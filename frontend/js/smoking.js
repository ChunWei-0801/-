/* Optional, account-backed smoking records. The lung color represents this
   month's logged ratio only; it does not describe a person's health. */
(function (global) {
  'use strict';
  var active = null;
  var zone = 'Asia/Taipei';

  function t(key, fallback) { return global.I18n && global.I18n.t ? global.I18n.t('smoking.' + key, fallback) : fallback; }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]; }); }
  function number(value) { return global.I18n && global.I18n.number ? global.I18n.number(value) : String(value); }
  function request(method, path, data) {
    if (!global.LifeAPI || typeof global.LifeAPI.request !== 'function') return Promise.reject(new Error(t('unavailable', '暫時無法讀取生活紀錄，請重新整理後再試。')));
    try { return Promise.resolve(global.LifeAPI.request(method, path, data)); } catch (error) { return Promise.reject(error); }
  }
  function today() {
    var parts = new Intl.DateTimeFormat('en-CA', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date());
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + '-' + values.month + '-' + values.day;
  }
  function current(ctx) { return active === ctx && ctx.root.isConnected; }
  function message(error) { return error && error.message ? error.message : t('failed', '操作未完成，請稍後再試。'); }
  function count(value) { var result = Number(value); return Number.isSafeInteger(result) && result >= 0 ? result : 0; }
  function monthLabel(month) { return month.replace('-', ' / '); }
  function dateLabel(value) {
    var date = new Date(value + 'T12:00:00+08:00');
    return global.I18n && global.I18n.date ? global.I18n.date(date, {month:'short', day:'numeric', weekday:'short', timeZone:zone}) : value.slice(5).replace('-', ' / ');
  }
  function normalized(data, month) {
    var seen = {};
    (data.days || []).forEach(function (day) {
      if (day && /^\d{4}-\d{2}-\d{2}$/.test(day.date) && day.date.slice(0, 7) === month) {
        seen[day.date] = {date:day.date, boughtPacks:count(day.boughtPacks), smokedPacks:count(day.smokedPacks)};
      }
    });
    var days = Object.keys(seen).sort().reverse().map(function (date) { return seen[date]; });
    return {month:month, days:days, totalBought:count(data.totalBought), totalSmoked:count(data.totalSmoked), monthlyLimit:count(data.monthlyLimit)};
  }
  function ratio(data) { return data.monthlyLimit > 0 ? data.totalSmoked / data.monthlyLimit : 0; }
  function notice(ctx, text, error) {
    if (!current(ctx)) return;
    ctx.notice = text || ''; ctx.error = !!error;
    var node = ctx.root.querySelector('[data-smoking-status]');
    if (node) { node.textContent = ctx.notice; node.classList.toggle('is-error', ctx.error); }
  }
  function lungs(data) {
    var percent = Math.round(ratio(data) * 100), darkness = Math.min(1, Math.max(0, ratio(data)));
    var title = data.monthlyLimit > 0 ? t('monthlyRatio', '本月吸菸紀錄比例') + ' ' + number(percent) + '%' : t('noLimit', '尚未設定');
    var left = 'M145 47C131 39 121 53 109 69C87 96 64 113 51 148C37 184 31 232 40 265C45 283 61 286 79 281L135 262C145 257 151 245 151 232L151 73C151 61 150 51 145 47Z';
    var right = 'M175 47C189 39 199 53 211 69C233 96 256 113 269 148C283 184 289 232 280 265C275 283 259 286 241 281L185 262C175 257 169 245 169 232L169 73C169 61 170 51 175 47Z';
    return '<div class="smoking-lungs" data-smoking-lungs style="--smoking-darkness:' + darkness.toFixed(4) + '" role="img" aria-label="' + esc(title) + '">' +
      '<svg viewBox="0 0 320 320" aria-hidden="true" focusable="false"><ellipse class="smoking-lungs__shadow" cx="160" cy="296" rx="110" ry="10"/>' +
      '<g class="smoking-lungs__base"><path d="' + left + '"/><path d="' + right + '"/></g>' +
      '<g class="smoking-lungs__shade"><path d="' + left + '"/><path d="' + right + '"/></g>' +
      '<g class="smoking-lungs__pulse"><path d="' + left + '"/><path d="' + right + '"/></g>' +
      '<g class="smoking-lungs__airways"><path d="M160 25V116M160 107L124 139M160 107L196 139M124 139L103 178M124 139L137 179M103 178L77 207M103 178L111 221M137 179L128 225M196 139L217 178M196 139L183 179M217 178L243 207M217 178L209 221M183 179L192 225"/></g>' +
      '<path class="smoking-lungs__trachea" d="M155 25V104M165 25V104"/></svg></div>';
  }
  function controls(ctx) {
    var date = ctx.today, data = ctx.data, day = data.days.find(function (item) { return item.date === date; }) || {boughtPacks:0, smokedPacks:0};
    if (data.month !== date.slice(0, 7)) {
      return '<section class="card smoking-today smoking-today--archive"><div class="smoking-section-title"><h2>' + esc(t('archive', '正在查看歷史月份')) + '</h2></div><p class="smoking-muted">' + esc(t('archiveHelp', '這裡保留當月的購買與吸菸紀錄。回到本月即可記錄今天。')) + '</p><button type="button" class="btn" data-smoking-action="today">' + esc(t('backToToday', '回到本月記錄今天')) + '</button></section>';
    }
    return '<section class="card smoking-today" aria-labelledby="smokingTodayTitle"><div class="smoking-section-title"><div><p class="smoking-eyebrow">' + esc(date) + '</p><h2 id="smokingTodayTitle">' + esc(t('today', '今天的紀錄')) + '</h2></div><span class="smoking-private">' + esc(t('private', '僅自己可見')) + '</span></div>' +
      '<div class="smoking-counters">' + counter('bought', day.boughtPacks, t('boughtToday', '今天買了'), t('boughtHelp', '購買的包數')) + counter('smoked', day.smokedPacks, t('smokedToday', '今天抽了'), t('smokedHelp', '實際抽的包數')) + '</div>' +
      '<p class="smoking-muted smoking-today__help">' + esc(t('separateCounts', '購買與吸菸分開記錄；每按一次增加或減少 1 包。')) + '</p></section>';
  }
  function counter(kind, value, title, help) {
    return '<div class="smoking-counter smoking-counter--' + kind + '"><h3>' + esc(title) + '</h3><p>' + esc(help) + '</p><div class="smoking-stepper">' +
      '<button type="button" data-smoking-action="' + kind + '-minus" aria-label="' + esc(title + ' ' + t('decrease', '減少 1 包')) + '"' + (value === 0 ? ' disabled' : '') + '>−</button>' +
      '<output data-smoking-count="' + kind + '" aria-label="' + esc(title) + '">' + esc(number(value)) + '<small>' + esc(t('packs', '包')) + '</small></output>' +
      '<button type="button" data-smoking-action="' + kind + '-plus" aria-label="' + esc(title + ' ' + t('increase', '增加 1 包')) + '"' + (value >= 10000 ? ' disabled' : '') + '>+</button></div></div>';
  }
  function history(ctx) {
    var data = ctx.data;
    var rows = data.days.filter(function (day) { return day.boughtPacks || day.smokedPacks; });
    return '<section class="card smoking-history" aria-labelledby="smokingHistoryTitle"><div class="smoking-section-title"><div><p class="smoking-eyebrow">' + esc(monthLabel(data.month)) + '</p><h2 id="smokingHistoryTitle">' + esc(t('dailyHistory', '每日紀錄')) + '</h2></div></div>' +
      '<div class="smoking-report-controls"><label><span>' + esc(t('reportMetric', '觀察項目')) + '</span><select data-smoking-metric><option value="smokedPacks"' + (ctx.metric === 'smokedPacks' ? ' selected' : '') + '>' + esc(t('smoked', '吸菸')) + '</option><option value="boughtPacks"' + (ctx.metric === 'boughtPacks' ? ' selected' : '') + '>' + esc(t('bought', '購買')) + '</option></select></label><label><span>' + esc(t('chartStyle', '呈現方式')) + '</span><select data-smoking-chart-type>' + ['line','bar','table'].map(function (type) { return '<option value="' + type + '"' + (ctx.chartType === type ? ' selected' : '') + '>' + esc(t(type, {line:'折線圖',bar:'長條圖',table:'資料表'}[type])) + '</option>'; }).join('') + '</select></label></div><div class="smoking-chart" data-smoking-chart></div>' +
      (rows.length ? '<div class="smoking-history__table" role="table" aria-label="' + esc(t('dailyHistory', '每日紀錄')) + '"><div class="smoking-history__row smoking-history__row--head" role="row"><span role="columnheader">' + esc(t('date', '日期')) + '</span><span role="columnheader">' + esc(t('bought', '購買')) + '</span><span role="columnheader">' + esc(t('smoked', '吸菸')) + '</span></div>' +
        rows.map(function (day) { return '<div class="smoking-history__row" role="row" data-smoking-day="' + esc(day.date) + '"><time role="cell" datetime="' + esc(day.date) + '">' + esc(dateLabel(day.date)) + '</time><span role="cell">' + esc(number(day.boughtPacks)) + '<small>' + esc(t('packs', '包')) + '</small></span><span role="cell">' + esc(number(day.smokedPacks)) + '<small>' + esc(t('packs', '包')) + '</small></span></div>'; }).join('') + '</div>' : '<p class="smoking-empty">' + esc(t('empty', '這個月份還沒有紀錄。')) + '</p>') + '</section>';
  }
  function setBusy(ctx) {
    if (!current(ctx)) return;
    var blocked = ctx.saving || ctx.loading;
    ctx.root.setAttribute('aria-busy', blocked ? 'true' : 'false');
    ctx.root.querySelectorAll('button,input,select').forEach(function (node) {
      if (node.hasAttribute('data-smoking-month') && !ctx.saving) { node.disabled = false; return; }
      node.disabled = blocked || node.dataset.smokingZero === 'true';
    });
  }
  function paint(ctx, focusedAction) {
    if (!current(ctx)) return;
    if (ctx.chartCleanup) { ctx.chartCleanup(); ctx.chartCleanup = null; }
    var data = ctx.data, actualRatio = ratio(data), percent = Math.round(actualRatio * 100);
    ctx.root.innerHTML = '<div class="page smoking-tracker"><header class="smoking-header"><div><p class="smoking-eyebrow">' + esc(t('eyebrow', '讓習慣有跡可循')) + '</p><h1>' + esc(t('title', '吸菸紀錄')) + '</h1><p>' + esc(t('intro', '分開記下買了多少、抽了多少，慢慢掌握自己的節奏。')) + '</p></div><a class="btn btn--sm" href="#/settings">' + esc(t('settings', '設定')) + '</a></header>' +
      '<p class="smoking-status' + (ctx.error ? ' is-error' : '') + '" data-smoking-status role="status" aria-live="polite">' + esc(ctx.notice) + '</p>' +
      '<section class="card smoking-overview" aria-labelledby="smokingMonthTitle"><div class="smoking-overview__visual">' + lungs(data) + '<p class="smoking-visual-note">' + esc(t('colorNote', '顏色只代表本月紀錄比例')) + '</p></div><div class="smoking-overview__details"><div class="smoking-month-heading"><h2 id="smokingMonthTitle">' + esc(t('monthOverview', '每月概況')) + '</h2><label class="smoking-month"><span class="smoking-sr-only">' + esc(t('chooseMonth', '選擇查詢月份')) + '</span><input type="month" value="' + esc(ctx.pendingMonth || data.month) + '" max="' + esc(ctx.today.slice(0, 7)) + '" data-smoking-month aria-label="' + esc(t('chooseMonth', '選擇查詢月份')) + '"></label></div>' +
      '<p class="smoking-overview__label">' + esc(t('smokedThisMonth', '本月已抽')) + '</p><div class="smoking-overview__amount"><strong data-smoking-total="smoked">' + esc(number(data.totalSmoked)) + '</strong><span>' + esc(t('packs', '包')) + '</span></div>' +
      '<div class="smoking-limit-meta"><span>' + esc(t('monthlyLimit', '每月自訂上限')) + ' <b data-smoking-limit>' + esc(number(data.monthlyLimit)) + '</b> ' + esc(t('packs', '包')) + '</span><strong>' + (data.monthlyLimit > 0 ? esc(number(percent)) + '%' : esc(t('noLimit', '尚未設定'))) + '</strong></div><progress class="smoking-progress" value="' + Math.min(1, actualRatio) + '" max="1" aria-label="' + esc(t('monthlyRatio', '本月吸菸紀錄比例')) + '">' + percent + '%</progress>' +
      '<div class="smoking-bought-total"><span>' + esc(t('boughtThisMonth', '本月已買')) + '</span><strong data-smoking-total="bought">' + esc(number(data.totalBought)) + ' <small>' + esc(t('packs', '包')) + '</small></strong></div>' +
      '<form data-smoking-settings><label for="smokingMonthlyLimit">' + esc(t('setMonthlyLimit', '調整每月上限')) + '</label><div class="smoking-limit-input"><input id="smokingMonthlyLimit" name="monthlyLimit" type="number" inputmode="numeric" min="0" max="1000000" step="1" value="' + esc(data.monthlyLimit) + '" required><span>' + esc(t('packsPerMonth', '包／月')) + '</span><button type="submit" class="btn btn--sm" data-smoking-action="save-limit">' + esc(t('save', '儲存')) + '</button></div><p class="smoking-limit-help">' + esc(t('limitHelp', '設為 0 表示尚未設定上限。每月依該月紀錄重新呈現顏色，舊紀錄會保留。')) + '</p></form></div></section>' +
      controls(ctx) + history(ctx) + '</div>';
    ctx.root.querySelectorAll('button:disabled').forEach(function (button) { button.dataset.smokingZero = 'true'; });
    setBusy(ctx);
    paintChart(ctx);
    if (focusedAction) {
      var next = ctx.root.querySelector('[data-smoking-action="' + focusedAction + '"]');
      if (next && !next.disabled) next.focus({preventScroll:true});
    }
  }
  function paintChart(ctx) {
    if (!current(ctx)) return;
    var node = ctx.root.querySelector('[data-smoking-chart]');
    if (!node) return;
    if (ctx.chartCleanup) { ctx.chartCleanup(); ctx.chartCleanup = null; }
    var rows = ctx.data.days.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).map(function (day) { return {label:day.date.slice(5), value:day[ctx.metric]}; });
    var title = monthLabel(ctx.data.month) + ' · ' + (ctx.metric === 'boughtPacks' ? t('bought', '購買') : t('smoked', '吸菸'));
    if (global.ReportCharts && typeof global.ReportCharts.render === 'function') {
      try {
        var result = global.ReportCharts.render(node, {rows:rows,type:ctx.chartType,title:title,unit:t('packs','包'),decimals:0});
        if (typeof result === 'function') ctx.chartCleanup = result;
        else if (result && typeof result.cleanup === 'function') ctx.chartCleanup = function () { result.cleanup(); };
        else if (result && typeof result.dispose === 'function') ctx.chartCleanup = function () { result.dispose(); };
        return;
      } catch (error) { /* The complete daily table below remains available. */ }
    }
    node.textContent = '';
  }
  function pulse(ctx) {
    var node = ctx.root.querySelector('[data-smoking-lungs]');
    if (!node) return;
    node.classList.remove('is-pulsing');
    global.requestAnimationFrame(function () {
      if (!current(ctx) || !node.isConnected) return;
      node.classList.add('is-pulsing');
      global.clearTimeout(ctx.pulseTimer);
      ctx.pulseTimer = global.setTimeout(function () { if (node.isConnected) node.classList.remove('is-pulsing'); }, 700);
    });
  }
  async function loadMonth(ctx, month) {
    if (!current(ctx) || ctx.saving || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > ctx.today.slice(0, 7)) return;
    var revision = ++ctx.loadRevision;
    ctx.loading = true; ctx.pendingMonth = month;
    if (ctx.data) { notice(ctx, t('loading', '正在讀取紀錄…')); setBusy(ctx); }
    try {
      var result = await request('GET', '/smoking?month=' + encodeURIComponent(month));
      if (!current(ctx) || revision !== ctx.loadRevision) return;
      ctx.data = normalized(result, month); ctx.pendingMonth = null; ctx.loading = false; ctx.notice = ''; ctx.error = false;
      paint(ctx);
    } catch (error) {
      if (!current(ctx) || revision !== ctx.loadRevision) return;
      ctx.pendingMonth = null; ctx.loading = false;
      if (ctx.data) { ctx.notice = message(error); ctx.error = true; paint(ctx); }
      else errorScreen(ctx, error);
    }
  }
  function errorScreen(ctx, error) {
    if (!current(ctx)) return;
    ctx.root.setAttribute('aria-busy', 'false');
    ctx.root.innerHTML = '<section class="card smoking-disabled"><h1>' + esc(t('unavailableTitle', '暫時無法開啟吸菸紀錄')) + '</h1><p role="alert">' + esc(message(error)) + '</p><button type="button" class="btn" data-smoking-action="retry">' + esc(t('retry', '重新讀取')) + '</button></section>';
  }
  async function changeCount(ctx, kind, step, action) {
    if (!current(ctx) || ctx.saving || ctx.loading || ctx.data.month !== ctx.today.slice(0, 7)) return;
    var liveToday = today();
    if (liveToday !== ctx.today) { ctx.today = liveToday; await loadMonth(ctx, liveToday.slice(0, 7)); return; }
    var day = ctx.data.days.find(function (entry) { return entry.date === ctx.today; }) || {date:ctx.today, boughtPacks:0, smokedPacks:0};
    var field = kind === 'bought' ? 'boughtPacks' : 'smokedPacks';
    var payload = {boughtPacks:day.boughtPacks, smokedPacks:day.smokedPacks};
    payload[field] = Math.min(10000, Math.max(0, payload[field] + step));
    if (payload[field] === day[field]) return;
    ctx.saving = true; setBusy(ctx); notice(ctx, t('saving', '正在儲存今天的紀錄…'));
    try {
      var result = await request('PUT', '/smoking/' + ctx.today, payload);
      if (!current(ctx)) return;
      var saved = result && result.date === ctx.today ? result : payload;
      var updated = {date:ctx.today, boughtPacks:count(saved.boughtPacks), smokedPacks:count(saved.smokedPacks)};
      ctx.data.totalBought += updated.boughtPacks - day.boughtPacks;
      ctx.data.totalSmoked += updated.smokedPacks - day.smokedPacks;
      ctx.data.days = ctx.data.days.filter(function (entry) { return entry.date !== ctx.today; });
      ctx.data.days.unshift(updated);
      ctx.saving = false; ctx.notice = t('saved', '今天的紀錄已儲存。'); ctx.error = false;
      paint(ctx, action);
      if (kind === 'smoked' && step > 0 && updated.smokedPacks > day.smokedPacks) pulse(ctx);
    } catch (error) { notice(ctx, message(error), true); }
    finally { if (current(ctx)) { ctx.saving = false; setBusy(ctx); } }
  }
  async function saveLimit(ctx, form) {
    if (ctx.saving || ctx.loading || !form.reportValidity()) return;
    var input = form.elements.monthlyLimit, value = Number(input.value);
    if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) { notice(ctx, t('wholeLimit', '每月上限請填入 0–1000000 的整數包數。'), true); return; }
    ctx.saving = true; setBusy(ctx); notice(ctx, t('savingLimit', '正在儲存每月上限…'));
    try {
      var result = await request('PUT', '/smoking/settings', {monthlyLimit:value});
      if (!current(ctx)) return;
      ctx.data.monthlyLimit = result && result.monthlyLimit != null ? count(result.monthlyLimit) : value;
      ctx.saving = false; ctx.notice = t('limitSaved', '每月上限已儲存。'); ctx.error = false;
      paint(ctx, 'save-limit');
    } catch (error) { notice(ctx, message(error), true); }
    finally { if (current(ctx)) { ctx.saving = false; setBusy(ctx); } }
  }
  function bind(ctx) {
    ctx.root.addEventListener('click', function (event) {
      var button = event.target.closest('[data-smoking-action]');
      if (!button || !current(ctx) || button.disabled) return;
      var action = button.dataset.smokingAction;
      if (action === 'retry') { mount(ctx.root); return; }
      if (action === 'today') { ctx.today = today(); loadMonth(ctx, ctx.today.slice(0, 7)); return; }
      var change = /^(bought|smoked)-(plus|minus)$/.exec(action);
      if (change) changeCount(ctx, change[1], change[2] === 'plus' ? 1 : -1, action);
    }, {signal:ctx.abort.signal});
    ctx.root.addEventListener('change', function (event) {
      if (current(ctx) && event.target.hasAttribute('data-smoking-month')) loadMonth(ctx, event.target.value);
      if (current(ctx) && event.target.hasAttribute('data-smoking-metric')) { ctx.metric = event.target.value === 'boughtPacks' ? 'boughtPacks' : 'smokedPacks'; paintChart(ctx); }
      if (current(ctx) && event.target.hasAttribute('data-smoking-chart-type')) { ctx.chartType = ['line','bar','table'].indexOf(event.target.value) >= 0 ? event.target.value : 'line'; paintChart(ctx); }
    }, {signal:ctx.abort.signal});
    ctx.root.addEventListener('submit', function (event) {
      if (!current(ctx) || !event.target.hasAttribute('data-smoking-settings')) return;
      event.preventDefault(); saveLimit(ctx, event.target);
    }, {signal:ctx.abort.signal});
  }
  function cleanup() {
    if (!active) return;
    active.abort.abort(); global.clearTimeout(active.pulseTimer); global.clearInterval(active.dayTimer);
    if (active.chartCleanup) active.chartCleanup();
    active.root.removeAttribute('aria-busy'); active = null;
  }
  async function mount(root) {
    cleanup();
    var ctx = {root:root, today:today(), data:null, pendingMonth:null, loadRevision:0, loading:true, saving:false, notice:'', error:false, metric:'smokedPacks',chartType:'line',chartCleanup:null,pulseTimer:null,dayTimer:null,abort:new AbortController()};
    active = ctx; bind(ctx);
    root.setAttribute('aria-busy', 'true');
    root.innerHTML = '<p class="smoking-empty" role="status">' + esc(t('loading', '正在讀取紀錄…')) + '</p>';
    try {
      var prefs = await request('GET', '/preferences');
      if (!current(ctx)) return;
      try { if (prefs.timezone) { new Intl.DateTimeFormat('en', {timeZone:prefs.timezone}).format(); zone = prefs.timezone; } } catch (error) { zone = 'Asia/Taipei'; }
      ctx.today = today();
      if (!prefs.smokingEnabled) {
        ctx.loading = false; root.setAttribute('aria-busy', 'false');
        root.innerHTML = '<section class="card smoking-disabled"><span class="smoking-disabled__icon" aria-hidden="true">◌</span><h1>' + esc(t('disabledTitle', '吸菸紀錄尚未開啟')) + '</h1><p>' + esc(t('disabledHelp', '可在設定中自行開啟；關閉功能會保留原有紀錄。')) + '</p><a class="btn btn--go" href="#/settings">' + esc(t('openSettings', '前往設定')) + '</a></section>';
        return;
      }
      await loadMonth(ctx, ctx.today.slice(0, 7));
      if (!current(ctx)) return;
      var refreshDay = function () {
        if (!current(ctx) || !ctx.data || ctx.saving || ctx.loading) return;
        var day = today(); if (day === ctx.today) return;
        var wasCurrent = ctx.data.month === ctx.today.slice(0, 7); ctx.today = day;
        if (wasCurrent) loadMonth(ctx, day.slice(0, 7));
        else paint(ctx);
      };
      ctx.dayTimer = global.setInterval(refreshDay, 60000);
      global.addEventListener('focus', refreshDay, {signal:ctx.abort.signal});
      document.addEventListener('visibilitychange', refreshDay, {signal:ctx.abort.signal});
    } catch (error) { if (current(ctx)) { ctx.loading = false; errorScreen(ctx, error); } }
  }
  global.SmokingTracker = {mount:mount, cleanup:cleanup};
})(window);
