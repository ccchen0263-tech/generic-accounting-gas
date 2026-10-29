/**
 * 產生「手動貼上版」：只有兩個檔案，方便在 Apps Script 編輯器直接貼上
 *   dist/Code.gs     ← 所有後端程式合併
 *   dist/Index.html  ← 畫面（樣式與前端程式已內嵌）
 * 用法：node tools/build-dist.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const read = (f) => fs.readFileSync(path.join(src, f), 'utf8');
const version = /version: '([^']+)'/.exec(read('00_Config.js'))[1];

const banner = `/**\n * 公版會計系統 v${version}（手動貼上版，由 tools/build-dist.js 產生，請勿直接修改）\n * 原始碼：https://github.com/ccchen0263-tech/generic-accounting-gas\n */\n`;
const code = fs.readdirSync(src).filter((f) => f.endsWith('.js')).sort()
  .map((f) => `// ===== ${f} =====\n` + read(f)).join('\n');
fs.writeFileSync(path.join(dist, 'Code.gs'), banner + code);

let html = read('Index.html');
html = html.replace("<?!= include('Css'); ?>", read('Css.html')).replace("<?!= include('Js'); ?>", read('Js.html'));
if (html.includes('<?')) throw new Error('Index.html 仍有樣板標記');
fs.writeFileSync(path.join(dist, 'Index.html'), html);
console.log(`dist/Code.gs、dist/Index.html 已產生（v${version}）`);
