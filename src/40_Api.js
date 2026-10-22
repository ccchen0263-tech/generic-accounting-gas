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
