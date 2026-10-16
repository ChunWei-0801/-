/* 國際匯率換算。真行情走 API；此頁不直接寫入帳本。 */
(function (global) {
  'use strict';

  var COMMON = ['TWD', 'USD', 'JPY', 'EUR', 'GBP', 'CNY', 'KRW', 'HKD', 'THB', 'VND'];
  var COMMON_NAMES = {
    TWD: ['新臺幣', 'New Taiwan Dollar'], USD: ['美元', 'US Dollar'],
    JPY: ['日圓', 'Japanese Yen'], EUR: ['歐元', 'Euro'], GBP: ['英鎊', 'British Pound'],
    CNY: ['人民幣', 'Chinese Yuan'], KRW: ['韓元', 'South Korean Won'],
    HKD: ['港幣', 'Hong Kong Dollar'], THB: ['泰銖', 'Thai Baht'], VND: ['越南盾', 'Vietnamese Dong']
  };
  var namesZH, namesEN;
  try {
    namesZH = new Intl.DisplayNames(['zh-Hant'], { type: 'currency' });
    namesEN = new Intl.DisplayNames(['en'], { type: 'currency' });
  } catch (e) { /* 舊版瀏覽器仍顯示貨幣代碼與常用中英名稱。 */ }

  function name(code) {
    var known = COMMON_NAMES[code];
    return known || [namesZH ? namesZH.of(code) : code, namesEN ? namesEN.of(code) : code];
  }
  function label(code) { var n = name(code); return code + ' · ' + n[0] + ' / ' + n[1]; }
  function timeLabel(value, precision) {
    if (precision === 'day') return value + '（來源提供日期，未提供精確時間）';
    var date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toLocaleString('zh-TW', { hour12: false }) + '（本機時間）';
  }
  function displayAmount(value) {
    var parts = String(value).split('.');
    return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts.length > 1 ? '.' + parts[1] : '');
  }
  function displayRate(value) {
    // Display rounding never feeds back into the Decimal API or ledger note.
    return Number(value).toLocaleString('en-US', { maximumSignificantDigits: 10, useGrouping: false });
  }
  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render(options) {
    options = options || {};
    var view = options.view || document.getElementById('view');
    if (!view) return null;
    var root = document.createElement('section');
    root.className = 'exchange-page';
    root.setAttribute('aria-labelledby', 'exchange-heading');
    root.innerHTML =
      '<div class="exchange-intro"><h2 id="exchange-heading">換算匯率 <small>Currency Converter</small></h2>' +
        '<p>旅行、海外購物或國際收支，先換算參考金額，再由你確認實際入帳金額。</p></div>' +
      '<div class="card exchange-calculator"><div class="card__h"><span class="card__t">國際貨幣換算</span>' +
        '<button type="button" class="btn btn--sm" id="exchange-refresh">重新整理匯率</button></div>' +
        '<p id="exchange-status" class="exchange-status" role="status" aria-live="polite">正在取得國際參考匯率…</p>' +
        '<p id="exchange-error" class="exchange-message exchange-message--error" role="alert" hidden></p>' +
        '<form id="exchange-form"><label class="fld" for="exchange-amount"><span>原始金額 / Amount</span>' +
          '<input id="exchange-amount" type="text" inputmode="decimal" value="100" autocomplete="off" required aria-describedby="exchange-amount-hint">' +
          '<small id="exchange-amount-hint" class="fld__h">填入 0 或正數；可含小數，例如 125.50。收支方向在記帳時選擇。</small></label>' +
          '<label class="fld exchange-search" for="exchange-search"><span>搜尋幣別 / Search currency</span>' +
          '<input id="exchange-search" type="search" placeholder="輸入 TWD、新臺幣、Japanese Yen…" autocomplete="off" aria-describedby="exchange-search-status">' +
          '<small id="exchange-search-status" class="fld__h" aria-live="polite"></small></label>' +
          '<div class="exchange-currencies"><label class="fld" for="exchange-from"><span>來源幣別 / From</span>' +
            '<select id="exchange-from" aria-label="來源幣別" required disabled></select></label>' +
            '<button class="btn exchange-swap" id="exchange-swap" type="button" title="互換來源與目標幣別" aria-label="互換來源與目標幣別" disabled>⇄ <span>互換</span></button>' +
            '<label class="fld" for="exchange-to"><span>目標幣別 / To</span><select id="exchange-to" aria-label="目標幣別" required disabled></select></label></div>' +
          '<button class="btn btn--go exchange-submit" id="exchange-submit" type="submit" disabled>換算金額</button></form>' +
        '<div id="exchange-result" class="exchange-result" aria-live="polite" aria-atomic="true" hidden></div>' +
        '<p id="exchange-warning" class="exchange-message exchange-message--warning" role="status" hidden></p>' +
        '<div id="exchange-source" class="exchange-source" hidden></div>' +
      '</div><div class="card exchange-guide"><h3>怎麼使用 / How to use</h3><ol>' +
        '<li>填入原始金額，選擇來源與目標幣別；可搜尋中英文名稱或國際代碼。</li>' +
        '<li>按「換算金額」，查看結果、資料日期和來源；按「互換」可交換幣別。</li>' +
        '<li>要記帳時，選擇目標 TWD 新臺幣，再按「帶入手動記帳」，檢查實付金額後確認新增。</li>' +
      '</ol><p class="hint">Rate 是「匯率」，Base Currency 是「基準幣別」，Last Updated 是「資料更新日期」。公開參考匯率通常每日更新；銀行、刷卡匯率及手續費可能不同。現有帳本以新臺幣 TWD 加總，換算器支援其他國際貨幣。</p></div>';
    view.replaceChildren(root);

    function $(id) { return root.querySelector('#exchange-' + id); }
    var amount = $('amount'), from = $('from'), to = $('to'), search = $('search');
    var codes = [], selectedFrom = 'USD', selectedTo = 'TWD', currentQuote = null;
    var busy = false, serial = 0;

    function alive(id) { return root.isConnected && id === serial; }
    function setBusy(value) {
      busy = value;
      $('refresh').disabled = value;
      amount.disabled = search.disabled = value;
      from.disabled = to.disabled = $('swap').disabled = $('submit').disabled = value || !codes.length;
      $('form').setAttribute('aria-busy', String(value));
    }
    function error(message) { $('error').textContent = message; $('error').hidden = !message; }
    function invalidate() { currentQuote = null; $('result').hidden = true; error(''); }
    function fillCurrencies() {
      var query = search.value.trim().toLocaleLowerCase();
      var filtered = codes.filter(function (code) { return label(code).toLocaleLowerCase().indexOf(query) >= 0; });
      function fill(select, selected) {
        var shown = filtered.slice();
        if (shown.indexOf(selected) < 0 && codes.indexOf(selected) >= 0) shown.unshift(selected);
        select.replaceChildren();
        shown.forEach(function (code) {
          var option = document.createElement('option');
          option.value = code; option.textContent = label(code); select.appendChild(option);
        });
        select.value = selected;
      }
      fill(from, selectedFrom); fill(to, selectedTo);
      $('search-status').textContent = query
        ? '找到 ' + filtered.length + ' 個符合幣別；目前選取的幣別會保留。'
        : '支援 ' + codes.length + ' 種貨幣；常用幣別列在最前面。';
    }
    function paintSource(data) {
      var container = $('source');
      container.hidden = false;
      container.replaceChildren();
      var provider = document.createElement('p');
      provider.appendChild(document.createTextNode('資料來源 / Source：'));
      var link = document.createElement('a');
      link.textContent = data.provider;
      // API fixes its providers; enforce safe schemes before creating a link.
      try {
        var url = new URL(data.sourceUrl);
        if (url.protocol === 'https:') { link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      } catch (e) { /* Keep readable provider text even if a URL is invalid. */ }
      provider.appendChild(link); container.appendChild(provider);
      var updated = document.createElement('p');
      updated.textContent = '資料更新 / Last Updated：' + timeLabel(data.updatedAt, data.updatePrecision);
      container.appendChild(updated);
      var note = document.createElement('p');
      note.textContent = '每次換算使用伺服器行情快取；重新整理最短間隔 60 秒。參考價格不包含金融機構手續費。';
      container.appendChild(note);
      $('warning').textContent = (data.stale ? '【使用較舊行情】 ' : '') + (data.warning || '');
      $('warning').hidden = !data.stale && !data.warning;
    }
    function loadRates(refresh) {
      if (busy) return;
      var id = ++serial;
      setBusy(true); invalidate();
      $('status').textContent = refresh ? '正在重新取得匯率…' : '正在取得國際參考匯率…';
      global.API.exchangeRates({ base: 'USD', refresh: !!refresh }).then(function (data) {
        if (!alive(id)) return;
        codes = Object.keys(data.rates || {}).sort(function (a, b) {
          var ai = COMMON.indexOf(a), bi = COMMON.indexOf(b);
          if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
          return a.localeCompare(b);
        });
        if (!codes.length) throw new Error('匯率來源未提供可選擇的貨幣，請稍後重新整理。');
        if (codes.indexOf(selectedFrom) < 0) selectedFrom = codes[0];
        if (codes.indexOf(selectedTo) < 0) selectedTo = codes[0];
        fillCurrencies(); paintSource(data);
        $('status').textContent = '已取得 ' + codes.length + ' 種貨幣的參考匯率。';
      }).catch(function (e) {
        if (!alive(id)) return;
        error(e.message || '目前無法取得匯率，請稍後重新整理。');
        $('status').textContent = '匯率暫時無法更新。';
      }).finally(function () { if (alive(id)) setBusy(false); });
    }
    function paintResult(quote) {
      currentQuote = quote;
      var result = $('result');
      result.hidden = false;
      result.innerHTML = '<span class="exchange-result__label">' + escape(displayAmount(quote.amount)) + ' ' + escape(quote.fromCurrency) + ' ≈</span>' +
        '<strong class="exchange-result__amount">' + escape(displayAmount(quote.convertedAmount)) + ' <small>' + escape(quote.toCurrency) + '</small></strong>' +
        '<span class="exchange-result__rate">匯率 / Rate（顯示約數）：1 ' + escape(quote.fromCurrency) + ' ≈ ' + escape(displayRate(quote.rate)) + ' ' + escape(quote.toCurrency) + '</span>' +
        '<p class="hint">結果依目標貨幣保留 ' + Number(quote.decimalPlaces) + ' 位小數，僅供估算。請以實際付款或金融機構入帳金額為準。</p>';
      if (options.onUseAmount) {
        var use = document.createElement('button');
        use.className = 'btn btn--go'; use.type = 'button'; use.id = 'exchange-use';
        if (quote.toCurrency !== 'TWD') {
          use.textContent = '改以 TWD 新臺幣換算後記帳';
          use.addEventListener('click', function () {
            selectedTo = 'TWD'; search.value = ''; fillCurrencies(); invalidate();
            $('status').textContent = '已選擇目標 TWD 新臺幣；按「換算金額」後即可帶入手動記帳。';
            $('submit').focus();
          });
        } else {
          use.textContent = '帶入手動記帳（TWD 新臺幣）';
          if (Number(quote.convertedAmount) <= 0 || Number(quote.convertedAmount) > 999999999999.99) {
            use.disabled = true;
            var why = document.createElement('p'); why.className = 'hint';
            why.textContent = '記帳金額需大於 0 且不能超過帳本支援的金額範圍。'; result.appendChild(why);
          }
          use.addEventListener('click', function () {
            if (!currentQuote) return;
            var note = '匯率換算：' + quote.amount + ' ' + quote.fromCurrency + ' → ' + quote.convertedAmount + ' TWD；1 ' +
              quote.fromCurrency + ' = ' + quote.rate + ' TWD；資料日期 ' + quote.updatedAt + '；來源 ' + quote.provider +
              (quote.stale ? '（較舊行情）' : '') + '。實際金額請依付款憑證確認。';
            options.onUseAmount({ amount: quote.convertedAmount, note: note, quote: quote });
          });
        }
        result.appendChild(use);
      }
      paintSource(quote);
    }
    $('refresh').addEventListener('click', function () { loadRates(true); });
    amount.addEventListener('input', invalidate);
    search.addEventListener('input', fillCurrencies);
    from.addEventListener('change', function () { selectedFrom = from.value; invalidate(); });
    to.addEventListener('change', function () { selectedTo = to.value; invalidate(); });
    $('swap').addEventListener('click', function () {
      var previous = selectedFrom; selectedFrom = selectedTo; selectedTo = previous;
      fillCurrencies(); invalidate(); $('status').textContent = '已互換來源與目標幣別，請重新換算。';
    });
    $('form').addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy || !codes.length) return;
      var value = amount.value.trim();
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
        error('請填入有效的 0 或正數金額，例如 100 或 125.50。'); amount.focus(); return;
      }
      var id = ++serial;
      invalidate(); setBusy(true); $('status').textContent = '正在換算金額…';
      global.API.exchangeConvert({ amount: value, fromCurrency: selectedFrom, toCurrency: selectedTo }).then(function (quote) {
        if (!alive(id)) return;
        paintResult(quote); $('status').textContent = '換算完成，請核對來源與資料日期。';
      }).catch(function (e) {
        if (!alive(id)) return;
        error(e.message || '換算暫時無法完成，請重新整理匯率後再試。');
        $('status').textContent = '換算未完成。';
      }).finally(function () { if (alive(id)) setBusy(false); });
    });
    loadRates(false);
    return root;
  }

  global.ExchangeFeature = { render: render };
})(window);
