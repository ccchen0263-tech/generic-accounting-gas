/**
 * 產生公版示範資料（公版餐飲、公版食品，2026-01 ～ 2026-10）
 * 用系統本身的後端邏輯建帳，保證借貸平衡；輸出各工作表要寫入的列。
 * 用法：node tools/seed-demo.js  → 輸出 tools/seed-demo.json
 */
const fs = require('fs');
const path = require('path');
const { loadApp } = require('../tests/load');

const app = loadApp({ now: '2026-10-29T10:00:00+08:00' });
app.__ss.name = '公版餐飲有限公司｜集團會計系統';
app.setup();
const pw = /臨時密碼：(\S+)/.exec(app.__logs.join('\n'))[1];
const token = app.login('admin', pw).data.token;
const at = (co, action, payload) => {
  const r = app.api(token, action, Object.assign({ _company: co }, payload || {}));
  if (!r.ok) throw new Error(action + '：' + r.error);
  return r.data;
};

// 固定亂數，每次產生的資料都一樣
let seed = 20261029;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const vary = (base, pct) => Math.round(base * (1 + (rnd() * 2 - 1) * pct) / 10) * 10;
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (m, d) => `2026-${pad(m)}-${pad(Math.min(d, new Date(Date.UTC(2026, m, 0)).getUTCDate()))}`;
const monthEnd = (m) => dayOf(m, 31);
const LAST_MONTH = 10;
const LAST_DAY = 28; // 十月只做到 28 日
const season = [0, 0.95, 1.12, 0.92, 0.96, 1.0, 0.98, 1.05, 1.08, 0.94, 1.02]; // 1～10 月旺淡季

function tplLines(co, id, amount) {
  const t = at(co, 'bootstrap').templates.find((x) => x.id === id);
  if (!t) throw new Error('找不到範本 ' + id);
  return { type: t.type, memo: t.memo, lines: app.applyTemplate_(t, amount) };
}
function V(co, date, type, memo, lines) {
  if (date > `2026-10-${LAST_DAY}`) return null;
  return at(co, 'saveVoucher', { date, type, memo, lines });
}
function T(co, date, id, amount, memo, party) {
  const t = tplLines(co, id, amount);
  if (party) t.lines.forEach((l) => { if (l.code === '2131' || l.code === '1141') l.party = party; });
  return V(co, date, t.type, memo || t.memo, t.lines);
}
function bal(co, code, asOf) {
  return at(co, 'ledger', { code, from: '2026-01-01', to: asOf }).closingBalance;
}
/** 營業稅：單月 15 日繳前兩個月（銷項 − 進項，進項較多時留抵不繳） */
function payVat(co, m) {
  const end = monthEnd(m - 1);
  const out = bal(co, '2161', end), inp = bal(co, '1191', end);
  if (!out && !inp) return;
  const date = dayOf(m, 15);
  if (out >= inp) V(co, date, '支出', `${m - 2}-${m - 1} 月營業稅繳納`, [{ code: '2161', debit: out }, { code: '1191', credit: inp }, { code: '1113', credit: out - inp }].filter((l) => l.debit || l.credit));
}

// ───────────── 公版餐飲（C01） ─────────────
const R = 'C01';
at(R, 'saveSettings', { companyName: '公版餐飲有限公司', taxId: '', industries: ['餐飲'], vatType: '一般稅額', fyStartMonth: 1, openingDate: '2026-01-01' });
at(R, 'addByIndustry', { industries: ['餐飲'] });
at(R, 'saveOpening', { rows: [
  { code: '1111', debit: 50000 }, { code: '1113', debit: 1200000 }, { code: '1166', debit: 42000 },
  { code: '1441', debit: 900000 }, { code: '1442', credit: 180000 }, { code: '1471', debit: 600000 }, { code: '1472', credit: 120000 },
  { code: '1811', debit: 360000 }, { code: '2131', credit: 85000 }, { code: '2193', credit: 300000 },
  { code: '3111', credit: 2000000 }, { code: '3351', credit: 467000 }
] });
const suppliersR = ['好鮮食材行', '旺來蔬果', '青田肉品', '公版食品有限公司'];
let apPrev = 85000;
for (let m = 1; m <= LAST_MONTH; m++) {
  const s = season[m];
  let ap = 0;
  // 營收：上半月、下半月各一次
  [14, 28].forEach((d) => {
    T(R, dayOf(m, d), 'r-cash', vary(205000 * s, 0.08), `${m}月${d === 14 ? '上' : '下'}半月現金營收`);
    T(R, dayOf(m, d), 'r-card', vary(255000 * s, 0.08), `${m}月${d === 14 ? '上' : '下'}半月刷卡營收`);
    T(R, dayOf(m, d), 'r-takeout', vary(63000 * s, 0.1), `${m}月${d === 14 ? '上' : '下'}半月外帶營收`);
  });
  const delivery = vary(157500 * s, 0.1);
  T(R, dayOf(m, 28), 'r-delivery', delivery, `${m}月外送平台營收`);
  // 外送與刷卡撥款（扣手續費）
  if (m > 1) {
    const prevDelivery = bal(R, '1143', monthEnd(m - 1));
    if (prevDelivery) { const fee = Math.round(prevDelivery * 0.3); V(R, dayOf(m, 10), '轉帳', `${m - 1}月外送平台撥款`, [{ code: '1113', debit: prevDelivery - fee }, { code: '6332', debit: fee }, { code: '1143', credit: prevDelivery }]); }
  }
  const card = bal(R, '1142', dayOf(m, 27));
  if (card) { const fee = Math.round(card * 0.02); V(R, dayOf(m, 27), '轉帳', `${m}月信用卡撥款`, [{ code: '1113', debit: card - fee }, { code: '6331', debit: fee }, { code: '1142', credit: card }]); }
  // 現金存銀行
  const cash = bal(R, '1111', dayOf(m, 28));
  if (cash > 80000) T(R, dayOf(m, 28), 'g-cash-deposit', Math.floor((cash - 60000) / 1000) * 1000, `${m}月現金存入銀行`);
  // 食材進貨（月結）三次
  [3, 12, 22].forEach((d, i) => {
    const amt = vary(136500 * s, 0.12);
    ap += amt;
    T(R, dayOf(m, d), 'r-food-credit', amt, `食材進貨－${suppliersR[i + (m % 2)]}`, suppliersR[i + (m % 2)]);
  });
  // 付上月貨款
  if (apPrev) T(R, dayOf(m, 8), 'g-pay-ap', apPrev, `支付${m === 1 ? '期初' : m - 1 + '月'}月結貨款`);
  apPrev = ap;
  // 固定費用
  T(R, dayOf(m, 5), 'g-rent', 126000, `${m}月店租`);
  T(R, dayOf(m, 18), 'g-util', vary(29400 * s, 0.1), `${m}月水電瓦斯`);
  T(R, dayOf(m, 20), 'r-pack', vary(8400, 0.2), `${m}月外帶包材`);
  T(R, dayOf(m, 20), 'r-clean', vary(5250, 0.2), `${m}月清潔衛生`);
  T(R, dayOf(m, 10), 'g-pos', 3150, `${m}月 POS 月租`);
  V(R, dayOf(m, 25), '支出', `${m}月薪資`, [{ code: '6111', debit: 280000 }, { code: '6112', debit: vary(62000 * s, 0.1) }, { code: '2191', credit: 18600 }, { code: '1113', credit: null }].map((l, i, arr) => {
    if (l.code === '1113') l.credit = arr[0].debit + arr[1].debit - 18600;
    return l;
  }));
  if (m > 1) V(R, dayOf(m, 28), '支出', `${m - 1}月勞健保`, [{ code: '6201', debit: 32400 }, { code: '2191', debit: 18600 }, { code: '1113', credit: 51000 }]);
  T(R, dayOf(m, 28), 'g-pension', 16800, `${m}月勞退提撥`);
  if (m % 3 === 0) T(R, dayOf(m, 16), 'g-staff-meal', vary(6000, 0.2), `${m}月員工聚餐`);
  if (m % 2 === 1) payVat(R, m);
  // 折舊
  V(R, monthEnd(m), '轉帳', `${m}月折舊`, [{ code: '6251', debit: 15000 }, { code: '1442', credit: 10000 }, { code: '1472', credit: 5000 }]);
  // 月底盤點
  if (monthEnd(m) <= `2026-10-${LAST_DAY}` || m < LAST_MONTH) at(R, 'stocktakeSave', { period: `2026-${pad(m)}`, counts: { '1166': vary(68000, 0.12) } });
}

// ───────────── 公版食品（C02） ─────────────
const F = at(R, 'createCompany', { name: '公版食品有限公司', industries: ['食品製造', '食品買賣'] }).id;
at(F, 'saveSettings', { companyName: '公版食品有限公司', taxId: '', industries: ['食品製造', '食品買賣'], vatType: '一般稅額', fyStartMonth: 1, openingDate: '2026-01-01' });
at(F, 'saveOpening', { rows: [
  { code: '1113', debit: 800000 }, { code: '1161', debit: 60000 }, { code: '1162', debit: 120000 }, { code: '1163', debit: 40000 }, { code: '1165', debit: 90000 },
  { code: '1431', debit: 1500000 }, { code: '1432', credit: 300000 }, { code: '1811', debit: 200000 },
  { code: '2131', credit: 150000 }, { code: '3111', credit: 2000000 }, { code: '3351', credit: 360000 }
] });
const customersF = ['公版餐飲有限公司', '晨光超市', '好食團膳'];
let apF = 150000, arPrev = 0;
for (let m = 1; m <= LAST_MONTH; m++) {
  const s = season[m];
  let ap = 0, ar = 0;
  [4, 18].forEach((d) => { const a = vary(160000 * s, 0.1); ap += a; T(F, dayOf(m, d), 'f-raw', a, '原料進貨－豐收農產', '豐收農產'); });
  { const a = vary(42000, 0.15); ap += a; T(F, dayOf(m, 6), 'f-pack', a, '包材進貨－和風包材', '和風包材'); }
  { const a = vary(178500 * s, 0.12); ap += a; T(F, dayOf(m, 9), 'f-goods', a, '選品進貨－山海選物', '山海選物'); }
  customersF.forEach((c, i) => { const a = vary([315000, 378000, 231000][i] * s, 0.1); ar += a; T(F, dayOf(m, 12 + i * 5), 'f-sale-own', a, `自製產品銷貨－${c}`, c); });
  { const a = vary(273000 * s, 0.1); ar += a; T(F, dayOf(m, 26), 'f-sale-goods', a, '選品銷貨－晨光超市', '晨光超市'); }
  T(F, dayOf(m, 27), 'f-ec-own', vary(157500 * s, 0.15), `${m}月電商銷售（自製）`);
  T(F, dayOf(m, 27), 'f-ec-goods', vary(84000 * s, 0.15), `${m}月電商銷售（選品）`);
  if (m > 1) {
    const ec = bal(F, '1144', monthEnd(m - 1));
    if (ec) { const fee = Math.round(ec * 0.06); V(F, dayOf(m, 7), '轉帳', `${m - 1}月電商平台撥款`, [{ code: '1113', debit: ec - fee }, { code: '6333', debit: fee }, { code: '1144', credit: ec }]); }
  }
  if (arPrev) T(F, dayOf(m, 15), 'g-collect', arPrev, `收回${m - 1}月貨款`);
  arPrev = ar;
  if (apF) T(F, dayOf(m, 10), 'g-pay-ap', apF, `支付${m === 1 ? '期初' : m - 1 + '月'}月結貨款`);
  apF = ap;
  V(F, dayOf(m, 25), '支出', `${m}月產線薪資`, [{ code: '5141', debit: 220000 }, { code: '2191', credit: 12400 }, { code: '1113', credit: 207600 }]);
  V(F, dayOf(m, 25), '支出', `${m}月行政薪資`, [{ code: '6111', debit: 96000 }, { code: '2191', credit: 5400 }, { code: '1113', credit: 90600 }]);
  if (m > 1) V(F, dayOf(m, 28), '支出', `${m - 1}月勞健保`, [{ code: '5151', debit: 21000 }, { code: '6201', debit: 9200 }, { code: '2191', debit: 17800 }, { code: '1113', credit: 48000 }]);
  T(F, dayOf(m, 28), 'g-pension', 18960, `${m}月勞退提撥`);
  T(F, dayOf(m, 5), 'f-factory-rent', 84000, `${m}月工廠租金`);
  T(F, dayOf(m, 19), 'f-factory-util', vary(47250 * s, 0.1), `${m}月工廠水電瓦斯`);
  T(F, dayOf(m, 21), 'f-ship', vary(15750 * s, 0.15), `${m}月出貨運費`);
  if (m % 3 === 1) T(F, dayOf(m, 23), 'f-test', 12600, `${m}月食品檢驗`);
  if (m % 2 === 1) payVat(F, m);
  V(F, monthEnd(m), '轉帳', `${m}月折舊`, [{ code: '5153', debit: 25000 }, { code: '1432', credit: 25000 }]);
  if (m < LAST_MONTH) at(F, 'stocktakeSave', { period: `2026-${pad(m)}`, counts: { '1161': vary(62000, 0.15), '1162': vary(125000, 0.15), '1163': vary(41000, 0.15), '1164': vary(35000, 0.2), '1165': vary(95000, 0.15) } });
}

// 鎖帳 1～9 月
for (let m = 1; m <= 9; m++) { at(R, 'lockPeriod', { period: `2026-${pad(m)}` }); at(F, 'lockPeriod', { period: `2026-${pad(m)}` }); }

// ───────────── 檢查與輸出 ─────────────
const out = {};
for (const [co, ssId] of [[R, 'fake-spreadsheet-id'], [F, 'fake-ss-1']]) {
  const tb = at(co, 'trialBalance', { from: '2026-01-01', to: '2026-10-31' });
  const bs = at(co, 'balanceSheet', { asOf: '2026-10-31' });
  const is = at(co, 'incomeStatement', { from: '2026-01-01', to: '2026-09-30' }).current.summary;
  if (!tb.balanced || bs.summary.difference) throw new Error(co + ' 不平衡');
  const ss = app.__registry[ssId];
  const rows = (name) => (ss.getSheetByName(name).data || []).slice(1).filter((r) => r.some((v) => v !== '' && v !== undefined));
  out[co] = {
    summary: { revenue: is.revenue, gross: is.grossProfit, net: is.netIncome, assets: bs.summary.assets },
    opening: rows('期初餘額'), vouchers: rows('傳票'), stocktake: rows('月底盤點'), periods: rows('期間')
  };
  console.log(co, '1～9月營收', is.revenue, '毛利', is.grossProfit, '淨利', is.netIncome, '｜傳票列數', out[co].vouchers.length, '盤點列', out[co].stocktake.length);
}
fs.writeFileSync(path.join(__dirname, 'seed-demo.json'), JSON.stringify(out));
