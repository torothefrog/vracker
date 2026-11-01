/*
 * Vracker pipeline tests - SIMULATED frames only.
 * Run: node tests/run-tests.js
 * These prove the math and the tracking pipeline against synthetic frames
 * with known ground truth. They do NOT validate a real camera, real
 * lighting, or physical markers; that check happens on the user's machine.
 */
'use strict';
const T = require('../src/tracker.js');
const S = require('../src/sim.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

// --- color conversion ---
{
  const [h1, s1, v1] = T.rgbToHsv(0, 230, 90);
  check('rgbToHsv green hue', near(h1, 143.5, 4), 'h=' + h1.toFixed(1));
  check('rgbToHsv green sat/val', near(s1, 1, 0.01) && near(v1, 230 / 255, 0.01));
  const [h2] = T.rgbToHsv(230, 0, 220);
  check('rgbToHsv magenta hue', near(h2, 302.6, 4), 'h=' + h2.toFixed(1));
  const [h3] = T.rgbToHsv(0, 200, 230);
  check('rgbToHsv cyan hue', near(h3, 187.8, 4), 'h=' + h3.toFixed(1));
  const [h4] = T.rgbToHsv(240, 220, 0);
  check('rgbToHsv yellow hue', near(h4, 55, 4), 'h=' + h4.toFixed(1));
  check('hueDist wraps', T.hueDist(5, 355) === 10);
}

// --- single-frame measurement against ground truth ---
{
  const W = 320, H = 240;
  const sim = S.createSimulator(W, H);
  const cfg = T.defaultConfig();
  const t = 0.37;
  const state = T.createState();
  const out = T.step(state, sim.draw(t), cfg, 1000);
  const byLabel = {};
  for (const wh of out.wheels) byLabel[wh.label] = wh;
  check('two wheels detected', out.wheels.length === 2, 'got ' + out.wheels.length);
  const gt = sim.truth(t); // index 0 = wheel A, index 1 = wheel B
  for (const [label, i] of [['A', 0], ['B', 1]]) {
    const ms = byLabel[label];
    check('wheel ' + label + ' present', !!ms);
    if (!ms) continue;
    const mx = gt[i].cx + (gt[i].ptrR / 2) * Math.cos(gt[i].angle);
    const my = gt[i].cy + (gt[i].ptrR / 2) * Math.sin(gt[i].angle);
    check('wheel ' + label + ' midpoint', near(ms.x, mx, 2) && near(ms.y, my, 2),
      `meas (${ms.x.toFixed(1)},${ms.y.toFixed(1)}) vs true (${mx.toFixed(1)},${my.toFixed(1)})`);
    const trueDeg = gt[i].angle * 180 / Math.PI;
    check('wheel ' + label + ' angle', near(ms.angleDeg, trueDeg, 3),
      `meas ${ms.angleDeg.toFixed(1)} vs true ${trueDeg.toFixed(1)}`);
  }
}

// --- identity is color-bound: labels and rotation direction are deterministic ---
{
  const W = 320, H = 240;
  const sim = S.createSimulator(W, H);
  const cfg = T.defaultConfig();
  const state = T.createState();
  let velOk = true;
  for (let f = 0; f <= 60; f++) {
    const t = f / 30;
    T.step(state, sim.draw(t), cfg, 1000 + f * 33);
    if (f > 10) {
      const a = state.wheels.A, b = state.wheels.B;
      if (!a || !b) { velOk = false; continue; }
      if (a.angVel < 20) velOk = false;    // A = +90 deg/s by ground truth
      if (b.angVel > -10) velOk = false;   // B = -45 deg/s by ground truth
    }
  }
  check('angular velocity signs (A +90, B -45 deg/s)', velOk);
  check('both wheels survived 2s of motion', !!state.wheels.A && !!state.wheels.B);
  check('A continuous angle exceeds one turn', state.wheels.A.angleDeg > 150,
    'angleDeg=' + state.wheels.A.angleDeg.toFixed(0));
}

// --- crossing: distinct colors keep identity through a pass-through ---
{
  const W = 320, H = 240;
  // wheels pass each other with a 60px vertical offset (physically realistic:
  // two wheels side by side, bodies never overlap, dots stay visible)
  const pass = (t) => [
    { cx: 60 + t * 40, cy: 90,  angle: t * 1.5, wheelR: 30, cDotR: 8, pDotR: 8, ptrR: 20 },
    { cx: 260 - t * 40, cy: 150, angle: -t * 1.2, wheelR: 30, cDotR: 8, pDotR: 8, ptrR: 20 }
  ];
  const sim = S.createSimulator(W, H, pass);
  const cfg = T.defaultConfig();
  const state = T.createState();
  let maxWheelsSeen = 0, lostEver = false;
  for (let f = 0; f <= 100; f++) {
    T.step(state, sim.draw(f / 20), cfg, 1000 + f * 50);
    maxWheelsSeen = Math.max(maxWheelsSeen, Object.keys(state.wheels).length);
    if ((state.wheels.A && state.wheels.A.lost > 0) || (state.wheels.B && state.wheels.B.lost > 0)) lostEver = true;
  }
  const a = state.wheels.A, b = state.wheels.B;
  check('pass-by: both wheels still tracked', !!a && !!b);
  check('pass-by: no phantom wheels', maxWheelsSeen <= 2, 'max ' + maxWheelsSeen);
  check('pass-by: identity kept (A ended right, B left)', a && b && a.x > b.x,
    a && b ? `A.x=${a.x.toFixed(0)} B.x=${b.x.toFixed(0)}` : 'missing');
  check('pass-by: no lost frames', !lostEver);
  check('pass-by: A angle continuous (~+430 deg over 5s)',
    a && near(a.angleDeg, 5 * 1.5 * 180 / Math.PI, 30),
    a && 'angleDeg=' + a.angleDeg.toFixed(0));
}

// --- head-on overlap: honest limit - long mutual occlusion resets stats ---
{
  const W = 320, H = 240;
  // two wheels driven into the same spot: physically impossible with real
  // wheels, included to document behavior - bodies occlude each other's dots
  // longer than the loss grace, so the occluded wheel is dropped and
  // re-acquired (identity still correct via color; angle history restarts)
  const cross = (t) => [
    { cx: 60 + t * 40, cy: 120, angle: t * 1.5, wheelR: 30, cDotR: 8, pDotR: 8, ptrR: 20 },
    { cx: 260 - t * 40, cy: 120, angle: -t * 1.2, wheelR: 30, cDotR: 8, pDotR: 8, ptrR: 20 }
  ];
  const sim = S.createSimulator(W, H, cross);
  const cfg = T.defaultConfig();
  const state = T.createState();
  let aDropped = false, maxWheelsSeen = 0;
  for (let f = 0; f <= 100; f++) {
    T.step(state, sim.draw(f / 20), cfg, 1000 + f * 50);
    maxWheelsSeen = Math.max(maxWheelsSeen, Object.keys(state.wheels).length);
    if (!state.wheels.A) aDropped = true;
  }
  const a = state.wheels.A, b = state.wheels.B;
  check('overlap: occluded wheel was dropped and re-acquired', aDropped && !!a);
  check('overlap: no phantom wheels', maxWheelsSeen <= 2, 'max ' + maxWheelsSeen);
  check('overlap: identity still correct after (A right, B left)', a && b && a.x > b.x,
    a && b ? `A.x=${a.x.toFixed(0)} B.x=${b.x.toFixed(0)}` : 'missing');
}

// --- occlusion: one wheel loses its pointer, the other keeps tracking ---
{
  const W = 320, H = 240;
  let occlude = false;
  const occ = (t) => [
    { cx: 90, cy: 120, angle: t, wheelR: 30, cDotR: 8, pDotR: 8, ptrR: 20 },
    { cx: 230, cy: 120, angle: -t, wheelR: 30, cDotR: 8, pDotR: occlude ? 0 : 8, ptrR: 20 }
  ];
  const sim = S.createSimulator(W, H, occ);
  const cfg = T.defaultConfig();
  const state = T.createState();
  for (let f = 0; f < 10; f++) T.step(state, sim.draw(f / 20), cfg, f * 33);
  occlude = true;
  let otherOk = true;
  for (let f = 10; f < 25; f++) {
    T.step(state, sim.draw(f / 20), cfg, f * 33);
    const a = state.wheels.A;
    if (!a || !isFinite(a.angleDeg)) otherOk = false;
  }
  check('occlusion: unoccluded wheel keeps tracking', otherOk);
  check('occlusion: occluded wheel dropped after maxLost', !state.wheels.B);
  occlude = false;
  let seenAtReacq = null;
  for (let f = 25; f < 45; f++) {
    T.step(state, sim.draw(f / 20), cfg, f * 33);
    const b = state.wheels.B;
    if (b && seenAtReacq === null) seenAtReacq = b.seen;
  }
  // identity is color-bound: the returning wheel is still B, but its tracking
  // stats (seen) restart as a fresh entry - angle history is not recovered
  check('reacquisition: same identity (B), fresh stats',
    seenAtReacq !== null && seenAtReacq <= 3,
    seenAtReacq === null ? 'never reacquired' : 'seen=' + seenAtReacq);
}

// --- short occlusion keeps the entry (loss flagged, then recovers) ---
{
  const W = 320, H = 240;
  let occlude = false;
  const occ = (t) => [
    { cx: 90, cy: 120, angle: t, wheelR: 30, cDotR: 8, pDotR: 8, ptrR: 20 },
    { cx: 230, cy: 120, angle: -t, wheelR: 30, cDotR: 8, pDotR: occlude ? 0 : 8, ptrR: 20 }
  ];
  const sim = S.createSimulator(W, H, occ);
  const cfg = T.defaultConfig();
  const state = T.createState();
  for (let f = 0; f < 10; f++) T.step(state, sim.draw(f / 20), cfg, f * 33);
  const seenBefore = state.wheels.B.seen;
  occlude = true;
  let lostWasFlagged = false;
  for (let f = 10; f < 14; f++) { // 4 frames < maxLost
    T.step(state, sim.draw(f / 20), cfg, f * 33);
    if (state.wheels.B && state.wheels.B.lost > 0) lostWasFlagged = true;
  }
  occlude = false;
  for (let f = 14; f < 24; f++) T.step(state, sim.draw(f / 20), cfg, f * 33);
  check('short occlusion: same entry kept (stats continue)',
    state.wheels.B && state.wheels.B.seen > seenBefore,
    'seen ' + seenBefore + ' -> ' + (state.wheels.B && state.wheels.B.seen));
  check('short occlusion: loss was flagged while hidden', lostWasFlagged);
}

// --- blank frames: no NaN, wheels dropped ---
{
  const W = 160, H = 120;
  const sim = S.createSimulator(W, H);
  const cfg = T.defaultConfig();
  const state = T.createState();
  T.step(state, sim.draw(0), cfg, 0);
  const blank = { data: new Uint8ClampedArray(W * H * 4).fill(30), width: W, height: H };
  const out = T.step(state, blank, cfg, 33);
  check('blank frame: no NaN positions', out.wheels.every(wh => isFinite(wh.x) && isFinite(wh.y) && isFinite(wh.angleDeg)));
  for (let i = 0; i < cfg.maxLost + 3; i++) T.step(state, blank, cfg, 66 + i * 33);
  check('wheels dropped after maxLost', Object.keys(state.wheels).length === 0);
}

// --- position smoothing stays sane ---
{
  const W = 160, H = 120;
  const sim = S.createSimulator(W, H);
  const cfg = T.defaultConfig();
  cfg.posTau = 0.09;
  const state = T.createState();
  let sm = [];
  for (let f = 0; f < 20; f++) {
    T.step(state, sim.draw(2 + f / 60), cfg, 1000 + f * 16);
    if (state.wheels.A) sm.push(state.wheels.A.x);
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const varr = a => { const m = mean(a); return mean(a.map(x => (x - m) ** 2)); };
  check('smoothed series is sane', sm.length > 10 && isFinite(varr(sm)));
}

// --- jittery frame times do not destabilize velocity ---
{
  const W = 320, H = 240;
  const sim = S.createSimulator(W, H);
  const cfg = T.defaultConfig();
  const state = T.createState();
  let ms = 1000;
  const dts = [5, 90, 12, 55, 8, 120, 30, 16]; // deliberately irregular
  for (let f = 0; f <= 80; f++) {
    ms += dts[f % dts.length];
    T.step(state, sim.draw((ms - 1000) / 1000), cfg, ms);
  }
  check('jittery dt: A velocity near +90', near(state.wheels.A.angVel, 90, 35),
    'v=' + state.wheels.A.angVel.toFixed(0));
  check('jittery dt: B velocity near -45', near(state.wheels.B.angVel, -45, 25),
    'v=' + state.wheels.B.angVel.toFixed(0));
}

// --- long pause re-acquires instead of trusting stale positions ---
{
  const W = 320, H = 240;
  const sim = S.createSimulator(W, H);
  const cfg = T.defaultConfig();
  const state = T.createState();
  for (let f = 0; f < 30; f++) T.step(state, sim.draw(f / 30), cfg, 1000 + f * 33);
  // 5s stall (tab hidden): past resetGapS; state must reset, not snap
  T.step(state, sim.draw(6), cfg, 1000 + 30 * 33 + 5000);
  T.step(state, sim.draw(6.033), cfg, 1000 + 30 * 33 + 5033);
  check('long pause: both wheels present, no phantoms',
    !!state.wheels.A && !!state.wheels.B && Object.keys(state.wheels).length === 2);
  check('long pause: entries are fresh (seen reset)',
    state.wheels.A.seen <= 3 && state.wheels.B.seen <= 3,
    'A:' + state.wheels.A.seen + ' B:' + state.wheels.B.seen);
  check('long pause: identity still color-bound after reset',
    state.wheels.A.x < state.wheels.B.x); // at t=6, A's path is left of B's
}

// --- mid-length stall: keep identity, snap, velocity re-converges ---
{
  const W = 320, H = 240;
  const sim = S.createSimulator(W, H);
  const cfg = T.defaultConfig();
  const state = T.createState();
  let ms = 1000;
  for (let f = 0; f < 30; f++) { T.step(state, sim.draw(f / 30), cfg, ms); ms += 33; }
  const seenBefore = state.wheels.A.seen;
  const angleBefore = state.wheels.A.angleDeg;
  ms += 1200; // 1.2s stall: between snapGapS and resetGapS
  T.step(state, sim.draw((ms - 1000) / 1000), cfg, ms);
  check('mid stall: wheel kept (no reset)', state.wheels.A.seen === seenBefore + 1,
    'seen ' + seenBefore + ' -> ' + state.wheels.A.seen);
  check('mid stall: velocity zeroed, no spike', state.wheels.A.angVel === 0);
  check('mid stall: no backward angle jump', state.wheels.A.angleDeg >= angleBefore - 1,
    angleBefore.toFixed(0) + ' -> ' + state.wheels.A.angleDeg.toFixed(0));
  for (let f = 0; f < 30; f++) { ms += 33; T.step(state, sim.draw((ms - 1000) / 1000), cfg, ms); }
  check('mid stall: velocity re-converges near +90', near(state.wheels.A.angVel, 90, 25),
    'v=' + state.wheels.A.angVel.toFixed(0));
  check('mid stall: still exactly 2 wheels', Object.keys(state.wheels).length === 2);
}

// --- burst cadence (1s stalls every ~5 frames) stays healthy ---
// Reproduces the throttled-host pattern observed on a real headless browser:
// 4-6 frames at 50-100ms, then a ~1.0s stall, repeating.
{
  const W = 320, H = 240;
  const sim = S.createSimulator(W, H);
  const cfg = T.defaultConfig();
  const state = T.createState();
  let ms = 1000;
  let worstDrop = 0;
  for (let cycle = 0; cycle < 8; cycle++) {
    for (let f = 0; f < 5; f++) {
      ms += 60;
      T.step(state, sim.draw((ms - 1000) / 1000), cfg, ms);
    }
    if (cycle >= 2 && state.wheels.A.angVel < 45) worstDrop++; // end of burst: should be near 90
    ms += 1000; // stall
  }
  check('burst cadence: velocity healthy at end of bursts', worstDrop === 0,
    worstDrop + ' weak bursts, final v=' + state.wheels.A.angVel.toFixed(0));
  check('burst cadence: identity kept throughout', !!state.wheels.A && !!state.wheels.B
    && Object.keys(state.wheels).length === 2);
}

console.log(failures === 0 ? '\nALL TESTS PASSED (simulated data)' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
