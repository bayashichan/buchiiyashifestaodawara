/**
 * リピーター認証
 *
 * 過去に申込のある方が、本名＋メールアドレスで照合し、メールで届く認証コードを
 * 入力すると前回の申込内容を読み込めるようにします。
 *
 * 認証コードは CacheService に有効期限つきで保管します。外部データベースも
 * 有料サービスも使わないため、追加費用はかかりません。
 *
 * 照合は _meta シートの fieldId 対応を使うため、管理者が項目名（列ラベル）を
 * 変更しても壊れません。
 */

// ========================================
// 認証コードの発行
// ========================================

function handleSendAuthCode(params) {
  var cfg = loadConfig();
  var rep = cfg.repeater || {};

  if (!rep.enabled) {
    return errorResponse('この機能は現在ご利用いただけません。', 'DISABLED');
  }

  var name = String(params.name || '').trim();
  var email = String(params.email || '').trim();
  if (!name || !email) {
    return errorResponse('お名前とメールアドレスを入力してください。', 'INVALID');
  }

  var cache = CacheService.getScriptCache();
  var emailKey = normalizeForMatch(email);

  // 短時間の連打を防ぐ（総当たり対策と送信枠の保護を兼ねる）
  var cooldown = rep.resendCooldownSeconds || 60;
  if (cache.get('auth_sent_' + emailKey)) {
    return errorResponse(
      cooldown + '秒以内に再送はできません。しばらくお待ちください。', 'COOLDOWN');
  }

  // 該当者がいなければコードを発行しない（無駄な送信枠を使わない）
  var matches = searchPastSubmissions(cfg, name, email);
  if (!matches.length) {
    return errorResponse(
      '該当するお申込みが見つかりませんでした。前回と同じお名前（本名）と'
      + 'メールアドレスをご確認ください。', 'NOT_FOUND');
  }

  // 送信枠が尽きているときは、黙って失敗せず理由を返す
  if (!hasQuotaForAuthMail()) {
    return errorResponse(
      '本日の認証受付は上限に達しました。お手数ですが翌日以降にお試しください。', 'QUOTA');
  }

  var digits = rep.codeDigits || 4;
  var code = generateCode(digits);
  var ttl = rep.codeTtlSeconds || 600;

  cache.put('auth_code_' + emailKey, code, ttl);
  cache.put('auth_sent_' + emailKey, '1', cooldown);
  cache.remove('auth_fail_' + emailKey);

  try {
    sendAuthCodeMail(cfg, email, code, ttl);
  } catch (e) {
    console.error('auth mail failed: ' + e.message);
    return errorResponse('認証コードの送信に失敗しました。時間をおいてお試しください。', 'MAIL_FAILED');
  }

  return jsonResponse({ success: true, count: matches.length });
}

function generateCode(digits) {
  var min = Math.pow(10, digits - 1);
  var max = Math.pow(10, digits) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

function sendAuthCodeMail(cfg, email, code, ttl) {
  var eventName = (cfg.event || {}).name || 'イベント';
  var minutes = Math.round(ttl / 60);

  MailApp.sendEmail({
    to: email,
    subject: '【' + eventName + '】認証コードのお知らせ',
    body: [
      '認証コード: ' + code,
      '',
      eventName + ' の出展申込フォームをご利用いただきありがとうございます。',
      '上記の認証コードをフォームに入力すると、前回の申込内容を読み込めます。',
      '',
      '※ このコードの有効期限は' + minutes + '分です。',
      '※ 本メールにお心当たりがない場合は破棄してください。',
      '',
      '────────────────',
      eventName + ' 事務局',
      '────────────────'
    ].join('\n'),
    name: senderName(cfg),
    replyTo: replyToEmail()
  });
}

// ========================================
// 認証コードの検証
// ========================================

function handleVerifyAuthCode(params) {
  var cfg = loadConfig();
  var rep = cfg.repeater || {};

  if (!rep.enabled) {
    return errorResponse('この機能は現在ご利用いただけません。', 'DISABLED');
  }

  var name = String(params.name || '').trim();
  var email = String(params.email || '').trim();
  var code = String(params.code || '').trim();
  if (!name || !email || !code) {
    return errorResponse('入力内容が不足しています。', 'INVALID');
  }

  var cache = CacheService.getScriptCache();
  var emailKey = normalizeForMatch(email);

  var saved = cache.get('auth_code_' + emailKey);
  if (!saved) {
    return errorResponse('認証コードの有効期限が切れています。再度送信してください。', 'EXPIRED');
  }

  // 総当たり対策。4桁は1万通りなので試行回数を必ず制限する
  var maxAttempts = rep.maxAttempts || 5;
  var failKey = 'auth_fail_' + emailKey;
  var fails = parseInt(cache.get(failKey) || '0', 10);

  if (fails >= maxAttempts) {
    cache.remove('auth_code_' + emailKey);
    return errorResponse(
      '入力の誤りが続いたため、この認証コードを無効にしました。'
      + 'お手数ですが再度送信してください。', 'LOCKED');
  }

  if (saved !== code) {
    fails++;
    // 残り時間に関わらずカウンタは保持する
    cache.put(failKey, String(fails), rep.codeTtlSeconds || 600);
    var left = maxAttempts - fails;
    return errorResponse(
      '認証コードが正しくありません。' + (left > 0 ? '（あと' + left + '回）' : ''),
      'MISMATCH');
  }

  // 使い終わったコードは破棄する（使い捨て）
  cache.remove('auth_code_' + emailKey);
  cache.remove(failKey);

  var list = searchPastSubmissions(cfg, name, email);
  return jsonResponse({ success: true, list: list });
}

// ========================================
// 過去申込の検索
// ========================================

/**
 * マスターDB から、氏名とメールアドレスが両方一致する行を新しい順に返す。
 *
 * 列の特定は _meta の fieldId 対応を使う。列ラベル（＝項目名）は管理者が
 * 変更できるため、ラベル名で探すと項目名の変更で照合が壊れてしまう。
 */
function searchPastSubmissions(cfg, name, email) {
  var dbId = getProp(PROP.DATABASE_SPREADSHEET_ID) || getProp(PROP.CURRENT_SPREADSHEET_ID);
  if (!dbId) return [];

  var data;
  try {
    data = readRows(dbId);
  } catch (e) {
    console.error('searchPastSubmissions failed: ' + e.message);
    return [];
  }
  if (!data.rows.length) return [];

  var matchFields = (cfg.repeater && cfg.repeater.matchFields) || ['name', 'email'];
  var targets = {
    name: normalizeForMatch(name),
    email: normalizeForMatch(email)
  };

  var results = [];

  // 新しい申込を上に出す
  for (var i = data.rows.length - 1; i >= 0; i--) {
    var row = data.rows[i];
    var ok = matchFields.every(function (key) {
      var cell = pickCell(row, key, data);
      return normalizeForMatch(cell) === targets[key];
    });
    if (!ok) continue;

    results.push(buildRestoreRecord(cfg, row, data));
  }

  return results;
}

/**
 * 行から目的の値を取り出す。
 * _meta があれば fieldId で、無ければ旧形式の日本語列名でも拾えるようにする。
 */
function pickCell(row, key, data) {
  if (row.byKey && key in row.byKey) return row.byKey[key];

  // _meta が無い旧シート向けのフォールバック
  var legacy = {
    name: ['氏名', 'お名前', 'お名前（本名）'],
    email: ['メールアドレス'],
    furigana: ['フリガナ', 'ふりがな'],
    exhibitorName: ['出展名']
  };
  var candidates = legacy[key] || [];
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i] in row.byLabel) return row.byLabel[candidates[i]];
  }
  return '';
}

/**
 * フォームへ復元するレコードを作る。
 *
 * ブース・オプション・懇親会は意図的に含めない。前回のブースが今回は存在しない、
 * 満枠、値上げ、といったときに誤った金額のまま申し込まれるのを防ぐため。
 */
function buildRestoreRecord(cfg, row, data) {
  var answers = {};

  (cfg.fields || []).forEach(function (f) {
    if (DISPLAY_ONLY_TYPES.indexOf(f.type) >= 0) return;
    if (f.type === 'booth' || f.type === 'category') return;

    var v = pickCell(row, f.id, data);
    if (v === '' || v == null) return;

    if (f.type === 'snsLinks') {
      answers[f.id] = parseSnsCell(v);
    } else if (f.type === 'checkboxGroup') {
      answers[f.id] = String(v).split(/[,、]\s*/).filter(Boolean);
    } else {
      answers[f.id] = v;
    }
  });

  return {
    eventName: String(row.byKey['__eventName'] || row.byLabel['開催回'] || ''),
    submittedAt: formatCellDate(row.byKey['__submittedAt'] || row.byLabel['申込日時']),
    exhibitorName: String(pickCell(row, 'exhibitorName', data) || ''),
    answers: answers
  };
}

/** "Instagram: https://…" の複数行を [{type,url}] に戻す */
function parseSnsCell(v) {
  var out = [];
  String(v).split('\n').forEach(function (line) {
    line = line.trim();
    if (!line) return;
    var m = line.match(/^([^:]+):\s*(https?:\/\/.+)$/);
    if (m) out.push({ type: m[1].trim(), url: m[2].trim() });
    else if (/^https?:\/\//.test(line)) out.push({ type: 'HP', url: line });
  });
  return out;
}

function formatCellDate(v) {
  if (!v) return '';
  var d = parseSheetDate(v);
  return d ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : String(v);
}
