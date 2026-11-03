/*
 * Camera chooser shared by the tracker page and the game. Lists video inputs,
 * remembers the pick in this browser, and opens the chosen one. Labels are
 * empty until the browser grants camera permission, so the list is rebuilt
 * after every successful open and on devicechange.
 */
(function (root) {
  'use strict';
  const KEY = 'vracker-camera';
  function saved() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function save(id) { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch (e) {} }

  function constraints(deviceId) {
    const v = { width: { ideal: 640 }, height: { ideal: 480 } };
    if (deviceId) v.deviceId = { exact: deviceId };
    return { video: v, audio: false };
  }

  // Open the chosen camera; if the saved one is gone, fall back to default.
  async function open(deviceId) {
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) throw new Error('camera API not available');
    try {
      return { stream: await md.getUserMedia(constraints(deviceId)), fellBack: false };
    } catch (err) {
      if (deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        return { stream: await md.getUserMedia(constraints('')), fellBack: true };
      }
      throw err;
    }
  }

  async function list() {
    const md = navigator.mediaDevices;
    if (!md || !md.enumerateDevices) return [];
    const all = await md.enumerateDevices();
    return all.filter(d => d.kind === 'videoinput').map((d, i) => ({
      id: d.deviceId, label: d.label || ('Camera ' + (i + 1))
    }));
  }

  function currentId(stream) {
    const t = stream && stream.getVideoTracks()[0];
    const s = t && t.getSettings ? t.getSettings() : {};
    return s.deviceId || '';
  }

  // Fill <select> elements with the cameras; `activeId` is the one in use.
  async function fill(selects, activeId) {
    const cams = (await list()).filter(c => c.id);   // empty ids = no permission yet
    const want = activeId || saved();
    for (const sel of selects) {
      if (!sel) continue;
      sel.innerHTML = '';
      if (!cams.length) { sel.style.display = 'none'; continue; }
      for (const c of cams) {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = c.label;
        if (c.id === want) o.selected = true;
        sel.appendChild(o);
      }
      sel.style.display = '';
    }
    return cams;
  }

  root.VrCamera = { open, list, fill, saved, save, currentId };
})(typeof self !== 'undefined' ? self : globalThis);
