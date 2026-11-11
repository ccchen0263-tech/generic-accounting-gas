/**
 * 單據匣測試（v0.4）：辨識整理、欄位來源、驗證、扣抵判定、防重複入帳、人工校正、批次入帳、權限、多公司隔離
 * 執行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load');
const plain = (x) => JSON.parse(JSON.stringify(x));

const OWN = '53212539';     // 本公司統編（測試用）
const SELLER = '22099131';  // 賣方統編（測試用）
const OTHER = '04595257';   // 其他公司統編（測試用）

const HANDWRITTEN = [
  '統一發票（三聯式）',
  '大成生鮮食品有限公司',
  '統一編號 ' + SELLER,
  '中華民國 115 年 10 月 28 日',
  'AB-12345678',
  '買受人 公版餐飲有限公司 統一編號 ' + OWN,
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
  '已確認,CD11113333,1151012,' + OTHER + ',台灣電力股份有限公司,' + OWN + ',2000,100,2100',
  '作廢,CD11114444,115/10/15,' + SELLER + ',大成生鮮食品有限公司,' + OWN + ',500,25,525',
  '已確認,EF55556666,2026-10-20,' + SELLER + ',大成生鮮食品有限公司,' + OWN + ',8000,400,8400'
].join('\r\n');

function books() {
  const app = loadApp({ now: '2026-11-03T10:00:00+08:00' });
  app.setup();
  const pw = /臨時密碼：(\S+)/.exec(app.__logs.join('\n'))[1];
  const token = app.login('admin', pw).data.token;
  const call = (action, payload, tk) => {
    const r = app.api(tk || token, action, Object.assign({}, payload));
    if (!r.ok) throw new Error(r.error);
    return plain(r.data);
  };
  call('saveSettings', { companyName: '公版餐飲有限公司', taxId: OWN, industries: ['餐飲'], vatType: '一般稅額', fyStartMonth: 1, openingDate: '2026-01-01' });
  call('addByIndustry', { industries: ['餐飲'] });
  const upload = (text, name) => {
    app.__drive.ocrQueue.push(text);
    return call('uploadDoc', { name: name || 'a.jpg', mimeType: 'image/jpeg', data: b64(name || 'a') });
  };
  return { app, call, token, upload };
}

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }
const codes = (doc) => doc.issues.map((i) => i.code);
const warnKeys = (doc) => doc.issues.filter((i) => i.level === '警示').map((i) => i.key);
/** 依畫面核對當下的單據組入帳項目：帶版本號與核對過的警示 */
const itemOf = (call, id, extra) => { const d = call('getDoc', { id }); return Object.assign({ id, rev: d.rev, ackWarnings: warnKeys(d) }, extra); };

// ───────────── 純計算 ─────────────

test('辨識整理：手開三聯式發票，欄位來源標示原文', () => {
  const app = loadApp();
  const r = plain(app.parseReceiptText_(HANDWRITTEN, { taxId: OWN, name: '公版餐飲有限公司' }));
  assert.equal(r.invoiceNo, 'AB12345678');
  assert.equal(r.date, '2026-10-28');
  assert.equal(r.sellerTaxId, SELLER);
  assert.equal(r.buyerTaxId, OWN);
  assert.equal(r.sellerName, '大成生鮮食品有限公司');
  assert.deepEqual([r.net, r.tax, r.total], [10000, 500, 10500]);
  assert.deepEqual([r.src.net, r.src.tax, r.src.total, r.src.invoiceNo], ['原文', '原文', '原文', '原文']);
  assert.equal(r.deductible, undefined, '解析不判定扣抵');
});

test('辨識整理：推算的金額標示「推算」；讀到的金額不互相覆蓋', () => {
  const app = loadApp();
  const rc = plain(app.parseReceiptText_(RECEIPT, { taxId: OWN }));
  assert.equal(rc.kind, '收據');
  assert.deepEqual([rc.net, rc.tax, rc.total], [3200, 0, 3200]);
  assert.deepEqual([rc.src.total, rc.src.net, rc.src.tax], ['原文', '推算', '推算']);
  const tri = plain(app.parseReceiptText_('XY87654321\n買受人統編 ' + OWN + '\n總計 2,100', { taxId: OWN }));
  assert.deepEqual([tri.net, tri.tax, tri.total], [2000, 100, 2100]);
  assert.equal(tri.src.tax, '推算');
  // 三個金額都讀到但對不上：保留原值，交給驗證
  const bad = plain(app.parseReceiptText_('銷售額 10,000\n稅額 500\n總計 10,600', {}));
  assert.deepEqual([bad.net, bad.tax, bad.total], [10000, 500, 10600]);
  const v = plain(app.validateDoc_(Object.assign(bad, { id: 'x', status: '待處理', date: '2026-10-01' }), {}));
  assert.ok(v.some((i) => i.code === 'AMOUNT_MISMATCH' && i.level === '錯誤'));
});

test('驗證規則：缺漏、稅率、統編、買方、日期、鎖帳、推算提示', () => {
  const app = loadApp();
  const base = { id: 'D1', status: '待處理', kind: '統一發票（有統編）', date: '2026-10-01', invoiceNo: 'AB12345678', sellerName: '甲', sellerTaxId: SELLER, buyerTaxId: OWN, net: 1000, tax: 50, total: 1050, src: {} };
  const ctx = { ownTaxId: OWN, openingDate: '2026-01-01', lockedPeriods: { '2026-09': true }, today: '2026-11-03' };
  const run = (patch, c) => plain(app.validateDoc_(Object.assign({}, base, patch), c || ctx)).map((i) => i.code);
  assert.deepEqual(run({}), []);
  assert.ok(run({ date: '' }).includes('MISSING_DATE'));
  assert.ok(run({ total: 0, net: 0, tax: 0 }).includes('MISSING_TOTAL'));
  assert.ok(run({ invoiceNo: '' }).includes('MISSING_INVOICE_NO'));
  assert.ok(run({ tax: 80, net: 970 }).includes('TAX_RATE'));
  assert.ok(run({ sellerTaxId: '12345678' }).includes('TAXID_INVALID'));
  assert.ok(run({ buyerTaxId: OTHER }).includes('BUYER_NOT_OWN'));
  assert.ok(run({ date: '2026-12-01' }).includes('DATE_FUTURE'));
  assert.ok(run({ date: '2025-12-31' }).includes('DATE_BEFORE_OPENING'));
  assert.ok(run({ date: '2026-09-15' }).includes('PERIOD_LOCKED'));
  assert.ok(run({ src: { tax: '推算' } }).includes('DERIVED'));
  assert.ok(run({ src: { _ocr: 'weak' } }).includes('OCR_WEAK'));
  assert.equal(app.docLevel_(plain(app.validateDoc_(Object.assign({}, base, { date: '' }), ctx))), '錯誤');
  assert.equal(app.docLevel_([]), '正常');
});

test('扣抵建議：不能只看買方統編', () => {
  const app = loadApp();
  const st = { taxId: OWN, vatType: '一般稅額' };
  const inv = { kind: '統一發票（有統編）', buyerTaxId: OWN, tax: 50 };
  assert.equal(app.deductibleHint_(inv, st, '5171').suggest, '可扣抵');
  assert.equal(app.deductibleHint_(Object.assign({}, inv, { kind: '收據' }), st, '5171').suggest, '不可扣抵');
  assert.equal(app.deductibleHint_(inv, { taxId: OWN, vatType: '小規模' }, '5171').suggest, '不可扣抵');
  assert.equal(app.deductibleHint_(inv, st, '6211').suggest, '不可扣抵');
  assert.equal(app.deductibleHint_(Object.assign({}, inv, { tax: 0 }), st, '5171').suggest, '不可扣抵');
  assert.equal(app.deductibleHint_(Object.assign({}, inv, { buyerTaxId: OTHER }), st, '5171').suggest, '不可扣抵');
  assert.match(app.deductibleHint_(inv, { taxId: '', vatType: '一般稅額' }, '5171').reason, /沒有填統一編號/);
  // 分錄：只有人工判定「可扣抵」才拆進項稅額
  const doc = { total: 1050, tax: 50, sellerName: '甲' };
  const on = { 1191: true };
  assert.equal(plain(app.docToLines_(Object.assign({ deductible: '未判定' }, doc), '5171', '1111', on)).length, 2);
  assert.equal(plain(app.docToLines_(Object.assign({ deductible: '不可扣抵' }, doc), '5171', '1111', on)).length, 2);
  assert.deepEqual(plain(app.docToLines_(Object.assign({ deductible: '可扣抵' }, doc), '5171', '1111', on)).map((l) => [l.code, l.debit, l.credit]), [['5171', 1000, 0], ['1191', 50, 0], ['1111', 0, 1050]]);
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

test('電子發票證明聯（A4 版面，雲端硬碟 OCR 實際輸出，名稱與統編已換成測試資料）', () => {
  const app = loadApp();
  const text = '電子發票證明聯 \n2026-11-04 \n發票號碼：HH40907524 格　　式：25 買　　方：測試買方股份有限公司 \n統一編號：' + OWN + ' \n地　　址： 第 1 頁／共 1 頁 \n' +
    '品名 數量 單價 金額 備註 線上金流服務費 1 2,049 2,049 1BFS_X.EC \n銷售額合計 2,049 營業人蓋統一發票專用章 (已條列營業人資料者得免蓋章) \n' +
    '營業稅 應稅 √ 零稅率 免稅 102 賣　　方：範例網路股份有限公司 \n總計 2,151 統一編號：' + SELLER + ' 總計新台幣(中文大寫) 地　　址：臺北市南港區經貿二路121號18樓 \n貳仟壹佰伍拾壹元整';
  for (const own of [{}, { taxId: OWN, name: '公版餐飲有限公司' }, { taxId: '12345675', name: '別家公司' }]) {
    const r = plain(app.parseReceiptText_(text, own));
    assert.equal(r.invoiceNo, 'HH40907524');
    assert.equal(r.date, '2026-11-04');
    assert.equal(r.sellerName, '範例網路股份有限公司');
    assert.equal(r.sellerTaxId, SELLER, '賣方統編要取「賣方」後面的那個');
    assert.equal(r.buyerTaxId, OWN);
    assert.deepEqual([r.net, r.tax, r.total], [2049, 102, 2151]);
    assert.deepEqual([r.src.net, r.src.tax, r.src.total], ['原文', '原文', '原文']);
  }
});

test('財政部進項發票檔：民國日期、引號金額、作廢略過、載具格式', () => {
  const app = loadApp();
  const r = plain(app.parseInvoiceCsv_(CSV));
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows.map((x) => x.date), ['2026-10-05', '2026-10-12', '2026-10-20']);
  assert.deepEqual([r.rows[0].net, r.rows[0].tax, r.rows[0].total], [1000, 50, 1050]);
  assert.match(r.skipped[0], /CD11114444/);
  assert.throws(() => app.parseInvoiceCsv_('a,b,c\n1,2,3'), /發票號碼/);
  assert.throws(() => app.parseInvoiceCsv_('序號,開立日期,金額\n1,2,3'), /第一列是：「序號,開立日期,金額」/);
  assert.throws(() => app.parseInvoiceCsv_('\uFFFD\uFFFDJFIF\u0000\u0001'), /不是文字格式/);
  // Excel 開過再存的亂碼（截圖實例）：要明確說是 Excel 造成、請重新下載
  assert.throws(() => app.parseInvoiceCsv_('?澆?隞?,蝯?蝔刻?,瘜冽?瑼??,鞈?蝯梁楊\n1,2,3,4'), /變成亂碼.*重新下載/);
  assert.throws(() => app.parseInvoiceCsv_('\uFFFD\uFFFD\uFFFD,\uFFFD\uFFFD\n1,2'), /變成亂碼/);
  const m = plain(app.parseInvoiceCsv_('M|手機條碼|/ABC1234|20261101|' + SELLER + '|某超市|GH12345678|356|開立'));
  assert.deepEqual([m.rows[0].invoiceNo, m.rows[0].date, m.rows[0].total], ['GH12345678', '2026-11-01', 356]);
});

// ───────────── 流程 ─────────────

test('上傳 → 原文另存 → 未判定不能入帳 → 人工校正 → 入帳 → 作廢後回到待處理', () => {
  const { app, call, upload } = books();
  const longText = HANDWRITTEN + '\n' + '備註'.repeat(30000);
  const up = upload(longText, '發票.jpg');
  assert.equal(up.status, '待處理');
  assert.equal(app.__drive.removed.length, 1, 'OCR 暫存文件要刪掉');
  assert.equal(app.__drive.ocrCalls[0].opts.ocrLanguage, 'zh', 'Drive API v3 語言提示要用兩碼 zh（zh-TW 會被拒絕）');
  // 原文完整保存在「單據原文」，超過 40,000 字分多列
  const d0 = call('getDoc', { id: up.id });
  assert.equal(d0.text, longText);
  assert.equal(app.readObjects_('單據原文').length, 2);
  assert.ok(!app.HEADERS['單據'].includes('辨識文字'), '單據分頁不再存原文');
  assert.equal(d0.deductible, '未判定');
  assert.equal(d0.hintSuggest, '可扣抵');
  assert.equal(d0.suggest, '5171');
  assert.equal(d0.src.total, '原文');

  const first = call('postDocs', { items: [{ id: up.id, rev: d0.rev, pay: '2131' }] });
  assert.equal(first.ok, 0);
  assert.match(first.results[0].error, /判定進項稅額/);

  // 人工修正賣方名稱並判定可扣抵
  const fixed = call('updateDoc', { id: up.id, rev: d0.rev, fields: { sellerName: '大成生鮮食品公司', deductible: '可扣抵' } });
  assert.equal(fixed.src.sellerName, '人工');
  assert.equal(fixed.src.deductible, '人工');
  assert.equal(fixed.confirmedBy, 'admin');
  assert.equal(fixed.rev, d0.rev + 1);

  const ok = call('postDocs', { items: [{ id: up.id, rev: fixed.rev, pay: '2131' }] });
  assert.equal(ok.ok, 1, JSON.stringify(ok.results));
  const v = call('getVoucher', { no: ok.results[0].no });
  assert.equal(v.source, '單據');
  assert.equal(v.type, '轉帳');
  assert.deepEqual(v.lines.map((l) => [l.code, l.debit, l.credit]), [['5171', 10000, 0], ['1191', 500, 0], ['2131', 0, 10500]]);
  assert.equal(call('listVouchers', { period: '2026-10' }).vouchers[0].docs[0].id, up.id);
  assert.throws(() => call('updateDoc', { id: up.id, rev: fixed.rev + 1, fields: { total: 1 } }), /已入帳/);
  assert.match(call('postDocs', { items: [{ id: up.id, pay: '2131', deductible: '可扣抵' }] }).results[0].error, /已經入帳/);

  call('voidVoucher', { no: v.no, reason: '科目選錯' });
  const back = call('getDoc', { id: up.id });
  assert.equal(back.status, '待處理');
  assert.equal(back.voucherNo, '');
  assert.match(back.note, /已作廢/);
});

test('防重複入帳：同號發票只能入帳一次；改回待處理也擋得住；作廢後才能改入另一張', () => {
  const { call, upload } = books();
  const a = upload(HANDWRITTEN, 'a.jpg');
  const b = upload(HANDWRITTEN, 'b.jpg');
  assert.equal(b.status, '重複');
  const da = call('getDoc', { id: a.id });
  assert.ok(codes(da).includes('DUP_PENDING'));
  // 有警示沒核對 → 不能入帳
  const noAck = call('postDocs', { items: [{ id: a.id, rev: da.rev, pay: '1113', deductible: '可扣抵' }] });
  assert.match(noAck.results[0].error, /警示尚未核對/);
  const ra = call('postDocs', { items: [itemOf(call, a.id, { pay: '1113', deductible: '可扣抵' })] });
  assert.equal(ra.ok, 1);
  // B 改回待處理需要原因，改回後仍然不能入帳
  assert.throws(() => call('restoreDoc', { id: b.id }), /原因/);
  call('restoreDoc', { id: b.id, reason: '確認是另一張' });
  const db = call('getDoc', { id: b.id });
  assert.ok(codes(db).includes('DUP_POSTED'));
  assert.equal(db.level, '錯誤');
  const rb = call('postDocs', { items: [itemOf(call, b.id, { pay: '1113', deductible: '可扣抵' })] });
  assert.match(rb.results[0].error, /已由 .* 入帳/);
  // 傳票編輯器路徑也擋得住
  assert.throws(() => call('saveVoucher', { docId: b.id, rev: db.rev, deductible: '可扣抵', ackWarnings: warnKeys(db), date: '2026-10-28', type: '支出', lines: [{ code: '5171', debit: 10500 }, { code: '1113', credit: 10500 }] }), /已由/);
  // 作廢 A 之後，B 可以入帳
  call('voidVoucher', { no: ra.results[0].no, reason: '入錯單據' });
  const rb2 = call('postDocs', { items: [itemOf(call, b.id, { pay: '1113', deductible: '可扣抵' })] });
  assert.equal(rb2.ok, 1, JSON.stringify(rb2.results));
  // 疑似重複：沒有發票號碼、廠商日期金額相同
  upload(RECEIPT, 'r1.jpg');
  const r2 = upload(RECEIPT, 'r2.jpg');
  assert.ok(codes(call('getDoc', { id: r2.id })).includes('DUP_SUSPECT'));
});

test('財政部匯入：不因有稅額就判定可扣抵；重複匯入不建立；缺買方欄標示推算', () => {
  const { call } = books();
  const r = call('importInvoices', { text: CSV, fileName: '進項.csv' });
  assert.equal(r.added, 3);
  assert.equal(call('importInvoices', { text: CSV, fileName: '進項.csv' }).duplicates.length, 3);
  const list = call('listDocs', {});
  const tel = list.docs.find((x) => x.invoiceNo === 'CD11112222');
  assert.equal(tel.deductible, '未判定');
  assert.equal(tel.hintSuggest, '可扣抵');
  assert.equal(tel.src.total, '匯入');
  assert.equal(tel.suggest, '6161');
  const noBuyer = 'ignored\n發票號碼,發票日期,賣方名稱,總計,營業稅\nGH22223333,115/10/09,某行,1050,50';
  call('importInvoices', { text: noBuyer, fileName: 'b.csv' });
  const gh = call('listDocs', { keyword: 'GH22223333' }).docs[0];
  assert.equal(gh.buyerTaxId, OWN);
  assert.equal(gh.src.buyerTaxId, '推算');
});

test('批次入帳：每張都經過傳票驗證，一張失敗不影響其他張；鎖帳月份擋下', () => {
  const { call } = books();
  call('importInvoices', { text: CSV, fileName: '進項.csv' });
  call('lockPeriod', { period: '2026-10' });
  call('unlockPeriod', { period: '2026-10', reason: '測試' });
  const docs = call('listDocs', {}).docs;
  const items = docs.map((d) => ({ id: d.id, rev: d.rev, pay: '1113', deductible: d.hintSuggest, ackWarnings: warnKeys(d) }));
  // 鎖住 10 月前先成功一張
  const one = call('postDocs', { items: [items[0]] });
  assert.equal(one.ok, 1);
  call('lockPeriod', { period: '2026-10' });
  const rest = call('postDocs', { items: items.slice(1) });
  assert.equal(rest.ok, 0);
  assert.ok(rest.results.every((x) => /已鎖帳/.test(x.error)));
  call('unlockPeriod', { period: '2026-10', reason: '補單據' });
  const again = call('postDocs', { items: items.slice(1).concat([{ id: 'D999999-0001' }]) });
  assert.equal(again.ok, 2);
  assert.equal(again.failed, 1);
  assert.match(again.results[2].error, /找不到單據/);
  // 批次結果與單張入帳相同規則：台電的買方是本公司、稅額 100 → 可扣抵拆稅
  const tw = call('listDocs', { status: '已入帳', keyword: 'CD11113333' }).docs[0];
  const v = call('getVoucher', { no: tw.voucherNo });
  assert.deepEqual(v.lines.map((l) => l.code), ['6191', '1191', '1113']);
  assert.throws(() => call('postDocs', { items: Array.from({ length: 21 }, (_, i) => ({ id: 'x' + i })) }), /最多 20 張/);
});

test('人工校正：版本衝突、格式檢查、重新解析保留人工欄位', () => {
  const { call, upload } = books();
  const up = upload(HANDWRITTEN, 'a.jpg');
  const d = call('getDoc', { id: up.id });
  assert.throws(() => call('updateDoc', { id: up.id, rev: d.rev + 5, fields: { total: 1 } }), /其他人修改過/);
  assert.throws(() => call('updateDoc', { id: up.id, rev: d.rev, fields: { total: 10.5 } }), /整數/);
  assert.throws(() => call('updateDoc', { id: up.id, rev: d.rev, fields: { invoiceNo: '12AB' } }), /發票號碼/);
  assert.throws(() => call('updateDoc', { id: up.id, rev: d.rev, fields: { sellerTaxId: '123' } }), /8 碼/);
  assert.throws(() => call('updateDoc', { id: up.id, rev: d.rev, fields: { suggest: '9999' } }), /不存在/);
  const u = call('updateDoc', { id: up.id, rev: d.rev, fields: { total: 10600 } });
  assert.ok(codes(u).includes('AMOUNT_MISMATCH'));
  assert.equal(u.level, '錯誤');
  assert.equal(call('listDocs', { status: '異常' }).docs.length, 1);
  const rp = call('reparseDoc', { id: up.id });
  assert.equal(rp.total, 10600, '人工欄位不被覆蓋');
  assert.equal(rp.net, 10000);
  assert.equal(rp.src.total, '人工');
});

test('權限：助理只能上傳與查看；畫面不能偽造傳票來源', () => {
  const { app, call } = books();
  app.createUser_('helper', '小幫手', '成員');
  app.setPassword_(app.findUser_('helper'), 'Help12345');
  app.appendObjects_('_公司權限', [{ '帳號': 'helper', '公司代碼': 'C01', '角色': '助理' }]);
  const ht = app.login('helper', 'Help12345').data.token;
  app.__drive.ocrQueue.push(RECEIPT);
  const up = call('uploadDoc', { name: 'r.jpg', mimeType: 'image/jpeg', data: b64('r') }, ht);
  assert.equal(call('getDoc', { id: up.id }, ht).id, up.id);
  ['updateDoc', 'postDocs', 'reparseDoc', 'importInvoices', 'skipDoc', 'restoreDoc'].forEach((a) => {
    assert.throws(() => call(a, { id: up.id, items: [{ id: up.id }], text: CSV, reason: 'x', rev: 1, fields: {} }, ht), /沒有權限/, a);
  });
  assert.throws(() => call('saveVoucher', { docId: up.id, date: '2026-10-30', type: '支出', lines: [] }, ht), /沒有權限/);
  const v = call('saveVoucher', { source: '月底盤點', date: '2026-10-30', type: '支出', memo: 'x', lines: [{ code: '6399', debit: 10 }, { code: '1111', credit: 10 }] });
  assert.equal(call('getVoucher', { no: v.no }).source, '手動');
});

test('多公司隔離：A 公司的單據在 B 公司查不到也入不了帳', () => {
  const { call, upload } = books();
  const up = upload(HANDWRITTEN, 'a.jpg');
  const b = call('createCompany', { name: '公版食品有限公司', industries: ['食品製造'] });
  assert.throws(() => call('getDoc', { id: up.id, _company: b.id }), /找不到單據/);
  const r = call('postDocs', { _company: b.id, items: [{ id: up.id, rev: 1, pay: '1113', deductible: '不可扣抵', ackWarnings: [] }] });
  assert.match(r.results[0].error, /找不到單據/);
  assert.equal(call('listDocs', { _company: b.id }).docs.length, 0);
  assert.equal(call('listDocs', {}).docs.length, 1);
});

test('傳票編輯器路徑：自訂分錄仍須判定扣抵並通過傳票驗證', () => {
  const { call, upload } = books();
  const up = upload(RECEIPT, 'r.jpg');
  const lines = [{ code: '6171', debit: 3200 }, { code: '1111', credit: 3200 }];
  const cur = call('getDoc', { id: up.id });
  const base = { docId: up.id, rev: cur.rev, ackWarnings: warnKeys(cur) };
  assert.throws(() => call('saveVoucher', Object.assign({ date: '2026-10-30', type: '支出', lines }, base)), /判定進項稅額/);
  assert.throws(() => call('saveVoucher', Object.assign({ deductible: '不可扣抵', date: '2026-10-30', type: '支出', lines: [{ code: '6171', debit: 3200 }, { code: '1111', credit: 3000 }] }, base)), /借貸/);
  const g = call('getDoc', { id: up.id, expense: '6171', pay: '1111', deductible: '不可扣抵' });
  assert.deepEqual(g.lines.map((l) => [l.code, l.debit, l.credit]), [['6171', 3200, 0], ['1111', 0, 3200]]);
  const r = call('saveVoucher', Object.assign({ deductible: '不可扣抵', date: '2026-10-30', type: '支出', memo: g.memo, lines: g.lines }, base));
  assert.ok(r.no);
  assert.equal(call('getDoc', { id: up.id }).status, '已入帳');
});

test('Codex P1：核對後被別人改過的單據不能用舊版本入帳（單張、批次、傳票編輯器）', () => {
  const { call, upload } = books();
  const up = upload(RECEIPT, 'r.jpg');
  const seen = call('getDoc', { id: up.id });
  // 另一位會計把金額改成 6,400
  call('updateDoc', { id: up.id, rev: seen.rev, fields: { total: 6400, net: 6400 } });
  const r = call('postDocs', { items: [{ id: up.id, rev: seen.rev, pay: '1111', deductible: '不可扣抵', ackWarnings: warnKeys(seen) }] });
  assert.equal(r.ok, 0);
  assert.match(r.results[0].error, /被修改過/);
  assert.throws(() => call('saveVoucher', { docId: up.id, rev: seen.rev, deductible: '不可扣抵', ackWarnings: warnKeys(seen), date: '2026-10-30', type: '支出', lines: [{ code: '6171', debit: 6400 }, { code: '1111', credit: 6400 }] }), /被修改過/);
  assert.equal(call('postDocs', { items: [{ id: up.id, pay: '1111', deductible: '不可扣抵' }] }).ok, 0, '沒有版本號也拒絕');
  assert.equal(call('getDoc', { id: up.id }).status, '待處理');
  // 重新核對最新版本後才能入帳
  assert.equal(call('postDocs', { items: [itemOf(call, up.id, { pay: '1111', deductible: '不可扣抵' })] }).ok, 1);
});

test('Codex P2：只核對過舊警示時，新出現的警示會擋下入帳', () => {
  const { call, upload } = books();
  const up = upload(RECEIPT, 'r.jpg');
  const before = call('getDoc', { id: up.id });
  const oldAck = warnKeys(before);
  // 改了買方統編 → 新增「買方不是本公司」警示，但畫面上還沒顯示
  const after = call('updateDoc', { id: up.id, rev: before.rev, fields: { buyerTaxId: OTHER } });
  assert.ok(codes(after).includes('BUYER_NOT_OWN'));
  const r = call('postDocs', { items: [{ id: up.id, rev: after.rev, pay: '1111', deductible: '不可扣抵', ackWarnings: oldAck }] });
  assert.equal(r.ok, 0);
  assert.match(r.results[0].error, /買方統編不是本公司/);
  // 舊版的 true（不指定哪些警示）也不算核對
  const legacy = call('postDocs', { items: [{ id: up.id, rev: after.rev, pay: '1111', deductible: '不可扣抵', ackWarnings: true }] });
  assert.match(legacy.results[0].error, /警示尚未核對/);
  assert.equal(call('postDocs', { items: [{ id: up.id, rev: after.rev, pay: '1111', deductible: '不可扣抵', ackWarnings: warnKeys(after) }] }).ok, 1);
});

test('沒有啟用 Drive API 時照樣存檔，標示辨識失敗', () => {
  const { app, call } = books();
  app.Drive = undefined;
  const up = call('uploadDoc', { name: 'n.png', mimeType: 'image/png', data: b64('n') });
  assert.equal(up.status, '待處理');
  assert.match(up.note, /尚未啟用文字辨識/);
  assert.ok(codes(call('getDoc', { id: up.id })).includes('OCR_FAILED'));
  assert.throws(() => call('uploadDoc', { name: 'x.exe', mimeType: 'application/x-msdownload', data: b64('x') }), /格式不支援/);
});
