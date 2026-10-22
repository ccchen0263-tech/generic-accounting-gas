/**
 * 測試用：模擬 Google Apps Script 的試算表與服務（Node 與瀏覽器都能用）
 * 只實作本系統用到的方法；超出範圍的 getRange 會丟錯，與真實試算表一致。
 */
(function (root) {
  function sha256Bytes(str) {
    // UTF-8 編碼
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      }
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var s = 56; s >= 0; s -= 8) bytes.push(s >= 32 ? Math.floor(l / Math.pow(2, s)) & 255 : (l >>> s) & 255);
    var W = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (var t = 0; t < 16; t++) W[t] = (bytes[off + 4 * t] << 24) | (bytes[off + 4 * t + 1] << 16) | (bytes[off + 4 * t + 2] << 8) | bytes[off + 4 * t + 3];
      for (t = 16; t < 64; t++) {
        var x = W[t - 15], y = W[t - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c3 = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c3) ^ (b & c3);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c3; c3 = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c3) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = [];
    H.forEach(function (v) { for (var k = 24; k >= 0; k -= 8) { var b8 = (v >>> k) & 255; out.push(b8 > 127 ? b8 - 256 : b8); } });
    return out;
  }

  function FakeRange(sheet, r, c, nr, nc) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('範圍不正確');
    if (r + nr - 1 > sheet.maxRows || c + nc - 1 > sheet.maxCols) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    this.getValues = function () {
      var out = [];
      for (var i = 0; i < nr; i++) {
        var row = [];
        for (var j = 0; j < nc; j++) {
          var v = (sheet.data[r - 1 + i] || [])[c - 1 + j];
          row.push(v === undefined ? '' : v);
        }
        out.push(row);
      }
      return out;
    };
    this.setValues = function (vals) {
      if (vals.length !== nr || vals[0].length !== nc) throw new Error('資料大小與範圍不符');
      for (var i = 0; i < nr; i++) {
        var rowIdx = r - 1 + i;
        while (sheet.data.length <= rowIdx) sheet.data.push([]);
        for (var j = 0; j < nc; j++) sheet.data[rowIdx][c - 1 + j] = vals[i][j];
      }
      return this;
    };
    this.clearContent = function () {
      for (var i = 0; i < nr; i++) {
        var row = sheet.data[r - 1 + i];
        if (!row) continue;
        for (var j = 0; j < nc; j++) row[c - 1 + j] = '';
      }
      return this;
    };
    this.setNumberFormat = function () { return this; };
    this.setFontWeight = function () { return this; };
    this.setBackground = function () { return this; };
  }

  function FakeSheet(name) {
    var self = this;
    this.name = name;
    this.data = [];
    this.maxRows = 1000;
    this.maxCols = 26;
    this.hidden = false;
    function lastRow() {
      for (var i = self.data.length - 1; i >= 0; i--) {
        if ((self.data[i] || []).some(function (v) { return v !== '' && v !== undefined && v !== null; })) return i + 1;
      }
      return 0;
    }
    this.getName = function () { return name; };
    this.getLastRow = lastRow;
    this.getLastColumn = function () {
      var max = 0;
      self.data.forEach(function (row) {
        for (var j = row.length - 1; j >= 0; j--) { if (row[j] !== '' && row[j] !== undefined && row[j] !== null) { if (j + 1 > max) max = j + 1; break; } }
      });
      return max;
    };
    this.getMaxRows = function () { return self.maxRows; };
    this.getMaxColumns = function () { return self.maxCols; };
    this.getRange = function (r, c, nr, nc) { return new FakeRange(self, r, c, nr || 1, nc || 1); };
    this.deleteRows = function (start, n) { self.data.splice(start - 1, n); self.maxRows -= n; };
    this.insertRowsAfter = function (after, n) { self.maxRows += n; };
    this.insertColumnsAfter = function (after, n) { self.maxCols += n; };
    this.clearContents = function () { self.data = []; return self; };
    this.hideSheet = function () { self.hidden = true; return self; };
    this.setFrozenRows = function () { return self; };
  }

  function FakeSpreadsheet() {
    var sheets = {};
    var self = this;
    this.sheets = sheets;
    this.getId = function () { return 'fake-spreadsheet-id'; };
    this.getSheetByName = function (n) { return sheets[n] || null; };
    this.insertSheet = function (n) { if (sheets[n]) throw new Error('工作表已存在'); sheets[n] = new FakeSheet(n); return sheets[n]; };
    this.getSheets = function () { return Object.keys(sheets).map(function (k) { return sheets[k]; }); };
  }

  function createFakeGas(options) {
    options = options || {};
    var ss = new FakeSpreadsheet();
    var props = {};
    var cache = {};
    var logs = [];
    var clock = { now: options.now || null };
    var uuidCounter = 0;
    var session = { email: options.email === undefined ? 'owner@example.com' : options.email, effective: 'owner@example.com' };

    function nowDate() { return clock.now ? new Date(clock.now) : new Date(); }

    function formatDate(date, tz, fmt) {
      // 台北時間固定 UTC+8
      var d = new Date(date.getTime() + 8 * 3600000);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return fmt.replace('yyyy', d.getUTCFullYear()).replace('MM', p(d.getUTCMonth() + 1)).replace('dd', p(d.getUTCDate()))
        .replace('HH', p(d.getUTCHours())).replace('mm', p(d.getUTCMinutes())).replace('ss', p(d.getUTCSeconds()));
    }

    var env = {
      SpreadsheetApp: {
        getActiveSpreadsheet: function () { return ss; },
        openById: function () { return ss; },
        getUi: function () { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); }
      },
      PropertiesService: {
        getScriptProperties: function () {
          return {
            getProperty: function (k) { return props.hasOwnProperty(k) ? props[k] : null; },
            setProperty: function (k, v) { props[k] = String(v); return this; }
          };
        }
      },
      CacheService: {
        getScriptCache: function () {
          return {
            get: function (k) { return cache.hasOwnProperty(k) ? cache[k] : null; },
            put: function (k, v) { cache[k] = String(v); },
            remove: function (k) { delete cache[k]; }
          };
        }
      },
      LockService: {
        getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; }
      },
      Utilities: {
        DigestAlgorithm: { SHA_256: 'SHA_256' },
        Charset: { UTF_8: 'UTF_8' },
        computeDigest: function (alg, str) { return sha256Bytes(str); },
        getUuid: function () {
          uuidCounter++;
          var hex = '';
          for (var i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
          return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
        },
        formatDate: function (date, tz, fmt) { return formatDate(date, tz, fmt); }
      },
      Logger: { log: function (m) { logs.push(String(m)); } },
      Session: {
        getActiveUser: function () { return { getEmail: function () { return session.email; } }; },
        getEffectiveUser: function () { return { getEmail: function () { return session.effective; } }; }
      },
      HtmlService: {},
      // 測試輔助
      __ss: ss, __props: props, __cache: cache, __logs: logs, __clock: clock, __sha256: sha256Bytes,
      __nowDate: nowDate, __session: session
    };
    // 讓 new Date() 也能固定時間：測試透過 Utilities.formatDate(new Date()) 取得今天，因此改寫 formatDate 的輸入
    var realFormat = env.Utilities.formatDate;
    env.Utilities.formatDate = function (date, tz, fmt) {
      if (clock.now && Math.abs(date.getTime() - Date.now()) < 5000) date = new Date(clock.now);
      return realFormat(date, tz, fmt);
    };
    return env;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createFakeGas: createFakeGas, sha256Bytes: sha256Bytes };
  else root.createFakeGas = createFakeGas;
})(this);
