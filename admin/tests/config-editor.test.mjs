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
const config = JSON.parse(fs.readFileSync(`${REPO}/apply/config.json`, 'utf8'));

let ng = 0;
const ok = (label, cond, extra='') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '  → ' + extra}`);
  if (!cond) ng++;
};

async function boot({ setup = false, unlocked = true } = {}) {
  const url = 'https://example.test/repo/admin/config-editor.html' + (setup ? '?setup' : '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url, pretendToBeVisual: true });
  const { window } = dom;

  Object.defineProperty(window, "crypto", { value: crypto.webcrypto, configurable: true });
  window.confirm = () => true;

  const saved = [];
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
      return { ok: true, json: async () => JSON.parse(JSON.stringify(config)) };
    }
    return { ok: false, json: async () => ({}) };
  };

  if (unlocked) {
    window.localStorage.setItem('buchi_admin_conn',
      JSON.stringify({ owner: 'bayashichan', repo: 'buchiiyashifestaodawara', token: 'x' }));
  }

  const scriptSrc = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  window.eval(scriptSrc);
  await new Promise(r => setTimeout(r, 120));
  return { window, doc: window.document, saved };
}

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
  bodyEl.value = '';
  bodyEl.setSelectionRange(0, 0);
  const chip = [...doc.querySelectorAll('#chipsBody .chip')].find(b => b.textContent.includes('お名前'));
  chip.dispatchEvent(new window.Event('click'));
  ok('ボタンで差し込み文字が入る', bodyEl.value === '{{name}}', bodyEl.value);
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
  body.value = 'あいうえお';
  body.setSelectionRange(2, 2);
  [...doc.querySelectorAll('#chipsBody .chip')]
    .find(b => b.textContent === '＋ 写真のお願い')
    .dispatchEvent(new window.Event('click'));
  ok('カーソル位置に差し込まれる', body.value === 'あい{{photoNotice}}うえお', body.value);

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
}

console.log(ng === 0 ? '\n✅ すべて成功' : `\n❌ ${ng}件失敗`);
process.exit(ng === 0 ? 0 : 1);
