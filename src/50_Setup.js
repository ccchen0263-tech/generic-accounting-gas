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
