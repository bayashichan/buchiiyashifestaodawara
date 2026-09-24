/**
 * ブース選択の回帰テスト（実DOM）
 *
 * ブースの識別子にブース名をそのまま使うようにしたため、
 * 日本語や記号を含む名前でも選択・料金計算が壊れないことを確認します。
 *
 * 実行方法:
 *   npm i --no-save jsdom
 *   node apply/tests/booth.test.mjs
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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html   = fs.readFileSync(`${REPO}/apply/index.html`, 'utf8');
const script = fs.readFileSync(`${REPO}/apply/script.js`, 'utf8');
const config = JSON.parse(fs.readFileSync(`${REPO}/apply/config.json`, 'utf8'));

let ng = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '  → ' + extra}`);
  if (!cond) ng++;
};

// status … バックエンドが返す空き状況（関数なら呼ばれるたびに結果を作る。throw で通信失敗）
async function boot(cfg, status) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/apply/' });
  const { window } = dom;
  const calls = [];
  window.fetch = async (input) => {
    const u = String(input);
    calls.push(u);
    if (u.includes('action=booth_status')) {
      const body = typeof status === 'function' ? status() : status;
      if (body === undefined) return { ok: true, json: async () => ({ success: true, message: '稼働中' }) };
      return { ok: true, json: async () => body };
    }
    return { ok: true, json: async () => cfg };
  };
  window.alert = () => {};
  window.eval(script);
  await new Promise(r => setTimeout(r, 80));
  return { window, doc: window.document, calls };
}

// 記号を含む名前でも壊れないことを確かめるため、テスト用のブースを足す
const cfg = JSON.parse(JSON.stringify(config));
cfg.booths.push({
  id: "Salon 'à la lune' <特設>",
  name: "Salon 'à la lune' <特設>",
  location: '',
  prices: { regular: 12000, earlyBird: 12000 },
  limits: { maxStaff: 0, maxChairs: 0, allowPower: true },
  soldOut: false, prohibitSession: false, askEquipment: false
});

const { window, doc } = await boot(cfg);

console.log('\n[1] ブースの表示');
const options = [...doc.querySelectorAll('.booth-option')];
ok('ブースが件数分ならぶ', options.length === cfg.booths.length, `${options.length}件`);
ok('ブース名がそのまま表示される',
  options.map(o => o.querySelector('span').textContent).join('|') === cfg.booths.map(b => b.name).join('|'),
  options.map(o => o.querySelector('span').textContent).join('|'));
ok('記号を含む名前も欠けずに表示される',
  options.at(-1).querySelector('span').textContent === "Salon 'à la lune' <特設>",
  options.at(-1).querySelector('span').textContent);

console.log('\n[2] 選択と料金');
const pick = (name) => {
  const radio = [...doc.querySelectorAll('input[name="boothRadio"]')].find(r => r.value === name);
  radio.checked = true;
  radio.dispatchEvent(new window.Event('change'));
};

pick('内側半テーブル');
ok('選んだブースに選択中の印がつく',
  options[0].classList.contains('selected') && !options[1].classList.contains('selected'));
ok('合計金額が反映される', doc.getElementById('totalPrice').textContent === '¥8,000',
  doc.getElementById('totalPrice').textContent);
ok('送信用のブース名が入る', doc.getElementById('boothIdInput').value === '内側半テーブル');

pick("Salon 'à la lune' <特設>");
ok('記号を含む名前でも選択できる',
  options.at(-1).classList.contains('selected') && !options[0].classList.contains('selected'));
ok('記号を含む名前でも料金が出る', doc.getElementById('totalPrice').textContent === '¥12,000',
  doc.getElementById('totalPrice').textContent);

console.log('\n[3] 持ち込み物品の欄');
const equip = doc.getElementById('equipmentSection');
pick('内側半テーブル');
ok('たずねない設定のブースでは出ない', equip.classList.contains('hidden'));
pick('ボディ');
ok('たずねる設定のブースで出る', !equip.classList.contains('hidden'));
pick('壁側半テーブル');
ok('別のブースに切り替えると消える', equip.classList.contains('hidden'));

console.log('\n[4] 満枠（キャンセル待ちを受け付ける＝初期設定）');
const soldOutCfg = JSON.parse(JSON.stringify(cfg));
soldOutCfg.gasUrl = 'https://script.google.com/macros/s/TEST/exec';
soldOutCfg.booths[0].soldOut = true;
const WAITLIST_OK = { success: true, waitlist: true, booths: { '内側半テーブル': { full: true, remaining: null } } };
const full = await boot(soldOutCfg, WAITLIST_OK);
const firstOption = full.doc.querySelector('.booth-option');
ok('締め切ったブースがあれば、対応しているかバックエンドに確かめる',
  full.calls.some(u => u.includes('booth_status')), full.calls.join(','));
ok('満枠のブースもキャンセル待ちとして選べる', !firstOption.querySelector('input').disabled);
ok('「満枠・キャンセル待ち」と表示される', firstOption.textContent.includes('満枠・キャンセル待ち'));
ok('料金も表示される', firstOption.textContent.includes('¥8,000'), firstOption.textContent);

const plain = await boot(cfg);
ok('満枠も定員も無ければ空き状況を取りに行かない',
  !plain.calls.some(u => u.includes('booth_status')), plain.calls.join(','));

// 古いバックエンド（キャンセル待ちを知らない）では、これまでどおり選べない
const oldBackend = await boot(soldOutCfg);
const oldFirst = oldBackend.doc.querySelector('.booth-option');
ok('古いバックエンドでは満枠のブースは選べない（通常の申込として受け付けられてしまうため）',
  oldFirst.querySelector('input').disabled && oldFirst.textContent.includes('満枠') &&
  !oldFirst.textContent.includes('キャンセル待ち'), oldFirst.textContent);
const offline = await boot(soldOutCfg, () => { throw new Error('通信失敗'); });
ok('確かめられないときも選べない', offline.doc.querySelector('.booth-option input').disabled);

const pickIn = (d, w, name) => {
  const radio = [...d.querySelectorAll('input[name="boothRadio"]')].find(r => r.value === name);
  radio.checked = true;
  radio.dispatchEvent(new w.Event('change'));
};
pickIn(full.doc, full.window, '内側半テーブル');
ok('選ぶとキャンセル待ちになる旨が出る', !full.doc.getElementById('waitlistNotice').classList.contains('hidden'));
ok('申込ボタンが「キャンセル待ちで申し込む」になる',
  full.doc.getElementById('submitBtn').textContent.trim() === 'キャンセル待ちで申し込む',
  full.doc.getElementById('submitBtn').textContent);
pickIn(full.doc, full.window, 'ボディ');
ok('空きのあるブースに変えると注意が消える', full.doc.getElementById('waitlistNotice').classList.contains('hidden'));
ok('申込ボタンの文字が戻る', full.doc.getElementById('submitBtn').textContent.trim() === '申し込む');

console.log('\n[5] 満枠（キャンセル待ちを受け付けない）');
const closedCfg = JSON.parse(JSON.stringify(soldOutCfg));
closedCfg.features.waitlist = false;
const closed = await boot(closedCfg, { success: true, waitlist: false, booths: { '内側半テーブル': { full: true, remaining: null } } });
const closedFirst = closed.doc.querySelector('.booth-option');
ok('満枠のブースは選べない', closedFirst.querySelector('input').disabled);
ok('満枠の表示が出る', closedFirst.textContent.includes('満枠'));
ok('キャンセル待ちの表示は出ない', !closedFirst.textContent.includes('キャンセル待ち'));

console.log('\n[6] 残り枠の表示（バックエンドの空き状況）');
const seatCfg = JSON.parse(JSON.stringify(cfg));
seatCfg.gasUrl = 'https://script.google.com/macros/s/TEST/exec';
seatCfg.booths[0].seats = { enabled: true, total: 10, show: true, showWhenAtMost: 0 };
seatCfg.booths[1].seats = { enabled: true, total: 3, show: false, showWhenAtMost: 0 };
const seat = await boot(seatCfg, {
  success: true, waitlist: true,
  booths: {
    '内側半テーブル': { full: false, remaining: 2 },
    '壁側半テーブル': { full: true,  remaining: null },
    'ボディ':         { full: false, remaining: null }
  }
});
const seatOpts = [...seat.doc.querySelectorAll('.booth-option')];
ok('空き状況を取りに行く', seat.calls.some(u => u.includes('action=booth_status')));
ok('「残りあと2枠」と表示される', seatOpts[0].textContent.includes('残りあと2枠'), seatOpts[0].textContent);
ok('定員に達したブースはキャンセル待ちになる', seatOpts[1].textContent.includes('満枠・キャンセル待ち'));
ok('数を出さない設定のブースには残り枠が出ない', !seatOpts[2].textContent.includes('残り'));

const noWait = await boot(seatCfg, {
  success: true, waitlist: false,
  booths: { '壁側半テーブル': { full: true, remaining: null } }
});
ok('バックエンドがキャンセル待ちを受け付けない設定なら選べない',
  noWait.doc.querySelectorAll('.booth-option')[1].querySelector('input').disabled);

console.log('\n[7] 空き状況を受け取れないとき');
const failed = await boot(seatCfg, () => { throw new Error('通信失敗'); });
const failedOpts = [...failed.doc.querySelectorAll('.booth-option')];
ok('ブースは設定どおりに表示される', failedOpts.length === seatCfg.booths.length);
ok('締め切っていないブースは選べる', failedOpts.every(o => !o.querySelector('input').disabled));
const old = await boot(seatCfg);   // 空き状況を知らない古いバックエンド
ok('古いバックエンドでも表示が壊れない', old.doc.querySelectorAll('.booth-option').length === seatCfg.booths.length);

console.log('\n[8] 選んだ後に満枠になった');
let turn = 0;
const later = await boot(seatCfg, () => (++turn === 1
  ? { success: true, waitlist: true, booths: { '内側半テーブル': { full: false, remaining: 1 } } }
  : { success: true, waitlist: true, booths: { '内側半テーブル': { full: true, remaining: null } } }));
pickIn(later.doc, later.window, '内側半テーブル');
await later.window.loadBoothAvailability();
const laterFirst = later.doc.querySelector('.booth-option');
ok('選んだ状態はそのまま', laterFirst.classList.contains('selected') && laterFirst.querySelector('input').checked);
ok('キャンセル待ちの表示に変わる', laterFirst.textContent.includes('満枠・キャンセル待ち'));
ok('キャンセル待ちになる旨が出る', !later.doc.getElementById('waitlistNotice').classList.contains('hidden'));

console.log('\n[9] 完了画面');
const done = await boot(cfg);
done.window.showCompleteModal(false, { waitlisted: true, expected: false, boothName: '内側半テーブル' });
ok('見出しが「キャンセル待ちで受け付けました」', done.doc.getElementById('completeTitle').textContent === 'キャンセル待ちで受け付けました');
ok('直前に満枠になったことを伝える', done.doc.getElementById('waitlistResultText').textContent.includes('直前に「内側半テーブル」が満枠'),
  done.doc.getElementById('waitlistResultText').textContent);
ok('振込を待ってもらう案内', done.doc.getElementById('waitlistResultText').textContent.includes('お振込みはお待ちください'));
const normal = await boot(cfg);
normal.window.showCompleteModal(false, { waitlisted: false });
ok('通常の申込では出ない', normal.doc.getElementById('waitlistResult').classList.contains('hidden'));
ok('通常の見出しのまま', normal.doc.getElementById('completeTitle').textContent.includes('ありがとうございます'));

console.log(ng === 0 ? '\n✅ すべて成功' : `\n❌ ${ng}件失敗`);
process.exit(ng === 0 ? 0 : 1);
