/**
 * 產生可在瀏覽器直接開啟的預覽頁：把後端程式與模擬試算表一起放進頁面，
 * google.script.run 改成直接呼叫後端函式，並預先建立示範帳務資料。
 * 用法：node tests/ui/build-preview.js  → 產生 tests/ui/preview.html
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const src = path.join(root, 'src');
const read = (f) => fs.readFileSync(path.join(src, f), 'utf8');

const serverJs = fs.readdirSync(src).filter((f) => f.endsWith('.js')).sort().map(read).join('\n;\n');
const fakes = fs.readFileSync(path.join(root, 'tests', 'gas-fakes.js'), 'utf8');

const seed = `
(function () {
  var env = createFakeGas({ now: '2026-02-10T10:00:00+08:00' });
  Object.keys(env).forEach(function (k) { window[k] = env[k]; });
})();
`;

const afterServer = `
(function () {
  setup();
  // 示範帳號（固定密碼，僅供預覽測試）
  setPassword_(findUser_('admin'), 'Admin1234');
  createUser_('acct', '王會計', '成員'); setPassword_(findUser_('acct'), 'Acct12345');
  createUser_('helper', '小幫手', '成員'); setPassword_(findUser_('helper'), 'Help12345');
  var s = { username: 'admin', name: '管理者', role: '管理者' };
  CTX.company = loadCompanies_()[0];
  HANDLERS.saveSettings({ companyName: '公版餐飲有限公司', taxId: '', industries: ['餐飲'], vatType: '一般稅額', fyStartMonth: 1, openingDate: '2026-01-01' }, s);
  HANDLERS.addByIndustry({ industries: ['餐飲'] }, s);
  HANDLERS.saveOpening({ rows: [
    { code: '1111', debit: 50000 }, { code: '1113', debit: 820000 }, { code: '1166', debit: 36000 },
    { code: '1441', debit: 680000 }, { code: '1442', credit: 120000 }, { code: '1811', debit: 150000 },
    { code: '2131', credit: 64000 }, { code: '2193', credit: 200000 }, { code: '3111', credit: 1000000 }, { code: '3351', credit: 352000 }
  ] }, s);
  var V = function (date, type, memo, lines) { return HANDLERS.saveVoucher({ date: date, type: type, memo: memo, lines: lines }, s); };
  V('2026-01-05', '支出', '一月店租', [{ code: '6121', debit: 85000 }, { code: '1113', credit: 85000 }]);
  V('2026-01-08', '支出', '食材進貨', [{ code: '5171', debit: 128000, party: '大成食品' }, { code: '1191', debit: 6400 }, { code: '2131', credit: 134400, party: '大成食品' }]);
  V('2026-01-15', '收入', '上半月營收', [{ code: '1111', debit: 96000 }, { code: '1142', debit: 120750 }, { code: '4121', credit: 160000 }, { code: '4122', credit: 46500 }, { code: '2161', credit: 10250 }]);
  V('2026-01-20', '收入', '外送平台撥款', [{ code: '1113', debit: 58200 }, { code: '6332', debit: 15800 }, { code: '4123', credit: 70476 }, { code: '2161', credit: 3524 }]);
  V('2026-01-25', '支出', '一月薪資', [{ code: '6111', debit: 168000 }, { code: '6112', debit: 42000 }, { code: '1113', credit: 210000 }]);
  V('2026-01-31', '收入', '下半月營收', [{ code: '1111', debit: 102000 }, { code: '1142', debit: 131250 }, { code: '4121', credit: 175000 }, { code: '4122', credit: 47619 }, { code: '2161', credit: 10631 }]);
  V('2026-01-31', '支出', '水電瓦斯', [{ code: '6191', debit: 23800 }, { code: '1191', debit: 1190 }, { code: '1113', credit: 24990 }]);
  HANDLERS.stocktakeSave({ period: '2026-01', counts: { '1166': 41500 } }, s);
  HANDLERS.lockPeriod({ period: '2026-01' }, s);
  V('2026-02-03', '支出', '二月店租', [{ code: '6121', debit: 85000 }, { code: '1113', credit: 85000 }]);
  V('2026-02-06', '支出', '食材進貨', [{ code: '5171', debit: 96500, party: '大成食品' }, { code: '1191', debit: 4825 }, { code: '1113', credit: 101325 }]);
  V('2026-02-09', '收入', '二月第一週營收', [{ code: '1111', debit: 61000 }, { code: '1142', debit: 75000 }, { code: '4121', credit: 104762 }, { code: '4122', credit: 24762 }, { code: '2161', credit: 6476 }]);
  var bad = V('2026-02-09', '支出', '重複輸入', [{ code: '6361', debit: 3200 }, { code: '1111', credit: 3200 }]);
  HANDLERS.voidVoucher({ no: bad.no, reason: '重複輸入' }, s);
  // 第二家公司：公版食品
  CTX.company = loadCompanies_()[0];
  var food = HANDLERS.createCompany({ name: '公版食品有限公司', industries: ['食品製造', '食品買賣'] }, s);
  CTX.company = loadCompanies_().filter(function (c) { return c.id === food.id; })[0];
  var fs = loadSettings_(); fs.openingDate = '2026-01-01'; saveSettings_(fs);
  HANDLERS.saveOpening({ rows: [{ code: '1113', debit: 600000 }, { code: '1162', debit: 80000 }, { code: '1431', debit: 420000 }, { code: '3111', credit: 1100000 }] }, s);
  V('2026-01-12', '轉帳', '原料進貨（月結）', applyTemplate_(templatesFor_(['食品製造'], loadAccounts_()).filter(function (t) { return t.id === 'f-raw'; })[0], 126000));
  V('2026-01-20', '轉帳', '自製產品銷貨', [{ code: '1141', debit: 294000, party: '公版餐飲' }, { code: '4111', credit: 280000 }, { code: '2161', credit: 14000 }]);
  V('2026-01-25', '轉帳', '電商銷售（選品）', [{ code: '1144', debit: 63000 }, { code: '4112', credit: 60000 }, { code: '2161', credit: 3000 }]);
  V('2026-01-28', '支出', '產線薪資', [{ code: '5141', debit: 96000 }, { code: '1113', credit: 96000 }]);
  CTX.company = null;
  appendObjects_(SHEETS.ACCESS, [
    { '帳號': 'acct', '公司代碼': 'C01', '角色': '會計' }, { '帳號': 'acct', '公司代碼': food.id, '角色': '會計' },
    { '帳號': 'helper', '公司代碼': 'C01', '角色': '助理' }
  ]);
})();
window.google = { script: { run: (function () {
  function runner(ok, fail) {
    var r = { withSuccessHandler: function (f) { return runner(f, fail); }, withFailureHandler: function (f) { return runner(ok, f); } };
    ['api', 'login', 'logout'].forEach(function (fn) {
      r[fn] = function () {
        var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
        setTimeout(function () {
          try { var out = window[fn].apply(null, args); ok && ok(JSON.parse(JSON.stringify(out === undefined ? null : out))); }
          catch (e) { fail && fail(e); }
        }, 30);
      };
    });
    return r;
  }
  return runner();
})() } };
`;

let html = read('Index.html');
html = html.replace("<?!= include('Css'); ?>", read('Css.html'));
html = html.replace("<?!= include('Js'); ?>",
  '<script>' + fakes + '</script>\n<script>' + seed + '</script>\n<script>' + serverJs + '</script>\n<script>' + afterServer + '</script>\n' + read('Js.html'));
if (html.includes('<?')) throw new Error('預覽頁仍有未處理的樣板標記');
const out = path.join(__dirname, 'preview.html');
fs.writeFileSync(out, html);
console.log('wrote', out);
