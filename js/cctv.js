// ==========================================================
//  กล้อง CCTV: เปิดกล้อง จับความเคลื่อนไหว แล้วบันทึกคลิปลงโฟลเดอร์อัตโนมัติ
//  (รวมมาจากโปรเจกต์ 044) เริ่มทำงานตอนเปิดหน้า "กล้อง CCTV" ครั้งแรกเท่านั้น ไม่ขอสิทธิ์กล้องตอนเปิดแอป
// ==========================================================
(() => {
  const $ = id => document.getElementById(id);
  const video = $('cctvVideo');
  const overlay = $('cctvOverlay');
  const recordCanvas = $('cctvRecordCanvas');
  if (!video || !overlay || !recordCanvas) return;
  const rctx = recordCanvas.getContext('2d');
  const placeholder = $('cctvPlaceholder');
  const hud = $('cctvHud');
  const hudText = $('cctvHudText');
  const timestampEl = $('cctvTimestamp');
  const statusText = $('cctvStatusText');
  const folderPathEl = $('cctvFolderPath');
  const folderInput = $('cctvFolderInput');
  const logEl = $('cctvLog');
  const camSelect = $('cctvCamSelect');
  const contextNotice = $('cctvContextNotice');
  const btnStart = $('cctvBtnStart');
  const btnFolder = $('cctvBtnFolder');
  const btnStop = $('cctvBtnStop');
  const sensitivityInput = $('cctvSensitivity');
  const cooldownSelect = $('cctvCooldown');
  const resolutionSelect = $('cctvResolution');

  const supportsFS = 'showDirectoryPicker' in window;
  const notify = msg => (typeof showAppAlert === 'function' ? showAppAlert(msg) : alert(msg));

  // File System Access API ใช้ไม่ได้นอก secure context (https หรือ localhost)
  if (supportsFS && window.isSecureContext === false) contextNotice.style.display = 'block';

  let stream = null, dirHandle = null, mediaRecorder = null, recordedChunks = [];
  let isRecording = false, lastMotionAt = 0, motionLoopId = null, clockId = null;
  let renderStream = null, renderLoopActive = false, savedHandle = null, started = false;

  const sampleW = 160, sampleH = 120;
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = sampleW; sampleCanvas.height = sampleH;
  const sctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  let prevFrame = null;

  const pad = n => n.toString().padStart(2, '0');
  const SETTINGS_KEY = 'cctv-motion-recorder-settings';
  const ACTIVE_KEY = 'cctv-motion-recorder-active';

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        sensitivity: sensitivityInput.value, cooldown: cooldownSelect.value,
        resolution: resolutionSelect.value, camDeviceId: camSelect.value
      }));
    } catch (e) {}
  }
  function loadSavedSettings() {
    try { const raw = localStorage.getItem(SETTINGS_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  sensitivityInput.addEventListener('input', saveSettings);
  cooldownSelect.addEventListener('change', saveSettings);
  camSelect.addEventListener('change', saveSettings);
  // ---- หมุนภาพ (กล้องติดตั้งตะแคง/กลับหัว): เก็บมุมแยกกันระหว่างเครื่องที่มีกล้องกับเครื่องที่ดู ----
  const ROT_KEY = 'cctv-rotate', ROT_VIEW_KEY = 'cctv-rotate-view';
  const monitorEl = $('cctvMonitor');
  const readRot = k => { let v = null; try { v = parseInt(localStorage.getItem(k), 10); } catch (e) {} return [0, 90, 180, 270].includes(v) ? v : null; };
  let rotation = 0, srcW = 640, srcH = 480, pendingResize = false, hostCfgRot = null;

  function layoutForRotation(w, h) {
    if (w && h) { srcW = w; srcH = h; }
    const swap = rotation % 180 !== 0;
    const cw = swap ? srcH : srcW, ch = swap ? srcW : srcH;
    if (!isRecording) {
      overlay.width = cw; overlay.height = ch; recordCanvas.width = cw; recordCanvas.height = ch;
      pendingResize = false;
    } else pendingResize = true;   // กำลังอัดคลิป ไม่เปลี่ยนขนาดผืนผ้าใบกลางคัน
    monitorEl.style.aspectRatio = cw + ' / ' + ch;
    monitorEl.style.setProperty('--cctv-ar', String(cw / ch));
    ['rot-0', 'rot-90', 'rot-180', 'rot-270'].forEach(c => monitorEl.classList.remove(c));
    monitorEl.classList.add('rot-' + rotation);
  }
  // มุมภาพเป็นของกล้อง เก็บที่เครื่องหลักที่เดียว: เครื่องที่ดูสั่งเปลี่ยนได้จากในเว็บ (ส่งคำสั่งไปเครื่องหลัก แล้วทุกเครื่องหมุนตาม)
  function rotationForRole(r) { return r === 'viewer' ? (hostCfgRot ?? 0) : (readRot(ROT_KEY) ?? 0); }
  function syncRotSelects() { ['cctvRotSelHost', 'cctvRotSelView'].forEach(id => { const el = $(id); if (el) el.value = String(rotation); }); }
  function setRotation(deg) {
    if (role === 'viewer') {
      if (viewDc && viewDc.readyState === 'open') viewDc.send(JSON.stringify({ t: 'setRot', rot: deg }));
      else { syncRotSelects(); notify('ยังไม่ได้เชื่อมต่อกับเครื่องหลัก — กด "เชื่อมต่อ" ก่อน'); }
      return;
    }
    rotation = deg;
    try { localStorage.setItem(ROT_KEY, String(deg)); } catch (e) {}
    layoutForRotation();
    syncRotSelects();
    hostPeers.forEach(pc => sendHostCfg(pc._dc));
  }
  $('cctvRotateBtn').addEventListener('click', () => setRotation((rotation + 90) % 360));
  ['cctvRotSelHost', 'cctvRotSelView'].forEach(id => { const el = $(id); if (el) el.addEventListener('change', () => setRotation(Number(el.value))); });
  const remoteEl = $('cctvRemote');
  remoteEl.addEventListener('loadedmetadata', () => layoutForRotation(remoteEl.videoWidth, remoteEl.videoHeight));
  remoteEl.addEventListener('resize', () => layoutForRotation(remoteEl.videoWidth, remoteEl.videoHeight));

  // เปลี่ยนความละเอียด = ปิดกระแสเดิมแล้วเปิดใหม่ (การสลับสดๆ ทำให้ภาพเสียในกล้อง USB บางรุ่น)
  // กล้องต้องใช้เวลาปล่อยตัวเองก่อน จึงรอแล้วลองซ้ำหลายรอบ ถ้าไม่ได้จริงๆ จะย้อนกลับค่าเดิมให้กล้องไม่ดับ
  async function reopenCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    let lastErr;
    for (const wait of [700, 1500, 3000]) {
      await new Promise(r => setTimeout(r, wait));
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: getVideoConstraints(), audio: false });
        video.srcObject = stream;
        await video.play();
        showActual();
        await applyCameraAdjust();
        buildAdjustPanel();
        hostRefreshTracks();
        const w = video.videoWidth || 640, h = video.videoHeight || 480;
        layoutForRotation(w, h);
        return;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  // ยามเฝ้ากล้อง: ถ้าภาพนิ่งค้าง (กล้อง USB สะดุด/หลุด) เปิดกล้องใหม่ให้เองโดยไม่ต้องมีใครมากด
  let recovering = false, lastRecoverAt = 0, lastCT = -1, lastCTChange = Date.now();
  async function recoverCamera(reason) {
    recovering = true; lastRecoverAt = Date.now();
    statusText.textContent = 'ภาพค้าง (' + reason + ') — กำลังเปิดกล้องใหม่อัตโนมัติ...';
    addLog(nowStamp() + ' · ภาพค้าง (' + reason + ') เปิดกล้องใหม่อัตโนมัติ');
    try {
      await reopenCamera();
      statusText.textContent = isRecording ? 'ตรวจพบความเคลื่อนไหว — กำลังบันทึก' : 'เปิดกล้องแล้ว — กู้คืนอัตโนมัติเรียบร้อย';
    } catch (e) {
      statusText.textContent = 'กล้องค้างและเปิดใหม่ไม่สำเร็จ — จะลองอีกครั้งใน 10 วินาที';
    } finally { recovering = false; lastCT = -1; lastCTChange = Date.now(); }
  }
  document.addEventListener('visibilitychange', () => { lastCT = -1; lastCTChange = Date.now(); });
  setInterval(() => {
    if (!stream || recovering || switchingRes) return;
    if (Date.now() - lastRecoverAt < 10000) return;
    const t = stream.getVideoTracks()[0];
    if (!t || t.readyState === 'ended') return recoverCamera('กล้องหลุด');   // เช็กได้แม้แท็บอยู่เบื้องหลัง
    if (document.hidden) return;   // แท็บซ่อนอยู่ เบราว์เซอร์อาจหยุดเดินภาพเอง จึงไม่ใช้เกณฑ์ภาพนิ่งตอนนี้
    if (video.paused) video.play().catch(() => {});
    const ct = video.currentTime;
    if (ct !== lastCT) { lastCT = ct; lastCTChange = Date.now(); }
    if (Date.now() - lastCTChange > 8000) recoverCamera('ไม่มีภาพใหม่ 8 วินาที');
  }, 2000);

  let lastGoodRes = resolutionSelect.value, switchingRes = false;
  resolutionSelect.addEventListener('change', async () => {
    saveSettings();
    if (!stream || switchingRes) return;
    switchingRes = true;
    const wanted = resolutionSelect.value;
    statusText.textContent = 'กำลังเปลี่ยนความละเอียด...';
    try {
      await reopenCamera();
      lastGoodRes = wanted;
      statusText.textContent = 'เปิดกล้องแล้ว — เปลี่ยนความละเอียดเรียบร้อย';
    } catch (err) {
      resolutionSelect.value = lastGoodRes; saveSettings();
      try {
        await reopenCamera();
        statusText.textContent = 'เปิดกล้องแล้ว — กลับไปใช้ความละเอียดเดิม';
        notify('เปลี่ยนเป็น ' + wanted.replace('x', ' x ') + ' ไม่สำเร็จ (' + err.message + ')\nกลับไปใช้ความละเอียดเดิมให้แล้ว\nถ้าเปลี่ยนไม่ได้ซ้ำๆ ให้ปิดโปรแกรมอื่นที่ใช้กล้อง หรือลองเสียบสาย USB ใหม่');
      } catch (err2) {
        statusText.textContent = 'กล้องไม่ตอบสนอง';
        notify('กล้องไม่ตอบสนอง: ' + err2.message + '\nลองกด "ปิดกล้อง" แล้ว "เปิดกล้อง" ใหม่ หรือถอดแล้วเสียบสาย USB ของกล้องใหม่');
      }
    } finally { switchingRes = false; }
  });

  (function applySavedBasicSettings() {
    const saved = loadSavedSettings();
    if (!saved) return;
    if (saved.sensitivity !== undefined) sensitivityInput.value = saved.sensitivity;
    if (saved.cooldown !== undefined) cooldownSelect.value = saved.cooldown;
    if (saved.resolution !== undefined) resolutionSelect.value = saved.resolution;
  })();

  // จำโฟลเดอร์ที่เลือกไว้ข้ามการรีโหลดหน้า
  const DB_NAME = 'cctv-motion-recorder', STORE_NAME = 'handles', HANDLE_KEY = 'dirHandle';
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const nowStamp = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const fileStamp = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`; };

  function setHud(mode) {
    hud.classList.remove('recording');
    if (mode === 'recording') { hud.classList.add('recording'); hudText.textContent = 'กำลังบันทึก'; }
    else if (mode === 'armed') hudText.textContent = 'เฝ้าระวัง';
    else if (mode === 'idle') hudText.textContent = 'เปิดกล้องแล้ว';
    else hudText.textContent = 'ยังไม่ได้เปิดกล้อง';
  }

  function addLog(text, kind) {
    const empty = logEl.querySelector('.cctv-log-empty');
    if (empty) empty.remove();
    const li = document.createElement('li');
    li.className = kind || '';
    const label = document.createElement('span');
    label.textContent = text;
    const badge = document.createElement('span');
    badge.className = 'cctv-badge';
    badge.textContent = kind === 'failed' ? 'ล้มเหลว' : (kind === 'saved' ? 'บันทึกแล้ว' : '');
    li.appendChild(label); li.appendChild(badge);
    logEl.prepend(li);
  }

  async function listCameras() {
    try {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      if (cams.length > 1) {
        camSelect.innerHTML = '';
        cams.forEach((c, i) => {
          const opt = document.createElement('option');
          opt.value = c.deviceId; opt.textContent = c.label || `กล้อง ${i + 1}`;
          camSelect.appendChild(opt);
        });
        const saved = loadSavedSettings();
        if (saved && saved.camDeviceId && cams.some(c => c.deviceId === saved.camDeviceId)) camSelect.value = saved.camDeviceId;
      }
    } catch (e) {}
  }

  // ปรับภาพ (แสง/สี): ใช้ค่าที่กล้องเปิดให้เบราว์เซอร์ปรับได้ (แต่ละรุ่นไม่เท่ากัน) และจำค่าไว้
  const ADJUST_KEY = 'cctv-adjust';
  const ADJUST_ITEMS = [['exposureCompensation', 'ชดเชยแสง'], ['brightness', 'ความสว่าง'], ['contrast', 'คอนทราสต์'], ['saturation', 'ความอิ่มสี']];
  const loadAdjust = () => { try { return JSON.parse(localStorage.getItem(ADJUST_KEY) || '{}'); } catch (e) { return {}; } };
  const saveAdjust = v => { try { localStorage.setItem(ADJUST_KEY, JSON.stringify(v)); } catch (e) {} };

  async function applyCameraAdjust() {
    const t = stream && stream.getVideoTracks()[0];
    if (!t || !t.getCapabilities) return;
    const caps = t.getCapabilities();
    const adv = {};
    // บังคับให้ระบบแสง/สมดุลสีอัตโนมัติทำงานต่อเนื่อง (แก้อาการแสงค้างจ้าหลังเปลี่ยนความละเอียด)
    if (caps.exposureMode && caps.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
    if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('continuous')) adv.whiteBalanceMode = 'continuous';
    const saved = loadAdjust();
    ADJUST_ITEMS.forEach(([k]) => { if (caps[k] && saved[k] !== undefined) adv[k] = saved[k]; });
    if (Object.keys(adv).length) { try { await t.applyConstraints({ advanced: [adv] }); } catch (e) {} }
  }

  function buildAdjustPanel() {
    const box = $('cctvAdjust');
    if (!box) return;
    const t = stream && stream.getVideoTracks()[0];
    if (!t || !t.getCapabilities) { box.textContent = 'เปิดกล้องก่อน'; return; }
    const caps = t.getCapabilities(), settings = t.getSettings(), saved = loadAdjust();
    box.innerHTML = '';
    const btns = document.createElement('div'); btns.className = 'cctv-btnrow';
    const auto = document.createElement('button'); auto.type = 'button'; auto.textContent = '☀️ รีเซ็ตเป็นแสงอัตโนมัติ';
    auto.addEventListener('click', async () => { saveAdjust({}); await applyCameraAdjust(); buildAdjustPanel(); });
    btns.appendChild(auto); box.appendChild(btns);
    let n = 0;
    ADJUST_ITEMS.forEach(([k, label]) => {
      const c = caps[k];
      if (!c || c.min === undefined || c.max === undefined) return;
      n++;
      const row = document.createElement('div'); row.className = 'cctv-adjust-row';
      const lb = document.createElement('label'); lb.textContent = label;
      const inp = document.createElement('input'); inp.type = 'range'; inp.min = c.min; inp.max = c.max; inp.step = c.step || (c.max - c.min) / 100;
      inp.value = saved[k] !== undefined ? saved[k] : (settings[k] !== undefined ? settings[k] : c.min);
      inp.addEventListener('input', () => {
        const s = loadAdjust(); s[k] = Number(inp.value); saveAdjust(s);
        t.applyConstraints({ advanced: [{ [k]: Number(inp.value) }] }).catch(() => {});
      });
      row.appendChild(lb); row.appendChild(inp); box.appendChild(row);
    });
    if (!n) { const note = document.createElement('div'); note.textContent = 'กล้องรุ่นนี้ไม่เปิดให้ปรับแสงผ่านเบราว์เซอร์ — ปุ่มด้านบนยังใช้บังคับแสงอัตโนมัติได้'; box.appendChild(note); }
  }

  // แสดงค่าที่กล้องส่งมาจริง (ขนาด/เฟรมเรต) ไว้เทียบกับที่เลือก
  function showActual() {
    const el = $('cctvActualInfo');
    const t = stream && stream.getVideoTracks()[0];
    if (!el) return;
    if (!t) { el.textContent = '-'; return; }
    const s = t.getSettings();
    el.textContent = `${s.width}x${s.height} @ ${Math.round(s.frameRate || 0)} fps`;
  }

  function getVideoConstraints() {
    const [width, height] = resolutionSelect.value.split('x').map(Number);
    const deviceId = camSelect.value && camSelect.options.length > 1 ? { exact: camSelect.value } : undefined;
    // ความละเอียดสูงกล้อง USB ส่งข้อมูลเยอะมาก (สาย/พอร์ต USB2 ไม่พอ ภาพจะขาดเป็นแถบหรือสีเพี้ยน)
    // จึงลดเหลือ 15 fps ตั้งแต่ Full HD ขึ้นไป — กล้องวงจรปิดใช้ 15 fps ก็เพียงพอ
    const frameRate = height >= 1080 ? { ideal: 15, max: 15 } : { ideal: 30, max: 30 };
    if (!width || !height) return deviceId ? { deviceId, frameRate } : { frameRate };
    return deviceId ? { deviceId, width: { ideal: width }, height: { ideal: height }, frameRate } : { width: { ideal: width }, height: { ideal: height }, frameRate };
  }

  async function startCamera() {
    // กล้อง USB (โดยเฉพาะ Full HD/2K) ใช้เวลาเปิดหลายวินาที แสดงตัวนับให้รู้ว่ายังทำงานอยู่
    const t0 = Date.now();
    placeholder.style.display = 'flex';
    const showWait = () => { placeholder.textContent = `กำลังเปิดกล้อง... ${Math.round((Date.now() - t0) / 1000)} วินาที (ความละเอียดสูงเปิดช้ากว่า)`; };
    showWait();
    const waitTimer = setInterval(showWait, 500);
    btnStart.disabled = true;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('เบราว์เซอร์นี้ไม่รองรับกล้อง (ต้องเปิดผ่าน https หรือ localhost)');
      // ลองเปิดด้วยค่าที่เลือกก่อน ถ้ากล้องไม่ตอบ (Timeout starting video source) รอแล้วลองค่าพื้นฐานที่เบาที่สุด
      const full = getVideoConstraints(), lowRes = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
      let usedFallback = false, lastErr;
      for (const [i, c] of [full, full, lowRes].entries()) {
        try {
          if (i > 0) await new Promise(r => setTimeout(r, 1500));
          stream = await navigator.mediaDevices.getUserMedia({ video: c, audio: false });
          usedFallback = (i === 2);
          break;
        } catch (e) { lastErr = e; stream = null; }
      }
      if (!stream) throw lastErr;
      video.srcObject = stream;
      await video.play();
      clearInterval(waitTimer);
      placeholder.style.display = 'none';   // โชว์ภาพก่อน ค่อยปรับแสงตามหลัง ไม่ต้องรอ
      showActual();
      applyCameraAdjust().then(buildAdjustPanel);
      if (usedFallback) notify('กล้องเปิดไม่ได้ที่ความละเอียดที่เลือก จึงเปิดด้วยค่าพื้นฐาน 640 x 480 แทน\nลองเลือกความละเอียดต่ำลง (เช่น 1280 x 720) หรือเสียบกล้องพอร์ต USB 3.0 ตรงที่ตัวเครื่อง');
      placeholder.style.display = 'none';
      const w = video.videoWidth || 640, h = video.videoHeight || 480;
      layoutForRotation(w, h);   // กรอบภาพตามสัดส่วนกล้องจริงและมุมที่หมุน
      await listCameras();
      btnStart.disabled = true; btnStop.disabled = false;
      statusText.textContent = 'เปิดกล้องแล้ว — กรุณาเลือกโฟลเดอร์บันทึก';
      setHud('idle');
      startClock();
      video.style.display = 'block';
      startRenderLoop();
      renderStream = recordCanvas.captureStream(30);
      try { localStorage.setItem(ACTIVE_KEY, 'true'); } catch (e) {}
      hostStart();
      if (dirHandle) armMotionDetection();   // เลือกโฟลเดอร์ไว้ก่อนเปิดกล้อง → เริ่มเฝ้าระวังทันที
    } catch (err) {
      clearInterval(waitTimer);
      btnStart.disabled = false;
      placeholder.style.display = 'flex';
      placeholder.textContent = 'เปิดกล้องไม่สำเร็จ — กดปุ่ม "เปิดกล้อง" เพื่อลองใหม่';
      statusText.textContent = 'ปิดอยู่';
      const busy = /Timeout starting video source|NotReadable|Could not start video/i.test((err.name || '') + ' ' + err.message);
      notify('เปิดกล้องไม่สำเร็จ: ' + err.message + '\n' + (busy
        ? 'กล้องอาจถูกโปรแกรมอื่นใช้อยู่ หรือยังไม่พร้อม:\n• ปิดหน้า Settings > Cameras ของ Windows, โปรแกรม EMEET และแอปประชุม/แท็บอื่นที่ใช้กล้อง\n• ถอดสาย USB ของกล้องแล้วเสียบใหม่ (พอร์ต USB 3.0 ตรงที่ตัวเครื่อง) รอ 5 วินาทีแล้วกด "เปิดกล้อง"'
        : 'กรุณาอนุญาตการเข้าถึงกล้องในเบราว์เซอร์'));
    }
  }

  function startClock() {
    clearInterval(clockId);
    clockId = setInterval(() => { timestampEl.textContent = nowStamp(); }, 1000);
  }

  function startRenderLoop() {
    renderLoopActive = true;
    function draw() {
      if (!renderLoopActive || !stream) return;
      const w = recordCanvas.width, h = recordCanvas.height;
      const vw = video.videoWidth || srcW, vh = video.videoHeight || srcH;
      rctx.save();
      rctx.translate(w / 2, h / 2);
      rctx.rotate(rotation * Math.PI / 180);   // คลิปที่บันทึกก็หมุนตามมุมที่ตั้งไว้ เปิดดูย้อนหลังแล้วภาพตั้งตรง
      rctx.drawImage(video, -vw / 2, -vh / 2, vw, vh);
      rctx.restore();
      // ฝังวันเวลามุมขวาล่างลงในคลิป เหมือนกล้องวงจรปิดจริง
      rctx.font = `${Math.max(14, Math.round(h * 0.035))}px monospace`;
      rctx.textBaseline = 'bottom'; rctx.textAlign = 'right';
      rctx.shadowColor = 'rgba(0,0,0,0.9)'; rctx.shadowBlur = 4; rctx.fillStyle = '#3ddc97';
      rctx.fillText(nowStamp(), w - Math.round(w * 0.02), h - Math.round(h * 0.03));
      rctx.shadowBlur = 0;
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

  async function pickFolder() {
    if (!supportsFS) { folderInput.click(); return; }
    if (window.isSecureContext === false) {
      contextNotice.style.display = 'block';
      notify('เปิดตัวเลือกโฟลเดอร์ไม่ได้ เพราะหน้านี้ถูกเปิดแบบ file:// โดยตรง\nกรุณาเปิดผ่าน http://localhost แทน (ไฟล์ยังบันทึกได้ด้วยการดาวน์โหลดอัตโนมัติ)');
      return;
    }
    try {
      if (savedHandle) {
        const perm = await savedHandle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          dirHandle = savedHandle;
          folderPathEl.textContent = dirHandle.name;
          btnFolder.textContent = 'เลือกโฟลเดอร์บันทึก';
          armMotionDetection();
          return;
        }
      }
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      savedHandle = dirHandle;
      idbSet(HANDLE_KEY, dirHandle).catch(() => {});
      folderPathEl.textContent = dirHandle.name;
      btnFolder.textContent = 'เลือกโฟลเดอร์บันทึก';
      armMotionDetection();
    } catch (err) {
      if (err && err.name !== 'AbortError') notify('เลือกโฟลเดอร์ไม่สำเร็จ: ' + err.message);
    }
  }

  folderInput.addEventListener('change', () => {
    const f = folderInput.files[0];
    if (!f) return;
    folderPathEl.textContent = `${f.webkitRelativePath.split('/')[0] || 'โฟลเดอร์ที่เลือก'} (ไฟล์จะดาวน์โหลดอัตโนมัติ)`;
    dirHandle = null;
    statusText.textContent = stream ? 'พร้อมเฝ้าระวัง' : 'เลือกโฟลเดอร์แล้ว — กรุณาเปิดกล้อง';
    if (stream) armMotionDetection();
  });

  function armMotionDetection() {
    if (!stream) { statusText.textContent = 'เลือกโฟลเดอร์แล้ว — กรุณาเปิดกล้อง'; return; }   // กล้องยังปิดอยู่ จะเริ่มเฝ้าระวังตอนเปิดกล้อง
    setHud('armed');
    statusText.textContent = 'กำลังเฝ้าระวังความเคลื่อนไหว';
    if (motionLoopId) clearInterval(motionLoopId);
    prevFrame = null;
    motionLoopId = setInterval(checkMotion, 220);
  }

  function checkMotion() {
    if (!stream || video.readyState < 2) return;
    sctx.drawImage(video, 0, 0, sampleW, sampleH);
    const frame = sctx.getImageData(0, 0, sampleW, sampleH);
    if (prevFrame) {
      const sensitivity = Number(sensitivityInput.value);
      const pixelThreshold = 90 - sensitivity * 6;
      const changedRatioThreshold = 0.012 - sensitivity * 0.0009;
      let changed = 0;
      const a = prevFrame.data, b = frame.data;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > pixelThreshold) changed++;
      }
      if (changed / (sampleW * sampleH) > changedRatioThreshold) {
        lastMotionAt = Date.now();
        if (!isRecording) startRecording();
      } else if (isRecording && Date.now() - lastMotionAt > Number(cooldownSelect.value)) {
        stopRecording();
      }
    }
    prevFrame = frame;
  }

  // กล้องเปิดค้างไว้ตลอด ฟังก์ชันนี้คุมแค่การอัดคลิปตอนมีความเคลื่อนไหว
  function startRecording() {
    if (!stream) return;
    try {
      const source = renderStream || stream;
      recordedChunks = [];
      const opts = { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: Math.min(12e6, Math.max(2.5e6, recordCanvas.width * recordCanvas.height * 4)) };
      mediaRecorder = MediaRecorder.isTypeSupported(opts.mimeType) ? new MediaRecorder(source, opts) : new MediaRecorder(source);
      mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = handleClipReady;
      mediaRecorder.start();
      isRecording = true;
      setHud('recording');
      statusText.textContent = 'ตรวจพบความเคลื่อนไหว — กำลังบันทึก';
    } catch (err) { addLog('เริ่มบันทึกไม่สำเร็จ: ' + err.message, 'failed'); }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    isRecording = false;
    if (pendingResize) layoutForRotation();   // หมุนภาพระหว่างอัดคลิป → ปรับขนาดผืนผ้าใบหลังคลิปจบ
    setHud('armed');
    statusText.textContent = 'กำลังเฝ้าระวังความเคลื่อนไหว';
  }

  async function handleClipReady() {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const filename = `motion_${fileStamp()}.webm`;
    if (dirHandle) {
      try {
        const fh = await dirHandle.getFileHandle(filename, { create: true });
        const w = await fh.createWritable();
        await w.write(blob); await w.close();
        addLog(`${nowStamp()} · ${filename} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`, 'saved');
      } catch (err) {
        addLog(`${nowStamp()} · บันทึก ${filename} ไม่สำเร็จ: ${err.message}`, 'failed');
        downloadBlob(blob, filename);
      }
    } else {
      downloadBlob(blob, filename);
      addLog(`${nowStamp()} · ${filename} (ดาวน์โหลดอัตโนมัติ)`, 'saved');
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function stopEverything() {
    hostStop();
    if (motionLoopId) clearInterval(motionLoopId);
    if (clockId) clearInterval(clockId);
    if (isRecording) stopRecording();
    renderLoopActive = false;
    if (renderStream) { renderStream.getTracks().forEach(t => t.stop()); renderStream = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    video.srcObject = null; video.style.display = 'none';
    placeholder.style.display = 'flex';
    placeholder.textContent = 'ปิดกล้องอยู่ — กดปุ่ม "เปิดกล้อง" เพื่อเริ่มใหม่';
    setHud('off');
    statusText.textContent = 'ปิดอยู่';
    showActual();
    buildAdjustPanel();
    timestampEl.textContent = '';
    btnStart.disabled = false; btnStop.disabled = true;
    dirHandle = null;
    folderPathEl.textContent = 'ยังไม่ได้เลือก';
    try { localStorage.setItem(ACTIVE_KEY, 'false'); } catch (e) {}
  }

  btnStart.addEventListener('click', startCamera);
  btnFolder.addEventListener('click', pickFolder);
  btnStop.addEventListener('click', stopEverything);
  if (!supportsFS) btnFolder.title = 'เลือกโฟลเดอร์สำหรับระบุปลายทางดาวน์โหลด';

  // เปิดกล้องอัตโนมัติตอนเปิดหน้านี้ครั้งแรก (ถ้าครั้งก่อนไม่ได้กด "ปิดกล้อง" ไว้) และต่อโฟลเดอร์เดิมให้ถ้าเบราว์เซอร์ยังจำสิทธิ์ได้
  async function autoStart() {
    let wasActive = true;
    try { wasActive = localStorage.getItem(ACTIVE_KEY) !== 'false'; } catch (e) {}
    if (!wasActive) { placeholder.textContent = 'ปิดกล้องอยู่ — กดปุ่ม "เปิดกล้อง" เพื่อเริ่ม'; return; }
    await startCamera();
    if (!stream || !supportsFS) return;
    try {
      const handle = await idbGet(HANDLE_KEY);
      if (!handle) return;
      savedHandle = handle;
      if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
        dirHandle = handle;
        folderPathEl.textContent = dirHandle.name;
        armMotionDetection();
        statusText.textContent = 'พร้อมเฝ้าระวัง (เชื่อมต่อโฟลเดอร์อัตโนมัติ)';
      } else {
        btnFolder.textContent = 'คลิกเพื่อเชื่อมต่อโฟลเดอร์เดิมอีกครั้ง';
        statusText.textContent = 'เปิดกล้องแล้ว — กดปุ่มเพื่อเชื่อมต่อโฟลเดอร์เดิมอีกครั้ง (ต้องคลิกยืนยัน 1 ครั้งตามข้อกำหนดเบราว์เซอร์)';
      }
    } catch (err) {}
  }

  // ==========================================================
  //  ดูย้อนหลัง: อ่านคลิปจากโฟลเดอร์ แสดงเป็นไทม์ไลน์ตามช่วงเวลา แล้วเล่นต่อเนื่องเหมือนกล้องวงจรปิด
  //  เวลาเริ่มอ่านจากชื่อไฟล์ เวลาจบใช้เวลาแก้ไขไฟล์ล่าสุด
  // ==========================================================
  const pbDate = $('cctvPbDate'), pbFrom = $('cctvPbFrom'), pbTo = $('cctvPbTo');
  const pbLoad = $('cctvPbLoad'), pbInfo = $('cctvPbInfo'), pbVideo = $('cctvPbVideo'), pbNow = $('cctvPbNow');
  const tl = $('cctvTl'), tlHead = $('cctvTlHead'), tlTicks = $('cctvTlTicks'), pbList = $('cctvPbList');
  let pbClips = [], pbIndex = -1, pbWinStart = 0, pbWinEnd = 0, pbUrl = null, pbDir = null;

  const d0 = new Date();
  pbDate.value = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}`;

  const hhmmss = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const parseName = name => {
    const m = /^motion_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.webm$/.exec(name);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
  };

  async function getPlaybackDir() {
    if (!supportsFS) { notify('เบราว์เซอร์นี้ไม่รองรับการอ่านโฟลเดอร์ (ใช้ Chrome หรือ Edge ผ่าน http://localhost)'); return null; }
    let h = dirHandle || pbDir || savedHandle;
    if (!h) { try { h = await idbGet(HANDLE_KEY); } catch (e) {} }
    if (h) {
      try { if ((await h.requestPermission({ mode: 'read' })) === 'granted') { pbDir = h; return h; } } catch (e) {}
    }
    try { pbDir = await window.showDirectoryPicker({ mode: 'read' }); return pbDir; }
    catch (e) { if (e && e.name !== 'AbortError') notify('เลือกโฟลเดอร์ไม่สำเร็จ: ' + e.message); return null; }
  }

  function windowRange() {
    const [y, mo, da] = pbDate.value.split('-').map(Number);
    const [fh, fm] = (pbFrom.value || '00:00').split(':').map(Number);
    const [th, tm] = (pbTo.value || '23:59').split(':').map(Number);
    return [new Date(y, mo - 1, da, fh, fm, 0).getTime(), new Date(y, mo - 1, da, th, tm, 59).getTime()];
  }

  async function scanDir(dir, ws, we) {
    const clips = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue;
      const start = parseName(name);
      if (start === null) continue;
      const file = await handle.getFile();
      const end = Math.max(file.lastModified, start + 1000);
      if (end < ws || start > we) continue;
      clips.push({ name, handle, start, end, size: file.size });
    }
    return clips;
  }

  async function loadPlayback() {
    if (!pbDate.value) { notify('กรุณาเลือกวันที่'); return; }
    const isViewer = role === 'viewer';
    const dir = isViewer ? null : await getPlaybackDir();
    if (!isViewer && !dir) return;
    const [ws, we] = windowRange();
    if (we <= ws) { notify('เวลา "ถึง" ต้องมากกว่า "ตั้งแต่"'); return; }
    pbWinStart = ws; pbWinEnd = we;
    let clips = [];
    try {
      if (isViewer) {
        // มือถือ/เครื่องที่ดู: ขอรายการและตัวคลิปจากเครื่องหลักผ่านการเชื่อมต่อ (คลิปเก็บอยู่ที่เครื่องหลัก)
        pbInfo.textContent = 'กำลังขอรายการคลิปจากเครื่องหลัก...';
        const list = await dcRequest({ t: 'list', from: ws, to: we });
        clips = list.map(c => ({ ...c, handle: { getFile: () => dcRequest({ t: 'get', name: c.name }, pct => { pbInfo.textContent = `กำลังโหลดคลิป ${pct}%`; }) } }));
      } else {
        pbInfo.textContent = 'กำลังอ่านโฟลเดอร์...';
        clips = await scanDir(dir, ws, we);
      }
    } catch (e) { pbInfo.textContent = (isViewer ? 'ขอคลิปไม่สำเร็จ: ' : 'อ่านโฟลเดอร์ไม่สำเร็จ: ') + e.message; return; }
    clips.sort((a, b) => a.start - b.start);
    pbClips = clips; pbIndex = -1;
    pbInfo.textContent = clips.length ? `พบ ${clips.length} คลิป · คลิกที่ไทม์ไลน์หรือรายการเพื่อดู` : 'ไม่พบคลิปในช่วงเวลานี้';
    renderTimeline();
    if (clips.length) playClip(0);
  }

  function renderTimeline() {
    tl.querySelectorAll('.cctv-tl-seg').forEach(n => n.remove());
    const span = pbWinEnd - pbWinStart;
    pbClips.forEach((c, i) => {
      const seg = document.createElement('div');
      seg.className = 'cctv-tl-seg';
      const l = Math.max(0, (c.start - pbWinStart) / span) * 100;
      const r = Math.min(1, (c.end - pbWinStart) / span) * 100;
      seg.style.left = l + '%'; seg.style.width = Math.max(0.25, r - l) + '%';
      seg.title = `${hhmmss(c.start)} - ${hhmmss(c.end)}`;
      seg.dataset.i = i;
      tl.appendChild(seg);
    });
    // ขีดบอกเวลาบนแกน (ประมาณ 8 ช่อง)
    tlTicks.innerHTML = '';
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = document.createElement('span');
      t.style.left = (i / steps * 100) + '%';
      t.textContent = hhmmss(pbWinStart + span * i / steps).slice(0, 5);
      tlTicks.appendChild(t);
    }
    pbList.innerHTML = '';
    pbClips.forEach((c, i) => {
      const li = document.createElement('li');
      li.dataset.i = i; li.style.cursor = 'pointer';
      const a = document.createElement('span'); a.textContent = `${hhmmss(c.start)} – ${hhmmss(c.end)}`;
      const b = document.createElement('span'); b.className = 'cctv-badge'; b.textContent = `${(c.size / 1024 / 1024).toFixed(2)} MB `;
      const dl = document.createElement('button'); dl.type = 'button'; dl.className = 'cctv-mini'; dl.dataset.dl = i; dl.textContent = '⬇'; dl.title = 'ดาวน์โหลดคลิปนี้';
      b.appendChild(dl);
      li.appendChild(a); li.appendChild(b); pbList.appendChild(li);
    });
    $('cctvPbDownload').disabled = !pbClips.length;
    $('cctvPbDownloadAll').disabled = !pbClips.length;
    updateHead(pbWinStart);
  }

  function updateHead(ms) {
    const span = pbWinEnd - pbWinStart;
    if (!span) return;
    const p = (ms - pbWinStart) / span;
    tlHead.hidden = p < 0 || p > 1;
    tlHead.style.left = (p * 100) + '%';
  }

  async function playClip(i, offsetMs) {
    if (i < 0 || i >= pbClips.length) return;
    pbIndex = i;
    const c = pbClips[i];
    try {
      const file = await c.handle.getFile();
      if (pbUrl) URL.revokeObjectURL(pbUrl);
      pbUrl = URL.createObjectURL(file);
      pbVideo.src = pbUrl;
      pbVideo.onloadedmetadata = () => { if (offsetMs > 0) { try { pbVideo.currentTime = offsetMs / 1000; } catch (e) {} } };
      await pbVideo.play().catch(() => {});
    } catch (e) { pbInfo.textContent = 'เปิดคลิปไม่สำเร็จ: ' + e.message; }
    tl.querySelectorAll('.cctv-tl-seg').forEach(s => s.classList.toggle('active', +s.dataset.i === i));
    pbList.querySelectorAll('li').forEach(li => li.classList.toggle('active', +li.dataset.i === i));
    pbNow.textContent = hhmmss(c.start);
    updateHead(c.start);
    $('cctvPbPrev').disabled = i <= 0;
    $('cctvPbNext').disabled = i >= pbClips.length - 1;
  }

  pbVideo.addEventListener('timeupdate', () => {
    if (pbIndex < 0) return;
    const ms = pbClips[pbIndex].start + pbVideo.currentTime * 1000;
    pbNow.textContent = hhmmss(ms);
    updateHead(ms);
  });
  pbVideo.addEventListener('ended', () => { if (pbIndex + 1 < pbClips.length) playClip(pbIndex + 1); });

  tl.addEventListener('click', e => {
    if (!pbClips.length) return;
    const r = tl.getBoundingClientRect();
    const t = pbWinStart + (e.clientX - r.left) / r.width * (pbWinEnd - pbWinStart);
    let i = pbClips.findIndex(c => t >= c.start && t <= c.end);
    if (i >= 0) return playClip(i, t - pbClips[i].start);
    i = pbClips.findIndex(c => c.start > t);      // คลิกช่วงว่าง → ไปคลิปถัดไป
    playClip(i >= 0 ? i : pbClips.length - 1);
  });
  async function downloadClip(i) {
    const c = pbClips[i];
    if (!c) return;
    try { downloadBlob(await c.handle.getFile(), c.name); }
    catch (e) { notify('ดาวน์โหลดไม่สำเร็จ: ' + e.message); }
  }
  pbList.addEventListener('click', e => {
    const dl = e.target.closest('button[data-dl]');
    if (dl) { downloadClip(+dl.dataset.dl); return; }
    const li = e.target.closest('li[data-i]'); if (li) playClip(+li.dataset.i);
  });
  $('cctvPbDownload').addEventListener('click', () => downloadClip(pbIndex));
  $('cctvPbDownloadAll').addEventListener('click', async () => {
    if (!pbClips.length) return;
    if (!confirm(`ดาวน์โหลดทั้งหมด ${pbClips.length} คลิป? เบราว์เซอร์อาจถามขออนุญาตดาวน์โหลดหลายไฟล์`)) return;
    for (let i = 0; i < pbClips.length; i++) { await downloadClip(i); await new Promise(r => setTimeout(r, 500)); }
  });
  pbLoad.addEventListener('click', loadPlayback);

  // สลับแท็บ กล้องสด / ดูย้อนหลัง (กล้องสดยังอัดต่อเนื่องแม้ซ่อนอยู่)
  const tabLive = $('cctvTabLive'), tabPb = $('cctvTabPb'), liveView = $('cctvLiveView'), pbView = $('cctvPbView');
  let pbAutoLoaded = false;
  function showTab(name) {
    const pb = name === 'pb';
    liveView.hidden = pb; pbView.hidden = !pb;
    tabLive.classList.toggle('active', !pb); tabPb.classList.toggle('active', pb);
    if (!pb) pbVideo.pause();
    // โหลดให้อัตโนมัติเฉพาะตอนที่เชื่อมต่อโฟลเดอร์ไว้แล้ว (ไม่งั้นต้องให้ผู้ใช้กดค้นหาเอง เพราะเบราว์เซอร์ต้องการการคลิกก่อนเปิดตัวเลือกโฟลเดอร์)
    if (pb && !pbAutoLoaded && (role === 'viewer' ? (viewDc && viewDc.readyState === 'open') : (dirHandle || pbDir))) { pbAutoLoaded = true; loadPlayback(); }
  }
  tabLive.addEventListener('click', () => showTab('live'));
  tabPb.addEventListener('click', () => showTab('pb'));

  // ปุ่มลัดช่วงเวลา
  document.querySelectorAll('[data-quick]').forEach(btn => btn.addEventListener('click', () => {
    const now = new Date(), q = btn.dataset.quick;
    const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const tstr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (q === 'hour') {
      const from = new Date(now.getTime() - 3600 * 1000);
      if (dstr(from) !== dstr(now)) { pbDate.value = dstr(now); pbFrom.value = '00:00'; }
      else { pbDate.value = dstr(now); pbFrom.value = tstr(from); }
      pbTo.value = tstr(now);
    } else {
      const d = new Date(now); if (q === 'yesterday') d.setDate(d.getDate() - 1);
      pbDate.value = dstr(d); pbFrom.value = '00:00'; pbTo.value = '23:59';
    }
    loadPlayback();
  }));

  $('cctvPbPrev').addEventListener('click', () => playClip(pbIndex - 1));
  $('cctvPbNext').addEventListener('click', () => playClip(pbIndex + 1));

  // ==========================================================
  //  ดูกล้องข้ามเครื่อง (WebRTC): เครื่องที่เสียบกล้อง (host) ส่งภาพสดให้มือถือ (viewer) ผ่านห้องรหัสลับ
  //  ใช้ Supabase Realtime แค่ส่งสัญญาณเชื่อมต่อ ตัวภาพวิ่งตรงระหว่างสองเครื่อง ไม่ผ่านเซิร์ฟเวอร์
  // ==========================================================
  const ROOM_KEY = 'cctv-room-code', ROLE_KEY = 'cctv-role', VIEW_CODE_KEY = 'cctv-view-code';
  const RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
  const MAX_VIEWERS = 4;
  const genCode = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    crypto.getRandomValues(new Uint8Array(8)).forEach(v => { s += chars[v % chars.length]; });
    return s;
  };
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const realtimeOk = () => typeof sbClient !== 'undefined' && sbClient && typeof RTCPeerConnection !== 'undefined';

  const remoteVideo = $('cctvRemote');
  const shareCodeEl = $('cctvShareCode'), shareViewersEl = $('cctvShareViewers');
  const viewCodeEl = $('cctvViewCode'), viewStatusEl = $('cctvViewStatus');
  const roleHostBtn = $('cctvRoleHost'), roleViewBtn = $('cctvRoleView');
  const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  let role = lsGet(ROLE_KEY) || (isMobileUA ? 'viewer' : 'host');
  let roomCode = lsGet(ROOM_KEY);
  if (!roomCode) { roomCode = genCode(); lsSet(ROOM_KEY, roomCode); }
  shareCodeEl.value = roomCode;

  // ---- ฝั่งเครื่องที่เสียบกล้อง ----
  let hostChan = null;
  const hostPeers = new Map();   // viewerId -> RTCPeerConnection

  function hostSend(payload) { if (hostChan) hostChan.send({ type: 'broadcast', event: 'sig', payload }); }
  function updateViewerCount() {
    let n = 0; hostPeers.forEach(pc => { if (pc.connectionState === 'connected') n++; });
    shareViewersEl.textContent = n;
  }
  function closeHostPeer(id) {
    const pc = hostPeers.get(id);
    if (pc) { try { pc.close(); } catch (e) {} hostPeers.delete(id); }
    updateViewerCount();
  }
  function hostStart() {
    hostStop();
    if (!realtimeOk()) return;
    hostChan = sbClient.channel('cctv-live-' + roomCode, { config: { broadcast: { self: false } } });
    hostChan.on('broadcast', { event: 'sig' }, ({ payload }) => onHostSignal(payload)).subscribe();
  }
  function hostStop() {
    hostPeers.forEach((pc, id) => closeHostPeer(id));
    if (hostChan) { try { sbClient.removeChannel(hostChan); } catch (e) {} hostChan = null; }
    updateViewerCount();
  }
  async function onHostSignal(m) {
    if (!m) return;
    try {
      if (m.type === 'join') return hostOffer(m.id);
      if (m.to !== 'host') return;
      const pc = hostPeers.get(m.from);
      if (!pc) return;
      if (m.type === 'answer') {
        await pc.setRemoteDescription(m.sdp);
        for (const c of pc._q) await pc.addIceCandidate(c).catch(() => {});
        pc._q = [];
      } else if (m.type === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(m.cand).catch(() => {});
        else pc._q.push(m.cand);
      } else if (m.type === 'bye') closeHostPeer(m.from);
    } catch (e) {}
  }
  async function hostOffer(id) {
    if (!stream) return;
    closeHostPeer(id);
    if (hostPeers.size >= MAX_VIEWERS) return;
    const pc = new RTCPeerConnection(RTC_CFG);
    pc._q = [];
    hostPeers.set(id, pc);
    stream.getVideoTracks().forEach(t => pc.addTrack(t, stream));
    // ช่องส่งไฟล์: ให้ผู้ดูขอรายการ/ตัวคลิปย้อนหลังจากโฟลเดอร์ที่เครื่องหลักได้
    const dc = pc.createDataChannel('files');
    dc.binaryType = 'arraybuffer';
    dc._chain = Promise.resolve();
    pc._dc = dc;
    dc.onopen = () => sendHostCfg(dc);
    dc.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      dc._chain = dc._chain.then(() => hostHandleFileMsg(dc, m)).catch(() => {});
    };
    pc.onicecandidate = e => { if (e.candidate) hostSend({ type: 'ice', to: id, from: 'host', cand: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closeHostPeer(id);
      updateViewerCount();
    };
    try {
      // จำกัดบิตเรตและขนาดภาพที่ส่งให้มือถือ (ต้นทาง 2K ก็ส่งลดขนาดให้ลื่นบนเน็ตมือถือ)
      const sender = pc.getSenders()[0];
      if (sender) {
        const p = sender.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = 2000000;
        p.encodings[0].scaleResolutionDownBy = Math.max(1, (video.videoWidth || 1280) / 1280);
        await sender.setParameters(p).catch(() => {});
      }
      await pc.setLocalDescription(await pc.createOffer());
      hostSend({ type: 'offer', to: id, from: 'host', sdp: pc.localDescription });
    } catch (e) { closeHostPeer(id); }
  }
  function sendHostCfg(dc) {
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify({ t: 'cfg', rot: readRot(ROT_KEY) ?? 0 }));
  }

  async function hostHandleFileMsg(dc, m) {
    const reply = o => { if (dc.readyState === 'open') dc.send(JSON.stringify(o)); };
    if (m.t === 'setRot') { if ([0, 90, 180, 270].includes(m.rot) && role === 'host') setRotation(m.rot); return; }   // เครื่องที่ดูสั่งหมุนภาพ
    if (!dirHandle) return reply({ t: 'err', id: m.id, msg: 'เครื่องหลักยังไม่ได้เชื่อมต่อโฟลเดอร์บันทึก (กดปุ่มโฟลเดอร์ที่เครื่องหลักก่อน)' });
    try {
      if (m.t === 'list') {
        const clips = await scanDir(dirHandle, Number(m.from), Number(m.to));
        return reply({ t: 'list', id: m.id, clips: clips.map(c => ({ name: c.name, start: c.start, end: c.end, size: c.size })) });
      }
      if (m.t === 'get') {
        if (parseName(String(m.name)) === null) return reply({ t: 'err', id: m.id, msg: 'ชื่อไฟล์ไม่ถูกต้อง' });   // รับเฉพาะชื่อคลิปที่เครื่องนี้สร้างเอง
        const file = await (await dirHandle.getFileHandle(m.name)).getFile();
        reply({ t: 'file', id: m.id, size: file.size });
        const CHUNK = 16384;
        dc.bufferedAmountLowThreshold = 256 * 1024;
        for (let off = 0; off < file.size; off += CHUNK) {
          if (dc.readyState !== 'open') return;
          if (dc.bufferedAmount > 1024 * 1024) await new Promise(r => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r(); }; });
          dc.send(await file.slice(off, off + CHUNK).arrayBuffer());
        }
        reply({ t: 'end', id: m.id });
      }
    } catch (e) { reply({ t: 'err', id: m.id, msg: e.message }); }
  }

  // เปลี่ยนความละเอียดแล้วกล้องเป็นกระแสใหม่ → สลับแทร็กที่ส่งให้ผู้ดูทุกคน
  function hostRefreshTracks() {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    hostPeers.forEach(pc => { const s = pc.getSenders()[0]; if (s) s.replaceTrack(track).catch(() => {}); });
  }

  $('cctvShareNew').addEventListener('click', () => {
    roomCode = genCode(); lsSet(ROOM_KEY, roomCode); shareCodeEl.value = roomCode;
    if (stream) hostStart();      // ผู้ดูรหัสเก่าจะหลุดทันที
  });
  shareCodeEl.addEventListener('focus', () => shareCodeEl.select());

  // ---- ฝั่งมือถือ/เครื่องที่ดู ----
  let viewChan = null, viewPc = null, viewId = null, viewTimer = null, viewQ = [];
  const setViewStatus = t => {
    viewStatusEl.textContent = t;
    hudText.textContent = t === 'กำลังดูกล้องสด' ? 'ดูสดจากกล้องอีกเครื่อง' : 'ยังไม่ได้เชื่อมต่อกล้อง';
  };

  // ช่องขอไฟล์จากเครื่องหลัก: ส่งคำขอทีละรายการ ตอบกลับด้วย id เดียวกัน
  let viewDc = null, dcSeq = 0, dcCurrent = 0;
  const dcPending = new Map();
  function dcRequest(msg, onProgress) {
    return new Promise((resolve, reject) => {
      if (!viewDc || viewDc.readyState !== 'open') return reject(new Error('ยังไม่ได้เชื่อมต่อกับเครื่องหลัก (ไปแท็บกล้องสดแล้วกดเชื่อมต่อก่อน)'));
      const id = ++dcSeq;
      const timer = setTimeout(() => { dcPending.delete(id); reject(new Error('หมดเวลารอเครื่องหลักตอบ')); }, 180000);
      dcPending.set(id, { chunks: [], size: 0, got: 0, onProgress,
        resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      viewDc.send(JSON.stringify({ ...msg, id }));
    });
  }
  function onViewerDcMsg(data) {
    if (typeof data === 'string') {
      let m; try { m = JSON.parse(data); } catch (e) { return; }
      if (m.t === 'cfg') {   // เครื่องหลักบอกมุมกล้อง: ถ้าเครื่องนี้ยังไม่ได้ตั้งมุมเอง ใช้ตามเครื่องหลัก
        hostCfgRot = [0, 90, 180, 270].includes(m.rot) ? m.rot : 0;
        rotation = hostCfgRot; layoutForRotation(); syncRotSelects();
        return;
      }
      const p = dcPending.get(m.id);
      if (!p) return;
      if (m.t === 'list') { dcPending.delete(m.id); p.resolve(m.clips); }
      else if (m.t === 'err') { dcPending.delete(m.id); p.reject(new Error(m.msg)); }
      else if (m.t === 'file') { p.size = m.size; dcCurrent = m.id; }
      else if (m.t === 'end') { dcPending.delete(m.id); p.resolve(new Blob(p.chunks, { type: 'video/webm' })); }
    } else {
      const p = dcPending.get(dcCurrent);
      if (!p) return;
      p.chunks.push(data); p.got += data.byteLength;
      if (p.onProgress && p.size) p.onProgress(Math.min(100, Math.round(p.got / p.size * 100)));
    }
  }

  function viewerStop() {
    dcPending.forEach(p => p.reject(new Error('การเชื่อมต่อถูกปิด'))); dcPending.clear(); viewDc = null;
    clearInterval(viewTimer); viewTimer = null;
    if (viewChan) { try { viewChan.send({ type: 'broadcast', event: 'sig', payload: { type: 'bye', to: 'host', from: viewId } }); } catch (e) {} try { sbClient.removeChannel(viewChan); } catch (e) {} viewChan = null; }
    if (viewPc) { try { viewPc.close(); } catch (e) {} viewPc = null; }
    remoteVideo.srcObject = null;
  }
  function viewerConnect() {
    const code = viewCodeEl.value.trim().toLowerCase();
    if (!code) { notify('กรุณาใส่รหัสดูกล้อง'); return; }
    if (!realtimeOk()) { notify('เบราว์เซอร์นี้ไม่รองรับการดูกล้อง (WebRTC)'); return; }
    lsSet(VIEW_CODE_KEY, code);
    viewerStop();
    viewId = genCode();
    placeholder.style.display = 'flex'; placeholder.textContent = 'กำลังเชื่อมต่อกล้อง...';
    setViewStatus('กำลังเชื่อมต่อ...');
    viewChan = sbClient.channel('cctv-live-' + code, { config: { broadcast: { self: false } } });
    viewChan.on('broadcast', { event: 'sig' }, ({ payload }) => onViewerSignal(payload));
    viewChan.subscribe(status => {
      if (status !== 'SUBSCRIBED') return;
      const sendJoin = () => {
        if (viewPc && viewPc.connectionState === 'connected') return;
        viewChan && viewChan.send({ type: 'broadcast', event: 'sig', payload: { type: 'join', id: viewId } });
      };
      sendJoin();
      clearInterval(viewTimer);
      viewTimer = setInterval(() => {
        if (viewPc && viewPc.connectionState === 'connected') return;
        setViewStatus('ยังไม่พบกล้อง — ตรวจว่าเครื่องที่เสียบกล้องเปิดกล้องอยู่ และรหัสถูกต้อง');
        sendJoin();
      }, 6000);
    });
  }
  async function onViewerSignal(m) {
    if (!m || m.to !== viewId) return;
    try {
      if (m.type === 'offer') {
        if (viewPc) { try { viewPc.close(); } catch (e) {} }
        viewQ = [];
        const pc = viewPc = new RTCPeerConnection(RTC_CFG);
        pc.ondatachannel = e => { viewDc = e.channel; viewDc.binaryType = 'arraybuffer'; viewDc.onmessage = ev => onViewerDcMsg(ev.data); };
        pc.ontrack = e => {
          remoteVideo.srcObject = e.streams[0] || new MediaStream([e.track]);
          remoteVideo.play().catch(() => {});
          placeholder.style.display = 'none';
        };
        pc.onicecandidate = e => { if (e.candidate && viewChan) viewChan.send({ type: 'broadcast', event: 'sig', payload: { type: 'ice', to: 'host', from: viewId, cand: e.candidate.toJSON() } }); };
        pc.onconnectionstatechange = () => {
          if (pc !== viewPc) return;
          if (pc.connectionState === 'connected') setViewStatus('กำลังดูกล้องสด');
          else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            setViewStatus('การเชื่อมต่อหลุด กำลังลองใหม่...');
            placeholder.style.display = 'flex'; placeholder.textContent = 'การเชื่อมต่อหลุด กำลังลองใหม่...';
          }
        };
        await pc.setRemoteDescription(m.sdp);
        for (const c of viewQ) await pc.addIceCandidate(c).catch(() => {});
        viewQ = [];
        await pc.setLocalDescription(await pc.createAnswer());
        viewChan.send({ type: 'broadcast', event: 'sig', payload: { type: 'answer', to: 'host', from: viewId, sdp: pc.localDescription } });
      } else if (m.type === 'ice' && viewPc) {
        if (viewPc.remoteDescription) await viewPc.addIceCandidate(m.cand).catch(() => {});
        else viewQ.push(m.cand);
      }
    } catch (e) { setViewStatus('เชื่อมต่อไม่สำเร็จ: ' + e.message); }
  }
  $('cctvViewConnect').addEventListener('click', viewerConnect);
  viewCodeEl.addEventListener('keydown', e => { if (e.key === 'Enter') viewerConnect(); });
  $('cctvViewFull').addEventListener('click', () => {
    const el = $('cctvMonitor');
    (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
  });

  // ---- สลับบทบาทของเครื่องนี้ ----
  function applyRole(r, fromUser) {
    role = r; lsSet(ROLE_KEY, r);
    liveView.dataset.role = r;
    rotation = rotationForRole(r); layoutForRotation(); syncRotSelects();
    roleHostBtn.classList.toggle('active', r === 'host');
    roleViewBtn.classList.toggle('active', r === 'viewer');
    if (r === 'viewer') {
      showTab('live');
      if (stream) { stopEverything(); lsSet(ACTIVE_KEY, 'true'); }   // ปิดกล้องเครื่องนี้ แต่จำไว้ว่ากลับไปโหมดกล้องแล้วเปิดใหม่ได้
      placeholder.style.display = 'flex'; placeholder.textContent = 'ใส่รหัสดูกล้องแล้วกด "เชื่อมต่อ"';
      viewCodeEl.value = lsGet(VIEW_CODE_KEY) || '';
      if (fromUser && viewCodeEl.value) viewerConnect();
    } else {
      viewerStop();
      setViewStatus('ยังไม่ได้เชื่อมต่อ');
      if (fromUser && !stream) { placeholder.textContent = 'กำลังเปิดกล้อง...'; autoStart(); }
    }
  }
  roleHostBtn.addEventListener('click', () => { if (role !== 'host') applyRole('host', true); });
  roleViewBtn.addEventListener('click', () => { if (role !== 'viewer') applyRole('viewer', true); });
  applyRole(role, false);

  window.cctvOnPageShow = function () {
    if (started) return;
    started = true;
    if (role === 'viewer') { if (viewCodeEl.value) viewerConnect(); }
    else autoStart();
  };
})();
