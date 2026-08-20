# ぶち癒しフェスタ 出展申込システム

| フォルダ | 内容 |
|---|---|
| `apply/` | 出展者が入力する申込フォーム（GitHub Pages で公開） |
| `admin/` | 事務局用の管理画面 |
| `gas/` | バックエンド（Google Apps Script に貼り付けて使用） |
| `docs/` | 移行手順・データベース仕様 |

## 使う人向け

設定画面は1つだけです → `admin/config-editor.html`（スマホ対応）

イベント名・開催回・色・ブース・料金・質問項目・規約・メール文面・保存先を、
すべてこの画面から変更して「設定内容を保存」で反映します。
初回だけ合い言葉の入力が必要です。詳しくは
[`docs/MIGRATION.md`](docs/MIGRATION.md) の「管理画面の使い方」を参照してください。

## 仕組み

```
申込フォーム (apply/)
      │ 送信
      ▼
Google Apps Script (gas/Code.gs)
      ├─→ 受付スプレッドシート … その回の受付管理（列は従来どおり）
      ├─→ データベーススプレッドシート … 全開催回を蓄積（次回の呼び出し用）
      ├─→ Google Drive … プロフィール写真
      └─→ Gmail … 申込者への自動返信・事務局への通知
```

フォームの表示内容・料金はすべて `apply/config.json` で決まります。
管理画面はこのファイルを書き換えているだけなので、
GAS を触らずに設定を変更できます。

## 開発者向け

```bash
node gas/tests/mapping.test.js            # 受付シートの列マッピングと重複判定

npm i --no-save jsdom                     # 下のテストに必要（初回のみ）
node apply/tests/sns.test.mjs             # SNSリンク欄が送信時に拾われるか
node apply/tests/booth.test.mjs           # ブース選択・料金・持ち込み物品の表示
node apply/tests/photo.test.mjs           # 写真が送れない場合でも申込できるか
node admin/tests/config-editor.test.mjs   # 管理画面の読み込み・保存・合い言葉
```

- 新しい開催回を始める手順 → [`docs/MIGRATION.md`](docs/MIGRATION.md)
- データベースの列定義 → [`docs/DATABASE.md`](docs/DATABASE.md)
