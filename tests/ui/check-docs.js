/**
 * 介面實測：單據匣 → 查看原始單據 → 產生傳票 → 儲存 → 傳票顯示「附單據」
 * 桌機與手機各跑一次。用法：node tests/ui/build-preview.js && node tests/ui/check-docs.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(require.resolve('playwright', { paths: ['/opt/npm-tools/node_modules', process.cwd()] }));

const url = 'file://' + path.join(__dirname, 'preview.html');
const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
const idle = (page) => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 10000 });

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  for (const size of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const fail = (m) => problems.push(size.name + '：' + m);
    await page.goto(url);
    await page.fill('#loginUser', 'acct');
    await page.fill('#loginPass', 'Acct12345');
    await page.click('#loginBtn');
    await page.waitForSelector('#app:not([hidden])');
    await idle(page);
    if (size.width < 900) { await page.click('#menuBtn'); await page.waitForTimeout(250); }
    await page.click('#nav a[data-page="docs"]');
    await idle(page);
    await page.waitForSelector('#docList .voucher');
    const count = await page.$$eval('#docList .voucher', (x) => x.length);
    if (count !== 4) fail('待處理應有 4 張，實際 ' + count);
    const tab = await page.textContent('#docTabs .chip.on');
    if (!/待處理\s*4/.test(tab)) fail('分頁數字不對：' + tab);

    // 找拍照上傳的大成發票
    const card = page.locator('#docList .voucher', { hasText: '大成生鮮' });
    await card.locator('.voucher-head').click();
    await card.locator('[data-act="file"]').click();
    await idle(page);
    if (!(await card.locator('.doc-view img.doc-img').count())) fail('看不到原始單據圖片');
    await card.locator('[data-pay]').selectOption('2131');
    await card.locator('[data-act="post"]').click();
    await page.waitForSelector('#modal:not([hidden]) #edSave');
    const title = await page.textContent('#modalTitle');
    if (!/單據入帳 D/.test(title)) fail('對話框標題不對：' + title);
    const lines = await page.$$eval('#edLines .line:not(.head)', (rows) => rows.map((r) => [r.querySelector('.l-acct').value, r.querySelector('.l-dr').value, r.querySelector('.l-cr').value]));
    const want = [['5171 食材及飲料進貨', '10000', ''], ['1191 進項稅額', '500', ''], ['2131 應付帳款', '', '10500']];
    if (JSON.stringify(lines) !== JSON.stringify(want)) fail('建議分錄不對：' + JSON.stringify(lines));
    if ((await page.inputValue('#edDate')) !== '2026-02-06') fail('日期沒有帶入');
    if ((await page.inputValue('#edType')) !== '轉帳') fail('月結應為轉帳傳票');
    await page.click('#edDocBtn');
    await idle(page);
    if (!(await page.locator('#edDocView img').count())) fail('入帳畫面看不到原始單據');
    await page.screenshot({ path: path.join(shots, size.name + '-單據入帳.png'), fullPage: true });
    await page.click('#edSave');
    await idle(page);
    await page.waitForSelector('#modal', { state: 'hidden' });
    await page.waitForTimeout(100);
    const left = await page.$$eval('#docList .voucher', (x) => x.length);
    if (left !== 3) fail('入帳後待處理應剩 3 張，實際 ' + left);

    if (size.width < 900) { await page.click('#menuBtn'); await page.waitForTimeout(250); }
    await page.click('#nav a[data-page="vouchers"]');
    await idle(page);
    await page.waitForSelector('#vList .voucher');
    const badge = await page.locator('#vList .voucher', { hasText: '大成生鮮' }).locator('.badge.open').count();
    if (!badge) fail('傳票沒有顯示「附單據」');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    if (wide > size.width) fail('畫面超出寬度 ' + wide);
    errors.forEach((e) => fail('JS 錯誤：' + e));
    await page.close();
  }
  await browser.close();
  if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
  console.log('單據匣流程通過：上傳的單據可查看原檔、帶入建議分錄、入帳後連結到傳票（桌機、手機）');
})();
