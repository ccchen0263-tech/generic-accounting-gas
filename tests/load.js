/** 把 src/*.js 載入同一個沙盒（模擬 Apps Script 的全域環境） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createFakeGas } = require('./gas-fakes');

function loadApp(options) {
  const env = createFakeGas(options);
  const context = vm.createContext(Object.assign({ console }, env));
  const dir = path.join(__dirname, '..', 'src');
  fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), context, { filename: f });
  });
  return context;
}

module.exports = { loadApp };
