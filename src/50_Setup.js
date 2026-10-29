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
  var hub = hubSs_();
  CTX.company = null;
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', hub.getId());
  HUB_SHEETS.forEach(function (name) { ensureSheet_(hub, name); });

  // 第一次（或從單一公司版升級）：這份試算表本身就是第一家公司
  if (!loadCompanies_().length) {
    var firstName = '';
    try {
      var sh = hub.getSheetByName(SHEETS.SETTINGS);
      if (sh) firstName = loadSettings_().companyName;
    } catch (e) { firstName = ''; }
    appendObjects_(SHEETS.COMPANIES, [{ '公司代碼': 'C01', '公司名稱': firstName || '公司一', '試算表ID': hub.getId(), '啟用': '是', '建立時間': nowText_() }]);
  }

  // 每家公司：補齊工作表、更新科目參考庫（公版更新時同步）
  var notes = [];
  loadCompanies_().forEach(function (c) {
    CTX.company = { id: c.id, name: c.name, spreadsheetId: c.spreadsheetId };
    CTX.ssCache = {};
    try { initCompanySheets_(c.name); notes.push(c.id + ' ' + c.name + '：完成'); }
    catch (e) { notes.push(c.id + ' ' + c.name + '：失敗（' + e.message + '）'); }
  });
  CTX.company = null;

  // 舊版帳號升級：原本的「會計／助理」改成成員，並給第一家公司相同角色
  var first = loadCompanies_()[0];
  loadUsers_().forEach(function (u) {
    if (u.role === '管理者' || u.role === '成員') return;
    if (ROLES.indexOf(u.role) >= 0) appendObjects_(SHEETS.ACCESS, [{ '帳號': u.username, '公司代碼': first.id, '角色': u.role }]);
    updateCells_(SHEETS.USERS, u._row, { '角色': '成員' });
  });

  [SHEETS.USERS, SHEETS.ACCESS, SHEETS.LOG].forEach(function (n) { hub.getSheetByName(n).hideSheet(); });

  var msg = '初始設定完成。\n' + notes.join('\n');
  if (!loadUsers_().length) {
    var pw = createUser_('admin', '管理者', '管理者');
    msg += '\n已建立集團管理者帳號 admin，臨時密碼：' + pw + '\n請登入後立即到「變更密碼」修改。';
    log_('system', '初始設定', '建立 admin 帳號');
  } else {
    log_('system', '初始設定', '更新工作表與科目參考庫');
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
  var hubId = hubSs_().getId();
  CTX.company = loadCompanies_().filter(function (c) { return c.spreadsheetId === hubId; })[0] || null;
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
