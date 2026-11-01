/* Vracker app: video source -> tracker -> overlay + readouts. */
(function () {
  'use strict';
  const T = window.VrTracker;
  const view = document.getElementById('view');
  const ctx = view.getContext('2d');
  const video = document.getElementById('cam');
  const statusEl = document.getElementById('status');
  const readoutsEl = document.getElementById('readouts');
  const simBadge = document.getElementById('simBadge');
  const btnCamera = document.getElementById('btnCamera');
  const btnSim = document.getElementById('btnSim');
  const btnCalA = document.getElementById('btnCalA');
  const btnCalB = document.getElementById('btnCalB');
  const swatches = {
    A: { center: document.getElementById('swACenter'), pointer: document.getElementById('swAPointer') },
    B: { center: document.getElementById('swBCenter'), pointer: document.getElementById('swBPointer') }
  };
  const WHEEL_LINE = { A: '#4ade80', B: '#38bdf8' }; // overlay accent per wheel

  const cfg = T.defaultConfig();
  const state = T.createState();
  let mode = 'idle';          // idle | camera | sim
  let sim = null;
  let off = document.createElement('canvas');
  let offCtx = off.getContext('2d', { willReadFrequently: true });
  let lastFrame = null;       // last ImageData, for calibration sampling
  let calibrate = null;       // 'center' | 'pointer' | null
  let fpsEma = 0, lastTs = 0;

  // Calibration persists in localStorage so the game page (game.html) picks
  // up the same per-wheel colors - printer colors and lighting differ.
  const CAL_KEY = 'vracker-calibration';
  function saveCalibration() {
    try { localStorage.setItem(CAL_KEY, JSON.stringify(cfg.wheels)); } catch (e) {}
  }
  (function loadCalibration() {
    try {
      const saved = JSON.parse(localStorage.getItem(CAL_KEY) || 'null');
      if (!Array.isArray(saved)) return;
      for (const sw of saved) {
        const def = cfg.wheels.find(d => d.label === sw.label);
        if (def && sw.center && sw.pointer) { def.center = sw.center; def.pointer = sw.pointer; }
      }
    } catch (e) {}
  })();

  function hsvCss(def) {
    return 'hsl(' + def.hue + ', 90%, 55%)';
  }
  function refreshSwatches() {
    for (const def of cfg.wheels) {
      swatches[def.label].center.style.background = hsvCss(def.center);
      swatches[def.label].pointer.style.background = hsvCss(def.pointer);
    }
  }
  refreshSwatches();

  function setStatus(msg) { statusEl.textContent = msg; }

  btnCamera.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false
      });
      video.srcObject = stream;
      await video.play();
      mode = 'camera';
      simBadge.style.display = 'none';
      setStatus('Camera live. REAL feed: this is the actual validation path.');
    } catch (err) {
      setStatus('Camera unavailable: ' + err.message +
        ' (needs permission and HTTPS or localhost). Try Simulation meanwhile.');
    }
  });

  btnSim.addEventListener('click', () => {
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    sim = sim || window.VrSim.createSimulator(view.width, view.height);
    mode = 'sim';
    simBadge.style.display = 'block';
    setStatus('Simulation running: synthetic wheels, same pipeline. Not your camera.');
  });

  // Two-click calibration per wheel: arm, click the CENTER dot, then the
  // POINTER dot. Needed when printer colors or lighting differ from defaults.
  function armCalibration(label, btn) {
    calibrate = { label, stage: 'center' };
    btnCalA.classList.toggle('armed', label === 'A');
    btnCalB.classList.toggle('armed', label === 'B');
    setStatus('Calibrating wheel ' + label + ': click its CENTER dot.');
  }
  btnCalA.addEventListener('click', () => armCalibration('A', btnCalA));
  btnCalB.addEventListener('click', () => armCalibration('B', btnCalB));

  view.addEventListener('click', (ev) => {
    if (!calibrate || !lastFrame) return;
    const r = view.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) * view.width / r.width);
    const y = Math.floor((ev.clientY - r.top) * view.height / r.height);
    const p = (y * lastFrame.width + x) * 4;
    const [h, s, v] = T.rgbToHsv(lastFrame.data[p], lastFrame.data[p + 1], lastFrame.data[p + 2]);
    const wheelDef = cfg.wheels.find(d => d.label === calibrate.label);
    const def = calibrate.stage === 'center' ? wheelDef.center : wheelDef.pointer;
    def.hue = h;
    def.satMin = Math.max(0.15, s - 0.25);
    def.valMin = Math.max(0.15, v - 0.25);
    refreshSwatches();
    if (calibrate.stage === 'center') {
      calibrate.stage = 'pointer';
      setStatus('Wheel ' + calibrate.label + ' center sampled (hue ' + h.toFixed(0) +
        '). Now click its POINTER dot.');
    } else {
      saveCalibration();
      setStatus('Wheel ' + calibrate.label + ' calibrated (center + pointer). Tracking updated. Saved for the game too.');
      calibrate = null;
      btnCalA.classList.remove('armed');
      btnCalB.classList.remove('armed');
    }
  });

  function sourceFrame(now) {
    if (mode === 'sim') {
      const f = sim.draw(now / 1000);
      return new ImageData(new Uint8ClampedArray(f.data), f.width, f.height);
    }
    if (mode === 'camera' && video.readyState >= 2) {
      const w = video.videoWidth, h = video.videoHeight;
      if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
      offCtx.drawImage(video, 0, 0);
      return offCtx.getImageData(0, 0, w, h);
    }
    return null;
  }

  function drawOverlay(out) {
    ctx.lineWidth = 2;
    for (const wh of out.wheels) {
      const c = wh.center, p = wh.pointer;
      const accent = WHEEL_LINE[wh.label] || '#7dd3fc';
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.beginPath(); ctx.moveTo(wh.x - 8, wh.y); ctx.lineTo(wh.x + 8, wh.y);
      ctx.moveTo(wh.x, wh.y - 8); ctx.lineTo(wh.x, wh.y + 8); ctx.stroke();
      ctx.fillStyle = accent;
      ctx.font = '13px ui-monospace, monospace';
      const deg = ((wh.angleDeg % 360) + 360) % 360;
      ctx.fillText(wh.label + '  ' + deg.toFixed(0) + ' deg', wh.x + 12, wh.y - 8);
    }
  }

  const wheelCards = new Map();
  function updateReadouts(out, fps) {
    const seen = new Set();
    for (const wh of out.wheels) {
      seen.add(wh.label);
      let card = wheelCards.get(wh.label);
      if (!card) {
        card = document.createElement('div');
        card.className = 'wheel';
        wheelCards.set(wh.label, card);
        readoutsEl.appendChild(card);
      }
      const deg = ((wh.angleDeg % 360) + 360) % 360;
      card.innerHTML =
        '<h2>Wheel ' + wh.label +
        (wh.lost > 0 ? ' <span class="lost">(markers lost)</span>' : '') +
        '</h2>' +
        '<div class="val">x ' + wh.x.toFixed(1) + ' px &nbsp; y ' + wh.y.toFixed(1) + ' px</div>' +
        '<div class="val">angle ' + deg.toFixed(1) + ' deg</div>' +
        '<div class="val">speed ' + wh.angVel.toFixed(0) + ' deg/s</div>';
    }
    for (const [label, card] of wheelCards) {
      if (!seen.has(label)) { card.remove(); wheelCards.delete(label); }
    }
    if (fps > 0) {
      let fpsCard = wheelCards.get('__fps');
      if (!fpsCard) {
        fpsCard = document.createElement('div');
        fpsCard.className = 'wheel';
        wheelCards.set('__fps', fpsCard);
        readoutsEl.appendChild(fpsCard);
      }
      fpsCard.innerHTML = '<h2>Pipeline</h2><div class="val">' + fps.toFixed(0) + ' fps</div>';
    }
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    if (mode === 'idle') return;
    const frame = sourceFrame(ts);
    if (!frame) return;
    lastFrame = frame;
    if (view.width !== frame.width || view.height !== frame.height) {
      view.width = frame.width; view.height = frame.height;
    }
    const out = T.step(state, frame, cfg, ts);
    ctx.putImageData(frame, 0, 0);
    drawOverlay(out);
    if (lastTs) fpsEma += 0.1 * (1000 / Math.max(ts - lastTs, 1) - fpsEma);
    lastTs = ts;
    updateReadouts(out, fpsEma);
  }
  requestAnimationFrame(loop);
})();
