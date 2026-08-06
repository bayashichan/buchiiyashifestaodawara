/**
 * 管理画面
 *
 * 主催者がパスワード1つでフォームの中身を変更できるようにします。
 * GitHub のトークンはこの画面には持たせず、Apps Script 側が代理で書き込みます。
 */

var state = {
  gasUrl: '',
  password: '',
  config: null,
  dirty: false
};

var PASSWORD_KEY = 'eventAdminPassword';
var PREVIEW_KEY = 'formPreviewConfig';

// ========================================
// 起動
// ========================================
document.addEventListener('DOMContentLoaded', function () {
  bindStaticHandlers();

  // 送信先は公開されている config.json から拾う（同一オリジン）
  fetch('../apply/config.json?t=' + Date.now())
    .then(function (r) { return r.json(); })
    .then(function (raw) {
      var cfg = normalizeConfig(raw);
      state.gasUrl = (cfg.integration || {}).gasUrl || '';
      if (!state.gasUrl) {
        showLoginError('送信先(Apps ScriptのURL)が設定されていません。config.json をご確認ください。');
      }
    })
    .catch(function () {
      showLoginError('設定ファイルを読み込めませんでした。');
    });

  var saved = localStorage.getItem(PASSWORD_KEY);
  if (saved) {
    document.getElementById('passwordInput').value = saved;
  }
});

function bindStaticHandlers() {
  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('passwordInput').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') login();
  });

  document.querySelectorAll('.card-head').forEach(function (head) {
    head.addEventListener('click', function () {
      var name = head.getAttribute('data-card');
      var body = document.querySelector('[data-body="' + name + '"]');
      var open = body.classList.toggle('hidden') === false;
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  document.getElementById('saveBtn').addEventListener('click', save);
  document.getElementById('previewBtn').addEventListener('click', openPreview);
  document.getElementById('closePreviewBtn').addEventListener('click', function () {
    document.getElementById('previewModal').classList.add('hidden');
  });

  document.getElementById('addBoothBtn').addEventListener('click', addBooth);
  document.getElementById('addOptionBtn').addEventListener('click', addOption);
  document.getElementById('addFieldBtn').addEventListener('click', addField);
  document.getElementById('addMediaBtn').addEventListener('click', addMedia);

  document.getElementById('previewSetupBtn').addEventListener('click', previewSetup);
  document.getElementById('setupBtn').addEventListener('click', runSetup);
  document.getElementById('migratePreviewBtn').addEventListener('click', function () { runMigrate(true); });
  document.getElementById('migrateBtn').addEventListener('click', function () { runMigrate(false); });
  document.getElementById('sendDigestBtn').addEventListener('click', sendDigest);
  document.getElementById('processQueueBtn').addEventListener('click', processQueue);

  // 個別に扱う必要のある入力
  document.getElementById('earlyBirdEnabled').addEventListener('change', function () {
    updateEarlyBirdStatus();
  });
  document.getElementById('earlyBirdDeadline').addEventListener('change', function (e) {
    state.config.earlyBird.deadline = e.target.value;
    markDirty();
    updateEarlyBirdStatus();
  });
  document.getElementById('memberDiscountAmount').addEventListener('input', function (e) {
    state.config.pricing.memberDiscount.amount = num(e.target.value);
    markDirty();
  });
  document.getElementById('categoryList').addEventListener('input', function (e) {
    state.config.categories = e.target.value.split('\n')
      .map(function (s) { return s.trim(); }).filter(Boolean);
    markDirty();
  });
  document.getElementById('codeDigits').addEventListener('input', function (e) {
    state.config.repeater.codeDigits = num(e.target.value) || 4;
    markDirty();
  });
  document.getElementById('maxAttempts').addEventListener('input', function (e) {
    state.config.repeater.maxAttempts = num(e.target.value) || 5;
    markDirty();
  });
}

// ========================================
// 通信
// ========================================

/** GAS へは multipart で送る（プリフライトを起こさないため） */
async function api(action, params) {
  if (!state.gasUrl) throw new Error('送信先が設定されていません');

  var fd = new FormData();
  fd.set('action', action);
  fd.set('password', state.password);
  Object.keys(params || {}).forEach(function (k) {
    fd.set(k, params[k]);
  });

  var res = await fetch(state.gasUrl, { method: 'POST', body: fd, redirect: 'follow' });
  if (!res.ok) throw new Error('通信に失敗しました（HTTP ' + res.status + '）');

  var text = await res.text();
  var data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('サーバーからの応答が不正です');
  }
  return data;
}

// ========================================
// ログイン
// ========================================
async function login() {
  var input = document.getElementById('passwordInput');
  var btn = document.getElementById('loginBtn');
  var password = input.value.trim();

  if (!password) { showLoginError('パスワードを入力してください'); return; }
  if (!state.gasUrl) { showLoginError('送信先が設定されていません'); return; }

  state.password = password;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 確認中';
  showLoginError('');

  try {
    var res = await api('admin_login', {});
    if (!res.success) { showLoginError(res.error || 'ログインできませんでした'); return; }

    if (document.getElementById('rememberPassword').checked) {
      localStorage.setItem(PASSWORD_KEY, password);
    } else {
      localStorage.removeItem(PASSWORD_KEY);
    }

    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainScreen').classList.remove('hidden');
    await loadAll();

  } catch (err) {
    showLoginError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'ログイン';
  }
}

function showLoginError(message) {
  document.getElementById('loginError').textContent = message || '';
}

// ========================================
// 読み込み
// ========================================
async function loadAll() {
  var res = await api('admin_get_config', {});
  if (!res.success) { toast(res.error || '設定を取得できませんでした', 'error'); return; }

  state.config = normalizeConfig(res.config);
  state.dirty = false;
  renderAll();
  refreshStatus();
}

async function refreshStatus() {
  try {
    var res = await api('admin_status', {});
    if (!res.success) return;

    var chip = document.getElementById('quotaChip');
    chip.textContent = 'メール残り ' + res.mailQuotaRemaining;
    chip.classList.toggle('is-low', res.mailQuotaRemaining < 10);

    var p = res.properties || {};
    document.getElementById('propStatus').innerHTML =
      [['設定ファイルのURL', p.CONFIG_JSON_URL],
       ['管理パスワード', p.ADMIN_PASSWORD],
       ['GitHubトークン', p.GITHUB_TOKEN],
       ['画像フォルダ', p.DRIVE_ROOT_FOLDER_ID],
       ['管理者メール', p.ADMIN_EMAIL]]
        .map(function (r) {
          return '<div>' + (r[1] ? '✅' : '⚠️') + ' ' + esc(r[0]) +
                 (r[1] ? '' : '（未設定）') + '</div>';
        }).join('') +
      '<div style="margin-top:0.4rem">リポジトリ: ' + (esc(p.GITHUB_REPO) || '未設定') + '</div>';

    document.getElementById('storageInfo').innerHTML =
      sheetLink('今回の申込データ', p.CURRENT_SPREADSHEET_ID) +
      sheetLink('マスターDB（過去履歴）', p.DATABASE_SPREADSHEET_ID);

  } catch (err) {
    console.error(err);
  }
}

function sheetLink(label, id) {
  if (!id) return '<div>⚠️ ' + esc(label) + ': 未作成</div>';
  return '<div>📄 ' + esc(label) + ': <a href="https://docs.google.com/spreadsheets/d/' +
         esc(id) + '/edit" target="_blank" rel="noopener">開く</a></div>';
}

// ========================================
// 描画
// ========================================
function renderAll() {
  bindSimpleFields();
  renderMedia();
  renderBooths();
  renderOptions();
  renderFields();
  renderMatrix();
  renderIssues();
  updateEarlyBirdStatus();

  document.getElementById('barEventName').textContent = (state.config.event || {}).name || '';
  document.getElementById('categoryList').value = (state.config.categories || []).join('\n');
  document.getElementById('memberDiscountAmount').value =
    state.config.pricing.memberDiscount.amount || 0;
  document.getElementById('codeDigits').value = state.config.repeater.codeDigits || 4;
  document.getElementById('maxAttempts').value = state.config.repeater.maxAttempts || 5;
  document.getElementById('earlyBirdDeadline').value =
    toDatetimeLocal(state.config.earlyBird.deadline);
}

/** data-bind="a.b.c" の入力欄をモデルと結びつける */
function bindSimpleFields() {
  document.querySelectorAll('[data-bind]').forEach(function (el) {
    var path = el.getAttribute('data-bind');
    var value = getPath(state.config, path);

    if (el.type === 'checkbox') {
      el.checked = !!value;
    } else {
      el.value = value == null ? '' : value;
    }

    if (el.dataset.bound) return;
    el.dataset.bound = '1';

    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input',
      function () {
        setPath(state.config, path, el.type === 'checkbox' ? el.checked : el.value);
        markDirty();
        if (path === 'event.name') {
          document.getElementById('barEventName').textContent = el.value;
        }
      });
  });
}

function updateEarlyBirdStatus() {
  var eb = state.config.earlyBird || {};
  var el = document.getElementById('earlyBirdStatus');
  var detail = document.getElementById('earlyBirdDetail');
  detail.classList.toggle('hidden', !eb.enabled);

  if (!eb.enabled) { el.textContent = '使わない（すべて通常価格）'; return; }
  if (!eb.deadline) { el.textContent = '⚠️ 締切日時が未設定です'; return; }

  var d = parseDeadline(eb.deadline);
  if (!d) { el.textContent = '⚠️ 締切日時を読み取れません'; return; }

  el.textContent = d.getTime() > Date.now()
    ? '早割期間中（' + (d.getMonth() + 1) + '/' + d.getDate() + ' まで）'
    : '締切済み（通常価格で表示中）';
}

// ---------- 画像 ----------
var MEDIA_POSITIONS = [
  ['headerBelow', 'ヘッダーの下'],
  ['sectionTop-basic', '基本情報の先頭'],
  ['sectionTop-exhibit', '出展内容の先頭'],
  ['sectionTop-options', 'オプションの先頭'],
  ['termsAbove', '規約の上'],
  ['footer', 'ページ最下部']
];

function renderMedia() {
  var host = document.getElementById('mediaList');
  host.innerHTML = '';

  (state.config.media || []).forEach(function (m, idx) {
    var item = el('div', 'item');
    item.appendChild(itemHead(m.caption || '画像 ' + (idx + 1), null, {
      onUp: idx > 0 ? function () { move(state.config.media, idx, -1); renderMedia(); } : null,
      onDown: idx < state.config.media.length - 1
        ? function () { move(state.config.media, idx, 1); renderMedia(); } : null,
      onDelete: function () { state.config.media.splice(idx, 1); markDirty(); renderMedia(); }
    }));

    item.appendChild(textField('画像のURL', m.url, function (v) { m.url = v; markDirty(); }, 'url'));
    item.appendChild(selectField('表示する位置', MEDIA_POSITIONS, m.position, function (v) {
      m.position = v; markDirty();
    }));
    item.appendChild(textField('キャプション（任意）', m.caption, function (v) {
      m.caption = v; markDirty();
    }));
    host.appendChild(item);
  });
}

function addMedia() {
  state.config.media.push({ id: 'media_' + Date.now(), url: '', position: 'headerBelow', caption: '' });
  markDirty();
  renderMedia();
}

// ---------- ブース ----------
function renderBooths() {
  var host = document.getElementById('boothList');
  host.innerHTML = '';
  document.getElementById('boothCount').textContent = (state.config.booths || []).length;

  state.config.booths.forEach(function (b, idx) {
    var item = el('div', 'item');
    item.appendChild(itemHead(b.name || '（名称未設定）', b.soldOut ? '満枠' : null, {
      onUp: idx > 0 ? function () { move(state.config.booths, idx, -1); renderBooths(); renderMatrix(); } : null,
      onDown: idx < state.config.booths.length - 1
        ? function () { move(state.config.booths, idx, 1); renderBooths(); renderMatrix(); } : null,
      onDelete: function () {
        if (!confirm('「' + (b.name || '無題') + '」を削除しますか？')) return;
        state.config.booths.splice(idx, 1);
        markDirty(); renderBooths(); renderMatrix(); renderIssues();
      }
    }));

    item.appendChild(textField('ブース名', b.name, function (v) {
      b.name = v; markDirty(); renderMatrix();
    }));
    item.appendChild(textField('説明（任意）', b.description, function (v) {
      b.description = v; markDirty();
    }));
    item.appendChild(textField('グループ名（任意。2つ以上で折りたたみ表示になります）',
      b.location, function (v) { b.location = v; markDirty(); }));

    var prices = el('div', 'grid-2');
    prices.appendChild(numberField('通常価格（円）', b.prices.regular, function (v) {
      b.prices.regular = v; markDirty(); renderIssues();
    }));
    prices.appendChild(numberField('早割価格（円）', b.prices.earlyBird, function (v) {
      b.prices.earlyBird = v; markDirty(); renderIssues();
    }));
    item.appendChild(prices);

    var checks = el('div', 'checks');
    checks.appendChild(checkbox('満枠にする', b.soldOut, function (v) {
      b.soldOut = v; markDirty(); renderBooths(); renderIssues();
    }));
    checks.appendChild(checkbox('セッション不可', b.prohibitSession, function (v) {
      b.prohibitSession = v; markDirty();
    }));
    item.appendChild(checks);

    item.appendChild(buildBoothOptions(b));
    host.appendChild(item);
  });
}

/**
 * ブースごとに、どのオプションを使えるかを設定する部分。
 * ブースの種類によってコンセントの可否などが変わるため、ここが主たる編集場所になる。
 */
function buildBoothOptions(booth) {
  var box = el('div', 'booth-options');
  var label = el('div', 'field-label');
  label.textContent = 'このブースで使えるオプション';
  box.appendChild(label);

  var boothScoped = (state.config.pricing.options || []).filter(function (o) {
    return o.enabled !== false && o.scope === 'booth';
  });

  if (!boothScoped.length) {
    var hint = el('p', 'hint');
    hint.textContent = 'ブースごとに設定するオプションがまだありません。';
    box.appendChild(hint);
    return box;
  }

  boothScoped.forEach(function (opt) {
    booth.options = booth.options || {};
    var per = booth.options[opt.id];
    var resolved = resolveOptionForBooth(opt, booth);

    var row = el('div', 'bo-row');

    var name = el('div', 'bo-name');
    name.textContent = opt.label || opt.id;
    if (!per) {
      var inherit = el('span', 'hint');
      inherit.style.marginLeft = '0.4rem';
      inherit.textContent = '（既定: ' + (opt.defaultAvailable !== false ? '使える' : '使えない') + '）';
      name.appendChild(inherit);
    }
    row.appendChild(name);

    if (opt.inputType === 'quantity') {
      var maxBox = el('div', 'bo-max');
      var maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.min = '0';
      maxInput.value = resolved.max;
      maxInput.title = '上限';
      maxInput.addEventListener('input', function () {
        booth.options[opt.id] = booth.options[opt.id] || { available: true };
        booth.options[opt.id].max = num(maxInput.value);
        booth.options[opt.id].available = num(maxInput.value) > 0;
        markDirty(); renderMatrix();
      });
      maxBox.appendChild(maxInput);
      row.appendChild(maxBox);
    }

    row.appendChild(toggleSwitch(resolved.available, function (v) {
      booth.options[opt.id] = booth.options[opt.id] || {};
      booth.options[opt.id].available = v;
      if (opt.inputType === 'quantity' && v && !booth.options[opt.id].max) {
        booth.options[opt.id].max = 1;
      }
      markDirty(); renderBooths(); renderMatrix();
    }));

    box.appendChild(row);
  });

  return box;
}

function addBooth() {
  state.config.booths.push({
    id: 'booth_' + Date.now().toString(36),
    name: '', description: '', location: '', imageUrl: '',
    prices: { regular: 0, earlyBird: 0 },
    soldOut: false, prohibitSession: false, options: {}
  });
  markDirty();
  renderBooths();
  renderMatrix();
}

// ---------- オプション ----------
var OPTION_INPUT_TYPES = [
  ['toggle', 'はい／いいえ'],
  ['quantity', '数量を選ぶ'],
  ['select', '選択肢から選ぶ']
];
var OPTION_SCOPES = [
  ['booth', 'ブースごとに設定'],
  ['global', 'ブースに関係なく表示']
];

function renderOptions() {
  var host = document.getElementById('optionList');
  host.innerHTML = '';
  document.getElementById('optionCount').textContent =
    (state.config.pricing.options || []).length;

  state.config.pricing.options.forEach(function (o, idx) {
    var item = el('div', 'item');
    item.appendChild(itemHead(o.label || '（名称未設定）',
      o.scope === 'global' ? '全ブース' : 'ブース別', {
        onUp: idx > 0 ? function () { move(state.config.pricing.options, idx, -1); renderOptions(); } : null,
        onDown: idx < state.config.pricing.options.length - 1
          ? function () { move(state.config.pricing.options, idx, 1); renderOptions(); } : null,
        onDelete: function () {
          if (!confirm('「' + (o.label || '無題') + '」を削除しますか？')) return;
          state.config.pricing.options.splice(idx, 1);
          markDirty(); renderOptions(); renderBooths(); renderMatrix(); renderIssues();
        }
      }));

    item.appendChild(textField('オプション名', o.label, function (v) {
      o.label = v; markDirty(); renderMatrix();
    }));
    item.appendChild(textField('説明（任意）', o.description, function (v) {
      o.description = v; markDirty();
    }));

    var g1 = el('div', 'grid-2');
    g1.appendChild(selectField('入力の種類', OPTION_INPUT_TYPES, o.inputType, function (v) {
      o.inputType = v; markDirty(); renderOptions(); renderBooths(); renderMatrix();
    }));
    g1.appendChild(selectField('適用範囲', OPTION_SCOPES, o.scope, function (v) {
      o.scope = v; markDirty(); renderOptions(); renderBooths(); renderMatrix();
    }));
    item.appendChild(g1);

    if (o.inputType === 'select') {
      item.appendChild(choicesField(o));
    } else {
      var g2 = el('div', 'grid-2');
      g2.appendChild(numberField('料金（円）', o.price, function (v) { o.price = v; markDirty(); }));
      if (o.inputType === 'quantity') {
        g2.appendChild(textField('単位（名・脚など）', o.unit, function (v) { o.unit = v; markDirty(); }));
      }
      item.appendChild(g2);
    }

    var checks = el('div', 'checks');
    checks.appendChild(checkbox('このオプションを使う', o.enabled !== false, function (v) {
      o.enabled = v; markDirty(); renderOptions(); renderBooths(); renderMatrix(); renderIssues();
    }));
    if (o.scope === 'booth') {
      checks.appendChild(checkbox('新しいブースでは既定で使える',
        o.defaultAvailable !== false, function (v) {
          o.defaultAvailable = v; markDirty(); renderBooths(); renderMatrix(); renderIssues();
        }));
    }
    item.appendChild(checks);

    // ブースを1つずつ開かなくても済むよう、一括で切り替えられるようにする
    if (o.scope === 'booth') {
      var bulk = el('div', 'grid-2');
      bulk.style.marginTop = '0.6rem';
      bulk.appendChild(smallButton('全ブースで使う', function () { bulkSet(o, true); }));
      bulk.appendChild(smallButton('全ブースで使わない', function () { bulkSet(o, false); }));
      item.appendChild(bulk);
    }

    host.appendChild(item);
  });
}

function bulkSet(option, available) {
  state.config.booths.forEach(function (b) {
    b.options = b.options || {};
    b.options[option.id] = b.options[option.id] || {};
    b.options[option.id].available = available;
    if (option.inputType === 'quantity') {
      b.options[option.id].max = available ? (b.options[option.id].max || 1) : 0;
    }
  });
  markDirty();
  renderBooths();
  renderMatrix();
  toast(available ? '全ブースで使えるようにしました' : '全ブースで使えないようにしました', 'ok');
}

function choicesField(option) {
  var wrap = el('div', 'field');
  var label = el('label');
  label.textContent = '選択肢（「表示名,金額」を1行に1つ）';
  wrap.appendChild(label);

  var ta = document.createElement('textarea');
  ta.rows = 4;
  ta.value = (option.choices || []).map(function (c) {
    return c.label + ',' + (c.price || 0);
  }).join('\n');
  ta.addEventListener('input', function () {
    option.choices = ta.value.split('\n').map(function (line) {
      var parts = line.split(',');
      var label = (parts[0] || '').trim();
      if (!label) return null;
      return { value: label, label: label, price: num(parts[1]) };
    }).filter(Boolean);
    markDirty();
  });
  wrap.appendChild(ta);

  var hint = el('p', 'hint');
  hint.textContent = '例: 不要,0 / お弁当,900';
  wrap.appendChild(hint);
  return wrap;
}

function addOption() {
  state.config.pricing.options.push({
    id: 'opt_' + Date.now().toString(36),
    label: '', description: '', inputType: 'toggle', scope: 'booth',
    defaultAvailable: false,      // 既存ブースで勝手に有効にならないようにする
    price: 0, max: 1, unit: '', enabled: true,
    order: (state.config.pricing.options.length + 1) * 10,
    choices: []
  });
  markDirty();
  renderOptions();
  renderBooths();
  renderMatrix();
}

// ---------- 可否のマトリクス ----------
function renderMatrix() {
  var table = document.getElementById('matrix');
  table.innerHTML = '';

  var options = (state.config.pricing.options || []).filter(function (o) {
    return o.enabled !== false && o.scope === 'booth';
  });
  var booths = state.config.booths || [];

  if (!options.length || !booths.length) {
    table.innerHTML = '<tr><td class="hint">ブースまたはオプションがまだありません。</td></tr>';
    return;
  }

  var thead = document.createElement('tr');
  thead.appendChild(th('ブース', 'row-head'));
  options.forEach(function (o) { thead.appendChild(th(o.label || o.id)); });
  table.appendChild(thead);

  booths.forEach(function (b) {
    var tr = document.createElement('tr');
    var head = document.createElement('td');
    head.className = 'row-head';
    head.textContent = b.name || '（無題）';
    tr.appendChild(head);

    options.forEach(function (o) {
      var g = resolveOptionForBooth(o, b);
      var td = document.createElement('td');
      if (g.available) {
        td.className = 'yes';
        td.textContent = o.inputType === 'quantity' ? '○ ' + g.max : '○';
      } else {
        td.className = 'no';
        td.textContent = '−';
      }
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
}

function th(text, cls) {
  var e = document.createElement('th');
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}

// ---------- 申込項目 ----------
var FIELD_TYPE_LABELS = [
  ['text', '1行テキスト'], ['textarea', '複数行テキスト'],
  ['select', 'プルダウン'], ['radio', 'ラジオボタン'],
  ['checkbox', 'チェックボックス（1つ）'], ['checkboxGroup', 'チェックボックス（複数）'],
  ['number', '数値'], ['email', 'メールアドレス'], ['tel', '電話番号'],
  ['postal', '郵便番号'], ['address', '住所'], ['date', '日付'],
  ['url', 'URL'], ['image', '画像の添付'], ['snsLinks', 'SNSリンク'],
  ['heading', '説明文だけ表示'],
  ['category', '出展カテゴリの選択'], ['booth', '出展ブースの選択']
];
var SECTION_LABELS = [
  ['basic', '基本情報'], ['exhibit', '出展内容'], ['sns', 'SNSリンク'],
  ['options', 'オプション'], ['terms', '規約・その他']
];

function renderFields() {
  var host = document.getElementById('fieldList');
  host.innerHTML = '';
  document.getElementById('fieldCount').textContent = (state.config.fields || []).length;

  state.config.fields.forEach(function (f, idx) {
    var locked = SINGLETON_TYPES.indexOf(f.type) >= 0;
    var item = el('div', 'item');

    item.appendChild(itemHead(f.label || '（質問文なし）', typeLabel(f.type), {
      locked: locked,
      onUp: idx > 0 ? function () { reorderFields(idx, -1); } : null,
      onDown: idx < state.config.fields.length - 1 ? function () { reorderFields(idx, 1); } : null,
      onDelete: locked ? null : function () {
        if (!confirm('「' + (f.label || '無題') + '」を削除しますか？')) return;
        state.config.fields.splice(idx, 1);
        markDirty(); renderFields(); renderIssues();
      }
    }));

    item.appendChild(textField('質問文', f.label, function (v) {
      f.label = v; markDirty();
    }));
    item.appendChild(textField('説明書き（任意）', f.description, function (v) {
      f.description = v; markDirty();
    }));

    var g = el('div', 'grid-2');
    if (locked) {
      var fixed = el('div', 'field');
      var l = el('label'); l.textContent = '入力の種類';
      var p = el('p', 'hint'); p.textContent = typeLabel(f.type) + '（変更できません）';
      fixed.appendChild(l); fixed.appendChild(p);
      g.appendChild(fixed);
    } else {
      g.appendChild(selectField('入力の種類', FIELD_TYPE_LABELS, f.type, function (v) {
        f.type = v; markDirty(); renderFields(); renderIssues();
      }));
    }
    g.appendChild(selectField('表示する場所', SECTION_LABELS, f.section, function (v) {
      f.section = v; markDirty(); renderFields();
    }));
    item.appendChild(g);

    if (['select', 'radio', 'checkboxGroup'].indexOf(f.type) >= 0) {
      item.appendChild(listField('選択肢（1行に1つ）', f.choices, function (v) {
        f.choices = v; markDirty(); renderIssues();
      }));
    }

    if (['text', 'textarea', 'email', 'tel', 'url', 'address'].indexOf(f.type) >= 0) {
      item.appendChild(textField('入力例（プレースホルダー）', f.placeholder, function (v) {
        f.placeholder = v; markDirty();
      }));
    }

    if (f.type === 'image') {
      item.appendChild(numberField('ファイルサイズの上限（MB）', f.maxFileSizeMB || 8, function (v) {
        f.maxFileSizeMB = v || 8; markDirty();
      }));
    }

    if (['text', 'textarea'].indexOf(f.type) >= 0) {
      var g2 = el('div', 'grid-2');
      g2.appendChild(numberField('文字数の上限（0＝制限なし）', f.maxLength || 0, function (v) {
        f.maxLength = v; markDirty(); renderIssues();
      }));
      item.appendChild(g2);
    }

    var checks = el('div', 'checks');
    if (f.type !== 'heading') {
      checks.appendChild(checkbox('必須にする', !!f.required, function (v) {
        f.required = v; markDirty();
      }));
    }
    if (['text', 'textarea'].indexOf(f.type) >= 0) {
      checks.appendChild(checkbox('文字数カウンターを出す', !!f.showCounter, function (v) {
        f.showCounter = v; markDirty(); renderIssues();
      }));
    }
    if (f.type === 'email') {
      checks.appendChild(checkbox('確認用の再入力を求める', !!f.confirm, function (v) {
        f.confirm = v; markDirty();
      }));
    }
    if (checks.children.length) item.appendChild(checks);

    var idHint = el('p', 'hint');
    idHint.textContent = '項目ID: ' + f.id + '（メール差し込み {{field:' + f.id + '}}）';
    item.appendChild(idHint);

    host.appendChild(item);
  });
}

/** 並び替えは order を振り直して確定させる */
function reorderFields(idx, delta) {
  move(state.config.fields, idx, delta);
  state.config.fields.forEach(function (f, i) { f.order = (i + 1) * 10; });
  markDirty();
  renderFields();
}

function typeLabel(type) {
  for (var i = 0; i < FIELD_TYPE_LABELS.length; i++) {
    if (FIELD_TYPE_LABELS[i][0] === type) return FIELD_TYPE_LABELS[i][1];
  }
  return type;
}

function addField() {
  var order = (state.config.fields.length + 1) * 10;
  state.config.fields.push({
    id: 'q_' + Date.now().toString(36),
    section: 'exhibit', type: 'text', label: '', description: '',
    placeholder: '', required: false, maxLength: 0, showCounter: false,
    order: order, choices: []
  });
  markDirty();
  renderFields();
}

// ---------- 点検結果 ----------
function renderIssues() {
  var host = document.getElementById('issuesBox');
  host.innerHTML = '';

  var issues = validateConfig(state.config);
  if (!issues.length) return;

  // 致命的なものを先に出す
  issues.sort(function (a, b) {
    return (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1);
  });

  issues.forEach(function (i) {
    var box = el('div', 'issue ' + i.level);
    box.textContent = (i.level === 'error' ? '⛔ ' : '⚠️ ') + i.message;
    host.appendChild(box);
  });
}

// ========================================
// 保存
// ========================================
async function save() {
  var btn = document.getElementById('saveBtn');
  var issues = validateConfig(state.config);
  var errors = issues.filter(function (i) { return i.level === 'error'; });

  if (errors.length) {
    var proceed = confirm(
      '次の問題があります。\n\n' +
      errors.map(function (e) { return '・' + e.message; }).join('\n') +
      '\n\nこのまま保存しますか？（フォームが正しく動かない可能性があります）');
    if (!proceed) return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 保存中';

  try {
    var res = await api('admin_save_config', {
      config: JSON.stringify(state.config),
      ignoreErrors: errors.length ? '1' : '0'
    });

    if (!res.success) {
      toast(res.error || '保存に失敗しました', 'error');
      return;
    }

    state.dirty = false;
    updateSaveStatus();
    toast('保存しました。フォームに反映されます。', 'ok');

  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '保存する';
  }
}

function markDirty() {
  state.dirty = true;
  updateSaveStatus();
  renderIssues();
}

function updateSaveStatus() {
  var el = document.getElementById('saveStatus');
  el.textContent = state.dirty ? '未保存の変更があります' : '変更はありません';
  el.classList.toggle('dirty', state.dirty);
}

window.addEventListener('beforeunload', function (e) {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ========================================
// プレビュー
// ========================================
function openPreview() {
  // 保存前の内容を申込フォームに読ませる
  sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(state.config));
  document.getElementById('previewFrame').src = '../apply/index.html?preview=1&t=' + Date.now();
  document.getElementById('previewModal').classList.remove('hidden');
}

// ========================================
// セットアップ・移送・メール
// ========================================
async function previewSetup() {
  var host = document.getElementById('setupResult');
  host.innerHTML = '<p class="hint">確認中…</p>';

  try {
    var res = await api('admin_preview_setup', {});
    if (!res.success) { host.innerHTML = ''; toast(res.error, 'error'); return; }

    var html = '<div class="plan-list">' + res.plan.map(function (p) {
      return '<div class="plan-row"><span>' + esc(p.item) +
             '</span><span class="action">' + esc(p.action) + '</span></div>';
    }).join('') + '</div>';

    html += '<div class="field-label" style="margin-top:0.75rem">作られる列</div>'
          + '<div class="header-preview">'
          + res.headerPreview.map(function (h) { return '<span>' + esc(h) + '</span>'; }).join('')
          + '</div>';

    host.innerHTML = html;
  } catch (err) {
    host.innerHTML = '';
    toast(err.message, 'error');
  }
}

async function runSetup() {
  if (!confirm('スプレッドシートと画像フォルダを作成します。\n\n'
             + 'イベント名: ' + ((state.config.event || {}).name || '（未設定）') + '\n\n'
             + '同じ名前のものが既にある場合は再利用します。よろしいですか？')) return;

  var btn = document.getElementById('setupBtn');
  var host = document.getElementById('setupResult');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 実行中';

  try {
    var res = await api('admin_setup_event', {});
    if (!res.success) { toast(res.error || '実行に失敗しました', 'error'); return; }

    host.innerHTML = '<div class="plan-list">' + res.steps.map(function (s) {
      var mark = s.status === 'created' ? '✅' : (s.status === 'reused' ? '♻️' : 'ℹ️');
      var link = s.url ? ' <a href="' + esc(s.url) + '" target="_blank" rel="noopener">開く</a>' : '';
      return '<div class="plan-row"><span>' + mark + ' ' + esc(s.step) +
             '</span><span class="action">' + esc(s.message) + link + '</span></div>';
    }).join('') + '</div>';

    toast('セットアップが完了しました', 'ok');
    refreshStatus();

  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '新規開催回を始める';
  }
}

async function runMigrate(dryRun) {
  var sourceId = document.getElementById('legacyId').value.trim();
  if (!sourceId) { toast('移送元のスプレッドシートIDを入力してください', 'error'); return; }

  if (!dryRun && !confirm('過去データをマスターDBへ取り込みます。\n'
                        + '移送元は読み取るだけで変更しません。よろしいですか？')) return;

  var host = document.getElementById('migrateResult');
  host.innerHTML = '<p class="hint">処理中…</p>';

  try {
    var res = await api('admin_migrate', { sourceId: sourceId, dryRun: dryRun ? '1' : '0' });
    if (!res.success) { host.innerHTML = ''; toast(res.error, 'error'); return; }

    var html = '<p class="hint" style="margin-top:0.5rem">' + esc(res.message) + '</p>';

    if (res.mapping && res.mapping.length) {
      html += '<div class="field-label" style="margin-top:0.6rem">対応づけ</div>'
            + '<div class="header-preview">'
            + res.mapping.map(function (m) {
                return '<span>' + esc(m.from) + ' → ' + esc(m.to) + '</span>';
              }).join('') + '</div>';
    }
    if (res.unmapped && res.unmapped.length) {
      html += '<div class="issue warn" style="margin-top:0.6rem">'
            + '対応づかなかった列（取り込まれません）: ' + esc(res.unmapped.join('、'))
            + '</div>';
    }
    host.innerHTML = html;
    if (!dryRun) toast('移送が完了しました', 'ok');

  } catch (err) {
    host.innerHTML = '';
    toast(err.message, 'error');
  }
}

async function sendDigest() {
  try {
    var res = await api('admin_send_digest', { days: '1' });
    if (!res.success) { toast(res.error, 'error'); return; }
    toast(res.count + '件のダイジェストを送信しました', 'ok');
    refreshStatus();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function processQueue() {
  try {
    var res = await api('admin_process_queue', {});
    if (!res.success) { toast(res.error, 'error'); return; }
    toast(res.sent + '件を送信しました（残り ' + res.remaining + '件）', 'ok');
    refreshStatus();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ========================================
// 部品
// ========================================
function el(tag, cls) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function itemHead(title, badgeText, opts) {
  opts = opts || {};
  var head = el('div', 'item-head');

  var t = el('span', 'item-title');
  t.textContent = title;
  head.appendChild(t);

  if (badgeText) {
    var b = el('span', 'item-type' + (opts.locked ? ' item-locked' : ''));
    b.textContent = badgeText;
    head.appendChild(b);
  }

  head.appendChild(iconButton('▲', opts.onUp, 'この項目を上へ'));
  head.appendChild(iconButton('▼', opts.onDown, 'この項目を下へ'));
  if (opts.onDelete) head.appendChild(iconButton('🗑', opts.onDelete, '削除', true));

  return head;
}

function iconButton(text, handler, title, danger) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn' + (danger ? ' danger' : '');
  b.textContent = text;
  b.title = title || '';
  if (handler) b.addEventListener('click', handler);
  else b.disabled = true;
  return b;
}

function smallButton(text, handler) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-secondary btn-sm';
  b.textContent = text;
  b.addEventListener('click', handler);
  return b;
}

function textField(labelText, value, onChange, type) {
  var wrap = el('div', 'field');
  var l = el('label');
  l.textContent = labelText;
  var input = document.createElement('input');
  input.type = type || 'text';
  input.value = value == null ? '' : value;
  input.addEventListener('input', function () { onChange(input.value); });
  wrap.appendChild(l);
  wrap.appendChild(input);
  return wrap;
}

function numberField(labelText, value, onChange) {
  var wrap = el('div', 'field');
  var l = el('label');
  l.textContent = labelText;
  var input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.value = value == null ? 0 : value;
  input.addEventListener('input', function () { onChange(num(input.value)); });
  wrap.appendChild(l);
  wrap.appendChild(input);
  return wrap;
}

function selectField(labelText, pairs, value, onChange) {
  var wrap = el('div', 'field');
  var l = el('label');
  l.textContent = labelText;
  var sel = document.createElement('select');
  pairs.forEach(function (p) {
    var o = document.createElement('option');
    o.value = p[0];
    o.textContent = p[1];
    if (p[0] === value) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', function () { onChange(sel.value); });
  wrap.appendChild(l);
  wrap.appendChild(sel);
  return wrap;
}

function listField(labelText, values, onChange) {
  var wrap = el('div', 'field');
  var l = el('label');
  l.textContent = labelText;
  var ta = document.createElement('textarea');
  ta.rows = 3;
  ta.value = (values || []).map(function (v) {
    return typeof v === 'string' ? v : (v.label || v.value);
  }).join('\n');
  ta.addEventListener('input', function () {
    onChange(ta.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean));
  });
  wrap.appendChild(l);
  wrap.appendChild(ta);
  return wrap;
}

function checkbox(labelText, checked, onChange) {
  var l = el('label', 'check');
  var input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.addEventListener('change', function () { onChange(input.checked); });
  var span = document.createElement('span');
  span.textContent = labelText;
  l.appendChild(input);
  l.appendChild(span);
  return l;
}

function toggleSwitch(checked, onChange) {
  var l = el('label', 'toggle');
  var input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.addEventListener('change', function () { onChange(input.checked); });
  var slider = el('span', 'toggle-slider');
  l.appendChild(input);
  l.appendChild(slider);
  return l;
}

function toast(message, kind) {
  var t = document.getElementById('toast');
  t.textContent = message;
  t.className = 'toast show ' + (kind || '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function () { t.className = 'toast'; }, 3200);
}

// ========================================
// ユーティリティ
// ========================================
function getPath(obj, path) {
  return path.split('.').reduce(function (o, k) {
    return (o == null) ? undefined : o[k];
  }, obj);
}

function setPath(obj, path, value) {
  var keys = path.split('.');
  var last = keys.pop();
  var target = keys.reduce(function (o, k) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    return o[k];
  }, obj);
  target[last] = value;
}

function move(arr, idx, delta) {
  var next = idx + delta;
  if (next < 0 || next >= arr.length) return;
  var tmp = arr[idx];
  arr[idx] = arr[next];
  arr[next] = tmp;
  markDirty();
}

function num(v) {
  var n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

/** "2026-06-30 23:59:00" ⇔ datetime-local の "2026-06-30T23:59" */
function toDatetimeLocal(value) {
  if (!value) return '';
  var s = String(value).trim().replace(' ', 'T');
  var m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return m ? m[1] : '';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
