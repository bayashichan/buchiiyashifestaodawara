/**
 * 申込フォーム メインスクリプト
 *
 * 役割は「組み立てと進行」だけです。
 *   - 入力欄の生成          → form-renderer.js
 *   - オプションの生成       → option-renderer.js
 *   - 料金計算と可否判定     → config-schema.js（computeQuote）
 *   - リピーター認証         → repeater.js
 */

var CONFIG = null;
var selectedBoothId = null;
var selectedCategory = null;
var lastQuote = null;

// ========================================
// 起動
// ========================================
document.addEventListener('DOMContentLoaded', function () {
  loadConfig();
});

async function loadConfig() {
  var raw;
  try {
    var res = await fetch('./config.json?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    raw = await res.json();
  } catch (err) {
    console.error('Config load error:', err);
    document.getElementById('configError').classList.remove('hidden');
    document.querySelector('.form-container').classList.add('hidden');
    document.querySelector('.price-footer').classList.add('hidden');
    return;
  }

  CONFIG = normalizeConfig(raw);
  initApp();
}

function initApp() {
  applyTheme();
  applyEventInfo();
  applyEarlyBirdBanner();
  applySectionTitles();
  renderMedia();

  FormFields.render(CONFIG, {
    basic:   document.getElementById('fields-basic'),
    exhibit: document.getElementById('fields-exhibit'),
    sns:     document.getElementById('fields-sns'),
    options: document.getElementById('fields-options'),
    terms:   document.getElementById('fields-terms')
  });

  renderCategories();
  renderBooths();

  OptionFields.render(CONFIG, document.getElementById('optionsContainer'), recalculate);
  OptionFields.setBooth(null);

  initTerms();
  initPriceBar();
  initSubmit();
  initLiff();

  if (CONFIG.repeater && CONFIG.repeater.enabled) {
    Repeater.init(CONFIG, onRepeaterRestore);
  }

  recalculate();
}

// ========================================
// テーマ・イベント情報
// ========================================
function applyTheme() {
  var t = CONFIG.theme || {};
  var root = document.documentElement;

  if (t.primaryColor)    root.style.setProperty('--color-primary', t.primaryColor);
  if (t.accentColor)     root.style.setProperty('--color-accent', t.accentColor);
  if (t.headerBgColor)   root.style.setProperty('--color-header-bg', t.headerBgColor);
  if (t.headerTextColor) root.style.setProperty('--color-header-txt', t.headerTextColor);

  if (t.primaryColor) {
    root.style.setProperty('--color-primary-light', hexToRgba(t.primaryColor, 0.12));
    root.style.setProperty('--color-primary-dark', shiftColor(t.primaryColor, -20));
  }

  var header = document.getElementById('appHeader');
  if (header && t.headerImageUrl) {
    header.style.backgroundImage = "url('" + t.headerImageUrl + "')";
    header.classList.add('has-image');
  }

  var logo = document.getElementById('headerLogo');
  if (logo && t.logoImageUrl) {
    logo.src = t.logoImageUrl;
    logo.classList.remove('hidden');
  }
}

function hexToRgba(hex, alpha) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function shiftColor(hex, amount) {
  var clamp = function (n) { return Math.min(255, Math.max(0, n)); };
  var r = clamp(parseInt(hex.slice(1, 3), 16) + amount);
  var g = clamp(parseInt(hex.slice(3, 5), 16) + amount);
  var b = clamp(parseInt(hex.slice(5, 7), 16) + amount);
  var hx = function (n) { return n.toString(16).padStart(2, '0'); };
  return '#' + hx(r) + hx(g) + hx(b);
}

function applyEventInfo() {
  var ev = CONFIG.event || {};
  var title = document.getElementById('eventTitle');
  if (title && ev.name) title.textContent = ev.name;
  document.title = '出展申込フォーム' + (ev.name ? ' | ' + ev.name : '');

  var box = document.getElementById('eventInfoBox');
  var shown = false;

  shown = setTextIfPresent('headerEventDate', ev.date) || shown;
  shown = setTextIfPresent('headerEventLocation', ev.location) || shown;
  shown = setTextIfPresent('headerEventNote', ev.headerNote) || shown;

  if (box && shown) box.classList.remove('hidden');
}

function setTextIfPresent(elId, value) {
  var el = document.getElementById(elId);
  if (!el || !value || !String(value).trim()) return false;
  el.textContent = value;
  el.classList.remove('hidden');
  return true;
}

function applyEarlyBirdBanner() {
  var banner = document.getElementById('earlyBirdBanner');
  if (!banner) return;

  if (!isEarlyBirdActive(CONFIG)) {
    banner.classList.add('hidden');
    return;
  }

  var eb = CONFIG.earlyBird || {};
  var badge = banner.querySelector('.early-bird-badge');
  if (badge) {
    if (eb.bannerText) {
      badge.textContent = eb.bannerText;
    } else {
      var d = parseDeadline(eb.deadline);
      badge.textContent = d
        ? '🎉 ' + (eb.label || '早割') + '期間中！' + (d.getMonth() + 1) + '/' + d.getDate() + 'まで'
        : '🎉 ' + (eb.label || '早割') + '期間中！';
    }
  }
  banner.classList.remove('hidden');
}

function applySectionTitles() {
  SECTIONS.forEach(function (s) {
    var section = document.querySelector('.form-section[data-section="' + s.id + '"]');
    if (!section) return;
    var icon = section.querySelector('.section-icon');
    var label = section.querySelector('.section-label');
    if (icon) icon.textContent = s.icon + ' ';
    if (label) label.textContent = s.title;
  });
}

/** media[] を position に従って各スロットへ差し込む */
function renderMedia() {
  (CONFIG.media || []).forEach(function (m) {
    if (!m.url) return;
    var slotId = 'media-' + String(m.position || 'footer').replace(':', '-');
    var slot = document.getElementById(slotId);
    if (!slot) return;

    var img = document.createElement('img');
    img.className = 'media-image';
    img.src = m.url;
    img.alt = m.alt || '';
    img.loading = 'lazy';
    slot.appendChild(img);

    if (m.caption) {
      var cap = document.createElement('p');
      cap.className = 'media-caption';
      cap.textContent = m.caption;
      slot.appendChild(cap);
    }
  });
}

// ========================================
// カテゴリ
// ========================================
function renderCategories() {
  var host = document.getElementById('categoryButtons');
  if (!host) return;

  (CONFIG.categories || []).forEach(function (category) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-btn';
    btn.textContent = category;
    btn.addEventListener('click', function () { selectCategory(category, btn); });
    host.appendChild(btn);
  });
}

function selectCategory(category, btn) {
  document.querySelectorAll('.category-btn').forEach(function (b) {
    b.classList.remove('selected');
  });
  btn.classList.add('selected');
  selectedCategory = category;

  var hidden = document.getElementById(FormFields.inputId('category'));
  if (hidden) hidden.value = category;

  FormFields.clearError('category');
  updateSessionWarning();
}

// ========================================
// ブース
// ========================================
function renderBooths() {
  var host = document.getElementById('boothAccordion');
  if (!host) return;

  var booths = CONFIG.booths || [];
  var locations = [];
  booths.forEach(function (b) {
    if (b.location && locations.indexOf(b.location) < 0) locations.push(b.location);
  });

  // 場所が2種類以上あるときだけアコーディオンでまとめる
  if (locations.length >= 2) {
    var seen = [];
    booths.forEach(function (b) {
      var loc = b.location || '';
      if (seen.indexOf(loc) >= 0) return;
      seen.push(loc);

      var group = booths.filter(function (x) { return (x.location || '') === loc; });
      if (!loc) {
        group.forEach(function (b2) { host.appendChild(createBoothOption(b2)); });
        return;
      }

      var header = document.createElement('div');
      header.className = 'accordion-header';
      header.innerHTML = '<span>' + escapeHtml(loc) + '</span><span class="accordion-icon">▼</span>';

      var content = document.createElement('div');
      content.className = 'accordion-content';
      group.forEach(function (b2) { content.appendChild(createBoothOption(b2)); });

      header.addEventListener('click', function () {
        header.classList.toggle('active');
        content.classList.toggle('open');
      });

      host.appendChild(header);
      host.appendChild(content);
    });
  } else {
    booths.forEach(function (b) { host.appendChild(createBoothOption(b)); });
  }
}

function createBoothOption(booth) {
  var label = document.createElement('label');
  label.className = 'booth-option' + (booth.soldOut ? ' sold-out' : '');

  var input = document.createElement('input');
  input.type = 'radio';
  input.name = 'boothRadio';
  input.value = booth.id;
  input.disabled = !!booth.soldOut;
  if (!booth.soldOut) {
    input.addEventListener('change', function () { selectBooth(booth.id); });
  }

  var name = document.createElement('span');
  name.style.flex = '1';
  name.textContent = booth.name;

  label.appendChild(input);
  label.appendChild(name);

  if (booth.description) {
    name.appendChild(document.createElement('br'));
    var d = document.createElement('small');
    d.className = 'field-description';
    d.textContent = booth.description;
    name.appendChild(d);
  }

  if (booth.soldOut) {
    var badge = document.createElement('span');
    badge.className = 'sold-out-badge';
    badge.textContent = '満枠';
    label.appendChild(badge);
  } else {
    var price = document.createElement('span');
    price.className = 'booth-price';
    price.innerHTML = boothPriceHtml(booth);
    label.appendChild(price);
  }
  return label;
}

function boothPriceHtml(booth) {
  var regular = booth.prices.regular || 0;
  var early = booth.prices.earlyBird;
  if (!isEarlyBirdActive(CONFIG) || early == null || early === regular) {
    return formatYen(regular);
  }
  return formatYen(early) +
    ' <span class="booth-price-early">（通常' + formatYen(regular) + '）</span>';
}

function selectBooth(boothId) {
  selectedBoothId = boothId;

  document.querySelectorAll('.booth-option').forEach(function (opt) {
    var input = opt.querySelector('input[type="radio"]');
    opt.classList.toggle('selected', !!input && input.value === boothId);
  });

  var hidden = document.getElementById(FormFields.inputId('booth'));
  if (hidden) hidden.value = boothId;

  FormFields.clearError('booth');
  OptionFields.setBooth(boothId);
  FormFields.applyConditionalVisibility(boothId);
  updateSessionWarning();
  recalculate();
}

/** 物販系ブースでセッション系カテゴリを選んだときの注意喚起 */
function updateSessionWarning() {
  var warning = document.getElementById('sessionWarning');
  if (!warning) return;

  var booth = findBooth(selectedBoothId);
  var targets = CONFIG.sessionCategories || [];
  var hit = booth && booth.prohibitSession && selectedCategory &&
            targets.indexOf(selectedCategory) >= 0;

  warning.textContent = hit
    ? '⚠️ ご注意: 選択されたブースではセッション・体験型の出展ができません。物販・飲食のみの出展となります。'
    : '';
  warning.classList.toggle('visible', !!hit);
}

function findBooth(boothId) {
  var booths = CONFIG.booths || [];
  for (var i = 0; i < booths.length; i++) {
    if (booths[i].id === boothId) return booths[i];
  }
  return null;
}

// ========================================
// 料金計算
// ========================================

/**
 * 選択内容から見積もりを作り直し、UI に反映する。
 * computeQuote が値を補正した場合は、その理由を必ず画面に出す。
 */
function recalculate() {
  var quote = computeQuote(CONFIG, {
    boothId: selectedBoothId,
    options: OptionFields.getValues(),
    isMember: OptionFields.getIsMember()
  });

  // 補正された値を UI に書き戻し、理由を提示する
  OptionFields.applyResolved(quote.options);
  OptionFields.showNotices(quote.notices);

  renderPriceBar(quote);
  lastQuote = quote;
  return quote;
}

function renderPriceBar(quote) {
  var totalEl = document.getElementById('totalPrice');
  var labelEl = document.getElementById('priceSummaryLabel');
  var listEl = document.getElementById('priceLineItems');

  if (totalEl) totalEl.textContent = formatYen(quote.total);

  if (labelEl) {
    labelEl.textContent = quote.lineItems.length
      ? quote.lineItems.length + '件の内訳を見る'
      : 'ブースを選択してください';
  }

  if (!listEl) return;
  listEl.innerHTML = '';
  quote.lineItems.forEach(function (item) {
    var li = document.createElement('li');
    if (item.amount < 0) li.className = 'is-discount';

    var name = document.createElement('span');
    name.textContent = item.label;

    var amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = formatYen(item.amount);

    li.appendChild(name);
    li.appendChild(amount);
    listEl.appendChild(li);
  });
}

/** スマホでは内訳が長くなるので、タップで開閉できるようにする */
function initPriceBar() {
  var toggle = document.getElementById('priceToggle');
  var details = document.getElementById('priceDetails');
  if (!toggle || !details) return;

  toggle.addEventListener('click', function () {
    var open = details.classList.toggle('hidden') === false;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

// ========================================
// 規約
// ========================================
function initTerms() {
  var terms = CONFIG.terms || {};
  var box = document.getElementById('termsBox');
  var link = document.getElementById('termsLink');
  var content = document.getElementById('termsContent');
  var titleEl = document.getElementById('termsTitle');
  var modal = document.getElementById('termsModal');
  var closeBtn = document.getElementById('closeTermsBtn');

  if (terms.requireAgree === false) {
    if (box) box.classList.add('hidden');
    return;
  }

  if (content) content.textContent = terms.body || '';
  if (titleEl) titleEl.textContent = terms.title || '出展規約';
  if (link) {
    link.textContent = terms.title || '出展規約';
    link.addEventListener('click', function (e) {
      e.preventDefault();
      if (modal) modal.classList.remove('hidden');
    });
  }
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', function () { modal.classList.add('hidden'); });
  }

  var cb = document.getElementById('agreeTerms');
  if (cb) {
    cb.addEventListener('change', function () {
      if (cb.checked) hideAgreeError();
    });
  }
}

function showAgreeError(message) {
  var el = document.getElementById('err_agreeTerms');
  if (el) { el.textContent = message; el.classList.remove('hidden'); }
}
function hideAgreeError() {
  var el = document.getElementById('err_agreeTerms');
  if (el) el.classList.add('hidden');
}

// ========================================
// 送信
// ========================================
function initSubmit() {
  var btn = document.getElementById('submitBtn');
  if (btn) btn.addEventListener('click', submitForm);
}

async function submitForm() {
  var errors = FormFields.validate();

  // 規約同意
  hideAgreeError();
  var terms = CONFIG.terms || {};
  var agreeCb = document.getElementById('agreeTerms');
  if (terms.requireAgree !== false && agreeCb && !agreeCb.checked) {
    showAgreeError((terms.title || '出展規約') + 'への同意が必要です');
    errors.push({ fieldId: 'agreeTerms', message: '規約への同意が必要です' });
  }

  if (errors.length) {
    // alert は使わず、最初のエラー項目まで送る
    var first = errors[0];
    if (first.fieldId === 'agreeTerms') {
      document.getElementById('termsBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      FormFields.focusError(first.fieldId);
    }
    return;
  }

  var quote = recalculate();

  // 直前の再計算でオプションが自動解除された場合は、金額を確認してもらってから送る
  if (quote.notices.length) {
    var ok = confirm(
      '選択内容の一部が調整されました。\n\n' +
      quote.notices.map(function (n) { return '・' + n.message; }).join('\n') +
      '\n\n合計 ' + formatYen(quote.total) + ' で申し込みますか？');
    if (!ok) return;
  }

  var booth = findBooth(quote.boothId);
  var overlay = document.getElementById('loadingOverlay');
  var btn = document.getElementById('submitBtn');
  overlay.classList.add('visible');
  btn.disabled = true;

  try {
    var fd = new FormData();

    fd.set('action', 'submit');
    fd.set('eventName', (CONFIG.event || {}).name || '');
    fd.set('submittedAt', new Date().toISOString());

    fd.set('answers', JSON.stringify(FormFields.getValues()));
    fd.set('fieldDefs', JSON.stringify(FormFields.getFieldDefs()));
    fd.set('selectedOptions', JSON.stringify(quote.options));
    fd.set('optionDefs', JSON.stringify(OptionFields.getOptionDefs()));

    fd.set('boothId', quote.boothId || '');
    fd.set('boothName', booth ? booth.name : '');
    fd.set('category', selectedCategory || '');
    fd.set('isMember', OptionFields.getIsMember() ? '1' : '0');
    fd.set('isEarlyBird', quote.earlyBird ? '1' : '0');

    // 金額はサーバ側が再計算する。これは突合用の参考値。
    fd.set('clientTotal', String(quote.total));

    fd.set('lineUserId', document.getElementById('lineUserId').value || '');
    fd.set('lineDisplayName', document.getElementById('lineDisplayName').value || '');

    await attachImages(fd);

    var target = (CONFIG.integration || {}).gasUrl || (CONFIG.integration || {}).workerUrl;
    if (!target) throw new Error('送信先URLが設定されていません（config.json の integration.gasUrl）。');

    var result = await postForm(target, fd);
    if (!result || result.success === false) {
      throw new Error((result && result.error) || 'サーバー側で受付に失敗しました。');
    }

    showComplete(result);

  } catch (err) {
    console.error('Submit error:', err);
    alert('送信に失敗しました。\n\n' + err.message + '\n\nお手数ですが、通信環境をご確認のうえ再度お試しください。');
  } finally {
    overlay.classList.remove('visible');
    btn.disabled = false;
  }
}

/**
 * 画像フィールドをすべて Base64 にして添付する。
 * 「前回の写真を使う」が選ばれている場合はURLだけ送り、再アップロードしない。
 */
async function attachImages(fd) {
  var fields = FormFields.getAllFields();
  var imageFieldIds = [];

  for (var id in fields) {
    if (fields[id].type !== 'image') continue;
    var st = FormFields.getImageState(id) || {};
    imageFieldIds.push(id);

    if (st.usePrevious && st.previousUrl) {
      fd.set('image_' + id + '_existingUrl', st.previousUrl);
      continue;
    }
    var file = FormFields.getImageFile(id);
    if (!file) continue;

    var encoded = await encodeImage(file);
    fd.set('image_' + id + '_base64', encoded.base64);
    fd.set('image_' + id + '_mime', encoded.mimeType);
    fd.set('image_' + id + '_name', encoded.name);
  }
  fd.set('imageFieldIds', JSON.stringify(imageFieldIds));
}

async function postForm(url, formData) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, 90000);

  var response;
  try {
    // multipart/form-data はプリフライトが発生しない単純リクエストなので、
    // 公開した GAS ウェブアプリへブラウザから直接 POST できる。
    response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      redirect: 'follow'
    });
  } catch (e) {
    throw e.name === 'AbortError'
      ? new Error('通信がタイムアウトしました。')
      : new Error('ネットワークエラーが発生しました。');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error('サーバーとの通信に失敗しました（状態コード ' + response.status + '）。');
  }
  var text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('サーバーからの応答が不正です。');
  }
}

function showComplete(result) {
  var msg = document.getElementById('completeMessage');
  if (msg) {
    // メール送信枠が尽きているときは、その旨を正直に伝える
    msg.innerHTML = result && result.mailQueued
      ? 'お申込みを受け付けました。<br>確認メールは順次お送りしますので、しばらくお待ちください。'
      : 'ご登録のメールアドレスに確認メールをお送りしました。<br>内容をご確認ください。';
  }
  document.getElementById('completeModal').classList.remove('hidden');
}

// ========================================
// 画像のエンコード（段階圧縮）
// ========================================

/**
 * GAS は大きすぎる POST を 403 で弾くため、目標サイズに収まるまで段階的に再圧縮する。
 * 実績: base64 約1.3MB は成功、約1.9MB は 403。余裕を見て目標は約1MB。
 */
function encodeImage(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('画像の読み込みに失敗しました')); };
    reader.onload = function (e) {
      var img = new Image();
      img.onerror = function () { reject(new Error('画像を読み込めませんでした')); };
      img.onload = function () {
        try {
          var TARGET_BASE64_LEN = 1000000;
          var MAX_DIMS = [1600, 1200, 1000, 800, 640];
          var MIN_QUALITY = 0.5;

          var encodeAt = function (maxDim, quality) {
            var canvas = document.createElement('canvas');
            var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/jpeg', quality);
          };

          var dataUrl = null;
          for (var i = 0; i < MAX_DIMS.length; i++) {
            for (var q = 0.85; q >= MIN_QUALITY; q -= 0.15) {
              dataUrl = encodeAt(MAX_DIMS[i], q);
              if (dataUrl.length <= TARGET_BASE64_LEN) {
                return resolve(toEncoded(dataUrl, file));
              }
            }
          }
          resolve(toEncoded(dataUrl, file));
        } catch (err) {
          reject(new Error('画像の変換に失敗しました'));
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function toEncoded(dataUrl, file) {
  var base = String(file.name || 'image').replace(/\.[^.]+$/, '');
  return {
    base64: dataUrl.split(',')[1],
    mimeType: 'image/jpeg',
    name: base + '.jpg'
  };
}

// ========================================
// リピーター復元
// ========================================

/**
 * 過去の申込内容をフォームへ反映する。
 * ブース・オプション・懇親会は復元しない（前回のブースが今回は無い・満枠・
 * 値上げ、というときに誤った金額で申し込まれるのを防ぐため）。
 */
function onRepeaterRestore(record) {
  if (!record) return;

  var answers = record.answers || {};
  var restoreIds = (CONFIG.repeater && CONFIG.repeater.restoreFieldIds) || [];
  var fields = FormFields.getAllFields();

  var values = {};
  Object.keys(answers).forEach(function (id) {
    var f = fields[id];
    if (!f) return;
    if (f.type === 'booth' || f.type === 'category') return;
    if (restoreIds.length && restoreIds.indexOf(id) < 0) return;
    values[id] = answers[id];
  });

  FormFields.setValues(values);
  recalculate();
}

// ========================================
// LIFF
// ========================================
async function initLiff() {
  var liffId = (CONFIG.integration || {}).liffId;
  if (!liffId || typeof liff === 'undefined') return;

  try {
    await liff.init({ liffId: liffId });
    if (liff.isLoggedIn()) {
      var profile = await liff.getProfile();
      document.getElementById('lineUserId').value = profile.userId;
      document.getElementById('lineDisplayName').value = profile.displayName;
    }
  } catch (err) {
    console.error('LIFF init error:', err);
  }
}

// ========================================
// ユーティリティ
// ========================================
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
