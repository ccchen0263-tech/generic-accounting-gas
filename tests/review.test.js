/**
 * 審查修正（第二輪）：修改傳票保留舊列、累計鎖帳、帳號層級登入鎖定、密碼雜湊升級、讀取暫存、上傳失敗清檔
 * 執行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load');
const plain = (x) => JSON.parse(JSON.stringify(x));

function books(now) {
  const app = loadApp({ now: now || '2026-04-10T10:00:00+08:00' });
  app.setup();
  const pw = /臨時密碼：(\S+)/.exec(app.__logs.join('\n'))[1];
  const login = app.login('admin', pw);
  assert.equal(login.ok, true, login.error);
  const token = login.data.token;
  const call = (action, payload) => {
    const r = app.api(token, action, payload || {});
    if (!r.ok) throw new Error(r.error);
    return plain(r.data);
  };
  call('saveSettings', { companyName: '公版餐飲有限公司', taxId: '', industries: ['餐飲'], vatType: '一般稅額', fyStartMonth: 1, openingDate: '2026-01-01' });
  call('addByIndustry', { industries: ['餐飲'] });
  call('saveOpening', { rows: [{ code: '1113', debit: 500000 }, { code: '3111', credit: 500000 }] });
  return { app, call, token, pw };
}

const voucherRows = (app) => {
  const sh = app.__ss.getSheetByName('傳票');
  const head = sh.data[0];
  return sh.data.slice(1).filter((r) => r && r[0]).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};

// ───────────── 1. 修改傳票：舊列保留、標記「已修改」 ─────────────

test('修改傳票：舊分錄不刪除，標記「已修改」保留原內容；帳簿與報表只算新版本', () => {
  const { app, call } = books();
  const v = call('saveVoucher', { date: '2026-02-10', type: '支出', memo: '文具', lines: [{ code: '6121', debit: 1000 }, { code: '1113', credit: 1000 }] });
  call('saveVoucher', { no: v.no, date: '2026-02-12', type: '支出', memo: '文具（更正）', lines: [{ code: '6121', debit: 1500 }, { code: '1191', debit: 75 }, { code: '1113', credit: 1575 }] });
  call('saveVoucher', { no: v.no, date: '2026-02-12', type: '支出', memo: '文具（再更正）', lines: [{ code: '6121', debit: 2000 }, { code: '1113', credit: 2000 }] });

  const rows = voucherRows(app).filter((r) => r['傳票號碼'] === v.no);
  assert.equal(rows.length, 2 + 3 + 2, '三個版本的分錄都還在試算表');
  const old = rows.filter((r) => r['狀態'] === '已修改');
  assert.equal(old.length, 5);
  assert.ok(old.some((r) => r['借方'] === 1000 && r['摘要'] === '文具'), '最早的原始內容可以找回');
  const current = rows.filter((r) => r['狀態'] === '有效');
  assert.equal(current.length, 2);
  // 被取代的列：修改時間＝新版本的修改時間（可對照出是被哪一版取代）
  assert.ok(old.slice(-3).every((r) => r['修改時間'] === current[0]['修改時間']));

  const got = call('getVoucher', { no: v.no });
  assert.equal(got.debit, 2000);
  assert.equal(got.lines.length, 2);
  assert.equal(call('listVouchers', { period: '2026-02' }).vouchers.length, 1);
  assert.equal(call('journal', { from: '2026-02-01', to: '2026-02-28' }).vouchers.length, 1);
  assert.equal(call('incomeStatement', { from: '2026-02-01', to: '2026-02-28' }).current.summary.opex, 2000);
  assert.equal(call('ledger', { code: '1113', from: '2026-02-01', to: '2026-02-28' }).closingBalance, 498000);
  assert.equal(call('trialBalance', { from: '2026-02-01', to: '2026-02-28' }).balanced, true);
  assert.equal(call('balanceSheet', { asOf: '2026-02-28' }).summary.difference, 0);
  assert.equal(call('dashboard').balanced, true);
  assert.equal(app.loadSupersededLines_(v.no).length, 5);
  // 操作紀錄記下修改前的日期與金額
  assert.ok(call('listLog', {}).some((l) => l.action === '修改傳票' && /修改前：2026-02-12 金額 1575/.test(l.detail)));

  // 作廢只作廢目前版本；舊列維持「已修改」
  call('voidVoucher', { no: v.no, reason: '測試' });
  const after = voucherRows(app).filter((r) => r['傳票號碼'] === v.no);
  assert.equal(after.filter((r) => r['狀態'] === '作廢').length, 2);
  assert.equal(after.filter((r) => r['狀態'] === '已修改').length, 5);
  assert.equal(call('getVoucher', { no: v.no }).status, '作廢');
  assert.equal(call('incomeStatement', { from: '2026-02-01', to: '2026-02-28' }).current.summary.opex, 0);
  // 號碼不重複使用
  assert.equal(call('saveVoucher', { date: '2026-02-20', type: '支出', lines: [{ code: '6121', debit: 1 }, { code: '1113', credit: 1 }] }).no, '202602-0002');
});

test('修改傳票：新版本寫入失敗時，舊分錄改回有效（不會整張消失）', () => {
  const { app, call } = books();
  const v = call('saveVoucher', { date: '2026-02-10', type: '支出', lines: [{ code: '6121', debit: 1000 }, { code: '1113', credit: 1000 }] });
  const real = app.appendObjects_;
  app.appendObjects_ = function (name, objs) {
    if (name === '傳票') throw new Error('模擬試算表寫入失敗');
    return real(name, objs);
  };
  assert.throws(() => call('saveVoucher', { no: v.no, date: '2026-02-11', type: '支出', lines: [{ code: '6121', debit: 9 }, { code: '1113', credit: 9 }] }), /模擬/);
  app.appendObjects_ = real;
  const got = call('getVoucher', { no: v.no });
  assert.equal(got.debit, 1000);
  assert.equal(got.status, '有效');
  assert.equal(voucherRows(app).filter((r) => r['狀態'] === '已修改').length, 0);
});

test('修改傳票不能把日期改到其他月份（號碼依月份編號）；同月份可以改日期', () => {
  const { call } = books();
  const v = call('saveVoucher', { date: '2026-02-10', type: '支出', lines: [{ code: '6121', debit: 1000 }, { code: '1113', credit: 1000 }] });
  assert.throws(() => call('saveVoucher', { no: v.no, date: '2026-03-01', type: '支出', lines: [{ code: '6121', debit: 1000 }, { code: '1113', credit: 1000 }] }), /其他月份.*作廢/s);
  call('saveVoucher', { no: v.no, date: '2026-02-28', type: '支出', lines: [{ code: '6121', debit: 1000 }, { code: '1113', credit: 1000 }] });
  assert.equal(call('getVoucher', { no: v.no }).date, '2026-02-28');
});

// ───────────── 2. 累計鎖帳 ─────────────

test('鎖帳是累計的：鎖了 3 月，2 月也不能補登、改期初、做盤點；3 月底餘額不會再變', () => {
  const { app, call } = books();
  const feb = call('saveVoucher', { date: '2026-02-05', type: '支出', lines: [{ code: '6121', debit: 1000 }, { code: '1113', credit: 1000 }] });
  call('lockPeriod', { period: '2026-03' });
  const before = call('balanceSheet', { asOf: '2026-03-31' }).summary;

  const line = [{ code: '6121', debit: 1 }, { code: '1113', credit: 1 }];
  assert.throws(() => call('saveVoucher', { date: '2026-02-10', type: '支出', lines: line }), /2026-02 已鎖帳/);
  assert.throws(() => call('saveVoucher', { date: '2026-01-10', type: '支出', lines: line }), /2026-01 已鎖帳/);
  assert.throws(() => call('saveVoucher', { no: feb.no, date: '2026-02-05', type: '支出', lines: line }), /已鎖帳/);
  assert.throws(() => call('voidVoucher', { no: feb.no, reason: 'x' }), /已鎖帳/);
  assert.throws(() => call('saveOpening', { rows: [{ code: '1113', debit: 1 }, { code: '3111', credit: 1 }] }), /已鎖帳/);
  assert.throws(() => call('stocktakeSave', { period: '2026-02', counts: { '1166': 1 } }), /已鎖帳/);
  assert.equal(call('getOpening').locked, true);
  assert.equal(call('stocktakePreview', { period: '2026-02' }).locked, true);
  assert.deepEqual(call('balanceSheet', { asOf: '2026-03-31' }).summary, before);
  // 4 月仍開放
  call('saveVoucher', { date: '2026-04-01', type: '支出', lines: line });

  const boot = call('bootstrap');
  assert.equal(boot.lockedPeriods['2026-02'], true, '前端也知道 2 月被鎖住');
  const periods = call('listPeriods');
  const p02 = periods.find((p) => p.period === '2026-02');
  assert.equal(p02.status, '已鎖定');
  assert.equal(p02.implied, true);
  assert.equal(p02.lockedThrough, '2026-03');
  assert.equal(periods.find((p) => p.period === '2026-03').implied, false);
  assert.equal(periods.find((p) => p.period === '2026-04').status, '開放');

  // 解鎖要從最後一個鎖帳月份開始
  assert.throws(() => call('unlockPeriod', { period: '2026-02', reason: '補登' }), /2026-03 還鎖著/);
  assert.throws(() => call('unlockPeriod', { period: '2026-05', reason: '補登' }), /沒有鎖帳/);
  call('lockPeriod', { period: '2026-01' });
  assert.throws(() => call('unlockPeriod', { period: '2026-01', reason: '補登' }), /2026-03 還鎖著/);
  call('unlockPeriod', { period: '2026-03', reason: '補登' });
  call('saveVoucher', { date: '2026-02-10', type: '支出', lines: line });
  assert.throws(() => call('saveVoucher', { date: '2026-01-10', type: '支出', lines: line }), /2026-01 已鎖帳/);
  assert.equal(app.isLocked_(app.expandLocks_({ '2026-03': true }, ''), '2025-12'), true, '沒有開帳日時，更早的月份也算鎖定');
});

test('單據入帳也受累計鎖帳限制', () => {
  const { app, call } = books();
  call('lockPeriod', { period: '2026-03' });
  app.__drive.ocrQueue.push('收 據\n範例水電行\n日期：2026/02/08\n冷氣清洗\n合計 NT$ 3,200 元');
  const up = call('uploadDoc', { name: 'a.jpg', mimeType: 'image/jpeg', data: Buffer.from('a').toString('base64') });
  const d = call('getDoc', { id: up.id });
  assert.ok(d.issues.some((i) => i.code === 'PERIOD_LOCKED'), JSON.stringify(d.issues));
});

test('已有鎖帳月份時，會計年度起始月與開帳日不能修改', () => {
  const { call } = books();
  call('lockPeriod', { period: '2026-01' });
  const base = { companyName: '公版餐飲有限公司', industries: ['餐飲'], vatType: '一般稅額', fyStartMonth: 1, openingDate: '2026-01-01' };
  assert.throws(() => call('saveSettings', Object.assign({}, base, { fyStartMonth: 7 })), /會計年度起始月/);
  assert.throws(() => call('saveSettings', Object.assign({}, base, { openingDate: '2025-12-01' })), /開帳日/);
  call('saveSettings', Object.assign({}, base, { companyName: '新名字' }));
  call('unlockPeriod', { period: '2026-01', reason: '調整年度' });
  call('saveSettings', Object.assign({}, base, { fyStartMonth: 7 }));
  assert.equal(call('getSettings').fyStartMonth, 7);
});

// ───────────── 3. 登入防護與密碼雜湊 ─────────────

test('同一帳號換不同瀏覽器代號連錯 10 次 → 帳號暫停登入；管理者重設密碼立即解除', () => {
  const { app, call } = books();
  const k = call('saveUser', { isNew: true, username: 'acct', name: '會計', role: '會計' });
  // 錯誤次數要在鎖內累加
  const realCache = app.CacheService.getScriptCache;
  const puts = [];
  app.CacheService.getScriptCache = function () {
    const c = realCache();
    return Object.assign({}, c, { put: (key, v, t) => { if (/^u?fail_/.test(key)) puts.push(app.__lock.held > 0); return c.put(key, v, t); } });
  };
  for (let i = 0; i < 12; i++) assert.equal(app.login('acct', 'wrong' + i, 'browser' + i).ok, false);
  app.CacheService.getScriptCache = realCache;
  assert.ok(puts.length >= 20 && puts.every(Boolean), '錯誤次數一律在鎖內寫入');
  const r = app.login('acct', k.tempPassword, 'fresh-browser');
  assert.equal(r.ok, false);
  assert.match(r.error, /暫停登入/);
  // 管理者重設密碼 → 解除
  const reset = call('resetPassword', { username: 'acct' });
  assert.equal(app.login('acct', reset.tempPassword, 'fresh-browser').ok, true);
});

test('admin 被鎖住時，從試算表選單「重設 admin 密碼」即可解除', () => {
  const { app } = books();
  for (let i = 0; i < 10; i++) app.login('admin', 'wrong', 'b' + i);
  app.__logs.length = 0;
  app.resetAdminPassword();
  const pw = /臨時密碼：(\S+)/.exec(app.__logs.join('\n'))[1];
  assert.equal(app.login('admin', pw, 'b99').ok, true);
});

test('新密碼用反覆雜湊（v2$次數$…）；舊版雜湊照樣能登入，登入成功後自動升級', () => {
  const { app, call } = books();
  const admin = app.findUser_('admin');
  assert.match(admin.hash, new RegExp('^v2\\$' + app.PW_ITERATIONS + '\\$[0-9a-f]{64}$'));

  // 模擬舊版客戶的帳號：單次 SHA-256(鹽|密碼)
  const k = call('saveUser', { isNew: true, username: 'legacy', name: '舊帳號', role: '會計' });
  const u = app.findUser_('legacy');
  app.updateCells_('_帳號', u._row, { '鹽': 'oldsalt123456789', '密碼雜湊': app.hashPassword_('oldsalt123456789', 'OldPass123') });
  assert.equal(app.findUser_('legacy').hash.length, 64);
  assert.equal(app.login('legacy', 'wrong', 'x').ok, false);
  const r = app.login('legacy', 'OldPass123', 'x');
  assert.equal(r.ok, true, r.error);
  const up = app.findUser_('legacy');
  assert.match(up.hash, /^v2\$/);
  assert.notEqual(up.salt, 'oldsalt123456789');
  assert.equal(app.api(r.data.token, 'bootstrap', {}).ok, true, '升級後取得的登入憑證可以用');
  assert.equal(app.login('legacy', 'OldPass123', 'y').ok, true, '升級後同一個密碼照樣能登入');
  assert.ok(k.tempPassword);

  // 舊版雜湊也能變更密碼（直接呼叫處理函式；經過網頁時登入當下就已升級）
  app.updateCells_('_帳號', up._row, { '鹽': 's2', '密碼雜湊': app.hashPassword_('s2', 'OldPass123') });
  assert.throws(() => app.HANDLERS.changePassword({ oldPassword: 'wrong', newPassword: 'NewPass1234' }, { username: 'legacy' }), /不正確/);
  app.HANDLERS.changePassword({ oldPassword: 'OldPass123', newPassword: 'NewPass1234' }, { username: 'legacy' });
  assert.equal(app.login('legacy', 'NewPass1234', 'z3').ok, true);

  // 次數不同的 v2 雜湊也能驗證，並改用目前的次數
  const u3 = app.findUser_('legacy');
  app.updateCells_('_帳號', u3._row, { '鹽': 's4', '密碼雜湊': app.hashPasswordV2_('s4', 'NewPass1234', 10) });
  assert.equal(app.login('legacy', 'NewPass1234', 'z4').ok, true);
  assert.match(app.findUser_('legacy').hash, new RegExp('^v2\\$' + app.PW_ITERATIONS + '\\$'));
  // 亂改的雜湊格式不會被當成正確
  assert.equal(app.verifyPassword_({ salt: 'a', hash: 'v2$0$' + 'a'.repeat(64) }, 'x').ok, false);
  assert.equal(app.verifyPassword_({ salt: 'a', hash: '' }, '').ok, false);
});

// ───────────── 5. 讀取暫存 ─────────────

test('讀取暫存：帳號／公司／權限跨呼叫共用；每次呼叫同一張表只讀一次；寫入立即生效', () => {
  const { app, call, token } = books();
  const hub = app.__ss;
  const reads = (n) => hub.getSheetByName(n).reads || 0;
  call('bootstrap');
  const r0 = { u: reads('_帳號'), c: reads('公司清單'), a: reads('_公司權限'), s: reads('公司設定'), p: reads('期間') };
  call('bootstrap');
  assert.equal(reads('_帳號'), r0.u, '帳號表從共用暫存讀');
  assert.equal(reads('公司清單'), r0.c);
  assert.equal(reads('_公司權限'), r0.a);
  assert.equal(reads('公司設定') - r0.s, 1, '公司設定一次呼叫只讀一次');
  assert.equal(reads('期間') - r0.p, 1);

  // 寫入後立即生效：停用帳號，舊登入馬上失效
  const k = call('saveUser', { isNew: true, username: 'acct', name: '會計', role: '會計' });
  const kt = app.login('acct', k.tempPassword).data.token;
  assert.equal(app.api(kt, 'bootstrap', {}).ok, true);
  call('saveUser', { username: 'acct', name: '會計', role: '會計', enabled: false });
  assert.equal(app.api(kt, 'bootstrap', {}).relogin, true);
  assert.equal(app.api(token, 'bootstrap', {}).ok, true);
});

test('讀取暫存：鎖內一律重新讀取，不用鎖外讀到的舊資料', () => {
  const { app } = books();
  app.beginRequestMemo_();
  try {
    const before = app.readTable_('公司清單').rows.length;
    const sh = app.__ss.getSheetByName('公司清單');
    sh.data.push(['C99', '直接加在試算表', 'x', '是', '']); // 模擬別人同時寫入
    assert.equal(app.readTable_('公司清單').rows.length, before, '同一次呼叫內用暫存');
    const inLock = app.withLock_(() => app.readTable_('公司清單').rows.length);
    assert.equal(inLock, before + 1, '鎖內讀到最新資料');
  } finally { app.endRequestMemo_(); }
});

test('集團報表與批次入帳：每家公司的設定只讀一次', () => {
  const { app, call, token } = books();
  const c2 = call('createCompany', { name: '公版食品有限公司', industries: ['食品製造'] });
  const ss2 = app.__registry[Object.keys(app.__registry).find((k) => k !== 'fake-spreadsheet-id')];
  const r1 = app.__ss.getSheetByName('公司設定').reads || 0;
  const r2 = ss2.getSheetByName('公司設定').reads || 0;
  const r = app.api(token, 'consolidated', { type: 'bs', asOf: '2026-03-31' });
  assert.equal(r.ok, true, r.error);
  assert.equal((app.__ss.getSheetByName('公司設定').reads || 0) - r1, 1);
  assert.equal((ss2.getSheetByName('公司設定').reads || 0) - r2, 1);
  assert.ok(c2.id);
});

// ───────────── 6. 批次更新 ─────────────

test('作廢多行傳票：相鄰列合併寫入，不是一格一格寫', () => {
  const { app, call } = books();
  const v = call('saveVoucher', { date: '2026-02-10', type: '支出', lines: [{ code: '6121', debit: 1000 }, { code: '1191', debit: 50 }, { code: '6131', debit: 10 }, { code: '1113', credit: 1060 }] });
  const sh = app.__ss.getSheetByName('傳票');
  const w0 = sh.writes || 0;
  call('voidVoucher', { no: v.no, reason: '測試' });
  // 狀態（第 12 欄）、修改者＋修改時間（第 15～16 欄）兩段，4 行一次寫完
  assert.equal((sh.writes || 0) - w0, 2);
  assert.equal(voucherRows(app).filter((r) => r['狀態'] === '作廢').length, 4);
  assert.ok(voucherRows(app).every((r) => r['建立者'] === 'admin'), '沒寫到的欄位保持原值');
});

// ───────────── 7. 上傳失敗清檔 ─────────────

test('上傳單據：等不到鎖時，剛存到雲端硬碟的檔案會丟到垃圾桶', () => {
  const { app, call } = books();
  app.__lock.fail = true;
  assert.throws(() => call('uploadDoc', { name: 'a.jpg', mimeType: 'image/jpeg', data: Buffer.from('a').toString('base64') }), /Lock timeout/);
  app.__lock.fail = false;
  assert.equal(app.__drive.trashed.length, 1);
  const ok = call('uploadDoc', { name: 'b.jpg', mimeType: 'image/jpeg', data: Buffer.from('b').toString('base64') });
  assert.ok(ok.id);
  assert.equal(app.__drive.trashed.length, 1, '成功的上傳不會被刪');
});
