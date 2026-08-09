/**
 * 運用補助（GASエディタから手動で実行する関数）
 *
 * デプロイ後の疎通確認や、設定を変えたあとの動作確認に使います。
 * すべて「実行」→「実行ログ」で結果を確認できます。
 */

/**
 * 設定が正しく読めるか、必要なプロパティが揃っているかを確認する。
 * 何か動かないときは、まずこれを実行してください。
 */
function checkSetup() {
  var lines = [];
  var ok = true;

  lines.push('=== 設定の確認 ===');

  // config.json
  var cfg = null;
  try {
    cfg = loadConfig(true);
    lines.push('✅ config.json を取得できました');
    lines.push('   イベント名: ' + ((cfg.event || {}).name || '(未設定)'));
    lines.push('   スキーマ: v' + cfg.schemaVersion);
    lines.push('   ブース: ' + (cfg.booths || []).length + '件 / 項目: ' +
               (cfg.fields || []).length + '件 / オプション: ' +
               ((cfg.pricing || {}).options || []).length + '件');
  } catch (e) {
    ok = false;
    lines.push('❌ config.json を取得できません: ' + e.message);
  }

  // スクリプトプロパティ
  lines.push('');
  lines.push('=== スクリプトプロパティ ===');
  [
    [PROP.CONFIG_JSON_URL, '設定ファイルのURL', true],
    [PROP.ADMIN_PASSWORD, '管理パスワード', true],
    [PROP.DRIVE_ROOT_FOLDER_ID, '画像保存フォルダ', true],
    [PROP.ADMIN_EMAIL, '管理者メール', true],
    [PROP.GITHUB_TOKEN, 'GitHubトークン', false],
    [PROP.GITHUB_REPO, 'GitHubリポジトリ', false],
    [PROP.CURRENT_SPREADSHEET_ID, '今回の申込データ', false],
    [PROP.DATABASE_SPREADSHEET_ID, 'マスターDB', false]
  ].forEach(function (row) {
    var v = getProp(row[0]);
    var mark = v ? '✅' : (row[2] ? '❌' : '⚠️');
    if (!v && row[2]) ok = false;
    lines.push(mark + ' ' + row[1] + (v ? '' : ' … 未設定'));
  });

  // Drive
  lines.push('');
  lines.push('=== Google ドライブ ===');
  try {
    var folder = getRootFolder();
    lines.push('✅ 画像保存フォルダを開けました: ' + folder.getName());
  } catch (e) {
    ok = false;
    lines.push('❌ ' + e.message);
  }

  // スプレッドシート
  lines.push('');
  lines.push('=== スプレッドシート ===');
  [[PROP.CURRENT_SPREADSHEET_ID, '今回の申込データ'],
   [PROP.DATABASE_SPREADSHEET_ID, 'マスターDB']].forEach(function (row) {
    var id = getProp(row[0]);
    if (!id) { lines.push('⚠️ ' + row[1] + ' … 未作成'); return; }
    try {
      var ss = SpreadsheetApp.openById(id);
      var sheet = ss.getSheetByName(SHEET_NAME);
      lines.push('✅ ' + row[1] + ': ' + ss.getName() +
                 '（' + (sheet ? Math.max(0, sheet.getLastRow() - 1) : 0) + '件）');
    } catch (e) {
      ok = false;
      lines.push('❌ ' + row[1] + ' を開けません: ' + e.message);
    }
  });

  // メール
  lines.push('');
  lines.push('=== メール ===');
  lines.push('本日あと ' + remainingQuota() + ' 宛先に送信できます');

  // 設定の点検
  if (cfg) {
    var issues = validateConfig(cfg);
    if (issues.length) {
      lines.push('');
      lines.push('=== 設定の点検 ===');
      issues.forEach(function (i) {
        lines.push((i.level === 'error' ? '⛔' : '⚠️') + ' ' + i.message);
      });
    }
  }

  lines.push('');
  lines.push(ok ? '判定: 申込を受け付けられる状態です' : '判定: ❌ のある項目を直してください');

  var text = lines.join('\n');
  console.log(text);
  return text;
}

/**
 * 自動テストが作ったデータの目印。
 * cleanupTestData() はこの文字列を含む行だけを消します。
 */
var TEST_MARKER = '★自動テスト★';

/** 1x1 の透明PNG。画像保存の経路を通すためだけのもの */
var TEST_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * テスト用の申込を1件流し込む。
 * 実際にスプレッドシートへ行が追加され、確認メールも送信されます。
 * 送信先は下の TEST_EMAIL を自分のアドレスに書き換えてから実行してください。
 */
function testSubmission() {
  var TEST_EMAIL = Session.getActiveUser().getEmail();

  var cfg = loadConfig(true);
  var booth = (cfg.booths || []).filter(function (b) { return !b.soldOut; })[0];
  if (!booth) throw new Error('選択できるブースがありません');

  // 必須項目を設定から拾って埋める
  var answers = {};
  (cfg.fields || []).forEach(function (f) {
    if (DISPLAY_ONLY_TYPES.indexOf(f.type) >= 0) return;
    if (f.type === 'booth' || f.type === 'category' || f.type === 'image') return;

    if (f.id === 'email') { answers[f.id] = TEST_EMAIL; return; }
    if (f.type === 'tel') { answers[f.id] = '09000000000'; return; }
    if (f.type === 'postal') { answers[f.id] = '1000001'; return; }
    if (f.type === 'select' || f.type === 'radio') {
      var c = (f.choices || [])[0];
      answers[f.id] = c ? (typeof c === 'string' ? c : (c.value || c.label)) : '';
      return;
    }
    if (f.type === 'snsLinks') { answers[f.id] = []; return; }
    if (f.required) answers[f.id] = 'テスト' + (f.label || f.id);
  });
  answers.name = 'テスト太郎';

  // 選べるオプションを1つずつ入れてみる
  var options = {};
  ((cfg.pricing || {}).options || []).forEach(function (o) {
    if (o.enabled === false) return;
    var gate = resolveOptionForBooth(o, booth);
    if (!gate.available) return;
    if (o.inputType === 'toggle') options[o.id] = true;
    else if (o.inputType === 'quantity') options[o.id] = 1;
  });

  var params = {
    action: 'submit',
    answers: JSON.stringify(answers),
    selectedOptions: JSON.stringify(options),
    boothId: booth.id,
    category: (cfg.categories || [])[0] || '',
    isMember: '0',
    agreeTerms: '1',
    imageFieldIds: '[]',
    clientTotal: '0'
  };

  var res = doPost({ parameter: params });
  var out = res.getContent ? res.getContent() : JSON.stringify(res);
  console.log('テスト申込の結果: ' + out);
  console.log('宛先: ' + TEST_EMAIL);
  console.log('※ スプレッドシートにテスト行が入ります。確認後は手で削除してください。');
  return out;
}

/**
 * 確認メールの本文だけを組み立てて、実際に送らずに内容を確認する。
 * テンプレートの差し込みが正しいかを見るのに使います。
 */
function previewConfirmationMail() {
  var cfg = loadConfig(true);
  var booth = (cfg.booths || [])[0] || { id: '', name: 'サンプルブース', prices: {} };

  var answers = {};
  (cfg.fields || []).forEach(function (f) {
    if (DISPLAY_ONLY_TYPES.indexOf(f.type) >= 0) return;
    if (f.type === 'booth' || f.type === 'category') return;
    answers[f.id] = 'サンプル（' + (f.label || f.id) + '）';
  });
  answers.name = 'テスト太郎';
  answers.email = 'test@example.com';

  var quote = computeQuote(cfg, { boothId: booth.id, options: {}, isMember: false });

  var record = {
    eventName: (cfg.event || {}).name || '',
    submittedAt: nowJst(),
    name: answers.name,
    email: answers.email,
    boothName: booth.name,
    category: (cfg.categories || [])[0] || '',
    answers: answers,
    options: quote.options,
    total: quote.total,
    breakdown: formatBreakdown(quote)
  };

  var subject = renderTemplate(
    (cfg.email || {}).confirmationSubject || '【{{eventName}}】お申込みを受け付けました',
    cfg, record);
  var body = renderTemplate(
    (cfg.email || {}).confirmationBodyTemplate || defaultConfirmationBody(),
    cfg, record);

  var text = '=== 件名 ===\n' + subject + '\n\n=== 本文 ===\n' + body;

  // 展開されずに残った記法があれば知らせる
  var leftover = body.match(/\{\{[^}]+\}\}/g);
  if (leftover) {
    text += '\n\n⚠️ 展開されなかった差し込み: ' + leftover.join(', ');
  }

  console.log(text);
  return text;
}

// ========================================
// フル機能テスト
// ========================================

/**
 * 申込1件が最後まで通るかを、実物の Google サービスを使って通しで確認する。
 *
 * スプレッドシートの作成 → ヘッダー生成 → 画像の Drive 保存 → 行の転記 →
 * 確認メールの送信 → リピーター照合 まで、実際に動かして結果を報告します。
 *
 * 実行前に必ず checkSetup() を通してください。
 * 作られたテスト行は cleanupTestData() で消せます。
 *
 * ⚠️ 検証用のプロジェクトで実行してください。稼働中のプロジェクトで実行すると
 *    本番のスプレッドシートにテスト行が入ります。
 */
function runFullTest() {
  var lines = [];
  var failed = 0;

  function head(m) { lines.push(''); lines.push('=== ' + m + ' ==='); }
  function ok(m)   { lines.push('✅ ' + m); }
  function warn(m) { lines.push('⚠️ ' + m); }
  function bad(m)  { lines.push('❌ ' + m); failed++; }

  function finish() {
    lines.push('');
    lines.push(failed
      ? '判定: ❌ が ' + failed + '件あります。上の内容を確認してください。'
      : '判定: すべて通りました。');
    lines.push('テスト行を消すには cleanupTestData() を実行してください。');
    var text = lines.join('\n');
    console.log(text);
    return text;
  }

  var me = Session.getEffectiveUser().getEmail();

  // --- 0. 本番から切り離されているかを先に確かめる ---
  head('本番から切り離されているか');

  var token  = getProp(PROP.GITHUB_TOKEN);
  var branch = getProp(PROP.GITHUB_BRANCH);
  if (token && (!branch || branch === 'main' || branch === 'master')) {
    bad('GITHUB_BRANCH が「' + (branch || '未設定') + '」です。'
      + 'この状態で管理画面の保存を押すと、稼働中のフォームの設定が書き換わります。'
      + '検証用のブランチ名を入れてから実行してください。');
    lines.push('');
    lines.push('中止しました（本番に影響する設定のため）。');
    var aborted = lines.join('\n');
    console.log(aborted);
    return aborted;
  }
  ok(token ? 'GitHub の書き込み先は ' + branch + ' ブランチです' : 'GitHub への書き込みは無効です');
  lines.push('   設定の取得元: ' + getProp(PROP.CONFIG_JSON_URL));
  lines.push('   実行ユーザー: ' + me);

  // --- 1. 設定 ---
  head('設定');
  var cfg;
  try {
    cfg = loadConfig(true);
    ok('config.json を取得しました（' + ((cfg.event || {}).name || '名称未設定') + '）');
  } catch (e) {
    bad('config.json を取得できません: ' + e.message);
    return finish();
  }

  var errors = validateConfig(cfg).filter(function (i) { return i.level === 'error'; });
  if (errors.length) {
    errors.forEach(function (i) { bad('設定の誤り: ' + i.message); });
    return finish();
  }
  ok('設定に致命的な誤りはありません');

  // --- 2. 保存先の作成 ---
  head('スプレッドシートとフォルダ');
  var setup;
  try {
    setup = setupNewEvent({});
    setup.steps.forEach(function (s) {
      lines.push('   ' + s.step + ': ' + s.message);
    });
    ok('保存先を用意しました');
  } catch (e) {
    bad('保存先を用意できません: ' + e.message);
    return finish();
  }

  var currentId  = getProp(PROP.CURRENT_SPREADSHEET_ID);
  var databaseId = getProp(PROP.DATABASE_SPREADSHEET_ID);

  // --- 3. 申込を1件通す ---
  head('申込の受付');
  var before = countRows(currentId);
  var built  = buildTestSubmission(cfg, me);
  var result;
  try {
    var res = doPost({ parameter: built.params });
    result = JSON.parse(res.getContent());
  } catch (e) {
    bad('申込の処理で例外: ' + e.message);
    return finish();
  }

  if (!result.success) {
    bad('申込が受け付けられません: ' + (result.error || JSON.stringify(result)));
    return finish();
  }
  ok('申込を受け付けました（合計 ' + formatYen(result.total) + '）');

  if (result.total !== built.expectedTotal) {
    bad('金額が想定と違います: サーバー ' + result.total + ' / 想定 ' + built.expectedTotal);
  } else {
    ok('金額が計算どおりです');
  }

  // --- 4. 転記の確認 ---
  head('スプレッドシートへの転記');
  if (countRows(currentId) !== before + 1) {
    bad('今回の申込データに行が増えていません');
  } else {
    ok('今回の申込データに1行増えました');
  }

  var row = findTestRow(currentId);
  if (!row) {
    bad('書き込まれた行を見つけられません');
  } else {
    ok('列の対応づけを確認しました（' + Object.keys(row.byKey).length + '列）');

    var written = row.byLabel['合計金額'];
    if (Number(written) !== result.total) {
      bad('合計金額の列が違います: ' + written + ' / 期待 ' + result.total);
    } else {
      ok('合計金額の列が正しく入っています');
    }

    var img = row.byKey[built.imageFieldId];
    if (built.imageFieldId) {
      if (img && String(img).indexOf('http') === 0) {
        ok('画像が Drive に保存されました: ' + img);
      } else {
        bad('画像のURLが行に入っていません（Drive への保存に失敗した可能性）');
      }
    }
  }

  if (databaseId && databaseId !== currentId) {
    if (findTestRow(databaseId)) ok('マスターDBにも転記されました');
    else bad('マスターDBに転記されていません');
  }

  // --- 5. メール ---
  head('確認メール');
  if (result.mailSent)        ok('確認メールを送信しました（宛先 ' + me + '・受信箱を確認してください）');
  else if (result.mailQueued) warn('送信枠が尽きたためキューに積まれました。runMailQueueNow() で再試行できます');
  else                        bad('確認メールが送信されず、キューにも積まれていません');

  var body = renderTemplate(
    (cfg.email || {}).confirmationBodyTemplate || defaultConfirmationBody(),
    cfg, buildPreviewRecord(cfg));
  var leftover = body.match(/\{\{[^}]+\}\}/g);
  if (leftover) bad('メール本文に展開されない差し込みが残っています: ' + leftover.join(', '));
  else          ok('メール本文の差し込みはすべて展開されました');

  if (body.indexOf('¥¥') >= 0) bad('メール本文の金額が「¥¥」と二重になっています');

  lines.push('   本日あと ' + remainingQuota() + ' 宛先に送信できます');

  // --- 6. リピーター照合 ---
  head('リピーター照合');
  var rep = cfg.repeater || {};
  if (!rep.enabled) {
    warn('リピーター機能が無効なので飛ばしました');
  } else {
    try {
      var sent = JSON.parse(handleSendAuthCode({
        name: built.applicantName, email: me
      }).getContent());

      if (!sent.success) {
        bad('過去の申込を照合できません: ' + sent.error);
      } else {
        ok('過去の申込 ' + sent.count + '件と照合し、認証コードを送りました');

        var code = CacheService.getScriptCache().get('auth_code_' + normalizeForMatch(me));
        if (!code) {
          bad('認証コードが保存されていません');
        } else {
          var verified = JSON.parse(handleVerifyAuthCode({
            name: built.applicantName, email: me, code: code
          }).getContent());

          if (verified.success && verified.list && verified.list.length) {
            ok('認証コードで過去の申込を読み出せました（' + verified.list.length + '件）');
          } else {
            bad('認証コードの検証に失敗しました: ' + (verified.error || ''));
          }
        }
      }
    } catch (e) {
      bad('リピーター照合で例外: ' + e.message);
    }
  }

  return finish();
}

/** テスト申込のパラメータを組み立て、想定金額も一緒に返す */
function buildTestSubmission(cfg, email) {
  var booth = (cfg.booths || []).filter(function (b) { return !b.soldOut; })[0];
  if (!booth) throw new Error('選択できるブースがありません');

  var applicantName = TEST_MARKER + ' 太郎';
  var answers = {};
  var imageFieldId = '';

  (cfg.fields || []).forEach(function (f) {
    if (DISPLAY_ONLY_TYPES.indexOf(f.type) >= 0) return;
    if (f.type === 'booth' || f.type === 'category') return;

    if (f.type === 'image') { if (!imageFieldId) imageFieldId = f.id; return; }
    if (f.id === 'name')    { answers[f.id] = applicantName; return; }
    if (f.id === 'email' || f.type === 'email') { answers[f.id] = email; return; }
    if (f.type === 'tel')    { answers[f.id] = '09000000000'; return; }
    if (f.type === 'postal') { answers[f.id] = '2500011'; return; }
    if (f.type === 'snsLinks') { answers[f.id] = [{ type: 'HP', url: 'https://example.com' }]; return; }
    if (f.type === 'select' || f.type === 'radio') {
      var c = (f.choices || [])[0];
      answers[f.id] = c ? (typeof c === 'string' ? c : (c.value || c.label)) : '';
      return;
    }
    if (f.type === 'checkboxGroup') {
      var c2 = (f.choices || [])[0];
      answers[f.id] = c2 ? [typeof c2 === 'string' ? c2 : (c2.value || c2.label)] : [];
      return;
    }
    answers[f.id] = TEST_MARKER + (f.label || f.id);
  });
  answers.name = applicantName;

  // 選べるオプションを1つずつ入れる（ブース別の可否は computeQuote が判定する）
  var options = {};
  ((cfg.pricing || {}).options || []).forEach(function (o) {
    if (o.enabled === false) return;
    var gate = resolveOptionForBooth(o, booth);
    if (!gate.available) return;
    if (o.inputType === 'toggle') options[o.id] = true;
    else if (o.inputType === 'quantity') options[o.id] = 1;
  });

  var quote = computeQuote(cfg, { boothId: booth.id, options: options, isMember: false });

  var params = {
    action: 'submit',
    eventName: (cfg.event || {}).name || '',
    answers: JSON.stringify(answers),
    selectedOptions: JSON.stringify(options),
    boothId: booth.id,
    boothName: booth.name,
    category: (cfg.categories || [])[0] || '',
    isMember: '0',
    agreeTerms: '1',
    clientTotal: String(quote.total),
    imageFieldIds: JSON.stringify(imageFieldId ? [imageFieldId] : [])
  };

  if (imageFieldId) {
    params['image_' + imageFieldId + '_base64'] = TEST_IMAGE_BASE64;
    params['image_' + imageFieldId + '_mime']   = 'image/png';
    params['image_' + imageFieldId + '_name']   = 'test.png';
  }

  return {
    params: params,
    expectedTotal: quote.total,
    applicantName: applicantName,
    imageFieldId: imageFieldId
  };
}

/** メール文面の確認に使う、送信しないダミーの申込 */
function buildPreviewRecord(cfg) {
  var booth = (cfg.booths || [])[0] || { id: '', name: 'サンプルブース' };
  var answers = {};
  (cfg.fields || []).forEach(function (f) {
    if (DISPLAY_ONLY_TYPES.indexOf(f.type) >= 0) return;
    if (f.type === 'booth' || f.type === 'category') return;
    answers[f.id] = 'サンプル（' + (f.label || f.id) + '）';
  });
  answers.name = 'テスト太郎';
  answers.email = 'test@example.com';

  var quote = computeQuote(cfg, { boothId: booth.id, options: {}, isMember: false });

  return {
    eventName: (cfg.event || {}).name || '',
    submittedAt: nowJst(),
    name: answers.name,
    email: answers.email,
    boothName: booth.name,
    category: (cfg.categories || [])[0] || '',
    answers: answers,
    options: quote.options,
    total: quote.total,
    breakdown: formatBreakdown(quote)
  };
}

function countRows(spreadsheetId) {
  if (!spreadsheetId) return 0;
  try {
    var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(SHEET_NAME);
    return sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
  } catch (e) {
    return 0;
  }
}

/** 目印の付いた行のうち、最後に書かれたものを返す */
function findTestRow(spreadsheetId) {
  var data = readRows(spreadsheetId);
  for (var i = data.rows.length - 1; i >= 0; i--) {
    if (rowHasMarker(data.rows[i])) return data.rows[i];
  }
  return null;
}

function rowHasMarker(row) {
  for (var i = 0; i < row.raw.length; i++) {
    if (String(row.raw[i]).indexOf(TEST_MARKER) >= 0) return true;
  }
  return false;
}

/**
 * runFullTest() が作ったテスト行を消す。
 * 目印（TEST_MARKER）を含む行だけが対象で、本物の申込には触れません。
 */
function cleanupTestData() {
  var lines = [];

  [[PROP.CURRENT_SPREADSHEET_ID, '今回の申込データ'],
   [PROP.DATABASE_SPREADSHEET_ID, 'マスターDB']].forEach(function (target) {
    var id = getProp(target[0]);
    if (!id) { lines.push('— ' + target[1] + ': 未作成'); return; }

    var data = readRows(id);
    var sheet = SpreadsheetApp.openById(id).getSheetByName(SHEET_NAME);
    var removed = 0;

    // 行番号がずれないよう下から消す
    for (var i = data.rows.length - 1; i >= 0; i--) {
      if (!rowHasMarker(data.rows[i])) continue;
      sheet.deleteRow(data.rows[i].rowIndex);
      removed++;
    }
    lines.push('🧹 ' + target[1] + ': ' + removed + '行を削除しました');
  });

  lines.push('※ Drive に保存されたテスト画像は消していません。フォルダから手で削除してください。');

  var text = lines.join('\n');
  console.log(text);
  return text;
}

/**
 * このプロジェクトの自動実行（トリガー）をすべて外す。
 * 検証用のプロジェクトを片付けるときに使います。
 */
function removeTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  var text = triggers.length + '件のトリガーを削除しました';
  console.log(text);
  return text;
}

/**
 * 送信待ちのメールを今すぐ処理する。
 * 送信枠が回復したあと、トリガーを待たずに流したいときに使います。
 */
function runMailQueueNow() {
  var result = processMailQueue();
  console.log(result.sent + '件送信、' + result.remaining + '件残り');
  return result;
}

/**
 * 日次ダイジェストを今すぐ送る（前日分）。
 */
function sendDigestNowManual() {
  var result = sendDailyDigest();
  console.log(JSON.stringify(result));
  return result;
}
