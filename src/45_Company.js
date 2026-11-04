/**
 * 集團：公司清單、依公司的權限、新增公司、帳號管理、集團合併報表、傳票範本
 */

// ───────────── 公司與權限 ─────────────

function loadCompanies_() {
  return readObjects_(SHEETS.COMPANIES).map(function (o) {
    return {
      id: str_(o['公司代碼']), name: str_(o['公司名稱']), spreadsheetId: str_(o['試算表ID']),
      enabled: str_(o['啟用']) !== '否', createdAt: str_(o['建立時間']), _row: o._row
    };
  }).filter(function (c) { return c.id && c.spreadsheetId; });
}

function loadAccess_() {
  return readObjects_(SHEETS.ACCESS).map(function (o) {
    return { username: str_(o['帳號']), companyId: str_(o['公司代碼']), role: str_(o['角色']), _row: o._row };
  }).filter(function (a) { return a.username && a.companyId; });
}

/** 某人在某公司的角色；集團管理者在每家公司都是管理者 */
function companyRoleOf_(session, companyId, access) {
  if (session.groupRole === '管理者') return '管理者';
  var key = session.username.toLowerCase();
  var row = (access || loadAccess_()).filter(function (a) { return a.username.toLowerCase() === key && a.companyId === companyId; })[0];
  return row && ROLES.indexOf(row.role) >= 0 ? row.role : null;
}

/** 這個人可以進入的公司（啟用中），依公司代碼排序 */
function accessibleCompanies_(session) {
  var access = session.groupRole === '管理者' ? [] : loadAccess_();
  return loadCompanies_().filter(function (c) { return c.enabled; })
    .sort(function (a, b) { return a.id < b.id ? -1 : 1; })
    .map(function (c) { return { company: { id: c.id, name: c.name, spreadsheetId: c.spreadsheetId }, role: companyRoleOf_(session, c.id, access) }; })
    .filter(function (x) { return x.role; });
}

function consolidatedCompanies_(session) {
  return (session.companies || []).filter(function (x) { return CONSOLIDATED_ROLES.indexOf(x.role) >= 0; });
}

function nextCompanyId_(companies) {
  var max = 0;
  companies.forEach(function (c) { var n = Number(String(c.id).replace(/\D/g, '')); if (n > max) max = n; });
  return 'C' + pad_(max + 1, 2);
}

/** 在目前 CTX 指到的公司試算表建立公司用的工作表與科目參考庫 */
function initCompanySheets_(companyName) {
  var ss = ss_();
  COMPANY_SHEETS.forEach(function (name) { ensureSheet_(ss, name); });
  replaceAll_(SHEETS.REF, referenceAccountObjects_().map(function (a) {
    return {
      '科目代碼': a.code, '科目名稱': a.name, '類別': a.category, '正常餘額': a.normal, '報表區塊': a.block,
      '適用產業': a.industries, '盤點對應成本科目': a.stockCost, '說明': a.note
    };
  }));
  var existing = {};
  readObjects_(SHEETS.SETTINGS).forEach(function (o) { existing[str_(o['項目'])] = o; });
  var missing = DEFAULT_SETTINGS.filter(function (d) { return !existing[d[0]]; });
  appendObjects_(SHEETS.SETTINGS, missing.map(function (d) {
    return { '項目': d[0], '值': d[0] === '公司名稱' ? (companyName || '') : d[1], '說明': d[2] };
  }));
  if (existing['公司名稱'] && !str_(existing['公司名稱']['值']) && companyName) updateCells_(SHEETS.SETTINGS, existing['公司名稱']._row, { '值': companyName });
}

// ───────────── 公司管理（集團管理者） ─────────────

HANDLERS.listCompanies = function () {
  return loadCompanies_().sort(function (a, b) { return a.id < b.id ? -1 : 1; }).map(function (c) {
    var url = '';
    try { url = 'https://docs.google.com/spreadsheets/d/' + c.spreadsheetId + '/edit'; } catch (e) { url = ''; }
    return { id: c.id, name: c.name, enabled: c.enabled, createdAt: c.createdAt, url: url, isHub: c.spreadsheetId === hubSs_().getId() };
  });
};

HANDLERS.createCompany = function (p, s) {
  return withLock_(function () {
    var name = str_(p.name);
    if (!name) throw new Error('請填公司名稱');
    var companies = loadCompanies_();
    if (companies.some(function (c) { return c.name === name; })) throw new Error('已經有「' + name + '」');
    var industries = (p.industries || []).filter(function (i) { return INDUSTRIES.indexOf(i) >= 0; });
    var newSs = SpreadsheetApp.create(name + '｜會計帳');
    // 放到集團主檔所在的資料夾
    try {
      var parents = DriveApp.getFileById(hubSs_().getId()).getParents();
      if (parents.hasNext()) DriveApp.getFileById(newSs.getId()).moveTo(parents.next());
    } catch (e) { /* 移動失敗時留在雲端硬碟根目錄 */ }
    var id = nextCompanyId_(companies);
    appendObjects_(SHEETS.COMPANIES, [{ '公司代碼': id, '公司名稱': name, '試算表ID': newSs.getId(), '啟用': '是', '建立時間': nowText_() }]);
    var prev = CTX.company;
    CTX.company = { id: id, name: name, spreadsheetId: newSs.getId() };
    CTX.ssCache[newSs.getId()] = newSs;
    try {
      initCompanySheets_(name);
      // 移除新試算表預設的空白工作表
      newSs.getSheets().forEach(function (sh) { if (!HEADERS[sh.getName()] && newSs.getSheets().length > 1) newSs.deleteSheet(sh); });
      var st = loadSettings_();
      st.companyName = name;
      st.taxId = str_(p.taxId);
      st.industries = industries.length ? industries : ['通用'];
      if (p.vatType) st.vatType = p.vatType;
      saveSettings_(st);
      if (p.addAccounts !== false) addReferenceAccounts_(referenceCodesFor_(st.industries), s);
      log_(s.username, '新增公司', id + ' ' + name);
    } finally {
      CTX.company = prev;
    }
    return { id: id, name: name, url: 'https://docs.google.com/spreadsheets/d/' + newSs.getId() + '/edit' };
  });
};

HANDLERS.saveCompany = function (p, s) {
  return withLock_(function () {
    var companies = loadCompanies_();
    var c = companies.filter(function (x) { return x.id === p.id; })[0];
    if (!c) throw new Error('公司不存在');
    var name = str_(p.name) || c.name;
    var enabled = p.enabled !== false;
    if (!enabled && companies.filter(function (x) { return x.enabled && x.id !== c.id; }).length === 0) throw new Error('至少要保留一家啟用中的公司');
    updateCells_(SHEETS.COMPANIES, c._row, { '公司名稱': name, '啟用': enabled ? '是' : '否' });
    if (name !== c.name) {
      var prev = CTX.company;
      CTX.company = { id: c.id, name: name, spreadsheetId: c.spreadsheetId };
      try {
        var st = loadSettings_();
        st.companyName = name;
        saveSettings_(st);
      } finally { CTX.company = prev; }
    }
    log_(s.username, '修改公司', c.id + ' ' + name + (enabled ? '' : '（停用）'));
    return { id: c.id };
  });
};

/** 依產業挑出參考庫科目代碼（含通用） */
function referenceCodesFor_(industries) {
  var wanted = (industries || []).concat(['通用']);
  return loadReference_().filter(function (r) {
    return r.industries.split(',').some(function (i) { return wanted.indexOf(str_(i)) >= 0; });
  }).map(function (r) { return r.code; });
}

// ───────────── 帳號（集團管理者） ─────────────

HANDLERS.listUsers = function () {
  var companies = loadCompanies_();
  var names = {};
  companies.forEach(function (c) { names[c.id] = c.name; });
  var access = loadAccess_();
  return {
    companies: companies.filter(function (c) { return c.enabled; }).map(function (c) { return { id: c.id, name: c.name }; }),
    users: loadUsers_().map(function (u) {
      var groupRole = u.role === '管理者' ? '管理者' : '成員';
      return {
        username: u.username, name: u.name, groupRole: groupRole, enabled: u.enabled, createdAt: u.createdAt, lastLogin: u.lastLogin,
        access: groupRole === '管理者' ? [] : access.filter(function (a) { return a.username.toLowerCase() === u.username.toLowerCase(); })
          .map(function (a) { return { companyId: a.companyId, companyName: names[a.companyId] || a.companyId, role: a.role }; })
      };
    })
  };
};

/**
 * 新增或修改帳號
 * p = { isNew, username, name, groupRole: 管理者|成員, enabled, access: [{ companyId, role }] }
 * 相容舊格式：p.role 為公司角色時，視為「成員」並只給目前這家公司該角色
 */
HANDLERS.saveUser = function (p, s) {
  return withLock_(function () {
    var groupRole = p.groupRole;
    var access = p.access;
    if (!groupRole && p.role) {
      if (p.role === '管理者') groupRole = '管理者';
      else { groupRole = '成員'; access = [{ companyId: CTX.company.id, role: p.role }]; }
    }
    if (GROUP_ROLES.indexOf(groupRole) < 0) throw new Error('身分不正確');
    var companies = {};
    loadCompanies_().forEach(function (c) { companies[c.id] = c; });
    access = (groupRole === '成員' ? (access || []) : []).filter(function (a) { return a && a.role; });
    access.forEach(function (a) {
      if (!companies[a.companyId]) throw new Error('公司 ' + a.companyId + ' 不存在');
      if (ROLES.indexOf(a.role) < 0) throw new Error('角色不正確：' + a.role);
    });
    if (groupRole === '成員' && !access.length && p.enabled !== false) throw new Error('一般成員至少要指派一家公司');

    var username = str_(p.username);
    var result = { username: username };
    if (p.isNew) {
      result.tempPassword = createUser_(username, p.name, groupRole);
    } else {
      var u = findUser_(username);
      if (!u) throw new Error('帳號不存在');
      username = u.username;
      var admins = loadUsers_().filter(function (x) { return x.enabled && x.role === '管理者'; });
      var losingAdmin = u.role === '管理者' && (groupRole !== '管理者' || p.enabled === false);
      if (losingAdmin && admins.length <= 1) throw new Error('至少要保留一位啟用中的集團管理者');
      if (u.username === s.username && losingAdmin) throw new Error('不能取消自己的集團管理者身分');
      updateCells_(SHEETS.USERS, u._row, { '姓名': str_(p.name) || u.name, '角色': groupRole, '啟用': p.enabled === false ? '否' : '是' });
    }
    // 重寫此人的公司權限
    var key = username.toLowerCase();
    deleteRowNumbers_(SHEETS.ACCESS, loadAccess_().filter(function (a) { return a.username.toLowerCase() === key; }).map(function (a) { return a._row; }));
    appendObjects_(SHEETS.ACCESS, access.map(function (a) { return { '帳號': username, '公司代碼': a.companyId, '角色': a.role }; }));
    var desc = groupRole === '管理者' ? '集團管理者' : access.map(function (a) { return (companies[a.companyId] || {}).name + '：' + a.role; }).join('、');
    log_(s.username, p.isNew ? '新增帳號' : '修改帳號', username + '（' + desc + '）' + (p.enabled === false ? '（停用）' : ''));
    return result;
  });
};

HANDLERS.listLog = function (p) {
  var rows = readObjects_(SHEETS.LOG);
  var limit = Math.min(Number(p.limit) || 200, 1000);
  return rows.slice(-limit).reverse().map(function (o) {
    return { time: str_(o['時間']), user: str_(o['帳號']), action: str_(o['動作']), detail: str_(o['內容']), company: str_(o['公司']) };
  });
};

// ───────────── 集團合併報表 ─────────────

/**
 * p = { type: 'is' | 'bs', from, to, asOf }
 * 每家公司各自計算（開帳日之前沒有資料的公司以空白呈現），再並排加總
 */
HANDLERS.consolidated = function (p, s) {
  var list = consolidatedCompanies_(s);
  if (list.length < 2) throw new Error('集團報表需要至少兩家您有「管理者」或「會計」權限的公司');
  var type = p.type === 'bs' ? 'bs' : 'is';
  var prev = CTX.company;
  var items = [];
  try {
    list.forEach(function (x) {
      CTX.company = x.company;
      var item = { id: x.company.id, name: x.company.name, statement: null };
      try {
        var settings = loadSettings_();
        if (type === 'bs') {
          item.statement = balanceSheet_(loadAccounts_(), loadOpening_(), loadLines_(), asOfOf_(p.asOf), settings.fyStartMonth);
        } else {
          var r = rangeOf_(p);
          item.statement = incomeStatement_(loadAccounts_(), loadLines_(), r.from, r.to);
        }
      } catch (e) {
        item.note = e.message;
      }
      items.push(item);
    });
  } finally {
    CTX.company = prev;
  }
  var merged = mergeStatements_(items);
  merged.type = type;
  merged.from = p.from; merged.to = p.to; merged.asOf = p.asOf;
  return merged;
};

// ───────────── 傳票範本 ─────────────

HANDLERS.voucherTemplates = function () {
  return templatesFor_(loadSettings_().industries, loadAccounts_());
};
