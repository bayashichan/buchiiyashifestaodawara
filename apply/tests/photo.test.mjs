/**
 * 写真が送れない場合でも申込を完了できることの回帰テスト（実DOM）
 *
 * 検証すること
 *  - 「あとからメールで送る」を選べば写真なしで申込できる
 *  - 画像の変換に失敗しても申込が止まらない
 *  - 完了画面に、写真をメールで送る案内が出る
 *
 * 実行方法:
 *   npm i --no-save jsdom
 *   node apply/tests/photo.test.mjs
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
const config = JSON.parse(fs.readFileSync(`${REPO}/apply/config.json`, 'utf8'));

let failures = 0;
const expect = (label, cond) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};

/**
 * フォームを起動して、必須項目を埋めた状態を作る
 * failImageConversion=true のとき、画像変換が必ず失敗するようにする
 */
async function boot({ attachFile = false, sendLater = false, failImageConversion = false } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/apply/' });
  const { window } = dom, doc = window.document;

  const sent = {};
  window.alert = msg => { sent.alert = msg; };
  window.confirm = () => true;

  window.fetch = async (url, opts) => {
    if (String(url).includes('config.json')) {
      return { ok: true, json: async () => config };
    }
    // 送信先。送られた内容を記録する
    sent.body = opts?.body;
    return { ok: true, json: async () => ({ success: true, totalFee: 8000 }) };
  };

  window.eval(fs.readFileSync(`${REPO}/apply/script.js`, 'utf8'));
  await new Promise(r => setTimeout(r, 80));

  // 画像変換の成否を差し替える
  window.convertFileToBase64 = async () => {
    if (failImageConversion) throw new Error('画像圧縮処理に失敗');
    return { base64: 'AAAA', mimeType: 'image/jpeg', name: 'a.jpg' };
  };

  // 必須項目を埋める
  const set = (sel, v) => { const el = doc.querySelector(sel); if (el) el.value = v; };
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
  // 質問IDは日本語のためセレクタではなく getElementById で取得する
  (config.customQuestions || []).forEach(q => {
    const el = doc.getElementById(q.id);
    if (el) el.value = 'テスト回答';
  });
  doc.querySelector('input[name="photoPermission"][value="可"]').checked = true;
  doc.querySelector('[name="agreeTerms"]').checked = true;

  if (sendLater) {
    doc.getElementById('photoLater').checked = true;
    window.togglePhotoUpload();
  }

  if (attachFile) {
    // ファイルが選ばれている状態を模擬する
    Object.defineProperty(doc.getElementById('profileImage'), 'files', {
      value: [{ name: 'p.jpg', size: 1000 }], configurable: true
    });
  }

  return { window, doc, sent };
}

const fieldOf = (body, key) => (body && typeof body.get === 'function') ? body.get(key) : null;

// ---------------------------------------------------------------
console.log('\n[1] 写真なし（あとからメールで送る）');
{
  const { window, doc, sent } = await boot({ sendLater: true });
  expect('バリデーションを通過する', window.validateForm().length === 0);

  await window.submitForm();
  expect('送信され、完了画面が出る', !doc.getElementById('completeModal').classList.contains('hidden'));
  expect('エラーが出ていない', !sent.alert);
  expect('写真未受領として送信される', fieldOf(sent.body, 'photoPending') === '1');
  expect('完了画面に写真の案内が出る', !doc.getElementById('photoPendingNotice').classList.contains('hidden'));

  const link = doc.getElementById('photoMailLink').getAttribute('href');
  expect('メール送信リンクが事務局あてになっている', link.startsWith(`mailto:${config.email.replyToEmail}`));
  expect('件名に名前と出展名が入っている', decodeURIComponent(link).includes('山田 花子（サロン花）'));
  expect('送り先アドレスが表示される', doc.getElementById('photoMailAddress').textContent.includes(config.email.replyToEmail));
}

// ---------------------------------------------------------------
console.log('\n[2] 画像を選んだが変換に失敗した場合');
{
  const { window, doc, sent } = await boot({ attachFile: true, failImageConversion: true });
  await window.submitForm();

  expect('申込は完了する（止まらない）', !doc.getElementById('completeModal').classList.contains('hidden'));
  expect('エラーで止まっていない', !sent.alert);
  expect('画像データは送られていない', !fieldOf(sent.body, 'profileImageBase64'));
  expect('写真未受領として送信される', fieldOf(sent.body, 'photoPending') === '1');
  expect('完了画面に写真の案内が出る', !doc.getElementById('photoPendingNotice').classList.contains('hidden'));
}

// ---------------------------------------------------------------
console.log('\n[3] 写真が正常に送れた場合');
{
  const { window, doc, sent } = await boot({ attachFile: true });
  await window.submitForm();

  expect('申込が完了する', !doc.getElementById('completeModal').classList.contains('hidden'));
  expect('画像データが送られる', fieldOf(sent.body, 'profileImageBase64') === 'AAAA');
  expect('写真ありとして送信される', fieldOf(sent.body, 'photoPending') === '0');
  expect('写真の案内は出ない', doc.getElementById('photoPendingNotice').classList.contains('hidden'));
}

// ---------------------------------------------------------------
console.log('\n[4] 写真を付けず、チェックも入れない場合');
{
  const { window } = await boot();
  const errors = window.validateForm();
  expect('写真が必須として案内される', errors.some(e => e.includes('プロフィール写真')));
  expect('逃げ道が案内文に含まれる', errors.some(e => e.includes('あとからメールで送る')));
}

console.log(failures === 0 ? '\n✅ すべて成功' : `\n❌ ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
