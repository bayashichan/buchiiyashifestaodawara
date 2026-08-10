/**
 * 申込フォーム 設定スキーマ / 料金計算エンジン
 *
 * このファイルは「料金計算の単一の真実」です。
 * ブラウザ（申込フォーム・管理画面）と Google Apps Script の両方から使います。
 * GAS へは同じ内容を pricing.gs としてコピーして配置してください。
 * そのため依存ゼロ・プレーンな関数宣言のみで書いています。
 */

var SCHEMA_VERSION = 2;

/** 申込項目として使える入力タイプ */
var FIELD_TYPES = [
  'text', 'textarea', 'select', 'radio', 'checkbox', 'checkboxGroup',
  'number', 'email', 'tel', 'postal', 'address', 'date', 'url',
  'image', 'snsLinks', 'heading',
  // 構造上の特別な項目。並び替えできるよう fields[] に含めるが、
  // 選択肢は categories[] / booths[] 側で管理する。
  'category', 'booth'
];

/** 管理画面で自由に追加・削除できないタイプ（1フォームに1つだけ） */
var SINGLETON_TYPES = ['category', 'booth'];

/** 値を持たない（回答として保存しない）表示専用タイプ */
var DISPLAY_ONLY_TYPES = ['heading'];

/** フォームのセクション定義。順序もここで決まる */
var SECTIONS = [
  { id: 'basic',   title: '基本情報',   icon: '📝' },
  { id: 'exhibit', title: '出展内容',   icon: '✨' },
  { id: 'sns',     title: 'SNSリンク',  icon: '🔗' },
  { id: 'options', title: 'オプション', icon: '⚙️' },
  { id: 'terms',   title: '規約・その他', icon: '📋' }
];

// ========================================
// 小さなユーティリティ
// ========================================

function isFiniteNumber(v) {
  return typeof v === 'number' && isFinite(v);
}

function toInt(v, fallback) {
  var n = parseInt(v, 10);
  return isNaN(n) ? (fallback || 0) : n;
}

function formatYen(n) {
  return '¥' + Math.round(n || 0).toLocaleString('ja-JP');
}

/** 空白（半角・全角）を除去して小文字化。氏名・メールの照合用 */
function normalizeForMatch(str) {
  return String(str == null ? '' : str).replace(/[\s　]/g, '').toLowerCase();
}

// ========================================
// 早割判定
// ========================================

/**
 * 早割期間中かどうか。
 * earlyBird.excludeMembers が true のとき、会員は早割対象外になります
 * （東京版 GAS の挙動。既定は false ＝ 会員でも早割適用）。
 */
function isEarlyBirdActive(config, opts) {
  opts = opts || {};
  var eb = (config && config.earlyBird) || {};
  if (!eb.enabled) return false;
  if (!eb.deadline) return false;

  if (eb.excludeMembers && opts.isMember) return false;

  var deadline = parseDeadline(eb.deadline);
  if (!deadline) return false;

  var now = opts.now ? new Date(opts.now) : new Date();
  return now.getTime() <= deadline.getTime();
}

/**
 * 早割締切を Date に変換する。
 *
 * 重要: "2026-06-30 23:59:00" のようにタイムゾーンを持たない文字列は、
 * 実行環境のローカルタイムゾーンで解釈されてしまう。申込フォーム（利用者の
 * ブラウザ）と GAS（スクリプトのタイムゾーン設定）で解釈がずれると、
 * 早割の判定がクライアントとサーバで食い違い、表示額と請求額が一致しなくなる。
 * そのため、タイムゾーン指定のない値は常に日本時間（+09:00）として扱う。
 *
 * 日付のみ（"2026-06-30"）の場合は「その日いっぱい」と解釈し 23:59:59 とする。
 */
function parseDeadline(value) {
  if (!value) return null;
  var s = String(value).trim().replace(' ', 'T');

  var hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  if (!hasZone) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      s += 'T23:59:59';
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) {
      s += ':00';
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) {
      s += '+09:00';
    }
  }

  var d = new Date(s);
  if (!isNaN(d.getTime())) return d;

  d = new Date(String(value));
  return isNaN(d.getTime()) ? null : d;
}

// ========================================
// ブース別のオプション可否
// ========================================

/**
 * 選択中ブースでそのオプションが使えるか、上限はいくつかを解決する。
 *
 * 優先順位:
 *   1. booth.options[optionId] にブース個別の指定があればそれ
 *   2. なければ option.defaultAvailable（未指定なら true）
 *
 * 「空＝全部可」のような暗黙ルールは採らない。オプションを新規追加したときに
 * 全ブースで意図せず有効になる事故を防ぐため、既定値はオプション側に明示させる。
 */
function resolveOptionForBooth(option, booth) {
  if (!option || option.enabled === false) {
    return { available: false, max: 0 };
  }

  var baseMax = defaultMaxFor(option);

  // ブースに依存しないオプション（懇親会・弁当など）は常に利用可
  if (option.scope === 'global') {
    return { available: true, max: baseMax };
  }

  // scope: 'booth' — ブース未選択なら出さない
  if (!booth) {
    return { available: false, max: 0 };
  }

  var per = (booth.options || {})[option.id];
  var available;
  if (per && typeof per.available === 'boolean') {
    available = per.available;
  } else {
    available = option.defaultAvailable !== false;
  }

  var max = (per && isFiniteNumber(per.max)) ? per.max : baseMax;

  // 数量型で上限0は「使えない」と同義
  if (option.inputType === 'quantity' && max <= 0) {
    available = false;
  }

  return { available: available, max: max };
}

function defaultMaxFor(option) {
  if (option.inputType === 'toggle') return 1;
  if (isFiniteNumber(option.max)) return option.max;
  return option.inputType === 'quantity' ? 99 : 1;
}

/** select 型オプションの選択肢を value で引く */
function findChoice(option, value) {
  var choices = option.choices || [];
  for (var i = 0; i < choices.length; i++) {
    var c = choices[i];
    var v = (c.value != null) ? c.value : c.label;
    if (String(v) === String(value)) return c;
  }
  return null;
}

// ========================================
// 料金計算（単一の真実）
// ========================================

/**
 * 選択内容から見積もりを組み立てる。
 *
 * @param {Object} config  正規化済み config（normalizeConfig の戻り値）
 * @param {Object} state
 *   - boothId  {string|null}
 *   - options  {Object} optionId -> 値（toggle:boolean / quantity:number / select:選択値）
 *   - isMember {boolean}
 *   - now      {Date|string} 早割判定の基準時刻（省略時は現在時刻）
 *
 * @returns {Object}
 *   - lineItems {Array} [{ id, label, unitPrice, qty, amount }]
 *   - total     {number}
 *   - earlyBird {boolean}
 *   - notices   {Array} 入力を自動調整した場合の説明。UI はこれを必ず利用者へ提示する。
 *   - options   {Object} 調整後の確定値
 */
function computeQuote(config, state) {
  config = config || {};
  state = state || {};

  var lineItems = [];
  var notices = [];
  var total = 0;

  var booths = config.booths || [];
  var booth = null;
  for (var i = 0; i < booths.length; i++) {
    if (booths[i].id === state.boothId) { booth = booths[i]; break; }
  }

  var isMember = !!state.isMember && !!(config.pricing &&
    config.pricing.memberDiscount && config.pricing.memberDiscount.enabled);

  var earlyBird = isEarlyBirdActive(config, { isMember: isMember, now: state.now });

  // --- ブース料金 ---
  if (booth) {
    if (booth.soldOut) {
      notices.push({
        type: 'boothSoldOut',
        optionId: null,
        message: booth.name + 'は満枠のため選択できません。'
      });
      booth = null;
    } else {
      var prices = booth.prices || {};
      var boothPrice = earlyBird && isFiniteNumber(prices.earlyBird)
        ? prices.earlyBird
        : prices.regular;
      boothPrice = isFiniteNumber(boothPrice) ? boothPrice : 0;

      lineItems.push({
        id: 'booth:' + booth.id,
        label: booth.name,
        unitPrice: boothPrice,
        qty: 1,
        amount: boothPrice
      });
      total += boothPrice;
    }
  }

  // --- オプション ---
  var resolved = {};
  var options = ((config.pricing || {}).options || []).slice().sort(byOrder);

  for (var j = 0; j < options.length; j++) {
    var opt = options[j];
    if (opt.enabled === false) continue;

    var raw = state.options ? state.options[opt.id] : undefined;
    var gate = resolveOptionForBooth(opt, booth);

    // 使えないのに選ばれている → 解除して理由を通知する。
    // 金額が黙って変わるのを避けるため、必ず notices に積む。
    if (!gate.available) {
      if (hasSelection(opt, raw)) {
        notices.push({
          type: 'optionUnavailable',
          optionId: opt.id,
          message: '「' + opt.label + '」は選択されたブースではご利用いただけないため解除しました。'
        });
      }
      resolved[opt.id] = emptyValueFor(opt);
      continue;
    }

    if (opt.inputType === 'toggle') {
      var on = raw === true || raw === 1 || raw === '1' || raw === 'true';
      resolved[opt.id] = on;
      if (on) {
        var tPrice = isFiniteNumber(opt.price) ? opt.price : 0;
        lineItems.push({
          id: opt.id, label: opt.label, unitPrice: tPrice, qty: 1, amount: tPrice
        });
        total += tPrice;
      }

    } else if (opt.inputType === 'quantity') {
      var qty = toInt(raw, 0);
      if (qty < 0) qty = 0;
      if (qty > gate.max) {
        notices.push({
          type: 'optionClamped',
          optionId: opt.id,
          message: '「' + opt.label + '」は選択されたブースでは' + gate.max +
                   (opt.unit || '') + 'までのため、' + gate.max + (opt.unit || '') + 'に変更しました。'
        });
        qty = gate.max;
      }
      resolved[opt.id] = qty;
      if (qty > 0) {
        var qPrice = isFiniteNumber(opt.price) ? opt.price : 0;
        lineItems.push({
          id: opt.id,
          label: opt.label + '×' + qty + (opt.unit || ''),
          unitPrice: qPrice,
          qty: qty,
          amount: qPrice * qty
        });
        total += qPrice * qty;
      }

    } else if (opt.inputType === 'select') {
      var choice = (raw === '' || raw == null) ? null : findChoice(opt, raw);
      if (raw && !choice) {
        notices.push({
          type: 'optionInvalidChoice',
          optionId: opt.id,
          message: '「' + opt.label + '」の選択内容が無効だったため未選択に戻しました。'
        });
      }
      resolved[opt.id] = choice ? ((choice.value != null) ? choice.value : choice.label) : '';
      if (choice) {
        var cPrice = isFiniteNumber(choice.price) ? choice.price : 0;
        if (cPrice !== 0) {
          lineItems.push({
            id: opt.id,
            label: opt.label + '（' + choice.label + '）',
            unitPrice: cPrice,
            qty: 1,
            amount: cPrice
          });
          total += cPrice;
        }
      }
    }
  }

  // --- 会員割引 ---
  var md = (config.pricing || {}).memberDiscount || {};
  if (isMember && isFiniteNumber(md.amount) && md.amount > 0) {
    lineItems.push({
      id: 'memberDiscount',
      label: md.label || '会員割引',
      unitPrice: -md.amount,
      qty: 1,
      amount: -md.amount
    });
    total -= md.amount;
  }

  if (total < 0) total = 0;

  return {
    lineItems: lineItems,
    total: total,
    earlyBird: earlyBird,
    notices: notices,
    options: resolved,
    boothId: booth ? booth.id : null
  };
}

function byOrder(a, b) {
  var ao = isFiniteNumber(a.order) ? a.order : 9999;
  var bo = isFiniteNumber(b.order) ? b.order : 9999;
  return ao - bo;
}

function hasSelection(option, raw) {
  if (raw == null || raw === '' || raw === false) return false;
  if (option.inputType === 'quantity') return toInt(raw, 0) > 0;
  if (option.inputType === 'toggle') return raw === true || raw === 1 || raw === '1' || raw === 'true';
  return true;
}

function emptyValueFor(option) {
  if (option.inputType === 'toggle') return false;
  if (option.inputType === 'quantity') return 0;
  return '';
}

/** 確認メール本文の {{breakdown}} 用。1行1明細のテキストに整形する */
function formatBreakdown(quote) {
  var lines = [];
  var items = (quote && quote.lineItems) || [];
  for (var i = 0; i < items.length; i++) {
    lines.push(items[i].label + '　' + formatYen(items[i].amount));
  }
  return lines.join('\n');
}

// ========================================
// 設定の正規化（v1 → v2）
// ========================================

/**
 * 旧形式(v1)の config.json を新形式(v2)へ変換する。
 * 既に v2 のものはそのまま補完だけ行う。
 * これにより既存の config.json を書き換えずに新エンジンを動かせる。
 */
function normalizeConfig(raw) {
  raw = raw || {};
  if (toInt(raw.schemaVersion, 1) >= 2) {
    return fillDefaults(raw);
  }
  return fillDefaults(migrateV1ToV2(raw));
}

function migrateV1ToV2(raw) {
  var features = raw.features || {};
  var v1Options = (raw.pricing || {}).options || {};

  var out = {
    schemaVersion: SCHEMA_VERSION,
    theme: raw.theme || {},
    event: {
      name: (raw.event || {}).name || raw.eventName || '',
      date: (raw.event || {}).date || raw.eventDate || '',
      location: (raw.event || {}).location || raw.eventLocation || '',
      headerNote: '',
      applicationDeadline: ''
    },
    earlyBird: {
      enabled: !!features.earlyBird,
      deadline: (raw.event || {}).earlyBirdDeadline || raw.earlyBirdDeadline || '',
      label: '早割',
      bannerText: '',
      excludeMembers: false
    },
    media: [],
    categories: raw.categories || [],
    // prohibitSession のブースで警告を出す対象カテゴリ。
    // v1 ではコードに直接書かれていたので、その値を既定として設定へ移す。
    sessionCategories: ['占い・スピリチュアル', 'ボディケア・美容'],
    booths: [],
    pricing: {
      memberDiscount: {
        enabled: !!features.memberDiscount,
        label: features.memberDiscountLabel || '会員割引',
        amount: toInt((raw.pricing || {}).memberDiscount, 0)
      },
      options: []
    },
    fields: [],
    terms: {
      title: '出展規約',
      body: typeof raw.terms === 'string' ? raw.terms : ((raw.terms || {}).body || ''),
      requireAgree: true,
      displayMode: 'modal'
    },
    email: raw.email || {},
    repeater: {
      enabled: !!features.repeaterSearch,
      matchFields: ['name', 'email'],
      restoreFieldIds: [],
      codeDigits: 4,
      codeTtlSeconds: 600,
      maxAttempts: 5,
      resendCooldownSeconds: 60
    },
    integration: {
      gasUrl: raw.gasUrl || '',
      workerUrl: raw.workerUrl || '',
      configJsonUrl: raw.configJsonUrl || '',
      liffId: features.liffId || ''
    }
  };

  // --- オプションの配列化 ---
  // v1 は power/chair/staff/party/secondaryParty の固定5キーだった。
  // scope は現行の挙動に合わせる（懇親会系はブース非依存）。
  var optionSpecs = [
    { key: 'power',          inputType: 'toggle',   scope: 'booth',  unit: '',   order: 10 },
    { key: 'chair',          inputType: 'quantity', scope: 'booth',  unit: '脚', order: 20 },
    { key: 'staff',          inputType: 'quantity', scope: 'booth',  unit: '名', order: 30 },
    { key: 'party',          inputType: 'quantity', scope: 'global', unit: '名', order: 40 },
    { key: 'secondaryParty', inputType: 'quantity', scope: 'global', unit: '名', order: 50 }
  ];

  for (var i = 0; i < optionSpecs.length; i++) {
    var spec = optionSpecs[i];
    var src = v1Options[spec.key];
    if (!src) continue;

    var enabled = src.enabled !== false;
    // v1 では features 側でも懇親会/二次会を制御していた
    if (spec.key === 'party') enabled = enabled && features.party !== false;
    if (spec.key === 'secondaryParty') enabled = enabled && !!features.secondaryParty;

    out.pricing.options.push({
      id: spec.key,
      label: src.label || spec.key,
      description: '',
      inputType: spec.inputType,
      scope: spec.scope,
      defaultAvailable: true,
      price: toInt(src.price, 0),
      max: spec.inputType === 'toggle' ? 1 : 99,
      unit: spec.unit,
      enabled: enabled,
      order: spec.order,
      choices: []
    });
  }

  // --- ブース ---
  // v1 の limits{allowPower,maxChairs,maxStaff} を booth.options へ展開する
  var srcBooths = raw.booths || [];
  for (var b = 0; b < srcBooths.length; b++) {
    var sb = srcBooths[b];
    var limits = sb.limits || {};
    out.booths.push({
      id: sb.id,
      name: sb.name,
      description: sb.description || '',
      location: sb.location || '',
      imageUrl: sb.imageUrl || '',
      prices: {
        regular: toInt((sb.prices || {}).regular, 0),
        earlyBird: toInt((sb.prices || {}).earlyBird, toInt((sb.prices || {}).regular, 0))
      },
      soldOut: !!sb.soldOut,
      prohibitSession: !!sb.prohibitSession,
      options: {
        power: { available: limits.allowPower !== false },
        chair: { available: toInt(limits.maxChairs, 0) > 0, max: toInt(limits.maxChairs, 0) },
        staff: { available: toInt(limits.maxStaff, 0) > 0, max: toInt(limits.maxStaff, 0) }
      }
    });
  }

  out.fields = buildFieldsFromV1(raw, out.booths);
  return out;
}

/**
 * v1 の standardFields（ON/OFFの固定枠）と customQuestions を
 * 統合した fields[] に変換する。並び順は現行フォームの見た目に合わせている。
 */
function buildFieldsFromV1(raw, booths) {
  var sf = raw.standardFields || {};
  var features = raw.features || {};
  var fields = [];

  fields.push({
    id: 'name', section: 'basic', type: 'text', label: 'お名前（本名）',
    placeholder: '山田 太郎', required: true, maxLength: 50, system: 'name'
  });
  fields.push({
    id: 'furigana', section: 'basic', type: 'text', label: 'ふりがな',
    placeholder: 'やまだ たろう', required: true, maxLength: 50, system: 'furigana'
  });
  fields.push({
    id: 'email', section: 'basic', type: 'email', label: 'メールアドレス',
    placeholder: 'example@example.com', required: true, confirm: true, system: 'email'
  });

  if (sf.showPhoneNumber !== false) {
    fields.push({
      id: 'phoneNumber', section: 'basic', type: 'tel', label: '電話番号',
      placeholder: '09012345678', required: true, system: 'phone'
    });
  }
  if (sf.showAddress !== false) {
    fields.push({
      id: 'postalCode', section: 'basic', type: 'postal', label: '郵便番号',
      placeholder: '1234567', required: true, linkTo: 'address', system: 'postalCode'
    });
    fields.push({
      id: 'address', section: 'basic', type: 'address', label: 'ご住所',
      required: true, system: 'address'
    });
  }

  fields.push({
    id: 'exhibitorName', section: 'exhibit', type: 'text',
    label: sf.exhibitorNameLabel || '出展名（セラピスト名・屋号）',
    placeholder: sf.exhibitorNamePlaceholder || '',
    required: true, maxLength: 60, system: 'exhibitorName'
  });

  // カテゴリとブースも項目として並びに含める（管理画面から順序を変えられる）
  if ((raw.categories || []).length) {
    fields.push({
      id: 'category', section: 'exhibit', type: 'category',
      label: '出展カテゴリ', required: true, system: 'category'
    });
  }
  fields.push({
    id: 'booth', section: 'exhibit', type: 'booth',
    label: '出展ブース', required: true, system: 'booth'
  });

  var cqs = raw.customQuestions || [];
  for (var i = 0; i < cqs.length; i++) {
    var q = cqs[i];
    fields.push({
      id: q.id,
      section: 'exhibit',
      type: FIELD_TYPES.indexOf(q.type) >= 0 ? q.type : 'text',
      label: q.label || '',
      description: q.description || '',
      placeholder: q.placeholder || '',
      required: q.required !== false,
      maxLength: toInt(q.maxLength, 0),
      showCounter: !!q.showCounter,
      choices: q.options || []
    });
  }

  // v1 では boothId が 'body_' で始まるときだけ表示する固定ロジックだった。
  // v2 では showIfBoothIds として設定に持たせる。
  // 該当ブースが1つも無ければ、この項目は出しようがないので作らない。
  if (features.bodyEquipment) {
    var bodyIds = [];
    for (var b = 0; b < (booths || []).length; b++) {
      if (String(booths[b].id).indexOf('body_') === 0) bodyIds.push(booths[b].id);
    }
    if (bodyIds.length) {
      fields.push({
        id: 'equipment', section: 'exhibit', type: 'textarea',
        label: 'ブースへの持ち込み物品',
        description: 'ベッドや施術用具など、持ち込む物をご記入ください。',
        required: false, maxLength: 200, showIfBoothIds: bodyIds
      });
    }
  }

  if (sf.showPhotoUpload !== false) {
    fields.push({
      id: 'profileImage', section: 'exhibit', type: 'image',
      label: 'プロフィール写真',
      description: '正方形に近い画像がきれいに表示されます。',
      required: true, maxFileSizeMB: 8,
      accept: ['image/jpeg', 'image/png', 'image/webp'],
      maxCount: 1, system: 'profileImage'
    });
  }
  if (sf.showPhotoPermission !== false) {
    fields.push({
      id: 'photoPermission', section: 'exhibit', type: 'radio',
      label: '写真のSNS投稿への掲載可否', required: true,
      choices: ['可', '不可']
    });
  }
  if (sf.showSnsLinks !== false) {
    fields.push({
      id: 'snsLinks', section: 'sns', type: 'snsLinks',
      label: 'SNS・ホームページのリンク',
      description: 'URLを貼ると種類を自動判別します。',
      required: false, system: 'snsLinks'
    });
  }

  if (features.stampRally) {
    fields.push({
      id: 'stampRallyPrize', section: 'terms', type: 'radio',
      label: 'スタンプラリーの景品をご提供いただけますか？',
      required: true, choices: ['ある', 'ない']
    });
    fields.push({
      id: 'prizeContent', section: 'terms', type: 'textarea',
      label: '景品の内容', required: false, maxLength: 200,
      showIf: { fieldId: 'stampRallyPrize', equals: 'ある' }
    });
  }

  if (sf.showNotes !== false) {
    fields.push({
      id: 'notes', section: 'terms', type: 'textarea',
      label: '備考・ご質問', required: false, maxLength: 500
    });
  }

  for (var k = 0; k < fields.length; k++) {
    if (!isFiniteNumber(fields[k].order)) fields[k].order = (k + 1) * 10;
  }
  return fields;
}

/** v2 config の欠けているキーを埋める */
function fillDefaults(cfg) {
  cfg.schemaVersion = SCHEMA_VERSION;
  cfg.theme = cfg.theme || {};
  cfg.event = cfg.event || {};
  cfg.earlyBird = cfg.earlyBird || { enabled: false, deadline: '' };
  cfg.media = cfg.media || [];
  cfg.categories = cfg.categories || [];
  cfg.sessionCategories = cfg.sessionCategories || [];
  cfg.booths = cfg.booths || [];
  cfg.fields = cfg.fields || [];
  cfg.pricing = cfg.pricing || {};
  cfg.pricing.options = cfg.pricing.options || [];
  cfg.pricing.memberDiscount = cfg.pricing.memberDiscount || { enabled: false, amount: 0 };
  cfg.terms = cfg.terms || { body: '', requireAgree: true, displayMode: 'modal' };
  cfg.email = cfg.email || {};
  cfg.repeater = cfg.repeater || { enabled: false };
  cfg.integration = cfg.integration || {};

  // ブース側の options を必ずオブジェクトにしておく
  for (var i = 0; i < cfg.booths.length; i++) {
    cfg.booths[i].options = cfg.booths[i].options || {};
    cfg.booths[i].prices = cfg.booths[i].prices || { regular: 0, earlyBird: 0 };
  }

  // オプションの既定値
  for (var j = 0; j < cfg.pricing.options.length; j++) {
    var o = cfg.pricing.options[j];
    if (!o.inputType) o.inputType = 'toggle';
    if (!o.scope) o.scope = 'booth';
    if (o.defaultAvailable === undefined) o.defaultAvailable = true;
    if (o.enabled === undefined) o.enabled = true;
    if (!isFiniteNumber(o.order)) o.order = (j + 1) * 10;
    o.choices = o.choices || [];
  }

  // 項目の既定値
  for (var k = 0; k < cfg.fields.length; k++) {
    var f = cfg.fields[k];
    if (!f.section) f.section = 'exhibit';
    if (!f.type) f.type = 'text';
    if (!isFiniteNumber(f.order)) f.order = (k + 1) * 10;
    f.choices = f.choices || [];
  }

  cfg.fields.sort(byOrder);
  cfg.pricing.options.sort(byOrder);
  return cfg;
}

// ========================================
// 設定の点検
// ========================================

/**
 * 設定の矛盾や入力ミスを洗い出す。管理画面で警告として表示する。
 * 保存を妨げるものではなく、気づきを与えるためのもの。
 *
 * @returns {Array} [{ level: 'error'|'warn', where, message }]
 */
function validateConfig(cfg) {
  var issues = [];
  cfg = cfg || {};

  var add = function (level, where, message) {
    issues.push({ level: level, where: where, message: message });
  };

  // --- イベント ---
  if (!(cfg.event && cfg.event.name)) {
    add('warn', 'event', 'イベント名が未設定です。フォームのヘッダーに表示されません。');
  }

  // --- 早割 ---
  var eb = cfg.earlyBird || {};
  if (eb.enabled) {
    if (!eb.deadline) {
      add('error', 'earlyBird', '早割が有効ですが、締切日時が未設定です。早割が適用されません。');
    } else {
      var d = parseDeadline(eb.deadline);
      if (!d) {
        add('error', 'earlyBird', '早割の締切日時を解釈できません: ' + eb.deadline);
      } else if (d.getTime() < Date.now()) {
        add('warn', 'earlyBird', '早割の締切が既に過ぎています。通常価格で表示されます。');
      }
    }
  }

  // --- ブース ---
  var boothIds = {};
  (cfg.booths || []).forEach(function (b) {
    if (!b.id) { add('error', 'booths', 'IDのないブースがあります。'); return; }
    if (boothIds[b.id]) add('error', 'booths', 'ブースIDが重複しています: ' + b.id);
    boothIds[b.id] = true;

    var p = b.prices || {};
    // 早割のほうが高いのはほぼ入力ミス。有効にした途端に値上げになる。
    if (isFiniteNumber(p.earlyBird) && isFiniteNumber(p.regular) && p.earlyBird > p.regular) {
      add('warn', 'booths',
        '「' + (b.name || b.id) + '」の早割価格（' + formatYen(p.earlyBird) +
        '）が通常価格（' + formatYen(p.regular) + '）より高くなっています。');
    }
    if (!isFiniteNumber(p.regular) || p.regular < 0) {
      add('error', 'booths', '「' + (b.name || b.id) + '」の通常価格が正しくありません。');
    }
  });
  if (!(cfg.booths || []).length) {
    add('error', 'booths', 'ブースが1つも登録されていません。申し込めません。');
  } else if ((cfg.booths || []).every(function (b) { return b.soldOut; })) {
    add('warn', 'booths', 'すべてのブースが満枠です。誰も申し込めません。');
  }

  // --- オプション ---
  var optIds = {};
  (cfg.pricing && cfg.pricing.options || []).forEach(function (o) {
    if (!o.id) { add('error', 'options', 'IDのないオプションがあります。'); return; }
    if (optIds[o.id]) add('error', 'options', 'オプションIDが重複しています: ' + o.id);
    optIds[o.id] = true;

    if (o.enabled === false) return;
    if (!o.label) add('warn', 'options', 'オプション「' + o.id + '」に名前がありません。');

    if (o.inputType === 'select') {
      if (!(o.choices || []).length) {
        add('error', 'options', '「' + (o.label || o.id) + '」は選択式ですが選択肢がありません。');
      }
    } else if (!isFiniteNumber(o.price)) {
      add('error', 'options', '「' + (o.label || o.id) + '」の料金が数値ではありません。');
    }

    // ブース依存なのに、どのブースでも使えない状態になっていないか
    if (o.scope === 'booth' && (cfg.booths || []).length) {
      var usable = (cfg.booths || []).some(function (b) {
        return resolveOptionForBooth(o, b).available;
      });
      if (!usable) {
        add('warn', 'options',
          '「' + (o.label || o.id) + '」はどのブースでも選べない設定になっています。');
      }
    }
  });

  // --- 項目 ---
  var fieldIds = {};
  var counts = { category: 0, booth: 0 };
  (cfg.fields || []).forEach(function (f) {
    if (!f.id) { add('error', 'fields', 'IDのない項目があります。'); return; }
    if (fieldIds[f.id]) add('error', 'fields', '項目IDが重複しています: ' + f.id);
    fieldIds[f.id] = true;

    if (counts[f.type] !== undefined) counts[f.type]++;

    if (FIELD_TYPES.indexOf(f.type) < 0) {
      add('error', 'fields', '項目「' + (f.label || f.id) + '」の入力タイプが不正です: ' + f.type);
    }
    if (!f.label && DISPLAY_ONLY_TYPES.indexOf(f.type) < 0) {
      add('warn', 'fields', '項目「' + f.id + '」に質問文がありません。');
    }
    if (['select', 'radio', 'checkboxGroup'].indexOf(f.type) >= 0 && !(f.choices || []).length) {
      add('error', 'fields', '「' + (f.label || f.id) + '」は選択式ですが選択肢がありません。');
    }
    if (f.showCounter && !(f.maxLength > 0)) {
      add('warn', 'fields', '「' + (f.label || f.id) + '」は文字数カウンター表示がONですが上限が未設定です。');
    }
    if (f.type === 'postal' && f.linkTo && !((cfg.fields || []).some(function (x) { return x.id === f.linkTo; }))) {
      add('warn', 'fields', '「' + (f.label || f.id) + '」の住所自動入力先「' + f.linkTo + '」が見つかりません。');
    }
    if (f.showIf && f.showIf.fieldId && !fieldIdExists(cfg, f.showIf.fieldId)) {
      add('warn', 'fields', '「' + (f.label || f.id) + '」の表示条件で参照している項目が見つかりません。');
    }
  });

  if (counts.booth === 0) add('error', 'fields', 'ブース選択の項目がありません。');
  if (counts.booth > 1)  add('error', 'fields', 'ブース選択の項目が複数あります。');
  if ((cfg.categories || []).length && counts.category === 0) {
    add('warn', 'fields', 'カテゴリが登録されていますが、カテゴリ選択の項目がフォームにありません。');
  }

  // --- 規約・連携 ---
  if ((cfg.terms || {}).requireAgree !== false && !((cfg.terms || {}).body || '').trim()) {
    add('warn', 'terms', '規約への同意を求める設定ですが、規約本文が空です。');
  }
  if (!(cfg.integration || {}).gasUrl) {
    add('error', 'integration', '送信先（GASのURL）が未設定です。申込を受け付けられません。');
  }

  return issues;
}

function fieldIdExists(cfg, id) {
  return (cfg.fields || []).some(function (f) { return f.id === id; });
}

/** 指定セクションに属する項目を順序どおりに返す */
function fieldsInSection(config, sectionId) {
  var out = [];
  var fields = (config && config.fields) || [];
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].section === sectionId) out.push(fields[i]);
  }
  return out.sort(byOrder);
}

/** 回答として保存する項目か（heading などの表示専用を除く） */
function isAnswerableField(field) {
  return DISPLAY_ONLY_TYPES.indexOf(field.type) < 0;
}

// Node（テスト実行）向けエクスポート。ブラウザと GAS では無視される。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    FIELD_TYPES: FIELD_TYPES,
    SINGLETON_TYPES: SINGLETON_TYPES,
    DISPLAY_ONLY_TYPES: DISPLAY_ONLY_TYPES,
    SECTIONS: SECTIONS,
    normalizeConfig: normalizeConfig,
    validateConfig: validateConfig,
    computeQuote: computeQuote,
    resolveOptionForBooth: resolveOptionForBooth,
    isEarlyBirdActive: isEarlyBirdActive,
    formatBreakdown: formatBreakdown,
    formatYen: formatYen,
    normalizeForMatch: normalizeForMatch,
    fieldsInSection: fieldsInSection,
    isAnswerableField: isAnswerableField,
    parseDeadline: parseDeadline
  };
}
