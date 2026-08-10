/**
 * 旧スプレッドシートからマスターDBへの移送
 *
 * 既存の申込データはスタッフ個人の Google アカウントが所有しているため、
 * オーナー移管ではなく「閲覧権限をもらって読み出し、主催者所有の新しい
 * マスターDBへ書き写す」方式を取ります。
 *   - 依頼が軽い（オーナー移管の受諾フローが不要）
 *   - 新スキーマへの列変換がどのみち必要
 *   - 新DBは主催者アカウントの GAS が作るので、所有者が構造的に保証される
 *
 * 旧スプレッドシートは読み取るだけで、一切変更しません。
 *
 * 事前準備:
 *   1. スタッフに旧スプレッドシートの閲覧権限を主催者アカウントへ付与してもらう
 *   2. スクリプトプロパティ LEGACY_SPREADSHEET_ID に旧スプシのIDを設定
 *   3. 管理画面から「過去データを移送」を実行（まず下見モードで確認）
 */

/**
 * @param {Object} opts { sourceId, dryRun }
 * @returns {Object} 移送結果。dryRun なら書き込まずに対応表だけ返す。
 */
function migrateLegacySpreadsheet(opts) {
  opts = opts || {};
  var sourceId = opts.sourceId;
  if (!sourceId) {
    throw new Error('移送元のスプレッドシートIDが指定されていません。');
  }

  var targetId = getProp(PROP.DATABASE_SPREADSHEET_ID);
  if (!targetId) {
    throw new Error('マスターDBが未作成です。先に「新規開催回を始める」を実行してください。');
  }
  if (sourceId === targetId) {
    throw new Error('移送元と移送先が同じです。');
  }

  var cfg = loadConfig();

  // --- 移送元を読む ---
  var srcSs;
  try {
    srcSs = SpreadsheetApp.openById(sourceId);
  } catch (e) {
    throw new Error('移送元のスプレッドシートを開けませんでした。'
      + '主催者アカウントに閲覧権限が付与されているかご確認ください。');
  }

  var srcSheet = pickDataSheet(srcSs);
  if (!srcSheet || srcSheet.getLastRow() < 2) {
    return { migrated: 0, skipped: 0, mapping: [], message: '移送元にデータがありません。' };
  }

  var values = srcSheet.getDataRange().getValues();
  var srcLabels = values[0].map(function (v) { return String(v).trim(); });

  // --- 列の対応づけ ---
  // 旧シートの列ラベルを、新スキーマの fieldId へ対応させる
  var mapping = buildLegacyMapping(cfg, srcLabels);

  if (opts.dryRun) {
    return {
      dryRun: true,
      sourceRows: values.length - 1,
      mapping: mapping.report,
      unmapped: mapping.unmapped,
      message: values.length - 1 + '件を移送できます。対応表をご確認ください。'
    };
  }

  // --- 既存データとの重複を避ける ---
  var existing = readRows(targetId);
  var seen = {};
  existing.rows.forEach(function (r) {
    seen[dedupeKey(
      r.byKey['name'] || r.byLabel['氏名'] || '',
      r.byKey['email'] || r.byLabel['メールアドレス'] || '',
      r.byKey['__submittedAt'] || r.byLabel['申込日時'] || ''
    )] = true;
  });

  var migrated = 0;
  var skipped = 0;

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var answers = {};

    Object.keys(mapping.labelToFieldId).forEach(function (label) {
      var col = srcLabels.indexOf(label);
      if (col < 0) return;
      var v = row[col];
      if (v === '' || v == null) return;
      answers[mapping.labelToFieldId[label]] = v;
    });

    var name = String(answers.name || '');
    var email = String(answers.email || '');
    if (!name && !email) { skipped++; continue; }

    var submittedAt = valueAt(row, srcLabels, ['申込日時', 'タイムスタンプ']);
    var key = dedupeKey(name, email, submittedAt);
    if (seen[key]) { skipped++; continue; }
    seen[key] = true;

    var record = {
      eventName: String(valueAt(row, srcLabels, ['開催回', '元ファイル名']) || '（移送データ）'),
      submittedAt: submittedAt ? formatCellDate(submittedAt) : '',
      name: name,
      email: email,
      category: String(answers.category || ''),
      boothId: '',
      boothName: String(valueAt(row, srcLabels, ['出展ブース']) || ''),
      answers: answers,
      options: {},
      isMember: String(valueAt(row, srcLabels, ['協会会員']) || '') === 'はい',
      isEarlyBird: false,
      total: Number(valueAt(row, srcLabels, ['合計金額'])) || 0,
      lineUserId: String(valueAt(row, srcLabels, ['LINEユーザーID']) || ''),
      lineDisplayName: String(valueAt(row, srcLabels, ['LINE表示名']) || '')
    };

    appendSubmission(targetId, cfg, record, { isMaster: true });
    migrated++;
  }

  return {
    migrated: migrated,
    skipped: skipped,
    sourceRows: values.length - 1,
    mapping: mapping.report,
    unmapped: mapping.unmapped,
    message: migrated + '件を移送しました（重複・空行 ' + skipped + '件をスキップ）。'
  };
}

/** 申込データらしいシートを選ぶ */
function pickDataSheet(ss) {
  var byName = ss.getSheetByName(SHEET_NAME);
  if (byName) return byName;

  // 行数が最も多いシートを採用する
  var sheets = ss.getSheets();
  var best = null;
  sheets.forEach(function (s) {
    if (s.getName().indexOf('_') === 0) return;
    if (!best || s.getLastRow() > best.getLastRow()) best = s;
  });
  return best;
}

/**
 * 旧シートの列ラベル → 新スキーマの fieldId の対応を作る。
 *
 * 1. 新設定の項目ラベルと完全一致するもの
 * 2. 旧システムで使われていた既知の列名（別名表）
 * を順に当てる。当たらなかった列は unmapped として報告し、人が確認できるようにする。
 */
function buildLegacyMapping(cfg, srcLabels) {
  var labelToFieldId = {};
  var report = [];
  var unmapped = [];

  // 新設定の項目ラベル
  var byLabel = {};
  (cfg.fields || []).forEach(function (f) {
    if (f.label) byLabel[String(f.label).trim()] = f.id;
  });

  // 旧システムの列名（東京版・小田原版で使われていたもの）
  var aliases = {
    '氏名': 'name',
    'お名前': 'name',
    'お名前（本名）': 'name',
    'フリガナ': 'furigana',
    'ふりがな': 'furigana',
    'メールアドレス': 'email',
    '電話番号': 'phoneNumber',
    '郵便番号': 'postalCode',
    '住所': 'address',
    'ご住所': 'address',
    '出展カテゴリ': 'category',
    '出展名': 'exhibitorName',
    '出展メニュー': 'cq_menu',
    '出展メニュー名': 'cq_menu',
    '自己紹介': 'cq_intro',
    '一言PR': 'cq_pr',
    'SNS': 'snsLinks',
    '写真掲載可否': 'photoPermission',
    'プロフィール写真': 'profileImage',
    '備考・質問': 'notes',
    '質問・備考': 'notes',
    'ボディーブース持ち込み物品': 'equipment',
    '景品内容': 'prizeContent',
    '景品提供': 'stampRallyPrize',
    '得意ジャンル': 'cq_genres',
    '事前予約': 'cq_reservation'
  };

  // 新設定に存在する fieldId だけを対象にする
  var knownIds = {};
  (cfg.fields || []).forEach(function (f) { knownIds[f.id] = true; });

  srcLabels.forEach(function (label) {
    if (!label) return;

    var fieldId = byLabel[label] || aliases[label];
    if (fieldId && knownIds[fieldId]) {
      labelToFieldId[label] = fieldId;
      report.push({ from: label, to: fieldId });
    } else {
      unmapped.push(label);
    }
  });

  return { labelToFieldId: labelToFieldId, report: report, unmapped: unmapped };
}

function valueAt(row, labels, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var idx = labels.indexOf(candidates[i]);
    if (idx >= 0) return row[idx];
  }
  return '';
}

/** 同じ申込を二重に取り込まないための鍵 */
function dedupeKey(name, email, submittedAt) {
  return normalizeForMatch(name) + '|' + normalizeForMatch(email) + '|'
       + normalizeForMatch(String(submittedAt).slice(0, 16));
}
