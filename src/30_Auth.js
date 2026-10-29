/**
 * 帳號、登入、權限
 * 密碼只存 SHA-256(鹽|密碼)，不存明碼；登入憑證放 CacheService 6 小時
 */
function hashPassword_(salt, password) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password, Utilities.Charset.UTF_8);
  return bytesToHex_(bytes);
}

function newSalt_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

/** 隨機臨時密碼：10 碼英數（排除易混淆字元） */
function randomPassword_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var uuid = Utilities.getUuid().replace(/-/g, '');
  var out = '';
  for (var i = 0; i < 10; i++) out += chars.charAt(parseInt(uuid.substr(i * 3, 3), 16) % chars.length);
  return out;
}

function validatePasswordStrength_(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return '密碼至少 8 碼';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '密碼需同時包含英文與數字';
  return '';
}

function loadUsers_() {
  return readObjects_(SHEETS.USERS).map(function (o) {
    return {
      username: str_(o['帳號']), name: str_(o['姓名']), role: str_(o['角色']),
      salt: str_(o['鹽']), hash: str_(o['密碼雜湊']),
      enabled: str_(o['啟用']) !== '否', createdAt: str_(o['建立時間']), lastLogin: str_(o['最後登入']), _row: o._row
    };
  }).filter(function (u) { return u.username; });
}

function findUser_(username) {
  var key = str_(username).toLowerCase();
  return loadUsers_().filter(function (u) { return u.username.toLowerCase() === key; })[0] || null;
}

/**
 * 登入防護（Apps Script 取不到訪客 IP，因此分兩層）：
 *  1. 同一個瀏覽器（clientId）錯 5 次 → 這個瀏覽器鎖 10 分鐘
 *  2. 同一帳號 10 分鐘內全站錯超過 20 次 → 之後每次嘗試延遲 3 秒（減緩猜密碼，但不擋正確密碼，避免被惡意鎖住帳號）
 */
function login(username, password, clientId) {
  try {
    var cache = CacheService.getScriptCache();
    var user = str_(username).toLowerCase();
    var cid = str_(clientId).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
    var u = findUser_(username);
    // 鎖定計數綁定目前的密碼版本：密碼被重設後，舊的錯誤次數自動歸零
    var ver = u ? credTag_(u) : 'none';
    var key = 'fail_' + user + '_' + cid + '_' + ver;
    var gkey = 'gfail_' + user + '_' + ver;
    var fails = Number(cache.get(key)) || 0;
    var gfails = Number(cache.get(gkey)) || 0;
    if (fails >= LOGIN_MAX_FAILS) return { ok: false, error: '密碼錯誤次數過多，請 10 分鐘後再試（或請管理者重設密碼）' };
    if (gfails >= LOGIN_GLOBAL_SLOWDOWN) Utilities.sleep(3000);
    if (!u || !u.enabled || hashPassword_(u.salt, String(password || '')) !== u.hash) {
      cache.put(key, String(fails + 1), LOGIN_LOCK_SECONDS);
      cache.put(gkey, String(gfails + 1), LOGIN_LOCK_SECONDS);
      return { ok: false, error: '帳號或密碼錯誤' };
    }
    cache.remove(key);
    var issued = issueSession_(u);
    updateCells_(SHEETS.USERS, u._row, { '最後登入': nowText_() });
    log_(u.username, '登入', '');
    return { ok: true, data: issued };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 憑證版本：密碼一改，雜湊就變，舊的登入憑證全部失效 */
function credTag_(u) {
  return u.hash.slice(0, 16);
}

function issueSession_(u) {
  var token = Utilities.getUuid();
  var session = { username: u.username, name: u.name, role: u.role, cred: credTag_(u) };
  CacheService.getScriptCache().put('tok_' + token, JSON.stringify(session), SESSION_SECONDS);
  return { token: token, user: { username: u.username, name: u.name, role: u.role } };
}

function logout(token) {
  CacheService.getScriptCache().remove('tok_' + token);
  return { ok: true };
}

function sessionFromToken_(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get('tok_' + token);
  if (!raw) return null;
  var s = JSON.parse(raw);
  // 每次確認帳號仍啟用、角色以帳號表為準（改權限立即生效）
  var u = findUser_(s.username);
  if (!u || !u.enabled || s.cred !== credTag_(u)) return null;
  return { username: u.username, name: u.name, role: u.role };
}

function can_(role, action) {
  var allowed = PERMISSIONS[action];
  return !!allowed && allowed.indexOf(role) >= 0;
}

/** 新增帳號（回傳臨時密碼，只顯示一次） */
function createUser_(username, name, role) {
  username = str_(username);
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) throw new Error('帳號需為 3～30 碼英數字');
  if (ROLES.indexOf(role) < 0) throw new Error('角色不正確');
  if (findUser_(username)) throw new Error('帳號 ' + username + ' 已存在');
  var salt = newSalt_();
  var pw = randomPassword_();
  appendObjects_(SHEETS.USERS, [{
    '帳號': username, '姓名': str_(name) || username, '角色': role, '鹽': salt,
    '密碼雜湊': hashPassword_(salt, pw), '啟用': '是', '建立時間': nowText_(), '最後登入': ''
  }]);
  return pw;
}

function setPassword_(user, newPassword) {
  var salt = newSalt_();
  updateCells_(SHEETS.USERS, user._row, { '鹽': salt, '密碼雜湊': hashPassword_(salt, newPassword) });
}
