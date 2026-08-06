/**
 * 画像の保存（Google ドライブ）
 *
 * ルートフォルダの配下にイベント名のフォルダを作り、その中へ保存します。
 * 画像項目が複数ある場合は、さらに項目名でサブフォルダに分けます。
 *
 * このスクリプトは主催者アカウントで実行されるため、作成されるフォルダ・
 * ファイルはすべて主催者の所有になります。
 */

/** フォルダを名前で探し、無ければ作る。並行実行での二重作成は許容する */
function getOrCreateFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();

  var folder = parent.createFolder(name);
  // 画像を確認サイトや案内で表示できるようにしておく
  tryOrLog('setSharing(folder)', function () {
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  });
  return folder;
}

/** ルートフォルダを取得する。一時的な失敗があるためリトライする */
function getRootFolder() {
  var id = getProp(PROP.DRIVE_ROOT_FOLDER_ID);
  if (!id) throw new Error('スクリプトプロパティ ' + PROP.DRIVE_ROOT_FOLDER_ID + ' が未設定です。');

  var lastError = null;
  for (var i = 0; i < 3; i++) {
    try {
      return DriveApp.getFolderById(id);
    } catch (e) {
      lastError = e;
      Utilities.sleep(1000);
    }
  }
  throw new Error('画像保存フォルダを開けませんでした: ' + (lastError && lastError.message));
}

/** イベント用フォルダ（無ければ作成）。「新規開催回を始める」でも使う */
function getEventFolder(eventName) {
  var root = getRootFolder();
  if (!eventName) return root;
  return getOrCreateFolder(root, eventName);
}

/**
 * Base64 の画像を保存し、埋め込み用の直リンクURLを返す。
 *
 * @param {Object} img { base64, mimeType, name }
 * @param {Object} ctx { eventName, fieldLabel, applicantName, multipleFields }
 */
function saveImage(img, ctx) {
  ctx = ctx || {};
  var folder = getEventFolder(ctx.eventName);

  // 画像項目が複数ある場合だけ項目ごとのサブフォルダに分ける
  if (ctx.multipleFields && ctx.fieldLabel) {
    folder = getOrCreateFolder(folder, ctx.fieldLabel);
  }

  var ext = (img.name && img.name.indexOf('.') >= 0)
    ? img.name.split('.').pop()
    : 'jpg';
  var fileName = ctx.applicantName
    ? sanitizeFileName(ctx.applicantName) + '.' + ext
    : (img.name || 'image.' + ext);

  var blob = Utilities.newBlob(
    Utilities.base64Decode(img.base64),
    img.mimeType || 'image/jpeg',
    fileName
  );

  var file = folder.createFile(blob);
  tryOrLog('setSharing(file)', function () {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  });

  return 'https://lh3.googleusercontent.com/d/' + file.getId();
}

/** ファイル名に使えない文字を落とす */
function sanitizeFileName(name) {
  return String(name).replace(/[\/\\:*?"<>|]/g, '_').trim().slice(0, 80) || 'image';
}

/**
 * 送信された画像をすべて保存し、fieldId -> URL の対応を返す。
 * 1枚失敗しても他の保存と申込本体は続行する。
 */
function saveSubmittedImages(params, cfg, applicantName, eventName) {
  var fieldIds = safeJsonParse(params.imageFieldIds, []);
  var urls = {};
  if (!fieldIds.length) return urls;

  var multiple = fieldIds.length > 1;

  fieldIds.forEach(function (fieldId) {
    // 「前回の写真を使う」が選ばれていれば再アップロードしない
    var existing = params['image_' + fieldId + '_existingUrl'];
    if (existing) { urls[fieldId] = existing; return; }

    var base64 = params['image_' + fieldId + '_base64'];
    if (!base64) return;

    var field = findField(cfg, fieldId);
    var url = tryOrLog('saveImage(' + fieldId + ')', function () {
      return saveImage({
        base64: base64,
        mimeType: params['image_' + fieldId + '_mime'] || 'image/jpeg',
        name: params['image_' + fieldId + '_name'] || 'image.jpg'
      }, {
        eventName: eventName,
        fieldLabel: field ? (field.label || fieldId) : fieldId,
        applicantName: applicantName,
        multipleFields: multiple
      });
    });
    if (url) urls[fieldId] = url;
  });

  return urls;
}

function findField(cfg, fieldId) {
  var fields = (cfg && cfg.fields) || [];
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].id === fieldId) return fields[i];
  }
  return null;
}
