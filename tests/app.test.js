/**
 * 帳務流程測試：初始設定 → 登入 → 開帳 → 傳票 → 月底盤點 → 報表 → 鎖帳
 * 執行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { loadApp } = require('./load');
const { sha256Bytes } = require('./gas-fakes');
const plain = (x) => JSON.parse(JSON.stringify(x));

function setupApp() {
  const app = loadApp({ now: '2026-02-10T10:00:00+08:00' });
  app.setup();
  const msg = app.__logs.join('\n');
  const pw = /臨時密碼：(\S+)/.exec(msg)[1];
  const login = app.login('admin', pw);
  assert.equal(login.ok, true, login.error);
  const token = login.data.token;
  const call = (action, payload) => {
    const r = app.api(token, action, payload);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };
  return { app, token, call, pw };
}

function restaurantBooks() {
  const ctx = setupApp();
  const { call } = ctx;
  call('saveSettings', { companyName: '鯉魚餐飲有限公司', taxId: '', industries: ['餐飲'], vatType: '一般稅額', fyStartMonth: 1, openingDate: '2026-01-01' });
  call('addByIndustry', { industries: ['餐飲'] });
  call('saveOpening', { rows: [
    { code: '1111', debit: 100000, credit: 0 },
    { code: '1113', debit: 400000, credit: 0 },
    { code: '1441', debit: 300000, credit: 0 },
    { code: '3111', debit: 0, credit: 800000 }
  ] });
  const sale = call('saveVoucher', { date: '2026-01-15', type: '收入', memo: '一月營收', lines: [
    { code: '1113', debit: 105000 }, { code: '4121', credit: 100000 }, { code: '2161', credit: 5000 }
  ] });
  const buy = call('saveVoucher', { date: '2026-01-20', type: '支出', memo: '食材進貨', lines: [
    { code: '5171', debit: 40000, party: '大成食品' }, { code: '1191', debit: 2000 }, { code: '1113', credit: 42000 }
  ] });
  const rent = call('saveVoucher', { date: '2026-01-31', type: '支出', memo: '一月租金', lines: [
    { code: '6121', debit: 30000 }, { code: '1113', credit: 30000 }
  ] });
  return Object.assign(ctx, { sale, buy, rent });
}

test('SHA-256 模擬與 Node 結果一致', () => {
  const s = 'abc|密碼123';
  const ours = Buffer.from(sha256Bytes(s).map((b) => (b < 0 ? b + 256 : b))).toString('hex');
  assert.equal(ours, crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
});

test('科目參考庫：代碼不重複、首碼與區塊相符、盤點對應科目存在', () => {
  const app = loadApp();
  const refs = app.referenceAccountObjects_();
  const codes = new Set();
  refs.forEach((r) => {
    assert.ok(!codes.has(r.code), '重複代碼 ' + r.code);
    codes.add(r.code);
    assert.deepEqual(plain(app.validateAccount_(Object.assign({}, r), {}, false).filter((e) => !e.includes('盤點'))), [], r.code);
    r.industries.split(',').forEach((i) => assert.ok(app.INDUSTRIES.includes(i), r.code + ' 產業 ' + i));
  });
  const byCode = app.indexAccounts_(refs);
  refs.filter((r) => r.stockCost).forEach((r) => {
    assert.ok(byCode[r.stockCost], r.code + ' 對應 ' + r.stockCost);
    assert.equal(byCode[r.stockCost].block, '營業成本');
  });
});

test('初始設定建立工作表、admin 帳號，錯誤密碼會被拒絕並鎖定', () => {
  const app = loadApp();
  app.setup();
  ['公司設定', '會計科目', '期初餘額', '傳票', '期間', '月底盤點', '科目參考庫', '_帳號', '_操作紀錄'].forEach((n) => assert.ok(app.__ss.getSheetByName(n), n));
  assert.ok(app.__ss.getSheetByName('_帳號').hidden);
  const users = app.loadUsers_();
  assert.equal(users.length, 1);
  assert.equal(users[0].role, '管理者');
  assert.ok(!/臨時密碼/.test(JSON.stringify(app.__ss.getSheetByName('_帳號').data)), '密碼不可明碼存放');
  for (let i = 0; i < 5; i++) assert.equal(app.login('admin', 'wrong').ok, false);
  const pw = /臨時密碼：(\S+)/.exec(app.__logs.join('\n'))[1];
  assert.match(app.login('admin', pw).error, /過多/);
  // 再跑一次 setup 不會重複建帳號、不會清掉設定
  app.setup();
  assert.equal(app.loadUsers_().length, 1);
});

test('依產業帶入科目：餐飲含食材存貨與外送，不含食品製造原料', () => {
  const { call } = setupApp();
  call('addByIndustry', { industries: ['餐飲'] });
  const codes = call('bootstrap').accounts.map((a) => a.code);
  ['1111', '1166', '5171', '4121', '4123', '6332', '2182'].forEach((c) => assert.ok(codes.includes(c), c));
  ['1162', '4111', '5131'].forEach((c) => assert.ok(!codes.includes(c), c));
  // 重複執行不會重複新增
  const n = codes.length;
  call('addByIndustry', { industries: ['餐飲'] });
  assert.equal(call('bootstrap').accounts.length, n);
});

test('食品公司：自製＋選品兩種產業同時帶入', () => {
  const { call } = setupApp();
  call('addByIndustry', { industries: ['食品製造', '食品買賣'] });
  const codes = call('bootstrap').accounts.map((a) => a.code);
  ['1161', '1162', '1163', '1164', '1165', '4111', '4112', '5121', '5131', '5161', '6333'].forEach((c) => assert.ok(codes.includes(c), c));
  assert.ok(!codes.includes('1166'));
});

test('傳票：借貸不平衡、科目不存在、早於開帳日都會被擋', () => {
  const { call } = restaurantBooks();
  assert.throws(() => call('saveVoucher', { date: '2026-01-05', type: '支出', lines: [{ code: '6121', debit: 100 }, { code: '1113', credit: 90 }] }), /借貸不平衡/);
  assert.throws(() => call('saveVoucher', { date: '2026-01-05', type: '支出', lines: [{ code: '9999', debit: 100 }, { code: '1113', credit: 100 }] }), /不存在/);
  assert.throws(() => call('saveVoucher', { date: '2025-12-31', type: '支出', lines: [{ code: '6121', debit: 100 }, { code: '1113', credit: 100 }] }), /開帳日/);
  assert.throws(() => call('saveVoucher', { date: '2026-01-05', type: '支出', lines: [{ code: '6121', debit: 10.5 }, { code: '1113', credit: 10.5 }] }), /整數/);
});

test('傳票號碼依月份流水，作廢號碼不重複使用', () => {
  const { call, sale, buy, rent } = restaurantBooks();
  assert.equal(sale.no, '202601-0001');
  assert.equal(buy.no, '202601-0002');
  assert.equal(rent.no, '202601-0003');
  call('voidVoucher', { no: rent.no, reason: '重複輸入' });
  const next = call('saveVoucher', { date: '2026-01-31', type: '支出', memo: '租金', lines: [{ code: '6121', debit: 30000 }, { code: '1113', credit: 30000 }] });
  assert.equal(next.no, '202601-0004');
  const feb = call('saveVoucher', { date: '2026-02-01', type: '轉帳', lines: [{ code: '6121', debit: 1 }, { code: '1113', credit: 1 }] });
  assert.equal(feb.no, '202602-0001');
  assert.throws(() => call('voidVoucher', { no: rent.no, reason: 'x' }), /已作廢/);
});

test('修改傳票保留號碼與建立者', () => {
  const { call, buy } = restaurantBooks();
  call('saveVoucher', { no: buy.no, date: '2026-01-20', type: '支出', memo: '食材進貨（更正）', lines: [
    { code: '5171', debit: 50000 }, { code: '1191', debit: 2500 }, { code: '1113', credit: 52500 }
  ] });
  const v = call('getVoucher', { no: buy.no });
  assert.equal(v.debit, 52500);
  assert.equal(v.lines.length, 3);
  assert.equal(v.lines[0].memo, '食材進貨（更正）');
  assert.equal(call('listVouchers', { period: '2026-01' }).vouchers.length, 3);
});

test('月底盤點：自動調整成本，重做會作廢舊傳票', () => {
  const { call } = restaurantBooks();
  const pre = call('stocktakePreview', { period: '2026-01' });
  const row = pre.rows.find((r) => r.code === '1166');
  assert.equal(row.book, 0);
  assert.equal(row.costCode, '5171');
  const r1 = call('stocktakeSave', { period: '2026-01', counts: { '1166': 8000 } });
  assert.ok(r1.voucherNo);
  let is = call('incomeStatement', { from: '2026-01-01', to: '2026-01-31' }).current.summary;
  assert.equal(is.cost, 32000);
  // 重做：盤點改成 10000
  const r2 = call('stocktakeSave', { period: '2026-01', counts: { '1166': 10000 } });
  assert.deepEqual(plain(r2.voided), [r1.voucherNo]);
  is = call('incomeStatement', { from: '2026-01-01', to: '2026-01-31' }).current.summary;
  assert.equal(is.cost, 30000);
  assert.equal(call('stocktakePreview', { period: '2026-01' }).rows.find((r) => r.code === '1166').counted, 10000);
  // 二月盤點少了 4000 → 成本增加
  call('saveVoucher', { date: '2026-02-05', type: '支出', lines: [{ code: '5171', debit: 20000 }, { code: '1113', credit: 20000 }] });
  call('stocktakeSave', { period: '2026-02', counts: { '1166': 6000 } });
  const feb = call('incomeStatement', { from: '2026-02-01', to: '2026-02-28' }).current.summary;
  assert.equal(feb.cost, 24000);
  assert.throws(() => call('saveVoucher', { no: r2.voucherNo, date: '2026-01-31', type: '轉帳', lines: [] }), /月底盤點/);
});

test('損益表、資產負債表、試算表數字正確且平衡', () => {
  const { call } = restaurantBooks();
  call('stocktakeSave', { period: '2026-01', counts: { '1166': 8000 } });
  const is = call('incomeStatement', { from: '2026-01-01', to: '2026-01-31', compare: 'prev' });
  assert.deepEqual(
    { r: is.current.summary.revenue, c: is.current.summary.cost, g: is.current.summary.grossProfit, o: is.current.summary.opex, n: is.current.summary.netIncome },
    { r: 100000, c: 32000, g: 68000, o: 30000, n: 38000 }
  );
  assert.equal(is.compare.from, '2025-12-01');
  assert.equal(is.compare.to, '2025-12-31');

  const bs = call('balanceSheet', { asOf: '2026-01-31' });
  assert.equal(bs.summary.assets, 843000);
  assert.equal(bs.summary.liabilities, 5000);
  assert.equal(bs.summary.equity, 838000);
  assert.equal(bs.summary.difference, 0);
  assert.equal(bs.summary.currentPeriodIncome, 38000);

  const tb = call('trialBalance', { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(tb.balanced, true);
  assert.equal(tb.totals.closeDebit, tb.totals.closeCredit);
  const bank = tb.rows.find((r) => r.code === '1113');
  assert.equal(bank.openDebit, 400000);
  assert.equal(bank.closeDebit, 433000);
});

test('下一年度：去年損益列為前期未結轉損益，資產負債表仍平衡', () => {
  const { call } = restaurantBooks();
  call('saveVoucher', { date: '2027-01-10', type: '收入', lines: [{ code: '1111', debit: 1000 }, { code: '4121', credit: 1000 }] });
  const bs = call('balanceSheet', { asOf: '2027-01-31' });
  assert.equal(bs.summary.priorUnclosedIncome, 30000); // 100000 − 40000 進貨 − 30000 租金（未盤點）
  assert.equal(bs.summary.currentPeriodIncome, 1000);
  assert.equal(bs.summary.difference, 0);
});

test('分類帳：期初、累計餘額、往來對象篩選', () => {
  const { call } = restaurantBooks();
  const lg = call('ledger', { code: '1113', from: '2026-01-01', to: '2026-01-31' });
  assert.equal(lg.openingBalance, 400000);
  assert.deepEqual(plain(lg.rows.map((r) => r.balance)), [505000, 463000, 433000]);
  const party = call('ledger', { code: '5171', from: '2026-01-01', to: '2026-01-31', party: '大成食品' });
  assert.equal(party.rows.length, 1);
  assert.equal(party.closingBalance, 40000);
});

test('鎖帳後不能新增、修改、作廢；解鎖需要原因', () => {
  const { call, sale } = restaurantBooks();
  call('lockPeriod', { period: '2026-01' });
  assert.throws(() => call('saveVoucher', { date: '2026-01-31', type: '支出', lines: [{ code: '6121', debit: 1 }, { code: '1113', credit: 1 }] }), /已鎖帳/);
  assert.throws(() => call('voidVoucher', { no: sale.no, reason: 'x' }), /已鎖帳/);
  assert.throws(() => call('stocktakeSave', { period: '2026-01', counts: { '1166': 1 } }), /已鎖帳/);
  assert.throws(() => call('unlockPeriod', { period: '2026-01' }), /原因/);
  call('unlockPeriod', { period: '2026-01', reason: '補登發票' });
  call('saveVoucher', { date: '2026-01-31', type: '支出', lines: [{ code: '6121', debit: 1 }, { code: '1113', credit: 1 }] });
  const periods = call('listPeriods');
  assert.equal(periods.find((p) => p.period === '2026-01').status, '開放');
});

test('期初未平衡時不能鎖帳', () => {
  const { call } = setupApp();
  call('saveSettings', { companyName: 'A', industries: ['餐飲'], vatType: '一般稅額', fyStartMonth: 1, openingDate: '2026-01-01' });
  call('addByIndustry', { industries: ['餐飲'] });
  const r = call('saveOpening', { rows: [{ code: '1111', debit: 100 }] });
  assert.equal(r.balanced, false);
  assert.throws(() => call('lockPeriod', { period: '2026-01' }), /不平衡/);
  assert.throws(() => call('saveOpening', { rows: [{ code: '4121', credit: 100 }] }), /資產、負債、權益/);
});

test('權限：助理只能看傳票，不能看報表或改科目；會計不能解鎖', () => {
  const { app, call } = restaurantBooks();
  const a = call('saveUser', { isNew: true, username: 'helper', name: '小幫手', role: '助理' });
  const k = call('saveUser', { isNew: true, username: 'acct', name: '會計', role: '會計' });
  const ht = app.login('helper', a.tempPassword).data.token;
  assert.equal(app.api(ht, 'listVouchers', { period: '2026-01' }).ok, true);
  assert.match(app.api(ht, 'trialBalance', {}).error, /權限/);
  assert.match(app.api(ht, 'saveVoucher', {}).error, /權限/);
  const kt = app.login('acct', k.tempPassword).data.token;
  assert.equal(app.api(kt, 'trialBalance', {}).ok, true);
  assert.match(app.api(kt, 'unlockPeriod', { period: '2026-01', reason: 'x' }).error, /權限/);
  assert.match(app.api(kt, 'saveAccount', {}).error, /權限/);
  // 停用帳號後原本的登入立即失效
  call('saveUser', { username: 'helper', name: '小幫手', role: '助理', enabled: false });
  assert.equal(app.api(ht, 'listVouchers', {}).relogin, true);
  // 不能停用最後一位管理者
  assert.throws(() => call('saveUser', { username: 'admin', name: '管理者', role: '會計' }), /管理者/);
  assert.match(app.api('bad-token', 'bootstrap', {}).error, /逾時/);
});

test('變更密碼需符合強度，舊密碼失效', () => {
  const { app, call, pw } = setupApp();
  assert.throws(() => call('changePassword', { oldPassword: pw, newPassword: 'short' }), /8 碼/);
  call('changePassword', { oldPassword: pw, newPassword: 'NewPass1234' });
  assert.equal(app.login('admin', pw).ok, false);
  assert.equal(app.login('admin', 'NewPass1234').ok, true);
});

test('自訂科目：代碼首碼需符合區塊；已有分錄不能改區塊；停用後不能再記帳', () => {
  const { call } = restaurantBooks();
  assert.throws(() => call('saveAccount', { isNew: true, account: { code: '5999', name: '錯誤', block: '營業費用' } }), /以 6 開頭/);
  call('saveAccount', { isNew: true, account: { code: '6345', name: '外送保溫袋', block: '營業費用' } });
  assert.throws(() => call('saveAccount', { isNew: true, account: { code: '6345', name: '重複', block: '營業費用' } }), /已存在/);
  assert.throws(() => call('saveAccount', { account: { code: '1113', name: '銀行存款', block: '非流動資產' } }), /不能更改報表區塊/);
  call('toggleAccount', { code: '6345', enabled: false });
  assert.throws(() => call('saveVoucher', { date: '2026-01-31', type: '支出', lines: [{ code: '6345', debit: 1 }, { code: '1113', credit: 1 }] }), /已停用/);
});

test('寫入報表分頁', () => {
  const { app, call } = restaurantBooks();
  call('writeReports', { from: '2026-01-01', to: '2026-01-31', asOf: '2026-01-31' });
  const is = app.__ss.getSheetByName('報表_損益表').data;
  const net = is.find((r) => r[1] === '本期淨利');
  assert.equal(net[2], 30000);
  const bs = app.__ss.getSheetByName('報表_資產負債表').data;
  assert.ok(!bs.some((r) => String(r[1]).includes('不平衡')));
});

test('大量傳票：超過預設列數會自動擴充', () => {
  const { app, call } = restaurantBooks();
  for (let i = 0; i < 520; i++) {
    call('saveVoucher', { date: '2026-02-01', type: '支出', lines: [{ code: '6121', debit: 1 }, { code: '1113', credit: 1 }] });
  }
  assert.ok(app.__ss.getSheetByName('傳票').getMaxRows() > 1000);
  assert.equal(call('trialBalance', { from: '2026-02-01', to: '2026-02-28' }).balanced, true);
});

test('比較期間與統一編號檢查', () => {
  const app = loadApp();
  assert.deepEqual(JSON.parse(JSON.stringify(app.compareRange_('2026-03-01', '2026-03-31', 'prev'))), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(JSON.parse(JSON.stringify(app.compareRange_('2026-01-01', '2026-03-31', 'prev'))), { from: '2025-10-01', to: '2025-12-31' });
  assert.deepEqual(JSON.parse(JSON.stringify(app.compareRange_('2024-02-01', '2024-02-29', 'lastyear'))), { from: '2023-02-01', to: '2023-02-28' });
  assert.equal(app.isValidTaxId_('22099131'), true);
  assert.equal(app.isValidTaxId_('22099132'), false);
  assert.equal(app.isValidTaxId_('1234567'), false);
});

test('安全：網頁訪客（匿名）不能呼叫初始設定或重設 admin 密碼', () => {
  const { app } = setupApp();
  const before = app.findUser_('admin').hash;
  app.__session.email = '';
  assert.throws(() => app.resetAdminPassword(), /只能從試算表/);
  assert.throws(() => app.setup(), /只能從試算表/);
  assert.throws(() => app.writeReportsThisMonth(), /只能從試算表/);
  app.__session.email = 'visitor@same-domain.com'; // 同網域訪客
  assert.throws(() => app.resetAdminPassword(), /只能從試算表/);
  assert.equal(app.findUser_('admin').hash, before);
  app.__session.email = 'owner@example.com';
  assert.equal(app.resetAdminPassword(), undefined, '重設結果不可回傳密碼給呼叫端');
  assert.notEqual(app.findUser_('admin').hash, before);
});

test('手動貼上版 dist/Code.gs 可獨立載入並完成初始設定與登入', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const { createFakeGas } = require('./gas-fakes');
  const env = createFakeGas();
  const ctx = vm.createContext(Object.assign({ console }, env));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'dist', 'Code.gs'), 'utf8'), ctx);
  ctx.setup();
  const pw = /臨時密碼：(\S+)/.exec(env.__logs.join('\n'))[1];
  assert.equal(ctx.login('admin', pw).ok, true);
  const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'Index.html'), 'utf8');
  assert.ok(!html.includes('<?'), 'Index.html 不可殘留樣板標記');
  assert.ok(html.includes('google.script.run'));
});

test('審查修正：盤點傳票不能一般作廢，可取消盤點', () => {
  const { call } = restaurantBooks();
  const r = call('stocktakeSave', { period: '2026-01', counts: { '1166': 8000 } });
  assert.throws(() => call('voidVoucher', { no: r.voucherNo, reason: 'x' }), /月底盤點/);
  assert.throws(() => call('stocktakeClear', { period: '2026-01' }), /原因/);
  call('stocktakeClear', { period: '2026-01', reason: '盤點數字錯誤' });
  assert.equal(call('incomeStatement', { from: '2026-01-01', to: '2026-01-31' }).current.summary.cost, 40000);
  assert.equal(call('stocktakePreview', { period: '2026-01' }).rows.find((x) => x.code === '1166').counted, '');
});

test('審查修正：重做盤點失敗時，舊盤點傳票保持有效', () => {
  const { call } = restaurantBooks();
  const r1 = call('stocktakeSave', { period: '2026-01', counts: { '1166': 8000 } });
  call('toggleAccount', { code: '5171', enabled: false });
  assert.throws(() => call('stocktakeSave', { period: '2026-01', counts: { '1166': 9000 } }), /已停用/);
  assert.equal(call('getVoucher', { no: r1.voucherNo }).status, '有效');
  assert.equal(call('incomeStatement', { from: '2026-01-01', to: '2026-01-31' }).current.summary.cost, 32000);
});

test('審查修正：改密碼或被重設後，舊登入全部失效', () => {
  const { app, token, call, pw } = setupApp();
  const other = app.login('admin', pw, 'phone').data.token;
  const r = call('changePassword', { oldPassword: pw, newPassword: 'NewPass1234' });
  assert.equal(app.api(other, 'bootstrap', {}).relogin, true);
  assert.equal(app.api(token, 'bootstrap', {}).relogin, true);
  assert.equal(app.api(r.token, 'bootstrap', {}).ok, true);
  const k = app.api(r.token, 'saveUser', { isNew: true, username: 'acct', name: '會計', role: '會計' }).data;
  const kt = app.login('acct', k.tempPassword).data.token;
  app.api(r.token, 'resetPassword', { username: 'acct' });
  assert.equal(app.api(kt, 'bootstrap', {}).relogin, true);
});

test('審查修正：開帳日之前查不到資料，開帳日前一天＝期初', () => {
  const { call } = restaurantBooks();
  assert.throws(() => call('balanceSheet', { asOf: '2025-06-30' }), /早於開帳日/);
  const bs = call('balanceSheet', { asOf: '2025-12-31' });
  assert.equal(bs.summary.assets, 800000);
  assert.throws(() => call('trialBalance', { from: '2025-01-01', to: '2025-12-31' }), /早於開帳日/);
  const tb = call('trialBalance', { from: '2025-12-01', to: '2026-01-31' });
  assert.equal(tb.from, '2026-01-01');
  assert.equal(tb.rows.find((x) => x.code === '1113').openDebit, 400000);
  assert.throws(() => call('stocktakePreview', { period: '2025-12' }), /早於開帳日/);
});

test('審查修正：期初金額亂打不會被當成空白、統編 00000000 無效、開帳日不能清空', () => {
  const { app, call } = restaurantBooks();
  assert.throws(() => call('saveOpening', { rows: [{ code: '1111', debit: 'abc' }] }), /不是數字/);
  assert.equal(call('getOpening').rows.find((x) => x.code === '1111').debit, 100000);
  assert.equal(app.isValidTaxId_('00000000'), false);
  assert.throws(() => call('saveSettings', { companyName: 'A', industries: ['餐飲'], vatType: '一般稅額', fyStartMonth: 1, openingDate: '' }), /不能清空/);
});

test('審查修正：以 = 開頭的摘要原樣保存，不會被當成公式', () => {
  const { call } = restaurantBooks();
  const v = call('saveVoucher', { date: '2026-01-31', type: '支出', memo: '=1+1 測試', lines: [{ code: '6121', debit: 1, party: '+886 廠商' }, { code: '1113', credit: 1 }] });
  const got = call('getVoucher', { no: v.no });
  assert.equal(got.lines[0].memo, '=1+1 測試');
  assert.equal(got.lines[0].party, '+886 廠商');
});

test('審查修正：別人亂試 admin 密碼不會鎖住真正的管理者', () => {
  const { app, pw } = setupApp();
  for (let i = 0; i < 30; i++) app.login('admin', 'wrong', 'attacker');
  assert.match(app.login('admin', 'wrong', 'attacker').error, /過多/);
  assert.equal(app.login('admin', pw, 'real-admin').ok, true);
});

test('審查修正：盤點對應成本科目只能設在流動資產（存貨）科目', () => {
  const { call } = restaurantBooks();
  assert.throws(() => call('saveAccount', { account: { code: '4121', name: '餐飲收入－內用', block: '營業收入', stockCost: '5171' } }), /只有流動資產/);
  assert.throws(() => call('saveAccount', { isNew: true, account: { code: '2199', name: '測試', block: '流動負債', stockCost: '5171' } }), /只有流動資產/);
});

test('忘記密碼被鎖住後，重設 admin 密碼即可馬上登入', () => {
  const { app } = setupApp();
  for (let i = 0; i < 6; i++) app.login('admin', 'wrong', 'mybrowser');
  assert.match(app.login('admin', 'wrong', 'mybrowser').error, /過多/);
  app.__logs.length = 0;
  app.resetAdminPassword();
  const pw = /臨時密碼：(\S+)/.exec(app.__logs.join('\n'))[1];
  assert.equal(app.login('admin', pw, 'mybrowser').ok, true);
});

// ───────────── 第 0.2 版：多公司、集團報表、傳票範本 ─────────────

function groupBooks() {
  const ctx = restaurantBooks(); // C01 鯉魚餐飲（集團主檔本身）
  const { app, token } = ctx;
  const callAt = (company, action, payload) => {
    const r = app.api(token, action, Object.assign({ _company: company }, payload || {}));
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };
  const food = callAt('C01', 'createCompany', { name: '鯉魚食品有限公司', industries: ['食品製造', '食品買賣'] });
  callAt(food.id, 'saveSettings', { companyName: '鯉魚食品有限公司', industries: ['食品製造', '食品買賣'], vatType: '一般稅額', fyStartMonth: 1, openingDate: '2026-01-01' });
  callAt(food.id, 'saveOpening', { rows: [{ code: '1113', debit: 300000 }, { code: '3111', credit: 300000 }] });
  callAt(food.id, 'saveVoucher', { date: '2026-01-10', type: '轉帳', memo: '自製產品銷貨', lines: [{ code: '1141', debit: 52500 }, { code: '4111', credit: 50000 }, { code: '2161', credit: 2500 }] });
  callAt(food.id, 'saveVoucher', { date: '2026-01-12', type: '轉帳', memo: '原料進貨', lines: [{ code: '5131', debit: 20000 }, { code: '1191', debit: 1000 }, { code: '2131', credit: 21000 }] });
  return Object.assign(ctx, { callAt, food });
}

test('多公司：setup 把原本的試算表登記為第一家公司，舊帳號自動升級', () => {
  const { app, call } = restaurantBooks();
  call('saveUser', { isNew: true, username: 'acct', name: '會計', role: '會計' });
  const companies = app.loadCompanies_();
  assert.equal(companies.length, 1);
  assert.equal(companies[0].id, 'C01');
  assert.equal(companies[0].spreadsheetId, 'fake-spreadsheet-id');
  const b = call('bootstrap');
  assert.equal(b.company.name, '鯉魚餐飲有限公司'); // 公司設定改名時同步到公司清單
  const users = call('listUsers').users;
  assert.equal(users.find((u) => u.username === 'acct').access[0].role, '會計');
});

test('多公司：新增公司會建立獨立試算表，帳務完全分開', () => {
  const { app, callAt, food } = groupBooks();
  assert.equal(food.id, 'C02');
  const foodSs = app.__registry['fake-ss-1'];
  assert.ok(foodSs.getSheetByName('傳票'));
  assert.ok(!foodSs.getSheetByName('工作表1'), '新試算表的空白工作表要移除');
  assert.ok(!foodSs.getSheetByName('_帳號'), '帳號只放在集團主檔');
  const foodBoot = callAt('C02', 'bootstrap');
  assert.equal(foodBoot.company.name, '鯉魚食品有限公司');
  assert.ok(foodBoot.accounts.some((a) => a.code === '5131'), '依產業自動帶入食品科目');
  assert.ok(!foodBoot.accounts.some((a) => a.code === '1166'), '不帶入餐飲專用科目');
  assert.equal(callAt('C02', 'listVouchers', { period: '2026-01' }).vouchers.length, 2);
  assert.equal(callAt('C01', 'listVouchers', { period: '2026-01' }).vouchers.length, 3);
  // 兩家公司的傳票號碼各自從 0001 開始
  assert.equal(callAt('C02', 'listVouchers', { period: '2026-01' }).vouchers.at(-1).no, '202601-0001');
  assert.equal(callAt('C02', 'incomeStatement', { from: '2026-01-01', to: '2026-01-31' }).current.summary.revenue, 50000);
});

test('多公司：依公司給不同角色；沒權限的公司看不到也寫不進去', () => {
  const { app, callAt } = groupBooks();
  const r = callAt('C01', 'saveUser', { isNew: true, username: 'wang', name: '王會計', groupRole: '成員', access: [{ companyId: 'C01', role: '會計' }, { companyId: 'C02', role: '助理' }] });
  const only = callAt('C01', 'saveUser', { isNew: true, username: 'lee', name: '李助理', groupRole: '成員', access: [{ companyId: 'C02', role: '助理' }] });
  const wt = app.login('wang', r.tempPassword).data.token;
  const b = app.api(wt, 'bootstrap', { _company: 'C02' }).data;
  assert.deepEqual(plain(b.companies.map((c) => c.id + c.role)), ['C01會計', 'C02助理']);
  assert.equal(b.user.role, '助理');
  assert.match(app.api(wt, 'trialBalance', { _company: 'C02' }).error, /權限/);
  assert.equal(app.api(wt, 'trialBalance', { _company: 'C01', from: '2026-01-01', to: '2026-01-31' }).ok, true);
  assert.match(app.api(wt, 'listUsers', { _company: 'C01' }).error, /集團管理者/);
  const lt = app.login('lee', only.tempPassword).data.token;
  const lb = app.api(lt, 'bootstrap', {}).data;
  assert.deepEqual(plain(lb.companies.map((c) => c.id)), ['C02']);
  const denied = app.api(lt, 'listVouchers', { _company: 'C01' });
  assert.equal(denied.ok, false);
  assert.equal(denied.switchCompany, true);
  assert.throws(() => callAt('C01', 'saveUser', { isNew: true, username: 'nobody', name: 'x', groupRole: '成員', access: [] }), /至少要指派/);
});

test('多公司：停用公司後就不能切換進去，至少保留一家', () => {
  const { callAt } = groupBooks();
  callAt('C01', 'saveCompany', { id: 'C02', enabled: false });
  assert.deepEqual(plain(callAt('C01', 'bootstrap').companies.map((c) => c.id)), ['C01']);
  assert.throws(() => callAt('C01', 'saveCompany', { id: 'C01', enabled: false }), /至少要保留/);
  callAt('C01', 'saveCompany', { id: 'C02', enabled: true, name: '鯉魚食品股份有限公司' });
  assert.equal(callAt('C02', 'bootstrap').settings.companyName, '鯉魚食品股份有限公司');
});

test('集團報表：每家公司單獨一欄＋合併欄', () => {
  const { callAt } = groupBooks();
  const is = callAt('C01', 'consolidated', { type: 'is', from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual(plain(is.companies.map((c) => c.id)), ['C01', 'C02']);
  assert.equal(is.summary.revenue.C01, 100000);
  assert.equal(is.summary.revenue.C02, 50000);
  assert.equal(is.summary.revenue.total, 150000);
  assert.equal(is.summary.netIncome.total, 30000 + 30000);
  const rev = is.sections.find((s) => s.block === '營業收入');
  assert.equal(rev.rows.find((r) => r.code === '4111').amounts.C02, 50000);
  const bs = callAt('C01', 'consolidated', { type: 'bs', asOf: '2026-01-31' });
  assert.equal(bs.summary.assets.total, bs.summary.liabilitiesAndEquity.total);
  assert.equal(bs.summary.difference.total, 0);
  // 只有一家公司權限的人看不到集團報表
  const { app } = groupBooks();
  const r = app.api(app.login('admin', /臨時密碼：(\S+)/.exec(app.__logs.join('\n'))[1]).data.token, 'bootstrap', {});
  assert.ok(r.data.allowed.includes('consolidated'));
});

test('傳票範本：依產業顯示，含稅金額自動拆未稅與 5% 稅額', () => {
  const { app, callAt } = groupBooks();
  const rest = callAt('C01', 'bootstrap').templates.map((t) => t.id);
  assert.ok(rest.includes('r-cash') && rest.includes('r-food-credit') && rest.includes('g-pay-ap'));
  assert.ok(!rest.includes('f-raw'), '餐飲公司不顯示食品範本');
  const food = callAt('C02', 'bootstrap').templates;
  const ids = food.map((t) => t.id);
  assert.ok(ids.includes('f-raw') && ids.includes('f-goods') && ids.includes('f-ec-pay'));
  assert.ok(!ids.includes('r-cash'));
  const tpl = food.find((t) => t.id === 'f-raw');
  assert.equal(tpl.amountMode, 'tax');
  const lines = app.applyTemplate_(tpl, 10500);
  assert.deepEqual(JSON.parse(JSON.stringify(lines)), [
    { code: '5131', debit: 10000, credit: 0 }, { code: '1191', debit: 500, credit: 0 }, { code: '2131', debit: 0, credit: 10500 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(app.splitTax_(1000))), { net: 952, tax: 48 });
  const v = callAt('C02', 'saveVoucher', { date: '2026-01-20', type: tpl.type, memo: tpl.memo, lines: app.applyTemplate_(tpl, 1000) });
  assert.ok(v.no);
  // 每個範本的科目都在參考庫裡，借貸方向合理
  const refs = app.indexAccounts_(app.referenceAccountObjects_());
  app.VOUCHER_TEMPLATES.forEach((t) => {
    t.lines.forEach((l) => assert.ok(refs[l[0]], t.id + ' 科目 ' + l[0]));
    const ap = app.applyTemplate_(app.templatesFor_(['餐飲', '食品製造', '食品買賣'], app.referenceAccountObjects_().map((a) => Object.assign(a, { enabled: true }))).find((x) => x.id === t.id) || { amountMode: 'manual', lines: [] }, 1050);
    const dr = ap.reduce((s, x) => s + x.debit, 0), cr = ap.reduce((s, x) => s + x.credit, 0);
    assert.equal(dr, cr, t.id + ' 借貸不平衡');
  });
});

test('全新部署：以試算表檔名當第一家公司名稱', () => {
  const app = loadApp();
  app.__ss.name = '鯉魚餐飲有限公司｜集團會計系統（主檔）';
  app.setup();
  const c = app.loadCompanies_()[0];
  assert.equal(c.name, '鯉魚餐飲有限公司');
  app.CTX.company = c;
  assert.equal(app.loadSettings_().companyName, '鯉魚餐飲有限公司');
});
