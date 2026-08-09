/**
 * 管理API
 *
 * 主催者が自分でフォームを管理できるようにするための入口です。
 *
 * 認証はパスワード1つだけにしています。管理者に GitHub アカウントや
 * Personal Access Token を持たせる運用は現実的でないためです。
 * GitHub トークンはこのスクリプトのプロパティに置き、ブラウザには一切渡しません。
 *
 *   主催者のブラウザ ──パスワード──▶ このスクリプト ──トークン──▶ GitHub
 */

/**
 * パスワード誤りが続いたときのロック。
 *
 * 総当たり対策よりも「スマホでの打ち間違いで締め出されない」ことを優先し、
 * 回数は多めに取っている。管理画面が扱うのはイベントの設定内容であり、
 * 金銭や個人情報を直接引き出せるものではないため、この配分としている。
 */
var ADMIN_MAX_ATTEMPTS = 10;
var ADMIN_LOCK_SECONDS = 60;

function handleAdmin(action, params) {
  var auth = verifyAdmin(params);
  if (!auth.ok) return errorResponse(auth.message, auth.code);

  switch (action) {
    case 'admin_login':          return jsonResponse({ success: true });
    case 'admin_status':         return jsonResponse(getSetupStatus());
    case 'admin_get_config':     return jsonResponse({ success: true, config: loadConfig(true) });
    case 'admin_save_config':    return handleSaveConfig(params);
    case 'admin_preview_setup':  return jsonResponse(previewSetup());
    case 'admin_setup_event':    return jsonResponse(setupNewEvent({ force: params.force === '1' }));
    case 'admin_send_digest':    return handleSendDigest(params);
    case 'admin_mail_quota':     return jsonResponse({ success: true, remaining: remainingQuota() });
    case 'admin_process_queue':  return jsonResponse(
                                          Object.assign({ success: true }, processMailQueue()));
    case 'admin_migrate':        return handleMigrate(params);
    default:
      return errorResponse('不明な管理操作です: ' + action, 'UNKNOWN_ACTION');
  }
}

// ========================================
// 認証
// ========================================

function verifyAdmin(params) {
  var expected = getProp(PROP.ADMIN_PASSWORD);
  if (!expected) {
    return { ok: false, code: 'NOT_CONFIGURED',
             message: '管理パスワードが未設定です。スクリプトプロパティ ADMIN_PASSWORD を設定してください。' };
  }

  var cache = CacheService.getScriptCache();
  var fails = parseInt(cache.get('admin_fail') || '0', 10);
  if (fails >= ADMIN_MAX_ATTEMPTS) {
    return { ok: false, code: 'LOCKED',
             message: 'パスワードの誤りが続いたため、しばらく操作できません。1分ほどお待ちください。' };
  }

  var given = String(params.password || '');
  if (!given || !constantTimeEquals(given, expected)) {
    cache.put('admin_fail', String(fails + 1), ADMIN_LOCK_SECONDS);
    return { ok: false, code: 'BAD_PASSWORD', message: 'パスワードが正しくありません。' };
  }

  cache.remove('admin_fail');
  return { ok: true };
}

/** 文字列比較の所要時間から情報が漏れないようにする */
function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ========================================
// 設定の保存（GitHub へ）
// ========================================

/**
 * 管理画面から受け取った config を GitHub の config.json へ書き込む。
 * トークンはここ（サーバ側）にしか無いので、ブラウザには出ない。
 */
function handleSaveConfig(params) {
  var incoming = safeJsonParse(params.config, null);
  if (!incoming) return errorResponse('設定の形式が不正です。', 'INVALID');

  // 保存前に点検し、致命的な誤りは弾く
  var normalized = normalizeConfig(incoming);
  var issues = validateConfig(normalized);
  var errors = issues.filter(function (i) { return i.level === 'error'; });

  if (errors.length && params.ignoreErrors !== '1') {
    return jsonResponse({
      success: false,
      code: 'VALIDATION',
      error: '設定に問題があります。修正するか、確認のうえ保存し直してください。',
      issues: issues
    });
  }

  var token = getProp(PROP.GITHUB_TOKEN);
  var repo = getProp(PROP.GITHUB_REPO);
  var branch = getProp(PROP.GITHUB_BRANCH);
  var pathInRepo = getProp(PROP.CONFIG_PATH, 'apply/config.json');

  // 書き込み先ブランチに既定値を持たせない。
  // main を既定にすると、検証用のプロジェクトで保存を押しただけで
  // 稼働中のフォームの設定が書き換わる。どのブランチへ書くかは必ず明示させる。
  if (!token || !repo || !branch) {
    return errorResponse(
      'GitHub の接続情報が未設定です（GITHUB_TOKEN / GITHUB_REPO / GITHUB_BRANCH）。'
      + ' 検証用のプロジェクトでは GITHUB_BRANCH に検証用のブランチ名を入れてください。',
      'NOT_CONFIGURED');
  }

  var apiBase = 'https://api.github.com/repos/' + repo + '/contents/' + pathInRepo;
  var headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  // 既存ファイルの SHA を取得（更新に必要）
  var sha = null;
  var getRes = UrlFetchApp.fetch(apiBase + '?ref=' + encodeURIComponent(branch), {
    method: 'get', headers: headers, muteHttpExceptions: true
  });
  if (getRes.getResponseCode() === 200) {
    sha = JSON.parse(getRes.getContentText()).sha;
  } else if (getRes.getResponseCode() !== 404) {
    return errorResponse('GitHub の読み取りに失敗しました（HTTP '
      + getRes.getResponseCode() + '）。', 'GITHUB');
  }

  var content = JSON.stringify(normalized, null, 2) + '\n';
  var payload = {
    message: '管理画面から設定を更新（' + nowJst() + '）',
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: branch
  };
  if (sha) payload.sha = sha;

  var putRes = UrlFetchApp.fetch(apiBase, {
    method: 'put',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = putRes.getResponseCode();
  if (code !== 200 && code !== 201) {
    return errorResponse('GitHub への保存に失敗しました（HTTP ' + code + '）: '
      + putRes.getContentText().slice(0, 300), 'GITHUB');
  }

  // 次の読み込みで新しい設定が反映されるようにする
  invalidateConfigCache();

  return jsonResponse({ success: true, issues: issues });
}

// ========================================
// ダイジェスト
// ========================================

function handleSendDigest(params) {
  try {
    var days = parseInt(params.days, 10);
    var result = sendDigestNow(isNaN(days) ? 1 : days);
    return jsonResponse({ success: true, count: result.count });
  } catch (e) {
    return errorResponse(e.message, 'DIGEST');
  }
}

// ========================================
// 移送
// ========================================

function handleMigrate(params) {
  try {
    var result = migrateLegacySpreadsheet({
      sourceId: params.sourceId || getProp(PROP.LEGACY_SPREADSHEET_ID),
      dryRun: params.dryRun === '1'
    });
    return jsonResponse(Object.assign({ success: true }, result));
  } catch (e) {
    return errorResponse(e.message, 'MIGRATE');
  }
}
