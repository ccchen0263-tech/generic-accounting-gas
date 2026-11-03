/**
 * 單據匣：上傳發票／收據照片 → 文字辨識（Google 雲端硬碟內建 OCR，免費）→ 產生草稿 → 確認後入帳
 * 也可匯入財政部「電子發票整合服務平台」下載的進項發票檔。
 *
 * 原始檔案存在部署者（業主）雲端硬碟：主檔所在資料夾／會計單據／<公司代碼 公司名稱>
 * 文字辨識需要在 Apps Script「服務」加入 Drive API（appsscript.json 已設定，clasp 推送會自動加入）。
 */
var DOC_MAX_BYTES = 10 * 1024 * 1024;
var DOC_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
var DOC_STATUS = { PENDING: '待處理', POSTED: '已入帳', SKIPPED: '略過', DUPLICATE: '重複' };

function docsSheetReady_() {
  var ss = ss_();
  if (!ss.getSheetByName(SHEETS.DOCS)) ensureSheet_(ss, SHEETS.DOCS);
}

function hasDocsSheet_() {
  try { return !!ss_().getSheetByName(SHEETS.DOCS); } catch (e) { return false; }
}

function docFromObj_(o) {
  return {
    id: str_(o['單據編號']), source: str_(o['來源']), kind: str_(o['種類']), status: str_(o['狀態']),
    date: str_(o['日期']), invoiceNo: str_(o['發票號碼']), sellerName: str_(o['賣方名稱']),
    sellerTaxId: str_(o['賣方統編']), buyerTaxId: str_(o['買方統編']),
    net: toAmount_(o['未稅金額']) || 0, tax: toAmount_(o['稅額']) || 0, total: toAmount_(o['總金額']) || 0,
    deductible: str_(o['可扣抵']) === '是', suggest: str_(o['建議科目']),
    fileName: str_(o['檔名']), fileId: str_(o['檔案ID']), text: str_(o['辨識文字']),
    voucherNo: str_(o['傳票號碼']), note: str_(o['備註']),
    uploadedBy: str_(o['上傳者']), uploadedAt: str_(o['上傳時間']),
    doneBy: str_(o['處理者']), doneAt: str_(o['處理時間']), _row: o._row
  };
}

function docToObj_(d) {
  return {
    '單據編號': d.id, '來源': d.source, '種類': d.kind, '狀態': d.status, '日期': d.date,
    '發票號碼': d.invoiceNo, '賣方名稱': d.sellerName, '賣方統編': d.sellerTaxId, '買方統編': d.buyerTaxId,
    '未稅金額': d.net || 0, '稅額': d.tax || 0, '總金額': d.total || 0, '可扣抵': d.deductible ? '是' : '否',
    '建議科目': d.suggest || '', '檔名': d.fileName || '', '檔案ID': d.fileId || '', '辨識文字': String(d.text || '').slice(0, 5000),
    '傳票號碼': d.voucherNo || '', '備註': d.note || '', '上傳者': d.uploadedBy || '', '上傳時間': d.uploadedAt || '',
    '處理者': d.doneBy || '', '處理時間': d.doneAt || ''
  };
}

function loadDocs_() {
  if (!hasDocsSheet_()) return [];
  return readObjects_(SHEETS.DOCS).map(docFromObj_).filter(function (d) { return d.id; });
}

function findDoc_(id) {
  var d = loadDocs_().filter(function (x) { return x.id === str_(id); })[0];
  if (!d) throw new Error('找不到單據 ' + id);
  return d;
}

/** 單據編號 D202611-0001（依上傳月份流水號） */
function nextDocIds_(docs, count) {
  var period = todayText_().slice(0, 7).replace('-', '');
  var prefix = 'D' + period + '-';
  var max = 0;
  docs.forEach(function (d) { if (d.id.indexOf(prefix) === 0) { var n = Number(d.id.slice(prefix.length)); if (n > max) max = n; } });
  var out = [];
  for (var i = 1; i <= count; i++) out.push(prefix + pad_(max + i, 4));
  return out;
}

/** 已啟用科目的對照表 */
function enabledCodeMap_() {
  var m = {};
  loadAccounts_().forEach(function (a) { if (a.enabled) m[a.code] = a; });
  return m;
}

/** 單據放在哪個雲端硬碟資料夾：主檔所在資料夾／會計單據／C01 公司名稱 */
function docFolder_() {
  var props = PropertiesService.getScriptProperties();
  var key = 'DOC_FOLDER_' + (CTX.company ? CTX.company.id : 'MAIN');
  var id = props.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 資料夾被刪除：重建 */ } }
  var parents = DriveApp.getFileById(hubSs_().getId()).getParents();
  var base = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var root = childFolder_(base, '會計單據');
  var name = CTX.company ? CTX.company.id + ' ' + CTX.company.name : '主檔';
  var folder = childFolder_(root, name);
  props.setProperty(key, folder.getId());
  return folder;
}

function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Google 雲端硬碟內建文字辨識：圖片或 PDF 轉成 Google 文件時順便讀出文字，讀完刪除暫存文件 */
function ocrBlob_(blob) {
  if (typeof Drive === 'undefined' || !Drive.Files) return { text: '', error: '尚未啟用文字辨識（Apps Script「服務」需加入 Drive API），請手動輸入內容' };
  var tmp = null;
  try {
    tmp = Drive.Files.create({ name: 'OCR暫存_' + blob.getName(), mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'zh-TW' });
    return { text: DocumentApp.openById(tmp.id).getBody().getText(), error: '' };
  } catch (e) {
    return { text: '', error: '文字辨識失敗（' + e.message + '），請手動輸入內容' };
  } finally {
    if (tmp && tmp.id) { try { Drive.Files.remove(tmp.id); } catch (e2) { try { DriveApp.getFileById(tmp.id).setTrashed(true); } catch (e3) { /* 忽略 */ } } }
  }
}

/** 同一張發票是否已經有了（不含已略過的） */
function duplicateOf_(docs, invoiceNo) {
  if (!invoiceNo) return null;
  return docs.filter(function (d) { return d.invoiceNo === invoiceNo && d.status !== DOC_STATUS.SKIPPED; })[0] || null;
}

// ───────────── API ─────────────

HANDLERS.listDocs = function (p) {
  var status = str_(p.status) || DOC_STATUS.PENDING;
  var kw = str_(p.keyword).toLowerCase();
  var enabled = enabledCodeMap_();
  var settings = loadSettings_();
  var docs = loadDocs_();
  var counts = { '待處理': 0, '已入帳': 0, '略過': 0 };
  docs.forEach(function (d) { var k = d.status === DOC_STATUS.DUPLICATE ? '待處理' : d.status; if (counts[k] !== undefined) counts[k]++; });
  var list = docs.filter(function (d) {
    if (status === '待處理' && d.status !== DOC_STATUS.PENDING && d.status !== DOC_STATUS.DUPLICATE) return false;
    if (status !== '待處理' && status !== '全部' && d.status !== status) return false;
    if (kw && [d.id, d.invoiceNo, d.sellerName, d.sellerTaxId, d.voucherNo, d.fileName, d.note].join(' ').toLowerCase().indexOf(kw) < 0) return false;
    return true;
  }).reverse().slice(0, 300).map(function (d) {
    var suggest = enabled[d.suggest] ? d.suggest : suggestExpense_(d.sellerName + '\n' + d.text, settings.industries, enabled);
    return {
      id: d.id, source: d.source, kind: d.kind, status: d.status, date: d.date, invoiceNo: d.invoiceNo,
      sellerName: d.sellerName, sellerTaxId: d.sellerTaxId, buyerTaxId: d.buyerTaxId,
      net: d.net, tax: d.tax, total: d.total, deductible: d.deductible, suggest: suggest,
      fileName: d.fileName, hasFile: !!d.fileId, text: d.text, voucherNo: d.voucherNo, note: d.note,
      uploadedBy: d.uploadedBy, uploadedAt: d.uploadedAt, doneBy: d.doneBy, doneAt: d.doneAt
    };
  });
  return {
    status: status, counts: counts, docs: list,
    payAccounts: PAY_ACCOUNTS.filter(function (x) { return enabled[x[0]]; }).map(function (x) { return { code: x[0], label: x[1] }; })
  };
};

/** 上傳一張單據（前端一次送一個檔案，圖片已在手機上壓縮） */
HANDLERS.uploadDoc = function (p, s) {
  var name = str_(p.name).replace(/[\\\/:*?"<>|]/g, '_').slice(0, 80) || '單據';
  var type = str_(p.mimeType).toLowerCase();
  if (DOC_TYPES.indexOf(type) < 0) throw new Error('「' + name + '」格式不支援，請上傳 JPG、PNG 照片或 PDF');
  var bytes = Utilities.base64Decode(str_(p.data));
  if (!bytes.length) throw new Error('「' + name + '」是空的檔案');
  if (bytes.length > DOC_MAX_BYTES) throw new Error('「' + name + '」超過 10MB，請拍小一點或分開上傳');

  docsSheetReady_();
  var settings = loadSettings_();
  var stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmmss');
  var blob = Utilities.newBlob(bytes, type, stamp + '_' + name);
  var file = docFolder_().createFile(blob);

  // 文字辨識需要幾秒，放在鎖外面，避免卡住其他人
  var ocr = ocrBlob_(blob);
  var parsed = parseReceiptText_(ocr.text, { taxId: settings.taxId, name: settings.companyName });
  var suggest = suggestExpense_(parsed.sellerName + '\n' + ocr.text, settings.industries, enabledCodeMap_());

  return withLock_(function () {
    var docs = loadDocs_();
    var dup = duplicateOf_(docs, parsed.invoiceNo);
    var d = {
      id: nextDocIds_(docs, 1)[0], source: '拍照上傳', kind: parsed.kind,
      status: dup ? DOC_STATUS.DUPLICATE : DOC_STATUS.PENDING,
      date: parsed.date, invoiceNo: parsed.invoiceNo, sellerName: parsed.sellerName,
      sellerTaxId: parsed.sellerTaxId, buyerTaxId: parsed.buyerTaxId,
      net: parsed.net, tax: parsed.tax, total: parsed.total, deductible: !!parsed.buyerTaxId,
      suggest: suggest, fileName: name, fileId: file.getId(), text: ocr.text,
      note: dup ? '與 ' + dup.id + ' 的發票號碼相同' : ocr.error,
      uploadedBy: s.username, uploadedAt: nowText_()
    };
    appendObjects_(SHEETS.DOCS, [docToObj_(d)]);
    log_(s.username, '上傳單據', d.id + ' ' + name + (d.total ? ' 金額 ' + d.total : ''));
    return { id: d.id, status: d.status, kind: d.kind, date: d.date, total: d.total, sellerName: d.sellerName, note: d.note };
  });
};

/** 匯入財政部進項發票檔（前端讀成文字後送來） */
HANDLERS.importInvoices = function (p, s) {
  var parsed = parseInvoiceCsv_(str_(p.text));
  if (!parsed.rows.length) throw new Error('檔案中沒有可匯入的發票' + (parsed.skipped.length ? '：\n' + parsed.skipped.slice(0, 5).join('\n') : ''));
  docsSheetReady_();
  var settings = loadSettings_();
  var enabled = enabledCodeMap_();
  return withLock_(function () {
    var docs = loadDocs_();
    var seen = {};
    var fresh = [], dups = [];
    parsed.rows.forEach(function (r) {
      if (seen[r.invoiceNo] || duplicateOf_(docs, r.invoiceNo)) { dups.push(r.invoiceNo); return; }
      seen[r.invoiceNo] = true;
      fresh.push(r);
    });
    var ids = nextDocIds_(docs, fresh.length);
    var now = nowText_();
    var objs = fresh.map(function (r, i) {
      return docToObj_({
        id: ids[i], source: '財政部匯入', kind: '電子發票', status: DOC_STATUS.PENDING,
        date: r.date, invoiceNo: r.invoiceNo, sellerName: r.sellerName, sellerTaxId: r.sellerTaxId, buyerTaxId: r.buyerTaxId || settings.taxId,
        net: r.net, tax: r.tax, total: r.total, deductible: r.tax > 0,
        suggest: suggestExpense_(r.sellerName, settings.industries, enabled), fileName: str_(p.fileName).slice(0, 80),
        uploadedBy: s.username, uploadedAt: now
      });
    });
    appendObjects_(SHEETS.DOCS, objs);
    log_(s.username, '匯入進項發票', str_(p.fileName) + '：新增 ' + objs.length + ' 張，重複 ' + dups.length + ' 張，略過 ' + parsed.skipped.length + ' 列');
    return { added: objs.length, duplicates: dups, skipped: parsed.skipped };
  });
};

HANDLERS.skipDoc = function (p, s) {
  return withLock_(function () {
    var d = findDoc_(p.id);
    if (d.status === DOC_STATUS.POSTED) throw new Error('此單據已入帳（傳票 ' + d.voucherNo + '），請先作廢傳票');
    var reason = str_(p.reason);
    if (!reason) throw new Error('請填寫略過原因');
    updateCells_(SHEETS.DOCS, d._row, { '狀態': DOC_STATUS.SKIPPED, '備註': reason, '處理者': s.username, '處理時間': nowText_() });
    log_(s.username, '略過單據', d.id + '：' + reason);
    return { id: d.id };
  });
};

HANDLERS.restoreDoc = function (p, s) {
  return withLock_(function () {
    var d = findDoc_(p.id);
    if (d.status !== DOC_STATUS.SKIPPED && d.status !== DOC_STATUS.DUPLICATE) throw new Error('只有「略過」或「重複」的單據可以改回待處理');
    updateCells_(SHEETS.DOCS, d._row, { '狀態': DOC_STATUS.PENDING, '處理者': s.username, '處理時間': nowText_() });
    log_(s.username, '單據改回待處理', d.id);
    return { id: d.id };
  });
};

/** 讀單據原始檔：圖片直接回傳；PDF 回傳第一頁縮圖＋原檔 */
HANDLERS.docFile = function (p) {
  var d = findDoc_(p.id);
  if (!d.fileId) throw new Error('這張單據是財政部匯入，沒有照片');
  var file = DriveApp.getFileById(d.fileId);
  var blob = file.getBlob();
  var type = blob.getContentType();
  var out = { id: d.id, name: d.fileName, mimeType: type };
  if (type === 'application/pdf') {
    out.pdf = Utilities.base64Encode(blob.getBytes());
    try { var th = file.getThumbnail(); out.image = 'data:' + th.getContentType() + ';base64,' + Utilities.base64Encode(th.getBytes()); } catch (e) { out.image = ''; }
  } else {
    out.image = 'data:' + type + ';base64,' + Utilities.base64Encode(blob.getBytes());
  }
  return out;
};

/** 傳票入帳時：確認單據可以用（在鎖內呼叫） */
function docForVoucher_(id) {
  var d = findDoc_(id);
  if (d.status === DOC_STATUS.POSTED) throw new Error('單據 ' + d.id + ' 已經入帳（傳票 ' + d.voucherNo + '）');
  if (d.status === DOC_STATUS.SKIPPED) throw new Error('單據 ' + d.id + ' 已略過，請先改回待處理');
  return d;
}

function markDocPosted_(d, voucherNo, s) {
  updateCells_(SHEETS.DOCS, d._row, { '狀態': DOC_STATUS.POSTED, '傳票號碼': voucherNo, '處理者': s.username, '處理時間': nowText_() });
}

/** 傳票作廢時：連結的單據改回待處理，可以重新入帳 */
function releaseDocsOf_(voucherNo, s) {
  loadDocs_().filter(function (d) { return d.voucherNo === voucherNo && d.status === DOC_STATUS.POSTED; }).forEach(function (d) {
    updateCells_(SHEETS.DOCS, d._row, { '狀態': DOC_STATUS.PENDING, '傳票號碼': '', '備註': '傳票 ' + voucherNo + ' 已作廢', '處理者': s.username, '處理時間': nowText_() });
  });
}

/** 傳票列表用：傳票號碼 → 單據 */
function docsByVoucher_() {
  var m = {};
  loadDocs_().forEach(function (d) {
    if (!d.voucherNo || d.status !== DOC_STATUS.POSTED) return;
    (m[d.voucherNo] = m[d.voucherNo] || []).push({ id: d.id, name: d.fileName || d.invoiceNo, hasFile: !!d.fileId, invoiceNo: d.invoiceNo });
  });
  return m;
}
