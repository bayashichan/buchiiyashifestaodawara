/**
 * GAS の実行環境を模した検証用ハーネス。
 *
 * Apps Script はデプロイしないと動かせないため、SpreadsheetApp などの
 * グローバルをメモリ上の実装に差し替えて、gas/*.gs をそのまま読み込みます。
 * これで「動的ヘッダー生成」「列の後方追加」「メール文面の差し込み」
 * 「リピーター照合」といった壊れやすい部分をデプロイ前に確認できます。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GAS_DIR = path.join(__dirname, '..');

// 読み込み順（GAS は全ファイルが同じグローバルを共有する）
const FILES = [
  'pricing.gs', 'config.gs', 'sheets.gs', 'drive.gs',
  'mailer.gs', 'repeater.gs', 'setup.gs', 'migrate.gs',
  'admin.gs', 'code.gs'
];

// ========================================
// スプレッドシートの模擬実装
// ========================================
class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numCols; c++) {
        row.push(this.sheet._cell(this.row + r, this.col + c));
      }
      out.push(row);
    }
    return out;
  }
  setValues(values) {
    values.forEach((row, r) => row.forEach((v, c) => {
      this.sheet._set(this.row + r, this.col + c, v);
    }));
    return this;
  }
  setValue(v) { this.sheet._set(this.row, this.col, v); return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.hidden = false; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  hideSheet() { this.hidden = true; return this; }

  _cell(r, c) {
    const row = this.data[r - 1];
    const v = row ? row[c - 1] : '';
    return v === undefined ? '' : v;
  }
  _set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }

  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  appendRow(values) { this.data.push(values.slice()); return this; }
  getRange(row, col, numRows = 1, numCols = 1) {
    return new FakeRange(this, row, col, numRows, numCols);
  }
  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
  setFrozenRows() { return this; }
  clear() { this.data = []; return this; }
}

class FakeSpreadsheet {
  constructor(id, name) { this.id = id; this.name = name; this.sheets = []; }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
}

// ========================================
// ハーネス本体
// ========================================
function createHarness(options = {}) {
  const spreadsheets = new Map();
  const cache = new Map();
  const properties = new Map(Object.entries(options.properties || {}));
  const sentMail = [];
  const createdFolders = [];
  let quota = options.quota === undefined ? 100 : options.quota;
  let idCounter = 0;

  const newSpreadsheet = (name) => {
    const id = 'SS_' + (++idCounter);
    const ss = new FakeSpreadsheet(id, name);
    ss.insertSheet('シート1');
    spreadsheets.set(id, ss);
    return ss;
  };

  const sandbox = {
    console,
    Object, Array, JSON, Math, Date, String, Number, Boolean, RegExp, Error,
    isNaN, parseInt, parseFloat, isFinite, encodeURIComponent, decodeURIComponent,

    SpreadsheetApp: {
      create: (name) => newSpreadsheet(name),
      openById: (id) => {
        const ss = spreadsheets.get(id);
        if (!ss) throw new Error('スプレッドシートが見つかりません: ' + id);
        return ss;
      }
    },

    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (properties.has(k) ? properties.get(k) : null),
        setProperty: (k, v) => properties.set(k, v),
        deleteProperty: (k) => properties.delete(k)
      })
    },

    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => cache.set(k, v),
        remove: (k) => cache.delete(k)
      })
    },

    MailApp: {
      getRemainingDailyQuota: () => quota,
      sendEmail: (opts) => {
        if (quota <= 0) throw new Error('quota exceeded');
        quota--;
        sentMail.push(opts);
      }
    },

    UrlFetchApp: {
      fetch: (url, params) => {
        const handler = options.fetchHandler;
        const res = handler ? handler(url, params) : { code: 200, text: '{}' };
        return {
          getResponseCode: () => res.code,
          getContentText: () => res.text
        };
      }
    },

    Utilities: {
      formatDate: (d, tz, fmt) => {
        const pad = (n) => String(n).padStart(2, '0');
        const dt = new Date(d);
        return fmt
          .replace('yyyy', dt.getUTCFullYear())
          .replace('MM', pad(dt.getUTCMonth() + 1))
          .replace('dd', pad(dt.getUTCDate()))
          .replace('HH', pad(dt.getUTCHours()))
          .replace('mm', pad(dt.getUTCMinutes()))
          .replace('ss', pad(dt.getUTCSeconds()))
          .replace('M/d', (dt.getUTCMonth() + 1) + '/' + dt.getUTCDate());
      },
      base64Encode: (s) => Buffer.from(String(s), 'utf8').toString('base64'),
      base64Decode: (s) => Array.from(Buffer.from(String(s), 'base64')),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
      sleep: () => {},
      Charset: { UTF_8: 'utf8' }
    },

    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' },
      getFolderById: (id) => makeFolder(id, 'root'),
      getFilesByName: () => ({ hasNext: () => false, next: () => null })
    },

    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },

    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({
        timeBased: () => ({
          atHour: () => ({ everyDays: () => ({ create: () => {} }) })
        })
      })
    },

    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text) => ({
        setMimeType: () => ({ getContent: () => text, _text: text })
      })
    }
  };

  function makeFolder(id, name) {
    return {
      getId: () => id,
      getName: () => name,
      getUrl: () => 'https://drive.google.com/drive/folders/' + id,
      getFoldersByName: (n) => {
        const found = createdFolders.find(f => f.name === n);
        return { hasNext: () => !!found, next: () => makeFolder(found?.id, n) };
      },
      createFolder: (n) => {
        const f = { id: 'FOLDER_' + (++idCounter), name: n };
        createdFolders.push(f);
        return makeFolder(f.id, n);
      },
      createFile: () => ({
        getId: () => 'FILE_' + (++idCounter),
        setSharing: () => {}
      }),
      setSharing: () => {}
    };
  }

  const context = vm.createContext(sandbox);
  for (const file of FILES) {
    const src = fs.readFileSync(path.join(GAS_DIR, file), 'utf8');
    vm.runInContext(src, context, { filename: file });
  }

  return {
    ctx: sandbox,
    spreadsheets,
    properties,
    cache,
    sentMail,
    createdFolders,
    newSpreadsheet,
    setQuota: (n) => { quota = n; },
    getQuota: () => quota,
    /** ContentService の戻り値から JSON を取り出す */
    readResponse: (res) => JSON.parse(res._text !== undefined ? res._text : res.getContent())
  };
}

module.exports = { createHarness, FakeSheet, FakeSpreadsheet };
