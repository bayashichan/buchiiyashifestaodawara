/**
 * 確認画面の回帰テスト（実DOM）
 *
 * 検証すること
 *  - 「確認画面へ進む」では送信されず、確認画面が出る（入力が足りなければ出ない）
 *  - 確認画面に「まだ完了していない」ことと、入力内容・料金がフォームの並びどおりに出る
 *  - 「戻って修正する」「修正する」「ブラウザの戻る」で入力画面に戻れる（入力は消えない）
 *  - 「この内容で申し込む」で1回だけ送信され、完了画面に切り替わる
 *  - 送信に失敗したら確認画面のまま送り直せる
 *  - キャンセル待ち・セッション不可のブースは、確認画面でも分かる
 *
 * 実行方法:
 *   npm i --no-save jsdom
 *   node apply/tests/confirm.test.mjs
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

// 公開中の設定が変わってもテストの前提が変わらないよう、質問と並び順はここで決める
const base = JSON.parse(fs.readFileSync(`${REPO}/apply/config.json`, 'utf8'));
delete base.formOrder;
base.customQuestions = [
  { id: 'menu', type: 'textarea', label: '出展メニュー', required: true, maxLength: 100 },
  { id: 'hitokoto', type: 'text', label: 'ひとこと', required: false }
];

let ng = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '  → ' + extra}`);
  if (!cond) ng++;
};
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

// respond … 送信したときにバックエンドが返す内容（関数なら呼ばれるたびに作る）
// status  … ブースの空き状況として返す内容（無ければ「稼働中」だけ返す）
async function boot(cfg = base, { respond = { success: true, totalFee: 8000 }, delay = 0, status = null } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/apply/' });
  const { window } = dom;
  const sent = { posts: [], alerts: [] };
  window.fetch = async (url, opts) => {
    if (String(url).includes('config.json')) return { ok: true, json: async () => cfg };
    if (opts?.method !== 'POST') {
      const body = String(url).includes('action=booth_status') && status ? status : { success: true };
      return { ok: true, json: async () => body };
    }
    sent.posts.push(opts.body);
    if (delay) await tick(delay);
    const body = typeof respond === 'function' ? respond() : respond;
    return { ok: true, json: async () => body };
  };
  window.alert = msg => { sent.alerts.push(String(msg)); };
  window.confirm = () => true;
  window.eval(script);
  await tick(80);
  return { window, doc: window.document, sent };
}

// 必須項目を埋める（写真は「あとから公式LINEで送る」）
function fill({ window, doc }, { exhibitorName = 'サロン花', category = 0, booth = 0 } = {}) {
  const set = (sel, v) => { doc.querySelector(sel).value = v; };
  set('#nameInput', '山田 花子');
  set('[name="furigana"]', 'やまだ はなこ');
  set('[name="phoneNumber"]', '090-1111-2222');
  set('#postalCode', '250-0002');
  set('#addressInput', '神奈川県小田原市1-1');
  set('#emailInput', 'hanako@example.com');
  set('#emailConfirmInput', 'hanako@example.com');
  set('[name="exhibitorName"]', exhibitorName);
  doc.getElementById('menu').value = 'タロット 20分 2,000円';
  window.selectCategory(base.categories[category], doc.querySelectorAll('.category-btn')[category]);
  window.selectBooth(base.booths[booth].id);
  doc.querySelector('input[name="photoPermission"][value="可"]').checked = true;
  doc.querySelector('[name="agreeTerms"]').checked = true;
  doc.getElementById('photoLater').checked = true;
  window.togglePhotoUpload();
}

const isOpen  = doc => !doc.getElementById('confirmScreen').classList.contains('hidden');
const cards   = doc => [...doc.querySelectorAll('#confirmList .confirm-card')];
const rowsOf  = card => [...card.querySelectorAll('.confirm-row')].map(r => ({
  label: r.querySelector('dt').textContent, value: r.querySelector('dd').textContent
}));
const allRows = doc => cards(doc).flatMap(rowsOf);
const valueOf = (doc, label) => allRows(doc).find(r => r.label === label)?.value;

// ---------------------------------------------------------------
console.log('\n[1] 入力画面');
{
  const { doc } = await boot();
  const steps = [...doc.querySelectorAll('main .steps .step')];
  ok('はじめに「入力 → 内容の確認 → 申込完了」の流れが出る',
    steps.map(s => s.textContent.replace(/\d/g, '').trim()).join('>') === '入力>内容の確認>申込完了',
    steps.map(s => s.textContent).join('>'));
  ok('いまは「入力」の段階', steps[0].classList.contains('current'));
  ok('確認画面があることを先に知らせる', doc.querySelector('.steps-note').textContent.includes('この内容で申し込む'));
  const btn = doc.getElementById('submitBtn');
  ok('画面下のボタンは「確認画面へ進む」', btn.textContent.trim() === '確認画面へ進む', btn.textContent);
  ok('画面下のボタンは確認画面をひらく', btn.getAttribute('onclick') === 'openConfirm()', btn.getAttribute('onclick'));
  ok('確認画面のボタンが送信する',
    doc.getElementById('confirmSubmitBtn').getAttribute('onclick') === 'submitForm()');
  ok('確認画面は閉じている', !isOpen(doc));
}

// ---------------------------------------------------------------
console.log('\n[2] 入力が足りないとき');
{
  const { window, doc, sent } = await boot();
  window.openConfirm();
  ok('確認画面は出ない', !isOpen(doc));
  ok('足りない項目を知らせる', sent.alerts.some(a => a.includes('お名前')), sent.alerts.join(' / '));
  ok('送信されない', sent.posts.length === 0);
}

// ---------------------------------------------------------------
console.log('\n[3] 確認画面をひらく');
{
  const ctx = await boot();
  const { window, doc, sent } = ctx;
  fill(ctx, { exhibitorName: '<b>サロン花</b>' });
  doc.querySelector('input[name="partyAttend"][value="出席"]').checked = true;
  window.togglePartyCount();
  doc.querySelector('input[name="isMember"][value="1"]').checked = true;
  window.calculatePrice();
  window.openConfirm();

  ok('確認画面が出る', isOpen(doc), sent.alerts.join(' / '));
  ok('この時点では送信されない', sent.posts.length === 0);
  ok('エラーは出ない', sent.alerts.length === 0, sent.alerts.join(' / '));
  ok('「まだお申込みは完了していません」と出る',
    doc.querySelector('.confirm-alert').textContent.includes('まだお申込みは完了していません'));
  const steps = [...doc.querySelectorAll('#confirmScreen .step')];
  ok('いまは「内容の確認」の段階', steps[1].classList.contains('current') && steps[0].classList.contains('done'));
  ok('送信ボタンは「この内容で申し込む」',
    doc.getElementById('confirmSubmitBtn').textContent.trim() === 'この内容で申し込む');
  ok('案内文はそのボタンを押すよう伝える',
    doc.querySelector('.confirm-alert').textContent.includes('「この内容で申し込む」ボタンを押してください'));
  ok('振込を待つ案内は出ない', doc.getElementById('confirmPriceNote').classList.contains('hidden'));
  ok('うしろの画面はスクロールしない', doc.body.classList.contains('confirm-open'));

  ok('お名前が出る', valueOf(doc, 'お名前') === '山田 花子', valueOf(doc, 'お名前'));
  ok('住所は郵便番号つきで出る', valueOf(doc, 'ご住所') === '〒250-0002\n神奈川県小田原市1-1', valueOf(doc, 'ご住所'));
  ok('メールアドレスが出る', valueOf(doc, 'メールアドレス') === 'hanako@example.com');
  ok('出展ブースが出る', valueOf(doc, '出展ブース') === base.booths[0].name, valueOf(doc, '出展ブース'));
  ok('出展カテゴリが出る', valueOf(doc, '出展カテゴリ') === base.categories[0]);
  ok('自由な質問の答えが出る', valueOf(doc, '出展メニュー') === 'タロット 20分 2,000円');
  ok('答えていない質問は「（未入力）」', valueOf(doc, 'ひとこと') === '（未入力）', valueOf(doc, 'ひとこと'));
  ok('写真をあとで送ることが出る', valueOf(doc, 'プロフィール写真') === 'あとから公式LINEで送る');
  ok('懇親会の出欠が出る', valueOf(doc, '懇親会') === '出席（1名）', valueOf(doc, '懇親会'));
  ok('規約への同意が出る', valueOf(doc, '出展規約') === '同意する');

  ok('入力された記号は文字のまま出る（タグとして扱わない）',
    valueOf(doc, base.standardFields.exhibitorNameLabel) === '<b>サロン花</b>' &&
    !doc.querySelector('#confirmList b'), valueOf(doc, base.standardFields.exhibitorNameLabel));

  // 見出しはフォームに見えている順で、同じ番号
  const formTitles = [...doc.querySelectorAll('#applicationForm > .form-section:not(.hidden) .section-title')]
    .map(el => el.textContent.trim());
  const confirmTitles = cards(doc).map(c => c.querySelector('h3').textContent);
  ok('見出しはフォームと同じ順・同じ番号', confirmTitles.join('|') === formTitles
    .filter(t => confirmTitles.includes(t)).join('|') && confirmTitles[0] === formTitles[0],
    `${confirmTitles.join('|')}  /  ${formTitles.join('|')}`);
  ok('見出しごとに「修正する」がある', cards(doc).every(c => c.querySelector('.confirm-edit')));

  // 料金は画面下の合計と同じ
  const price = [...doc.querySelectorAll('#confirmPrice .confirm-row')].map(r => r.textContent);
  const total = doc.querySelector('#confirmPrice .confirm-total dd').textContent;
  ok('合計が画面下の合計と同じ', total === doc.getElementById('totalPrice').textContent,
    `${total} / ${doc.getElementById('totalPrice').textContent}`);
  ok('会員割引はマイナスで出る', price.some(t => t.includes('-¥2,000')), price.join(' | '));
  ok('懇親会費が内訳に出る', price.some(t => t.includes('懇親会')), price.join(' | '));
  ok('キャンセル待ちの案内は出ない', doc.getElementById('confirmWaitlist').classList.contains('hidden'));
  ok('セッション不可の注意は出ない', doc.getElementById('confirmSessionWarning').classList.contains('hidden'));
}

// ---------------------------------------------------------------
console.log('\n[4] 戻って修正する');
{
  const ctx = await boot();
  const { window, doc, sent } = ctx;
  fill(ctx);
  window.openConfirm();
  ok('ひらいたとき履歴を1つ積む（スマホの戻るで確認画面だけ閉じるため）', window.history.state?.applyConfirm === true);
  window.closeConfirm();
  await tick();
  ok('確認画面が閉じる', !isOpen(doc));
  ok('送信されない', sent.posts.length === 0);
  ok('入力した内容は残っている', doc.getElementById('nameInput').value === '山田 花子');
  ok('うしろの画面がまたスクロールできる', !doc.body.classList.contains('confirm-open'));

  // 直して、もう一度ひらくと新しい内容になる
  doc.getElementById('nameInput').value = '山田 花代';
  window.openConfirm();
  ok('もう一度ひらくと直した内容が出る', isOpen(doc) && valueOf(doc, 'お名前') === '山田 花代', valueOf(doc, 'お名前'));

  // 見出しの「修正する」でも閉じる
  cards(doc)[0].querySelector('.confirm-edit').click();
  await tick();
  ok('「修正する」でも入力画面に戻る', !isOpen(doc));
}

// ---------------------------------------------------------------
console.log('\n[5] ブラウザ（スマホ）の「戻る」');
{
  const ctx = await boot();
  const { window, doc, sent } = ctx;
  fill(ctx);
  window.openConfirm();
  window.dispatchEvent(new window.PopStateEvent('popstate', { state: null }));
  ok('確認画面だけが閉じる', !isOpen(doc));
  ok('送信されない', sent.posts.length === 0);
  ok('入力した内容は残っている', doc.getElementById('nameInput').value === '山田 花子');
}

// ---------------------------------------------------------------
console.log('\n[6] この内容で申し込む');
{
  const ctx = await boot(base, { delay: 30 });
  const { window, doc, sent } = ctx;
  fill(ctx);
  window.openConfirm();
  const first = window.submitForm();
  ok('送信中は申込ボタンが押せない', doc.getElementById('confirmSubmitBtn').disabled);
  ok('送信中は戻れない', doc.getElementById('confirmBackBtn').disabled);
  await window.submitForm();   // 二度押し
  await first;

  ok('1回だけ送信される', sent.posts.length === 1, `${sent.posts.length}回`);
  ok('入力内容が送られる', sent.posts[0]?.get('name') === '山田 花子');
  ok('完了画面が出る', !doc.getElementById('completeModal').classList.contains('hidden'));
  ok('確認画面は閉じる', !isOpen(doc));
  const steps = [...doc.querySelectorAll('#completeModal .step')];
  ok('完了画面は「申込完了」の段階', steps[2].classList.contains('current') &&
    steps[0].classList.contains('done') && steps[1].classList.contains('done'));
  ok('エラーは出ない', sent.alerts.length === 0, sent.alerts.join(' / '));
}

// ---------------------------------------------------------------
console.log('\n[7] 送信に失敗したとき');
{
  const ctx = await boot(base, { respond: { success: false, error: '受付シートに書き込めませんでした' } });
  const { window, doc, sent } = ctx;
  fill(ctx);
  window.openConfirm();
  await window.submitForm();
  await tick();
  ok('まだ完了していないと知らせる', sent.alerts.some(a => a.includes('まだ完了していません')), sent.alerts.join(' / '));
  ok('確認画面のまま（もう一度押せば送り直せる）', isOpen(doc));
  ok('申込ボタンがまた押せる', !doc.getElementById('confirmSubmitBtn').disabled);
  ok('完了画面は出ない', doc.getElementById('completeModal').classList.contains('hidden'));
}

// ---------------------------------------------------------------
console.log('\n[8] キャンセル待ちのブース');
{
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.booths[0].seats = { enabled: true, total: 1, show: true, showWhenAtMost: 0 };
  const ctx = await boot(cfg, {
    status: { success: true, waitlist: true, booths: { [base.booths[0].id]: { full: true, remaining: 0 } } }
  });
  const { window, doc } = ctx;
  fill(ctx);
  window.openConfirm();
  ok('キャンセル待ちになることが出る', !doc.getElementById('confirmWaitlist').classList.contains('hidden'));
  ok('ブースの欄にも「キャンセル待ち」と出る', valueOf(doc, '出展ブース') === `${base.booths[0].name}（キャンセル待ち）`,
    valueOf(doc, '出展ブース'));
  ok('申込ボタンが「キャンセル待ちで申し込む」になる',
    doc.getElementById('confirmSubmitBtn').textContent.trim() === 'キャンセル待ちで申し込む');
  ok('案内文もボタンと同じ名前で呼ぶ',
    doc.querySelector('.confirm-alert').textContent.includes('「キャンセル待ちで申し込む」'),
    doc.querySelector('.confirm-alert').textContent);
  ok('振込を待ってもらう案内が料金の下に出る',
    !doc.getElementById('confirmPriceNote').classList.contains('hidden'));
}

// ---------------------------------------------------------------
console.log('\n[9] セッションができないブース');
{
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.booths[0].prohibitSession = true;
  const ctx = await boot(cfg);
  fill(ctx, { category: 0 });   // 占い・スピリチュアル
  ctx.window.openConfirm();
  ok('確認画面に注意が出る', !ctx.doc.getElementById('confirmSessionWarning').classList.contains('hidden'));
  ok('確認のダイアログは出さない（確認画面で伝える）', ctx.sent.alerts.length === 0);
}

// ---------------------------------------------------------------
console.log('\n[10] 写真を選んだとき');
{
  const ctx = await boot();
  const { window, doc } = ctx;
  window.convertFileToBase64 = async () => ({ base64: 'AAAA', mimeType: 'image/jpeg', name: 'a.jpg' });
  fill(ctx);
  doc.getElementById('photoLater').checked = false;
  window.togglePhotoUpload();
  const input = doc.getElementById('profileImage');
  Object.defineProperty(input, 'files', { value: [{ name: 'p.jpg', size: 1024 }], configurable: true });
  input.dispatchEvent(new window.Event('change'));
  await tick();
  window.openConfirm();
  const img = doc.querySelector('#confirmList .confirm-photo');
  ok('選んだ写真が小さく出る', img?.getAttribute('src') === 'data:image/jpeg;base64,AAAA', img?.getAttribute('src'));
}

// ---------------------------------------------------------------
console.log('\n[11] 並び順を変えたとき');
{
  const cfg = JSON.parse(JSON.stringify(base));
  // 管理画面は、いつも全部の項目の並びを保存する
  cfg.formOrder = [
    'section:basic', 'q:hitokoto', 'name', 'furigana', 'email', 'phone', 'address',
    'section:exhibit', 'exhibitorName', 'category', 'booth', 'q:menu', 'photo', 'photoPermission',
    'section:sns', 'sns', 'section:options', 'options', 'section:party', 'party',
    'section:stampRally', 'stampRally', 'section:member', 'member', 'section:other', 'notes', 'terms'
  ];
  const ctx = await boot(cfg);
  fill(ctx);
  ctx.doc.getElementById('hitokoto').value = 'よろしくお願いします';
  ctx.window.openConfirm();
  const first = rowsOf(cards(ctx.doc)[0]).map(r => r.label);
  ok('確認画面もフォームと同じ並びになる',
    first.join('|') === 'ひとこと|お名前|ふりがな|メールアドレス|電話番号|ご住所', first.join('|'));
  const last = rowsOf(cards(ctx.doc).at(-1)).map(r => r.label);
  ok('最後の見出しの中も同じ並び', last.join('|') === '質問・備考|出展規約', last.join('|'));
}

console.log(ng === 0 ? '\n✅ すべて成功' : `\n❌ ${ng}件失敗`);
process.exit(ng === 0 ? 0 : 1);
