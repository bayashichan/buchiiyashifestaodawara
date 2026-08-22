/**
 * ================================================================
 * ぶち癒しフェスタ 申込フォーム バックエンド v2
 * ================================================================
 *
 * v1（現行）からの変更点
 *   1. 受付スプレッドシートは「今ある1行目のヘッダーをそのまま尊重」して書き込みます。
 *      ヘッダーの並び替え・上書きは一切行いません（現状の受付を維持するため）。
 *   2. 開催回をまたいで蓄積する「データベース用スプレッドシート」へ同時保存します。
 *      （applications / exhibitors / events の3シート）
 *   3. リピーター検索（前回データ呼び出し）はデータベース側を参照します。
 *      受付スプシしか無い場合は自動的にそちらへフォールバックします。
 *   4. データベースへの書き込みが失敗しても、受付への保存とメール送信は止めません。
 *
 * 【デプロイ】
 *   - ウェブアプリとしてデプロイ
 *     「次のユーザーとして実行」: 自分
 *     「アクセスできるユーザー」: 全員
 *   - 発行された /exec URL を config.json の gasUrl に設定
 *
 * 【初回のみ手動実行する関数】
 *   - setupDatabase()             … DBスプシを整形（既存シートは自動バックアップ）
 *   - migrateReceptionToDatabase() … 現在の受付スプシの内容をDBへ取り込み
 *   （どちらも何度実行しても重複しません）
 */

// ================================================================
// 設定
// ================================================================

/** 唯一のハードコード設定。config.json の公開URL。 */
const CONFIG_JSON_URL = 'https://bayashichan.github.io/buchiiyashifestaodawara/apply/config.json';

/** 受付スプレッドシートのシート名（現行のまま） */
const RECEPTION_SHEET_NAME = '申込データ';

/** データベーススプレッドシートのシート名 */
const DB_SHEET_APPLICATIONS = 'applications';
const DB_SHEET_EXHIBITORS   = 'exhibitors';
const DB_SHEET_EVENTS       = 'events';

/** config キャッシュ秒数 */
const CONFIG_CACHE_SEC = 1800;

/** 写真が届いていないときに、写真欄へ入れる目印 */
const PHOTO_PENDING_LABEL = 'LINE送付待ち';

// ---------------------------------------------------------------
// データベース列定義（1行目のヘッダーとして書き込まれます）
// 並び順を変えると既存データとずれるため、追加は必ず末尾へ。
// ---------------------------------------------------------------

const DB_APPLICATION_HEADERS = [
  '申込ID',
  '開催回ID',
  '開催回',
  'イベント名',
  '出展者ID',
  '申込日時',
  '氏名',
  'フリガナ',
  'メールアドレス',
  '電話番号',
  '郵便番号',
  '住所',
  '出展カテゴリ',
  '出展名',
  '出展ブース',
  '出展メニュー名',
  '自己紹介',
  '持ち込み物品',
  'SNS',
  '写真掲載可否',
  'プロフィール写真',
  'コンセント',
  '懇親会出欠',
  '懇親会人数',
  '二次会出欠',
  '二次会人数',
  '協会会員',
  '景品提供',
  '景品内容',
  '備考・質問',
  '座席番号',
  '合計金額',
  '入金確認',
  '入金日',
  'ステータス',
  'スタッフメモ',
  'LINEユーザーID',
  'LINE表示名',
  '登録元',
  '登録日時'
];

const DB_EXHIBITOR_HEADERS = [
  '出展者ID',
  'メールキー',
  '氏名',
  'フリガナ',
  'メールアドレス',
  '電話番号',
  '郵便番号',
  '住所',
  '最新出展名',
  '最新出展カテゴリ',
  '最新出展メニュー名',
  '最新自己紹介',
  '最新SNS',
  '最新プロフィール写真',
  '出展回数',
  '初回申込日時',
  '最終申込日時',
  '最終開催回',
  'スタッフメモ'
];

const DB_EVENT_HEADERS = [
  '開催回ID',
  '開催回',
  'イベント名',
  '開催日時',
  '会場',
  '受付スプレッドシートID',
  '申込件数',
  '登録日時'
];

// ================================================================
// Config 取得
// ================================================================

function getConfig() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get('config');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* 壊れていたら取り直す */ }
  }

  const res = UrlFetchApp.fetch(CONFIG_JSON_URL, {
    muteHttpExceptions: true,
    headers: { 'Cache-Control': 'no-cache' }
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('config.json の取得に失敗しました: ' + res.getContentText().slice(0, 200));
  }

  const config = JSON.parse(res.getContentText());
  cache.put('config', JSON.stringify(config), CONFIG_CACHE_SEC);
  return config;
}

/** 設定変更後、フォームへ即時反映させたいときに実行（管理画面のボタンからも呼べます） */
function clearConfigCache() {
  CacheService.getScriptCache().remove('config');
  console.log('Config cache cleared.');
}

// ================================================================
// doGet
// ================================================================

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || '';
  let result;

  try {
    switch (action) {
      case 'send_auth_code':
        result = handleSendAuthCode(params, getConfig());
        break;
      case 'verify_auth_code':
        result = handleVerifyAuthCode(params, getConfig());
        break;
      case 'get_exhibitors':
        result = handleGetExhibitors(getConfig());
        break;
      case 'clear_cache':
        result = handleClearCache(params);
        break;
      case 'create_reception_sheet':
        return handleCreateReceptionSheet(params);
      case 'status':
        result = handleStatus();
        break;
      default:
        result = { success: true, message: '申込フォーム バックエンド 稼働中', version: '2.0.0' };
    }
  } catch (err) {
    console.error('doGet error:', err);
    result = { success: false, error: err.message };
  }

  return jsonOutput_(result);
}

// ================================================================
// doPost（フォーム送信）
// ================================================================

function doPost(e) {
  let result;

  try {
    const config = getConfig();

    // パラメータ取得（FormData または JSON）
    let params = {};
    if (e && e.postData && e.postData.contents) {
      try {
        const json = JSON.parse(e.postData.contents);
        params = Object.assign({}, e.parameter, json);
      } catch (err) {
        params = e.parameter || {};
      }
    } else {
      params = (e && e.parameter) || {};
    }

    params.submittedAt = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

    validateRequiredFields(params);

    // 画像アップロード（前回写真を再利用する場合は profileImageUrl がそのまま来る）
    if (params.profileImageBase64 && params.profileImageBase64.length > 0) {
      params.profileImageUrl = saveProfileImage(params, config);
    }

    // 写真を受け取れたか（保存に失敗した場合もここで未受領になる）
    params.photoPending = !params.profileImageUrl;

    // カスタム質問
    params.customAnswers      = safeParseJson_(params.customAnswers, {});
    params.customQuestionDefs = safeParseJson_(params.customQuestionDefs, []);

    const calc = calculatePrice(params, config);

    // ---- 受付スプレッドシートへ保存（最優先） ----
    saveToReceptionSheet(params, calc, config);

    // ---- データベースへ保存（失敗しても受付は止めない） ----
    let dbResult = { saved: false };
    try {
      dbResult = saveToDatabase(params, calc, config);
    } catch (dbErr) {
      console.error('saveToDatabase error（受付処理は継続します）:', dbErr);
      dbResult = { saved: false, reason: 'エラー: ' + dbErr.message };
    }
    if (!dbResult.saved) {
      console.warn('データベースへ保存されませんでした: ' + (dbResult.reason || '理由不明'));
    }

    // ---- メール送信 ----
    try {
      sendConfirmationEmail(params, calc, config);
    } catch (mailErr) {
      console.error('sendConfirmationEmail error:', mailErr);
    }
    try {
      sendAdminEmail(params, calc, config, dbResult);
    } catch (mailErr) {
      console.error('sendAdminEmail error:', mailErr);
    }

    result = {
      success: true,
      totalFee: calc.totalFee,
      applicationId: dbResult.applicationId || '',
      databaseSaved: !!dbResult.saved,
      photoPending: !!params.photoPending
    };

  } catch (err) {
    console.error('doPost error:', err);
    result = { success: false, error: err.message };
  }

  return jsonOutput_(result);
}

// ================================================================
// バリデーション
// ================================================================

function validateRequiredFields(params) {
  const required = [
    { key: 'name',       label: 'お名前' },
    { key: 'email',      label: 'メールアドレス' },
    { key: 'boothId',    label: '出展ブース' },
    { key: 'agreeTerms', label: '規約への同意' }
  ];

  required.forEach(function (f) {
    if (!params[f.key] || String(params[f.key]).trim() === '') {
      throw new Error(f.label + 'が入力されていません');
    }
  });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.email)) {
    throw new Error('メールアドレスの形式が正しくありません');
  }
}

// ================================================================
// 料金計算
// ================================================================

function calculatePrice(params, config) {
  const booths = config.booths || [];
  const opts   = (config.pricing && config.pricing.options) || {};
  const booth  = booths.filter(function (b) { return b.id === params.boothId; })[0];

  if (!booth) throw new Error('ブース(' + params.boothId + ')が見つかりません');

  const isEarlyBird = params.isEarlyBird === '1';
  const boothPrice  = isEarlyBird ? booth.prices.earlyBird : booth.prices.regular;

  let total = boothPrice;
  const breakdown = { booth: boothPrice, staff: 0, chairs: 0, power: 0, party: 0, memberDiscount: 0 };

  const extraStaff = parseInt(params.extraStaff, 10) || 0;
  if (extraStaff > 0 && opts.staff && opts.staff.enabled) {
    breakdown.staff = extraStaff * opts.staff.price;
    total += breakdown.staff;
  }

  const extraChairs = parseInt(params.extraChairs, 10) || 0;
  if (extraChairs > 0 && opts.chair && opts.chair.enabled) {
    breakdown.chairs = extraChairs * opts.chair.price;
    total += breakdown.chairs;
  }

  if (params.usePower === '1' && booth.limits && booth.limits.allowPower && opts.power && opts.power.enabled) {
    breakdown.power = opts.power.price;
    total += breakdown.power;
  }

  const partyCount = parseInt(params.partyCount, 10) || 0;
  if (partyCount > 0 && opts.party && opts.party.enabled) {
    breakdown.party = partyCount * opts.party.price;
    total += breakdown.party;
  }

  const isMember = config.features && config.features.memberDiscount && params.isMember === '1';
  if (isMember && config.pricing && config.pricing.memberDiscount) {
    breakdown.memberDiscount = config.pricing.memberDiscount;
    total -= breakdown.memberDiscount;
  }

  return {
    totalFee: Math.max(0, total),
    boothName: booth.name,
    isEarlyBird: isEarlyBird,
    breakdown: breakdown
  };
}

// ================================================================
// 受付スプレッドシートへの保存
// ================================================================

/**
 * 受付シートの「現在の1行目」に合わせて1行追記します。
 * ヘッダーの書き換えは行いません（既存の運用列・手入力列を壊さないため）。
 */
function saveToReceptionSheet(params, calc, config) {
  const ss = SpreadsheetApp.openById(config.spreadsheetId);
  let sheet = ss.getSheetByName(RECEPTION_SHEET_NAME);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 受付シートがまだ無い（または空）の場合のみ、config からヘッダーを作成
    if (!sheet) sheet = ss.insertSheet(RECEPTION_SHEET_NAME);

    if (sheet.getLastRow() === 0) {
      const headers = buildReceptionHeaders(config);
      ensureColumnCount_(sheet, headers.length);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground('#374151')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    const headerRow = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
    const fieldMap  = buildFieldMap(params, calc, config);
    const rowData   = mapRowToHeaders_(headerRow, fieldMap);

    sheet.appendRow(rowData);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 受付シートを新規作成する場合のヘッダー（現行の並びを踏襲）
 */
function buildReceptionHeaders(config) {
  const headers = ['座席番号', '申込日時', '氏名', 'フリガナ', 'メールアドレス'];
  const sf   = config.standardFields || {};
  const f    = config.features       || {};
  const opts = (config.pricing && config.pricing.options) || {};

  if (sf.showPhoneNumber !== false) headers.push('電話番号');
  if (config.categories && config.categories.length) headers.push('出展カテゴリ');
  headers.push('出展名', '出展ブース');

  (config.customQuestions || []).forEach(function (q) { headers.push(q.label); });

  if (f.bodyEquipment) headers.push('持ち込み物品');
  if (sf.showSnsLinks !== false) headers.push('SNS');
  if (sf.showPhotoPermission !== false) headers.push('写真掲載可否');
  if (sf.showPhotoUpload !== false) headers.push('プロフィール写真');

  if (opts.staff && opts.staff.enabled) headers.push('追加スタッフ');
  if (opts.chair && opts.chair.enabled) headers.push('追加椅子');
  if (opts.power && opts.power.enabled) headers.push('コンセント');
  if (opts.party && opts.party.enabled) headers.push('懇親会出欠', '懇親会人数');
  if (f.secondaryParty) headers.push('二次会出欠', '二次会人数');
  if (f.memberDiscount) headers.push('協会会員');
  if (f.stampRally)     headers.push('景品提供', '景品内容');

  if (sf.showAddress !== false) headers.push('郵便番号', '住所');
  if (sf.showNotes   !== false) headers.push('備考・質問');

  headers.push('スタッフメモ', '合計金額', '入金確認', '入金日', 'LINEユーザーID', 'LINE表示名');
  return headers;
}

/**
 * 列名 → 値 のマップを生成します。
 * カスタム質問はラベル名がそのまま列名になります（出展メニュー名・自己紹介など）。
 */
function buildFieldMap(params, calc, config) {
  const customAnswers = params.customAnswers || {};

  const map = {
    '座席番号':         '',
    '申込日時':         params.submittedAt || '',
    '氏名':             params.name || '',
    'フリガナ':         params.furigana || '',
    'メールアドレス':   params.email || '',
    '電話番号':         params.phoneNumber || '',
    '出展カテゴリ':     params.category || '',
    '出展名':           params.exhibitorName || '',
    '出展ブース':       calc.boothName || '',
    '持ち込み物品':     params.equipment || '',
    'SNS':              formatSnsLinks(params.snsLinks),
    '写真掲載可否':     params.photoPermission || '',
    'プロフィール写真': params.profileImageUrl || PHOTO_PENDING_LABEL,
    '追加スタッフ':     parseInt(params.extraStaff, 10) || 0,
    '追加椅子':         parseInt(params.extraChairs, 10) || 0,
    'コンセント':       params.usePower === '1' ? 'あり' : 'なし',
    '懇親会出欠':       params.partyAttend || '欠席',
    '懇親会人数':       parseInt(params.partyCount, 10) || 0,
    '二次会出欠':       params.secondaryPartyAttend || '欠席',
    '二次会人数':       parseInt(params.secondaryPartyCount, 10) || 0,
    '協会会員':         params.isMember === '1' ? 'はい' : 'いいえ',
    '景品提供':         params.stampRallyPrize || 'ない',
    '景品内容':         params.prizeContent || '',
    '郵便番号':         params.postalCode || '',
    '住所':             params.address || '',
    '備考・質問':       params.notes || '',
    'スタッフメモ':     '',
    '合計金額':         calc.totalFee,
    '入金確認':         '',
    '入金日':           '',
    'LINEユーザーID':   params.lineUserId || '',
    'LINE表示名':       params.lineDisplayName || ''
  };

  // カスタム質問（ラベル＝列名）で上書き
  (config.customQuestions || []).forEach(function (q) {
    map[q.label] = customAnswers[q.id] || '';
  });

  return map;
}

/**
 * ヘッダー行の並びどおりに値を並べます。
 *
 * 実運用の受付シートには「懇親会出欠」の隣にラベル無しの人数列があるなど、
 * ヘッダーが空欄の列が存在します。空欄の場合は直前の列から推測し、
 * 推測できない列（スタッフ用の自由記入列など）は空文字を入れて温存します。
 */
function mapRowToHeaders_(headerRow, fieldMap) {
  const PAIRED_BLANK = {
    '懇親会出欠': '懇親会人数',
    '二次会出欠': '二次会人数',
    '追加スタッフ': '',
    '景品提供': ''
  };

  const row = [];
  let prevName = '';

  for (let i = 0; i < headerRow.length; i++) {
    const name = String(headerRow[i] === null || headerRow[i] === undefined ? '' : headerRow[i]).trim();

    let key = name;
    if (name === '') {
      // ラベル無し列 → 直前の列から推測
      key = PAIRED_BLANK[prevName] || '';
    }

    row.push(key && fieldMap[key] !== undefined ? fieldMap[key] : '');
    if (name !== '') prevName = name;
  }

  return row;
}

// ================================================================
// データベーススプレッドシートへの保存
// ================================================================

/** DBスプシのIDを取得（未設定なら null） */
function getDatabaseSpreadsheetId_(config) {
  return (config && config.databaseSpreadsheetId) ? String(config.databaseSpreadsheetId).trim() : '';
}

/** 開催回情報を config から取り出す */
function getEditionInfo_(config) {
  const ev = config.event || {};
  const editionId = String(ev.editionId || ev.edition || ev.name || '').trim();
  return {
    editionId: editionId,
    edition:   String(ev.edition || '').trim(),
    eventName: String(ev.name || '').trim(),
    eventDate: String(ev.date || '').trim(),
    location:  String(ev.location || '').trim()
  };
}

/**
 * 申込1件をDBへ保存します。
 * - applications へ1行追記
 * - exhibitors をメールアドレスをキーに upsert
 * - events を upsert（申込件数を更新）
 */
function saveToDatabase(params, calc, config) {
  const dbId = getDatabaseSpreadsheetId_(config);
  if (!dbId) return { saved: false, reason: 'databaseSpreadsheetId 未設定' };

  const ss = SpreadsheetApp.openById(dbId);
  const edition = getEditionInfo_(config);
  const customAnswers = params.customAnswers || {};

  // カスタム質問のラベルから、DBの固定列に対応する値を拾う
  const byLabel = {};
  (config.customQuestions || []).forEach(function (q) {
    byLabel[q.label] = customAnswers[q.id] || '';
  });

  const record = {
    '開催回ID':         edition.editionId,
    '開催回':           edition.edition,
    'イベント名':       edition.eventName,
    '申込日時':         params.submittedAt || '',
    '氏名':             params.name || '',
    'フリガナ':         params.furigana || '',
    'メールアドレス':   params.email || '',
    '電話番号':         params.phoneNumber || '',
    '郵便番号':         params.postalCode || '',
    '住所':             params.address || '',
    '出展カテゴリ':     params.category || '',
    '出展名':           params.exhibitorName || '',
    '出展ブース':       calc.boothName || '',
    '出展メニュー名':   byLabel['出展メニュー名'] || '',
    '自己紹介':         byLabel['自己紹介'] || '',
    '持ち込み物品':     params.equipment || '',
    'SNS':              formatSnsLinks(params.snsLinks),
    '写真掲載可否':     params.photoPermission || '',
    'プロフィール写真': params.profileImageUrl || PHOTO_PENDING_LABEL,
    'コンセント':       params.usePower === '1' ? 'あり' : 'なし',
    '懇親会出欠':       params.partyAttend || '欠席',
    '懇親会人数':       parseInt(params.partyCount, 10) || 0,
    '二次会出欠':       params.secondaryPartyAttend || '欠席',
    '二次会人数':       parseInt(params.secondaryPartyCount, 10) || 0,
    '協会会員':         params.isMember === '1' ? 'はい' : 'いいえ',
    '景品提供':         params.stampRallyPrize || 'ない',
    '景品内容':         params.prizeContent || '',
    '備考・質問':       params.notes || '',
    '座席番号':         '',
    '合計金額':         calc.totalFee,
    '入金確認':         '',
    '入金日':           '',
    'ステータス':       '申込',
    'スタッフメモ':     '',
    'LINEユーザーID':   params.lineUserId || '',
    'LINE表示名':       params.lineDisplayName || '',
    '登録元':           'form'
  };

  return writeDatabaseRecord_(ss, record, edition, config);
}

/**
 * DBへ1件書き込む共通処理（フォーム送信・移行取り込みの両方から使用）
 */
function writeDatabaseRecord_(ss, record, edition, config) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const appSheet = ensureDbSheet_(ss, DB_SHEET_APPLICATIONS, DB_APPLICATION_HEADERS);
    const headers  = DB_APPLICATION_HEADERS;

    // 重複チェック（開催回ID + メール + 申込日時）
    const dedupeKey = [
      record['開催回ID'],
      normalizeEmail_(record['メールアドレス']),
      dateKey_(record['申込日時'])
    ].join('|');

    if (findApplicationByKey_(appSheet, dedupeKey)) {
      return { saved: false, reason: 'duplicate', applicationId: '' };
    }

    // 出展者マスタを upsert して 出展者ID を得る
    const exhibitorId = upsertExhibitor_(ss, record, edition);

    const applicationId = nextApplicationId_(appSheet, record['開催回ID']);
    record['申込ID']    = applicationId;
    record['出展者ID']  = exhibitorId;
    record['登録日時']  = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

    appSheet.appendRow(headers.map(function (h) {
      return record[h] !== undefined && record[h] !== null ? record[h] : '';
    }));

    upsertEvent_(ss, edition, config);

    return { saved: true, applicationId: applicationId, exhibitorId: exhibitorId };
  } finally {
    lock.releaseLock();
  }
}

/** 指定シートが無ければヘッダー付きで作成、あればヘッダー不足分を補完 */
function ensureDbSheet_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    ensureColumnCount_(sheet, headers.length);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleDbHeader_(sheet, headers.length);
    return sheet;
  }

  ensureColumnCount_(sheet, headers.length);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleDbHeader_(sheet, headers.length);
    return sheet;
  }

  // 末尾に列が増えた場合のみ補完（既存列の並びは動かさない）
  const current = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (current.length < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleDbHeader_(sheet, headers.length);
  }

  return sheet;
}

/** 新規シートの既定列数(26列)を超えるヘッダーを書けるように列を広げる */
function ensureColumnCount_(sheet, needed) {
  const max = sheet.getMaxColumns();
  if (max < needed) sheet.insertColumnsAfter(max, needed - max);
}

function styleDbHeader_(sheet, colCount) {
  sheet.getRange(1, 1, 1, colCount)
    .setBackground('#1f2937')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/** 重複判定用に applications を走査 */
function findApplicationByKey_(sheet, dedupeKey) {
  if (sheet.getLastRow() < 2) return false;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idxEd   = headers.indexOf('開催回ID');
  const idxMail = headers.indexOf('メールアドレス');
  const idxDate = headers.indexOf('申込日時');
  if (idxEd < 0 || idxMail < 0 || idxDate < 0) return false;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  for (let i = 0; i < rows.length; i++) {
    const key = [
      String(rows[i][idxEd] || ''),
      normalizeEmail_(rows[i][idxMail]),
      dateKey_(rows[i][idxDate])
    ].join('|');
    if (key === dedupeKey) return true;
  }
  return false;
}

/** 申込ID採番： 開催回ID-0001 */
function nextApplicationId_(sheet, editionId) {
  const prefix = (editionId || 'EVENT') + '-';
  let max = 0;

  if (sheet.getLastRow() >= 2) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idx = headers.indexOf('申込ID');
    if (idx >= 0) {
      const ids = sheet.getRange(2, idx + 1, sheet.getLastRow() - 1, 1).getValues();
      ids.forEach(function (r) {
        const v = String(r[0] || '');
        if (v.indexOf(prefix) === 0) {
          const n = parseInt(v.slice(prefix.length), 10);
          if (!isNaN(n) && n > max) max = n;
        }
      });
    }
  }

  return prefix + padLeft_(max + 1, 4);
}

/**
 * 出展者マスタを upsert します。キーは正規化したメールアドレス。
 * メールが無い招待枠などは 氏名＋出展名 をキーにします。
 */
function upsertExhibitor_(ss, record, edition) {
  const sheet   = ensureDbSheet_(ss, DB_SHEET_EXHIBITORS, DB_EXHIBITOR_HEADERS);
  const headers = DB_EXHIBITOR_HEADERS;

  const mailKey = normalizeEmail_(record['メールアドレス']) ||
                  ('name:' + String(record['氏名'] || '').replace(/\s/g, '') + '/' + String(record['出展名'] || '').replace(/\s/g, ''));
  if (!mailKey || mailKey === 'name:/') return '';

  const idxKey = headers.indexOf('メールキー');
  const lastRow = sheet.getLastRow();

  let targetRow = 0;
  let existing  = null;

  if (lastRow >= 2) {
    const keys = sheet.getRange(2, idxKey + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === mailKey) {
        targetRow = i + 2;
        existing  = sheet.getRange(targetRow, 1, 1, headers.length).getValues()[0];
        break;
      }
    }
  }

  const now = record['申込日時'] || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

  if (!targetRow) {
    const exhibitorId = nextExhibitorId_(sheet, headers.indexOf('出展者ID'));
    const row = {
      '出展者ID':           exhibitorId,
      'メールキー':         mailKey,
      '氏名':               record['氏名'] || '',
      'フリガナ':           record['フリガナ'] || '',
      'メールアドレス':     record['メールアドレス'] || '',
      '電話番号':           record['電話番号'] || '',
      '郵便番号':           record['郵便番号'] || '',
      '住所':               record['住所'] || '',
      '最新出展名':         record['出展名'] || '',
      '最新出展カテゴリ':   record['出展カテゴリ'] || '',
      '最新出展メニュー名': record['出展メニュー名'] || '',
      '最新自己紹介':       record['自己紹介'] || '',
      '最新SNS':            record['SNS'] || '',
      '最新プロフィール写真': record['プロフィール写真'] || '',
      '出展回数':           1,
      '初回申込日時':       now,
      '最終申込日時':       now,
      '最終開催回':         edition.edition || edition.editionId || '',
      'スタッフメモ':       ''
    };
    sheet.appendRow(headers.map(function (h) { return row[h] !== undefined ? row[h] : ''; }));
    return exhibitorId;
  }

  // 既存行を更新（空で上書きしない）
  const get = function (name) { return existing[headers.indexOf(name)]; };
  const keepOrUpdate = function (name, value) {
    return (value === '' || value === null || value === undefined) ? get(name) : value;
  };

  const count = (parseInt(get('出展回数'), 10) || 0) + 1;

  const updated = {
    '出展者ID':             get('出展者ID') || ('EX' + padLeft_(targetRow - 1, 4)),
    'メールキー':           mailKey,
    '氏名':                 keepOrUpdate('氏名', record['氏名']),
    'フリガナ':             keepOrUpdate('フリガナ', record['フリガナ']),
    'メールアドレス':       keepOrUpdate('メールアドレス', record['メールアドレス']),
    '電話番号':             keepOrUpdate('電話番号', record['電話番号']),
    '郵便番号':             keepOrUpdate('郵便番号', record['郵便番号']),
    '住所':                 keepOrUpdate('住所', record['住所']),
    '最新出展名':           keepOrUpdate('最新出展名', record['出展名']),
    '最新出展カテゴリ':     keepOrUpdate('最新出展カテゴリ', record['出展カテゴリ']),
    '最新出展メニュー名':   keepOrUpdate('最新出展メニュー名', record['出展メニュー名']),
    '最新自己紹介':         keepOrUpdate('最新自己紹介', record['自己紹介']),
    '最新SNS':              keepOrUpdate('最新SNS', record['SNS']),
    '最新プロフィール写真': keepOrUpdate('最新プロフィール写真', record['プロフィール写真']),
    '出展回数':             count,
    '初回申込日時':         get('初回申込日時') || now,
    '最終申込日時':         now,
    '最終開催回':           edition.edition || edition.editionId || get('最終開催回'),
    'スタッフメモ':         get('スタッフメモ') || ''
  };

  sheet.getRange(targetRow, 1, 1, headers.length)
    .setValues([headers.map(function (h) { return updated[h] !== undefined ? updated[h] : ''; })]);

  return updated['出展者ID'];
}

/** 既存の最大値+1 で出展者IDを採番（行を削除しても重複しません） */
function nextExhibitorId_(sheet, idIndex) {
  let max = 0;
  if (sheet.getLastRow() >= 2 && idIndex >= 0) {
    const ids = sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getValues();
    ids.forEach(function (r) {
      const m = String(r[0] || '').match(/^EX(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    });
  }
  return 'EX' + padLeft_(max + 1, 4);
}

/** 開催回マスタを upsert（申込件数も更新） */
function upsertEvent_(ss, edition, config) {
  if (!edition.editionId) return;

  const sheet   = ensureDbSheet_(ss, DB_SHEET_EVENTS, DB_EVENT_HEADERS);
  const headers = DB_EVENT_HEADERS;
  const lastRow = sheet.getLastRow();

  const count = countApplicationsOfEdition_(ss, edition.editionId);

  let targetRow = 0;
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === edition.editionId) { targetRow = i + 2; break; }
    }
  }

  const row = {
    '開催回ID':               edition.editionId,
    '開催回':                 edition.edition,
    'イベント名':             edition.eventName,
    '開催日時':               edition.eventDate,
    '会場':                   edition.location,
    '受付スプレッドシートID': (config && config.spreadsheetId) || '',
    '申込件数':               count,
    '登録日時':               Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss')
  };

  const values = [headers.map(function (h) { return row[h] !== undefined ? row[h] : ''; })];

  if (targetRow) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues(values);
  } else {
    sheet.appendRow(values[0]);
  }
}

function countApplicationsOfEdition_(ss, editionId) {
  const sheet = ss.getSheetByName(DB_SHEET_APPLICATIONS);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = headers.indexOf('開催回ID');
  if (idx < 0) return 0;

  const values = sheet.getRange(2, idx + 1, sheet.getLastRow() - 1, 1).getValues();
  return values.filter(function (r) { return String(r[0]).trim() === editionId; }).length;
}

// ================================================================
// 画像保存
// ================================================================

function saveProfileImage(params, config) {
  try {
    const base64Data = params.profileImageBase64;
    const mimeType   = params.profileImageMimeType || 'image/jpeg';

    const blob = Utilities.newBlob(
      Utilities.base64Decode(base64Data), mimeType, buildPhotoFileName_(params)
    );

    const file = getPhotoFolder_(config).createFile(blob);

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (sharingErr) {
      console.warn('setSharing failed:', sharingErr);
    }

    return 'https://drive.google.com/file/d/' + file.getId() + '/view';
  } catch (err) {
    console.error('saveProfileImage error:', err);
    return '';
  }
}

/**
 * 写真の保存先フォルダを返します。
 *
 * 設定された親フォルダの下に、開催回ごとのフォルダ（例:「第1回」）を作り、
 * その中に保存します。開催回が未設定の場合は親フォルダへ直接保存します。
 */
function getPhotoFolder_(config) {
  const parentId = parseDriveFolderId(config.driveFolderUrl || config.driveFolderId);
  const parent   = parentId ? DriveApp.getFolderById(parentId) : DriveApp.getRootFolder();

  const edition = getEditionInfo_(config);
  const name    = sanitizeFileName_(edition.edition || edition.editionId);
  if (!name) return parent;

  // 同時に申し込みがあっても、同名フォルダが二重にできないようにする
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    console.warn('フォルダ作成のロックを取得できませんでした:', e);
  }

  try {
    const found = parent.getFoldersByName(name);
    return found.hasNext() ? found.next() : parent.createFolder(name);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* ロック未取得時は何もしない */ }
  }
}

/** 写真のファイル名を「氏名_出展名.jpg」にして、後から探しやすくする */
function buildPhotoFileName_(params) {
  const person = sanitizeFileName_(params.name);
  const shop   = sanitizeFileName_(params.exhibitorName);
  const base   = [person, shop].filter(Boolean).join('_');

  if (!base) return params.profileImageName || 'photo.jpg';
  return base.slice(0, 80) + '.jpg';
}

/** フォルダ名・ファイル名に使えない文字を取り除く */
function sanitizeFileName_(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDriveFolderId(urlOrId) {
  if (!urlOrId) return null;
  const match = String(urlOrId).match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]+$/.test(String(urlOrId).trim())) return String(urlOrId).trim();
  return null;
}

// ================================================================
// メール送信
// ================================================================

function sendConfirmationEmail(params, calc, config) {
  const emailCfg  = config.email || {};
  const eventName = (config.event && config.event.name) || 'イベント';

  const bd = calc.breakdown;
  const lines = [];
  lines.push('  出展ブース（' + calc.boothName + '）: ¥' + bd.booth.toLocaleString());
  if (bd.staff > 0)  lines.push('  追加スタッフ: ¥' + bd.staff.toLocaleString());
  if (bd.chairs > 0) lines.push('  追加椅子: ¥' + bd.chairs.toLocaleString());
  if (bd.power > 0)  lines.push('  コンセント: ¥' + bd.power.toLocaleString());
  if (bd.party > 0)  lines.push('  懇親会費: ¥' + bd.party.toLocaleString());
  if (bd.memberDiscount > 0) lines.push('  会員割引: -¥' + bd.memberDiscount.toLocaleString());

  const customAnswers = params.customAnswers || {};
  const customQText = (config.customQuestions || []).map(function (q) {
    return ('  ' + q.label + ': ' + (customAnswers[q.id] || '')).replace(/\s+$/, '');
  }).join('\n');

  const variables = {
    name:          params.name || '',
    eventName:     eventName,
    email:         params.email || '',
    boothName:     calc.boothName,
    totalFee:      calc.totalFee.toLocaleString(),
    breakdown:     lines.join('\n'),
    customAnswers: customQText,
    submittedAt:   params.submittedAt || '',
    exhibitorName: params.exhibitorName || ''
  };
  (config.customQuestions || []).forEach(function (q) {
    variables[q.id] = customAnswers[q.id] || '';
  });

  // 写真が届いていない場合の案内文
  // テンプレートに {{photoNotice}} があればその位置に、無ければ本文の先頭に差し込む
  variables.photoNotice = params.photoPending ? buildPhotoNoticeText_(config) : '';

  const subject  = applyTemplate(emailCfg.confirmationSubject || '【{{eventName}}】お申込みを受け付けました', variables);
  const template = emailCfg.confirmationBodyTemplate || defaultConfirmationTemplate();

  let body = applyTemplate(template, variables);
  if (params.photoPending && template.indexOf('{{photoNotice}}') === -1) {
    body = variables.photoNotice + '\n\n' + body;
  }

  GmailApp.sendEmail(params.email, subject, body, {
    name:    emailCfg.adminSenderName || (eventName + ' 事務局'),
    replyTo: emailCfg.replyToEmail || emailCfg.adminEmail || ''
  });
}

/**
 * 写真が届いていないときに、申込者へお願いする文面を作ります。
 * 送り先は公式LINEです。URL が設定されていれば併せて案内します。
 */
function buildPhotoNoticeText_(config) {
  const lineUrl = config.lineOfficialUrl || '';

  const lines = [
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '📷 プロフィール写真をお送りください',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    'お申込みは完了しておりますが、プロフィール写真が届いておりません。',
    'お手数ですが、公式LINEのトーク画面あてに、',
    '出展名とプロフィール写真を後ほどお送りください。',
    ''
  ];
  if (lineUrl) {
    lines.push('  公式LINE: ' + lineUrl, '');
  }
  return lines.join('\n');
}

/**
 * 事務局メールに出す、データベース保存の結果説明。
 * 保存されなかったときは理由まで書き、気づけるようにします。
 */
function describeDbResult_(dbResult) {
  const r = dbResult || {};
  if (r.saved) return 'OK' + (r.applicationId ? '（申込ID: ' + r.applicationId + '）' : '');
  return '⚠️ 未保存（' + (r.reason || '理由不明') + '）※受付シートには入っています';
}

function sendAdminEmail(params, calc, config, dbResult) {
  const emailCfg   = config.email || {};
  const eventName  = (config.event && config.event.name) || 'イベント';
  const adminEmail = emailCfg.adminEmail;
  if (!adminEmail) return;

  const customAnswers = params.customAnswers || {};
  const customQLines  = (config.customQuestions || []).map(function (q) {
    return q.label + ': ' + (customAnswers[q.id] || '');
  });

  const bd = calc.breakdown;
  const breakdownLines = [
    '出展ブース: ¥' + bd.booth.toLocaleString(),
    bd.staff > 0 ? '追加スタッフ: ¥' + bd.staff.toLocaleString() : null,
    bd.chairs > 0 ? '追加椅子: ¥' + bd.chairs.toLocaleString() : null,
    bd.power > 0 ? 'コンセント: ¥' + bd.power.toLocaleString() : null,
    bd.party > 0 ? '懇親会費: ¥' + bd.party.toLocaleString() : null,
    bd.memberDiscount > 0 ? '会員割引: -¥' + bd.memberDiscount.toLocaleString() : null
  ].filter(Boolean);

  const subject = applyTemplate(
    emailCfg.adminNotificationSubject || '【新規申込】{{name}}様 ({{exhibitorName}})',
    { name: params.name, exhibitorName: params.exhibitorName || '', eventName: eventName }
  );

  const body = '新しい出展申込がありました。\n\n' +
    '━━ 申込者情報 ━━━━━━━━━━━━━━━━\n' +
    'お名前:         ' + (params.name || '') + '\n' +
    'ふりがな:       ' + (params.furigana || '') + '\n' +
    '電話番号:       ' + (params.phoneNumber || '-') + '\n' +
    '郵便番号:       ' + (params.postalCode || '-') + '\n' +
    'ご住所:         ' + (params.address || '-') + '\n' +
    'メール:         ' + (params.email || '') + '\n' +
    'LINE名:         ' + (params.lineDisplayName || '-') + '\n\n' +
    '━━ 出展情報 ━━━━━━━━━━━━━━━━━━\n' +
    '出展名:         ' + (params.exhibitorName || '-') + '\n' +
    'カテゴリ:       ' + (params.category || '-') + '\n' +
    'ブース:         ' + calc.boothName + '\n' +
    '早割:           ' + (calc.isEarlyBird ? 'あり' : 'なし') + '\n\n' +
    '━━ カスタム回答 ━━━━━━━━━━━━━━━━\n' +
    (customQLines.join('\n') || 'なし') + '\n\n' +
    '━━ オプション ━━━━━━━━━━━━━━━━━\n' +
    '追加スタッフ:   ' + (params.extraStaff || 0) + '名\n' +
    '追加椅子:       ' + (params.extraChairs || 0) + '脚\n' +
    'コンセント:     ' + (params.usePower === '1' ? 'あり' : 'なし') + '\n' +
    '懇親会:         ' + (params.partyAttend || '欠席') + ' ' + (params.partyCount ? '(' + params.partyCount + '名)' : '') + '\n' +
    '二次会:         ' + (params.secondaryPartyAttend || '欠席') + ' ' + (params.secondaryPartyCount ? '(' + params.secondaryPartyCount + '名)' : '') + '\n' +
    '会員割引:       ' + (params.isMember === '1' ? 'あり' : 'なし') + '\n' +
    '景品提供:       ' + (params.stampRallyPrize || 'ない') + (params.prizeContent ? ' (' + params.prizeContent + ')' : '') + '\n\n' +
    '━━ SNSリンク ━━━━━━━━━━━━━━━━━━\n' +
    formatSnsLinks(params.snsLinks) + '\n\n' +
    '━━ 料金 ━━━━━━━━━━━━━━━━━━━━━━\n' +
    breakdownLines.join('\n') + '\n' +
    '合計: ¥' + calc.totalFee.toLocaleString() + '\n\n' +
    '━━ その他 ━━━━━━━━━━━━━━━━━━━━━\n' +
    '備考: ' + (params.notes || 'なし') + '\n' +
    '写真掲載可否: ' + (params.photoPermission || '-') + '\n' +
    '写真URL: ' + (params.profileImageUrl || '⚠️ 未受領（申込者に公式LINEへの送付を案内済み）') + '\n' +
    '申込日時: ' + params.submittedAt + '\n' +
    'データベース保存: ' + describeDbResult_(dbResult);

  GmailApp.sendEmail(adminEmail, subject, body, {
    name: emailCfg.adminSenderName || (eventName + ' 事務局')
  });
}

// ================================================================
// リピーター検索（前回データ呼び出し）
// ================================================================

function handleSendAuthCode(params, config) {
  const name  = String(params.name || '').trim();
  const email = String(params.email || '').trim();

  if (!name || !email) return { success: false, error: 'お名前とメールアドレスを入力してください' };

  const records = searchApplicantRecords(name, email, config);
  if (!records.length) {
    return { success: false, error: '過去の申込データが見つかりませんでした。お名前とメールアドレスをご確認ください。' };
  }

  const authCode = String(Math.floor(1000 + Math.random() * 9000));
  const key      = authCacheKey_(name, email);
  CacheService.getScriptCache().put(
    key,
    JSON.stringify({ code: authCode, expiration: Date.now() + 10 * 60 * 1000 }),
    600
  );

  const eventName  = (config.event && config.event.name) || 'イベント';
  const senderName = (config.email && config.email.adminSenderName) || (eventName + ' 事務局');

  GmailApp.sendEmail(email, '【' + eventName + '】認証コードのお知らせ',
    [
      name + ' 様',
      '',
      '申込データ呼び出しのための認証コードをお送りします。',
      '',
      '認証コード: ' + authCode,
      '',
      '（このコードは10分間有効です）',
      '',
      'このメールに心当たりがない場合は無視してください。',
      '',
      eventName + ' 事務局'
    ].join('\n'),
    { name: senderName }
  );

  return { success: true };
}

function handleVerifyAuthCode(params, config) {
  const name  = String(params.name || '').trim();
  const email = String(params.email || '').trim();
  const code  = String(params.code || '').trim();

  const key    = authCacheKey_(name, email);
  const cached = CacheService.getScriptCache().get(key);
  if (!cached) return { success: false, error: '認証コードの有効期限が切れました。再度送信してください。' };

  const codeData = JSON.parse(cached);
  if (String(codeData.code) !== code) {
    return { success: false, error: '認証コードが正しくありません' };
  }
  if (Date.now() > codeData.expiration) {
    return { success: false, error: '認証コードの有効期限が切れました。再度送信してください。' };
  }

  CacheService.getScriptCache().remove(key);

  return { success: true, list: searchApplicantRecords(name, email, config) };
}

function authCacheKey_(name, email) {
  return 'auth_' + normalizeEmail_(email) + '_' + String(name).replace(/\s/g, '');
}

/**
 * 過去の申込データを検索します。
 * データベースがあればそちらを（開催回をまたいで）検索し、
 * 無ければ受付スプレッドシートを検索します。
 */
function searchApplicantRecords(name, email, config) {
  const fromDb = searchDatabaseRecords_(name, email, config);
  if (fromDb.length) return fromDb;
  return searchReceptionRecords_(name, email, config);
}

function searchDatabaseRecords_(name, email, config) {
  try {
    const dbId = getDatabaseSpreadsheetId_(config);
    if (!dbId) return [];

    const sheet = SpreadsheetApp.openById(dbId).getSheetByName(DB_SHEET_APPLICATIONS);
    if (!sheet || sheet.getLastRow() < 2) return [];

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rows    = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

    const col = function (row, headerName) {
      const i = headers.indexOf(headerName);
      return i >= 0 ? row[i] : '';
    };

    const targetName  = String(name).replace(/\s/g, '');
    const targetEmail = normalizeEmail_(email);

    return rows
      .filter(function (row) {
        return normalizeEmail_(col(row, 'メールアドレス')) === targetEmail &&
               String(col(row, '氏名')).replace(/\s/g, '') === targetName;
      })
      .map(function (row) {
        return {
          name:            col(row, '氏名'),
          furigana:        col(row, 'フリガナ'),
          email:           col(row, 'メールアドレス'),
          phone:           col(row, '電話番号'),
          postalCode:      col(row, '郵便番号'),
          address:         col(row, '住所'),
          exhibitorName:   col(row, '出展名'),
          category:        col(row, '出展カテゴリ'),
          boothName:       col(row, '出展ブース'),
          menu:            col(row, '出展メニュー名'),
          intro:           col(row, '自己紹介'),
          equipment:       col(row, '持ち込み物品'),
          photoPermission: col(row, '写真掲載可否'),
          eventName:       col(row, 'イベント名') || col(row, '開催回'),
          edition:         col(row, '開催回'),
          submittedAt:     formatCellDate_(col(row, '申込日時')),
          profileImageUrl: col(row, 'プロフィール写真'),
          snsLinks:        col(row, 'SNS')
        };
      })
      .sort(function (a, b) { return String(b.submittedAt).localeCompare(String(a.submittedAt)); });
  } catch (err) {
    console.error('searchDatabaseRecords_ error:', err);
    return [];
  }
}

function searchReceptionRecords_(name, email, config) {
  try {
    const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(RECEPTION_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return [];

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rows    = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

    const col = function (row, headerName) {
      const i = headers.indexOf(headerName);
      return i >= 0 ? row[i] : '';
    };

    const targetName  = String(name).replace(/\s/g, '');
    const targetEmail = normalizeEmail_(email);
    const eventName   = (config.event && config.event.name) || '';

    return rows
      .filter(function (row) {
        return normalizeEmail_(col(row, 'メールアドレス')) === targetEmail &&
               String(col(row, '氏名')).replace(/\s/g, '') === targetName;
      })
      .map(function (row) {
        return {
          name:            col(row, '氏名'),
          furigana:        col(row, 'フリガナ'),
          email:           col(row, 'メールアドレス'),
          phone:           col(row, '電話番号'),
          postalCode:      col(row, '郵便番号'),
          address:         col(row, '住所'),
          exhibitorName:   col(row, '出展名'),
          category:        col(row, '出展カテゴリ'),
          boothName:       col(row, '出展ブース'),
          menu:            col(row, '出展メニュー名'),
          intro:           col(row, '自己紹介'),
          equipment:       col(row, '持ち込み物品'),
          photoPermission: col(row, '写真掲載可否'),
          eventName:       eventName,
          edition:         '',
          submittedAt:     formatCellDate_(col(row, '申込日時')),
          profileImageUrl: col(row, 'プロフィール写真'),
          snsLinks:        col(row, 'SNS')
        };
      });
  } catch (err) {
    console.error('searchReceptionRecords_ error:', err);
    return [];
  }
}

// ================================================================
// 出展者一覧（当日パンフ・紹介ページ用）
// ================================================================

function handleGetExhibitors(config) {
  try {
    const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(RECEPTION_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return { success: true, exhibitors: [] };

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rows    = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

    const col = function (row, headerName) {
      const i = headers.indexOf(headerName);
      return i >= 0 ? row[i] : '';
    };

    const exhibitors = rows
      .filter(function (row) { return col(row, '出展名') || col(row, '氏名'); })
      .map(function (row) {
        return {
          name:            col(row, '出展名') || col(row, '氏名'),
          category:        col(row, '出展カテゴリ'),
          booth:           col(row, '出展ブース'),
          seatNo:          col(row, '座席番号'),
          menu:            col(row, '出展メニュー名'),
          intro:           col(row, '自己紹介'),
          sns:             col(row, 'SNS'),
          photoUrl:        col(row, 'プロフィール写真'),
          photoPermission: col(row, '写真掲載可否')
        };
      });

    return { success: true, exhibitors: exhibitors };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ================================================================
// 管理用アクション
// ================================================================

/**
 * config キャッシュを消して、管理画面の変更をフォームへ即時反映させます。
 * スクリプトプロパティ ADMIN_TOKEN を設定している場合はトークン必須。
 */
function handleClearCache(params) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  if (expected && String(params.token || '') !== expected) {
    return { success: false, error: '管理トークンが正しくありません' };
  }
  clearConfigCache();
  return { success: true, message: '設定キャッシュをクリアしました' };
}

/**
 * 今回の受付スプレッドシートを新しく作ります。
 *
 * 管理画面の「次の開催をはじめる」から呼ばれます。
 * - いま使っている受付シートと同じフォルダに作ります
 * - 1行目の見出しも、いまの受付シートからそのまま写します
 *   （見出しが取れない場合だけ、設定から組み立てます）
 *
 * format=html を付けると、ブラウザで開いて結果を確認できる画面を返します。
 */
function handleCreateReceptionSheet(params) {
  const wantHtml = String(params.format || '') === 'html';

  try {
    const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
    if (expected && String(params.token || '') !== expected) {
      throw new Error('管理トークンが正しくありません');
    }

    const config = getConfig();
    const info   = createReceptionSpreadsheet_(config, params.name);

    return wantHtml ? createSheetResultPage_(info) : jsonOutput_(Object.assign({ success: true }, info));

  } catch (err) {
    console.error('handleCreateReceptionSheet error:', err);
    if (wantHtml) return createSheetResultPage_({ error: err.message });
    return jsonOutput_({ success: false, error: err.message });
  }
}

function createReceptionSpreadsheet_(config, requestedName) {
  const edition = getEditionInfo_(config);
  const name    = sanitizeFileName_(requestedName) ||
                  sanitizeFileName_((edition.eventName || 'イベント') + ' 申込');

  // いまの受付シートの見出しを引き継ぐ（列の並びを変えないため）
  let headers = null;
  let sameFolder = null;

  if (config.spreadsheetId) {
    try {
      const cur   = SpreadsheetApp.openById(config.spreadsheetId);
      const sheet = cur.getSheetByName(RECEPTION_SHEET_NAME);
      if (sheet && sheet.getLastColumn() > 0) {
        headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      }
      const parents = DriveApp.getFileById(config.spreadsheetId).getParents();
      if (parents.hasNext()) sameFolder = parents.next();
    } catch (e) {
      console.warn('いまの受付シートを参照できませんでした:', e);
    }
  }

  if (!headers || !headers.length) headers = buildReceptionHeaders(config);

  const ss    = SpreadsheetApp.create(name);
  const sheet = ss.getSheets()[0];
  sheet.setName(RECEPTION_SHEET_NAME);

  ensureColumnCount_(sheet, headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#374151')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);

  // いまの受付シートと同じ場所へ置く
  let folderName = 'マイドライブ';
  if (sameFolder) {
    try {
      const file = DriveApp.getFileById(ss.getId());
      sameFolder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
      folderName = sameFolder.getName();
    } catch (e) {
      console.warn('フォルダの移動に失敗しました:', e);
    }
  }

  return {
    id: ss.getId(),
    url: ss.getUrl(),
    name: name,
    folder: folderName,
    columns: headers.length
  };
}

/** ブラウザで開いたときに見せる結果画面 */
function createSheetResultPage_(info) {
  const esc = function (t) {
    return String(t === null || t === undefined ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  const body = info.error
    ? '<h1>作成できませんでした</h1><p class="err">' + esc(info.error) + '</p>' +
      '<p>お手数ですが、この画面を管理者にお知らせください。</p>'
    : '<h1>受付シートを作成しました</h1>' +
      '<p><b>' + esc(info.name) + '</b><br>保存先: ' + esc(info.folder) + '</p>' +
      '<p>下のURLをコピーして、管理画面の「今回の受付シート」に貼り付けてください。</p>' +
      '<input id="u" value="' + esc(info.url) + '" readonly onclick="this.select()">' +
      '<button onclick="navigator.clipboard.writeText(document.getElementById(\'u\').value);this.textContent=\'コピーしました\'">URLをコピー</button>' +
      '<p><a href="' + esc(info.url) + '" target="_blank">シートを開く</a></p>';

  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;' +
    'padding:1.5rem;line-height:1.8;color:#2a1a22;max-width:34rem;margin:0 auto}' +
    'h1{font-size:1.15rem;color:#650133}' +
    'input{width:100%;font-size:16px;padding:.6rem;border:1.5px solid #e6dfe4;border-radius:.5rem;margin:.5rem 0}' +
    'button{font:inherit;font-weight:700;background:#650133;color:#fff;border:0;' +
    'border-radius:.5rem;padding:.6rem 1rem;cursor:pointer}' +
    '.err{color:#a3182a;font-weight:700}</style>' + body
  ).setTitle('受付シートの作成');
}

/** 稼働状況の確認（設定が正しく読めているかの点検用） */
function handleStatus() {
  const config  = getConfig();
  const edition = getEditionInfo_(config);
  const dbId    = getDatabaseSpreadsheetId_(config);

  const status = {
    success: true,
    version: '2.0.0',
    configJsonUrl: CONFIG_JSON_URL,
    eventName: edition.eventName,
    edition: edition.edition,
    editionId: edition.editionId,
    receptionSpreadsheetId: config.spreadsheetId || '',
    databaseSpreadsheetId: dbId,
    receptionSheetFound: false,
    receptionRowCount: 0,
    databaseSheetFound: false,
    databaseRowCount: 0
  };

  try {
    const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(RECEPTION_SHEET_NAME);
    if (sheet) {
      status.receptionSheetFound = true;
      status.receptionRowCount = Math.max(0, sheet.getLastRow() - 1);
    }
  } catch (e) {
    status.receptionError = e.message;
  }

  if (dbId) {
    try {
      const sheet = SpreadsheetApp.openById(dbId).getSheetByName(DB_SHEET_APPLICATIONS);
      if (sheet) {
        status.databaseSheetFound = true;
        status.databaseRowCount = Math.max(0, sheet.getLastRow() - 1);
      }
    } catch (e) {
      status.databaseError = e.message;
    }
  }

  return status;
}

// ================================================================
// 初回セットアップ / 移行（手動実行）
// ================================================================

/**
 * 【手動実行1】データベーススプレッドシートをDB形式に整えます。
 *
 * - 既存のシートは「_backup_日付」へ退避してから、DB用シートを作成します
 *   （元データは同じファイル内に残るので、いつでも見返せます）
 * - applications / exhibitors / events の3シートを作成します
 * - 何度実行しても、既にDB形式になっていれば作り直しません
 */
function setupDatabase() {
  const config = getConfig();
  const dbId   = getDatabaseSpreadsheetId_(config);

  if (!dbId) {
    throw new Error(
      'config.json に databaseSpreadsheetId がありません。\n' +
      '読み込み元: ' + CONFIG_JSON_URL + '\n' +
      'このURLの中身に databaseSpreadsheetId が含まれているか確認してください。\n' +
      '（設定を更新した直後の場合は clearConfigCache を実行してから再実行してください）'
    );
  }

  const ss    = SpreadsheetApp.openById(dbId);
  const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmm');

  // すでにDB形式かどうか
  const alreadySetUp = !!ss.getSheetByName(DB_SHEET_APPLICATIONS);

  // 退避対象を先に控える（この時点で存在するシート＝旧データ）
  const oldSheets = alreadySetUp ? [] : ss.getSheets().filter(function (sheet) {
    return sheet.getName().indexOf('_backup_') !== 0;
  });

  // 先にDB用シートを作る（1枚も表示シートが無い状態を作らないため）
  ensureDbSheet_(ss, DB_SHEET_EVENTS,       DB_EVENT_HEADERS);
  ensureDbSheet_(ss, DB_SHEET_EXHIBITORS,   DB_EXHIBITOR_HEADERS);
  ensureDbSheet_(ss, DB_SHEET_APPLICATIONS, DB_APPLICATION_HEADERS);

  // 旧シートをリネームして非表示に退避（中身は消しません）
  oldSheets.forEach(function (sheet) {
    sheet.setName('_backup_' + stamp + '_' + sheet.getName());
    sheet.hideSheet();
  });

  // シート順を applications → exhibitors → events に整える
  [DB_SHEET_APPLICATIONS, DB_SHEET_EXHIBITORS, DB_SHEET_EVENTS].forEach(function (name, i) {
    const sheet = ss.getSheetByName(name);
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(i + 1);
  });

  console.log('データベースのセットアップが完了しました。');
  console.log('  applications: ' + DB_APPLICATION_HEADERS.length + '列');
  console.log('  exhibitors:   ' + DB_EXHIBITOR_HEADERS.length + '列');
  console.log('  events:       ' + DB_EVENT_HEADERS.length + '列');
  if (!alreadySetUp) {
    console.log('  既存シートは「_backup_' + stamp + '_〜」として非表示で保存しました。');
  }
}

/**
 * 【手動実行2】現在の受付スプレッドシートの内容をデータベースへ取り込みます。
 *
 * - config.json の event.editionId / event.edition を開催回として記録します
 * - 同じ（開催回ID＋メール＋申込日時）の行は重複登録しません
 *   → 受付中に何度実行しても大丈夫です
 */
function migrateReceptionToDatabase() {
  const config = getConfig();
  const dbId   = getDatabaseSpreadsheetId_(config);
  if (!dbId) throw new Error(
      'config.json に databaseSpreadsheetId がありません。\n' +
      '読み込み元: ' + CONFIG_JSON_URL + '\n' +
      'このURLの中身に databaseSpreadsheetId が含まれているか確認してください。\n' +
      '（設定を更新した直後の場合は clearConfigCache を実行してから再実行してください）'
    );

  const edition = getEditionInfo_(config);
  if (!edition.editionId) {
    throw new Error(
      'config.json に event.editionId がありません。\n' +
      '読み込み元: ' + CONFIG_JSON_URL
    );
  }

  const src = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(RECEPTION_SHEET_NAME);
  if (!src || src.getLastRow() < 2) {
    console.log('受付シートに取り込むデータがありません。');
    return;
  }

  // ---- 受付シートを1回だけ読む ----
  const headers = src.getRange(1, 1, 1, src.getLastColumn()).getValues()[0];
  const rows    = src.getRange(2, 1, src.getLastRow() - 1, src.getLastColumn()).getValues();
  const resolved = resolveReceptionHeaders_(headers);

  const col = function (row, name) {
    const i = resolved.indexOf(name);
    return i >= 0 ? row[i] : '';
  };

  // ---- データベース側も1回だけ読む ----
  const dbSs     = SpreadsheetApp.openById(dbId);
  const appSheet = ensureDbSheet_(dbSs, DB_SHEET_APPLICATIONS, DB_APPLICATION_HEADERS);
  const appHeaders = DB_APPLICATION_HEADERS;

  const seen   = {};   // すでに入っている申込（重複を防ぐ）
  const prefix = edition.editionId + '-';
  let   maxSeq = 0;

  if (appSheet.getLastRow() >= 2) {
    const cur = appSheet.getRange(2, 1, appSheet.getLastRow() - 1, appHeaders.length).getValues();
    const iId = appHeaders.indexOf('申込ID');
    const iEd = appHeaders.indexOf('開催回ID');
    const iMl = appHeaders.indexOf('メールアドレス');
    const iDt = appHeaders.indexOf('申込日時');

    cur.forEach(function (r) {
      seen[[String(r[iEd] || ''), normalizeEmail_(r[iMl]), dateKey_(r[iDt])].join('|')] = true;
      const v = String(r[iId] || '');
      if (v.indexOf(prefix) === 0) {
        const n = parseInt(v.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    });
  }

  // ---- 追加ぶんを組み立てる（ここではシートに触らない） ----
  const now      = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  const newRows  = [];
  let   skipped  = 0;

  rows.forEach(function (row) {
    const name  = String(col(row, '氏名') || '').trim();
    const email = String(col(row, 'メールアドレス') || '').trim();
    if (!name && !email) { skipped++; return; }

    const when = dateKey_(col(row, '申込日時'));
    const key  = [edition.editionId, normalizeEmail_(email), when].join('|');
    if (seen[key]) { skipped++; return; }
    seen[key] = true;

    const record = {
      '申込ID':           prefix + padLeft_(++maxSeq, 4),
      '開催回ID':         edition.editionId,
      '開催回':           edition.edition,
      'イベント名':       edition.eventName,
      '出展者ID':         '',
      '申込日時':         formatCellDate_(col(row, '申込日時')),
      '氏名':             name,
      'フリガナ':         col(row, 'フリガナ'),
      'メールアドレス':   email,
      '電話番号':         col(row, '電話番号'),
      '郵便番号':         col(row, '郵便番号'),
      '住所':             col(row, '住所'),
      '出展カテゴリ':     col(row, '出展カテゴリ'),
      '出展名':           col(row, '出展名'),
      '出展ブース':       col(row, '出展ブース'),
      '出展メニュー名':   col(row, '出展メニュー名'),
      '自己紹介':         col(row, '自己紹介'),
      '持ち込み物品':     col(row, '持ち込み物品'),
      'SNS':              col(row, 'SNS'),
      '写真掲載可否':     col(row, '写真掲載可否'),
      'プロフィール写真': col(row, 'プロフィール写真'),
      'コンセント':       col(row, 'コンセント'),
      '懇親会出欠':       col(row, '懇親会出欠'),
      '懇親会人数':       col(row, '懇親会人数'),
      '二次会出欠':       col(row, '二次会出欠'),
      '二次会人数':       col(row, '二次会人数'),
      '協会会員':         col(row, '協会会員'),
      '景品提供':         col(row, '景品提供'),
      '景品内容':         col(row, '景品内容'),
      '備考・質問':       col(row, '備考・質問'),
      '座席番号':         col(row, '座席番号'),
      '合計金額':         col(row, '合計金額'),
      '入金確認':         col(row, '入金確認'),
      '入金日':           formatCellDate_(col(row, '入金日')),
      'ステータス':       String(col(row, '入金確認') || '').trim() ? '入金済' : '申込',
      'スタッフメモ':     col(row, 'スタッフメモ'),
      'LINEユーザーID':   col(row, 'LINEユーザーID'),
      'LINE表示名':       col(row, 'LINE表示名'),
      '登録元':           'migration',
      '登録日時':         now
    };

    newRows.push(appHeaders.map(function (h) {
      return record[h] !== undefined && record[h] !== null ? record[h] : '';
    }));
  });

  // ---- まとめて1回で書き込む ----
  if (newRows.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      appSheet.getRange(appSheet.getLastRow() + 1, 1, newRows.length, appHeaders.length)
        .setValues(newRows);
    } finally {
      lock.releaseLock();
    }
  }

  // ---- 出展者マスタは applications から数え直す（出展者IDもここで確定） ----
  const exhibitorCount = refreshExhibitorsFromApplications_(dbSs);
  fillExhibitorIds_(appSheet);
  upsertEvent_(dbSs, edition, config);

  console.log('取り込み完了: ' + newRows.length + '件を登録、' + skipped + '件をスキップ（重複・空行）');
  console.log('出展者マスタ: ' + exhibitorCount + '名');
}

/**
 * 受付シートのヘッダーを解決します。
 * ラベルが空欄の列は、直前の列から推測します（懇親会人数など）。
 */
function resolveReceptionHeaders_(headers) {
  const out = [];
  let prev = '';
  for (let i = 0; i < headers.length; i++) {
    const name = String(headers[i] === null || headers[i] === undefined ? '' : headers[i]).trim();
    if (name === '') {
      out.push(prev === '懇親会出欠' ? '懇親会人数' : (prev === '二次会出欠' ? '二次会人数' : ''));
    } else {
      out.push(name);
      prev = name;
    }
  }
  return out;
}

/** applications の空の「出展者ID」を、exhibitors の割り当てで埋めます */
function fillExhibitorIds_(appSheet) {
  if (appSheet.getLastRow() < 2) return;

  const ss      = appSheet.getParent();
  const exSheet = ss.getSheetByName(DB_SHEET_EXHIBITORS);
  if (!exSheet || exSheet.getLastRow() < 2) return;

  const exRows = exSheet.getRange(2, 1, exSheet.getLastRow() - 1, DB_EXHIBITOR_HEADERS.length).getValues();
  const idByKey = {};
  const iKey = DB_EXHIBITOR_HEADERS.indexOf('メールキー');
  const iId  = DB_EXHIBITOR_HEADERS.indexOf('出展者ID');
  exRows.forEach(function (r) { idByKey[String(r[iKey])] = r[iId]; });

  const headers = DB_APPLICATION_HEADERS;
  const iExId = headers.indexOf('出展者ID');
  const iName = headers.indexOf('氏名');
  const iMail = headers.indexOf('メールアドレス');
  const iShop = headers.indexOf('出展名');

  const rows = appSheet.getRange(2, 1, appSheet.getLastRow() - 1, headers.length).getValues();
  const ids  = rows.map(function (r) {
    const key = normalizeEmail_(r[iMail]) ||
                ('name:' + String(r[iName] || '').replace(/\s/g, '') + '/' + String(r[iShop] || '').replace(/\s/g, ''));
    return [idByKey[key] || r[iExId] || ''];
  });

  appSheet.getRange(2, iExId + 1, ids.length, 1).setValues(ids);
}

/**
 * 【必要なときだけ】データベースに記録済みの「開催回ID」を一括で付け替えます。
 *
 * 管理画面で開催回の呼び方を変えた場合（例: odawara-01 → 第1回）、
 * 過去に登録した行のIDは古いままです。そのままにすると、
 * 同じ回のデータが2つのIDに分かれて重複登録の原因になります。
 *
 * 使い方: 下の2行を書き換えてから実行してください。
 */
function renameEditionId() {
  const OLD_ID = 'odawara-01';   // ← 変更前のID
  const NEW_ID = '第1回';         // ← 変更後のID（管理画面の「開催回」と同じ文字）

  if (!OLD_ID || !NEW_ID) throw new Error('OLD_ID と NEW_ID を設定してください');
  if (OLD_ID === NEW_ID) { console.log('同じIDのため何もしません。'); return; }

  const config = getConfig();
  const dbId = getDatabaseSpreadsheetId_(config);
  if (!dbId) throw new Error('config.json に databaseSpreadsheetId がありません');

  const ss = SpreadsheetApp.openById(dbId);
  let changed = 0;

  // applications: 開催回ID と、申込IDの先頭を付け替える
  const appSheet = ss.getSheetByName(DB_SHEET_APPLICATIONS);
  if (appSheet && appSheet.getLastRow() >= 2) {
    const headers = appSheet.getRange(1, 1, 1, appSheet.getLastColumn()).getValues()[0];
    const idxEdition = headers.indexOf('開催回ID');
    const idxAppId   = headers.indexOf('申込ID');
    const rowCount   = appSheet.getLastRow() - 1;

    if (idxEdition >= 0) {
      const editions = appSheet.getRange(2, idxEdition + 1, rowCount, 1).getValues();
      const appIds   = idxAppId >= 0 ? appSheet.getRange(2, idxAppId + 1, rowCount, 1).getValues() : null;

      for (let i = 0; i < editions.length; i++) {
        if (String(editions[i][0]).trim() !== OLD_ID) continue;
        editions[i][0] = NEW_ID;
        if (appIds) {
          const cur = String(appIds[i][0] || '');
          if (cur.indexOf(OLD_ID + '-') === 0) {
            appIds[i][0] = NEW_ID + '-' + cur.slice(OLD_ID.length + 1);
          }
        }
        changed++;
      }

      appSheet.getRange(2, idxEdition + 1, rowCount, 1).setValues(editions);
      if (appIds) appSheet.getRange(2, idxAppId + 1, rowCount, 1).setValues(appIds);
    }
  }

  // exhibitors: 最終開催回
  const exSheet = ss.getSheetByName(DB_SHEET_EXHIBITORS);
  if (exSheet && exSheet.getLastRow() >= 2) {
    const headers = exSheet.getRange(1, 1, 1, exSheet.getLastColumn()).getValues()[0];
    const idx = headers.indexOf('最終開催回');
    if (idx >= 0) {
      const rowCount = exSheet.getLastRow() - 1;
      const values = exSheet.getRange(2, idx + 1, rowCount, 1).getValues();
      let touched = false;
      values.forEach(function (r) {
        if (String(r[0]).trim() === OLD_ID) { r[0] = NEW_ID; touched = true; }
      });
      if (touched) exSheet.getRange(2, idx + 1, rowCount, 1).setValues(values);
    }
  }

  // events: 開催回ID
  const evSheet = ss.getSheetByName(DB_SHEET_EVENTS);
  if (evSheet && evSheet.getLastRow() >= 2) {
    const rowCount = evSheet.getLastRow() - 1;
    const ids = evSheet.getRange(2, 1, rowCount, 1).getValues();
    let touched = false;
    ids.forEach(function (r) {
      if (String(r[0]).trim() === OLD_ID) { r[0] = NEW_ID; touched = true; }
    });
    if (touched) evSheet.getRange(2, 1, rowCount, 1).setValues(ids);
  }

  console.log('開催回IDを付け替えました: ' + OLD_ID + ' → ' + NEW_ID + '（applications ' + changed + '件）');
}

/**
 * 【修復用】exhibitors シートを applications から作り直します。
 *
 * 取り込みが途中で止まると、申込は入っていないのに出展者だけ登録された行や、
 * 出展回数が実際より多い行が残ることがあります。
 * この関数は applications を正として数え直すため、何度実行しても同じ結果になります。
 *
 * - 出展者IDと「スタッフメモ」は、いま入っている値を引き継ぎます
 * - applications に1件も無い人（テスト行など）は取り除かれます
 */
function rebuildExhibitors() {
  const config = getConfig();
  const dbId   = getDatabaseSpreadsheetId_(config);
  if (!dbId) throw new Error('databaseSpreadsheetId が設定されていません');

  const ss       = SpreadsheetApp.openById(dbId);
  const appSheet = ss.getSheetByName(DB_SHEET_APPLICATIONS);
  if (!appSheet || appSheet.getLastRow() < 2) {
    console.log('applications にデータがありません。');
    return;
  }

  const appHeaders = appSheet.getRange(1, 1, 1, appSheet.getLastColumn()).getValues()[0];
  const appRows    = appSheet.getRange(2, 1, appSheet.getLastRow() - 1, appSheet.getLastColumn()).getValues();

  const exSheet  = ensureDbSheet_(ss, DB_SHEET_EXHIBITORS, DB_EXHIBITOR_HEADERS);
  const existing = {};
  if (exSheet.getLastRow() >= 2) {
    const cur = exSheet.getRange(2, 1, exSheet.getLastRow() - 1, DB_EXHIBITOR_HEADERS.length).getValues();
    cur.forEach(function (row) {
      const obj = {};
      DB_EXHIBITOR_HEADERS.forEach(function (h, i) { obj[h] = row[i]; });
      if (obj['メールキー']) existing[String(obj['メールキー'])] = obj;
    });
  }

  const rows = buildExhibitorRows_(appHeaders, appRows, existing);
  writeExhibitorRows_(exSheet, rows);

  console.log('exhibitors を作り直しました: ' + rows.length + '名');
  console.log('（applications ' + appRows.length + '件から集計）');
}

/** exhibitors シートを丸ごと書き直します（1行目は残します） */
function writeExhibitorRows_(exSheet, rows) {
  if (exSheet.getLastRow() > 1) {
    exSheet.getRange(2, 1, exSheet.getLastRow() - 1, DB_EXHIBITOR_HEADERS.length).clearContent();
  }
  if (rows.length) {
    exSheet.getRange(2, 1, rows.length, DB_EXHIBITOR_HEADERS.length).setValues(rows);
  }
}

/** applications を読み直して exhibitors を作り直します（移行の仕上げにも使用） */
function refreshExhibitorsFromApplications_(ss) {
  const appSheet = ss.getSheetByName(DB_SHEET_APPLICATIONS);
  if (!appSheet || appSheet.getLastRow() < 2) return 0;

  const appHeaders = appSheet.getRange(1, 1, 1, appSheet.getLastColumn()).getValues()[0];
  const appRows    = appSheet.getRange(2, 1, appSheet.getLastRow() - 1, appSheet.getLastColumn()).getValues();

  const exSheet  = ensureDbSheet_(ss, DB_SHEET_EXHIBITORS, DB_EXHIBITOR_HEADERS);
  const existing = {};
  if (exSheet.getLastRow() >= 2) {
    const cur = exSheet.getRange(2, 1, exSheet.getLastRow() - 1, DB_EXHIBITOR_HEADERS.length).getValues();
    cur.forEach(function (row) {
      const obj = {};
      DB_EXHIBITOR_HEADERS.forEach(function (h, i) { obj[h] = row[i]; });
      if (obj['メールキー']) existing[String(obj['メールキー'])] = obj;
    });
  }

  const rows = buildExhibitorRows_(appHeaders, appRows, existing);
  writeExhibitorRows_(exSheet, rows);
  return rows.length;
}

/**
 * applications の全行から exhibitors の中身を組み立てます。
 * シートに触れないため、単体で検証できます。
 */
function buildExhibitorRows_(appHeaders, appRows, existing) {
  const col = function (row, name) {
    const i = appHeaders.indexOf(name);
    return i >= 0 ? row[i] : '';
  };

  // 申込日時の古い順に見ていく（初回・最終を正しく出すため）
  const sorted = appRows.slice().sort(function (a, b) {
    return dateKey_(col(a, '申込日時')).localeCompare(dateKey_(col(b, '申込日時')));
  });

  const byKey = {};
  const order = [];

  sorted.forEach(function (row) {
    const name  = String(col(row, '氏名') || '').trim();
    const email = String(col(row, 'メールアドレス') || '').trim();
    const shop  = String(col(row, '出展名') || '').trim();
    if (!name && !email) return;

    const key = normalizeEmail_(email) ||
                ('name:' + name.replace(/\s/g, '') + '/' + shop.replace(/\s/g, ''));
    const when = dateKey_(col(row, '申込日時'));

    if (!byKey[key]) {
      byKey[key] = { key: key, count: 0, first: when, last: when, values: {} };
      order.push(key);
    }

    const e = byKey[key];
    e.count += 1;
    if (!e.first || (when && when < e.first)) e.first = when;
    if (when && when > e.last) e.last = when;

    // 空の値では上書きしない（新しい申込ほど優先）
    const keep = function (field, value) {
      if (value !== '' && value !== null && value !== undefined) e.values[field] = value;
    };
    keep('氏名', name);
    keep('フリガナ',   col(row, 'フリガナ'));
    keep('メールアドレス', email);
    keep('電話番号',   col(row, '電話番号'));
    keep('郵便番号',   col(row, '郵便番号'));
    keep('住所',       col(row, '住所'));
    keep('最新出展名',           shop);
    keep('最新出展カテゴリ',     col(row, '出展カテゴリ'));
    keep('最新出展メニュー名',   col(row, '出展メニュー名'));
    keep('最新自己紹介',         col(row, '自己紹介'));
    keep('最新SNS',              col(row, 'SNS'));
    keep('最新プロフィール写真', col(row, 'プロフィール写真'));
    keep('最終開催回',           col(row, '開催回') || col(row, '開催回ID'));
  });

  // 既にあった出展者IDを引き継ぎ、新しい人には続きの番号を振る
  let maxId = 0;
  Object.keys(existing || {}).forEach(function (k) {
    const m = String(existing[k]['出展者ID'] || '').match(/^EX(\d+)$/);
    if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
  });

  return order.map(function (key) {
    const e   = byKey[key];
    const old = (existing || {})[key] || {};

    const row = {
      '出展者ID':   old['出展者ID'] || ('EX' + padLeft_(++maxId, 4)),
      'メールキー': key,
      '出展回数':   e.count,
      '初回申込日時': e.first,
      '最終申込日時': e.last,
      'スタッフメモ': old['スタッフメモ'] || ''
    };
    Object.keys(e.values).forEach(function (f) { row[f] = e.values[f]; });

    return DB_EXHIBITOR_HEADERS.map(function (h) {
      return row[h] !== undefined && row[h] !== null ? row[h] : '';
    });
  });
}

/**
 * 【任意】開催が終わったあとに、受付スプシの最終状態（座席番号・入金など）を
 * データベースへ反映します。申込日時をキーに既存行を更新します。
 */
function syncReceptionUpdatesToDatabase() {
  const config = getConfig();
  const dbId   = getDatabaseSpreadsheetId_(config);
  if (!dbId) throw new Error(
      'config.json に databaseSpreadsheetId がありません。\n' +
      '読み込み元: ' + CONFIG_JSON_URL + '\n' +
      'このURLの中身に databaseSpreadsheetId が含まれているか確認してください。\n' +
      '（設定を更新した直後の場合は clearConfigCache を実行してから再実行してください）'
    );

  const edition = getEditionInfo_(config);
  const src = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(RECEPTION_SHEET_NAME);
  const dbSheet = SpreadsheetApp.openById(dbId).getSheetByName(DB_SHEET_APPLICATIONS);
  if (!src || !dbSheet || src.getLastRow() < 2 || dbSheet.getLastRow() < 2) {
    console.log('同期対象がありません。');
    return;
  }

  const srcHeaders = src.getRange(1, 1, 1, src.getLastColumn()).getValues()[0];
  const srcRows    = src.getRange(2, 1, src.getLastRow() - 1, src.getLastColumn()).getValues();
  const srcCol = function (row, name) {
    const i = srcHeaders.indexOf(name);
    return i >= 0 ? row[i] : '';
  };

  const dbHeaders = dbSheet.getRange(1, 1, 1, dbSheet.getLastColumn()).getValues()[0];
  const dbRows    = dbSheet.getRange(2, 1, dbSheet.getLastRow() - 1, dbSheet.getLastColumn()).getValues();

  const idxEdition = dbHeaders.indexOf('開催回ID');
  const idxMail    = dbHeaders.indexOf('メールアドレス');
  const idxDate    = dbHeaders.indexOf('申込日時');

  const targets = ['座席番号', '合計金額', '入金確認', '入金日', 'スタッフメモ'];
  let updated = 0;

  srcRows.forEach(function (row) {
    const key = [
      edition.editionId,
      normalizeEmail_(srcCol(row, 'メールアドレス')),
      dateKey_(srcCol(row, '申込日時'))
    ].join('|');

    for (let i = 0; i < dbRows.length; i++) {
      const dbKey = [
        String(dbRows[i][idxEdition] || ''),
        normalizeEmail_(dbRows[i][idxMail]),
        dateKey_(dbRows[i][idxDate])
      ].join('|');

      if (dbKey !== key) continue;

      targets.forEach(function (name) {
        const dbIdx = dbHeaders.indexOf(name);
        if (dbIdx < 0) return;
        const value = name === '入金日' ? formatCellDate_(srcCol(row, name)) : srcCol(row, name);
        if (value !== '' && value !== null && value !== undefined) {
          dbSheet.getRange(i + 2, dbIdx + 1).setValue(value);
        }
      });

      const statusIdx = dbHeaders.indexOf('ステータス');
      if (statusIdx >= 0 && String(srcCol(row, '入金確認') || '').trim()) {
        dbSheet.getRange(i + 2, statusIdx + 1).setValue('入金済');
      }

      updated++;
      break;
    }
  });

  console.log('同期完了: ' + updated + '件を更新しました。');
}

// ================================================================
// ユーティリティ
// ================================================================

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeParseJson_(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (e) { return fallback; }
}

function normalizeEmail_(email) {
  return String(email === null || email === undefined ? '' : email).trim().toLowerCase();
}

function padLeft_(num, width) {
  let s = String(num);
  while (s.length < width) s = '0' + s;
  return s;
}

/** 日付セルは Date オブジェクトで返ることがあるため文字列へ揃える */
function formatCellDate_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  }
  return String(value).trim();
}

/**
 * 重複判定に使う日時キーを作ります。
 *
 * 同じ「2026/05/05 7:31:56」でも、シートに書き込むと日付型に変換されて
 * 「2026/05/05 07:31:56」として読み戻されることがあります。
 * ゼロ埋めを揃えないと、取り込みを再実行するたびに重複してしまうため、
 * 数字だけを取り出して同じ形に正規化します。
 */
function dateKey_(value) {
  const text = formatCellDate_(value);
  if (!text) return '';

  const m = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}))?)?/);
  if (!m) return text;

  return m[1] + '/' + padLeft_(m[2], 2) + '/' + padLeft_(m[3], 2) + ' ' +
         padLeft_(m[4] || 0, 2) + ':' + padLeft_(m[5] || 0, 2) + ':' + padLeft_(m[6] || 0, 2);
}

function applyTemplate(template, vars) {
  let result = String(template || '');
  Object.keys(vars).forEach(function (key) {
    // 差し込み名は質問文をそのまま使うため、記号（（） ・ ? など）が
    // 正規表現として解釈されないようエスケープする
    const safeKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(
      new RegExp('\\{\\{' + safeKey + '\\}\\}', 'g'),
      vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ''
    );
  });
  return result;
}

function formatSnsLinks(snsJson) {
  if (!snsJson) return 'なし';
  if (typeof snsJson === 'string' && snsJson.indexOf('[') !== 0) return snsJson;
  try {
    const links = typeof snsJson === 'string' ? JSON.parse(snsJson) : snsJson;
    if (!Array.isArray(links) || !links.length) return 'なし';
    return links.map(function (l) { return l.type + ': ' + l.url; }).join('\n');
  } catch (e) {
    return String(snsJson) || 'なし';
  }
}

function defaultConfirmationTemplate() {
  return [
    '{{name}} 様',
    '',
    'この度はお申込みいただきありがとうございます。',
    '以下の内容でお申込みを受け付けました。',
    '',
    '■ お申込み情報',
    'お名前: {{name}}',
    'メールアドレス: {{email}}',
    '出展ブース: {{boothName}}',
    '',
    '■ お支払い金額',
    '{{breakdown}}',
    '合計: ¥{{totalFee}}',
    '',
    'ご不明な点はこのメールへ返信ください。',
    '',
    '{{eventName}} 運営事務局'
  ].join('\n');
}

// ================================================================
// 動作テスト（手動実行）
// ================================================================

/** 受付シートに1行も書かずに、列の対応だけ確認します */
function testReceptionColumnMapping() {
  const config = getConfig();
  const sheet  = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(RECEPTION_SHEET_NAME);
  if (!sheet) throw new Error('受付シートが見つかりません: ' + RECEPTION_SHEET_NAME);

  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const dummy = buildTestParams_(config);
  const calc  = calculatePrice(dummy, config);
  const row   = mapRowToHeaders_(headerRow, buildFieldMap(dummy, calc, config));

  headerRow.forEach(function (h, i) {
    console.log((i + 1) + '列目 [' + (h || '(空欄)') + '] → ' + row[i]);
  });
}

/** 受付シートへ1行テスト書き込みします（確認後、行を削除してください） */
function testDoPost() {
  const config = getConfig();
  const params = buildTestParams_(config);
  const calc   = calculatePrice(params, config);

  saveToReceptionSheet(params, calc, config);
  const db = saveToDatabase(params, calc, config);

  console.log('受付シートへ書き込みました。合計: ¥' + calc.totalFee);
  console.log('DB書き込み: ' + JSON.stringify(db));
  console.log('※ テスト行は手動で削除してください。');
}

function buildTestParams_(config) {
  const cq = {};
  (config.customQuestions || []).forEach(function (q) {
    cq[q.id] = 'テスト回答（' + q.label + '）';
  });

  return {
    name: 'テスト太郎',
    furigana: 'てすとたろう',
    email: 'test@example.com',
    phoneNumber: '090-0000-0000',
    postalCode: '100-0001',
    address: '東京都千代田区1-1',
    exhibitorName: 'テストサロン',
    category: (config.categories || [])[0] || '',
    boothId: (config.booths || [])[0] ? config.booths[0].id : 'booth_s',
    isEarlyBird: '0',
    extraStaff: '0',
    extraChairs: '0',
    usePower: '0',
    partyAttend: '欠席',
    partyCount: '0',
    secondaryPartyAttend: '欠席',
    secondaryPartyCount: '0',
    isMember: '0',
    agreeTerms: 'on',
    snsLinks: JSON.stringify([{ type: 'Instagram', url: 'https://instagram.com/test' }]),
    customAnswers: cq,
    notes: 'テスト送信',
    stampRallyPrize: 'ない',
    photoPermission: '可',
    lineUserId: '',
    lineDisplayName: '',
    profileImageUrl: '',
    submittedAt: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss')
  };
}
