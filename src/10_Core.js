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
