/**
 * 設定の読み込み
 *
 * 設定は2箇所に分かれています。
 *
 *   config.json（GitHub Pages・公開）
 *     見た目と申込内容の定義。テーマ、イベント情報、項目、ブース、料金、規約、メール文面。
 *     委託先が管理画面から更新します。
 *
 *   スクリプトプロパティ（このスクリプト内・非公開）
 *     スプレッドシートID、DriveフォルダID、管理者アドレス、パスワード、GitHubトークン。
 *     config.json は誰でも読めるため、これらをそこに置いてはいけません。
 *
 * イベント固有の値をコードに書かないので、同じスクリプトを別のイベントでも使えます。
 */

/** スクリプトプロパティのキー */
var PROP = {
  CONFIG_JSON_URL:        'CONFIG_JSON_URL',
  ADMIN_PASSWORD:         'ADMIN_PASSWORD',
  GITHUB_TOKEN:           'GITHUB_TOKEN',
  GITHUB_REPO:            'GITHUB_REPO',           // 例: bayashichan/buchiiyashifestaodawara
  GITHUB_BRANCH:          'GITHUB_BRANCH',
  CONFIG_PATH:            'CONFIG_PATH',           // 例: apply/config.json
  CURRENT_SPREADSHEET_ID: 'CURRENT_SPREADSHEET_ID',
  DATABASE_SPREADSHEET_ID:'DATABASE_SPREADSHEET_ID',
  DRIVE_ROOT_FOLDER_ID:   'DRIVE_ROOT_FOLDER_ID',
  ADMIN_EMAIL:            'ADMIN_EMAIL',
  REPLY_TO_EMAIL:         'REPLY_TO_EMAIL',
  SENDER_NAME:            'SENDER_NAME',
  LEGACY_SPREADSHEET_ID:  'LEGACY_SPREADSHEET_ID'  // 移送元（スタッフ所有の旧スプシ）
};

var SHEET_NAME = '申込データ';
var META_SHEET_NAME = '_meta';
var QUEUE_SHEET_NAME = '_mailQueue';

function props() {
  return PropertiesService.getScriptProperties();
}

function getProp(key, fallback) {
  var v = props().getProperty(key);
  return (v === null || v === '') ? (fallback === undefined ? '' : fallback) : v;
}

function setProp(key, value) {
  props().setProperty(key, String(value == null ? '' : value));
}

/**
 * config.json を取得して正規化する。
 * 同一リクエスト内では使い回し、短時間キャッシュで GitHub への往復を減らす。
 */
var _configCache = null;

function loadConfig(forceFresh) {
  if (_configCache && !forceFresh) return _configCache;

  var url = getProp(PROP.CONFIG_JSON_URL);
  if (!url) {
    throw new Error('スクリプトプロパティ ' + PROP.CONFIG_JSON_URL + ' が未設定です。');
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = 'config_json';
  var text = forceFresh ? null : cache.get(cacheKey);

  if (!text) {
    var res = UrlFetchApp.fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), {
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('config.json を取得できませんでした（HTTP ' + res.getResponseCode() + '）: ' + url);
    }
    text = res.getContentText();
    // 設定変更を長く待たせないよう短めにする
    cache.put(cacheKey, text, 60);
  }

  var raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error('config.json の形式が不正です: ' + e.message);
  }

  _configCache = normalizeConfig(raw);
  return _configCache;
}

/** 管理画面から設定を保存した直後にキャッシュを捨てる */
function invalidateConfigCache() {
  _configCache = null;
  CacheService.getScriptCache().remove('config_json');
}

// ========================================
// JSON レスポンス
// ========================================

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(message, code) {
  return jsonResponse({ success: false, error: message, code: code || 'ERROR' });
}

// ========================================
// 小さなユーティリティ
// ========================================

function nowJst() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
}

function safeJsonParse(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

/** 例外を握りつぶして記録だけする。副次的な処理で申込本体を落とさないため */
function tryOrLog(label, fn) {
  try {
    return fn();
  } catch (e) {
    console.error(label + ' failed: ' + (e && e.stack ? e.stack : e));
    return null;
  }
}
