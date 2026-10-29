/* Educational allowance records. No bank payments and no real ledger writes. */
(function (global) {
  'use strict';
  var current = null, sequence = 0;
  function node(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function button(text, action, cls) { var b = node('button', cls || 'btn', text); b.type = 'button'; b.dataset.allowanceAction = action; return b; }
  function live(s) {
    if (current !== s || s.closed || !s.panel.isConnected) return false;
    if (typeof s.options.getAccountId === 'function' && String(s.options.getAccountId()) !== s.owner) { cleanup(); return false; }
    var owner = typeof s.options.getUser === 'function' ? s.options.getUser() : global.LifeFeatures && typeof global.LifeFeatures.user === 'function' ? global.LifeFeatures.user() : null;
    if (owner && String(owner.id) !== s.owner) { cleanup(); return false; }
    return true;
  }
  function message(s, text, error) { if (!live(s)) return; s.status.textContent = text; s.status.classList.toggle('is-error', !!error); }
  function money(value) { return Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 0 }) + ' 元'; }
  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    var bytes = new Uint8Array(16); global.crypto.getRandomValues(bytes); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
    var hex = Array.from(bytes, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  function field(form, text, name, type) {
    var label = node('label', 'allowance-sim__field'), caption = node('span', '', text), input = node(type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    input.name = name; if (input.tagName === 'INPUT') input.type = type; label.append(caption, input); form.appendChild(label); return input;
  }
  function lock(s, value) { Array.from(s.form.elements).forEach(function (el) { el.disabled = value; }); }
  function amountValue(input) {
    var raw = input.value.trim(); if (!/^[0-9]{1,7}$/.test(raw)) return null;
    var number = Number(raw); return Number.isSafeInteger(number) && number >= 1 && number <= 1000000 ? number : null;
  }
  function drawHistory(s) {
    s.history.replaceChildren();
    if (!s.items.length) s.history.appendChild(node('p', 'allowance-sim__muted', '還沒有模擬發放紀錄。'));
    s.items.forEach(function (item) {
      var article = node('article', 'allowance-sim__record'), heading = node('div', 'allowance-sim__record-head');
      heading.append(node('strong', '', String(item.guardianName || '發放者') + ' → ' + String(item.wardName || '收款者')), node('span', 'allowance-sim__amount', money(item.amount)));
      var meta = node('p', 'allowance-sim__muted', String(item.guardianId) === s.owner ? '你發放的模擬零用錢' : '你收到的模擬零用錢');
      var at = new Date(item.createdAt); if (Number.isFinite(at.getTime())) { var time = node('time', '', at.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })); time.dateTime = item.createdAt; meta.append(' · ', time); }
      article.append(heading, meta); if (item.note) article.appendChild(node('p', 'allowance-sim__note', String(item.note))); s.history.appendChild(article);
    });
    s.more.hidden = !s.next; s.more.disabled = false;
  }
  async function load(s, append) {
    var job = ++s.loadJob;
    if (append) s.more.disabled = true;
    try {
      var data = await s.api.allowanceSimulation(append ? { beforeId: s.next } : {});
      if (!live(s) || job !== s.loadJob) return;
      var items = Array.isArray(data.items) ? data.items : [];
      if (append) { var ids = new Set(s.items.map(function (i) { return String(i.id); })); s.items = s.items.concat(items.filter(function (i) { return !ids.has(String(i.id)); })); }
      else s.items = items;
      s.next = data.nextBeforeId || null; drawHistory(s);
      if (!append) {
        s.recipients = Array.isArray(data.recipients) ? data.recipients : [];
        var selected = s.recipient.value; s.recipient.replaceChildren();
        s.recipients.forEach(function (person) { var option = node('option', '', String(person.name)); option.value = String(person.id); s.recipient.appendChild(option); });
        if (s.recipients.some(function (r) { return String(r.id) === selected; })) s.recipient.value = selected;
        s.form.hidden = !s.recipients.length; s.empty.hidden = !!s.recipients.length;
        if (!s.recipients.length) s.preview.hidden = true;
      }
      s.retry.hidden = true;
    } catch (_) {
      if (!live(s) || job !== s.loadJob) return;
      message(s, s.issued ? '模擬發放已完成，但紀錄暫時無法重新讀取。請重新載入紀錄；不需要再發放一次。' : '目前無法讀取模擬紀錄，請稍後重試。', true);
      s.retry.hidden = false; s.more.disabled = false;
    }
  }
  function showPreview(s) {
    if (!live(s) || s.sending) return;
    var amount = amountValue(s.amount), recipient = s.recipients.find(function (r) { return String(r.id) === s.recipient.value; });
    if (!recipient || amount === null || s.note.value.trim().length > 120) return message(s, '請選擇收款者，並填入1至1,000,000元的整元金額；備註最多120字。', true);
    var body = { wardId: String(recipient.id), amount: amount, note: s.note.value.trim() }, signature = JSON.stringify(body);
    if (!s.attempt || s.attempt.signature !== signature) s.attempt = { signature: signature, body: Object.assign(body, { idempotencyKey: uuid() }) };
    s.preview.replaceChildren(node('h3', '', '確認模擬發放'), node('p', '', '發放 ' + money(amount) + ' 給 ' + String(recipient.name)));
    if (body.note) s.preview.appendChild(node('p', 'allowance-sim__note', body.note));
    s.preview.append(node('p', 'allowance-sim__muted', '只建立雙方可見的練習紀錄，不會扣款或影響正式收支。'), button('確認模擬發放', 'confirm', 'btn btn--primary'), button('返回填寫', 'cancel'));
    s.preview.hidden = false; lock(s, true); message(s, '請核對收款者與金額，再確認模擬發放。', false);
    s.preview.querySelector('button').focus();
  }
  async function send(s) {
    if (!live(s) || s.sending || !s.attempt) return;
    s.sending = true; Array.from(s.preview.querySelectorAll('button')).forEach(function (b) { b.disabled = true; }); message(s, '正在保存模擬紀錄…', false);
    try {
      var result = await s.api.issueAllowanceSimulation(Object.assign({}, s.attempt.body));
      if (!live(s)) return;
      if (!result || result.simulation !== true || !result.item || !result.item.id) throw new Error('Invalid simulation response');
      s.issued = true; s.attempt = null; s.preview.hidden = true; lock(s, false); s.note.value = '';
      message(s, result.replayed ? '這筆模擬發放已保存，重試沒有重複新增。' : '模擬發放已完成，雙方都能看到這筆練習紀錄。', false);
      s.panel.dispatchEvent(new CustomEvent('fambudget:allowance-simulated', { bubbles: true, detail: { simulation: true } }));
      await load(s, false);
    } catch (error) {
      if (!live(s)) return;
      if (error && [400, 401, 403, 409, 422].includes(error.status)) {
        s.attempt = null; s.preview.hidden = true; lock(s, false);
        return message(s, error.status === 403 ? '這次未新增模擬紀錄。請確認目前的家庭監管關係，再重新載入紀錄。' : error.status === 401 ? '登入已失效，請重新登入後再操作。' : '這次未新增模擬紀錄，請重新核對對象、金額及備註。', true);
      }
      message(s, '這次保存結果尚未確認。可按「重試確認」，系統會沿用同一操作編號，避免重複發放。', true);
      var confirm = s.preview.querySelector('[data-allowance-action=confirm]'); if (confirm) confirm.textContent = '重試確認';
    } finally {
      if (live(s)) { s.sending = false; Array.from(s.preview.querySelectorAll('button')).forEach(function (b) { b.disabled = false; }); }
    }
  }
  function cleanup() {
    var s = current; current = null; if (!s) return; s.closed = true; s.loadJob++; global.removeEventListener('hashchange', s.onHash); s.panel.remove(); s.attempt = null; s.items = [];
  }
  function render(root, options) {
    cleanup(); options = options || {}; var api = options.api || global.API, user = options.user || {};
    if (!root || !api || typeof api.allowanceSimulation !== 'function' || typeof api.issueAllowanceSimulation !== 'function') throw new Error('Allowance simulation API unavailable');
    var s = { id: ++sequence, owner: String(user.id || ''), options: options, api: api, items: [], recipients: [], loadJob: 0, next: null, closed: false, sending: false, issued: false, attempt: null };
    current = s; s.panel = node('section', 'allowance-sim'); s.panel.dataset.allowanceSimulation = ''; root.appendChild(s.panel);
    s.panel.append(node('h2', '', '親子零用錢模擬'), node('p', 'allowance-sim__badge', '模擬零用錢，未發生銀行轉帳'), node('p', 'allowance-sim__intro', '練習發放、記錄與討論零用錢用途。這裡不會扣款，也不會改變正式收支、每月零用金設定或銀行餘額。'));
    s.status = node('p', 'allowance-sim__status', '正在讀取模擬紀錄…'); s.status.setAttribute('role', 'status'); s.status.setAttribute('aria-live', 'polite'); s.panel.appendChild(s.status);
    s.retry = button('重新載入紀錄', 'retry'); s.retry.hidden = true; s.panel.appendChild(s.retry);
    s.form = node('form', 'allowance-sim__form'); s.form.hidden = true; s.form.noValidate = true;
    s.recipient = field(s.form, '發放給誰', 'wardId', 'select'); s.amount = field(s.form, '模擬金額（新臺幣整元）', 'amount', 'text'); s.amount.inputMode = 'numeric'; s.amount.maxLength = 7; s.amount.value = '200';
    s.note = field(s.form, '用途／備註（選填）', 'note', 'textarea'); s.note.maxLength = 120; s.note.rows = 2; s.note.placeholder = '例如：本週零用錢，先存50元';
    s.form.appendChild(button('核對發放內容', 'preview', 'btn btn--primary')); s.form.addEventListener('submit', function (event) { event.preventDefault(); showPreview(s); }); s.panel.appendChild(s.form);
    s.empty = node('div', 'allowance-sim__empty'); s.empty.hidden = true;
    var link = node('a', '', '前往家庭設定'); link.href = '#/members'; s.empty.append(node('p', '', '目前沒有可發放的照看對象。孩子可在下方查看收到的模擬紀錄；家長請先在家庭功能建立有效的監管關係。'), link); s.panel.appendChild(s.empty);
    s.preview = node('section', 'allowance-sim__preview'); s.preview.hidden = true; s.preview.setAttribute('aria-label', '模擬發放內容確認'); s.panel.appendChild(s.preview);
    var historyTitle = node('h3', '', '雙方共用的模擬紀錄'); s.history = node('div', 'allowance-sim__history'); s.more = button('載入較早紀錄', 'more'); s.more.hidden = true; s.panel.append(historyTitle, s.history, s.more);
    s.panel.addEventListener('click', function (event) {
      var target = event.target.closest('[data-allowance-action]'); if (!target || !live(s)) return;
      var action = target.dataset.allowanceAction;
      if (action === 'preview') showPreview(s);
      else if (action === 'confirm') send(s);
      else if (action === 'cancel' && !s.sending) { s.preview.hidden = true; lock(s, false); s.recipient.focus(); message(s, '可調整內容；若上次保存未確認，相同內容再次確認會沿用原操作編號。', false); }
      else if (action === 'retry') { message(s, '正在讀取模擬紀錄…', false); load(s, false).then(function () { if (live(s) && s.retry.hidden) message(s, '模擬紀錄已更新。', false); }); }
      else if (action === 'more' && s.next) load(s, true);
    });
    s.hash = global.location.hash; s.onHash = function () { if (current === s && global.location.hash !== s.hash) cleanup(); }; global.addEventListener('hashchange', s.onHash);
    return load(s, false).then(function () { if (live(s) && s.retry.hidden) message(s, '模擬紀錄已載入。只有發放者與收款者可以查看。', false); });
  }
  global.AllowanceSimulation = { render: render, cleanup: cleanup };
})(window);
