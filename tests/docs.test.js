/**
 * 單據匣測試：文字辨識整理、財政部進項發票匯入、單據入帳與作廢連動、權限
 * 執行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load');
const plain = (x) => JSON.parse(JSON.stringify(x));

const OWN = '53212539';     // 本公司統編（測試用）
const SELLER = '22099131';  // 賣方統編（測試用）

const HANDWRITTEN = [
  '統一發票（三聯式）',
  '大成生鮮食品有限公司',
  '統一編號 ' + SELLER,
  '中華民國 115 年 10 月 28 日',
  'AB-12345678',
  '買受人 鯉魚餐飲有限公司 統一編號 ' + OWN,
  '豬肉 20台斤  6,000',
  '銷售額合計 10,000',
  '營業稅 500',
  '總計 10,500'
].join('\n');

const RECEIPT = ['收 據', '阿明水電行', '日期：2026/10/30', '冷氣清洗 2 台', '合計 NT$ 3,200 元'].join('\n');

const CSV = [
  '營業人進項發票明細',
  '發票狀態,發票號碼,發票日期,賣方統一編號,賣方名稱,買方統一編號,銷售額合計,營業稅,總計',
  '已確認,CD11112222,115/10/05,' + SELLER + ',中華電信股份有限公司,' + OWN + ',"1,000",50,"1,050"',
  '已確認,CD11113333,1151012,04595257,台灣電力股份有限公司,' + OWN + ',2000,100,2100',
  '作廢,CD11114444,115/10/15,' + SELLER + ',大成生鮮食品有限公司,' + OWN + ',500,25,525',
  '已確認,EF55556666,2026-10-20,' + SELLER + ',大成生鮮食品有限公司,' + OWN + ',8000,400,8400'
].join('\r\n');

function books() {
  const app = loadApp({ now: '2026-11-03T10:00:00+08:00' });
  app.setup();
  const pw = /臨時密碼：(\S+)/.exec(app.__logs.join('\n'))[1];
  const token = app.login('admin', pw).data.token;
  const call = (action, payload, tk) => {
    const r = app.api(tk || token, action, payload);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };
  call('saveSettings', { companyName: '鯉魚餐飲有限公司', taxId: OWN, industries: ['餐飲'], vatType: '一般稅額', fyStartMonth: 1, openingDate: '2026-01-01' });
  call('addByIndustry', { industries: ['餐飲'] });
  return { app, call, token };
}

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

test('辨識文字整理：手開三聯式發票', () => {
  const app = loadApp();
  const r = plain(app.parseReceiptText_(HANDWRITTEN, { taxId: OWN, name: '鯉魚餐飲有限公司' }));
  assert.equal(r.invoiceNo, 'AB12345678');
  assert.equal(r.date, '2026-10-28');
  assert.equal(r.sellerTaxId, SELLER);
  assert.equal(r.buyerTaxId, OWN);
  assert.equal(r.sellerName, '大成生鮮食品有限公司');
  assert.deepEqual([r.net, r.tax, r.total], [10000, 500, 10500]);
  assert.equal(r.kind, '統一發票（有統編）');
});

test('辨識文字整理：收據沒有稅額、只讀到總額的三聯式自動拆 5%', () => {
  const app = loadApp();
  const r = plain(app.parseReceiptText_(RECEIPT, { taxId: OWN }));
  assert.equal(r.kind, '收據');
  assert.equal(r.date, '2026-10-30');
  assert.deepEqual([r.net, r.tax, r.total], [3200, 0, 3200]);
  const t = plain(app.parseReceiptText_('XY87654321\n買受人統編 ' + OWN + '\n總計 2,100', { taxId: OWN }));
  assert.deepEqual([t.net, t.tax, t.total], [2000, 100, 2100]);
  const empty = plain(app.parseReceiptText_('', {}));
  assert.equal(empty.total, 0);
  assert.equal(empty.date, '');
});

test('建議科目：依賣方名稱與產業', () => {
  const app = loadApp();
  const on = {}; ['5171', '5131', '6161', '6191', '6171', '6399'].forEach((c) => { on[c] = true; });
  assert.equal(app.suggestExpense_('大成生鮮食品有限公司', ['餐飲'], on), '5171');
  assert.equal(app.suggestExpense_('大成生鮮食品有限公司', ['食品製造'], on), '5131');
  assert.equal(app.suggestExpense_('中華電信股份有限公司', ['餐飲'], on), '6161');
  assert.equal(app.suggestExpense_('阿明水電行 冷氣清洗', ['餐飲'], on), '6171');
  assert.equal(app.suggestExpense_('台灣電力股份有限公司', ['餐飲'], on), '6191');
  assert.equal(app.suggestExpense_('不知名商店', ['餐飲'], on), '6399');
});

test('財政部進項發票檔：民國日期、引號金額、作廢略過', () => {
  const app = loadApp();
  const r = plain(app.parseInvoiceCsv_(CSV));
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows.map((x) => x.date), ['2026-10-05', '2026-10-12', '2026-10-20']);
  assert.deepEqual([r.rows[0].net, r.rows[0].tax, r.rows[0].total], [1000, 50, 1050]);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0], /CD11114444/);
  assert.throws(() => app.parseInvoiceCsv_('a,b,c\n1,2,3'), /發票號碼/);
  // 手機條碼載具格式
  const m = plain(app.parseInvoiceCsv_('M|手機條碼|/ABC1234|20261101|' + SELLER + '|全聯福利中心|GH12345678|356|開立'));
  assert.equal(m.rows[0].invoiceNo, 'GH12345678');
  assert.equal(m.rows[0].date, '2026-11-01');
  assert.equal(m.rows[0].total, 356);
});

test('上傳照片 → 辨識 → 入帳 → 作廢後單據回到待處理', () => {
  const { app, call } = books();
  app.__drive.ocrQueue.push(HANDWRITTEN);
  const up = call('uploadDoc', { name: '發票.jpg', mimeType: 'image/jpeg', data: b64('fake-jpeg') });
  assert.equal(up.status, '待處理');
  assert.equal(up.total, 10500);
  assert.equal(app.__drive.ocrCalls[0].opts.ocrLanguage, 'zh-TW');
  assert.equal(app.__drive.removed.length, 1, 'OCR 暫存文件要刪掉');

  const list = call('listDocs', {});
  assert.equal(list.docs.length, 1);
  const d = list.docs[0];
  assert.equal(d.suggest, '5171');
  assert.ok(d.deductible);
  assert.ok(list.payAccounts.some((x) => x.code === '1113'));

  // 照片讀得回來
  const f = call('docFile', { id: d.id });
  assert.match(f.image, /^data:image\/jpeg;base64,/);

  const lines = plain(app.docToLines_(d, d.suggest, '2131', { 1191: true }));
  assert.deepEqual(lines.map((l) => [l.code, l.debit, l.credit]), [['5171', 10000, 0], ['1191', 500, 0], ['2131', 0, 10500]]);
  const v = call('saveVoucher', { docId: d.id, date: d.date, type: '轉帳', memo: app.docMemo_(d), lines });
  const after = call('listDocs', { status: '已入帳' }).docs[0];
  assert.equal(after.voucherNo, v.no);
  const vs = call('listVouchers', { period: '2026-10' }).vouchers;
  assert.equal(vs[0].source, '單據');
  assert.equal(vs[0].docs[0].id, d.id);

  assert.throws(() => call('saveVoucher', { docId: d.id, date: d.date, type: '轉帳', lines }), /已經入帳/);
  call('voidVoucher', { no: v.no, reason: '科目選錯' });
  const back = call('listDocs', {}).docs[0];
  assert.equal(back.status, '待處理');
  assert.equal(back.voucherNo, '');
  assert.match(back.note, /已作廢/);
});

test('同一張發票上傳兩次標記為重複；略過與改回待處理', () => {
  const { app, call } = books();
  app.__drive.ocrQueue.push(HANDWRITTEN, HANDWRITTEN);
  call('uploadDoc', { name: 'a.jpg', mimeType: 'image/jpeg', data: b64('a') });
  const second = call('uploadDoc', { name: 'b.jpg', mimeType: 'image/jpeg', data: b64('b') });
  assert.equal(second.status, '重複');
  assert.match(second.note, /D202611-0001/);
  assert.equal(second.id, 'D202611-0002');
  assert.throws(() => call('skipDoc', { id: second.id }), /原因/);
  call('skipDoc', { id: second.id, reason: '重複拍照' });
  assert.equal(call('listDocs', { status: '略過' }).docs.length, 1);
  call('restoreDoc', { id: second.id });
  assert.equal(call('listDocs', {}).counts['待處理'], 2);
  assert.throws(() => call('uploadDoc', { name: 'x.exe', mimeType: 'application/x-msdownload', data: b64('x') }), /格式不支援/);
});

test('匯入財政部進項發票：重複匯入不會重複建立，照片與匯入互相比對', () => {
  const { app, call } = books();
  const r = call('importInvoices', { text: CSV, fileName: '進項.csv' });
  assert.equal(r.added, 3);
  assert.equal(r.skipped.length, 1);
  const again = call('importInvoices', { text: CSV, fileName: '進項.csv' });
  assert.equal(again.added, 0);
  assert.equal(again.duplicates.length, 3);
  const docs = call('listDocs', {}).docs;
  const tel = docs.find((x) => x.invoiceNo === 'CD11112222');
  assert.equal(tel.suggest, '6161');
  assert.ok(tel.deductible);
  assert.equal(tel.hasFile, false);
  // 匯入過的發票再拍照上傳 → 重複
  app.__drive.ocrQueue.push('EF-55556666\n總計 8,400');
  assert.equal(call('uploadDoc', { name: 'c.jpg', mimeType: 'image/jpeg', data: b64('c') }).status, '重複');
});

test('權限：助理可上傳不能入帳與匯入；畫面不能偽造傳票來源', () => {
  const { app, call } = books();
  app.createUser_('helper', '小幫手', '成員');
  app.setPassword_(app.findUser_('helper'), 'Help12345');
  app.appendObjects_('_公司權限', [{ '帳號': 'helper', '公司代碼': 'C01', '角色': '助理' }]);
  const ht = app.login('helper', 'Help12345').data.token;
  app.__drive.ocrQueue.push(RECEIPT);
  const up = call('uploadDoc', { name: 'r.jpg', mimeType: 'image/jpeg', data: b64('r') }, ht);
  assert.equal(up.status, '待處理');
  assert.throws(() => call('importInvoices', { text: CSV }, ht), /沒有權限/);
  assert.throws(() => call('skipDoc', { id: up.id, reason: 'x' }, ht), /沒有權限/);
  assert.throws(() => call('saveVoucher', { docId: up.id, date: '2026-10-30', type: '支出', lines: [] }, ht), /沒有權限/);

  const v = call('saveVoucher', { source: '月底盤點', date: '2026-10-30', type: '支出', memo: 'x', lines: [{ code: '6399', debit: 10 }, { code: '1111', credit: 10 }] });
  const saved = call('getVoucher', { no: v.no });
  assert.equal(saved.source, '手動');
});

test('沒有啟用 Drive API 時照樣存檔，提示手動輸入', () => {
  const { app, call } = books();
  app.Drive = undefined;
  const up = call('uploadDoc', { name: 'n.png', mimeType: 'image/png', data: b64('n') });
  assert.equal(up.status, '待處理');
  assert.match(up.note, /尚未啟用文字辨識/);
});
