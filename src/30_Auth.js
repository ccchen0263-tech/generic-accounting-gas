/**
 * 帳號、登入、權限
 * 密碼不存明碼。雜湊格式：
 *   舊版（v1）：SHA-256(鹽|密碼) 的 64 碼十六進位
 *   新版（v2）：「v2$次數$雜湊」＝ v1 結果再反覆 SHA-256 共「次數」次（PW_ITERATIONS）
 * 舊版雜湊照樣可以登入，登入成功時自動改存新版（使用者不用做任何事）。
 * 登入憑證放 CacheService 6 小時。
 */
function hashPassword_(salt, password) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password, Utilities.Charset.UTF_8);
  return bytesToHex_(bytes);
}

function hashPasswordV2_(salt, password, iterations) {
  var h = hashPassword_(salt, password);
  for (var i = 1; i < iterations; i++) {
    h = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + '|' + salt, Utilities.Charset.UTF_8));
  }
  return 'v2$' + iterations + '$' + h;
}

/** 新密碼一律用新版雜湊 */
function makePasswordHash_(salt, password) {
  return hashPasswordV2_(salt, password, PW_ITERATIONS);
}

/** 檢查密碼；upgrade = 密碼正確但雜湊是舊版或次數不同，應改存新版 */
function verifyPassword_(u, password) {
  var stored = str_(u && u.hash);
  var m = /^v2\$(\d{1,6})\$([0-9a-f]{64})$/.exec(stored);
  if (m) {
    var it = Number(m[1]);
    if (it < 1 || it > 200000) return { ok: false, upgrade: false };
    var ok2 = hashPasswordV2_(u.salt, password, it) === stored;
    return { ok: ok2, upgrade: ok2 && it !== PW_ITERATIONS };
  }
  if (/^[0-9a-f]{64}$/.test(stored)) {
    var ok1 = hashPassword_(u.salt, password) === stored;
    return { ok: ok1, upgrade: ok1 };
  }
  return { ok: false, upgrade: false };
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
 *  2. 同一個帳號不分瀏覽器錯 10 次 → 這個帳號暫停登入 15 分鐘（換瀏覽器代號也繞不過）
 *     管理者「重設密碼」後立即解除（計數綁定密碼版本）
 * 錯誤次數在鎖內累加，避免同時多次嘗試時計數被覆蓋。
 */
function login(username, password, clientId) {
  try {
    var cache = CacheService.getScriptCache();
    var user = str_(username).toLowerCase().slice(0, 60);
    var cid = str_(clientId).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
    var u = findUser_(username);
    // 鎖定計數綁定目前的密碼版本：密碼被重設後，舊的錯誤次數自動歸零
    var ver = u ? credTag_(u) : 'none';
    var key = 'fail_' + user + '_' + cid + '_' + ver;
    var ukey = 'ufail_' + user + '_' + ver;
    if ((Number(cache.get(ukey)) || 0) >= LOGIN_USER_MAX_FAILS) return { ok: false, error: '這個帳號密碼錯誤次數過多，已暫停登入 15 分鐘；請稍後再試，或請集團管理者重設密碼（重設後立即解除）' };
    if ((Number(cache.get(key)) || 0) >= LOGIN_MAX_FAILS) return { ok: false, error: '密碼錯誤次數過多，請 10 分鐘後再試（或請管理者重設密碼）' };
    var pw = String(password || '');
    var check = u && u.enabled ? verifyPassword_(u, pw) : null;
    if (!u) makePasswordHash_('x', pw); // 帳號不存在也花一樣的時間，避免從回應速度猜出帳號
    if (!check || !check.ok) {
      withLock_(function () {
        cache.put(key, String((Number(cache.get(key)) || 0) + 1), LOGIN_LOCK_SECONDS);
        cache.put(ukey, String((Number(cache.get(ukey)) || 0) + 1), LOGIN_USER_LOCK_SECONDS);
      });
      return { ok: false, error: '帳號或密碼錯誤' };
    }
    cache.remove(key);
    cache.remove(ukey);
    var patch = { '最後登入': nowText_() };
    if (check.upgrade) {
      // 舊版雜湊 → 新版：在鎖內重新讀取，確認密碼沒有剛好被別人改掉才寫入
      u = withLock_(function () {
        var fresh = findUser_(username);
        if (!fresh || fresh.hash !== u.hash) return fresh || u;
        var salt = newSalt_();
        fresh.salt = salt;
        fresh.hash = makePasswordHash_(salt, pw);
        updateCells_(SHEETS.USERS, fresh._row, { '鹽': fresh.salt, '密碼雜湊': fresh.hash, '最後登入': patch['最後登入'] });
        patch = null;
        return fresh;
      });
    }
    if (patch) updateCells_(SHEETS.USERS, u._row, patch);
    var issued = issueSession_(u);
    log_(u.username, '登入', check.upgrade ? '密碼雜湊已升級' : '');
    return { ok: true, data: issued };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 憑證版本：密碼一改，雜湊就變，舊的登入憑證全部失效 */
function credTag_(u) {
  return String(u.hash).split('$').pop().slice(0, 16);
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
  return { username: u.username, name: u.name, groupRole: u.role === '管理者' ? '管理者' : '成員' };
}

function can_(role, action) {
  var allowed = PERMISSIONS[action];
  return !!allowed && allowed.indexOf(role) >= 0;
}

/** 新增帳號（回傳臨時密碼，只顯示一次）；role 為集團身分：管理者／成員 */
function createUser_(username, name, role) {
  username = str_(username);
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) throw new Error('帳號需為 3～30 碼英數字');
  if (GROUP_ROLES.indexOf(role) < 0) throw new Error('身分不正確');
  if (findUser_(username)) throw new Error('帳號 ' + username + ' 已存在');
  var salt = newSalt_();
  var pw = randomPassword_();
  appendObjects_(SHEETS.USERS, [{
    '帳號': username, '姓名': str_(name) || username, '角色': role, '鹽': salt,
    '密碼雜湊': makePasswordHash_(salt, pw), '啟用': '是', '建立時間': nowText_(), '最後登入': ''
  }]);
  return pw;
}

function setPassword_(user, newPassword) {
  var salt = newSalt_();
  updateCells_(SHEETS.USERS, user._row, { '鹽': salt, '密碼雜湊': makePasswordHash_(salt, newPassword) });
}
