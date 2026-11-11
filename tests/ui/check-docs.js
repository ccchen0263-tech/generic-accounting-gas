/**
 * 介面實測（v0.4）：單據匣
 *  1. 校正畫面：左邊原始單據、右邊欄位與來源標示、判定扣抵 → 確認入帳 → 分錄正確
 *  2. 勾選兩張財政部發票 → 批次確認入帳
 *  3. 金額對不上的單據出現在「異常」分頁，而且不能勾選
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
    const nav = async (id) => {
      if (size.width < 900) { await page.click('#menuBtn'); await page.waitForTimeout(250); }
      await page.click(`#nav a[data-page="${id}"]`);
      await idle(page);
    };
    const wide = async (label) => {
      const w = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, ...Array.from(document.querySelectorAll('#modal:not([hidden]) *, #main *')).filter((e) => !e.closest('.table-wrap') && !e.closest('[hidden]') && e.getBoundingClientRect().width > 0).map((e) => Math.ceil(e.getBoundingClientRect().right))));
      if (w > size.width) fail(label + ' 超出畫面寬度 ' + w);
    };
    await page.goto(url);
    await page.fill('#loginUser', 'acct');
    await page.fill('#loginPass', 'Acct12345');
    await page.click('#loginBtn');
    await page.waitForSelector('#app:not([hidden])');
    await idle(page);
    await nav('docs');
    await page.waitForSelector('#docList .doc-row');
    const count = await page.$$eval('#docList .doc-row', (x) => x.length);
    if (count !== 5) fail('待處理應有 5 張，實際 ' + count);

    // 0. 選錯按鈕：照片走匯入、CSV 走照片，都要明確提醒，不能顯示「找不到發票號碼」
    const tmp = require('os').tmpdir();
    fs.writeFileSync(path.join(tmp, 'wrong.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]));
    fs.writeFileSync(path.join(tmp, 'wrong.csv'), '發票號碼,發票日期,總計\n');
    await page.setInputFiles('#invFile', path.join(tmp, 'wrong.jpg'));
    await page.waitForTimeout(300);
    if (!/請改按「選擇照片或 PDF」/.test(await page.textContent('#upProg'))) fail('照片選到匯入按鈕時沒有提醒');
    await page.setInputFiles('#docFiles', path.join(tmp, 'wrong.csv'));
    await page.waitForTimeout(300);
    const msg2 = await page.textContent('#upProg');
    if (!/請按「匯入財政部進項發票檔」/.test(msg2) || /找不到/.test(msg2)) fail('CSV 選到照片按鈕時提醒不對：' + msg2);
    // 1. 校正畫面
    await page.locator('#docList .doc-row', { hasText: '大成生鮮' }).locator('.doc-open').click();
    await page.waitForSelector('#modal:not([hidden]) .review');
    await idle(page);
    if (!(await page.locator('#rvFile img.doc-img').count())) fail('校正畫面左邊沒有原始單據');
    const srcs = await page.$$eval('.review-form .src', (x) => x.map((e) => e.textContent));
    if (!srcs.includes('原文')) fail('欄位沒有標示來源：' + srcs.join(','));
    if (await page.inputValue('[data-f="total"]') !== '10500') fail('總金額沒有帶入');
    if (!/與總額相符/.test(await page.textContent('#rvSum'))) fail('金額核對沒有顯示相符');
    const layout = await page.evaluate(() => { const a = document.querySelector('.review-src').getBoundingClientRect(), b = document.querySelector('.review-form').getBoundingClientRect(); return { side: b.left > a.right - 1, stacked: b.top >= a.bottom - 1 }; });
    if (size.width >= 900 && !layout.side) fail('桌機應左右並排');
    if (size.width < 900 && !layout.stacked) fail('手機應上下排列');
    await wide('校正畫面');
    await page.click('#rvPost');
    await idle(page);
    if (!/判定進項稅額/.test(await page.textContent('#rvErr'))) fail('未判定扣抵時應擋下入帳');
    // 改了欄位直接按確認：要先存檔、重新檢查、顯示最新結果，不能直接入帳（Codex P2）
    await page.fill('[data-f="sellerName"]', '大成生鮮食品股份有限公司');
    await page.check('input[name="rvDed"][value="可扣抵"]');
    await page.selectOption('#rvPay', '2131');
    await page.click('#rvPost');
    await idle(page);
    if (!/重新檢查/.test(await page.textContent('#rvErr'))) fail('改了欄位後應先重新檢查，不能直接入帳');
    if ((await page.locator('.fld', { hasText: '賣方名稱' }).locator('.src').textContent()) !== '人工') fail('改過的欄位沒有標示人工');
    if (!(await page.isChecked('input[name="rvDed"][value="可扣抵"]'))) fail('重新顯示後扣抵判定應保留');
    await page.screenshot({ path: path.join(shots, size.name + '-單據校正.png') });
    await page.click('#rvPost');
    await idle(page);
    await page.waitForSelector('#modal', { state: 'hidden' });
    await idle(page);
    const left = await page.$$eval('#docList .doc-row', (x) => x.length);
    if (left !== 4) fail('入帳後待處理應剩 4 張，實際 ' + left);

    // 2. 批次確認
    for (const who of ['中華電信', '台灣電力']) await page.locator('#docList .doc-row', { hasText: who }).locator('[data-pick]').check();
    await page.waitForSelector('#batchBar:not([hidden])');
    if (!/已選 2 張/.test(await page.textContent('#batchBar'))) fail('批次列沒有顯示已選 2 張');
    await page.selectOption('#bPay', '1113');
    await page.selectOption('#bDed', 'hint');
    if (await page.locator('#bAck').count()) await page.check('#bAck');
    await wide('批次列');
    await page.click('#bGo');
    await idle(page);
    await page.waitForSelector('#docList .notice');
    const note = await page.textContent('#docList .notice');
    if (!/入帳 2 張/.test(note)) fail('批次入帳結果不對：' + note);

    // 3. 異常分頁
    await page.click('#docTabs .chip[data-st="異常"]');
    await idle(page);
    const bad = page.locator('#docList .doc-row', { hasText: '某某商行' });
    if (!(await bad.count())) fail('金額對不上的單據沒有出現在異常分頁');
    else if (await bad.locator('[data-pick]').count()) fail('有錯誤的單據不應該能勾選');

    await nav('vouchers');
    await page.waitForSelector('#vList .voucher');
    const card = page.locator('#vList .voucher', { hasText: '大成生鮮' });
    if (!(await card.locator('.badge.open').count())) fail('傳票沒有顯示「附單據」');
    await card.locator('.voucher-head').click();
    const cells = await card.locator('tbody tr').allInnerTexts();
    const flat = cells.map((t) => t.replace(/\s+/g, ' ')).join(' | ');
    if (!/5171.*10,000/.test(flat) || !/1191.*500/.test(flat) || !/2131.*10,500/.test(flat)) fail('入帳分錄不對：' + flat);
    errors.forEach((e) => fail('JS 錯誤：' + e));
    await page.close();
  }
  await browser.close();
  if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
  console.log('單據匣流程通過：校正畫面（左右並排／手機上下）、扣抵判定、確認入帳、批次入帳、異常分頁（桌機、手機）');
})();
