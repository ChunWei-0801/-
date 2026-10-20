/* FamBudget translations. UI-only: values, names, merchants and notes are never rewritten. */
(function (global) {
  'use strict';
  var LANGUAGES = [
    { code: 'zh-TW', name: '繁體中文' }, { code: 'zh-CN', name: '简体中文' },
    { code: 'en', name: 'English' }, { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' }, { code: 'es', name: 'Español' }
  ];
  var STORAGE_KEY = 'fambudget.language';
  var packs = {}, sourceKeys = {}, reverseKeys = {}, templates = [], current = 'zh-TW';
  var textState = new WeakMap(), attrState = new WeakMap();
  var observer = null, scheduled = false, serial = 0;
  var script = document.currentScript;
  var localeBase = script && script.src ? new URL('../locales/', script.src).href : 'locales/';
  var excluded = 'script,style,textarea,noscript,code,pre,[data-i18n-skip],[translate="no"],[contenteditable="true"],.ava,.me__n,.mshare__n,.txr__raw,.btbl__span';
  function supported(value) {
    value = String(value || '').replace('_', '-');
    if (/^zh(?:-|$)/i.test(value)) return /^zh-(?:CN|SG|Hans)(?:-|$)/i.test(value) ? 'zh-CN' : 'zh-TW';
    var short = value.toLowerCase().split('-')[0];
    return LANGUAGES.some(function (item) { return item.code === short; }) ? short : null;
  }
  function initialLanguage() {
    try { var saved = supported(localStorage.getItem(STORAGE_KEY)); if (saved) return saved; } catch (e) {}
    var browserLanguages = navigator.languages || [navigator.language];
    for (var i = 0; i < browserLanguages.length; i++) { var found = supported(browserLanguages[i]); if (found) return found; }
    return 'zh-TW';
  }
  current = initialLanguage();
  document.documentElement.lang = current;
  document.documentElement.setAttribute('data-language', current);
  function normalize(value) { return String(value).replace(/\s+/g, ' ').trim(); }
  function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function prepareSources(pack) {
    sourceKeys = {}; templates = [];
    Object.keys(pack.sources || {}).forEach(function (source) {
      var normalized = normalize(source), key = pack.sources[source];
      sourceKeys[normalized] = key;
      if (/\{[a-zA-Z]\w*\}/.test(normalized)) {
        var names = [], cursor = 0, expression = '^';
        normalized.replace(/\{([a-zA-Z]\w*)\}/g, function (placeholder, name, index) {
          expression += escapeRegex(normalized.slice(cursor, index));
          expression += /^(count|index|year|month|day|seconds|total|missing)$/.test(name) ? '(\\d+)' : '(.+?)';
          cursor = index + placeholder.length; names.push(name); return placeholder;
        });
        expression += escapeRegex(normalized.slice(cursor)) + '$';
        templates.push({ pattern: new RegExp(expression), names: names, key: key });
      }
    });
  }
  function interpolate(value, vars) {
    return String(value).replace(/\{([a-zA-Z]\w*)\}/g, function (whole, key) {
      return vars && Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole;
    });
  }
  function rebuildReverseKeys() {
    reverseKeys = {};
    Object.keys(packs).forEach(function (locale) {
      Object.keys(packs[locale].messages || {}).forEach(function (key) {
        var value = packs[locale].messages[key];
        if (typeof value === 'string' && !/\{[a-zA-Z]\w*\}/.test(value)) reverseKeys[normalize(value)] = key;
      });
    });
  }
  function t(key, vars) {
    // Modules can pass t('key', 'Traditional Chinese fallback') before a named key is registered.
    if (typeof vars === 'string') {
      var named = (packs[current] && packs[current].messages[key]) || (packs['zh-TW'] && packs['zh-TW'].messages[key]);
      return named || translate(vars);
    }
    var fallback = packs['zh-TW'] && packs['zh-TW'].messages[key];
    var value = (packs[current] && packs[current].messages[key]) || fallback;
    return interpolate(value == null ? key : value, vars);
  }
  function translate(value, vars) {
    var raw = String(value == null ? '' : value), normalized = normalize(raw), key = sourceKeys[normalized] || reverseKeys[normalized];
    if (key) return raw.slice(0, raw.indexOf(raw.trim())) + t(key, vars) + raw.slice(raw.trimEnd().length);
    if (vars) return interpolate(raw, vars);
    for (var i = 0; i < templates.length; i++) {
      var match = templates[i].pattern.exec(normalized);
      if (!match) continue;
      var replacements = {};
      templates[i].names.forEach(function (name, index) { replacements[name] = match[index + 1]; });
      return t(templates[i].key, replacements);
    }
    return raw;
  }
  function skip(element) { return !element || !!element.closest(excluded); }
  function applyText(node) {
    if (skip(node.parentElement) || !node.nodeValue.trim()) return;
    var previous = textState.get(node);
    var source = previous && previous.rendered === node.nodeValue ? previous.source : node.nodeValue;
    var rendered = translate(source);
    textState.set(node, { source: source, rendered: rendered });
    if (node.nodeValue !== rendered) node.nodeValue = rendered;
  }
  function applyAttributes(element) {
    if (skip(element)) return;
    var records = attrState.get(element) || {};
    ['placeholder', 'title', 'aria-label', 'alt'].forEach(function (name) {
      if (!element.hasAttribute(name)) return;
      var value = element.getAttribute(name), previous = records[name];
      var source = previous && previous.rendered === value ? previous.source : value;
      var rendered = translate(source);
      records[name] = { source: source, rendered: rendered };
      if (value !== rendered) element.setAttribute(name, rendered);
    });
    attrState.set(element, records);
  }
  function render(root) {
    if (!document.body || !packs['zh-TW']) return;
    root = root && root.nodeType === 1 ? root : document.body;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) applyText(node);
    applyAttributes(root);
    root.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(applyAttributes);
    root.querySelectorAll('[data-language-select]').forEach(function (select) { select.value = current; });
    root.querySelectorAll('[data-i18n]').forEach(function (element) {
      if (skip(element)) return;
      var rendered = t(element.getAttribute('data-i18n'));
      if (element.textContent !== rendered) element.textContent = rendered;
    });
    var titleKey = document.querySelector('meta[name="title-i18n"]');
    document.title = titleKey ? t(titleKey.content) : translate('家庭記帳與財務控管系統');
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(function () { scheduled = false; render(); });
  }
  function load(code) {
    if (packs[code]) return Promise.resolve(packs[code]);
    return fetch(localeBase + encodeURIComponent(code) + '.json', { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) throw new Error('Language file unavailable: ' + code);
      return response.json();
    }).then(function (pack) { packs[code] = pack; rebuildReverseKeys(); return pack; });
  }
  function setLanguage(code, options) {
    code = supported(code) || 'zh-TW';
    var request = ++serial;
    return Promise.all([load('zh-TW'), load(code)]).then(function (loaded) {
      if (request !== serial) return current;
      prepareSources(loaded[0]); current = code;
      try { localStorage.setItem(STORAGE_KEY, current); } catch (e) {}
      document.documentElement.lang = current;
      document.documentElement.setAttribute('data-language', current);
      render();
      if (!options || !options.silent) global.dispatchEvent(new CustomEvent('fambudget:languagechange', { detail: { language: current } }));
      return current;
    }).catch(function (error) {
      // Existing UI remains usable; never turn a financial screen blank for a language download failure.
      if (request === serial && packs['zh-TW']) { current = 'zh-TW'; prepareSources(packs['zh-TW']); document.documentElement.lang = current; render(); }
      if (global.console) console.warn(error.message);
      return current;
    });
  }
  function number(value, options) { return new Intl.NumberFormat(current, options || {}).format(value); }
  function date(value, options) {
    var parsed = value instanceof Date ? value : new Date(value);
    return isNaN(parsed.getTime()) ? String(value || '') : new Intl.DateTimeFormat(current, options || { dateStyle: 'medium' }).format(parsed);
  }
  function currency(value, code, options) {
    return number(value, Object.assign({ style: 'currency', currency: code || 'TWD' }, options || {}));
  }
  function currencyName(code) {
    try { return new Intl.DisplayNames([current], { type: 'currency' }).of(code) || code; } catch (e) { return code; }
  }
  function renderLanguageSelect() {
    return '<label class="language-control"><span data-i18n="language.label">' + t('language.label') + '</span>' +
      '<select data-language-select aria-label="' + t('language.label') + '">' + LANGUAGES.map(function (item) {
        return '<option data-i18n-skip lang="' + item.code + '" value="' + item.code + '"' + (item.code === current ? ' selected' : '') + '>' + item.name + '</option>';
      }).join('') + '</select></label>';
  }
  document.addEventListener('change', function (event) {
    if (event.target.matches && event.target.matches('[data-language-select]')) setLanguage(event.target.value);
  });
  global.I18n = {
    t: t, translate: translate, setLanguage: setLanguage, language: function () { return current; },
    number: number, date: date, currency: currency, currencyName: currencyName,
    render: render, renderLanguageSelect: renderLanguageSelect, languages: LANGUAGES.slice()
  };
  function start() {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'alt'] });
    global.I18n.ready = setLanguage(current, { silent: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})(window);
