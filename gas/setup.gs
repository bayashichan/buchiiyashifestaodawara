/**
 * 開催回のセットアップ
 *
 * 管理画面の「新規開催回を始める」から呼びます。1操作で次を行います。
 *
 *   1. マスターDB（開催回をまたぐ照合先）が無ければ作成
 *   2. 今回イベント用スプレッドシートを作成し、ヘッダーを config から自動生成
 *   3. Drive にイベント名のフォルダを作成
 *   4. 作成したIDをスクリプトプロパティへ保存
 *
 * このスクリプトは主催者アカウントで実行されるため、作成されたスプレッドシートと
 * フォルダはすべて主催者の所有になります。委託先が手で作ってはいけません。
 */

/**
 * @param {Object} opts { force: boolean }  force=true で同名でも新規作成する
 * @returns {Object} 実行結果（管理画面にそのまま表示できる形）
 */
function setupNewEvent(opts) {
  opts = opts || {};
  var cfg = loadConfig(true);           // 最新の設定で作る
  var eventName = (cfg.event || {}).name;

  if (!eventName) {
    throw new Error('イベント名が未設定です。先に管理画面でイベント名を設定してください。');
  }

  var steps = [];

  // --- 1. マスターDB ---
  var databaseId = getProp(PROP.DATABASE_SPREADSHEET_ID);
  if (databaseId && !opts.force) {
    steps.push({ step: 'マスターDB', status: 'reused', id: databaseId,
                 message: '既存のマスターDBを使用します' });
  } else {
    var masterName = masterDbName(cfg);
    var master = SpreadsheetApp.create(masterName);
    databaseId = master.getId();
    renameFirstSheet(master);
    ensureSheet(databaseId, cfg, { isMaster: true });
    setProp(PROP.DATABASE_SPREADSHEET_ID, databaseId);
    steps.push({ step: 'マスターDB', status: 'created', id: databaseId,
                 name: masterName, url: master.getUrl(),
                 message: 'マスターDBを作成しました' });
  }

  // --- 2. 今回イベント用スプレッドシート ---
  var eventSheetName = eventName + ' 申込データ';
  var existingEvent = opts.force ? null : findSpreadsheetByName(eventSheetName);

  var currentId;
  if (existingEvent) {
    currentId = existingEvent.getId();
    ensureSheet(currentId, cfg, { isMaster: false });
    steps.push({ step: 'イベント用スプレッドシート', status: 'reused', id: currentId,
                 name: eventSheetName, url: existingEvent.getUrl(),
                 message: '同名のスプレッドシートが既にあるため再利用します' });
  } else {
    var ss = SpreadsheetApp.create(eventSheetName);
    currentId = ss.getId();
    renameFirstSheet(ss);
    ensureSheet(currentId, cfg, { isMaster: false });
    steps.push({ step: 'イベント用スプレッドシート', status: 'created', id: currentId,
                 name: eventSheetName, url: ss.getUrl(),
                 message: 'ヘッダーを設定して作成しました' });
  }
  setProp(PROP.CURRENT_SPREADSHEET_ID, currentId);

  // --- 3. Drive フォルダ ---
  var folderInfo = tryOrLog('createEventFolder', function () {
    var root = getRootFolder();
    var before = root.getFoldersByName(eventName).hasNext();
    var folder = getOrCreateFolder(root, eventName);
    return {
      id: folder.getId(),
      url: folder.getUrl(),
      created: !before
    };
  });

  if (folderInfo) {
    steps.push({ step: '画像保存フォルダ',
                 status: folderInfo.created ? 'created' : 'reused',
                 id: folderInfo.id, url: folderInfo.url,
                 message: folderInfo.created
                   ? 'イベント名のフォルダを作成しました'
                   : '同名のフォルダが既にあるため再利用します' });
  } else {
    steps.push({ step: '画像保存フォルダ', status: 'skipped',
                 message: 'DRIVE_ROOT_FOLDER_ID が未設定のため作成をスキップしました' });
  }

  // --- 4. トリガー ---
  var triggers = tryOrLog('installTriggers', installTriggers);
  steps.push({ step: '自動処理', status: 'ok',
               message: '日次ダイジェストとメールキューのトリガーを確認しました',
               detail: triggers ? triggers.join(', ') : '' });

  return {
    success: true,
    eventName: eventName,
    currentSpreadsheetId: currentId,
    databaseSpreadsheetId: databaseId,
    steps: steps
  };
}

/**
 * 実行前に何が作られるかを見せるための下見。
 * 誤字のまま二重に作ってしまうのを防ぐ。
 */
function previewSetup() {
  var cfg = loadConfig(true);
  var eventName = (cfg.event || {}).name || '';
  var eventSheetName = eventName + ' 申込データ';

  var existingEvent = eventName ? findSpreadsheetByName(eventSheetName) : null;
  var databaseId = getProp(PROP.DATABASE_SPREADSHEET_ID);

  var folderExists = false;
  tryOrLog('previewFolder', function () {
    folderExists = getRootFolder().getFoldersByName(eventName).hasNext();
  });

  var header = buildHeaderRow(cfg, { isMaster: false });

  return {
    success: true,
    eventName: eventName,
    plan: [
      { item: 'マスターDB',
        action: databaseId ? '既存を使用' : '新規作成（' + masterDbName(cfg) + '）' },
      { item: 'イベント用スプレッドシート',
        action: existingEvent ? '既存を使用（' + eventSheetName + '）'
                              : '新規作成（' + eventSheetName + '）' },
      { item: '画像保存フォルダ',
        action: folderExists ? '既存を使用（' + eventName + '）'
                             : '新規作成（' + eventName + '）' }
    ],
    headerPreview: header.labels,
    issues: validateConfig(cfg)
  };
}

function masterDbName(cfg) {
  var base = (cfg.event || {}).name || 'イベント';
  // 「第1回◯◯in小田原」→「◯◯in小田原」のように回次を落として通し名にする
  var series = base.replace(/^第?\s*[0-9０-９]+\s*回\s*/, '').trim() || base;
  return series + ' 申込マスターDB';
}

function renameFirstSheet(ss) {
  var first = ss.getSheets()[0];
  if (first && first.getName() !== SHEET_NAME) {
    // ensureSheet が SHEET_NAME を作るので、既定シートは邪魔にならない名前にしておく
    first.setName(SHEET_NAME);
  }
}

/** 同名のスプレッドシートを探す（二重作成を防ぐ） */
function findSpreadsheetByName(name) {
  var it = DriveApp.getFilesByName(name);
  while (it.hasNext()) {
    var file = it.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
      return SpreadsheetApp.openById(file.getId());
    }
  }
  return null;
}

/**
 * 設定内容とスクリプトプロパティの状態を返す（管理画面の診断表示用）。
 * 値そのものは返さず、設定済みかどうかだけを返す（トークンを漏らさないため）。
 */
function getSetupStatus() {
  var issues = [];
  var cfg = null;
  try {
    cfg = loadConfig(true);
    issues = validateConfig(cfg);
  } catch (e) {
    issues = [{ level: 'error', where: 'config', message: e.message }];
  }

  var configured = function (key) { return !!getProp(key); };

  return {
    success: true,
    eventName: cfg ? (cfg.event || {}).name : '',
    properties: {
      CONFIG_JSON_URL:         configured(PROP.CONFIG_JSON_URL),
      ADMIN_PASSWORD:          configured(PROP.ADMIN_PASSWORD),
      GITHUB_TOKEN:            configured(PROP.GITHUB_TOKEN),
      GITHUB_REPO:             getProp(PROP.GITHUB_REPO),
      CURRENT_SPREADSHEET_ID:  getProp(PROP.CURRENT_SPREADSHEET_ID),
      DATABASE_SPREADSHEET_ID: getProp(PROP.DATABASE_SPREADSHEET_ID),
      DRIVE_ROOT_FOLDER_ID:    configured(PROP.DRIVE_ROOT_FOLDER_ID),
      ADMIN_EMAIL:             configured(PROP.ADMIN_EMAIL)
    },
    mailQuotaRemaining: remainingQuota(),
    issues: issues
  };
}
