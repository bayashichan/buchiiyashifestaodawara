/**
 * GAS の純粋関数だけを取り出して、Node で挙動を検証する。
 * Spreadsheet/Gmail などに触れない関数のみ対象。
 */
const fs = require('fs');
let src = fs.readFileSync(require('path').join(__dirname, '..', 'Code.gs'), 'utf8');

// GAS 固有 API のスタブ
const Utilities = {
  formatDate: (d, tz, fmt) => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
};

// Code.gs をそのまま評価し、スプレッドシートに触れない関数だけ取り出す
// 実行方法: node gas/tests/mapping.test.js
const wrapped = new Function('Utilities', 'console', src + `
  return { mapRowToHeaders_, buildFieldMap, dateKey_, formatCellDate_, padLeft_, normalizeEmail_,
           formatSnsLinks, buildReceptionHeaders, DB_APPLICATION_HEADERS,
           sanitizeFileName_, buildPhotoFileName_, getEditionInfo_,
           buildPhotoNoticeText_, applyTemplate, PHOTO_PENDING_LABEL,
           buildExhibitorRows_, DB_EXHIBITOR_HEADERS };
`);
const M = wrapped(Utilities, console);

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.log(`  ✗ ${label}\n    期待: ${JSON.stringify(expected)}\n    実際: ${JSON.stringify(actual)}`); }
  else console.log(`  ✓ ${label}`);
}

// ---------------------------------------------------------------
// 1. 実際の受付シートのヘッダー（空欄列を含む33列）で列ズレが起きないか
// ---------------------------------------------------------------
console.log('\n[1] 受付シートの列マッピング（実データのヘッダー）');

const realHeader = [
  '座席番号','申込日時','氏名','フリガナ','メールアドレス','電話番号','出展カテゴリ','出展名','出展ブース',
  '出展メニュー名','自己紹介','持ち込み物品','SNS','写真掲載可否','プロフィール写真','コンセント',
  '懇親会出欠','','二次会出欠','二次会人数','協会会員','景品提供','景品内容','郵便番号','住所',
  '備考・質問','スタッフメモ','','合計金額','入金確認','入金日','LINEユーザーID','LINE表示名'
];

const config = {
  customQuestions: [
    { id: 'cq_menu',  label: '出展メニュー名' },
    { id: 'cq_intro', label: '自己紹介' }
  ]
};

const params = {
  submittedAt: '2026/08/17 10:00:00',
  name: '山田 花子', furigana: 'やまだ はなこ', email: 'Hanako@Example.com ',
  phoneNumber: '090-1111-2222', category: '占い・スピリチュアル', exhibitorName: 'サロン花',
  equipment: 'ベッド', photoPermission: '可', profileImageUrl: 'https://drive/x',
  usePower: '1', partyAttend: '出席', partyCount: '2',
  secondaryPartyAttend: '欠席', secondaryPartyCount: '0',
  isMember: '1', stampRallyPrize: 'ある', prizeContent: 'お守り',
  postalCode: '250-0002', address: '神奈川県小田原市1-1', notes: 'よろしく',
  lineUserId: 'U123', lineDisplayName: 'はなこ',
  snsLinks: JSON.stringify([{ type: 'Instagram', url: 'https://instagram.com/a' }]),
  customAnswers: { cq_menu: 'タロット 20分 2,000円', cq_intro: 'はじめまして' },
  extraStaff: '0', extraChairs: '0'
};
const calc = { totalFee: 14000, boothName: '壁側半テーブル', isEarlyBird: false, breakdown: {} };

const row = M.mapRowToHeaders_(realHeader, M.buildFieldMap(params, calc, config));

check('列数がヘッダーと一致', row.length, realHeader.length);
check('申込日時', row[1], '2026/08/17 10:00:00');
check('出展メニュー名（カスタム質問）', row[9], 'タロット 20分 2,000円');
check('自己紹介（カスタム質問）', row[10], 'はじめまして');
check('コンセント', row[15], 'あり');
check('懇親会出欠', row[16], '出席');
check('ラベル無し列 → 懇親会人数として2が入る', row[17], 2);
check('二次会出欠', row[18], '欠席');
check('協会会員', row[20], 'はい');
check('住所', row[24], '神奈川県小田原市1-1');
check('スタッフメモは空のまま', row[26], '');
check('スタッフメモ隣のラベル無し列は空（手入力を温存）', row[27], '');
check('合計金額', row[28], 14000);
check('入金確認は空', row[29], '');
check('LINE表示名', row[32], 'はなこ');

// ---------------------------------------------------------------
// 2. 列を1つ追加・並べ替えても正しい位置に入るか
// ---------------------------------------------------------------
console.log('\n[2] スタッフが列を足しても壊れないこと');

const customHeader = ['申込日時', '担当スタッフ', '氏名', '合計金額', '出展名'];
const row2 = M.mapRowToHeaders_(customHeader, M.buildFieldMap(params, calc, config));
check('並び替え後も列名どおり', row2, ['2026/08/17 10:00:00', '', '山田 花子', 14000, 'サロン花']);

// ---------------------------------------------------------------
// 3. 重複判定キー（取り込みの再実行で増えないこと）
// ---------------------------------------------------------------
console.log('\n[3] 日時キーの正規化');

check('ゼロ埋め無しと有りが一致', M.dateKey_('2026/05/05 7:31:56'), M.dateKey_('2026/05/05 07:31:56'));
check('Date型と文字列が一致', M.dateKey_(new Date(2026, 4, 5, 7, 31, 56)), M.dateKey_('2026/05/05 7:31:56'));
check('日付のみ', M.dateKey_('2026/07/09'), '2026/07/09 00:00:00');
check('ハイフン区切り', M.dateKey_('2026-05-05 7:31:56'), '2026/05/05 07:31:56');
check('空欄', M.dateKey_(''), '');
check('メール正規化', M.normalizeEmail_(' Hanako@Example.COM '), 'hanako@example.com');

// ---------------------------------------------------------------
// 4. SNS の整形
// ---------------------------------------------------------------
console.log('\n[4] SNS整形');
check('JSON配列', M.formatSnsLinks('[{"type":"Instagram","url":"https://x"}]'), 'Instagram: https://x');
check('既存の文字列はそのまま', M.formatSnsLinks('Instagram: https://y'), 'Instagram: https://y');
check('空', M.formatSnsLinks(''), 'なし');
check('空配列', M.formatSnsLinks('[]'), 'なし');

// ---------------------------------------------------------------
// 5. DBヘッダーの重複チェック
// ---------------------------------------------------------------
console.log('\n[5] DB列定義');
const dup = M.DB_APPLICATION_HEADERS.filter((h, i, a) => a.indexOf(h) !== i);
check('applications に重複列名が無い', dup, []);

// ---------------------------------------------------------------
// 6. 写真の保存先とファイル名
// ---------------------------------------------------------------
console.log('\n[6] 写真のフォルダ名・ファイル名');

check('開催回がフォルダ名になる',
  M.sanitizeFileName_(M.getEditionInfo_({ event: { edition: '第1回', name: 'イベント' } }).edition), '第1回');
check('開催回が空ならIDを使う',
  M.getEditionInfo_({ event: { editionId: '第2回', name: 'イベント' } }).editionId, '第2回');
check('フォルダ名に使えない記号を落とす', M.sanitizeFileName_('第1回/小田原:特設?'), '第1回小田原特設');
check('前後の空白を落とす', M.sanitizeFileName_('  第1回  '), '第1回');
check('空欄なら空文字', M.sanitizeFileName_(''), '');

check('ファイル名は氏名_出展名',
  M.buildPhotoFileName_({ name: '山田 花子', exhibitorName: 'サロン花' }), '山田 花子_サロン花.jpg');
check('出展名が無ければ氏名だけ',
  M.buildPhotoFileName_({ name: '山田 花子', exhibitorName: '' }), '山田 花子.jpg');
check('記号を含む出展名も安全に',
  M.buildPhotoFileName_({ name: '関', exhibitorName: 'Salon à la lune <特設>' }), '関_Salon à la lune 特設.jpg');
check('どちらも空なら元のファイル名',
  M.buildPhotoFileName_({ name: '', exhibitorName: '', profileImageName: 'photo.jpg' }), 'photo.jpg');
check('長すぎる名前は切り詰める',
  M.buildPhotoFileName_({ name: 'あ'.repeat(100), exhibitorName: '' }).length, 84);

// ---------------------------------------------------------------
// 7. 写真が届かなかった場合の案内
// ---------------------------------------------------------------
console.log('\n[7] 写真未受領の案内');

const mailCfg = { email: { adminEmail: 'admin@example.com', replyToEmail: 'reply@example.com' } };
const notice  = M.buildPhotoNoticeText_(mailCfg);

check('返信先アドレスを案内に載せる', notice.includes('reply@example.com'), true);
check('返信先が無ければ管理者アドレスを使う',
  M.buildPhotoNoticeText_({ email: { adminEmail: 'admin@example.com' } }).includes('admin@example.com'), true);
check('アドレス未設定でも文面が壊れない',
  M.buildPhotoNoticeText_({}).includes('ご返信でお送りください'), true);
check('申込が完了している旨を伝える', notice.includes('お申込みは完了'), true);
check('シートの目印', M.PHOTO_PENDING_LABEL, 'メール送付待ち');

// テンプレートに {{photoNotice}} があればその位置へ差し込まれる
check('差し込み位置を指定できる',
  M.applyTemplate('前\n{{photoNotice}}\n後', { photoNotice: '案内文' }), '前\n案内文\n後');
check('写真ありのときは空になる',
  M.applyTemplate('前\n{{photoNotice}}\n後', { photoNotice: '' }), '前\n\n後');

// ---------------------------------------------------------------
// 8. exhibitors の作り直し（取り込みが途中で止まったときの修復）
// ---------------------------------------------------------------
console.log('\n[8] 出展者マスタの作り直し');

const AH = ['開催回ID','開催回','申込日時','氏名','フリガナ','メールアドレス','電話番号',
            '郵便番号','住所','出展カテゴリ','出展名','出展メニュー名','自己紹介','SNS','プロフィール写真'];
const appRow = o => AH.map(h => o[h] !== undefined ? o[h] : '');

const appRows = [
  appRow({ 開催回ID:'第1回', 開催回:'第1回', 申込日時:'2026/05/05 7:31:56', 氏名:'影山愛結美',
        メールアドレス:'A@Example.com', 出展名:'虹色ユニコーン', 住所:'静岡県' }),
  appRow({ 開催回ID:'第1回', 開催回:'第1回', 申込日時:'2026/05/10 22:00:44', 氏名:'梅原由紀子',
        メールアドレス:'ume@example.com', 出展名:'NOEVIR', 電話番号:'090' }),
  // 同じ人の2件目（あとの申込なので、こちらの内容が優先される）
  appRow({ 開催回ID:'第1回', 開催回:'第1回', 申込日時:'2026/05/11 0:00:04', 氏名:'梅原由紀子',
        メールアドレス:'ume@example.com', 出展名:'NOEVIR Revoir', 電話番号:'' }),
  // メールが無い招待枠
  appRow({ 開催回ID:'第1回', 開催回:'第1回', 申込日時:'2026/07/09', 氏名:'カンメイさん',
        出展名:'Kanmei' })
];

// 取り込みが途中で止まり、申込が無いのに残っている出展者と、テスト行
const existing = {
  'a@example.com': { '出展者ID':'EX0001', 'メールキー':'a@example.com', 'スタッフメモ':'常連さん' },
  'orphan@example.com': { '出展者ID':'EX0050', 'メールキー':'orphan@example.com' },
  'test@example.com':   { '出展者ID':'EX0069', 'メールキー':'test@example.com' }
};

const built = M.buildExhibitorRows_(AH, appRows, existing);
const H = M.DB_EXHIBITOR_HEADERS;
const get = (r, name) => r[H.indexOf(name)];

check('申込のある人だけになる', built.length, 3);
check('申込が無い人は消える', built.some(r => get(r,'メールキー').indexOf('orphan') >= 0), false);
check('テスト行も消える', built.some(r => get(r,'メールキー').indexOf('test@') >= 0), false);

check('出展者IDは引き継がれる', get(built[0], '出展者ID'), 'EX0001');
check('スタッフメモは残る', get(built[0], 'スタッフメモ'), '常連さん');
check('メールは小文字で名寄せ', get(built[0], 'メールキー'), 'a@example.com');

const ume = built.filter(r => get(r,'メールキー') === 'ume@example.com')[0];
check('同じ人は1行にまとまる', built.filter(r => get(r,'メールキー') === 'ume@example.com').length, 1);
check('出展回数は申込の数どおり', get(ume, '出展回数'), 2);
check('初回申込日時', get(ume, '初回申込日時'), '2026/05/10 22:00:44');
check('最終申込日時', get(ume, '最終申込日時'), '2026/05/11 00:00:04');
check('新しい申込の内容が優先される', get(ume, '最新出展名'), 'NOEVIR Revoir');
check('空欄では上書きしない（電話番号が残る）', get(ume, '電話番号'), '090');

const kanmei = built.filter(r => String(get(r,'メールキー')).indexOf('name:') === 0)[0];
check('メールが無い人は氏名と出展名で名寄せ', get(kanmei, 'メールキー'), 'name:カンメイさん/Kanmei');
// 既存の最大は EX0069。新しい人には申込日時の古い順に続きの番号が振られる
check('新しい人①（梅原）に続きの番号', get(ume, '出展者ID'), 'EX0070');
check('新しい人②（カンメイ）にその次の番号', get(kanmei, '出展者ID'), 'EX0071');

// 何度実行しても同じ結果になる
const again = M.buildExhibitorRows_(AH, appRows,
  Object.fromEntries(built.map(r => [get(r,'メールキー'),
    Object.fromEntries(H.map((h,i) => [h, r[i]]))])));
check('もう一度実行しても増えない', again.length, built.length);
check('出展回数が増えていかない', get(again.filter(r => get(r,'メールキー')==='ume@example.com')[0], '出展回数'), 2);
check('IDも変わらない', get(again[0], '出展者ID'), 'EX0001');

console.log(failures === 0 ? '\n✅ すべて成功' : `\n❌ ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
