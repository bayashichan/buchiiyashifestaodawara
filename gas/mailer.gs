/**
 * メール送信
 *
 * 主催者アカウントは無料 Gmail のため、Apps Script の送信枠は 1日100「宛先」です
 * （通数ではなく宛先数）。この制約の下で運用が破綻しないよう、次の方針を取ります。
 *
 *   1. 申込者への確認メールを最優先で即時送信する
 *   2. 管理者への通知は1件ごとに送らず、1日1通のダイジェストにまとめる
 *   3. 枠が尽きたら確認メールを送信待ちキューに積み、翌日のトリガーで送る
 *   4. 申込データの保存は必ずメール送信より先に完了させる
 *      （メールが送れなくても申込そのものは失わない）
 */

/** 認証コードなど即時性の高い用途のために残しておく宛先数 */
var QUOTA_RESERVE = 3;

function remainingQuota() {
  try {
    return MailApp.getRemainingDailyQuota();
  } catch (e) {
    console.warn('quota check failed: ' + e.message);
    return 0;
  }
}

/** 通常のメールを送ってよいか（予備分を残して判断する） */
function hasQuotaForNormalMail() {
  return remainingQuota() > QUOTA_RESERVE;
}

/** 認証コードは予備分まで使ってよい */
function hasQuotaForAuthMail() {
  return remainingQuota() > 0;
}

// ========================================
// 申込確認メール
// ========================================

/**
 * 申込者へ確認メールを送る。枠が足りなければキューに積む。
 * @returns {Object} { sent: boolean, queued: boolean }
 */
function sendConfirmationMail(cfg, record) {
  var email = record.email;
  if (!email) return { sent: false, queued: false };

  var subject = renderTemplate(
    (cfg.email || {}).confirmationSubject || '【{{eventName}}】お申込みを受け付けました',
    cfg, record);
  var body = renderTemplate((cfg.email || {}).confirmationBodyTemplate || defaultConfirmationBody(),
    cfg, record);

  if (!hasQuotaForNormalMail()) {
    enqueueMail(email, subject, body);
    return { sent: false, queued: true };
  }

  try {
    MailApp.sendEmail({
      to: email,
      subject: subject,
      body: body,
      name: senderName(cfg),
      replyTo: replyToEmail()
    });
    return { sent: true, queued: false };
  } catch (e) {
    console.error('confirmation mail failed: ' + e.message);
    enqueueMail(email, subject, body);
    return { sent: false, queued: true };
  }
}

function senderName(cfg) {
  return getProp(PROP.SENDER_NAME) ||
         (cfg.email || {}).adminSenderName ||
         ((cfg.event || {}).name || '') + ' 事務局';
}

function replyToEmail() {
  return getProp(PROP.REPLY_TO_EMAIL) || getProp(PROP.ADMIN_EMAIL) || '';
}

function defaultConfirmationBody() {
  return [
    '{{name}} 様',
    '',
    'この度は「{{eventName}}」へのお申込みありがとうございます。',
    '以下の内容で受け付けました。',
    '',
    '■ お申込み内容',
    '{{answers}}',
    '',
    '■ ご請求金額',
    '{{breakdown}}',
    '合計: {{totalFee}}',
    '',
    '{{eventName}} 事務局'
  ].join('\n');
}

// ========================================
// テンプレート置換
// ========================================

/**
 * 差し込み記法:
 *   {{name}} {{email}} {{eventName}} {{eventDate}} {{eventLocation}}
 *   {{boothName}} {{category}} {{breakdown}} {{totalFee}} {{answers}}
 *   {{field:任意の項目ID}}
 */
function renderTemplate(template, cfg, record) {
  if (!template) return '';
  var ev = cfg.event || {};

  var map = {
    name: record.name || '',
    email: record.email || '',
    eventName: ev.name || '',
    eventDate: ev.date || '',
    eventLocation: ev.location || '',
    boothName: record.boothName || '',
    category: record.category || '',
    breakdown: record.breakdown || '',
    totalFee: formatYen(record.total || 0),
    answers: formatAnswersForMail(cfg, record)
  };

  var out = String(template);

  // {{field:xxx}} を先に処理する
  out = out.replace(/\{\{\s*field:([^}\s]+)\s*\}\}/g, function (m, fieldId) {
    var v = record.answers ? record.answers[fieldId] : '';
    return String(formatAnswer(v));
  });

  out = out.replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, key) {
    return (key in map) ? String(map[key]) : m;
  });

  return out;
}

/** 申込内容を「項目名: 値」の一覧にする */
function formatAnswersForMail(cfg, record) {
  var lines = [];
  (cfg.fields || []).forEach(function (f) {
    if (DISPLAY_ONLY_TYPES.indexOf(f.type) >= 0) return;
    var v = record.answers ? record.answers[f.id] : '';
    if (v == null || v === '') return;
    lines.push((f.label || f.id) + ': ' + formatAnswer(v));
  });
  return lines.join('\n');
}

// ========================================
// 送信待ちキュー
// ========================================

/** キューは今回イベント用スプレッドシートの非表示シートに置く */
function queueSheet() {
  var id = getProp(PROP.CURRENT_SPREADSHEET_ID);
  if (!id) return null;

  var ss = SpreadsheetApp.openById(id);
  var sheet = ss.getSheetByName(QUEUE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(QUEUE_SHEET_NAME);
    sheet.appendRow(['積んだ日時', '宛先', '件名', '本文', '状態', '送信日時']);
    sheet.hideSheet();
  }
  return sheet;
}

function enqueueMail(to, subject, body) {
  var sheet = queueSheet();
  if (!sheet) {
    console.error('メールキューに積めませんでした（スプレッドシート未設定）: ' + to);
    return;
  }
  sheet.appendRow([nowJst(), to, subject, body, 'pending', '']);
  console.log('メール送信枠が不足のためキューに積みました: ' + to);
}

/**
 * キューを消化する。時間主導トリガーで1日1回以上動かす。
 * 枠が尽きたら途中で止め、残りは次回に回す。
 */
function processMailQueue() {
  var sheet = queueSheet();
  if (!sheet || sheet.getLastRow() < 2) return { sent: 0, remaining: 0 };

  var values = sheet.getDataRange().getValues();
  var sent = 0;
  var remaining = 0;

  for (var i = 1; i < values.length; i++) {
    if (values[i][4] !== 'pending') continue;

    if (!hasQuotaForNormalMail()) { remaining++; continue; }

    try {
      MailApp.sendEmail({
        to: values[i][1],
        subject: values[i][2],
        body: values[i][3],
        name: getProp(PROP.SENDER_NAME) || '事務局',
        replyTo: replyToEmail()
      });
      sheet.getRange(i + 1, 5).setValue('sent');
      sheet.getRange(i + 1, 6).setValue(nowJst());
      sent++;
    } catch (e) {
      console.error('キューの送信に失敗: ' + e.message);
      remaining++;
    }
  }

  console.log('メールキュー: ' + sent + '件送信、' + remaining + '件残り');
  return { sent: sent, remaining: remaining };
}

// ========================================
// 日次ダイジェスト（管理者向け）
// ========================================

/**
 * 前日分の申込をまとめて管理者へ1通送る。時間主導トリガーで毎朝実行する。
 * 申込が0件の日は送らない（送信枠の節約とノイズ削減）。
 */
function sendDailyDigest() {
  var adminEmail = getProp(PROP.ADMIN_EMAIL);
  if (!adminEmail) {
    console.warn('ADMIN_EMAIL が未設定のためダイジェストを送れません');
    return { sent: false, reason: 'no-admin-email' };
  }

  var cfg = loadConfig();
  var summary = buildDigest(cfg, 1);

  if (!summary.count) {
    console.log('前日の申込が0件のためダイジェストは送信しません');
    return { sent: false, reason: 'no-submissions' };
  }

  if (!hasQuotaForAuthMail()) {
    console.warn('送信枠が尽きているためダイジェストを見送ります');
    return { sent: false, reason: 'no-quota' };
  }

  MailApp.sendEmail({
    to: adminEmail,
    subject: '【' + ((cfg.event || {}).name || 'イベント') + '】申込ダイジェスト '
           + summary.dateLabel + '（' + summary.count + '件）',
    body: summary.body,
    name: senderName(cfg)
  });

  return { sent: true, count: summary.count };
}

/** 管理画面の「今すぐ送る」から呼ぶ */
function sendDigestNow(days) {
  var adminEmail = getProp(PROP.ADMIN_EMAIL);
  if (!adminEmail) throw new Error('ADMIN_EMAIL が未設定です');

  var cfg = loadConfig();
  var summary = buildDigest(cfg, days || 1);

  if (!hasQuotaForAuthMail()) throw new Error('本日のメール送信枠が残っていません');

  MailApp.sendEmail({
    to: adminEmail,
    subject: '【' + ((cfg.event || {}).name || 'イベント') + '】申込ダイジェスト（'
           + summary.count + '件）',
    body: summary.body,
    name: senderName(cfg)
  });
  return summary;
}

/**
 * 直近 days 日分の申込を集計する。
 * 件数・合計金額・ブース別内訳・申込者一覧・未入金者数を返す。
 */
function buildDigest(cfg, days) {
  var spreadsheetId = getProp(PROP.CURRENT_SPREADSHEET_ID);
  if (!spreadsheetId) {
    return { count: 0, body: 'スプレッドシートが未設定です。', dateLabel: '' };
  }

  var data = readRows(spreadsheetId);
  var since = new Date();
  since.setDate(since.getDate() - (days || 1));
  since.setHours(0, 0, 0, 0);

  var recent = data.rows.filter(function (r) {
    var t = r.byKey['__submittedAt'] || r.byLabel['申込日時'];
    var d = parseSheetDate(t);
    return d && d.getTime() >= since.getTime();
  });

  var total = 0;
  var byBooth = {};
  var unpaid = 0;
  var lines = [];

  recent.forEach(function (r) {
    var amount = Number(r.byLabel['合計金額']) || 0;
    total += amount;

    var booth = String(r.byKey['booth'] || r.byLabel['出展ブース'] || '未設定');
    byBooth[booth] = (byBooth[booth] || 0) + 1;

    if (!String(r.byLabel['入金確認'] || '').trim()) unpaid++;

    var name = r.byKey['name'] || r.byLabel['お名前（本名）'] || '';
    var exhibitor = r.byKey['exhibitorName'] || '';
    lines.push('・' + name + (exhibitor ? '（' + exhibitor + '）' : '')
             + ' / ' + booth + ' / ' + formatYen(amount));
  });

  var boothLines = Object.keys(byBooth).map(function (k) {
    return '  ' + k + ': ' + byBooth[k] + '件';
  });

  var dateLabel = Utilities.formatDate(since, 'Asia/Tokyo', 'M/d') + '以降';

  var body = [
    ((cfg.event || {}).name || 'イベント') + ' 申込ダイジェスト',
    dateLabel,
    '',
    '■ 新規申込: ' + recent.length + '件',
    '■ 金額合計: ' + formatYen(total),
    '■ 未入金:   ' + unpaid + '件',
    '',
    '■ ブース別',
    boothLines.length ? boothLines.join('\n') : '  （なし）',
    '',
    '■ 申込者',
    lines.length ? lines.join('\n') : '  （なし）',
    '',
    '── 累計 ' + data.rows.length + '件',
    'スプレッドシート: https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit',
    '',
    '※ このメールは1日1回の自動送信です。',
    '※ 本日のメール送信可能数: 残り' + remainingQuota() + '件'
  ].join('\n');

  return { count: recent.length, total: total, body: body, dateLabel: dateLabel };
}

function parseSheetDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  var d = new Date(String(v).replace(/\//g, '-').replace(' ', 'T'));
  if (!isNaN(d.getTime())) return d;
  d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ========================================
// トリガー設定
// ========================================

/**
 * 日次ダイジェストとキュー消化のトリガーを作る。
 * 初回セットアップ時に一度だけ実行する（重複作成はしない）。
 */
function installTriggers() {
  var existing = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction();
  });

  if (existing.indexOf('sendDailyDigest') < 0) {
    ScriptApp.newTrigger('sendDailyDigest').timeBased().atHour(8).everyDays(1).create();
  }
  if (existing.indexOf('processMailQueue') < 0) {
    // 送信枠は太平洋時間の深夜にリセットされるので、朝一で先にキューを流す
    ScriptApp.newTrigger('processMailQueue').timeBased().atHour(7).everyDays(1).create();
  }
  return ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
}
