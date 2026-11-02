/*
 * Wheel input for the game: webcam -> VrTracker -> normalized steering.
 * Same pipeline as the tracker page (index.html): the video never leaves the
 * device, and per-wheel color pairs keep player identity. A wheel's steering
 * is its angle offset from a baseline captured at game start / recenter:
 * turn the physical wheel right and the ship steers right, back to the
 * baseline and it flies straight.
 */
(function (root) {
  'use strict';
  const T = root.VrTracker;
  const G = root.VrGame;

  function create(opts) {
    const video = opts.video;                 // hidden <video>
    const preview = opts.preview;             // small visible preview canvas
    const pctx = preview.getContext('2d');
    const onStatus = opts.onStatus || function () {};
    const cfg = T.defaultConfig();
    // Pick up per-wheel colors calibrated on the tracker page (same device).
    try {
      const saved = JSON.parse(localStorage.getItem('vracker-calibration') || 'null');
      if (Array.isArray(saved)) {
        for (const sw of saved) {
          const def = cfg.wheels.find(d => d.label === sw.label);
          if (def && sw.center && sw.pointer) { def.center = sw.center; def.pointer = sw.pointer; }
        }
      }
    } catch (e) {}
    const state = T.createState();
    const present = { A: false, B: false };
    let off = document.createElement('canvas');
    let offCtx = off.getContext('2d', { willReadFrequently: true });
    let stream = null;
    const baselines = { A: null, B: null };
    const latest = { A: null, B: null };      // last tracker output per label
    // Per-marker detection counts for the preview (refreshed ~5x/s) so a
    // marker that is not found is visible instead of silently missing.
    const MARKERS = [
      { key: 'A centre', wheel: 'A', part: 'center', css: 'hsl(140,70%,50%)' },
      { key: 'A pointer', wheel: 'A', part: 'pointer', css: 'hsl(300,70%,55%)' },
      { key: 'B centre', wheel: 'B', part: 'center', css: 'hsl(190,80%,55%)' },
      { key: 'B pointer', wheel: 'B', part: 'pointer', css: 'hsl(60,85%,55%)' }
    ];
    let diagN = 0;
    const diag = {};

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false
        });
        video.srcObject = stream;
        await video.play();
        preview.style.display = 'block';
        onStatus('Camera live. Hold the wheels level, then press RECENTER or start.');
        return true;
      } catch (err) {
        onStatus('Camera unavailable: ' + err.message +
          ' (needs permission and HTTPS). Keyboard still works.');
        return false;
      }
    }

    function stop() {
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      video.srcObject = null;
      preview.style.display = 'none';
    }

    // Capture the current wheel angles as the neutral position. Wheels that
    // are not visible keep their old baseline and simply give no input.
    function recenter() {
      for (const label of ['A', 'B']) {
        if (latest[label]) baselines[label] = latest[label].angleDeg;
      }
      onStatus('Wheels recentered: current wheel position is now "straight ahead".');
    }

    function active() { return !!stream; }

    // Called every animation frame by the game loop.
    function update(nowMs) {
      if (!stream || video.readyState < 2) return;
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return;
      if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
      offCtx.drawImage(video, 0, 0);
      const frame = offCtx.getImageData(0, 0, w, h);
      const out = T.step(state, frame, cfg, nowMs);
      latest.A = null; latest.B = null;
      for (const wh of out.wheels) latest[wh.label] = wh;
      // Re-anchor after a drop: when a wheel comes back after being lost long
      // enough to be dropped, its angle history restarted - treat its current
      // position as neutral instead of jumping the ship.
      for (const label of ['A', 'B']) {
        const now = !!latest[label];
        if (now && !present[label]) baselines[label] = latest[label].angleDeg;
        present[label] = now;
      }

      if (diagN++ % 12 === 0) {
        for (const m of MARKERS) {
          const def = cfg.wheels.find(d => d.label === m.wheel)[m.part];
          diag[m.key] = T.findBlobs(T.thresholdMask(frame.data, w, h, def), w, h, cfg.minArea).length;
        }
      }
      // Preview: mirrored-ish raw feed + per-wheel overlay, like the tracker page.
      if (preview.width !== w || preview.height !== h) { preview.width = w; preview.height = h; }
      pctx.putImageData(frame, 0, 0);
      pctx.lineWidth = 2;
      for (const wh of out.wheels) {
        const accent = wh.label === 'A' ? '#4ade80' : '#38bdf8';
        pctx.strokeStyle = 'rgba(255,255,255,0.6)';
        pctx.beginPath(); pctx.moveTo(wh.center.x, wh.center.y);
        pctx.lineTo(wh.pointer.x, wh.pointer.y); pctx.stroke();
        pctx.strokeStyle = accent;
        pctx.beginPath();
        pctx.moveTo(wh.x - 8, wh.y); pctx.lineTo(wh.x + 8, wh.y);
        pctx.moveTo(wh.x, wh.y - 8); pctx.lineTo(wh.x, wh.y + 8);
        pctx.stroke();
        pctx.fillStyle = accent;
        pctx.font = '13px ui-monospace, monospace';
        pctx.fillText(wh.label, wh.x + 12, wh.y - 8);
      }
      // Marker checklist: filled square = found, X = not found.
      pctx.font = '14px ui-monospace, monospace';
      MARKERS.forEach((m, i) => {
        const n = diag[m.key] || 0;
        const y = 8 + i * 18;
        pctx.fillStyle = 'rgba(0,0,0,0.55)'; pctx.fillRect(6, y - 2, 118, 17);
        pctx.fillStyle = m.css; pctx.fillRect(10, y + 1, 10, 10);
        pctx.fillStyle = n ? '#e5e7eb' : '#fb7185';
        pctx.fillText(m.key + (n ? ' ok' : ' X'), 26, y + 11);
      });
    }

    // Normalized steering for one ship, or null when its wheel is not tracked.
    function getSteer(label) {
      const wh = latest[label];
      if (!wh) return null;
      if (baselines[label] === null) baselines[label] = wh.angleDeg; // first sight = neutral
      // Camera faces the player, so a physical clockwise turn shows as
      // counter-clockwise (falling angle) in the image: invert so turning
      // the wheel right steers right.
      return G.steerFromWheel(baselines[label], wh.angleDeg);
    }

    function wheelSeen(label) { return !!latest[label]; }

    return { start, stop, recenter, active, update, getSteer, wheelSeen, cfg, baselines };
  }

  root.VrWheelInput = { create };
})(typeof self !== 'undefined' ? self : globalThis);
