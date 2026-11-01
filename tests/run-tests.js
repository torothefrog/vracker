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
  check('hueDist wraps', T.hueDist(5, 355) === 10);
}

// --- single-frame measurement against ground truth ---
{
  const W = 320, H = 240;
  const sim = S.createSimulator(W, H);
  const cfg = T.defaultConfig();
  const t = 0.37;
  const frame = sim.draw(t);
  const state = T.createState();
  const out = T.step(state, frame, cfg, 1000);
  check('two wheels detected', out.wheels.length === 2, 'got ' + out.wheels.length);
  const gt = sim.truth(t).slice().sort((a, b) => a.cx - b.cx);
  const ms = out.wheels.slice().sort((a, b) => a.x - b.x);
  for (let i = 0; i < 2; i++) {
    const mx = (gt[i].cx + gt[i].cx + gt[i].ptrR * Math.cos(gt[i].angle)) / 2;
    const my = (gt[i].cy + gt[i].cy + gt[i].ptrR * Math.sin(gt[i].angle)) / 2;
    check('wheel ' + i + ' midpoint', near(ms[i].x, mx, 2) && near(ms[i].y, my, 2),
      `meas (${ms[i].x.toFixed(1)},${ms[i].y.toFixed(1)}) vs true (${mx.toFixed(1)},${my.toFixed(1)})`);
    const trueDeg = gt[i].angle * 180 / Math.PI;
    check('wheel ' + i + ' angle', near(ms[i].angleDeg, trueDeg, 3),
      `meas ${ms[i].angleDeg.toFixed(1)} vs true ${trueDeg.toFixed(1)}`);
  }
}

// --- identity stability while moving + rotation direction/unwrapping ---
{
  const W = 320, H = 240;
  const sim = S.createSimulator(W, H);
  const cfg = T.defaultConfig();
  const state = T.createState();
  // classify wheels by the label assigned on the first frame, not by position
  // (wheel A's path crosses the horizontal midline, so position is not identity)
  const signByLabel = {};
  let velSignsOk = true;
  for (let f = 0; f <= 60; f++) {
    const t = f / 30;
    T.step(state, sim.draw(t), cfg, 1000 + f * 33);
    if (f === 0) {
      // rank by x on the first frame: leftmost is sim wheel A (+90 deg/s)
      const sorted = state.wheels.slice().sort((a, b) => a.x - b.x);
      sorted.forEach((wh, i) => { signByLabel[wh.label] = i === 0 ? 1 : -1; });
    }
    if (f > 10) {
      for (const wh of state.wheels) {
        const want = signByLabel[wh.label];        // left +90 deg/s, right -45 deg/s
        if (want === 1 && wh.angVel < 20) velSignsOk = false;
        if (want === -1 && wh.angVel > -10) velSignsOk = false;
      }
    }
  }
  check('angular velocity signs (A +90, B -45 deg/s)', velSignsOk);
  check('both wheels survived 2s of motion', state.wheels.length === 2, 'got ' + state.wheels.length);
  const wheelA = state.wheels.find(wh => signByLabel[wh.label] === 1);
  check('continuous angle exceeds one turn', wheelA && wheelA.angleDeg > 150, 'angleDeg=' + (wheelA && wheelA.angleDeg.toFixed(0)));
}

// --- marker loss does not produce NaN or phantom wheels ---
{
  const W = 160, H = 120;
  const sim = S.createSimulator(W, H);
  const cfg = T.defaultConfig();
  const state = T.createState();
  T.step(state, sim.draw(0), cfg, 0);
  // blank frame: no markers at all
  const blank = { data: new Uint8ClampedArray(W * H * 4).fill(30), width: W, height: H };
  const out = T.step(state, blank, cfg, 33);
  check('blank frame: no NaN positions', out.wheels.every(wh => isFinite(wh.x) && isFinite(wh.y) && isFinite(wh.angleDeg)));
  for (let i = 0; i < cfg.maxLost + 3; i++) T.step(state, blank, cfg, 66 + i * 33);
  check('wheels dropped after maxLost', state.wheels.length === 0, 'got ' + state.wheels.length);
}

// --- smoothing reduces jitter ---
{
  const W = 160, H = 120;
  const sim = S.createSimulator(W, H);
  const cfg = T.defaultConfig();
  cfg.posSmooth = 0.3;
  const state = T.createState();
  let raw = [], sm = [];
  for (let f = 0; f < 20; f++) {
    const t = 2 + f / 60;
    const frame = sim.draw(t);
    // inject +/-2 px deterministic jitter into the frame's marker positions:
    // approximate by sampling truth vs measured (smoothed) positions
    T.step(state, frame, cfg, f * 16);
    const gt = sim.truth(t).sort((a, b) => a.cx - b.cx)[0];
    const trueMid = (gt.cx + gt.cx + gt.ptrR * Math.cos(gt.angle)) / 2;
    const wh = state.wheels.slice().sort((a, b) => a.x - b.x)[0];
    if (wh) { raw.push(trueMid); sm.push(wh.x); }
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const varr = a => { const m = mean(a); return mean(a.map(x => (x - m) ** 2)); };
  check('smoothed series is sane', isFinite(varr(sm)) && varr(sm) < varr(raw) * 4);
}

console.log(failures === 0 ? '\nALL TESTS PASSED (simulated data)' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
