/**
 * 管理画面の回帰テスト（実DOM）
 *
 * 実行方法:
 *   npm i --no-save jsdom
 *   node admin/tests/config-editor.test.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'node:crypto';

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('jsdom が見つからないためスキップします（npm i --no-save jsdom）');
  process.exit(0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html   = fs.readFileSync(`${REPO}/admin/config-editor.html`, 'utf8');

// 公開中の設定をもとに、「第1回を受付中」の状態をテスト用に固定する
// （本番の設定が次の回へ進んでも、テストの前提が変わらないように）
const config = JSON.parse(fs.readFileSync(`${REPO}/apply/config.json`, 'utf8'));
config.event.name      = '第1回ぶち癒しフェスタin小田原';
config.event.edition   = '第1回';
config.event.editionId = '第1回';
config.spreadsheetEdition = '第1回';
config.booths.forEach(b => { delete b.seats; b.soldOut = false; });

const atobUtf8 = b64 => Buffer.from(b64, 'base64').toString('utf8');

let ng = 0;
const ok = (label, cond, extra='') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '  → ' + extra}`);
  if (!cond) ng++;
};

// gas … GAS への問い合わせに返す内容（URL を受け取って JSON を返す関数。throw で通信失敗）
async function boot({ setup = false, unlocked = true, registered = true, cfg = config, gas = null, gasToken = '' } = {}) {
  const url = 'https://example.test/repo/admin/config-editor.html' + (setup ? '?setup' : '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url, pretendToBeVisual: true });
  const { window } = dom;

  Object.defineProperty(window, "crypto", { value: crypto.webcrypto, configurable: true });
  window.confirm = () => true;

  const saved = [];
  const gasCalls = [];
  window.fetch = async (input, init) => {
    const u = String(input);
    // GitHub API のURLにも apply/config.json が含まれるため、先に判定する
    if (u.includes('api.github.com')) {
      if (init?.method === 'PUT') {
        saved.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ content: { sha: 'def456' } }) };
      }
      return { ok: true, json: async () => ({ sha: 'abc123' }) };
    }
    if (u.includes('apply/config.json')) {
      // 保存したものはすぐ公開されたことにする
      const latest = saved.length ? atobUtf8(saved.at(-1).content) : JSON.stringify(cfg);
      return { ok: true, json: async () => JSON.parse(latest) };
    }
    if (u.includes('script.google.com')) {
      gasCalls.push(u);
      const body = gas ? await gas(new URL(u)) : { success: true };
      return { ok: true, json: async () => body };
    }
    if (u.includes('admin/unlock.json')) {
      if (!registered) return { ok: false, json: async () => ({}) };
      return {
        ok: true,
        headers: { get: name => name === 'last-modified' ? 'Thu, 20 Aug 2026 15:24:00 GMT' : null },
        json: async () => ({ v: 1 })
      };
    }
    return { ok: false, json: async () => ({}) };
  };

  if (unlocked) {
    window.localStorage.setItem('buchi_admin_conn',
      JSON.stringify({ owner: 'bayashichan', repo: 'buchiiyashifestaodawara', token: 'x', gasToken }));
  }

  const scriptSrc = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  window.eval(scriptSrc);
  window.TIMING.publishPollMs = 5;   // 反映待ちはテストでは待たない
  await new Promise(r => setTimeout(r, 120));
  return { window, doc: window.document, saved, gasCalls };
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const lastSaved = saved => JSON.parse(atobUtf8(saved.at(-1).content));

// ============================================================
console.log('\n[1] 起動と読み込み');
const { window, doc, saved } = await boot();

ok('合い言葉が登録済みならロック画面を出さない', doc.getElementById('lockScreen').classList.contains('hidden'));
ok('本体が表示される', !doc.getElementById('app').classList.contains('hidden'));
ok('作成者用は通常URLでは隠れている', doc.getElementById('devCard').classList.contains('hidden'));
ok('イベント名が入る', doc.getElementById('f-eventName').value === config.event.name,
   doc.getElementById('f-eventName').value);
ok('開催回が入る', doc.getElementById('f-edition').value === '第1回', doc.getElementById('f-edition').value);
ok('受付シートがURL形式で表示される',
   doc.getElementById('f-sheetUrl').value === `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`,
   doc.getElementById('f-sheetUrl').value);
ok('ブースが件数分ならぶ', doc.querySelectorAll('#boothList .item').length === config.booths.length);
ok('質問が件数分ならぶ', doc.querySelectorAll('#questionList .item').length === config.customQuestions.length);
ok('ジャンルが件数分ならぶ', doc.querySelectorAll('#tagList .tag').length === config.categories.length);
ok('起動直後は保存ボタンが押せない', doc.getElementById('saveBtn').disabled);

console.log('\n[2] 色のプレビュー');
const cp = doc.getElementById('c-primary');
cp.value = '#123456';
cp.dispatchEvent(new window.Event('input'));
ok('メインの色がプレビューに反映される',
   doc.getElementById('pvSection').style.color.replace(/\s/g,'') === 'rgb(18,52,86)',
   doc.getElementById('pvSection').style.color);
ok('ボタンがグラデーションになる',
   /linear-gradient/.test(doc.getElementById('pvBtn').style.background) &&
   /18,\s*52,\s*86/.test(doc.getElementById('pvBtn').style.background),
   doc.getElementById('pvBtn').style.background);
ok('見出し帯に色がつく', doc.getElementById('pvHead').style.background !== '');
ok('色を変えると保存ボタンが押せる', !doc.getElementById('saveBtn').disabled);

console.log('\n[3] 編集して保存');
doc.getElementById('f-eventName').value = '第2回ぶち癒しフェスタin小田原';
doc.getElementById('f-edition').value = '第2回';
doc.getElementById('f-edition').dispatchEvent(new window.Event('input'));
ok('開催回を変えると注意が出る', !doc.getElementById('editionWarn').hidden);

// ブース名を変更（IDが追随するか）
const boothName = doc.querySelector('#boothList .item input[type=text]');
boothName.value = '内側テーブル';
boothName.dispatchEvent(new window.Event('input'));

// 貼り付けURLからIDを取り出せるか
doc.getElementById('f-dbUrl').value =
  'https://docs.google.com/spreadsheets/d/1QjOHkZRXZOJF7e6pslNPO2S_rnnHXaUxhY_LJrH9D6M/edit?gid=0#gid=0';

const collectResult = window.collect();
ok('入力内容にエラーが無い', collectResult === null, String(collectResult));
doc.getElementById('saveBtn').dispatchEvent(new window.Event('click'));
await new Promise(r => setTimeout(r, 200));

ok('保存が1回だけ実行される', saved.length === 1, `${saved.length}回`);
const body = saved[0] ? JSON.parse(Buffer.from(saved[0].content, 'base64').toString('utf8')) : null;
ok('保存内容がJSONとして正しい', !!body);
ok('イベント名が反映される', body?.event.name === '第2回ぶち癒しフェスタin小田原');
ok('開催回と記録用キーが一致する', body?.event.edition === '第2回' && body?.event.editionId === '第2回',
   JSON.stringify(body?.event));
ok('ブース名の変更にIDが追随する', body?.booths[0].id === '内側テーブル' && body?.booths[0].name === '内側テーブル',
   JSON.stringify(body?.booths[0]));
ok('質問IDが質問文と一致する', body?.customQuestions.every(q => q.id === q.label));
ok('貼ったURLからシートIDだけを取り出す',
   body?.databaseSpreadsheetId === '1QjOHkZRXZOJF7e6pslNPO2S_rnnHXaUxhY_LJrH9D6M', body?.databaseSpreadsheetId);
ok('画面に無い項目も消えずに残る',
   body?.terms === config.terms && body?.gasUrl === config.gasUrl && body?.features.liffId === config.features.liffId);
ok('持ち込み物品の設定がブースごとに残る',
   body?.booths[2].askEquipment === true && body?.features.bodyEquipment === true,
   JSON.stringify(body?.booths[2]));
ok('保存後は保存ボタンが再び押せなくなる', doc.getElementById('saveBtn').disabled);

console.log('\n[4] 合い言葉');
const locked = await boot({ unlocked: false });
ok('未登録の端末ではロック画面が出る', !locked.doc.getElementById('lockScreen').classList.contains('hidden'));
ok('本体は隠れている', locked.doc.getElementById('app').classList.contains('hidden'));

const setupMode = await boot({ setup: true });
ok('?setup では作成者用が出る', !setupMode.doc.getElementById('devCard').classList.contains('hidden'));

console.log('\n[5] 暗号化の往復');
{
  const w = setupMode.window;
  const blob = await w.encryptJson({ owner: 'o', repo: 'r', token: 'secret-token' }, 'ながい合い言葉です');
  const back = await w.decryptJson(blob, 'ながい合い言葉です');
  ok('正しい合い言葉なら復号できる', back.token === 'secret-token');
  let failed = false;
  try { await w.decryptJson(blob, 'ちがう合い言葉です'); } catch { failed = true; }
  ok('違う合い言葉では復号できない', failed);
  ok('保存物に生のトークンが含まれない', !JSON.stringify(blob).includes('secret-token'));
}

console.log('\n[6] メールの差し込みボタン');
{
  const bodyEl = doc.getElementById('f-body');
  window.textToRich(bodyEl, '');
  const chip = [...doc.querySelectorAll('#chipsBody .chip')].find(b => b.textContent.includes('お名前'));
  chip.dispatchEvent(new window.Event('click'));
  ok('ボタンで差し込み文字が入る', window.richToText(bodyEl) === '{{name}}', window.richToText(bodyEl));
  const subjectChips = [...doc.querySelectorAll('#chipsSubject .chip')].map(b => b.textContent);
  ok('件名には長い項目を出さない', !subjectChips.some(t => t.includes('料金の内訳')));
  ok('差し込みボタンが日本語表示', subjectChips.every(t => !/\{\{/.test(t)), subjectChips.join(','));
}

console.log('\n[7] 差し込みボタンの追加分とフォルダの説明');
{
  const labels = [...doc.querySelectorAll('#chipsBody .chip')].map(b => b.textContent);
  ok('本文に「＋写真のお願い」がある', labels.includes('＋ 写真のお願い'), labels.join(','));
  ok('質問名のボタンが並ぶ（出展メニュー名）', labels.includes('＋ 出展メニュー名'), labels.join(','));
  ok('質問名のボタンが並ぶ（自己紹介）', labels.includes('＋ 自己紹介'));
  ok('すべて「＋ 」で始まる', labels.every(t => t.startsWith('＋ ')));

  const subjectChips = [...doc.querySelectorAll('#chipsSubject .chip')].map(b => b.textContent);
  ok('件名には写真のお願いを出さない', !subjectChips.includes('＋ 写真のお願い'));

  // カーソル位置に差し込まれる
  const body = doc.getElementById('f-body');
  window.textToRich(body, 'あいうえお');
  const r = doc.createRange();
  r.setStart(body.firstChild, 2);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(r);

  [...doc.querySelectorAll('#chipsBody .chip')]
    .find(b => b.textContent === '＋ 写真のお願い')
    .dispatchEvent(new window.Event('click'));
  ok('カーソル位置に差し込まれる（末尾ではない）',
     window.richToText(body) === 'あい{{photoNotice}}うえお', window.richToText(body));

  // フォルダの説明
  const tree = doc.querySelector('.folder-tree').textContent;
  ok('親フォルダであることを図で示す', tree.includes('ここに設定するフォルダ'));
  ok('自動で作られることを図で示す', tree.includes('自動で作られます'));
  ok('図に開催回が入る', doc.getElementById('folderTreeEdition').textContent === '第1回');

  doc.getElementById('f-edition').value = '第3回';
  window.updatePreview();
  ok('開催回を変えると図も追従する', doc.getElementById('folderTreeEdition').textContent === '第3回');

  const hint = doc.querySelector('#f-driveUrl').parentElement.querySelector('.hint').textContent;
  ok('いちばん外側のフォルダだと明記', hint.includes('いちばん外側のフォルダ'));
  ok('毎回そのままでよいと明記', hint.includes('毎回そのままにしてください'));

  // 運用する人が保存先を設定しなくてよいことが、カードの先頭に書いてある
  const storeCard = doc.querySelector('#f-driveUrl').closest('.card');
  const storeNote = storeCard.querySelector('.note').textContent;
  ok('保存先は設定ずみだと明記', storeNote.includes('設定ずみ'));
  ok('受付シートは自動で作られると明記', storeNote.includes('自動作成'));
  ok('データベースも変えなくてよいと明記', storeNote.includes('出展者データベース'));
  ok('カードの見出しでも触らなくてよいと分かる',
    storeCard.querySelector('summary').textContent.includes('さわらなくて大丈夫'));
}

// ============================================================
console.log('\n[7-2] 合い言葉が無いまま編集したとき');
{
  // 作成者用URL（?setup）は合い言葉なしでも開けるが、保存はできない
  const { window: w, doc: d } = await boot({ setup: true, unlocked: false });
  const btn = d.getElementById('saveBtn');
  ok('起動時に保存できない理由が出る', d.getElementById('saveStatus').textContent.includes('合い言葉'));

  const rep = d.getElementById('f-repeater');
  rep.checked = !rep.checked;
  rep.dispatchEvent(new w.Event('change', { bubbles: true }));

  ok('編集しても保存ボタンは押せないまま', btn.disabled);
  ok('編集したあとも理由が消えない', d.getElementById('saveStatus').textContent.includes('合い言葉'),
     d.getElementById('saveStatus').textContent);
  ok('ボタンにも理由が出る', btn.title.includes('合い言葉'), btn.title);
}

// ============================================================
console.log('\n[7-3] 合い言葉があれば切り替えで保存できる');
{
  const { window: w, doc: d } = await boot();
  const rep = d.getElementById('f-repeater');
  rep.checked = !rep.checked;
  rep.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('リピーター設定の切り替えで保存ボタンが押せる', !d.getElementById('saveBtn').disabled);
}

console.log('\n[8] 本文のタグ表示');
{
  const body = doc.getElementById('f-body');

  // 保存されている文章 → 画面のタグ表示
  window.textToRich(body, 'こんにちは {{name}} さん\n{{eventName}} です');
  const tags = [...body.querySelectorAll('.var')];
  ok('差し込み部分がタグになる', tags.length === 2, String(tags.length));
  ok('タグは日本語で表示される', tags[0].textContent === 'お名前', tags[0].textContent);
  ok('イベント名のタグ', tags[1].textContent === 'イベント名', tags[1].textContent);
  ok('タグは編集できない', tags[0].getAttribute('contenteditable') === 'false');
  ok('画面に中カッコが出ない', !body.textContent.includes('{{'), body.textContent);

  // 画面 → 保存する文章（元に戻る）
  ok('元の文章に戻せる',
     window.richToText(body) === 'こんにちは {{name}} さん\n{{eventName}} です',
     JSON.stringify(window.richToText(body)));

  // 質問名のタグも往復できる
  window.textToRich(body, '内容: {{出展メニュー名}}');
  ok('質問名もタグになる', body.querySelector('.var')?.textContent === '出展メニュー名');
  ok('質問名のタグも元に戻る', window.richToText(body) === '内容: {{出展メニュー名}}');

  // 差し込んでも表示位置が動かない
  window.textToRich(body, 'あ\n'.repeat(200));
  body.scrollTop = 500;
  const before = body.scrollTop;
  [...doc.querySelectorAll('#chipsBody .chip')]
    .find(b => b.textContent === '＋ お名前')
    .dispatchEvent(new window.Event('click'));
  ok('差し込んでも末尾へスクロールしない', body.scrollTop === before,
     `${before} → ${body.scrollTop}`);

  // 見えない補助文字が保存内容に混ざらない
  ok('保存内容に余計な文字が混ざらない', !window.richToText(body).includes('\u200b'));

  // 保存したときに本文が正しく入る
  window.textToRich(body, '{{name}} 様\nありがとうございます');
  window.markDirty();
  ok('保存用の文章として取り出せる',
     window.val('f-body') === '{{name}} 様\nありがとうございます',
     JSON.stringify(window.val('f-body')));
}

console.log('\n[9] 本番のメール文面が往復で変わらないこと');
{
  const body     = doc.getElementById('f-body');
  const original = config.email.confirmationBodyTemplate;

  window.textToRich(body, original);
  const back = window.richToText(body);

  ok('一字一句変わらない', back === original,
     back === original ? '' : `長さ ${original.length} → ${back.length}`);

  if (back !== original) {
    for (let i = 0; i < Math.max(original.length, back.length); i++) {
      if (original[i] !== back[i]) {
        console.log(`      最初の差分 ${i}文字目: ${JSON.stringify(original.slice(i-20, i+20))}`);
        console.log(`                        → ${JSON.stringify(back.slice(i-20, i+20))}`);
        break;
      }
    }
  }

  const used = (original.match(/\{\{[^{}]+\}\}/g) || []);
  ok('文面内の差し込みがすべてタグになる',
     body.querySelectorAll('.var').length === used.length,
     `${body.querySelectorAll('.var').length} / ${used.length}`);
  ok('振込先などの本文が消えない', back.includes('セブン銀行') === original.includes('セブン銀行'));
}

console.log('\n[10] 次の開催をはじめる（確認 → シート作成 → 保存まで一度に）');
{
  const madeNames = [];
  const { doc, window, saved, gasCalls } = await boot({
    gasToken: 'TKN',
    gas: url => {
      if (url.searchParams.get('action') === 'create_reception_sheet') {
        madeNames.push(url.searchParams.get('name'));
        return { success: true, id: 'NEWSHEET123', url: 'https://docs.google.com/spreadsheets/d/NEWSHEET123/edit',
                 name: url.searchParams.get('name'), folder: '申込フォルダ', columns: 35 };
      }
      if (url.searchParams.get('action') === 'clear_cache') return { success: true, addedColumns: [] };
      return { success: true };
    }
  });
  const v = id => doc.getElementById(id).value;

  ok('入口が見えている', !!doc.getElementById('newEventBtn'));
  ok('いまの開催回が案内される',
     doc.getElementById('newEventSub').textContent.includes('第1回'),
     doc.getElementById('newEventSub').textContent);
  ok('最初は入力欄が閉じている', doc.getElementById('newEventForm').classList.contains('hidden'));
  ok('受付シートのURL欄は無い（自動で作る）', !doc.getElementById('ne-sheet') && !doc.getElementById('ne-make'));

  doc.getElementById('newEventBtn').dispatchEvent(new window.Event('click'));
  ok('押すと入力欄が開く', !doc.getElementById('newEventForm').classList.contains('hidden'));
  ok('次の開催回が先に入っている', v('ne-edition') === '第2回', v('ne-edition'));
  ok('イベント名も次の回に', v('ne-name') === '第2回ぶち癒しフェスタin小田原', v('ne-name'));
  ok('会場は引き継がれる', v('ne-place') === config.event.location);
  ok('開催日時は空（入れ直す）', v('ne-date') === '');
  ok('ボタンは「この内容ではじめる」', doc.getElementById('newEventApply').textContent.includes('この内容ではじめる'));

  // 前回と同じ開催回は止める
  let warned = '';
  window.alert = m => { warned = m; };
  doc.getElementById('ne-edition').value = '第1回';
  doc.getElementById('newEventApply').dispatchEvent(new window.Event('click'));
  ok('前回と同じ開催回は止める', warned.includes('前回と同じ'), warned);
  ok('止めたときは確認のパネルも出ない', doc.getElementById('dialog').classList.contains('hidden'));

  // 正しく入れると、確認のパネルが出る
  doc.getElementById('ne-edition').value = '第2回';
  doc.getElementById('ne-date').value    = '2027年5月5日（日）11:00〜16:30';
  doc.getElementById('newEventApply').dispatchEvent(new window.Event('click'));
  const dialog = doc.getElementById('dialog');
  const todo = [...doc.querySelectorAll('#dialogBody .todo li')].map(li => li.textContent);
  ok('確認のパネルが出る', !dialog.classList.contains('hidden'));
  ok('パネルの見出しに開催回', doc.getElementById('dialogTitle').textContent.includes('第2回'));
  ok('受付シートを作ることが書いてある', todo.some(t => t.includes('受付シート「第2回ぶち癒しフェスタin小田原 申込」')), todo.join(' / '));
  ok('開催回を切り替えることが書いてある', todo.some(t => t.includes('「第2回」に切り替え')));
  ok('保存まで行うことが書いてある', todo.some(t => t.includes('保存')));
  ok('この時点ではまだ何も作らない', gasCalls.length === 0 && saved.length === 0);
  ok('この時点ではまだ画面の開催回も変わらない', v('f-edition') === '第1回');

  // 「はじめる」
  doc.getElementById('dialogStart').dispatchEvent(new window.Event('click'));
  await wait(250);

  ok('GASに受付シートの作成を頼む', madeNames.length === 1, String(madeNames.length));
  ok('シート名はイベント名から作る', madeNames[0] === '第2回ぶち癒しフェスタin小田原 申込', madeNames[0]);
  ok('管理トークンを付けて頼む',
     gasCalls.some(u => u.includes('create_reception_sheet') && new URL(u).searchParams.get('token') === 'TKN'));
  ok('1回だけ保存する', saved.length === 1, `${saved.length}回`);

  const body = lastSaved(saved);
  ok('開催回が保存される', body.event.editionId === '第2回' && body.event.edition === '第2回');
  ok('イベント名が保存される', body.event.name === '第2回ぶち癒しフェスタin小田原');
  ok('開催日時が保存される', body.event.date === '2027年5月5日（日）11:00〜16:30');
  ok('受付シートが新しいIDになる', body.spreadsheetId === 'NEWSHEET123', body.spreadsheetId);
  ok('受付シートがどの回のものか記録される', body.spreadsheetEdition === '第2回', body.spreadsheetEdition);
  ok('リピーター検索がONになる', body.features.repeaterSearch === true);
  ok('データベースは変わらない', body.databaseSpreadsheetId === config.databaseSpreadsheetId);
  ok('写真フォルダは変わらない', body.driveFolderUrl === config.driveFolderUrl);
  ok('ブースはそのまま残る', body.booths.length === config.booths.length);
  ok('ブースが受付中に戻る', body.booths.every(b => b.soldOut === false));
  ok('質問はそのまま残る', body.customQuestions.length === config.customQuestions.length);
  ok('メール文面はそのまま残る', body.email.confirmationBodyTemplate === config.email.confirmationBodyTemplate);
  ok('規約はそのまま残る', body.terms === config.terms);

  const steps = [...doc.querySelectorAll('#dialogBody .steps li')];
  ok('進み具合がすべて ✅ になる', steps.every(li => li.className === 'ok'),
     steps.map(li => li.className + ':' + li.textContent).join(' / '));
  ok('受付シートを開くリンクが出る',
     [...doc.querySelectorAll('#dialogActions a')].some(a => a.href.includes('NEWSHEET123')));
  ok('反映のあとGASの一時保存を消す（トークン付き）',
     gasCalls.some(u => u.includes('clear_cache') && new URL(u).searchParams.get('token') === 'TKN'));
  ok('保存ボタンは押せない状態に戻る', doc.getElementById('saveBtn').disabled);
  ok('入力欄が閉じる', doc.getElementById('newEventForm').classList.contains('hidden'));
  ok('いまの開催回の表示が変わる', doc.getElementById('newEventSub').textContent.includes('第2回'),
     doc.getElementById('newEventSub').textContent);
  ok('受付シートの警告は出ない', doc.getElementById('sheetAlert').classList.contains('hidden'));
  ok('保存状況に反映したと出る', doc.getElementById('saveStatus').textContent.includes('反映しました'),
     doc.getElementById('saveStatus').textContent);
}

console.log('\n[11] 受付シートを作れなかったとき');
{
  const { doc, window, saved } = await boot({ gas: () => { throw new Error('CORS'); } });
  window.alert = () => {};

  doc.getElementById('newEventBtn').dispatchEvent(new window.Event('click'));
  doc.getElementById('newEventApply').dispatchEvent(new window.Event('click'));
  doc.getElementById('dialogStart').dispatchEvent(new window.Event('click'));
  await wait(120);

  const sheetStep = doc.querySelector('#dialogBody li[data-step="sheet"]');
  ok('作成の段階が ❌ になる', sheetStep.className === 'ng', sheetStep.className);
  ok('何も保存しない', saved.length === 0);
  ok('画面の開催回も変えない', doc.getElementById('f-edition').value === '第1回');
  ok('いまの受付はそのままだと伝える',
     doc.getElementById('sheetFallback').textContent.includes('まだ何も変わっていません'));
  const open = doc.getElementById('sheetFallbackOpen');
  ok('別の画面で作る案内がある', !!open && open.href.includes('format=html'), open?.href);

  // 別の画面で作ったURLを貼ると続きが進む
  doc.getElementById('sheetFallbackUrl').value = 'https://docs.google.com/spreadsheets/d/PASTED456/edit';
  doc.getElementById('sheetFallbackGo').dispatchEvent(new window.Event('click'));
  await wait(250);
  ok('貼ったURLで保存まで進む', saved.length === 1, `${saved.length}回`);
  const body = lastSaved(saved);
  ok('貼ったシートが受付シートになる', body.spreadsheetId === 'PASTED456', body.spreadsheetId);
  ok('開催回も切り替わる', body.event.edition === '第2回');

  // 正しくないURLは止める
  const again = await boot({ gas: () => { throw new Error('CORS'); } });
  let msg = '';
  again.window.alert = m => { msg = m; };
  again.doc.getElementById('newEventBtn').dispatchEvent(new again.window.Event('click'));
  again.doc.getElementById('newEventApply').dispatchEvent(new again.window.Event('click'));
  again.doc.getElementById('dialogStart').dispatchEvent(new again.window.Event('click'));
  await wait(120);
  again.doc.getElementById('sheetFallbackUrl').value = 'https://example.com/';
  again.doc.getElementById('sheetFallbackGo').dispatchEvent(new again.window.Event('click'));
  await wait(60);
  ok('正しくないURLは止める', msg.includes('正しくない') && again.saved.length === 0, msg);

  // やめると閉じて、何も変わらない
  again.doc.querySelector('#dialogActions .btn').dispatchEvent(new again.window.Event('click'));
  ok('やめると閉じる', again.doc.getElementById('dialog').classList.contains('hidden'));

  // 受付シートを作る機能が無い古いバックエンド（「稼働中」とだけ返す）
  const old = await boot({ gas: () => ({ success: true, message: '稼働中', version: '1.0.0' }) });
  old.window.alert = () => {};
  old.doc.getElementById('newEventBtn').dispatchEvent(new old.window.Event('click'));
  old.doc.getElementById('newEventApply').dispatchEvent(new old.window.Event('click'));
  old.doc.getElementById('dialogStart').dispatchEvent(new old.window.Event('click'));
  await wait(120);
  const oldNote = old.doc.querySelector('#dialogBody li[data-step="sheet"]').textContent;
  ok('古いバックエンドだと分かる', oldNote.includes('GASの更新'), oldNote);
  ok('古いバックエンドでも何も保存しない', old.saved.length === 0);
}

console.log('\n[11-2] 受付シートが前の回のままのとき');
{
  // 本番で起きた状態：開催回は第2回、受付シートは第1回のまま（どの回のシートか記録なし）
  const stale = JSON.parse(JSON.stringify(config));
  stale.event.edition = stale.event.editionId = '第2回';
  stale.event.name = '第2回ぶち癒しフェスタin小田原';
  delete stale.spreadsheetEdition;

  const made = [];
  const { doc, window, saved } = await boot({
    cfg: stale,
    gas: url => {
      if (url.searchParams.get('action') === 'create_reception_sheet') {
        made.push(url.searchParams.get('name'));
        return { success: true, url: 'https://docs.google.com/spreadsheets/d/SECOND789/edit',
                 name: url.searchParams.get('name'), folder: '申込フォルダ' };
      }
      return { success: true };
    }
  });

  const alertBox = doc.getElementById('sheetAlert');
  ok('警告が出る', !alertBox.classList.contains('hidden'));
  ok('どの回のシートが無いか書いてある', alertBox.textContent.includes('第2回'), alertBox.textContent);
  ok('このままだと前の回のシートに入ると書いてある', alertBox.textContent.includes('前の回のシートに入ります'));

  doc.getElementById('sheetAlertMake').dispatchEvent(new window.Event('click'));
  ok('確認のパネルが出る', !doc.getElementById('dialog').classList.contains('hidden'));
  doc.getElementById('dialogStart').dispatchEvent(new window.Event('click'));
  await wait(250);

  ok('今回のイベント名でシートを作る', made[0] === '第2回ぶち癒しフェスタin小田原 申込', made[0]);
  const body = lastSaved(saved);
  ok('新しいシートが受付シートになる', body.spreadsheetId === 'SECOND789');
  ok('第2回のシートだと記録される', body.spreadsheetEdition === '第2回');
  ok('開催回はそのまま', body.event.edition === '第2回');
  ok('保存後は警告が消える', alertBox.classList.contains('hidden'));

  // 「いまのシートのまま使う」
  const keep = await boot({ cfg: stale });
  keep.doc.getElementById('sheetAlertKeep').dispatchEvent(new keep.window.Event('click'));
  ok('まま使うと警告が消える', keep.doc.getElementById('sheetAlert').classList.contains('hidden'));
  ok('保存ボタンが押せるようになる', !keep.doc.getElementById('saveBtn').disabled);
  keep.doc.getElementById('saveBtn').dispatchEvent(new keep.window.Event('click'));
  await wait(120);
  ok('いまのシートが第2回のものとして記録される', lastSaved(keep.saved).spreadsheetEdition === '第2回');

  // 開催回だけを変えて保存すると、警告が出る
  const manual = await boot();
  manual.doc.getElementById('f-edition').value = '第2回';
  manual.doc.getElementById('f-edition').dispatchEvent(new manual.window.Event('input'));
  ok('開催回だけ変えると「次の開催をはじめる」を案内する',
     manual.doc.getElementById('editionWarn').textContent.includes('次の開催をはじめる'));
  manual.doc.getElementById('saveBtn').dispatchEvent(new manual.window.Event('click'));
  await wait(120);
  ok('保存すると受付シートの警告が出る', !manual.doc.getElementById('sheetAlert').classList.contains('hidden'));
  ok('シートは第1回のものだと記録が残る', lastSaved(manual.saved).spreadsheetEdition === '第1回');

  // 受付シートのURLを貼り替えて保存すると、いまの回のシートになる
  const paste = await boot();
  paste.doc.getElementById('f-sheetUrl').value = 'https://docs.google.com/spreadsheets/d/HANDMADE000/edit';
  paste.doc.getElementById('f-sheetUrl').dispatchEvent(new paste.window.Event('input', { bubbles: true }));
  paste.doc.getElementById('saveBtn').dispatchEvent(new paste.window.Event('click'));
  await wait(120);
  ok('貼り替えたシートは、いまの回のものとして記録される',
     lastSaved(paste.saved).spreadsheetId === 'HANDMADE000' && lastSaved(paste.saved).spreadsheetEdition === '第1回');
}

console.log('\n[12] 作成者用の登録状況');
{
  // 合い言葉ファイルがある場合
  const w = setupMode.window, d = setupMode.doc;
  await w.renderDevStatus();
  const text = d.getElementById('devState').textContent;
  ok('合い言葉が登録ずみと出る', /合い言葉[\s\S]*?登録ずみ/.test(text), text);
  ok('更新日も出る', text.includes('2026/8/20'), text);
  ok('トークンも登録ずみと出る', /アクセストークン[\s\S]*?登録ずみ/.test(text), text);
  ok('トークンは伏せ字で出す', text.includes('****'), text);
  ok('保存先が出る', text.includes('bayashichan / buchiiyashifestaodawara'), text);
  ok('config.jsonの公開URLが埋まっている',
     text.includes(config.configJsonUrl) && !!config.configJsonUrl, text);
  ok('未登録の警告は出ない', !text.includes('未登録'), text);

  // 合い言葉ファイルが無い場合
  const fresh = await boot({ setup: true, unlocked: false, registered: false });
  await fresh.window.renderDevStatus();
  const t2 = fresh.doc.getElementById('devState').textContent;
  ok('未登録なら未登録と出る', t2.includes('未登録'), t2);
  ok('やることが書いてある', t2.includes('合い言葉を登録する'), t2);
}

console.log('\n[13] トークンを入れ直さずに合い言葉だけ変える');
{
  const fresh = await boot({ setup: true });
  const d = fresh.doc, w = fresh.window;
  d.getElementById('d-owner').value = 'bayashichan';
  d.getElementById('d-repo').value  = 'buchiiyashifestaodawara';
  d.getElementById('d-token').value = '';          // 空のまま
  d.getElementById('d-pass1').value = 'あたらしい合い言葉です';
  d.getElementById('d-pass2').value = 'あたらしい合い言葉です';
  await w.registerPassphrase();

  const msg = d.getElementById('devMsg').textContent;
  ok('トークン欄が空でも登録できる', msg.includes('登録しました'), msg);

  const put = fresh.saved.find(x => x.message.includes('合い言葉'));
  const blob = JSON.parse(Buffer.from(put.content, 'base64').toString('utf8'));
  const back = await w.decryptJson(blob, 'あたらしい合い言葉です');
  ok('前のトークンが引き継がれる', back.token === 'x', back.token);
  ok('入力した合い言葉は残さない', d.getElementById('d-pass1').value === '');
}

console.log('\n[14] ブースの残り枠の設定');
{
  const { doc, window, saved } = await boot();
  const booth = doc.querySelector('#boothList details.booth');
  const text  = () => booth.textContent;
  const sw    = title => [...booth.querySelectorAll('.switch')].find(s => s.querySelector('.txt').textContent === title);
  const flip  = title => {
    const input = sw(title).querySelector('input');
    input.checked = !input.checked;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  };

  ok('ブースは最初は閉じている（名前があるとき）', !booth.open);
  ok('閉じていても名前と料金が分かる', booth.querySelector('summary').textContent.includes('内側半テーブル') &&
     booth.querySelector('summary').textContent.includes('¥8,000'), booth.querySelector('summary').textContent);
  ok('閉じていても定員の有無が分かる', booth.querySelector('summary').textContent.includes('定員なし'));

  ok('「残り枠を数える」スイッチがある', !!sw('残り枠を数える'));
  ok('オンにするとどうなるか書いてある', sw('残り枠を数える').textContent.includes('定員に達したら'));
  const sub = booth.querySelector('.subsettings');
  ok('オフの間は細かい設定を隠す', sub.classList.contains('hidden'));

  flip('残り枠を数える');
  ok('オンにすると細かい設定が出る', !sub.classList.contains('hidden'));
  ok('要約に定員が出る', booth.querySelector('summary').textContent.includes('定員10枠'),
     booth.querySelector('summary').textContent);

  // 定員を −／＋ で変える
  const stepper = sub.querySelector('.stepper');
  const plus  = stepper.querySelectorAll('button')[1];
  const minus = stepper.querySelectorAll('button')[0];
  plus.dispatchEvent(new window.Event('click'));
  plus.dispatchEvent(new window.Event('click'));
  minus.dispatchEvent(new window.Event('click'));
  ok('−／＋で定員が変わる', stepper.querySelector('input').value === '11', stepper.querySelector('input').value);
  ok('ボタンは指で押しやすい大きさ', /48px/.test(html.match(/\.stepper button \{[^}]*\}/)[0]));
  ok('要約も追従する', booth.querySelector('summary').textContent.includes('定員11枠'));

  // 見本
  const example = () => sub.querySelector('.example').textContent;
  ok('フォームでの見え方の見本がある', example().includes('フォームではこう見えます'));
  ok('見本に「残りあと◯枠」が出る', example().includes('残りあと3枠'), example());
  ok('定員に達したら満枠に切り替わると書いてある', example().includes('11枠うまったら'), example());

  // 表示しはじめるタイミング
  const radios = [...sub.querySelectorAll('input[type=radio]')];
  ok('「いつも出す」が最初に選ばれている', radios[0].checked);
  radios[1].checked = true;
  radios[1].dispatchEvent(new window.Event('change', { bubbles: true }));
  ok('「少なくなってから」を選ぶと枠数の欄が出る', !sub.querySelector('.choice-extra').classList.contains('hidden'));
  ok('見本の説明が変わる', example().includes('3枠以下になると'), example());

  // 数を出さない
  flip('フォームに「残りあと◯枠」を出す');
  ok('数を出さないとタイミングの欄を隠す', sub.querySelector('.choices').closest('.field').classList.contains('hidden'));
  ok('見本に数を出さないと書いてある', example().includes('残りの数は出しません'), example());
  flip('フォームに「残りあと◯枠」を出す');

  // 手動で締め切る
  ok('「手動で締め切る」スイッチがある', !!sw('手動で締め切る'));
  ok('キャンセル待ちになると説明がある', sw('手動で締め切る').textContent.includes('キャンセル待ち'));

  doc.getElementById('saveBtn').dispatchEvent(new window.Event('click'));
  await wait(120);
  const body = lastSaved(saved);
  ok('残り枠の設定が保存される',
     JSON.stringify(body.booths[0].seats) === JSON.stringify({ enabled: true, total: 11, show: true, showWhenAtMost: 3 }),
     JSON.stringify(body.booths[0].seats));
  ok('ほかのブースは数えない設定で保存される', body.booths[1].seats.enabled === false);
  ok('キャンセル待ちを受け付ける設定で保存される', body.features.waitlist === true);

  // 新しいブースは開いた状態で出る
  doc.getElementById('addBooth').dispatchEvent(new window.Event('click'));
  const added = [...doc.querySelectorAll('#boothList details.booth')].at(-1);
  ok('追加したブースは開いている', added.open);
  ok('追加したブースは数えない設定', added.querySelector('.subsettings').classList.contains('hidden'));
}

console.log('\n[15] キャンセル待ちの受付とメール');
{
  const { doc, window, saved } = await boot();
  const wl = doc.getElementById('f-waitlist');
  ok('キャンセル待ちのスイッチは最初オン', wl.checked);
  ok('オンの説明がある', doc.getElementById('waitlistSub').textContent.includes('キャンセル待ち'));

  wl.checked = false;
  wl.dispatchEvent(new window.Event('change', { bubbles: true }));
  ok('オフにすると説明が変わる', doc.getElementById('waitlistSub').textContent.includes('選べなくなり'),
     doc.getElementById('waitlistSub').textContent);
  const firstBooth = doc.querySelector('#boothList details.booth');
  const manual = [...firstBooth.querySelectorAll('.switch')].find(s => s.textContent.includes('手動で締め切る'));
  ok('手動で締め切るの説明も変わる', manual.textContent.includes('選べなくなります'), manual.textContent);

  const waitBody = doc.getElementById('f-waitBody');
  ok('キャンセル待ちのメール本文が最初から入っている', window.richToText(waitBody).includes('キャンセル待ちとして受け付けました'));
  ok('本文には振込の案内が無い', !window.richToText(waitBody).includes('振込先'));
  ok('件名は空なら既定の件名だと分かる', doc.getElementById('f-waitSubject').placeholder.includes('キャンセル待ち'));
  const chips = [...doc.querySelectorAll('#chipsWaitBody .chip')].map(b => b.textContent);
  ok('キャンセル待ちの本文にも差し込みボタンがある', chips.includes('＋ お名前') && chips.includes('＋ 出展ブース'), chips.join(','));

  // 差し込みボタンは、キャンセル待ちの本文の中に入る（通常の本文には入らない）
  window.textToRich(waitBody, '');
  const before = window.richToText(doc.getElementById('f-body'));
  [...doc.querySelectorAll('#chipsWaitBody .chip')].find(b => b.textContent === '＋ お名前')
    .dispatchEvent(new window.Event('click'));
  ok('キャンセル待ちの本文に差し込まれる', window.richToText(waitBody) === '{{name}}', window.richToText(waitBody));
  ok('通常の本文は変わらない', window.richToText(doc.getElementById('f-body')) === before);

  doc.getElementById('f-waitSubject').value = '【{{eventName}}】キャンセル待ちのご案内';
  window.textToRich(waitBody, '{{name}} 様\n空きが出たらご連絡します');
  window.markDirty();
  doc.getElementById('saveBtn').dispatchEvent(new window.Event('click'));
  await wait(120);
  const body = lastSaved(saved);
  ok('キャンセル待ちを受け付けない設定で保存される', body.features.waitlist === false);
  ok('キャンセル待ちの件名が保存される', body.email.waitlistSubject === '【{{eventName}}】キャンセル待ちのご案内');
  ok('キャンセル待ちの本文が保存される', body.email.waitlistBodyTemplate === '{{name}} 様\n空きが出たらご連絡します',
     JSON.stringify(body.email.waitlistBodyTemplate));
  ok('通常のメール文面は変わらない', body.email.confirmationBodyTemplate === config.email.confirmationBodyTemplate);
}

console.log('\n[16] データベースに残す質問の注意');
{
  const { doc, window } = await boot();
  const items = [...doc.querySelectorAll('#questionList .item')];
  const menuItem = items.find(el => el.querySelector('input').value === '出展メニュー名');
  const note = menuItem.querySelector('.note');
  ok('「出展メニュー名」に注意が付く', !!note && note.textContent.includes('前回の内容を呼び出す'), note?.textContent);

  const input = menuItem.querySelector('input');
  input.value = 'メニュー';
  input.dispatchEvent(new window.Event('input'));
  ok('質問文を変えると警告に変わる', note.classList.contains('note-warn') && note.textContent.includes('残らず'),
     note.textContent);

  doc.getElementById('addQuestion').dispatchEvent(new window.Event('click'));
  const added = [...doc.querySelectorAll('#questionList .item')].at(-1);
  ok('新しく足した質問には付かない', added.querySelector('.note').classList.contains('hidden'));
}

console.log('\n[17] 保存のあと、受付シートに見出しを足したら知らせる');
{
  const { doc, window, gasCalls } = await boot({
    gas: url => url.searchParams.get('action') === 'clear_cache'
      ? { success: true, addedColumns: ['ステータス', '搬入の時間'] }
      : { success: true }
  });
  doc.getElementById('addQuestion').dispatchEvent(new window.Event('click'));
  const q = [...doc.querySelectorAll('#questionList .item')].at(-1).querySelector('input');
  q.value = '搬入の時間';
  q.dispatchEvent(new window.Event('input'));
  doc.getElementById('saveBtn').dispatchEvent(new window.Event('click'));
  await wait(150);
  ok('反映を確かめてから一時保存を消す', gasCalls.some(u => u.includes('clear_cache')));
  ok('追加した見出しを知らせる', doc.getElementById('toast').textContent.includes('搬入の時間'),
     doc.getElementById('toast').textContent);
}

console.log('\n[18] 申込フォームのURLをコピーする');
{
  const { doc, window } = await boot();
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async t => { copied.push(t); } }, configurable: true
  });

  const url = doc.getElementById('formUrl');
  ok('申込フォームのURLが表示される', url.value === 'https://example.test/repo/apply/', url.value);
  ok('書き換えられない', url.readOnly);
  ok('開いて確かめるリンクも同じURL', doc.getElementById('openFormUrl').href === 'https://example.test/repo/apply/');
  ok('ページのいちばん上のほうにある',
     doc.querySelector('.wrap').children[1] === url.closest('.linkcard'));

  const btn = doc.getElementById('copyFormUrl');
  btn.dispatchEvent(new window.Event('click'));
  await wait(20);
  ok('ボタンでコピーできる', copied[0] === 'https://example.test/repo/apply/', copied.join(','));
  ok('コピーしたと分かる', btn.textContent.includes('コピーしました') && doc.getElementById('toast').textContent === 'コピーしました');
  ok('コピーしても未保存にはならない', doc.getElementById('saveBtn').disabled);
  ok('LINE連携が無ければLINE用のURLは出さない', doc.getElementById('liffLinkBox').classList.contains('hidden'));

  // 作成者用URL（?setup）で開いても、申込フォームのURLに ?setup は付かない
  const setupPage = await boot({ setup: true });
  ok('?setup で開いても余計なものが付かない',
     setupPage.doc.getElementById('formUrl').value === 'https://example.test/repo/apply/',
     setupPage.doc.getElementById('formUrl').value);

  // LINE連携（LIFF）を設定しているとき
  const liffCfg = JSON.parse(JSON.stringify(config));
  liffCfg.features.liffId = '1234567890-AbCdEfGh';
  const liff = await boot({ cfg: liffCfg });
  ok('LINE連携があればLINE用のURLも出す', !liff.doc.getElementById('liffLinkBox').classList.contains('hidden'));
  ok('LINE用のURL', liff.doc.getElementById('liffUrl').value === 'https://liff.line.me/1234567890-AbCdEfGh',
     liff.doc.getElementById('liffUrl').value);
}

console.log(ng === 0 ? '\n✅ すべて成功' : `\n❌ ${ng}件失敗`);
process.exit(ng === 0 ? 0 : 1);
