/*
 * Vracker Space Dodgers - Three.js renderer and game shell.
 * Two ships, one shared screen, steered by the marker wheels (or keyboard /
 * touch while testing). All visuals are original low-poly primitives built
 * here in code - no external assets. Rendering only: the rules live in
 * src/game/core.js.
 */
import * as THREE from 'three';

(function () {
  'use strict';
  const G = window.VrGame;
  const params = new URLSearchParams(location.search);
  const TEST = params.get('test') === '1';
  const TEST_SECONDS = Number(params.get('testsecs') || 12);

  // ---------- DOM ----------
  const canvas = document.getElementById('scene');
  const hudHearts = document.getElementById('hearts');
  const hudScore = document.getElementById('score');
  const hudBest = document.getElementById('best');
  const startOverlay = document.getElementById('startOverlay');
  const overOverlay = document.getElementById('overOverlay');
  const overScore = document.getElementById('overScore');
  const overBest = document.getElementById('overBest');
  const statusEl = document.getElementById('status');
  const preview = document.getElementById('preview');
  const btnStart1 = document.getElementById('btnStart1');
  const btnStart2 = document.getElementById('btnStart2');
  const btnRestart = document.getElementById('btnRestart');
  const btnMenu = document.getElementById('btnMenu');
  const btnCamera = document.getElementById('btnCamera');
  const btnCamera2 = document.getElementById('btnCamera2');
  const btnRecenter = document.getElementById('btnRecenter');
  const btnMute = document.getElementById('btnMute');
  const testLog = document.getElementById('testlog');

  const setStatus = (m) => { statusEl.textContent = m; };

  // ---------- Audio (tiny original synth, generated in code) ----------
  let audioCtx = null;
  let muted = localStorage.getItem('vracker-muted') === '1';
  function ensureAudio() {
    if (!audioCtx && !TEST) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
  }
  function tone(f0, f1, dur, type, vol) {
    if (muted || !audioCtx) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol || 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noiseBurst(dur, vol) {
    if (muted || !audioCtx) return;
    const t = audioCtx.currentTime;
    const n = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const g = audioCtx.createGain(); g.gain.value = vol || 0.18;
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    src.connect(f); f.connect(g); g.connect(audioCtx.destination);
    src.start(t);
  }
  const sfx = {
    collect() { tone(880, 1568, 0.16, 'sine', 0.10); tone(1320, 2093, 0.12, 'triangle', 0.05); },
    heart() { tone(660, 990, 0.14, 'sine', 0.10); setTimeout(() => tone(990, 1320, 0.2, 'sine', 0.10), 120); },
    hit() { noiseBurst(0.3, 0.22); tone(160, 60, 0.28, 'sawtooth', 0.08); },
    start() { tone(523, 523, 0.1, 'triangle', 0.1); setTimeout(() => tone(659, 659, 0.1, 'triangle', 0.1), 110); setTimeout(() => tone(784, 1046, 0.18, 'triangle', 0.12), 220); },
    over() { tone(392, 196, 0.5, 'triangle', 0.12); setTimeout(() => tone(330, 165, 0.6, 'triangle', 0.1), 250); }
  };
  function refreshMute() { btnMute.textContent = muted ? 'sound: off' : 'sound: on'; }
  btnMute.addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem('vracker-muted', muted ? '1' : '0');
    refreshMute();
  });
  refreshMute();

  const shipMeshes = [];   // filled below by buildShip; fitCamera scales these

  // ---------- Renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x150b28);
  scene.fog = new THREE.Fog(0x150b28, 45, 135);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 300);
  camera.position.set(0, 4.6, 9.5);
  camera.lookAt(0, 0.4, -14);
  let shake = 0;

  // Pull the camera back on narrow (portrait) screens so both lane edges and
  // both ships stay in view. Ships live at z=0 within x +/- ~8.
  let shipScaleNow = 1;
  function fitCamera() {
    const halfFovH = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
    const need = 8.0 / Math.max(Math.tan(halfFovH), 0.05);
    camera.position.z = Math.max(9.5, Math.min(need, 24));
    camera.position.y = 4.6 + (camera.position.z - 9.5) * 0.3;
    // Portrait zooms far out; scale the rockets up so they stay readable.
    // The separation gap scales with them so wings still never overlap.
    shipScaleNow = camera.position.z > 13 ? 1.45 : 1;
    for (const m of shipMeshes) m.scale.set(shipScaleNow, shipScaleNow, shipScaleNow);
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    fitCamera();
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  scene.add(new THREE.AmbientLight(0x9d8cff, 0.55));
  const hemi = new THREE.HemisphereLight(0x8a7bff, 0x241035, 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d9, 1.4);
  sun.position.set(6, 10, 4);
  scene.add(sun);

  // Starfield: drifting points, recycled as they pass the camera.
  const STAR_N = 900;
  const starPos = new Float32Array(STAR_N * 3);
  for (let i = 0; i < STAR_N; i++) {
    starPos[i * 3] = (Math.random() * 2 - 1) * 70;
    starPos[i * 3 + 1] = (Math.random() * 2 - 1) * 42 + 4;
    starPos[i * 3 + 2] = -Math.random() * 150 + 10;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  function glowTexture(inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.4, outer);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const starMat = new THREE.PointsMaterial({
    color: 0xfff6e0, size: 0.9, sizeAttenuation: true,
    map: glowTexture('rgba(255,250,235,1)', 'rgba(255,230,180,0.5)'),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  scene.add(new THREE.Points(starGeo, starMat));

  // Soft nebula clouds: big translucent colored sprites for a friendlier sky.
  function nebula(x, y, z, scale, inner, outer) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(inner, outer), transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending
    }));
    m.position.set(x, y, z);
    m.scale.set(scale, scale * 0.7, 1);
    scene.add(m);
    return m;
  }
  nebula(-30, 12, -110, 90, 'rgba(255,120,200,0.55)', 'rgba(140,40,160,0.25)');
  nebula(35, -6, -100, 80, 'rgba(90,200,255,0.45)', 'rgba(40,60,180,0.22)');
  nebula(5, 26, -125, 100, 'rgba(150,120,255,0.4)', 'rgba(60,30,140,0.2)');

  // A few big pastel planets far away for depth (kid-friendly color pops).
  function planet(x, y, z, r, color, ring) {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 1),
      new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 })
    );
    m.position.set(x, y, z);
    scene.add(m);
    if (ring) {
      const rg = new THREE.Mesh(
        new THREE.TorusGeometry(r * 1.6, r * 0.16, 8, 40),
        new THREE.MeshStandardMaterial({ color: 0xffd9a0, flatShading: true, roughness: 0.8 })
      );
      rg.rotation.x = Math.PI / 2.4;
      m.add(rg);
    }
    return m;
  }
  planet(-38, 14, -95, 7, 0xff9ecb, true);
  planet(34, -10, -80, 5, 0x7be0c3, false);
  planet(10, 24, -120, 9, 0x8fa8ff, false);

  // ---------- Ships (original low-poly rockets) ----------
  function buildShip(bodyColor, accentColor) {
    const g = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ color: bodyColor, flatShading: true, roughness: 0.55, metalness: 0.1, emissive: bodyColor, emissiveIntensity: 0.18 });
    const matAccent = new THREE.MeshStandardMaterial({ color: accentColor, flatShading: true, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.1, 8), matBody);
    body.rotation.x = -Math.PI / 2;          // point forward (-Z)
    g.add(body);
    const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.62, 0.9, 8), matBody);
    belly.rotation.x = -Math.PI / 2;
    belly.position.z = 0.9;
    g.add(belly);
    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xcff4ff, flatShading: true, roughness: 0.15, metalness: 0.3, emissive: 0x224455 })
    );
    cockpit.position.set(0, 0.32, 0.15);
    g.add(cockpit);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.09, 0.75), matAccent);
      wing.position.set(side * 0.75, -0.12, 0.95);
      wing.rotation.z = side * 0.22;
      wing.rotation.y = side * -0.35;
      g.add(wing);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 6), matAccent);
      tip.position.set(side * 1.22, 0.02, 1.05);
      g.add(tip);
    }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.7, 0.6), matAccent);
    fin.position.set(0, 0.42, 1.05);
    g.add(fin);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 1.1, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9 })
    );
    flame.rotation.x = Math.PI / 2;          // points backwards (+Z)
    flame.position.z = 1.95;
    g.add(flame);
    const flameCore = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.7, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.95 })
    );
    flameCore.rotation.x = Math.PI / 2;
    flameCore.position.z = 1.9;
    g.add(flameCore);
    g.userData.flame = flame;
    g.userData.flameCore = flameCore;
    g.userData.mats = [matBody, matAccent];
    scene.add(g);
    return g;
  }
  shipMeshes.push(
    buildShip(0x35d07f, 0x1e7a4c),   // player A: green (matches wheel A); the solo ship
    buildShip(0x41b8f5, 0x1f6fa8)    // player B: blue (matches wheel B); hidden in solo
  );
  fitCamera();                       // apply initial ship scale

  // ---------- Asteroids / stars / particles ----------
  const AST_COLORS = [0xc98a5e, 0xa06be0, 0x7fd4c1, 0xe0b34f, 0xd97b8f];
  const astGeoCache = new Map();
  function astGeo(r) {
    const key = r.toFixed(2);
    if (!astGeoCache.has(key)) astGeoCache.set(key, new THREE.IcosahedronGeometry(r, 0));
    return astGeoCache.get(key);
  }
  const astMeshes = new Map(); // core id -> mesh
  function getAstMesh(a) {
    let m = astMeshes.get(a.id);
    if (!m) {
      m = new THREE.Mesh(astGeo(a.r), new THREE.MeshStandardMaterial({
        color: AST_COLORS[a.color % AST_COLORS.length], flatShading: true, roughness: 0.95
      }));
      // bumpy little crater lumps so they read as rocks, not dice
      const lumps = 3 + (a.id % 3);
      const lumpMat = m.material;
      for (let i = 0; i < lumps; i++) {
        const lr = a.r * (0.25 + ((a.id * (i + 3)) % 10) / 40);
        const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(lr, 0), lumpMat);
        const th = (a.id * 1.7 + i * 2.1) % 6.28, ph = (a.id * 0.9 + i * 1.3) % 3.14;
        lump.position.set(
          Math.sin(ph) * Math.cos(th) * a.r * 0.75,
          Math.cos(ph) * a.r * 0.75,
          Math.sin(ph) * Math.sin(th) * a.r * 0.75
        );
        m.add(lump);
      }
      astMeshes.set(a.id, m);
      scene.add(m);
    }
    return m;
  }

  const starMeshes = new Map();
  const starGeoMesh = new THREE.OctahedronGeometry(0.5, 0);
  starGeoMesh.scale(1, 1.25, 0.55);
  const starMatGold = new THREE.MeshStandardMaterial({
    color: 0xffd94d, emissive: 0x8a5a00, flatShading: true, roughness: 0.3
  });
  function getStarMesh(s) {
    let m = starMeshes.get(s.id);
    if (!m) {
      m = new THREE.Mesh(starGeoMesh, starMatGold);
      starMeshes.set(s.id, m);
      scene.add(m);
    }
    return m;
  }

  // Heart pickups: an original flat heart shape (drawn in code, no assets),
  // extruded thin so it reads as a clean icon against the sky.
  const heartMeshes = new Map();
  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, 0.28);
  heartShape.bezierCurveTo(-0.08, 0.52, -0.38, 0.56, -0.5, 0.34);
  heartShape.bezierCurveTo(-0.68, 0.02, -0.42, -0.3, 0, -0.52);
  heartShape.bezierCurveTo(0.42, -0.3, 0.68, 0.02, 0.5, 0.34);
  heartShape.bezierCurveTo(0.38, 0.56, 0.08, 0.52, 0, 0.28);
  const heartGeoMesh = new THREE.ExtrudeGeometry(heartShape, { depth: 0.2, bevelEnabled: false });
  heartGeoMesh.center();
  const heartMatPink = new THREE.MeshStandardMaterial({
    color: 0xff5c8a, emissive: 0x7a1030, flatShading: true, roughness: 0.35
  });
  function getHeartMesh(h) {
    let m = heartMeshes.get(h.id);
    if (!m) {
      m = new THREE.Mesh(heartGeoMesh, heartMatPink);
      heartMeshes.set(h.id, m);
      scene.add(m);
    }
    return m;
  }

  // Particle bursts (pooled tiny tetra shards).
  const particles = [];
  const shardGeo = new THREE.TetrahedronGeometry(0.16);
  function burst(x, y, z, color, n, spread) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(shardGeo, mat.clone());
      m.position.set(x, y, z);
      const th = Math.random() * 6.28, ph = Math.acos(Math.random() * 2 - 1);
      const sp = (0.5 + Math.random()) * (spread || 7);
      particles.push({
        mesh: m,
        vx: Math.sin(ph) * Math.cos(th) * sp,
        vy: Math.cos(ph) * sp,
        vz: Math.sin(ph) * Math.sin(th) * sp,
        life: 0.8 + Math.random() * 0.3
      });
      scene.add(m);
    }
  }
  function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        scene.remove(p.mesh);
        p.mesh.material.dispose();
        particles.splice(i, 1);
        continue;
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += (p.vz + game.speed * 0.5) * dt;
      p.mesh.rotation.x += dt * 6; p.mesh.rotation.y += dt * 5;
      p.mesh.material.opacity = Math.min(1, p.life * 1.6);
    }
  }

  // ---------- Game state + inputs ----------
  // Player mode: 1 (solo, one ship) or 2 (co-op pair). Saved in the browser;
  // the ?players=1 URL parameter wins so the test harness can force a mode.
  let players = (params.get('players') || localStorage.getItem('vracker-players')) === '1' ? 1 : 2;
  let game = G.createGame({ players });
  let best = Number(localStorage.getItem('vracker-best') || 0);
  hudBest.textContent = 'best ' + best;

  function setMode(n, save) {
    players = n === 1 ? 1 : 2;
    // Only a real mode choice is saved; the initial call (and the ?players=
    // URL override used by the test harness) must not overwrite it.
    if (save !== false) localStorage.setItem('vracker-players', String(players));
    game = G.createGame({ players });
    window.__vracker.game = game;
    shipMeshes[1].visible = players === 2;
    btnStart1.classList.toggle('sel', players === 1);
    btnStart2.classList.toggle('sel', players === 2);
  }

  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if ((e.code === 'Enter' || e.code === 'Space') && (!game.started || game.gameOver)) startGame();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  // Touch: left half steers ship A, right half ship B, by drag distance.
  const touches = new Map(); // pointerId -> {ship, x0, steer}
  canvas.addEventListener('pointerdown', (e) => {
    const ship = players === 1 ? 0 : (e.clientX < window.innerWidth / 2 ? 0 : 1);
    touches.set(e.pointerId, { ship, x0: e.clientX, steer: 0 });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  canvas.addEventListener('pointermove', (e) => {
    const t = touches.get(e.pointerId);
    if (t) t.steer = Math.max(-1, Math.min(1, (e.clientX - t.x0) / 90));
  });
  const endTouch = (e) => touches.delete(e.pointerId);
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);

  const camSelects = [document.getElementById('camSelectTop'), document.getElementById('camSelectStart')];
  const wheels = window.VrWheelInput.create({
    video: document.getElementById('cam'),
    preview,
    markerEl: document.getElementById('markers'),
    selects: camSelects,
    onStatus: setStatus
  });
  // Camera chooser: same list in the top bar and on the start screen. Picking
  // one switches the live camera without reloading (or just remembers it).
  for (const sel of camSelects) {
    sel.addEventListener('change', async () => {
      for (const o of camSelects) o.value = sel.value;
      await wheels.switchCamera(sel.value);
    });
  }
  if (window.VrCamera && navigator.mediaDevices) {
    const refreshCams = () => window.VrCamera.fill(camSelects, undefined).catch(() => {});
    refreshCams();
    if (navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', refreshCams);
  }
  // Read-only diagnostic handle (used by live checks; handy for tinkering).
  window.__vracker = { game, version: '2.4.0', wheels };

  btnCamera.addEventListener('click', async () => { ensureAudio(); await wheels.start(); });
  btnCamera2.addEventListener('click', async () => { ensureAudio(); await wheels.start(); });
  btnRecenter.addEventListener('click', () => wheels.recenter());

  function keyboardSteer(ship) {
    if (ship === 0) return (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    return (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  }
  function touchSteer(ship) {
    for (const t of touches.values()) if (t.ship === ship) return t.steer;
    return 0;
  }
  function inputFor(ship) {
    const label = ship === 0 ? 'A' : 'B';
    const w = wheels.getSteer(label);
    if (w !== null) return w;
    const k = keyboardSteer(ship);
    if (k !== 0) return k;
    return touchSteer(ship);
  }
  // Solo: whichever wheel is seen steers (A preferred), A/D and arrow keys
  // both work, and a drag anywhere on the screen steers.
  function inputSolo() {
    const wa = wheels.getSteer('A');
    if (wa !== null) return wa;
    const wb = wheels.getSteer('B');
    if (wb !== null) return wb;
    const k = ((keys.has('KeyD') || keys.has('ArrowRight')) ? 1 : 0) -
              ((keys.has('KeyA') || keys.has('ArrowLeft')) ? 1 : 0);
    if (k !== 0) return k;
    for (const t of touches.values()) return t.steer;
    return 0;
  }

  function startGame() {
    ensureAudio();
    G.restart(game);
    wheels.recenter();
    startOverlay.style.display = 'none';
    overOverlay.style.display = 'none';
    shake = 0;
    sfx.start();
    setStatus(wheels.active()
      ? (players === 1
        ? 'Steer with the wheel. Turn right to move right; back to center = straight.'
        : 'Steer with the wheels. Turn right to move right; back to center = straight.')
      : (players === 1
        ? 'Steer with A/D or the arrow keys, or drag anywhere on the screen.'
        : 'Ship A: A/D keys. Ship B: left/right arrows. Or drag on the left/right half of the screen.'));
  }
  btnStart1.addEventListener('click', () => { setMode(1); startGame(); });
  btnStart2.addEventListener('click', () => { setMode(2); startGame(); });
  btnRestart.addEventListener('click', startGame);
  btnMenu.addEventListener('click', () => {
    overOverlay.style.display = 'none';
    startOverlay.style.display = 'flex';
  });
  setMode(players, false);

  // ---------- HUD ----------
  // Flat inline-SVG hearts (recolorable icons, no emoji): filled for hearts
  // you have, dim outline-fill for hearts lost.
  const HEART_PATH = 'M12 21 C12 21 2 13.6 2 7.6 C2 4.5 4.4 2.2 7.3 2.2 ' +
    'C9.2 2.2 11 3.3 12 4.9 C13 3.3 14.8 2.2 16.7 2.2 C19.6 2.2 22 4.5 22 7.6 ' +
    'C22 13.6 12 21 12 21 Z';
  function heartIcon(fill, stroke) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
      '<path d="' + HEART_PATH + '" fill="' + fill + '" stroke="' + stroke +
      '" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }
  function drawHearts() {
    const full = Math.max(0, game.hearts);
    let html = '';
    for (let i = 0; i < game.cfg.startHearts; i++) {
      html += i < full
        ? heartIcon('#ff6b8a', 'rgba(0,0,0,0.35)')
        : heartIcon('rgba(255,107,138,0.12)', 'rgba(255,107,138,0.55)');
    }
    hudHearts.innerHTML = html;
  }
  drawHearts();

  // ---------- Main loop ----------
  const clock = new THREE.Clock();
  let testTime = 0, testHits = 0, testCollects = 0, testDone = false;
  let maxAsteroidsSeen = 0;
  // ?heartdemo=1 freezes a frame with a pickup mid-flight and a damaged HUD;
  // ?heartdemo=2 forces a pickup onto the ship at the end so the restored
  // heart (HUD + burst) is visible in the frozen frame. Test-only hooks.
  const HEART_DEMO = Number(params.get('heartdemo') || 0);
  let heartDemoDone = false;


  // ---------- Lane guide: edge rails + asteroid path stripes ----------
  // Rails mark exactly how far the ships can go (ship center clamps at
  // laneW; the hull reaches ~1.2 further). Each asteroid casts a floor
  // stripe from itself to the ship line, as wide as its hit zone, so you can
  // see whether your ship is in its path. Stripes turn red when a ship is in
  // the path and the asteroid is close.
  const FLOOR_Y = -1.25;
  const railX = game.cfg.laneW + 1.25;
  const railMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.75 });
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 110), railMat);
    rail.position.set(sx * railX, FLOOR_Y, -45);
    scene.add(rail);
  }
  const gate = new THREE.Mesh(new THREE.BoxGeometry(railX * 2, 0.06, 0.12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
  gate.position.set(0, FLOOR_Y, game.cfg.shipZ);
  scene.add(gate);
  const stripeGeo = new THREE.PlaneGeometry(1, 1);
  stripeGeo.rotateX(-Math.PI / 2);
  const stripes = new Map(); // asteroid id -> mesh
  function syncStripes() {
    const live = new Set();
    for (const a of game.asteroids) {
      if (a.z > game.cfg.shipZ + 1) continue;
      live.add(a.id);
      let m = stripes.get(a.id);
      if (!m) {
        m = new THREE.Mesh(stripeGeo, new THREE.MeshBasicMaterial({
          color: 0xffb454, transparent: true, opacity: 0.09, depthWrite: false }));
        scene.add(m); stripes.set(a.id, m);
      }
      const w = (a.r + game.cfg.shipR) * 1.8 * 0.9;
      const len = Math.max(0.1, game.cfg.shipZ - a.z);
      m.scale.set(w, 1, len);
      m.position.set(a.x, FLOOR_Y + 0.01, a.z + len / 2);
      let danger = false;
      for (const sh of game.ships) {
        if (Math.abs(sh.x - a.x) < (a.r + game.cfg.shipR) * 0.9) danger = true;
      }
      const near = a.z > -45;
      m.material.color.setHex(danger && near ? 0xff5c5c : 0xffb454);
      m.material.opacity = danger && near ? 0.32 : 0.09;
    }
    for (const [id, m] of stripes) {
      if (!live.has(id)) { scene.remove(m); m.material.dispose(); stripes.delete(id); }
    }
  }

  function syncMeshes() {
    const seenAst = new Set(), seenStar = new Set();
    for (const a of game.asteroids) {
      const m = getAstMesh(a);
      m.position.set(a.x, a.y, a.z);
      m.rotation.set(a.rx, a.ry, 0);
      seenAst.add(a.id);
    }
    for (const [id, m] of astMeshes) {
      if (!seenAst.has(id)) { scene.remove(m); m.material.dispose(); astMeshes.delete(id); }
    }
    for (const s of game.stars) {
      const m = getStarMesh(s);
      m.position.set(s.x, s.y, s.z);
      m.rotation.z = s.spin;
      seenStar.add(s.id);
    }
    for (const [id, m] of starMeshes) {
      if (!seenStar.has(id)) { scene.remove(m); starMeshes.delete(id); }
    }
    const seenHeart = new Set();
    for (const h of game.heartsPickups) {
      const m = getHeartMesh(h);
      m.position.set(h.x, h.y, h.z);
      m.rotation.y = Math.sin(h.spin) * 0.55;        // gentle wobble, keeps the face readable
      const pulse = 1.15 + Math.sin(h.spin * 2.2) * 0.15;
      m.scale.set(pulse, pulse, pulse);
      seenHeart.add(h.id);
    }
    for (const [id, m] of heartMeshes) {
      if (!seenHeart.has(id)) { scene.remove(m); heartMeshes.delete(id); }
    }
    maxAsteroidsSeen = Math.max(maxAsteroidsSeen, game.asteroids.length);
    syncStripes();

    for (let i = 0; i < game.ships.length; i++) {
      const s = game.ships[i], m = shipMeshes[i];
      m.position.set(s.x, game.cfg.shipY, game.cfg.shipZ);
      m.rotation.z = -s.vx * 0.045;                    // bank into the turn
      m.rotation.x = Math.abs(s.vx) * 0.004;
      const flick = 0.85 + Math.sin(performance.now() * 0.03 + i * 2) * 0.15;
      m.userData.flame.scale.set(flick, flick, 0.8 + flick * 0.4);
      m.userData.flameCore.scale.set(flick, flick, 0.8 + flick * 0.3);
      // invulnerability blink
      m.visible = s.inv <= 0 || Math.floor(s.inv * 12) % 2 === 0;
    }
  }

  function handleEvents() {
    for (const ev of game.events) {
      if (ev.type === 'hit') {
        burst(ev.x, ev.y, ev.z, 0xff8a5c, 26, 8);
        burst(ev.x, ev.y, ev.z, 0xffe08a, 14, 5);
        shake = 0.5;
        sfx.hit();
      } else if (ev.type === 'collect') {
        burst(ev.x, ev.y, ev.z, 0xffd94d, 12, 4);
        sfx.collect();
      } else if (ev.type === 'heart') {
        burst(ev.x, ev.y, ev.z, 0xff6b9d, 18, 5);
        burst(ev.x, ev.y, ev.z, 0xffc2d4, 10, 3);
        sfx.heart();
      } else if (ev.type === 'gameover') {
        sfx.over();
        const sc = Math.floor(game.score);
        if (sc > best) { best = sc; localStorage.setItem('vracker-best', String(best)); }
        overScore.textContent = 'score ' + sc;
        overBest.textContent = 'best ' + best;
        hudBest.textContent = 'best ' + best;
        overOverlay.style.display = 'flex';
      }
    }
  }

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (TEST) {
      // Deterministic harness: simulate fixed steps up-front (software GL in
      // headless runs rAF slowly, so wall-clock stepping would never finish),
      // then freeze and keep rendering the reached state for screenshots.
      if (!game.started) startGame();
      if (!testDone) {
        if (HEART_DEMO) {
          game.hearts = Math.max(1, game.cfg.startHearts - 2);
          drawHearts();
        }
        while (testTime < TEST_SECONDS && !game.gameOver) {
          if (HEART_DEMO && !heartDemoDone && testTime >= TEST_SECONDS - (HEART_DEMO === 1 ? 1.8 : 0.4)) {
            heartDemoDone = true;
            if (HEART_DEMO === 1) {
              // park a pickup ahead of ship A, out of collection range
              game.heartsPickups.push({ id: 90001, x: game.ships[0].x, y: 0, z: -30, vz: game.speed * 0.95, spin: 0 });
            } else {
              // drop one right on the ship: collected within a frame or two
              game.asteroids.length = 0;
              game.spawnTimer = 999;
              game.heartsPickups.push({ id: 90002, x: game.ships[0].x, y: 0, z: game.cfg.shipZ - 0.5, vz: game.speed * 0.95, spin: 0 });
            }
          }
          testTime += 1 / 60;
          const sa = Math.sin(testTime * 0.9), sb = Math.cos(testTime * 0.7) * 0.8;
          G.step(game, 1 / 60, sa, game.ships.length > 1 ? sb : 0);
          for (const ev of game.events) {
            if (ev.type === 'hit') testHits++;
            if (ev.type === 'collect') testCollects++;
          }
          if (game.asteroids.length > maxAsteroidsSeen) maxAsteroidsSeen = game.asteroids.length;
        }
        testDone = true;
        const report = {
          ok: true,
          players: game.ships.length,
          seconds: Math.round(testTime * 10) / 10,
          score: Math.floor(game.score),
          hearts: game.hearts,
          hits: testHits,
          collects: testCollects,
          gameOver: game.gameOver,
          asteroidsLive: game.asteroids.length,
          maxAsteroidsSeen,
          shipAx: Math.round(game.ships[0].x * 100) / 100,
          shipBx: game.ships.length > 1 ? Math.round(game.ships[1].x * 100) / 100 : null
        };
        testLog.textContent = 'VRTEST ' + JSON.stringify(report);
        document.title = 'TESTDONE';
      }
    } else if (game.ships.length === 1) {
      G.step(game, dt, inputSolo(), 0);
    } else {
      G.step(game, dt, inputFor(0), inputFor(1));
    }

    game.cfg.shipGap = 2.6 * shipScaleNow; // gap follows visual ship scale
    wheels.update(performance.now());
    handleEvents();
    syncMeshes();
    stepParticles(dt);

    // Starfield drift
    const arr = starGeo.attributes.position.array;
    const drift = (game.started && !game.gameOver ? game.speed : 4) * dt * 0.35;
    for (let i = 0; i < STAR_N; i++) {
      arr[i * 3 + 2] += drift * (0.6 + (i % 5) * 0.1);
      if (arr[i * 3 + 2] > 10) arr[i * 3 + 2] -= 160;
    }
    starGeo.attributes.position.needsUpdate = true;

    // Camera shake decay (around the fitted base position). On narrow screens
    // (camera pulled back) the view pans with the ships' midpoint so both
    // players stay in frame even when both steer the same way.
    const baseY = 4.6 + (camera.position.z - 9.5) * 0.3;
    const midX = game.ships.length === 1
      ? game.ships[0].x
      : (game.ships[0].x + game.ships[1].x) / 2;
    const baseX = camera.position.z > 13 ? Math.max(-3.2, Math.min(3.2, midX * 0.55)) : 0;
    if (shake > 0) {
      shake = Math.max(0, shake - dt * 1.8);
      camera.position.x = baseX + (Math.random() - 0.5) * shake * 0.7;
      camera.position.y = baseY + (Math.random() - 0.5) * shake * 0.5;
    } else {
      camera.position.x += (baseX - camera.position.x) * Math.min(1, dt * 4);
      camera.position.y = baseY;
    }
    camera.lookAt(camera.position.x, 0.4, -14);

    hudScore.textContent = 'score ' + Math.floor(game.score);
    drawHearts();
    renderer.render(scene, camera);
  }
  frame();
})();
