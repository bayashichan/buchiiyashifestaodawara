/**
 * 質問の並び順の回帰テスト（実DOM）
 *
 * 検証すること
 *  - formOrder が無ければ、これまでと同じ並びで表示される
 *  - formOrder どおりに質問・見出しが並び、見出しの番号が 1, 2, 3… と振り直される
 *  - 中身が空になった見出しは出ない。見出しより前に置いた質問も表示される
 *  - 消した質問・知らない名前は無視し、並びに無い質問も表示される
 *  - 並べ替えても送信内容は変わらない
 *  - 管理画面と申込フォームで、初期の並びが同じ
 *
 * 実行方法:
 *   npm i --no-save jsdom
 *   node apply/tests/order.test.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'node:child_process';

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('jsdom が見つからないためスキップします（npm i --no-save jsdom）');
  process.exit(0);
}

const REPO   = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html   = fs.readFileSync(`${REPO}/apply/index.html`, 'utf8');
const script = fs.readFileSync(`${REPO}/apply/script.js`, 'utf8');
const config = JSON.parse(fs.readFileSync(`${REPO}/apply/config.json`, 'utf8'));
delete config.formOrder;   // 公開中の設定が並べ替えられていても、テストの前提は変えない

let ng = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '  → ' + extra}`);
  if (!cond) ng++;
};

async function boot(cfg, { htmlSource = html, scriptSource = script } = {}) {
  const dom = new JSDOM(htmlSource, { runScripts: 'outside-only', url: 'https://example.test/apply/' });
  const { window } = dom;
  const sent = {};
  window.fetch = async (url, opts) => {
    if (String(url).includes('config.json')) return { ok: true, json: async () => cfg };
    sent.body = opts?.body;
    return { ok: true, json: async () => ({ success: true, totalFee: 8000 }) };
  };
  window.alert = msg => { sent.alert = msg; };
  window.confirm = () => true;
  window.eval(scriptSource);
  await new Promise(r => setTimeout(r, 80));
  return { window, doc: window.document, sent };
}

const withOrder = order => ({ ...JSON.parse(JSON.stringify(config)), formOrder: order });

// 表示されている質問のかたまりの並び
const blocks = doc => [...doc.querySelectorAll('#applicationForm [data-block]')]
  .filter(el => !el.closest('.hidden')).map(el => el.dataset.block);
// 表示されている見出し
const titles = doc => [...doc.querySelectorAll('#applicationForm > .form-section:not(.hidden) .section-title')]
  .map(el => el.textContent.trim());
// 入力欄の名前（フォームの上から順）
const fieldNames = doc => [...doc.getElementById('applicationForm').elements]
  .map(el => el.name || el.id).filter(Boolean);

const Q1 = config.customQuestions[0].id;   // 出展メニュー名
const Q2 = config.customQuestions[1].id;   // 自己紹介

// 初期の並び（管理画面は、いつもこのように全部の項目の並びを保存する）
const DEFAULTS = [
  'section:basic', 'name', 'furigana', 'phone', 'address', 'email',
  'section:exhibit', 'exhibitorName', 'category', 'booth', `q:${Q1}`, `q:${Q2}`, 'photo', 'photoPermission',
  'section:sns', 'sns', 'section:options', 'options', 'section:party', 'party',
  'section:stampRally', 'stampRally', 'section:member', 'member', 'section:other', 'terms', 'notes'
];
// key を before の直前へ動かした並び（before が null ならいちばん下へ）
const moved = (order, key, before) => {
  const out = order.filter(k => k !== key);
  out.splice(before ? out.indexOf(before) : out.length, 0, key);
  return out;
};

// ============================================================
console.log('\n[1] formOrder が無いとき（これまでどおり）');
{
  const { doc } = await boot(config);
  ok('質問がこれまでと同じ順に並ぶ',
    blocks(doc).join(',') === ['name', 'furigana', 'phone', 'address', 'email',
      'exhibitorName', 'category', 'booth', `q:${Q1}`, `q:${Q2}`, 'photo', 'photoPermission',
      'sns', 'options', 'party', 'stampRally', 'member', 'terms', 'notes'].join(','),
    blocks(doc).join(','));
  ok('見出しに通し番号が振られる',
    titles(doc).join('|') === ['📝 1. 基本情報', '✨ 2. 出展内容', '🔗 3. SNSリンク', '⚙️ 4. オプション',
      '🎉 5. 懇親会', '🎁 6. スタンプラリー', '🏅 7. 会員特典', '📋 8. 規約・その他'].join('|'),
    titles(doc).join('|'));

  // 変更前の申込フォームと、入力欄の並びが同じか確かめる
  let oldHtml = null, oldScript = null;
  try {
    oldHtml   = execSync('git show 4656a7b:apply/index.html', { cwd: REPO, encoding: 'utf8', maxBuffer: 1e8 });
    oldScript = execSync('git show 4656a7b:apply/script.js',  { cwd: REPO, encoding: 'utf8', maxBuffer: 1e8 });
  } catch { /* 比較できない環境ではスキップ */ }
  if (oldHtml) {
    const before = await boot(config, { htmlSource: oldHtml, scriptSource: oldScript });
    ok('入力欄の並びが変更前のフォームと同じ',
      fieldNames(before.doc).join(',') === fieldNames(doc).join(','),
      `\n    前: ${fieldNames(before.doc).join(',')}\n    後: ${fieldNames(doc).join(',')}`);
  } else {
    console.log('  （変更前の版は取得できないため比較をスキップします）');
  }
}

// ============================================================
console.log('\n[2] 並べ替えたとき');
{
  const order = [
    'section:basic', 'name', `q:${Q2}`, 'furigana', 'email', 'phone', 'address',
    'section:member', 'member',
    'section:exhibit', 'exhibitorName', `q:${Q1}`, 'booth', 'category', 'photo', 'photoPermission',
    'section:sns', 'sns', 'section:options', 'options', 'section:party', 'party',
    'section:stampRally', 'stampRally', 'section:other', 'notes', 'terms'
  ];
  const { doc } = await boot(withOrder(order));
  ok('質問が設定どおりに並ぶ',
    blocks(doc).join(',') === order.filter(k => !k.startsWith('section:')).join(','),
    blocks(doc).join(','));
  ok('見出しも設定どおりに並び、番号が振り直される',
    titles(doc).join('|') === ['📝 1. 基本情報', '🏅 2. 会員特典', '✨ 3. 出展内容', '🔗 4. SNSリンク',
      '⚙️ 5. オプション', '🎉 6. 懇親会', '🎁 7. スタンプラリー', '📋 8. 規約・その他'].join('|'),
    titles(doc).join('|'));
  ok('ほかの見出しの中に動かした質問は、その見出しの中に出る',
    doc.getElementById(Q2).closest('[data-section]')?.dataset.section === 'basic');
}

// ============================================================
console.log('\n[3] 表示しない項目と、空になった見出し');
{
  const cfg = withOrder([
    'section:basic', 'name', 'furigana', 'phone', 'address', 'email', 'exhibitorName', 'category',
    'booth', `q:${Q1}`, `q:${Q2}`, 'photo', 'photoPermission', 'sns',
    'section:exhibit', 'section:sns',
    'section:options', 'options', 'section:party', 'party', 'section:stampRally', 'stampRally',
    'section:member', 'member', 'section:other', 'terms', 'notes'
  ]);
  cfg.features.stampRally = false;
  const { doc } = await boot(cfg);
  ok('中身を全部動かした見出しは出ない', !titles(doc).some(t => t.includes('出展内容')), titles(doc).join('|'));
  ok('SNSの見出しも、SNS欄を動かしたので出ない', !titles(doc).some(t => t.includes('SNSリンク')));
  ok('表示しない設定の見出しは出ず、番号が詰まる',
    titles(doc).join('|') === ['📝 1. 基本情報', '⚙️ 2. オプション', '🎉 3. 懇親会',
      '🏅 4. 会員特典', '📋 5. 規約・その他'].join('|'),
    titles(doc).join('|'));
}

// ============================================================
console.log('\n[4] 見出しより前に置いた質問');
{
  const { doc } = await boot(withOrder(moved(DEFAULTS, 'exhibitorName', 'section:basic')));
  const first = doc.querySelector('#applicationForm > .form-section');
  ok('いちばん上の枠に出る', first.contains(doc.getElementById('exhibitorNameInput')));
  ok('その枠には見出しが付かない', !first.querySelector('.section-title'));
  ok('そのあとに基本情報が続く',
    first.nextElementSibling?.dataset.section === 'basic' && titles(doc)[0] === '📝 1. 基本情報',
    titles(doc)[0]);
}

// ============================================================
console.log('\n[5] 並びに無い質問・消した質問・知らない名前');
{
  // 自己紹介を基本情報へ動かしたあと、並びを保存せずに質問を足した（config.json を直接書き換えた）場合
  const order = moved(DEFAULTS, `q:${Q2}`, 'furigana').filter(k => k !== `q:${Q1}`);
  order.splice(3, 0, 'q:消した質問', 'わからない名前', 'name');
  const cfg = withOrder(order);
  cfg.customQuestions.push({ id: "新しい質問 'テスト' <1>", type: 'text', label: "新しい質問 'テスト' <1>", required: false });
  const { doc } = await boot(cfg);
  const b = blocks(doc);
  ok('並びに無い質問も表示される', b.includes(`q:${Q1}`) && b.includes('photo') && b.includes('notes'), b.join(','));
  ok('同じものが二重に出ない', new Set(b).size === b.length, b.join(','));
  ok('足した質問は、直前の質問のうしろに入る',
    b.indexOf("q:新しい質問 'テスト' <1>") === b.indexOf(`q:${Q2}`) + 1, b.join(','));
  ok('記号を含む質問も入力欄が作られる', !!doc.getElementById("新しい質問 'テスト' <1>"));
  ok('並びに無かった質問は、初期の並びで直前にあるもののうしろに入る',
    b.indexOf(`q:${Q1}`) === b.indexOf('booth') + 1, b.join(','));
  ok('見出しはどれも1回ずつ出る', titles(doc).length === 8, titles(doc).join('|'));
}

// ============================================================
console.log('\n[6] 並べ替えても送信内容は変わらない');
{
  const order = ['section:other', 'terms', 'notes', `q:${Q2}`, 'section:basic', 'email', 'name', 'furigana',
    'section:exhibit', 'booth', 'exhibitorName', `q:${Q1}`];
  const { window, doc, sent } = await boot(withOrder(order));
  const set = (sel, v) => { doc.querySelector(sel).value = v; };
  set('#nameInput', '山田 花子');
  set('[name="furigana"]', 'やまだ はなこ');
  set('[name="phoneNumber"]', '090-1111-2222');
  set('#postalCode', '250-0002');
  set('#addressInput', '神奈川県小田原市1-1');
  set('#emailInput', 'hanako@example.com');
  set('#emailConfirmInput', 'hanako@example.com');
  set('[name="exhibitorName"]', 'サロン花');
  set('[name="notes"]', 'よろしくお願いします');
  doc.getElementById(Q1).value = 'タロット 20分';
  doc.getElementById(Q2).value = 'はじめまして';
  window.selectCategory(config.categories[0], doc.querySelector('.category-btn'));
  window.selectBooth(config.booths[0].id);
  doc.querySelector('input[name="photoPermission"][value="可"]').checked = true;
  doc.querySelector('[name="agreeTerms"]').checked = true;
  doc.getElementById('photoLater').checked = true;
  window.togglePhotoUpload();

  ok('入力チェックを通る', window.validateForm().length === 0, window.validateForm().join(' / '));
  await window.submitForm();
  const body = sent.body;
  ok('送信される', !!body && !sent.alert, sent.alert);
  ok('お名前が送られる', body?.get('name') === '山田 花子');
  ok('備考が送られる', body?.get('notes') === 'よろしくお願いします');
  const answers = JSON.parse(body?.get('customAnswers') || '{}');
  ok('自由な質問の答えが送られる', answers[Q1] === 'タロット 20分' && answers[Q2] === 'はじめまして',
    JSON.stringify(answers));
}

// ============================================================
console.log('\n[7] 管理画面と申込フォームの初期の並び');
{
  const admin = fs.readFileSync(`${REPO}/admin/config-editor.html`, 'utf8');
  const pick = src => {
    const m = src.match(/const DEFAULT_FORM_ORDER = (\[[\s\S]*?\]);/);
    return m ? JSON.parse(m[1].replace(/'/g, '"').replace(/,\s*\]/, ']')) : null;
  };
  const a = pick(admin), f = pick(script);
  ok('両方に並びの初期値がある', !!a && !!f);
  ok('同じ並びになっている', JSON.stringify(a) === JSON.stringify(f), `\n    管理画面: ${a}\n    フォーム: ${f}`);
}

console.log(ng === 0 ? '\n✅ すべて成功' : `\n❌ ${ng}件失敗`);
process.exit(ng === 0 ? 0 : 1);
