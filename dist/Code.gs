/**
 * 公版會計系統 v0.1.0（手動貼上版，由 tools/build-dist.js 產生，請勿直接修改）
 * 原始碼：https://github.com/ccchen0263-tech/generic-accounting-gas
 */
// ===== 00_Config.js =====
/**
 * 公版會計系統 — 全域設定
 * 所有工作表名稱、欄位、科目分類規則都集中在這裡。
 */
var APP = {
  name: '公版會計系統',
  version: '0.1.0'
};

var SHEETS = {
  SETTINGS: '公司設定',
  REF: '科目參考庫',
  ACCOUNTS: '會計科目',
  OPENING: '期初餘額',
  VOUCHERS: '傳票',
  PERIODS: '期間',
  STOCKTAKE: '月底盤點',
  RPT_TB: '報表_試算表',
  RPT_IS: '報表_損益表',
  RPT_BS: '報表_資產負債表',
  USERS: '_帳號',
  LOG: '_操作紀錄'
};

var HEADERS = {};
HEADERS[SHEETS.SETTINGS] = ['項目', '值', '說明'];
HEADERS[SHEETS.REF] = ['科目代碼', '科目名稱', '類別', '正常餘額', '報表區塊', '適用產業', '盤點對應成本科目', '說明'];
HEADERS[SHEETS.ACCOUNTS] = ['科目代碼', '科目名稱', '類別', '正常餘額', '報表區塊', '適用產業', '盤點對應成本科目', '啟用', '來源', '說明'];
HEADERS[SHEETS.OPENING] = ['科目代碼', '科目名稱', '借方', '貸方'];
HEADERS[SHEETS.VOUCHERS] = ['傳票號碼', '日期', '類型', '行號', '科目代碼', '科目名稱', '借方', '貸方', '摘要', '往來對象', '來源', '狀態', '建立者', '建立時間', '修改者', '修改時間'];
HEADERS[SHEETS.PERIODS] = ['期間', '狀態', '鎖定人', '鎖定時間'];
HEADERS[SHEETS.STOCKTAKE] = ['期間', '存貨科目', '存貨名稱', '帳上金額', '盤點金額', '差額', '對應成本科目', '傳票號碼', '建立者', '建立時間'];
HEADERS[SHEETS.USERS] = ['帳號', '姓名', '角色', '鹽', '密碼雜湊', '啟用', '建立時間', '最後登入'];
HEADERS[SHEETS.LOG] = ['時間', '帳號', '動作', '內容'];

/** 這些欄位一律存成文字，避免代碼前置零或日期被試算表自動轉換 */
var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEETS.REF] = ['科目代碼', '盤點對應成本科目'];
TEXT_COLUMNS[SHEETS.ACCOUNTS] = ['科目代碼', '盤點對應成本科目'];
TEXT_COLUMNS[SHEETS.OPENING] = ['科目代碼'];
TEXT_COLUMNS[SHEETS.VOUCHERS] = ['傳票號碼', '日期', '科目代碼', '建立時間', '修改時間'];
TEXT_COLUMNS[SHEETS.PERIODS] = ['期間', '鎖定時間'];
TEXT_COLUMNS[SHEETS.STOCKTAKE] = ['期間', '存貨科目', '對應成本科目', '傳票號碼', '建立時間'];
TEXT_COLUMNS[SHEETS.USERS] = ['帳號', '建立時間', '最後登入'];
TEXT_COLUMNS[SHEETS.LOG] = ['時間'];
TEXT_COLUMNS[SHEETS.SETTINGS] = ['值'];

/** 公司設定的預設值 */
var DEFAULT_SETTINGS = [
  ['公司名稱', '', '顯示在報表標題'],
  ['統一編號', '', '8 碼'],
  ['產業類別', '通用', '可多選，用「,」分隔：通用、餐飲、食品製造、食品買賣'],
  ['營業稅類型', '一般稅額', '一般稅額（5%，有開統一發票）或 小規模（1%，國稅局查定）'],
  ['會計年度起始月', '1', '1～12，多數公司為 1'],
  ['開帳日', '', '開始用本系統記帳的第一天，例如 2026-01-01；期初餘額以此日為準']
];

/** 可選的產業類別（醫美之後加入） */
var INDUSTRIES = ['通用', '餐飲', '食品製造', '食品買賣'];

/**
 * 報表區塊：決定科目屬於哪個類別、出現在哪張報表、哪一邊為正。
 * sign = 'D' 代表「借方 − 貸方」為正數；'C' 代表「貸方 − 借方」為正數。
 */
var BLOCKS = {
  '流動資產':   { category: '資產', statement: 'BS', sign: 'D', normal: '借', order: 1,  digits: ['1'] },
  '非流動資產': { category: '資產', statement: 'BS', sign: 'D', normal: '借', order: 2,  digits: ['1'] },
  '流動負債':   { category: '負債', statement: 'BS', sign: 'C', normal: '貸', order: 3,  digits: ['2'] },
  '非流動負債': { category: '負債', statement: 'BS', sign: 'C', normal: '貸', order: 4,  digits: ['2'] },
  '權益':       { category: '權益', statement: 'BS', sign: 'C', normal: '貸', order: 5,  digits: ['3'] },
  '營業收入':   { category: '收入', statement: 'IS', sign: 'C', normal: '貸', order: 6,  digits: ['4'] },
  '營業成本':   { category: '成本', statement: 'IS', sign: 'D', normal: '借', order: 7,  digits: ['5'] },
  '營業費用':   { category: '費用', statement: 'IS', sign: 'D', normal: '借', order: 8,  digits: ['6'] },
  '營業外收入': { category: '營業外收入', statement: 'IS', sign: 'C', normal: '貸', order: 9,  digits: ['7'] },
  '營業外支出': { category: '營業外支出', statement: 'IS', sign: 'D', normal: '借', order: 10, digits: ['7'] },
  '所得稅費用': { category: '所得稅', statement: 'IS', sign: 'D', normal: '借', order: 11, digits: ['8'] }
};

var VOUCHER_TYPES = ['收入', '支出', '轉帳'];

var ROLES = ['管理者', '會計', '助理'];

/**
 * 權限表：每個 API 動作允許哪些角色。
 * 助理在第一期只能查看傳票與日記簿；第二期開放上傳單據。
 */
var PERMISSIONS = {
  bootstrap:        ['管理者', '會計', '助理'],
  changePassword:   ['管理者', '會計', '助理'],
  listVouchers:     ['管理者', '會計', '助理'],
  getVoucher:       ['管理者', '會計', '助理'],
  journal:          ['管理者', '會計', '助理'],
  saveVoucher:      ['管理者', '會計'],
  voidVoucher:      ['管理者', '會計'],
  ledger:           ['管理者', '會計'],
  trialBalance:     ['管理者', '會計'],
  incomeStatement:  ['管理者', '會計'],
  balanceSheet:     ['管理者', '會計'],
  dashboard:        ['管理者', '會計'],
  writeReports:     ['管理者', '會計'],
  getOpening:       ['管理者', '會計'],
  saveOpening:      ['管理者', '會計'],
  stocktakePreview: ['管理者', '會計'],
  stocktakeSave:    ['管理者', '會計'],
  stocktakeClear:   ['管理者', '會計'],
  listPeriods:      ['管理者', '會計'],
  lockPeriod:       ['管理者', '會計'],
  unlockPeriod:     ['管理者'],
  listReference:    ['管理者', '會計'],
  addFromReference: ['管理者'],
  addByIndustry:    ['管理者'],
  saveAccount:      ['管理者'],
  toggleAccount:    ['管理者'],
  getSettings:      ['管理者', '會計'],
  saveSettings:     ['管理者'],
  listUsers:        ['管理者'],
  saveUser:         ['管理者'],
  resetPassword:    ['管理者'],
  listLog:          ['管理者']
};

var LOGIN_MAX_FAILS = 5;
var LOGIN_LOCK_SECONDS = 600;
var LOGIN_GLOBAL_SLOWDOWN = 20;
var SESSION_SECONDS = 21600; // 6 小時

// ===== 01_Util.js =====
/**
 * 公用小工具（不使用任何 Google 服務，可在本機測試）
 */
function pad_(n, len) {
  var s = String(n);
  while (s.length < len) s = '0' + s;
  return s;
}

/** 檢查 yyyy-MM-dd 格式且為真實日期 */
function isValidDate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth_(y, m);
}

function daysInMonth_(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** '2026-03' → '2026-03-31' */
function monthEnd_(period) {
  var y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
  return period + '-' + pad_(daysInMonth_(y, m), 2);
}

function monthStart_(period) {
  return period + '-01';
}

function isValidPeriod_(p) {
  return typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}

/** 日期加減天數，回傳 yyyy-MM-dd */
function addDays_(dateStr, days) {
  var t = Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)));
  var d = new Date(t + days * 86400000);
  return d.getUTCFullYear() + '-' + pad_(d.getUTCMonth() + 1, 2) + '-' + pad_(d.getUTCDate(), 2);
}

/** 同一日期往前或往後 n 年（2/29 自動調整為 2/28） */
function addYears_(dateStr, years) {
  var y = Number(dateStr.slice(0, 4)) + years, m = Number(dateStr.slice(5, 7)), d = Number(dateStr.slice(8, 10));
  d = Math.min(d, daysInMonth_(y, m));
  return y + '-' + pad_(m, 2) + '-' + pad_(d, 2);
}

/** 兩個日期間的天數（含頭尾） */
function daySpan_(from, to) {
  var a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  var b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86400000) + 1;
}

/** 會計年度第一天：依起始月計算 date 所屬年度 */
function fiscalYearStart_(dateStr, startMonth) {
  startMonth = Number(startMonth) || 1;
  var y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7));
  if (m < startMonth) y -= 1;
  return y + '-' + pad_(startMonth, 2) + '-01';
}

/** 金額轉整數（新台幣），空白視為 0 */
function toAmount_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : NaN;
}

function round0_(n) {
  return Math.round(n);
}

function str_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    var d = v.getFullYear() + '-' + pad_(v.getMonth() + 1, 2) + '-' + pad_(v.getDate(), 2);
    if (v.getHours() || v.getMinutes() || v.getSeconds()) d += ' ' + pad_(v.getHours(), 2) + ':' + pad_(v.getMinutes(), 2) + ':' + pad_(v.getSeconds(), 2);
    return d;
  }
  return String(v).trim();
}

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    out += pad_(b.toString(16), 2);
  }
  return out;
}

/** 統一編號檢查碼（財政部 2023 起新規則：可被 5 整除；舊規則可被 10 整除仍有效） */
function isValidTaxId_(id) {
  if (!/^\d{8}$/.test(id) || id === '00000000') return false;
  var w = [1, 2, 1, 2, 1, 2, 4, 1];
  var sum = 0;
  for (var i = 0; i < 8; i++) {
    var p = Number(id.charAt(i)) * w[i];
    sum += Math.floor(p / 10) + (p % 10);
  }
  if (sum % 5 === 0) return true;
  if (id.charAt(6) === '7' && (sum + 1) % 5 === 0) return true;
  return false;
}

// ===== 02_ReferenceAccounts.js =====
/**
 * 科目參考庫（公版內建）
 * 格式：[科目代碼, 科目名稱, 報表區塊, 正常餘額, 適用產業, 盤點對應成本科目, 說明]
 * - 正常餘額留空 = 依報表區塊預設；填「借」或「貸」= 抵銷科目（如累計折舊、銷貨退回）
 * - 適用產業用「,」分隔；「通用」代表所有產業都會用到
 * - 盤點對應成本科目：月底盤點時，存貨差額沖回的成本科目
 * 本清單為參考範本，正式使用前請記帳士或會計師確認。
 */
var REFERENCE_ACCOUNTS = [
  // ── 流動資產 ──
  ['1111', '庫存現金', '流動資產', '', '通用', '', '店內收銀與保險箱現金'],
  ['1112', '零用金', '流動資產', '', '通用', '', '小額零用金'],
  ['1113', '銀行存款', '流動資產', '', '通用', '', '各銀行帳戶；可用往來對象區分帳戶'],
  ['1114', '電子支付帳戶', '流動資產', '', '餐飲,食品買賣', '', 'LINE Pay、街口等帳戶餘額'],
  ['1131', '應收票據', '流動資產', '', '通用', '', ''],
  ['1141', '應收帳款', '流動資產', '', '通用', '', '客戶賒帳、月結客戶'],
  ['1142', '應收信用卡款', '流動資產', '', '餐飲,食品買賣', '', '刷卡收入尚未撥款'],
  ['1143', '應收外送平台款', '流動資產', '', '餐飲', '', 'Uber Eats、foodpanda 等待撥款'],
  ['1144', '應收電商平台款', '流動資產', '', '食品製造,食品買賣', '', '蝦皮、momo 等待撥款'],
  ['1151', '其他應收款', '流動資產', '', '通用', '', ''],
  ['1161', '商品存貨', '流動資產', '', '食品買賣', '5121', '買進來直接賣的商品；月底盤點'],
  ['1162', '原料', '流動資產', '', '食品製造', '5131', '生產用原料；月底盤點'],
  ['1163', '物料及包材', '流動資產', '', '食品製造', '5132', '包裝材料、生產耗材；月底盤點'],
  ['1164', '在製品', '流動資產', '', '食品製造', '5161', '生產中尚未完成；月底盤點'],
  ['1165', '製成品', '流動資產', '', '食品製造', '5161', '自製完成待售；月底盤點'],
  ['1166', '食材及飲料存貨', '流動資產', '', '餐飲', '5171', '廚房食材、飲料；月底盤點'],
  ['1171', '用品盤存', '流動資產', '', '通用', '', '未用完的營業用品'],
  ['1181', '預付款項', '流動資產', '', '通用', '', '預付貨款、訂金'],
  ['1182', '預付費用', '流動資產', '', '通用', '', '預付租金、保險費'],
  ['1191', '進項稅額', '流動資產', '', '通用', '', '可扣抵的進項營業稅'],
  ['1192', '留抵稅額', '流動資產', '', '通用', '', '申報後尚未用完的進項稅額'],
  ['1193', '暫付款', '流動資產', '', '通用', '', '用途待確認的付款'],

  // ── 非流動資產 ──
  ['1411', '土地', '非流動資產', '', '通用', '', ''],
  ['1421', '房屋及建築', '非流動資產', '', '通用', '', ''],
  ['1422', '累計折舊－房屋及建築', '非流動資產', '貸', '通用', '', '抵銷科目'],
  ['1431', '機器設備', '非流動資產', '', '食品製造', '', '生產設備'],
  ['1432', '累計折舊－機器設備', '非流動資產', '貸', '食品製造', '', '抵銷科目'],
  ['1441', '生財器具', '非流動資產', '', '通用', '', '餐廚設備、冷凍冷藏櫃、店面設備'],
  ['1442', '累計折舊－生財器具', '非流動資產', '貸', '通用', '', '抵銷科目'],
  ['1451', '運輸設備', '非流動資產', '', '通用', '', '貨車、機車'],
  ['1452', '累計折舊－運輸設備', '非流動資產', '貸', '通用', '', '抵銷科目'],
  ['1461', '辦公設備', '非流動資產', '', '通用', '', '電腦、POS 機'],
  ['1462', '累計折舊－辦公設備', '非流動資產', '貸', '通用', '', '抵銷科目'],
  ['1471', '租賃改良', '非流動資產', '', '通用', '', '承租店面的裝潢工程'],
  ['1472', '累計折舊－租賃改良', '非流動資產', '貸', '通用', '', '抵銷科目'],
  ['1481', '未完工程及預付設備款', '非流動資產', '', '通用', '', ''],
  ['1511', '電腦軟體', '非流動資產', '', '通用', '', ''],
  ['1512', '累計攤銷－電腦軟體', '非流動資產', '貸', '通用', '', '抵銷科目'],
  ['1811', '存出保證金', '非流動資產', '', '通用', '', '店面押金、各項保證金'],

  // ── 流動負債 ──
  ['2111', '短期借款', '流動負債', '', '通用', '', ''],
  ['2121', '應付票據', '流動負債', '', '通用', '', ''],
  ['2131', '應付帳款', '流動負債', '', '通用', '', '供應商月結貨款'],
  ['2141', '應付費用', '流動負債', '', '通用', '', '已發生未付款的費用'],
  ['2142', '應付薪資', '流動負債', '', '通用', '', ''],
  ['2143', '應付勞健保', '流動負債', '', '通用', '', ''],
  ['2144', '應付退休金', '流動負債', '', '通用', '', '勞退提撥'],
  ['2151', '其他應付款', '流動負債', '', '通用', '', ''],
  ['2161', '銷項稅額', '流動負債', '', '通用', '', '銷售時代收的營業稅'],
  ['2162', '應付營業稅', '流動負債', '', '通用', '', ''],
  ['2171', '應付所得稅', '流動負債', '', '通用', '', ''],
  ['2181', '預收貨款', '流動負債', '', '食品製造,食品買賣', '', '預購、團購先收款'],
  ['2182', '預收禮券', '流動負債', '', '餐飲', '', '禮券、儲值金'],
  ['2191', '代收款', '流動負債', '', '通用', '', '代扣所得稅、二代健保'],
  ['2192', '暫收款', '流動負債', '', '通用', '', '用途待確認的收款'],
  ['2193', '股東往來', '流動負債', '', '通用', '', '股東代墊或借給公司的款項'],

  // ── 非流動負債 ──
  ['2411', '長期借款', '非流動負債', '', '通用', '', ''],
  ['2811', '存入保證金', '非流動負債', '', '通用', '', '收到的押金'],

  // ── 權益 ──
  ['3111', '資本', '權益', '', '通用', '', '登記資本額'],
  ['3211', '資本公積', '權益', '', '通用', '', ''],
  ['3311', '法定盈餘公積', '權益', '', '通用', '', ''],
  ['3351', '累積盈虧', '權益', '', '通用', '', '以前年度累積的盈餘或虧損'],
  ['3353', '本期損益', '權益', '', '通用', '', '年度結帳用；平時由系統自動計算'],

  // ── 營業收入 ──
  ['4111', '銷貨收入－自製產品', '營業收入', '', '食品製造', '', '自己生產的產品'],
  ['4112', '銷貨收入－商品', '營業收入', '', '食品買賣', '', '選品買進再賣'],
  ['4121', '餐飲收入－內用', '營業收入', '', '餐飲', '', ''],
  ['4122', '餐飲收入－外帶', '營業收入', '', '餐飲', '', ''],
  ['4123', '餐飲收入－外送平台', '營業收入', '', '餐飲', '', ''],
  ['4124', '外燴及團膳收入', '營業收入', '', '餐飲,食品製造', '', ''],
  ['4131', '銷貨退回', '營業收入', '借', '通用', '', '抵銷科目'],
  ['4132', '銷貨折讓', '營業收入', '借', '通用', '', '抵銷科目'],
  ['4141', '勞務收入', '營業收入', '', '通用', '', ''],
  ['4151', '其他營業收入', '營業收入', '', '通用', '', ''],

  // ── 營業成本 ──
  ['5121', '進貨', '營業成本', '', '食品買賣', '', '商品進貨；月底盤點自動調整'],
  ['5122', '進貨退出及折讓', '營業成本', '貸', '食品買賣', '', '抵銷科目'],
  ['5131', '原料進料', '營業成本', '', '食品製造', '', '月底盤點自動調整'],
  ['5132', '物料及包材進料', '營業成本', '', '食品製造', '', '月底盤點自動調整'],
  ['5141', '直接人工', '營業成本', '', '食品製造', '', '產線人員薪資'],
  ['5151', '製造費用－間接人工', '營業成本', '', '食品製造', '', ''],
  ['5152', '製造費用－水電瓦斯', '營業成本', '', '食品製造', '', '工廠水電瓦斯'],
  ['5153', '製造費用－折舊', '營業成本', '', '食品製造', '', '生產設備折舊'],
  ['5154', '製造費用－租金', '營業成本', '', '食品製造', '', '工廠租金'],
  ['5159', '製造費用－其他', '營業成本', '', '食品製造', '', ''],
  ['5161', '在製品及製成品存貨變動', '營業成本', '', '食品製造', '', '月底盤點自動產生'],
  ['5171', '食材及飲料進貨', '營業成本', '', '餐飲', '', '月底盤點自動調整'],

  // ── 營業費用 ──
  ['6111', '薪資支出', '營業費用', '', '通用', '', ''],
  ['6112', '臨時工資', '營業費用', '', '通用', '', '時薪人員、工讀生'],
  ['6121', '租金支出', '營業費用', '', '通用', '', ''],
  ['6131', '文具用品', '營業費用', '', '通用', '', ''],
  ['6141', '旅費', '營業費用', '', '通用', '', '出差'],
  ['6142', '交通費', '營業費用', '', '通用', '', '停車、計程車、油資'],
  ['6151', '運費', '營業費用', '', '通用', '', '出貨、宅配'],
  ['6161', '郵電費', '營業費用', '', '通用', '', '電話、網路、郵資'],
  ['6171', '修繕費', '營業費用', '', '通用', '', ''],
  ['6181', '廣告費', '營業費用', '', '通用', '', '網路廣告、印刷品'],
  ['6191', '水電瓦斯費', '營業費用', '', '通用', '', ''],
  ['6201', '保險費', '營業費用', '', '通用', '', '勞健保公司負擔、商業保險'],
  ['6211', '交際費', '營業費用', '', '通用', '', '招待客戶；進項稅額不得扣抵'],
  ['6221', '捐贈', '營業費用', '', '通用', '', ''],
  ['6231', '稅捐', '營業費用', '', '通用', '', '印花稅、牌照稅、房屋稅'],
  ['6251', '折舊', '營業費用', '', '通用', '', ''],
  ['6261', '各項攤提', '營業費用', '', '通用', '', ''],
  ['6271', '伙食費', '營業費用', '', '通用', '', '員工伙食'],
  ['6281', '職工福利', '營業費用', '', '通用', '', '員工聚餐、福利品'],
  ['6291', '佣金支出', '營業費用', '', '通用', '', ''],
  ['6301', '訓練費', '營業費用', '', '通用', '', ''],
  ['6311', '退休金', '營業費用', '', '通用', '', '勞退提撥'],
  ['6321', '勞務費', '營業費用', '', '通用', '', '記帳士、律師、顧問'],
  ['6331', '手續費', '營業費用', '', '通用', '', '刷卡、匯款手續費'],
  ['6332', '外送平台服務費', '營業費用', '', '餐飲', '', '外送平台抽成'],
  ['6333', '電商平台手續費', '營業費用', '', '食品製造,食品買賣', '', '電商平台成交手續費'],
  ['6341', '包裝費', '營業費用', '', '餐飲,食品製造,食品買賣', '', '外帶容器、出貨紙箱'],
  ['6351', '清潔衛生費', '營業費用', '', '餐飲,食品製造', '', '清潔用品、病媒防治'],
  ['6361', '消耗品', '營業費用', '', '通用', '', ''],
  ['6371', '資訊服務費', '營業費用', '', '通用', '', 'POS、軟體月租'],
  ['6381', '研究發展費', '營業費用', '', '食品製造', '', '新品研發'],
  ['6391', '檢驗費', '營業費用', '', '食品製造,食品買賣', '', '食品檢驗、認證'],
  ['6399', '雜費', '營業費用', '', '通用', '', ''],

  // ── 營業外收支 ──
  ['7111', '利息收入', '營業外收入', '', '通用', '', ''],
  ['7121', '租金收入', '營業外收入', '', '通用', '', ''],
  ['7131', '處分資產利益', '營業外收入', '', '通用', '', ''],
  ['7141', '兌換利益', '營業外收入', '', '通用', '', ''],
  ['7191', '其他收入', '營業外收入', '', '通用', '', '政府補助、雜項收入'],
  ['7511', '利息支出', '營業外支出', '', '通用', '', ''],
  ['7521', '處分資產損失', '營業外支出', '', '通用', '', ''],
  ['7531', '兌換損失', '營業外支出', '', '通用', '', ''],
  ['7591', '其他損失', '營業外支出', '', '通用', '', ''],

  // ── 所得稅 ──
  ['8111', '所得稅費用', '所得稅費用', '', '通用', '', '']
];

/** 把參考庫陣列轉成物件清單 */
function referenceAccountObjects_() {
  return REFERENCE_ACCOUNTS.map(function (r) {
    var block = BLOCKS[r[2]];
    return {
      code: r[0],
      name: r[1],
      category: block.category,
      normal: r[3] || block.normal,
      block: r[2],
      industries: r[4],
      stockCost: r[5],
      note: r[6]
    };
  });
}

// ===== 10_Core.js =====
/**
 * 帳務核心計算（純計算，不讀寫試算表，可在本機做單元測試）
 *
 * 資料形狀：
 *  account = { code, name, category, normal, block, industries, stockCost, enabled, source, note }
 *  opening = [{ code, debit, credit }]
 *  line    = { no, date, type, lineNo, code, name, debit, credit, memo, party, source, status }
 */

// ───────────── 科目 ─────────────

function indexAccounts_(accounts) {
  var map = {};
  accounts.forEach(function (a) { map[a.code] = a; });
  return map;
}

/** 檢查一筆科目資料；isNew 時代碼不可與既有重複 */
function validateAccount_(acc, accountsByCode, isNew) {
  var errors = [];
  var code = str_(acc.code);
  if (!/^\d{4,6}$/.test(code)) errors.push('科目代碼需為 4～6 位數字');
  if (!str_(acc.name)) errors.push('請填科目名稱');
  var block = BLOCKS[acc.block];
  if (!block) {
    errors.push('報表區塊不正確');
  } else if (code && block.digits.indexOf(code.charAt(0)) < 0) {
    errors.push('「' + acc.block + '」的科目代碼需以 ' + block.digits.join('／') + ' 開頭');
  }
  if (acc.normal && acc.normal !== '借' && acc.normal !== '貸') errors.push('正常餘額只能是「借」或「貸」');
  if (isNew && accountsByCode[code]) errors.push('科目代碼 ' + code + ' 已存在');
  if (acc.stockCost && acc.block !== '流動資產') errors.push('只有流動資產的存貨科目可以設定盤點對應成本科目');
  if (acc.stockCost) {
    var target = accountsByCode[acc.stockCost];
    if (!target) errors.push('盤點對應成本科目 ' + acc.stockCost + ' 不存在，請先加入該科目');
    else if (target.block !== '營業成本' && target.block !== '營業費用') errors.push('盤點對應成本科目需為營業成本或營業費用');
  }
  return errors;
}

// ───────────── 傳票 ─────────────

function activeLines_(lines) {
  return lines.filter(function (l) { return l.status !== '作廢'; });
}

/**
 * 檢查傳票
 * ctx = { accountsByCode, openingDate, lockedPeriods: {'2026-01': true} }
 */
function validateVoucher_(v, ctx) {
  var errors = [];
  if (!isValidDate_(v.date)) errors.push('日期格式需為 yyyy-MM-dd');
  else {
    if (ctx.openingDate && v.date < ctx.openingDate) errors.push('日期早於開帳日 ' + ctx.openingDate);
    if (ctx.lockedPeriods && ctx.lockedPeriods[v.date.slice(0, 7)]) errors.push(v.date.slice(0, 7) + ' 已鎖帳，不能新增或修改');
  }
  if (VOUCHER_TYPES.indexOf(v.type) < 0) errors.push('傳票類型需為 收入／支出／轉帳');
  var lines = (v.lines || []).filter(function (l) {
    return str_(l.code) || toAmount_(l.debit) || toAmount_(l.credit);
  });
  if (lines.length < 2) errors.push('至少要有兩行分錄');
  var dr = 0, cr = 0;
  lines.forEach(function (l, i) {
    var n = i + 1;
    var acc = ctx.accountsByCode[str_(l.code)];
    if (!acc) errors.push('第 ' + n + ' 行：科目 ' + (l.code || '(空白)') + ' 不存在');
    else if (!acc.enabled) errors.push('第 ' + n + ' 行：科目 ' + acc.code + ' ' + acc.name + ' 已停用');
    var d = toAmount_(l.debit), c = toAmount_(l.credit);
    if (isNaN(d) || isNaN(c)) { errors.push('第 ' + n + ' 行：金額不是數字'); return; }
    if (d < 0 || c < 0) errors.push('第 ' + n + ' 行：金額不可為負數');
    if (!Number.isInteger(d) || !Number.isInteger(c)) errors.push('第 ' + n + ' 行：金額需為整數（新台幣元）');
    if (d && c) errors.push('第 ' + n + ' 行：同一行不能同時有借方與貸方');
    if (!d && !c) errors.push('第 ' + n + ' 行：請填借方或貸方金額');
    dr += d || 0; cr += c || 0;
  });
  if (dr !== cr) errors.push('借貸不平衡：借方 ' + dr + '，貸方 ' + cr + '，差 ' + (dr - cr));
  if (dr === 0) errors.push('傳票金額不可為 0');
  return { errors: errors, debit: dr, credit: cr, lines: lines };
}

/**
 * 下一個傳票號碼：yyyyMM-0001。取「表上最大號」與「已發出最大號」較大者 + 1，作廢號碼不重複使用。
 */
function nextVoucherNo_(existingNos, period, storedSeq) {
  var prefix = period.replace('-', '') + '-';
  var max = Number(storedSeq) || 0;
  existingNos.forEach(function (no) {
    if (String(no).indexOf(prefix) === 0) {
      var n = Number(String(no).slice(prefix.length));
      if (n > max) max = n;
    }
  });
  return { no: prefix + pad_(max + 1, 4), seq: max + 1 };
}

// ───────────── 期初餘額 ─────────────

function validateOpening_(rows, accountsByCode) {
  var errors = [], dr = 0, cr = 0;
  rows.forEach(function (r) {
    var d = toAmount_(r.debit), c = toAmount_(r.credit);
    if (isNaN(d) || isNaN(c)) { errors.push('科目 ' + r.code + '：金額不是數字'); return; }
    if (!d && !c) return;
    var acc = accountsByCode[r.code];
    if (!acc) { errors.push('科目 ' + r.code + ' 不存在'); return; }
    if (BLOCKS[acc.block].statement !== 'BS') errors.push(acc.code + ' ' + acc.name + '：期初餘額只能填資產、負債、權益科目');
    if (isNaN(d) || isNaN(c) || d < 0 || c < 0 || !Number.isInteger(d) || !Number.isInteger(c)) errors.push(acc.code + ' ' + acc.name + '：金額需為正整數');
    if (d && c) errors.push(acc.code + ' ' + acc.name + '：借方與貸方只能填一邊');
    dr += d || 0; cr += c || 0;
  });
  return { errors: errors, debit: dr, credit: cr, balanced: dr === cr };
}

// ───────────── 彙總 ─────────────

/** 依科目加總指定日期區間（含頭尾）的借貸；from 空白 = 從頭；to 空白 = 到最後 */
function sumByAccount_(lines, from, to) {
  var out = {};
  lines.forEach(function (l) {
    if (l.status === '作廢') return;
    if (from && l.date < from) return;
    if (to && l.date > to) return;
    var s = out[l.code] || (out[l.code] = { debit: 0, credit: 0 });
    s.debit += Number(l.debit) || 0;
    s.credit += Number(l.credit) || 0;
  });
  return out;
}

function openingMap_(opening) {
  var out = {};
  (opening || []).forEach(function (o) {
    var s = out[o.code] || (out[o.code] = { debit: 0, credit: 0 });
    s.debit += Number(o.debit) || 0;
    s.credit += Number(o.credit) || 0;
  });
  return out;
}

/** 依報表區塊方向換算金額：sign D = 借 − 貸；C = 貸 − 借 */
function signed_(block, debit, credit) {
  return BLOCKS[block].sign === 'D' ? debit - credit : credit - debit;
}

function sortByCode_(a, b) { return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; }

// ───────────── 試算表 ─────────────

/**
 * 試算表：期初（開帳餘額 + from 之前的分錄）、本期借貸、期末
 * 回傳每科目的借方餘額／貸方餘額，與合計是否平衡
 */
function trialBalance_(accounts, opening, lines, from, to) {
  var open = openingMap_(opening);
  var before = from ? sumByAccount_(lines, '', addDays_(from, -1)) : {};
  var period = sumByAccount_(lines, from, to);
  var rows = [];
  var tot = { openDebit: 0, openCredit: 0, debit: 0, credit: 0, closeDebit: 0, closeCredit: 0 };
  accounts.slice().sort(sortByCode_).forEach(function (a) {
    var o = open[a.code] || { debit: 0, credit: 0 };
    var b = before[a.code] || { debit: 0, credit: 0 };
    var p = period[a.code] || { debit: 0, credit: 0 };
    var openNet = o.debit - o.credit + b.debit - b.credit;
    var closeNet = openNet + p.debit - p.credit;
    if (!openNet && !p.debit && !p.credit) return;
    var row = {
      code: a.code, name: a.name, block: a.block,
      openDebit: openNet > 0 ? openNet : 0, openCredit: openNet < 0 ? -openNet : 0,
      debit: p.debit, credit: p.credit,
      closeDebit: closeNet > 0 ? closeNet : 0, closeCredit: closeNet < 0 ? -closeNet : 0
    };
    Object.keys(tot).forEach(function (k) { tot[k] += row[k]; });
    rows.push(row);
  });
  return {
    from: from, to: to, rows: rows, totals: tot,
    balanced: tot.closeDebit === tot.closeCredit && tot.debit === tot.credit
  };
}

// ───────────── 損益表 ─────────────

var IS_BLOCKS = ['營業收入', '營業成本', '營業費用', '營業外收入', '營業外支出', '所得稅費用'];

function incomeStatement_(accounts, lines, from, to) {
  var sums = sumByAccount_(lines, from, to);
  var sections = {};
  IS_BLOCKS.forEach(function (b) { sections[b] = { block: b, rows: [], total: 0 }; });
  accounts.slice().sort(sortByCode_).forEach(function (a) {
    if (!sections[a.block]) return;
    var s = sums[a.code];
    if (!s) return;
    var amt = signed_(a.block, s.debit, s.credit);
    if (!amt) return;
    sections[a.block].rows.push({ code: a.code, name: a.name, amount: amt });
    sections[a.block].total += amt;
  });
  var rev = sections['營業收入'].total;
  var cost = sections['營業成本'].total;
  var gross = rev - cost;
  var opex = sections['營業費用'].total;
  var opInc = gross - opex;
  var pretax = opInc + sections['營業外收入'].total - sections['營業外支出'].total;
  var net = pretax - sections['所得稅費用'].total;
  return {
    from: from, to: to,
    sections: IS_BLOCKS.map(function (b) { return sections[b]; }),
    summary: {
      revenue: rev, cost: cost, grossProfit: gross, opex: opex, operatingIncome: opInc,
      nonOpIncome: sections['營業外收入'].total, nonOpExpense: sections['營業外支出'].total,
      pretaxIncome: pretax, incomeTax: sections['所得稅費用'].total, netIncome: net
    }
  };
}

/** 比較期間：prev = 前一段相同天數；lastyear = 去年同期 */
function compareRange_(from, to, mode) {
  if (mode === 'lastyear') return { from: addYears_(from, -1), to: addYears_(to, -1) };
  if (mode === 'prev') {
    var days = daySpan_(from, to);
    var isWholeMonths = from.slice(8) === '01' && to === monthEnd_(to.slice(0, 7));
    if (isWholeMonths) {
      var months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
      var pTo = addDays_(from, -1);
      var y = Number(pTo.slice(0, 4)), m = Number(pTo.slice(5, 7)) - months + 1;
      while (m < 1) { m += 12; y -= 1; }
      return { from: y + '-' + pad_(m, 2) + '-01', to: pTo };
    }
    return { from: addDays_(from, -days), to: addDays_(from, -1) };
  }
  return null;
}

function netIncome_(accounts, lines, from, to) {
  return incomeStatement_(accounts, lines, from, to).summary.netIncome;
}

// ───────────── 資產負債表 ─────────────

var BS_BLOCKS = ['流動資產', '非流動資產', '流動負債', '非流動負債', '權益'];

/**
 * 資產負債表（截至 asOf）
 * 權益另加兩列系統計算數：
 *  - 前期未結轉損益：本會計年度以前、尚未做年度結帳的損益
 *  - 本期損益：本會計年度第一天到 asOf 的淨利
 */
function balanceSheet_(accounts, opening, lines, asOf, fyStartMonth) {
  var open = openingMap_(opening);
  var sums = sumByAccount_(lines, '', asOf);
  var sections = {};
  BS_BLOCKS.forEach(function (b) { sections[b] = { block: b, rows: [], total: 0 }; });
  accounts.slice().sort(sortByCode_).forEach(function (a) {
    if (!sections[a.block]) return;
    var o = open[a.code] || { debit: 0, credit: 0 };
    var s = sums[a.code] || { debit: 0, credit: 0 };
    var amt = signed_(a.block, o.debit + s.debit, o.credit + s.credit);
    if (!amt) return;
    sections[a.block].rows.push({ code: a.code, name: a.name, amount: amt });
    sections[a.block].total += amt;
  });
  var fyStart = fiscalYearStart_(asOf, fyStartMonth);
  var priorUnclosed = netIncome_(accounts, lines, '', addDays_(fyStart, -1));
  var current = netIncome_(accounts, lines, fyStart, asOf);
  var eq = sections['權益'];
  if (priorUnclosed) { eq.rows.push({ code: '', name: '前期未結轉損益', amount: priorUnclosed, computed: true }); eq.total += priorUnclosed; }
  if (current || !eq.rows.length) { eq.rows.push({ code: '', name: '本期損益', amount: current, computed: true }); eq.total += current; }
  var assets = sections['流動資產'].total + sections['非流動資產'].total;
  var liabilities = sections['流動負債'].total + sections['非流動負債'].total;
  var equity = eq.total;
  return {
    asOf: asOf, fiscalYearStart: fyStart,
    sections: BS_BLOCKS.map(function (b) { return sections[b]; }),
    summary: {
      assets: assets, liabilities: liabilities, equity: equity,
      liabilitiesAndEquity: liabilities + equity,
      difference: assets - liabilities - equity,
      currentPeriodIncome: current, priorUnclosedIncome: priorUnclosed
    }
  };
}

// ───────────── 分類帳 ─────────────

/**
 * 分類帳：單一科目在期間內的每筆分錄與累計餘額
 * 餘額以科目正常餘額方向顯示（借方科目：借 − 貸；貸方科目：貸 − 借）
 * party 有值時只看該往來對象（明細分類帳），此時期初只計算該往來對象的分錄
 */
function ledger_(accounts, opening, lines, code, from, to, party) {
  var acc = indexAccounts_(accounts)[code];
  if (!acc) throw new Error('科目 ' + code + ' 不存在');
  var dir = acc.normal === '貸' ? -1 : 1;
  var mine = lines.filter(function (l) {
    return l.status !== '作廢' && l.code === code && (!party || str_(l.party) === party);
  });
  var openNet = 0;
  if (!party) {
    var o = openingMap_(opening)[code];
    if (o) openNet += o.debit - o.credit;
  }
  mine.forEach(function (l) { if (from && l.date < from) openNet += (Number(l.debit) || 0) - (Number(l.credit) || 0); });
  var bal = openNet * dir;
  var rows = [];
  var totDr = 0, totCr = 0;
  mine.filter(function (l) { return (!from || l.date >= from) && (!to || l.date <= to); })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.no < b.no ? -1 : a.no > b.no ? 1 : a.lineNo - b.lineNo); })
    .forEach(function (l) {
      var d = Number(l.debit) || 0, c = Number(l.credit) || 0;
      bal += (d - c) * dir;
      totDr += d; totCr += c;
      rows.push({ date: l.date, no: l.no, memo: l.memo, party: l.party, debit: d, credit: c, balance: bal });
    });
  return {
    code: acc.code, name: acc.name, normal: acc.normal, party: party || '',
    from: from, to: to, openingBalance: openNet * dir, rows: rows,
    totalDebit: totDr, totalCredit: totCr, closingBalance: bal
  };
}

/** 日記簿：期間內每張傳票與其分錄 */
function journal_(lines, from, to, includeVoid) {
  var byNo = {};
  var order = [];
  lines.forEach(function (l) {
    if (!includeVoid && l.status === '作廢') return;
    if (from && l.date < from) return;
    if (to && l.date > to) return;
    if (!byNo[l.no]) {
      byNo[l.no] = { no: l.no, date: l.date, type: l.type, source: l.source, status: l.status, lines: [], debit: 0, credit: 0 };
      order.push(l.no);
    }
    var v = byNo[l.no];
    v.lines.push({ lineNo: l.lineNo, code: l.code, name: l.name, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, memo: l.memo, party: l.party });
    v.debit += Number(l.debit) || 0;
    v.credit += Number(l.credit) || 0;
  });
  return order.map(function (no) {
    var v = byNo[no];
    v.lines.sort(function (a, b) { return a.lineNo - b.lineNo; });
    v.memo = v.lines.length ? v.lines[0].memo : '';
    return v;
  }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.no < b.no ? -1 : 1); });
}

// ───────────── 月底盤點 ─────────────

/**
 * 列出所有有「盤點對應成本科目」的存貨科目，與月底帳上金額
 * excludeNos：重做盤點時，排除本期舊的盤點傳票
 */
function stocktakePreview_(accounts, opening, lines, period, excludeNos) {
  var ex = {};
  (excludeNos || []).forEach(function (n) { ex[n] = true; });
  var end = monthEnd_(period);
  var used = lines.filter(function (l) { return !ex[l.no]; });
  var open = openingMap_(opening);
  var sums = sumByAccount_(used, '', end);
  var byCode = indexAccounts_(accounts);
  return accounts.filter(function (a) { return a.enabled && a.stockCost; }).sort(sortByCode_).map(function (a) {
    var o = open[a.code] || { debit: 0, credit: 0 };
    var s = sums[a.code] || { debit: 0, credit: 0 };
    var cost = byCode[a.stockCost];
    return {
      code: a.code, name: a.name,
      book: o.debit - o.credit + s.debit - s.credit,
      costCode: a.stockCost, costName: cost ? cost.name : '(不存在)'
    };
  });
}

/**
 * 依盤點數產生調整傳票
 * counts = { '1166': 52000, ... }（未填的科目不調整）
 * 差額 > 0：借 存貨 / 貸 成本；差額 < 0：借 成本 / 貸 存貨
 */
function buildStocktakeVoucher_(period, preview, counts) {
  var lines = [];
  var detail = [];
  preview.forEach(function (p) {
    if (counts[p.code] === undefined || counts[p.code] === '' || counts[p.code] === null) return;
    var counted = toAmount_(counts[p.code]);
    if (isNaN(counted) || counted < 0 || !Number.isInteger(counted)) throw new Error(p.code + ' ' + p.name + '：盤點金額需為 0 以上的整數');
    var diff = counted - p.book;
    detail.push({ code: p.code, name: p.name, book: p.book, counted: counted, diff: diff, costCode: p.costCode });
    if (!diff) return;
    var memo = period + ' 月底盤點調整－' + p.name;
    if (diff > 0) {
      lines.push({ code: p.code, debit: diff, credit: 0, memo: memo, party: '' });
      lines.push({ code: p.costCode, debit: 0, credit: diff, memo: memo, party: '' });
    } else {
      lines.push({ code: p.costCode, debit: -diff, credit: 0, memo: memo, party: '' });
      lines.push({ code: p.code, debit: 0, credit: -diff, memo: memo, party: '' });
    }
  });
  return {
    detail: detail,
    voucher: lines.length ? { date: monthEnd_(period), type: '轉帳', memo: period + ' 月底盤點調整', lines: lines } : null
  };
}

// ───────────── 首頁摘要 ─────────────

var CASH_CODES = ['1111', '1112', '1113', '1114'];

function dashboard_(accounts, opening, lines, today, fyStartMonth) {
  var period = today.slice(0, 7);
  var month = incomeStatement_(accounts, lines, monthStart_(period), monthEnd_(period));
  var ytd = incomeStatement_(accounts, lines, fiscalYearStart_(today, fyStartMonth), today);
  var open = openingMap_(opening);
  var sums = sumByAccount_(lines, '', today);
  var cash = 0;
  CASH_CODES.forEach(function (c) {
    var o = open[c] || { debit: 0, credit: 0 }, s = sums[c] || { debit: 0, credit: 0 };
    cash += o.debit - o.credit + s.debit - s.credit;
  });
  var tb = trialBalance_(accounts, opening, lines, '', today);
  return {
    period: period,
    month: month.summary,
    ytd: ytd.summary,
    cash: cash,
    balanced: tb.balanced,
    voucherCount: journal_(lines, monthStart_(period), monthEnd_(period)).length
  };
}

// ===== 20_Store.js =====
/**
 * 試算表讀寫層：所有工作表存取都集中在這裡
 */
function ss_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('找不到試算表，請先在試算表中執行「初始設定」');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
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
    appendObjects_(SHEETS.LOG, [{ '時間': nowText_(), '帳號': user || '', '動作': action, '內容': typeof detail === 'string' ? detail : JSON.stringify(detail) }]);
  } catch (e) {
    // 紀錄失敗不影響主要操作
  }
}

// ===== 30_Auth.js =====
/**
 * 帳號、登入、權限
 * 密碼只存 SHA-256(鹽|密碼)，不存明碼；登入憑證放 CacheService 6 小時
 */
function hashPassword_(salt, password) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password, Utilities.Charset.UTF_8);
  return bytesToHex_(bytes);
}

function newSalt_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

/** 隨機臨時密碼：10 碼英數（排除易混淆字元） */
function randomPassword_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var uuid = Utilities.getUuid().replace(/-/g, '');
  var out = '';
  for (var i = 0; i < 10; i++) out += chars.charAt(parseInt(uuid.substr(i * 3, 3), 16) % chars.length);
  return out;
}

function validatePasswordStrength_(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return '密碼至少 8 碼';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '密碼需同時包含英文與數字';
  return '';
}

function loadUsers_() {
  return readObjects_(SHEETS.USERS).map(function (o) {
    return {
      username: str_(o['帳號']), name: str_(o['姓名']), role: str_(o['角色']),
      salt: str_(o['鹽']), hash: str_(o['密碼雜湊']),
      enabled: str_(o['啟用']) !== '否', createdAt: str_(o['建立時間']), lastLogin: str_(o['最後登入']), _row: o._row
    };
  }).filter(function (u) { return u.username; });
}

function findUser_(username) {
  var key = str_(username).toLowerCase();
  return loadUsers_().filter(function (u) { return u.username.toLowerCase() === key; })[0] || null;
}

/**
 * 登入防護（Apps Script 取不到訪客 IP，因此分兩層）：
 *  1. 同一個瀏覽器（clientId）錯 5 次 → 這個瀏覽器鎖 10 分鐘
 *  2. 同一帳號 10 分鐘內全站錯超過 20 次 → 之後每次嘗試延遲 3 秒（減緩猜密碼，但不擋正確密碼，避免被惡意鎖住帳號）
 */
function login(username, password, clientId) {
  try {
    var cache = CacheService.getScriptCache();
    var user = str_(username).toLowerCase();
    var cid = str_(clientId).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
    var key = 'fail_' + user + '_' + cid;
    var gkey = 'gfail_' + user;
    var fails = Number(cache.get(key)) || 0;
    var gfails = Number(cache.get(gkey)) || 0;
    if (fails >= LOGIN_MAX_FAILS) return { ok: false, error: '密碼錯誤次數過多，請 10 分鐘後再試' };
    if (gfails >= LOGIN_GLOBAL_SLOWDOWN) Utilities.sleep(3000);
    var u = findUser_(username);
    if (!u || !u.enabled || hashPassword_(u.salt, String(password || '')) !== u.hash) {
      cache.put(key, String(fails + 1), LOGIN_LOCK_SECONDS);
      cache.put(gkey, String(gfails + 1), LOGIN_LOCK_SECONDS);
      return { ok: false, error: '帳號或密碼錯誤' };
    }
    cache.remove(key);
    var issued = issueSession_(u);
    updateCells_(SHEETS.USERS, u._row, { '最後登入': nowText_() });
    log_(u.username, '登入', '');
    return { ok: true, data: issued };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 憑證版本：密碼一改，雜湊就變，舊的登入憑證全部失效 */
function credTag_(u) {
  return u.hash.slice(0, 16);
}

function issueSession_(u) {
  var token = Utilities.getUuid();
  var session = { username: u.username, name: u.name, role: u.role, cred: credTag_(u) };
  CacheService.getScriptCache().put('tok_' + token, JSON.stringify(session), SESSION_SECONDS);
  return { token: token, user: { username: u.username, name: u.name, role: u.role } };
}

function logout(token) {
  CacheService.getScriptCache().remove('tok_' + token);
  return { ok: true };
}

function sessionFromToken_(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get('tok_' + token);
  if (!raw) return null;
  var s = JSON.parse(raw);
  // 每次確認帳號仍啟用、角色以帳號表為準（改權限立即生效）
  var u = findUser_(s.username);
  if (!u || !u.enabled || s.cred !== credTag_(u)) return null;
  return { username: u.username, name: u.name, role: u.role };
}

function can_(role, action) {
  var allowed = PERMISSIONS[action];
  return !!allowed && allowed.indexOf(role) >= 0;
}

/** 新增帳號（回傳臨時密碼，只顯示一次） */
function createUser_(username, name, role) {
  username = str_(username);
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) throw new Error('帳號需為 3～30 碼英數字');
  if (ROLES.indexOf(role) < 0) throw new Error('角色不正確');
  if (findUser_(username)) throw new Error('帳號 ' + username + ' 已存在');
  var salt = newSalt_();
  var pw = randomPassword_();
  appendObjects_(SHEETS.USERS, [{
    '帳號': username, '姓名': str_(name) || username, '角色': role, '鹽': salt,
    '密碼雜湊': hashPassword_(salt, pw), '啟用': '是', '建立時間': nowText_(), '最後登入': ''
  }]);
  return pw;
}

function setPassword_(user, newPassword) {
  var salt = newSalt_();
  updateCells_(SHEETS.USERS, user._row, { '鹽': salt, '密碼雜湊': hashPassword_(salt, newPassword) });
}

// ===== 40_Api.js =====
/**
 * 網頁入口與 API
 * 前端一律呼叫 api(token, action, payload)，權限在這裡檢查後才回傳資料
 */
function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle(APP.name)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  if (['Css', 'Js'].indexOf(name) < 0) throw new Error('不明的檔案');
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function api(token, action, payload) {
  try {
    var session = sessionFromToken_(token);
    if (!session) return { ok: false, error: '登入已逾時，請重新登入', relogin: true };
    if (!HANDLERS[action]) return { ok: false, error: '不明的操作：' + action };
    if (!can_(session.role, action)) return { ok: false, error: '您沒有權限執行此操作' };
    var data = HANDLERS[action](payload || {}, session);
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

var HANDLERS = {};

// ───────────── 啟動資料 ─────────────

HANDLERS.bootstrap = function (p, s) {
  var allowed = Object.keys(PERMISSIONS).filter(function (a) { return can_(s.role, a); });
  return {
    app: APP,
    user: s,
    allowed: allowed,
    settings: loadSettings_(),
    accounts: loadAccounts_(),
    lockedPeriods: lockedPeriodsMap_(),
    blocks: Object.keys(BLOCKS).map(function (b) { return { name: b, category: BLOCKS[b].category, normal: BLOCKS[b].normal, statement: BLOCKS[b].statement }; }),
    industries: INDUSTRIES,
    voucherTypes: VOUCHER_TYPES,
    roles: ROLES,
    today: todayText_()
  };
};

// ───────────── 傳票 ─────────────

HANDLERS.listVouchers = function (p) {
  var period = isValidPeriod_(p.period) ? p.period : todayText_().slice(0, 7);
  var list = journal_(loadLines_(), monthStart_(period), monthEnd_(period), true);
  var kw = str_(p.keyword).toLowerCase();
  if (kw) {
    list = list.filter(function (v) {
      return v.no.toLowerCase().indexOf(kw) >= 0 || v.lines.some(function (l) {
        return [l.code, l.name, l.memo, l.party].join(' ').toLowerCase().indexOf(kw) >= 0;
      });
    });
  }
  return { period: period, vouchers: list.reverse() };
};

HANDLERS.getVoucher = function (p) {
  var v = journal_(loadLines_().filter(function (l) { return l.no === p.no; }), '', '', true)[0];
  if (!v) throw new Error('找不到傳票 ' + p.no);
  return v;
};

HANDLERS.saveVoucher = function (p, s) {
  return withLock_(function () { return saveVoucherCore_(p, s); });
};

/** 新增或修改傳票（不加鎖，呼叫端負責加鎖） */
function saveVoucherCore_(p, s) {
    var accounts = loadAccounts_();
    var byCode = indexAccounts_(accounts);
    var settings = loadSettings_();
    var locked = lockedPeriodsMap_();
    var all = loadLines_();
    var old = [];
    if (p.no) {
      old = all.filter(function (l) { return l.no === p.no; });
      if (!old.length) throw new Error('找不到傳票 ' + p.no);
      if (old[0].status === '作廢') throw new Error('已作廢的傳票不能修改');
      if (old[0].source === '月底盤點') throw new Error('月底盤點傳票請到「月底盤點」重新產生');
      if (locked[old[0].date.slice(0, 7)]) throw new Error(old[0].date.slice(0, 7) + ' 已鎖帳，不能修改');
    }
    var v = { date: str_(p.date), type: str_(p.type), lines: p.lines || [] };
    var check = validateVoucher_(v, { accountsByCode: byCode, openingDate: settings.openingDate, lockedPeriods: locked });
    if (check.errors.length) throw new Error(check.errors.join('\n'));

    var no = p.no;
    if (!no) {
      var period = v.date.slice(0, 7);
      var props = PropertiesService.getScriptProperties();
      var key = 'SEQ_' + period.replace('-', '');
      var next = nextVoucherNo_(all.map(function (l) { return l.no; }), period, props.getProperty(key));
      no = next.no;
      props.setProperty(key, String(next.seq));
    }
    var now = nowText_();
    var rows = check.lines.map(function (l, i) {
      var acc = byCode[str_(l.code)];
      return {
        '傳票號碼': no, '日期': v.date, '類型': v.type, '行號': i + 1,
        '科目代碼': acc.code, '科目名稱': acc.name,
        '借方': toAmount_(l.debit) || 0, '貸方': toAmount_(l.credit) || 0,
        '摘要': str_(l.memo) || str_(p.memo), '往來對象': str_(l.party),
        '來源': p.source || (old.length ? old[0].source : '手動'), '狀態': '有效',
        '建立者': old.length ? old[0].createdBy : s.username, '建立時間': old.length ? old[0].createdAt : now,
        '修改者': old.length ? s.username : '', '修改時間': old.length ? now : ''
      };
    });
    if (old.length) deleteRowNumbers_(SHEETS.VOUCHERS, old.map(function (l) { return l._row; }));
    appendObjects_(SHEETS.VOUCHERS, rows);
    log_(s.username, old.length ? '修改傳票' : '新增傳票', no + ' ' + v.date + ' 金額 ' + check.debit);
    return { no: no, debit: check.debit };
}

HANDLERS.voidVoucher = function (p, s) {
  return withLock_(function () {
    var rows = loadLines_().filter(function (l) { return l.no === p.no; });
    if (!rows.length) throw new Error('找不到傳票 ' + p.no);
    if (rows[0].status === '作廢') throw new Error('此傳票已作廢');
    if (rows[0].source === '月底盤點') throw new Error('月底盤點傳票請到「月底盤點」重新盤點或取消盤點');
    if (lockedPeriodsMap_()[rows[0].date.slice(0, 7)]) throw new Error(rows[0].date.slice(0, 7) + ' 已鎖帳，不能作廢');
    var reason = str_(p.reason);
    if (!reason) throw new Error('請填寫作廢原因');
    var now = nowText_();
    rows.forEach(function (l) { updateCells_(SHEETS.VOUCHERS, l._row, { '狀態': '作廢', '修改者': s.username, '修改時間': now }); });
    log_(s.username, '作廢傳票', p.no + '：' + reason);
    return { no: p.no };
  });
};

// ───────────── 帳簿與報表 ─────────────

/**
 * 查詢期間：開帳日之前沒有資料。
 * 起始日早於開帳日時自動從開帳日起算；整段都在開帳日之前則提示沒有資料。
 */
function rangeOf_(p) {
  var today = todayText_();
  var from = isValidDate_(p.from) ? p.from : monthStart_(today.slice(0, 7));
  var to = isValidDate_(p.to) ? p.to : today;
  if (from > to) throw new Error('起始日不可晚於結束日');
  var od = loadSettings_().openingDate;
  if (od) {
    if (to < od) throw new Error('查詢期間早於開帳日 ' + od + '，系統沒有這段期間的資料');
    if (from < od) from = od;
  }
  return { from: from, to: to };
}

/** 資產負債表等「截至某日」的查詢：最早只能查開帳日前一天（＝期初餘額） */
function asOfOf_(asOf) {
  var d = isValidDate_(asOf) ? asOf : todayText_();
  var od = loadSettings_().openingDate;
  if (od && d < addDays_(od, -1)) throw new Error('查詢日期早於開帳日 ' + od + '，系統沒有這段期間的資料；最早可查 ' + addDays_(od, -1) + '（期初餘額）');
  return d;
}

HANDLERS.journal = function (p) {
  var r = rangeOf_(p);
  return { from: r.from, to: r.to, vouchers: journal_(loadLines_(), r.from, r.to, false) };
};

HANDLERS.ledger = function (p) {
  var r = rangeOf_(p);
  return ledger_(loadAccounts_(), loadOpening_(), loadLines_(), str_(p.code), r.from, r.to, str_(p.party));
};

HANDLERS.trialBalance = function (p) {
  var r = rangeOf_(p);
  var tb = trialBalance_(loadAccounts_(), loadOpening_(), loadLines_(), r.from, r.to);
  tb.companyName = loadSettings_().companyName;
  return tb;
};

HANDLERS.incomeStatement = function (p) {
  var r = rangeOf_(p);
  var accounts = loadAccounts_(), lines = loadLines_();
  var out = { companyName: loadSettings_().companyName, current: incomeStatement_(accounts, lines, r.from, r.to), compare: null };
  var c = compareRange_(r.from, r.to, p.compare);
  if (c) out.compare = incomeStatement_(accounts, lines, c.from, c.to);
  return out;
};

HANDLERS.balanceSheet = function (p) {
  var asOf = asOfOf_(p.asOf);
  var settings = loadSettings_();
  var bs = balanceSheet_(loadAccounts_(), loadOpening_(), loadLines_(), asOf, settings.fyStartMonth);
  bs.companyName = settings.companyName;
  return bs;
};

HANDLERS.dashboard = function () {
  var settings = loadSettings_();
  var opening = loadOpening_();
  var d = dashboard_(loadAccounts_(), opening, loadLines_(), todayText_(), settings.fyStartMonth);
  var ob = validateOpening_(opening, indexAccounts_(loadAccounts_()));
  d.openingBalanced = ob.balanced;
  d.openingCount = opening.length;
  d.stocktaken = stocktakeRecords_(d.period).length > 0;
  d.openingDate = settings.openingDate;
  d.locked = lockedPeriodsMap_();
  return d;
};

/** 把三張報表寫到試算表分頁，業主可直接在試算表查看 */
HANDLERS.writeReports = function (p, s) {
  var r = rangeOf_(p);
  var asOf = asOfOf_(isValidDate_(p.asOf) ? p.asOf : r.to);
  writeReportSheets_(r.from, r.to, asOf);
  log_(s.username, '寫入報表分頁', r.from + '～' + r.to + '，資產負債表截至 ' + asOf);
  return { from: r.from, to: r.to, asOf: asOf };
};

function ensureReportSheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  return sh;
}

function writeBlock_(sh, rows) {
  if (!rows.length) return;
  var width = 0;
  rows.forEach(function (r) { if (r.length > width) width = r.length; });
  var data = rows.map(function (r) { var x = r.slice(); while (x.length < width) x.push(''); return x; });
  sh.getRange(1, 1, data.length, width).setValues(data);
}

function writeReportSheets_(from, to, asOf) {
  var settings = loadSettings_();
  var accounts = loadAccounts_(), opening = loadOpening_(), lines = loadLines_();
  var stamp = '系統自動產生・請勿在此修改　產生時間 ' + nowText_();

  var tb = trialBalance_(accounts, opening, lines, from, to);
  var tbRows = [[settings.companyName + ' 試算表', from + ' ～ ' + to], [stamp],
    ['科目代碼', '科目名稱', '期初借餘', '期初貸餘', '本期借方', '本期貸方', '期末借餘', '期末貸餘']];
  tb.rows.forEach(function (r) { tbRows.push([r.code, r.name, r.openDebit, r.openCredit, r.debit, r.credit, r.closeDebit, r.closeCredit]); });
  tbRows.push(['', '合計', tb.totals.openDebit, tb.totals.openCredit, tb.totals.debit, tb.totals.credit, tb.totals.closeDebit, tb.totals.closeCredit]);
  writeBlock_(ensureReportSheet_(SHEETS.RPT_TB), tbRows);

  var is = incomeStatement_(accounts, lines, from, to);
  var isRows = [[settings.companyName + ' 損益表', from + ' ～ ' + to], [stamp], ['科目代碼', '項目', '金額']];
  var sm = is.summary;
  var after = { '營業成本': ['', '營業毛利', sm.grossProfit], '營業費用': ['', '營業淨利', sm.operatingIncome], '營業外支出': ['', '稅前淨利', sm.pretaxIncome], '所得稅費用': ['', '本期淨利', sm.netIncome] };
  is.sections.forEach(function (sec) {
    isRows.push(['', sec.block, '']);
    sec.rows.forEach(function (r) { isRows.push([r.code, '　' + r.name, r.amount]); });
    isRows.push(['', sec.block + '合計', sec.total]);
    if (after[sec.block]) isRows.push(after[sec.block]);
  });
  writeBlock_(ensureReportSheet_(SHEETS.RPT_IS), isRows);

  var bs = balanceSheet_(accounts, opening, lines, asOf, settings.fyStartMonth);
  var bsRows = [[settings.companyName + ' 資產負債表', '截至 ' + asOf], [stamp], ['科目代碼', '項目', '金額']];
  bs.sections.forEach(function (sec) {
    bsRows.push(['', sec.block, '']);
    sec.rows.forEach(function (r) { bsRows.push([r.code, '　' + r.name, r.amount]); });
    bsRows.push(['', sec.block + '合計', sec.total]);
  });
  bsRows.push(['', '資產總計', bs.summary.assets]);
  bsRows.push(['', '負債及權益總計', bs.summary.liabilitiesAndEquity]);
  if (bs.summary.difference) bsRows.push(['', '差額（不平衡，請檢查期初餘額）', bs.summary.difference]);
  writeBlock_(ensureReportSheet_(SHEETS.RPT_BS), bsRows);
}

// ───────────── 期初餘額 ─────────────

HANDLERS.getOpening = function () {
  var settings = loadSettings_();
  var accounts = loadAccounts_().filter(function (a) { return BLOCKS[a.block] && BLOCKS[a.block].statement === 'BS'; });
  var open = {};
  loadOpening_().forEach(function (o) { open[o.code] = o; });
  return {
    openingDate: settings.openingDate,
    locked: !!(settings.openingDate && lockedPeriodsMap_()[settings.openingDate.slice(0, 7)]),
    rows: accounts.sort(sortByCode_).map(function (a) {
      var o = open[a.code] || { debit: 0, credit: 0 };
      return { code: a.code, name: a.name, block: a.block, normal: a.normal, enabled: a.enabled, debit: o.debit, credit: o.credit };
    })
  };
};

HANDLERS.saveOpening = function (p, s) {
  return withLock_(function () {
    var settings = loadSettings_();
    if (!settings.openingDate) throw new Error('請先到「公司設定」填寫開帳日');
    if (lockedPeriodsMap_()[settings.openingDate.slice(0, 7)]) throw new Error('開帳日所在月份已鎖帳，不能修改期初餘額');
    var byCode = indexAccounts_(loadAccounts_());
    var rows = (p.rows || []).map(function (r) { return { code: str_(r.code), debit: toAmount_(r.debit), credit: toAmount_(r.credit) }; });
    var check = validateOpening_(rows, byCode);
    if (check.errors.length) throw new Error(check.errors.join('\n'));
    var objs = rows.filter(function (r) { return r.debit || r.credit; }).map(function (r) {
      return { '科目代碼': r.code, '科目名稱': byCode[r.code].name, '借方': r.debit || 0, '貸方': r.credit || 0 };
    });
    replaceAll_(SHEETS.OPENING, objs);
    log_(s.username, '儲存期初餘額', '借方 ' + check.debit + '，貸方 ' + check.credit);
    return { debit: check.debit, credit: check.credit, balanced: check.balanced };
  });
};

// ───────────── 月底盤點 ─────────────

function stocktakeRecords_(period) {
  return readObjects_(SHEETS.STOCKTAKE).filter(function (o) { return str_(o['期間']) === period; });
}

function checkStocktakePeriod_(period) {
  if (!isValidPeriod_(period)) throw new Error('期間格式需為 yyyy-MM');
  var od = loadSettings_().openingDate;
  if (od && monthEnd_(period) < od) throw new Error(period + ' 早於開帳日 ' + od + '，不能盤點');
}

/** 本期有效（未作廢）的盤點傳票號碼 */
function activeStocktakeNos_(records, lines) {
  var priorNos = {};
  records.forEach(function (r) { if (str_(r['傳票號碼'])) priorNos[str_(r['傳票號碼'])] = true; });
  return Object.keys(priorNos).filter(function (no) { return lines.some(function (l) { return l.no === no && l.status !== '作廢'; }); });
}

HANDLERS.stocktakePreview = function (p) {
  var period = str_(p.period);
  checkStocktakePeriod_(period);
  var records = stocktakeRecords_(period);
  var lines = loadLines_();
  var activeNos = activeStocktakeNos_(records, lines);
  var preview = stocktakePreview_(loadAccounts_(), loadOpening_(), lines, period, activeNos);
  var counted = {};
  records.forEach(function (r) { counted[str_(r['存貨科目'])] = toAmount_(r['盤點金額']); });
  preview.forEach(function (row) { row.counted = counted[row.code] !== undefined ? counted[row.code] : ''; });
  return { period: period, endDate: monthEnd_(period), locked: !!lockedPeriodsMap_()[period], rows: preview, priorVouchers: activeNos };
};

HANDLERS.stocktakeSave = function (p, s) {
  return withLock_(function () {
    var period = str_(p.period);
    checkStocktakePeriod_(period);
    var locked = lockedPeriodsMap_();
    if (locked[period]) throw new Error(period + ' 已鎖帳');
    var lines = loadLines_();
    var records = stocktakeRecords_(period);
    var activeNos = activeStocktakeNos_(records, lines);
    var accounts = loadAccounts_();
    var preview = stocktakePreview_(accounts, loadOpening_(), lines, period, activeNos);
    var built = buildStocktakeVoucher_(period, preview, p.counts || {});
    if (!built.detail.length) throw new Error('請至少填一個存貨科目的盤點金額');

    // 先確認新傳票可以成立，才作廢舊的（避免舊傳票作廢了、新傳票卻存不進去）
    if (built.voucher) {
      var check = validateVoucher_(built.voucher, { accountsByCode: indexAccounts_(accounts), openingDate: loadSettings_().openingDate, lockedPeriods: locked });
      if (check.errors.length) throw new Error('無法產生盤點傳票：\n' + check.errors.join('\n'));
    }
    var now = nowText_();
    lines.forEach(function (l) {
      if (activeNos.indexOf(l.no) >= 0) updateCells_(SHEETS.VOUCHERS, l._row, { '狀態': '作廢', '修改者': s.username, '修改時間': now });
    });
    var newNo = '';
    if (built.voucher) {
      built.voucher.source = '月底盤點';
      newNo = saveVoucherCore_(built.voucher, s).no;
    }
    deleteRowNumbers_(SHEETS.STOCKTAKE, records.map(function (r) { return r._row; }));
    appendObjects_(SHEETS.STOCKTAKE, built.detail.map(function (d) {
      return {
        '期間': period, '存貨科目': d.code, '存貨名稱': d.name, '帳上金額': d.book, '盤點金額': d.counted,
        '差額': d.diff, '對應成本科目': d.costCode, '傳票號碼': newNo, '建立者': s.username, '建立時間': now
      };
    }));
    log_(s.username, '月底盤點', period + (newNo ? ' 產生傳票 ' + newNo : ' 無差額') + (activeNos.length ? '，作廢舊傳票 ' + activeNos.join('、') : ''));
    return { period: period, voucherNo: newNo, detail: built.detail, voided: activeNos };
  });
};

/** 取消本月盤點：作廢盤點傳票並刪除盤點紀錄 */
HANDLERS.stocktakeClear = function (p, s) {
  return withLock_(function () {
    var period = str_(p.period);
    checkStocktakePeriod_(period);
    if (lockedPeriodsMap_()[period]) throw new Error(period + ' 已鎖帳');
    var reason = str_(p.reason);
    if (!reason) throw new Error('請填寫取消原因');
    var lines = loadLines_();
    var records = stocktakeRecords_(period);
    if (!records.length) throw new Error(period + ' 沒有盤點紀錄');
    var activeNos = activeStocktakeNos_(records, lines);
    var now = nowText_();
    lines.forEach(function (l) {
      if (activeNos.indexOf(l.no) >= 0) updateCells_(SHEETS.VOUCHERS, l._row, { '狀態': '作廢', '修改者': s.username, '修改時間': now });
    });
    deleteRowNumbers_(SHEETS.STOCKTAKE, records.map(function (r) { return r._row; }));
    log_(s.username, '取消月底盤點', period + '：' + reason + (activeNos.length ? '，作廢傳票 ' + activeNos.join('、') : ''));
    return { period: period, voided: activeNos };
  });
};

// ───────────── 期間鎖帳 ─────────────

HANDLERS.listPeriods = function () {
  var settings = loadSettings_();
  var lines = loadLines_();
  var today = todayText_();
  var first = settings.openingDate ? settings.openingDate.slice(0, 7) : today.slice(0, 7);
  lines.forEach(function (l) { if (l.date && l.date.slice(0, 7) < first) first = l.date.slice(0, 7); });
  var map = {};
  loadPeriods_().forEach(function (p) { map[p.period] = p; });
  var counts = {};
  activeLines_(lines).forEach(function (l) { var k = l.date.slice(0, 7); counts[k] = counts[k] || {}; counts[k][l.no] = true; });
  var out = [];
  var y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7));
  var last = today.slice(0, 7);
  var guard = 0;
  while (guard++ < 600) {
    var k = y + '-' + pad_(m, 2);
    var rec = map[k] || {};
    out.push({ period: k, status: rec.status || '開放', lockedBy: rec.lockedBy || '', lockedAt: rec.lockedAt || '', vouchers: counts[k] ? Object.keys(counts[k]).length : 0 });
    if (k >= last) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out.reverse();
};

function setPeriodStatus_(period, status, s) {
  if (!isValidPeriod_(period)) throw new Error('期間格式需為 yyyy-MM');
  var rec = loadPeriods_().filter(function (p) { return p.period === period; })[0];
  var patch = { '狀態': status, '鎖定人': status === '已鎖定' ? s.username : '', '鎖定時間': status === '已鎖定' ? nowText_() : '' };
  if (rec) updateCells_(SHEETS.PERIODS, rec._row, patch);
  else appendObjects_(SHEETS.PERIODS, [{ '期間': period, '狀態': status, '鎖定人': patch['鎖定人'], '鎖定時間': patch['鎖定時間'] }]);
}

HANDLERS.lockPeriod = function (p, s) {
  return withLock_(function () {
    var period = str_(p.period);
    var tb = trialBalance_(loadAccounts_(), loadOpening_(), loadLines_(), '', monthEnd_(period));
    if (!tb.balanced) throw new Error('截至 ' + monthEnd_(period) + ' 的試算表借貸不平衡（多半是期初餘額未平衡），請先修正再鎖帳');
    setPeriodStatus_(period, '已鎖定', s);
    log_(s.username, '鎖帳', period);
    return { period: period };
  });
};

HANDLERS.unlockPeriod = function (p, s) {
  return withLock_(function () {
    var reason = str_(p.reason);
    if (!reason) throw new Error('請填寫解鎖原因');
    setPeriodStatus_(str_(p.period), '開放', s);
    log_(s.username, '解鎖', p.period + '：' + reason);
    return { period: p.period };
  });
};

// ───────────── 科目管理 ─────────────

HANDLERS.listReference = function () {
  var mine = indexAccounts_(loadAccounts_());
  return loadReference_().map(function (r) { r.inCompany = !!mine[r.code]; return r; });
};

function addReferenceAccounts_(codes, s) {
  var ref = indexAccounts_(loadReference_());
  var mine = indexAccounts_(loadAccounts_());
  var toAdd = {};
  codes.forEach(function (c) {
    var r = ref[c];
    if (!r || mine[c]) return;
    toAdd[c] = r;
    if (r.stockCost && !mine[r.stockCost] && ref[r.stockCost]) toAdd[r.stockCost] = ref[r.stockCost];
  });
  var list = Object.keys(toAdd).sort().map(function (c) {
    var r = toAdd[c];
    return accountToObj_({ code: r.code, name: r.name, normal: r.normal, block: r.block, industries: r.industries, stockCost: r.stockCost, enabled: true, source: '參考庫', note: r.note });
  });
  appendObjects_(SHEETS.ACCOUNTS, list);
  if (list.length) log_(s.username, '加入參考科目', list.map(function (o) { return o['科目代碼']; }).join('、'));
  return { added: list.length };
}

HANDLERS.addFromReference = function (p, s) {
  return withLock_(function () { return addReferenceAccounts_(p.codes || [], s); });
};

HANDLERS.addByIndustry = function (p, s) {
  return withLock_(function () {
    var wanted = (p.industries || []).concat(['通用']);
    var codes = loadReference_().filter(function (r) {
      return r.industries.split(',').some(function (i) { return wanted.indexOf(str_(i)) >= 0; });
    }).map(function (r) { return r.code; });
    return addReferenceAccounts_(codes, s);
  });
};

HANDLERS.saveAccount = function (p, s) {
  return withLock_(function () {
    var a = p.account || {};
    var accounts = loadAccounts_();
    var byCode = indexAccounts_(accounts);
    var acc = {
      code: str_(a.code), name: str_(a.name), block: str_(a.block), normal: str_(a.normal),
      industries: str_(a.industries), stockCost: str_(a.stockCost), note: str_(a.note),
      enabled: a.enabled !== false
    };
    var errors = validateAccount_(acc, byCode, !!p.isNew);
    if (acc.stockCost === acc.code) errors.push('盤點對應成本科目不能是自己');
    if (errors.length) throw new Error(errors.join('\n'));
    if (p.isNew) {
      acc.source = '自訂';
      appendObjects_(SHEETS.ACCOUNTS, [accountToObj_(acc)]);
      log_(s.username, '新增科目', acc.code + ' ' + acc.name);
    } else {
      var old = byCode[acc.code];
      if (!old) throw new Error('科目 ' + acc.code + ' 不存在');
      var used = loadLines_().some(function (l) { return l.code === acc.code; }) || loadOpening_().some(function (o) { return o.code === acc.code; });
      if (used && old.block !== acc.block) throw new Error('此科目已有分錄或期初餘額，不能更改報表區塊；請停用後另開新科目');
      acc.source = old.source;
      var obj = accountToObj_(acc);
      updateCells_(SHEETS.ACCOUNTS, old._row, obj);
      log_(s.username, '修改科目', acc.code + ' ' + acc.name);
    }
    return { code: acc.code };
  });
};

HANDLERS.toggleAccount = function (p, s) {
  return withLock_(function () {
    var acc = indexAccounts_(loadAccounts_())[str_(p.code)];
    if (!acc) throw new Error('科目不存在');
    updateCells_(SHEETS.ACCOUNTS, acc._row, { '啟用': p.enabled ? '是' : '否' });
    log_(s.username, p.enabled ? '啟用科目' : '停用科目', acc.code + ' ' + acc.name);
    return { code: acc.code, enabled: !!p.enabled };
  });
};

// ───────────── 公司設定 ─────────────

HANDLERS.getSettings = function () {
  return loadSettings_();
};

HANDLERS.saveSettings = function (p, s) {
  return withLock_(function () {
    var errors = [];
    var st = {
      companyName: str_(p.companyName), taxId: str_(p.taxId),
      industries: (p.industries || []).filter(function (i) { return INDUSTRIES.indexOf(i) >= 0; }),
      vatType: str_(p.vatType), fyStartMonth: Number(p.fyStartMonth), openingDate: str_(p.openingDate)
    };
    if (!st.companyName) errors.push('請填公司名稱');
    if (st.taxId && !isValidTaxId_(st.taxId)) errors.push('統一編號檢查碼不正確');
    if (['一般稅額', '小規模'].indexOf(st.vatType) < 0) errors.push('營業稅類型需為「一般稅額」或「小規模」');
    if (!(st.fyStartMonth >= 1 && st.fyStartMonth <= 12)) errors.push('會計年度起始月需為 1～12');
    if (st.openingDate && !isValidDate_(st.openingDate)) errors.push('開帳日格式需為 yyyy-MM-dd');
    if (!st.industries.length) st.industries = ['通用'];
    var old = loadSettings_();
    if (old.openingDate && !st.openingDate && (loadOpening_().length || loadLines_().length)) {
      errors.push('已有期初餘額或傳票，開帳日不能清空');
    }
    if (st.openingDate && st.openingDate !== old.openingDate) {
      var earlier = loadLines_().filter(function (l) { return l.status !== '作廢' && l.date < st.openingDate; });
      if (earlier.length) errors.push('已有早於 ' + st.openingDate + ' 的傳票（' + earlier[0].no + '），不能把開帳日改晚');
    }
    if (errors.length) throw new Error(errors.join('\n'));
    saveSettings_(st);
    log_(s.username, '修改公司設定', st);
    return st;
  });
};

// ───────────── 帳號 ─────────────

HANDLERS.listUsers = function () {
  return loadUsers_().map(function (u) {
    return { username: u.username, name: u.name, role: u.role, enabled: u.enabled, createdAt: u.createdAt, lastLogin: u.lastLogin };
  });
};

HANDLERS.saveUser = function (p, s) {
  return withLock_(function () {
    if (ROLES.indexOf(p.role) < 0) throw new Error('角色不正確');
    if (p.isNew) {
      var pw = createUser_(p.username, p.name, p.role);
      log_(s.username, '新增帳號', p.username + '（' + p.role + '）');
      return { username: p.username, tempPassword: pw };
    }
    var u = findUser_(p.username);
    if (!u) throw new Error('帳號不存在');
    var admins = loadUsers_().filter(function (x) { return x.enabled && x.role === '管理者'; });
    var losingAdmin = u.role === '管理者' && (p.role !== '管理者' || p.enabled === false);
    if (losingAdmin && admins.length <= 1) throw new Error('至少要保留一位啟用中的管理者');
    if (u.username === s.username && losingAdmin) throw new Error('不能取消自己的管理者權限');
    updateCells_(SHEETS.USERS, u._row, { '姓名': str_(p.name) || u.name, '角色': p.role, '啟用': p.enabled === false ? '否' : '是' });
    log_(s.username, '修改帳號', u.username + '：' + p.role + (p.enabled === false ? '（停用）' : ''));
    return { username: u.username };
  });
};

HANDLERS.resetPassword = function (p, s) {
  var u = findUser_(p.username);
  if (!u) throw new Error('帳號不存在');
  var pw = randomPassword_();
  setPassword_(u, pw);
  log_(s.username, '重設密碼', u.username);
  return { username: u.username, tempPassword: pw };
};

HANDLERS.changePassword = function (p, s) {
  var u = findUser_(s.username);
  if (!u || hashPassword_(u.salt, String(p.oldPassword || '')) !== u.hash) throw new Error('目前密碼不正確');
  var err = validatePasswordStrength_(p.newPassword);
  if (err) throw new Error(err);
  setPassword_(u, p.newPassword);
  log_(s.username, '變更密碼', '');
  // 舊的登入（含其他裝置）全部失效，回傳新的登入憑證給目前這個畫面
  return issueSession_(findUser_(s.username));
};

HANDLERS.listLog = function (p) {
  var rows = readObjects_(SHEETS.LOG);
  var limit = Math.min(Number(p.limit) || 200, 1000);
  return rows.slice(-limit).reverse().map(function (o) {
    return { time: str_(o['時間']), user: str_(o['帳號']), action: str_(o['動作']), detail: str_(o['內容']) };
  });
};

// ===== 50_Setup.js =====
/**
 * 初始設定與試算表選單
 * 第一次使用：在 Apps Script 編輯器選 setup → 執行 → 授權，
 * 再到「執行紀錄」看管理者帳號 admin 的臨時密碼。
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu(APP.name)
    .addItem('初始設定／更新科目參考庫', 'setup')
    .addItem('更新本月報表到試算表', 'writeReportsThisMonth')
    .addSeparator()
    .addItem('重設 admin 密碼', 'resetAdminPassword')
    .addToUi();
}

/**
 * 安全防護：setup、重設密碼等管理函式只能由有權編輯試算表的人，
 * 從試算表選單或 Apps Script 編輯器執行；網頁訪客（匿名）呼叫會被拒絕。
 */
function requireEditor_() {
  var active = '', effective = '';
  try { active = Session.getActiveUser().getEmail(); effective = Session.getEffectiveUser().getEmail(); } catch (e) { active = ''; }
  // 網頁以部署者身分執行：訪客的 active 為空白或與部署者不同 → 拒絕
  if (!active || active !== effective) throw new Error('此功能只能從試算表選單或 Apps Script 編輯器執行');
  return active;
}

function setup() {
  requireEditor_();
  var ss = ss_();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  var order = [SHEETS.SETTINGS, SHEETS.ACCOUNTS, SHEETS.OPENING, SHEETS.VOUCHERS, SHEETS.PERIODS, SHEETS.STOCKTAKE, SHEETS.REF, SHEETS.USERS, SHEETS.LOG];
  order.forEach(function (name) { ensureSheet_(ss, name); });

  // 科目參考庫：每次執行都以程式內建版本覆蓋（公版更新時同步）
  replaceAll_(SHEETS.REF, referenceAccountObjects_().map(function (a) {
    return {
      '科目代碼': a.code, '科目名稱': a.name, '類別': a.category, '正常餘額': a.normal, '報表區塊': a.block,
      '適用產業': a.industries, '盤點對應成本科目': a.stockCost, '說明': a.note
    };
  }));

  // 公司設定：補上缺少的項目，不覆蓋已填的值
  var existing = {};
  readObjects_(SHEETS.SETTINGS).forEach(function (o) { existing[str_(o['項目'])] = true; });
  var missing = DEFAULT_SETTINGS.filter(function (d) { return !existing[d[0]]; });
  appendObjects_(SHEETS.SETTINGS, missing.map(function (d) { return { '項目': d[0], '值': d[1], '說明': d[2] }; }));

  ss.getSheetByName(SHEETS.USERS).hideSheet();
  ss.getSheetByName(SHEETS.LOG).hideSheet();

  var msg = '初始設定完成。';
  if (!loadUsers_().length) {
    var pw = createUser_('admin', '管理者', '管理者');
    msg += '\n已建立管理者帳號 admin，臨時密碼：' + pw + '\n請登入後立即到「變更密碼」修改。';
    log_('system', '初始設定', '建立 admin 帳號');
  } else {
    log_('system', '初始設定', '更新科目參考庫');
  }
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* 從編輯器執行時沒有對話框，請看執行紀錄 */ }
}

function ensureSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var headers = HEADERS[name];
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  var head = sh.getRange(1, 1, 1, headers.length);
  head.setValues([headers]);
  head.setFontWeight('bold');
  head.setBackground('#eef2f7');
  sh.setFrozenRows(1);
  (TEXT_COLUMNS[name] || []).forEach(function (h) {
    var col = headers.indexOf(h) + 1;
    if (col > 0) sh.getRange(2, col, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  });
  return sh;
}

/** 選單：把本月損益、試算表與今日資產負債表寫入試算表 */
function writeReportsThisMonth() {
  requireEditor_();
  var today = todayText_();
  writeReportSheets_(monthStart_(today.slice(0, 7)), today, today);
  log_('system', '寫入報表分頁', '選單執行');
  try { SpreadsheetApp.getUi().alert('已更新「報表_」三個分頁'); } catch (e) { /* 編輯器執行 */ }
}

/** 忘記管理者密碼時使用：重設 admin 並在執行紀錄顯示新臨時密碼 */
function resetAdminPassword() {
  requireEditor_();
  var u = findUser_('admin');
  var msg;
  if (!u) {
    var pw0 = createUser_('admin', '管理者', '管理者');
    msg = '已重新建立 admin，臨時密碼：' + pw0;
  } else {
    var pw = randomPassword_();
    setPassword_(u, pw);
    updateCells_(SHEETS.USERS, u._row, { '啟用': '是', '角色': '管理者' });
    msg = 'admin 臨時密碼：' + pw;
  }
  log_('system', '重設 admin 密碼', '');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* 編輯器執行 */ }
}
