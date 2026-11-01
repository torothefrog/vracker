/*
 * Vracker tracking core.
 * Pure JavaScript: no DOM, no canvas, no dependencies.
 * Runs in the browser (window.VrTracker) and in Node (module.exports).
 *
 * Principle (agreed in #project-vracker): per wheel we only need to locate two
 * distinguishable points, then compute their midpoint (position) and the angle
 * of the vector between them. Points are colored markers found by HSV
 * thresholding + connected-component labeling.
 *
 * Player identity: each wheel has its OWN center/pointer color pair
 * (wheel A: green+magenta, wheel B: cyan+yellow), so identity is bound to
 * color, not to proximity guessing - wheels can cross without swapping.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VrTracker = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

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

  function defaultConfig() {
    return {
      // Per-player color pairs. Wheel A = green center + magenta pointer,
      // wheel B = cyan center + yellow pointer. Identity is bound to these.
      wheels: [
        { label: 'A',
          center:  { hue: 140, hueTol: 30, satMin: 0.45, valMin: 0.35 },
          pointer: { hue: 300, hueTol: 30, satMin: 0.40, valMin: 0.35 } },
        { label: 'B',
          center:  { hue: 190, hueTol: 25, satMin: 0.40, valMin: 0.35 },
          pointer: { hue: 60,  hueTol: 25, satMin: 0.45, valMin: 0.45 } }
      ],
      minArea: 12,          // px; blobs smaller than this are ignored
      maxPairDist: 220,     // px; center-to-pointer distance on a physical wheel
      maxLost: 10,          // frames a wheel may go missing before being dropped
      velTau: 0.12,         // s; time constant for angular-velocity smoothing.
                            // Time-based (not per-frame) so jittery frame
                            // intervals do not spike the velocity estimate.
      posTau: 0.05,         // s; time constant for reported-position smoothing
      resetGapS: 1.0        // s; after a gap this long (tab hidden, stall),
                            // re-acquire fresh instead of trusting stale state
    };
  }

  function createState() {
    return { wheels: {}, lastTime: 0 }; // wheels keyed by label (color-bound)
  }

  function observeWheel(def, frame, cfg) {
    const w = frame.width, h = frame.height, data = frame.data;
    const centers = findBlobs(thresholdMask(data, w, h, def.center), w, h, cfg.minArea)
      .sort((a, b) => b.area - a.area);
    if (!centers.length) return null;
    const pointers = findBlobs(thresholdMask(data, w, h, def.pointer), w, h, cfg.minArea)
      .sort((a, b) => b.area - a.area);
    if (!pointers.length) return null;
    const c = centers[0];
    let best = null, bd = Infinity;
    for (const p of pointers) {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || bd > cfg.maxPairDist) return null;
    return {
      x: (c.x + best.x) / 2,
      y: (c.y + best.y) / 2,
      angle: Math.atan2(best.y - c.y, best.x - c.x),
      center: c, pointer: best
    };
  }

  function step(state, frame, cfg, nowMs) {
    const dtRaw = state.lastTime ? (nowMs - state.lastTime) / 1000 : 0;
    if (dtRaw > cfg.resetGapS) state.wheels = {}; // long pause: re-acquire fresh
    const dt = Math.min(dtRaw, 0.5);
    state.lastTime = nowMs;

    for (const def of cfg.wheels) {
      const obs = observeWheel(def, frame, cfg);
      const wh = state.wheels[def.label];
      if (obs) {
        if (wh) updateWheel(wh, obs, dt, cfg);
        else state.wheels[def.label] = newWheel(def.label, obs);
      } else if (wh) {
        wh.lost++;
        if (wh.lost > cfg.maxLost) delete state.wheels[def.label];
      }
    }
    return { wheels: cfg.wheels.map(d => state.wheels[d.label]).filter(Boolean) };
  }

  function newWheel(label, o) {
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
      const aV = 1 - Math.exp(-dt / cfg.velTau);
      wh.angVel += aV * (inst - wh.angVel);
    }
    const aP = dt > 0 ? 1 - Math.exp(-dt / cfg.posTau) : 1;
    wh.x += aP * (o.x - wh.x);
    wh.y += aP * (o.y - wh.y);
    wh.center = o.center;
    wh.pointer = o.pointer;
    wh.lost = 0;
    wh.seen++;
  }

  return { rgbToHsv, hueDist, thresholdMask, findBlobs, defaultConfig, createState, step };
});
