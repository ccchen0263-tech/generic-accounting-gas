/**
 * 單據匣：上傳發票／收據照片 → 文字辨識（Google 雲端硬碟內建 OCR，免費）→ 規則整理 → 驗證 → 人工校正 → 入帳
 * 也可匯入財政部「電子發票整合服務平台」下載的進項發票檔。
 *
 * 資料：
 *   單據      — 每張單據一列：解析後的欄位、欄位來源、驗證結果、扣抵判定、狀態
 *   單據原文  — OCR 原始文字（與解析結果分開，可用來重新解析）
 *   原始檔案  — 部署者（業主）雲端硬碟：主檔所在資料夾／會計單據／<公司代碼 公司名稱>
 *
 * 入帳一律經過 postDocVoucher_ → saveVoucherCore_（借貸平衡、鎖帳、開帳日、科目啟用檢查），沒有其他捷徑。
 * 文字辨識需要在 Apps Script「服務」加入 Drive API（appsscript.json 已設定，clasp 推送會自動加入）。
 */
var DOC_MAX_BYTES = 10 * 1024 * 1024;
var DOC_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
var DOC_STATUS = { PENDING: '待處理', POSTED: '已入帳', SKIPPED: '略過', DUPLICATE: '重複' };
var DOC_KINDS = ['統一發票（有統編）', '統一發票', '電子發票', '收據', '其他'];
var DOC_BATCH_MAX = 20;
var DOC_TEXT_CHUNK = 40000;
/** 這些付款科目屬於轉帳傳票（沒有現金或存款進出） */
var TRANSFER_PAY_CODES = ['2131', '2193', '1142'];

function docsSheetReady_() {
  var ss = ss_();
  [SHEETS.DOCS, SHEETS.DOC_TEXT].forEach(function (n) { if (!ss.getSheetByName(n)) ensureSheet_(ss, n); });
}

function hasDocsSheet_() {
  try { return !!ss_().getSheetByName(SHEETS.DOCS); } catch (e) { return false; }
}

function parseJson_(s, fallback) {
  if (!s) return fallback;
  try { var v = JSON.parse(s); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
}

function docFromObj_(o) {
  var deductible = str_(o['扣抵判定']);
  return {
    id: str_(o['單據編號']), source: str_(o['來源']), kind: str_(o['種類']), status: str_(o['狀態']),
    date: str_(o['日期']), invoiceNo: str_(o['發票號碼']), sellerName: str_(o['賣方名稱']),
    sellerTaxId: str_(o['賣方統編']), buyerTaxId: str_(o['買方統編']),
    net: toAmount_(o['未稅金額']) || 0, tax: toAmount_(o['稅額']) || 0, total: toAmount_(o['總金額']) || 0,
    src: parseJson_(str_(o['欄位來源']), {}), level: str_(o['驗證等級']) || '正常', issues: parseJson_(str_(o['驗證結果']), []),
    deductible: DEDUCT_STATES.indexOf(deductible) >= 0 ? deductible : '未判定', hint: str_(o['扣抵建議']),
    suggest: str_(o['建議科目']), fileName: str_(o['檔名']), fileId: str_(o['檔案ID']),
    voucherNo: str_(o['傳票號碼']), note: str_(o['備註']),
    uploadedBy: str_(o['上傳者']), uploadedAt: str_(o['上傳時間']),
    confirmedBy: str_(o['確認者']), confirmedAt: str_(o['確認時間']),
    doneBy: str_(o['處理者']), doneAt: str_(o['處理時間']),
    rev: Number(o['版本']) || 1, parserVersion: Number(o['解析版本']) || 0, _row: o._row
  };
}

function docToObj_(d) {
  return {
    '單據編號': d.id, '來源': d.source, '種類': d.kind, '狀態': d.status, '日期': d.date,
    '發票號碼': d.invoiceNo, '賣方名稱': d.sellerName, '賣方統編': d.sellerTaxId, '買方統編': d.buyerTaxId,
    '未稅金額': d.net || 0, '稅額': d.tax || 0, '總金額': d.total || 0,
    '欄位來源': JSON.stringify(d.src || {}), '驗證等級': d.level || '正常', '驗證結果': JSON.stringify(d.issues || []),
    '扣抵判定': d.deductible || '未判定', '扣抵建議': d.hint || '', '建議科目': d.suggest || '',
    '檔名': d.fileName || '', '檔案ID': d.fileId || '', '傳票號碼': d.voucherNo || '', '備註': d.note || '',
    '上傳者': d.uploadedBy || '', '上傳時間': d.uploadedAt || '', '確認者': d.confirmedBy || '', '確認時間': d.confirmedAt || '',
    '處理者': d.doneBy || '', '處理時間': d.doneAt || '', '版本': d.rev || 1, '解析版本': d.parserVersion || 0
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

function saveDoc_(d) {
  updateRow_(SHEETS.DOCS, d._row, docToObj_(d));
}

/** OCR 原文另存：太長的文字切成多列 */
function saveDocText_(id, engine, text) {
  var t = String(text || '');
  var rows = [], now = nowText_();
  for (var i = 0; i === 0 || i * DOC_TEXT_CHUNK < t.length; i++) {
    rows.push({ '單據編號': id, '引擎': engine, '段落': i + 1, '原始文字': t.slice(i * DOC_TEXT_CHUNK, (i + 1) * DOC_TEXT_CHUNK), '擷取時間': now });
  }
  appendObjects_(SHEETS.DOC_TEXT, rows);
}

function loadDocText_(id) {
  try { if (!ss_().getSheetByName(SHEETS.DOC_TEXT)) return ''; } catch (e) { return ''; }
  return readObjects_(SHEETS.DOC_TEXT).filter(function (o) { return str_(o['單據編號']) === id; })
    .sort(function (a, b) { return Number(a['段落']) - Number(b['段落']); })
    .map(function (o) { return String(o['原始文字'] === undefined ? '' : o['原始文字']); }).join('');
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

/** 驗證需要的公司狀態（一次讀好，給多張單據共用） */
function docCtx_(docs) {
  var settings = loadSettings_();
  return {
    settings: settings, ownTaxId: settings.taxId, openingDate: settings.openingDate,
    lockedPeriods: lockedPeriodsMap_(), today: todayText_(), index: buildDocIndex_(docs)
  };
}

function checkDoc_(d, ctx) {
  d.issues = validateDoc_(d, ctx);
  d.level = docLevel_(d.issues);
  return d;
}

function hintText_(d, settings, expense) {
  var h = deductibleHint_(d, settings, expense);
  return '建議' + h.suggest + '：' + h.reason;
}

/** 給畫面用的單據資料（清單不帶原文，避免太大） */
function docView_(d, ctx, enabled) {
  var suggest = enabled[d.suggest] ? d.suggest : suggestExpense_(d.sellerName, ctx.settings.industries, enabled);
  var hint = deductibleHint_(d, ctx.settings, suggest);
  return {
    id: d.id, source: d.source, kind: d.kind, status: d.status, date: d.date, invoiceNo: d.invoiceNo,
    sellerName: d.sellerName, sellerTaxId: d.sellerTaxId, buyerTaxId: d.buyerTaxId,
    net: d.net, tax: d.tax, total: d.total, src: d.src, level: d.level, issues: d.issues,
    deductible: d.deductible, hintSuggest: hint.suggest, hintReason: hint.reason, suggest: suggest,
    fileName: d.fileName, hasFile: !!d.fileId, voucherNo: d.voucherNo, note: d.note,
    uploadedBy: d.uploadedBy, uploadedAt: d.uploadedAt, confirmedBy: d.confirmedBy, confirmedAt: d.confirmedAt,
    doneBy: d.doneBy, doneAt: d.doneAt, rev: d.rev,
    open: d.status === DOC_STATUS.PENDING || d.status === DOC_STATUS.DUPLICATE
  };
}

function payAccounts_(enabled) {
  return PAY_ACCOUNTS.filter(function (x) { return enabled[x[0]]; }).map(function (x) { return { code: x[0], label: x[1] }; });
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
    var meta = { name: 'OCR暫存_' + blob.getName(), mimeType: 'application/vnd.google-apps.document' };
    // Drive API v3 的語言提示只接受 ISO 639-1 兩碼（zh），寫 zh-TW 會被拒絕「Invalid Value」；
    // 萬一還是被拒，就不帶提示讓 Google 自動判斷
    try { tmp = Drive.Files.create(meta, blob, { ocrLanguage: 'zh' }); }
    catch (e1) { tmp = Drive.Files.create(meta, blob); }
    return { text: DocumentApp.openById(tmp.id).getBody().getText(), error: '' };
  } catch (e) {
    return { text: '', error: '文字辨識失敗（' + e.message + '），請手動輸入內容' };
  } finally {
    if (tmp && tmp.id) { try { Drive.Files.remove(tmp.id); } catch (e2) { try { DriveApp.getFileById(tmp.id).setTrashed(true); } catch (e3) { /* 忽略 */ } } }
  }
}

/** OCR 結果好不好：失敗、文字太少或讀不到金額日期 */
function ocrState_(ocr, parsed) {
  if (ocr.error) return 'failed';
  if (String(ocr.text).replace(/\s/g, '').length < 20 || (!parsed.total && !parsed.date)) return 'weak';
  return 'ok';
}

/** 同一張發票是否已經有了（不含已略過的） */
function duplicateOf_(docs, invoiceNo) {
  if (!invoiceNo) return null;
  return docs.filter(function (d) { return d.invoiceNo === invoiceNo && d.status !== DOC_STATUS.SKIPPED; })[0] || null;
}

// ───────────── API：查詢 ─────────────

/** 分頁：待處理（含重複）、異常（待處理中有錯誤或警示）、已入帳、略過、全部 */
HANDLERS.listDocs = function (p) {
  var tab = str_(p.status) || '待處理';
  var kw = str_(p.keyword).toLowerCase();
  var enabled = enabledCodeMap_();
  var docs = loadDocs_();
  var ctx = docCtx_(docs);
  docs.forEach(function (d) { checkDoc_(d, ctx); });
  var isOpen = function (d) { return d.status === DOC_STATUS.PENDING || d.status === DOC_STATUS.DUPLICATE; };
  var isBad = function (d) { return isOpen(d) && (d.level === '錯誤' || d.level === '警示'); };
  var counts = { '待處理': 0, '異常': 0, '已入帳': 0, '略過': 0 };
  docs.forEach(function (d) {
    if (isOpen(d)) counts['待處理']++;
    if (isBad(d)) counts['異常']++;
    if (d.status === DOC_STATUS.POSTED) counts['已入帳']++;
    if (d.status === DOC_STATUS.SKIPPED) counts['略過']++;
  });
  var list = docs.filter(function (d) {
    if (tab === '待處理' && !isOpen(d)) return false;
    if (tab === '異常' && !isBad(d)) return false;
    if ((tab === '已入帳' || tab === '略過') && d.status !== tab) return false;
    if (kw && [d.id, d.invoiceNo, d.sellerName, d.sellerTaxId, d.voucherNo, d.fileName, d.note].join(' ').toLowerCase().indexOf(kw) < 0) return false;
    return true;
  }).reverse().slice(0, 300).map(function (d) { return docView_(d, ctx, enabled); });
  return { status: tab, counts: counts, docs: list, payAccounts: payAccounts_(enabled), kinds: DOC_KINDS, batchMax: DOC_BATCH_MAX };
};

/** 一張單據的完整資料（含 OCR 原文）；帶 expense、pay 時一併回傳建議分錄 */
HANDLERS.getDoc = function (p) {
  var docs = loadDocs_();
  var d = docs.filter(function (x) { return x.id === str_(p.id); })[0];
  if (!d) throw new Error('找不到單據 ' + p.id);
  var ctx = docCtx_(docs);
  var enabled = enabledCodeMap_();
  checkDoc_(d, ctx);
  var v = docView_(d, ctx, enabled);
  v.text = loadDocText_(d.id);
  v.item = itemNameOf_(v.text);
  v.payAccounts = payAccounts_(enabled);
  v.kinds = DOC_KINDS;
  if (p.expense && p.pay) {
    var deductible = DEDUCT_STATES.indexOf(str_(p.deductible)) >= 0 ? str_(p.deductible) : d.deductible;
    v.lines = docToLines_({ total: d.total, tax: d.tax, sellerName: d.sellerName, deductible: deductible }, str_(p.expense), str_(p.pay), enabled);
    v.voucherType = TRANSFER_PAY_CODES.indexOf(str_(p.pay)) >= 0 ? '轉帳' : '支出';
    v.memo = docMemo_(d, v.item);
  }
  return v;
};

/** 讀單據原始檔：圖片直接回傳；PDF 回傳第一頁縮圖＋原檔 */
HANDLERS.docFile = function (p) {
  var d = findDoc_(p.id);
  if (!d.fileId) throw new Error('這張單據是財政部匯入，沒有原始檔');
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

// ───────────── API：建立 ─────────────

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
  parsed.src._ocr = ocrState_(ocr, parsed);
  var suggest = suggestExpense_(parsed.sellerName + '\n' + ocr.text, settings.industries, enabledCodeMap_());

  return withLock_(function () {
    var docs = loadDocs_();
    var dup = duplicateOf_(docs, parsed.invoiceNo);
    var d = {
      id: nextDocIds_(docs, 1)[0], source: '拍照上傳', kind: parsed.kind,
      status: dup ? DOC_STATUS.DUPLICATE : DOC_STATUS.PENDING,
      date: parsed.date, invoiceNo: parsed.invoiceNo, sellerName: parsed.sellerName,
      sellerTaxId: parsed.sellerTaxId, buyerTaxId: parsed.buyerTaxId,
      net: parsed.net, tax: parsed.tax, total: parsed.total, src: parsed.src,
      deductible: '未判定', suggest: suggest, fileName: name, fileId: file.getId(),
      note: dup ? '與 ' + dup.id + ' 的發票號碼相同' : ocr.error,
      uploadedBy: s.username, uploadedAt: nowText_(), rev: 1, parserVersion: PARSER_VERSION
    };
    d.hint = hintText_(d, settings, suggest);
    checkDoc_(d, docCtx_(docs.concat([d])));
    appendObjects_(SHEETS.DOCS, [docToObj_(d)]);
    saveDocText_(d.id, 'Google 雲端硬碟 OCR', ocr.text);
    log_(s.username, '上傳單據', d.id + ' ' + name + (d.total ? ' 金額 ' + d.total : ''));
    return { id: d.id, status: d.status, level: d.level, kind: d.kind, date: d.date, total: d.total, sellerName: d.sellerName, note: d.note };
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
    var made = fresh.map(function (r, i) {
      var src = { invoiceNo: '匯入', date: '匯入', sellerName: '匯入', sellerTaxId: '匯入', buyerTaxId: '匯入', net: '匯入', tax: '匯入', total: '匯入' };
      // 進項發票檔本來就是本公司的進項；檔案沒有買方欄時以本公司統編補上，並標示推算
      if (!r.buyerTaxId) src.buyerTaxId = '推算';
      var suggest = suggestExpense_(r.sellerName + '\n' + (r.items || ''), settings.industries, enabled);
      var d = {
        id: ids[i], source: '財政部匯入', kind: '電子發票', status: DOC_STATUS.PENDING,
        date: r.date, invoiceNo: r.invoiceNo, sellerName: r.sellerName, sellerTaxId: r.sellerTaxId, buyerTaxId: r.buyerTaxId || settings.taxId,
        net: r.net, tax: r.tax, total: r.total, src: src, deductible: '未判定', suggest: suggest,
        fileName: str_(p.fileName).slice(0, 80), uploadedBy: s.username, uploadedAt: now, rev: 1, parserVersion: PARSER_VERSION
      };
      d.hint = hintText_(d, settings, suggest);
      return d;
    });
    var ctx = docCtx_(docs.concat(made));
    appendObjects_(SHEETS.DOCS, made.map(function (d) { return docToObj_(checkDoc_(d, ctx)); }));
    // 財政部檔有品項明細（D 列）時，把品名存成原文，傳票摘要就能寫「買了什麼」
    var texts = [];
    fresh.forEach(function (r, i) { if (r.items) texts.push({ '單據編號': made[i].id, '引擎': '財政部匯入', '段落': 1, '原始文字': '品名：' + r.items, '擷取時間': now }); });
    if (texts.length) appendObjects_(SHEETS.DOC_TEXT, texts);
    log_(s.username, '匯入進項發票', str_(p.fileName) + '：新增 ' + made.length + ' 張，重複 ' + dups.length + ' 張，略過 ' + parsed.skipped.length + ' 列');
    return { added: made.length, duplicates: dups, skipped: parsed.skipped };
  });
};

// ───────────── API：人工校正 ─────────────

function openDocOrThrow_(d) {
  if (d.status === DOC_STATUS.POSTED) throw new Error('單據 ' + d.id + ' 已入帳（傳票 ' + d.voucherNo + '），不能修改；需要修改請先作廢傳票');
  if (d.status === DOC_STATUS.SKIPPED) throw new Error('單據 ' + d.id + ' 已略過，請先改回待處理');
}

/** 檢查並整理人工輸入的欄位；格式不對直接拒絕（統編檢查碼不對只警示，不拒絕） */
function cleanDocFields_(f, enabled) {
  var out = {}, errors = [];
  var has = function (k) { return Object.prototype.hasOwnProperty.call(f, k); };
  if (has('kind')) { if (DOC_KINDS.indexOf(str_(f.kind)) < 0) errors.push('種類不正確'); else out.kind = str_(f.kind); }
  if (has('date')) { var dt = str_(f.date); if (dt && !isValidDate_(dt)) errors.push('日期格式需為 yyyy-MM-dd'); else out.date = dt; }
  if (has('invoiceNo')) { var no = str_(f.invoiceNo).toUpperCase().replace(/[\s\-－]/g, ''); if (no && !/^[A-Z]{2}\d{8}$/.test(no)) errors.push('發票號碼需為 2 個英文字母＋8 碼數字'); else out.invoiceNo = no; }
  if (has('sellerName')) out.sellerName = str_(f.sellerName).slice(0, 60);
  ['sellerTaxId', 'buyerTaxId'].forEach(function (k) {
    if (!has(k)) return;
    var v = str_(f[k]);
    if (v && !/^\d{8}$/.test(v)) errors.push(DOC_FIELD_NAMES[k] + '需為 8 碼數字'); else out[k] = v;
  });
  ['net', 'tax', 'total'].forEach(function (k) {
    if (!has(k)) return;
    var n = toAmount_(f[k]);
    if (isNaN(n) || n < 0 || Math.round(n) !== n) errors.push(DOC_FIELD_NAMES[k] + '需為 0 以上的整數'); else out[k] = n;
  });
  if (has('deductible')) { if (DEDUCT_STATES.indexOf(str_(f.deductible)) < 0) errors.push('扣抵判定不正確'); else out.deductible = str_(f.deductible); }
  if (has('suggest')) { var c = str_(f.suggest); if (c && !enabled[c]) errors.push('科目 ' + c + ' 不存在或已停用'); else out.suggest = c; }
  if (errors.length) throw new Error(errors.join('\n'));
  return out;
}

/** 人工修改辨識欄位：改過的欄位標記「人工」，重新驗證；版本不同（別人剛改過）會被拒絕 */
HANDLERS.updateDoc = function (p, s) {
  return withLock_(function () {
    var docs = loadDocs_();
    var d = docs.filter(function (x) { return x.id === str_(p.id); })[0];
    if (!d) throw new Error('找不到單據 ' + p.id);
    openDocOrThrow_(d);
    if (Number(p.rev) !== d.rev) throw new Error('這張單據剛被其他人修改過，請重新開啟後再改');
    var enabled = enabledCodeMap_();
    var f = cleanDocFields_(p.fields || {}, enabled);
    var changes = [];
    DOC_FIELDS.concat(['deductible', 'suggest']).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(f, k) || String(f[k]) === String(d[k])) return;
      changes.push((DOC_FIELD_NAMES[k] || (k === 'deductible' ? '扣抵判定' : '科目')) + '：' + (d[k] === '' ? '（空）' : d[k]) + ' → ' + (f[k] === '' ? '（空）' : f[k]));
      d[k] = f[k];
      d.src[k] = '人工'; // 科目也記來源：重新解析不會蓋掉人工選的科目
    });
    var settings = loadSettings_();
    d.hint = hintText_(d, settings, d.suggest);
    if (changes.length || p.confirm) { d.confirmedBy = s.username; d.confirmedAt = nowText_(); }
    d.rev += 1;
    var ctx = docCtx_(docs);
    checkDoc_(d, ctx);
    saveDoc_(d);
    if (changes.length) log_(s.username, '修改單據', d.id + '：' + changes.join('；'));
    return docView_(d, ctx, enabled);
  });
};

/** 用保存的 OCR 原文重跑解析規則；人工改過的欄位不會被覆蓋 */
HANDLERS.reparseDoc = function (p, s) {
  return withLock_(function () {
    var docs = loadDocs_();
    var d = docs.filter(function (x) { return x.id === str_(p.id); })[0];
    if (!d) throw new Error('找不到單據 ' + p.id);
    openDocOrThrow_(d);
    if (d.source !== '拍照上傳') throw new Error('只有拍照上傳的單據可以重新解析');
    var settings = loadSettings_();
    var parsed = parseReceiptText_(loadDocText_(d.id), { taxId: settings.taxId, name: settings.companyName });
    var kept = [];
    DOC_FIELDS.forEach(function (k) {
      if (d.src[k] === '人工') { kept.push(DOC_FIELD_NAMES[k]); return; }
      d[k] = parsed[k];
      if (parsed.src[k]) d.src[k] = parsed.src[k]; else delete d.src[k];
    });
    d.parserVersion = PARSER_VERSION;
    // 原本只是「雜費／消耗品」這種找不到規則的預設科目時，依新規則重新建議
    if (d.src.suggest !== '人工' && (!d.suggest || d.suggest === '6399' || d.suggest === '6361')) {
      var re = suggestExpense_(d.sellerName + '\n' + loadDocText_(d.id), settings.industries, enabledCodeMap_());
      if (re) d.suggest = re;
    }
    d.rev += 1;
    d.hint = hintText_(d, settings, d.suggest);
    var ctx = docCtx_(docs);
    checkDoc_(d, ctx);
    saveDoc_(d);
    log_(s.username, '重新解析單據', d.id + (kept.length ? '（保留人工欄位：' + kept.join('、') + '）' : ''));
    return docView_(d, ctx, enabledCodeMap_());
  });
};

HANDLERS.skipDoc = function (p, s) {
  return withLock_(function () {
    var d = findDoc_(p.id);
    if (d.status === DOC_STATUS.POSTED) throw new Error('此單據已入帳（傳票 ' + d.voucherNo + '），請先作廢傳票');
    var reason = str_(p.reason);
    if (!reason) throw new Error('請填寫略過原因');
    d.status = DOC_STATUS.SKIPPED; d.note = reason; d.doneBy = s.username; d.doneAt = nowText_(); d.rev += 1;
    saveDoc_(d);
    log_(s.username, '略過單據', d.id + '：' + reason);
    return { id: d.id };
  });
};

/** 略過或重複 → 待處理。必填原因；就算改回待處理，同號發票已入帳時仍然不能入帳（DUP_POSTED） */
HANDLERS.restoreDoc = function (p, s) {
  return withLock_(function () {
    var d = findDoc_(p.id);
    if (d.status !== DOC_STATUS.SKIPPED && d.status !== DOC_STATUS.DUPLICATE) throw new Error('只有「略過」或「重複」的單據可以改回待處理');
    var reason = str_(p.reason);
    if (!reason) throw new Error('請填寫改回待處理的原因');
    d.status = DOC_STATUS.PENDING; d.note = '改回待處理：' + reason; d.doneBy = s.username; d.doneAt = nowText_(); d.rev += 1;
    saveDoc_(d);
    log_(s.username, '單據改回待處理', d.id + '：' + reason);
    return { id: d.id };
  });
};

// ───────────── 入帳 ─────────────

/**
 * 單據入帳的唯一入口（呼叫端必須已取得鎖）。
 * 重新讀取並驗證 → 有「錯誤」不能入帳 → 有「警示」須已核對 → 扣抵須人工判定 → 組分錄 → saveVoucherCore_ → 標記已入帳
 * p = { docId, rev, expense, pay, deductible, ackWarnings: [核對過的警示 key], lines?, date?, type?, memo? }
 *   rev：畫面核對時的版本；單據之後被別人改過（版本不同）就拒絕，避免用沒看過的資料入帳
 *   ackWarnings：畫面上顯示並勾選核對的警示 key；目前的警示只要有一項不在清單內就拒絕
 *   lines 有給（傳票編輯器自己改過分錄）就用畫面的分錄，否則由伺服器依單據組分錄
 */
function postDocVoucher_(p, s) {
  var docs = loadDocs_();
  var d = docs.filter(function (x) { return x.id === str_(p.docId); })[0];
  if (!d) throw new Error('找不到單據 ' + p.docId);
  if (d.status === DOC_STATUS.POSTED) throw new Error('單據 ' + d.id + ' 已經入帳（傳票 ' + d.voucherNo + '）');
  if (d.status === DOC_STATUS.SKIPPED) throw new Error('單據 ' + d.id + ' 已略過，請先改回待處理');
  if (Number(p.rev) !== d.rev) throw new Error(d.id + ' 在你核對之後被修改過（版本 ' + p.rev + ' → ' + d.rev + '），請重新開啟核對後再入帳');
  checkDoc_(d, docCtx_(docs));
  var errs = d.issues.filter(function (i) { return i.level === '錯誤'; });
  if (errs.length) throw new Error(d.id + ' 不能入帳：' + errs.map(function (i) { return i.msg; }).join('；'));
  var acked = Array.isArray(p.ackWarnings) ? p.ackWarnings.map(String) : [];
  var unacked = d.issues.filter(function (i) { return i.level === '警示' && acked.indexOf(i.key) < 0; });
  if (unacked.length) throw new Error(d.id + ' 有 ' + unacked.length + ' 項警示尚未核對：' + unacked.map(function (i) { return i.msg; }).join('；'));
  var deductible = str_(p.deductible) || d.deductible;
  if (deductible !== '可扣抵' && deductible !== '不可扣抵') throw new Error(d.id + ' 請先判定進項稅額是否可扣抵');

  var enabled = enabledCodeMap_();
  var expense = str_(p.expense) || d.suggest;
  var lines = p.lines, type = str_(p.type);
  if (!lines || !lines.length) {
    var pay = str_(p.pay);
    if (!enabled[expense]) throw new Error(d.id + ' 請選擇費用科目');
    if (!enabled[pay] || !PAY_ACCOUNTS.some(function (x) { return x[0] === pay; })) throw new Error(d.id + ' 請選擇付款方式');
    lines = docToLines_({ total: d.total, tax: d.tax, sellerName: d.sellerName, deductible: deductible }, expense, pay, enabled);
    if (!type) type = TRANSFER_PAY_CODES.indexOf(pay) >= 0 ? '轉帳' : '支出';
  }
  var r = saveVoucherCore_({ date: str_(p.date) || d.date, type: type || '支出', memo: str_(p.memo).slice(0, 100) || docMemo_(d, itemNameOf_(loadDocText_(d.id))), lines: lines, source: '單據' }, s);

  var now = nowText_();
  if (deductible !== d.deductible) d.src.deductible = '人工';
  d.deductible = deductible;
  if (enabled[expense]) d.suggest = expense;
  d.status = DOC_STATUS.POSTED; d.voucherNo = r.no;
  if (!d.confirmedBy) { d.confirmedBy = s.username; d.confirmedAt = now; }
  d.doneBy = s.username; d.doneAt = now; d.rev += 1;
  d.issues = d.issues.filter(function (i) { return i.level !== '提示'; });
  d.level = docLevel_(d.issues);
  saveDoc_(d);
  log_(s.username, '單據入帳', d.id + ' → 傳票 ' + r.no + '（' + deductible + '）');
  return { id: d.id, no: r.no, debit: r.debit };
}

/** 批次確認入帳：一張一張經過 postDocVoucher_，一張失敗不影響其他張 */
HANDLERS.postDocs = function (p, s) {
  var items = (p.items || []).filter(function (x) { return x && x.id; });
  if (!items.length) throw new Error('請勾選要入帳的單據');
  if (items.length > DOC_BATCH_MAX) throw new Error('一次最多 ' + DOC_BATCH_MAX + ' 張，請分批確認');
  var results = items.map(function (it) {
    try {
      var r = withLock_(function () {
        return postDocVoucher_({ docId: it.id, rev: it.rev, expense: it.expense, pay: it.pay, deductible: it.deductible, ackWarnings: it.ackWarnings, memo: it.memo }, s);
      });
      return { id: it.id, ok: true, no: r.no };
    } catch (e) {
      return { id: it.id, ok: false, error: e.message };
    }
  });
  var ok = results.filter(function (r) { return r.ok; }).length;
  log_(s.username, '批次入帳單據', '成功 ' + ok + ' 張，失敗 ' + (results.length - ok) + ' 張');
  return { ok: ok, failed: results.length - ok, results: results };
};

/** 傳票作廢時：連結的單據改回待處理，可以重新入帳 */
function releaseDocsOf_(voucherNo, s) {
  loadDocs_().filter(function (d) { return d.voucherNo === voucherNo && d.status === DOC_STATUS.POSTED; }).forEach(function (d) {
    d.status = DOC_STATUS.PENDING; d.voucherNo = ''; d.note = '傳票 ' + voucherNo + ' 已作廢';
    d.doneBy = s.username; d.doneAt = nowText_(); d.rev += 1;
    saveDoc_(d);
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
