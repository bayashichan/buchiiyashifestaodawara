/**
 * 申込フォーム バックエンド（汎用）
 *
 * イベント固有の値をコードに一切持ちません。設定は config.json（公開）と
 * スクリプトプロパティ（非公開）から実行時に読みます。そのため、
 * 料金・ブース・項目・メール文面を変えても再デプロイは不要です。
 *
 * ------------------------------------------------------------------
 * 初回セットアップ（主催者アカウントで実施）
 *   1. スクリプトプロパティに CONFIG_JSON_URL を設定
 *   2. ウェブアプリとしてデプロイ（実行ユーザー: 自分 / アクセス: 全員）
 *   3. 管理画面から「新規開催回を始める」を実行
 * ------------------------------------------------------------------
 */

/**
 * ブラウザからは multipart/form-data で POST します。
 * 単純リクエストなのでプリフライトが発生せず、公開したウェブアプリへ
 * 直接送信できます（CORS 回避のための中継サーバーが不要）。
 */
function doPost(e) {
  try {
    var params = (e && e.parameter) || {};

    // JSON ボディで送られた場合にも対応する
    if (e && e.postData && e.postData.type === 'application/json') {
      var body = safeJsonParse(e.postData.contents, {});
      Object.keys(body).forEach(function (k) {
        if (!(k in params)) params[k] = body[k];
      });
    }

    return route(params.action, params);

  } catch (err) {
    console.error('doPost error: ' + (err && err.stack ? err.stack : err));
    return errorResponse(err.message || 'サーバー内部エラー');
  }
}

/** 疎通確認と、GET でも動く一部の参照系 */
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    if (!params.action) {
      return jsonResponse({ success: true, message: '申込フォームのバックエンドは稼働中です。' });
    }
    return route(params.action, params);
  } catch (err) {
    console.error('doGet error: ' + (err && err.stack ? err.stack : err));
    return errorResponse(err.message || 'サーバー内部エラー');
  }
}

function route(action, params) {
  switch (action) {
    case 'submit':           return handleSubmit(params);
    case 'send_auth_code':   return handleSendAuthCode(params);
    case 'verify_auth_code': return handleVerifyAuthCode(params);
    case 'ping':             return jsonResponse({ success: true, time: nowJst() });
    default:
      if (action && action.indexOf('admin_') === 0) return handleAdmin(action, params);
      return errorResponse('不明なアクションです: ' + action, 'UNKNOWN_ACTION');
  }
}

// ========================================
// 入力の検証
// ========================================

/**
 * 必須項目・形式・規約同意をサーバ側で確認する。
 * 項目の定義は config から読むので、管理者が必須の有無を変えれば追従する。
 *
 * @returns {Array<string>} エラーメッセージ。空配列なら問題なし。
 */
function validateSubmission(cfg, answers, params) {
  var errors = [];
  answers = answers || {};

  (cfg.fields || []).forEach(function (f) {
    if (DISPLAY_ONLY_TYPES.indexOf(f.type) >= 0) return;
    // ブースとカテゴリは answers ではなく専用のパラメータで送られる
    if (f.type === 'booth' || f.type === 'category') return;

    var label = f.label || f.id;

    // 画像は answers の文字列ではなく、実際に添付が届いているかで判定する
    if (f.type === 'image') {
      var hasImage = !!(params['image_' + f.id + '_base64'] ||
                        params['image_' + f.id + '_existingUrl']);
      if (f.required && !hasImage) errors.push(label + 'が添付されていません');
      return;
    }

    var v = answers[f.id];
    var empty = (v == null) || (Array.isArray(v) ? !v.length : !String(v).trim());

    if (f.required && empty) {
      errors.push(label + 'が入力されていません');
      return;
    }
    if (empty) return;

    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) {
      errors.push(label + 'の形式が正しくありません');
    }
    if (f.maxLength > 0 && typeof v === 'string' && v.length > f.maxLength) {
      errors.push(label + 'が' + f.maxLength + '文字を超えています');
    }
  });

  // カテゴリは config に登録がある場合のみ必須扱いにする
  var categoryField = findFieldByType(cfg, 'category');
  if (categoryField && categoryField.required && (cfg.categories || []).length) {
    if (!String(params.category || '').trim()) {
      errors.push('出展カテゴリが選択されていません');
    } else if ((cfg.categories || []).indexOf(params.category) < 0) {
      errors.push('出展カテゴリの値が不正です');
    }
  }

  // 規約同意
  if ((cfg.terms || {}).requireAgree !== false) {
    if (params.agreeTerms !== '1' && params.agreeTerms !== 'true' && params.agreeTerms !== 'on') {
      errors.push(((cfg.terms || {}).title || '出展規約') + 'への同意が必要です');
    }
  }

  return errors;
}

function findFieldByType(cfg, type) {
  var fields = (cfg && cfg.fields) || [];
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].type === type) return fields[i];
  }
  return null;
}

// ========================================
// 申込の受付
// ========================================

/**
 * 処理の順序が重要です。
 *
 *   1. 金額をサーバ側で再計算する（クライアントの申告は信用しない）
 *   2. 画像を保存する
 *   3. スプレッドシートへ保存する
 *   4. 最後に確認メールを送る
 *
 * メール送信は最後に行い、失敗しても保存済みの申込は失われないようにします。
 * 送信枠が尽きている場合はキューに積み、その旨を画面に返します。
 */
function handleSubmit(params) {
  var cfg = loadConfig();

  var answers = safeJsonParse(params.answers, {});
  var selected = safeJsonParse(params.selectedOptions, {});
  var isMember = params.isMember === '1';

  // --- 0. 入力の検証 ---
  // フォーム側でも検証しているが、直接POSTされた場合に空の申込が通らないよう
  // サーバ側でも必ず確認する。
  var invalid = validateSubmission(cfg, answers, params);
  if (invalid.length) {
    return jsonResponse({
      success: false,
      code: 'VALIDATION',
      error: invalid[0],
      errors: invalid
    });
  }

  // --- 1. サーバ側で再計算 ---
  // ブース別のオプション可否・上限もここで再判定されるため、
  // 改変したリクエストで使えないオプションを通すことはできない。
  var quote = computeQuote(cfg, {
    boothId: params.boothId || null,
    options: selected,
    isMember: isMember
  });

  if (!quote.boothId) {
    return errorResponse('出展ブースが選択されていないか、満枠です。', 'NO_BOOTH');
  }

  var booth = null;
  for (var i = 0; i < cfg.booths.length; i++) {
    if (cfg.booths[i].id === quote.boothId) { booth = cfg.booths[i]; break; }
  }

  var applicantName = String(answers.name || answers['お名前'] || '').trim();
  var applicantEmail = String(answers.email || '').trim();
  var eventName = (cfg.event || {}).name || params.eventName || '';

  // --- 2. 画像の保存 ---
  var imageUrls = saveSubmittedImages(params, cfg, applicantName, eventName);
  Object.keys(imageUrls).forEach(function (fieldId) {
    answers[fieldId] = imageUrls[fieldId];
  });

  var record = {
    eventName: eventName,
    submittedAt: nowJst(),
    name: applicantName,
    email: applicantEmail,
    category: params.category || '',
    boothId: quote.boothId,
    boothName: booth ? booth.name : '',
    answers: answers,
    options: quote.options,
    isMember: isMember,
    isEarlyBird: quote.earlyBird,
    total: quote.total,
    breakdown: formatBreakdown(quote),
    lineUserId: params.lineUserId || '',
    lineDisplayName: params.lineDisplayName || ''
  };

  // 表示額とサーバ計算額が食い違ったら記録する（設定変更中の申込などで起こりうる）
  var clientTotal = parseInt(params.clientTotal, 10);
  if (!isNaN(clientTotal) && clientTotal !== quote.total) {
    console.warn('金額不一致: client=' + clientTotal + ' server=' + quote.total
                 + ' / ' + applicantName);
  }

  // --- 3. 保存（ここまで必ず完了させる）---
  var currentId = getProp(PROP.CURRENT_SPREADSHEET_ID);
  var databaseId = getProp(PROP.DATABASE_SPREADSHEET_ID);

  if (!currentId && !databaseId) {
    return errorResponse(
      '保存先スプレッドシートが未設定です。管理画面から「新規開催回を始める」を実行してください。',
      'NO_SPREADSHEET');
  }

  if (currentId) {
    appendSubmission(currentId, cfg, record, { isMaster: false });
  }
  // マスターDBは開催回をまたいだリピーター照合の参照元
  if (databaseId && databaseId !== currentId) {
    tryOrLog('appendSubmission(master)', function () {
      appendSubmission(databaseId, cfg, record, { isMaster: true });
    });
  }

  // --- 4. 確認メール（失敗しても申込は成立済み）---
  var mail = { sent: false, queued: false };
  tryOrLog('sendConfirmationMail', function () {
    mail = sendConfirmationMail(cfg, record);
  });

  return jsonResponse({
    success: true,
    total: quote.total,
    breakdown: record.breakdown,
    mailSent: mail.sent,
    mailQueued: mail.queued,
    notices: quote.notices
  });
}
