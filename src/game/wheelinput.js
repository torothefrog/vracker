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
    const state = T.createState();
    let off = document.createElement('canvas');
    let offCtx = off.getContext('2d', { willReadFrequently: true });
    let stream = null;
    const baselines = { A: null, B: null };
    const latest = { A: null, B: null };      // last tracker output per label

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
    }

    // Normalized steering for one ship, or null when its wheel is not tracked.
    function getSteer(label) {
      const wh = latest[label];
      if (!wh) return null;
      if (baselines[label] === null) baselines[label] = wh.angleDeg; // first sight = neutral
      return G.steerFromWheel(wh.angleDeg, baselines[label]);
    }

    function wheelSeen(label) { return !!latest[label]; }

    return { start, stop, recenter, active, update, getSteer, wheelSeen };
  }

  root.VrWheelInput = { create };
})(typeof self !== 'undefined' ? self : globalThis);
