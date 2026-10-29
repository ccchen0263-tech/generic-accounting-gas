/**
 * 試算表讀寫層：所有工作表存取都集中在這裡
 */
/**
 * 目前這次操作所屬的公司（由 api() 依登入者與切換的公司設定）
 * company = { id, name, spreadsheetId }；null 代表集團主檔本身
 */
var CTX = { company: null, ssCache: {} };

/** 集團主檔：程式綁定的那份試算表 */
function hubSs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('找不到試算表，請先在試算表中執行「初始設定」');
  return SpreadsheetApp.openById(id);
}

/** 目前公司的試算表 */
function ss_() {
  var c = CTX.company;
  var hub = hubSs_();
  if (!c || c.spreadsheetId === hub.getId()) return hub;
  if (!CTX.ssCache[c.spreadsheetId]) CTX.ssCache[c.spreadsheetId] = SpreadsheetApp.openById(c.spreadsheetId);
  return CTX.ssCache[c.spreadsheetId];
}

function sheet_(name) {
  var sh = (HUB_SHEETS.indexOf(name) >= 0 ? hubSs_() : ss_()).getSheetByName(name);
  if (!sh) throw new Error('找不到工作表「' + name + '」，請先執行初始設定');
  return sh;
}

/** 讀整張表：回傳 { headers, rows }，rows 為二維陣列（不含標題列） */
function readTable_(name) {
  var sh = sheet_(name);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: HEADERS[name].slice(), rows: [] };
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  return { headers: values[0].map(String), rows: values.slice(1) };
}

/** 讀成物件陣列，key 為中文欄名，並附上 _row（試算表列號） */
function readObjects_(name) {
  var t = readTable_(name);
  return t.rows.map(function (r, i) {
    var o = { _row: i + 2 };
    t.headers.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  }).filter(function (o) {
    return t.headers.some(function (h) { return o[h] !== '' && o[h] !== null; });
  });
}

/**
 * 寫入試算表前的保護：以「=」「+」開頭的文字會被試算表當成公式執行，
 * 前面加單引號強制存成純文字（試算表讀回時不含單引號）
 */
function cellValue_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' && /^[=+]/.test(v)) return "'" + v;
  return v;
}

/** 依標題順序把物件轉成列 */
function toRow_(name, obj) {
  return HEADERS[name].map(function (h) { return cellValue_(obj[h]); });
}

function appendObjects_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var rows = objs.map(function (o) { return toRow_(name, o); });
  var start = sh.getLastRow() + 1;
  ensureRows_(sh, name, start + rows.length - 1);
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

/** 列數不夠時一次多加 500 列，並把文字欄位設為純文字格式 */
function ensureRows_(sh, name, lastNeeded) {
  var max = sh.getMaxRows();
  if (lastNeeded <= max) return;
  var add = lastNeeded - max + 500;
  sh.insertRowsAfter(max, add);
  var headers = HEADERS[name] || [];
  (TEXT_COLUMNS[name] || []).forEach(function (h) {
    var col = headers.indexOf(h) + 1;
    if (col > 0) sh.getRange(max + 1, col, add, 1).setNumberFormat('@');
  });
}

/** 更新指定列的部分欄位 */
function updateCells_(name, rowNumber, patch) {
  var sh = sheet_(name);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  Object.keys(patch).forEach(function (h) {
    var col = headers.indexOf(h);
    if (col < 0) throw new Error('欄位「' + h + '」不存在');
    sh.getRange(rowNumber, col + 1, 1, 1).setValues([[cellValue_(patch[h])]]);
  });
}

/** 刪除指定列（由下往上刪，連續列一次刪） */
function deleteRowNumbers_(name, rowNumbers) {
  if (!rowNumbers.length) return;
  var sh = sheet_(name);
  var sorted = rowNumbers.slice().sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < sorted.length) {
    var end = sorted[i], start = end, j = i + 1;
    while (j < sorted.length && sorted[j] === start - 1) { start = sorted[j]; j++; }
    sh.deleteRows(start, end - start + 1);
    i = j;
  }
}

/** 清空資料列並整批寫入 */
function replaceAll_(name, objs) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, HEADERS[name].length).clearContent();
  if (objs.length) {
    var rows = objs.map(function (o) { return toRow_(name, o); });
    ensureRows_(sh, name, rows.length + 1);
    sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function nowText_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
}

function todayText_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ───────────── 公司設定 ─────────────

function loadSettings_() {
  var raw = {};
  readObjects_(SHEETS.SETTINGS).forEach(function (o) { raw[str_(o['項目'])] = str_(o['值']); });
  return {
    companyName: raw['公司名稱'] || '',
    taxId: raw['統一編號'] || '',
    industries: (raw['產業類別'] || '通用').split(/[,，、]/).map(str_).filter(String),
    vatType: raw['營業稅類型'] || '一般稅額',
    fyStartMonth: Number(raw['會計年度起始月']) || 1,
    openingDate: raw['開帳日'] || ''
  };
}

function saveSettings_(s) {
  var map = {
    '公司名稱': s.companyName,
    '統一編號': s.taxId,
    '產業類別': (s.industries || []).join(','),
    '營業稅類型': s.vatType,
    '會計年度起始月': String(s.fyStartMonth),
    '開帳日': s.openingDate
  };
  var rows = readObjects_(SHEETS.SETTINGS);
  Object.keys(map).forEach(function (k) {
    var row = rows.filter(function (r) { return str_(r['項目']) === k; })[0];
    if (row) updateCells_(SHEETS.SETTINGS, row._row, { '值': map[k] });
    else appendObjects_(SHEETS.SETTINGS, [{ '項目': k, '值': map[k], '說明': '' }]);
  });
}

// ───────────── 科目 ─────────────

function accountFromObj_(o) {
  return {
    code: str_(o['科目代碼']), name: str_(o['科目名稱']), category: str_(o['類別']),
    normal: str_(o['正常餘額']), block: str_(o['報表區塊']), industries: str_(o['適用產業']),
    stockCost: str_(o['盤點對應成本科目']),
    enabled: o['啟用'] === true || str_(o['啟用']) === 'TRUE' || str_(o['啟用']) === '是',
    source: str_(o['來源']), note: str_(o['說明']), _row: o._row
  };
}

function accountToObj_(a) {
  var block = BLOCKS[a.block];
  return {
    '科目代碼': a.code, '科目名稱': a.name, '類別': block ? block.category : a.category,
    '正常餘額': a.normal || (block ? block.normal : ''), '報表區塊': a.block, '適用產業': a.industries || '',
    '盤點對應成本科目': a.stockCost || '', '啟用': a.enabled ? '是' : '否', '來源': a.source || '自訂', '說明': a.note || ''
  };
}

function loadAccounts_() {
  return readObjects_(SHEETS.ACCOUNTS).map(accountFromObj_).filter(function (a) { return a.code; });
}

function loadReference_() {
  return readObjects_(SHEETS.REF).map(function (o) {
    return {
      code: str_(o['科目代碼']), name: str_(o['科目名稱']), category: str_(o['類別']),
      normal: str_(o['正常餘額']), block: str_(o['報表區塊']), industries: str_(o['適用產業']),
      stockCost: str_(o['盤點對應成本科目']), note: str_(o['說明'])
    };
  }).filter(function (a) { return a.code; });
}

// ───────────── 期初餘額 ─────────────

function loadOpening_() {
  return readObjects_(SHEETS.OPENING).map(function (o) {
    return { code: str_(o['科目代碼']), name: str_(o['科目名稱']), debit: toAmount_(o['借方']) || 0, credit: toAmount_(o['貸方']) || 0 };
  }).filter(function (o) { return o.code && (o.debit || o.credit); });
}

// ───────────── 傳票 ─────────────

function lineFromObj_(o) {
  return {
    no: str_(o['傳票號碼']), date: str_(o['日期']), type: str_(o['類型']), lineNo: Number(o['行號']) || 0,
    code: str_(o['科目代碼']), name: str_(o['科目名稱']),
    debit: toAmount_(o['借方']) || 0, credit: toAmount_(o['貸方']) || 0,
    memo: str_(o['摘要']), party: str_(o['往來對象']), source: str_(o['來源']), status: str_(o['狀態']) || '有效',
    createdBy: str_(o['建立者']), createdAt: str_(o['建立時間']),
    updatedBy: str_(o['修改者']), updatedAt: str_(o['修改時間']), _row: o._row
  };
}

function loadLines_() {
  return readObjects_(SHEETS.VOUCHERS).map(lineFromObj_).filter(function (l) { return l.no; });
}

// ───────────── 期間 ─────────────

function loadPeriods_() {
  return readObjects_(SHEETS.PERIODS).map(function (o) {
    return { period: str_(o['期間']), status: str_(o['狀態']), lockedBy: str_(o['鎖定人']), lockedAt: str_(o['鎖定時間']), _row: o._row };
  }).filter(function (p) { return p.period; });
}

function lockedPeriodsMap_() {
  var m = {};
  loadPeriods_().forEach(function (p) { if (p.status === '已鎖定') m[p.period] = true; });
  return m;
}

// ───────────── 操作紀錄 ─────────────

function log_(user, action, detail) {
  try {
    appendObjects_(SHEETS.LOG, [{ '時間': nowText_(), '帳號': user || '', '動作': action, '內容': typeof detail === 'string' ? detail : JSON.stringify(detail), '公司': CTX.company ? CTX.company.name : '' }]);
  } catch (e) {
    // 紀錄失敗不影響主要操作
  }
}
