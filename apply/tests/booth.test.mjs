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

async function boot(cfg) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/apply/' });
  const { window } = dom;
  window.fetch = async () => ({ ok: true, json: async () => cfg });
  window.alert = () => {};
  window.eval(script);
  await new Promise(r => setTimeout(r, 80));
  return { window, doc: window.document };
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

console.log('\n[4] 満枠');
const soldOutCfg = JSON.parse(JSON.stringify(cfg));
soldOutCfg.booths[0].soldOut = true;
const full = await boot(soldOutCfg);
const firstOption = full.doc.querySelector('.booth-option');
ok('満枠のブースは選べない', firstOption.querySelector('input').disabled);
ok('満枠の表示が出る', firstOption.textContent.includes('満枠'));

console.log(ng === 0 ? '\n✅ すべて成功' : `\n❌ ${ng}件失敗`);
process.exit(ng === 0 ? 0 : 1);
