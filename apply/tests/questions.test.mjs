/**
 * 自由な質問（説明・答え方）の回帰テスト（実DOM）
 *
 * 検証すること
 *  - 説明が質問文のすぐ下に、書いたとおり（改行もそのまま）出る
 *  - 答え方ごとに入力欄が出る（長い文章・短い文章・数字・1つ選ぶ・いくつでも選ぶ・プルダウン）
 *  - 必ず答えてもらう質問の入力チェック、送られる答え
 *  - 前回の内容を呼び出したとき、選択肢の答えも入る
 *
 * 実行方法:
 *   npm i --no-save jsdom
 *   node apply/tests/questions.test.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
delete config.formOrder;

let ng = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '  → ' + extra}`);
  if (!cond) ng++;
};

async function boot(questions) {
  const cfg = { ...JSON.parse(JSON.stringify(config)), customQuestions: questions };
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/apply/' });
  const { window } = dom, doc = window.document;
  const sent = {};
  window.fetch = async (url, opts) => {
    if (String(url).includes('config.json')) return { ok: true, json: async () => cfg };
    sent.body = opts?.body;
    return { ok: true, json: async () => ({ success: true, totalFee: 8000 }) };
  };
  window.alert = msg => { sent.alert = msg; };
  window.confirm = () => true;
  window.eval(script);
  await new Promise(r => setTimeout(r, 80));

  // 自由な質問以外の必須項目を埋めておく
  const set = (sel, v) => { doc.querySelector(sel).value = v; };
  set('#nameInput', '山田 花子');
  set('[name="furigana"]', 'やまだ はなこ');
  set('[name="phoneNumber"]', '090-1111-2222');
  set('#postalCode', '250-0002');
  set('#addressInput', '神奈川県小田原市1-1');
  set('#emailInput', 'hanako@example.com');
  set('#emailConfirmInput', 'hanako@example.com');
  set('[name="exhibitorName"]', 'サロン花');
  window.selectCategory(config.categories[0], doc.querySelector('.category-btn'));
  window.selectBooth(config.booths[0].id);
  doc.querySelector('input[name="photoPermission"][value="可"]').checked = true;
  doc.querySelector('[name="agreeTerms"]').checked = true;
  doc.getElementById('photoLater').checked = true;
  window.togglePhotoUpload();
  return { window, doc, sent };
}

const block = (doc, id) => [...doc.querySelectorAll('[data-block]')].find(el => el.dataset.block === `q:${id}`);
const pick  = (doc, id, value) => {
  const input = [...block(doc, id).querySelectorAll('input')].find(el => el.value === value);
  input.checked = true;
};

// ============================================================
console.log('\n[1] 説明');
{
  const { doc } = await boot([
    { id: '出展メニュー名', label: '出展メニュー名', type: 'textarea', required: true, maxLength: 100, showCounter: true,
      description: '1行目の説明です\n2行目は <b>太字にならない</b>' },
    { id: '自己紹介', label: '自己紹介', type: 'textarea', required: true }
  ]);
  const b = block(doc, '出展メニュー名');
  const desc = b.querySelector('.question-desc');
  ok('説明が出る', !!desc);
  ok('質問文のすぐ下に出る', desc?.previousElementSibling?.classList.contains('input-label'));
  ok('入力欄より上に出る', desc?.nextElementSibling === doc.getElementById('出展メニュー名'));
  ok('改行もそのまま入る', desc?.textContent === '1行目の説明です\n2行目は <b>太字にならない</b>', JSON.stringify(desc?.textContent));
  ok('書いた記号はそのまま文字で出る（HTMLとして扱わない）', !desc?.querySelector('b'));
  ok('読み上げのため入力欄と説明がつながっている',
    doc.getElementById('出展メニュー名').getAttribute('aria-describedby') === desc?.id);
  ok('説明が無い質問には何も出ない', !block(doc, '自己紹介').querySelector('.question-desc'));
  ok('文字数カウンターはこれまでどおり', b.querySelector('.char-counter')?.textContent === '0/100',
    b.querySelector('.char-counter')?.textContent);
}

// ============================================================
console.log('\n[2] 答え方ごとの入力欄');
const QUESTIONS = [
  { id: '当日の人数', label: '当日の人数', type: 'number', required: true, placeholder: '例：2' },
  { id: '希望の時間帯', label: '希望の時間帯', type: 'radio', required: true,
    options: ['午前', '午後', '終日'], description: 'いちばん近いものを選んでください' },
  { id: '持ってくるもの', label: '持ってくるもの', type: 'checkbox', required: true, options: ['机', '椅子', '電源タップ'] },
  { id: '駐車場', label: '駐車場', type: 'select', required: true, options: ['使う', '使わない'] },
  { id: 'ひとこと', label: "ひとこと <任意> & 'メモ'", type: 'text', required: false, options: ['使われない'] }
];
{
  const { window, doc, sent } = await boot(QUESTIONS);

  ok('数字は数字の入力欄', doc.getElementById('当日の人数')?.type === 'number');
  const radios = [...block(doc, '希望の時間帯').querySelectorAll('input')];
  ok('1つ選ぶ質問は、選択肢がならぶ',
    radios.length === 3 && radios.every(r => r.type === 'radio') &&
    radios.map(r => r.value).join(',') === '午前,午後,終日', radios.map(r => r.value).join(','));
  ok('選択肢の文字も押せる（行ごと押せる）', radios[0].closest('label.q-choice')?.textContent === '午前');
  ok('選択肢のまとまりに質問文が結びついている',
    doc.getElementById('希望の時間帯').getAttribute('role') === 'radiogroup' &&
    doc.getElementById(doc.getElementById('希望の時間帯').getAttribute('aria-labelledby'))?.textContent.startsWith('希望の時間帯'));
  ok('1つ選ぶ質問にも説明が出る', block(doc, '希望の時間帯').querySelector('.question-desc')?.textContent === 'いちばん近いものを選んでください');
  const checks = [...block(doc, '持ってくるもの').querySelectorAll('input')];
  ok('いくつでも選ぶ質問は、チェックボックスがならぶ', checks.length === 3 && checks.every(c => c.type === 'checkbox'));
  const select = doc.getElementById('駐車場');
  ok('プルダウンは選択肢＋「選択してください」',
    select?.tagName === 'SELECT' && [...select.options].map(o => o.textContent).join(',') === '選択してください,使う,使わない');
  ok('短い文章で、使わない選択肢があっても入力欄になる', doc.getElementById('ひとこと')?.type === 'text');
  ok('質問文の記号もそのまま文字で出る',
    block(doc, 'ひとこと').querySelector('.input-label').textContent === "ひとこと <任意> & 'メモ'",
    block(doc, 'ひとこと').querySelector('.input-label').textContent);

  console.log('\n[3] 入力チェック');
  const errors = window.validateForm();
  ok('数字が空なら入力を案内', errors.includes('当日の人数を入力してください'), errors.join(' / '));
  ok('1つ選ぶ質問が未選択なら選択を案内', errors.includes('希望の時間帯を選択してください'));
  ok('いくつでも選ぶ質問が未選択なら選択を案内', errors.includes('持ってくるものを選択してください'));
  ok('プルダウンが未選択なら選択を案内', errors.includes('駐車場を選択してください'));
  ok('任意の質問は空でもよい', !errors.some(e => e.includes('ひとこと')));

  doc.getElementById('当日の人数').value = '2';
  pick(doc, '希望の時間帯', '午後');
  pick(doc, '持ってくるもの', '机');
  pick(doc, '持ってくるもの', '電源タップ');
  doc.getElementById('駐車場').value = '使う';
  ok('答えると入力チェックを通る', window.validateForm().length === 0, window.validateForm().join(' / '));

  console.log('\n[4] 送られる答え');
  await window.submitForm();
  const answers = JSON.parse(sent.body?.get('customAnswers') || '{}');
  ok('送信される', !sent.alert, sent.alert);
  ok('数字の答え', answers['当日の人数'] === '2');
  ok('1つ選んだ答え', answers['希望の時間帯'] === '午後');
  ok('いくつでも選んだ答えは「、」でつながる', answers['持ってくるもの'] === '机、電源タップ', answers['持ってくるもの']);
  ok('プルダウンの答え', answers['駐車場'] === '使う');
  ok('任意で空の答えは空のまま', answers['ひとこと'] === '');
}

// ============================================================
console.log('\n[5] 前回の内容を呼び出したとき');
{
  const { window, doc } = await boot([
    { id: '出展メニュー名', label: '出展メニュー名', type: 'radio', required: true, options: ['占い', '整体', '物販'] },
    { id: '自己紹介', label: '自己紹介', type: 'checkbox', required: false, options: ['初出展', '常連', '地元'] }
  ]);
  window.fillFormWithData({ menu: '整体', intro: '常連、地元' });
  const checked = id => [...block(doc, id).querySelectorAll('input:checked')].map(el => el.value).join(',');
  ok('1つ選ぶ質問に前回の答えが入る', checked('出展メニュー名') === '整体', checked('出展メニュー名'));
  ok('いくつでも選ぶ質問に前回の答えが入る', checked('自己紹介') === '常連,地元', checked('自己紹介'));
}

console.log(ng === 0 ? '\n✅ すべて成功' : `\n❌ ${ng}件失敗`);
process.exit(ng === 0 ? 0 : 1);
