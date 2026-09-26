/**
 * SNSリンク欄の回帰テスト（実DOM）
 *
 * 「＋ SNSリンクを追加」で増やした欄が、送信時に確実に拾われることを確認します。
 * 以前、追加した欄に判定用クラスが付かず、2件目以降が送信されない不具合がありました。
 *
 * 実行方法:
 *   npm i --no-save jsdom
 *   node apply/tests/sns.test.mjs
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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html   = fs.readFileSync(`${REPO}/apply/index.html`, 'utf8');
const config = JSON.parse(fs.readFileSync(`${REPO}/apply/config.json`, 'utf8'));

const URLS = [
  'https://www.instagram.com/example',
  'https://www.tiktok.com/@example',
  'https://lin.ee/example'
];

async function run(scriptSource, label, cfg = config) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/apply/' });
  const { window } = dom, doc = window.document;
  window.fetch = async () => ({ ok: true, json: async () => cfg });
  window.alert = () => {};

  window.eval(scriptSource);
  await new Promise(r => setTimeout(r, 80));   // jsdom が DOMContentLoaded を発火させる

  // 「＋ SNSリンクを追加」を2回押して3欄にする
  doc.getElementById('addSnsBtn').dispatchEvent(new window.Event('click'));
  doc.getElementById('addSnsBtn').dispatchEvent(new window.Event('click'));

  [...doc.querySelectorAll('#snsLinksContainer input')].forEach((el, i) => {
    if (!URLS[i]) return;
    el.value = URLS[i];
    el.dispatchEvent(new window.Event('input'));
  });

  // 送信時と同じ収集処理を再現
  const collect = () => {
    const out = [];
    doc.querySelectorAll('.sns-input').forEach((input, index) => {
      if (input.value) {
        const badge = doc.querySelector(`.sns-badge[data-index="${index}"]`);
        out.push({ type: badge?.textContent || 'HP', url: input.value });
      }
    });
    return out;
  };

  const rows = doc.querySelectorAll('#snsLinksContainer .sns-link-row').length;
  const collected = collect();
  const dropped = URLS.filter(u => !collected.some(c => c.url === u));

  console.log(`\n■ ${label}`);
  console.log(`  入力欄 ${rows}件 → 送信対象 ${collected.length}件`);
  collected.forEach(c => console.log(`    - ${c.type}: ${c.url}`));
  if (dropped.length) console.log(`  ❌ 送信されないURL: ${dropped.join(' , ')}`);

  return { window, doc, rows, collected, dropped, collect };
}

const newSrc = fs.readFileSync(`${REPO}/apply/script.js`, 'utf8');

// 修正前の版と比較できる場合は、不具合が再現することも確認する
let before = null;
try {
  const oldSrc = execSync('git show 45a7be8:apply/script.js', { cwd: REPO, encoding: 'utf8', maxBuffer: 1e8 });
  before = await run(oldSrc, '修正前（参考）');
} catch {
  console.log('\n（修正前の版は取得できないため比較をスキップします）');
}

const after = await run(newSrc, '現在の apply/script.js');

// 途中の行を削除したあとのズレを確認（inline onclick は jsdom では動かないため関数を直接呼ぶ）
const btn = after.doc.querySelectorAll('#snsLinksContainer .sns-link-row')[1].querySelector('button');
after.window.removeSnsRow(btn);
const afterRemove = after.collect();
console.log('\n■ 2件目（TikTok）を削除したあと');
afterRemove.forEach(c => console.log(`    - ${c.type}: ${c.url}`));

let ng = 0;
const expect = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) ng++; };
console.log('\n■ 判定');
if (before) {
  expect('修正前は2件目以降が送信対象から漏れる（不具合の再現）',
    before.collected.length === 1 && before.dropped.length === 2);
}
expect('欄が増えすぎない（1クリック＝1欄）', after.rows === 3);
expect('3件すべて送信対象になる', after.collected.length === 3 && after.dropped.length === 0);
expect('SNS種別が正しく判定される', after.collected.map(c => c.type).join(',') === 'Instagram,TikTok,公式LINE');
expect('削除後は残り2件だけになる', afterRemove.length === 2);
expect('削除後もバッジと入力欄の対応がずれない',
  afterRemove[0]?.type === 'Instagram' && afterRemove[1]?.type === '公式LINE');

// 注意書き（管理画面で入れた文字）と「HP、公式LINEなど」の見出し
// 本番の設定が変わってもテストの前提が変わらないよう、必要な項目だけ固定する
const NOTE = '⚠️注意書⚠️\nテスト用の注意書きです。';
const withSns = (standardFields, customQuestions) => ({
  ...config,
  standardFields: { ...config.standardFields, ...standardFields },
  customQuestions,
  formOrder: undefined
});
const FB_IG = [
  { id: 'Facebook',  label: 'Facebook',  type: 'text', required: false },
  { id: 'Instagram', label: 'Instagram', type: 'text', required: false }
];
const sectionOf = doc => doc.querySelector('[data-section="sns"]');

const shown  = await run(newSrc, '注意書きあり', withSns({ snsNote: NOTE, showSnsLinks: true }, FB_IG));
const noteEl = shown.doc.getElementById('snsNote');
const blank  = await run(newSrc, '注意書きなし', withSns({ snsNote: '  ', showSnsLinks: true }, FB_IG));
const noSns  = await run(newSrc, 'SNS欄を出さない設定', withSns({ snsNote: NOTE, showSnsLinks: false }, []));

console.log('\n■ 注意書きと見出し');
expect('注意書きが改行ごと表示される', !noteEl.classList.contains('hidden') && noteEl.textContent === NOTE);
expect('注意書きは「SNSリンク」の見出しのすぐ下（質問より上）',
  noteEl.parentElement === sectionOf(shown.doc) &&
  noteEl.previousElementSibling?.classList.contains('section-title') &&
  noteEl.nextElementSibling?.classList.contains('section-body'));
expect('空白だけなら注意書きを出さない', blank.doc.getElementById('snsNote').classList.contains('hidden'));
expect('リンク欄に「HP、公式LINEなど」の見出しが付く',
  shown.doc.querySelector('#snsSection .input-label')?.textContent === 'HP、公式LINEなど');
expect('見出しの下に何も無ければ、注意書きごと見出しを隠す',
  sectionOf(noSns.doc).classList.contains('hidden'));

console.log(ng === 0 ? '\n✅ すべて成功' : `\n❌ ${ng}件失敗`);
process.exit(ng === 0 ? 0 : 1);
