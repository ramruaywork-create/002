// ==========================================================
//  ประวัติการยิงเครื่องสแกนเนอร์: จับทุกครั้งที่ยิง ไม่ว่าจะอยู่หน้าไหน หรือไม่ได้คลิกช่องกรอกไว้
//  เครื่องสแกนแบบ USB/ไร้สายทำงานเหมือนคีย์บอร์ดที่พิมพ์เร็วมากแล้วจบด้วย Enter
//  จึงแยกออกจากคนพิมพ์ด้วยความเร็วการกดปุ่ม แล้วบันทึกลงตาราง scan_log บน Supabase
// ==========================================================
(() => {
  const MAX_GAP_MS = 80;      // ปุ่มห่างกันเกินนี้ = คนพิมพ์ ไม่ใช่เครื่องสแกน
  const MIN_LEN = 4;          // สั้นกว่านี้ไม่นับ
  const MAX_AVG_GAP_MS = 50;  // เครื่องสแกนเฉลี่ยเร็วกว่านี้มาก (ปกติ ~5-20ms)
  const IDLE_FLUSH_MS = 120;  // เครื่องสแกนที่ไม่ส่ง Enter ปิดท้าย ให้ถือว่าจบเมื่อเงียบไปเท่านี้
  const PENDING_KEY = 'scanLogPending';
  const ALLOWED_PREFIX = /^(th|spx)/i;

  let buf = '';
  let times = [];
  let idleTimer = null;

  function currentContext() {
    const page = document.querySelector('.page.active');
    const ae = document.activeElement;
    return { page: page ? page.id : null, inputId: ae && ae.id ? ae.id : null };
  }

  function detectKind(code) {
    try {
      const key = code.trim().toLowerCase();
      if (typeof db !== 'undefined' && (db.orders || []).some(o => String(o.trackingNo || '').trim().toLowerCase() === key)) return 'tracking';
      if (typeof findProductBySkuOrGtin === 'function' && findProductBySkuOrGtin(code)) return 'product';
    } catch (e) {}
    return 'unknown';
  }

  function loadPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch (e) { return []; }
  }
  function savePending(list) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch (e) {}
  }

  let sending = false;
  async function flushPending() {
    if (sending) return;
    const list = loadPending();
    if (!list.length) return;
    sending = true;
    let ok = false;
    try {
      const result = await apiPost('logScans', { rows: list });
      if (result && result.success) {
        ok = true;
        // ตัดเฉพาะที่ส่งไปแล้ว เผื่อมีสแกนใหม่เข้าคิวระหว่างรอ
        savePending(loadPending().slice(list.length));
        const pageEl = document.getElementById('pageScanLog');
        if (pageEl && pageEl.classList.contains('active')) loadScanLog();
      }
    } catch (e) {
      // ส่งไม่สำเร็จ (เช่น เน็ตหลุด) ปล่อยไว้ในคิว จะลองใหม่ครั้งต่อไป
    } finally {
      sending = false;
    }
    if (ok && loadPending().length) flushPending(); // มีรายการที่ยิงเข้ามาระหว่างส่ง ส่งต่อเลย
  }

  function commit() {
    clearTimeout(idleTimer);
    const code = buf;
    const stamps = times;
    buf = '';
    times = [];
    if (code.length < MIN_LEN || stamps.length < 2) return;
    if (!ALLOWED_PREFIX.test(code)) return; // เก็บเฉพาะเลขที่ขึ้นต้นด้วย TH หรือ SPX (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
    const avgGap = (stamps[stamps.length - 1] - stamps[0]) / (stamps.length - 1);
    if (avgGap > MAX_AVG_GAP_MS) return;

    const ctx = currentContext();
    const list = loadPending();
    list.push({ code, kind: detectKind(code), page: ctx.page, input_id: ctx.inputId, created_at: new Date().toISOString() });
    savePending(list);
    flushPending();
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const now = performance.now();

    if (e.key === 'Enter' || e.key === 'Tab') {
      if (buf) commit();
      return;
    }
    if (e.key.length !== 1) return; // ปุ่มพิเศษ (Shift, ลูกศร ฯลฯ) ข้าม

    if (buf && now - times[times.length - 1] > MAX_GAP_MS) { buf = ''; times = []; }
    buf += e.key;
    times.push(now);

    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (buf.length >= 8) commit(); else { buf = ''; times = []; } }, IDLE_FLUSH_MS);
  }, true);

  window.addEventListener('DOMContentLoaded', () => { setTimeout(flushPending, 1500); });
  window.addEventListener('online', flushPending);

  // ---------- หน้า "ประวัติการยิง" ----------
  const KIND_LABEL = {
    tracking: '<span class="badge badge-completed">Tracking</span>',
    product: '<span class="badge badge-replaced">สินค้า (SKU/GTIN)</span>',
    unknown: '<span class="badge badge-pending">ไม่พบในระบบ</span>'
  };
  const PAGE_LABEL = {
    pageScan: 'ตรวจสอบสินค้า (QC)', pageOrders: 'รายการออเดอร์', pageProducts: 'จัดการสินค้า',
    pageSubReplace: 'เปลี่ยนสินค้าทดแทน', pageSubDelete: 'ตัดสินค้าออกจากออเดอร์',
    pageUploadExcel: 'ทำ ฟวย', pageScanLog: 'ประวัติการยิง', pageCctv: 'กล้อง CCTV'
  };

  // page เป็น id หน้าในเว็บ หรือ "app:ชื่อโปรแกรม" ถ้ายิงตอนอยู่โปรแกรมอื่น (จากโปรแกรมเบื้องหลัง)
  function pageLabel(page) {
    if (!page) return '-';
    if (page.startsWith('app:')) return 'โปรแกรมอื่น (' + page.slice(4) + ')';
    return PAGE_LABEL[page] || page;
  }

  function todayBangkok() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  window.loadScanLog = async function () {
    const dateEl = document.getElementById('scanLogDate');
    const qEl = document.getElementById('scanLogSearch');
    const tbody = document.getElementById('tbScanLog');
    if (!dateEl || !tbody) return;
    if (!dateEl.value) dateEl.value = todayBangkok();

    const params = { q: qEl ? qEl.value.trim() : '', limit: 1000 };
    if (dateEl.value) {
      const from = new Date(dateEl.value + 'T00:00:00+07:00');
      params.fromISO = from.toISOString();
      params.toISO = new Date(from.getTime() + 24 * 3600 * 1000).toISOString();
    }

    const result = await apiGet('getScanLog', params);
    // ประเภทประเมินใหม่จากข้อมูลออเดอร์ล่าสุดทุกครั้ง (โปรแกรมเบื้องหลังไม่รู้จักออเดอร์ จึงบันทึกเป็น "scanned")
    const allRows = (result.rows || []).map(r => ({ ...r, kind: detectKind(r.code), machine: r.machine || (r.page && r.page.startsWith('app:') ? 'ไม่ระบุชื่อ (โปรแกรมรุ่นเก่า)' : null) }));

    // ตัวกรองชื่อเครื่อง: รวบรวมชื่อเครื่องที่พบในวันนั้น (แถวที่ไม่มีชื่อ = ยิงในหน้าเว็บ)
    const machSel = document.getElementById('scanLogMachine');
    const WEB = '__web__';
    if (machSel) {
      const names = [...new Set(allRows.filter(r => r.machine).map(r => r.machine))].sort();
      const hasWeb = allRows.some(r => !r.machine);
      const wanted = ['', ...names, ...(hasWeb ? [WEB] : [])];
      const have = [...machSel.options].map(o => o.value);
      if (wanted.join('|') !== have.join('|')) {
        const keep = machSel.value;
        machSel.innerHTML = '<option value="">🖥️ ทุกเครื่อง</option>' +
          names.map(n => `<option value="${escapeHtml(n)}">🖥️ ${escapeHtml(n)}</option>`).join('') +
          (hasWeb ? `<option value="${WEB}">🌐 เว็บเบราว์เซอร์</option>` : '');
        machSel.value = wanted.includes(keep) ? keep : '';
      }
    }
    const machFilter = machSel ? machSel.value : '';
    const rows = machFilter ? allRows.filter(r => machFilter === WEB ? !r.machine : r.machine === machFilter) : allRows;
    const count = k => rows.filter(r => r.kind === k).length;
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('scanLogTotal', rows.length);
    setText('scanLogTracking', count('tracking'));
    setText('scanLogProduct', count('product'));
    setText('scanLogUnknown', count('unknown'));

    if (!result.success) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:20px; color:#c41f42;">โหลดไม่สำเร็จ: ${escapeHtml(result.message || '')}</td></tr>`;
      return;
    }
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding:20px; color:#6c757d;">ยังไม่มีการยิงในวันที่เลือก</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td class="text-center" style="font-size:12px; color:#666;">${escapeHtml(r.time)}</td>
        <td><b>${escapeHtml(r.code)}</b></td>
        <td class="text-center">${KIND_LABEL[r.kind] || KIND_LABEL.unknown}</td>
        <td>${r.machine ? '🖥️ ' + escapeHtml(r.machine) : '<span style="color:#8898aa;">🌐 เว็บเบราว์เซอร์</span>'}</td>
        <td>${escapeHtml(pageLabel(r.page))}</td>
      </tr>`).join('');
  };
})();
