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
