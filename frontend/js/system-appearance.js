/* Device display mode is separate from the account's selected theme and photos. */
(function (global) {
  'use strict';
  var root = document.documentElement, key = 'fambudget.color-mode.v1', mode = 'system', media = null;
  try { if (global.localStorage.getItem(key) === 'theme') mode = 'theme'; } catch (_) {}
  try { if (global.matchMedia) media = global.matchMedia('(prefers-color-scheme: dark)'); } catch (_) {}

  function refresh() {
    var dark = mode === 'system' ? !!(media && media.matches) : root.getAttribute('data-theme') === 'tech';
    var scheme = dark ? 'dark' : 'light';
    root.setAttribute('data-color-mode', mode);
    root.setAttribute('data-color-scheme', scheme);
    root.style.colorScheme = scheme;
    var color = '';
    try { color = global.getComputedStyle(root).getPropertyValue(dark ? '--paper' : '--band').trim(); } catch (_) {}
    if (!color) color = dark ? '#10171f' : '#E3EEE8';
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) { meta.setAttribute('content', color); });
  }
  function setMode(value, persist) {
    if (value !== 'system' && value !== 'theme') return false;
    mode = value;
    if (persist !== false) try { global.localStorage.setItem(key, value); } catch (_) {}
    refresh();
    return true;
  }
  if (media) {
    if (typeof media.addEventListener === 'function') media.addEventListener('change', refresh);
    else if (typeof media.addListener === 'function') media.addListener(refresh);
  }
  global.addEventListener('storage', function (event) {
    if (event.key === key || event.key === null) setMode(event.newValue === 'theme' ? 'theme' : 'system', false);
  });
  global.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', refresh);
  document.addEventListener('DOMContentLoaded', refresh, { once: true });
  global.SystemAppearance = Object.freeze({ mode: function () { return mode; }, setMode: setMode, refresh: refresh });
  refresh();
})(window);
