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
  resolutionSelect.addEventListener('change', async () => {
    saveSettings();
    if (!stream) return;
    try {
      // ปิดกระแสเดิมแล้วเปิดใหม่ (การสลับความละเอียดสดๆ ทำให้ภาพเสียเป็นบล็อกเขียวในกล้อง USB บางรุ่น)
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
      await new Promise(r => setTimeout(r, 400));
      stream = await navigator.mediaDevices.getUserMedia({ video: getVideoConstraints(), audio: false });
      video.srcObject = stream;
      await video.play();
      const w = video.videoWidth || 640, h = video.videoHeight || 480;
      overlay.width = w; overlay.height = h; recordCanvas.width = w; recordCanvas.height = h;
      $('cctvMonitor').style.aspectRatio = w + ' / ' + h;
      statusText.textContent = 'เปิดกล้องแล้ว — เปลี่ยนความละเอียดเรียบร้อย';
    } catch (err) { notify('เปลี่ยนความละเอียดไม่สำเร็จ: ' + err.message); }
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

  function getVideoConstraints() {
    const [width, height] = resolutionSelect.value.split('x').map(Number);
    const deviceId = camSelect.value && camSelect.options.length > 1 ? { exact: camSelect.value } : undefined;
    const frameRate = { ideal: 30, max: 30 };   // ล็อก 30 fps กันภาพกระพริบตอนความละเอียดสูง
    if (!width || !height) return deviceId ? { deviceId, frameRate } : { frameRate };
    return deviceId ? { deviceId, width: { ideal: width }, height: { ideal: height }, frameRate } : { width: { ideal: width }, height: { ideal: height }, frameRate };
  }

  async function startCamera() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('เบราว์เซอร์นี้ไม่รองรับกล้อง (ต้องเปิดผ่าน https หรือ localhost)');
      stream = await navigator.mediaDevices.getUserMedia({ video: getVideoConstraints(), audio: false });
      video.srcObject = stream;
      await video.play();
      placeholder.style.display = 'none';
      const w = video.videoWidth || 640, h = video.videoHeight || 480;
      overlay.width = w; overlay.height = h; recordCanvas.width = w; recordCanvas.height = h;
      $('cctvMonitor').style.aspectRatio = w + ' / ' + h;   // กรอบภาพตามสัดส่วนกล้องจริง (16:9 ไม่โดนตัด)
      await listCameras();
      btnStart.disabled = true; btnStop.disabled = false;
      statusText.textContent = 'เปิดกล้องแล้ว — กรุณาเลือกโฟลเดอร์บันทึก';
      setHud('idle');
      startClock();
      video.style.display = 'block';
      startRenderLoop();
      renderStream = recordCanvas.captureStream(30);
      try { localStorage.setItem(ACTIVE_KEY, 'true'); } catch (e) {}
    } catch (err) {
      placeholder.textContent = 'เปิดกล้องไม่สำเร็จ — กดปุ่ม "เปิดกล้อง" เพื่อลองใหม่';
      statusText.textContent = 'ปิดอยู่';
      notify('เปิดกล้องไม่สำเร็จ: ' + err.message + '\nกรุณาอนุญาตการเข้าถึงกล้องในเบราว์เซอร์');
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
      rctx.drawImage(video, 0, 0, w, h);
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

  async function loadPlayback() {
    if (!pbDate.value) { notify('กรุณาเลือกวันที่'); return; }
    const dir = await getPlaybackDir();
    if (!dir) return;
    [pbWinStart, pbWinEnd] = windowRange();
    if (pbWinEnd <= pbWinStart) { notify('เวลา "ถึง" ต้องมากกว่า "ตั้งแต่"'); return; }
    pbInfo.textContent = 'กำลังอ่านโฟลเดอร์...';
    const clips = [];
    try {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'file') continue;
        const start = parseName(name);
        if (start === null) continue;
        const file = await handle.getFile();
        const end = Math.max(file.lastModified, start + 1000);
        if (end < pbWinStart || start > pbWinEnd) continue;
        clips.push({ name, handle, start, end, size: file.size });
      }
    } catch (e) { pbInfo.textContent = 'อ่านโฟลเดอร์ไม่สำเร็จ: ' + e.message; return; }
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
    if (pb && !pbAutoLoaded && (dirHandle || pbDir)) { pbAutoLoaded = true; loadPlayback(); }
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

  window.cctvOnPageShow = function () {
    if (started) return;
    started = true;
    autoStart();
  };
})();
