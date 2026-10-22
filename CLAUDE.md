# 開發規則（給 AI 助手與開發者）

專案擁有者不寫程式。回覆一律繁體中文，說明要白話；改動要附測試。

## 架構

- Google Apps Script + Google 試算表，一家公司一份試算表（綁定式程式）。`src/` 由 clasp 推送，`dist/` 是手動貼上版（`node tools/build-dist.js` 產生，src 改完要重建並一起提交）。
- `10_Core.js` 只做純計算，不呼叫任何 Google 服務，方便在 Node 測試。試算表讀寫只寫在 `20_Store.js`。
- 前端只呼叫 `api(token, action, payload)`；新增功能 = 在 `HANDLERS` 加一個動作 + 在 `PERMISSIONS` 設定角色。權限一律在伺服器檢查。
- 名稱結尾沒有底線的全域函式，網頁訪客都能用 `google.script.run` 呼叫。目前只允許 `doGet`、`include`、`api`、`login`、`logout`；選單與編輯器用的管理函式（`setup`、`resetAdminPassword`、`writeReportsThisMonth`）第一行必須呼叫 `requireEditor_()`。其他函式一律以 `_` 結尾。

## 帳務規則（不可違反）

- 金額為新台幣整數；每張傳票借貸必須相等。
- 科目代碼、日期、傳票號碼在試算表一律存成文字。
- 報表區塊決定科目屬於哪張報表與正負方向（`BLOCKS`）；代碼首碼需符合區塊（1 資產、2 負債、3 權益、4 收入、5 成本、6 費用、7 營業外、8 所得稅）。
- 傳票號碼 `yyyyMM-0001`，作廢號碼不重複使用；作廢保留原列並標記「作廢」，不刪除。
- 已鎖帳月份不能新增、修改、作廢傳票，也不能重做盤點；解鎖只限管理者且必填原因。
- 月底盤點採定期盤存：差額 = 盤點數 − 帳上存貨，沖轉到該存貨科目的「盤點對應成本科目」。
- 資產負債表的「本期損益」「前期未結轉損益」為系統計算，年度結帳（第三期）後前期未結轉損益會歸零。
- 已有分錄或期初餘額的科目不能改報表區塊，只能停用。

## 測試

- `npm test`：帳務流程測試（`tests/gas-fakes.js` 模擬試算表與 Apps Script 服務）。
- `node tests/ui/build-preview.js && node tests/ui/check-ui.js`：三種角色 × 1280／390 寬逐頁檢查，不可有 JS 錯誤或超出畫面。
- 每次修改後兩組測試都要通過再提交。
