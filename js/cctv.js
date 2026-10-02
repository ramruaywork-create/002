// ==========================================================
//  กล้อง CCTV (ฝั่งดู): โปรแกรม RRQC Camera บนคอมเครื่องหลักเป็นคนเปิดกล้อง/บันทึกคลิป
//  หน้านี้ดึงภาพสดและคลิปย้อนหลังจากโปรแกรมผ่าน HTTP ใน LAN (ทุกคำขอต้องมีรหัสดูกล้อง ?k=)
// ==========================================================
(() => {
  const $ = id => document.getElementById(id);
  const img = $('cctvLiveImg');
  if (!img) return;
  const notify = msg => (typeof showAppAlert === 'function' ? showAppAlert(msg) : alert(msg));
  const pad = n => n.toString().padStart(2, '0');
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const ADDR_KEY = 'cctv-addr', CODE_KEY = 'cctv-code';

  const addrEl = $('cctvAddr'), codeEl = $('cctvCode'), connStatus = $('cctvConnStatus');
  const placeholder = $('cctvPlaceholder'), hudText = $('cctvHudText'), hud = $('cctvHud'), rotEl = $('cctvRot');
  let base = '', code = '', statusTimer = null, imgTimer = null, connected = false, rotBusy = false;

  addrEl.value = lsGet(ADDR_KEY) || ((location.hostname || 'localhost') + ':8787');
  codeEl.value = lsGet(CODE_KEY) || '';

  function normalizeAddr(a) {
    a = a.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!a) return '';
    if (!/:\d+$/.test(a)) a += ':8787';
    return 'http://' + a;
  }
  const url = (path, extra) => `${base}${path}?k=${encodeURIComponent(code)}${extra || ''}`;
  const setConn = (text, ok) => { connStatus.textContent = text; hudText.textContent = ok ? 'ดูสดจากกล้อง' : 'ไม่ได้เชื่อมต่อ'; hud.classList.toggle('recording', false); };

  async function pollStatus() {
    try {
      const r = await fetch(url('/api/status'), { cache: 'no-store' });
      if (r.status === 401) { connected = false; setConn('รหัสไม่ถูกต้อง', false); showPlaceholder('รหัสไม่ถูกต้อง'); return; }
      if (r.status === 429) { setConn('ใส่รหัสผิดบ่อยเกินไป รอสักครู่แล้วลองใหม่', false); return; }
      const st = await r.json();
      const wasConnected = connected;
      connected = true;
      const stateTh = { armed: 'เฝ้าระวัง', recording: 'กำลังบันทึก', starting: 'กำลังเปิดกล้อง', recovering: 'กล้องค้าง กำลังกู้คืน', stopped: 'กล้องปิดอยู่' }[st.state] || st.state;
      setConn(`กำลังดูกล้องสด (${st.width && st.height ? st.width + 'x' + st.height + ' @ ' + st.fps + ' fps · ' : ''}${stateTh})`, true);
      hudText.textContent = stateTh;
      hud.classList.toggle('recording', st.state === 'recording');
      if (!rotBusy) rotEl.value = String(st.rot || 0);
      if (!wasConnected) startImage();
    } catch (e) {
      connected = false;
      const https = location.protocol === 'https:';
      setConn(https ? 'หน้านี้เปิดแบบ https:// จึงเรียกโปรแกรมกล้องใน LAN ไม่ได้ ให้เปิดเว็บแบบ http://' : 'ติดต่อโปรแกรมกล้องไม่ได้ — ตรวจว่าโปรแกรมเปิดอยู่ อยู่ Wi-Fi เดียวกัน และ Firewall อนุญาต', false);
      showPlaceholder('ติดต่อโปรแกรมกล้องไม่ได้ กำลังลองใหม่...');
    }
  }

  function showPlaceholder(t) { placeholder.textContent = t; placeholder.style.display = 'flex'; }

  function startImage() {
    clearTimeout(imgTimer);
    placeholder.style.display = 'none';
    img.src = url('/live', '&t=' + Date.now());
  }
  img.addEventListener('error', () => {
    if (!base) return;
    showPlaceholder('ภาพขาดช่วง กำลังต่อใหม่...');
    clearTimeout(imgTimer);
    imgTimer = setTimeout(() => { if (connected) startImage(); }, 3000);
  });
  img.addEventListener('load', () => { placeholder.style.display = 'none'; });

  function connect() {
    base = normalizeAddr(addrEl.value);
    code = codeEl.value.trim().toLowerCase();
    if (!base) { notify('กรุณาใส่ที่อยู่เครื่องหลัก'); return; }
    if (!/^[a-z2-9]{8}$/.test(code)) { notify('รหัสดูกล้องต้องเป็นตัวอักษร/ตัวเลข 8 ตัว'); return; }
    lsSet(ADDR_KEY, addrEl.value.trim()); lsSet(CODE_KEY, code);
    connected = false; img.removeAttribute('src');
    showPlaceholder('กำลังเชื่อมต่อ...'); connStatus.textContent = 'กำลังเชื่อมต่อ...';
    clearInterval(statusTimer);
    pollStatus(); statusTimer = setInterval(pollStatus, 3000);
  }
  $('cctvConnect').addEventListener('click', connect);
  codeEl.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
  $('cctvFull').addEventListener('click', () => { const el = $('cctvMonitor'); (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el); });

  rotEl.addEventListener('change', async () => {
    if (!base) { notify('ยังไม่ได้เชื่อมต่อกับโปรแกรมกล้อง'); return; }
    rotBusy = true;
    try {
      const r = await fetch(url('/api/rot', '&v=' + rotEl.value), { method: 'POST' });
      if (!r.ok) notify('สั่งหมุนภาพไม่สำเร็จ (' + r.status + ')');
    } catch (e) { notify('สั่งหมุนภาพไม่สำเร็จ: ติดต่อโปรแกรมกล้องไม่ได้'); }
    setTimeout(() => { rotBusy = false; }, 6000);
  });

  // ================= ดูย้อนหลัง =================
  const pbDate = $('cctvPbDate'), pbFrom = $('cctvPbFrom'), pbTo = $('cctvPbTo');
  const pbLoad = $('cctvPbLoad'), pbInfo = $('cctvPbInfo'), pbVideo = $('cctvPbVideo'), pbNow = $('cctvPbNow');
  const tl = $('cctvTl'), tlHead = $('cctvTlHead'), tlTicks = $('cctvTlTicks'), pbList = $('cctvPbList');
  let pbClips = [], pbIndex = -1, pbWinStart = 0, pbWinEnd = 0;

  const d0 = new Date();
  pbDate.value = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}`;
  const hhmmss = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const clipUrl = (c, extra) => `${base}/clips/${encodeURIComponent(c.name)}?k=${encodeURIComponent(code)}${extra || ''}`;

  function windowRange() {
    const [y, mo, da] = pbDate.value.split('-').map(Number);
    const [fh, fm] = (pbFrom.value || '00:00').split(':').map(Number);
    const [th, tm] = (pbTo.value || '23:59').split(':').map(Number);
    return [new Date(y, mo - 1, da, fh, fm, 0).getTime(), new Date(y, mo - 1, da, th, tm, 59).getTime()];
  }

  async function loadPlayback() {
    if (!base) { notify('ต้องเชื่อมต่อกับโปรแกรมกล้องก่อน (ใส่ที่อยู่และรหัสแล้วกด "เชื่อมต่อ")'); return; }
    if (!pbDate.value) { notify('กรุณาเลือกวันที่'); return; }
    const [ws, we] = windowRange();
    if (we <= ws) { notify('เวลา "ถึง" ต้องมากกว่า "ตั้งแต่"'); return; }
    pbWinStart = ws; pbWinEnd = we;
    pbInfo.textContent = 'กำลังขอรายการคลิปจากโปรแกรมกล้อง...';
    try {
      const r = await fetch(url('/api/clips', `&from=${ws}&to=${we}`), { cache: 'no-store' });
      if (r.status === 401) { pbInfo.textContent = 'รหัสไม่ถูกต้อง'; return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      pbClips = (await r.json()).clips;
    } catch (e) { pbInfo.textContent = 'ขอรายการคลิปไม่สำเร็จ: ติดต่อโปรแกรมกล้องไม่ได้'; return; }
    pbIndex = -1;
    pbInfo.textContent = pbClips.length ? `พบ ${pbClips.length} คลิป · คลิกที่ไทม์ไลน์หรือรายการเพื่อดู` : 'ไม่พบคลิปในช่วงเวลานี้';
    renderTimeline();
    if (pbClips.length) playClip(0);
  }

  function renderTimeline() {
    tl.querySelectorAll('.cctv-tl-seg').forEach(n => n.remove());
    const span = pbWinEnd - pbWinStart;
    pbClips.forEach((c, i) => {
      const seg = document.createElement('div');
      seg.className = 'cctv-tl-seg';
      const l = Math.max(0, (c.start - pbWinStart) / span) * 100, r = Math.min(1, (c.end - pbWinStart) / span) * 100;
      seg.style.left = l + '%'; seg.style.width = Math.max(0.25, r - l) + '%';
      seg.title = `${hhmmss(c.start)} - ${hhmmss(c.end)}`; seg.dataset.i = i;
      tl.appendChild(seg);
    });
    tlTicks.innerHTML = '';
    for (let i = 0; i <= 8; i++) {
      const t = document.createElement('span');
      t.style.left = (i / 8 * 100) + '%'; t.textContent = hhmmss(pbWinStart + span * i / 8).slice(0, 5);
      tlTicks.appendChild(t);
    }
    pbList.innerHTML = '';
    pbClips.forEach((c, i) => {
      const li = document.createElement('li'); li.dataset.i = i;
      const a = document.createElement('span'); a.textContent = `${hhmmss(c.start)} – ${hhmmss(c.end)}`;
      const b = document.createElement('span'); b.className = 'cctv-badge'; b.textContent = `${(c.size / 1024 / 1024).toFixed(2)} MB `;
      const dl = document.createElement('button'); dl.type = 'button'; dl.className = 'cctv-mini'; dl.dataset.dl = i; dl.textContent = '⬇'; dl.title = 'ดาวน์โหลดคลิปนี้';
      b.appendChild(dl); li.appendChild(a); li.appendChild(b); pbList.appendChild(li);
    });
    $('cctvPbDownload').disabled = !pbClips.length; $('cctvPbDownloadAll').disabled = !pbClips.length;
    updateHead(pbWinStart);
  }

  function updateHead(ms) {
    const span = pbWinEnd - pbWinStart; if (!span) return;
    const p = (ms - pbWinStart) / span;
    tlHead.hidden = p < 0 || p > 1; tlHead.style.left = (p * 100) + '%';
  }

  function playClip(i, offsetMs) {
    if (i < 0 || i >= pbClips.length) return;
    pbIndex = i;
    const c = pbClips[i];
    pbVideo.src = clipUrl(c);
    pbVideo.onloadedmetadata = () => { if (offsetMs > 0) { try { pbVideo.currentTime = offsetMs / 1000; } catch (e) {} } };
    pbVideo.play().catch(() => {});
    tl.querySelectorAll('.cctv-tl-seg').forEach(s => s.classList.toggle('active', +s.dataset.i === i));
    pbList.querySelectorAll('li').forEach(li => li.classList.toggle('active', +li.dataset.i === i));
    pbNow.textContent = hhmmss(c.start); updateHead(c.start);
    $('cctvPbPrev').disabled = i <= 0; $('cctvPbNext').disabled = i >= pbClips.length - 1;
  }

  pbVideo.addEventListener('timeupdate', () => {
    if (pbIndex < 0) return;
    const ms = pbClips[pbIndex].start + pbVideo.currentTime * 1000;
    pbNow.textContent = hhmmss(ms); updateHead(ms);
  });
  pbVideo.addEventListener('ended', () => { if (pbIndex + 1 < pbClips.length) playClip(pbIndex + 1); });

  tl.addEventListener('click', e => {
    if (!pbClips.length) return;
    const r = tl.getBoundingClientRect();
    const t = pbWinStart + (e.clientX - r.left) / r.width * (pbWinEnd - pbWinStart);
    let i = pbClips.findIndex(c => t >= c.start && t <= c.end);
    if (i >= 0) return playClip(i, t - pbClips[i].start);
    i = pbClips.findIndex(c => c.start > t);
    playClip(i >= 0 ? i : pbClips.length - 1);
  });

  function downloadClip(i) {
    const c = pbClips[i]; if (!c) return;
    const a = document.createElement('a'); a.href = clipUrl(c, '&dl=1'); a.download = c.name;
    document.body.appendChild(a); a.click(); a.remove();
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
    for (let i = 0; i < pbClips.length; i++) { downloadClip(i); await new Promise(r => setTimeout(r, 600)); }
  });
  pbLoad.addEventListener('click', loadPlayback);
  $('cctvPbPrev').addEventListener('click', () => playClip(pbIndex - 1));
  $('cctvPbNext').addEventListener('click', () => playClip(pbIndex + 1));

  document.querySelectorAll('[data-quick]').forEach(btn => btn.addEventListener('click', () => {
    const now = new Date(), q = btn.dataset.quick;
    const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const tstr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (q === 'hour') {
      const from = new Date(now.getTime() - 3600 * 1000);
      pbDate.value = dstr(now); pbFrom.value = dstr(from) !== dstr(now) ? '00:00' : tstr(from); pbTo.value = tstr(now);
    } else {
      const d = new Date(now); if (q === 'yesterday') d.setDate(d.getDate() - 1);
      pbDate.value = dstr(d); pbFrom.value = '00:00'; pbTo.value = '23:59';
    }
    loadPlayback();
  }));

  // ================= แท็บ =================
  const tabLive = $('cctvTabLive'), tabPb = $('cctvTabPb'), liveView = $('cctvLiveView'), pbView = $('cctvPbView');
  function showTab(name) {
    const pb = name === 'pb';
    liveView.hidden = pb; pbView.hidden = !pb;
    tabLive.classList.toggle('active', !pb); tabPb.classList.toggle('active', pb);
    if (pb) { img.removeAttribute('src'); clearInterval(statusTimer); if (connected && !pbClips.length) loadPlayback(); }
    else { pbVideo.pause(); if (base) { pollStatus(); statusTimer = setInterval(pollStatus, 3000); connected = false; } }
  }
  tabLive.addEventListener('click', () => showTab('live'));
  tabPb.addEventListener('click', () => showTab('pb'));

  let started = false;
  window.cctvOnPageShow = function () {
    if (started) return;
    started = true;
    if (codeEl.value) connect();
  };
})();
