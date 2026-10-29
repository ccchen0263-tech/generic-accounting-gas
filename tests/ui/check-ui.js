/**
 * 介面實測：三種角色 × 桌機 1280 與手機 390，逐頁截圖並檢查
 *  - 沒有 JavaScript 錯誤
 *  - 手機版頁面寬度不超出 390（沒有橫向捲動）
 *  - 每頁都有內容、沒有錯誤提示
 * 用法：node tests/ui/build-preview.js && node tests/ui/check-ui.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(require.resolve('playwright', { paths: ['/opt/npm-tools/node_modules', process.cwd()] }));

const url = 'file://' + path.join(__dirname, 'preview.html');
const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });

const ROLES = [
  { user: 'admin', pass: 'Admin1234', label: '管理者' },
  { user: 'acct', pass: 'Acct12345', label: '會計' },
  { user: 'helper', pass: 'Help12345', label: '助理' }
];
const SIZES = [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }];

async function idle(page) {
  await page.waitForFunction(() => document.querySelector('#busy').hidden && !(document.querySelector('#pageBody') || {}).textContent?.startsWith('載入中'), null, { timeout: 10000 });
  await page.waitForTimeout(80);
}

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  for (const size of SIZES) {
    for (const role of ROLES) {
      const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(url);
      await page.fill('#loginUser', role.user);
      await page.fill('#loginPass', role.pass);
      await page.click('#loginBtn');
      await page.waitForSelector('#app:not([hidden])');
      await idle(page);
      const pages = await page.$$eval('#nav a', (as) => as.map((a) => ({ id: a.dataset.page, title: a.textContent })));
      for (const p of pages) {
        if (size.width < 900) {
          await page.click('#menuBtn');
          await page.waitForTimeout(250);
        }
        await page.click(`#nav a[data-page="${p.id}"]`);
        await idle(page);
        await page.waitForTimeout(150);
        const info = await page.evaluate(() => ({
          sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, ...Array.from(document.querySelectorAll('body *')).filter((e) => {
            if (e.closest('.table-wrap') && !e.classList.contains('table-wrap')) return false;
            if (e.closest('#nav:not(.open)') || e.closest('[hidden]')) return false;
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          }).map((e) => Math.ceil(e.getBoundingClientRect().right))),
          bodyText: (document.querySelector('#pageBody') || {}).innerText || '',
          bad: Array.from(document.querySelectorAll('.notice.bad')).map((n) => n.innerText)
        }));
        if (info.sw > size.width) problems.push(`${size.name} ${role.label} ${p.title}：頁面寬 ${info.sw} 超出 ${size.width}`);
        if (!info.bodyText.trim()) problems.push(`${size.name} ${role.label} ${p.title}：沒有內容`);
        info.bad.forEach((b) => problems.push(`${size.name} ${role.label} ${p.title}：錯誤提示「${b.slice(0, 80)}」`));
        await page.screenshot({ path: path.join(shots, `${size.name}-${role.user}-${p.id}.png`), fullPage: true });
      }
      errors.forEach((e) => problems.push(`${size.name} ${role.label}：JS 錯誤 ${e}`));
      console.log(`${size.name} ${role.label}：${pages.length} 頁 → ${pages.map((p) => p.title).join('、')}`);
      await page.close();
    }
  }

  // 互動流程：管理者用畫面新增一張傳票、開啟損益表比較
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url);
  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'Admin1234');
  await page.click('#loginBtn');
  await page.waitForSelector('#app:not([hidden])');
  await idle(page);
  await page.click('#nav a[data-page="vouchers"]');
  await idle(page);
  await page.click('#newV');
  await page.fill('#edMemo', '二月網路費');
  const rows = await page.$$('#edLines .line:not(.head)');
  await (await rows[0].$('.l-acct')).fill('6161');
  await (await rows[0].$('.l-acct')).dispatchEvent('change');
  await (await rows[0].$('.l-dr')).fill('1599');
  await (await rows[1].$('.l-acct')).fill('銀行存款');
  await (await rows[1].$('.l-acct')).dispatchEvent('change');
  await (await rows[1].$('.l-cr')).fill('1500');
  await page.waitForTimeout(50);
  const diffText = await page.textContent('#edDiff');
  if (!diffText.includes('差額 99')) problems.push('傳票差額提示不正確：' + diffText);
  await page.click('#edSave');
  await page.waitForFunction(() => document.querySelector('#edErr') && document.querySelector('#edErr').textContent.includes('借貸不平衡'));
  await (await rows[1].$('.l-cr')).fill('1599');
  await page.screenshot({ path: path.join(shots, 'flow-voucher-editor.png') });
  await page.click('#edSave');
  await page.waitForSelector('#modal[hidden]', { state: 'attached' });
  await idle(page);
  const listText = await page.textContent('#vList');
  if (!listText.includes('二月網路費')) problems.push('新增的傳票沒有出現在清單');
  // 套用範本：食材進貨－月結，輸入含稅 10500 → 未稅 10000、稅額 500
  await page.click('#newV');
  await page.selectOption('#edTpl', 'r-food-credit');
  await page.fill('#edAmt', '10500');
  await page.waitForTimeout(50);
  const tplDiff = await page.textContent('#edDiff');
  const tplHint = await page.textContent('#edTplHint');
  if (!tplDiff.includes('借貸平衡') || !tplHint.includes('未稅 10,000')) problems.push('範本金額拆分不正確：' + tplDiff + ' / ' + tplHint);
  await page.screenshot({ path: path.join(shots, 'flow-template.png') });
  await page.click('#edSave');
  await page.waitForSelector('#modal[hidden]', { state: 'attached' });
  await idle(page);
  // 切換公司
  await page.selectOption('#coSwitch', 'C02');
  await idle(page);
  await page.waitForFunction(() => document.querySelector('#companyTitle').textContent.includes('鯉魚食品'));
  await page.click('#nav a[data-page="group"]');
  await idle(page);
  await page.waitForTimeout(150);
  const groupText = await page.textContent('#gOut');
  if (!groupText.includes('合併') || !groupText.includes('鯉魚食品')) problems.push('集團報表沒有顯示兩家公司與合併欄');
  await page.screenshot({ path: path.join(shots, 'flow-group-report.png'), fullPage: true });
  await page.selectOption('#coSwitch', 'C01');
  await idle(page);
  await page.click('#nav a[data-page="is"]');
  await idle(page);
  await page.selectOption('#isCmp', 'prev');
  await page.click('#isCtl .run');
  await idle(page);
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(shots, 'flow-income-compare.png'), fullPage: true });
  errs.forEach((e) => problems.push('互動流程 JS 錯誤 ' + e));
  await browser.close();

  if (problems.length) {
    console.log('\n發現問題：\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('\n全部通過：沒有 JS 錯誤、手機版無橫向捲動、每頁都有內容');
})();
