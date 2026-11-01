/*
 * Vracker tracking core.
 * Pure JavaScript: no DOM, no canvas, no dependencies.
 * Runs in the browser (window.VrTracker) and in Node (module.exports).
 *
 * Principle (agreed in #project-vracker): per wheel we only need to locate two
 * distinguishable points, then compute their midpoint (position) and the angle
 * of the vector between them. Points are colored markers found by HSV
 * thresholding + connected-component labeling.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VrTracker = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TAU = Math.PI * 2;

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : d / max;
    return [h, s, max];
  }

  function hueDist(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  // def: {hue, hueTol, satMin, valMin}
  function thresholdMask(data, w, h, def) {
    const mask = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      const [hh, ss, vv] = rgbToHsv(data[p], data[p + 1], data[p + 2]);
      if (ss >= def.satMin && vv >= def.valMin && hueDist(hh, def.hue) <= def.hueTol) {
        mask[i] = 1;
      }
    }
    return mask;
  }

  // Two-pass connected-component labeling with union-find.
  function findBlobs(mask, w, h, minArea) {
    const labels = new Int32Array(w * h);
    const parent = [0];
    let next = 1;
    function find(a) {
      while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      return a;
    }
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        if (!mask[i]) continue;
        const left = x > 0 && mask[i - 1] ? labels[i - 1] : 0;
        const up = y > 0 && mask[i - w] ? labels[i - w] : 0;
        if (left && up) {
          const rl = find(left), ru = find(up);
          if (rl === ru) labels[i] = rl;
          else {
            const lo = Math.min(rl, ru), hi = Math.max(rl, ru);
            parent[hi] = lo;
            labels[i] = lo;
          }
        } else if (left || up) {
          labels[i] = left || up;
        } else {
          parent[next] = next;
          labels[i] = next;
          next++;
        }
      }
    }
    const acc = new Map();
    for (let i = 0; i < mask.length; i++) {
      if (!labels[i]) continue;
      const r = find(labels[i]);
      let a = acc.get(r);
      if (!a) { a = { sx: 0, sy: 0, n: 0 }; acc.set(r, a); }
      a.sx += i % w;
      a.sy += Math.floor(i / w);
      a.n++;
    }
    const blobs = [];
    for (const a of acc.values()) {
      if (a.n >= minArea) blobs.push({ x: a.sx / a.n, y: a.sy / a.n, area: a.n });
    }
    return blobs;
  }

  const LABELS = 'ABCDEFGH';

  function defaultConfig() {
    return {
      centerColor:  { hue: 140, hueTol: 30, satMin: 0.45, valMin: 0.35 }, // green tape
      pointerColor: { hue: 300, hueTol: 30, satMin: 0.40, valMin: 0.35 }, // magenta tape
      minArea: 12,          // px; blobs smaller than this are ignored
      maxWheels: 2,
      maxPairDist: 220,     // px; center-to-pointer distance on a physical wheel
      maxJump: 120,         // px; max plausible wheel motion between frames
      maxLost: 10,          // frames a wheel may go missing before being dropped
      velSmooth: 0.25,      // EMA factor for angular velocity
      posSmooth: 0.5        // EMA factor for reported position
    };
  }

  function createState() {
    return { wheels: [], lastTime: 0 };
  }

  function step(state, frame, cfg, nowMs) {
    const w = frame.width, h = frame.height, data = frame.data;
    const dt = state.lastTime ? Math.min((nowMs - state.lastTime) / 1000, 0.5) : 0;
    state.lastTime = nowMs;

    const centerMask = thresholdMask(data, w, h, cfg.centerColor);
    const centers = findBlobs(centerMask, w, h, cfg.minArea)
      .sort((a, b) => b.area - a.area).slice(0, cfg.maxWheels * 2);
    const pointerMask = thresholdMask(data, w, h, cfg.pointerColor);
    const pointers = findBlobs(pointerMask, w, h, cfg.minArea)
      .sort((a, b) => b.area - a.area).slice(0, cfg.maxWheels * 3);

    // Pair each center with its nearest free pointer.
    const usedP = new Set();
    const obs = [];
    for (const c of centers) {
      let best = -1, bd = Infinity;
      for (let j = 0; j < pointers.length; j++) {
        if (usedP.has(j)) continue;
        const p = pointers[j];
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d < bd) { bd = d; best = j; }
      }
      if (best < 0 || bd > cfg.maxPairDist) continue;
      usedP.add(best);
      const p = pointers[best];
      obs.push({
        x: (c.x + p.x) / 2,
        y: (c.y + p.y) / 2,
        angle: Math.atan2(p.y - c.y, p.x - c.x),
        center: c, pointer: p
      });
      if (obs.length >= cfg.maxWheels) break;
    }

    // Match observations to existing wheels by nearest midpoint.
    const usedW = new Set();
    for (const o of obs) {
      let bi = -1, bd = Infinity;
      for (let k = 0; k < state.wheels.length; k++) {
        if (usedW.has(k)) continue;
        const wh = state.wheels[k];
        if (wh.lost > cfg.maxLost) continue;
        const d = Math.hypot(o.x - wh.x, o.y - wh.y);
        if (d < bd) { bd = d; bi = k; }
      }
      if (bi >= 0 && bd <= cfg.maxJump) {
        usedW.add(bi);
        updateWheel(state.wheels[bi], o, dt, cfg);
      } else {
        state.wheels.push(newWheel(state, o));
        usedW.add(state.wheels.length - 1);
      }
    }
    for (const wh of state.wheels) {
      if (!usedW.has(state.wheels.indexOf(wh))) wh.lost++;
    }
    state.wheels = state.wheels.filter(wh => wh.lost <= cfg.maxLost);

    return { centers, pointers, wheels: state.wheels };
  }

  function newWheel(state, o) {
    const usedLabels = new Set(state.wheels.map(wh => wh.label));
    let label = '?';
    for (const ch of LABELS) { if (!usedLabels.has(ch)) { label = ch; break; } }
    const deg = o.angle * 180 / Math.PI;
    return {
      label,
      x: o.x, y: o.y,
      angleRaw: o.angle,       // last raw atan2, radians (-PI..PI]
      angleDeg: deg,           // continuous, unwrapped
      angVel: 0,               // deg/s, smoothed
      lost: 0,
      center: o.center, pointer: o.pointer,
      seen: 1
    };
  }

  function updateWheel(wh, o, dt, cfg) {
    let da = o.angle - wh.angleRaw;
    da = Math.atan2(Math.sin(da), Math.cos(da)); // wrap to (-PI, PI]
    const daDeg = da * 180 / Math.PI;
    wh.angleRaw = o.angle;
    wh.angleDeg += daDeg;
    if (dt > 0) {
      const inst = daDeg / dt;
      wh.angVel += cfg.velSmooth * (inst - wh.angVel);
    }
    wh.x += cfg.posSmooth * (o.x - wh.x);
    wh.y += cfg.posSmooth * (o.y - wh.y);
    wh.center = o.center;
    wh.pointer = o.pointer;
    wh.lost = 0;
    wh.seen++;
  }

  return { rgbToHsv, hueDist, thresholdMask, findBlobs, defaultConfig, createState, step, TAU };
});
