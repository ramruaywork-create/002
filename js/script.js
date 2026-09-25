// ==========================================================
//  Backend: Supabase (เดิมใช้ Google Apps Script Web App)
//  apiGet/apiPost ด้านล่างนี้คงชื่อ/รูปแบบเดิมไว้ทั้งหมด แต่ภายในเปลี่ยนไปเรียก
//  sbApiGet/sbApiPost (ใน supabase-api.js) แทนการ fetch ไป Apps Script
//  เพื่อให้โค้ดส่วนที่เหลือทั้งไฟล์ไม่ต้องแก้ไขอะไรเลย
// ==========================================================
function showAppDialog(message, requireConfirmation) {
    const dialog = document.getElementById('appDialog');
    const messageBox = document.getElementById('appDialogMessage');
    const cancelButton = document.getElementById('appDialogCancel');
    const okButton = document.getElementById('appDialogOk');
    if (!dialog || !messageBox || !okButton) return Promise.resolve(true);

    messageBox.textContent = message;
    cancelButton.style.display = requireConfirmation ? 'inline-block' : 'none';
    dialog.classList.add('show');

    return new Promise(resolve => {
        const close = result => {
            dialog.classList.remove('show');
            okButton.removeEventListener('click', onOk);
            cancelButton.removeEventListener('click', onCancel);
            resolve(result);
        };
        const onOk = () => close(true);
        const onCancel = () => close(false);
        okButton.addEventListener('click', onOk);
        cancelButton.addEventListener('click', onCancel);
        okButton.focus();
    });
}

function showAppAlert(message) { return showAppDialog(message, false); }
function showAppConfirm(message) { return showAppDialog(message, true); }

async function apiGet(action, params) {
    return await sbApiGet(action, params);
}

async function apiPost(action, payload) {
    return await sbApiPost(action, payload);
}

// ==========================================================
//  Helper: เวลาปัจจุบัน (โซนไทย) รูปแบบ yyyy-MM-dd HH:mm:ss
// ==========================================================
function nowBangkokString() {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(d);
    const map = {};
    parts.forEach(p => map[p.type] = p.value);
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function todayBangkokISO(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d);
    const map = {};
    parts.forEach(p => map[p.type] = p.value);
    return `${map.year}-${map.month}-${map.day}`;
}

// แปลงวันที่แบบไทย (เช่น "02 ก.ย. 2026 19:22") หรือ Date ให้เป็น yyyy-MM-dd
const THAI_MONTHS = {
    'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
    'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12
};
const MONTH_RE = new RegExp(
    '^(\\d{1,2})\\s+(' +
    Object.keys(THAI_MONTHS).map(k => k.replace(/\./g, '\\.')).join('|') +
    ')\\s+(\\d{4})(?:\\s+(\\d{1,2}):(\\d{2}))?'
);

function toISODate(v) {
    let d;
    if (v instanceof Date) {
        d = v;
    } else {
        const s = String(v || '').trim();
        if (!s) return null;
        const m = s.match(MONTH_RE);
        if (m) {
            const day = parseInt(m[1], 10);
            const month = THAI_MONTHS[m[2]];
            const year = parseInt(m[3], 10);
            const hour = m[4] ? parseInt(m[4], 10) : 0;
            const minute = m[5] ? parseInt(m[5], 10) : 0;
            d = new Date(year, month - 1, day, hour, minute);
        } else {
            d = new Date(s);
        }
    }
    if (!d || isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
}

function shortLogistic(m) {
    const s = String(m || '').trim();
    const match = s.match(/-TH-(.+)$/i);
    return match ? match[1].trim() : s;
}

function containsCI(str, sub) {
    return String(str || '').toLowerCase().indexOf(String(sub).toLowerCase()) !== -1;
}

function containsTH(str, sub) {
    return String(str || '').indexOf(sub) !== -1;
}

// ==========================================================
//  State
// ==========================================================
let productsMap = {};
let db = { products: [], orders: [], replacements: [], cuts: [] };
let currentPage = { products: 1, orders: 1, substitutes: 1, cuts: 1 };
let rowsPerPage = { products: 10, orders: 10, substitutes: 10, cuts: 10 };
let pendingExcelData = null;
let fuayData = [];
let currentFuayTabIndex = 0;
let pendingProductImportData = null;   // { headers, rows } อ่านมาจากไฟล์ดิบ
let pendingProductImportMapped = [];   // แถวที่ map แล้ว + สถานะ (ใหม่/ซ้ำในระบบ/ซ้ำในไฟล์/ไม่มี SKU)

let currentQC = { trackingNo: '', items: [] };

document.addEventListener('DOMContentLoaded', function () {
    loadData();
    setupOldSkuDropdown();
    setupScanAutoSelect();
    loadFuayData();
    initQCVolumeSlider();

    const excelInput = document.getElementById('excelFileInput');
    if (excelInput) excelInput.addEventListener('change', previewExcelFile);

    const prodExcelInput = document.getElementById('prodExcelFileInput');
    if (prodExcelInput) prodExcelInput.addEventListener('change', previewProductExcelFile);

    initScanButtons();

    const qcQuickPassCb = document.getElementById('qcQuickPassCheck');
    if (qcQuickPassCb) qcQuickPassCb.checked = localStorage.getItem('qcQuickPass') === '1';

    // เปิดด้วยลิงก์ ...index.html#cctv จะข้ามไปหน้ากล้องเลย (ใช้กับเครื่องเปิดทิ้งไว้เฝ้ากล้อง)
    if (location.hash === '#cctv') switchPage('pageCctv', 'btnTabCctv');
});

// ==========================================================
//  ปุ่มสแกน QR Code / บาร์โค้ด ด้วยกล้องมือถือ
//  ติดปุ่ม 📷 ให้ทุกช่องที่มี class="scannable-input" อัตโนมัติ
// ==========================================================
function initScanButtons() {
    document.querySelectorAll('.scannable-input').forEach(function (input) {
        if (input.dataset.scanWrapped) return;
        input.dataset.scanWrapped = '1';

        // ถ้ามีปุ่ม 📷 (.scan-cam-btn) ติดอยู่กับช่องนี้ใน HTML อยู่แล้ว ไม่ต้องสร้างปุ่มซ้ำ
        if (input.parentNode && input.parentNode.querySelector('.scan-cam-btn')) return;

        const wrap = document.createElement('div');
        wrap.className = 'scan-input-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'camera-scan-btn';
        btn.title = 'สแกนด้วยกล้อง';
        btn.setAttribute('aria-label', 'สแกนด้วยกล้อง');
        btn.innerHTML = '📷';
        btn.onclick = function () { openCameraScanner(input.id); };
        wrap.appendChild(btn);
    });
}

let html5QrCodeScanner = null;
let cameraScanTargetId = null;

function openCameraScanner(targetInputId) {
    if (typeof Html5Qrcode === 'undefined') {
        showAppAlert('ไม่สามารถโหลดตัวอ่านกล้องได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่');
        return;
    }
    cameraScanTargetId = targetInputId;
    const modal = document.getElementById('cameraScanModal');
    if (modal) modal.classList.add('show');

    html5QrCodeScanner = new Html5Qrcode('cameraScanReader');
    const config = { fps: 10, qrbox: { width: 240, height: 160 } };
    html5QrCodeScanner.start({ facingMode: 'environment' }, config, onCameraScanSuccess, function () {})
        .catch(function () {
            showAppAlert('เปิดกล้องไม่สำเร็จ กรุณาอนุญาตให้เว็บไซต์ใช้กล้องแล้วลองใหม่อีกครั้ง');
            closeCameraScanner();
        });
}

function onCameraScanSuccess(decodedText) {
    const input = document.getElementById(cameraScanTargetId);
    if (input) {
        input.value = String(decodedText || '').trim();
        input.dispatchEvent(new Event('input', { bubbles: true }));

        if (input.dataset.scanEnter === '1') {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        }
        if (input.dataset.scanCall && typeof window[input.dataset.scanCall] === 'function') {
            window[input.dataset.scanCall]();
        }
        input.focus();
    }
    closeCameraScanner();
}

function closeCameraScanner() {
    const modal = document.getElementById('cameraScanModal');
    if (modal) modal.classList.remove('show');
    if (html5QrCodeScanner) {
        const scannerToStop = html5QrCodeScanner;
        html5QrCodeScanner = null;
        scannerToStop.stop().then(function () { scannerToStop.clear(); }).catch(function () {});
    }
    cameraScanTargetId = null;
}

// ==========================================================
//  โหลดข้อมูลหลัก (products, orders, substitutes, cuts)
//  จาก Google Sheet ผ่าน Apps Script (action=getAllData)
// ==========================================================
async function loadData() {
    try {
        const result = await apiGet('getAllData');
        if (result.error) throw new Error(result.error);

        db = {
            orders: result.orders || [],
            products: result.products || [],
            replacements: result.replacements || [],
            cuts: result.cuts || []
        };

        productsMap = {};
        db.products.forEach(p => { if (p.skuMerchant) productsMap[p.skuMerchant.trim()] = p.brand; });

        renderTables();
        setupNewSkuDatalist();
        hidePageLoader(true);
    } catch (err) {
        console.error("Error loading data:", err);
        showAppAlert("เกิดข้อผิดพลาดในการโหลดข้อมูล: " + err.message);
        hidePageLoader(false);
    }
}

// ซ่อนหลอดโหลดเต็มจอ แล้วโชว์ป้ายเล็กๆ มุมบนขวาสั้นๆ บอกว่าโหลดเสร็จ/พร้อมใช้งานแล้ว หรือโหลดพลาด
function hidePageLoader(success) {
    const loader = document.getElementById('pageLoader');
    if (loader) loader.classList.add('hide');

    const badge = document.getElementById('pageReadyBadge');
    if (!badge) return;
    badge.textContent = success ? '✅ โหลดข้อมูลเสร็จแล้ว พร้อมใช้งาน' : '❌ โหลดข้อมูลไม่สำเร็จ';
    badge.className = 'page-ready-badge show' + (success ? '' : ' error');
    setTimeout(() => { badge.classList.remove('show'); }, 3500);
}

function setupOldSkuDropdown() {
    const trackingInput = document.getElementById('subTracking');
    if (trackingInput) {
        trackingInput.addEventListener('input', function () {
            resetSubstituteRows();
        });
    }
    resetSubstituteRows();

    const delTrackingInput = document.getElementById('delTracking');
    if (delTrackingInput) {
        delTrackingInput.addEventListener('input', function () {
            resetDeleteRows();
        });
    }
    resetDeleteRows();

    setupNewSkuDatalist();
}

function setupScanAutoSelect() {
    const scanOrder = document.getElementById('scanOrder');
    const scanItem = document.getElementById('scanItem');
    const searchFuayInput = document.getElementById('searchFuayInput');
    if (scanOrder) scanOrder.addEventListener('focus', function () { this.select(); });
    if (scanItem) scanItem.addEventListener('focus', function () { this.select(); });
    if (searchFuayInput) searchFuayInput.addEventListener('focus', function () { this.select(); });
}

// ==========================================================
//  แถวรายการ "สินค้าทดแทน" เพิ่ม/ลบได้หลายแถวต่อ Tracking เดียว
//  แต่ละแถว = SKU เดิม (จากออเดอร์) + จำนวน + SKU ใหม่ 1 คู่
// ==========================================================
function getSubOldSkuOptionsForTracking(trackingNo) {
    if (!trackingNo) return [];
    const order = (db.orders || []).find(o =>
        String(o.trackingNo || '').trim().toLowerCase() === trackingNo.toLowerCase()
    );
    return (order && order.items) ? order.items : [];
}

// เติม/รีเฟรช dropdown "SKU เดิม" ของทุกแถว: ตัด SKU ที่แถวอื่นเลือกไปแล้วออก (กันเลือกซ้ำ)
// และปรับ max ของช่องจำนวนให้ตรงกับจำนวนที่เหลือในออเดอร์ของ SKU ที่เลือกไว้
function refreshSubRowOldSkuOptions() {
    const rows = Array.from(document.querySelectorAll('#subRowsContainer .sub-row'));
    if (rows.length === 0) return;

    const trackingInput = document.getElementById('subTracking');
    const items = getSubOldSkuOptionsForTracking(trackingInput ? trackingInput.value.trim() : '');

    rows.forEach(row => {
        const select = row.querySelector('.sub-row-old-sku');
        const currentVal = select.value;

        const usedByOtherRows = {};
        rows.forEach(otherRow => {
            if (otherRow === row) return;
            const v = otherRow.querySelector('.sub-row-old-sku').value;
            if (v) usedByOtherRows[v] = true;
        });

        const availableItems = items.filter(it => !usedByOtherRows[it.sku]);
        select.innerHTML = items.length === 0
            ? '<option value="" disabled>(ไม่พบ SKU ในออเดอร์นี้)</option>'
            : '<option value="">-- เลือก SKU เดิม --</option>' + availableItems.map(it =>
                `<option value="${it.sku}" data-qty="${it.qty}">${it.sku} (จำนวน ${it.qty})</option>`
            ).join('');

        if (currentVal && !usedByOtherRows[currentVal]) select.value = currentVal;

        const chosenItem = items.find(it => it.sku === select.value);
        const qtyInput = row.querySelector('.sub-row-qty');
        if (qtyInput) {
            if (chosenItem) {
                qtyInput.max = chosenItem.qty;
                if (Number(qtyInput.value) > chosenItem.qty) qtyInput.value = chosenItem.qty;
            } else {
                qtyInput.removeAttribute('max');
            }
        }
    });

    updateAddSubRowButtonState();
}

// ปิดปุ่ม "เพิ่มรายการ" เมื่อจำนวนแถวครบเท่าจำนวน SKU ที่มีในออเดอร์แล้ว (ไม่เหลือ SKU ให้เลือกเพิ่ม)
function updateAddSubRowButtonState() {
    const btn = document.getElementById('btnAddSubRow');
    if (!btn) return;
    const trackingInput = document.getElementById('subTracking');
    const trackingNo = trackingInput ? trackingInput.value.trim() : '';
    const items = getSubOldSkuOptionsForTracking(trackingNo);
    const rowCount = document.querySelectorAll('#subRowsContainer .sub-row').length;
    // ปิดปุ่ม: ยังไม่ได้กรอก Tracking, กรอกแล้วแต่ไม่พบ SKU ในออเดอร์, หรือเพิ่มแถวครบทุก SKU แล้ว
    btn.disabled = !trackingNo || items.length === 0 || rowCount >= items.length;
}

function addSubstituteRow() {
    const container = document.getElementById('subRowsContainer');
    if (!container) return;

    const trackingInput = document.getElementById('subTracking');
    const trackingNo = trackingInput ? trackingInput.value.trim() : '';
    const items = getSubOldSkuOptionsForTracking(trackingNo);
    const currentRowCount = container.querySelectorAll('.sub-row').length;

    // ไม่มี Tracking หรือไม่พบ SKU ในออเดอร์นี้: อนุญาตแค่แถวเดียว (placeholder ว่าง) เท่านั้น
    if ((!trackingNo || items.length === 0) && currentRowCount >= 1) return;
    // มี Tracking และพบ SKU: ห้ามเพิ่มแถวเกินจำนวน SKU ที่มีในออเดอร์
    if (items.length > 0 && currentRowCount >= items.length) return;

    const row = document.createElement('div');
    row.className = 'sub-row';
    row.innerHTML = `
        <select class="input-box sub-row-old-sku"></select>
        <input type="number" class="input-box sub-row-qty" value="1" min="1">
        <input type="text" class="input-box sub-row-new-sku scannable-input" list="listNewSku" placeholder="SKU หรือ GTIN ใหม่ที่จะใส่แทน" autocomplete="off">
        <button type="button" class="btn-remove-sub-row" onclick="removeSubstituteRow(this)" aria-label="ลบแถว" title="ลบแถว">✖</button>
    `;
    container.appendChild(row);

    const select = row.querySelector('.sub-row-old-sku');
    const qtyInput = row.querySelector('.sub-row-qty');

    select.addEventListener('change', function () {
        const opt = this.selectedOptions[0];
        if (opt && opt.dataset.qty) qtyInput.value = opt.dataset.qty;
        refreshSubRowOldSkuOptions();
    });
    qtyInput.addEventListener('input', function () {
        const max = Number(this.max);
        if (max && Number(this.value) > max) this.value = max;
        if (Number(this.value) < 1) this.value = 1;
    });

    refreshSubRowOldSkuOptions();
    initScanButtons();
}

function removeSubstituteRow(btn) {
    const row = btn.closest('.sub-row');
    if (row) row.remove();
    const container = document.getElementById('subRowsContainer');
    if (container && container.children.length === 0) { addSubstituteRow(); return; }
    refreshSubRowOldSkuOptions();
}

function resetSubstituteRows() {
    const container = document.getElementById('subRowsContainer');
    if (!container) return;
    container.innerHTML = '';
    addSubstituteRow();
}

// ==========================================================
//  แถวรายการ "ตัดสินค้าออกจากออเดอร์" เพิ่ม/ลบได้หลายแถวต่อ Tracking เดียว
//  แต่ละแถว = SKU + จำนวนที่จะตัดออก 1 คู่ (ไม่รวม SKU ที่ถูกตัดไปแล้วในระบบ)
// ==========================================================
function getAvailableDelSkuItems(trackingNo) {
    const items = getSubOldSkuOptionsForTracking(trackingNo);
    if (!trackingNo || items.length === 0) return items;

    const alreadyCut = {};
    (db.cuts || []).forEach(c => {
        if (String(c.trackingNo || '').trim().toLowerCase() === trackingNo.toLowerCase()) {
            alreadyCut[String(c.sku || '').trim().toLowerCase()] = true;
        }
    });
    return items.filter(it => !alreadyCut[String(it.sku).trim().toLowerCase()]);
}

function refreshDelRowSkuOptions() {
    const rows = Array.from(document.querySelectorAll('#delRowsContainer .sub-row'));
    if (rows.length === 0) return;

    const trackingInput = document.getElementById('delTracking');
    const trackingNo = trackingInput ? trackingInput.value.trim() : '';
    const items = getAvailableDelSkuItems(trackingNo);

    rows.forEach(row => {
        const select = row.querySelector('.del-row-sku');
        const currentVal = select.value;

        const usedByOtherRows = {};
        rows.forEach(otherRow => {
            if (otherRow === row) return;
            const v = otherRow.querySelector('.del-row-sku').value;
            if (v) usedByOtherRows[v] = true;
        });

        const availableItems = items.filter(it => !usedByOtherRows[it.sku]);
        select.innerHTML = items.length === 0
            ? '<option value="" disabled>(ไม่พบ SKU ที่ตัดได้ในออเดอร์นี้)</option>'
            : '<option value="">-- เลือก SKU --</option>' + availableItems.map(it =>
                `<option value="${it.sku}" data-qty="${it.qty}">${it.sku} (จำนวน ${it.qty})</option>`
            ).join('');

        if (currentVal && !usedByOtherRows[currentVal]) select.value = currentVal;

        const chosenItem = items.find(it => it.sku === select.value);
        const qtyInput = row.querySelector('.del-row-qty');
        if (qtyInput) {
            if (chosenItem) {
                qtyInput.max = chosenItem.qty;
                if (Number(qtyInput.value) > chosenItem.qty) qtyInput.value = chosenItem.qty;
            } else {
                qtyInput.removeAttribute('max');
            }
        }
    });

    updateAddDelRowButtonState();
}

function updateAddDelRowButtonState() {
    const btn = document.getElementById('btnAddDelRow');
    if (!btn) return;
    const trackingInput = document.getElementById('delTracking');
    const trackingNo = trackingInput ? trackingInput.value.trim() : '';
    const items = getAvailableDelSkuItems(trackingNo);
    const rowCount = document.querySelectorAll('#delRowsContainer .sub-row').length;
    btn.disabled = !trackingNo || items.length === 0 || rowCount >= items.length;
}

function addDeleteRow() {
    const container = document.getElementById('delRowsContainer');
    if (!container) return;

    const trackingInput = document.getElementById('delTracking');
    const trackingNo = trackingInput ? trackingInput.value.trim() : '';
    const items = getAvailableDelSkuItems(trackingNo);
    const currentRowCount = container.querySelectorAll('.sub-row').length;

    if ((!trackingNo || items.length === 0) && currentRowCount >= 1) return;
    if (items.length > 0 && currentRowCount >= items.length) return;

    const row = document.createElement('div');
    row.className = 'sub-row';
    row.innerHTML = `
        <select class="input-box del-row-sku"></select>
        <input type="number" class="input-box del-row-qty" value="1" min="1">
        <button type="button" class="btn-remove-sub-row" onclick="removeDeleteRow(this)" aria-label="ลบแถว" title="ลบแถว">✖</button>
    `;
    container.appendChild(row);

    const select = row.querySelector('.del-row-sku');
    const qtyInput = row.querySelector('.del-row-qty');

    select.addEventListener('change', function () {
        const opt = this.selectedOptions[0];
        if (opt && opt.dataset.qty) qtyInput.value = opt.dataset.qty;
        refreshDelRowSkuOptions();
    });
    qtyInput.addEventListener('input', function () {
        const max = Number(this.max);
        if (max && Number(this.value) > max) this.value = max;
        if (Number(this.value) < 1) this.value = 1;
    });

    refreshDelRowSkuOptions();
    initScanButtons();
}

function removeDeleteRow(btn) {
    const row = btn.closest('.sub-row');
    if (row) row.remove();
    const container = document.getElementById('delRowsContainer');
    if (container && container.children.length === 0) { addDeleteRow(); return; }
    refreshDelRowSkuOptions();
}

function resetDeleteRows() {
    const container = document.getElementById('delRowsContainer');
    if (!container) return;
    container.innerHTML = '';
    addDeleteRow();
}

function setupNewSkuDatalist() {
    const listEl = document.getElementById('listNewSku');
    if (!listEl) return;
    listEl.innerHTML = '';
    (db.products || []).forEach(p => {
        if (!p.skuMerchant) return;
        const opt = document.createElement('option');
        opt.value = p.skuMerchant;
        opt.label = p.brand ? `${p.skuMerchant} (${p.brand})` : p.skuMerchant;
        listEl.appendChild(opt);

        // เพิ่ม GTIN เป็นตัวเลือกแยกด้วย เพื่อให้พิมพ์/สแกนบาร์โค้ดแล้วขึ้นแนะนำอัตโนมัติได้
        if (p.gtin && String(p.gtin).trim() !== '') {
            const gtinOpt = document.createElement('option');
            gtinOpt.value = String(p.gtin).trim();
            gtinOpt.label = `${p.gtin} → ${p.skuMerchant}${p.brand ? ' (' + p.brand + ')' : ''}`;
            listEl.appendChild(gtinOpt);
        }
    });
}

function findProductBySkuOrGtin(code) {
    if (!code) return null;
    const val = String(code).trim().toLowerCase();
    return (db.products || []).find(p =>
        (p.skuMerchant && String(p.skuMerchant).trim().toLowerCase() === val) ||
        (p.gtin && String(p.gtin).trim().toLowerCase() === val)
    ) || null;
}

// ==========================================================
//  Pagination / Render (เหมือนเดิมทั้งหมด ไม่เปลี่ยนแปลง)
// ==========================================================
function paginateList(list, page, perPage) {
    const total = list.length;
    const totalPages = Math.ceil(total / perPage) || 1;
    const current = Math.min(Math.max(1, page), totalPages);
    const start = (current - 1) * perPage;
    const items = list.slice(start, start + perPage);
    return { items, totalPages, currentPage: current, totalItems: total };
}

function renderPaginationControls(containerId, key, paginated) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
        <div class="pagination-info">
            แสดงหน้า ${paginated.currentPage} จาก ${paginated.totalPages} (ทั้งหมด ${paginated.totalItems} รายการ)
            &nbsp;|&nbsp; แสดงต่อหน้า:
            <select onchange="changeRowsPerPage('${key}', this.value)" style="padding:2px 5px; margin-left:5px;">
                <option value="10" ${rowsPerPage[key] == 10 ? 'selected' : ''}>10</option>
                <option value="20" ${rowsPerPage[key] == 20 ? 'selected' : ''}>20</option>
                <option value="50" ${rowsPerPage[key] == 50 ? 'selected' : ''}>50</option>
            </select>
        </div>
        <div class="pagination-btns">
            <button class="page-btn" onclick="changePage('${key}', -1)" ${paginated.currentPage <= 1 ? 'disabled' : ''}>◄ ก่อนหน้า</button>
            <button class="page-btn" onclick="changePage('${key}', 1)" ${paginated.currentPage >= paginated.totalPages ? 'disabled' : ''}>ถัดไป ►</button>
        </div>
    `;
}

function changePage(key, dir) { currentPage[key] += dir; renderTables(); }
function changeRowsPerPage(key, val) { rowsPerPage[key] = parseInt(val); currentPage[key] = 1; renderTables(); }

let multiSearchList = [];

function openMultiSearchModal() {
    const modal = document.getElementById('multiSearchModal');
    const textarea = document.getElementById('multiSearchTextarea');
    if (textarea) textarea.value = multiSearchList.join('\n');
    updateMultiSearchCounter();
    if (modal) modal.classList.add('show');
    if (textarea) textarea.focus();
}

function closeMultiSearchModal() {
    const modal = document.getElementById('multiSearchModal');
    if (modal) modal.classList.remove('show');
}

function parseMultiSearchText(text) {
    return (text || '')
        .split(/[\n,\s]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

function updateMultiSearchCounter() {
    const textarea = document.getElementById('multiSearchTextarea');
    const counter = document.getElementById('multiSearchCounter');
    if (!textarea || !counter) return;
    const list = parseMultiSearchText(textarea.value);
    counter.innerText = `${list.length} รายการ`;
}

function applyMultiSearch() {
    const textarea = document.getElementById('multiSearchTextarea');
    multiSearchList = parseMultiSearchText(textarea ? textarea.value : '');

    const chip = document.getElementById('multiSearchChip');
    const searchInput = document.getElementById('searchOrderInput');

    if (multiSearchList.length > 0) {
        if (searchInput) { searchInput.value = ''; searchInput.disabled = true; searchInput.placeholder = 'กำลังกรองแบบหลายรายการ...'; }
        if (chip) {
            chip.style.display = 'inline-flex';
            chip.innerHTML = `กำลังกรอง ${multiSearchList.length} Tracking <button type="button" onclick="clearMultiSearch()" aria-label="ล้าง">✕</button>`;
        }
    } else {
        clearMultiSearch();
    }

    closeMultiSearchModal();
    currentPage.orders = 1;
    renderOrders();
}

function clearMultiSearch() {
    multiSearchList = [];
    const chip = document.getElementById('multiSearchChip');
    const searchInput = document.getElementById('searchOrderInput');
    if (chip) { chip.style.display = 'none'; chip.innerHTML = ''; }
    if (searchInput) { searchInput.disabled = false; searchInput.placeholder = '🔍 ค้นหา Tracking No. หรือ SKU สินค้า...'; }
    currentPage.orders = 1;
    renderOrders();
}

function renderOrders() {
    const input = document.getElementById('searchOrderInput');
    const f = input ? input.value.toLowerCase().trim() : '';
    const list = db.orders || [];

    const filtered = list.filter(o => {
        const tracking = String(o.trackingNo || '').toLowerCase();
        const items = String(o.itemsStr || '').toLowerCase();

        if (multiSearchList.length > 0) {
            return multiSearchList.some(term => tracking.includes(term.toLowerCase()));
        }
        return tracking.includes(f) || items.includes(f);
    });

    const paginated = paginateList(filtered, currentPage.orders, rowsPerPage.orders);
    const tbody = document.getElementById('tbOrders');
    if (!tbody) return;

    if (paginated.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:20px; color:#6c757d;">ไม่พบข้อมูลออเดอร์</td></tr>`;
        renderPaginationControls('pageOrdContainer', 'orders', paginated);
        return;
    }

    tbody.innerHTML = paginated.items.map(o => {
        const tracking = o.trackingNo || '-';
        const items = o.itemsStr || '-';
        const status = o.status || 'Pending';
        const qcTime = o.qcTime || '-';
        const isDone = status === 'Completed' || status === 'QC แล้ว' || status === 'สำเร็จ';

        return `
            <tr>
                <td><b>${tracking}</b></td>
                <td>${items}</td>
                <td class="text-center">
                    <span class="badge ${isDone ? 'badge-completed' : 'badge-pending'}">
                        ${isDone ? 'QC แล้ว' : 'รอ QC'}
                    </span>
                </td>
                <td class="text-center" style="font-size:12px; color:#666;">${qcTime}</td>
                <td class="text-center">
                    <button class="btn-revert" onclick="revertQC('${tracking}')">🔄 ยกเลิก</button>
                </td>
            </tr>
        `;
    }).join('');

    renderPaginationControls('pageOrdContainer', 'orders', paginated);
}

function renderProducts() {
    const input = document.getElementById('searchProdInput');
    const f = input ? input.value.toLowerCase().trim() : '';
    const list = db.products || [];

    const filtered = list.filter(p =>
        (p.brand && p.brand.toLowerCase().includes(f)) ||
        (p.skuMerchant && p.skuMerchant.toLowerCase().includes(f)) ||
        (p.gtin && p.gtin.toLowerCase().includes(f))
    );

    const paginated = paginateList(filtered, currentPage.products, rowsPerPage.products);
    const tbody = document.getElementById('tbProducts');
    if (!tbody) return;

    if (paginated.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding:20px; color:#6c757d;">ไม่พบข้อมูลสินค้า</td></tr>`;
        renderPaginationControls('pageProdContainer', 'products', paginated);
        return;
    }

    tbody.innerHTML = paginated.items.map(p => `
        <tr>
            <td><b>${p.brand || '-'}</b></td>
            <td><span class="sku-code">${p.skuMerchant}</span></td>
            <td>${p.gtin || '-'}</td>
            <td class="text-center">
                <button class="btn-edit-row" onclick='editProductRow(${JSON.stringify(p)})'>✏️ แก้ไข</button>
                <button class="btn-revert" onclick="deleteProductRow('${p.rowIndex}')">🗑️ ลบ</button>
            </td>
        </tr>
    `).join('');

    renderPaginationControls('pageProdContainer', 'products', paginated);
}

function renderSubReplace() {
    const input = document.getElementById('searchReplaceInput');
    const f = input ? input.value.toLowerCase().trim() : '';
    const list = (db.replacements || []).filter(item => {
        const tracking = String(item.trackingNo || '').toLowerCase();
        const oldSku = String(item.oldSku || '').toLowerCase();
        const newSku = String(item.newSku || '').toLowerCase();
        return tracking.includes(f) || oldSku.includes(f) || newSku.includes(f);
    });

    const tbody = document.getElementById('tbSubReplace');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:20px; color:#6c757d;">ไม่พบข้อมูลสินค้าทดแทน</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(item => `
        <tr>
            <td>${item.trackingNo}</td>
            <td><span class="badge badge-old">${item.oldSku}</span></td>
            <td class="text-center">${item.qty}</td>
            <td><span class="badge badge-completed">${item.newSku}</span></td>
            <td class="text-center">${item.qty}</td>
            <td class="text-center">${item.timestamp}</td>
            <td class="text-center">
                <button class="btn-revert" onclick="deleteSubstituteRow('${item.rowIndex}')">🗑️ ลบ</button>
            </td>
        </tr>
    `).join('');
}

function renderSubDelete() {
    const input = document.getElementById('searchDeleteInput');
    const f = input ? input.value.toLowerCase().trim() : '';
    const cutsData = db.cuts || [];

    const filtered = cutsData.filter(item => {
        const tracking = String(item.trackingNo || '').toLowerCase();
        const sku = String(item.sku || '').toLowerCase();
        return tracking.includes(f) || sku.includes(f);
    });

    const paginated = paginateList(filtered, currentPage.substitutes, rowsPerPage.substitutes);
    const tbody = document.getElementById('tbSubDelete');
    if (!tbody) return;

    if (paginated.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:20px; color:#6c757d;">ไม่พบข้อมูลรายการตัดสินค้าออก</td></tr>`;
        renderPaginationControls('pageDeleteContainer', 'substitutes', paginated);
        return;
    }

    tbody.innerHTML = paginated.items.map(item => {
        const tracking = item.trackingNo || '-';
        const sku = item.sku || '-';
        const qty = item.qty || 1;
        const timestamp = item.timestamp || '-';
        const rowIndex = item.rowIndex;

        return `
            <tr>
                <td><b>${tracking}</b></td>
                <td><span class="badge badge-old">${sku}</span></td>
                <td class="text-center">${qty}</td>
                <td class="text-center"><span class="badge badge-pending">ตัดรายการออก</span></td>
                <td class="text-center" style="color:#666; font-size:12px;">${timestamp}</td>
                <td class="text-center">
                    <button class="btn-revert" onclick="deleteCutRow('${rowIndex}')">🗑️ ลบ</button>
                </td>
            </tr>
        `;
    }).join('');

    renderPaginationControls('pageDeleteContainer', 'substitutes', paginated);
}

function renderTables() {
    renderOrders();
    renderProducts();
    renderSubReplace();
    renderSubDelete();
}

function filterOrders() { currentPage.orders = 1; renderOrders(); }
function filterProducts() { currentPage.products = 1; renderProducts(); }
function filterSubstitutes() { currentPage.substitutes = 1; renderSubReplace(); renderSubDelete(); }

function toggleSubMenu() {
    const sub = document.getElementById('subMenuSubstitutes');
    const arrow = document.getElementById('arrowSub');
    if (!sub) return;
    if (sub.classList.contains('open')) { sub.classList.remove('open'); arrow.innerText = '▼'; }
    else { sub.classList.add('open'); arrow.innerText = '▲'; }
}

function switchPage(pageId, btnId, isSubMenu = false) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.sub-btn').forEach(s => s.classList.remove('active'));

    document.getElementById(pageId).classList.add('active');

    if (isSubMenu) {
        document.getElementById('btnSubDropdown').classList.add('active');
        document.getElementById(btnId).classList.add('active');
        document.getElementById('subMenuSubstitutes').classList.add('open');
        document.getElementById('arrowSub').innerText = '▲';
    } else {
        document.getElementById(btnId).classList.add('active');
    }

    renderTables();
    closeMobileMenu();
    if (pageId === 'pageCctv' && typeof cctvOnPageShow === 'function') cctvOnPageShow();
    if (pageId === 'pageScanLog' && typeof loadScanLog === 'function') loadScanLog();
}

function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebarNav');
    const overlay = document.getElementById('mobileOverlay');
    if (!sidebar || !overlay) return;
    if (sidebar.classList.contains('mobile-open')) closeMobileMenu();
    else { sidebar.classList.add('mobile-open'); overlay.classList.add('show'); }
}

function closeMobileMenu() {
    const sidebar = document.getElementById('sidebarNav');
    const overlay = document.getElementById('mobileOverlay');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('show');
}

// ==========================================================
//  Actions ที่เขียนข้อมูล (ตอนนี้คุยกับ Google Sheet ผ่าน Apps Script)
// ==========================================================
async function revertQC(trackingNo) {
    if (!await showAppConfirm(`ต้องการยกเลิกสถานะ QC ของ Tracking: ${trackingNo} (กลับเป็น "รอ QC") หรือไม่?`)) return;
    try {
        const result = await apiPost('resetQCStatus', { trackingNo });
        if (!result.success) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
        showAppAlert(result.message || 'รีเซ็ตสถานะเรียบร้อย');
        loadData();
    } catch (err) {
        showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function deleteProductRow(rowIndex) {
    if (!await showAppConfirm('คุณต้องการลบสินค้ารายการนี้หรือไม่?')) return;
    try {
        const result = await apiPost('deleteRowBySheetAndIndex', { sheetName: 'Products', rowIndex: Number(rowIndex) });
        if (!result.success) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
        showAppAlert(result.message || 'ลบรายการเรียบร้อยแล้ว');
        loadData();
    } catch (err) {
        showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function deleteSubstituteRow(rowIndex) {
    if (!await showAppConfirm('คุณต้องการลบรายการทดแทนนี้หรือไม่?')) return;
    try {
        const result = await apiPost('deleteRowBySheetAndIndex', { sheetName: 'Substitute products', rowIndex: Number(rowIndex) });
        if (!result.success) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
        showAppAlert(result.message || 'ลบรายการเรียบร้อยแล้ว');
        loadData();
    } catch (err) {
        showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function deleteCutRow(rowIndex) {
    if (!await showAppConfirm('คุณต้องการยกเลิก/ลบรายการตัดสินค้านี้ ใช่หรือไม่?')) return;
    try {
        const result = await apiPost('deleteRowBySheetAndIndex', { sheetName: 'cut', rowIndex: Number(rowIndex) });
        if (!result.success) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
        loadData();
    } catch (err) {
        showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

// ==========================================================
//  เสียงแจ้งเตือนตอน QC (สังเคราะห์เอง เสียงแปลก/ดังกว่าเดิม)
//  + ปรับระดับเสียงได้จากสไลเดอร์ในหน้าเว็บ (จำค่าไว้ใน localStorage)
// ==========================================================
let qcVolume = parseFloat(localStorage.getItem('qcVolume'));
if (isNaN(qcVolume)) qcVolume = 1;

function updateVolumeSliderFill(slider) {
    if (!slider) return;
    const pct = (Number(slider.value) / Number(slider.max)) * 100;
    slider.style.background = `linear-gradient(to right, var(--argon-primary) 0%, var(--argon-primary) ${pct}%, #e9ecef ${pct}%, #e9ecef 100%)`;
}

function onQCVolumeChange(value) {
    qcVolume = Math.max(0, Math.min(1.5, Number(value) / 100));
    localStorage.setItem('qcVolume', String(qcVolume));
    const label = document.getElementById('qcVolumeValue');
    if (label) label.textContent = Math.round(qcVolume * 100) + '%';
    updateVolumeSliderFill(document.getElementById('qcVolumeSlider'));
}

function initQCVolumeSlider() {
    const slider = document.getElementById('qcVolumeSlider');
    const label = document.getElementById('qcVolumeValue');
    const pct = Math.round(qcVolume * 100);
    if (slider) slider.value = pct;
    if (label) label.textContent = pct + '%';
    updateVolumeSliderFill(slider);
}

function playSweep(ctx, fromFreq, toFreq, duration, waveType, delay, volume) {
    if (volume <= 0) return;
    const startTime = ctx.currentTime + (delay || 0);
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.type = waveType || 'sawtooth';
    oscillator.frequency.setValueAtTime(Math.max(fromFreq, 1), startTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(toFreq, 1), startTime + duration);
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(volume, startTime + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
}

function playQCSound(kind) {
    try {
        if (qcVolume <= 0) return;
        const ctx = getAudioContext();
        if (!ctx) return;
        const v = qcVolume;

        if (kind === 'correct') {
            // เสียง "ตุ๊งติ๊ง" สั้นๆ แปลกหู สองชั้นทับกัน
            playSweep(ctx, 750, 1200, 0.09, 'sawtooth', 0, 0.55 * v);
            playSweep(ctx, 1600, 950, 0.07, 'square', 0.05, 0.3 * v);
        } else if (kind === 'complete') {
            // อาร์เปโจ้ไต่บันไดเสียงแบบเกมผ่านด่าน จบด้วยเสียงหวือ
            const notes = [523.25, 659.25, 784.0, 1046.5, 1318.5];
            notes.forEach((freq, i) => playBeep(freq, 0.16, 'triangle', i * 0.09, 0.6 * v));
            playSweep(ctx, 1500, 2400, 0.28, 'sawtooth', notes.length * 0.09, 0.35 * v);
        } else if (kind === 'wrong') {
            // เสียงหวอผิดพลาด โทนต่ำ แหบ แปลกๆ
            playSweep(ctx, 320, 80, 0.4, 'sawtooth', 0, 0.6 * v);
            playBeep(140, 0.32, 'square', 0.06, 0.45 * v);
        }
    } catch (e) {}
}

function isQcQuickPassMode() {
    const cb = document.getElementById('qcQuickPassCheck');
    return !!(cb && cb.checked);
}

function handleOrderScan(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const input = document.getElementById('scanOrder');
    const tracking = input.value.trim();
    if (!tracking) return;

    const order = (db.orders || []).find(o => String(o.trackingNo || '').toLowerCase() === tracking.toLowerCase());

    if (!order) {
        showMessage('❌ ไม่พบข้อมูล Tracking No. นี้ในระบบ', 'error', 'wrong');
        input.select(); input.focus();
        return;
    }

    const status = order.status || '';
    const isAlreadyDone = status === 'Completed' || status === 'QC แล้ว' || status === 'สำเร็จ';
    if (isAlreadyDone) {
        const qcTime = order.qcTime || '-';
        showMessage(`⚠️ ออเดอร์ ${tracking} ผ่าน QC ไปแล้วเมื่อ ${qcTime}`, 'error', 'wrong');
        input.value = ''; input.focus();
        return;
    }

    currentQC.trackingNo = order.trackingNo;
    currentQC.items = parseOrderItems(order.itemsStr || '');

    // โหมด "ยิงผ่าน (ข้าม SKU)": ถือว่าออเดอร์นี้ผ่าน QC ทันทีโดยไม่ต้องสแกนเช็ค SKU ทีละชิ้น
    if (isQcQuickPassMode()) {
        input.value = '';
        showMessage(`🎯 ยิงผ่าน ${currentQC.trackingNo} เรียบร้อย (ข้ามการเช็ค SKU)`, 'success', 'complete');
        saveQCSuccess(currentQC.trackingNo, true);
        return;
    }

    document.getElementById('txtTracking').innerText = currentQC.trackingNo;
    document.getElementById('orderDetail').style.display = 'block';

    const scanItemInput = document.getElementById('scanItem');
    scanItemInput.disabled = false;
    scanItemInput.value = '';
    scanItemInput.focus();

    showMessage(`✅ ดึงข้อมูลออเดอร์ ${currentQC.trackingNo} เรียบร้อย`, 'success');
    renderQCItems();
}

function parseOrderItems(itemsStr) {
    if (!itemsStr) return [];
    const rawList = itemsStr.split(/,|\n/);
    const result = [];
    rawList.forEach(raw => {
        let text = raw.trim();
        if (!text) return;
        let qty = 1;
        const match = text.match(/\((\d+)\)\s*$/);
        if (match) { qty = parseInt(match[1], 10); text = text.slice(0, match.index).trim(); }
        result.push({ sku: text, qty: qty, scannedQty: 0 });
    });
    return result;
}

function handleItemScan(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const input = document.getElementById('scanItem');
    const barcode = input.value.trim();
    if (!barcode) return;

    let matchedSku = barcode;
    const prodMatch = findProductBySkuOrGtin(barcode);
    if (prodMatch) matchedSku = prodMatch.skuMerchant;

    const item = currentQC.items.find(i => i.sku.trim().toLowerCase() === matchedSku.trim().toLowerCase());

    if (!item) {
        showMessage(`❌ สินค้า SKU/บาร์โค้ด [${barcode}] ไม่อยู่ในออเดอร์นี้!`, 'error', 'wrong');
        input.value = ''; input.select();
        return;
    }

    const targetQty = item.qty || 1;
    if (item.scannedQty >= targetQty) {
        showMessage(`⚠️ สินค้า SKU [${item.sku}] ครบจำนวนแล้ว!`, 'error', 'wrong');
        input.value = ''; input.select();
        return;
    }

    item.scannedQty++;
    input.value = '';
    renderQCItems();

    const isAllDone = currentQC.items.every(i => i.scannedQty >= (i.qty || 1));
    if (isAllDone) {
        showMessage(`🎉 ตรวจสอบออเดอร์ ${currentQC.trackingNo} ครบถ้วนแล้ว!`, 'success', 'complete');
        saveQCSuccess(currentQC.trackingNo, false);
    } else {
        showMessage(`👍 สแกน ${item.sku} สำเร็จ (${item.scannedQty}/${targetQty})`, 'success', 'correct');
    }
}

function renderQCItems(itemsList) {
    const tbody = document.getElementById('tbQCItems');
    if (!tbody) return;

    const items = itemsList || currentQC.items || [];
    let scannedTotal = 0, requiredTotal = 0;

    tbody.innerHTML = items.map(item => {
        const scanned = Number(item.scannedQty || 0);
        const qty = Number(item.qty || 1);
        scannedTotal += scanned;
        requiredTotal += qty;

        const cleanSku = (item.sku || '').trim();
        const brandName = productsMap[cleanSku] || '-';
        const isDone = scanned >= qty;
        const statusBadge = isDone
            ? '<span class="badge" style="background:#d4edda; color:#155724; padding:4px 8px; border-radius:4px;">ครบถ้วน</span>'
            : '<span class="badge" style="background:#fff3cd; color:#856404; padding:4px 8px; border-radius:4px;">รอสแกน</span>';

        return `
            <tr style="${isDone ? 'background-color: #f8f9fa;' : ''}">
                <td data-label="SKU สินค้า"><span style="background:#f1f3f5; padding:2px 6px; border-radius:4px; font-weight:bold;">${cleanSku || '-'}</span></td>
                <td data-label="ชื่อสินค้า / แบรนด์">${brandName}</td>
                <td class="text-center" data-label="จำนวน (สแกน/ทั้งหมด)">${scanned} / ${qty}</td>
                <td class="text-center" data-label="สถานะ">${statusBadge}</td>
            </tr>
        `;
    }).join('');

    updateQCSummary(scannedTotal, requiredTotal);
}

function updateQCSummary(scannedTotal, requiredTotal) {
    const badge = document.getElementById('totalItemsBadge');
    if (!badge) return;
    badge.innerText = `สแกนแล้ว ${scannedTotal} / ${requiredTotal} ชิ้น`;
    badge.style.backgroundColor = (scannedTotal === requiredTotal && requiredTotal > 0) ? '#28a745' : '#17a2b8';
}

async function saveQCSuccess(trackingNo, wasSkipped) {
    try {
        const inspectionStatus = wasSkipped ? 'ไม่ได้ตรวจ' : 'ตรวจแล้ว';
        await apiPost('updateQCStatus', { trackingNo, status: 'Completed', inspectionStatus });
        loadData();
        setTimeout(resetScanUI, 600);
    } catch (err) {
        console.error('Error updating QC status:', err);
    }
}

function resetScanUI() {
    const orderDetail = document.getElementById('orderDetail');
    const scanOrder = document.getElementById('scanOrder');
    const scanItem = document.getElementById('scanItem');
    if (orderDetail) orderDetail.style.display = 'none';
    if (scanOrder) scanOrder.value = '';
    if (scanItem) { scanItem.value = ''; scanItem.disabled = true; }
    currentQC = { trackingNo: '', items: [] };
    if (scanOrder) scanOrder.focus();
}

function showMessage(text, type, soundKind) {
    const msgDiv = document.getElementById('msg');
    if (!msgDiv) return;
    msgDiv.className = `msg ${type}`;
    msgDiv.innerText = text;
    msgDiv.style.display = 'block';
    if (soundKind) {
        playQCSound(soundKind);
    } else {
        playFeedbackSound(type);
    }
    setTimeout(() => { msgDiv.style.display = 'none'; }, 4000);
}

let audioCtx = null;
function getAudioContext() {
    if (!audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        audioCtx = new AudioCtx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
}

function playBeep(frequency, duration, waveType, delay, volume) {
    const ctx = getAudioContext();
    if (!ctx) return;
    const startTime = ctx.currentTime + (delay || 0);
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.type = waveType || 'sine';
    oscillator.frequency.setValueAtTime(frequency, startTime);
    const peakVolume = volume || 0.25;
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(peakVolume, startTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
}

function playFeedbackSound(type) {
    try {
        if (type === 'success') { playBeep(880, 0.12, 'sine', 0, 0.22); playBeep(1318, 0.14, 'sine', 0.1, 0.22); }
        else if (type === 'error') { playBeep(220, 0.28, 'square', 0, 0.2); }
    } catch (e) {}
}

async function saveProduct(e) {
    if (e && e.preventDefault) e.preventDefault();

    const rowIndexInput = document.getElementById('prodEditRowIndex');
    const editingRowIndex = rowIndexInput ? rowIndexInput.value.trim() : '';

    const data = {
        brand: document.getElementById('prodBrand') ? document.getElementById('prodBrand').value.trim() : '',
        skuMerchant: document.getElementById('prodSkuMerchant') ? document.getElementById('prodSkuMerchant').value.trim() : '',
        gtin: document.getElementById('prodGtin') ? document.getElementById('prodGtin').value.trim() : ''
    };

    if (!data.skuMerchant) { showAppAlert('กรุณากรอก SKU สินค้า'); return; }

    try {
        let result;
        if (editingRowIndex) {
            result = await apiPost('updateProduct', { ...data, rowIndex: Number(editingRowIndex) });
        } else {
            result = await apiPost('addProduct', data);
        }
        if (result.success === false) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
        showAppAlert(result.message || (editingRowIndex ? 'แก้ไขสินค้าเรียบร้อยแล้ว' : 'บันทึกสินค้าเรียบร้อยแล้ว'));
        cancelEditProduct();
        loadData();
    } catch (err) {
        showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

function editProductRow(product) {
    document.getElementById('prodEditRowIndex').value = product.rowIndex;
    document.getElementById('prodBrand').value = product.brand || '';
    document.getElementById('prodSkuMerchant').value = product.skuMerchant || '';
    document.getElementById('prodGtin').value = product.gtin || '';

    const btn = document.getElementById('btnSaveProduct');
    if (btn) btn.textContent = '💾 บันทึกการแก้ไข';
    const cancelBtn = document.getElementById('btnCancelEditProduct');
    if (cancelBtn) cancelBtn.style.display = 'inline-block';

    document.getElementById('frmAddProduct').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditProduct() {
    const form = document.getElementById('frmAddProduct');
    if (form) form.reset();
    document.getElementById('prodEditRowIndex').value = '';

    const btn = document.getElementById('btnSaveProduct');
    if (btn) btn.textContent = '➕ เพิ่มสินค้า';
    const cancelBtn = document.getElementById('btnCancelEditProduct');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

async function removeItemFromOrder(e) {
    if (e && e.preventDefault) e.preventDefault();

    const trackingInput = document.getElementById('delTracking');
    const trackingNo = trackingInput ? trackingInput.value.trim() : '';
    const rowEls = Array.from(document.querySelectorAll('#delRowsContainer .sub-row'));

    if (!trackingNo || rowEls.length === 0) {
        showAppAlert('กรุณากรอก Tracking No. และเพิ่มอย่างน้อย 1 รายการ');
        return;
    }

    const order = (db.orders || []).find(o => String(o.trackingNo || '').trim().toLowerCase() === trackingNo.toLowerCase());

    const seenInForm = {};
    const entries = [];
    for (const row of rowEls) {
        const sku = row.querySelector('.del-row-sku').value.trim();
        const qty = Number(row.querySelector('.del-row-qty').value) || 1;

        if (!sku) continue; // แถวว่างเปล่า ข้ามไป

        const key = sku.toLowerCase();
        if (seenInForm[key]) {
            showAppAlert(`❌ เลือก SKU "${sku}" ซ้ำกันหลายแถว กรุณาเลือกไม่ให้ซ้ำกัน`);
            return;
        }
        seenInForm[key] = true;

        const orderItem = order && order.items ? order.items.find(it => String(it.sku || '').trim().toLowerCase() === key) : null;
        if (!orderItem) {
            showAppAlert(`❌ ไม่พบ SKU "${sku}" ในออเดอร์ "${trackingNo}"\nกรุณาเลือก SKU จากรายการที่มีอยู่ในออเดอร์นี้เท่านั้น`);
            return;
        }
        if (qty > orderItem.qty) {
            showAppAlert(`❌ จำนวนที่กรอกสำหรับ SKU "${sku}" (${qty}) มากกว่าจำนวนที่มีในออเดอร์ (${orderItem.qty})`);
            return;
        }

        const isDuplicate = (db.cuts || []).some(item =>
            String(item.trackingNo || '').trim().toLowerCase() === trackingNo.toLowerCase() &&
            String(item.sku || '').trim().toLowerCase() === key
        );
        if (isDuplicate) {
            showAppAlert(`❌ Tracking No. "${trackingNo}" กับ SKU "${sku}" มีข้อมูลรายการตัดสินค้าออกอยู่แล้วในระบบ ไม่สามารถบันทึกซ้ำได้\nกรุณาลบรายการเดิมก่อน หากต้องการแก้ไข`);
            return;
        }

        entries.push({ trackingNo, sku, qty });
    }

    if (entries.length === 0) {
        showAppAlert('กรุณาเพิ่มอย่างน้อย 1 รายการ (เลือก SKU ที่ต้องการตัดออก)');
        return;
    }

    const confirmList = entries.map(en => `${en.sku} (${en.qty})`).join(', ');
    if (!await showAppConfirm(`ยืนยันการตัด SKU: ${confirmList} ออกจาก Tracking: ${trackingNo} ใช่หรือไม่?`)) return;

    try {
        let successCount = 0;
        const errors = [];
        for (const data of entries) {
            const result = await apiPost('deleteOrderItem', data);
            if (result.success === false) errors.push(`${data.sku}: ${result.message || 'เกิดข้อผิดพลาด'}`);
            else successCount++;
        }

        let msg = successCount > 0 ? `✅ บันทึกตัดสินค้าออกสำเร็จ ${successCount} รายการ` : '';
        if (errors.length > 0) msg += `${msg ? '\n' : ''}❌ บันทึกไม่สำเร็จ: ${errors.join(', ')}`;
        showAppAlert(msg || 'ไม่มีรายการที่บันทึกสำเร็จ');

        if (trackingInput) trackingInput.value = '';
        resetDeleteRows();
        loadData();
    } catch (err) {
        showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function saveReplaceAction(e) {
    if (e && e.preventDefault) e.preventDefault();

    const trackingNo = document.getElementById('subTracking') ? document.getElementById('subTracking').value.trim() : '';
    const rowEls = Array.from(document.querySelectorAll('#subRowsContainer .sub-row'));

    if (!trackingNo || rowEls.length === 0) {
        showAppAlert('❌ กรุณากรอก Tracking No. และเพิ่มอย่างน้อย 1 รายการ');
        return;
    }

    const orderItemsForTracking = getSubOldSkuOptionsForTracking(trackingNo);
    const seenInForm = {};
    const entries = [];
    for (const row of rowEls) {
        const oldSku = row.querySelector('.sub-row-old-sku').value.trim();
        const qty = Number(row.querySelector('.sub-row-qty').value) || 1;
        const newSkuRaw = row.querySelector('.sub-row-new-sku').value.trim();

        if (!oldSku && !newSkuRaw) continue; // แถวว่างเปล่า ข้ามไป

        if (!oldSku || !newSkuRaw) {
            showAppAlert('❌ กรุณาเลือก SKU เดิม และกรอก SKU ใหม่ ให้ครบทุกแถวที่กรอกข้อมูล');
            return;
        }

        const key = oldSku.toLowerCase();
        if (seenInForm[key]) {
            showAppAlert(`❌ เลือก SKU เดิม "${oldSku}" ซ้ำกันหลายแถว กรุณาเลือกไม่ให้ซ้ำกัน`);
            return;
        }
        seenInForm[key] = true;

        const orderItem = orderItemsForTracking.find(it => it.sku === oldSku);
        if (orderItem && qty > orderItem.qty) {
            showAppAlert(`❌ จำนวนที่กรอกสำหรับ SKU "${oldSku}" (${qty}) มากกว่าจำนวนที่มีในออเดอร์ (${orderItem.qty})`);
            return;
        }

        const matchedProduct = findProductBySkuOrGtin(newSkuRaw);
        if (!matchedProduct) {
            showAppAlert(`❌ ไม่พบ SKU/GTIN "${newSkuRaw}" ในระบบสินค้า\nกรุณาเพิ่มสินค้านี้ในหน้า "จัดการสินค้า (Products)" ก่อน หรือเลือกจากรายการ SKU ที่มีอยู่แล้ว`);
            return;
        }

        entries.push({ oldSku, qty, newSku: matchedProduct.skuMerchant });
    }

    if (entries.length === 0) {
        showAppAlert('❌ กรุณาเพิ่มอย่างน้อย 1 รายการ (เลือก SKU เดิม และกรอก SKU ใหม่)');
        return;
    }

    const toSave = [];
    const skippedDuplicates = [];
    entries.forEach(entry => {
        const isDuplicate = (db.replacements || []).some(item =>
            String(item.trackingNo || '').trim().toLowerCase() === trackingNo.toLowerCase() &&
            String(item.oldSku || '').trim().toLowerCase() === entry.oldSku.toLowerCase()
        );
        if (isDuplicate) { skippedDuplicates.push(entry.oldSku); return; }

        toSave.push({ trackingNo, oldSku: entry.oldSku, qty: entry.qty, newSku: entry.newSku, newQty: entry.qty });
    });

    if (toSave.length === 0) {
        showAppAlert(`❌ Tracking No. "${trackingNo}" กับ SKU เดิมที่กรอกทั้งหมด มีข้อมูลสินค้าทดแทนอยู่แล้วในระบบ ไม่สามารถบันทึกซ้ำได้\nกรุณาลบรายการเดิมก่อน หากต้องการแก้ไข`);
        return;
    }

    try {
        let successCount = 0;
        const errors = [];
        for (const data of toSave) {
            const result = await apiPost('saveSubstitute', data);
            if (result.success === false) errors.push(`${data.oldSku}: ${result.message || 'เกิดข้อผิดพลาด'}`);
            else successCount++;
        }

        let msg = successCount > 0 ? `✅ บันทึกสินค้าทดแทนสำเร็จ ${successCount} รายการ` : '';
        if (skippedDuplicates.length > 0) msg += `${msg ? '\n' : ''}⚠️ ข้ามรายการที่ซ้ำ: ${skippedDuplicates.join(', ')}`;
        if (errors.length > 0) msg += `${msg ? '\n' : ''}❌ บันทึกไม่สำเร็จ: ${errors.join(', ')}`;
        showAppAlert(msg || 'ไม่มีรายการที่บันทึกสำเร็จ');

        const form = document.getElementById('formSubstitute');
        if (form) form.reset();
        resetSubstituteRows();
        loadData();
    } catch (err) {
        showAppAlert("❌ เกิดข้อผิดพลาดจากระบบ: " + err.message);
    }
}

// ==========================================================
//  ทำฟวย (Upload Excel) → เขียนเข้า collection "fuayEntries"
//  คอลัมน์อ้างอิงตามตำแหน่งเดิม: A=0 tracking, H=7 remark,
//  I=8 วันที่, M=12 โลจิสติกส์, N=13 สถานะแพลตฟอร์ม, O=14 สถานะคำสั่งซื้อ
// ==========================================================
function previewExcelFile() {
    const fileInput = document.getElementById('excelFileInput');
    const file = fileInput.files[0];
    pendingExcelData = null;
    document.getElementById('excelPreviewHeader').innerHTML = '';
    document.getElementById('excelPreviewBody').innerHTML = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });

            if (!rows || rows.length === 0) {
                showUploadStatus('❌ ไม่พบข้อมูลในไฟล์ที่เลือก', 'error');
                return;
            }

            const headers = rows[0].map(h => String(h || '').trim());
            const dataRows = rows.slice(1).filter(r => r.some(cell => String(cell || '').trim() !== ''));

            pendingExcelData = { headers, rows: dataRows };
            renderExcelPreview(headers, dataRows);
            showUploadStatus(`✅ อ่านไฟล์สำเร็จ พบ ${dataRows.length} แถวข้อมูล พร้อมอัปโหลด`, 'success');
        } catch (err) {
            showUploadStatus('❌ ไม่สามารถอ่านไฟล์นี้ได้: ' + err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function renderExcelPreview(headers, dataRows) {
    const headerRow = document.getElementById('excelPreviewHeader');
    const body = document.getElementById('excelPreviewBody');
    headerRow.innerHTML = headers.map(h => `<th>${h}</th>`).join('');
    const previewRows = dataRows.slice(0, 10);
    body.innerHTML = previewRows.map(r => '<tr>' + headers.map((h, i) => `<td>${r[i] !== undefined ? r[i] : ''}</td>`).join('') + '</tr>').join('');
    if (dataRows.length > 10) {
        body.innerHTML += `<tr><td colspan="${headers.length}" class="text-center" style="color:#888;">... และอีก ${dataRows.length - 10} แถว</td></tr>`;
    }
}

function showUploadStatus(text, type, boxId) {
    const box = document.getElementById(boxId || 'uploadStatusBox');
    if (!box) return;
    box.className = `msg ${type}`;
    box.innerText = text;
    box.style.display = 'block';
}

async function uploadExcelFile() {
    if (!pendingExcelData || !pendingExcelData.rows || pendingExcelData.rows.length === 0) {
        showAppAlert('กรุณาเลือกไฟล์ Excel ที่มีข้อมูลก่อนอัปโหลด');
        return;
    }

    if (!await showAppConfirm(`ยืนยันการนำเข้าข้อมูล ${pendingExcelData.rows.length} แถว แทนที่ข้อมูล "ฟวย" เดิมทั้งหมดหรือไม่?`)) return;

    showUploadStatus('⏳ กำลังอัปโหลดข้อมูล กรุณารอสักครู่...', 'success');

    try {
        const result = await apiPost('importExcelToOrdersSheet', {
            headers: pendingExcelData.headers,
            rows: pendingExcelData.rows
        });

        if (result.success === false) {
            showUploadStatus('❌ ' + (result.message || 'เกิดข้อผิดพลาด'), 'error');
            return;
        }

        showUploadStatus('✅ ' + (result.message || 'นำเข้าข้อมูลเรียบร้อยแล้ว'), 'success');
        document.getElementById('excelFileInput').value = '';
        document.getElementById('excelPreviewHeader').innerHTML = '';
        document.getElementById('excelPreviewBody').innerHTML = '';
        pendingExcelData = null;
        loadFuayData();
        loadData();
    } catch (err) {
        showUploadStatus('❌ เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
}

// ==========================================================
//  นำเข้าสินค้าจากไฟล์ Excel (Master Products)
//  รองรับไฟล์หลายรูปแบบ (เช่น export จาก BigSeller) โดยให้ผู้ใช้
//  เลือกจับคู่คอลัมน์เอง (SKU Merchant / แบรนด์ / GTIN) ก่อนนำเข้าจริง
// ==========================================================
const PRODUCT_FIELD_KEYWORDS = {
    gtin:  ['gtin', 'บาร์โค้ด', 'บาร์โคด', 'barcode'],
    sku:   ['sku merchant', 'merchant sku', 'เลข sku', 'รหัส sku', 'sku code', 'sku'],
    brand: ['แบรนด์', 'brand', 'ชื่อสำรอง sku merchant', 'ชื่อ sku']
};

function guessProductColumnIndex(headers, usedIdx, keywords) {
    for (const kw of keywords) {
        const idx = headers.findIndex((h, i) => !usedIdx.has(i) && String(h || '').trim().toLowerCase().includes(kw));
        if (idx !== -1) return idx;
    }
    return -1;
}

function guessProductColumnMapping(headers, rows) {
    const usedIdx = new Set();

    const gtinIdx = guessProductColumnIndex(headers, usedIdx, PRODUCT_FIELD_KEYWORDS.gtin);
    if (gtinIdx !== -1) usedIdx.add(gtinIdx);

    const skuIdx = guessProductColumnIndex(headers, usedIdx, PRODUCT_FIELD_KEYWORDS.sku);
    if (skuIdx !== -1) usedIdx.add(skuIdx);

    let brandIdx = guessProductColumnIndex(headers, usedIdx, PRODUCT_FIELD_KEYWORDS.brand);

    // ถ้าคอลัมน์ที่เดาไว้เป็น "แบรนด์" แต่ข้อมูลจริงว่างเปล่าเกือบทั้งหมด
    // (ไฟล์บางแบบ เช่น BigSeller ใส่ชื่อแบรนด์ไว้ในคอลัมน์ "ชื่อ SKU" แทน)
    // ให้ลองสลับไปใช้คอลัมน์ "ชื่อ SKU" ถ้ามีข้อมูลมากกว่า
    const sample = rows.slice(0, 30);
    const emptyRatio = idx => {
        if (idx === -1 || sample.length === 0) return 1;
        const empty = sample.filter(r => String(r[idx] || '').trim() === '').length;
        return empty / sample.length;
    };
    if (emptyRatio(brandIdx) > 0.8) {
        const altIdx = headers.findIndex((h, i) => i !== skuIdx && String(h || '').trim().toLowerCase().includes('ชื่อ sku'));
        if (altIdx !== -1 && emptyRatio(altIdx) < emptyRatio(brandIdx)) brandIdx = altIdx;
    }

    return { skuIdx, brandIdx, gtinIdx };
}

function readWorkbookRowsFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });

                if (!rows || rows.length === 0) {
                    resolve({ fileName: file.name, headers: [], rows: [] });
                    return;
                }
                const headers = rows[0].map(h => String(h || '').trim());
                const dataRows = rows.slice(1).filter(r => r.some(cell => String(cell || '').trim() !== ''));
                resolve({ fileName: file.name, headers, rows: dataRows });
            } catch (err) {
                reject(new Error(`ไฟล์ "${file.name}": ${err.message}`));
            }
        };
        reader.onerror = () => reject(new Error(`ไม่สามารถอ่านไฟล์ "${file.name}" ได้`));
        reader.readAsArrayBuffer(file);
    });
}

function previewProductExcelFile() {
    const fileInput = document.getElementById('prodExcelFileInput');
    const files = Array.from(fileInput.files || []);

    pendingProductImportData = null;
    pendingProductImportMapped = [];
    document.getElementById('prodImportMappingWrap').style.display = 'none';
    document.getElementById('prodImportPreviewWrap').style.display = 'none';
    document.getElementById('prodImportSummary').style.display = 'none';
    document.getElementById('btnImportProducts').disabled = true;
    if (!files.length) return;

    showUploadStatus(`⏳ กำลังอ่านไฟล์ ${files.length} ไฟล์...`, 'success', 'prodImportStatusBox');

    Promise.all(files.map(readWorkbookRowsFromFile))
        .then(fileResults => {
            let headers = null;
            let headerMismatch = false;
            let allRows = [];

            fileResults.forEach(r => {
                if (!r.rows.length) return;
                if (!headers) {
                    headers = r.headers;
                } else if (r.headers.length !== headers.length) {
                    headerMismatch = true;
                }
                allRows = allRows.concat(r.rows);
            });

            if (!headers || allRows.length === 0) {
                showUploadStatus('❌ ไม่พบข้อมูลในไฟล์ที่เลือก', 'error', 'prodImportStatusBox');
                return;
            }

            pendingProductImportData = { headers, rows: allRows };

            const guess = guessProductColumnMapping(headers, allRows);
            renderProductMappingSelects(headers, guess);
            document.getElementById('prodImportMappingWrap').style.display = 'block';

            const filesNote = files.length > 1 ? ` จาก ${files.length} ไฟล์` : '';
            const mismatchNote = headerMismatch ? ' ⚠️ หมายเหตุ: บางไฟล์มีจำนวนคอลัมน์ไม่ตรงกัน กรุณาตรวจสอบการจับคู่คอลัมน์ให้ดี' : '';
            showUploadStatus(`✅ อ่านไฟล์สำเร็จ พบ ${allRows.length} แถวข้อมูล${filesNote} — กรุณาตรวจสอบการจับคู่คอลัมน์ด้านล่าง${mismatchNote}`, 'success', 'prodImportStatusBox');

            renderProductImportPreview();
        })
        .catch(err => {
            showUploadStatus('❌ ไม่สามารถอ่านไฟล์ได้: ' + err.message, 'error', 'prodImportStatusBox');
        });
}

function renderProductMappingSelects(headers, guess) {
    const buildOptions = (selectedIdx, optional) => {
        let html = optional ? `<option value="-1">-- ไม่ใช้ --</option>` : '';
        headers.forEach((h, i) => {
            html += `<option value="${i}" ${i === selectedIdx ? 'selected' : ''}>${h || '(คอลัมน์ ' + (i + 1) + ')'}</option>`;
        });
        return html;
    };

    document.getElementById('mapProdSku').innerHTML = buildOptions(guess.skuIdx, false);
    document.getElementById('mapProdBrand').innerHTML = buildOptions(guess.brandIdx, true);
    document.getElementById('mapProdGtin').innerHTML = buildOptions(guess.gtinIdx, true);
}

function buildMappedProductRows() {
    if (!pendingProductImportData) return [];

    const skuIdx = Number(document.getElementById('mapProdSku').value);
    const brandIdx = Number(document.getElementById('mapProdBrand').value);
    const gtinIdx = Number(document.getElementById('mapProdGtin').value);

    const seenInFile = new Set();
    const mapped = [];

    pendingProductImportData.rows.forEach(r => {
        const skuMerchant = skuIdx > -1 ? String(r[skuIdx] || '').trim() : '';
        const brand = brandIdx > -1 ? String(r[brandIdx] || '').trim() : '';
        const gtin = gtinIdx > -1 ? String(r[gtinIdx] || '').trim() : '';
        const skuKey = skuMerchant.toLowerCase();

        let status;
        if (!skuMerchant) {
            status = 'missing';
        } else if (seenInFile.has(skuKey)) {
            status = 'dup_in_file';
        } else {
            status = 'new';
        }
        if (skuMerchant) seenInFile.add(skuKey);

        mapped.push({ brand, skuMerchant, gtin, status });
    });

    return mapped;
}

function renderProductImportPreview() {
    if (!pendingProductImportData) return;

    pendingProductImportMapped = buildMappedProductRows();

    const statusLabel = {
        new: '<span class="badge badge-completed">จะนำเข้า</span>',
        dup_in_file: '<span class="badge badge-old">ซ้ำในไฟล์ (ใช้แถวแรก)</span>',
        missing: '<span class="badge badge-old">ไม่มี SKU (ข้าม)</span>'
    };

    const body = document.getElementById('prodImportPreviewBody');
    const previewRows = pendingProductImportMapped.slice(0, 15);
    body.innerHTML = previewRows.map(row => `
        <tr>
            <td>${row.brand || '-'}</td>
            <td><span class="sku-code">${row.skuMerchant || '-'}</span></td>
            <td>${row.gtin || '-'}</td>
            <td class="text-center">${statusLabel[row.status]}</td>
        </tr>
    `).join('');
    if (pendingProductImportMapped.length > previewRows.length) {
        body.innerHTML += `<tr><td colspan="4" class="text-center" style="color:#888;">... และอีก ${pendingProductImportMapped.length - previewRows.length} แถว</td></tr>`;
    }
    document.getElementById('prodImportPreviewWrap').style.display = 'block';

    const total = pendingProductImportMapped.length;
    const missing = pendingProductImportMapped.filter(r => r.status === 'missing').length;
    const dupInFile = pendingProductImportMapped.filter(r => r.status === 'dup_in_file').length;
    const newCount = pendingProductImportMapped.filter(r => r.status === 'new').length;
    const currentTotal = (db.products || []).length;

    const summaryBox = document.getElementById('prodImportSummary');
    summaryBox.style.display = 'block';
    summaryBox.innerHTML = `
        พบในไฟล์ทั้งหมด <b>${total}</b> แถว &nbsp;|&nbsp;
        จะนำเข้า <b style="color:#198754;">${newCount}</b> รายการ &nbsp;|&nbsp;
        ซ้ำในไฟล์ <b>${dupInFile}</b> &nbsp;|&nbsp;
        ไม่มี SKU <b>${missing}</b>
        <br>⚠️ สินค้าเดิมในระบบตอนนี้มี <b>${currentTotal}</b> รายการ — จะถูก<b style="color:#dc3545;">ลบทิ้งทั้งหมด</b>แล้วแทนที่ด้วย <b style="color:#0d6efd;">${newCount}</b> รายการนี้
    `;

    document.getElementById('btnImportProducts').disabled = newCount === 0;
}

async function importProductsFromExcel() {
    if (!pendingProductImportData) {
        showAppAlert('กรุณาเลือกไฟล์ Excel ก่อนนำเข้า');
        return;
    }

    const toImport = pendingProductImportMapped
        .filter(r => r.status === 'new')
        .map(({ brand, skuMerchant, gtin }) => ({ brand, skuMerchant, gtin }));

    if (toImport.length === 0) {
        showAppAlert('ไม่มีรายการที่ถูกต้องให้นำเข้า (ไม่มี SKU Merchant)');
        return;
    }

    const currentTotal = (db.products || []).length;
    const confirmMsg = `⚠️ ยืนยันลบสินค้าเดิมทั้งหมด (${currentTotal} รายการ) ออกจากระบบ แล้วนำเข้าสินค้าใหม่ ${toImport.length} รายการแทนหรือไม่?\n\nการกระทำนี้ไม่สามารถย้อนกลับได้`;
    if (!await showAppConfirm(confirmMsg)) return;

    const btn = document.getElementById('btnImportProducts');
    if (btn) btn.disabled = true;

    try {
        showUploadStatus('⏳ กำลังลบข้อมูลสินค้าเดิมทั้งหมด...', 'success', 'prodImportStatusBox');
        const clearResult = await apiPost('clearProducts', {});
        if (clearResult.success === false) {
            showUploadStatus('❌ ' + (clearResult.message || 'ลบข้อมูลเดิมไม่สำเร็จ'), 'error', 'prodImportStatusBox');
            if (btn) btn.disabled = false;
            return;
        }

        const CHUNK_SIZE = 300;
        let importedTotal = 0;
        let skippedTotal = 0;

        for (let i = 0; i < toImport.length; i += CHUNK_SIZE) {
            const chunk = toImport.slice(i, i + CHUNK_SIZE);
            showUploadStatus(`⏳ กำลังนำเข้าข้อมูลใหม่... (${Math.min(i + CHUNK_SIZE, toImport.length)}/${toImport.length})`, 'success', 'prodImportStatusBox');

            const result = await apiPost('importProducts', { products: chunk });
            if (result.success === false) {
                showUploadStatus('❌ ' + (result.message || 'เกิดข้อผิดพลาดระหว่างนำเข้า') + ` (นำเข้าไปแล้ว ${importedTotal} รายการก่อนเกิดปัญหา)`, 'error', 'prodImportStatusBox');
                if (btn) btn.disabled = false;
                loadData();
                return;
            }
            importedTotal += (result.added != null ? result.added : chunk.length);
            skippedTotal += (result.skipped || 0);
        }

        showUploadStatus(`✅ ลบของเดิมและนำเข้าใหม่สำเร็จ ${importedTotal} รายการ${skippedTotal ? ` (ข้ามซ้ำ ${skippedTotal} รายการ)` : ''}`, 'success', 'prodImportStatusBox');
        document.getElementById('prodExcelFileInput').value = '';
        document.getElementById('prodImportMappingWrap').style.display = 'none';
        document.getElementById('prodImportPreviewWrap').style.display = 'none';
        document.getElementById('prodImportSummary').style.display = 'none';
        pendingProductImportData = null;
        pendingProductImportMapped = [];
        loadData();
    } catch (err) {
        showUploadStatus('❌ เกิดข้อผิดพลาด: ' + err.message, 'error', 'prodImportStatusBox');
        if (btn) btn.disabled = false;
    }
}

// ==========================================================
//  ฟวย: คำนวณ ค้าง/วิกฤติ/ยิง/แฟลช/เช็ค
//  (คำนวณฝั่ง Apps Script จากชีต "ลงข้อมูล" โดยตรง action=getFuayData)
// ==========================================================
async function loadFuayData() {
    try {
        const result = await apiGet('getFuayData');
        if (!result.success) {
            console.error('Error loading Fuay data:', result.message);
            return;
        }

        fuayData = result.data || [];
        window.fuayHeaders = (result.headers || ["ค้าง ว", "ค้าง ย", "วิกฤติ", "ยิง", "แฟลช"]).slice(0, 5);
        window.fuayShippedSet = {};
        (result.shippedTracks || []).forEach(t => { window.fuayShippedSet[String(t).trim().toLowerCase()] = true; });
        // col6 ของทุกแถวรวมกัน = รายการ "เช็ค" ทั้งหมด (เอาไว้กรองแบบ เจอ/หาย ตอนคลิกช่องย่อย และโชว์เป็นลิสต์แยกได้)
        window.fuayCheckedSet = {};
        window.fuayCheckedList = [];
        fuayData.forEach(row => {
            if (!row.col6) return;
            const key = String(row.col6).trim().toLowerCase();
            if (window.fuayCheckedSet[key]) return;
            window.fuayCheckedSet[key] = true;
            window.fuayCheckedList.push(row.col6);
        });
        const checkedCountEl = document.getElementById('fuayCheckedCount');
        if (checkedCountEl) checkedCountEl.textContent = window.fuayCheckedList.length;
        window.fuayLastSummary = result.summary;
        renderFuayTable();
        renderFuaySummary(result.summary);
    } catch (err) {
        console.error('Error loading Fuay data:', err);
    }
}

// กล่องหลัก (วิกฤติ/ยิง/แฟลช) โชว์ยอด "ค้างว"/"ค้างย"/แฟลช กดได้ พาไปคอลัมน์ ค้างว/ค้างย/แฟลช
// ช่องย่อย ("X ออกได้"/เจอ/หาย/ส่ง/ค้าง) ใช้ข้อมูลจริงของหมวดนั้น (วิกฤติ/ยิง/แฟลช แบบดิบ) กดได้ พาไปคอลัมน์ วิกฤติ/ยิง/แฟลช
// colIdx อ้างอิงคอลัมน์เดียวกับ headers/fuayData: 0=ค้างว 1=ค้างย 2=วิกฤติ 3=ยิง 4=แฟลช
const FUAY_MAIN_COL_INDEX = { wikrit: 2, ying: 3, flash: 4 };
const FUAY_KANG_COL_INDEX = { wikrit: 0, ying: 1, flash: 4 };

function renderFuaySummary(summary) {
    const grid = document.getElementById('fuaySummaryGrid');
    if (!grid) return;
    if (!summary) { grid.innerHTML = ''; return; }

    function clickableCard(label, value, colIdx, metricKey, extraClass) {
        const isActive = window.fuayActiveMetricKey === (colIdx + ':' + metricKey);
        return `<div class="fuay-box ${extraClass || ''} fuay-box-clickable${isActive ? ' active' : ''}" onclick="selectFuayMetric(${colIdx}, '${metricKey}')">
                    <div class="fuay-box-label">${label}</div>
                    <div class="fuay-box-value">${value}</div>
                </div>`;
    }
    // main/mainColIdx = ลิสต์ของกล่องหลัก (ค้างว/ค้างย/แฟลช) ใช้กับกล่องหลัก + เจอ/หาย/ส่ง/ค้าง
    // ให้ตัวเลขในแถวเดียวกันรวมกันได้ตรงกับยอดกล่องหลัก (เจอ+หาย = ยอดรวม)
    // raw/rawColIdx = ลิสต์วิกฤติ/ยิง/แฟลช แบบดิบ ใช้กับช่อง "X ออกได้" เท่านั้น
    function metricRow(mainLabel, main, mainColIdx, raw, rawColIdx) {
        return `
            ${clickableCard(mainLabel, main.total, mainColIdx, 'main', 'fuay-box-main')}
            ${clickableCard(mainLabel + ' ออกได้', raw.total, rawColIdx, 'total', 'fuay-metric-found')}
            ${clickableCard('เจอ', main.found, mainColIdx, 'found', 'fuay-metric-found')}
            ${clickableCard('หาย', main.missing, mainColIdx, 'missing', 'fuay-metric-missing')}
            ${clickableCard('ส่ง', main.shipped, mainColIdx, 'shipped', 'fuay-metric-shipped')}
            ${clickableCard('ค้าง', main.pending, mainColIdx, 'pending', 'fuay-metric-pending')}
        `;
    }

    grid.innerHTML = `
        <div class="fuay-summary-row">${metricRow('วิกฤติ', summary.kangWikrit, FUAY_KANG_COL_INDEX.wikrit, summary.wikrit, FUAY_MAIN_COL_INDEX.wikrit)}</div>
        <div class="fuay-summary-row">${metricRow('ยิง', summary.kangYing, FUAY_KANG_COL_INDEX.ying, summary.ying, FUAY_MAIN_COL_INDEX.ying)}</div>
        <div class="fuay-summary-row">${metricRow('แฟลช', summary.flash, FUAY_KANG_COL_INDEX.flash, summary.flash, FUAY_MAIN_COL_INDEX.flash)}</div>
    `;
}

function selectFuayMetric(colIdx, metricKey) {
    window.fuayShowCheckedList = false;
    window.fuayActiveMetricKey = colIdx + ':' + metricKey;
    currentFuayTabIndex = colIdx;
    renderFuayTable();
    renderFuaySummary(window.fuayLastSummary);
}

// โชว์รายการ Tracking No. ทั้งหมดที่เช็ค (สแกน) ไปแล้ว ไม่ว่าจะอยู่หมวดไหน
function showFuayCheckedList() {
    window.fuayShowCheckedList = true;
    window.fuayActiveMetricKey = null;
    renderFuayTable();
    renderFuaySummary(window.fuayLastSummary);
}

// ล้างรายการ "เช็คแล้ว" ทั้งหมด (เริ่มเช็คใหม่ตั้งแต่ต้น) — ต้องยืนยันก่อนเพราะย้อนกลับไม่ได้
async function resetFuayChecked() {
    const count = (window.fuayCheckedList || []).length;
    if (count === 0) {
        showAppAlert('ยังไม่มีรายการที่เช็คไว้ ไม่ต้องรีเซ็ต');
        return;
    }
    if (!await showAppConfirm(`ยืนยันล้างรายการที่เช็คแล้วทั้งหมด (${count} รายการ) หรือไม่?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return;

    try {
        const result = await apiPost('clearCheckedTrackings', {});
        if (result.success === false) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
        window.fuayLastScannedTracking = null;
        window.fuayShowCheckedList = false;
        showAppAlert(result.message || 'รีเซ็ตเรียบร้อยแล้ว');
        loadFuayData();
    } catch (err) {
        showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

// พื้นหลังจางๆ ตามสีหมวด สำหรับแถวที่ "เจอ" (เช็คแล้ว) ค้างไว้ถาวร ต่างจากไฮไลต์เหลืองที่เป็นแค่ชั่วคราว
function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ไฮไลต์ถ้าตรงกับคำค้นหาปัจจุบัน หรือเป็นรายการที่เพิ่งสแกนเช็คสำเร็จล่าสุด (ให้ค้างไว้แม้ช่องค้นหาจะถูกเคลียร์แล้ว)
function isFuayValueHighlighted(value, searchTerm) {
    const v = String(value || '').trim().toLowerCase();
    if (searchTerm && v.includes(searchTerm)) return true;
    if (window.fuayLastScannedTracking && v === String(window.fuayLastScannedTracking).trim().toLowerCase()) return true;
    return false;
}

function renderFuayTable() {
    const tbody = document.getElementById('tbFuayData');
    const headerRow = document.getElementById('fuayTableHeader');
    if (!tbody) return;

    const input = document.getElementById('searchFuayInput');
    const f = input ? input.value.toLowerCase().trim() : '';
    const headers = (window.fuayHeaders || ['ค้าง ว', 'ค้าง ย', 'วิกฤติ', 'ยิง', 'แฟลช']).slice(0, 5);

    const viewCheckedBtn = document.getElementById('btnViewChecked');
    if (viewCheckedBtn) viewCheckedBtn.classList.toggle('active', !!window.fuayShowCheckedList);

    if (window.fuayShowCheckedList) {
        const list = window.fuayCheckedList || [];
        if (headerRow) headerRow.innerHTML = `<th>✅ เช็คแล้วทั้งหมด (${list.length})</th>`;
        tbody.innerHTML = list.length === 0
            ? `<tr><td class="text-center" style="padding:20px; color:#6c757d;">ยังไม่ได้เช็คอะไรเลย</td></tr>`
            : list.map(value => {
                const isShipped = window.fuayShippedSet && window.fuayShippedSet[String(value).trim().toLowerCase()];
                const shippedBadge = isShipped ? ' <span class="fuay-shipped-badge">✅ ส่งแล้ว</span>' : '';
                const highlighted = isFuayValueHighlighted(value, f)
                    ? `<span style="background-color:#fff3cd; padding:2px 6px; border-radius:4px; font-weight:bold;">${value}</span>`
                    : value;
                // ทุกแถวในลิสต์นี้ "เจอ" อยู่แล้ว (เพราะคือรายการที่เช็คแล้ว) ใช้สีของหมวดแรกที่ตรงเป็นพื้นหลัง
                const cats = findFuayCategoriesForTracking(value);
                const rowStyle = cats.length ? ` style="background:${hexToRgba(cats[0].color, 0.12)};"` : '';
                return `<tr${isShipped ? ' class="fuay-row-shipped"' : ''}${rowStyle}><td>${highlighted}${shippedBadge}</td></tr>`;
            }).join('');
        return;
    }

    if (currentFuayTabIndex > headers.length - 1) currentFuayTabIndex = 0;
    const colKey = 'col' + (currentFuayTabIndex + 1);
    const activeLabel = headers[currentFuayTabIndex] || '-';

    let rowsWithValue = fuayData.filter(row => row[colKey]);

    // ถ้าคลิกช่องย่อย (เจอ/หาย/ส่ง/ค้าง) ให้กรองรายการในคอลัมน์นี้ต่อ ไม่ใช่แค่สลับคอลัมน์เฉยๆ
    const activeParts = (window.fuayActiveMetricKey || '').split(':');
    const activeColIdx = Number(activeParts[0]);
    const activeMetricKey = activeParts[1];
    if (activeColIdx === currentFuayTabIndex && activeMetricKey && activeMetricKey !== 'main' && activeMetricKey !== 'total') {
        rowsWithValue = rowsWithValue.filter(row => {
            const key = String(row[colKey]).trim().toLowerCase();
            const isFound = !!(window.fuayCheckedSet && window.fuayCheckedSet[key]);
            const isShipped = !!(window.fuayShippedSet && window.fuayShippedSet[key]);
            if (activeMetricKey === 'found') return isFound && !isShipped;
            if (activeMetricKey === 'missing') return !isFound && !isShipped;
            if (activeMetricKey === 'shipped') return isShipped;
            if (activeMetricKey === 'pending') return !isShipped;
            return true;
        });
    }

    if (headerRow) headerRow.innerHTML = `<th>${activeLabel} (${rowsWithValue.length})</th>`;

    if (rowsWithValue.length === 0) {
        tbody.innerHTML = `<tr><td class="text-center" style="padding:20px; color:#6c757d;">ไม่พบข้อมูล</td></tr>`;
        return;
    }

    function cellHtml(value) {
        if (!value) return '-';
        const isShipped = window.fuayShippedSet && window.fuayShippedSet[String(value).trim().toLowerCase()];
        const shippedBadge = isShipped
            ? ' <span class="fuay-shipped-badge">✅ ส่งแล้ว</span>'
            : '';
        if (isFuayValueHighlighted(value, f)) {
            return `<span style="background-color:#fff3cd; padding:2px 6px; border-radius:4px; font-weight:bold;">${value}</span>${shippedBadge}`;
        }
        return `${value}${shippedBadge}`;
    }

    const activeCategoryColor = FUAY_CATEGORY_META[currentFuayTabIndex] ? FUAY_CATEGORY_META[currentFuayTabIndex].color : null;
    tbody.innerHTML = rowsWithValue.map(row => {
        const key = String(row[colKey]).trim().toLowerCase();
        const isShipped = window.fuayShippedSet && window.fuayShippedSet[key];
        const isFound = window.fuayCheckedSet && window.fuayCheckedSet[key];
        const rowStyle = (isFound && activeCategoryColor) ? ` style="background:${hexToRgba(activeCategoryColor, 0.12)};"` : '';
        return `<tr${isShipped ? ' class="fuay-row-shipped"' : ''}${rowStyle}><td>${cellHtml(row[colKey])}</td></tr>`;
    }).join('');
}

// หมวดหมู่ในตาราง "ทำ ฟวย" (ตรงกับ col1..col5) + สีป้ายกำกับ อิงโทนสีใกล้เคียงกับที่ใช้ใน Google Sheet เดิม
const FUAY_CATEGORY_META = [
    { key: 'col1', label: 'ค้าง ว', color: '#f5365c' },
    { key: 'col2', label: 'ค้าง ย', color: '#fb6340' },
    { key: 'col3', label: 'วิกฤติ', color: '#8965e0' },
    { key: 'col4', label: 'ยิง', color: '#11cdef' },
    { key: 'col5', label: 'แฟลช', color: '#ffc107' }
];

function findFuayCategoriesForTracking(trackingNo) {
    const key = String(trackingNo).trim().toLowerCase();
    return FUAY_CATEGORY_META.filter(cat =>
        fuayData.some(row => String(row[cat.key] || '').trim().toLowerCase() === key)
    );
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str == null ? '' : str);
    return div.innerHTML;
}

async function handleFuaySearchEnter(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const input = document.getElementById('searchFuayInput');
    const trackingNo = input.value.trim();
    if (!trackingNo) return;

    const statusBox = document.getElementById('fuayCheckStatus');

    // หาว่าเลขนี้อยู่ในหมวดไหนบ้าง ก่อนบันทึก — ถ้าไม่ตรงกับออเดอร์ไหนเลย ไม่ต้องบันทึกลงระบบ
    const categories = findFuayCategoriesForTracking(trackingNo);
    if (categories.length === 0) {
        if (statusBox) {
            statusBox.className = 'msg error';
            statusBox.innerHTML = `${escapeHtml(`❌ ไม่พบ "${trackingNo}" ในออเดอร์ใดเลย ไม่บันทึก`)}`;
            statusBox.style.display = 'block';
        }
        playQCSound('wrong');
        input.select();
        input.focus();
        setTimeout(() => { if (statusBox) statusBox.style.display = 'none'; }, 5000);
        return;
    }

    if (statusBox) { statusBox.className = 'msg success'; statusBox.innerText = '⏳ กำลังบันทึก...'; statusBox.style.display = 'block'; }

    const badgesHtml = categories.map(c => `<span class="fuay-check-badge" style="background:${c.color}">${c.label}</span>`).join('');

    try {
        const result = await apiPost('addCheckedTracking', { trackingNo });

        if (statusBox) {
            statusBox.className = result.success ? 'msg success' : 'msg error';
            const message = result.message || (result.success ? `✅ บันทึก "${trackingNo}" เรียบร้อยแล้ว` : '❌ เกิดข้อผิดพลาด');
            statusBox.innerHTML = `${escapeHtml(message)}<div class="fuay-check-badges">${badgesHtml}</div>`;
            statusBox.style.display = 'block';
        }
        playQCSound(result.success ? 'correct' : 'wrong');
        if (result.success) {
            window.fuayLastScannedTracking = trackingNo; // ให้แถวนี้ยังขึ้นไฮไลต์ค้างไว้แม้ช่องค้นหาจะถูกเคลียร์แล้ว
            input.value = '';
            loadFuayData();
        } else {
            input.select();
        }
        input.focus();
        setTimeout(() => { if (statusBox) statusBox.style.display = 'none'; }, 5000);
    } catch (err) {
        if (statusBox) {
            statusBox.className = 'msg error';
            statusBox.innerHTML = `${escapeHtml('❌ เกิดข้อผิดพลาด: ' + err.message)}<div class="fuay-check-badges">${badgesHtml}</div>`;
            statusBox.style.display = 'block';
        }
        playQCSound('wrong');
        input.focus();
    }
}

// ==========================================================
//  สแกน QR Code / บาร์โค้ด ด้วยกล้องมือถือ (ใช้ไลบรารี html5-qrcode)
// ==========================================================
let qrScannerInstance = null;
let qrScannerTargetInputId = null;

async function openQrScanner(targetInputId) {
    qrScannerTargetInputId = targetInputId;
    const modal = document.getElementById('qrScanModal');
    if (!modal) return;

    if (typeof Html5Qrcode === 'undefined') {
        showAppAlert('ไม่สามารถโหลดตัวสแกนกล้องได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่');
        return;
    }

    modal.classList.add('show');

    try {
        qrScannerInstance = new Html5Qrcode('qrReaderRegion');
        await qrScannerInstance.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText) => onQrScanDecoded(decodedText),
            () => { /* เฟรมที่ยังอ่านไม่เจอ ไม่ต้องแจ้งเตือน */ }
        );
    } catch (err) {
        showAppAlert('เปิดกล้องไม่สำเร็จ: กรุณาอนุญาตให้เว็บนี้ใช้กล้อง แล้วลองใหม่อีกครั้ง');
        closeQrScanner();
    }
}

function onQrScanDecoded(decodedText) {
    const input = document.getElementById(qrScannerTargetInputId);
    if (input) {
        input.value = decodedText;
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    closeQrScanner();
}

function closeQrScanner() {
    const modal = document.getElementById('qrScanModal');
    if (modal) modal.classList.remove('show');

    if (qrScannerInstance) {
        const instance = qrScannerInstance;
        qrScannerInstance = null;
        instance.stop()
            .then(() => instance.clear())
            .catch(() => {});
    }
}
