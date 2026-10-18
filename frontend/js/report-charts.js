/* Shared, dependency-free report charts. Every chart keeps the complete data
   table available, including values that cannot be represented by a pie. */
(function (global) {
  'use strict';
  var sequence = 0;
  var TYPES = ['line', 'bar', 'pie', 'table'];
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function t(key, fallback) { return global.I18n && global.I18n.t ? global.I18n.t(key, fallback) : fallback; }
  function number(value, decimals) {
    var options = { minimumFractionDigits: 0, maximumFractionDigits: decimals };
    return global.I18n && global.I18n.number ? global.I18n.number(value, options) : Number(value).toLocaleString(undefined, options);
  }
  function table(rows, options, id) {
    return '<div class="report-chart__table-wrap" tabindex="0" role="region" aria-label="' + esc(t('reports.dataTable', '完整數值表')) + '"><table><caption>' + esc(options.title || t('reports.dataTable', '完整數值表')) + '</caption><thead><tr><th scope="col">' + esc(options.labelLabel || t('reports.item', '項目')) + '</th><th scope="col">' + esc(options.valueLabel || t('reports.value', '數值')) + (options.unit ? ' (' + esc(options.unit) + ')' : '') + '</th></tr></thead><tbody>' + rows.map(function (row) { return '<tr><th scope="row">' + esc(row.label) + '</th><td>' + esc(number(row.value, options.decimals)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function coordinate(value) { return Number(value).toFixed(2); }
  function cartesian(rows, type, options, id) {
    var width = 760, height = 320, left = 82, right = 22, top = 24, bottom = 68;
    var plotWidth = width - left - right, plotHeight = height - top - bottom;
    var values = rows.map(function (row) { return row.value; });
    var low = Math.min.apply(null, values), high = Math.max.apply(null, values);
    // Bars always have a true zero baseline. A line can show small changes in
    // physical measurements, while a signed series always includes zero.
    if (type === 'bar' || low <= 0 && high >= 0) { low = Math.min(0, low); high = Math.max(0, high); }
    else { var span = high - low; var margin = span ? span * .1 : Math.max(Math.abs(high) * .08, 1); low -= margin; high += margin; }
    if (high === low) { low = Math.min(0, low) - 1; high = Math.max(0, high) + 1; }
    var y = function (value) { return top + (high - value) / (high - low) * plotHeight; };
    var x = function (index) { return left + (index + .5) / rows.length * plotWidth; };
    var out = '<svg class="report-chart__svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="' + id + '-title ' + id + '-desc"><title id="' + id + '-title">' + esc(options.title || t('reports.chart', '數值圖表')) + '</title><desc id="' + id + '-desc">' + esc(t(type === 'bar' ? 'reports.barDescription' : 'reports.lineDescription', type === 'bar' ? '長條高度表示數值，負值畫在零線下方。完整數值請查看下方表格。' : '依項目順序連接實際數值；完整數值請查看下方表格。')) + '</desc>';
    for (var tick = 0; tick <= 4; tick++) {
      var value = low + (high - low) * tick / 4, tickY = y(value);
      out += '<line class="report-chart__grid" x1="' + left + '" y1="' + coordinate(tickY) + '" x2="' + (width - right) + '" y2="' + coordinate(tickY) + '"/><text class="report-chart__axis" x="' + (left - 10) + '" y="' + coordinate(tickY + 4) + '" text-anchor="end">' + esc(number(value, Math.min(options.decimals, 1))) + '</text>';
    }
    if (low <= 0 && high >= 0) out += '<line class="report-chart__zero" x1="' + left + '" y1="' + coordinate(y(0)) + '" x2="' + (width - right) + '" y2="' + coordinate(y(0)) + '"/>';
    if (type === 'line') out += '<polyline class="report-chart__line" points="' + rows.map(function (row, index) { return coordinate(x(index)) + ',' + coordinate(y(row.value)); }).join(' ') + '"/>';
    rows.forEach(function (row, index) {
      var pointX = x(index), pointY = y(row.value), title = esc(row.label + ': ' + number(row.value, options.decimals) + (options.unit ? ' ' + options.unit : ''));
      if (type === 'bar') {
        var barWidth = Math.min(44, plotWidth / rows.length * .68), zero = y(0);
        out += '<rect class="report-chart__bar' + (row.value < 0 ? ' is-negative' : '') + '" x="' + coordinate(pointX - barWidth / 2) + '" y="' + coordinate(Math.min(pointY, zero)) + '" width="' + coordinate(barWidth) + '" height="' + coordinate(Math.abs(zero - pointY)) + '" rx="2"><title>' + title + '</title></rect>';
      } else out += '<circle class="report-chart__point' + (row.value < 0 ? ' is-negative' : '') + '" cx="' + coordinate(pointX) + '" cy="' + coordinate(pointY) + '" r="4"><title>' + title + '</title></circle>';
      // A compact axis on phones; the table retains every label and value.
      var stride = Math.max(1, Math.ceil(rows.length / 7));
      if (index % stride === 0 || index === rows.length - 1) {
        var label = row.label.length > 13 ? row.label.slice(0, 12) + '…' : row.label;
        out += '<text class="report-chart__axis" x="' + coordinate(pointX) + '" y="' + (height - bottom + 23) + '" text-anchor="middle">' + esc(label) + '</text>';
      }
    });
    return out + '</svg>';
  }
  function pie(rows, options, id) {
    var positive = rows.filter(function (row) { return row.value > 0; });
    var total = positive.reduce(function (sum, row) { return sum + row.value; }, 0), angle = -Math.PI / 2, cx = 160, cy = 160, radius = 123;
    if (!total) return '<p class="report-chart__notice">' + esc(t('reports.zeroPie', '所有數值皆為零，目前沒有圓餅比例可顯示。')) + '</p>';
    var out = '<div class="report-chart__pie-layout"><svg class="report-chart__pie" viewBox="0 0 320 320" role="img" aria-labelledby="' + id + '-title ' + id + '-desc"><title id="' + id + '-title">' + esc(options.title || t('reports.chart', '數值圖表')) + '</title><desc id="' + id + '-desc">' + esc(t('reports.pieDescription', '各項數值佔合計的比例；完整數值請查看下方表格。')) + '</desc>';
    positive.forEach(function (row, index) {
      var arc = row.value / total * Math.PI * 2, end = angle + arc, color = index % 8;
      var title = esc(row.label + ': ' + number(row.value, options.decimals) + (options.unit ? ' ' + options.unit : '') + ' (' + number(row.value / total * 100, 1) + '%)');
      if (positive.length === 1) out += '<circle class="report-chart__slice report-chart__color-' + color + '" cx="160" cy="160" r="123"><title>' + title + '</title></circle>';
      else out += '<path class="report-chart__slice report-chart__color-' + color + '" d="M ' + cx + ' ' + cy + ' L ' + coordinate(cx + radius * Math.cos(angle)) + ' ' + coordinate(cy + radius * Math.sin(angle)) + ' A ' + radius + ' ' + radius + ' 0 ' + (arc > Math.PI ? 1 : 0) + ' 1 ' + coordinate(cx + radius * Math.cos(end)) + ' ' + coordinate(cy + radius * Math.sin(end)) + ' Z"><title>' + title + '</title></path>';
      angle = end;
    });
    out += '</svg><ul class="report-chart__legend">';
    positive.forEach(function (row, index) { out += '<li><span class="report-chart__swatch report-chart__color-' + index % 8 + '" aria-hidden="true"></span><span>' + esc(row.label) + '</span><strong>' + esc(number(row.value / total * 100, 1)) + '%</strong></li>'; });
    return out + '</ul></div>';
  }
  function render(root, settings) {
    if (!root) return function () {};
    var options = Object.assign({ type: 'line', decimals: 2 }, settings || {});
    options.decimals = Number.isInteger(options.decimals) ? Math.max(0, Math.min(6, options.decimals)) : 2;
    var type = TYPES.indexOf(options.type) >= 0 ? options.type : 'line';
    var source = Array.isArray(options.rows) ? options.rows : [];
    var rows = source.filter(function (row) { return row && row.value !== null && row.value !== '' && row.value !== undefined && Number.isFinite(Number(row.value)); }).map(function (row) { return { label: String(row.label == null ? '' : row.label), value: Number(row.value) }; });
    var id = 'report-chart-' + (++sequence), out = options.title ? '<h3 class="report-chart__title">' + esc(options.title) + '</h3>' : '';
    if (rows.length !== source.length) out += '<p class="report-chart__notice">' + esc(t('reports.invalidValues', '部分紀錄沒有有效數值，未繪入圖表。')) + '</p>';
    if (!rows.length) out += '<p class="report-chart__empty">' + esc(t('reports.emptyChart', '這段期間還沒有紀錄。')) + '</p>';
    else {
      var effective = type;
      if (type === 'pie' && rows.some(function (row) { return row.value < 0; })) {
        effective = 'bar';
        out += '<p class="report-chart__notice">' + esc(t('reports.negativePie', '數值含有負數，改用正負長條圖呈現；完整數值保留於表格。')) + '</p>';
      }
      if (effective === 'line' || effective === 'bar') out += cartesian(rows, effective, options, id);
      if (effective === 'pie') out += pie(rows, options, id);
      if (type === 'table') out += table(rows, options, id);
      else out += '<details class="report-chart__details"><summary>' + esc(t('reports.showTable', '查看完整數值表')) + '</summary>' + table(rows, options, id) + '</details>';
    }
    root.classList.add('report-chart'); root.dataset.reportChartInstance = id; root.innerHTML = out;
    return function () { if (root.dataset.reportChartInstance === id) { root.innerHTML = ''; delete root.dataset.reportChartInstance; root.classList.remove('report-chart'); } };
  }
  global.ReportCharts = { render: render };
})(window);
