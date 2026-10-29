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
