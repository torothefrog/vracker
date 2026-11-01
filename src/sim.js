/*
 * Vracker simulated feed.
 * Pure JavaScript frame generator: draws two moving, rotating wheels with
 * center + pointer markers into a raw RGBA buffer, exactly the layout the
 * tracker expects. Used by the browser app in "Simulation" mode and by the
 * Node tests, which check measured output against this ground truth.
 *
 * Everything produced here is SIMULATED - it proves the pipeline, not the
 * real camera, lighting, or physical markers.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VrSim = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Marker colors (must sit inside the tracker's default hue windows):
  const CENTER_RGB = [0, 230, 90];    // green
  const POINTER_RGB = [230, 0, 220];  // magenta
  const BODY_RGB = [35, 38, 46];      // dark grey wheel body
  const BG_RGB = [22, 24, 30];

  function createSimulator(width, height) {
    const buf = new Uint8ClampedArray(width * height * 4);

    function fill(rgb) {
      for (let i = 0; i < buf.length; i += 4) {
        buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = 255;
      }
    }
    function disc(cx, cy, rad, rgb) {
      const r2 = rad * rad;
      const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(width - 1, Math.ceil(cx + rad));
      const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(height - 1, Math.ceil(cy + rad));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy <= r2) {
            const p = (y * width + x) * 4;
            buf[p] = rgb[0]; buf[p + 1] = rgb[1]; buf[p + 2] = rgb[2]; buf[p + 3] = 255;
          }
        }
      }
    }

    // Ground-truth wheel paths. Deterministic in t (seconds).
    function truth(t) {
      return [
        {
          cx: width * 0.30 + 55 * Math.cos(t * 0.7),
          cy: height * 0.5 + 45 * Math.sin(t * 1.1),
          angle: t * (Math.PI / 2),              // +90 deg/s
          wheelR: 46, dotR: 9, ptrR: 30
        },
        {
          cx: width * 0.70 + 60 * Math.sin(t * 0.5 + 1.3),
          cy: height * 0.5 + 50 * Math.cos(t * 0.9),
          angle: -t * (Math.PI / 4) + 0.8,       // -45 deg/s
          wheelR: 46, dotR: 9, ptrR: 30
        }
      ];
    }

    function draw(t) {
      fill(BG_RGB);
      for (const wh of truth(t)) {
        disc(wh.cx, wh.cy, wh.wheelR, BODY_RGB);
        const px = wh.cx + wh.ptrR * Math.cos(wh.angle);
        const py = wh.cy + wh.ptrR * Math.sin(wh.angle);
        disc(px, py, wh.dotR, POINTER_RGB);
        disc(wh.cx, wh.cy, wh.dotR, CENTER_RGB);
      }
      return { data: buf, width, height };
    }

    return { draw, truth, CENTER_RGB, POINTER_RGB };
  }

  return { createSimulator };
});
