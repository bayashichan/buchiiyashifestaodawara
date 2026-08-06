/**
 * オプション（追加料金項目）レンダラ
 *
 * config.pricing.options[] から UI を生成します。オプションは任意個数・任意IDで、
 * ブースの種類ごとに使える／使えないが変わります。
 *
 * 設計上の要点:
 *   可否と上限の判定は computeQuote（config-schema.js）が持つ唯一の実装に任せ、
 *   このファイルは「その結果を UI に書き戻す」だけにしています。
 *   表示・請求・GAS 側の再計算で判定がずれないようにするためです。
 */

var OptionFields = (function () {

  var config = null;
  var container = null;
  var changeHandler = null;
  /** optionId -> 現在のUI値 */
  var values = {};
  var isMember = false;

  // ========================================
  // 生成
  // ========================================

  function render(cfg, host, onChange) {
    config = cfg;
    container = host;
    changeHandler = onChange || function () {};
    values = {};

    host.innerHTML = '';

    var options = (cfg.pricing && cfg.pricing.options) || [];
    options.forEach(function (opt) {
      if (opt.enabled === false) return;
      values[opt.id] = emptyValue(opt);
      host.appendChild(buildOption(opt));
    });

    var md = (cfg.pricing && cfg.pricing.memberDiscount) || {};
    if (md.enabled && md.amount > 0) {
      host.appendChild(buildMemberDiscount(md));
    }

    var empty = document.createElement('p');
    empty.className = 'field-hint';
    empty.id = 'noOptionsMessage';
    empty.textContent = '※ ブースを選択すると、選べるオプションが表示されます';
    host.appendChild(empty);

    // 通知（自動解除・切り下げの説明）の置き場所
    var notices = document.createElement('div');
    notices.id = 'optionNotices';
    notices.className = 'option-notices';
    host.appendChild(notices);
  }

  function buildOption(opt) {
    var box = document.createElement('div');
    box.className = 'option-group hidden';
    box.id = 'opt_' + opt.id;
    box.setAttribute('data-option-id', opt.id);

    var label = document.createElement('label');
    label.className = 'input-label';
    label.textContent = opt.label + priceSuffix(opt);
    box.appendChild(label);

    if (opt.description) {
      var desc = document.createElement('p');
      desc.className = 'field-description';
      desc.textContent = opt.description;
      box.appendChild(desc);
    }

    if (opt.inputType === 'toggle')        box.appendChild(buildToggle(opt));
    else if (opt.inputType === 'quantity') box.appendChild(buildQuantity(opt));
    else if (opt.inputType === 'select')   box.appendChild(buildSelect(opt));

    return box;
  }

  function priceSuffix(opt) {
    if (opt.inputType === 'select') return '';
    if (!isFinite(opt.price) || opt.price === 0) return '';
    var per = opt.inputType === 'quantity' && opt.unit ? '/' + opt.unit : '';
    return '（' + formatYen(opt.price) + per + '）';
  }

  /** はい／いいえのラジオ */
  function buildToggle(opt) {
    var group = document.createElement('div');
    group.className = 'choice-group';

    [['1', 'はい'], ['0', 'いいえ']].forEach(function (pair, idx) {
      var label = document.createElement('label');
      label.className = 'checkbox-label';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'opt_' + opt.id;
      input.value = pair[0];
      if (idx === 1) input.checked = true;
      input.addEventListener('change', function () {
        values[opt.id] = pair[0] === '1';
        changeHandler();
      });
      var span = document.createElement('span');
      span.textContent = pair[1];
      label.appendChild(input);
      label.appendChild(span);
      group.appendChild(label);
    });
    return group;
  }

  /** 出席/欠席 → 人数の ± ボタン */
  function buildQuantity(opt) {
    var box = document.createElement('div');

    var group = document.createElement('div');
    group.className = 'choice-group';
    var counter = document.createElement('div');
    counter.className = 'quantity-input hidden';
    counter.id = 'qty_' + opt.id;

    [['1', opt.yesLabel || 'はい'], ['0', opt.noLabel || 'いいえ']].forEach(function (pair, idx) {
      var label = document.createElement('label');
      label.className = 'checkbox-label';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'opt_' + opt.id;
      input.value = pair[0];
      if (idx === 1) input.checked = true;
      input.addEventListener('change', function () {
        var on = pair[0] === '1';
        counter.classList.toggle('hidden', !on);
        values[opt.id] = on ? 1 : 0;
        renderQtyValue(opt);
        changeHandler();
      });
      var span = document.createElement('span');
      span.textContent = pair[1];
      label.appendChild(input);
      label.appendChild(span);
      group.appendChild(label);
    });
    box.appendChild(group);

    var minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'quantity-btn';
    minus.textContent = '−';
    minus.addEventListener('click', function () { adjust(opt, -1); });

    var val = document.createElement('span');
    val.className = 'quantity-value';
    val.id = 'qtyVal_' + opt.id;
    val.textContent = '1';

    var plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'quantity-btn';
    plus.textContent = '＋';
    plus.addEventListener('click', function () { adjust(opt, 1); });

    var maxHint = document.createElement('span');
    maxHint.className = 'quantity-max';
    maxHint.id = 'qtyMax_' + opt.id;

    counter.appendChild(minus);
    counter.appendChild(val);
    counter.appendChild(plus);
    counter.appendChild(maxHint);
    box.appendChild(counter);

    return box;
  }

  function adjust(opt, delta) {
    var gate = currentGate(opt);
    var current = toInt(values[opt.id], 0);
    var next = Math.max(1, Math.min(gate.max, current + delta));
    values[opt.id] = next;
    renderQtyValue(opt);
    changeHandler();
  }

  function renderQtyValue(opt) {
    var el = document.getElementById('qtyVal_' + opt.id);
    if (el) el.textContent = Math.max(1, toInt(values[opt.id], 1));
  }

  function buildSelect(opt) {
    var sel = document.createElement('select');
    sel.className = 'input-field';
    sel.id = 'optSel_' + opt.id;

    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '選択してください';
    sel.appendChild(blank);

    (opt.choices || []).forEach(function (c) {
      var o = document.createElement('option');
      o.value = (c.value != null) ? c.value : c.label;
      o.textContent = c.price
        ? c.label + '（' + formatYen(c.price) + '）'
        : c.label;
      sel.appendChild(o);
    });

    sel.addEventListener('change', function () {
      values[opt.id] = sel.value;
      changeHandler();
    });
    return sel;
  }

  function buildMemberDiscount(md) {
    var box = document.createElement('div');
    box.className = 'option-group';
    box.id = 'opt_memberDiscount';

    var label = document.createElement('label');
    label.className = 'input-label';
    label.textContent = (md.label || '会員割引') + '（-' + formatYen(md.amount) + '）';
    box.appendChild(label);

    var group = document.createElement('div');
    group.className = 'choice-group';
    [['1', 'はい'], ['0', 'いいえ']].forEach(function (pair, idx) {
      var l = document.createElement('label');
      l.className = 'checkbox-label';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'isMember';
      input.value = pair[0];
      if (idx === 1) input.checked = true;
      input.addEventListener('change', function () {
        isMember = pair[0] === '1';
        changeHandler();
      });
      var span = document.createElement('span');
      span.textContent = pair[1];
      l.appendChild(input);
      l.appendChild(span);
      group.appendChild(l);
    });
    box.appendChild(group);
    return box;
  }

  // ========================================
  // ブース変更に伴う表示切替
  // ========================================

  var currentBoothId = null;

  function currentBooth() {
    var booths = (config && config.booths) || [];
    for (var i = 0; i < booths.length; i++) {
      if (booths[i].id === currentBoothId) return booths[i];
    }
    return null;
  }

  function currentGate(opt) {
    return resolveOptionForBooth(opt, currentBooth());
  }

  /**
   * 選択中のブースを設定し、各オプションの表示可否と上限表示を更新する。
   * 値の補正そのものは computeQuote に任せ、ここでは見た目だけを合わせる。
   */
  function setBooth(boothId) {
    currentBoothId = boothId || null;
    var booth = currentBooth();
    var options = (config.pricing && config.pricing.options) || [];
    var anyVisible = false;

    options.forEach(function (opt) {
      if (opt.enabled === false) return;
      var box = document.getElementById('opt_' + opt.id);
      if (!box) return;

      var gate = resolveOptionForBooth(opt, booth);
      // 使えないオプションはグレーアウトではなく非表示にする（迷いを減らすため）
      box.classList.toggle('hidden', !gate.available);
      if (gate.available) anyVisible = true;

      var maxHint = document.getElementById('qtyMax_' + opt.id);
      if (maxHint && opt.inputType === 'quantity') {
        maxHint.textContent = gate.max < 99 ? '最大 ' + gate.max + (opt.unit || '') : '';
      }
    });

    var empty = document.getElementById('noOptionsMessage');
    if (empty) {
      empty.classList.toggle('hidden', anyVisible);
      empty.textContent = booth
        ? '※ このブースで追加できるオプションはありません'
        : '※ ブースを選択すると、選べるオプションが表示されます';
    }
  }

  /**
   * computeQuote が補正した値を UI に書き戻す。
   * 「選んだはずのものが消えている」状態を作らないため、必ず notices の表示と対にする。
   */
  function applyResolved(resolved) {
    var options = (config.pricing && config.pricing.options) || [];

    options.forEach(function (opt) {
      if (opt.enabled === false) return;
      if (!(opt.id in resolved)) return;
      var next = resolved[opt.id];
      if (sameValue(values[opt.id], next)) return;

      values[opt.id] = next;

      if (opt.inputType === 'toggle') {
        var want = next === true ? '1' : '0';
        var radio = document.querySelector('[name="opt_' + opt.id + '"][value="' + want + '"]');
        if (radio) radio.checked = true;

      } else if (opt.inputType === 'quantity') {
        var qty = toInt(next, 0);
        var yes = document.querySelector('[name="opt_' + opt.id + '"][value="' + (qty > 0 ? '1' : '0') + '"]');
        if (yes) yes.checked = true;
        var counter = document.getElementById('qty_' + opt.id);
        if (counter) counter.classList.toggle('hidden', qty <= 0);
        var valEl = document.getElementById('qtyVal_' + opt.id);
        if (valEl) valEl.textContent = Math.max(1, qty);

      } else if (opt.inputType === 'select') {
        var sel = document.getElementById('optSel_' + opt.id);
        if (sel) sel.value = next || '';
      }
    });
  }

  function sameValue(a, b) {
    if (typeof a === 'number' || typeof b === 'number') return toInt(a, 0) === toInt(b, 0);
    return String(a) === String(b);
  }

  /**
   * 自動解除・切り下げの理由を画面に出す。
   * 金額が理由もわからず変わるのを避けるための、この機能の要。
   */
  function showNotices(notices) {
    var host = document.getElementById('optionNotices');
    if (!host) return;
    host.innerHTML = '';
    if (!notices || !notices.length) return;

    notices.forEach(function (n) {
      var p = document.createElement('p');
      p.className = 'option-notice';
      p.textContent = '⚠️ ' + n.message;
      host.appendChild(p);
    });

    // 見落とされないよう、通知が出たら一度だけそこへ寄せる
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ========================================
  // 値
  // ========================================

  function getValues() {
    var out = {};
    Object.keys(values).forEach(function (k) { out[k] = values[k]; });
    return out;
  }

  function getIsMember() { return isMember; }

  /** 送信・保存用にラベル付きで返す */
  function getLabeledValues() {
    var out = {};
    var options = (config.pricing && config.pricing.options) || [];
    options.forEach(function (opt) {
      if (opt.enabled === false) return;
      out[opt.id] = { label: opt.label, value: values[opt.id], inputType: opt.inputType };
    });
    return out;
  }

  function getOptionDefs() {
    var options = (config.pricing && config.pricing.options) || [];
    return options
      .filter(function (o) { return o.enabled !== false; })
      .map(function (o) {
        return { id: o.id, label: o.label, inputType: o.inputType, unit: o.unit || '' };
      });
  }

  function emptyValue(opt) {
    if (opt.inputType === 'toggle') return false;
    if (opt.inputType === 'quantity') return 0;
    return '';
  }

  function toInt(v, fallback) {
    var n = parseInt(v, 10);
    return isNaN(n) ? (fallback || 0) : n;
  }

  return {
    render: render,
    setBooth: setBooth,
    applyResolved: applyResolved,
    showNotices: showNotices,
    getValues: getValues,
    getLabeledValues: getLabeledValues,
    getOptionDefs: getOptionDefs,
    getIsMember: getIsMember
  };
})();
