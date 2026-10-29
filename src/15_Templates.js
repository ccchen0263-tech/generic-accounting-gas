/**
 * 常用傳票範本
 * 新增傳票時選一個範本，科目與借貸自動帶入。
 * 每行格式：[科目代碼, 'D' 借方 | 'C' 貸方, 金額來源]
 *   金額來源：'total' 含稅總額（或單一金額）、'net' 未稅、'tax' 稅額（5%）、'' 自己填
 * 有 net／tax 的範本，畫面會要求輸入「含稅金額」，系統自動拆：未稅＝四捨五入(含稅 ÷ 1.05)，稅額＝含稅 − 未稅。
 * 只會顯示「公司產業相符」且「所有科目都已啟用」的範本。
 */
var VOUCHER_TEMPLATES = [
  // ── 餐飲：營收 ──
  { id: 'r-cash', name: '現金營收（含稅）', industries: '餐飲', type: '收入', memo: '現金營收', lines: [['1111', 'D', 'total'], ['4121', 'C', 'net'], ['2161', 'C', 'tax']] },
  { id: 'r-card', name: '刷卡營收（含稅）', industries: '餐飲', type: '收入', memo: '刷卡營收', lines: [['1142', 'D', 'total'], ['4121', 'C', 'net'], ['2161', 'C', 'tax']] },
  { id: 'r-takeout', name: '外帶營收（含稅）', industries: '餐飲', type: '收入', memo: '外帶營收', lines: [['1111', 'D', 'total'], ['4122', 'C', 'net'], ['2161', 'C', 'tax']] },
  { id: 'r-delivery', name: '外送平台營收（含稅）', industries: '餐飲', type: '收入', memo: '外送平台營收', lines: [['1143', 'D', 'total'], ['4123', 'C', 'net'], ['2161', 'C', 'tax']] },
  { id: 'r-delivery-pay', name: '外送平台撥款（扣抽成）', industries: '餐飲', type: '轉帳', memo: '外送平台撥款', lines: [['1113', 'D', ''], ['6332', 'D', ''], ['1143', 'C', '']] },
  { id: 'r-card-pay', name: '信用卡撥款（扣手續費）', industries: '餐飲,食品買賣', type: '轉帳', memo: '信用卡撥款', lines: [['1113', 'D', ''], ['6331', 'D', ''], ['1142', 'C', '']] },
  { id: 'r-voucher', name: '售出禮券（預收）', industries: '餐飲', type: '收入', memo: '售出禮券', lines: [['1111', 'D', 'total'], ['2182', 'C', 'total']] },
  // ── 餐飲：成本與費用 ──
  { id: 'r-food-cash', name: '食材進貨－付現（含稅）', industries: '餐飲', type: '支出', memo: '食材進貨', lines: [['5171', 'D', 'net'], ['1191', 'D', 'tax'], ['1111', 'C', 'total']] },
  { id: 'r-food-credit', name: '食材進貨－月結（含稅）', industries: '餐飲', type: '轉帳', memo: '食材進貨（月結）', lines: [['5171', 'D', 'net'], ['1191', 'D', 'tax'], ['2131', 'C', 'total']] },
  { id: 'r-pack', name: '外帶包材（含稅）', industries: '餐飲', type: '支出', memo: '外帶包材', lines: [['6341', 'D', 'net'], ['1191', 'D', 'tax'], ['1111', 'C', 'total']] },
  { id: 'r-clean', name: '清潔衛生費（含稅）', industries: '餐飲', type: '支出', memo: '清潔衛生費', lines: [['6351', 'D', 'net'], ['1191', 'D', 'tax'], ['1113', 'C', 'total']] },

  // ── 食品：進貨與生產 ──
  { id: 'f-raw', name: '原料進貨－月結（含稅）', industries: '食品製造', type: '轉帳', memo: '原料進貨（月結）', lines: [['5131', 'D', 'net'], ['1191', 'D', 'tax'], ['2131', 'C', 'total']] },
  { id: 'f-raw-cash', name: '原料進貨－付現（含稅）', industries: '食品製造', type: '支出', memo: '原料進貨', lines: [['5131', 'D', 'net'], ['1191', 'D', 'tax'], ['1113', 'C', 'total']] },
  { id: 'f-pack', name: '包材進貨－月結（含稅）', industries: '食品製造', type: '轉帳', memo: '包材進貨（月結）', lines: [['5132', 'D', 'net'], ['1191', 'D', 'tax'], ['2131', 'C', 'total']] },
  { id: 'f-goods', name: '選品商品進貨－月結（含稅）', industries: '食品買賣', type: '轉帳', memo: '商品進貨（月結）', lines: [['5121', 'D', 'net'], ['1191', 'D', 'tax'], ['2131', 'C', 'total']] },
  { id: 'f-factory-util', name: '工廠水電瓦斯（含稅）', industries: '食品製造', type: '支出', memo: '工廠水電瓦斯', lines: [['5152', 'D', 'net'], ['1191', 'D', 'tax'], ['1113', 'C', 'total']] },
  { id: 'f-factory-rent', name: '工廠租金（含稅發票）', industries: '食品製造', type: '支出', memo: '工廠租金', lines: [['5154', 'D', 'net'], ['1191', 'D', 'tax'], ['1113', 'C', 'total']] },
  { id: 'f-line-pay', name: '產線薪資發放', industries: '食品製造', type: '支出', memo: '產線薪資', lines: [['5141', 'D', ''], ['2191', 'C', ''], ['1113', 'C', '']] },
  // ── 食品：銷售與收款 ──
  { id: 'f-sale-own', name: '自製產品銷貨－月結客戶（含稅）', industries: '食品製造', type: '轉帳', memo: '自製產品銷貨', lines: [['1141', 'D', 'total'], ['4111', 'C', 'net'], ['2161', 'C', 'tax']] },
  { id: 'f-sale-goods', name: '選品商品銷貨－月結客戶（含稅）', industries: '食品買賣', type: '轉帳', memo: '商品銷貨', lines: [['1141', 'D', 'total'], ['4112', 'C', 'net'], ['2161', 'C', 'tax']] },
  { id: 'f-ec-own', name: '電商銷售－自製產品（含稅）', industries: '食品製造', type: '轉帳', memo: '電商銷售（自製）', lines: [['1144', 'D', 'total'], ['4111', 'C', 'net'], ['2161', 'C', 'tax']] },
  { id: 'f-ec-goods', name: '電商銷售－選品（含稅）', industries: '食品買賣', type: '轉帳', memo: '電商銷售（選品）', lines: [['1144', 'D', 'total'], ['4112', 'C', 'net'], ['2161', 'C', 'tax']] },
  { id: 'f-ec-pay', name: '電商平台撥款（扣手續費）', industries: '食品製造,食品買賣', type: '轉帳', memo: '電商平台撥款', lines: [['1113', 'D', ''], ['6333', 'D', ''], ['1144', 'C', '']] },
  { id: 'f-preorder', name: '預購先收款', industries: '食品製造,食品買賣', type: '收入', memo: '預購收款', lines: [['1113', 'D', 'total'], ['2181', 'C', 'total']] },
  { id: 'f-ship', name: '出貨運費（含稅）', industries: '食品製造,食品買賣', type: '支出', memo: '出貨運費', lines: [['6151', 'D', 'net'], ['1191', 'D', 'tax'], ['1113', 'C', 'total']] },
  { id: 'f-test', name: '食品檢驗費（含稅）', industries: '食品製造,食品買賣', type: '支出', memo: '食品檢驗費', lines: [['6391', 'D', 'net'], ['1191', 'D', 'tax'], ['1113', 'C', 'total']] },

  // ── 通用 ──
  { id: 'g-collect', name: '收回客戶貨款', industries: '通用', type: '收入', memo: '收回貨款', lines: [['1113', 'D', 'total'], ['1141', 'C', 'total']] },
  { id: 'g-pay-ap', name: '支付月結貨款', industries: '通用', type: '支出', memo: '支付月結貨款', lines: [['2131', 'D', 'total'], ['1113', 'C', 'total']] },
  { id: 'g-rent', name: '店租／辦公室租金（含稅發票）', industries: '通用', type: '支出', memo: '租金', lines: [['6121', 'D', 'net'], ['1191', 'D', 'tax'], ['1113', 'C', 'total']] },
  { id: 'g-rent-person', name: '租金（房東個人，無發票）', industries: '通用', type: '支出', memo: '租金', lines: [['6121', 'D', 'total'], ['1113', 'C', 'total']] },
  { id: 'g-util', name: '水電瓦斯（含稅）', industries: '通用', type: '支出', memo: '水電瓦斯', lines: [['6191', 'D', 'net'], ['1191', 'D', 'tax'], ['1113', 'C', 'total']] },
  { id: 'g-phone', name: '電話網路費（含稅）', industries: '通用', type: '支出', memo: '電話網路費', lines: [['6161', 'D', 'net'], ['1191', 'D', 'tax'], ['1113', 'C', 'total']] },
  { id: 'g-pos', name: 'POS／軟體月租（含稅）', industries: '通用', type: '支出', memo: '軟體月租', lines: [['6371', 'D', 'net'], ['1191', 'D', 'tax'], ['1113', 'C', 'total']] },
  { id: 'g-salary', name: '薪資發放（扣員工自付勞健保）', industries: '通用', type: '支出', memo: '薪資', lines: [['6111', 'D', ''], ['6112', 'D', ''], ['2191', 'C', ''], ['1113', 'C', '']] },
  { id: 'g-insurance', name: '勞健保繳款（公司＋員工自付）', industries: '通用', type: '支出', memo: '勞健保', lines: [['6201', 'D', ''], ['2191', 'D', ''], ['1113', 'C', '']] },
  { id: 'g-pension', name: '勞退提撥', industries: '通用', type: '支出', memo: '勞退提撥', lines: [['6311', 'D', 'total'], ['1113', 'C', 'total']] },
  { id: 'g-petty', name: '零用金支付雜支', industries: '通用', type: '支出', memo: '雜支', lines: [['6399', 'D', 'total'], ['1112', 'C', 'total']] },
  { id: 'g-petty-fill', name: '零用金撥補', industries: '通用', type: '轉帳', memo: '零用金撥補', lines: [['1112', 'D', 'total'], ['1113', 'C', 'total']] },
  { id: 'g-cash-deposit', name: '現金存入銀行', industries: '通用', type: '轉帳', memo: '現金存入銀行', lines: [['1113', 'D', 'total'], ['1111', 'C', 'total']] },
  { id: 'g-owner-paid', name: '股東代墊費用', industries: '通用', type: '轉帳', memo: '股東代墊', lines: [['6399', 'D', 'total'], ['2193', 'C', 'total']] },
  { id: 'g-entertain', name: '交際費（進項不得扣抵）', industries: '通用', type: '支出', memo: '交際費', lines: [['6211', 'D', 'total'], ['1113', 'C', 'total']] },
  { id: 'g-staff-meal', name: '員工伙食', industries: '通用', type: '支出', memo: '員工伙食', lines: [['6271', 'D', 'total'], ['1111', 'C', 'total']] },
  { id: 'g-vat', name: '營業稅繳納（銷項 − 進項）', industries: '通用', type: '支出', memo: '營業稅繳納', lines: [['2161', 'D', ''], ['1191', 'C', ''], ['1113', 'C', '']] },
  { id: 'g-account-fee', name: '記帳／會計師公費', industries: '通用', type: '支出', memo: '記帳費', lines: [['6321', 'D', 'total'], ['1113', 'C', 'total']] }
];

/** 依公司產業與已啟用科目，挑出可用的範本 */
function templatesFor_(industries, accounts) {
  var inds = (industries || []).concat(['通用']);
  var enabled = {};
  accounts.forEach(function (a) { if (a.enabled) enabled[a.code] = a; });
  return VOUCHER_TEMPLATES.filter(function (t) {
    var ok = t.industries.split(',').some(function (i) { return inds.indexOf(i) >= 0; });
    return ok && t.lines.every(function (l) { return enabled[l[0]]; });
  }).map(function (t) {
    var split = t.lines.some(function (l) { return l[2] === 'net' || l[2] === 'tax'; });
    var single = !split && t.lines.every(function (l) { return l[2] === 'total'; });
    return {
      id: t.id, name: t.name, type: t.type, memo: t.memo, industries: t.industries,
      amountMode: split ? 'tax' : single ? 'single' : 'manual',
      lines: t.lines.map(function (l) { return { code: l[0], side: l[1], part: l[2] }; })
    };
  });
}

/** 含稅金額拆未稅與稅額（5%） */
function splitTax_(total) {
  var net = Math.round(total / 1.05);
  return { net: net, tax: total - net };
}

/** 依範本與金額產生分錄（測試與前端共用相同規則） */
function applyTemplate_(tpl, amount) {
  var parts = tpl.amountMode === 'tax' ? splitTax_(amount) : { net: amount, tax: 0 };
  return tpl.lines.map(function (l) {
    var v = l.part === 'total' ? amount : l.part === 'net' ? parts.net : l.part === 'tax' ? parts.tax : 0;
    return { code: l.code, debit: l.side === 'D' ? v : 0, credit: l.side === 'C' ? v : 0 };
  });
}
