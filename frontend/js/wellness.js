/* Private daily measurements and family birthday wishes. Health records are
   always fetched through the signed-in owner's API; none are stored locally. */
(function (global) {
  'use strict';
  var health = null, profiles = [], celebrations = [];
  var METRICS = {
    bmi: { key: 'wellness.bmi', label: 'BMI', unit: '', digits: 1 },
    weightKg: { key: 'wellness.weight', label: '體重', unit: 'kg', digits: 1 },
    heightCm: { key: 'wellness.height', label: '身高', unit: 'cm', digits: 1 }
  };
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]; }); }
  function t(key, fallback, values) {
    var value = global.I18n && global.I18n.t ? global.I18n.t(key, fallback) : fallback;
    return String(value).replace(/\{(\w+)\}/g, function (token, name) { return values && Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token; });
  }
  function request(method, path, data) {
    if (!global.LifeAPI || typeof global.LifeAPI.request !== 'function') return Promise.reject(new Error(t('wellness.unavailable', '生活資料暫時無法連線，請重新整理後再試。')));
    try { return Promise.resolve(global.LifeAPI.request(method, path, data)); } catch (error) { return Promise.reject(error); }
  }
  function errorText(error) { return error && error.message || t('wellness.failed', '未能完成操作，請稍後再試。'); }
  function today() {
    var now = new Date(), preferences = global.LifeFeatures && typeof global.LifeFeatures.prefs === 'function' ? global.LifeFeatures.prefs() : null;
    if (preferences && preferences.timezone) {
      try {
        var parts = new Intl.DateTimeFormat('en-CA', {timeZone:preferences.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now), values = {};
        parts.forEach(function (part) { values[part.type] = part.value; }); return values.year + '-' + values.month + '-' + values.day;
      } catch (error) { /* Invalid client preferences cannot prevent recording. */ }
    }
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    var parts = value.split('-').map(Number), date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0] && date.getUTCMonth() + 1 === parts[1] && date.getUTCDate() === parts[2];
  }
  function numeric(value) { return value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null; }
  function bmi(height, weight) { return height > 0 && weight > 0 ? weight / Math.pow(height / 100, 2) : null; }
  function number(value, digits) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    var options = { minimumFractionDigits: digits == null ? 1 : digits, maximumFractionDigits: digits == null ? 1 : digits };
    return global.I18n && global.I18n.number ? global.I18n.number(Number(value), options) : Number(value).toLocaleString(undefined, options);
  }
  function option(value, label, current) { return '<option value="' + esc(value) + '"' + (String(value) === String(current) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function cleanRecords(data) {
    return (data && Array.isArray(data.records) ? data.records : []).map(function (item) {
      var date = String(item.date || '').slice(0, 10), height = numeric(item.heightCm), weight = numeric(item.weightKg), measuredBmi = numeric(item.bmi);
      return { date: date, heightCm: height, weightKg: weight, bmi: measuredBmi == null ? bmi(height, weight) : measuredBmi };
    }).filter(function (item) { return validDate(item.date); }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  }
  function listen(ctx, node, event, callback) { node.addEventListener(event, callback); ctx.listeners.push(function () { node.removeEventListener(event, callback); }); }
  function dispose(ctx) {
    if (!ctx || ctx.disposed) return;
    ctx.disposed = true; ctx.revision = (ctx.revision || 0) + 1;
    (ctx.listeners || []).forEach(function (remove) { remove(); }); ctx.listeners = [];
    if (ctx.timer) global.clearTimeout(ctx.timer);
    if (ctx.chartCleanup) { try { ctx.chartCleanup(); } catch (error) {} ctx.chartCleanup = null; }
    if (ctx.banner) ctx.banner.remove();
  }
  function status(ctx, text, failed) {
    if (!ctx || ctx.disposed || !ctx.root.isConnected) return;
    var node = ctx.root.querySelector('[data-wellness-status]');
    if (node) { node.textContent = text || ''; node.classList.toggle('is-error', !!failed); }
  }

  function profileHTML(preferences) {
    var date = preferences && validDate(preferences.birthDate) ? preferences.birthDate : '';
    return '<section class="card wellness-profile" data-wellness-profile><h2>' + esc(t('wellness.birthdayTitle', '生日與生活紀錄')) + '</h2>' +
      '<form data-wellness-birth-form><label class="wellness-field"><span>' + esc(t('wellness.fullBirthDate', '完整生日（年／月／日）')) + '</span>' +
      '<input name="birthDate" type="date" min="1900-01-01" max="' + today() + '" value="' + esc(date) + '" autocomplete="bday" data-wellness-birth-date></label>' +
      '<p class="wellness-help">' + esc(t('wellness.birthdayPrivacy', '生日當天，與你共用家庭的成員會看到姓名與生日祝福；提醒不會顯示出生年份。留白可移除生日。')) + '</p>' +
      '<button type="submit" class="btn btn--go">' + esc(t('wellness.saveBirthday', '儲存生日')) + '</button></form>' +
      '<p class="wellness-status" data-wellness-status role="status" aria-live="polite"></p><a class="wellness-health-link" href="#/health">' + esc(t('wellness.openHealth', '查看我的身高、體重與 BMI 紀錄 →')) + '</a></section>';
  }
  function bindProfile(root, preferences) {
    var section = root && root.matches && root.matches('[data-wellness-profile]') ? root : root && root.querySelector('[data-wellness-profile]');
    if (!section) return function () {};
    profiles.filter(function (item) { return item.root === section; }).forEach(dispose);
    var ctx = { root: section, listeners: [], revision: 0, disposed: false, busy: false }; profiles.push(ctx);
    var form = section.querySelector('[data-wellness-birth-form]'), input = section.querySelector('[data-wellness-birth-date]');
    if (preferences) input.value = validDate(preferences.birthDate) ? preferences.birthDate : '';
    listen(ctx, form, 'submit', async function (event) {
      event.preventDefault(); event.stopPropagation();
      if (ctx.busy || !form.reportValidity()) return;
      var value = input.value;
      if (value && (!validDate(value) || value < '1900-01-01' || value > today())) { status(ctx, t('wellness.invalidBirthday', '請填寫有效生日，且日期不能晚於今天。'), true); return; }
      ctx.busy = true; form.querySelector('button').disabled = true; input.disabled = true;
      status(ctx, t('wellness.savingBirthday', '正在儲存生日…'));
      try {
        await request('PUT', '/preferences', { birthDate: value || null });
        if (!ctx.disposed) { status(ctx, t('wellness.birthdaySaved', '生日已儲存。')); global.dispatchEvent(new CustomEvent('fambudget:lifestylechange', { detail: { section: 'birthDate' } })); }
      } catch (error) { status(ctx, errorText(error), true); }
      finally { ctx.busy = false; if (!ctx.disposed) { form.querySelector('button').disabled = false; input.disabled = false; } }
    });
    return function () { dispose(ctx); };
  }
  function mountProfile(root, preferences) {
    if (!root) return function () {};
    var section = root.querySelector('[data-wellness-profile]');
    if (!section) {
      var holder = document.createElement('div'); holder.innerHTML = profileHTML(preferences); section = holder.firstElementChild;
      // A caller may pass the old profile form. Keep this independent form outside it.
      if (root.tagName === 'FORM') root.insertAdjacentElement('afterend', section);
      else (root.querySelector('[data-wellness-profile-slot]') || root).appendChild(section);
    }
    var unbind = bindProfile(section, preferences), ctx = profiles[profiles.length - 1];
    if (!preferences) {
      var input = section.querySelector('[data-wellness-birth-date]'), button = section.querySelector('button[type="submit"]'); input.disabled = true; button.disabled = true; ctx.busy = true;
      status(ctx, t('wellness.loadingBirthday', '正在讀取生日…'));
      request('GET', '/preferences').then(function (data) {
        if (ctx.disposed || !section.isConnected) return;
        input.value = data && validDate(data.birthDate) ? data.birthDate : ''; status(ctx, '');
      }).catch(function (error) { status(ctx, errorText(error), true); }).finally(function () { if (!ctx.disposed) { input.disabled = false; button.disabled = false; ctx.busy = false; } });
    }
    return unbind;
  }

  function celebrate(root, options) {
    if (!root) return function () {};
    celebrations.filter(function (item) { return item.root === root; }).forEach(dispose);
    var ctx = { root: root, listeners: [], disposed: false, revision: 0 }, date = options && options.date || today(); celebrations.push(ctx);
    if (!validDate(date)) return function () { dispose(ctx); };
    // Let the server use the account timezone unless a caller explicitly supplies a date.
    request('GET', '/birthdays' + (options && options.date ? '?date=' + encodeURIComponent(date) : '')).then(function (data) {
      if (ctx.disposed || !root.isConnected) return;
      var members = data && Array.isArray(data.members) ? data.members : [];
      if (!members.length) return;
      var banner = document.createElement('section'); banner.className = 'wellness-birthday'; banner.dataset.wellnessBirthday = '';
      banner.setAttribute('role', 'region'); banner.setAttribute('aria-label', t('wellness.birthdayBanner', '家庭生日祝福'));
      banner.innerHTML = '<span class="wellness-birthday__icon" aria-hidden="true">🎂</span><div class="wellness-birthday__message"><p class="wellness-eyebrow">' + esc(t('wellness.todayCelebration', '今天值得一起慶祝')) + '</p><h2>' + esc(t('wellness.happyBirthday', '生日快樂！')) + '</h2><p>' +
        members.map(function (member) { return '<strong data-i18n-skip>' + esc(member.displayName || t('wellness.familyMember', '家人')) + '</strong>' + (member.isSelf ? '<span class="wellness-self">' + esc(t('wellness.you', '你')) + '</span>' : ''); }).join('<span aria-hidden="true">、</span>') +
        '</p><p class="wellness-birthday__wish">' + esc(t('wellness.birthdayWish', '願今天有喜歡的蛋糕，也有家人滿滿的祝福。')) + '</p></div><button type="button" class="wellness-birthday__close" data-wellness-birthday-dismiss aria-label="' + esc(t('wellness.dismissBirthday', '關閉今天的生日提醒')) + '">×</button>';
      ctx.banner = banner; root.insertBefore(banner, root.firstChild);
      listen(ctx, banner.querySelector('[data-wellness-birthday-dismiss]'), 'click', function () { dispose(ctx); });
      if (!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        var confetti = document.createElement('div'); confetti.className = 'wellness-confetti'; confetti.setAttribute('aria-hidden', 'true');
        for (var i = 0; i < 24; i++) { var piece = document.createElement('i'); piece.style.cssText = '--x:' + ((i * 37) % 100) + '%;--drift:' + ((i % 2 ? 1 : -1) * (20 + i % 35)) + 'px;--delay:' + (i % 7 * 0.07) + 's;--turn:' + (i * 43 % 360) + 'deg;--color:' + ['#1b6b5a', '#d4a84b', '#76b3a1', '#dd916c'][i % 4]; confetti.appendChild(piece); }
        banner.appendChild(confetti); ctx.timer = global.setTimeout(function () { confetti.remove(); ctx.timer = null; }, 3200);
      }
    }).catch(function () { /* A birthday enhancement must not block the financial dashboard. */ });
    return function () { dispose(ctx); };
  }

  function metricName(key) { var metric = METRICS[key] || METRICS.bmi; return t(metric.key, metric.label); }
  function healthHTML(ctx) {
    return '<div class="page wellness" data-wellness><section class="card wellness-intro"><p class="wellness-eebrow">' + esc(t('wellness.personal', '我的生活與健康')) + '</p><h2>' + esc(t('wellness.title', '記下身體的日常變化')) + '</h2><p>' + esc(t('wellness.healthPrivacy', '身高、體重與 BMI 僅供你本人查看，不會顯示在家人的帳本或報表。')) + '</p></section>' +
      '<div class="wellness-top"><section class="card wellness-entry"><h2>' + esc(t('wellness.dailyEntry', '每日身高與體重')) + '</h2><form data-wellness-record-form><fieldset><div class="wellness-form-grid"><label class="wellness-field wellness-field--date"><span>' + esc(t('wellness.recordDate', '紀錄日期')) + '</span><input name="date" type="date" min="1900-01-01" max="' + ctx.today + '" value="' + ctx.today + '" required data-wellness-date></label>' +
      '<label class="wellness-field"><span>' + esc(t('wellness.heightCm', '身高（cm）')) + '</span><input name="heightCm" type="number" min="0.01" max="300" step="0.01" inputmode="decimal" required data-wellness-height></label><label class="wellness-field"><span>' + esc(t('wellness.weightKg', '體重（kg）')) + '</span><input name="weightKg" type="number" min="0.01" max="1000" step="0.01" inputmode="decimal" required data-wellness-weight></label></div>' +
      '<div class="wellness-bmi-preview"><span>' + esc(t('wellness.bmiPreview', '這次的 BMI')) + '</span><output data-wellness-bmi aria-live="polite">—</output><small>' + esc(t('wellness.bmiFormula', '體重（kg）÷ 身高（m）²')) + '</small></div><p class="wellness-help" data-wellness-edit-note></p>' +
      '<div class="wellness-actions"><button class="btn btn--go" type="submit" data-wellness-save>' + esc(t('wellness.saveRecord', '儲存這天的紀錄')) + '</button><button class="btn" type="button" data-wellness-cancel hidden>' + esc(t('wellness.cancelEdit', '取消編輯')) + '</button></div></fieldset></form></section>' +
      '<aside class="card wellness-overview"><h2>' + esc(t('wellness.selectedSummary', '所選期間概況')) + '</h2><div data-wellness-summary></div><p class="wellness-help">' + esc(t('wellness.onePerDay', '每天保留一筆紀錄。可補記過去日期，也能從歷史紀錄修改或刪除。')) + '</p><a href="#/profile" class="wellness-health-link">' + esc(t('wellness.profileLink', '回到個人資料與生日設定 →')) + '</a></aside></div>' +
      '<p class="wellness-status" data-wellness-status role="status" aria-live="polite"></p><section class="card wellness-report"><div class="wellness-section-head"><div><p class="wellness-eyebrow">' + esc(t('wellness.trends', '讓每次紀錄看得見')) + '</p><h2>' + esc(t('wellness.report', '健康月報與年報')) + '</h2></div></div>' +
      '<div class="wellness-controls"><label class="wellness-field"><span>' + esc(t('wellness.reportPeriod', '報表期間')) + '</span><select data-wellness-period>' + option('month', t('wellness.monthlyDaily', '月報：每日紀錄'), 'month') + option('year', t('wellness.yearlyMonthly', '年報：每月平均'), 'month') + '</select></label>' +
      '<label class="wellness-field"><span>' + esc(t('wellness.reportYear', '報表年份')) + '</span><input type="number" min="1900" max="' + ctx.today.slice(0, 4) + '" step="1" value="' + ctx.year + '" data-wellness-year></label>' +
      '<label class="wellness-field" data-wellness-month-label><span>' + esc(t('wellness.reportMonth', '月份')) + '</span><select data-wellness-month>' + Array.from({ length: 12 }, function (_, index) { return option(index + 1, t('wellness.monthNumber', '{month} 月', { month: index + 1 }), ctx.month); }).join('') + '</select></label>' +
      '<label class="wellness-field"><span>' + esc(t('wellness.metric', '觀察項目')) + '</span><select data-wellness-metric>' + Object.keys(METRICS).map(function (key) { return option(key, metricName(key), 'bmi'); }).join('') + '</select></label>' +
      '<label class="wellness-field"><span>' + esc(t('wellness.chartStyle', '圖表樣式')) + '</span><select data-wellness-chart-type>' + option('line', t('wellness.line', '折線圖'), 'line') + option('bar', t('wellness.bar', '長條圖'), 'line') + option('table', t('wellness.table', '資料表'), 'line') + '</select></label></div>' +
      '<div class="wellness-chart" data-wellness-chart></div><p class="wellness-help" data-wellness-report-note></p></section>' +
      '<section class="card wellness-history-section"><div class="wellness-section-head"><h2>' + esc(t('wellness.history', '歷史紀錄')) + '</h2><span class="wellness-count" data-wellness-count></span></div><div data-wellness-history></div><button class="btn wellness-more" type="button" data-wellness-more hidden>' + esc(t('wellness.moreRecords', '顯示更多紀錄')) + '</button></section></div>';
  }
  function currentRecords(ctx) { var prefix = String(ctx.year) + (ctx.period === 'month' ? '-' + String(ctx.month).padStart(2, '0') : ''); return ctx.records.filter(function (record) { return record.date.indexOf(prefix) === 0; }); }
  function average(records, key) { var values = records.map(function (record) { return numeric(record[key]); }).filter(function (value) { return value != null; }); return values.length ? values.reduce(function (total, value) { return total + value; }, 0) / values.length : null; }
  function rowsFor(ctx, records) {
    if (ctx.period === 'month') return records.filter(function (record) { return record[ctx.metric] != null; }).map(function (record) { return { label: record.date.slice(5), value: record[ctx.metric] }; });
    var rows = [];
    for (var month = 1; month <= 12; month++) { var prefix = ctx.year + '-' + String(month).padStart(2, '0'), group = records.filter(function (record) { return record.date.indexOf(prefix) === 0; }), value = average(group, ctx.metric); if (value != null) rows.push({ label: t('wellness.monthNumber', '{month} 月', { month: month }), value: value }); }
    return rows;
  }
  function fallbackChart(root, rows, title, metric) {
    root.innerHTML = '<h3>' + esc(title) + '</h3>' + (rows.length ? '<div class="wellness-table-wrap"><table><caption class="wellness-sr-only">' + esc(title) + '</caption><thead><tr><th scope="col">' + esc(t('wellness.date', '日期')) + '</th><th scope="col">' + esc(metricName(metric)) + '</th></tr></thead><tbody>' + rows.map(function (row) { return '<tr><th scope="row">' + esc(row.label) + '</th><td>' + esc(number(row.value)) + (METRICS[metric].unit ? ' ' + METRICS[metric].unit : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="wellness-empty">' + esc(t('wellness.noRecords', '這段期間還沒有健康紀錄。先記下一天，就能開始觀察變化。')) + '</p>');
  }
  function paintReport(ctx) {
    if (ctx.disposed || !ctx.root.isConnected) return;
    var records = currentRecords(ctx), rows = rowsFor(ctx, records), root = ctx.root.querySelector('[data-wellness-chart]');
    var period = ctx.period === 'month' ? ctx.year + ' / ' + String(ctx.month).padStart(2, '0') : String(ctx.year);
    var title = period + ' · ' + metricName(ctx.metric), latest = records[records.length - 1];
    ctx.root.querySelector('[data-wellness-month-label]').hidden = ctx.period === 'year';
    ctx.root.querySelector('[data-wellness-summary]').innerHTML = '<dl class="wellness-totals"><div><dt>' + esc(t('wellness.recordedDays', '已記錄天數')) + '</dt><dd>' + records.length + '</dd></div><div><dt>' + esc(t('wellness.latestBmi', '最近一次 BMI')) + '</dt><dd>' + esc(number(latest && latest.bmi)) + '</dd></div><div><dt>' + esc(t('wellness.averageMetric', '平均 {metric}', { metric: metricName(ctx.metric) })) + '</dt><dd>' + esc(number(average(records, ctx.metric))) + (METRICS[ctx.metric].unit ? '<small>' + METRICS[ctx.metric].unit + '</small>' : '') + '</dd></div></dl>';
    ctx.root.querySelector('[data-wellness-report-note]').textContent = ctx.period === 'year' ? t('wellness.yearlyNote', '每個月份以當月所有紀錄的平均值呈現；沒有紀錄的月份不補零。') : t('wellness.monthlyNote', '依日期顯示每天的實際紀錄；沒有紀錄的日期不補零。');
    if (ctx.chartCleanup) { try { ctx.chartCleanup(); } catch (error) {} ctx.chartCleanup = null; }
    if (global.ReportCharts && typeof global.ReportCharts.render === 'function') {
      try {
        var result = global.ReportCharts.render(root, { rows: rows, type: ctx.chartType, title: title, unit: METRICS[ctx.metric].unit, valueLabel: metricName(ctx.metric), labelLabel: t('wellness.date', '日期'), decimals: 1 });
        if (typeof result === 'function') ctx.chartCleanup = result;
        else if (result && typeof result.dispose === 'function') ctx.chartCleanup = function () { result.dispose(); };
        else if (result && typeof result.cleanup === 'function') ctx.chartCleanup = function () { result.cleanup(); };
      } catch (error) { fallbackChart(root, rows, title, ctx.metric); }
    } else fallbackChart(root, rows, title, ctx.metric);
    paintHistory(ctx, records);
  }
  function paintHistory(ctx, records) {
    records = records || currentRecords(ctx); var display = records.slice().reverse().slice(0, ctx.limit), root = ctx.root.querySelector('[data-wellness-history]');
    ctx.root.querySelector('[data-wellness-count]').textContent = t('wellness.recordCount', '{count} 筆', { count: records.length });
    root.innerHTML = display.length ? '<ol class="wellness-history">' + display.map(function (record) {
      return '<li data-wellness-record="' + esc(record.date) + '"><div class="wellness-history__date"><time datetime="' + esc(record.date) + '" data-i18n-skip>' + esc(record.date) + '</time></div><dl>' + ['heightCm', 'weightKg', 'bmi'].map(function (key) { return '<div><dt>' + esc(metricName(key)) + '</dt><dd>' + esc(number(record[key])) + (METRICS[key].unit ? '<small>' + METRICS[key].unit + '</small>' : '') + '</dd></div>'; }).join('') + '</dl><div class="wellness-history__actions"><button type="button" class="btn btn--sm" data-wellness-edit="' + esc(record.date) + '"' + (ctx.busy ? ' disabled' : '') + '>' + esc(t('wellness.edit', '編輯')) + '</button><button type="button" class="btn btn--sm wellness-delete" data-wellness-delete="' + esc(record.date) + '"' + (ctx.busy ? ' disabled' : '') + '>' + esc(t('wellness.delete', '刪除')) + '</button></div></li>';
    }).join('') + '</ol>' : '<p class="wellness-empty">' + esc(t('wellness.emptyHistory', '所選期間沒有紀錄。可在上方填寫日期、身高與體重。')) + '</p>';
    ctx.root.querySelector('[data-wellness-more]').hidden = records.length <= ctx.limit;
  }
  function preview(ctx) {
    var height = Number(ctx.root.querySelector('[data-wellness-height]').value), weight = Number(ctx.root.querySelector('[data-wellness-weight]').value);
    ctx.root.querySelector('[data-wellness-bmi]').textContent = number(bmi(height, weight));
    ctx.root.querySelector('[data-wellness-edit-note]').textContent = ctx.editingDate ? t('wellness.editingDate', '正在編輯 {date}。更改日期後，這筆紀錄會移至新日期。', { date: ctx.editingDate }) : '';
    ctx.root.querySelector('[data-wellness-cancel]').hidden = !ctx.editingDate;
  }
  function fillForm(ctx, record) {
    ctx.editingDate = record ? record.date : null;
    ctx.root.querySelector('[data-wellness-date]').value = record ? record.date : ctx.today;
    ctx.root.querySelector('[data-wellness-height]').value = record && record.heightCm != null ? record.heightCm : '';
    ctx.root.querySelector('[data-wellness-weight]').value = record && record.weightKg != null ? record.weightKg : '';
    preview(ctx);
  }
  function busy(ctx, value) {
    ctx.busy = value; ctx.root.querySelector('[data-wellness-record-form] fieldset').disabled = value;
    ctx.root.querySelectorAll('[data-wellness-edit],[data-wellness-delete]').forEach(function (button) { button.disabled = value; });
  }
  async function load(ctx, success) {
    var revision = ++ctx.revision, year = ctx.year;
    ctx.root.querySelector('[data-wellness-chart]').setAttribute('aria-busy', 'true'); status(ctx, t('wellness.loading', '正在讀取健康紀錄…'));
    try {
      var data = await request('GET', '/health?year=' + encodeURIComponent(year));
      if (ctx.disposed || revision !== ctx.revision || !ctx.root.isConnected) return;
      ctx.records = cleanRecords(data); paintReport(ctx);
      if (!ctx.initialized && !ctx.formTouched) { var current = ctx.records.find(function (record) { return record.date === ctx.today; }); if (current) fillForm(ctx, current); else { var latest = ctx.records[ctx.records.length - 1]; if (latest && latest.heightCm) ctx.root.querySelector('[data-wellness-height]').value = latest.heightCm; } ctx.initialized = true; }
      status(ctx, success || '');
    } catch (error) { if (!ctx.disposed && revision === ctx.revision) { ctx.records = []; paintReport(ctx); status(ctx, errorText(error), true); } }
    finally { if (!ctx.disposed && revision === ctx.revision) ctx.root.querySelector('[data-wellness-chart]').setAttribute('aria-busy', 'false'); }
  }
  async function saveRecord(ctx, form) {
    if (ctx.busy || !form.reportValidity()) return;
    var date = ctx.root.querySelector('[data-wellness-date]').value, height = numeric(ctx.root.querySelector('[data-wellness-height]').value), weight = numeric(ctx.root.querySelector('[data-wellness-weight]').value), original = ctx.editingDate;
    if (!validDate(date) || date < '1900-01-01' || date > ctx.today || height <= 0 || height > 300 || weight <= 0 || weight > 1000 || height == null || weight == null) { status(ctx, t('wellness.invalidMeasurement', '請填寫有效日期；身高與體重需大於 0，身高不超過 300 cm、體重不超過 1000 kg。'), true); return; }
    busy(ctx, true); var saved = false;
    try {
      if (original && original !== date) {
        var destination = ctx.records;
        if (Number(date.slice(0, 4)) !== ctx.year) destination = cleanRecords(await request('GET', '/health?year=' + date.slice(0, 4) + '&month=' + Number(date.slice(5, 7))));
        if (ctx.disposed || !ctx.root.isConnected) return;
        if (destination.some(function (record) { return record.date === date; }) && !global.confirm(t('wellness.confirmOverwrite', '{date} 已有健康紀錄。移動後會覆蓋該日資料，是否繼續？', { date: date }))) return;
      }
      status(ctx, t('wellness.saving', '正在儲存健康紀錄…'));
      await request('PUT', '/health/' + encodeURIComponent(date), { heightCm: height, weightKg: weight }); saved = true;
      if (ctx.disposed || !ctx.root.isConnected) return;
      if (original && original !== date) await request('DELETE', '/health/' + encodeURIComponent(original));
      if (ctx.disposed) return;
      ctx.year = Number(date.slice(0, 4)); ctx.month = Number(date.slice(5, 7)); ctx.limit = 20;
      ctx.root.querySelector('[data-wellness-year]').value = ctx.year; ctx.root.querySelector('[data-wellness-month]').value = ctx.month;
      fillForm(ctx, { date: date, heightCm: height, weightKg: weight });
      await load(ctx, t('wellness.saved', '{date} 的健康紀錄已儲存。', { date: date }));
    } catch (error) {
      if (saved && original && original !== date) { await load(ctx); status(ctx, t('wellness.movePartial', '新日期已儲存，但原日期尚未移除；兩筆都會保留。請核對後再刪除原日期。') + ' ' + errorText(error), true); }
      else status(ctx, errorText(error), true);
    } finally { if (!ctx.disposed) busy(ctx, false); }
  }
  function mount(root, options) {
    if (health) dispose(health);
    if (!root) return function () {};
    var date = options && options.date || today(); if (!validDate(date)) date = today();
    var ctx = { root: root, today: date, year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), period: 'month', metric: 'bmi', chartType: 'line', records: [], limit: 20, listeners: [], revision: 0, disposed: false, busy: false, editingDate: null, formTouched: false, initialized: false };
    health = ctx; root.innerHTML = healthHTML(ctx); paintReport(ctx); preview(ctx);
    listen(ctx, root, 'submit', function (event) { if (event.target.matches('[data-wellness-record-form]')) { event.preventDefault(); event.stopPropagation(); saveRecord(ctx, event.target); } });
    listen(ctx, root, 'input', function (event) { if (event.target.matches('[data-wellness-height],[data-wellness-weight],[data-wellness-date]')) { ctx.formTouched = true; preview(ctx); } });
    listen(ctx, root, 'change', function (event) {
      var input = event.target;
      if (input.hasAttribute('data-wellness-year')) {
        var year = Number(input.value); if (!Number.isInteger(year) || year < 1900 || year > Number(ctx.today.slice(0, 4))) { input.value = ctx.year; return; }
        ctx.year = year; ctx.limit = 20; load(ctx); return;
      }
      if (input.hasAttribute('data-wellness-period')) ctx.period = input.value === 'year' ? 'year' : 'month';
      else if (input.hasAttribute('data-wellness-month')) ctx.month = Math.max(1, Math.min(12, Number(input.value)));
      else if (input.hasAttribute('data-wellness-metric')) ctx.metric = METRICS[input.value] ? input.value : 'bmi';
      else if (input.hasAttribute('data-wellness-chart-type')) ctx.chartType = ['line', 'bar', 'table'].indexOf(input.value) >= 0 ? input.value : 'line';
      else return;
      ctx.limit = 20; paintReport(ctx);
    });
    listen(ctx, root, 'click', async function (event) {
      var button = event.target.closest('button'); if (!button || !root.contains(button)) return;
      if (button.hasAttribute('data-wellness-cancel')) { fillForm(ctx, null); ctx.formTouched = false; status(ctx, ''); return; }
      if (button.hasAttribute('data-wellness-more')) { ctx.limit += 20; paintHistory(ctx); return; }
      if (ctx.busy) return;
      if (button.hasAttribute('data-wellness-edit')) {
        var record = ctx.records.find(function (item) { return item.date === button.dataset.wellnessEdit; });
        if (record) { fillForm(ctx, record); ctx.formTouched = true; var form = root.querySelector('[data-wellness-record-form]'); form.scrollIntoView({ block: 'center', behavior: global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); root.querySelector('[data-wellness-date]').focus({ preventScroll: true }); }
      }
      if (button.hasAttribute('data-wellness-delete')) {
        var date = button.dataset.wellnessDelete;
        if (!validDate(date) || !global.confirm(t('wellness.confirmDelete', '確定刪除 {date} 的健康紀錄？', { date: date }))) return;
        busy(ctx, true); status(ctx, t('wellness.deleting', '正在刪除這天的紀錄…'));
        try { await request('DELETE', '/health/' + encodeURIComponent(date)); if (ctx.disposed) return; if (ctx.editingDate === date) fillForm(ctx, null); await load(ctx, t('wellness.deleted', '{date} 的健康紀錄已刪除。', { date: date })); }
        catch (error) { status(ctx, errorText(error), true); }
        finally { if (!ctx.disposed) busy(ctx, false); }
      }
    });
    load(ctx);
    return function () { dispose(ctx); if (health === ctx) health = null; };
  }
  function cleanup() { if (health) dispose(health); health = null; profiles.forEach(dispose); profiles = []; celebrations.forEach(dispose); celebrations = []; }
  global.Wellness = { mount: mount, mountProfile: mountProfile, profileHTML: profileHTML, bindProfile: bindProfile, celebrate: celebrate, cleanup: cleanup };
})(window);
