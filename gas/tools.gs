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
