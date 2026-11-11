/**
 * 單據辨識的純計算（不呼叫任何 Google 服務，可在本機測試）
 *   parseReceiptText_ ：把 OCR 讀出的文字整理成日期、發票號碼、統編、金額
 *   parseInvoiceCsv_  ：解析財政部下載的進項發票檔
 *   suggestExpense_   ：依賣方名稱與內容建議費用科目
 *   docToLines_       ：單據 → 建議分錄
 */

/** 民國或西元年月日 → yyyy-MM-dd；不合法回傳 '' */
function toIsoDate_(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (!y || !m || !d) return '';
  if (y < 1000) y += 1911;
  var s = y + '-' + pad_(m, 2) + '-' + pad_(d, 2);
  return isValidDate_(s) ? s : '';
}

/** 單一日期字串（2026-11-03、2026/11/3、115/11/03、1151103、20261103、115年11月3日）→ yyyy-MM-dd */
function normalizeDate_(v) {
  var s = str_(v).replace(/\s/g, '');
  if (!s) return '';
  var m = /^(\d{2,4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?/.exec(s);
  if (m) return toIsoDate_(m[1], m[2], m[3]);
  if (/^\d{8}$/.test(s)) return toIsoDate_(s.slice(0, 4), s.slice(4, 6), s.slice(6, 8));
  if (/^\d{7}$/.test(s)) return toIsoDate_(s.slice(0, 3), s.slice(3, 5), s.slice(5, 7));
  return '';
}

/** 文字中的金額字串 → 整數（1,234、NT$1234、$ 1,234.00） */
function moneyOf_(s) {
  var t = String(s).replace(/[,，\s]/g, '').replace(/NT\$|\$|元/gi, '');
  var m = /-?\d+(\.\d+)?/.exec(t);
  return m ? Math.round(Number(m[0])) : NaN;
}

/** 找出「關鍵字」後面最近的金額（同一行或下一行） */
function amountAfter_(lines, keywords, exclude) {
  var re = new RegExp('(' + keywords.join('|') + ')');
  var ex = exclude ? new RegExp('(' + exclude.join('|') + ')') : null;
  var best = NaN;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var hit = re.exec(line);
    if (!hit || (ex && ex.test(line))) continue;
    var rest = line.slice(hit.index + hit[0].length);
    var nums = rest.match(/\d[\d,]*(\.\d+)?/g);
    if (!nums && i + 1 < lines.length) nums = lines[i + 1].match(/^\s*(NT\$|\$)?\s*(\d[\d,]*(\.\d+)?)\s*元?\s*$/) ? [lines[i + 1]] : null;
    if (!nums) continue;
    var v = moneyOf_(nums[nums.length - 1]);
    if (!isNaN(v) && v > 0 && v < 100000000 && (isNaN(best) || v > best)) best = v;
  }
  return best;
}

/**
 * 把 OCR 文字整理成欄位。辨識不到的欄位留空，交給使用者補。
 * own = { taxId, name }：本公司統編與名稱，用來分辨買方與賣方
 */
function parseReceiptText_(text, own) {
  own = own || {};
  var raw = String(text || '');
  var lines = raw.split(/\r?\n/).map(function (l) { return l.replace(/　/g, ' ').trim(); }).filter(String);
  var flat = lines.join('\n');
  var out = { kind: '其他', invoiceNo: '', date: '', sellerName: '', sellerTaxId: '', buyerTaxId: '', net: 0, tax: 0, total: 0, src: {} };

  // 發票號碼：兩個英文字母 + 8 碼數字
  var inv = /(^|[^A-Z])([A-Z]{2})\s*[-－]?\s*(\d{8})(?!\d)/.exec(flat.toUpperCase());
  if (inv) { out.invoiceNo = inv[2] + inv[3]; out.src.invoiceNo = '原文'; }

  // 日期：先找年月日格式，再找連續數字
  var dm = /(\d{2,4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/g, d;
  while ((d = dm.exec(flat)) && !out.date) out.date = toIsoDate_(d[1], d[2], d[3]);
  if (out.date) out.src.date = '原文';

  // 統編：8 碼且檢查碼正確；等於本公司的是買方，其他第一個是賣方
  var ids = [];
  (flat.match(/(^|\D)(\d{8})(?!\d)/g) || []).forEach(function (m) {
    var id = m.replace(/\D/g, '');
    if (id === out.invoiceNo.slice(2)) return;
    if (isValidTaxId_(id) && ids.indexOf(id) < 0) ids.push(id);
  });
  ids.forEach(function (id) {
    if (own.taxId && id === own.taxId) out.buyerTaxId = id;
    else if (!out.sellerTaxId) out.sellerTaxId = id;
  });
  if (!own.taxId) {
    var buyerLine = lines.filter(function (l) { return /買(受人|方)/.test(l); })[0];
    var bm = buyerLine && /(\d{8})/.exec(buyerLine);
    if (bm && isValidTaxId_(bm[1])) {
      out.buyerTaxId = bm[1];
      if (out.sellerTaxId === bm[1]) out.sellerTaxId = ids.filter(function (x) { return x !== bm[1]; })[0] || '';
    }
  }

  // 賣方名稱：含「公司、商行、企業社…」且不是本公司的第一行
  var ownName = str_(own.name);
  var nameLine = lines.filter(function (l) {
    if (!/(股份有限公司|有限公司|公司|商行|企業社|商號|工作室|實業|行號|門市|分公司)/.test(l)) return false;
    if (ownName && l.indexOf(ownName) >= 0) return false;
    return !/(統一發票|電子發票|買受人|地址|電話)/.test(l);
  })[0];
  // 找不到公司名稱時：短短一行、以「行、店、社、坊、館、廠」結尾的店名（收據常見）
  if (!nameLine) nameLine = lines.filter(function (l) {
    return l.length <= 20 && !/\d/.test(l) && /(行|店|社|坊|館|廠|商號)$/.test(l) && (!ownName || l.indexOf(ownName) < 0) && !/(銀行|發票|收據)/.test(l);
  })[0];
  if (nameLine) out.sellerName = nameLine.replace(/^(賣方|營業人|名稱|店名)[:：\s]*/, '').replace(/(統一編號|統編|賣方)[\s\S]*$/, '').trim().slice(0, 40);
  if (out.sellerName) out.src.sellerName = '原文';
  if (out.sellerTaxId) out.src.sellerTaxId = '原文';
  if (out.buyerTaxId) out.src.buyerTaxId = '原文';

  // 金額：讀到的保持原值（不互相覆蓋），對不上的交給 validateDoc_ 警示
  var src = out.src;
  var total = amountAfter_(lines, ['總計', '合計', '總金額', '含稅', '應付', '實收', '金額合計', '總額', 'TOTAL', 'Total'], ['未稅', '銷售額', '稅額']);
  var tax = amountAfter_(lines, ['營業稅', '稅額', '稅金', 'TAX', 'Tax'], ['免稅', '零稅率', '含稅']);
  var net = amountAfter_(lines, ['銷售額', '未稅', '小計'], ['稅額']);
  if (!isNaN(tax) && !isNaN(total) && tax >= total) tax = NaN; // 稅額不可能大於總額：視為讀錯
  if (!isNaN(total)) src.total = '原文';
  if (!isNaN(tax)) src.tax = '原文';
  if (!isNaN(net)) src.net = '原文';
  if (isNaN(total) && !isNaN(net) && !isNaN(tax)) { total = net + tax; src.total = '推算'; }
  if (!isNaN(total) && !isNaN(tax) && isNaN(net)) { net = total - tax; src.net = '推算'; }
  if (!isNaN(total) && !isNaN(net) && isNaN(tax) && total >= net) { tax = total - net; src.tax = '推算'; }
  out.total = isNaN(total) ? 0 : total;
  out.tax = isNaN(tax) ? 0 : tax;
  out.net = isNaN(net) ? 0 : net;

  // 種類
  if (out.invoiceNo) out.kind = out.buyerTaxId ? '統一發票（有統編）' : '統一發票';
  else if (/收\s*據/.test(flat)) out.kind = '收據';
  // 只讀到總額：有統編的發票依 5% 拆稅額，其他視為含稅總額（標示「推算」，需人工確認）
  if (out.total && isNaN(net) && isNaN(tax)) {
    if (out.invoiceNo && out.buyerTaxId) { var sp = splitTax_(out.total); out.net = sp.net; out.tax = sp.tax; }
    else { out.net = out.total; out.tax = 0; }
    src.net = '推算'; src.tax = '推算';
  }
  return out;
}

/** 依關鍵字建議費用科目；食材依產業區分 */
var EXPENSE_RULES = [
  [/中華電信|台灣大哥大|遠傳|亞太電信|電信|寬頻|網路費|電話費/, '6161'],
  [/台灣電力|台電|電費|自來水|水費|瓦斯|天然氣|欣[^\s]{0,2}瓦斯/, '6191'],
  [/加油站|中油|台塑石化|全國加油|停車|計程車|高鐵|臺鐵|台鐵|客運|ETC|遠通/, '6142'],
  [/物流|宅配|快遞|黑貓|新竹貨運|嘉里|郵局|運費|貨運/, '6151'],
  [/房租|租金/, '6121'],
  [/保險|產險|人壽/, '6201'],
  [/廣告|Facebook|Meta|Google Ads|印刷|名片|傳單/, '6181'],
  [/POS|軟體|訂閱|雲端|月租費/, '6371'],
  [/修繕|維修|水電行|五金|冷氣|工程行/, '6171'],
  [/清潔|洗碗|消毒|除蟲|病媒|垃圾/, '6351'],
  [/餐盒|紙盒|紙杯|吸管|塑膠袋|包材|包裝|免洗/, '6341'],
  [/文具|影印|書局/, '6131'],
  [/記帳|會計師|律師|顧問/, '6321'],
  [/蔬菜|蔬果|青菜|果菜|水產|海鮮|魚|肉品|肉舖|雞|豬|牛|羊|蛋|米|麵|調味|醬|食品|農產|乳品|牛奶|飲料|茶葉|咖啡豆|冷凍食品|食材|生鮮|豆腐|蔥/, 'FOOD']
];

function suggestExpense_(text, industries, enabledCodes) {
  var ok = function (c) { return !!enabledCodes[c]; };
  var s = String(text || '');
  for (var i = 0; i < EXPENSE_RULES.length; i++) {
    if (!EXPENSE_RULES[i][0].test(s)) continue;
    var code = EXPENSE_RULES[i][1];
    if (code === 'FOOD') {
      var inds = industries || [];
      var cands = [];
      if (inds.indexOf('餐飲') >= 0) cands.push('5171');
      if (inds.indexOf('食品製造') >= 0) cands.push('5131');
      if (inds.indexOf('食品買賣') >= 0) cands.push('5121');
      cands = cands.concat(['5171', '5131', '5121']).filter(ok);
      if (cands.length) return cands[0];
      continue;
    }
    if (ok(code)) return code;
  }
  return ['6399', '6361'].filter(ok)[0] || '';
}

/** 付款方式可選的科目（只列已啟用的） */
var PAY_ACCOUNTS = [
  ['1111', '現金'], ['1112', '零用金'], ['1113', '銀行轉帳'], ['2131', '月結（應付帳款）'], ['2193', '股東代墊'], ['1142', '信用卡']
];

/**
 * 單據 → 建議分錄。只有「扣抵判定＝可扣抵」（人工判定）且 1191 進項稅額已啟用時，才拆成費用＋進項稅額；
 * 其他情況整張金額記入費用。
 * doc = { total, tax, sellerName, invoiceNo, deductible: '未判定'｜'可扣抵'｜'不可扣抵' }
 */
function docToLines_(doc, expenseCode, payCode, enabledCodes) {
  var total = Number(doc.total) || 0;
  var tax = Number(doc.tax) || 0;
  var party = str_(doc.sellerName);
  var lines = [];
  if (tax > 0 && tax < total && doc.deductible === '可扣抵' && enabledCodes['1191']) {
    lines.push({ code: expenseCode, debit: total - tax, credit: 0, party: party });
    lines.push({ code: '1191', debit: tax, credit: 0, party: party });
  } else {
    lines.push({ code: expenseCode, debit: total, credit: 0, party: party });
  }
  lines.push({ code: payCode, debit: 0, credit: total, party: party });
  return lines;
}

/** 單據摘要：賣方＋發票號碼 */
function docMemo_(doc) {
  return [str_(doc.sellerName) || str_(doc.kind) || '單據', str_(doc.invoiceNo)].filter(String).join(' ');
}

/** 解析規則版本：規則改了就加 1，舊單據可用「重新解析」套用新規則 */
var PARSER_VERSION = 2;

// ───────────── 單據驗證 ─────────────

var DOC_LEVELS = ['正常', '提示', '警示', '錯誤'];
var DEDUCT_STATES = ['未判定', '可扣抵', '不可扣抵'];
/** 依營業稅法第 19 條，進項稅額通常不得扣抵的科目（交際費、職工福利、伙食費）；正式使用前請記帳士確認 */
var NON_DEDUCTIBLE_CODES = ['6211', '6281', '6271'];
var DOC_FIELDS = ['kind', 'date', 'invoiceNo', 'sellerName', 'sellerTaxId', 'buyerTaxId', 'net', 'tax', 'total'];
var DOC_FIELD_NAMES = { kind: '種類', date: '日期', invoiceNo: '發票號碼', sellerName: '賣方名稱', sellerTaxId: '賣方統編', buyerTaxId: '買方統編', net: '未稅金額', tax: '稅額', total: '總金額' };

function isInvoiceKind_(kind) { return /發票/.test(str_(kind)); }

/** 疑似重複的比對鍵：沒有發票號碼時，用賣方＋日期＋總額 */
function suspectKey_(d) {
  var who = str_(d.sellerTaxId) || str_(d.sellerName);
  return who && d.date && d.total ? who + '|' + d.date + '|' + d.total : '';
}

/** 一次建立索引，避免每張單據都掃描全部單據 */
function buildDocIndex_(docs) {
  var byInv = {}, bySuspect = {};
  docs.forEach(function (d) {
    if (d.status === '略過') return;
    if (d.invoiceNo) (byInv[d.invoiceNo] = byInv[d.invoiceNo] || []).push(d);
    var k = suspectKey_(d);
    if (k && !d.invoiceNo) (bySuspect[k] = bySuspect[k] || []).push(d);
  });
  return { byInv: byInv, bySuspect: bySuspect };
}

/**
 * 檢查一張單據，回傳問題清單 [{code, level, field, msg}]。
 * level：錯誤＝不能入帳；警示＝入帳前要核對；提示＝參考
 * ctx = { ownTaxId, openingDate, lockedPeriods, today, index }
 */
function validateDoc_(d, ctx) {
  ctx = ctx || {};
  var out = [];
  var add = function (code, level, field, msg) { out.push({ code: code, level: level, field: field || '', msg: msg, key: code + '|' + (field || '') }); };
  var invoice = isInvoiceKind_(d.kind);
  var src = d.src || {};
  var open = d.status !== '已入帳' && d.status !== '略過';

  if (!d.date || !isValidDate_(d.date)) add('MISSING_DATE', '錯誤', 'date', '缺少日期');
  if (!(Number(d.total) > 0)) add('MISSING_TOTAL', '錯誤', 'total', '缺少總金額');
  if (invoice && !d.invoiceNo) add('MISSING_INVOICE_NO', '警示', 'invoiceNo', '發票缺少發票號碼');
  if (d.invoiceNo && !/^[A-Z]{2}\d{8}$/.test(d.invoiceNo)) add('INVOICE_NO_FORMAT', '警示', 'invoiceNo', '發票號碼格式應為 2 個英文字母＋8 碼數字');
  if (invoice && !d.sellerTaxId) add('MISSING_SELLER_TAXID', '警示', 'sellerTaxId', '發票缺少賣方統編');
  if (!d.sellerName && !d.sellerTaxId) add('MISSING_SELLER', '警示', 'sellerName', '缺少賣方（廠商）名稱');

  var net = Number(d.net) || 0, tax = Number(d.tax) || 0, total = Number(d.total) || 0;
  if (total > 0 && Math.abs(net + tax - total) > 1) add('AMOUNT_MISMATCH', '錯誤', 'total', '未稅 ' + net + ' ＋ 稅額 ' + tax + ' ≠ 總額 ' + total);
  else if (tax > 0 && net > 0 && Math.abs(tax - Math.round(net * 0.05)) > 1) add('TAX_RATE', '警示', 'tax', '稅額 ' + tax + ' 與未稅 × 5%（' + Math.round(net * 0.05) + '）不符');
  if (d.sellerTaxId && !isValidTaxId_(d.sellerTaxId)) add('TAXID_INVALID', '警示', 'sellerTaxId', '賣方統編檢查碼不正確');
  if (d.buyerTaxId && !isValidTaxId_(d.buyerTaxId)) add('TAXID_INVALID', '警示', 'buyerTaxId', '買方統編檢查碼不正確');
  if (d.buyerTaxId && ctx.ownTaxId && d.buyerTaxId !== ctx.ownTaxId) add('BUYER_NOT_OWN', '警示', 'buyerTaxId', '買方統編不是本公司（' + ctx.ownTaxId + '），進項稅額不得扣抵');

  if (d.date && isValidDate_(d.date) && open) {
    if (ctx.today && d.date > ctx.today) add('DATE_FUTURE', '錯誤', 'date', '日期在今天之後');
    if (ctx.openingDate && d.date < ctx.openingDate) add('DATE_BEFORE_OPENING', '錯誤', 'date', '日期早於開帳日 ' + ctx.openingDate);
    if (ctx.lockedPeriods && ctx.lockedPeriods[d.date.slice(0, 7)]) add('PERIOD_LOCKED', '錯誤', 'date', d.date.slice(0, 7) + ' 已鎖帳');
  }

  var idx = ctx.index || { byInv: {}, bySuspect: {} };
  if (d.invoiceNo) {
    var same = (idx.byInv[d.invoiceNo] || []).filter(function (x) { return x.id !== d.id; });
    var posted = same.filter(function (x) { return x.status === '已入帳'; })[0];
    if (posted) add('DUP_POSTED', '錯誤', 'invoiceNo', '發票 ' + d.invoiceNo + ' 已由 ' + posted.id + ' 入帳（傳票 ' + posted.voucherNo + '）');
    else if (same.length && open) add('DUP_PENDING', '警示', 'invoiceNo', '發票 ' + d.invoiceNo + ' 另有單據 ' + same.map(function (x) { return x.id; }).join('、'));
  } else {
    var k = suspectKey_(d);
    var sus = k ? (idx.bySuspect[k] || []).filter(function (x) { return x.id !== d.id; }) : [];
    if (sus.length && open) add('DUP_SUSPECT', '警示', 'total', '疑似重複：與 ' + sus.map(function (x) { return x.id; }).join('、') + ' 的廠商、日期、金額相同');
  }

  if (src._ocr === 'failed') add('OCR_FAILED', '警示', '', '文字辨識失敗，請對照原始單據手動輸入');
  else if (src._ocr === 'weak') add('OCR_WEAK', '警示', '', '辨識出的文字很少或讀不到金額、日期，請對照原始單據');
  var derived = DOC_FIELDS.filter(function (f) { return src[f] === '推算'; });
  if (derived.length) add('DERIVED', '提示', derived[0], derived.map(function (f) { return DOC_FIELD_NAMES[f]; }).join('、') + ' 是系統推算的，請核對');
  return out;
}

function docLevel_(issues) {
  var lv = 0;
  (issues || []).forEach(function (i) { var n = DOC_LEVELS.indexOf(i.level); if (n > lv) lv = n; });
  return DOC_LEVELS[lv];
}

/**
 * 進項稅額扣抵「建議」（不會自動套用）：全部條件都符合才建議可扣抵。
 * 不能只看買方統編：還要看公司稅別、單據種類、稅額、費用科目。
 */
function deductibleHint_(d, settings, expenseCode) {
  var reasons = [];
  var own = str_(settings.taxId);
  if (!own) reasons.push('公司設定沒有填統一編號，無法核對買方');
  else if (d.buyerTaxId !== own) reasons.push(d.buyerTaxId ? '買方統編不是本公司' : '單據上沒有本公司統編');
  if (settings.vatType !== '一般稅額') reasons.push('公司營業稅類型不是一般稅額');
  if (!isInvoiceKind_(d.kind)) reasons.push('不是統一發票（收據等不能扣抵）');
  if (!(Number(d.tax) > 0)) reasons.push('沒有稅額');
  if (expenseCode && NON_DEDUCTIBLE_CODES.indexOf(expenseCode) >= 0) reasons.push('科目 ' + expenseCode + ' 依法通常不得扣抵');
  if (reasons.length) return { suggest: '不可扣抵', reason: reasons.join('；') };
  return { suggest: '可扣抵', reason: '買方為本公司、一般稅額、統一發票、有稅額；請確認用途為營業使用' };
}

// ───────────── 財政部進項發票檔 ─────────────

/** 簡易 CSV 解析（支援引號、逗號、Tab、直線分隔） */
function splitCsvLine_(line, sep) {
  var out = [], cur = '', q = false;
  for (var i = 0; i < line.length; i++) {
    var c = line.charAt(i);
    if (q) {
      if (c === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

var INVOICE_COLUMNS = {
  invoiceNo: ['發票號碼', '發票字軌號碼', '字軌號碼'],
  date: ['發票日期', '開立日期', '日期'],
  sellerTaxId: ['賣方統一編號', '賣方統編', '銷售人統一編號', '賣方營業人統編', '商店統編'],
  sellerName: ['賣方名稱', '賣方營業人名稱', '銷售人名稱', '商店店名', '賣方'],
  buyerTaxId: ['買方統一編號', '買方統編', '買受人統一編號'],
  net: ['銷售額', '銷售額合計', '未稅金額', '應稅銷售額'],
  tax: ['營業稅額', '稅額', '營業稅'],
  total: ['總計', '總金額', '含稅金額', '發票金額', '總額'],
  status: ['發票狀態', '狀態']
};

/**
 * 解析財政部「電子發票整合服務平台」下載的進項發票檔。
 * 欄位以標題名稱對應（不固定欄位順序），也支援手機條碼載具的「M|…」格式。
 * 回傳 { rows: [...], skipped: [...說明] }
 */
function parseInvoiceCsv_(text) {
  var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
  var rows = [], skipped = [];

  // 載具格式：M|載具類別|載具名稱|發票日期|商店統編|商店店名|發票號碼|總金額|發票狀態
  if (lines.length && /^[MD]\|/.test(lines[0]) || lines.some(function (l) { return /^M\|/.test(l); })) {
    lines.filter(function (l) { return /^M\|/.test(l); }).forEach(function (l) {
      var c = l.split('|');
      var r = { invoiceNo: str_(c[6]).replace(/[-\s]/g, '').toUpperCase(), date: normalizeDate_(c[3]), sellerTaxId: str_(c[4]), sellerName: str_(c[5]), buyerTaxId: '', total: moneyOf_(c[7]), tax: 0, status: str_(c[8]) };
      if (/作廢|註銷/.test(r.status)) { skipped.push(r.invoiceNo + ' 已作廢'); return; }
      r.net = r.total;
      rows.push(r);
    });
    return { rows: rows, skipped: skipped };
  }

  // 找標題列：含「發票號碼」的那一列
  var sep = ',';
  var headIdx = -1, head = [];
  for (var i = 0; i < Math.min(lines.length, 15); i++) {
    var s = lines[i].indexOf('\t') >= 0 ? '\t' : lines[i].indexOf('|') >= 0 && lines[i].indexOf(',') < 0 ? '|' : ',';
    var cells = splitCsvLine_(lines[i], s);
    if (cells.some(function (c) { return INVOICE_COLUMNS.invoiceNo.indexOf(c.replace(/\s/g, '')) >= 0; })) { headIdx = i; head = cells.map(function (c) { return c.replace(/\s/g, ''); }); sep = s; break; }
  }
  if (headIdx < 0) {
    var first = (lines[0] || '').replace(/\s+/g, ' ').trim();
    var binary = /[\u0000-\u0008]/.test(first) || /^(\x89PNG|%PDF|PK|ÿØÿ)/.test(first);
    // 中文變亂碼：Excel 用錯編碼打開財政部檔再存檔，中文會變成一堆「?」或怪字，而且救不回來
    var garbled = !binary && ((first.match(/\?/g) || []).length >= 3 || (first.match(/\uFFFD/g) || []).length >= 2);
    if (garbled) throw new Error('這個檔案的中文已經變成亂碼，通常是先用 Excel 打開、再存檔造成的（Excel 會用錯的編碼讀財政部的檔案，存檔後就救不回來）。' +
      '請回財政部網站重新下載一次，下載後不要打開，直接按「匯入財政部進項發票檔」選它。');
    throw new Error(binary
      ? '這不是文字格式的 CSV 檔（看起來是照片、PDF 或 Excel）。照片和 PDF 請按「選擇照片或 PDF」；財政部發票請下載 CSV 格式。'
      : '看不懂這個檔案：找不到「發票號碼」欄位。檔案第一列是：「' + first.slice(0, 120) + (first.length > 120 ? '…' : '') + '」。請把這段文字或檔案傳給系統管理者確認格式。');
  }
  var col = {};
  Object.keys(INVOICE_COLUMNS).forEach(function (k) {
    var names = INVOICE_COLUMNS[k];
    for (var n = 0; n < names.length; n++) { var j = head.indexOf(names[n]); if (j >= 0) { col[k] = j; return; } }
  });
  if (col.date === undefined) throw new Error('檔案中找不到「發票日期」欄位');
  if (col.total === undefined && col.net === undefined) throw new Error('檔案中找不到金額欄位（總計或銷售額）');

  lines.slice(headIdx + 1).forEach(function (l, k) {
    var c = splitCsvLine_(l, sep);
    var get = function (key) { return col[key] === undefined ? '' : str_(c[col[key]]); };
    var no = get('invoiceNo').replace(/[-\s]/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{8}$/.test(no)) { if (no) skipped.push('第 ' + (headIdx + k + 2) + ' 列發票號碼「' + no + '」格式不對'); return; }
    var status = get('status');
    if (/作廢|註銷|折讓/.test(status)) { skipped.push(no + ' ' + status); return; }
    var date = normalizeDate_(get('date'));
    if (!date) { skipped.push(no + ' 日期看不懂（' + get('date') + '）'); return; }
    var net = moneyOf_(get('net')), tax = moneyOf_(get('tax')), total = moneyOf_(get('total'));
    if (isNaN(tax)) tax = 0;
    if (isNaN(total)) total = (isNaN(net) ? 0 : net) + tax;
    if (isNaN(net)) net = total - tax;
    if (!total) { skipped.push(no + ' 金額為 0'); return; }
    rows.push({ invoiceNo: no, date: date, sellerTaxId: get('sellerTaxId'), sellerName: get('sellerName'), buyerTaxId: get('buyerTaxId'), net: net, tax: tax, total: total, status: status });
  });
  return { rows: rows, skipped: skipped };
}
