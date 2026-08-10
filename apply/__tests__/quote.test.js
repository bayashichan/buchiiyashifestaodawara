/**
 * 料金計算エンジンのテスト
 *   実行: node --test apply/__tests__/
 *
 * ここで固定した期待値が、フォーム表示・確認メール・GAS 側の再計算で
 * すべて一致していなければならない。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeConfig,
  computeQuote,
  resolveOptionForBooth,
  isEarlyBirdActive,
  formatBreakdown,
  parseDeadline,
  validateConfig
} = require('../config-schema.js');

// ========================================
// テスト用の v2 設定
// ========================================
function makeConfig(overrides) {
  const cfg = {
    schemaVersion: 2,
    event: { name: 'テストイベント' },
    earlyBird: { enabled: true, deadline: '2026-06-30 23:59:00' },
    booths: [
      {
        id: 'inner', name: '内側ブース',
        prices: { regular: 8000, earlyBird: 7500 },
        options: {
          power: { available: false },              // 内側はコンセント不可
          staff: { available: false, max: 0 }
        }
      },
      {
        id: 'wall', name: '壁側ブース',
        prices: { regular: 17000, earlyBird: 16000 },
        options: {
          power: { available: true },
          staff: { available: true, max: 2 }
        }
      },
      {
        id: 'gone', name: '満枠ブース', soldOut: true,
        prices: { regular: 5000, earlyBird: 5000 },
        options: {}
      }
    ],
    pricing: {
      memberDiscount: { enabled: true, label: '会員割引', amount: 2000 },
      options: [
        { id: 'power', label: 'コンセント使用', inputType: 'toggle',
          scope: 'booth', price: 500, order: 10 },
        { id: 'staff', label: '参加人数追加', inputType: 'quantity',
          scope: 'booth', price: 1000, unit: '名', order: 20 },
        { id: 'party', label: '懇親会参加', inputType: 'quantity',
          scope: 'global', price: 5000, max: 5, unit: '名', order: 30 },
        { id: 'lunch', label: 'お弁当', inputType: 'select', scope: 'global',
          order: 40,
          choices: [
            { value: 'none', label: '不要', price: 0 },
            { value: 'normal', label: '通常', price: 900 }
          ] }
      ]
    },
    fields: []
  };
  return normalizeConfig(Object.assign(cfg, overrides || {}));
}

const BEFORE_DEADLINE = '2026-06-01T00:00:00+09:00';
const AFTER_DEADLINE = '2026-08-01T00:00:00+09:00';

// ========================================
// 早割
// ========================================
test('早割期間内はブース料金が早割価格になる', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, { boothId: 'wall', now: BEFORE_DEADLINE });
  assert.strictEqual(q.earlyBird, true);
  assert.strictEqual(q.total, 16000);
});

test('早割期間を過ぎると通常価格になる', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, { boothId: 'wall', now: AFTER_DEADLINE });
  assert.strictEqual(q.earlyBird, false);
  assert.strictEqual(q.total, 17000);
});

test('早割が無効なら期間内でも通常価格', () => {
  const cfg = makeConfig({ earlyBird: { enabled: false, deadline: '2026-06-30 23:59:00' } });
  const q = computeQuote(cfg, { boothId: 'wall', now: BEFORE_DEADLINE });
  assert.strictEqual(q.total, 17000);
});

test('excludeMembers が true なら会員は早割対象外', () => {
  const cfg = makeConfig({
    earlyBird: { enabled: true, deadline: '2026-06-30 23:59:00', excludeMembers: true }
  });
  const q = computeQuote(cfg, { boothId: 'wall', isMember: true, now: BEFORE_DEADLINE });
  // 通常価格 17000 から会員割引 2000
  assert.strictEqual(q.earlyBird, false);
  assert.strictEqual(q.total, 15000);
});

test('既定では会員でも早割が適用される', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, { boothId: 'wall', isMember: true, now: BEFORE_DEADLINE });
  assert.strictEqual(q.total, 16000 - 2000);
});

// ========================================
// ブース別のオプション可否（今回の中核）
// ========================================
test('コンセント不可のブースでは power が利用不可になる', () => {
  const cfg = makeConfig();
  const power = cfg.pricing.options.find(o => o.id === 'power');
  const inner = cfg.booths.find(b => b.id === 'inner');
  assert.strictEqual(resolveOptionForBooth(power, inner).available, false);
});

test('コンセント不可のブースで power を選んでも加算されず、理由が notices に入る', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, {
    boothId: 'inner', options: { power: true }, now: AFTER_DEADLINE
  });
  assert.strictEqual(q.total, 8000);                 // 500 が乗らない
  assert.strictEqual(q.options.power, false);        // 解除されている
  const n = q.notices.find(x => x.optionId === 'power');
  assert.ok(n, '解除の通知が返ること');
  assert.match(n.message, /ご利用いただけない/);
});

test('利用可能なブースでは power が加算される', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, {
    boothId: 'wall', options: { power: true }, now: AFTER_DEADLINE
  });
  assert.strictEqual(q.total, 17000 + 500);
});

test('ブース未選択では scope:booth のオプションは利用不可', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, { boothId: null, options: { power: true }, now: AFTER_DEADLINE });
  assert.strictEqual(q.total, 0);
});

test('scope:global のオプションはブース未選択でも選べる', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, { boothId: null, options: { party: 2 }, now: AFTER_DEADLINE });
  assert.strictEqual(q.total, 10000);
  assert.strictEqual(q.notices.length, 0);
});

test('数量がブース上限を超えると切り下げられ、理由が notices に入る', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, {
    boothId: 'wall', options: { staff: 5 }, now: AFTER_DEADLINE
  });
  assert.strictEqual(q.options.staff, 2);            // max 2 に切り下げ
  assert.strictEqual(q.total, 17000 + 2000);
  const n = q.notices.find(x => x.optionId === 'staff');
  assert.ok(n, '切り下げの通知が返ること');
  assert.match(n.message, /2名まで/);
});

test('上限0のブースではその数量オプション自体が利用不可', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, {
    boothId: 'inner', options: { staff: 1 }, now: AFTER_DEADLINE
  });
  assert.strictEqual(q.options.staff, 0);
  assert.strictEqual(q.total, 8000);
});

test('defaultAvailable:false のオプションは指定のないブースで有効にならない', () => {
  const cfg = makeConfig();
  cfg.pricing.options.push({
    id: 'newOpt', label: '新オプション', inputType: 'toggle',
    scope: 'booth', defaultAvailable: false, price: 300, enabled: true, order: 50, choices: []
  });
  const q = computeQuote(cfg, {
    boothId: 'wall', options: { newOpt: true }, now: AFTER_DEADLINE
  });
  assert.strictEqual(q.total, 17000, '既定不可のオプションは加算されない');
});

test('defaultAvailable:true なら指定のないブースで有効になる', () => {
  const cfg = makeConfig();
  cfg.pricing.options.push({
    id: 'newOpt', label: '新オプション', inputType: 'toggle',
    scope: 'booth', defaultAvailable: true, price: 300, enabled: true, order: 50, choices: []
  });
  const q = computeQuote(cfg, {
    boothId: 'wall', options: { newOpt: true }, now: AFTER_DEADLINE
  });
  assert.strictEqual(q.total, 17000 + 300);
});

test('enabled:false のオプションは常に無効', () => {
  const cfg = makeConfig();
  cfg.pricing.options.find(o => o.id === 'party').enabled = false;
  const q = computeQuote(cfg, { boothId: 'wall', options: { party: 2 }, now: AFTER_DEADLINE });
  assert.strictEqual(q.total, 17000);
});

// ========================================
// select 型オプション
// ========================================
test('select オプションは選択肢ごとの価格が乗る', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, {
    boothId: 'wall', options: { lunch: 'normal' }, now: AFTER_DEADLINE
  });
  assert.strictEqual(q.total, 17000 + 900);
});

test('price 0 の選択肢は明細に出さない', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, {
    boothId: 'wall', options: { lunch: 'none' }, now: AFTER_DEADLINE
  });
  assert.strictEqual(q.total, 17000);
  assert.ok(!q.lineItems.some(li => li.id === 'lunch'));
});

test('存在しない選択肢は未選択に戻して通知する', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, {
    boothId: 'wall', options: { lunch: 'bogus' }, now: AFTER_DEADLINE
  });
  assert.strictEqual(q.options.lunch, '');
  assert.ok(q.notices.some(n => n.optionId === 'lunch'));
});

// ========================================
// 満枠・合計の下限
// ========================================
test('満枠ブースは選択できず通知される', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, { boothId: 'gone', now: AFTER_DEADLINE });
  assert.strictEqual(q.total, 0);
  assert.strictEqual(q.boothId, null);
  assert.ok(q.notices.some(n => n.type === 'boothSoldOut'));
});

test('割引が合計を上回っても負の金額にならない', () => {
  const cfg = makeConfig();
  cfg.pricing.memberDiscount.amount = 999999;
  const q = computeQuote(cfg, { boothId: 'wall', isMember: true, now: AFTER_DEADLINE });
  assert.strictEqual(q.total, 0);
});

test('会員割引が無効なら isMember でも引かれない', () => {
  const cfg = makeConfig();
  cfg.pricing.memberDiscount.enabled = false;
  const q = computeQuote(cfg, { boothId: 'wall', isMember: true, now: AFTER_DEADLINE });
  assert.strictEqual(q.total, 17000);
});

// ========================================
// 明細の整形（確認メールの {{breakdown}}）
// ========================================
test('breakdown は1行1明細で整形される', () => {
  const cfg = makeConfig();
  const q = computeQuote(cfg, {
    boothId: 'wall', options: { power: true, staff: 2, party: 1 },
    isMember: true, now: AFTER_DEADLINE
  });
  const text = formatBreakdown(q);
  const lines = text.split('\n');
  assert.strictEqual(lines.length, 5);
  assert.match(lines[0], /壁側ブース　¥17,000/);
  assert.match(lines[1], /コンセント使用　¥500/);
  assert.match(lines[2], /参加人数追加×2名　¥2,000/);
  assert.match(lines[3], /懇親会参加×1名　¥5,000/);
  assert.match(lines[4], /会員割引　¥-2,000/);
  assert.strictEqual(q.total, 17000 + 500 + 2000 + 5000 - 2000);
});

// ========================================
// v1 → v2 移行
//
// config.json は v2 へ移行済みなので、移行ロジックが将来も壊れないように
// v1 形式のフィクスチャをここに固定しておく。
// ========================================
const V1_FIXTURE = {
  theme: { primaryColor: '#650133' },
  event: { name: '第1回テスト', date: '2026年11月1日', location: 'テスト会場', earlyBirdDeadline: '' },
  features: {
    earlyBird: false, repeaterSearch: false, memberDiscount: true,
    memberDiscountLabel: '協会会員ですか？', stampRally: true,
    party: true, secondaryParty: false, bodyEquipment: true, liffId: ''
  },
  pricing: {
    memberDiscount: 2000,
    options: {
      power:          { label: 'コンセント使用', price: 500,  enabled: true },
      chair:          { label: '椅子追加',       price: 100,  enabled: false },
      staff:          { label: '参加人数追加',   price: 1000, enabled: false },
      party:          { label: '懇親会参加費',   price: 5000, enabled: true },
      secondaryParty: { label: '二次会参加費',   price: 3000, enabled: false }
    }
  },
  booths: [
    { id: 'booth_s', name: '内側半テーブル', location: '',
      prices: { regular: 8000, earlyBird: 7500 },
      limits: { maxStaff: 0, maxChairs: 0, allowPower: false }, soldOut: false },
    { id: 'booth_m', name: '壁側半テーブル', location: '',
      prices: { regular: 9000, earlyBird: 8500 },
      limits: { maxStaff: 2, maxChairs: 1, allowPower: true }, soldOut: false }
  ],
  categories: ['占い・スピリチュアル', '物販'],
  standardFields: {
    exhibitorNameLabel: '出展名', exhibitorNamePlaceholder: 'サロン〇〇',
    showPhoneNumber: true, showAddress: true, showPhotoUpload: true,
    showSnsLinks: true, showPhotoPermission: true, showNotes: true
  },
  customQuestions: [
    { id: 'cq_menu', type: 'textarea', label: '出展メニュー名',
      required: true, showCounter: true, maxLength: 100 },
    { id: 'cq_check', type: 'checkbox', label: '確認事項', required: false }
  ],
  terms: '規約テキスト',
  email: { adminEmail: 'a@example.com' },
  gasUrl: 'https://example.com/exec',
  spreadsheetId: 'SHEET_ID'
};

test('v1 形式を v2 へ正規化できる', () => {
  const cfg = normalizeConfig(JSON.parse(JSON.stringify(V1_FIXTURE)));

  assert.strictEqual(cfg.schemaVersion, 2);
  assert.ok(cfg.fields.length > 0, 'fields が生成されること');
  assert.ok(Array.isArray(cfg.pricing.options), 'options が配列化されること');

  // limits が booth.options へ展開されること
  const s = cfg.booths.find(b => b.id === 'booth_s');
  assert.strictEqual(s.options.power.available, false, 'allowPower:false → 利用不可');
  assert.strictEqual(s.options.staff.available, false, 'maxStaff:0 → 利用不可');

  const m = cfg.booths.find(b => b.id === 'booth_m');
  assert.strictEqual(m.options.power.available, true);
  assert.strictEqual(m.options.staff.max, 2);
  assert.strictEqual(m.options.chair.max, 1);

  // scope の割り当て
  const byId = Object.fromEntries(cfg.pricing.options.map(o => [o.id, o]));
  assert.strictEqual(byId.power.scope, 'booth');
  assert.strictEqual(byId.party.scope, 'global');
  assert.strictEqual(byId.secondaryParty.enabled, false, 'features.secondaryParty:false を反映');

  // customQuestions が fields に取り込まれ、checkbox 型が保持されること
  assert.ok(cfg.fields.some(f => f.id === 'cq_menu'));
  const check = cfg.fields.find(f => f.id === 'cq_check');
  assert.strictEqual(check.type, 'checkbox', 'checkbox 型が text に落ちないこと');

  // カテゴリ・ブースが並び替え可能な項目として入ること
  assert.ok(cfg.fields.some(f => f.type === 'category'));
  assert.ok(cfg.fields.some(f => f.type === 'booth'));

  // 該当ブースが無いので持ち込み物品は作られないこと
  assert.ok(!cfg.fields.some(f => f.id === 'equipment'),
    'body_ で始まるブースが無ければ equipment 項目は生成しない');

  // terms が文字列からオブジェクトへ
  assert.strictEqual(cfg.terms.body, '規約テキスト');
});

test('v1 移行後も金額計算が期待どおり', () => {
  const cfg = normalizeConfig(JSON.parse(JSON.stringify(V1_FIXTURE)));

  // 早割は features.earlyBird:false なので通常価格
  const q = computeQuote(cfg, { boothId: 'booth_m', now: AFTER_DEADLINE });
  assert.strictEqual(q.earlyBird, false);
  assert.strictEqual(q.total, 9000);

  // 懇親会は scope:global
  const q2 = computeQuote(cfg, { boothId: 'booth_m', options: { party: 1 }, now: AFTER_DEADLINE });
  assert.strictEqual(q2.total, 14000);

  // booth_s はコンセント不可
  const q3 = computeQuote(cfg, { boothId: 'booth_s', options: { power: true }, now: AFTER_DEADLINE });
  assert.strictEqual(q3.total, 8000, 'コンセント料金が乗らない');

  // enabled:false の椅子は上限があっても加算されない
  const q4 = computeQuote(cfg, { boothId: 'booth_m', options: { chair: 1 }, now: AFTER_DEADLINE });
  assert.strictEqual(q4.total, 9000);
});

// ========================================
// 実際に配信する config.json
// ========================================
test('配信中の config.json が v2 として妥当', () => {
  const rawPath = path.join(__dirname, '..', 'config.json');
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

  assert.strictEqual(raw.schemaVersion, 2, 'v2 で保存されていること');

  const cfg = normalizeConfig(raw);
  assert.ok(cfg.fields.length > 0);
  assert.ok(cfg.booths.length > 0);
  assert.ok(cfg.terms.body.length > 0);

  // 公開ファイルなので、インフラのIDや管理者アドレスを含めない
  assert.ok(!('spreadsheetId' in raw), 'spreadsheetId は GAS 側で保持する');
  assert.ok(!('driveFolderUrl' in raw), 'driveFolderUrl は GAS 側で保持する');
  assert.ok(!(raw.email && raw.email.adminEmail), 'adminEmail は GAS 側で保持する');

  // 送信先。切り替え時に新しい Apps Script の /exec を入れる。
  //
  // 稼働中の旧 Apps Script を指したままにしてはいけない。
  // 新しいフォームは answers / selectedOptions を送るので旧 GAS は解釈できず、
  // ローカルで動作確認しただけで稼働中のスプレッドシートに壊れた行が入る。
  const gasUrl = cfg.integration.gasUrl;
  assert.ok(
    !/AKfycbzdEcorQyVCAfOTmtYhWSRBVp020nBYFI8fezNUt6GRWbpTw3ZeYLG9Vs5DhslZ4i2Y/.test(gasUrl),
    '稼働中の旧 Apps Script を指していないこと');
  assert.ok(
    gasUrl === '' || /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(gasUrl),
    'gasUrl は空（未設定）か、Apps Script の /exec URL であること');
});

// ========================================
// 設定の点検（管理画面の警告表示に使う）
// ========================================
test('早割価格が通常価格より高いブースを警告する', () => {
  const cfg = makeConfig();
  cfg.booths[0].prices = { regular: 8000, earlyBird: 9000 };
  const issues = validateConfig(cfg);
  assert.ok(issues.some(i => i.where === 'booths' && /早割価格/.test(i.message)),
    '早割のほうが高い設定は警告されること');
});

test('早割が有効なのに締切が未設定ならエラー', () => {
  const cfg = makeConfig({ earlyBird: { enabled: true, deadline: '' } });
  const issues = validateConfig(cfg);
  assert.ok(issues.some(i => i.level === 'error' && i.where === 'earlyBird'));
});

test('どのブースでも選べないオプションを警告する', () => {
  const cfg = makeConfig();
  cfg.pricing.options.push({
    id: 'ghost', label: '幽霊オプション', inputType: 'toggle', scope: 'booth',
    defaultAvailable: false, price: 100, enabled: true, order: 99, choices: []
  });
  const issues = validateConfig(cfg);
  assert.ok(issues.some(i => /どのブースでも選べない/.test(i.message)));
});

test('選択肢のない選択式オプションはエラー', () => {
  const cfg = makeConfig();
  cfg.pricing.options.push({
    id: 'empty', label: '空の選択', inputType: 'select', scope: 'global',
    enabled: true, order: 98, choices: []
  });
  const issues = validateConfig(cfg);
  assert.ok(issues.some(i => i.level === 'error' && /選択肢がありません/.test(i.message)));
});

test('IDの重複を検出する', () => {
  const cfg = makeConfig();
  cfg.booths.push({ id: 'wall', name: '重複ブース', prices: { regular: 1, earlyBird: 1 }, options: {} });
  const issues = validateConfig(cfg);
  assert.ok(issues.some(i => /ブースIDが重複/.test(i.message)));
});

test('ブース選択の項目が無ければエラー', () => {
  const cfg = makeConfig();
  cfg.fields = [];
  const issues = validateConfig(cfg);
  assert.ok(issues.some(i => i.level === 'error' && /ブース選択の項目がありません/.test(i.message)));
});

test('問題のない設定では error が出ない', () => {
  const cfg = makeConfig();
  cfg.fields = [
    { id: 'booth', type: 'booth', label: '出展ブース', section: 'exhibit', order: 10, choices: [] }
  ];
  cfg.integration = { gasUrl: 'https://example.com/exec' };
  cfg.terms = { body: '規約', requireAgree: true };
  cfg.event = { name: 'テスト' };
  const errors = validateConfig(cfg).filter(i => i.level === 'error');
  assert.deepStrictEqual(errors, []);
});

// 配信中の設定に含まれる問題は、管理画面で警告として運営に見せる。
// テストをここで落とすと運営データの都合でCIが赤くなるため、内容の報告に留める。
test('配信中の config.json の点検結果を報告する', () => {
  const rawPath = path.join(__dirname, '..', 'config.json');
  const cfg = normalizeConfig(JSON.parse(fs.readFileSync(rawPath, 'utf8')));
  const issues = validateConfig(cfg);

  if (issues.length) {
    console.log('\n  現在の config.json の点検結果:');
    issues.forEach(i => console.log('    [' + i.level + '] ' + i.where + ': ' + i.message));
  }
  // 検証関数が例外なく完走することだけを保証する
  assert.ok(Array.isArray(issues));
});

test('normalizeConfig は v2 の入力をそのまま扱える（冪等）', () => {
  const once = makeConfig();
  const twice = normalizeConfig(JSON.parse(JSON.stringify(once)));
  assert.deepStrictEqual(twice.pricing.options, once.pricing.options);
  assert.deepStrictEqual(twice.booths, once.booths);
});

// ========================================
// 早割判定の境界
// ========================================
test('締切日時ちょうどは早割が有効', () => {
  const cfg = makeConfig();
  assert.strictEqual(
    isEarlyBirdActive(cfg, { now: '2026-06-30T23:59:00+09:00' }), true);
});

test('締切を1秒過ぎると早割が切れる', () => {
  const cfg = makeConfig();
  assert.strictEqual(
    isEarlyBirdActive(cfg, { now: '2026-06-30T23:59:01+09:00' }), false);
});

// タイムゾーンを持たない締切文字列は、実行環境のTZに関係なく
// 日本時間として解釈されなければならない。
// （ブラウザとGASで判定がずれると表示額と請求額が食い違う）
test('TZ指定のない締切は実行環境のTZに依存せず日本時間で判定される', () => {
  const cfg = makeConfig();  // deadline: '2026-06-30 23:59:00'
  const deadlineJst = parseDeadline('2026-06-30 23:59:00');
  assert.strictEqual(deadlineJst.toISOString(), '2026-06-30T14:59:00.000Z');

  // JST 23:59:00 = UTC 14:59:00。UTC基準の時刻で境界を確認する
  assert.strictEqual(isEarlyBirdActive(cfg, { now: '2026-06-30T14:59:00Z' }), true);
  assert.strictEqual(isEarlyBirdActive(cfg, { now: '2026-06-30T14:59:01Z' }), false);
});

test('日付のみの締切はその日いっぱい（23:59:59 JST）として扱う', () => {
  const d = parseDeadline('2026-06-30');
  assert.strictEqual(d.toISOString(), '2026-06-30T14:59:59.000Z');
});

test('分までの締切（datetime-local の出力）も日本時間で解釈される', () => {
  const d = parseDeadline('2026-06-30T23:59');
  assert.strictEqual(d.toISOString(), '2026-06-30T14:59:00.000Z');
});

test('明示的なタイムゾーン付きの値はそのまま尊重される', () => {
  const d = parseDeadline('2026-06-30T23:59:00Z');
  assert.strictEqual(d.toISOString(), '2026-06-30T23:59:00.000Z');
});
