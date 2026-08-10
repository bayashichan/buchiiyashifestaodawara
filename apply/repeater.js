/**
 * リピーター認証
 *
 * 過去に申込のある方が、本名＋メールアドレスで照合 → メールで届く認証コードを入力すると
 * 前回の申込内容を読み込めるようにします。
 *
 * 認証コードの発行・検証・保管はすべて GAS 側で行います（CacheService を使うため
 * 追加のデータベースや有料サービスは不要）。このファイルは UI と通信だけを担当します。
 */

var Repeater = (function () {

  var config = null;
  var onRestore = null;
  var lastName = '';
  var lastEmail = '';

  function init(cfg, restoreCallback) {
    config = cfg;
    onRestore = restoreCallback || function () {};

    var section = document.getElementById('repeaterSection');
    if (!section) return;

    section.innerHTML = '';
    section.appendChild(buildUI());
    section.classList.remove('hidden');
  }

  function buildUI() {
    var box = document.createElement('div');

    var title = document.createElement('h2');
    title.className = 'section-title';
    title.style.color = '#ea580c';
    title.textContent = '🔄 以前にお申込みされた方へ';
    box.appendChild(title);

    var lead = document.createElement('p');
    lead.className = 'field-description';
    lead.textContent = '前回と同じお名前（本名）とメールアドレスで照合し、'
                     + 'メールにお送りする認証コードを入力すると、前回の申込内容を読み込めます。';
    box.appendChild(lead);

    var openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'submit-btn';
    openBtn.style.background = '#ea580c';
    openBtn.style.boxShadow = 'none';
    openBtn.textContent = '🔍 前回の内容を呼び出す';
    box.appendChild(openBtn);

    var area = document.createElement('div');
    area.className = 'hidden';
    area.style.marginTop = '1rem';
    area.style.paddingTop = '1rem';
    area.style.borderTop = '1px solid #fed7aa';

    var nameInput = labeledInput(area, 'お名前（本名）', 'text', '山田 花子',
      '※ 出展名ではなく本名を入力してください');
    var emailInput = labeledInput(area, 'メールアドレス', 'email', 'example@example.com', '');

    var sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'submit-btn';
    sendBtn.style.width = '100%';
    sendBtn.style.marginTop = '0.75rem';
    sendBtn.textContent = '認証コードを送信';
    area.appendChild(sendBtn);

    // --- 認証コード入力 ---
    var codeArea = document.createElement('div');
    codeArea.className = 'hidden';
    codeArea.style.cssText = 'margin-top:1rem;padding:1rem;background:#f0fdf4;'
                           + 'border:1.5px solid #86efac;border-radius:0.5rem';

    var codeTitle = document.createElement('p');
    codeTitle.style.cssText = 'font-weight:700;color:#16a34a;margin-bottom:0.5rem';
    codeTitle.textContent = '✅ 認証コードをメールでお送りしました';
    codeArea.appendChild(codeTitle);

    var digits = (config.repeater && config.repeater.codeDigits) || 4;
    var codeLabel = document.createElement('label');
    codeLabel.className = 'input-label';
    codeLabel.textContent = '認証コード（メールに届いた' + digits + '桁の数字）';
    codeArea.appendChild(codeLabel);

    var codeRow = document.createElement('div');
    codeRow.style.cssText = 'display:flex;gap:0.5rem;align-items:center';

    var codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.className = 'input-field';
    codeInput.style.width = '9rem';
    codeInput.inputMode = 'numeric';
    codeInput.autocomplete = 'one-time-code';
    codeInput.maxLength = digits;
    codeInput.placeholder = '0'.repeat(digits);

    var verifyBtn = document.createElement('button');
    verifyBtn.type = 'button';
    verifyBtn.className = 'submit-btn';
    verifyBtn.style.background = '#16a34a';
    verifyBtn.style.boxShadow = 'none';
    verifyBtn.textContent = '認証して呼び出す';

    codeRow.appendChild(codeInput);
    codeRow.appendChild(verifyBtn);
    codeArea.appendChild(codeRow);
    area.appendChild(codeArea);

    var status = document.createElement('p');
    status.className = 'status-message';
    area.appendChild(status);

    box.appendChild(area);

    // --- 動作 ---
    openBtn.addEventListener('click', function () {
      area.classList.toggle('hidden');
    });

    sendBtn.addEventListener('click', function () {
      sendCode(nameInput.value, emailInput.value, sendBtn, codeArea, status);
    });

    verifyBtn.addEventListener('click', function () {
      verifyCode(codeInput.value, verifyBtn, status, area);
    });

    return box;
  }

  function labeledInput(host, labelText, type, placeholder, hint) {
    var wrap = document.createElement('div');
    wrap.style.marginBottom = '0.75rem';

    var label = document.createElement('label');
    label.className = 'input-label';
    label.textContent = labelText;
    wrap.appendChild(label);

    var input = document.createElement('input');
    input.type = type;
    input.className = 'input-field';
    input.placeholder = placeholder;
    wrap.appendChild(input);

    if (hint) {
      var h = document.createElement('p');
      h.className = 'field-hint';
      h.textContent = hint;
      wrap.appendChild(h);
    }

    host.appendChild(wrap);
    return input;
  }

  // ========================================
  // 認証コードの送信・検証
  // ========================================

  async function sendCode(name, email, btn, codeArea, status) {
    name = String(name || '').trim();
    email = String(email || '').trim();

    if (!name || !email) {
      setStatus(status, 'お名前とメールアドレスを入力してください', 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus(status, 'メールアドレスの形式が正しくありません', 'error');
      return;
    }

    lastName = name;
    lastEmail = email;

    setStatus(status, '📧 認証コードを送信しています…', 'info');
    btn.disabled = true;

    try {
      var data = await callGas({ action: 'send_auth_code', name: name, email: email });

      if (data.success) {
        setStatus(status, '認証コードをメールでお送りしました。メールをご確認ください。', 'ok');
        codeArea.classList.remove('hidden');
        btn.textContent = '認証コードを再送する';
      } else {
        // 「該当なし」と「送信上限」を区別して伝える
        setStatus(status, data.error || '該当するお申込みが見つかりませんでした。',
          data.code === 'QUOTA' ? 'warn' : 'warn');
      }
    } catch (err) {
      setStatus(status, '通信に失敗しました。時間をおいてお試しください。', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function verifyCode(code, btn, status, area) {
    code = String(code || '').trim();
    var digits = (config.repeater && config.repeater.codeDigits) || 4;

    if (code.length !== digits) {
      setStatus(status, digits + '桁の認証コードを入力してください', 'error');
      return;
    }

    setStatus(status, '🔍 認証しています…', 'info');
    btn.disabled = true;

    try {
      var data = await callGas({
        action: 'verify_auth_code', name: lastName, email: lastEmail, code: code
      });

      if (data.success && data.list && data.list.length) {
        setStatus(status, '認証できました。読み込むデータを選択してください。', 'ok');
        showSelection(data.list, status, area);
      } else {
        setStatus(status, data.error || '認証コードが正しくないか、有効期限が切れています。', 'error');
      }
    } catch (err) {
      setStatus(status, '通信に失敗しました。時間をおいてお試しください。', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  /** GAS へは multipart で送る（プリフライトを起こさないため） */
  async function callGas(params) {
    var target = (config.integration || {}).gasUrl || (config.integration || {}).workerUrl;
    if (!target) throw new Error('送信先URLが未設定です');

    var fd = new FormData();
    Object.keys(params).forEach(function (k) { fd.set(k, params[k]); });

    var res = await fetch(target, { method: 'POST', body: fd, redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }

  // ========================================
  // 過去申込の選択
  // ========================================

  function showSelection(list, status, area) {
    var modal = document.getElementById('repeaterSelectModal');
    var host = document.getElementById('repeaterList');
    var closeBtn = document.getElementById('closeRepeaterModalBtn');
    if (!modal || !host) return;

    host.innerHTML = '';

    list.forEach(function (record) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'repeater-item';

      var title = document.createElement('div');
      title.className = 'ri-event';
      title.textContent = record.eventName || '過去のお申込み';

      var meta = document.createElement('div');
      meta.className = 'ri-meta';
      var bits = [];
      if (record.submittedAt) bits.push(record.submittedAt);
      if (record.exhibitorName) bits.push('出展名: ' + record.exhibitorName);
      meta.textContent = bits.join(' / ');

      item.appendChild(title);
      item.appendChild(meta);

      item.addEventListener('click', function () {
        onRestore(record);
        modal.classList.add('hidden');
        setStatus(status, '前回の内容を読み込みました。ブースとオプションは今回の分をお選びください。', 'ok');
        setTimeout(function () { area.classList.add('hidden'); }, 1800);
      });

      host.appendChild(item);
    });

    if (closeBtn) {
      closeBtn.onclick = function () {
        modal.classList.add('hidden');
        setStatus(status, 'キャンセルしました', 'warn');
      };
    }
    modal.classList.remove('hidden');
  }

  function setStatus(el, message, kind) {
    if (!el) return;
    el.textContent = message;
    el.className = 'status-message is-' + (kind || 'info');
  }

  return { init: init };
})();
