/*
 * Vracker Space Dodgers - game core.
 * Pure JavaScript: no DOM, no rendering, no dependencies (same pattern as
 * tracker.js). Runs in the browser (window.VrGame) and in Node for tests.
 *
 * The core owns the rules: ship movement, asteroid/star spawning, collisions,
 * hearts, score, difficulty ramp. The renderer (game3d.js) only draws the
 * state and feeds inputs in. Steering inputs are normalized: -1 full left,
 * +1 full right, one value per ship per frame.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VrGame = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const DEFAULTS = {
    laneW: 6.2,          // steering range: ship x in [-laneW, +laneW]
    shipY: 0,            // ships fly in a plane; asteroids vary a little in y
    shipZ: 0,
    shipR: 0.95,         // ship collision radius
    shipMaxV: 13.5,      // lateral units/s at full steering deflection
    steerLag: 8,         // 1/s; how fast lateral velocity follows steering
    baseSpeed: 15,       // world approach speed, units/s
    speedRamp: 0.22,     // extra speed per second alive
    maxSpeedBonus: 16,
    spawnZ: -95,
    despawnZ: 12,
    spawnInt0: 2.6,      // s between asteroid spawns at t=0
    spawnIntMin: 0.9,
    spawnRamp: 0.012,    // spawn interval shrink per second alive
    pairChance: 0.18,    // chance an asteroid spawn is a pair with a gap
    pairGap: 3.4,        // guaranteed clear lane between a pair
    astRMin: 0.75,
    astRMax: 1.7,
    astYVar: 1.1,        // asteroid y wobble around the ship plane
    startHearts: 5,      // shared team hearts (co-op for kids)
    invulnS: 2.0,        // ship invulnerability after a hit
    starEveryS: 2.6,     // mean time between star spawns
    starR: 0.55,
    starScore: 50,
    dodgeScore: 5,       // per asteroid survived past the ships
    scorePerS: 10,       // survival trickle
    fullTurnDeg: 150,    // wheel degrees from center for full deflection
    shipGap: 2.6         // min x distance between ships (wingspan is ~2.4)
  };

  function createGame(opts) {
    const cfg = Object.assign({}, DEFAULTS, (opts && opts.cfg) || {});
    const rng = (opts && opts.rng) || Math.random;
    const state = {
      cfg, rng,
      time: 0, score: 0, hearts: cfg.startHearts,
      gameOver: false, started: false,
      speed: cfg.baseSpeed,
      ships: [
        { label: 'A', x: -2.4, vx: 0, inv: 0, steer: 0 },
        { label: 'B', x: 2.4, vx: 0, inv: 0, steer: 0 }
      ],
      asteroids: [], stars: [], particles: [],
      nextId: 1,
      spawnTimer: 2.4, starTimer: cfg.starEveryS,
      events: []           // consumed by renderer/audio each frame
    };
    return state;
  }

  function restart(state) {
    state.time = 0; state.score = 0; state.hearts = state.cfg.startHearts;
    state.gameOver = false; state.started = true;
    state.speed = state.cfg.baseSpeed;
    state.ships[0].x = -2.4; state.ships[1].x = 2.4;
    for (const s of state.ships) { s.vx = 0; s.inv = 0; s.steer = 0; }
    state.asteroids.length = 0;
    state.stars.length = 0;
    state.spawnTimer = 2.4; state.starTimer = state.cfg.starEveryS;
  }

  // Wheel angle (continuous degrees) -> normalized steering. The baseline is
  // the wheel angle captured at game start / recenter; turning the physical
  // wheel fullTurnDeg from it gives full deflection. Clamped to [-1, 1].
  function steerFromWheel(angleDeg, baselineDeg, fullTurnDeg) {
    const d = (angleDeg - baselineDeg) / (fullTurnDeg || DEFAULTS.fullTurnDeg);
    return Math.max(-1, Math.min(1, d));
  }

  // The webcam faces the player, so turning the physical wheel to the player's
  // right (clockwise for them) is counter-clockwise in the image: the tracked
  // image angle FALLS. Steering from tracker angles therefore inverts.
  function steerFromImageAngle(angleDeg, baselineDeg, fullTurnDeg) {
    return steerFromWheel(baselineDeg, angleDeg, fullTurnDeg);
  }

  function spawnAsteroid(state, x, y, r) {
    const cfg = state.cfg, rng = state.rng;
    state.asteroids.push({
      id: state.nextId++, x, y, z: cfg.spawnZ - rng() * 10, r,
      vz: state.speed * (0.9 + rng() * 0.2),
      rx: rng() * 6.28, ry: rng() * 6.28,
      wx: (rng() - 0.5) * 2.2, wy: (rng() - 0.5) * 2.2,
      color: Math.floor(rng() * 5),
      counted: false
    });
  }

  function spawnWave(state) {
    const cfg = state.cfg, rng = state.rng;
    const r = () => cfg.astRMin + rng() * (cfg.astRMax - cfg.astRMin);
    const y = () => cfg.shipY + (rng() - 0.5) * 2 * cfg.astYVar;
    if (rng() < cfg.pairChance) {
      // Two asteroids with a guaranteed clear gap between them.
      const gx = (rng() * 2 - 1) * (cfg.laneW - cfg.pairGap);
      spawnAsteroid(state, gx - cfg.pairGap - rng() * 2, y(), r());
      spawnAsteroid(state, gx + cfg.pairGap + rng() * 2, y(), r());
    } else {
      spawnAsteroid(state, (rng() * 2 - 1) * cfg.laneW, y(), r());
    }
  }

  function spawnStar(state) {
    const cfg = state.cfg, rng = state.rng;
    state.stars.push({
      id: state.nextId++,
      x: (rng() * 2 - 1) * cfg.laneW,
      y: cfg.shipY + (rng() - 0.5) * 2 * cfg.astYVar,
      z: cfg.spawnZ,
      vz: state.speed * 0.95,
      spin: rng() * 6.28
    });
  }

  function step(state, dt, steerA, steerB) {
    const cfg = state.cfg;
    state.events.length = 0;
    if (!state.started || state.gameOver || dt <= 0) return state;

    state.time += dt;
    state.speed = cfg.baseSpeed + Math.min(cfg.maxSpeedBonus, state.time * cfg.speedRamp);
    state.score += cfg.scorePerS * dt * (state.speed / cfg.baseSpeed);

    // Ships: lateral velocity follows steering with a short lag, clamp to lane.
    const steers = [steerA, steerB];
    for (let i = 0; i < 2; i++) {
      const s = state.ships[i];
      s.steer = Math.max(-1, Math.min(1, steers[i] || 0));
      const targetV = s.steer * cfg.shipMaxV;
      s.vx += (targetV - s.vx) * Math.min(1, cfg.steerLag * dt);
      s.x += s.vx * dt;
      if (s.x < -cfg.laneW) { s.x = -cfg.laneW; s.vx = Math.max(0, s.vx); }
      if (s.x > cfg.laneW) { s.x = cfg.laneW; s.vx = Math.min(0, s.vx); }
      if (s.inv > 0) s.inv -= dt;
    }

    // Ship-ship separation: the two rockets never overlap visually. Steering
    // still applies; positions are re-balanced around the midpoint only when
    // the ships would intrude into each other.
    const minGap = cfg.shipGap;
    let a = state.ships[0].x, b = state.ships[1].x;
    if (Math.abs(b - a) < minGap) {
      const m = (a + b) / 2;
      a = m - minGap / 2; b = m + minGap / 2;
      if (a < -cfg.laneW) { a = -cfg.laneW; b = a + minGap; }
      if (b > cfg.laneW) { b = cfg.laneW; a = b - minGap; }
      state.ships[0].x = a; state.ships[1].x = b;
    }

    // Spawning ramps up over time.
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnWave(state);
      const interval = Math.max(cfg.spawnIntMin, cfg.spawnInt0 - state.time * cfg.spawnRamp);
      state.spawnTimer = interval * (0.7 + state.rng() * 0.6);
    }
    state.starTimer -= dt;
    if (state.starTimer <= 0) {
      spawnStar(state);
      state.starTimer = cfg.starEveryS * (0.7 + state.rng() * 0.6);
    }

    // Move asteroids, resolve collisions at the ship plane.
    for (const a of state.asteroids) {
      a.z += a.vz * dt;
      a.rx += a.wx * dt; a.ry += a.wy * dt;
      if (!a.counted && a.z > cfg.shipZ + 1) {
        a.counted = true;
        state.score += cfg.dodgeScore;
      }
      for (const s of state.ships) {
        if (s.inv > 0) continue;
        const dz = a.z - cfg.shipZ;
        if (Math.abs(dz) > a.r + cfg.shipR) continue;
        const dx = a.x - s.x, dy = a.y - cfg.shipY;
        if (dx * dx + dy * dy < (a.r + cfg.shipR) * (a.r + cfg.shipR) * 0.82) {
          a.dead = true;
          s.inv = cfg.invulnS;
          state.hearts--;
          state.events.push({ type: 'hit', ship: s.label, x: a.x, y: a.y, z: a.z });
          if (state.hearts <= 0) {
            state.gameOver = true;
            state.events.push({ type: 'gameover', score: Math.floor(state.score) });
          }
          break;
        }
      }
    }
    state.asteroids = state.asteroids.filter(a => !a.dead && a.z < cfg.despawnZ);

    // Stars drift by and can be collected by either ship.
    for (const st of state.stars) {
      st.z += st.vz * dt;
      st.spin += dt * 3;
      for (const s of state.ships) {
        const dx = st.x - s.x, dy = st.y - cfg.shipY, dz = st.z - cfg.shipZ;
        if (dx * dx + dy * dy + dz * dz < (cfg.shipR + cfg.starR) * (cfg.shipR + cfg.starR)) {
          st.dead = true;
          state.score += cfg.starScore;
          state.events.push({ type: 'collect', ship: s.label, x: st.x, y: st.y, z: st.z });
          break;
        }
      }
    }
    state.stars = state.stars.filter(s => !s.dead && s.z < cfg.despawnZ);
    return state;
  }

  // Deterministic RNG for tests (32-bit LCG).
  function seededRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  return { DEFAULTS, createGame, restart, step, steerFromWheel, steerFromImageAngle, seededRng };
});
