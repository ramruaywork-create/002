// ==========================================================
//  Supabase backend (แทนที่ Google Apps Script Web App เดิม)
//  ทุกฟังก์ชันในไฟล์นี้คืนค่ารูปแบบเดียวกับ action ที่ Apps Script เคยส่งกลับ
//  เพื่อให้ apiGet/apiPost ใน script.js เรียกใช้ได้โดยไม่ต้องแก้โค้ดส่วนอื่น
// ==========================================================
const SUPABASE_URL = 'https://dsekvvygczrvvwnnrkuy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_boz7aOGbmjTHyPwsKhJl0Q_W41e5RXl';
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function sbFormatBangkok(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
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

// PostgREST คืนสูงสุด 1000 แถวต่อ request เสมอ ต้องวน .range() จนกว่าจะครบ
// (สำคัญมากสำหรับตาราง products ที่มีเกือบ 3 หมื่นแถว)
async function sbFetchAll(table, columns) {
    const pageSize = 1000;
    let from = 0;
    let all = [];
    while (true) {
        const { data, error } = await sbClient.from(table).select(columns).order('id').range(from, from + pageSize - 1);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < pageSize) break;
        from += pageSize;
    }
    return all;
}

function sbAddItemToOrdersMap(ordersMap, trackNo, sku, qty, status, qcTime, rowIdx) {
    if (qty <= 0) return;

    if (!ordersMap[trackNo]) {
        ordersMap[trackNo] = {
            trackingNo: trackNo,
            items: [{ sku: sku, qty: qty }],
            status: status,
            qcTime: qcTime,
            rowIndex: rowIdx
        };
        return;
    }

    let existingItem = null;
    for (let ei = 0; ei < ordersMap[trackNo].items.length; ei++) {
        if (ordersMap[trackNo].items[ei].sku === sku) { existingItem = ordersMap[trackNo].items[ei]; break; }
    }
    if (existingItem) existingItem.qty += qty;
    else ordersMap[trackNo].items.push({ sku: sku, qty: qty });
}

// ==========================================================
//  action = getAllData
// ==========================================================
async function sbGetAllData() {
    try {
        const [cutsRows, subsRows, qcRows, itemRows, productRows] = await Promise.all([
            sbFetchAll('cuts', 'id, tracking_no, sku, qty, created_at'),
            sbFetchAll('substitutes', 'id, tracking_no, old_sku, qty, new_sku, created_at'),
            sbFetchAll('qc_log', 'tracking_no, qc_time'),
            sbFetchAll('order_items', 'id, tracking_no, sku, qty'),
            // gtin2/gtin3 เพิ่มทีหลัง: ถ้ายังไม่ได้รัน SQL เพิ่มคอลัมน์ ให้ถอยกลับไปอ่านแบบเดิมเพื่อไม่ให้เว็บพัง
            sbFetchAll('products', 'id, brand, sku_merchant, gtin, gtin2, gtin3')
                .catch(() => sbFetchAll('products', 'id, brand, sku_merchant, gtin'))
        ]);

        const cutMap = {};
        const cutsData = cutsRows.map(row => {
            const key = String(row.tracking_no).trim() + '_' + String(row.sku).trim();
            cutMap[key] = (cutMap[key] || 0) + Number(row.qty);
            return {
                trackingNo: row.tracking_no,
                sku: row.sku,
                qty: Number(row.qty),
                timestamp: sbFormatBangkok(row.created_at),
                rowIndex: row.id
            };
        });

        const subMap = {};
        const replacementsData = subsRows.map(row => {
            const key = String(row.tracking_no).trim() + '_' + String(row.old_sku).trim();
            subMap[key] = { newSku: row.new_sku, newQty: Number(row.qty) };
            return {
                trackingNo: row.tracking_no,
                oldSku: row.old_sku,
                qty: Number(row.qty),
                newSku: row.new_sku,
                timestamp: sbFormatBangkok(row.created_at),
                rowIndex: row.id
            };
        });

        const summaryQcMap = {};
        qcRows.forEach(row => {
            summaryQcMap[String(row.tracking_no).trim().toLowerCase()] = sbFormatBangkok(row.qc_time);
        });

        const ordersMap = {};
        itemRows.forEach(row => {
            const trackNo = String(row.tracking_no || '').trim();
            if (!trackNo) return;

            const sku = String(row.sku || '').trim();
            let qty = Number(row.qty) || 1;
            const trackKeyLower = trackNo.toLowerCase();
            const isDoneFromSummary = Object.prototype.hasOwnProperty.call(summaryQcMap, trackKeyLower);
            const status = isDoneFromSummary ? 'Completed' : 'รอดำเนินการ';
            const qcTime = isDoneFromSummary ? summaryQcMap[trackKeyLower] : '-';

            const itemKey = trackNo + '_' + sku;

            if (cutMap[itemKey]) {
                const cutQty = cutMap[itemKey];
                if (qty <= cutQty) { cutMap[itemKey] -= qty; return; }
                else { qty -= cutQty; cutMap[itemKey] = 0; }
            }

            if (subMap[itemKey]) {
                const subInfo = subMap[itemKey];
                const subQty = subInfo.newQty;
                const remainQty = qty - subQty;
                if (remainQty > 0) sbAddItemToOrdersMap(ordersMap, trackNo, sku, remainQty, status, qcTime, row.id);
                sbAddItemToOrdersMap(ordersMap, trackNo, subInfo.newSku, subQty, status, qcTime, row.id);
            } else {
                sbAddItemToOrdersMap(ordersMap, trackNo, sku, qty, status, qcTime, row.id);
            }
        });

        const ordersData = Object.keys(ordersMap).map(key => {
            const ord = ordersMap[key];
            const itemsArrStr = ord.items.map(it => `${it.sku} (${it.qty})`);
            return {
                trackingNo: ord.trackingNo,
                itemsStr: itemsArrStr.join(', '),
                items: ord.items,
                status: ord.status,
                qcTime: ord.qcTime,
                rowIndex: ord.rowIndex
            };
        });

        const productsData = productRows.map(p => ({
            brand: p.brand || '',
            skuMerchant: p.sku_merchant || '',
            gtin: p.gtin || '',
            gtin2: p.gtin2 || '',
            gtin3: p.gtin3 || '',
            rowIndex: p.id
        }));

        return { orders: ordersData, products: productsData, replacements: replacementsData, cuts: cutsData };
    } catch (err) {
        console.error('sbGetAllData error:', err);
        return { orders: [], products: [], replacements: [], cuts: [], error: err.message || String(err) };
    }
}

// ==========================================================
//  action = getFuayData
//  (พอร์ตตรงจากตรรกะเดิมใน Apps Script — ใช้ toISODate/shortLogistic/
//  containsCI/containsTH/THAI_MONTHS ที่ประกาศไว้แล้วใน script.js)
// ==========================================================
async function sbGetFuayData() {
    try {
        const [uploadRes, qcRows, checkedRows] = await Promise.all([
            sbClient.from('fuay_upload').select('headers, rows').eq('id', 1).single(),
            sbFetchAll('qc_log', 'tracking_no'),
            sbFetchAll('checked_trackings', 'tracking_no')
        ]);
        if (uploadRes.error) throw uploadRes.error;

        const headerRow = uploadRes.data.headers || [];
        const dataRows = uploadRes.data.rows || [];
        if (dataRows.length === 0) {
            return { success: true, headers: ["ค้าง ย", "ค้าง ว", "วิกฤติ", "ยิง", "แฟลช", "เช็ค"], data: [] };
        }
        const values = [headerRow].concat(dataRows);

        const COL_TRACK = 0, COL_REMARK = 7, COL_DATE = 8, COL_LOGISTIC = 12, COL_STATUS = 13, COL_ORDER_STATUS = 14;
        const REFUND_STATUS = "การคืนเงิน/คืนสินค้า";

        const todayISO = todayBangkokISO(0);
        const yesterdayISO = todayBangkokISO(-1);
        const twoDaysAgoISO = todayBangkokISO(-2);

        const qcMap = {};
        qcRows.forEach(r => { qcMap[String(r.tracking_no || '').trim().toLowerCase()] = true; });

        const seenKang = {};
        let listKangYing = [], listKangWikrit = [];
        const seenWikritAll = {}, listWikritAll = [];
        const seenYingAll = {}, listYingAll = [];
        const seenFlashAll = {}, listFlashAll = [];

        for (let i = 1; i < values.length; i++) {
            const row = values[i];
            const track = String(row[COL_TRACK] || '').trim();
            if (!track) continue;

            const orderStatus = String(row[COL_ORDER_STATUS] || '').trim();
            if (orderStatus === REFUND_STATUS) continue;

            const remark = row[COL_REMARK];
            const logisticFull = String(row[COL_LOGISTIC] || '').trim();
            const logisticShort = shortLogistic(logisticFull);
            const status = String(row[COL_STATUS] || '').trim();
            const dateISO = toISODate(row[COL_DATE]);

            const hasNoHave = containsCI(remark, "NO HAVE");
            const hasYNo = containsCI(remark, "Y NO");
            const hasCancelled = containsTH(remark, "ยกเลิก");
            const remarkOkay = ((!hasNoHave) || hasYNo) && !hasCancelled;

            const cond1 = dateISO && dateISO <= todayISO && (status === "Shipped" || status === "Shipping");
            const cond2 = logisticShort === "Flash Express";
            const cond3 = dateISO && dateISO <= todayISO;
            if ((cond1 || cond2 || cond3) && !seenKang[track]) {
                seenKang[track] = true;
                const isKangOverdue2 = dateISO && dateISO <= twoDaysAgoISO;
                if (isKangOverdue2) listKangWikrit.push(track);
                else listKangYing.push(track);
            }

            const isShippedLike = (status === "Shipped" || status === "Shipping");
            const isSpx = logisticFull === "Shopee-TH-SPX Express";
            const isOverdue2 = dateISO && dateISO <= twoDaysAgoISO;
            if (isShippedLike && isSpx && remarkOkay && isOverdue2 && !seenWikritAll[track]) {
                seenWikritAll[track] = true;
                listWikritAll.push(track);
            }

            const isYesterday = dateISO === yesterdayISO;
            const isSpxForYing = logisticFull === "Shopee-TH-SPX Express";
            const hasNoHaveForYing = hasNoHave && !hasYNo;
            if (isYesterday && isSpxForYing && !hasNoHaveForYing && !seenYingAll[track]) {
                seenYingAll[track] = true;
                listYingAll.push(track);
            }

            const isFlash = (logisticFull === "Lazada-TH-Flash Express" || logisticFull === "Shopee-TH-Flash Express");
            if (isFlash && !seenFlashAll[track]) {
                seenFlashAll[track] = true;
                listFlashAll.push(track);
            }
        }

        let listWikrit = listWikritAll.slice();
        let listYing = listYingAll.slice();
        let listFlash = listFlashAll.slice();

        (function enforceMutualExclusivity() {
            function dedupeAgainst(list, exclusionSet) {
                const result = [];
                const localSeen = {};
                for (let di = 0; di < list.length; di++) {
                    const key = String(list[di]).trim().toLowerCase();
                    if (exclusionSet[key] || localSeen[key]) continue;
                    localSeen[key] = true;
                    result.push(list[di]);
                }
                return result;
            }
            const usedSet = {};
            function addToUsed(list) { list.forEach(t => { usedSet[String(t).trim().toLowerCase()] = true; }); }

            listFlash = dedupeAgainst(listFlash, {});
            addToUsed(listFlash);

            listWikrit = dedupeAgainst(listWikrit, usedSet);
            addToUsed(listWikrit);

            listKangWikrit = dedupeAgainst(listKangWikrit, usedSet);
            addToUsed(listKangWikrit);

            listYing = dedupeAgainst(listYing, usedSet);
            addToUsed(listYing);

            const usedSetForKangWikrit = {};
            listFlash.forEach(t => { usedSetForKangWikrit[String(t).trim().toLowerCase()] = true; });
            listKangWikrit = dedupeAgainst(listKangWikrit, usedSetForKangWikrit);

            const kangWikritSet = {};
            listKangWikrit.forEach(t => { kangWikritSet[String(t).trim().toLowerCase()] = true; });
            listWikrit.forEach(t => {
                const key = String(t).trim().toLowerCase();
                if (!kangWikritSet[key]) { kangWikritSet[key] = true; listKangWikrit.push(t); }
            });

            const usedSetWithoutYing = {};
            listFlash.forEach(t => { usedSetWithoutYing[String(t).trim().toLowerCase()] = true; });
            listWikrit.forEach(t => { usedSetWithoutYing[String(t).trim().toLowerCase()] = true; });
            listKangWikrit.forEach(t => { usedSetWithoutYing[String(t).trim().toLowerCase()] = true; });
            listKangYing = dedupeAgainst(listKangYing, usedSetWithoutYing);

            const kangYingSet = {};
            listKangYing.forEach(t => { kangYingSet[String(t).trim().toLowerCase()] = true; });
            listYing.forEach(t => {
                const key = String(t).trim().toLowerCase();
                if (!kangYingSet[key]) { kangYingSet[key] = true; listKangYing.push(t); }
            });
        })();

        const listCheck = checkedRows.map(r => r.tracking_no).filter(Boolean);

        const maxLen = Math.max(listKangYing.length, listKangWikrit.length, listWikrit.length, listYing.length, listFlash.length, listCheck.length);
        const result = [];
        for (let r = 0; r < maxLen; r++) {
            result.push({
                col1: listKangWikrit[r] || '',
                col2: listKangYing[r] || '',
                col3: listWikrit[r] || '',
                col4: listYing[r] || '',
                col5: listFlash[r] || '',
                col6: listCheck[r] || ''
            });
        }

        const checkSet = {};
        listCheck.forEach(t => { checkSet[String(t).trim().toLowerCase()] = true; });

        function summarizeList(list) {
            let found = 0, missing = 0, shipped = 0, pending = 0;
            list.forEach(t => {
                const key = String(t).trim().toLowerCase();
                // ส่งแล้ว = นับที่ "ส่ง" อย่างเดียว ตัดออกจาก เจอ/หาย/ค้าง
                if (qcMap[key]) { shipped++; return; }
                pending++;
                if (checkSet[key]) found++; else missing++;
            });
            return { total: list.length, found, missing, shipped, pending };
        }

        // สรุปครบทั้ง 5 หมวด แยกกันตรงๆ ตามคอลัมน์จริง: ค้างว/ค้างย/วิกฤติ/ยิง/แฟลช
        const summary = {
            kangWikrit: summarizeList(listKangWikrit),
            kangYing: summarizeList(listKangYing),
            wikrit: summarizeList(listWikritAll),
            ying: summarizeList(listYingAll),
            flash: summarizeList(listFlashAll)
        };
        summary.yingWikritTotal = summary.ying.total + summary.wikrit.total;

        const shippedTracks = Object.keys(qcMap);

        return {
            success: true,
            headers: ["ค้าง ว", "ค้าง ย", "วิกฤติ", "ยิง", "แฟลช", "เช็ค"],
            data: result,
            summary,
            shippedTracks
        };
    } catch (err) {
        console.error('sbGetFuayData error:', err);
        return { success: false, message: "เกิดข้อผิดพลาด: " + (err.message || String(err)), data: [] };
    }
}

// ==========================================================
//  action = updateQCStatus / resetQCStatus
// ==========================================================
async function sbUpdateQCStatus(trackingNo, status, inspectionStatus) {
    try {
        if (!trackingNo) return { success: false, message: "ไม่พบข้อมูล Tracking" };
        const trimmed = String(trackingNo).trim();

        const { data: orderCheck, error: ocErr } = await sbClient.from('order_items').select('id').ilike('tracking_no', trimmed).limit(1);
        if (ocErr) throw ocErr;
        const updated = !!(orderCheck && orderCheck.length > 0);

        const isCompleted = (status === "Completed" || status === "QC แล้ว" || status === "สำเร็จ");
        if (updated && isCompleted) {
            const statusLabel = (inspectionStatus === "ไม่ได้ตรวจ") ? "ไม่ได้ตรวจ" : "ตรวจแล้ว";
            const { data: existing, error: selErr } = await sbClient.from('qc_log').select('id').ilike('tracking_no', trimmed).limit(1);
            if (selErr) throw selErr;
            const fields = { qc_time: new Date().toISOString(), status_label: statusLabel };
            if (existing && existing.length > 0) {
                const { error } = await sbClient.from('qc_log').update(fields).eq('id', existing[0].id);
                if (error) throw error;
            } else {
                const { error } = await sbClient.from('qc_log').insert({ tracking_no: trimmed, ...fields });
                if (error) throw error;
            }
        }

        return updated
            ? { success: true, message: "อัปเดตสถานะ QC สำเร็จ" }
            : { success: false, message: "ไม่พบข้อมูล Tracking" };
    } catch (err) {
        return { success: false, message: err.message || String(err) };
    }
}

async function sbResetQCStatus(trackingNo) {
    try {
        if (!trackingNo) return { success: false, message: "ไม่พบข้อมูล Tracking" };
        const trimmed = String(trackingNo).trim();

        const { data: orderCheck, error: ocErr } = await sbClient.from('order_items').select('id').ilike('tracking_no', trimmed).limit(1);
        if (ocErr) throw ocErr;
        const found = !!(orderCheck && orderCheck.length > 0);

        const { error: delErr } = await sbClient.from('qc_log').delete().ilike('tracking_no', trimmed);
        if (delErr) throw delErr;

        return found
            ? { success: true, message: "รีเซ็ตสถานะเรียบร้อย" }
            : { success: false, message: "ไม่พบข้อมูล Tracking" };
    } catch (err) {
        return { success: false, message: err.message || String(err) };
    }
}

// ==========================================================
//  action = saveSubstitute / deleteOrderItem
// ==========================================================
async function sbSaveSubstitute(data) {
    try {
        const trackingNo = data.trackingNo || data.tracking;
        const oldSku = data.oldSku;
        const newSku = data.newSku;
        const qty = Number(data.newQty || data.qty || data.oldTotalQty) || 1;

        if (!trackingNo || !oldSku || !newSku) {
            return { success: false, message: "กรุณากรอกข้อมูล Tracking และ SKU ให้ครบถ้วน" };
        }

        const { error } = await sbClient.from('substitutes').insert({
            tracking_no: String(trackingNo).trim(),
            old_sku: String(oldSku).trim(),
            qty,
            new_sku: String(newSku).trim()
        });
        if (error) throw error;

        return { success: true, message: "บันทึกสินค้าทดแทนเรียบร้อยแล้ว" };
    } catch (err) {
        return { success: false, message: "เกิดข้อผิดพลาด: " + (err.message || String(err)) };
    }
}

async function sbDeleteOrderItem(data) {
    try {
        const { error } = await sbClient.from('cuts').insert({
            tracking_no: String(data.trackingNo || '').trim(),
            sku: String(data.sku || '').trim(),
            qty: Number(data.qty) || 1
        });
        if (error) throw error;
        return { success: true, message: "บันทึกข้อมูลลงชีต cut เรียบร้อยแล้ว!" };
    } catch (err) {
        return { success: false, message: err.message || String(err) };
    }
}

// ==========================================================
//  action = addProduct / updateProduct / clearProducts / importProducts
// ==========================================================
function sbFriendlyDupMessage(error, sku, gtin, isUpdate) {
    const msg = String(error.message || '');
    const suffix = isUpdate ? ' (แถวอื่น) ไม่สามารถบันทึกซ้ำได้' : ' ไม่สามารถเพิ่มซ้ำได้';
    if (msg.includes('gtin')) return `❌ GTIN "${gtin}" มีอยู่ในระบบแล้ว${suffix}`;
    return `❌ SKU Merchant "${sku}" มีอยู่ในระบบแล้ว${suffix}`;
}

// รวม GTIN ทั้ง 3 ช่อง: ตัดช่องว่าง ตัดค่าซ้ำ และเลื่อนช่องที่ว่างขึ้นมา (ช่อง 1 ว่างแต่ช่อง 2 มีค่า → ย้ายขึ้นเป็นช่อง 1)
function sbCleanGtins(src) {
    const list = [];
    [src && src.gtin, src && src.gtin2, src && src.gtin3].forEach(v => {
        const s = String(v || '').trim();
        if (s && !list.includes(s)) list.push(s);
    });
    return { gtin: list[0] || null, gtin2: list[1] || null, gtin3: list[2] || null };
}

// ถ้ายังไม่ได้เพิ่มคอลัมน์ gtin2/gtin3 ในฐานข้อมูล ให้บอกวิธีแก้แทนข้อความ error ดิบ
function sbMissingGtinColumnMessage(err) {
    const msg = String((err && err.message) || '');
    if (/gtin2|gtin3/.test(msg)) return '❌ ฐานข้อมูลยังไม่มีคอลัมน์ gtin2 / gtin3 — ให้รัน SQL เพิ่มคอลัมน์ใน Supabase (SQL Editor) ก่อน';
    return null;
}

async function sbAddProduct(form) {
    try {
        const sku = String((form && form.skuMerchant) || '').trim();
        if (!sku) return { success: false, message: 'กรุณากรอก SKU Merchant' };
        const g = sbCleanGtins(form);

        const { error } = await sbClient.from('products').insert({
            brand: form.brand || '',
            sku_merchant: sku,
            ...g
        });
        if (error) {
            if (error.code === '23505') return { success: false, message: sbFriendlyDupMessage(error, sku, g.gtin, false) };
            throw error;
        }
        return { success: true, message: 'บันทึกสินค้าเรียบร้อยแล้ว' };
    } catch (err) {
        return { success: false, message: sbMissingGtinColumnMessage(err) || err.message || String(err) };
    }
}

async function sbUpdateProduct(data) {
    try {
        const rowIndex = Number(data.rowIndex);
        if (!rowIndex || rowIndex < 1) return { success: false, message: 'แถวไม่ถูกต้อง' };
        const sku = String(data.skuMerchant || '').trim();
        if (!sku) return { success: false, message: 'กรุณากรอก SKU Merchant' };
        const g = sbCleanGtins(data);

        const { error } = await sbClient.from('products').update({
            brand: data.brand || '',
            sku_merchant: sku,
            ...g
        }).eq('id', rowIndex);
        if (error) {
            if (error.code === '23505') return { success: false, message: sbFriendlyDupMessage(error, sku, g.gtin, true) };
            throw error;
        }
        return { success: true, message: 'แก้ไขสินค้าเรียบร้อยแล้ว' };
    } catch (err) {
        return { success: false, message: sbMissingGtinColumnMessage(err) || err.message || String(err) };
    }
}

async function sbClearProducts() {
    try {
        const { error } = await sbClient.from('products').delete().gte('id', 0);
        if (error) throw error;
        return { success: true, message: 'ลบข้อมูลสินค้าเดิมทั้งหมดเรียบร้อยแล้ว' };
    } catch (err) {
        return { success: false, message: err.message || String(err) };
    }
}

// action = clearCheckedTrackings ("ทำ ฟวย" ปุ่มรีเซ็ตรายการที่เช็คแล้วทั้งหมด)
async function sbClearCheckedTrackings() {
    try {
        const { error } = await sbClient.from('checked_trackings').delete().gte('id', 0);
        if (error) throw error;
        return { success: true, message: 'รีเซ็ตรายการที่เช็คแล้วทั้งหมดเรียบร้อยแล้ว' };
    } catch (err) {
        return { success: false, message: err.message || String(err) };
    }
}

// นำเข้าเป็นชุด (เรียกซ้ำได้หลายครั้งต่อเนื่องทีละ chunk จากหน้าเว็บ)
// ใช้ upsert ON CONFLICT (sku_merchant) DO NOTHING เพื่อข้าม SKU ซ้ำแบบ case-exact โดยไม่ต้อง
// ดึงข้อมูลเดิมทั้งหมดมาก่อน (ตาราง products มีเกือบ 3 หมื่นแถว การ select ทั้งหมดทุก chunk จะช้ามาก)
// หมายเหตุ: ถ้า SKU/GTIN ซ้ำแบบต่างตัวพิมพ์ใหญ่-เล็ก หรือ GTIN ซ้ำ จะถูก unique index อีกตัวปฏิเสธทั้ง chunk
// (เคสนี้พบได้ยากมากในข้อมูลจริง — ตรวจสอบแล้วไม่มี SKU/GTIN ซ้ำเลยตอนย้ายข้อมูล)
async function sbImportProducts(payload) {
    try {
        const products = (payload && payload.products) || [];
        if (!products.length) return { success: false, message: 'ไม่มีข้อมูลสินค้าที่จะนำเข้า' };

        const seenInBatch = {};
        const toInsert = [];
        let skipped = 0;
        products.forEach(p => {
            const sku = String(p.skuMerchant || '').trim();
            if (!sku) { skipped++; return; }
            const key = sku.toLowerCase();
            if (seenInBatch[key]) { skipped++; return; }
            seenInBatch[key] = true;
            toInsert.push({ brand: String(p.brand || '').trim(), sku_merchant: sku, ...sbCleanGtins(p) });
        });

        let added = 0;
        if (toInsert.length > 0) {
            const { data, error } = await sbClient
                .from('products')
                .upsert(toInsert, { onConflict: 'sku_merchant', ignoreDuplicates: true })
                .select('id');
            if (error) throw error;
            added = (data || []).length;
            skipped += (toInsert.length - added);
        }

        return {
            success: true,
            message: `นำเข้าสำเร็จ ${added} รายการ (ข้ามซ้ำ ${skipped} รายการ)`,
            added,
            skipped
        };
    } catch (err) {
        return { success: false, message: err.message || String(err) };
    }
}

// ==========================================================
//  action = deleteRowBySheetAndIndex
// ==========================================================
const SB_SHEET_TABLE_MAP = {
    'Products': 'products',
    'Substitutes': 'substitutes',
    'Substitute products': 'substitutes',
    'cut': 'cuts'
};

async function sbDeleteRowBySheetAndIndex(sheetName, rowIndex, trackingNo, oldSku) {
    try {
        const table = SB_SHEET_TABLE_MAP[sheetName];
        if (!table) return { success: false, message: "ไม่พบชีต: " + sheetName };

        if (trackingNo && oldSku) {
            const skuCol = table === 'cuts' ? 'sku' : 'old_sku';
            const { data, error: selErr } = await sbClient.from(table).select('id')
                .ilike('tracking_no', String(trackingNo).trim())
                .ilike(skuCol, String(oldSku).trim())
                .limit(1);
            if (selErr) throw selErr;
            if (!data || data.length === 0) return { success: false, message: "ไม่พบข้อมูลที่ตรงกันในชีตเพื่อทำการลบ" };
            const { error: delErr } = await sbClient.from(table).delete().eq('id', data[0].id);
            if (delErr) throw delErr;
            return { success: true, message: "ลบรายการเรียบร้อยแล้ว" };
        }

        if (rowIndex && Number(rowIndex) > 0) {
            const { error } = await sbClient.from(table).delete().eq('id', Number(rowIndex));
            if (error) throw error;
            return { success: true, message: "ลบรายการเรียบร้อยแล้ว" };
        }

        return { success: false, message: "ตำแหน่งแถวหรือข้อมูลไม่ถูกต้อง" };
    } catch (err) {
        return { success: false, message: "เกิดข้อผิดพลาด: " + (err.message || String(err)) };
    }
}

// ==========================================================
//  action = importExcelToOrdersSheet ("ทำ ฟวย")
// ==========================================================
async function sbImportExcelToOrdersSheet(payload) {
    try {
        if (!payload || !payload.headers || !payload.rows) {
            return { success: false, message: "ข้อมูลไฟล์ไม่ถูกต้อง" };
        }
        const headers = payload.headers.map(h => String(h || '').trim());
        const rows = payload.rows;

        // ชีต Orders เดิมเป็นสูตร QUERY ดึงคอลัมน์ A,B,D,E จากชีต "ลงข้อมูล" อัตโนมัติ
        // (Tracking, ชื่อ SKU Merchant, SKU Merchant, จำนวน) จึงต้องสร้างรายการออเดอร์จากไฟล์เดียวกันนี้ด้วย
        const orderRows = [];
        rows.forEach(r => {
            const trackingNo = String((r && r[0]) || '').trim();
            const sku = String((r && (r[3] || r[1])) || '').trim();
            if (!trackingNo || !sku) return;
            orderRows.push({ tracking_no: trackingNo, sku, qty: Number(r[4]) || 1 });
        });

        const { error } = await sbClient.from('fuay_upload').update({
            headers, rows, updated_at: new Date().toISOString()
        }).eq('id', 1);
        if (error) throw error;

        const { error: delErr } = await sbClient.from('order_items').delete().gte('id', 0);
        if (delErr) throw delErr;
        for (let i = 0; i < orderRows.length; i += 500) {
            const { error: insErr } = await sbClient.from('order_items').insert(orderRows.slice(i, i + 500));
            if (insErr) throw insErr;
        }

        return {
            success: true,
            message: `นำเข้าข้อมูลใหม่ ${rows.length} แถว เข้าสู่ระบบ "ทำ ฟวย" และอัปเดตรายการออเดอร์ ${orderRows.length} แถวเรียบร้อยแล้ว`
        };
    } catch (err) {
        return { success: false, message: "เกิดข้อผิดพลาด: " + (err.message || String(err)) };
    }
}

// ==========================================================
//  action = cleanupOrphanStatusRows (ไม่มี caller ในหน้าเว็บปัจจุบัน แต่คงไว้เพื่อความครบถ้วน)
// ==========================================================
async function sbCleanupOrphanStatusRows() {
    return { success: true, message: "ไม่มีข้อมูลค้างที่ต้องล้าง (โครงสร้างฐานข้อมูลใหม่บังคับ tracking_no ไม่ให้ว่างอยู่แล้ว)" };
}

// ==========================================================
//  action = addCheckedTracking
// ==========================================================
async function sbAddCheckedTracking(trackingNo) {
    try {
        if (!trackingNo || String(trackingNo).trim() === '') {
            return { success: false, message: "กรุณากรอกหมายเลข Tracking" };
        }
        const trimmed = String(trackingNo).trim();
        const { error } = await sbClient.from('checked_trackings').insert({ tracking_no: trimmed });
        if (error) {
            if (error.code === '23505') {
                return { success: false, message: `❌ หมายเลข "${trimmed}" มีอยู่ในรายการเช็คแล้ว ไม่สามารถเพิ่มซ้ำได้` };
            }
            throw error;
        }
        return { success: true, message: `✅ บันทึก "${trimmed}" เรียบร้อยแล้ว` };
    } catch (err) {
        return { success: false, message: "เกิดข้อผิดพลาด: " + (err.message || String(err)) };
    }
}

// ==========================================================
//  จุดเรียกรวม เทียบเท่า doGet/doPost ของ Apps Script เดิม
// ==========================================================
// ==========================================================
//  ประวัติการยิงสแกนเนอร์ (scan_log)
// ==========================================================
async function sbLogScans(rows) {
    try {
        if (!rows || !rows.length) return { success: true, added: 0 };
        const { error } = await sbClient.from('scan_log').insert(rows);
        if (error) throw error;
        return { success: true, added: rows.length };
    } catch (err) {
        return { success: false, message: err.message || String(err) };
    }
}

// params: { fromISO, toISO, q, limit }
async function sbGetScanLog(params) {
    try {
        const p = params || {};
        let query = sbClient.from('scan_log').select('id, code, kind, page, input_id, machine, created_at').order('created_at', { ascending: false });
        if (p.fromISO) query = query.gte('created_at', p.fromISO);
        if (p.toISO) query = query.lt('created_at', p.toISO);
        if (p.q) query = query.ilike('code', '%' + String(p.q).replace(/[%_]/g, '') + '%');
        const { data, error } = await query.limit(p.limit || 500);
        if (error) throw error;
        return {
            success: true,
            rows: (data || []).map(r => ({ id: r.id, code: r.code, kind: r.kind, page: r.page, inputId: r.input_id, machine: r.machine, time: sbFormatBangkok(r.created_at) }))
        };
    } catch (err) {
        return { success: false, message: err.message || String(err), rows: [] };
    }
}

async function sbApiGet(action, params) {
    switch (action) {
        case 'getAllData': return await sbGetAllData();
        case 'getFuayData': return await sbGetFuayData();
        case 'getScanLog': return await sbGetScanLog(params);
        default: return { success: false, message: 'ไม่รู้จัก action: ' + action };
    }
}

async function sbApiPost(action, payload) {
    payload = payload || {};
    switch (action) {
        case 'updateQCStatus': return await sbUpdateQCStatus(payload.trackingNo, payload.status, payload.inspectionStatus);
        case 'resetQCStatus': return await sbResetQCStatus(payload.trackingNo);
        case 'saveSubstitute': return await sbSaveSubstitute(payload);
        case 'addProduct': return await sbAddProduct(payload);
        case 'updateProduct': return await sbUpdateProduct(payload);
        case 'clearProducts': return await sbClearProducts();
        case 'clearCheckedTrackings': return await sbClearCheckedTrackings();
        case 'importProducts': return await sbImportProducts(payload);
        case 'deleteOrderItem': return await sbDeleteOrderItem(payload);
        case 'deleteRowBySheetAndIndex': return await sbDeleteRowBySheetAndIndex(payload.sheetName, payload.rowIndex, payload.trackingNo, payload.oldSku);
        case 'importExcelToOrdersSheet': return await sbImportExcelToOrdersSheet(payload);
        case 'cleanupOrphanStatusRows': return await sbCleanupOrphanStatusRows();
        case 'addCheckedTracking': return await sbAddCheckedTracking(payload.trackingNo);
        case 'logScans': return await sbLogScans(payload.rows);
        default: return { success: false, message: 'ไม่รู้จัก action: ' + action };
    }
}
