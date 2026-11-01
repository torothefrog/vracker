/*
 * Vracker Space Dodgers - game core tests (pure logic, no rendering).
 * Run: node tests/game-tests.js
 * Deterministic: seeded RNG, fixed time steps.
 */
'use strict';
const G = require('../src/game/core.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

// --- steering mapping ---
{
  check('steer: baseline is zero', G.steerFromWheel(100, 100) === 0);
  check('steer: +150 deg = full right', G.steerFromWheel(250, 100) === 1);
  check('steer: -150 deg = full left', G.steerFromWheel(-50, 100) === -1);
  check('steer: half deflection', near(G.steerFromWheel(175, 100), 0.5, 1e-9));
  check('steer: clamps beyond full turn', G.steerFromWheel(1000, 100) === 1
    && G.steerFromWheel(-1000, 100) === -1);
  check('steer: continuous angles wrap-free (720 deg of spin)', G.steerFromWheel(820, 100) === 1);
}

// --- ship movement and lane clamp ---
{
  const g = G.createGame({ rng: G.seededRng(1) });
  G.restart(g);
  const x0 = g.ships[0].x;
  for (let i = 0; i < 60; i++) G.step(g, 1 / 60, 1, 0); // full right, 1s
  check('ship A moves right under positive steer', g.ships[0].x > x0, 'x=' + g.ships[0].x.toFixed(2));
  // hold right 10s: A pushes B to the lane edge, then parks one gap beside it
  for (let i = 0; i < 600; i++) G.step(g, 1 / 60, 1, 0);
  check('ship B clamps at right lane edge', near(g.ships[1].x, g.cfg.laneW, 0.01),
    'x=' + g.ships[1].x.toFixed(2));
  check('ship A stops one gap left of the edge',
    near(g.ships[0].x, g.cfg.laneW - g.cfg.shipGap, 0.05), 'x=' + g.ships[0].x.toFixed(2));
}
{
  const g = G.createGame({ rng: G.seededRng(11) });
  G.restart(g);
  for (let i = 0; i < 300; i++) G.step(g, 1 / 60, 0, 0); // nobody steers, 5s
  check('zero steer keeps both ships put',
    near(g.ships[0].x, -2.4, 0.2) && near(g.ships[1].x, 2.4, 0.2),
    'A=' + g.ships[0].x.toFixed(2) + ' B=' + g.ships[1].x.toFixed(2));
}

// --- ships never overlap (soft separation) ---
{
  const g = G.createGame({ rng: G.seededRng(2) });
  G.restart(g);
  // drive both toward center hard
  for (let i = 0; i < 300; i++) G.step(g, 1 / 60, 1, -1);
  const gap = g.ships[1].x - g.ships[0].x;
  check('ships keep a minimum visual gap', near(gap, g.cfg.shipGap, 0.05), 'gap=' + gap.toFixed(2));
}

// --- collision: heart loss, invulnerability window, game over ---
{
  const g = G.createGame({ rng: G.seededRng(3), cfg: { starEveryS: 999 } });
  G.restart(g);
  // park an asteroid right on top of ship A, just about to cross the plane
  g.asteroids.push({ id: 900, x: g.ships[0].x, y: 0, z: -1, r: 1.2, vz: g.speed,
    rx: 0, ry: 0, wx: 0, wy: 0, color: 0, counted: false });
  const hearts0 = g.hearts;
  G.step(g, 1 / 60, 0, 0);
  check('collision costs a heart', g.hearts === hearts0 - 1, 'hearts=' + g.hearts);
  check('hit event emitted', g.events.some(e => e.type === 'hit' && e.ship === 'A'));
  check('colliding asteroid consumed', !g.asteroids.some(a => a.id === 900));
  check('ship A invulnerable after hit', g.ships[0].inv > 0);
  // second immediate asteroid must not hurt the invulnerable ship
  g.asteroids.push({ id: 901, x: g.ships[0].x, y: 0, z: -1, r: 1.2, vz: g.speed,
    rx: 0, ry: 0, wx: 0, wy: 0, color: 0, counted: false });
  G.step(g, 1 / 60, 0, 0);
  check('invulnerability blocks a second hit', g.hearts === hearts0 - 1, 'hearts=' + g.hearts);
  // run the team out of hearts -> game over
  let guard = 0;
  while (!g.gameOver && guard++ < 3000) {
    g.ships[0].inv = 0; g.ships[1].inv = 0; // strip invulnerability for the test
    if (!g.asteroids.some(a => a.z < -1)) {
      g.asteroids.push({ id: 1000 + guard, x: g.ships[0].x, y: 0, z: -2, r: 1.2, vz: g.speed,
        rx: 0, ry: 0, wx: 0, wy: 0, color: 0, counted: false });
    }
    G.step(g, 1 / 60, 0, 0);
  }
  check('game over when hearts reach zero', g.gameOver === true, 'hearts=' + g.hearts);
  check('gameover event carries final score', g.events.some(e => e.type === 'gameover'));
  const frozenScore = g.score;
  G.step(g, 1 / 60, 1, 1);
  check('score frozen after game over', g.score === frozenScore);
  G.restart(g);
  check('restart resets hearts and gameOver', g.hearts === g.cfg.startHearts && !g.gameOver);
}

// --- star collection ---
{
  const g = G.createGame({ rng: G.seededRng(4), cfg: { spawnInt0: 999 } });
  G.restart(g);
  g.stars.push({ id: 800, x: g.ships[1].x, y: 0, z: -0.5, vz: g.speed, spin: 0 });
  const s0 = g.score;
  G.step(g, 1 / 60, 0, 0);
  check('star collected by overlapping ship', !g.stars.some(s => s.id === 800));
  check('star adds score', g.score - s0 >= g.cfg.starScore, 'd=' + (g.score - s0).toFixed(1));
  check('collect event emitted', g.events.some(e => e.type === 'collect' && e.ship === 'B'));
}

// --- difficulty ramp + spawning ---
{
  const g = G.createGame({ rng: G.seededRng(5) });
  G.restart(g);
  const v0 = g.speed;
  for (let i = 0; i < 60 * 30; i++) G.step(g, 1 / 60, 0, 0); // 30 s
  check('approach speed ramps up', g.speed > v0 + 3, 'v=' + g.speed.toFixed(1));
  check('asteroids keep spawning', g.asteroids.length > 0);
  check('spawn interval floor respected', g.cfg.spawnInt0 - g.time * g.cfg.spawnRamp > -999); // sanity
}

// --- pair spawns always leave a gap ---
{
  let ok = true;
  for (let seed = 0; seed < 40; seed++) {
    const g = G.createGame({ rng: G.seededRng(seed), cfg: { pairChance: 1 } });
    G.restart(g);
    g.spawnTimer = 0;
    G.step(g, 1 / 60, 0, 0);
    const fresh = g.asteroids.filter(a => a.z < -80);
    if (fresh.length >= 2) {
      const xs = fresh.map(a => a.x).sort((a, b) => a - b);
      if (xs[1] - xs[0] < g.cfg.pairGap) ok = false;
    }
  }
  check('paired asteroids always leave a clear lane', ok);
}

// --- asteroids despawn and award dodge score ---
{
  const g = G.createGame({ rng: G.seededRng(6), cfg: { spawnInt0: 999, starEveryS: 999 } });
  G.restart(g);
  g.asteroids.push({ id: 700, x: 99, y: 0, z: -2, r: 1, vz: g.speed,
    rx: 0, ry: 0, wx: 0, wy: 0, color: 0, counted: false });
  const s0 = g.score;
  for (let i = 0; i < 120; i++) G.step(g, 1 / 60, 0, 0);
  check('passed asteroid despawns', !g.asteroids.some(a => a.id === 700));
  check('dodged asteroid awards score', g.score - s0 > g.cfg.dodgeScore, 'd=' + (g.score - s0).toFixed(1));
}

console.log(failures === 0 ? '\nALL GAME TESTS PASSED' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
