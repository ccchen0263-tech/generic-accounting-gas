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
  var out = { kind: '其他', invoiceNo: '', date: '', sellerName: '', sellerTaxId: '', buyerTaxId: '', net: 0, tax: 0, total: 0 };

  // 發票號碼：兩個英文字母 + 8 碼數字
  var inv = /(^|[^A-Z])([A-Z]{2})\s*[-－]?\s*(\d{8})(?!\d)/.exec(flat.toUpperCase());
  if (inv) out.invoiceNo = inv[2] + inv[3];

  // 日期：先找年月日格式，再找連續數字
  var dm = /(\d{2,4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/g, d;
  while ((d = dm.exec(flat)) && !out.date) out.date = toIsoDate_(d[1], d[2], d[3]);

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
  if (nameLine) out.sellerName = nameLine.replace(/^(賣方|營業人|名稱|店名)[:：\s]*/, '').replace(/(統一編號|統編|賣方)[\s\S]*$/, '').trim().slice(0, 40);

  // 金額
  var total = amountAfter_(lines, ['總計', '合計', '總金額', '含稅', '應付', '實收', '金額合計', '總額', 'TOTAL', 'Total'], ['未稅', '銷售額', '稅額']);
  var tax = amountAfter_(lines, ['營業稅', '稅額', '稅金', 'TAX', 'Tax'], ['免稅', '零稅率', '含稅']);
  var net = amountAfter_(lines, ['銷售額', '未稅', '小計'], ['稅額']);
  if (isNaN(total) && !isNaN(net) && !isNaN(tax)) total = net + tax;
  if (!isNaN(total) && !isNaN(tax) && isNaN(net)) net = total - tax;
  if (!isNaN(total) && !isNaN(net) && isNaN(tax) && total > net) tax = total - net;
  if (!isNaN(tax) && !isNaN(total) && tax >= total) tax = NaN;
  out.total = isNaN(total) ? 0 : total;
  out.tax = isNaN(tax) ? 0 : tax;
  out.net = out.total ? out.total - out.tax : (isNaN(net) ? 0 : net);

  // 種類
  if (out.invoiceNo) out.kind = out.buyerTaxId ? '統一發票（有統編）' : '統一發票';
  else if (/收\s*據/.test(flat)) out.kind = '收據';
  // 有統編的三聯式只讀到總額：依 5% 拆出稅額
  if (out.invoiceNo && out.buyerTaxId && out.total && !out.tax) {
    var sp = splitTax_(out.total);
    out.net = sp.net; out.tax = sp.tax;
  }
  // 沒有統編的發票或收據，進項稅額不能扣抵：全部算在費用
  if (!out.buyerTaxId) { out.net = out.total || out.net; out.tax = 0; }
  if (!out.total) out.total = out.net + out.tax;
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
 * 單據 → 建議分錄。可扣抵（有統編的發票、財政部進項發票）且 1191 進項稅額已啟用時，拆成費用＋進項稅額。
 * doc = { total, tax, sellerName, invoiceNo, deductible }
 */
function docToLines_(doc, expenseCode, payCode, enabledCodes) {
  var total = Number(doc.total) || 0;
  var tax = Number(doc.tax) || 0;
  var party = str_(doc.sellerName);
  var lines = [];
  if (tax > 0 && tax < total && doc.deductible && enabledCodes['1191']) {
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
  if (headIdx < 0) throw new Error('看不懂這個檔案：找不到「發票號碼」欄位。請下載財政部的 CSV 檔，或把檔案傳給系統管理者確認格式。');
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
