# Apps Script（GAS）に追加する機能

管理画面（Config Editor）の機能をフルに使うために、稼働中のGASへ3つの機能を追加します。
どれも**既存の処理には手を加えず、追加と1行の差し替えだけ**で済みます。

| 追加する機能 | 何のため | 重要度 |
|---|---|---|
| ① 設定キャッシュのクリア | 管理画面の変更を**すぐに**反映させる | **高** |
| ② 開催回ごとの写真フォルダ | 写真を開催回ごとのフォルダに自動で振り分ける | 中 |
| ③ スプレッドシートの新規作成 | 次回開催分のシートを管理画面から作る | 低 |

> **追加しなくても申込フォームは今までどおり動きます。**
> ①だけは、開催回を切り替える運用をするなら実質必須です（理由は下記）。

## 編集するスクリプトの見分け方

`CONFIG_JSON_URL` の定義と `doPost(e)` があるプロジェクトが対象です。
Googleフォームのトリガー用スクリプト（`e.itemResponses` を使うもの）とは別物なので注意してください。

---

## ① 設定キャッシュのクリア（最優先）

### なぜ必要か

GASは config.json を**30分キャッシュ**しています。

```javascript
cache.put('config', JSON.stringify(config), 1800); // 30分キャッシュ
```

このため、管理画面で「受付中の開催回」を切り替えても、**最大30分は前の開催回のスプレッドシートに
申込が保存され続けます**。料金・メール文面・質問項目の変更も同じく最大30分遅れます。

この機能を追加すると、管理画面で保存した瞬間にGASへクリアが通知され、**次の申込から即座に新しい設定**が使われます。

### 手順1：関数を追加（ファイル末尾に貼り付け）

```javascript
/** JSONレスポンスを返す共通処理 */
function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 管理画面から「設定を更新したのでキャッシュを捨てて」と依頼されたときの処理 */
function handleClearCache_() {
  CacheService.getScriptCache().remove('config');
  return jsonOutput_({ success: true, action: 'clearCache' });
}
```

### 手順2：`doPost(e)` の先頭に3行追加

```javascript
function doPost(e) {
  // ▼▼ 追加 ▼▼
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'clearCache') return handleClearCache_();
  // ▲▲ 追加ここまで ▲▲

  let result;

  try {
    const config = getConfig();
    // ↓ 以下は今までのコードのまま
```

---

## ② 開催回ごとの写真フォルダ

親フォルダ（`config.driveFolderUrl`）の中に、開催回ごとのフォルダを自動で作って保存します。

```
📁 親フォルダ（管理画面の「写真の保存先」）
  └ 📁 第2回（2027年3月1日）   ← 初回の申込時に自動作成
      └ 🖼 山田花子_プロフィール.jpg
```

### 手順1：関数を追加（ファイル末尾に貼り付け）

```javascript
/**
 * 親フォルダの中の「開催回フォルダ」を返す。無ければ作成する。
 * 開催回名が渡されていない場合は、従来どおり親フォルダをそのまま使う。
 */
function getEditionFolder_(baseFolder, folderName) {
  const name = String(folderName || '').trim();
  if (!name) return baseFolder;

  const found = baseFolder.getFoldersByName(name);
  return found.hasNext() ? found.next() : baseFolder.createFolder(name);
}
```

### 手順2：`saveProfileImage()` の中の3行を差し替え

既存のコードのうち、**フォルダを決めている部分だけ**を差し替えます。

```javascript
// 変更前
    const folderId = parseDriveFolderId(config.driveFolderUrl || config.driveFolderId);
    const folder   = folderId
      ? DriveApp.getFolderById(folderId)
      : DriveApp.getRootFolder();
```

```javascript
// 変更後
    const folderId   = parseDriveFolderId(config.driveFolderUrl || config.driveFolderId);
    const baseFolder = folderId
      ? DriveApp.getFolderById(folderId)
      : DriveApp.getRootFolder();
    const folder = getEditionFolder_(baseFolder, e.parameter.driveFolderName);
```

> `saveProfileImage(params, config)` は `params` を受け取っているので、`e.parameter.driveFolderName` の代わりに
> `params.driveFolderName` と書いても同じです。呼び出し元の書き方に合わせてください。

---

## ③ スプレッドシートの新規作成

管理画面の「✨ スプレッドシートを新規作成」ボタンから、次回開催分のシートを作れるようにします。
**このボタンで作られたシートは、GASを実行しているアカウントの所有物になります。**
（＝GASをクライアントのアカウントへ移行した後に使えば、クライアント所有のシートが作られます）

### 手順1：関数を追加（ファイル末尾に貼り付け）

```javascript
/** 管理画面からの「スプレッドシート新規作成」依頼を処理する */
function handleCreateSpreadsheet_(e) {
  try {
    const name = String(e.parameter.name || '').trim()
              || ('申込データ_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd'));

    const ss = SpreadsheetApp.create(name);

    // 親フォルダが指定されていれば、その中へ移動する
    const parentId = parseDriveFolderId(e.parameter.parentFolderId);
    if (parentId) {
      DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(parentId));
    }

    return jsonOutput_({
      success: true,
      action: 'createSpreadsheet',
      spreadsheetId: ss.getId(),
      spreadsheetUrl: ss.getUrl()
    });

  } catch (err) {
    return jsonOutput_({ success: false, error: String(err) });
  }
}
```

### 手順2：`doPost(e)` の先頭に1行追加（①と同じ場所）

```javascript
function doPost(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'clearCache')        return handleClearCache_();
  if (action === 'createSpreadsheet') return handleCreateSpreadsheet_(e);   // ← 追加

  let result;
  ...
```

作成したシートには、GASエディタで `setupSpreadsheet()` を実行するとヘッダー行が用意されます
（実行しなくても、最初の申込が届いた時点で自動生成されます）。

---

## 再デプロイ（これを忘れると反映されません）

1. 画面右上「**デプロイ**」→「**デプロイを管理**」
2. 稼働中のデプロイの ✏️（鉛筆アイコン）をクリック
3. バージョンを「**新バージョン**」に変更 → 「**デプロイ**」
4. **URLは変わりません**。config.json の変更は不要です

> ⚠️ 「**新しいデプロイ**」を選ぶとURLが変わり、申込が届かなくなります。
> 必ず「デプロイを管理」から既存のデプロイを更新してください。

---

## 動作確認

| 追加した機能 | 確認方法 |
|---|---|
| ① キャッシュクリア | 管理画面で何か変更して保存 → 「**すぐに反映されます**」と表示されれば成功（未対応時は「最大30分」と表示） |
| ② 写真フォルダ | テスト申込を送信 → 親フォルダの中に開催回名のフォルダができ、画像が入っている |
| ③ 新規作成 | 「✨ スプレッドシートを新規作成」→ URLが自動で入力される |

うまくいかない場合は、Apps Script の「**実行数**」画面でエラーを確認してください。よくある原因は次の2つです。

- **再デプロイを忘れている**（一番多い）
- **フォルダの権限**：GASを実行しているGoogleアカウントに、そのフォルダの編集権限がない
  - 特に注意：写真フォルダの所有者を移した場合、**申込は成功するのに写真URLだけ空になります**
    （`saveProfileImage` はエラーを握りつぶす作りのため、表面上は成功して見えます）
