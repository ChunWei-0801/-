/* Actual owner transactions, fetched in full before any total is displayed.
   No report is silently limited to the API's first 200 rows. */
(function (global) {
  'use strict';
  var active = [], MAX_ROWS = 20000, MAX_PAGES = 100;
  var CANCELLED = { cancelled: true };
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function t(key, fallback, values) {
    var result = global.I18n && global.I18n.t ? global.I18n.t(key, fallback) : fallback;
    return String(result).replace(/\{(\w+)\}/g, function (token, key) { return values && Object.prototype.hasOwnProperty.call(values, key) ? values[key] : token; });
  }
  function pad(value) { return String(value).padStart(2, '0'); }
  function today() { var now = new Date(); return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()); }
  function validDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    var parts = value.split('-').map(Number), date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return parts[0] >= 1900 && date.getUTCFullYear() === parts[0] && date.getUTCMonth() + 1 === parts[1] && date.getUTCDate() === parts[2];
  }
  function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
  function range(ctx) {
    var input = ctx.root.querySelector('[data-report-date]'), value = input && input.value || '';
    if (ctx.period === 'day' && validDay(value)) return { from: value, to: value };
    if (ctx.period === 'month' && /^\d{4}-\d{2}$/.test(value)) {
      var parts = value.split('-').map(Number);
      if (parts[0] >= 1900 && parts[1] >= 1 && parts[1] <= 12) return { from: value + '-01', to: value + '-' + daysInMonth(parts[0], parts[1]) };
    }
    if (ctx.period === 'year' && /^\d{4}$/.test(value) && Number(value) >= 1900) return { from: value + '-01-01', to: value + '-12-31' };
    return null;
  }
  function number(value) { var options = { maximumFractionDigits: 2 }; return global.I18n && global.I18n.number ? global.I18n.number(value, options) : Number(value).toLocaleString(undefined, options); }
  function money(value) { return 'NT$ ' + number(value); }
  function metricName(metric) { return metric === 'income' ? t('reports.income', '收入') : metric === 'net' ? t('reports.net', '收支結餘') : t('reports.expense', '支出'); }
  function option(value, text, selected) { return '<option value="' + value + '"' + (value === selected ? ' selected' : '') + '>' + esc(text) + '</option>'; }
  function preferenceKey(ctx) { return 'fambudget.report-style.' + ctx.uid; }
  function readStyle(ctx) { try { var value = global.localStorage.getItem(preferenceKey(ctx)); return ['line', 'bar', 'pie', 'table'].indexOf(value) >= 0 ? value : 'line'; } catch (error) { return 'line'; } }
  function saveStyle(ctx) { try { global.localStorage.setItem(preferenceKey(ctx), ctx.chartType); } catch (error) {} }
  function dateControl(ctx) {
    var value = ctx.date, attributes = 'type="date" min="1900-01-01" max="9999-12-31"';
    if (ctx.period === 'month') { value = value.slice(0, 7); attributes = 'type="month" min="1900-01" max="9999-12"'; }
    if (ctx.period === 'year') { value = value.slice(0, 4); attributes = 'type="number" min="1900" max="9999" step="1" inputmode="numeric"'; }
    return '<input data-report-date name="reportDate" ' + attributes + ' value="' + esc(value) + '" required aria-label="' + esc(t('reports.selectedPeriod', '報表日期')) + '">';
  }
  function renderShell(ctx) {
    ctx.root.innerHTML = '<section class="financial-reports" data-financial-reports><header class="financial-reports__header"><div><p class="financial-reports__eyebrow">' + esc(t('reports.myReport', '我的報表')) + '</p><h1>' + esc(t('reports.title', '用喜歡的方式，看懂每一天')) + '</h1><p class="financial-reports__intro">' + esc(t('reports.ownScope', '統計你自己的實際記帳金額，轉帳不列入收入與支出。')) + '</p></div><a class="btn btn--sm" href="#/stats">' + esc(t('reports.backToStats', '返回收支統計')) + '</a></header>' +
      '<form class="card financial-reports__controls" data-report-form><label class="financial-reports__field"><span>' + esc(t('reports.period', '報表週期')) + '</span><select data-report-period name="reportPeriod">' + option('day', t('reports.daily', '日報表'), ctx.period) + option('month', t('reports.monthly', '月報表'), ctx.period) + option('year', t('reports.yearly', '年報表'), ctx.period) + '</select></label><label class="financial-reports__field"><span>' + esc(t('reports.selectedPeriod', '報表日期')) + '</span><span data-report-date-slot>' + dateControl(ctx) + '</span></label><label class="financial-reports__field"><span>' + esc(t('reports.metric', '查看數值')) + '</span><select data-report-metric name="reportMetric">' + option('expense', metricName('expense'), ctx.metric) + option('income', metricName('income'), ctx.metric) + option('net', metricName('net'), ctx.metric) + '</select></label><label class="financial-reports__field"><span>' + esc(t('reports.format', '呈現方式')) + '</span><select data-report-style name="reportStyle">' + option('line', t('reports.line', '曲線圖'), ctx.chartType) + option('bar', t('reports.bar', '長條圖'), ctx.chartType) + option('pie', t('reports.pie', '圓餅圖'), ctx.chartType) + option('table', t('reports.table', '數值表'), ctx.chartType) + '</select></label><div class="financial-reports__actions"><button type="submit" class="btn btn--go" data-report-refresh>' + esc(t('reports.refresh', '更新報表')) + '</button><button type="button" class="btn" data-report-cancel hidden>' + esc(t('reports.cancel', '停止讀取')) + '</button></div></form>' +
      '<p class="financial-reports__status" data-report-status role="status" aria-live="polite"></p><p class="financial-reports__error" data-report-error role="alert" hidden></p><div data-report-summary></div><section class="card financial-reports__visual" aria-busy="false" data-report-results><div data-report-chart></div><p class="financial-reports__note" data-report-note></p></section></section>';
  }
  function available(ctx, revision) { return !ctx.disposed && ctx.revision === revision && ctx.root.isConnected; }
  function assertCurrent(ctx, revision) { if (!available(ctx, revision)) throw CANCELLED; }
  function setStatus(ctx, message, failed) {
    if (ctx.disposed || !ctx.root.isConnected) return;
    var status = ctx.root.querySelector('[data-report-status]'), error = ctx.root.querySelector('[data-report-error]');
    status.textContent = failed ? '' : message || ''; error.textContent = failed ? message || '' : ''; error.hidden = !failed;
  }
  function busy(ctx, value) {
    ctx.busy = value;
    if (ctx.disposed || !ctx.root.isConnected) return;
    ctx.root.querySelector('[data-report-cancel]').hidden = !value;
    ctx.root.querySelector('[data-report-refresh]').disabled = value;
    ctx.root.querySelector('[data-report-results]').setAttribute('aria-busy', String(value));
  }
  function clearResults(ctx) {
    if (ctx.chartCleanup) { ctx.chartCleanup(); ctx.chartCleanup = null; }
    ctx.root.querySelector('[data-report-summary]').innerHTML = '';
    ctx.root.querySelector('[data-report-chart]').innerHTML = '';
    ctx.root.querySelector('[data-report-note]').textContent = '';
  }
  async function fetchAll(ctx, selected, revision) {
    var rows = [], seen = Object.create(null), total = null;
    for (var page = 1; page <= MAX_PAGES; page++) {
      assertCurrent(ctx, revision);
      if (!global.API || typeof global.API.transactions !== 'function') throw new Error(t('reports.apiUnavailable', '記帳服務暫時無法連線，請重新整理後再試。'));
      var result = await global.API.transactions({ userId: ctx.uid, from: selected.from, to: selected.to, page: page });
      assertCurrent(ctx, revision);
      if (!result || !Array.isArray(result.transactions) || !Number.isInteger(result.total) || result.total < 0) throw new Error(t('reports.invalidResponse', '記帳資料不完整，請重新讀取。'));
      if (result.total > MAX_ROWS) throw new Error(t('reports.tooMany', '這段期間超過 20,000 筆紀錄。請選擇較短期間；目前未顯示部分資料或不完整加總。'));
      if (total !== null && total !== result.total) throw new Error(t('reports.changedDuringRead', '讀取期間記帳內容有變更，請按「更新報表」重新整理，確保加總完整。'));
      total = result.total;
      result.transactions.forEach(function (row) {
        if (!row || !row.id || String(row.user) !== ctx.uid || !validDay(row.date) || row.date < selected.from || row.date > selected.to || !Number.isFinite(row.amount) || row.amount < 0 || ['income', 'expense', 'transfer'].indexOf(row.kind) < 0) throw new Error(t('reports.invalidResponse', '記帳資料不完整，請重新讀取。'));
        if (seen[String(row.id)]) throw new Error(t('reports.changedDuringRead', '讀取期間記帳內容有變更，請按「更新報表」重新整理，確保加總完整。'));
        seen[String(row.id)] = true; rows.push(row);
      });
      if (rows.length === total) return rows;
      if (!result.transactions.length || rows.length > total || rows.length > MAX_ROWS) throw new Error(t('reports.invalidResponse', '記帳資料不完整，請重新讀取。'));
      setStatus(ctx, t('reports.progress', '正在讀取完整紀錄：{loaded} / {total} 筆…', { loaded: rows.length, total: total }));
    }
    throw new Error(t('reports.pageLimit', '這段期間需要讀取過多分頁，請縮短報表期間後再試。目前未顯示不完整加總。'));
  }
  function cents(amount) {
    var value = Math.round(amount * 100);
    if (!Number.isSafeInteger(value)) throw new Error(t('reports.amountTooLarge', '記帳金額超過可精確統計範圍，請縮短報表期間。'));
    return value;
  }
  function add(a, b) { var value = a + b; if (!Number.isSafeInteger(value)) throw new Error(t('reports.amountTooLarge', '記帳金額超過可精確統計範圍，請縮短報表期間。')); return value; }
  function aggregate(ctx) {
    var income = 0, expense = 0, count = 0, buckets = new Map();
    if (ctx.period === 'month') {
      var parts = ctx.selected.from.split('-').map(Number);
      for (var day = 1; day <= daysInMonth(parts[0], parts[1]); day++) { var date = ctx.selected.from.slice(0, 8) + pad(day); buckets.set(date, { label: date.slice(5), income: 0, expense: 0 }); }
    } else if (ctx.period === 'year') {
      for (var month = 1; month <= 12; month++) { var key = ctx.selected.from.slice(0, 4) + '-' + pad(month); buckets.set(key, { label: key, income: 0, expense: 0 }); }
    }
    ctx.transactions.forEach(function (row) {
      if (row.kind === 'transfer') return;
      var value = cents(row.amount); count++;
      if (row.kind === 'income') income = add(income, value); else expense = add(expense, value);
      var key = ctx.period === 'day' ? String(row.cat || 'uncategorized') : ctx.period === 'month' ? row.date : row.date.slice(0, 7);
      if (!buckets.has(key)) buckets.set(key, { label: String(row.catName || row.cat || t('reports.uncategorized', '未分類')), income: 0, expense: 0 });
      var bucket = buckets.get(key); bucket[row.kind] = add(bucket[row.kind], value);
    });
    var entries = Array.from(buckets.values());
    if (ctx.period === 'day') entries.sort(function (a, b) { return a.label.localeCompare(b.label); });
    var rows = entries.map(function (bucket) { return { label: bucket.label, value: (ctx.metric === 'net' ? add(bucket.income, -bucket.expense) : bucket[ctx.metric]) / 100 }; });
    return { income: income / 100, expense: expense / 100, net: add(income, -expense) / 100, count: count, rows: rows };
  }
  function fallbackChart(root, rows, title, label) {
    root.innerHTML = '<h3>' + esc(title) + '</h3><div class="financial-reports__table-wrap"><table><thead><tr><th scope="col">' + esc(label) + '</th><th scope="col">' + esc(t('reports.amount', '金額（新臺幣）')) + '</th></tr></thead><tbody>' + rows.map(function (row) { return '<tr><th scope="row">' + esc(row.label) + '</th><td>' + esc(money(row.value)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function paint(ctx) {
    if (ctx.disposed || !ctx.root.isConnected || !ctx.transactions) return;
    var data = aggregate(ctx), label = ctx.period === 'day' ? t('reports.category', '分類') : ctx.period === 'month' ? t('reports.date', '日期') : t('reports.month', '月份');
    var title = (ctx.period === 'day' ? ctx.selected.from : ctx.period === 'month' ? ctx.selected.from.slice(0, 7) : ctx.selected.from.slice(0, 4)) + ' · ' + metricName(ctx.metric);
    var summary = ctx.root.querySelector('[data-report-summary]');
    summary.innerHTML = '<dl class="financial-reports__totals">' + ['income', 'expense', 'net'].map(function (metric) { return '<div class="financial-reports__total' + (metric === 'net' && data.net < 0 ? ' is-negative' : '') + '"><dt>' + esc(metricName(metric)) + '</dt><dd>' + esc(money(data[metric])) + '</dd></div>'; }).join('') + '</dl>';
    var chart = ctx.root.querySelector('[data-report-chart]');
    if (ctx.chartCleanup) { ctx.chartCleanup(); ctx.chartCleanup = null; }
    if (global.ReportCharts && typeof global.ReportCharts.render === 'function') ctx.chartCleanup = global.ReportCharts.render(chart, { rows: data.rows, type: ctx.chartType, title: title, unit: t('reports.currency', '新臺幣'), labelLabel: label, valueLabel: metricName(ctx.metric), decimals: 2 });
    else fallbackChart(chart, data.rows, title, label);
    ctx.root.querySelector('[data-report-note]').textContent = ctx.period === 'day' ? t('reports.dailyNote', '日報表依實際記帳分類加總；曲線連接分類數值，不代表一天內的時間變化。') : ctx.period === 'month' ? t('reports.monthNote', '每一點代表當天加總；沒有記帳的日期以 0 呈現。') : t('reports.yearNote', '每一點代表當月加總；沒有記帳的月份以 0 呈現。');
    setStatus(ctx, t('reports.complete', '已完整讀取 {total} 筆紀錄，其中 {count} 筆收入／支出列入統計。', { total: ctx.transactions.length, count: data.count }));
  }
  async function load(ctx) {
    if (ctx.disposed || !ctx.root.isConnected || !ctx.uid) return;
    var selected = range(ctx), revision = ++ctx.revision;
    ctx.transactions = null; clearResults(ctx);
    if (!selected) { busy(ctx, false); setStatus(ctx, t('reports.invalidDate', '請選擇有效的報表日期。'), true); return; }
    ctx.selected = selected;
    // Preserve the selected year/month when switching report periods.
    if (ctx.period === 'day') ctx.date = selected.from;
    else if (ctx.period === 'month') ctx.date = selected.from.slice(0, 7) + '-' + pad(Math.min(Number(ctx.date.slice(8, 10)), Number(selected.to.slice(8, 10))));
    else {
      var year = Number(selected.from.slice(0, 4)), month = Number(ctx.date.slice(5, 7));
      ctx.date = String(year) + '-' + pad(month) + '-' + pad(Math.min(Number(ctx.date.slice(8, 10)), daysInMonth(year, month)));
    }
    busy(ctx, true); setStatus(ctx, t('reports.loading', '正在讀取完整記帳資料…'));
    try { var loaded = await fetchAll(ctx, selected, revision); assertCurrent(ctx, revision); ctx.transactions = loaded; paint(ctx); }
    catch (error) {
      if (available(ctx, revision) && error !== CANCELLED) { ctx.transactions = null; clearResults(ctx); setStatus(ctx, error && error.message || t('reports.loadFailed', '報表讀取失敗，請按「更新報表」重試。'), true); }
    } finally { if (available(ctx, revision)) busy(ctx, false); }
  }
  function dispose(ctx) {
    if (!ctx || ctx.disposed) return;
    ctx.disposed = true; ctx.revision++;
    ctx.listeners.forEach(function (remove) { remove(); }); ctx.listeners = [];
    if (ctx.chartCleanup) ctx.chartCleanup();
    ctx.transactions = null; active = active.filter(function (item) { return item !== ctx; });
  }
  function listen(ctx, node, event, callback) { node.addEventListener(event, callback); ctx.listeners.push(function () { node.removeEventListener(event, callback); }); }
  function mount(root, user) {
    if (!root) return function () {};
    active.filter(function (ctx) { return ctx.root === root; }).forEach(dispose);
    var ctx = { root: root, uid: null, period: 'month', date: today(), metric: 'expense', chartType: 'line', transactions: null, selected: null, listeners: [], revision: 0, disposed: false, busy: false, chartCleanup: null }; active.push(ctx);
    renderShell(ctx); setStatus(ctx, t('reports.loading', '正在讀取完整記帳資料…'));
    listen(ctx, root, 'submit', function (event) { if (event.target.matches('[data-report-form]')) { event.preventDefault(); load(ctx); } });
    listen(ctx, root, 'click', function (event) { if (event.target.closest('[data-report-cancel]')) { ctx.revision++; ctx.transactions = null; clearResults(ctx); busy(ctx, false); setStatus(ctx, t('reports.cancelled', '已停止讀取。按「更新報表」可重新讀取完整資料。')); } });
    listen(ctx, root, 'change', function (event) {
      var target = event.target;
      if (target.matches('[data-report-period]')) { ctx.period = target.value; root.querySelector('[data-report-date-slot]').innerHTML = dateControl(ctx); load(ctx); }
      else if (target.matches('[data-report-date]')) load(ctx);
      else if (target.matches('[data-report-metric]')) { ctx.metric = target.value; try { paint(ctx); } catch (error) { clearResults(ctx); setStatus(ctx, error.message, true); } }
      else if (target.matches('[data-report-style]')) { ctx.chartType = target.value; saveStyle(ctx); try { paint(ctx); } catch (error) { clearResults(ctx); setStatus(ctx, error.message, true); } }
    });
    var who;
    try { who = user || global.LifeFeatures && typeof global.LifeFeatures.user === 'function' && global.LifeFeatures.user(); } catch (error) {}
    Promise.resolve(who).then(function (value) {
      if (ctx.disposed || !root.isConnected) return;
      value = value && value.user || value;
      if (!value || value.id == null || !String(value.id) || String(value.id) === 'all') throw new Error(t('reports.signIn', '請先登入，再查看自己的報表。'));
      ctx.uid = String(value.id); ctx.chartType = readStyle(ctx); root.querySelector('[data-report-style]').value = ctx.chartType; return load(ctx);
    }).catch(function (error) { if (!ctx.disposed) { busy(ctx, false); setStatus(ctx, error.message || t('reports.loadFailed', '報表讀取失敗，請按「更新報表」重試。'), true); } });
    return function () { dispose(ctx); };
  }
  global.FinancialReports = { mount: mount, cleanup: function () { active.slice().forEach(dispose); } };
})(window);
