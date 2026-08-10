/**
 * 申込フォーム レンダラ
 *
 * config.fields[] から入力欄を動的に生成し、値の取得・復元・検証を担当します。
 * 入力欄のHTMLはこのファイルだけが持ちます（index.html は器のみ）。
 */

var FormFields = (function () {

  var SNS_PATTERNS = [
    { pattern: /instagram\.com|instagr\.am/i, name: 'Instagram',  color: '#E4405F' },
    { pattern: /youtube\.com|youtu\.be/i,     name: 'YouTube',    color: '#FF0000' },
    { pattern: /tiktok\.com/i,                name: 'TikTok',     color: '#000000' },
    { pattern: /ameblo\.jp|ameba\.jp/i,       name: 'Ameblo',     color: '#1F8742' },
    { pattern: /line\.me|lin\.ee/i,           name: '公式LINE',   color: '#00B900' },
    { pattern: /twitter\.com|x\.com/i,        name: 'X(Twitter)', color: '#1DA1F2' },
    { pattern: /facebook\.com|fb\.com/i,      name: 'Facebook',   color: '#1877F2' },
    { pattern: /lit\.link/i,                  name: 'lit.link',   color: '#28A0FF' },
    { pattern: /linktr\.ee/i,                 name: 'Linktree',   color: '#43E55E' }
  ];

  var config = null;
  var fieldsById = {};
  /** 画像フィールドの状態: fieldId -> { file, error, previousUrl, usePrevious } */
  var imageState = {};

  // ========================================
  // 生成
  // ========================================

  /**
   * @param {Object} cfg 正規化済み config
   * @param {Object} containers セクションid -> 差し込み先要素
   */
  function render(cfg, containers) {
    config = cfg;
    fieldsById = {};
    imageState = {};

    Object.keys(containers).forEach(function (sectionId) {
      var host = containers[sectionId];
      if (!host) return;
      host.innerHTML = '';

      var fields = fieldsInSection(cfg, sectionId);
      fields.forEach(function (field) {
        fieldsById[field.id] = field;
        host.appendChild(buildField(field));
      });

      // 項目が1つも無いセクションは見出しごと隠す
      var section = host.closest('.form-section');
      if (section && !section.hasAttribute('data-keep-empty')) {
        section.classList.toggle('hidden', fields.length === 0);
      }
    });

    bindConditionalVisibility();
  }

  function buildField(field) {
    var wrap = document.createElement('div');
    wrap.className = 'field-block';
    wrap.setAttribute('data-field-id', field.id);

    if (field.type === 'heading') {
      var h = document.createElement('p');
      h.className = 'field-heading';
      h.textContent = field.label || '';
      wrap.appendChild(h);
      if (field.description) wrap.appendChild(buildDescription(field));
      return wrap;
    }

    wrap.appendChild(buildLabel(field));
    if (field.description) wrap.appendChild(buildDescription(field));

    var control = buildControl(field);
    if (control) wrap.appendChild(control);

    if (field.showCounter && field.maxLength > 0) {
      wrap.appendChild(buildCounter(field));
    }

    var err = document.createElement('p');
    err.className = 'field-error hidden';
    err.id = 'err_' + field.id;
    wrap.appendChild(err);

    return wrap;
  }

  function buildLabel(field) {
    var label = document.createElement('label');
    label.className = 'input-label';
    label.setAttribute('for', inputId(field.id));
    label.textContent = field.label || '';
    if (field.required) {
      var req = document.createElement('span');
      req.className = 'required';
      req.textContent = '*';
      label.appendChild(req);
    }
    return label;
  }

  function buildDescription(field) {
    var p = document.createElement('p');
    p.className = 'field-description';
    p.textContent = field.description;
    return p;
  }

  function buildCounter(field) {
    var c = document.createElement('div');
    c.className = 'char-counter';
    c.id = 'counter_' + field.id;
    c.innerHTML = '<span id="count_' + field.id + '">0</span>/' + field.maxLength;
    return c;
  }

  function inputId(fieldId) { return 'f_' + fieldId; }

  // ========================================
  // 型ごとのコントロール生成
  // ========================================

  function buildControl(field) {
    switch (field.type) {
      case 'textarea':      return buildTextarea(field);
      case 'select':        return buildSelect(field);
      case 'radio':         return buildChoiceGroup(field, 'radio');
      case 'checkboxGroup': return buildChoiceGroup(field, 'checkbox');
      case 'checkbox':      return buildSingleCheckbox(field);
      case 'postal':        return buildPostal(field);
      case 'image':         return buildImage(field);
      case 'snsLinks':      return buildSnsLinks(field);
      case 'email':         return buildEmail(field);
      case 'category':      return buildCategoryPlaceholder(field);
      case 'booth':         return buildBoothPlaceholder(field);
      default:              return buildTextInput(field);
    }
  }

  /**
   * カテゴリ・ブースは選択肢を categories[] / booths[] 側で管理するため、
   * ここでは器と隠しフィールドだけ作り、中身は script.js が描画する。
   * こうすることで管理画面から他の項目と一緒に並び替えできる。
   */
  function buildCategoryPlaceholder(field) {
    var box = document.createElement('div');
    var buttons = document.createElement('div');
    buttons.id = 'categoryButtons';
    buttons.className = 'category-buttons';
    var hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = inputId(field.id);
    hidden.name = field.id;
    box.appendChild(buttons);
    box.appendChild(hidden);
    return box;
  }

  function buildBoothPlaceholder(field) {
    var box = document.createElement('div');
    var warning = document.createElement('div');
    warning.id = 'sessionWarning';
    warning.className = 'session-warning';
    var accordion = document.createElement('div');
    accordion.id = 'boothAccordion';
    accordion.className = 'booth-accordion';
    var hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = inputId(field.id);
    hidden.name = field.id;
    box.appendChild(warning);
    box.appendChild(accordion);
    box.appendChild(hidden);
    return box;
  }

  /** text / tel / url / date / number / address をまとめて扱う */
  function buildTextInput(field) {
    var input = document.createElement('input');
    input.type = htmlInputType(field.type);
    input.id = inputId(field.id);
    input.name = field.id;
    input.className = 'input-field';
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.maxLength > 0) input.maxLength = field.maxLength;

    if (field.type === 'number') {
      if (isNum(field.min)) input.min = field.min;
      if (isNum(field.max)) input.max = field.max;
    }
    if (field.type === 'tel') input.inputMode = 'tel';

    attachCounter(field, input);
    return input;
  }

  function htmlInputType(type) {
    if (type === 'tel') return 'tel';
    if (type === 'url') return 'url';
    if (type === 'date') return 'date';
    if (type === 'number') return 'number';
    return 'text';
  }

  function buildTextarea(field) {
    var ta = document.createElement('textarea');
    ta.id = inputId(field.id);
    ta.name = field.id;
    ta.className = 'input-field';
    ta.rows = field.rows || 4;
    if (field.placeholder) ta.placeholder = field.placeholder;
    if (field.maxLength > 0) ta.maxLength = field.maxLength;
    attachCounter(field, ta);
    return ta;
  }

  function attachCounter(field, el) {
    if (!field.showCounter || !(field.maxLength > 0)) return;
    el.addEventListener('input', function () {
      var counter = document.getElementById('counter_' + field.id);
      var count = document.getElementById('count_' + field.id);
      if (count) count.textContent = el.value.length;
      if (counter) counter.classList.toggle('over', el.value.length > field.maxLength);
    });
  }

  function buildSelect(field) {
    var sel = document.createElement('select');
    sel.id = inputId(field.id);
    sel.name = field.id;
    sel.className = 'input-field';

    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = field.placeholder || '選択してください';
    sel.appendChild(blank);

    normalizeChoices(field).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.value;
      o.textContent = c.label;
      sel.appendChild(o);
    });
    return sel;
  }

  /** radio / checkboxGroup の共通生成 */
  function buildChoiceGroup(field, inputType) {
    var group = document.createElement('div');
    group.className = 'choice-group';
    group.id = inputId(field.id);

    normalizeChoices(field).forEach(function (c, idx) {
      var label = document.createElement('label');
      label.className = 'checkbox-label';

      var input = document.createElement('input');
      input.type = inputType;
      input.name = inputType === 'radio' ? field.id : field.id + '[]';
      input.value = c.value;
      input.id = inputId(field.id) + '_' + idx;

      var span = document.createElement('span');
      span.textContent = c.label;

      label.appendChild(input);
      label.appendChild(span);
      group.appendChild(label);
    });
    return group;
  }

  function buildSingleCheckbox(field) {
    var label = document.createElement('label');
    label.className = 'checkbox-label';

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = inputId(field.id);
    input.name = field.id;
    input.value = '1';

    var span = document.createElement('span');
    span.textContent = field.checkboxText || field.placeholder || 'はい';

    label.appendChild(input);
    label.appendChild(span);
    return label;
  }

  function normalizeChoices(field) {
    return (field.choices || []).map(function (c) {
      if (typeof c === 'string') return { value: c, label: c };
      return { value: (c.value != null) ? c.value : c.label, label: c.label };
    });
  }

  /** 郵便番号：入力欄＋住所検索ボタン。linkTo で指定した項目へ結果を書き込む */
  function buildPostal(field) {
    var row = document.createElement('div');
    row.className = 'postal-row';

    var input = document.createElement('input');
    input.type = 'text';
    input.id = inputId(field.id);
    input.name = field.id;
    input.className = 'input-field';
    input.style.width = '9rem';
    input.inputMode = 'numeric';
    input.maxLength = 8;
    input.placeholder = field.placeholder || '1234567';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'address-search-btn';
    btn.textContent = '住所検索';
    btn.addEventListener('click', function () { lookupAddress(field, input, btn); });

    row.appendChild(input);
    row.appendChild(btn);
    return row;
  }

  /**
   * 郵便番号から住所を引く（zipcloud）。
   * 外部APIが落ちていても手入力で続行できるよう、失敗しても入力はブロックしない。
   */
  function lookupAddress(field, input, btn) {
    var code = String(input.value || '').replace(/[^0-9]/g, '');
    var errEl = document.getElementById('err_' + field.id);

    if (code.length !== 7) {
      showError(field.id, '郵便番号は7桁の数字で入力してください');
      return;
    }
    clearError(field.id);
    btn.disabled = true;
    btn.textContent = '検索中…';

    fetch('https://zipcloud.ibsnet.co.jp/api/search?zipcode=' + code)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.results || !data.results.length) {
          showError(field.id, '該当する住所が見つかりませんでした。手入力してください。');
          return;
        }
        var r = data.results[0];
        var addr = (r.address1 || '') + (r.address2 || '') + (r.address3 || '');
        var target = field.linkTo && document.getElementById(inputId(field.linkTo));
        if (target) {
          target.value = addr;
          target.focus();
          target.dispatchEvent(new Event('input'));
        }
      })
      .catch(function () {
        showError(field.id, '住所の検索に失敗しました。手入力してください。');
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = '住所検索';
      });
  }

  /** メールアドレス：confirm 指定があれば確認用の再入力欄も出す */
  function buildEmail(field) {
    var box = document.createElement('div');

    var input = document.createElement('input');
    input.type = 'email';
    input.id = inputId(field.id);
    input.name = field.id;
    input.className = 'input-field';
    input.inputMode = 'email';
    input.autocomplete = 'email';
    if (field.placeholder) input.placeholder = field.placeholder;
    box.appendChild(input);

    if (field.confirm) {
      var label = document.createElement('label');
      label.className = 'input-label';
      label.style.marginTop = '0.75rem';
      label.textContent = (field.label || 'メールアドレス') + '（確認）';
      var req = document.createElement('span');
      req.className = 'required';
      req.textContent = '*';
      label.appendChild(req);

      var confirmInput = document.createElement('input');
      confirmInput.type = 'email';
      confirmInput.id = inputId(field.id) + '_confirm';
      confirmInput.className = 'input-field';
      confirmInput.placeholder = 'もう一度入力してください';

      var mismatch = document.createElement('p');
      mismatch.className = 'field-error hidden';
      mismatch.id = 'err_' + field.id + '_confirm';
      mismatch.textContent = 'メールアドレスが一致しません';

      function check() {
        var ok = !confirmInput.value || confirmInput.value === input.value;
        mismatch.classList.toggle('hidden', ok);
        confirmInput.classList.toggle('input-invalid', !ok);
      }
      input.addEventListener('input', check);
      confirmInput.addEventListener('input', check);

      box.appendChild(label);
      box.appendChild(confirmInput);
      box.appendChild(mismatch);
    }
    return box;
  }

  // ========================================
  // 画像添付
  // ========================================

  function buildImage(field) {
    var box = document.createElement('div');
    imageState[field.id] = { file: null, error: null, previousUrl: '', usePrevious: false };

    // 前回の写真を使う（リピーター認証で復元されたときだけ表示）
    var reuse = document.createElement('div');
    reuse.className = 'reuse-photo hidden';
    reuse.id = 'reuse_' + field.id;
    var reuseLabel = document.createElement('label');
    reuseLabel.className = 'checkbox-label';
    var reuseCb = document.createElement('input');
    reuseCb.type = 'checkbox';
    reuseCb.id = 'usePrev_' + field.id;
    var reuseText = document.createElement('span');
    reuseText.textContent = '前回の写真を使用する';
    reuseLabel.appendChild(reuseCb);
    reuseLabel.appendChild(reuseText);
    var prevImg = document.createElement('img');
    prevImg.className = 'reuse-photo-thumb hidden';
    prevImg.id = 'prevImg_' + field.id;
    prevImg.alt = '前回の写真';
    reuse.appendChild(reuseLabel);
    reuse.appendChild(prevImg);
    box.appendChild(reuse);

    var input = document.createElement('input');
    input.type = 'file';
    input.id = inputId(field.id);
    input.name = field.id;
    input.className = 'input-field file-field';
    input.accept = (field.accept || ['image/jpeg', 'image/png']).join(',');
    box.appendChild(input);

    var preview = document.createElement('div');
    preview.className = 'image-preview hidden';
    preview.id = 'preview_' + field.id;
    box.appendChild(preview);

    var hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent = acceptHint(field);
    box.appendChild(hint);

    reuseCb.addEventListener('change', function () {
      var st = imageState[field.id];
      st.usePrevious = reuseCb.checked;
      input.disabled = reuseCb.checked;
      if (reuseCb.checked) {
        input.value = '';
        st.file = null;
        st.error = null;
        preview.classList.add('hidden');
        clearError(field.id);
      }
      prevImg.classList.toggle('hidden', !reuseCb.checked);
    });

    input.addEventListener('change', function () {
      handleImageSelected(field, input, preview);
    });

    return box;
  }

  function acceptHint(field) {
    var types = (field.accept || ['image/jpeg', 'image/png'])
      .map(function (t) { return t.replace('image/', '').toUpperCase(); })
      .join(' / ');
    var mb = field.maxFileSizeMB || 8;
    return '※ ' + types + ' 形式、' + mb + 'MB以下';
  }

  /**
   * 画像を選んだ直後にその場で検証する。
   * alert() を出さず、該当欄の直下にメッセージとプレビューを表示する。
   */
  function handleImageSelected(field, input, preview) {
    var st = imageState[field.id];
    st.file = null;
    st.error = null;
    preview.classList.add('hidden');
    preview.innerHTML = '';
    clearError(field.id);

    var file = input.files && input.files[0];
    if (!file) return;

    var maxMb = field.maxFileSizeMB || 8;
    var accept = field.accept || ['image/jpeg', 'image/png'];
    var name = (file.name || '').toLowerCase();

    // HEIC/HEIF はブラウザで描画できず圧縮も効かないため明示的に弾く
    if (/\.(heic|heif)$/.test(name)) {
      st.error = 'HEIC形式は使用できません。iPhoneの「設定 > カメラ > フォーマット」を'
               + '「互換性優先」にするか、JPGに変換してから選択してください。';
      showError(field.id, st.error);
      input.value = '';
      return;
    }

    var typeOk = accept.indexOf(file.type) >= 0;
    if (!typeOk) {
      st.error = '対応していない形式です（' + (file.type || '不明') + '）。'
               + acceptHint(field).replace('※ ', '') + ' を選択してください。';
      showError(field.id, st.error);
      input.value = '';
      return;
    }

    var sizeMb = file.size / 1024 / 1024;
    if (sizeMb > maxMb) {
      st.error = '画像が' + maxMb + 'MBを超えています（現在 ' + sizeMb.toFixed(1) + 'MB）。'
               + 'もう少し小さい画像を選択してください。';
      showError(field.id, st.error);
      input.value = '';
      return;
    }

    st.file = file;

    var img = document.createElement('img');
    img.className = 'image-preview-thumb';
    img.alt = '選択した画像';
    img.src = URL.createObjectURL(file);
    img.onload = function () { URL.revokeObjectURL(img.src); };

    var meta = document.createElement('span');
    meta.className = 'image-preview-meta';
    meta.textContent = file.name + '（' + sizeMb.toFixed(1) + 'MB）';

    preview.appendChild(img);
    preview.appendChild(meta);
    preview.classList.remove('hidden');
  }

  /** 選択済みファイルを返す（送信時に Base64 化する） */
  function getImageFile(fieldId) {
    var st = imageState[fieldId];
    return st ? st.file : null;
  }

  function getImageState(fieldId) {
    return imageState[fieldId] || null;
  }

  /** リピーター復元時に「前回の写真」を提示する */
  function setPreviousImage(fieldId, url) {
    var st = imageState[fieldId];
    if (!st || !url) return;
    st.previousUrl = url;

    var box = document.getElementById('reuse_' + fieldId);
    var img = document.getElementById('prevImg_' + fieldId);
    var cb = document.getElementById('usePrev_' + fieldId);
    if (!box || !img || !cb) return;

    var m = String(url).match(/(?:\/d\/|id=)([\w-]+)/);
    img.src = m ? 'https://lh3.googleusercontent.com/d/' + m[1] : url;
    img.onerror = function () { img.style.display = 'none'; };

    box.classList.remove('hidden');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
  }

  // ========================================
  // SNSリンク
  // ========================================

  function buildSnsLinks(field) {
    var box = document.createElement('div');
    box.id = 'snsBox_' + field.id;

    var rows = document.createElement('div');
    rows.className = 'sns-rows';
    rows.id = 'snsRows_' + field.id;
    box.appendChild(rows);

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-link-btn';
    addBtn.textContent = '＋ リンクを追加';
    addBtn.addEventListener('click', function () { addSnsRow(field.id, ''); });
    box.appendChild(addBtn);

    setTimeout(function () { addSnsRow(field.id, ''); }, 0);
    return box;
  }

  function addSnsRow(fieldId, url) {
    var rows = document.getElementById('snsRows_' + fieldId);
    if (!rows) return;

    var row = document.createElement('div');
    row.className = 'sns-link-row';

    var badge = document.createElement('span');
    badge.className = 'sns-badge';
    badge.textContent = '未入力';

    var input = document.createElement('input');
    input.type = 'url';
    input.className = 'input-field sns-input';
    input.placeholder = 'https://...';
    input.value = url || '';

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'sns-remove-btn';
    del.setAttribute('aria-label', 'このリンクを削除');
    del.textContent = '×';
    del.addEventListener('click', function () { row.remove(); });

    input.addEventListener('input', function () { updateSnsBadge(badge, input.value); });

    row.appendChild(badge);
    row.appendChild(input);
    row.appendChild(del);
    rows.appendChild(row);

    if (url) updateSnsBadge(badge, url);
  }

  function updateSnsBadge(badge, value) {
    if (!value) {
      badge.textContent = '未入力';
      badge.style.background = '';
      return;
    }
    for (var i = 0; i < SNS_PATTERNS.length; i++) {
      if (SNS_PATTERNS[i].pattern.test(value)) {
        badge.textContent = SNS_PATTERNS[i].name;
        badge.style.background = SNS_PATTERNS[i].color;
        badge.style.color = '#fff';
        return;
      }
    }
    badge.textContent = 'HP';
    badge.style.background = '#6b7280';
    badge.style.color = '#fff';
  }

  function getSnsLinks(fieldId) {
    var rows = document.getElementById('snsRows_' + fieldId);
    if (!rows) return [];
    var out = [];
    rows.querySelectorAll('.sns-link-row').forEach(function (row) {
      var input = row.querySelector('.sns-input');
      var badge = row.querySelector('.sns-badge');
      if (input && input.value.trim()) {
        out.push({ type: badge ? badge.textContent : 'HP', url: input.value.trim() });
      }
    });
    return out;
  }

  function setSnsLinks(fieldId, links) {
    var rows = document.getElementById('snsRows_' + fieldId);
    if (!rows) return;
    rows.innerHTML = '';
    (links || []).forEach(function (l) {
      addSnsRow(fieldId, typeof l === 'string' ? l : l.url);
    });
    if (!rows.children.length) addSnsRow(fieldId, '');
  }

  // ========================================
  // 値の取得・設定
  // ========================================

  function getValue(field) {
    var el = document.getElementById(inputId(field.id));

    if (field.type === 'image') {
      var st = imageState[field.id] || {};
      if (st.usePrevious && st.previousUrl) return st.previousUrl;
      return st.file ? '(添付あり)' : '';
    }
    if (field.type === 'snsLinks') return getSnsLinks(field.id);
    if (field.type === 'heading') return '';

    if (field.type === 'radio') {
      var checked = document.querySelector('[name="' + cssEscape(field.id) + '"]:checked');
      return checked ? checked.value : '';
    }
    if (field.type === 'checkboxGroup') {
      var vals = [];
      document.querySelectorAll('[name="' + cssEscape(field.id) + '[]"]:checked')
        .forEach(function (c) { vals.push(c.value); });
      return vals;
    }
    if (field.type === 'checkbox') {
      return el && el.checked ? (field.checkedValue || 'はい') : (field.uncheckedValue || 'いいえ');
    }
    return el ? el.value.trim() : '';
  }

  /** 全項目の回答を { fieldId: 値 } で返す */
  function getValues() {
    var out = {};
    Object.keys(fieldsById).forEach(function (id) {
      var f = fieldsById[id];
      if (!isAnswerableField(f)) return;
      if (!isFieldVisible(f)) return;   // 非表示の項目は回答に含めない
      out[id] = getValue(f);
    });
    return out;
  }

  /** リピーター復元用。存在しない項目・非対応の値は黙って無視する */
  function setValues(values) {
    Object.keys(values || {}).forEach(function (id) {
      var field = fieldsById[id];
      if (!field) return;
      var value = values[id];
      if (value === undefined || value === null || value === '') return;

      if (field.type === 'snsLinks') { setSnsLinks(id, value); return; }
      if (field.type === 'image') { setPreviousImage(id, value); return; }

      if (field.type === 'radio') {
        var radio = document.querySelector(
          '[name="' + cssEscape(id) + '"][value="' + cssEscape(String(value)) + '"]');
        if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
        return;
      }
      if (field.type === 'checkboxGroup') {
        var list = Array.isArray(value) ? value : String(value).split(',');
        list.forEach(function (v) {
          var cb = document.querySelector(
            '[name="' + cssEscape(id) + '[]"][value="' + cssEscape(String(v).trim()) + '"]');
          if (cb) cb.checked = true;
        });
        return;
      }

      var el = document.getElementById(inputId(id));
      if (!el) return;
      if (field.type === 'checkbox') {
        el.checked = String(value) === (field.checkedValue || 'はい') || value === true;
      } else {
        el.value = value;
        if (field.confirm) {
          var conf = document.getElementById(inputId(id) + '_confirm');
          if (conf) conf.value = value;
        }
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  // ========================================
  // 条件付き表示
  // ========================================

  /** showIf（他項目の値に連動）を監視する */
  function bindConditionalVisibility() {
    Object.keys(fieldsById).forEach(function (id) {
      var f = fieldsById[id];
      if (!f.showIf || !f.showIf.fieldId) return;
      var srcField = fieldsById[f.showIf.fieldId];
      if (!srcField) return;

      var handler = function () { applyConditionalVisibility(); };
      if (srcField.type === 'radio' || srcField.type === 'checkboxGroup') {
        document.querySelectorAll('[name^="' + cssEscape(srcField.id) + '"]')
          .forEach(function (el) { el.addEventListener('change', handler); });
      } else {
        var el = document.getElementById(inputId(srcField.id));
        if (el) el.addEventListener('input', handler);
      }
    });
    applyConditionalVisibility();
  }

  /**
   * showIf / showIfBoothIds を評価して表示を切り替える。
   * @param {string|null} boothId 現在選択中のブース
   */
  function applyConditionalVisibility(boothId) {
    if (boothId !== undefined) applyConditionalVisibility._boothId = boothId;
    var currentBooth = applyConditionalVisibility._boothId || null;

    Object.keys(fieldsById).forEach(function (id) {
      var f = fieldsById[id];
      var wrap = document.querySelector('.field-block[data-field-id="' + cssEscape(id) + '"]');
      if (!wrap) return;

      var visible = true;

      if (f.showIf && f.showIf.fieldId) {
        var srcField = fieldsById[f.showIf.fieldId];
        var srcValue = srcField ? getValue(srcField) : '';
        visible = String(srcValue) === String(f.showIf.equals);
      }

      // showIfBoothIds が指定されていれば、そこに含まれるブースのときだけ表示する。
      // 空配列は「表示できるブースが無い」＝常に非表示（誤って常時表示にしない）。
      if (visible && Array.isArray(f.showIfBoothIds)) {
        visible = !!currentBooth && f.showIfBoothIds.indexOf(currentBooth) >= 0;
      }

      wrap.classList.toggle('hidden', !visible);
    });
  }

  function isFieldVisible(field) {
    var wrap = document.querySelector('.field-block[data-field-id="' + cssEscape(field.id) + '"]');
    return wrap ? !wrap.classList.contains('hidden') : false;
  }

  // ========================================
  // 検証
  // ========================================

  /**
   * 全項目を検証する。
   * @returns {Array} [{ fieldId, message }] 先頭がフォーカス対象
   */
  function validate() {
    var errors = [];

    Object.keys(fieldsById).forEach(function (id) {
      var f = fieldsById[id];
      clearError(id);
      if (!isAnswerableField(f) || !isFieldVisible(f)) return;

      var value = getValue(f);
      var label = f.label || id;

      // 必須
      if (f.required && isEmpty(f, value)) {
        errors.push({ fieldId: id, message: label + 'を' + requiredVerb(f) + 'してください' });
        return;
      }
      if (isEmpty(f, value)) return;   // 任意項目が空なら以降の検証は不要

      // 文字数
      if (f.maxLength > 0 && typeof value === 'string' && value.length > f.maxLength) {
        errors.push({
          fieldId: id,
          message: label + 'は' + f.maxLength + '文字以内で入力してください（現在 ' + value.length + '文字）'
        });
        return;
      }

      var typeError = validateByType(f, value);
      if (typeError) errors.push({ fieldId: id, message: typeError });
    });

    errors.forEach(function (e) { showError(e.fieldId, e.message); });
    return errors;
  }

  function validateByType(field, value) {
    var label = field.label || field.id;

    switch (field.type) {
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return label + 'の形式が正しくありません';
        }
        if (field.confirm) {
          var conf = document.getElementById(inputId(field.id) + '_confirm');
          if (conf && conf.value !== value) return label + 'が一致しません';
        }
        return null;

      case 'tel':
        if (!/^[0-9０-９\-\(\)\s]{9,15}$/.test(value)) {
          return label + 'は9〜15桁の数字で入力してください';
        }
        return null;

      case 'postal':
        if (!/^\d{3}-?\d{4}$/.test(value)) {
          return label + 'は7桁の数字で入力してください';
        }
        return null;

      case 'url':
        if (!/^https?:\/\/.+/.test(value)) {
          return label + 'は http:// または https:// から始まるURLを入力してください';
        }
        return null;

      case 'number':
        var n = Number(value);
        if (isNaN(n)) return label + 'は数値で入力してください';
        if (isNum(field.min) && n < field.min) return label + 'は' + field.min + '以上で入力してください';
        if (isNum(field.max) && n > field.max) return label + 'は' + field.max + '以下で入力してください';
        return null;

      case 'image':
        var st = imageState[field.id] || {};
        if (st.error) return st.error;
        return null;

      case 'snsLinks':
        var bad = (value || []).filter(function (l) { return !/^https?:\/\/.+/.test(l.url); });
        if (bad.length) return 'SNSリンクは http:// または https:// から始まるURLを入力してください';
        return null;

      default:
        return null;
    }
  }

  /** 「入力」「選択」「添付」を型に応じて出し分ける */
  function requiredVerb(field) {
    if (field.type === 'image') return '添付';
    if (['select', 'radio', 'checkbox', 'checkboxGroup', 'category', 'booth', 'date']
        .indexOf(field.type) >= 0) return '選択';
    return '入力';
  }

  function isEmpty(field, value) {
    if (field.type === 'image') {
      var st = imageState[field.id] || {};
      return !st.file && !(st.usePrevious && st.previousUrl);
    }
    if (Array.isArray(value)) return value.length === 0;
    if (field.type === 'checkbox') return false;   // チェックボックスは常に値を持つ
    return !String(value == null ? '' : value).trim();
  }

  // ========================================
  // エラー表示
  // ========================================

  function showError(fieldId, message) {
    var el = document.getElementById('err_' + fieldId);
    if (el) {
      el.textContent = message;
      el.classList.remove('hidden');
    }
    var input = document.getElementById(inputId(fieldId));
    if (input) input.classList.add('input-invalid');
  }

  function clearError(fieldId) {
    var el = document.getElementById('err_' + fieldId);
    if (el) {
      el.textContent = '';
      el.classList.add('hidden');
    }
    var input = document.getElementById(inputId(fieldId));
    if (input) input.classList.remove('input-invalid');
  }

  /** 最初のエラー項目までスクロールしてフォーカスする */
  function focusError(fieldId) {
    var wrap = document.querySelector('.field-block[data-field-id="' + cssEscape(fieldId) + '"]');
    if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var input = document.getElementById(inputId(fieldId));
    if (input && input.focus) setTimeout(function () { input.focus({ preventScroll: true }); }, 300);
  }

  // ========================================
  // その他
  // ========================================

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /** 属性セレクタに埋め込むための最小限のエスケープ */
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  /** スプレッドシートのヘッダ生成用に、項目の定義を送信可能な形で返す */
  function getFieldDefs() {
    return Object.keys(fieldsById).map(function (id) {
      var f = fieldsById[id];
      return { id: f.id, label: f.label, type: f.type, section: f.section, order: f.order };
    }).filter(function (d) { return DISPLAY_ONLY_TYPES.indexOf(d.type) < 0; });
  }

  function getField(fieldId) { return fieldsById[fieldId] || null; }
  function getAllFields() { return fieldsById; }

  return {
    render: render,
    getValues: getValues,
    setValues: setValues,
    validate: validate,
    showError: showError,
    clearError: clearError,
    focusError: focusError,
    applyConditionalVisibility: applyConditionalVisibility,
    getImageFile: getImageFile,
    getImageState: getImageState,
    setPreviousImage: setPreviousImage,
    getSnsLinks: getSnsLinks,
    getFieldDefs: getFieldDefs,
    getField: getField,
    getAllFields: getAllFields,
    inputId: inputId
  };
})();
