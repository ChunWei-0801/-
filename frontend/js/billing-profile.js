/* Optional buyer invoice details. Private defaults stay on the authenticated account. */
(function (global) {
  'use strict';
  var current = null, forms = new WeakMap();
  var methods = [
    ['', '未指定'], ['cash', '現金'], ['credit_card', '信用卡'],
    ['bank_transfer', '銀行轉帳'], ['jkopay', '街口支付'],
    ['line_pay', 'LINE Pay'], ['easycard', '悠遊卡'], ['other', '其他付款方式']
  ];
  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function id(value) { return value && typeof value === 'object' ? String(value.id) : value == null ? null : String(value); }
  function owner(options) {
    if (typeof options.getOwner === 'function') return id(options.getOwner());
    if (global.LifeFeatures && typeof global.LifeFeatures.user === 'function') return id(global.LifeFeatures.user());
    return id(typeof options.owner === 'function' ? options.owner() : options.owner);
  }
  function authenticated(api) { return !!(api && api.mode === 'http' && typeof api.request === 'function'); }
  function request(api, method, body, signal) { return api.request('/api/billing/profile', { method: method, body: body, signal: signal }); }
  function taxId(value) { return String(value == null ? '' : value).trim(); }
  function taxValid(value) { return !taxId(value) || /^[0-9]{8}$/.test(taxId(value)); }
  function label(text, control) { var wrap = el('label', null, 'billing-field'); wrap.append(el('span', text), control); return wrap; }
  function taxInput(value) {
    var input = el('input'); input.type = 'text'; input.name = 'buyerTaxId';
    input.inputMode = 'numeric'; input.autocomplete = 'off'; input.maxLength = 12;
    input.pattern = '\\s*[0-9]{8}\\s*'; input.placeholder = '例如：12345678'; input.value = taxId(value);
    return input;
  }
  function paymentInput(value) {
    var select = el('select'); select.name = 'paymentMethod';
    methods.forEach(function (entry) { select.append(new Option(entry[1], entry[0])); });
    select.value = methods.some(function (entry) { return entry[0] === value; }) ? value : '';
    return select;
  }
  function control(form, name) { return form.elements && typeof form.elements.namedItem === 'function' ? form.elements.namedItem(name) : form.querySelector('[name="' + name + '"]'); }
  function values(form) {
    var payment = control(form, 'paymentMethod'), tax = control(form, 'buyerTaxId');
    return { paymentMethod: payment && payment.value || null, buyerTaxId: tax && taxId(tax.value) || null };
  }
  function valid(form) {
    var value = values(form);
    return taxValid(value.buyerTaxId) && methods.some(function (entry) { return entry[0] === (value.paymentMethod || ''); });
  }
  function enhanceForm(form, options) {
    options = options || {};
    if (!form || typeof form.querySelector !== 'function') return null;
    if (forms.has(form)) { var previous = forms.get(form); if (previous.tax.isConnected && form.contains(previous.tax)) return previous; previous.destroy(); }
    var mine = owner(options), api = options.api || global.API, explicit = options.values || {};
    var set = el('fieldset', null, 'billing-entry-fields'); set.dataset.billingFields = '';
    set.append(el('legend', '付款與報帳資料（選填）'));
    var payment = control(form, 'paymentMethod') || paymentInput(explicit.paymentMethod);
    var tax = control(form, 'buyerTaxId') || taxInput(explicit.buyerTaxId);
    if (!payment.parentNode) set.append(label('付款方式（選填）', payment));
    if (!tax.parentNode) set.append(label('買方統一編號（報帳用，選填）', tax));
    var help = el('p', '統編可留白；只檢查 8 位數字格式。供記帳報帳使用，不會修改已開立的發票。', 'billing-help');
    set.append(help); (options.container || form).append(set);
    var touched = false, destroyed = false;
    function live() { return !destroyed && form.isConnected && set.isConnected && tax.isConnected && mine !== null && mine === owner(options); }
    function dirty() { touched = true; }
    tax.addEventListener('input', dirty); tax.addEventListener('change', dirty);
    tax.addEventListener('blur', function () { tax.value = taxId(tax.value); });
    var state = { payment: payment, tax: tax, ready: Promise.resolve(), destroy: function () {
      destroyed = true; tax.removeEventListener('input', dirty); tax.removeEventListener('change', dirty);
      set.remove(); forms.delete(form);
    } };
    forms.set(form, state);
    if (options.prefill !== false && !Object.prototype.hasOwnProperty.call(explicit, 'buyerTaxId') && authenticated(api) && mine !== null) {
      var initialValue = tax.value;
      state.ready = Promise.resolve().then(function () {
        if (!live()) return null;
        return request(api, 'GET');
      }).then(function (profile) {
        if (!profile || !live() || touched || tax.value !== initialValue || taxId(tax.value)) return;
        if (taxValid(profile.buyerTaxId)) {
          tax.value = taxId(profile.buyerTaxId);
          // A late default changes the receipt draft and requires review again.
          if (tax.value) tax.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }).catch(function () {
        if (live()) help.textContent = '常用統編暫時無法讀取，可自行填寫或留白；只檢查 8 位數字格式。';
      });
    }
    return state;
  }
  function live(s) { return current === s && !s.closed && s.dialog.isConnected && s.owner === owner(s.options); }
  function status(s, text, bad) { if (live(s)) { s.status.textContent = text; s.status.classList.toggle('is-error', !!bad); } }
  function close(force) {
    var s = current; if (!s || s.saving && !force) return;
    current = null; s.closed = true; if (s.abort) s.abort.abort(); if (s.observer) s.observer.disconnect();
    s.dialog.close(); s.dialog.remove();
    if (s.focus && s.focus.isConnected) s.focus.focus();
    if (typeof s.options.onClose === 'function') s.options.onClose();
  }
  function busy(s, value) {
    s.saving = value;
    [s.tax, s.company, s.save, s.clear, s.copy].forEach(function (node) { node.disabled = value; });
    s.close.disabled = value;
  }
  function cleanProfile(value) {
    return { buyerTaxId: taxId(value && value.buyerTaxId), companyName: String(value && value.companyName || '').slice(0, 80) };
  }
  async function load(s) {
    busy(s, true); s.saving = false; s.loading = true; s.close.disabled = false; status(s, '正在讀取常用統編…');
    try {
      var profile = cleanProfile(await request(s.api, 'GET', undefined, s.abort.signal));
      if (!live(s)) { if (current === s) close(true); return; }
      s.tax.value = taxValid(profile.buyerTaxId) ? profile.buyerTaxId : ''; s.company.value = profile.companyName;
      s.loading = false; busy(s, false); s.copy.disabled = !s.tax.value; s.retry.hidden = true;
      status(s, '可儲存常用資料，結帳時快速查看或複製統編。');
    } catch (_) {
      if (!live(s)) return;
      s.loading = false; s.saving = false; status(s, '暫時無法讀取常用統編，請重試。', true); s.close.disabled = false; s.retry.hidden = false;
    }
  }
  async function save(s, clear) {
    if (!live(s) || s.saving || s.loading) return;
    var tax = clear ? '' : taxId(s.tax.value), company = clear ? '' : s.company.value.trim();
    if (!taxValid(tax)) { status(s, '統一編號請填 8 位數字，或留白。', true); s.tax.focus(); return; }
    if (company.length > 80) { status(s, '公司或單位名稱最多 80 個字。', true); return; }
    busy(s, true); status(s, '正在儲存常用資料…');
    try {
      var result = cleanProfile(await request(s.api, 'PUT', { buyerTaxId: tax || null, companyName: company }, s.abort.signal));
      if (!live(s)) { if (current === s) close(true); return; }
      s.tax.value = result.buyerTaxId; s.company.value = result.companyName;
      status(s, clear ? '常用統編與公司名稱已清除。' : '常用統編已儲存。');
    } catch (_) { status(s, '尚未確認儲存完成，請稍後重試。', true); }
    finally { if (live(s)) { busy(s, false); s.copy.disabled = !taxValid(s.tax.value) || !taxId(s.tax.value); } }
  }
  async function copy(s) {
    if (!live(s) || s.saving || s.loading) return;
    var value = taxId(s.tax.value);
    if (!value || !taxValid(value)) { status(s, '請先填寫 8 位數字的統一編號。', true); return; }
    try {
      if (!global.navigator.clipboard || typeof global.navigator.clipboard.writeText !== 'function') throw new Error('Clipboard unavailable');
      await global.navigator.clipboard.writeText(value);
      status(s, '統一編號已複製，可在結帳時使用。');
    } catch (_) { if (live(s)) { s.tax.focus(); s.tax.select(); status(s, '已選取統一編號，請使用手機或瀏覽器的複製功能。'); } }
  }
  function open(options) {
    options = options || {}; close(); if (current) return null;
    var api = options.api || global.API, mine = owner(options);
    if (!authenticated(api) || mine === null || options.owner != null && typeof options.owner !== 'function' && id(options.owner) !== mine) return null;
    var dialog = el('dialog', null, 'billing-dialog'), s = { options: options, api: api, owner: mine, dialog: dialog, closed: false, saving: false, loading: false, abort: new AbortController(), focus: document.activeElement };
    current = s; dialog.dataset.billingProfile = ''; dialog.dataset.i18nSkip = '';
    var head = el('div', null, 'billing-dialog-head'); head.append(el('h2', '常用統一編號'));
    s.close = el('button', '關閉', 'btn'); s.close.type = 'button'; s.close.dataset.billingClose = ''; s.close.onclick = function () { close(); }; head.append(s.close); dialog.append(head);
    dialog.append(el('p', '供結帳時出示或複製，並帶入新記帳的報帳資料。這是買方統編，可隨時清除。', 'billing-help'));
    var form = el('form'); form.noValidate = true; s.tax = taxInput();
    s.company = el('input'); s.company.type = 'text'; s.company.name = 'companyName'; s.company.maxLength = 80; s.company.autocomplete = 'organization';
    form.append(label('公司或單位名稱（選填）', s.company), label('買方統一編號（報帳用，選填）', s.tax), el('p', '只檢查 8 位數字格式，未查詢政府公司資料。', 'billing-help'));
    var actions = el('div', null, 'billing-actions'); s.save = el('button', '儲存常用資料', 'btn btn--go'); s.save.type = 'submit'; s.save.dataset.billingSave = '';
    s.copy = el('button', '複製統編', 'btn'); s.copy.type = 'button'; s.copy.dataset.billingCopy = ''; s.copy.onclick = function () { copy(s); };
    s.clear = el('button', '清除常用資料', 'btn'); s.clear.type = 'button'; s.clear.dataset.billingClear = ''; s.clear.onclick = function () { save(s, true); };
    actions.append(s.save, s.copy, s.clear); form.append(actions); dialog.append(form);
    s.status = el('p', null, 'billing-status'); s.status.setAttribute('role', 'status'); s.status.setAttribute('aria-live', 'polite'); dialog.append(s.status);
    s.retry = el('button', '重試讀取', 'btn'); s.retry.type = 'button'; s.retry.dataset.billingRetry = ''; s.retry.hidden = true; s.retry.onclick = function () { load(s); }; dialog.append(s.retry);
    form.onsubmit = function (event) { event.preventDefault(); save(s, false); };
    s.tax.oninput = function () { s.copy.disabled = s.saving || !taxValid(s.tax.value) || !taxId(s.tax.value); };
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
    document.body.append(dialog); dialog.showModal();
    s.observer = new MutationObserver(function () { if (current === s && !live(s)) close(true); }); s.observer.observe(document.body, { childList: true, subtree: true });
    s.ready = load(s);
    return { dialog: dialog, ready: s.ready, close: function () { close(); } };
  }
  global.addEventListener('hashchange', function () { close(true); });
  global.addEventListener('pagehide', function () { close(true); });
  global.BillingProfile = Object.freeze({ open: open, close: close, enhanceForm: enhanceForm, values: values, valid: valid, paymentMethods: methods.map(function (entry) { return { value: entry[0], label: entry[1] }; }) });
})(window);
