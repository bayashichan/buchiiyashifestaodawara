/**
 * スプレッドシートを使う処理の検証（Node で実行）
 *
 * Google のスプレッドシート・メールなどを、メモリ上の偽物に置き換えて
 * 「申込を送る → 受付シート → データベース → メール」の流れをそのまま動かします。
 *
 * 確かめること
 *   - 受付シートに足りない見出しが右端に追加される（並べ替えた列はそのまま）
 *   - 定員に達したらキャンセル待ちになる／キャンセルした行は数えない
 *   - データベースの列を並べ替えても、見出しの名前どおりに入る
 *   - 次の開催の受付シートは、前回の見出し＋足りない見出しで作られる
 *
 * 実行方法: node gas/tests/sheets.test.js
 */
const fs   = require('fs');
const path = require('path');
const src  = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

// ---------------------------------------------------------------
// 偽物のスプレッドシート
// ---------------------------------------------------------------
const isBlank = v => v === '' || v === null || v === undefined;

class FakeSheet {
  constructor(name, rows) {
    this.name = name;
    this.data = (rows || []).map(r => r.slice());
    this.maxCols = Math.max(26, ...this.data.map(r => r.length));
    this.frozen = 0;
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getParent() { return this.parent; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) {
      if ((this.data[i] || []).some(v => !isBlank(v))) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.data.forEach(r => {
      for (let j = (r || []).length - 1; j >= 0; j--) {
        if (!isBlank(r[j])) { m = Math.max(m, j + 1); break; }
      }
    });
    return m;
  }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(after, n) { this.maxCols += n; }
  setFrozenRows(n) { this.frozen = n; }
  appendRow(row) {
    if (row.length > this.maxCols) throw new Error('列が足りません');
    this.data[this.getLastRow()] = row.slice();
  }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  header() { return (this.data[0] || []).slice(0, this.getLastColumn()); }
  /** 見出しの名前で、行の値を取り出す */
  rowObj(n) {
    const h = this.data[0];
    const r = this.data[n - 1] || [];
    const o = {};
    h.forEach((k, i) => { if (k && !(k in o)) o[k] = r[i] === undefined ? '' : r[i]; });
    return o;
  }
}

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const vals = [];
      for (let j = 0; j < this.nc; j++) {
        const v = row[this.c - 1 + j];
        vals.push(v === undefined ? '' : v);
      }
      out.push(vals);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.nr || values.some(v => v.length !== this.nc)) {
      throw new Error('範囲と値の大きさが合いません');
    }
    if (this.c - 1 + this.nc > this.sheet.maxCols) throw new Error('列が足りません');
    values.forEach((vals, i) => {
      const at = this.r - 1 + i;
      this.sheet.data[at] = this.sheet.data[at] || [];
      vals.forEach((v, j) => { this.sheet.data[at][this.c - 1 + j] = v; });
    });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  clearContent() {
    return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill('')));
  }
  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
}

class FakeBook {
  constructor(id, sheets) {
    this.id = id;
    this.sheets = sheets || [];
  }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSheets() { return this.sheets; }
  getSheetByName(n) {
    const s = this.sheets.find(x => x.name === n) || null;
    if (s) s.parent = this;
    return s;
  }
  insertSheet(n) { const s = new FakeSheet(n, []); s.parent = this; this.sheets.push(s); return s; }
}

// ---------------------------------------------------------------
// GAS のサービスの偽物
// ---------------------------------------------------------------
function makeEnv(books, config) {
  const cache = { config: JSON.stringify(config) };
  const mails = [];
  let created = 0;

  const env = {
    Utilities: {
      formatDate: (d) => {
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      }
    },
    SpreadsheetApp: {
      openById: id => {
        if (!books[id]) throw new Error('開けません: ' + id);
        return books[id];
      },
      create: name => {
        const id = 'NEW' + (++created);
        const b = new FakeBook(id, [new FakeSheet('シート1', [])]);
        b.name = name;
        books[id] = b;
        return b;
      }
    },
    DriveApp: {
      getFileById: () => ({ getParents: () => ({ hasNext: () => false }) }),
      getRootFolder: () => ({ removeFile() {} })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in cache ? cache[k] : null),
        put: (k, v) => { cache[k] = v; },
        remove: k => { if (k !== 'config') delete cache[k]; }
      })
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    UrlFetchApp: { fetch: () => { throw new Error('ネットワークは使いません'); } },
    GmailApp: { sendEmail: (to, subject, body, opts) => mails.push({ to, subject, body, opts }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ setMimeType: () => ({ content: s }) })
    },
    HtmlService: { createHtmlOutput: s => ({ setTitle: () => s }) },
    console: { log() {}, warn() {}, error() {} }
  };

  const names = Object.keys(env);
  const G = new Function(...names, src + `
    return { doPost, doGet, saveToDatabase, calculatePrice, createReceptionSpreadsheet_,
             handleClearCache, handleBoothStatus, migrateReceptionToDatabase, rebuildExhibitors,
             syncReceptionUpdatesToDatabase,
             DB_APPLICATION_HEADERS, DB_EXHIBITOR_HEADERS, DB_EVENT_HEADERS };
  `)(...names.map(n => env[n]));

  return { G, mails, cache };
}

// ---------------------------------------------------------------
let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`  ✗ ${label}\n    期待: ${JSON.stringify(expected)}\n    実際: ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

// 実際の第1回の受付シートの見出し（空欄の列を含む33列）
const realHeader = [
  '座席番号','申込日時','氏名','フリガナ','メールアドレス','電話番号','出展カテゴリ','出展名','出展ブース',
  '出展メニュー名','自己紹介','持ち込み物品','SNS','写真掲載可否','プロフィール写真','コンセント',
  '懇親会出欠','','二次会出欠','二次会人数','協会会員','景品提供','景品内容','郵便番号','住所',
  '備考・質問','スタッフメモ','','合計金額','入金確認','入金日','LINEユーザーID','LINE表示名'
];

function baseConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'apply', 'config.json'), 'utf8'));
  cfg.spreadsheetId = 'RECEPTION';
  cfg.databaseSpreadsheetId = 'DB';
  cfg.event.edition = cfg.event.editionId = '第2回';
  cfg.booths[0].seats = { enabled: true, total: 2, show: true, showWhenAtMost: 0 };
  cfg.customQuestions.push({ id: '搬入の時間', label: '搬入の時間', type: 'text', required: false });
  cfg.features.waitlist = true;
  return cfg;
}

let seq = 0;
function post(G, over) {
  seq++;
  const params = Object.assign({
    name: '申込 ' + seq, furigana: 'もうしこみ', email: `user${seq}@example.com`,
    phoneNumber: '090', exhibitorName: 'サロン' + seq, category: '物販',
    boothId: '内側半テーブル', agreeTerms: '1', usePower: '0',
    customAnswers: JSON.stringify({ '出展メニュー名': 'タロット', '自己紹介': 'こんにちは', '搬入の時間': '9時' })
  }, over || {});
  const out = G.doPost({ parameter: params });
  return JSON.parse(out.content);
}

// ===============================================================
console.log('\n[1] 受付シートの見出しの自動追加');
{
  const reception = new FakeSheet('申込データ', [realHeader]);
  const books = { RECEPTION: new FakeBook('RECEPTION', [reception]), DB: new FakeBook('DB', []) };
  const { G } = makeEnv(books, baseConfig());

  const res = post(G);
  check('申込が成功する', res.success, true);

  const header = reception.header();
  check('元の33列は並びも名前も変わらない', header.slice(0, 33), realHeader);
  check('足りない見出しだけが右端に増える', header.slice(33), ['ステータス', '搬入の時間']);
  check('空欄の見出し（懇親会人数）は追加しない', header.filter(h => h === '懇親会人数').length, 0);

  const row = reception.data[1];
  check('氏名は元の列に入る', row[2], '申込 ' + seq);
  check('増えた質問の答えが入る', row[34], '9時');
  check('ステータスは「申込」', row[33], '申込');

  // スタッフが列を並べ替えても、名前どおりに入る
  const moved = reception.data.map(r => { const c = r.slice(); [c[2], c[7]] = [c[7], c[2]]; return c; });
  reception.data = moved;
  post(G, { boothId: 'ボディ' });
  check('並べ替えた後も氏名の列に氏名が入る', reception.rowObj(3)['氏名'], '申込 ' + seq);
  check('並べ替えた後も出展名の列に出展名が入る', reception.rowObj(3)['出展名'], 'サロン' + seq);
  check('2回目は見出しが増えない', reception.header().length, 35);
}

// ===============================================================
console.log('\n[2] 残り枠とキャンセル待ち');
{
  const reception = new FakeSheet('申込データ', [realHeader]);
  const books = { RECEPTION: new FakeBook('RECEPTION', [reception]), DB: new FakeBook('DB', []) };
  const cfg = baseConfig();
  const { G, mails } = makeEnv(books, cfg);

  check('1件目は申込', post(G).waitlisted, false);
  check('2件目（定員2）も申込', post(G).waitlisted, false);
  const third = post(G);
  check('3件目はキャンセル待ちになる', third.waitlisted, true);
  check('受付シートのステータスがキャンセル待ち', reception.rowObj(4)['ステータス'], 'キャンセル待ち');

  const last = mails.filter(m => m.to === `user${seq}@example.com`)[0];
  check('申込者にはキャンセル待ちの件名で届く', /キャンセル待ち/.test(last.subject), true);
  check('振込の案内は入らない', /合計: ¥/.test(last.body), false);
  const admin = mails.filter(m => m.to === cfg.email.adminEmail).pop();
  check('事務局の通知に【キャンセル待ち】が付く', admin.subject.indexOf('【キャンセル待ち】') === 0, true);

  const db = books.DB.getSheetByName('applications');
  check('データベースのステータスもキャンセル待ち', db.rowObj(db.getLastRow())['ステータス'], 'キャンセル待ち');

  // 1件キャンセルすると1枠空く
  const iStatus = reception.header().indexOf('ステータス');
  reception.data[1][iStatus] = 'キャンセル';
  check('キャンセルした行は数えないので申込に戻る', post(G).waitlisted, false);

  // 別のブースは数えない（定員の設定なし）
  check('定員を決めていないブースは影響しない', post(G, { boothId: 'ボディ' }).waitlisted, false);
}

// ===============================================================
console.log('\n[3] 手動で締め切る・キャンセル待ちを受け付けない');
{
  const reception = new FakeSheet('申込データ', [realHeader]);
  const books = { RECEPTION: new FakeBook('RECEPTION', [reception]), DB: new FakeBook('DB', []) };
  const cfg = baseConfig();
  cfg.booths[1].soldOut = true;
  const { G } = makeEnv(books, cfg);
  check('手動で締め切ったブースはキャンセル待ち', post(G, { boothId: '壁側半テーブル' }).waitlisted, true);

  const cfg2 = baseConfig();
  cfg2.booths[1].soldOut = true;
  cfg2.features.waitlist = false;
  const reception2 = new FakeSheet('申込データ', [realHeader]);
  const books2 = { RECEPTION: new FakeBook('RECEPTION', [reception2]), DB: new FakeBook('DB', []) };
  const env2 = makeEnv(books2, cfg2);
  const res = post(env2.G, { boothId: '壁側半テーブル' });
  check('キャンセル待ちを受け付けない設定なら断る', res.success, false);
  check('断った理由が分かる', /満枠/.test(res.error), true);
  check('断った申込は受付シートに書かない', reception2.getLastRow(), 1);
  check('断った申込にはメールを送らない', env2.mails.length, 0);
}

// ===============================================================
console.log('\n[4] フォームに出す空き状況');
{
  const reception = new FakeSheet('申込データ', [realHeader]);
  const books = { RECEPTION: new FakeBook('RECEPTION', [reception]), DB: new FakeBook('DB', []) };
  const cfg = baseConfig();
  cfg.booths[0].seats = { enabled: true, total: 5, show: true, showWhenAtMost: 3 };
  cfg.booths[1].seats = { enabled: true, total: 5, show: false, showWhenAtMost: 0 };
  const { G, cache } = makeEnv(books, cfg);

  post(G);
  delete cache.booth_status;
  let st = G.handleBoothStatus(cfg);
  check('残り4枠は「3枠以下で表示」の設定なので出さない', st.booths['内側半テーブル'].remaining, null);

  post(G);
  delete cache.booth_status;
  st = G.handleBoothStatus(cfg);
  check('残り3枠になったら出す', st.booths['内側半テーブル'].remaining, 3);
  check('表示しない設定のブースは数を返さない', st.booths['壁側半テーブル'].remaining, null);
  check('満枠かどうかは返す', st.booths['壁側半テーブル'].full, false);
  check('キャンセル待ちを受け付けるか', st.waitlist, true);
}

// ===============================================================
console.log('\n[5] データベースの列を並べ替えても正しく入る');
{
  const reception = new FakeSheet('申込データ', [realHeader]);
  const cfg = baseConfig();
  const { G: G0 } = makeEnv({}, cfg);

  // applications: 逆順に並べ替え、途中にスタッフ用の列を足し、「ステータス」列は消してある
  const appHeaders = G0.DB_APPLICATION_HEADERS.filter(h => h !== 'ステータス').reverse();
  appHeaders.splice(5, 0, '担当者');
  // exhibitors: 並べ替え＋スタッフ用の列
  const exHeaders = G0.DB_EXHIBITOR_HEADERS.slice().reverse().concat(['電話メモ']);
  const exRow = exHeaders.map(h => ({
    '出展者ID': 'EX0001', 'メールキー': 'repeat@example.com', '氏名': '常連 さん',
    'メールアドレス': 'repeat@example.com', '出展回数': 1, '電話メモ': '午前中は不在', 'スタッフメモ': '前回は角の席'
  })[h] ?? '');
  // events: 並べ替え
  const evHeaders = G0.DB_EVENT_HEADERS.slice().reverse();

  const books = {
    RECEPTION: new FakeBook('RECEPTION', [reception]),
    DB: new FakeBook('DB', [
      new FakeSheet('applications', [appHeaders]),
      new FakeSheet('exhibitors', [exHeaders, exRow]),
      new FakeSheet('events', [evHeaders])
    ])
  };
  const { G } = makeEnv(books, cfg);
  const res = post(G, { name: '常連 さん', email: 'repeat@example.com', exhibitorName: '月の庭' });
  check('データベースに保存できた', res.databaseSaved, true);

  const app = books.DB.getSheetByName('applications');
  const h = app.header();
  check('並べ替えた見出しは書き換えない', h.slice(0, appHeaders.length), appHeaders);
  check('消してあった「ステータス」は右端に戻る', h.slice(appHeaders.length), ['ステータス']);
  const rec = app.rowObj(2);
  check('氏名が氏名の列に入る', rec['氏名'], '常連 さん');
  check('メールがメールの列に入る', rec['メールアドレス'], 'repeat@example.com');
  check('出展メニュー名が入る', rec['出展メニュー名'], 'タロット');
  check('自己紹介が入る', rec['自己紹介'], 'こんにちは');
  check('データベースには決めた2つ以外の質問は入らない', h.includes('搬入の時間'), false);
  check('スタッフ用の列は空のまま', rec['担当者'], '');
  check('開催回IDが入る', rec['開催回ID'], '第2回');
  check('申込IDが採番される', rec['申込ID'], '第2回-0001');

  const ex = books.DB.getSheetByName('exhibitors');
  const exRec = ex.rowObj(2);
  check('出展者は同じ行を更新（増えない）', ex.getLastRow(), 2);
  check('出展回数が増える', exRec['出展回数'], 2);
  check('最新出展名が入る', exRec['最新出展名'], '月の庭');
  check('スタッフが足した列の値は残る', exRec['電話メモ'], '午前中は不在');
  check('スタッフメモは残る', exRec['スタッフメモ'], '前回は角の席');
  check('申込に出展者IDが付く', rec['出展者ID'], 'EX0001');

  const ev = books.DB.getSheetByName('events');
  check('開催回が見出しどおりに記録される', ev.rowObj(2)['開催回ID'], '第2回');
  check('申込件数が数えられる', ev.rowObj(2)['申込件数'], 1);

  post(G, { name: '別の 人', email: 'other@example.com' });
  check('2件目の申込IDは続き番号', app.rowObj(3)['申込ID'], '第2回-0002');
  check('events は同じ行を更新', ev.getLastRow(), 2);
  check('申込件数が増える', ev.rowObj(2)['申込件数'], 2);
}

// ===============================================================
console.log('\n[6] 次の開催の受付シートを作る');
{
  const prev = new FakeSheet('申込データ', [realHeader.concat(['担当'])]);
  const books = { RECEPTION: new FakeBook('RECEPTION', [prev]), DB: new FakeBook('DB', []) };
  const cfg = baseConfig();
  const { G } = makeEnv(books, cfg);

  const info = G.createReceptionSpreadsheet_(cfg, '第3回 申込');
  const made = books[info.id].getSheetByName('申込データ');
  check('シート名は「申込データ」', !!made, true);
  check('前回の見出し（スタッフの列も含む）をそのまま引き継ぐ',
    made.header().slice(0, realHeader.length + 1), realHeader.concat(['担当']));
  check('足りない見出しを右端に足す', made.header().slice(realHeader.length + 1), ['ステータス', '搬入の時間']);
  check('列数を返す', info.columns, realHeader.length + 3);
  check('1行目を固定する', made.frozen, 1);
}

// ===============================================================
console.log('\n[7] 設定を保存したとき（キャッシュ削除）に見出しを足す');
{
  const reception = new FakeSheet('申込データ', [realHeader]);
  const books = { RECEPTION: new FakeBook('RECEPTION', [reception]), DB: new FakeBook('DB', []) };
  const cfg = baseConfig();
  const { G } = makeEnv(books, cfg);
  const res = G.handleClearCache({});
  check('成功する', res.success, true);
  check('追加した見出しを返す', res.addedColumns, ['ステータス', '搬入の時間']);
  check('受付シートに見出しが増える', reception.header().slice(33), ['ステータス', '搬入の時間']);
  check('もう一度実行しても増えない', G.handleClearCache({}).addedColumns, []);
}

// ===============================================================
console.log('\n[8] 取り込み・作り直し・同期も見出しの名前で動く');
{
  const cfg = baseConfig();
  const { G: G0 } = makeEnv({}, cfg);
  const recHeader = realHeader.concat(['ステータス']);
  const iStatus = recHeader.length - 1;
  const r1 = recHeader.map(() => ''); const r2 = recHeader.map(() => '');
  Object.assign(r1, { 1: '2027/01/10 10:00:00', 2: '取込 一郎', 4: 'ichi@example.com', 7: '一の店', 8: 'ボディ' });
  Object.assign(r2, { 1: '2027/01/11 11:00:00', 2: '取込 二郎', 4: 'ni@example.com',   7: '二の店', 8: 'ボディ' });
  r2[iStatus] = 'キャンセル待ち';
  const reception = new FakeSheet('申込データ', [recHeader, r1, r2]);

  const appHeaders = G0.DB_APPLICATION_HEADERS.slice().reverse();
  const exHeaders  = ['メモ欄'].concat(G0.DB_EXHIBITOR_HEADERS.slice().reverse());
  const books = {
    RECEPTION: new FakeBook('RECEPTION', [reception]),
    DB: new FakeBook('DB', [
      new FakeSheet('applications', [appHeaders]),
      new FakeSheet('exhibitors', [exHeaders, exHeaders.map(h => ({ 'メモ欄': '大事', 'メールキー': 'ichi@example.com', '出展者ID': 'EX0009' })[h] ?? '')]),
      new FakeSheet('events', [G0.DB_EVENT_HEADERS])
    ])
  };
  const { G } = makeEnv(books, cfg);
  G.migrateReceptionToDatabase();

  const app = books.DB.getSheetByName('applications');
  check('取り込んだ件数', app.getLastRow() - 1, 2);
  check('並べ替えた見出しはそのまま', app.header(), appHeaders);
  check('取り込みでも氏名の列に氏名', app.rowObj(2)['氏名'], '取込 一郎');
  check('受付シートのステータスを引き継ぐ', app.rowObj(3)['ステータス'], 'キャンセル待ち');
  check('出展者IDは既存を引き継ぐ', app.rowObj(2)['出展者ID'], 'EX0009');

  const ex = books.DB.getSheetByName('exhibitors');
  check('作り直しても見出しはそのまま', ex.header(), exHeaders);
  const ichi = [2, 3].map(n => ex.rowObj(n)).find(o => o['メールキー'] === 'ichi@example.com');
  check('スタッフが足した列の値は残る', ichi['メモ欄'], '大事');
  check('氏名が入る', ichi['氏名'], '取込 一郎');

  G.rebuildExhibitors();
  check('もう一度作り直しても同じ人数', ex.getLastRow() - 1, 2);

  // 受付シートでステータスと入金を直してから同期
  reception.data[2][iStatus] = '申込';
  reception.data[2][recHeader.indexOf('入金確認')] = '済';
  reception.data[1][iStatus] = 'キャンセル';
  reception.data[1][recHeader.indexOf('入金確認')] = '済';
  G.syncReceptionUpdatesToDatabase();
  check('繰り上げて入金した人は入金済', app.rowObj(3)['ステータス'], '入金済');
  check('キャンセルした人は入金確認があってもキャンセルのまま', app.rowObj(2)['ステータス'], 'キャンセル');
}

console.log(failures === 0 ? '\n✅ すべて成功' : `\n❌ ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
