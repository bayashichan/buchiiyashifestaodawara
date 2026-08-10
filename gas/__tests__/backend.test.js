/**
 * GAS バックエンドの検証
 *   実行: node --test gas/__tests__/backend.test.js
 *
 * Apps Script をデプロイせずに、壊れやすい部分をここで確認する。
 *   - ヘッダーが config の項目どおりに生成されるか
 *   - 項目を後から追加しても既存の列がずれないか
 *   - サーバ側の再計算が改変リクエストを弾くか
 *   - 送信枠が尽きても申込データが保存されるか
 *   - 項目名を変えてもリピーター照合が壊れないか
 */

const test = require('node:test');
const assert = require('node:assert');
const { createHarness } = require('./harness.js');

// ========================================
// テスト用の設定
// ========================================
const CONFIG = {
  schemaVersion: 2,
  event: { name: '第1回テストフェスタ', date: '2026年11月1日', location: 'テスト会場' },
  earlyBird: { enabled: false, deadline: '' },
  categories: ['占い', '物販'],
  booths: [
    { id: 'inner', name: '内側ブース', prices: { regular: 8000, earlyBird: 8000 },
      options: { power: { available: false }, staff: { available: false, max: 0 } } },
    { id: 'wall', name: '壁側ブース', prices: { regular: 17000, earlyBird: 17000 },
      options: { power: { available: true }, staff: { available: true, max: 2 } } }
  ],
  pricing: {
    memberDiscount: { enabled: true, label: '会員割引', amount: 2000 },
    options: [
      { id: 'power', label: 'コンセント使用', inputType: 'toggle', scope: 'booth',
        price: 500, enabled: true, order: 10 },
      { id: 'staff', label: '参加人数追加', inputType: 'quantity', scope: 'booth',
        price: 1000, unit: '名', enabled: true, order: 20 },
      { id: 'party', label: '懇親会参加', inputType: 'quantity', scope: 'global',
        price: 5000, max: 5, unit: '名', enabled: true, order: 30 }
    ]
  },
  // system を持つ項目は「標準項目」。旧テンプレートの {{customAnswers}} は
  // これらを除いた「管理者が追加した質問」だけを並べる。
  fields: [
    { id: 'name', type: 'text', label: 'お名前（本名）', section: 'basic', order: 10,
      required: true, system: 'name' },
    { id: 'email', type: 'email', label: 'メールアドレス', section: 'basic', order: 20,
      required: true, system: 'email' },
    { id: 'phoneNumber', type: 'tel', label: '電話番号', section: 'basic', order: 30,
      system: 'phone' },
    { id: 'exhibitorName', type: 'text', label: '出展名', section: 'exhibit', order: 40,
      system: 'exhibitorName' },
    { id: 'category', type: 'category', label: '出展カテゴリ', section: 'exhibit', order: 50,
      system: 'category' },
    { id: 'booth', type: 'booth', label: '出展ブース', section: 'exhibit', order: 60,
      system: 'booth' },
    { id: 'cq_menu', type: 'textarea', label: '出展メニュー', section: 'exhibit', order: 70 },
    { id: 'snsLinks', type: 'snsLinks', label: 'SNSリンク', section: 'sns', order: 80,
      system: 'snsLinks' },
    { id: 'note', type: 'heading', label: '（説明のみ）', section: 'terms', order: 90 }
  ],
  terms: { body: '規約', requireAgree: true },
  email: {
    confirmationSubject: '【{{eventName}}】お申込みを受け付けました',
    confirmationBodyTemplate: [
      '{{name}} 様', '',
      '出展名: {{field:exhibitorName}}',
      'ブース: {{boothName}}', '',
      '{{breakdown}}',
      '合計: {{totalFee}}'
    ].join('\n')
  },
  repeater: { enabled: true, matchFields: ['name', 'email'], codeDigits: 4,
              codeTtlSeconds: 600, maxAttempts: 5, resendCooldownSeconds: 60 },
  integration: { gasUrl: 'https://example.com/exec' }
};

function makeHarness(overrides = {}) {
  const cfg = JSON.parse(JSON.stringify(CONFIG));
  if (overrides.mutateConfig) overrides.mutateConfig(cfg);

  const h = createHarness({
    quota: overrides.quota,
    properties: Object.assign({
      CONFIG_JSON_URL: 'https://example.com/config.json',
      ADMIN_PASSWORD: 'secret',
      DRIVE_ROOT_FOLDER_ID: 'ROOT'
    }, overrides.properties || {}),
    fetchHandler: () => ({ code: 200, text: JSON.stringify(cfg) })
  });

  // 保存先スプレッドシートを用意する
  const current = h.newSpreadsheet('今回イベント');
  const master = h.newSpreadsheet('マスターDB');
  h.properties.set('CURRENT_SPREADSHEET_ID', current.getId());
  h.properties.set('DATABASE_SPREADSHEET_ID', master.getId());

  return { h, cfg, current, master };
}

// ========================================
// ヘッダー生成
// ========================================
test('ヘッダーが config の項目とオプションから生成される', () => {
  const { h, cfg } = makeHarness();
  const header = h.ctx.buildHeaderRow(h.ctx.normalizeConfig(cfg), { isMaster: false });

  assert.strictEqual(header.labels[0], '座席番号', 'イベント用は先頭が座席番号');
  assert.strictEqual(header.labels[1], '申込日時');

  // 項目が config の並び順どおりに入る
  ['お名前（本名）', 'メールアドレス', '電話番号', '出展名', '出展カテゴリ',
   '出展ブース', '出展メニュー', 'SNSリンク'].forEach(label => {
    assert.ok(header.labels.includes(label), label + ' が列に含まれること');
  });

  // 表示専用の heading は列にしない
  assert.ok(!header.labels.includes('（説明のみ）'), 'heading 型は列を作らない');

  // オプションも列になる
  ['コンセント使用', '参加人数追加', '懇親会参加'].forEach(label => {
    assert.ok(header.labels.includes(label), label + ' が列に含まれること');
  });

  ['合計金額', 'スタッフメモ', '入金確認', '入金日'].forEach(label => {
    assert.ok(header.labels.includes(label));
  });
});

test('マスターDBは先頭列が開催回になる', () => {
  const { h, cfg } = makeHarness();
  const header = h.ctx.buildHeaderRow(h.ctx.normalizeConfig(cfg), { isMaster: true });
  assert.strictEqual(header.labels[0], '開催回');
});

// ========================================
// 申込の保存
// ========================================
function submitParams(overrides = {}) {
  return Object.assign({
    action: 'submit',
    answers: JSON.stringify({
      name: '山田 太郎', email: 'taro@example.com', phoneNumber: '09012345678',
      exhibitorName: 'サロン太郎', cq_menu: 'タロット占い',
      snsLinks: [{ type: 'Instagram', url: 'https://instagram.com/taro' }]
    }),
    selectedOptions: JSON.stringify({ power: true, staff: 1, party: 2 }),
    boothId: 'wall',
    category: '占い',
    isMember: '0',
    agreeTerms: '1',
    clientTotal: '27500',
    imageFieldIds: '[]'
  }, overrides);
}

test('申込がスプレッドシートへ保存され、金額がサーバ側で再計算される', () => {
  const { h, current } = makeHarness();
  const res = h.readResponse(h.ctx.doPost({ parameter: submitParams() }));

  assert.strictEqual(res.success, true);
  // 17000 + 500(コンセント) + 1000(スタッフ1名) + 10000(懇親会2名)
  assert.strictEqual(res.total, 28500);

  const sheet = current.getSheetByName('申込データ');
  assert.strictEqual(sheet.getLastRow(), 2, 'ヘッダー + 1件');

  const labels = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const cell = (label) => row[labels.indexOf(label)];

  assert.strictEqual(cell('お名前（本名）'), '山田 太郎');
  assert.strictEqual(cell('出展ブース'), '');           // booth 型の回答は answers に無い
  assert.strictEqual(cell('コンセント使用'), 'あり');
  assert.strictEqual(cell('参加人数追加'), 1);
  assert.strictEqual(cell('懇親会参加'), 2);
  assert.strictEqual(cell('合計金額'), 28500);
  assert.strictEqual(cell('座席番号'), '', '座席番号は運営が後で入れる');
  assert.match(String(cell('SNSリンク')), /Instagram: https:\/\/instagram\.com\/taro/);
});

test('マスターDBにも保存され、開催回が入る', () => {
  const { h, master } = makeHarness();
  h.ctx.doPost({ parameter: submitParams() });

  const sheet = master.getSheetByName('申込データ');
  const labels = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  assert.strictEqual(row[labels.indexOf('開催回')], '第1回テストフェスタ');
});

test('使えないオプションを直接POSTしても金額に加算されない', () => {
  const { h } = makeHarness();
  // 内側ブースはコンセント不可。改変したリクエストを想定する。
  const res = h.readResponse(h.ctx.doPost({
    parameter: submitParams({
      boothId: 'inner',
      selectedOptions: JSON.stringify({ power: true, staff: 5 }),
      clientTotal: '99999'
    })
  }));

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.total, 8000, 'コンセントもスタッフも加算されない');
  assert.ok(res.notices.length > 0, '調整した旨が返ること');
});

// ブース側に指定が無いオプションは option.defaultAvailable に従う。
// 「指定が無い＝全部使える」ではなく、既定値をオプション側に明示させる設計。
test('ブース側に指定の無いオプションは defaultAvailable に従う', () => {
  const { h } = makeHarness({
    mutateConfig: (c) => {
      // 壁側ブースには lunch の指定を置かない
      c.pricing.options.push({
        id: 'lunch', label: 'お弁当', inputType: 'toggle', scope: 'booth',
        defaultAvailable: false, price: 900, enabled: true, order: 40
      });
    }
  });

  const res = h.readResponse(h.ctx.doPost({
    parameter: submitParams({
      selectedOptions: JSON.stringify({ lunch: true }), boothId: 'wall'
    })
  }));
  assert.strictEqual(res.total, 17000, 'defaultAvailable:false なら加算されない');
});

test('数量オプションはブース上限まで切り下げられる', () => {
  const { h } = makeHarness();
  const res = h.readResponse(h.ctx.doPost({
    parameter: submitParams({
      boothId: 'wall',                                  // staff は max 2
      selectedOptions: JSON.stringify({ staff: 99 })
    })
  }));
  assert.strictEqual(res.total, 17000 + 2000, '2名分までしか加算されない');
  assert.ok(res.notices.some(n => n.optionId === 'staff'));
});

// ========================================
// サーバ側の必須チェック
//
// フォーム側でも検証しているが、直接POSTされたときに空の申込が通らないこと。
// ========================================
test('必須項目が空なら受け付けない', () => {
  const { h, current } = makeHarness();
  const res = h.readResponse(h.ctx.doPost({
    parameter: submitParams({
      answers: JSON.stringify({ email: 'taro@example.com' })   // 氏名なし
    })
  }));

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'VALIDATION');
  assert.match(res.error, /お名前（本名）が入力されていません/);
  assert.strictEqual(current.getSheetByName('申込データ'), null, '保存されないこと');
  assert.strictEqual(h.sentMail.length, 0, 'メールも送らないこと');
});

test('メールアドレスの形式が不正なら受け付けない', () => {
  const { h } = makeHarness();
  const res = h.readResponse(h.ctx.doPost({
    parameter: submitParams({
      answers: JSON.stringify({ name: '山田 太郎', email: 'not-an-email' })
    })
  }));
  assert.strictEqual(res.success, false);
  assert.match(res.error, /形式が正しくありません/);
});

test('規約に同意していなければ受け付けない', () => {
  const { h } = makeHarness();
  const res = h.readResponse(h.ctx.doPost({
    parameter: submitParams({ agreeTerms: '0' })
  }));
  assert.strictEqual(res.success, false);
  assert.match(res.error, /同意が必要です/);
});

test('規約同意が不要な設定なら agreeTerms なしでも通る', () => {
  const { h } = makeHarness({
    mutateConfig: (c) => { c.terms.requireAgree = false; }
  });
  const params = submitParams();
  delete params.agreeTerms;
  const res = h.readResponse(h.ctx.doPost({ parameter: params }));
  assert.strictEqual(res.success, true);
});

test('必須の画像が添付されていなければ受け付けない', () => {
  const { h } = makeHarness({
    mutateConfig: (c) => {
      c.fields.push({ id: 'photo', type: 'image', label: 'プロフィール写真',
                      section: 'exhibit', order: 75, required: true });
    }
  });
  const res = h.readResponse(h.ctx.doPost({
    parameter: submitParams({ imageFieldIds: JSON.stringify(['photo']) })
  }));
  assert.strictEqual(res.success, false);
  assert.match(res.error, /プロフィール写真が添付されていません/);
});

test('登録の無いカテゴリは受け付けない', () => {
  const { h } = makeHarness({
    mutateConfig: (c) => { c.fields.find(f => f.type === 'category').required = true; }
  });
  const res = h.readResponse(h.ctx.doPost({
    parameter: submitParams({ category: '存在しないカテゴリ' })
  }));
  assert.strictEqual(res.success, false);
  assert.match(res.error, /カテゴリの値が不正/);
});

test('文字数上限を超えていれば受け付けない', () => {
  const { h } = makeHarness({
    mutateConfig: (c) => { c.fields.find(f => f.id === 'cq_menu').maxLength = 10; }
  });
  const res = h.readResponse(h.ctx.doPost({
    parameter: submitParams({
      answers: JSON.stringify({
        name: '山田 太郎', email: 'taro@example.com',
        cq_menu: 'あ'.repeat(50)
      })
    })
  }));
  assert.strictEqual(res.success, false);
  assert.match(res.error, /10文字を超えています/);
});

test('満枠ブースの申込は受け付けない', () => {
  const { h } = makeHarness({
    mutateConfig: (c) => { c.booths[1].soldOut = true; }
  });
  const res = h.readResponse(h.ctx.doPost({ parameter: submitParams({ boothId: 'wall' }) }));
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'NO_BOOTH');
});

// ========================================
// 項目を後から追加したときの互換
// ========================================
test('項目を追加しても既存行の列がずれない', () => {
  const { h, cfg, current } = makeHarness();

  h.ctx.doPost({ parameter: submitParams() });

  // 管理画面から項目を1つ増やした状況を作る
  cfg.fields.push({ id: 'cq_extra', type: 'text', label: '追加質問', section: 'exhibit', order: 75 });
  h.ctx.invalidateConfigCache();

  h.ctx.doPost({
    parameter: submitParams({
      answers: JSON.stringify({
        name: '鈴木 花子', email: 'hanako@example.com',
        exhibitorName: 'サロン花子', cq_extra: '追加の答え'
      })
    })
  });

  const sheet = current.getSheetByName('申込データ');
  const labels = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  assert.ok(labels.includes('追加質問'), '不足列が末尾に追加されること');
  assert.strictEqual(labels.indexOf('追加質問'), labels.length - 1, '末尾に足される');

  const row1 = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row2 = sheet.getRange(3, 1, 1, sheet.getLastColumn()).getValues()[0];

  assert.strictEqual(row1[labels.indexOf('お名前（本名）')], '山田 太郎', '既存行が壊れない');
  assert.strictEqual(row2[labels.indexOf('お名前（本名）')], '鈴木 花子');
  assert.strictEqual(row2[labels.indexOf('追加質問')], '追加の答え');
  assert.strictEqual(row1[labels.indexOf('合計金額')], 28500, '既存行の金額もずれない');
});

// ========================================
// メール
// ========================================
test('確認メールにテンプレートが差し込まれる', () => {
  const { h } = makeHarness();
  h.ctx.doPost({ parameter: submitParams() });

  assert.strictEqual(h.sentMail.length, 1);
  const mail = h.sentMail[0];

  assert.strictEqual(mail.to, 'taro@example.com');
  assert.match(mail.subject, /第1回テストフェスタ/);
  assert.match(mail.body, /山田 太郎 様/);
  assert.match(mail.body, /出展名: サロン太郎/, '{{field:xxx}} が展開される');
  assert.match(mail.body, /ブース: 壁側ブース/);
  assert.match(mail.body, /壁側ブース　¥17,000/, '{{breakdown}} が明細になる');
  assert.match(mail.body, /懇親会参加×2名　¥10,000/);
  assert.match(mail.body, /合計: 28,500/);
});

// ========================================
// 旧テンプレートとの互換
//
// 稼働中のメール文面は {{customAnswers}} と「合計: ¥{{totalFee}}」を使っている。
// 移行で文面を書き換えずに済むよう、そのまま動くことを保証する。
// ========================================
test('旧テンプレートの {{customAnswers}} と ¥{{totalFee}} がそのまま使える', () => {
  const { h } = makeHarness({
    mutateConfig: (c) => {
      c.email.confirmationBodyTemplate = [
        '{{name}} 様', '',
        '■ お申込み情報',
        'お名前: {{name}}',
        'メールアドレス: {{email}}',
        '出展ブース: {{boothName}}',
        '{{customAnswers}}', '',
        '■ お支払い金額',
        '{{breakdown}}',
        '合計: ¥{{totalFee}}'
      ].join('\n');
    }
  });

  h.ctx.doPost({ parameter: submitParams() });
  const body = h.sentMail[0].body;

  // 円記号が二重にならない
  assert.match(body, /合計: ¥28,500/);
  assert.ok(!/¥¥/.test(body), '¥¥ にならないこと');

  // {{customAnswers}} が展開され、記法が残らない
  assert.ok(!/\{\{/.test(body), '展開されない差し込み記法が残らないこと');
  assert.match(body, /出展メニュー: タロット占い/, 'カスタム質問が展開される');

  // 標準項目は上部で個別に差し込まれているので重複させない
  const nameCount = (body.match(/山田 太郎/g) || []).length;
  assert.strictEqual(nameCount, 2, '氏名は「様」と「お名前:」の2箇所だけ');
  assert.ok(!/お名前（本名）: 山田 太郎/.test(body),
    '{{customAnswers}} 側に標準項目を含めない');
});

test('項目IDを直接書いた差し込み {{cq_menu}} も展開される', () => {
  const { h } = makeHarness({
    mutateConfig: (c) => {
      c.email.confirmationBodyTemplate = 'メニュー: {{cq_menu}} / 出展名: {{exhibitorName}}';
    }
  });
  h.ctx.doPost({ parameter: submitParams() });
  const body = h.sentMail[0].body;
  assert.match(body, /メニュー: タロット占い/);
  assert.match(body, /出展名: サロン太郎/);
});

test('{{totalFeeYen}} は円記号つきで出る', () => {
  const { h } = makeHarness({
    mutateConfig: (c) => { c.email.confirmationBodyTemplate = '合計 {{totalFeeYen}}'; }
  });
  h.ctx.doPost({ parameter: submitParams() });
  assert.match(h.sentMail[0].body, /合計 ¥28,500/);
});

test('設定に無い差し込みは記法のまま残す（誤字に気づけるように）', () => {
  const { h } = makeHarness({
    mutateConfig: (c) => { c.email.confirmationBodyTemplate = '{{typo_here}}'; }
  });
  h.ctx.doPost({ parameter: submitParams() });
  assert.match(h.sentMail[0].body, /\{\{typo_here\}\}/);
});

test('送信枠が尽きても申込は保存され、確認メールはキューに積まれる', () => {
  const { h, current } = makeHarness({ quota: 1 });   // 予備枠 3 を下回る

  const res = h.readResponse(h.ctx.doPost({ parameter: submitParams() }));

  assert.strictEqual(res.success, true, '申込自体は成立する');
  assert.strictEqual(res.mailQueued, true, 'キューに積まれた旨が返る');
  assert.strictEqual(res.mailSent, false);
  assert.strictEqual(h.sentMail.length, 0, 'この時点では送っていない');

  // データは確実に保存されている
  assert.strictEqual(current.getSheetByName('申込データ').getLastRow(), 2);

  // キューに積まれている
  const queue = current.getSheetByName('_mailQueue');
  assert.ok(queue, 'キューのシートができる');
  assert.strictEqual(queue.getLastRow(), 2);
  assert.strictEqual(queue.getRange(2, 5, 1, 1).getValues()[0][0], 'pending');
});

test('枠が回復するとキューが消化される', () => {
  const { h, current } = makeHarness({ quota: 1 });
  h.ctx.doPost({ parameter: submitParams() });

  h.setQuota(100);
  const result = h.ctx.processMailQueue();

  assert.strictEqual(result.sent, 1);
  assert.strictEqual(h.sentMail.length, 1);
  assert.strictEqual(
    current.getSheetByName('_mailQueue').getRange(2, 5, 1, 1).getValues()[0][0], 'sent');
});

test('管理者への1件ごとの通知メールは送らない', () => {
  const { h } = makeHarness({ properties: { ADMIN_EMAIL: 'admin@example.com' } });
  h.ctx.doPost({ parameter: submitParams() });
  // 申込者への1通だけ
  assert.strictEqual(h.sentMail.length, 1);
  assert.strictEqual(h.sentMail[0].to, 'taro@example.com');
});

test('日次ダイジェストは申込0件なら送らない', () => {
  const { h } = makeHarness({ properties: { ADMIN_EMAIL: 'admin@example.com' } });
  const result = h.ctx.sendDailyDigest();
  assert.strictEqual(result.sent, false);
  assert.strictEqual(result.reason, 'no-submissions');
  assert.strictEqual(h.sentMail.length, 0);
});

test('日次ダイジェストは申込をまとめて1通にする', () => {
  const { h } = makeHarness({ properties: { ADMIN_EMAIL: 'admin@example.com' } });

  h.ctx.doPost({ parameter: submitParams() });
  h.ctx.doPost({ parameter: submitParams({
    answers: JSON.stringify({ name: '鈴木 花子', email: 'hanako@example.com' }),
    boothId: 'inner', selectedOptions: JSON.stringify({})
  }) });
  h.sentMail.length = 0;

  const result = h.ctx.sendDailyDigest();
  assert.strictEqual(result.sent, true);
  assert.strictEqual(result.count, 2);
  assert.strictEqual(h.sentMail.length, 1, '2件の申込でもメールは1通');

  const body = h.sentMail[0].body;
  assert.match(body, /新規申込: 2件/);
  assert.match(body, /山田 太郎/);
  assert.match(body, /鈴木 花子/);
  assert.match(body, /未入金:\s+2件/);
});

// ========================================
// リピーター認証
// ========================================
test('該当データが無ければ認証コードを発行しない', () => {
  const { h } = makeHarness();
  const res = h.readResponse(h.ctx.doPost({
    parameter: { action: 'send_auth_code', name: '存在しない人', email: 'nobody@example.com' }
  }));
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'NOT_FOUND');
  assert.strictEqual(h.sentMail.length, 0, '無駄な送信枠を使わない');
});

test('該当データがあれば認証コードをメールで送る', () => {
  const { h } = makeHarness();
  h.ctx.doPost({ parameter: submitParams() });
  h.sentMail.length = 0;

  const res = h.readResponse(h.ctx.doPost({
    parameter: { action: 'send_auth_code', name: '山田 太郎', email: 'taro@example.com' }
  }));

  assert.strictEqual(res.success, true);
  assert.strictEqual(h.sentMail.length, 1);
  assert.match(h.sentMail[0].body, /認証コード: \d{4}/);
});

test('氏名の表記ゆれ（空白）を吸収して照合する', () => {
  const { h } = makeHarness();
  h.ctx.doPost({ parameter: submitParams() });
  h.sentMail.length = 0;

  const res = h.readResponse(h.ctx.doPost({
    parameter: { action: 'send_auth_code', name: '山田太郎', email: 'TARO@example.com' }
  }));
  assert.strictEqual(res.success, true, '空白と大文字小文字の違いは無視する');
});

test('正しいコードで過去の申込内容を取り出せる', () => {
  const { h } = makeHarness();
  h.ctx.doPost({ parameter: submitParams() });
  h.sentMail.length = 0;

  h.ctx.doPost({ parameter: { action: 'send_auth_code', name: '山田 太郎', email: 'taro@example.com' } });
  const code = h.sentMail[0].body.match(/認証コード: (\d{4})/)[1];

  const res = h.readResponse(h.ctx.doPost({
    parameter: { action: 'verify_auth_code', name: '山田 太郎', email: 'taro@example.com', code }
  }));

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.list.length, 1);

  const rec = res.list[0];
  assert.strictEqual(rec.answers.name, '山田 太郎');
  assert.strictEqual(rec.answers.exhibitorName, 'サロン太郎');
  assert.strictEqual(rec.answers.cq_menu, 'タロット占い');

  // 金額に関わるものは復元しない
  assert.ok(!('booth' in rec.answers), 'ブースは復元しない');
  assert.ok(!('category' in rec.answers), 'カテゴリは復元しない');

  // SNSリンクは配列に戻る
  assert.ok(Array.isArray(rec.answers.snsLinks));
  assert.strictEqual(rec.answers.snsLinks[0].url, 'https://instagram.com/taro');
});

test('誤ったコードを5回入れるとコードが無効化される', () => {
  const { h } = makeHarness();
  h.ctx.doPost({ parameter: submitParams() });
  h.ctx.doPost({ parameter: { action: 'send_auth_code', name: '山田 太郎', email: 'taro@example.com' } });

  const wrong = { action: 'verify_auth_code', name: '山田 太郎', email: 'taro@example.com', code: '0000' };
  let res;
  for (let i = 0; i < 5; i++) {
    res = h.readResponse(h.ctx.doPost({ parameter: wrong }));
  }
  assert.strictEqual(res.code, 'MISMATCH');

  res = h.readResponse(h.ctx.doPost({ parameter: wrong }));
  assert.strictEqual(res.code, 'LOCKED', '6回目でロックされる');
});

test('連続で再送しようとするとクールダウンで弾かれる', () => {
  const { h } = makeHarness();
  h.ctx.doPost({ parameter: submitParams() });

  const p = { action: 'send_auth_code', name: '山田 太郎', email: 'taro@example.com' };
  h.ctx.doPost({ parameter: p });
  const res = h.readResponse(h.ctx.doPost({ parameter: p }));
  assert.strictEqual(res.code, 'COOLDOWN');
});

test('メール枠が尽きているときは理由を返す', () => {
  const { h } = makeHarness();
  h.ctx.doPost({ parameter: submitParams() });
  h.setQuota(0);

  const res = h.readResponse(h.ctx.doPost({
    parameter: { action: 'send_auth_code', name: '山田 太郎', email: 'taro@example.com' }
  }));
  assert.strictEqual(res.code, 'QUOTA');
  assert.match(res.error, /上限/);
});

// 列ラベル（項目名）は管理者が変更できる。fieldId で引いているか確認する。
test('項目名を変更してもリピーター照合が壊れない', () => {
  const { h, cfg } = makeHarness();
  h.ctx.doPost({ parameter: submitParams() });

  // 「お名前（本名）」→「申込者氏名」に改名した状況
  cfg.fields.find(f => f.id === 'name').label = '申込者氏名';
  h.ctx.invalidateConfigCache();
  h.sentMail.length = 0;

  const res = h.readResponse(h.ctx.doPost({
    parameter: { action: 'send_auth_code', name: '山田 太郎', email: 'taro@example.com' }
  }));
  assert.strictEqual(res.success, true, '_meta の fieldId 対応で引けること');
});

// ========================================
// 管理API
// ========================================
test('パスワードが違えば管理操作を拒否する', () => {
  const { h } = makeHarness();
  const res = h.readResponse(h.ctx.doPost({
    parameter: { action: 'admin_status', password: 'wrong' }
  }));
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'BAD_PASSWORD');
});

test('正しいパスワードなら状態を返す', () => {
  const { h } = makeHarness();
  const res = h.readResponse(h.ctx.doPost({
    parameter: { action: 'admin_status', password: 'secret' }
  }));
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.properties.ADMIN_PASSWORD, true, '値ではなく設定済みかだけを返す');
  assert.strictEqual(typeof res.mailQuotaRemaining, 'number');
});

test('打ち間違いが数回続いてもロックされない', () => {
  const { h } = makeHarness();
  // スマホでの打ち間違いを想定。9回目までは通常のエラーで、締め出さない。
  for (let i = 0; i < 9; i++) {
    const res = h.readResponse(h.ctx.doPost({
      parameter: { action: 'admin_status', password: 'wrong' }
    }));
    assert.strictEqual(res.code, 'BAD_PASSWORD', (i + 1) + '回目はまだロックしない');
  }
  const ok = h.readResponse(h.ctx.doPost({
    parameter: { action: 'admin_status', password: 'secret' }
  }));
  assert.strictEqual(ok.success, true, '9回誤っても正しく入れればログインできる');
});

test('パスワード誤りが10回続くとロックされる', () => {
  const { h } = makeHarness();
  for (let i = 0; i < 10; i++) {
    h.ctx.doPost({ parameter: { action: 'admin_status', password: 'wrong' } });
  }
  const res = h.readResponse(h.ctx.doPost({
    parameter: { action: 'admin_status', password: 'secret' }
  }));
  assert.strictEqual(res.code, 'LOCKED');
});

test('ログインに成功すると失敗カウンタがリセットされる', () => {
  const { h } = makeHarness();
  for (let i = 0; i < 9; i++) {
    h.ctx.doPost({ parameter: { action: 'admin_status', password: 'wrong' } });
  }
  h.ctx.doPost({ parameter: { action: 'admin_status', password: 'secret' } });

  // カウンタが戻っているので、また9回まで猶予がある
  for (let i = 0; i < 9; i++) {
    const res = h.readResponse(h.ctx.doPost({
      parameter: { action: 'admin_status', password: 'wrong' }
    }));
    assert.strictEqual(res.code, 'BAD_PASSWORD');
  }
});

test('設定に致命的な誤りがあれば保存を止める', () => {
  const { h, cfg } = makeHarness();
  const broken = JSON.parse(JSON.stringify(cfg));
  broken.booths = [];                       // ブースなし
  broken.integration = { gasUrl: '' };      // 送信先なし

  const res = h.readResponse(h.ctx.doPost({
    parameter: { action: 'admin_save_config', password: 'secret', config: JSON.stringify(broken) }
  }));

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'VALIDATION');
  assert.ok(res.issues.some(i => i.level === 'error'));
});

// ========================================
// 開催回セットアップ
// ========================================
test('新規開催回でスプレッドシートとフォルダが作られる', () => {
  const h2 = createHarness({
    properties: {
      CONFIG_JSON_URL: 'https://example.com/config.json',
      ADMIN_PASSWORD: 'secret',
      DRIVE_ROOT_FOLDER_ID: 'ROOT'
    },
    fetchHandler: () => ({ code: 200, text: JSON.stringify(CONFIG) })
  });

  const result = h2.ctx.setupNewEvent({});

  assert.strictEqual(result.success, true);
  assert.ok(result.currentSpreadsheetId, 'イベント用スプシが作られる');
  assert.ok(result.databaseSpreadsheetId, 'マスターDBが作られる');

  // ヘッダーが config どおりに入っている
  const ss = h2.spreadsheets.get(result.currentSpreadsheetId);
  const sheet = ss.getSheetByName('申込データ');
  const labels = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  assert.strictEqual(labels[0], '座席番号');
  assert.ok(labels.includes('コンセント使用'));

  // Drive フォルダも作られる
  assert.ok(h2.createdFolders.some(f => f.name === '第1回テストフェスタ'));

  // プロパティに書き戻されている
  assert.strictEqual(h2.properties.get('CURRENT_SPREADSHEET_ID'), result.currentSpreadsheetId);
});

test('下見モードでは何も作らず計画だけ返す', () => {
  const h2 = createHarness({
    properties: {
      CONFIG_JSON_URL: 'https://example.com/config.json',
      DRIVE_ROOT_FOLDER_ID: 'ROOT'
    },
    fetchHandler: () => ({ code: 200, text: JSON.stringify(CONFIG) })
  });

  const preview = h2.ctx.previewSetup();
  assert.strictEqual(preview.eventName, '第1回テストフェスタ');
  assert.strictEqual(preview.plan.length, 3);
  assert.ok(preview.headerPreview.includes('お名前（本名）'), 'ヘッダーの下見が返る');
  assert.strictEqual(h2.spreadsheets.size, 0, '何も作られていない');
  assert.strictEqual(h2.createdFolders.length, 0);
});

// ========================================
// 移送
// ========================================
test('旧シートの列を新スキーマへ対応づける', () => {
  const { h, cfg } = makeHarness();
  const mapping = h.ctx.buildLegacyMapping(
    h.ctx.normalizeConfig(cfg),
    ['開催回', '申込日時', '氏名', 'メールアドレス', '電話番号', '出展名',
     '出展メニュー', 'SNS', '謎の列']
  );

  assert.strictEqual(mapping.labelToFieldId['氏名'], 'name');
  assert.strictEqual(mapping.labelToFieldId['メールアドレス'], 'email');
  assert.strictEqual(mapping.labelToFieldId['出展名'], 'exhibitorName');
  assert.strictEqual(mapping.labelToFieldId['出展メニュー'], 'cq_menu');
  assert.ok(mapping.unmapped.includes('謎の列'), '対応づかない列は報告される');
});

test('旧スプレッドシートからマスターDBへ移送できる', () => {
  const { h, master } = makeHarness();

  // 旧スプシ（スタッフ所有想定）を用意する
  const legacy = h.newSpreadsheet('旧申込データ');
  const sheet = legacy.insertSheet('申込データ');
  sheet.appendRow(['開催回', '申込日時', '氏名', 'メールアドレス', '出展名', '合計金額']);
  sheet.appendRow(['第0回', '2025/10/01 10:00', '過去 太郎', 'past@example.com', '過去サロン', 12000]);
  sheet.appendRow(['第0回', '2025/10/02 11:00', '過去 花子', 'past2@example.com', '花子堂', 8000]);

  const dry = h.ctx.migrateLegacySpreadsheet({ sourceId: legacy.getId(), dryRun: true });
  assert.strictEqual(dry.dryRun, true);
  assert.strictEqual(dry.sourceRows, 2);
  assert.strictEqual(h.spreadsheets.get(master.getId()).getSheetByName('申込データ'), null,
    '下見では書き込まない');

  const result = h.ctx.migrateLegacySpreadsheet({ sourceId: legacy.getId() });
  assert.strictEqual(result.migrated, 2);

  const target = master.getSheetByName('申込データ');
  assert.strictEqual(target.getLastRow(), 3, 'ヘッダー + 2件');

  const labels = target.getRange(1, 1, 1, target.getLastColumn()).getValues()[0];
  const row = target.getRange(2, 1, 1, target.getLastColumn()).getValues()[0];
  assert.strictEqual(row[labels.indexOf('お名前（本名）')], '過去 太郎');
  assert.strictEqual(row[labels.indexOf('開催回')], '第0回');

  // 旧シートは変更されない
  assert.strictEqual(sheet.getLastRow(), 3);
});

test('同じデータを二重に移送しない', () => {
  const { h, master } = makeHarness();
  const legacy = h.newSpreadsheet('旧申込データ');
  const sheet = legacy.insertSheet('申込データ');
  sheet.appendRow(['開催回', '申込日時', '氏名', 'メールアドレス']);
  sheet.appendRow(['第0回', '2025/10/01 10:00', '過去 太郎', 'past@example.com']);

  h.ctx.migrateLegacySpreadsheet({ sourceId: legacy.getId() });
  const second = h.ctx.migrateLegacySpreadsheet({ sourceId: legacy.getId() });

  assert.strictEqual(second.migrated, 0);
  assert.strictEqual(second.skipped, 1);
  assert.strictEqual(master.getSheetByName('申込データ').getLastRow(), 2, '増えていない');
});

// ========================================
// Drive フォルダの指定
// ========================================
test('フォルダのURLからIDを取り出せる', () => {
  const { h } = makeHarness();
  const p = h.ctx.parseDriveFolderId;

  assert.strictEqual(p('https://drive.google.com/drive/folders/1ABCxyz_-9'), '1ABCxyz_-9');
  assert.strictEqual(p('https://drive.google.com/drive/u/0/folders/1ABCxyz_-9'), '1ABCxyz_-9');
  assert.strictEqual(p('https://drive.google.com/open?id=1ABCxyz_-9'), '1ABCxyz_-9');
  assert.strictEqual(p('1ABCxyz_-9'), '1ABCxyz_-9', 'IDのみでもそのまま使える');
  assert.strictEqual(p('  1ABCxyz_-9  '), '1ABCxyz_-9', '前後の空白を無視する');
  assert.strictEqual(p(''), null);
  assert.strictEqual(p('これは違う値です'), null);
});

test('フォルダをURLで指定していても画像を保存できる', () => {
  const { h } = makeHarness({
    properties: { DRIVE_ROOT_FOLDER_ID: 'https://drive.google.com/drive/folders/ROOT' }
  });
  const folder = h.ctx.getRootFolder();
  assert.ok(folder, 'URL指定でもフォルダを開ける');
});

test('フォルダの指定が解釈できなければ理由の分かるエラーになる', () => {
  const { h } = makeHarness({ properties: { DRIVE_ROOT_FOLDER_ID: '不正な値' } });
  assert.throws(() => h.ctx.getRootFolder(), /解釈できません/);
});

// ========================================
// 運用補助
// ========================================
test('メール文面のプレビューが差し込み後の本文を返す', () => {
  const { h } = makeHarness();
  const text = h.ctx.previewConfirmationMail();
  assert.match(text, /=== 件名 ===/);
  assert.match(text, /=== 本文 ===/);
  assert.ok(!/展開されなかった差し込み/.test(text),
    '既定のテンプレートに未展開の記法が残らないこと');
  assert.strictEqual(h.sentMail.length, 0, 'プレビューでは送信しない');
});

test('プレビューは未展開の差し込みを警告する', () => {
  const { h } = makeHarness({
    mutateConfig: (c) => { c.email.confirmationBodyTemplate = '{{typo}}'; }
  });
  assert.match(h.ctx.previewConfirmationMail(), /展開されなかった差し込み: \{\{typo\}\}/);
});

test('設定確認が状態を一覧で返す', () => {
  const { h } = makeHarness();
  const text = h.ctx.checkSetup();
  assert.match(text, /config\.json を取得できました/);
  assert.match(text, /第1回テストフェスタ/);
  assert.match(text, /本日あと \d+ 宛先/);
});

test('移送先が未設定なら分かるエラーを返す', () => {
  const h2 = createHarness({
    properties: { CONFIG_JSON_URL: 'https://example.com/config.json' },
    fetchHandler: () => ({ code: 200, text: JSON.stringify(CONFIG) })
  });
  assert.throws(
    () => h2.ctx.migrateLegacySpreadsheet({ sourceId: 'X' }),
    /マスターDBが未作成/
  );
});

// ========================================
// 本番へ書き込まないための守り
// ========================================

test('所有者が自分なら再利用する / 他人なら再利用しない', () => {
  const cfg = JSON.parse(JSON.stringify(CONFIG));

  const mine = createHarness({
    activeUser: 'owner@example.com',
    properties: { CONFIG_JSON_URL: 'https://example.com/config.json' },
    fetchHandler: () => ({ code: 200, text: JSON.stringify(cfg) }),
    driveFiles: [{ id: 'SS_MINE', name: '申込データ', owner: 'owner@example.com' }]
  });
  mine.newSpreadsheet('申込データ');
  // newSpreadsheet が採番した ID ではなく、driveFiles の ID で開けるようにする
  mine.spreadsheets.set('SS_MINE', mine.spreadsheets.values().next().value);
  assert.ok(mine.ctx.findSpreadsheetByName('申込データ'), '自分の所有なら再利用する');

  const theirs = createHarness({
    activeUser: 'owner@example.com',
    properties: { CONFIG_JSON_URL: 'https://example.com/config.json' },
    fetchHandler: () => ({ code: 200, text: JSON.stringify(cfg) }),
    driveFiles: [{ id: 'SS_STAFF', name: '申込データ', owner: 'staff@example.com' }]
  });
  assert.strictEqual(
    theirs.ctx.findSpreadsheetByName('申込データ'), null,
    '他人所有（共有されただけ）なら再利用しない');
});

test('所有者を確認できないファイルは再利用しない', () => {
  const cfg = JSON.parse(JSON.stringify(CONFIG));
  const h = createHarness({
    properties: { CONFIG_JSON_URL: 'https://example.com/config.json' },
    fetchHandler: () => ({ code: 200, text: JSON.stringify(cfg) }),
    driveFiles: [{ id: 'SS_X', name: '申込データ', owner: null }]
  });
  assert.strictEqual(h.ctx.findSpreadsheetByName('申込データ'), null);
});

test('GITHUB_BRANCH が未設定なら設定を保存しない', () => {
  // 既定を main にしていると、検証用プロジェクトの保存が本番を書き換える。
  const { h } = makeHarness({
    properties: { GITHUB_TOKEN: 'tok', GITHUB_REPO: 'owner/repo' }
  });
  const res = h.readResponse(h.ctx.handleAdmin('admin_save_config', {
    password: 'secret',
    config: JSON.stringify(CONFIG)
  }));
  assert.strictEqual(res.success, false);
  assert.match(res.error, /GITHUB_BRANCH/);
});

// ========================================
// フル機能テスト（runFullTest 自体の検証）
// ========================================

test('runFullTest が申込・転記・メール・照合を通しで確認する', () => {
  const { h } = makeHarness({ properties: { DRIVE_ROOT_FOLDER_ID: 'ROOT' } });

  const report = h.ctx.runFullTest();

  assert.ok(!/❌/.test(report), '失敗項目が出ていない:\n' + report);
  assert.match(report, /申込を受け付けました/);
  assert.match(report, /金額が計算どおりです/);
  assert.match(report, /合計金額の列が正しく入っています/);
  assert.match(report, /マスターDBにも転記されました/);
  assert.match(report, /確認メールを送信しました/);
  assert.match(report, /メール本文の差し込みはすべて展開されました/);
  assert.match(report, /認証コードで過去の申込を読み出せました/);

  // setupNewEvent が保存先を作り直すので、実行後のプロパティを見る
  const current = h.spreadsheets.get(h.properties.get('CURRENT_SPREADSHEET_ID'));
  const master = h.spreadsheets.get(h.properties.get('DATABASE_SPREADSHEET_ID'));

  assert.strictEqual(current.getSheetByName('申込データ').getLastRow(), 2, 'ヘッダー + 申込1件');
  assert.strictEqual(master.getSheetByName('申込データ').getLastRow(), 2);
  assert.ok(h.sentMail.length >= 1, '確認メールが送られている');
});

test('runFullTest は書き込み先が main のとき中止する', () => {
  const { h } = makeHarness({
    properties: { GITHUB_TOKEN: 'tok', GITHUB_REPO: 'owner/repo', GITHUB_BRANCH: 'main' }
  });
  const report = h.ctx.runFullTest();

  assert.match(report, /中止しました/);
  assert.match(report, /稼働中のフォームの設定が書き換わります/);
  assert.ok(!/申込を受け付けました/.test(report), '申込まで進んでいない');
});

test('cleanupTestData は目印のある行だけ消す', () => {
  const { h } = makeHarness({ properties: { DRIVE_ROOT_FOLDER_ID: 'ROOT' } });

  h.ctx.runFullTest();

  // 同じ保存先に、目印のない本物の申込を1件足す
  const current = h.spreadsheets.get(h.properties.get('CURRENT_SPREADSHEET_ID'));
  h.readResponse(h.ctx.doPost({ parameter: {
    action: 'submit',
    answers: JSON.stringify({ name: '本物 花子', email: 'real@example.com' }),
    selectedOptions: '{}', boothId: 'inner', agreeTerms: '1', imageFieldIds: '[]'
  }}));

  const sheet = current.getSheetByName('申込データ');
  assert.strictEqual(sheet.getLastRow(), 3, 'ヘッダー + テスト + 本物');

  const text = h.ctx.cleanupTestData();
  assert.match(text, /今回の申込データ: 1行を削除しました/);

  assert.strictEqual(sheet.getLastRow(), 2, '本物の申込は残る');
  const rows = h.ctx.readRows(current.getId()).rows;
  assert.ok(rows.some((r) => r.byKey.name === '本物 花子'), '本物の行が残っている');
  assert.ok(!rows.some((r) => String(r.byKey.name).indexOf('★自動テスト★') >= 0));
});

test('removeTriggers が自動実行をすべて外す', () => {
  const { h } = makeHarness();
  h.ctx.installTriggers();
  assert.ok(h.triggers.length > 0);

  const text = h.ctx.removeTriggers();
  assert.match(text, /件のトリガーを削除しました/);
  assert.strictEqual(h.triggers.length, 0);
});

test('runFullTest が画像の Drive 保存まで確認する', () => {
  const { h } = makeHarness({
    properties: { DRIVE_ROOT_FOLDER_ID: 'ROOT' },
    mutateConfig: (c) => {
      c.fields.push({
        id: 'profileImage', type: 'image', label: 'プロフィール写真',
        section: 'exhibit', order: 90, required: true
      });
    }
  });

  const report = h.ctx.runFullTest();

  assert.ok(!/❌/.test(report), '失敗項目が出ていない:\n' + report);
  assert.match(report, /画像が Drive に保存されました: https:\/\//);

  // 行にも画像URLが入っていること
  const current = h.spreadsheets.get(h.properties.get('CURRENT_SPREADSHEET_ID'));
  const row = h.ctx.readRows(current.getId()).rows[0];
  assert.match(String(row.byKey.profileImage), /^https:\/\//);
});
