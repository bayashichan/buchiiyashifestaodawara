# ぶち癒しフェスタ 出展申込システム

| フォルダ | 内容 |
|---|---|
| `apply/` | 出展者が入力する申込フォーム（GitHub Pages で公開） |
| `admin/` | 事務局用の管理画面 |
| `gas/` | バックエンド（Google Apps Script に貼り付けて使用） |
| `docs/` | 移行手順・データベース仕様 |

## 使う人向け

- **早割ON/OFF・ブースの満枠切り替え** → `admin/quick-settings.html`
- **料金・ブース・質問項目・メール文面・開催回の切り替え** → `admin/config-editor.html`

どちらも初回だけ GitHub の接続設定が必要です。詳しくは
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
node gas/tests/mapping.test.js   # 受付シートの列マッピングと重複判定のテスト
```

- 新しい開催回を始める手順 → [`docs/MIGRATION.md`](docs/MIGRATION.md)
- データベースの列定義 → [`docs/DATABASE.md`](docs/DATABASE.md)
