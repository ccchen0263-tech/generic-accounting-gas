/**
 * 試算表讀寫層：所有工作表存取都集中在這裡
 */
/**
 * 目前這次操作所屬的公司（由 api() 依登入者與切換的公司設定）
 * company = { id, name, spreadsheetId }；null 代表集團主檔本身
 */
var CTX = { company: null, ssCache: {}, memo: null, lockDepth: 0 };

/**
 * 同一次 API 呼叫內的讀取暫存（api() 開始時建立、結束時清掉）：
 * 同一張工作表在一次操作中只讀一次；任何寫入都會清掉該表的暫存；
 * 取得鎖（withLock_）時整個清空，確保鎖內一定讀到最新資料。
 */
function beginRequestMemo_() {
  CTX.memo = { tables: {}, hubId: '' };
  CTX.lockDepth = 0;
}

function endRequestMemo_() {
  CTX.memo = null;
  CTX.lockDepth = 0;
}

/** 帳號、公司清單、公司權限：每次 API 都要查，存在 CacheService 共用（寫入時立即清除；直接改試算表最多 60 秒後生效） */
var TABLE_CACHE_SHEETS = ['公司清單', '_帳號', '_公司權限'];
var TABLE_CACHE_SECONDS = 60;
var TABLE_CACHE_PREFIX = 'tbl1_';

/** 集團主檔：程式綁定的那份試算表 */
function hubSs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('找不到試算表，請先在試算表中執行「初始設定」');
  return SpreadsheetApp.openById(id);
}

/** 網頁與試算表選單顯示的系統名稱：各客戶自訂（指令碼屬性 APP_NAME），沒設定就用公版預設 */
function appName_() {
  var name = '';
  try { name = str_(PropertiesService.getScriptProperties().getProperty('APP_NAME')); } catch (e) { name = ''; }
  return name || APP.name;
}

function setAppName_(name) {
  PropertiesService.getScriptProperties().setProperty('APP_NAME', name);
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

/** 讀整張表：回傳 { headers, rows }，rows 為二維陣列（不含標題列）。回傳值請當唯讀使用（會被暫存共用） */
function readTable_(name) {
  var key = CTX.memo ? memoKey_(name) : '';
  if (key && CTX.memo.tables[key]) return CTX.memo.tables[key];
  var shared = TABLE_CACHE_SHEETS.indexOf(name) >= 0;
  // 鎖內不用共用暫存，一定讀試算表
  var t = shared && !CTX.lockDepth ? getCachedTable_(name) : null;
  if (!t) {
    t = readSheetTable_(name);
    if (shared) putCachedTable_(name, t);
  }
  if (key) CTX.memo.tables[key] = t;
  return t;
}

function readSheetTable_(name) {
  var sh = sheet_(name);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: HEADERS[name].slice(), rows: [] };
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  return { headers: values[0].map(String), rows: values.slice(1) };
}

/** 暫存的鍵：試算表 ID＋工作表名稱（集團主檔本身也是第一家公司，用同一個 ID 才不會重複） */
function memoKey_(name) {
  if (!CTX.memo.hubId) CTX.memo.hubId = hubSs_().getId();
  var ssId = HUB_SHEETS.indexOf(name) >= 0 || !CTX.company ? CTX.memo.hubId : CTX.company.spreadsheetId;
  return ssId + '|' + name;
}

function getCachedTable_(name) {
  try {
    var raw = CacheService.getScriptCache().get(TABLE_CACHE_PREFIX + name);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function putCachedTable_(name, t) {
  try {
    // 日期物件先轉成文字（讀取端一律用 str_ 處理，結果相同）
    var rows = t.rows.map(function (r) { return r.map(function (v) { return Object.prototype.toString.call(v) === '[object Date]' ? str_(v) : v; }); });
    var raw = JSON.stringify({ headers: t.headers, rows: rows });
    if (raw.length < 90000) CacheService.getScriptCache().put(TABLE_CACHE_PREFIX + name, raw, TABLE_CACHE_SECONDS);
  } catch (e) { /* 暫存失敗不影響讀取 */ }
}

/** 寫入後清掉暫存（本次呼叫的暫存與共用暫存） */
function invalidateTable_(name) {
  if (CTX.memo) delete CTX.memo.tables[memoKey_(name)];
  if (TABLE_CACHE_SHEETS.indexOf(name) >= 0) {
    try { CacheService.getScriptCache().remove(TABLE_CACHE_PREFIX + name); } catch (e) { /* 忽略 */ }
  }
}

/** 建立或改動工作表結構時：清掉本次呼叫所有讀取暫存 */
function invalidateAllTables_() {
  if (CTX.memo) CTX.memo.tables = {};
  TABLE_CACHE_SHEETS.forEach(function (n) {
    try { CacheService.getScriptCache().remove(TABLE_CACHE_PREFIX + n); } catch (e) { /* 忽略 */ }
  });
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
  try {
    var start = sh.getLastRow() + 1;
    ensureRows_(sh, name, start + rows.length - 1);
    sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
  } finally { invalidateTable_(name); }
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
  updateCellsMany_(name, [rowNumber], patch);
}

/**
 * 多列套用同一組欄位值（例如作廢一張傳票的每一行）。
 * 標題只讀一次；相鄰的列、相鄰的欄合併成一次寫入；只寫 patch 裡的欄位，其他欄位不動。
 */
function updateCellsMany_(name, rowNumbers, patch) {
  if (!rowNumbers || !rowNumbers.length) return;
  var sh = sheet_(name);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var cols = Object.keys(patch).map(function (h) {
    var col = headers.indexOf(h);
    if (col < 0) throw new Error('欄位「' + h + '」不存在');
    return { col: col + 1, value: cellValue_(patch[h]) };
  }).sort(function (a, b) { return a.col - b.col; });
  var colRuns = [];
  cols.forEach(function (c) {
    var last = colRuns[colRuns.length - 1];
    if (last && last.start + last.values.length === c.col) last.values.push(c.value);
    else colRuns.push({ start: c.col, values: [c.value] });
  });
  var rows = rowNumbers.map(Number).filter(function (r, i, a) { return r >= 2 && a.indexOf(r) === i; }).sort(function (a, b) { return a - b; });
  var rowRuns = [];
  rows.forEach(function (r) {
    var last = rowRuns[rowRuns.length - 1];
    if (last && last.start + last.count === r) last.count++;
    else rowRuns.push({ start: r, count: 1 });
  });
  try {
    rowRuns.forEach(function (rr) {
      colRuns.forEach(function (cr) {
        var data = [];
        for (var i = 0; i < rr.count; i++) data.push(cr.values.slice());
        sh.getRange(rr.start, cr.start, rr.count, cr.values.length).setValues(data);
      });
    });
  } finally { invalidateTable_(name); }
}

/**
 * 整列更新：先讀出該列，再依標題把 obj 有的欄位換掉，一次寫回（比逐格寫快很多）
 * obj 沒有的欄位保留原值
 */
function updateRow_(name, rowNumber, obj) {
  var sh = sheet_(name);
  var width = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
  var range = sh.getRange(rowNumber, 1, 1, width);
  var row = range.getValues()[0];
  headers.forEach(function (h, i) { if (Object.prototype.hasOwnProperty.call(obj, h)) row[i] = cellValue_(obj[h]); else row[i] = cellValue_(row[i]); });
  try { range.setValues([row]); } finally { invalidateTable_(name); }
}

/** 刪除指定列（由下往上刪，連續列一次刪） */
function deleteRowNumbers_(name, rowNumbers) {
  if (!rowNumbers.length) return;
  var sh = sheet_(name);
  var sorted = rowNumbers.slice().sort(function (a, b) { return b - a; });
  var i = 0;
  try {
    while (i < sorted.length) {
      var end = sorted[i], start = end, j = i + 1;
      while (j < sorted.length && sorted[j] === start - 1) { start = sorted[j]; j++; }
      sh.deleteRows(start, end - start + 1);
      i = j;
    }
  } finally { invalidateTable_(name); }
}

/** 清空資料列並整批寫入 */
function replaceAll_(name, objs) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  try {
    if (last > 1) sh.getRange(2, 1, last - 1, HEADERS[name].length).clearContent();
    if (objs.length) {
      var rows = objs.map(function (o) { return toRow_(name, o); });
      ensureRows_(sh, name, rows.length + 1);
      sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    }
  } finally { invalidateTable_(name); }
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
  // 鎖內一律重新讀取（別人可能在我們拿到鎖之前改過資料）
  CTX.lockDepth = (CTX.lockDepth || 0) + 1;
  if (CTX.memo) CTX.memo.tables = {};
  try { return fn(); } finally {
    CTX.lockDepth--;
    if (CTX.memo) CTX.memo.tables = {};
    lock.releaseLock();
  }
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

/**
 * 目前有效的傳票分錄（含作廢，供傳票列表顯示）。
 * 狀態「已修改」的列是修改前的舊內容：保留在試算表供查核，不屬於任何帳簿與報表，這裡一律排除。
 */
function loadLines_() {
  return readObjects_(SHEETS.VOUCHERS).map(lineFromObj_).filter(function (l) { return l.no && l.status !== VOUCHER_SUPERSEDED; });
}

/** 修改前的舊分錄（查核用） */
function loadSupersededLines_(no) {
  return readObjects_(SHEETS.VOUCHERS).map(lineFromObj_).filter(function (l) { return l.no === no && l.status === VOUCHER_SUPERSEDED; });
}

// ───────────── 期間 ─────────────

function loadPeriods_() {
  return readObjects_(SHEETS.PERIODS).map(function (o) {
    return { period: str_(o['期間']), status: str_(o['狀態']), lockedBy: str_(o['鎖定人']), lockedAt: str_(o['鎖定時間']), _row: o._row };
  }).filter(function (p) { return p.period; });
}

/** 標記為「已鎖定」的月份（期間表上實際的紀錄） */
function explicitLocks_() {
  var m = {};
  loadPeriods_().forEach(function (p) { if (p.status === '已鎖定') m[p.period] = true; });
  return m;
}

/** 實際鎖定的月份：最晚鎖帳月份（含）以前全部鎖定，見 expandLocks_ */
function lockedPeriodsMap_() {
  return expandLocks_(explicitLocks_(), loadSettings_().openingDate);
}

// ───────────── 操作紀錄 ─────────────

function log_(user, action, detail) {
  try {
    appendObjects_(SHEETS.LOG, [{ '時間': nowText_(), '帳號': user || '', '動作': action, '內容': typeof detail === 'string' ? detail : JSON.stringify(detail), '公司': CTX.company ? CTX.company.name : '' }]);
  } catch (e) {
    // 紀錄失敗不影響主要操作
  }
}
