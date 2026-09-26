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
// 選択時に縮小・圧縮を済ませた写真（送信時はこれをそのまま使う）
let preparedPhoto = null;
// バックエンドから受け取ったブースの空き状況 { ブースID: { full, remaining } }
let boothAvailability = {};
// 満枠のブースをキャンセル待ちとして受け付けるか。
// バックエンドが対応していると確かめられたときだけ true にする
// （古いバックエンドは、キャンセル待ちのつもりの申込を通常の申込として受け付けてしまうため）
let waitlistEnabled = false;

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
  applyFormOrder();
  refreshSections();
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

  // 残り枠を数えるブースがあれば、いまの空き状況を取りに行く（表示は先に出しておく）
  loadBoothAvailability();

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
// ブースの空き状況
// ========================================

/** 満枠か（手動で締め切った／定員に達した） */
function isBoothFull(booth) {
  return !!(booth?.soldOut || boothAvailability[booth?.id]?.full);
}

/** 満枠でも、キャンセル待ちとして選べるか */
function canApplyAsWaitlist(booth) {
  return isBoothFull(booth) && waitlistEnabled;
}

/**
 * バックエンドから、ブースごとの空き状況を受け取って表示に反映します。
 * 受け取れなかった場合は設定ファイルの内容だけで表示し、満枠のブースは選べないままにします
 * （満枠かどうかは送信時にバックエンドでも必ず確かめます）。
 */
async function loadBoothAvailability() {
  const booths = CONFIG.booths || [];
  const counting   = booths.some(b => b.seats?.enabled);
  const waitClosed = CONFIG.features?.waitlist !== false && booths.some(b => b.soldOut);
  if (!counting && !waitClosed) return;

  const base = CONFIG.workerUrl || CONFIG.gasUrl;
  if (!base) return;

  try {
    const url = new URL(base);
    url.searchParams.set('action', 'booth_status');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (!data?.success || !data.booths) return;   // 古いバックエンドは空き状況を返さない

    boothAvailability = data.booths;
    waitlistEnabled   = data.waitlist === true;
    refreshBooths();
  } catch (err) {
    console.warn('ブースの空き状況を取得できませんでした:', err);
  }
}

/** ブースの一覧を描き直す（選んでいたブースはそのまま選んだ状態にする） */
function refreshBooths() {
  const container = document.getElementById('boothAccordion');
  if (!container) return;
  const keepId = selectedBooth?.id;
  container.textContent = '';
  initBoothAccordion();

  if (!keepId) return;
  const booth = (CONFIG.booths || []).find(b => b.id === keepId);
  if (booth && isBoothFull(booth) && !canApplyAsWaitlist(booth)) {
    // 選んでいる間に満枠になり、キャンセル待ちも受け付けない場合は選び直してもらう
    selectedBooth = null;
    document.getElementById('boothIdInput').value = '';
    updateWaitlistNotice();
    calculatePrice();
    return;
  }
  const radio = [...container.querySelectorAll('input[name="boothRadio"]')].find(r => r.value === keepId);
  if (radio) {
    radio.checked = true;
    radio.closest('.booth-option')?.classList.add('selected');
  }
  updateWaitlistNotice();
}

/** 選んだブースが満枠のとき、キャンセル待ちになることを知らせる */
function updateWaitlistNotice() {
  const notice = document.getElementById('waitlistNotice');
  const waiting = !!selectedBooth && canApplyAsWaitlist(selectedBooth);
  if (notice) notice.classList.toggle('hidden', !waiting);

  const btn = document.getElementById('submitBtn');
  if (btn && !btn.disabled) btn.textContent = waiting ? 'キャンセル待ちで申し込む' : '申し込む';
}

// ========================================
// ブース表示
// ========================================
function initBoothAccordion() {
  const container = document.getElementById('boothAccordion');
  if (!container) return;

  const booths = CONFIG.booths || [];

  // 空でない location の種類が 2 以上のときだけアコーディオン表示
  const nonEmptyLocations = [...new Set(booths.map(b => b.location).filter(Boolean))];
  const useAccordion = nonEmptyLocations.length >= 2;

  if (useAccordion) {
    const locations = [...new Set(booths.map(b => b.location))];
    locations.forEach(location => {
      const groupBooths = booths.filter(b => b.location === location);
      if (!location) {
        // location が空 → ヘッダーなしで直接追加
        groupBooths.forEach(booth => container.appendChild(createBoothOption(booth)));
        return;
      }
      const header = document.createElement('div');
      header.className = 'accordion-header';
      header.innerHTML = `<span class="font-bold">${location}</span><span class="accordion-icon">▼</span>`;
      const content = document.createElement('div');
      content.className = 'accordion-content';
      groupBooths.forEach(booth => content.appendChild(createBoothOption(booth)));
      header.onclick = () => {
        header.classList.toggle('active');
        content.classList.toggle('open');
      };
      container.appendChild(header);
      container.appendChild(content);
    });
  } else {
    // フラット表示（アコーディオンなし）
    booths.forEach(booth => container.appendChild(createBoothOption(booth)));
  }
}

// ブースオプション要素を生成するヘルパー
// ブースIDにはブース名がそのまま入るため、引用符や記号が含まれても
// 壊れないよう、文字列ではなく DOM API で組み立てる
function createBoothOption(booth) {
  const earlyPrice   = booth.prices.earlyBird;
  const regularPrice = booth.prices.regular;

  const full      = isBoothFull(booth);
  const waitlist  = full && canApplyAsWaitlist(booth);
  const remaining = boothAvailability[booth.id]?.remaining;

  const option = document.createElement('label');
  option.className = 'booth-option' + (full ? (waitlist ? ' waitlist' : ' sold-out') : '');

  const radio = document.createElement('input');
  radio.type  = 'radio';
  radio.name  = 'boothRadio';
  radio.value = booth.id;

  const name = document.createElement('span');
  name.className = 'booth-name';
  name.style.flex = '1';
  name.textContent = booth.name;

  option.append(radio, name);

  if (full && !waitlist) {
    radio.disabled = true;
    const badge = document.createElement('span');
    badge.className = 'sold-out-badge';
    badge.textContent = '満枠';
    option.appendChild(badge);
  } else {
    if (waitlist) {
      const badge = document.createElement('span');
      badge.className = 'waitlist-badge';
      badge.textContent = '満枠・キャンセル待ち';
      name.appendChild(badge);
    } else if (typeof remaining === 'number' && remaining > 0) {
      const badge = document.createElement('span');
      badge.className = 'remaining-badge';
      badge.textContent = `残りあと${remaining}枠`;
      name.appendChild(badge);
    }

    radio.addEventListener('change', () => selectBooth(booth.id));
    const price = document.createElement('span');
    price.className = 'booth-price';
    if (isEarlyBird() && earlyPrice !== regularPrice) {
      price.textContent = `¥${earlyPrice.toLocaleString()} `;
      const note = document.createElement('span');
      note.className = 'booth-price-early';
      note.textContent = `（通常¥${regularPrice.toLocaleString()}）`;
      price.appendChild(note);
    } else {
      price.textContent = `¥${(isEarlyBird() ? earlyPrice : regularPrice).toLocaleString()}`;
    }
    option.appendChild(price);
  }

  return option;
}

// ========================================
// ブース選択処理
// ========================================
function selectBooth(boothId) {
  selectedBooth = (CONFIG.booths || []).find(b => b.id === boothId);
  document.getElementById('boothIdInput').value = boothId;

  document.querySelectorAll('.booth-option').forEach(opt => {
    const input = opt.querySelector('input[name="boothRadio"]');
    opt.classList.toggle('selected', !!input && input.value === boothId);
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

  // 持ち込み物品欄（ブースごとの設定で表示を切り替える）
  const equipSection = document.getElementById('equipmentSection');
  if (equipSection) {
    const ask = selectedBooth?.askEquipment ??
                (CONFIG.features?.bodyEquipment && String(boothId).includes('ボディ'));
    equipSection.classList.toggle('hidden', !ask);
  }

  updateOptionsUI();
  updateSessionWarning();
  updateWaitlistNotice();
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
  // 作り直すときは、前に作ったものを消してから
  document.querySelectorAll('[data-block^="q:"]').forEach(el => el.remove());

  // いったん「出展内容」の最後に置き、applyFormOrder() で並び順どおりの場所へ動かす
  const home = document.querySelector('[data-section="exhibit"] .section-body');
  if (!home) return;

  (CONFIG.customQuestions || []).forEach((q, i) => {
    const wrapper = document.createElement('div');
    wrapper.dataset.block = `q:${q.id}`;
    const group = isChoiceGroup(q);   // 選択肢をならべる質問（1つ選ぶ・いくつでも選ぶ）

    // 質問文（管理画面で入れた文字をそのまま出す）
    const label = document.createElement(group ? 'div' : 'label');
    label.className = 'input-label';
    label.id = `cq${i}_label`;
    if (!group) label.htmlFor = q.id;
    label.textContent = q.label;
    if (q.required) {
      const mark = document.createElement('span');
      mark.className = 'required';
      mark.textContent = '*';
      label.appendChild(mark);
    }
    wrapper.appendChild(label);

    // 説明（質問文のすぐ下に小さく出す。改行もそのまま）
    const description = String(q.description || '').trim();
    let desc = null;
    if (description) {
      desc = document.createElement('p');
      desc.className = 'question-desc';
      desc.id = `cq${i}_desc`;
      desc.textContent = description;
      wrapper.appendChild(desc);
    }

    const input = group ? createChoiceGroup(q) : createAnswerInput(q);
    input.id = q.id;
    if (group) input.setAttribute('aria-labelledby', label.id);
    if (desc)  input.setAttribute('aria-describedby', desc.id);
    wrapper.appendChild(input);

    // 文字数カウンター（文章で答える質問だけ）
    if (isTextAnswer(q) && q.showCounter && q.maxLength) {
      const counter = document.createElement('div');
      counter.className = 'char-counter';
      const count = document.createElement('span');
      count.textContent = '0';
      counter.append(count, `/${q.maxLength}`);
      wrapper.appendChild(counter);

      input.addEventListener('input', () => {
        const len = input.value.length;
        count.textContent = len;
        counter.classList.toggle('over', len > q.maxLength);
      });
    }

    home.appendChild(wrapper);
  });
}

/*
 * 自由な質問の答え方（config.json の customQuestions[].type）
 *   textarea … 長い文章　　text … 短い文章　　number … 数字
 *   radio    … 選択肢から1つ選ぶ　　checkbox … 選択肢からいくつでも選ぶ
 *   select   … 選択肢から1つ選ぶ（プルダウン）
 * 選択肢は customQuestions[].options に入っています。
 */

/** 選択肢をボタンのようにならべる質問か */
function isChoiceGroup(q) {
  return q.type === 'radio' || q.type === 'checkbox';
}

/** 選択肢から選ぶ質問か（プルダウンも含む） */
function isChoiceQuestion(q) {
  return isChoiceGroup(q) || q.type === 'select';
}

/** 文章で答える質問か（文字数を数える） */
function isTextAnswer(q) {
  return !isChoiceQuestion(q) && q.type !== 'number';
}

/** 文章・数字・プルダウンの入力欄をつくる */
function createAnswerInput(q) {
  let input;
  if (q.type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 4;
  } else if (q.type === 'select') {
    input = document.createElement('select');
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

  input.name = q.id;
  input.className = 'input-field';
  if (q.placeholder && q.type !== 'select') input.placeholder = q.placeholder;
  if (q.maxLength && isTextAnswer(q))       input.maxLength   = q.maxLength;
  if (q.required)                           input.required    = true;
  return input;
}

/** 選択肢を1行ずつならべる（1つ選ぶ＝ラジオボタン、いくつでも選ぶ＝チェックボックス） */
function createChoiceGroup(q) {
  const box = document.createElement('div');
  box.className = 'q-choices';
  box.setAttribute('role', q.type === 'radio' ? 'radiogroup' : 'group');

  (q.options || []).forEach(opt => {
    const row = document.createElement('label');
    row.className = 'q-choice';
    const input = document.createElement('input');
    input.type = q.type;
    input.name = q.id;
    input.value = opt;
    const text = document.createElement('span');
    text.textContent = opt;
    row.append(input, text);
    box.appendChild(row);
  });
  return box;
}

/** 質問のかたまり（質問のIDには記号も入りうるので、セレクタを使わずに探す） */
function questionBlock(q) {
  return [...document.querySelectorAll('[data-block]')].find(el => el.dataset.block === `q:${q.id}`) || null;
}

/** 自由な質問の答え（いくつでも選べる質問は「、」でつなぐ） */
function getCustomAnswer(q) {
  if (isChoiceGroup(q)) {
    const block = questionBlock(q);
    if (!block) return '';
    return [...block.querySelectorAll('input:checked')].map(el => el.value).join('、');
  }
  return document.getElementById(q.id)?.value ?? '';
}

/** 自由な質問に答えを入れる（前回の内容を呼び出すとき） */
function setCustomAnswer(q, value) {
  if (!value) return;
  if (isChoiceGroup(q)) {
    const picked = q.type === 'checkbox' ? String(value).split('、') : [String(value)];
    questionBlock(q)?.querySelectorAll('input').forEach(el => { el.checked = picked.includes(el.value); });
    return;
  }
  const el = document.getElementById(q.id);
  if (el) el.value = value;
}

// ========================================
// 質問の並び順
// ========================================

/**
 * 並び順の初期値（config.json に formOrder が無いときの並び）です。
 * index.html に書いてある順番と同じで、管理画面（admin/config-editor.html）の
 * DEFAULT_FORM_ORDER とも同じにしておきます。
 *   'section:〇〇' … 見出し（index.html の data-section）
 *   'questions'    … 自由な質問（customQuestions）を設定の順に置く場所
 *   それ以外       … 質問のかたまり（index.html の data-block）
 * 自由な質問は formOrder の中では 'q:質問のID' と書きます。
 */
const DEFAULT_FORM_ORDER = [
  'section:basic', 'name', 'furigana', 'phone', 'address', 'email',
  'section:exhibit', 'exhibitorName', 'category', 'booth', 'questions', 'photo', 'photoPermission',
  'section:sns', 'sns',
  'section:options', 'options',
  'section:party', 'party',
  'section:stampRally', 'stampRally',
  'section:member', 'member',
  'section:other', 'terms', 'notes'
];

/**
 * 保存された並び順（formOrder）を、いまある質問に合わせて整えます。
 * 知らない名前や消した質問は外し、並びに無いもの（あとから足した質問など）は、
 * 初期の並びで直前にあるものの後ろに入れます。formOrder が無ければ初期の並びになります。
 */
function resolveFormOrder(saved, questionIds) {
  const defaults = DEFAULT_FORM_ORDER.flatMap(k =>
    k === 'questions' ? questionIds.map(id => `q:${id}`) : [k]);
  const known = new Set(defaults);

  const order = [];
  (Array.isArray(saved) ? saved : []).forEach(k => {
    if (known.has(k) && !order.includes(k)) order.push(k);
  });

  defaults.forEach((k, i) => {
    if (order.includes(k)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const p = order.indexOf(defaults[j]);
      if (p >= 0) { at = p + 1; break; }
    }
    order.splice(at, 0, k);
  });
  return order;
}

/** 見出しと質問のかたまりを、設定された並び順に置き直す */
function applyFormOrder() {
  const form = document.getElementById('applicationForm');
  if (!form) return;

  // 質問のIDには記号も入りうるので、セレクタではなく名前の対応表で探す
  const sections = new Map();
  form.querySelectorAll('[data-section]').forEach(el => sections.set(el.dataset.section, el));
  const blocks = new Map();
  form.querySelectorAll('[data-block]').forEach(el => blocks.set(el.dataset.block, el));

  const order = resolveFormOrder(CONFIG.formOrder, (CONFIG.customQuestions || []).map(q => q.id));
  let body = null;
  order.forEach(key => {
    if (key.startsWith('section:')) {
      const section = sections.get(key.slice('section:'.length));
      if (!section) return;
      form.appendChild(section);
      body = section.querySelector('.section-body');
      return;
    }
    const block = blocks.get(key);
    if (!block) return;
    // 見出しより前に置かれた質問は、見出しの無い枠に入れる
    if (!body) body = createUntitledSection(form);
    body.appendChild(block);
  });
}

function createUntitledSection(form) {
  const section = document.createElement('section');
  section.className = 'form-section';
  const body = document.createElement('div');
  body.className = 'section-body';
  section.appendChild(body);
  form.appendChild(section);
  return body;
}

/**
 * 表示する質問が1つも無い見出しは隠し、見えている見出しに 1, 2, 3… と番号を振ります。
 * （電話番号・SNSなどを出さない設定にしたときや、並べ替えで中身が空になったとき）
 */
function refreshSections() {
  let no = 0;
  document.querySelectorAll('#applicationForm > .form-section').forEach(section => {
    const body  = section.querySelector('.section-body');
    const shown = !!body && [...body.children].some(el =>
      !el.classList.contains('hidden') && el.style.display !== 'none');
    section.classList.toggle('hidden', !shown);

    const title = section.querySelector('.section-title');
    if (!shown || !title || !section.dataset.title) return;
    no++;
    title.textContent = `${section.dataset.icon} ${no}. ${section.dataset.title}`;
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

  addBtn?.addEventListener('click', () => addSnsLinkInput());
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
  renumberSnsRows();
  const addBtn = document.getElementById('addSnsBtn');
  if (addBtn) addBtn.style.display = 'block';
}

// 行の削除・追加後に data-index を振り直す
// （バッジと入力欄の対応、および送信時の収集順を保つため）
function renumberSnsRows() {
  const container = document.getElementById('snsLinksContainer');
  if (!container) return;
  const rows = container.querySelectorAll('.sns-link-row');
  rows.forEach((row, i) => {
    row.querySelector('.sns-badge')?.setAttribute('data-index', i);
    const input = row.querySelector('.sns-input');
    if (input) {
      input.dataset.index = i;
      input.name = `snsLink${i + 1}`;
    }
  });
  snsLinkCount = rows.length;
}

function addSnsLinkInput(url = '') {
  const container = document.getElementById('snsLinksContainer');
  const addBtn    = document.getElementById('addSnsBtn');
  if (!container || snsLinkCount >= 6) return;

  const index = snsLinkCount;
  snsLinkCount++;

  const row = document.createElement('div');
  row.className = 'sns-link-row';
  row.innerHTML = `
    <span class="sns-badge" data-index="${index}">未入力</span>
    <input type="url" name="snsLink${index + 1}" class="input-field sns-input" style="flex:1"
      data-index="${index}" placeholder="https://...">
    <button type="button" style="color:#ef4444;padding:0 0.5rem;border:none;background:none;cursor:pointer;font-size:1.2rem" onclick="removeSnsRow(this)">✕</button>`;
  container.appendChild(row);

  const inp = row.querySelector('.sns-input');
  if (url) inp.value = url;
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
    const answer = getCustomAnswer(q);
    // 枠の色を変えるのは入力欄だけ（選択肢をならべた質問は枠が無い）
    const input = isChoiceGroup(q) ? null : document.getElementById(q.id);
    if (!answer.trim()) {
      errors.push(isChoiceQuestion(q) ? `${q.label}を選択してください` : `${q.label}を入力してください`);
      if (input) input.classList.add('border-red-500');
    } else {
      if (input) input.classList.remove('border-red-500');
      if (isTextAnswer(q) && q.maxLength && answer.length > q.maxLength) {
        errors.push(`${q.label}は${q.maxLength}文字以内で入力してください`);
      }
    }
  });

  // 写真（「前回の写真を使う」「あとから公式LINEで送る」を選んだ場合は不要）
  if (sf.showPhotoUpload !== false) {
    const photoInput  = form.querySelector('[name="profileImage"]');
    const usePrevious = form.querySelector('[name="usePreviousPhoto"]')?.checked;
    const sendLater   = form.querySelector('[name="photoLater"]')?.checked;
    if (!usePrevious && !sendLater) {
      if (!photoInput?.files?.length) {
        errors.push('プロフィール写真をアップロードしてください（うまく送れない場合は「写真をあとから公式LINEで送る」にチェックしてください）');
      } else if (!preparedPhoto) {
        // 縮小がまだ終わっていない、または読み込めなかった
        errors.push('写真の準備が終わっていません。少し待ってからもう一度お試しください');
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
      customAnswers[q.id] = getCustomAnswer(q);
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
    // 変換に失敗しても申込自体は完了させ、あとから公式LINEで送っていただく
    const photoInput  = form.querySelector('[name="profileImage"]');
    const sendLater   = form.querySelector('[name="photoLater"]')?.checked;
    const usePrevious = form.querySelector('[name="usePreviousPhoto"]')?.checked;
    let photoAttached = false;

    if (!sendLater && photoInput?.files?.length) {
      try {
        // 選択時に縮小済みならそれを使う。何らかの理由で未準備ならここで変換する
        const b64 = preparedPhoto || await convertFileToBase64(photoInput.files[0]);
        formData.set('profileImageBase64',   b64.base64);
        formData.set('profileImageMimeType', b64.mimeType);
        formData.set('profileImageName',     b64.name);
        photoAttached = true;
      } catch (e) {
        console.error('画像処理に失敗したため、写真なしで送信します:', e);
        formData.delete('profileImageBase64');
        formData.delete('profileImageMimeType');
        formData.delete('profileImageName');
      }
    }

    // 前回の写真を使う場合は、そのURLが送られるので写真ありとして扱う
    if (usePrevious && form.querySelector('[name="profileImageUrl"]')?.value) {
      photoAttached = true;
    }

    // 写真が付いていないことをバックエンドにも伝える
    formData.set('photoPending', photoAttached ? '0' : '1');

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

    if (!response.ok) {
      console.error('Submit failed:', response.status, await response.text().catch(() => ''));
      throw new Error('サーバーとの通信に失敗しました。(状態コード: ' + response.status + ')');
    }

    const result = await response.json().catch(() => { throw new Error('サーバーからの応答が不正です。'); });

    if (result.success) {
      // バックエンド側で写真を保存できなかった場合も未受領として扱う
      showCompleteModal(!photoAttached || result.photoPending === true, {
        waitlisted: result.waitlisted === true,
        expected:   !!selectedBooth && canApplyAsWaitlist(selectedBooth),
        boothName:  selectedBooth?.name || ''
      });
    } else {
      throw new Error(result.error || '送信に失敗しました。再度お試しください。');
    }

  } catch (err) {
    console.error('Submit error:', err);
    alert(`送信エラー:\n\n${err.message}\n\n解決しない場合は、主催者へお問合せください。`);
    // 満枠になって断られた場合に備えて、空き状況を取り直す
    loadBoothAvailability();
  } finally {
    document.getElementById('loadingOverlay')?.classList.remove('visible');
    document.getElementById('submitBtn').disabled = false;
  }
}

// 申込完了モーダルを表示する
// photoPending が true のときだけ、写真を公式LINEへ送っていただく案内を出す
// waitlist.waitlisted が true のときは、キャンセル待ちで受け付けたことを伝える
function showCompleteModal(photoPending, waitlist) {
  const modal  = document.getElementById('completeModal');
  const notice = document.getElementById('photoPendingNotice');

  const waitBox = document.getElementById('waitlistResult');
  if (waitBox) {
    const waiting = !!waitlist?.waitlisted;
    waitBox.classList.toggle('hidden', !waiting);
    if (waiting) {
      const booth = waitlist.boothName ? `「${waitlist.boothName}」` : 'お選びのブース';
      // 申込の途中で満枠になった場合は、その旨を先に伝える
      const lead = waitlist.expected
        ? `${booth}は満枠のため、`
        : `お申込みの直前に${booth}が満枠になったため、`;
      const text   = document.getElementById('waitlistResultText');
      const strong = document.createElement('strong');
      strong.textContent = 'キャンセル待ち';
      text.replaceChildren(
        lead, strong, 'として受け付けました。', document.createElement('br'),
        '空きが出た場合に、事務局から順番にご連絡します。ご連絡があるまで、出展料のお振込みはお待ちください。'
      );
      const title = document.getElementById('completeTitle');
      if (title) title.textContent = 'キャンセル待ちで受け付けました';
      const icon = document.getElementById('completeIcon');
      if (icon) icon.textContent = '⏳';
    }
  }

  if (notice) {
    notice.classList.toggle('hidden', !photoPending);

    if (photoPending) {
      // 公式LINEのURLが設定されていればボタンを出す。無ければ文章だけで案内する
      const lineUrl = CONFIG?.lineOfficialUrl || '';
      const shop    = document.querySelector('[name="exhibitorName"]')?.value || '';

      const link = document.getElementById('photoLineLink');
      if (link) {
        link.href = lineUrl || '#';
        link.classList.toggle('hidden', !lineUrl);
      }

      const guideEl = document.getElementById('photoLineGuide');
      if (guideEl) {
        guideEl.textContent = shop
          ? `送るもの: 出展名「${shop}」とプロフィール写真`
          : '送るもの: 出展名とプロフィール写真';
      }
    }
  }

  modal?.classList.remove('hidden');
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
/**
 * 写真を選んだ時点で縮小・圧縮まで済ませます。
 *
 * 以前はファイルサイズが8MBを超えると、縮小する前に拒否していました。
 * 最近のスマホの写真は8MBを超えることが珍しくないため、
 * まず縮小してみて、結果が送れる大きさなら受け付けます。
 */
function initFileSizeCheck() {
  const photoInput = document.getElementById('profileImage');
  if (!photoInput) return;

  photoInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    preparedPhoto = null;

    if (!file) { setPhotoStatus(''); return; }

    setPhotoStatus('画像を準備しています...', 'wait');

    try {
      preparedPhoto = await convertFileToBase64(file);

      const kb = Math.round(preparedPhoto.base64.length * 0.75 / 1024);
      const before = file.size / 1024 / 1024;
      setPhotoStatus(
        before >= 1
          ? `準備できました（${before.toFixed(1)}MB → 約${kb}KB に縮小）`
          : `準備できました（約${kb}KB）`,
        'ok'
      );
      showPhotoPreview(preparedPhoto);

    } catch (err) {
      console.error('画像の準備に失敗:', err);
      preparedPhoto = null;
      showPhotoPreview(null);
      setPhotoStatus('この画像は読み込めませんでした。別の画像を選ぶか、あとから公式LINEでお送りください。', 'ng');

      // 逃げ道を自動で選択しておく（申込を進められるように）
      const later = document.getElementById('photoLater');
      if (later && !later.checked) {
        later.checked = true;
        togglePhotoUpload();
      }
    }
  });
}

// 写真欄の状態表示
function setPhotoStatus(message, kind) {
  const el = document.getElementById('photoStatus');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
  const colors = { wait: '#6b7280', ok: '#16a34a', ng: '#dc2626' };
  el.style.color = colors[kind] || '#6b7280';
}

// 縮小後の画像をその場で見せる
function showPhotoPreview(prepared) {
  const box = document.getElementById('photoPreviewBox');
  const img = document.getElementById('photoPreviewImg');
  if (!box || !img) return;

  if (!prepared) { box.classList.add('hidden'); img.removeAttribute('src'); return; }
  img.src = `data:${prepared.mimeType};base64,${prepared.base64}`;
  box.classList.remove('hidden');
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

    const info = document.createElement('div');
    const title = document.createElement('p');
    title.style.fontWeight = '700';
    title.textContent = data.eventName || data.edition || '過去のイベント';
    const when = document.createElement('p');
    when.style.cssText = 'font-size:0.8rem;color:#6b7280';
    when.textContent = data.submittedAt || '';
    const who = document.createElement('p');
    who.style.cssText = 'font-size:0.85rem;color:#374151';
    who.textContent = `出展名: ${data.exhibitorName || ''}`;
    info.append(title, when, who);

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.style.cssText = 'background:var(--color-primary);color:#fff;padding:0.4rem 1rem;border:none;border-radius:0.5rem;font-weight:700;cursor:pointer;font-size:0.85rem';
    pick.textContent = '選択';

    item.append(info, pick);
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
  setVal('[name="equipment"]',     data.equipment);

  // カスタム質問（出展メニュー名・自己紹介など）を label で対応付けて復元
  const answerByLabel = {
    '出展メニュー名': data.menu,
    '自己紹介':       data.intro
  };
  (CONFIG?.customQuestions || []).forEach(q => setCustomAnswer(q, answerByLabel[q.label]));

  // 写真掲載可否
  if (data.photoPermission) {
    document.querySelectorAll('input[name="photoPermission"]').forEach(radio => {
      if (radio.value === data.photoPermission) radio.checked = true;
    });
  }

  // カテゴリ復元
  if (data.category) {
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
  const snsList = parseSnsLinks(data.snsLinks || data.sns);
  snsList.forEach(url => addSnsLinkInput(url));
  if (!snsList.length) addSnsLinkInput();

  document.querySelectorAll('textarea, input[type="text"]').forEach(el =>
    el.dispatchEvent(new Event('input')));
}

/**
 * 保存形式が複数あるSNS欄からURLの配列を取り出します。
 *  - スプレッドシートの文字列 "Instagram: https://... \n HP: https://..."
 *  - JSON配列 [{type, url}, ...]
 *  - 旧形式のオブジェクト {hp, insta, blog, fb, line, other}
 */
function parseSnsLinks(snsData) {
  if (!snsData) return [];

  if (typeof snsData === 'string') {
    const text = snsData.trim();
    if (!text || text === 'なし') return [];
    if (text.startsWith('[')) {
      try {
        const arr = JSON.parse(text);
        if (Array.isArray(arr)) return arr.map(l => l?.url).filter(Boolean);
      } catch { /* 文字列として処理を続ける */ }
    }
    // 「種別: URL」形式、または URL のみの行から URL を抽出
    return text.split(/\r?\n/)
      .map(line => (line.match(/https?:\/\/\S+/) || [])[0])
      .filter(Boolean);
  }

  if (Array.isArray(snsData)) {
    return snsData.map(l => (typeof l === 'string' ? l : l?.url)).filter(Boolean);
  }

  return ['hp', 'insta', 'blog', 'fb', 'line', 'other']
    .map(k => snsData[k])
    .filter(Boolean);
}

function togglePhotoUpload() {
  const usePrevious = document.getElementById('usePreviousPhoto');
  const sendLater   = document.getElementById('photoLater');
  const fileInput   = document.getElementById('profileImage');
  const preview     = document.getElementById('previousPhotoPreview');
  const reqTag      = document.getElementById('photoRequiredTag');
  if (!fileInput) return;

  const skipUpload = !!usePrevious?.checked || !!sendLater?.checked;

  fileInput.disabled = skipUpload;
  fileInput.required = !skipUpload;
  if (skipUpload) {
    fileInput.value = '';
    preparedPhoto = null;
    showPhotoPreview(null);
  }
  if (reqTag) reqTag.style.display = skipUpload ? 'none' : 'inline';

  preview?.classList.toggle('hidden', !usePrevious?.checked);
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
          // 送信先の GAS(Google)は大きすぎる POST を 403 で弾くため、
          // 送信データが確実に上限を下回るよう、目標サイズに収まるまで段階的に再圧縮する。
          // 実績: base64 約1.3MB は成功、約1.9MB は 403。余裕を見て目標は約1MB。
          const TARGET_BASE64_LEN = 1_000_000; // base64 文字数 ≒ 送信バイト数
          const MAX_DIMS    = [1200, 1000, 800, 640];
          const MIN_QUALITY = 0.5;

          const encodeAt = (maxDim, quality) => {
            const canvas = document.createElement('canvas');
            const ctx    = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas初期化失敗');
            let { width, height } = img;
            if (width > height) { if (width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; } }
            else                { if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; } }
            canvas.width = width; canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            return dataUrl.split(',')[1] || '';
          };

          // 寸法を段階的に下げつつ、各寸法で品質を 0.8→0.5 まで下げて目標以下を探す
          let base64 = '';
          outer:
          for (const maxDim of MAX_DIMS) {
            for (let q = 0.8; q >= MIN_QUALITY - 1e-9; q -= 0.1) {
              base64 = encodeAt(maxDim, Math.round(q * 10) / 10);
              if (base64 && base64.length <= TARGET_BASE64_LEN) break outer;
            }
          }

          if (!base64) { reject(new Error('画像変換結果が空')); return; }
          // 目標まで下げ切れなくても最小設定の結果を送る（従来の固定圧縮より必ず小さい）
          resolve({ base64, mimeType: 'image/jpeg', name: file.name.replace(/\.[^/.]+$/, '') + '.jpg' });
        } catch (e) { reject(new Error('画像圧縮処理に失敗: ' + e.message)); }
      };
      img.onerror = () => reject(new Error('画像読み込み失敗'));
    };
    reader.onerror = () => reject(new Error('ファイル読み取り失敗'));
  });
}
