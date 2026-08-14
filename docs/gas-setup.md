# Apps Script（GAS）に追加する設定

管理画面の「📅 開催回とデータの保存先」を**完全に自動化**するために、Apps Script 側へ2つの機能を追加します。

> **追加しなくても申込フォームは今までどおり動きます。**
> 未対応の状態では、次の2点だけが手作業になります。
> - 写真は従来のフォルダに保存されます（開催回ごとのフォルダは作られません）
> - 「✨ スプレッドシートを新規作成」ボタンは、空のシートを開く案内に切り替わります

管理画面から送られてくる項目（追加分）は次の4つです。いずれも未対応なら無視されるだけです。

| 項目名 | 内容 | 例 |
|---|---|---|
| `spreadsheetId` | 受付中の開催回のスプレッドシートID（従来と同じ項目） | `1-KFjF...` |
| `driveParentFolderId` | 写真を入れる親フォルダのID | `1Yr2nO...` |
| `driveFolderName` | この開催回のフォルダ名 | `第1回（2026年11月1日）` |
| `editionId` / `editionName` | 開催回の識別子と名前 | `ed_1762...` / `第1回` |

---

## 1. 写真を開催回ごとのフォルダに保存する

Apps Script のエディタで、以下の関数をファイルの末尾に貼り付けます。

```javascript
/**
 * 親フォルダの中の「開催回フォルダ」を返す。無ければ作成する。
 * parentFolderId が空のときは null を返すので、呼び出し側で従来のフォルダを使う。
 */
function getEditionFolder_(parentFolderId, folderName) {
  if (!parentFolderId) return null;

  var name = String(folderName || '').trim() || '未分類';
  var parent = DriveApp.getFolderById(parentFolderId);
  var found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}
```

次に、**画像を保存している既存の箇所**を探します。だいたい次のような形になっているはずです。

```javascript
// 変更前（例）
var folder = DriveApp.getFolderById(FOLDER_ID);
var blob = Utilities.newBlob(
  Utilities.base64Decode(e.parameter.profileImageBase64),
  e.parameter.profileImageMimeType,
  e.parameter.profileImageName
);
var file = folder.createFile(blob);
```

このうち **フォルダを決めている1行だけ**を、次のように差し替えます。

```javascript
// 変更後
var folder = getEditionFolder_(e.parameter.driveParentFolderId, e.parameter.driveFolderName)
          || DriveApp.getFolderById(FOLDER_ID);   // 未設定なら従来のフォルダ
```

これで、保存先が次のようになります。

```
📁 親フォルダ
  └ 📁 第1回（2026年11月1日）   ← 初回の申込時に自動作成
      └ 🖼 山田花子_プロフィール.jpg
```

---

## 2. スプレッドシートを新規作成できるようにする

同じく末尾に貼り付けます。

```javascript
/** 管理画面からの「スプレッドシート新規作成」リクエストを処理する */
function handleCreateSpreadsheet_(e) {
  try {
    var name = String(e.parameter.name || '').trim()
            || ('申込データ_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd'));

    var ss = SpreadsheetApp.create(name);

    // 親フォルダが指定されていれば、その中へ移動する
    var parentId = e.parameter.parentFolderId;
    if (parentId) {
      DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(parentId));
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl()
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

そのうえで、**`doPost(e)` の一番最初**に次の3行を追加します。

```javascript
function doPost(e) {
  if (e && e.parameter && e.parameter.action === 'createSpreadsheet') {
    return handleCreateSpreadsheet_(e);
  }

  // ↓ ここから下は今までのコードのまま
  ...
}
```

---

## 3. 再デプロイ（これを忘れると反映されません）

1. Apps Script の画面右上「**デプロイ**」→「**デプロイを管理**」
2. 稼働中のデプロイの ✏️（鉛筆）をクリック
3. バージョンを「**新バージョン**」に変更 → 「**デプロイ**」
4. **URLは変わりません**。config.json の変更は不要です

> 「新しいデプロイ」を選ぶと URL が変わってしまい、申込が届かなくなります。必ず「デプロイを管理」から更新してください。

---

## 4. 動作確認

1. 管理画面の「📅 開催回とデータの保存先」で「✨ スプレッドシートを新規作成」を押す
   → 新しいスプレッドシートのURLが自動で入れば成功です
2. 申込フォームからテスト送信し、親フォルダの中に開催回名のフォルダができ、その中に画像が入っていることを確認します

うまくいかない場合は、Apps Script の「実行数」画面でエラー内容を確認してください。よくある原因は次の2つです。

- **再デプロイを忘れている**（一番多い）
- **親フォルダの権限**：Apps Script を実行しているGoogleアカウントに、そのフォルダの編集権限がない
