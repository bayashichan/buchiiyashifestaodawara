/**
 * イベント申込フォーム テンプレート
 * メインスクリプト
 * config.json から全設定を読み込み、動的にフォームを構築します
 */

// ========================================
// グローバル状態
// ========================================
let CONFIG = null;
let selectedBooth = null;
let selectedCategory = null;
let optionValues = {
  staff: 0,
  chairs: 0,
  power: false,
  partyCount: 0,
  secondaryPartyCount: 0
};
let snsLinkCount = 1;

// ========================================
// SNS判別パターン
// ========================================
const SNS_PATTERNS = [
  { pattern: /instagram\.com|instagr\.am/i,   name: 'Instagram',   color: '#E4405F' },
  { pattern: /youtube\.com|youtu\.be/i,        name: 'YouTube',     color: '#FF0000' },
  { pattern: /tiktok\.com/i,                   name: 'TikTok',      color: '#000000' },
  { pattern: /ameblo\.jp|ameba\.jp/i,          name: 'Ameblo',      color: '#1F8742' },
  { pattern: /line\.me|lin\.ee/i,              name: '公式LINE',    color: '#00B900' },
  { pattern: /twitter\.com|x\.com/i,           name: 'X(Twitter)',  color: '#1DA1F2' },
  { pattern: /facebook\.com|fb\.com/i,         name: 'Facebook',    color: '#1877F2' },
  { pattern: /lit\.link/i,                     name: 'lit.link',    color: '#28A0FF' },
  { pattern: /linktr\.ee/i,                    name: 'Linktree',    color: '#43E55E' }
];

// ========================================
// 設定読み込み & 初期化
// ========================================
async function loadConfig() {
  try {
    const res = await fetch(`./config.json?t=${Date.now()}`);
    if (!res.ok) throw new Error('config.json の読み込みに失敗しました');
    CONFIG = await res.json();
  } catch (err) {
    console.error('Config load error:', err);
    alert('設定ファイルの読み込みに失敗しました。ページを再読み込みしてください。');
    return;
  }
  initApp();
}

function initApp() {
  applyTheme();
  applyEventInfo();
  applyFeatures();
  initCategories();
  initBoothAccordion();
  renderCustomQuestions();
  initCharCounters();
  initSnsInputs();
  initPostalCodeSearch();
  initEmailConfirmation();
  initFileSizeCheck();
  updateEarlyBirdBanner();
  updateOptionsUI();
  calculatePrice();
  initLiff();

  if (CONFIG.features?.repeaterSearch) {
    initRepeaterSearch();
  }

  // 規約モーダルにテキストを注入
  const termsContent = document.getElementById('termsContent');
  if (termsContent && CONFIG.terms) {
    termsContent.textContent = CONFIG.terms;
  }
}

document.addEventListener('DOMContentLoaded', loadConfig);

// ========================================
// テーマ適用
// ========================================
function applyTheme() {
  if (!CONFIG?.theme) return;
  const root = document.documentElement;
  const { primaryColor, accentColor, headerBgColor, headerTextColor } = CONFIG.theme;

  if (primaryColor)    root.style.setProperty('--color-primary',      primaryColor);
  if (accentColor)     root.style.setProperty('--color-accent',       accentColor);
  if (headerBgColor)   root.style.setProperty('--color-header-bg',    headerBgColor);
  if (headerTextColor) root.style.setProperty('--color-header-txt',   headerTextColor);

  // primaryColor から light/dark バリエーションを生成
  // （簡易版：color-mix が使えないブラウザ向けに手動設定）
  if (primaryColor) {
    root.style.setProperty('--color-primary-light', hexToRgba(primaryColor, 0.12));
    root.style.setProperty('--color-primary-dark',  shiftColor(primaryColor, -20));
  }

  // ヘッダー画像
  const header = document.getElementById('appHeader');
  if (header && CONFIG.theme.headerImageUrl) {
    header.style.backgroundImage = `url('${CONFIG.theme.headerImageUrl}')`;
    header.classList.add('has-image');
  }
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function shiftColor(hex, amount) {
  let r = Math.min(255, Math.max(0, parseInt(hex.slice(1,3), 16) + amount));
  let g = Math.min(255, Math.max(0, parseInt(hex.slice(3,5), 16) + amount));
  let b = Math.min(255, Math.max(0, parseInt(hex.slice(5,7), 16) + amount));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// ========================================
// イベント情報表示
// ========================================
function applyEventInfo() {
  if (!CONFIG?.event) return;

  const titleEl    = document.getElementById('eventTitle');
  const dateEl     = document.getElementById('headerEventDate');
  const locationEl = document.getElementById('headerEventLocation');
  const infoBox    = document.getElementById('eventInfoBox');

  if (titleEl)    titleEl.textContent = CONFIG.event.name;
  document.title = `出展申込フォーム | ${CONFIG.event.name}`;

  const hasDate     = CONFIG.event.date?.trim();
  const hasLocation = CONFIG.event.location?.trim();

  if (hasDate || hasLocation) {
    if (infoBox) infoBox.classList.remove('hidden');
    if (dateEl && hasDate) {
      dateEl.textContent = CONFIG.event.date;
      dateEl.classList.remove('hidden');
    }
    if (locationEl && hasLocation) {
      locationEl.textContent = CONFIG.event.location;
      locationEl.classList.remove('hidden');
    }
  }
}

// ========================================
// 早割バナー
// ========================================
function updateEarlyBirdBanner() {
  const banner = document.getElementById('earlyBirdBanner');
  if (!banner) return;

  if (!CONFIG.features?.earlyBird) {
    banner.classList.add('hidden');
    return;
  }

  const deadline = new Date(CONFIG.event?.earlyBirdDeadline);
  if (!CONFIG.event?.earlyBirdDeadline || isNaN(deadline.getTime()) || new Date() > deadline) {
    banner.classList.add('hidden');
    return;
  }

  const m = deadline.getMonth() + 1;
  const d = deadline.getDate();
  const badge = banner.querySelector('.early-bird-badge');
  if (badge) badge.textContent = `🎉 早割期間中！${m}/${d}まで`;
}

function isEarlyBird() {
  if (!CONFIG.features?.earlyBird) return false;
  if (!CONFIG.event?.earlyBirdDeadline) return false;
  return new Date() <= new Date(CONFIG.event.earlyBirdDeadline);
}

// ========================================
// features による表示/非表示制御
// ========================================
function applyFeatures() {
  if (!CONFIG?.features) return;
  const f = CONFIG.features;

  setFeatureVisible('repeaterSearch',  f.repeaterSearch);
  setFeatureVisible('stampRally',      f.stampRally);
  setFeatureVisible('secondaryParty',  f.secondaryParty);
  setFeatureVisible('memberDiscount',  f.memberDiscount);
  setFeatureVisible('party',           CONFIG.pricing?.options?.party?.enabled);
  setFeatureVisible('bodyEquipment',   false); // 初期は非表示（ブース選択後に制御）

  // 会員割引ラベル
  const memberLabel = document.getElementById('memberDiscountLabel');
  if (memberLabel && f.memberDiscountLabel) {
    memberLabel.textContent = f.memberDiscountLabel;
  }

  // カテゴリセクション（カテゴリが空なら非表示）
  const catSection = document.getElementById('categorySection');
  if (catSection) {
    catSection.style.display = CONFIG.categories?.length ? '' : 'none';
  }

  // オプションラベル更新
  updateOptionLabels();

  // exhibitorName ラベル
  const enLabel = document.getElementById('exhibitorNameLabel');
  if (enLabel && CONFIG.standardFields?.exhibitorNameLabel) {
    enLabel.textContent = CONFIG.standardFields.exhibitorNameLabel;
  }
  const enInput = document.getElementById('exhibitorNameInput');
  if (enInput && CONFIG.standardFields?.exhibitorNamePlaceholder) {
    enInput.placeholder = CONFIG.standardFields.exhibitorNamePlaceholder;
  }

  // standardFields によるフィールド表示
  const sf = CONFIG.standardFields || {};
  if (sf.showPhoneNumber === false) hideById('phoneSection');
  if (sf.showAddress    === false) hideById('addressSection');
  if (sf.showPhotoUpload === false) hideById('photoSection');
  if (sf.showSnsLinks    === false) hideById('snsSection');
  if (sf.showPhotoPermission === false) hideById('photoPermissionSection');
  if (sf.showNotes       === false) hideById('notesSection');
}

function setFeatureVisible(featureName, isVisible) {
  document.querySelectorAll(`[data-feature="${featureName}"]`).forEach(el => {
    if (isVisible) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

function hideById(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// オプションラベルを config から適用
function updateOptionLabels() {
  const opts = CONFIG.pricing?.options || {};
  updateOptionLabel('powerLabel',  opts.power);
  updateOptionLabel('chairLabel',  opts.chair);
  updateOptionLabel('staffLabel',  opts.staff);
  updateOptionLabel('partyLabel',  opts.party);
}

function updateOptionLabel(elId, opt) {
  const el = document.getElementById(elId);
  if (!el || !opt) return;
  const price = opt.price.toLocaleString();
  el.textContent = `${opt.label}（¥${price}）`;
}

// ========================================
// カテゴリ選択
// ========================================
function initCategories() {
  const container = document.getElementById('categoryButtons');
  if (!container) return;

  (CONFIG.categories || []).forEach(category => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-btn';
    btn.textContent = category;
    btn.onclick = () => selectCategory(category, btn);
    container.appendChild(btn);
  });
}

function selectCategory(category, btn) {
  document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedCategory = category;
  document.getElementById('categoryInput').value = category;
  updateSessionWarning();
}

// ========================================
// ブースアコーディオン
// ========================================
function initBoothAccordion() {
  const container = document.getElementById('boothAccordion');
  if (!container) return;

  const locations = [...new Set((CONFIG.booths || []).map(b => b.location))];

  locations.forEach(location => {
    const booths = CONFIG.booths.filter(b => b.location === location);

    const header = document.createElement('div');
    header.className = 'accordion-header';
    header.innerHTML = `<span class="font-bold">${location}</span><span class="accordion-icon">▼</span>`;

    const content = document.createElement('div');
    content.className = 'accordion-content';

    booths.forEach(booth => {
      const earlyPrice   = booth.prices.earlyBird;
      const regularPrice = booth.prices.regular;
      let priceDisplay;

      if (isEarlyBird()) {
        priceDisplay = earlyPrice === regularPrice
          ? `¥${earlyPrice.toLocaleString()}`
          : `¥${earlyPrice.toLocaleString()} <span class="booth-price-early">（通常¥${regularPrice.toLocaleString()}）</span>`;
      } else {
        priceDisplay = `¥${regularPrice.toLocaleString()}`;
      }

      const option = document.createElement('label');
      option.className = 'booth-option' + (booth.soldOut ? ' sold-out' : '');

      if (booth.soldOut) {
        option.innerHTML = `
          <input type="radio" name="boothRadio" value="${booth.id}" disabled>
          <span style="flex:1">${booth.name}</span>
          <span class="sold-out-badge">満枠</span>`;
      } else {
        option.innerHTML = `
          <input type="radio" name="boothRadio" value="${booth.id}" onchange="selectBooth('${booth.id}')">
          <span style="flex:1">${booth.name}</span>
          <span class="booth-price">${priceDisplay}</span>`;
      }

      content.appendChild(option);
    });

    header.onclick = () => {
      header.classList.toggle('active');
      content.classList.toggle('open');
    };

    container.appendChild(header);
    container.appendChild(content);
  });
}

// ========================================
// ブース選択処理
// ========================================
function selectBooth(boothId) {
  selectedBooth = (CONFIG.booths || []).find(b => b.id === boothId);
  document.getElementById('boothIdInput').value = boothId;

  document.querySelectorAll('.booth-option').forEach(opt => {
    opt.classList.remove('selected');
    if (opt.querySelector(`input[value="${boothId}"]`)) opt.classList.add('selected');
  });

  // オプション値リセット
  optionValues.staff  = 0;
  optionValues.chairs = 0;
  const staffVal  = document.getElementById('staffValue');
  const chairsVal = document.getElementById('chairsValue');
  const staffInp  = document.getElementById('extraStaffInput');
  const chairsInp = document.getElementById('extraChairsInput');
  if (staffVal)  staffVal.textContent  = '1';
  if (chairsVal) chairsVal.textContent = '1';
  if (staffInp)  staffInp.value  = '0';
  if (chairsInp) chairsInp.value = '0';

  const wantStaffNo  = document.querySelector('input[name="wantStaff"][value="0"]');
  const wantChairsNo = document.querySelector('input[name="wantChairs"][value="0"]');
  if (wantStaffNo)  wantStaffNo.checked  = true;
  if (wantChairsNo) wantChairsNo.checked = true;
  const staffCountSec  = document.getElementById('staffCountSection');
  const chairsCountSec = document.getElementById('chairsCountSection');
  if (staffCountSec)  staffCountSec.classList.add('hidden');
  if (chairsCountSec) chairsCountSec.classList.add('hidden');

  // BodyEquipment セクション
  if (CONFIG.features?.bodyEquipment) {
    const equipSection = document.getElementById('equipmentSection');
    if (equipSection) {
      equipSection.classList.toggle('hidden', !boothId.startsWith('body_'));
    }
  }

  updateOptionsUI();
  updateSessionWarning();
  calculatePrice();
}

// ========================================
// オプション UI 更新
// ========================================
function updateOptionsUI() {
  const staffSection = document.getElementById('optionStaff');
  const chairsSection = document.getElementById('optionChairs');
  const powerSection  = document.getElementById('optionPower');
  const noOptMsg      = document.getElementById('noOptionsMessage');
  const opts = CONFIG.pricing?.options || {};

  if (!selectedBooth) {
    if (staffSection)  staffSection.classList.add('hidden');
    if (chairsSection) chairsSection.classList.add('hidden');
    if (powerSection)  powerSection.classList.add('hidden');
    if (noOptMsg)      noOptMsg.classList.remove('hidden');
    return;
  }

  const limits = selectedBooth.limits;
  let hasAny = false;

  if (staffSection) {
    const show = limits.maxStaff > 0 && opts.staff?.enabled;
    staffSection.classList.toggle('hidden', !show);
    if (show) {
      const maxEl = document.getElementById('staffMax');
      if (maxEl) maxEl.textContent = limits.maxStaff;
      hasAny = true;
    }
  }

  if (chairsSection) {
    const show = limits.maxChairs > 0 && opts.chair?.enabled;
    chairsSection.classList.toggle('hidden', !show);
    if (show) {
      const maxEl = document.getElementById('chairsMax');
      if (maxEl) maxEl.textContent = limits.maxChairs;
      hasAny = true;
    }
  }

  if (powerSection) {
    const show = limits.allowPower && opts.power?.enabled;
    powerSection.classList.toggle('hidden', !show);
    if (show) hasAny = true;
  }

  if (noOptMsg) noOptMsg.classList.toggle('hidden', hasAny);
}

// ========================================
// セッション禁止警告
// ========================================
function updateSessionWarning() {
  const warning = document.getElementById('sessionWarning');
  if (!warning) return;

  if (!selectedBooth || !selectedCategory) {
    warning.classList.remove('visible'); return;
  }

  if (selectedBooth.prohibitSession &&
      ['占い・スピリチュアル', 'ボディケア・美容'].includes(selectedCategory)) {
    warning.classList.add('visible');
  } else {
    warning.classList.remove('visible');
  }
}

// ========================================
// オプション切り替え
// ========================================
function toggleStaffCount() {
  const section  = document.getElementById('staffCountSection');
  const wantStaff = document.querySelector('input[name="wantStaff"]:checked')?.value === '1';
  if (section) section.classList.toggle('hidden', !wantStaff);
  optionValues.staff = wantStaff ? 1 : 0;
  const staffVal = document.getElementById('staffValue');
  const staffInp = document.getElementById('extraStaffInput');
  if (staffVal) staffVal.textContent = wantStaff ? '1' : '0';
  if (staffInp) staffInp.value = wantStaff ? '1' : '0';
  calculatePrice();
}

function toggleChairsCount() {
  const section    = document.getElementById('chairsCountSection');
  const wantChairs = document.querySelector('input[name="wantChairs"]:checked')?.value === '1';
  if (section) section.classList.toggle('hidden', !wantChairs);
  optionValues.chairs = wantChairs ? 1 : 0;
  const chairsVal = document.getElementById('chairsValue');
  const chairsInp = document.getElementById('extraChairsInput');
  if (chairsVal) chairsVal.textContent = wantChairs ? '1' : '0';
  if (chairsInp) chairsInp.value = wantChairs ? '1' : '0';
  calculatePrice();
}

function adjustQuantity(type, delta) {
  if (!selectedBooth) return;
  const limits = selectedBooth.limits;
  let max, current, valueEl, inputEl;

  if (type === 'staff') {
    max = limits.maxStaff; current = optionValues.staff;
    valueEl = document.getElementById('staffValue');
    inputEl = document.getElementById('extraStaffInput');
  } else {
    max = limits.maxChairs; current = optionValues.chairs;
    valueEl = document.getElementById('chairsValue');
    inputEl = document.getElementById('extraChairsInput');
  }

  const newVal = Math.max(1, Math.min(max, current + delta));
  optionValues[type] = newVal;
  if (valueEl) valueEl.textContent = newVal;
  if (inputEl) inputEl.value = newVal;
  calculatePrice();
}

// ========================================
// 懇親会・二次会
// ========================================
function togglePartyCount() {
  const section   = document.getElementById('partyCountSection');
  const attending = document.querySelector('input[name="partyAttend"]:checked')?.value === '出席';
  if (section) section.classList.toggle('hidden', !attending);
  optionValues.partyCount = attending ? 1 : 0;
  const partyVal = document.getElementById('partyValue');
  const partyInp = document.getElementById('partyCountInput');
  if (partyVal) partyVal.textContent = '1';
  if (partyInp) partyInp.value = attending ? '1' : '0';
  calculatePrice();
}

function toggleSecondaryPartyCount() {
  const section   = document.getElementById('secondaryPartyCountSection');
  const attending = document.querySelector('input[name="secondaryPartyAttend"]:checked')?.value === '出席';
  if (section) section.classList.toggle('hidden', !attending);
  optionValues.secondaryPartyCount = attending ? 1 : 0;
  const secVal = document.getElementById('secondaryValue');
  const secInp = document.getElementById('secondaryPartyCountInput');
  if (secVal) secVal.textContent = '1';
  if (secInp) secInp.value = attending ? '1' : '0';
}

function adjustPartyCount(type, delta) {
  let current, valueEl, inputEl;
  if (type === 'party') {
    current = optionValues.partyCount;
    valueEl = document.getElementById('partyValue');
    inputEl = document.getElementById('partyCountInput');
  } else {
    current = optionValues.secondaryPartyCount;
    valueEl = document.getElementById('secondaryValue');
    inputEl = document.getElementById('secondaryPartyCountInput');
  }
  const newVal = Math.max(1, current + delta);
  if (type === 'party') optionValues.partyCount = newVal;
  else                  optionValues.secondaryPartyCount = newVal;
  if (valueEl) valueEl.textContent = newVal;
  if (inputEl) inputEl.value = newVal;
  if (type === 'party') calculatePrice();
}

// ========================================
// スタンプラリー
// ========================================
function togglePrizeInput() {
  const section  = document.getElementById('prizeInputSection');
  const hasPrize = document.querySelector('input[name="stampRallyPrize"]:checked')?.value === 'ある';
  if (section) section.classList.toggle('hidden', !hasPrize);
}

// ========================================
// 規約モーダル
// ========================================
function showTerms() {
  document.getElementById('termsModal')?.classList.remove('hidden');
}
function hideTerms() {
  document.getElementById('termsModal')?.classList.add('hidden');
}

// ========================================
// 料金計算
// ========================================
function calculatePrice() {
  const breakdown = [];
  let total = 0;
  const opts = CONFIG?.pricing?.options || {};

  if (selectedBooth) {
    const boothPrice = isEarlyBird()
      ? selectedBooth.prices.earlyBird
      : selectedBooth.prices.regular;
    breakdown.push(`${selectedBooth.name}: ¥${boothPrice.toLocaleString()}`);
    total += boothPrice;

    if (optionValues.staff > 0 && opts.staff?.enabled) {
      const cost = optionValues.staff * opts.staff.price;
      breakdown.push(`${opts.staff.label}×${optionValues.staff}: ¥${cost.toLocaleString()}`);
      total += cost;
    }

    if (optionValues.chairs > 0 && opts.chair?.enabled) {
      const cost = optionValues.chairs * opts.chair.price;
      breakdown.push(`${opts.chair.label}×${optionValues.chairs}: ¥${cost.toLocaleString()}`);
      total += cost;
    }

    const usePower = document.querySelector('input[name="usePower"]:checked')?.value === '1';
    if (usePower && selectedBooth.limits.allowPower && opts.power?.enabled) {
      breakdown.push(`${opts.power.label}: ¥${opts.power.price.toLocaleString()}`);
      total += opts.power.price;
      optionValues.power = true;
    } else {
      optionValues.power = false;
    }
  }

  if (optionValues.partyCount > 0 && opts.party?.enabled) {
    const cost = optionValues.partyCount * opts.party.price;
    breakdown.push(`${opts.party.label}×${optionValues.partyCount}: ¥${cost.toLocaleString()}`);
    total += cost;
  }

  const isMember = CONFIG.features?.memberDiscount &&
    document.querySelector('input[name="isMember"]:checked')?.value === '1';
  if (isMember && CONFIG.pricing?.memberDiscount) {
    const disc = CONFIG.pricing.memberDiscount;
    breakdown.push(`${CONFIG.features.memberDiscountLabel || '会員割引'}: -¥${disc.toLocaleString()}`);
    total -= disc;
  }

  const bdEl    = document.getElementById('priceBreakdown');
  const totalEl = document.getElementById('totalPrice');
  if (bdEl)    bdEl.textContent = breakdown.length ? breakdown.join(' + ') : 'ブースを選択してください';
  if (totalEl) totalEl.textContent = `¥${Math.max(0, total).toLocaleString()}`;
}

// 電源変更時も再計算
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input[name="usePower"]').forEach(r =>
    r.addEventListener('change', calculatePrice));
  document.querySelectorAll('input[name="isMember"]').forEach(r =>
    r.addEventListener('change', calculatePrice));
});

// ========================================
// カスタム質問レンダリング
// ========================================
function renderCustomQuestions() {
  const container = document.getElementById('customQuestionsSection');
  if (!container) return;
  container.innerHTML = '';

  const questions = CONFIG.customQuestions || [];
  if (!questions.length) {
    container.style.display = 'none';
    return;
  }

  questions.forEach(q => {
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '1rem';

    const label = document.createElement('label');
    label.className = 'input-label';
    label.setAttribute('for', q.id);
    label.innerHTML = `${q.label}${q.required ? '<span class="required">*</span>' : ''}`;
    wrapper.appendChild(label);

    let input;
    if (q.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 4;
    } else if (q.type === 'select') {
      input = document.createElement('select');
      input.className = 'input-field';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '選択してください';
      input.appendChild(defaultOpt);
      (q.options || []).forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        input.appendChild(o);
      });
    } else if (q.type === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
    } else {
      input = document.createElement('input');
      input.type = 'text';
    }

    input.id = q.id;
    input.name = q.id;
    if (input.tagName !== 'SELECT') input.className = 'input-field';
    if (q.placeholder) input.placeholder = q.placeholder;
    if (q.maxLength)   input.maxLength   = q.maxLength;
    if (q.required)    input.required    = true;
    wrapper.appendChild(input);

    // 文字数カウンター
    if (q.showCounter && q.maxLength) {
      const counter = document.createElement('div');
      counter.className = 'char-counter';
      counter.id = `counter_${q.id}`;
      counter.innerHTML = `<span id="count_${q.id}">0</span>/${q.maxLength}`;
      wrapper.appendChild(counter);

      input.addEventListener('input', () => {
        const len = input.value.length;
        const countEl = document.getElementById(`count_${q.id}`);
        if (countEl) countEl.textContent = len;
        counter.classList.toggle('over', len > q.maxLength);
      });
    }

    container.appendChild(wrapper);
  });
}

// ========================================
// SNS 入力
// ========================================
function initSnsInputs() {
  const container = document.getElementById('snsLinksContainer');
  const addBtn    = document.getElementById('addSnsBtn');
  if (!container) return;

  container.querySelectorAll('.sns-input').forEach(input =>
    input.addEventListener('input', handleSnsInput));

  addBtn?.addEventListener('click', () => {
    if (snsLinkCount >= 6) return;
    snsLinkCount++;
    const row = document.createElement('div');
    row.className = 'sns-link-row';
    row.innerHTML = `
      <span class="sns-badge" data-index="${snsLinkCount - 1}">未入力</span>
      <input type="url" name="snsLink${snsLinkCount}" class="input-field" style="flex:1"
        data-index="${snsLinkCount - 1}" placeholder="https://...">
      <button type="button" style="color:#ef4444;padding:0 0.5rem;border:none;background:none;cursor:pointer;font-size:1.2rem" onclick="removeSnsRow(this)">✕</button>`;
    container.appendChild(row);
    row.querySelector('.sns-input')?.addEventListener('input', handleSnsInput);
    if (snsLinkCount >= 6) addBtn.style.display = 'none';
  });
}

function handleSnsInput(e) {
  const url   = e.target.value;
  const index = e.target.dataset.index;
  const badge = document.querySelector(`.sns-badge[data-index="${index}"]`);
  if (!badge) return;

  if (!url) {
    badge.textContent = '未入力';
    badge.style.cssText = '';
    return;
  }

  let detected = null;
  for (const sns of SNS_PATTERNS) {
    if (sns.pattern.test(url)) { detected = sns; break; }
  }

  if (detected) {
    badge.textContent = detected.name;
    badge.style.background = detected.color;
    badge.style.color = '#fff';
  } else {
    badge.textContent = 'HP';
    badge.style.background = '#6366f1';
    badge.style.color = '#fff';
  }
}

function removeSnsRow(btn) {
  btn.closest('.sns-link-row')?.remove();
  snsLinkCount--;
  const addBtn = document.getElementById('addSnsBtn');
  if (addBtn) addBtn.style.display = 'block';
}

function addSnsLinkInput(url = '') {
  const container = document.getElementById('snsLinksContainer');
  const addBtn    = document.getElementById('addSnsBtn');
  if (!container || snsLinkCount >= 6) return;

  snsLinkCount++;
  const row = document.createElement('div');
  row.className = 'sns-link-row';
  row.innerHTML = `
    <span class="sns-badge" data-index="${snsLinkCount - 1}">未入力</span>
    <input type="url" name="snsLink${snsLinkCount}" class="input-field" style="flex:1"
      data-index="${snsLinkCount - 1}" placeholder="https://..." value="${url}">
    <button type="button" style="color:#ef4444;padding:0 0.5rem;border:none;background:none;cursor:pointer;font-size:1.2rem" onclick="removeSnsRow(this)">✕</button>`;
  container.appendChild(row);

  const inp = row.querySelector('.sns-input');
  inp?.addEventListener('input', handleSnsInput);
  if (url) inp?.dispatchEvent(new Event('input'));
  if (snsLinkCount >= 6 && addBtn) addBtn.style.display = 'none';
}

// ========================================
// 文字数カウンター初期化（既存HMTLフィールド用）
// ========================================
function initCharCounters() {
  document.querySelectorAll('[data-maxlength]').forEach(input => {
    const max = parseInt(input.dataset.maxlength);
    const counterId = input.dataset.counter;
    const counter   = counterId ? document.getElementById(counterId) : null;
    if (!counter) return;
    input.addEventListener('input', () => {
      const len = input.value.length;
      counter.textContent = len;
      counter.parentElement?.classList.toggle('over', len > max);
    });
  });
}

// ========================================
// バリデーション
// ========================================
function validateForm() {
  const form = document.getElementById('applicationForm');
  const errors = [];

  // 固定必須フィールド
  const fixedFields = [
    { name: 'name',          label: 'お名前'    },
    { name: 'furigana',      label: 'ふりがな'  },
    { name: 'email',         label: 'メールアドレス' },
    { name: 'exhibitorName', label: CONFIG.standardFields?.exhibitorNameLabel || '出展名' }
  ];
  const sf = CONFIG.standardFields || {};
  if (sf.showAddress    !== false) fixedFields.push(
    { name: 'postalCode', label: '郵便番号' },
    { name: 'address',    label: 'ご住所'   }
  );
  if (sf.showPhoneNumber !== false) fixedFields.push({ name: 'phoneNumber', label: '電話番号' });

  fixedFields.forEach(f => {
    const input = form.querySelector(`[name="${f.name}"]`);
    if (!input) return;
    if (!input.value.trim()) {
      errors.push(`${f.label}を入力してください`);
      input.classList.add('border-red-500');
    } else {
      input.classList.remove('border-red-500');
    }
  });

  // カテゴリ
  if ((CONFIG.categories?.length) && !selectedCategory) {
    errors.push('出展カテゴリを選択してください');
  }

  // ブース
  if (!selectedBooth) errors.push('出展ブースを選択してください');

  // カスタム質問
  (CONFIG.customQuestions || []).forEach(q => {
    if (!q.required) return;
    const input = document.getElementById(q.id);
    if (!input || !input.value.trim()) {
      errors.push(`${q.label}を入力してください`);
      if (input) input.classList.add('border-red-500');
    } else {
      input.classList.remove('border-red-500');
      if (q.maxLength && input.value.length > q.maxLength) {
        errors.push(`${q.label}は${q.maxLength}文字以内で入力してください`);
      }
    }
  });

  // 写真
  if (sf.showPhotoUpload !== false) {
    const photoInput = form.querySelector('[name="profileImage"]');
    const usePrevious = form.querySelector('[name="usePreviousPhoto"]')?.checked;
    if (!usePrevious) {
      if (!photoInput?.files?.length) {
        errors.push('プロフィール写真をアップロードしてください');
      } else if (photoInput.files[0].size > 8 * 1024 * 1024) {
        errors.push('画像ファイルは8MB以下にしてください');
      }
    }
  }

  // 写真掲載可否
  if (sf.showPhotoPermission !== false) {
    if (!form.querySelector('input[name="photoPermission"]:checked')) {
      errors.push('写真のSNS投稿への掲載可否を選択してください');
    }
  }

  // メールアドレス形式
  const emailInput = form.querySelector('[name="email"]');
  if (emailInput?.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value)) {
    errors.push('メールアドレスの形式が正しくありません');
  }

  // メールアドレス一致
  const emailConf = form.querySelector('[name="emailConfirm"]');
  if (emailInput && emailConf && emailInput.value !== emailConf.value) {
    errors.push('メールアドレスが一致しません');
  }

  // 規約同意
  if (!form.querySelector('[name="agreeTerms"]')?.checked) {
    errors.push('出展規約への同意が必要です');
  }

  return errors;
}

// ========================================
// フォーム送信
// ========================================
async function submitForm() {
  const errors = validateForm();
  if (errors.length) {
    alert('入力エラー:\n\n' + errors.join('\n'));
    return;
  }

  // セッション禁止警告
  if (document.getElementById('sessionWarning')?.classList.contains('visible')) {
    if (!confirm('⚠️ 選択されたブースではセッション系の出展ができません。物販・飲食のみの出展となりますがよろしいですか？')) {
      return;
    }
  }

  document.getElementById('loadingOverlay')?.classList.add('visible');
  document.getElementById('submitBtn').disabled = true;

  try {
    const form = document.getElementById('applicationForm');
    const formData = new FormData(form);

    // ブース・カテゴリ情報
    formData.set('boothId',    selectedBooth.id);
    formData.set('boothName',  selectedBooth.name);
    if (selectedCategory) formData.set('category', selectedCategory);
    formData.set('isEarlyBird', isEarlyBird() ? '1' : '0');

    const boothPrice = isEarlyBird()
      ? selectedBooth.prices.earlyBird
      : selectedBooth.prices.regular;
    formData.set('boothPrice',          String(boothPrice));
    formData.set('extraStaff',          String(optionValues.staff));
    formData.set('extraChairs',         String(optionValues.chairs));
    formData.set('usePower',            optionValues.power ? '1' : '0');
    formData.set('partyCount',          String(optionValues.partyCount));
    formData.set('secondaryPartyCount', String(optionValues.secondaryPartyCount));

    // カスタム質問の回答（JSON形式で送信）
    const customAnswers = {};
    (CONFIG.customQuestions || []).forEach(q => {
      const el = document.getElementById(q.id);
      customAnswers[q.id] = el ? el.value : '';
    });
    formData.set('customAnswers', JSON.stringify(customAnswers));

    // カスタム質問のラベルも送信（スプシのHeader自動生成用）
    const customQuestionDefs = (CONFIG.customQuestions || []).map(q => ({
      id: q.id, label: q.label
    }));
    formData.set('customQuestionDefs', JSON.stringify(customQuestionDefs));

    // SNS リンク収集
    const snsLinks = [];
    document.querySelectorAll('.sns-input').forEach((input, index) => {
      if (input.value) {
        const badge = document.querySelector(`.sns-badge[data-index="${index}"]`);
        snsLinks.push({ type: badge?.textContent || 'HP', url: input.value });
      }
    });
    formData.set('snsLinks', JSON.stringify(snsLinks));

    // スプレッドシートID
    if (CONFIG.spreadsheetId) formData.set('spreadsheetId', CONFIG.spreadsheetId);

    // イベント名
    formData.set('eventName', CONFIG.event?.name || '');

    // 写真処理
    const photoInput = form.querySelector('[name="profileImage"]');
    if (photoInput?.files?.length) {
      try {
        const b64 = await convertFileToBase64(photoInput.files[0]);
        formData.set('profileImageBase64',  b64.base64);
        formData.set('profileImageMimeType', b64.mimeType);
        formData.set('profileImageName',     b64.name);
      } catch (e) {
        throw new Error('画像の処理に失敗しました。別の画像を選択してください。');
      }
    }

    // LINE情報
    formData.set('lineUserId',      document.getElementById('lineUserId')?.value || '');
    formData.set('lineDisplayName', document.getElementById('lineDisplayName')?.value || '');

    // 送信先
    const targetUrl = CONFIG.workerUrl || CONFIG.gasUrl;
    if (!targetUrl) throw new Error('送信先URLが設定されていません（config.json を確認してください）');

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 90000);

    let response;
    try {
      response = await fetch(targetUrl, {
        method: 'POST',
        body:   formData,
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timeoutId);
      throw e.name === 'AbortError'
        ? new Error('通信がタイムアウトしました。再度お試しください。')
        : new Error('ネットワークエラーが発生しました。接続を確認してください。');
    }
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error('サーバーとの通信に失敗しました。');

    const result = await response.json().catch(() => { throw new Error('サーバーからの応答が不正です。'); });

    if (result.success) {
      document.getElementById('completeModal')?.classList.remove('hidden');
    } else {
      throw new Error(result.error || '送信に失敗しました。再度お試しください。');
    }

  } catch (err) {
    console.error('Submit error:', err);
    alert(`送信エラー:\n\n${err.message}\n\n解決しない場合は、主催者へお問合せください。`);
  } finally {
    document.getElementById('loadingOverlay')?.classList.remove('visible');
    document.getElementById('submitBtn').disabled = false;
  }
}

// ========================================
// 郵便番号検索
// ========================================
function initPostalCodeSearch() {
  const postalInput = document.getElementById('postalCode');
  if (!postalInput) return;

  postalInput.addEventListener('input', e => {
    let v = e.target.value.replace(/[^0-9]/g, '');
    if (v.length > 3) v = v.slice(0,3) + '-' + v.slice(3,7);
    e.target.value = v;
    document.getElementById('postalCodeError')?.classList.add('hidden');
    if (v.replace('-','').length === 7) searchAddress();
  });
}

async function searchAddress() {
  const postalInput = document.getElementById('postalCode');
  const addressInput = document.getElementById('addressInput');
  const searchBtn   = document.getElementById('searchAddressBtn');
  const errorEl     = document.getElementById('postalCodeError');
  if (!postalInput) return;

  const code = postalInput.value.replace(/[^0-9]/g, '');
  if (code.length !== 7) {
    if (errorEl) { errorEl.textContent = '郵便番号は7桁で入力してください'; errorEl.classList.remove('hidden'); }
    return;
  }

  if (searchBtn) { searchBtn.classList.add('loading'); searchBtn.textContent = '検索中...'; }
  errorEl?.classList.add('hidden');

  try {
    const res  = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${code}`);
    const data = await res.json();
    if (data.status === 200 && data.results?.length) {
      const r = data.results[0];
      if (addressInput) { addressInput.value = r.address1 + r.address2 + r.address3; addressInput.focus(); }
      if (searchBtn) { searchBtn.textContent = '✓ 反映済み'; setTimeout(() => { searchBtn.textContent = '住所検索'; }, 2000); }
    } else {
      if (errorEl) { errorEl.textContent = '郵便番号が見つかりません'; errorEl.classList.remove('hidden'); }
      if (searchBtn) searchBtn.textContent = '住所検索';
    }
  } catch {
    if (errorEl) { errorEl.textContent = '検索に失敗しました'; errorEl.classList.remove('hidden'); }
    if (searchBtn) searchBtn.textContent = '住所検索';
  } finally {
    searchBtn?.classList.remove('loading');
  }
}

// ========================================
// メールアドレス一致チェック
// ========================================
function initEmailConfirmation() {
  const emailInput = document.getElementById('emailInput');
  const emailConf  = document.getElementById('emailConfirmInput');
  const errorEl    = document.getElementById('emailMatchError');
  if (!emailInput || !emailConf) return;

  const check = () => {
    if (!emailConf.value) { errorEl?.classList.add('hidden'); return; }
    const match = emailInput.value === emailConf.value;
    errorEl?.classList.toggle('hidden', match);
    emailConf.classList.toggle('border-red-500', !match);
    emailConf.classList.toggle('border-green-500', match);
  };
  emailInput.addEventListener('input', check);
  emailConf.addEventListener('input', check);
}

// ========================================
// ファイルサイズチェック
// ========================================
function initFileSizeCheck() {
  const photoInput = document.getElementById('profileImage');
  if (!photoInput) return;

  photoInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith('.heic') || name.endsWith('.heif')) {
      alert('HEIC形式はサポートされていません。JPGまたはPNG形式でアップロードしてください。');
      e.target.value = ''; return;
    }
    if (file.size > 8 * 1024 * 1024) {
      alert(`画像は8MB以下にしてください。\n現在: ${(file.size/1024/1024).toFixed(2)}MB`);
      e.target.value = '';
    }
  });
}

// ========================================
// LIFF 初期化
// ========================================
async function initLiff() {
  const liffId = CONFIG.features?.liffId;
  if (!liffId || typeof liff === 'undefined') return;

  try {
    await liff.init({ liffId });
    if (liff.isLoggedIn()) {
      const profile = await liff.getProfile();
      const uidEl  = document.getElementById('lineUserId');
      const nameEl = document.getElementById('lineDisplayName');
      if (uidEl)  uidEl.value  = profile.userId;
      if (nameEl) nameEl.value = profile.displayName;
    }
  } catch (err) {
    console.error('LIFF init error:', err);
  }
}

// ========================================
// リピーター検索
// ========================================
function initRepeaterSearch() {
  const toggleBtn   = document.getElementById('toggleRepeaterSearchBtn');
  const searchArea  = document.getElementById('repeaterSearchArea');
  const sendAuthBtn = document.getElementById('sendAuthCodeBtn');
  const verifyBtn   = document.getElementById('verifyAuthCodeBtn');
  const authCodeArea = document.getElementById('authCodeArea');
  const statusEl    = document.getElementById('repeaterSearchStatus');

  toggleBtn?.addEventListener('click', () => searchArea?.classList.toggle('hidden'));

  sendAuthBtn?.addEventListener('click', async () => {
    const name  = document.getElementById('repeaterName')?.value;
    const email = document.getElementById('repeaterEmail')?.value;
    if (!name || !email) {
      setStatus(statusEl, '❌ お名前とメールアドレスを入力してください', 'red'); return;
    }
    setStatus(statusEl, '📧 認証コードを送信中...', 'blue');
    sendAuthBtn.disabled = true;
    try {
      const url = new URL(`${CONFIG.workerUrl || CONFIG.gasUrl}`);
      url.searchParams.set('action', 'send_auth_code');
      url.searchParams.set('name',   name);
      url.searchParams.set('email',  email);
      const res = await fetch(url); const data = await res.json();
      if (data.success) {
        setStatus(statusEl, '✅ 認証コードをメールに送信しました', 'green');
        authCodeArea?.classList.remove('hidden');
        sendAuthBtn.classList.add('hidden');
      } else {
        setStatus(statusEl, `⚠️ ${data.error || '該当データが見つかりませんでした'}`, 'amber');
        sendAuthBtn.disabled = false;
      }
    } catch {
      setStatus(statusEl, '❌ エラーが発生しました', 'red');
      sendAuthBtn.disabled = false;
    }
  });

  verifyBtn?.addEventListener('click', async () => {
    const name  = document.getElementById('repeaterName')?.value;
    const email = document.getElementById('repeaterEmail')?.value;
    const code  = document.getElementById('repeaterAuthCode')?.value;
    if (!code || code.length < 4) {
      setStatus(statusEl, '❌ 4桁の認証コードを入力してください', 'red'); return;
    }
    setStatus(statusEl, '🔍 認証中...', 'blue');
    verifyBtn.disabled = true;
    try {
      const url = new URL(`${CONFIG.workerUrl || CONFIG.gasUrl}`);
      url.searchParams.set('action', 'verify_auth_code');
      url.searchParams.set('name',   name);
      url.searchParams.set('email',  email);
      url.searchParams.set('code',   code);
      const res = await fetch(url); const data = await res.json();
      if (data.success && data.list?.length) {
        setStatus(statusEl, '✅ 認証成功！データを選択してください', 'green');
        showRepeaterSelectionModal(data.list, statusEl, searchArea);
      } else {
        setStatus(statusEl, `❌ ${data.error || '認証に失敗しました'}`, 'red');
        verifyBtn.disabled = false;
      }
    } catch {
      setStatus(statusEl, '❌ エラーが発生しました', 'red');
      verifyBtn.disabled = false;
    }
  });
}

function setStatus(el, msg, color) {
  if (!el) return;
  const colors = { red: '#dc2626', blue: '#2563eb', green: '#16a34a', amber: '#d97706' };
  el.textContent = msg;
  el.style.color = colors[color] || '#374151';
}

function showRepeaterSelectionModal(list, statusEl, searchArea) {
  const modal     = document.getElementById('repeaterSelectModal');
  const listBox   = document.getElementById('repeaterList');
  const closeBtn  = document.getElementById('closeRepeaterModalBtn');
  if (!modal || !listBox) return;

  listBox.innerHTML = '';
  list.forEach(data => {
    const item = document.createElement('div');
    item.style.cssText = 'border:1.5px solid #e5e7eb;border-radius:0.5rem;padding:1rem;cursor:pointer;display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;';
    item.innerHTML = `
      <div>
        <p style="font-weight:700">${data.eventName || '過去のイベント'}</p>
        <p style="font-size:0.8rem;color:#6b7280">${data.submittedAt || ''}</p>
        <p style="font-size:0.85rem;color:#374151">出展名: ${data.exhibitorName || ''}</p>
      </div>
      <button type="button" style="background:var(--color-primary);color:#fff;padding:0.4rem 1rem;border:none;border-radius:0.5rem;font-weight:700;cursor:pointer;font-size:0.85rem">選択</button>`;
    item.addEventListener('click', () => {
      fillFormWithData(data);
      modal.classList.add('hidden');
      setStatus(statusEl, '✅ データを自動入力しました', 'green');
      setTimeout(() => searchArea?.classList.add('hidden'), 1500);
    });
    listBox.appendChild(item);
  });

  closeBtn && (closeBtn.onclick = () => {
    modal.classList.add('hidden');
    setStatus(statusEl, '⚠️ キャンセルしました', 'amber');
  });
  modal.classList.remove('hidden');
}

function fillFormWithData(data) {
  const setVal = (sel, val) => { const el = document.querySelector(sel); if (el && val) el.value = val; };
  setVal('#nameInput',             data.name);
  setVal('[name="furigana"]',      data.furigana);
  setVal('[name="phoneNumber"]',   data.phone);
  setVal('#postalCode',            data.postalCode);
  setVal('#addressInput',          data.address);
  setVal('#emailInput',            data.email);
  setVal('#emailConfirmInput',     data.email);
  setVal('[name="exhibitorName"]', data.exhibitorName);

  // カテゴリ復元
  if (data.category) {
    document.addEventListener('configLoaded', () => {}, { once: true });
    document.querySelectorAll('.category-btn').forEach(btn => {
      if (btn.textContent === data.category) btn.click();
    });
  }

  // 写真再利用
  const imageUrl = data.profileImageUrl || data.photoUrl;
  if (imageUrl) {
    const reuseOpt = document.getElementById('reusePhotoOption');
    const prevImg  = document.getElementById('prevPhotoImg');
    const hiddenUrl = document.getElementById('profileImageUrl');
    if (reuseOpt && prevImg && hiddenUrl) {
      reuseOpt.classList.remove('hidden');
      const idMatch = imageUrl.match(/(?:\/d\/|id=)([\w-]+)/);
      prevImg.src = idMatch ? `https://lh3.googleusercontent.com/d/${idMatch[1]}` : imageUrl;
      prevImg.onerror = () => { prevImg.style.display = 'none'; };
      hiddenUrl.value = imageUrl;
    }
  }

  // SNS リンク復元
  const container = document.getElementById('snsLinksContainer');
  if (container) { container.innerHTML = ''; snsLinkCount = 0; }
  const snsData = data.snsLinks || data.sns;
  const snsList = [];
  if (snsData) {
    if (snsData.hp)    snsList.push(snsData.hp);
    if (snsData.insta) snsList.push(snsData.insta);
    if (snsData.blog)  snsList.push(snsData.blog);
    if (snsData.fb)    snsList.push(snsData.fb);
    if (snsData.line)  snsList.push(snsData.line);
    if (snsData.other) snsList.push(snsData.other);
  }
  snsList.filter(Boolean).forEach(url => addSnsLinkInput(url));
  if (!snsList.length) addSnsLinkInput();

  document.querySelectorAll('textarea, input[type="text"]').forEach(el =>
    el.dispatchEvent(new Event('input')));
}

function togglePhotoUpload() {
  const checkbox  = document.getElementById('usePreviousPhoto');
  const fileInput = document.getElementById('profileImage');
  const preview   = document.getElementById('previousPhotoPreview');
  const reqTag    = document.getElementById('photoRequiredTag');
  if (!checkbox || !fileInput) return;

  if (checkbox.checked) {
    fileInput.disabled = true; fileInput.required = false; fileInput.value = '';
    preview?.classList.remove('hidden');
    if (reqTag) reqTag.style.display = 'none';
  } else {
    fileInput.disabled = false; fileInput.required = true;
    preview?.classList.add('hidden');
    if (reqTag) reqTag.style.display = 'inline';
  }
}

// ========================================
// 画像 Base64 変換
// ========================================
function convertFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = e => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx    = canvas.getContext('2d');
          if (!ctx) { reject(new Error('Canvas初期化失敗')); return; }
          const MAX = 1200;
          let { width, height } = img;
          if (width > height) { if (width > MAX) { height = Math.round(height * MAX / width); width = MAX; } }
          else                { if (height > MAX) { width = Math.round(width * MAX / height); height = MAX; } }
          canvas.width = width; canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          const base64  = dataUrl.split(',')[1];
          if (!base64) { reject(new Error('画像変換結果が空')); return; }
          resolve({ base64, mimeType: 'image/jpeg', name: file.name.replace(/\.[^/.]+$/, '') + '.jpg' });
        } catch (e) { reject(new Error('画像圧縮処理に失敗: ' + e.message)); }
      };
      img.onerror = () => reject(new Error('画像読み込み失敗'));
    };
    reader.onerror = () => reject(new Error('ファイル読み取り失敗'));
  });
}
