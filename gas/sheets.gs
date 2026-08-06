/**
 * スプレッドシートへの保存
 *
 * ヘッダーは config の fields[] と pricing.options[] から動的に生成します。
 * 列を固定配列で書くと、管理者が項目を1つ増やしただけで全部ずれるためです。
 *
 * 書き込みは常に「ヘッダー名 → 値」の対応で行い、列の位置に依存しません。
 * 項目を後から追加した場合は ensureColumns が不足列を末尾に足します。
 *
 * _meta シート（非表示）に「列ラベル ↔ fieldId」の対応を保存します。
 * リピーター照合はこの対応を使うため、管理者が項目名を変えても壊れません。
 */

/** 運営が手で埋める列。申込データの前後に置く */
var LEADING_COLUMN_EVENT  = '座席番号';   // 今回イベント用
var LEADING_COLUMN_MASTER = '開催回';     // マスターDB用
var TRAILING_COLUMNS = ['合計金額', 'スタッフメモ', '入金確認', '入金日'];

/**
 * ヘッダー行を組み立てる。
 * @param {Object} cfg    正規化済み config
 * @param {Object} opts   { isMaster: boolean }
 * @returns {Object} { labels: [...], keys: [...] }  keys は列の識別子（fieldId 等）
 */
function buildHeaderRow(cfg, opts) {
  opts = opts || {};
  var labels = [];
  var keys = [];

  var push = function (label, key) { labels.push(label); keys.push(key); };

  push(opts.isMaster ? LEADING_COLUMN_MASTER : LEADING_COLUMN_EVENT,
       opts.isMaster ? '__eventName' : '__seat');
  push('申込日時', '__submittedAt');

  // 申込項目（並び順は config のまま）
  (cfg.fields || []).forEach(function (f) {
    if (DISPLAY_ONLY_TYPES.indexOf(f.type) >= 0) return;
    push(f.label || f.id, f.id);
  });

  // オプション（有効なものだけ）
  (cfg.pricing && cfg.pricing.options || []).forEach(function (o) {
    if (o.enabled === false) return;
    push(o.label || o.id, 'opt:' + o.id);
  });

  if (cfg.pricing && cfg.pricing.memberDiscount && cfg.pricing.memberDiscount.enabled) {
    push(cfg.pricing.memberDiscount.label || '会員割引', '__isMember');
  }

  push('早割適用', '__isEarlyBird');
  TRAILING_COLUMNS.forEach(function (label) { push(label, '__' + label); });
  push('LINEユーザーID', '__lineUserId');
  push('LINE表示名', '__lineDisplayName');

  return { labels: labels, keys: keys };
}

/**
 * シートを用意し、ヘッダーと _meta を最新にする。
 * 既存シートに足りない列があれば末尾に追加する（既存データは壊さない）。
 */
function ensureSheet(spreadsheetId, cfg, opts) {
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(SHEET_NAME);
  var header = buildHeaderRow(cfg, opts);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(header.labels);
    sheet.setFrozenRows(1);
    styleHeader(sheet, header.labels.length);
    writeMeta(ss, header, cfg);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header.labels);
    sheet.setFrozenRows(1);
    styleHeader(sheet, header.labels.length);
    writeMeta(ss, header, cfg);
    return sheet;
  }

  ensureColumns(sheet, ss, header, cfg);
  return sheet;
}

/** 既存ヘッダーに無い列を末尾へ追加する */
function ensureColumns(sheet, ss, header, cfg) {
  var existing = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
                      .getValues()[0]
                      .map(function (v) { return String(v); });

  var missing = [];
  header.labels.forEach(function (label) {
    if (existing.indexOf(label) < 0) missing.push(label);
  });

  if (missing.length) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    styleHeader(sheet, existing.length + missing.length);
    console.log('ヘッダーに列を追加しました: ' + missing.join(', '));
  }

  writeMeta(ss, header, cfg);
}

function styleHeader(sheet, columnCount) {
  var range = sheet.getRange(1, 1, 1, columnCount);
  range.setFontWeight('bold');
  range.setBackground('#374151');
  range.setFontColor('#ffffff');
  tryOrLog('autoResizeColumns', function () {
    sheet.autoResizeColumns(1, columnCount);
  });
}

/**
 * 列ラベルと fieldId の対応を _meta シートに残す。
 * 管理者が項目名を変更しても、リピーター照合が fieldId で引けるようにするため。
 */
function writeMeta(ss, header, cfg) {
  var meta = ss.getSheetByName(META_SHEET_NAME);
  if (!meta) {
    meta = ss.insertSheet(META_SHEET_NAME);
    meta.hideSheet();
  }
  meta.clear();

  var rows = [['key', 'label']];
  for (var i = 0; i < header.keys.length; i++) {
    rows.push([header.keys[i], header.labels[i]]);
  }
  meta.getRange(1, 1, rows.length, 2).setValues(rows);

  // 参考情報（人が見て分かるように）
  meta.getRange(1, 4, 3, 2).setValues([
    ['schemaVersion', String(cfg.schemaVersion || '')],
    ['eventName', String((cfg.event || {}).name || '')],
    ['updatedAt', nowJst()]
  ]);
}

/** _meta から key -> label の対応を読む。無ければ null */
function readMeta(spreadsheetId) {
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var meta = ss.getSheetByName(META_SHEET_NAME);
    if (!meta || meta.getLastRow() < 2) return null;

    var values = meta.getRange(2, 1, meta.getLastRow() - 1, 2).getValues();
    var keyToLabel = {};
    var labelToKey = {};
    values.forEach(function (r) {
      if (!r[0]) return;
      keyToLabel[r[0]] = r[1];
      labelToKey[r[1]] = r[0];
    });
    return { keyToLabel: keyToLabel, labelToKey: labelToKey };
  } catch (e) {
    console.warn('readMeta failed: ' + e.message);
    return null;
  }
}

/**
 * 申込1件を保存する。
 * ヘッダー行を読んでその順に値を並べるので、列の増減や並び替えに影響されない。
 */
function appendSubmission(spreadsheetId, cfg, record, opts) {
  opts = opts || {};
  var sheet = ensureSheet(spreadsheetId, cfg, opts);

  var headerLabels = sheet.getRange(1, 1, 1, sheet.getLastColumn())
                          .getValues()[0]
                          .map(function (v) { return String(v); });

  var header = buildHeaderRow(cfg, opts);
  var valueByLabel = {};
  for (var i = 0; i < header.keys.length; i++) {
    valueByLabel[header.labels[i]] = valueForKey(header.keys[i], record, cfg, opts);
  }

  var row = headerLabels.map(function (label) {
    return (label in valueByLabel) ? valueByLabel[label] : '';
  });

  sheet.appendRow(row);
  return sheet.getLastRow();
}

/** 列の識別子から書き込む値を決める */
function valueForKey(key, record, cfg, opts) {
  if (key === '__seat') return '';                       // 運営が後で記入
  if (key === '__eventName') return record.eventName || '';
  if (key === '__submittedAt') return record.submittedAt || nowJst();
  if (key === '__isMember') return record.isMember ? 'はい' : 'いいえ';
  if (key === '__isEarlyBird') return record.isEarlyBird ? '適用' : '—';
  if (key === '__合計金額') return record.total;
  if (key === '__スタッフメモ' || key === '__入金確認' || key === '__入金日') return '';
  if (key === '__lineUserId') return record.lineUserId || '';
  if (key === '__lineDisplayName') return record.lineDisplayName || '';

  if (key.indexOf('opt:') === 0) {
    return formatOptionValue(key.slice(4), record, cfg);
  }

  // 通常の申込項目
  var v = record.answers ? record.answers[key] : '';
  return formatAnswer(v);
}

function formatOptionValue(optionId, record, cfg) {
  var opts = (cfg.pricing && cfg.pricing.options) || [];
  var def = null;
  for (var i = 0; i < opts.length; i++) {
    if (opts[i].id === optionId) { def = opts[i]; break; }
  }
  var v = record.options ? record.options[optionId] : undefined;

  if (!def) return '';
  if (def.inputType === 'toggle') return v ? 'あり' : 'なし';
  if (def.inputType === 'quantity') {
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }
  return v == null ? '' : String(v);
}

/** 配列・オブジェクトはシートで読める形に均す */
function formatAnswer(v) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    if (!v.length) return '';
    if (typeof v[0] === 'object' && v[0] !== null) {
      // SNSリンク [{type,url}]
      return v.map(function (x) {
        return (x.type ? x.type + ': ' : '') + (x.url || '');
      }).join('\n');
    }
    return v.join(', ');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/**
 * シートを1行ずつオブジェクトとして読む（リピーター照合・ダイジェスト用）。
 * _meta があれば fieldId をキーに、無ければ列ラベルをキーにする。
 */
function readRows(spreadsheetId) {
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return { rows: [], labels: [], meta: null };

  var values = sheet.getDataRange().getValues();
  var labels = values[0].map(function (v) { return String(v); });
  var meta = readMeta(spreadsheetId);

  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var byLabel = {};
    var byKey = {};
    for (var c = 0; c < labels.length; c++) {
      byLabel[labels[c]] = row[c];
      if (meta && meta.labelToKey[labels[c]]) {
        byKey[meta.labelToKey[labels[c]]] = row[c];
      }
    }
    rows.push({ rowIndex: i + 1, byLabel: byLabel, byKey: byKey, raw: row });
  }
  return { rows: rows, labels: labels, meta: meta };
}
