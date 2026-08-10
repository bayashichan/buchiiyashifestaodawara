#!/usr/bin/env node
/**
 * 申込フォームと管理画面を1枚の自己完結HTMLに束ね、テスト用のデモを作る。
 *
 * 管理画面は Apps Script が無いとログインすらできないため、GAS を用意する前は
 * 画面を確認する手段が無い。そこで通信部分だけをブラウザ内で模擬し、
 * URL を開くだけで両方を触れるようにする。
 *
 *     node tools/build-demo.js [出力先]        既定: demo/index.html
 *
 * 模擬するのは通信の外側だけで、料金計算・バリデーション・ブース別の可否判定は
 * apply/config-schema.js の実物をそのまま動かす。したがって金額は本番と一致する。
 *
 * 生成物は本番に配信されない（GitHub Pages に置きたくない場合は demo/ を
 * .gitignore するか、生成物をコミットせず手元で開く）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/**
 * 差し込む中身は必ず関数で渡す。
 * 置換文字列をそのまま渡すと `$&` などが特殊解釈され、
 * ソース中の正規表現（例: form-renderer.js の '\\$&'）で中身が壊れる。
 */
const insert = (html, pattern, content) => html.replace(pattern, () => content);

/** デモの管理パスワードと認証コード。実物とは無関係の固定値。 */
const DEMO_PASSWORD = 'demo';
const DEMO_AUTH_CODE = '1234';

/** 設定を差し込む目印。ビルド時ではなくブラウザ側で置換する。 */
const CONFIG_TOKEN = '__DEMO_CONFIG_JSON__';

// ========================================
// デモ用の設定
// ========================================

/**
 * 公開中の config.json をデモ向けに加工する。
 *
 * - 送信先URLを架空のものにする（実物のGASのURLをデモに載せない）
 * - メール文面の3桁以上の数字を伏せる（振込先の店番・口座番号）
 *   公開中の config.json には実物が入っているが、配布面を増やさないため。
 */
function demoConfig() {
  const cfg = JSON.parse(read('apply', 'config.json'));

  cfg.integration = Object.assign({}, cfg.integration, {
    gasUrl: 'https://demo.invalid/exec',
    workerUrl: '',
    configJsonUrl: '',
    liffId: ''
  });

  cfg.email = cfg.email || {};
  Object.keys(cfg.email).forEach((k) => {
    if (typeof cfg.email[k] === 'string') {
      cfg.email[k] = cfg.email[k].replace(/\d{3,}/g, (m) => '●'.repeat(m.length));
    }
  });

  return cfg;
}

// ========================================
// 申込フォーム側
// ========================================

/** apply/index.html を1ファイル化する。設定は CONFIG_TOKEN のまま残す。 */
function buildFormDoc() {
  let html = read('apply', 'index.html');

  // 外部リソースは CSP で遮断されるので落とす。
  // LIFF は script.js が typeof で守っているため、無くても動く。
  html = html
    .replace(/\s*<link rel="preconnect"[^>]*>/g, '')
    .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '')
    .replace(/\s*<!-- LIFF SDK[^>]*-->\s*<script charset="utf-8" src="https:\/\/static\.line-scdn\.net[^>]*><\/script>/g, '');

  html = insert(html, '<link rel="stylesheet" href="style.css">',
    '<style>\n' + read('apply', 'style.css') + '\n</style>');

  const scripts = [
    ['config-schema.js', read('apply', 'config-schema.js')],
    ['form-renderer.js', read('apply', 'form-renderer.js')],
    ['option-renderer.js', read('apply', 'option-renderer.js')],
    ['repeater.js', read('apply', 'repeater.js')],
    ['script.js', read('apply', 'script.js')]
  ];

  // モックは script.js の DOMContentLoaded より先に fetch を差し替える必要があるため、
  // すべての実スクリプトより前に置く。
  const bundle =
    '<script>\n' + formMock() + '\n</script>\n' +
    scripts.map(([name, src]) =>
      '<script>\n/* ==== apply/' + name + ' ==== */\n' + src + '\n</script>'
    ).join('\n');

  html = insert(html,
    /<script src="config-schema\.js"><\/script>[\s\S]*?<script src="script\.js"><\/script>/,
    bundle);

  return html;
}

/** 申込フォーム内で動く模擬層 */
function formMock() {
  return `
/* ==== デモ用モック（tools/build-demo.js が生成）==== */
(function () {
  'use strict';

  var DEMO_CONFIG = ${CONFIG_TOKEN};
  var AUTH_CODE = '${DEMO_AUTH_CODE}';

  /** 最上位フレームの共有状態（設定の受け渡しに使う） */
  function top() {
    try { return window.top.__DEMO__ || null; } catch (e) { return null; }
  }

  function jsonRes(obj) {
    return new Response(JSON.stringify(obj), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // 郵便番号→住所。外部APIは遮断されるので、数件だけ手元で持つ。
  var ZIP = {
    '2500011': { address1: '神奈川県', address2: '小田原市', address3: '栄町' },
    '1000001': { address1: '東京都',   address2: '千代田区', address3: '千代田' },
    '5300001': { address1: '大阪府',   address2: '大阪市北区', address3: '梅田' },
    '0600001': { address1: '北海道',   address2: '札幌市中央区', address3: '北一条西' }
  };

  var realFetch = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    init = init || {};

    if (url.indexOf('config.json') >= 0) {
      var live = top();
      return Promise.resolve(jsonRes(live && live.config ? live.config : DEMO_CONFIG));
    }

    if (url.indexOf('zipcloud') >= 0) {
      var m = url.match(/zipcode=(\\d+)/);
      var hit = m && ZIP[m[1]];
      return wait(350).then(function () {
        return jsonRes(hit ? { status: 200, results: [hit] } : { status: 200, results: null });
      });
    }

    if (init.body instanceof FormData) {
      return wait(600).then(function () { return jsonRes(handleGas(init.body)); });
    }

    return Promise.reject(new Error('デモでは外部通信を行いません: ' + url));
  };

  /** GAS の応答を組み立てる。金額は実物の computeQuote で計算する。 */
  function handleGas(fd) {
    var action = String(fd.get('action') || '');

    if (action === 'submit') {
      var cfg = normalizeConfig(top() && top().config ? top().config : DEMO_CONFIG);
      var quote = computeQuote(cfg, {
        boothId: fd.get('boothId') || '',
        options: safeParse(fd.get('selectedOptions'), {}),
        isMember: String(fd.get('isMember')) === '1'
      });
      return {
        success: true,
        total: quote.total,
        breakdown: formatBreakdown(quote),
        mailSent: true,
        mailQueued: false,
        notices: quote.notices,
        demoQuote: quote
      };
    }

    if (action === 'send_auth_code') {
      return { success: true, count: 1 };
    }

    if (action === 'verify_auth_code') {
      if (String(fd.get('code') || '').trim() !== AUTH_CODE) {
        return { success: false, code: 'MISMATCH',
                 error: 'デモの認証コードは ' + AUTH_CODE + ' です。' };
      }
      return { success: true, list: pastSubmissions() };
    }

    return { success: false, error: 'デモでは未対応の操作です: ' + action };
  }

  function safeParse(s, fallback) {
    try { return JSON.parse(s); } catch (e) { return fallback; }
  }

  /** 架空の過去申込。復元の動きを見せるためだけのもの。 */
  function pastSubmissions() {
    return [{
      eventName: 'ぶち癒しフェスタ（過去回・デモ用の架空データ）',
      submittedAt: '2025/04/12 10:32',
      exhibitorName: 'サンプル出展者',
      answers: {
        name: 'デモ 太郎',
        furigana: 'デモ タロウ',
        email: 'demo@example.com',
        phoneNumber: '090-0000-0000',
        postalCode: '2500011',
        address: '神奈川県小田原市栄町1-1-1',
        exhibitorName: 'サンプル出展者',
        cq_menu: 'ハンドマッサージ 20分 / 3,000円',
        cq_intro: 'デモ用に用意した架空の紹介文です。',
        snsLinks: [{ type: 'Instagram', url: 'https://example.com/demo' }]
      }
    }];
  }

  // ========================================
  // 画面側の差し替え
  // ========================================
  document.addEventListener('DOMContentLoaded', function () {
    // 完了モーダル：実際には送信していないことを明示する
    var origComplete = window.showComplete;
    window.showComplete = function (result) {
      if (typeof origComplete === 'function') origComplete(result);
      var msg = document.getElementById('completeMessage');
      if (msg) {
        msg.innerHTML =
          '<b>デモのため、実際には送信されていません。</b><br>' +
          'メールもスプレッドシートへの保存も行われません。<br><br>' +
          'サーバー側で再計算した合計は <b>' +
          formatYen(result && result.total ? result.total : 0) + '</b> です。';
      }
      var closeBtn = document.querySelector('#completeModal .submit-btn');
      if (closeBtn) {
        closeBtn.onclick = function () {
          document.getElementById('completeModal').classList.add('hidden');
        };
      }
    };
  });
})();
`.trim();
}

// ========================================
// 管理画面側
// ========================================

function buildAdminDoc() {
  let html = read('admin', 'index.html');

  html = html.replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '');
  html = insert(html, '<link rel="stylesheet" href="style.css">',
    '<style>\n' + read('admin', 'style.css') + '\n</style>');

  const bundle =
    '<script>\n' + adminMock() + '\n</script>\n' +
    '<script>\n/* ==== apply/config-schema.js ==== */\n' + read('apply', 'config-schema.js') + '\n</script>\n' +
    '<script>\n/* ==== admin/script.js ==== */\n' + read('admin', 'script.js') + '\n</script>';

  html = insert(html,
    /<script src="\.\.\/apply\/config-schema\.js"><\/script>\s*<script src="script\.js"><\/script>/,
    bundle);

  return html;
}

function adminMock() {
  return `
/* ==== デモ用モック（tools/build-demo.js が生成）==== */
(function () {
  'use strict';

  var PASSWORD = '${DEMO_PASSWORD}';

  function top() {
    try { return window.top.__DEMO__ || null; } catch (e) { return null; }
  }

  function jsonRes(obj) {
    return new Response(JSON.stringify(obj), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // パスワード入力の手間を省く（管理画面は保存済みパスワードを読む）
  try { localStorage.setItem('eventAdminPassword', PASSWORD); } catch (e) {}

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    init = init || {};

    if (url.indexOf('config.json') >= 0) {
      return Promise.resolve(jsonRes(top() ? top().config : {}));
    }
    if (init.body instanceof FormData) {
      return wait(450).then(function () { return jsonRes(handleAdmin(init.body)); });
    }
    return Promise.reject(new Error('デモでは外部通信を行いません: ' + url));
  };

  function handleAdmin(fd) {
    var action = String(fd.get('action') || '');

    if (String(fd.get('password') || '') !== PASSWORD) {
      return { success: false, code: 'BAD_PASSWORD',
               error: 'パスワードが正しくありません。（デモのパスワードは ' + PASSWORD + '）' };
    }

    var shared = top();
    var cfg = shared ? shared.config : {};

    switch (action) {
      case 'admin_login':
        return { success: true };

      case 'admin_get_config':
        return { success: true, config: cfg };

      case 'admin_save_config':
        return saveConfig(fd);

      case 'admin_status':
        return status(cfg);

      case 'admin_preview_setup':
        return previewSetup(cfg);

      case 'admin_setup_event':
        return setupEvent(cfg);

      case 'admin_migrate':
        return migrate(fd);

      case 'admin_send_digest':
        return { success: true, count: 0 };

      case 'admin_process_queue':
        return { success: true, sent: 0, remaining: 0 };

      default:
        return { success: false, error: 'デモでは未対応の操作です: ' + action };
    }
  }

  /** 保存はメモリ上だけ。GitHub には書かない。 */
  function saveConfig(fd) {
    var incoming;
    try { incoming = JSON.parse(fd.get('config')); }
    catch (e) { return { success: false, error: '設定の形式が不正です。' }; }

    var normalized = normalizeConfig(incoming);
    var issues = validateConfig(normalized);
    var errors = issues.filter(function (i) { return i.level === 'error'; });

    if (errors.length && fd.get('ignoreErrors') !== '1') {
      return { success: false, code: 'VALIDATION', issues: issues,
               error: '設定に問題があります。' };
    }

    var shared = top();
    if (shared) shared.setConfig(normalized);
    return { success: true, issues: issues };
  }

  function status(cfg) {
    return {
      success: true,
      eventName: (cfg.event || {}).name || '',
      mailQuotaRemaining: 87,
      properties: {
        CONFIG_JSON_URL: 'https://demo.invalid/config.json',
        ADMIN_PASSWORD: '設定済み',
        GITHUB_TOKEN: '設定済み',
        GITHUB_REPO: 'demo/demo（デモ用の架空値）',
        CURRENT_SPREADSHEET_ID: '',
        DATABASE_SPREADSHEET_ID: '',
        DRIVE_ROOT_FOLDER_ID: '設定済み',
        ADMIN_EMAIL: '設定済み'
      }
    };
  }

  /** 実際に作られる列の目安。実物は gas/sheets.gs が組み立てる。 */
  function headerPreview(cfg) {
    var labels = ['申込日時', '開催回'];
    (cfg.fields || []).forEach(function (f) {
      if (f.type !== 'heading') labels.push(f.label || f.id);
    });
    ((cfg.pricing || {}).options || []).forEach(function (o) {
      labels.push(o.label || o.id);
    });
    labels.push('会員割引', '早割', '合計金額');
    return labels;
  }

  function previewSetup(cfg) {
    var name = (cfg.event || {}).name || '（イベント名が未設定）';
    return {
      success: true,
      eventName: name,
      plan: [
        { item: 'マスターDB', action: '新規作成（デモのため作成しません）' },
        { item: 'イベント用スプレッドシート', action: '新規作成（' + name + ' 申込データ）' },
        { item: '画像保存フォルダ', action: '新規作成（' + name + '）' }
      ],
      headerPreview: headerPreview(cfg),
      issues: validateConfig(normalizeConfig(cfg))
    };
  }

  function setupEvent(cfg) {
    var name = (cfg.event || {}).name || '';
    return {
      success: true,
      eventName: name,
      steps: [
        { step: 'マスターDB', status: 'skipped',
          message: 'デモのため作成していません（実際はGoogleドライブに作られます）' },
        { step: 'イベント用スプレッドシート', status: 'skipped',
          message: 'デモのため作成していません（' + name + ' 申込データ）' },
        { step: '画像保存フォルダ', status: 'skipped',
          message: 'デモのため作成していません' },
        { step: '自動処理', status: 'skipped',
          message: 'デモのためトリガーは設定していません' }
      ]
    };
  }

  function migrate(fd) {
    return {
      success: true,
      message: 'デモのため実際の移送は行っていません。対応表だけを表示しています。',
      mapping: [
        { from: 'お名前', to: 'name' },
        { from: 'メールアドレス', to: 'email' },
        { from: '出展者名', to: 'exhibitorName' }
      ],
      unmapped: ['旧・備考欄']
    };
  }

  // ========================================
  // プレビュー用 iframe の差し替え
  // ========================================
  document.addEventListener('DOMContentLoaded', function () {
    var frame = document.getElementById('previewFrame');
    if (!frame) return;

    // openPreview は src にパスを入れるが、デモにはそのファイルが無い。
    // 代入を捕まえて、いま編集中の設定でフォームを組み立て直す。
    Object.defineProperty(frame, 'src', {
      configurable: true,
      get: function () { return ''; },
      set: function () {
        var shared = top();
        if (!shared) return;
        var draft = null;
        try { draft = JSON.parse(sessionStorage.getItem('formPreviewConfig')); } catch (e) {}
        frame.srcdoc = shared.buildFormDoc(draft || shared.config);
      }
    });
  });
})();
`.trim();
}

// ========================================
// シェル
// ========================================

function buildShell(formDoc, adminDoc, config) {
  const docs = JSON.stringify({ form: formDoc, admin: adminDoc })
    .replace(/</g, '\\u003c');
  const cfg = JSON.stringify(config).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>【デモ】出展申込フォーム／管理画面</title>
<style>
  /*
   * この外枠は「足場」であって作品ではない。配色はアプリ側のワインとピンクに
   * 寄せた中間色で、暗い枠に明るいアプリという対比そのものが
   * 「囲みの中は実物ではない」という境界線になる。
   * 閲覧側のテーマに追随せず常に暗いのは、その境界を消さないための選択。
   */
  :root {
    --ground:  #1a1016;   /* プラム寄りの黒 */
    --surface: #251722;
    --rule:    #3d2a33;
    --muted:   #c9b8c0;
    --bright:  #f5eef1;
    --accent:  #ffa3da;   /* アプリの accentColor */
    --warn:    #8f1d1d;
    --flag:    #ffd166;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    display: flex; flex-direction: column;
    background: var(--ground); color: var(--bright);
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP",
                 "Yu Gothic UI", sans-serif;
  }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  .demo-banner {
    flex: 0 0 auto;
    background: var(--warn); color: #fff;
    padding: 0.4rem 0.7rem;
    font-size: 0.76rem; line-height: 1.35; font-weight: 700; text-align: center;
    text-wrap: balance;
  }

  .tabs { display: flex; flex: 0 0 auto; background: var(--surface); }
  .tabs button {
    flex: 1; appearance: none; border: 0; background: transparent;
    color: var(--muted); font: inherit; font-size: 0.9rem; font-weight: 600;
    padding: 0.7rem 0.4rem; cursor: pointer;
    border-bottom: 3px solid transparent;
  }
  .tabs button[aria-selected="true"] {
    color: var(--bright); border-bottom-color: var(--accent);
  }

  .hint { flex: 0 0 auto; background: var(--surface); border-top: 1px solid var(--rule); }
  .hint > summary {
    list-style: none; cursor: pointer;
    color: var(--muted); font-size: 0.74rem; padding: 0.35rem 0.9rem;
    display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;
  }
  .hint > summary::-webkit-details-marker { display: none; }
  .hint > summary::after { content: '▼'; font-size: 0.6rem; opacity: 0.7; }
  .hint[open] > summary::after { content: '▲'; }

  .hint-body {
    color: var(--muted); font-size: 0.74rem; line-height: 1.65;
    padding: 0 0.9rem 0.6rem;
    display: flex; flex-direction: column; gap: 0.4rem;
  }
  .hint-body p { margin: 0; }
  .hint-body code {
    background: var(--rule); color: var(--accent);
    padding: 0.05rem 0.35rem; border-radius: 3px; font-size: 0.76rem;
  }
  .hint-body button {
    align-self: flex-start;
    appearance: none; border: 1px solid var(--rule); background: var(--ground);
    color: var(--bright); font: inherit; font-size: 0.72rem;
    padding: 0.3rem 0.7rem; border-radius: 5px; cursor: pointer;
  }
  .stale-flag { color: var(--flag); font-weight: 700; }

  .panes { position: relative; flex: 1 1 auto; min-height: 0; background: #fff; }
  .panes iframe {
    position: absolute; inset: 0;
    width: 100%; height: 100%; border: 0; background: #fff;
  }
  .panes iframe[hidden] { display: none; }
</style>
</head>
<body>

<div class="demo-banner">デモ画面です。申込・保存・メール送信は行われません</div>

<div class="tabs" role="tablist">
  <button role="tab" id="tab-form"  aria-selected="true"  aria-controls="pane-form">申込フォーム</button>
  <button role="tab" id="tab-admin" aria-selected="false" aria-controls="pane-admin">管理画面</button>
</div>

<details class="hint" id="hint">
  <summary id="hintSummary">使い方とデモの制約</summary>
  <div class="hint-body" id="hintBody"></div>
</details>

<div class="panes">
  <iframe id="pane-form"  title="申込フォーム（デモ）"></iframe>
  <iframe id="pane-admin" title="管理画面（デモ）" hidden></iframe>
</div>

<script id="demo-docs" type="application/json">${docs}</script>
<script>
(function () {
  'use strict';

  var DOCS = JSON.parse(document.getElementById('demo-docs').textContent);
  var BASE = ${cfg};

  function serialize(obj) {
    return JSON.stringify(obj).replace(/</g, '\\\\u003c');
  }

  var formFrame  = document.getElementById('pane-form');
  var adminFrame = document.getElementById('pane-admin');

  window.__DEMO__ = {
    password: ${JSON.stringify(DEMO_PASSWORD)},
    authCode: ${JSON.stringify(DEMO_AUTH_CODE)},
    config: JSON.parse(JSON.stringify(BASE)),

    /** いまの設定を差し込んだ申込フォームの文書を組み立てる */
    buildFormDoc: function (cfg) {
      return DOCS.form.split(${JSON.stringify(CONFIG_TOKEN)}).join(serialize(cfg || this.config));
    },

    /** 管理画面が保存したときに呼ばれる。次にフォームを開くとき作り直す。 */
    setConfig: function (cfg) {
      this.config = cfg;
      formStale = true;
      renderHint();
    }
  };

  var formStale = true;
  var adminLoaded = false;
  var current = 'form';

  function loadForm() {
    formFrame.srcdoc = window.__DEMO__.buildFormDoc();
    formStale = false;
    renderHint();
  }

  function show(which) {
    current = which;
    var isForm = which === 'form';

    document.getElementById('tab-form').setAttribute('aria-selected', isForm);
    document.getElementById('tab-admin').setAttribute('aria-selected', !isForm);
    formFrame.hidden = !isForm;
    adminFrame.hidden = isForm;

    if (isForm && formStale) loadForm();
    if (!isForm && !adminLoaded) {
      adminFrame.srcdoc = DOCS.admin;
      adminLoaded = true;
    }
    renderHint();
  }

  function renderHint() {
    var body = document.getElementById('hintBody');
    var summary = document.getElementById('hintSummary');

    if (current === 'admin') {
      summary.textContent = '使い方とデモの制約（管理画面）';
      body.innerHTML =
        '<p>パスワードは <code>' + window.__DEMO__.password + '</code>（入力済み）。' +
        '保存してもGitHubには書き込まず、このページ上の設定だけが変わります。' +
        'ページを開き直せば元に戻ります。</p>' +
        '<p>スプレッドシートやフォルダの作成、メール送信、過去データの移送は行いません。' +
        'メール文面の振込先の数字はデモ用に伏せてあります。</p>';
    } else {
      summary.innerHTML = '使い方とデモの制約（申込フォーム）' +
        (formStale ? ' <span class="stale-flag">・未反映の変更あり</span>' : '');
      body.innerHTML =
        '<p>料金計算・必須チェック・ブース別のオプション可否は本番と同じコードで動きます。' +
        '郵便番号は <code>2500011</code> などで住所検索を試せます。' +
        'リピーター認証の確認コードは <code>' + window.__DEMO__.authCode + '</code>。</p>' +
        '<p>送信しても実際には送られません。画像もどこにも保存されません。</p>' +
        (formStale
          ? '<p class="stale-flag">管理画面の変更はまだ反映されていません。</p>'
          : '') +
        '<button type="button" id="reloadForm">フォームを再読込</button>';
      var btn = document.getElementById('reloadForm');
      if (btn) btn.addEventListener('click', loadForm);
    }
  }

  document.getElementById('tab-form').addEventListener('click', function () { show('form'); });
  document.getElementById('tab-admin').addEventListener('click', function () { show('admin'); });

  show('form');
})();
</script>
</body>
</html>
`;
}

// ========================================

/**
 * 外側の <html>/<head>/<body> を取り除き、中身だけにする。
 *
 * 公開ページとして配る場合、置き場所側が doctype と head/body を用意するため、
 * こちらが重ねて持つと入れ子になって崩れる。<title> は置き場所側で付けられるので落とす。
 * 埋め込んだフォーム・管理画面の文書は JSON 内で < を \\u003c に逃がしてあるので、
 * ここでの境界検出には引っかからない。
 */
function toFragment(doc) {
  const head = doc.slice(doc.indexOf('<head>') + 6, doc.indexOf('</head>'));
  const body = doc.slice(doc.indexOf('<body>') + 6, doc.indexOf('</body>'));
  const style = head.slice(head.indexOf('<style>'), head.indexOf('</style>') + 8);
  return style.trim() + '\n\n' + body.trim() + '\n';
}

/**
 * 差し込みが実際に効いたかを確かめる。
 * 元ファイルの構造が変わって置換が空振りすると、見た目は生成できてしまうため。
 */
function verify(formDoc, adminDoc) {
  const problems = [];
  const must = (doc, label, cond, message) => { if (!cond) problems.push(label + ': ' + message); };

  [['申込フォーム', formDoc], ['管理画面', adminDoc]].forEach(([label, doc]) => {
    must(doc, label, !/<script\s+src=/.test(doc), '外部スクリプトが残っています');
    must(doc, label, !/<link[^>]+stylesheet/.test(doc), '外部スタイルシートが残っています');
    must(doc, label, !doc.includes('fonts.googleapis'), '外部フォントの参照が残っています');
    must(doc, label, doc.includes('function computeQuote'), 'config-schema.js が入っていません');
    must(doc, label, doc.includes('デモ用モック'), 'モックが入っていません');
  });

  must(formDoc, '申込フォーム', formDoc.includes('function initApp'), 'script.js が入っていません');
  must(formDoc, '申込フォーム',
    formDoc.split(CONFIG_TOKEN).length === 2, '設定の差し込み口が1つではありません');
  must(adminDoc, '管理画面', adminDoc.includes('function renderAll'), 'admin/script.js が入っていません');

  if (problems.length) {
    console.error('デモの生成に失敗しました:');
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  const fragment = args.includes('--fragment');
  const out = args.filter((a) => !a.startsWith('--'))[0]
    || path.join(ROOT, 'demo', 'index.html');

  const formDoc = buildFormDoc();
  const adminDoc = buildAdminDoc();
  verify(formDoc, adminDoc);

  const shell = buildShell(formDoc, adminDoc, demoConfig());
  const html = fragment ? toFragment(shell) : shell;

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);

  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log('デモを生成しました: ' + path.relative(ROOT, out) + '（' + kb + ' KB）'
    + (fragment ? '（外側のタグなし）' : ''));
  console.log('管理パスワード: ' + DEMO_PASSWORD + ' / 認証コード: ' + DEMO_AUTH_CODE);
}

main();
