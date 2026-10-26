/* Local statement parsing; no requests, storage, HTML execution or automatic posting.
 * parse(text, {delimiter?, headerRow?:0..50, maxRows?:1..500}) returns
 *   {headers, rows, rowNumbers, delimiter}; rowNumbers are original physical CSV lines.
 * suggest(headers) returns field -> index (-1 when missing or ambiguous).
 * normalize(rows, mapping, {rowNumbers?, kindMap?, explicitExpense?, currency?:'TWD',
 *   paymentMethod?, provider?, signedAmount?:'positive-expense'|'negative-expense',
 *   debitCreditMode?:'debit-expense'|'credit-expense', dateOrder?:'YMD'|'MDY'|'DMY'})
 * returns review drafts with positive, exact two-decimal-string amounts (or null).
 * Every draft needsReview=true. Invalid, foreign-currency, transfer, repayment,
 * top-up and refund rows are excluded by default, never removed. A duplicate is a
 * review suggestion, not proof; its canonical fingerprint is NOT a trusted server key.
 */
(function (root) {
  'use strict';
  var MAX_ROWS = 500, MAX_CHARS = 1048576, MAX_COLUMNS = 80, MAX_CELL = 4000;
  var fields = ['date','amount','kind','merchant','note','externalId','currency','buyerTaxId','debit','credit'];
  var aliases = {
    date:['日期','交易日期','消費日期','消費日','入帳日期','交易時間','date','transactiondate','purchasedate','posteddate'],
    amount:['金額','交易金額','消費金額','實付金額','付款金額','amount','transactionamount','total','金額新臺幣','交易金額新臺幣','新臺幣金額','台幣金額'],
    kind:['收支','收支別','類型','交易類型','方向','kind','type','direction'],
    merchant:['店家','商家','商店','特店名稱','商店名稱','消費店家','交易店家','交易摘要','摘要','merchant','merchantname','description'],
    note:['備註','附註','說明','note','memo','remarks','remark'],
    externalId:['交易序號','交易編號','交易代碼','參考編號','參考號碼','訂單編號','交易識別碼','transactionid','transactionno','orderid','reference','referenceid','ref'],
    currency:['幣別','幣種','交易幣別','貨幣','currency','currencycode'],
    buyerTaxId:['買方統編','買方統一編號','統一編號','統編','buyertaxid','buyerban','taxid'],
    debit:['支出金額','借方','借方金額','扣款金額','debit','debitamount','withdrawal','withdrawals'],
    credit:['收入金額','貸方','貸方金額','入款金額','credit','creditamount','deposit','deposits']
  };
  function fail(code, message) { var error = new Error(message); error.code = code; throw error; }
  function clean(value) { return value == null ? '' : String(value).normalize('NFKC').trim(); }
  function headerKey(value) { return clean(value).toLowerCase().replace(/[\s()（）:：_-]/g, ''); }
  function optionsFor(value) {
    value = value || {};
    var maxRows = value.maxRows == null ? MAX_ROWS : value.maxRows, headerRow = value.headerRow == null ? 0 : value.headerRow;
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS || !Number.isInteger(headerRow) || headerRow < 0 || headerRow > 50) fail('OPTIONS_INVALID','請選擇有效的標題列與匯入筆數上限。');
    if (value.delimiter != null && ![',','\t',';'].includes(value.delimiter)) fail('OPTIONS_INVALID','分隔符號只能選逗號、Tab 或分號。');
    return {maxRows:maxRows, headerRow:headerRow, delimiter:value.delimiter};
  }
  function tokenize(text, delimiter, limit) {
    var records = [], numbers = [], row = [], field = '', quoted = false, closed = false, line = 1, firstLine = 1;
    function pushField() {
      if (field.length > MAX_CELL) fail('CELL_LIMIT','單一欄位過長，請先移除與記帳無關的內容。');
      row.push(field); field = ''; closed = false;
      if (row.length > MAX_COLUMNS) fail('COLUMN_LIMIT','欄位超過 80 欄，請先另存只含交易明細的 CSV。');
    }
    function pushRow() {
      pushField();
      if (row.some(function (cell) { return cell.trim() !== ''; })) {
        records.push(row); numbers.push(firstLine);
        if (records.length > limit) fail('ROW_LIMIT','一次最多匯入 500 筆，請將帳單拆成較小的檔案。');
      }
      row = []; firstLine = line + 1;
    }
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { quoted = false; closed = true; }
        } else if (ch === '\r' || ch === '\n') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          field += '\n'; line++;
        } else field += ch;
      } else if (ch === delimiter) pushField();
      else if (ch === '\r' || ch === '\n') {
        pushRow(); if (ch === '\r' && text[i + 1] === '\n') i++; line++;
      } else if (closed) {
        if (!/\s/.test(ch)) fail('CSV_QUOTES','引號結束後有其他文字，請重新匯出標準 CSV。');
      } else if (ch === '"') {
        if (field !== '') fail('CSV_QUOTES','CSV 引號位置不正確，請重新匯出檔案。');
        quoted = true;
      } else field += ch;
      if (field.length > MAX_CELL) fail('CELL_LIMIT','單一欄位過長，請先移除與記帳無關的內容。');
    }
    if (quoted) fail('CSV_QUOTES','CSV 有未結束的引號，請重新匯出完整檔案。');
    if (field !== '' || row.length || closed) pushRow();
    return {records:records, numbers:numbers};
  }
  function headerDelimiters(text, headerRow) {
    var counts = {',':0,'\t':0,';':0}, quoted = false, record = 0, hasText = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') {
        if (quoted && text[i + 1] === '"') { hasText = true; i++; continue; }
        quoted = !quoted;
      } else if (!quoted && (ch === '\n' || ch === '\r')) {
        if (hasText) { if (record === headerRow) break; record++; }
        if (ch === '\r' && text[i + 1] === '\n') i++;
        hasText = false;
      } else {
        if (ch.trim() && (quoted || !Object.prototype.hasOwnProperty.call(counts,ch))) hasText = true;
        if (!quoted && record === headerRow && Object.prototype.hasOwnProperty.call(counts,ch)) counts[ch]++;
      }
    }
    return Object.keys(counts).filter(function (delimiter) { return counts[delimiter] > 0; });
  }
  function readWith(text, delimiter, options) {
    var parsed = tokenize(text, delimiter, options.headerRow + options.maxRows + 1), headers = parsed.records[options.headerRow];
    if (!headers || headers.every(function (cell) { return !cell.trim(); })) fail('HEADERS_MISSING','找不到標題列，請選擇帳單欄位名稱所在的列。');
    headers = headers.map(clean);
    var rows = parsed.records.slice(options.headerRow + 1), rowNumbers = parsed.numbers.slice(options.headerRow + 1);
    rows.forEach(function (row) { if (row.length !== headers.length) fail('COLUMN_COUNT','交易列與標題列的欄位數不同；請確認分隔符號及 CSV 格式。'); });
    return {headers:headers, rows:rows, rowNumbers:rowNumbers, delimiter:delimiter};
  }
  function parse(value, givenOptions) {
    if (typeof value !== 'string') fail('TEXT_REQUIRED','請先選擇文字編碼正確的 CSV 檔案。');
    if (value.length > MAX_CHARS) fail('FILE_LIMIT','檔案過大，請先拆成較小的 CSV。');
    if (/[\u0000\uFFFD]/.test(value)) fail('ENCODING_INVALID','檔案包含無法辨識的文字，請改選正確編碼或重新匯出 UTF-8 CSV。');
    var text = value.replace(/^\uFEFF/, ''), options = optionsFor(givenOptions);
    if (!text.trim()) fail('EMPTY_FILE','檔案沒有交易資料。');
    if (options.delimiter) return readWith(text, options.delimiter, options);
    var choices = headerDelimiters(text, options.headerRow);
    if (!choices.length) choices = [','];
    var accepted = [], errors = [];
    choices.forEach(function (delimiter) { try { accepted.push(readWith(text, delimiter, options)); } catch (error) { errors.push(error); } });
    if (accepted.length > 1) fail('DELIMITER_AMBIGUOUS','有多種可能的分隔符號，請自行選擇後再讀取。');
    if (accepted.length === 1) return accepted[0];
    throw errors[0];
  }
  function suggest(headers) {
    if (!Array.isArray(headers) || headers.length > MAX_COLUMNS) fail('HEADERS_INVALID','無法讀取欄位名稱。');
    var keys = headers.map(headerKey), mapping = {};
    fields.forEach(function (field) {
      var matches = [];
      keys.forEach(function (value,index) { if (aliases[field].some(function (alias) { return headerKey(alias) === value; })) matches.push(index); });
      mapping[field] = matches.length === 1 ? matches[0] : -1;
    });
    return mapping;
  }
  function calendarDate(value, order) {
    var text = clean(value), match, year, month, day;
    if ((match = /^(?:民國\s*)(\d{1,3})[年/.-](\d{1,2})[月/.-](\d{1,2})日?$/.exec(text))) {
      year = Number(match[1]); if (year < 1 || year > 300) return ''; year += 1911; month = Number(match[2]); day = Number(match[3]);
    } else if ((match = /^(\d{3,4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text))) {
      year = Number(match[1]); if (match[1].length === 3 && year > 0 && year <= 300) year += 1911;
      month = Number(match[2]); day = Number(match[3]);
      if (match[4] && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] || 0) > 59)) return '';
    } else if ((match = /^(\d{4})(\d{2})(\d{2})$/.exec(text))) {
      year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
    } else if ((match = /^(\d{3})(\d{2})(\d{2})$/.exec(text))) {
      year = Number(match[1]); if (year < 1 || year > 300) return ''; year += 1911;
      month = Number(match[2]); day = Number(match[3]);
    } else if (['MDY','DMY'].includes(order) && (match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text))) {
      year = Number(match[3]); month = Number(match[order === 'MDY' ? 1 : 2]); day = Number(match[order === 'MDY' ? 2 : 1]);
    } else return '';
    if (year < 1900 || year >= 9999 || month < 1 || month > 12 || day < 1 || day > 31) return '';
    var date = new Date(Date.UTC(year,month - 1,day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  }
  var currencies = {'TWD':'TWD','NTD':'TWD','NT$':'TWD','新台幣':'TWD','新臺幣':'TWD','台幣':'TWD','臺幣':'TWD','USD':'USD','US$':'USD','美元':'USD','JPY':'JPY','日圓':'JPY','日元':'JPY','円':'JPY','CNY':'CNY','RMB':'CNY','人民幣':'CNY','EUR':'EUR','歐元':'EUR','€':'EUR','HKD':'HKD','HK$':'HKD','港幣':'HKD','GBP':'GBP','英鎊':'GBP','£':'GBP'};
  function currencyValue(value) { var text = clean(value).toUpperCase(); return currencies[text] || (/^[A-Z]{3}$/.test(text) ? text : ''); }
  function moneyValue(value) {
    var text = clean(value), negative = false, embeddedCurrency = '', signSeen = false, ambiguousCurrency = false;
    if (!text) return null;
    if (/^\([^()]+\)$/.test(text)) { negative = true; signSeen = true; text = text.slice(1,-1).trim(); }
    if (/^[+-]/.test(text)) { if (signSeen) return null; signSeen = true; negative = text[0] === '-'; text = text.slice(1).trim(); }
    var prefix = /^(NT\$|TWD|NTD|US\$|USD|HK\$|HKD|JPY|CNY|RMB|EUR|GBP|\$|€|£|¥|￥)\s*/i.exec(text);
    if (prefix) { text = text.slice(prefix[0].length).trim(); ambiguousCurrency = /[¥￥]/.test(prefix[1]); embeddedCurrency = prefix[1] === '$' || ambiguousCurrency ? '' : currencyValue(prefix[1]); }
    if (/^[+-]/.test(text)) { if (signSeen) return null; negative = text[0] === '-'; text = text.slice(1).trim(); }
    if (/[元圓]$/.test(text)) text = text.slice(0,-1).trim();
    if (!/^(?:\d{1,3}(?:,\d{3})+|\d{1,20})(?:\.\d{1,2})?$/.test(text)) return null;
    var parts = text.replace(/,/g,'').split('.'), whole = parts[0].replace(/^0+(?=\d)/,''), fraction = (parts[1] || '').padEnd(2,'0');
    if (whole.length > 12) return null;
    return {amount:whole+'.'+fraction, negative:negative, currency:embeddedCurrency, ambiguousCurrency:ambiguousCurrency, zero:/^0+$/.test(whole+fraction)};
  }
  function canonical(draft, options) {
    options = options || {};
    if (!draft.date || !draft.amount || !draft.kind || !draft.currency) return '';
    var provider = clean(options.provider).toLowerCase(), method = clean(draft.paymentMethod).toLowerCase();
    return JSON.stringify(draft.externalId ? ['statement-v1','id',provider,method,clean(draft.externalId)] : ['statement-v1','content',provider,method,draft.date,draft.amount,draft.kind,draft.currency,clean(draft.merchant).replace(/\s+/g,' ').toLowerCase()]);
  }
  function normalize(rows, mapping, options) {
    options = options || {}; mapping = mapping || {};
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) fail('ROW_LIMIT','一次最多匯入 500 筆，請分批核對。');
    fields.forEach(function (field) { if (mapping[field] != null && (!Number.isInteger(mapping[field]) || mapping[field] < -1 || mapping[field] >= MAX_COLUMNS)) fail('MAPPING_INVALID','請重新選擇交易欄位。'); });
    if (options.dateOrder != null && !['YMD','MDY','DMY'].includes(options.dateOrder)) fail('OPTIONS_INVALID','請選擇有效的日期排列。');
    if (options.signedAmount != null && !['positive-expense','negative-expense'].includes(options.signedAmount)) fail('OPTIONS_INVALID','請選擇正負金額的收支方向。');
    if (options.debitCreditMode != null && !['debit-expense','credit-expense'].includes(options.debitCreditMode)) fail('OPTIONS_INVALID','請選擇借方與貸方的收支方向。');
    var seen = new Set();
    return rows.map(function (row,index) {
      if (!Array.isArray(row) || row.length > MAX_COLUMNS || row.some(function (cell) { return String(cell == null ? '' : cell).length > MAX_CELL; })) fail('ROWS_INVALID','交易欄位無法讀取，請重新選擇帳單檔案。');
      function cell(field) { var at = mapping[field]; return Number.isInteger(at) && at >= 0 ? clean(row[at]) : ''; }
      var reasons = [], date = calendarDate(cell('date'),options.dateOrder || 'YMD'), merchant = cell('merchant'), note = cell('note'), buyerTaxId = cell('buyerTaxId');
      var money = null, inferredKind = '', rawKind = cell('kind'), kindMap = options.kindMap || {}, kind = '';
      if (Object.prototype.hasOwnProperty.call(kindMap,rawKind) && ['expense','income'].includes(kindMap[rawKind])) kind = kindMap[rawKind];
      else if (/^(expense|支出)$/i.test(rawKind)) kind = 'expense';
      else if (/^(income|收入)$/i.test(rawKind)) kind = 'income';
      var split = Number.isInteger(mapping.debit) && mapping.debit >= 0 || Number.isInteger(mapping.credit) && mapping.credit >= 0;
      if (split) {
        var debitRaw = cell('debit'), creditRaw = cell('credit'), debit = debitRaw ? moneyValue(debitRaw) : null, credit = creditRaw ? moneyValue(creditRaw) : null;
        if (debitRaw && !debit || creditRaw && !credit) reasons.push('借方或貸方金額格式不正確');
        var hasDebit = debit && !debit.zero, hasCredit = credit && !credit.zero;
        if (hasDebit && hasCredit) reasons.push('同列同時有借方與貸方金額，請核對');
        else {
          money = hasDebit ? debit : hasCredit ? credit : null;
          if (!options.debitCreditMode) reasons.push('請先指定借方與貸方的收支方向');
          else if (money) inferredKind = (hasDebit ? options.debitCreditMode === 'debit-expense' : options.debitCreditMode === 'credit-expense') ? 'expense' : 'income';
        }
        if (money && money.negative) reasons.push('借方或貸方含負數，可能是沖銷，請核對');
      } else {
        money = moneyValue(cell('amount'));
        if (money && options.signedAmount) inferredKind = (money.negative ? options.signedAmount === 'negative-expense' : options.signedAmount === 'positive-expense') ? 'expense' : 'income';
        else if (money && money.negative) reasons.push('負數可能是退款或沖銷，請指定正負金額方向並核對收支');
      }
      if (!kind && inferredKind) kind = inferredKind;
      else if (kind && inferredKind && kind !== inferredKind) reasons.push('收支欄與金額方向不一致，請核對');
      if (!kind && options.explicitExpense === true && money && !money.negative && !split && !options.signedAmount) kind = 'expense';
      if (!date) reasons.push('日期格式不明或不存在，請使用年／月／日或指定日期排列');
      if (!money || money.zero) reasons.push('請提供可核對的正數金額，最多保留兩位小數');
      if (!kind) reasons.push('請指定收入或支出，不會自動推測');
      if (rawKind && !kind) reasons.push('原收支標記尚未對應');
      var rawCurrency = cell('currency'), selectedCurrency = currencyValue(options.currency || 'TWD'), currency = rawCurrency ? currencyValue(rawCurrency) : money && money.currency || selectedCurrency;
      if (money && money.ambiguousCurrency && (!rawCurrency || currency === 'TWD')) { currency = ''; reasons.push('¥ 符號無法確認原幣別，請核對原幣與新臺幣實際扣款'); }
      if (!currency) reasons.push('無法確認幣別');
      else if (currency !== 'TWD') reasons.push('外幣尚未換算為新臺幣，請依實際扣款換算後核對');
      if (money && money.currency && rawCurrency && currency !== money.currency) {
        reasons.push('金額與幣別欄不一致，請核對');
        if (money.currency !== 'TWD' && currency === 'TWD') { currency = money.currency; reasons.push('原金額含外幣，請依實際新臺幣扣款換算'); }
      }
      if (buyerTaxId && !/^\d{8}$/.test(buyerTaxId)) reasons.push('買方統一編號需為 8 位數字');
      if (merchant.length > 120) reasons.push('店家名稱超過 120 字，請縮短');
      if (note.length > 500) reasons.push('備註超過 500 字，請縮短');
      if (cell('externalId').length > 160) reasons.push('交易編號超過 160 字，請核對欄位');
      var cues = [merchant,note,rawKind].join(' '), isCard = /^(credit_card|card)$/.test(clean(options.paymentMethod));
      if (/(?:信用卡(?:帳單)?(?:繳款|還款|扣款)|繳(?:信用卡|卡費)|卡費(?:繳款|扣繳)|credit\s*card\s*(?:bill\s*)?(?:payment|repayment)|card\s*repayment)/i.test(cues) || isCard && /payment\s*(?:received|thank\s*you)|(?:^|\s)還款(?:\s|$)/i.test(cues)) reasons.push('可能是信用卡繳款／還款，預設不重複算成消費');
      else if (/(?:儲值|加值|充值|top[ -]?up)/i.test(cues)) reasons.push('可能是儲值或錢包加值，預設不重複算成消費');
      else if (/(?:轉帳|轉出|轉入|匯款|transfer)/i.test(cues) && !/(?:轉帳|匯款|交易)手續費|轉帳費|transfer\s*fee/i.test(cues)) reasons.push('可能是轉帳，請確認是否為實際消費');
      if (/(?:退款|退費|退貨|沖銷|撤銷|折讓|refund|reversal|chargeback)/i.test(cues)) reasons.push('可能是退款或沖銷，請核對收支與金額，不會自動當作收入');
      var draft = {rowIndex:Array.isArray(options.rowNumbers) && Number.isInteger(options.rowNumbers[index]) && options.rowNumbers[index] > 0 ? options.rowNumbers[index] : index + 2,date:date,amount:money && !money.zero ? money.amount : null,kind:kind,merchant:merchant,note:note,externalId:cell('externalId'),paymentMethod:clean(options.paymentMethod),buyerTaxId:buyerTaxId,currency:currency,excluded:reasons.length > 0,reason:'',needsReview:true,possibleDuplicate:false,fingerprint:''};
      draft.fingerprint = canonical(draft,options);
      if (draft.fingerprint) {
        if (seen.has(draft.fingerprint)) { draft.possibleDuplicate = true; draft.excluded = true; reasons.push('疑似重複交易，請核對是否為同一筆；此列仍保留供確認'); }
        else seen.add(draft.fingerprint);
      }
      draft.reason = reasons.join('；');
      return draft;
    });
  }
  root.StatementParser = Object.freeze({parse:parse,suggest:suggest,normalize:normalize,canonical:canonical,limits:Object.freeze({rows:MAX_ROWS,columns:MAX_COLUMNS,cellCharacters:MAX_CELL,textCharacters:MAX_CHARS})});
})(typeof window !== 'undefined' ? window : globalThis);
