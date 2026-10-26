/* Monthly reports are opt-in. Google scheduling is installed by the owner, not by this page.
 * The downloaded script contains no access token; its token stays in private Script Properties.
 */
(function (global) {
  'use strict';
  var current = null, canonicalOrigin = 'https://fambudget-recovery-20261017.onrender.com';
  function delivery(value) { return /^(email|drive|both)$/.test(value || '') ? value : 'email'; }
  function exportURL(value) {
    var url;
    try { url = new URL(value); } catch (_) { throw new Error('月報網址格式不正確。'); }
    var ownOrigin = global.location && global.location.protocol === 'https:' ? global.location.origin : canonicalOrigin;
    if (url.protocol !== 'https:' || ![canonicalOrigin, ownOrigin].includes(url.origin) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/monthly-reports/export') throw new Error('自動月報需使用此網站的 HTTPS 月報網址。');
    return url.href;
  }

  function generateScript(options) {
    options = options || {};
    var channel = delivery(options.delivery), url = exportURL(options.exportUrl || canonicalOrigin + '/api/monthly-reports/export');
    var parts = [
      '/* 家庭記帳免費月報：請先在「專案設定 → 指令碼屬性」設定網址與專用金鑰。',
      ' * 請自行閱讀 Google 權限並執行 installMonthlyReport；下載這個檔案不會啟用寄送。',
      ' * 免費額度與實際執行時間依 Google 政策；此檔不含你的讀取金鑰。 */',
      'var FAMBUDGET_EXPECTED_EXPORT_URL = ' + JSON.stringify(url) + ';',
      'var FAMBUDGET_INSTALLED_DELIVERY = ' + JSON.stringify(channel) + ';',
      'var FAMBUDGET_TIMEZONE = "Asia/Taipei";',
      safeError.toString(), configured.toString(), reportPeriod.toString(), readReport.toString(), validReport.toString(), stateKey.toString(), loadState.toString(), saveState.toString(), reportBlobs.toString(),
      installMonthlyReport.toString(), removeMonthlyReport.toString(), resetUncertainMonthlyReport.toString()
    ];
    if (channel === 'drive' || channel === 'both') parts.push(storeFiles.toString());
    if (channel === 'email' || channel === 'both') parts.push(sendReport.toString());
    parts.push(runMonthlyReport.toString().replace('/* DRIVE_DELIVERY */', channel === 'drive' || channel === 'both' ? 'storeFiles(report, blobs, properties, key, state);' : '').replace('/* EMAIL_DELIVERY */', channel === 'email' || channel === 'both' ? 'sendReport(report, blobs, properties, key, state);' : ''));
    return parts.join('\n\n') + '\n';
  }

  // These functions are serialized into the standalone Google Apps Script.
  function safeError(message) { var error = new Error(message); error.fambudgetSafe = true; return error; }
  function configured() {
    var properties = PropertiesService.getScriptProperties(), url = properties.getProperty('FAMBUDGET_REPORT_URL'), token = properties.getProperty('FAMBUDGET_REPORT_TOKEN');
    if (url !== FAMBUDGET_EXPECTED_EXPORT_URL || !token || !/^[A-Za-z0-9_-]{40,160}$/.test(token)) throw safeError('請在指令碼屬性設定正確的 FAMBUDGET_REPORT_URL 與 FAMBUDGET_REPORT_TOKEN。金鑰不可放進網址。');
    return { properties: properties, url: url, token: token };
  }
  function reportPeriod() {
    var current = Utilities.formatDate(new Date(), FAMBUDGET_TIMEZONE, 'yyyy-MM').split('-'), year = Number(current[0]), month = Number(current[1]) - 1;
    if (month === 0) { month = 12; year--; }
    return String(year) + '-' + String(month).padStart(2, '0');
  }
  function readReport(config, period) {
    var response;
    for (var attempt = 0; attempt < 6; attempt++) {
      try { response = UrlFetchApp.fetch(config.url + '?period=' + encodeURIComponent(period), { method: 'get', headers: { Authorization: 'Bearer ' + config.token }, followRedirects: false, muteHttpExceptions: true, validateHttpsCertificates: true }); }
      catch (_) { if (attempt < 5) { Utilities.sleep([1500, 4000, 15000, 20000, 25000][attempt]); continue; } throw safeError('無法取得月報。請稍後重試，或檢查網站與專用金鑰；本次沒有傳送月報。'); }
      var code = response.getResponseCode();
      if ([429, 502, 503, 504].indexOf(code) >= 0 && attempt < 5) { Utilities.sleep([1500, 4000, 15000, 20000, 25000][attempt]); continue; }
      if (code !== 200) throw safeError(code === 401 || code === 403 ? '月報讀取授權已停用、到期或信箱已變更。請回家庭記帳重新建立設定。' : '網站暫時無法提供月報；本次沒有傳送，請稍後重試。');
      break;
    }
    var text = response.getContentText();
    if (typeof text !== 'string' || text.length > 18000000) throw safeError('月報資料超出可處理範圍，未傳送任何檔案。');
    var report;
    try { report = JSON.parse(text); } catch (_) { throw safeError('月報格式不正確，沒有傳送任何檔案。'); }
    validReport(report, period);
    return report;
  }
  function validReport(report, period) {
    if (!report || report.version !== 1 || report.period !== period || report.timezone !== FAMBUDGET_TIMEZONE || report.delivery !== FAMBUDGET_INSTALLED_DELIVERY || !report.totals || !Array.isArray(report.transactions) || report.transactions.length > 20000 || typeof report.csv !== 'string' || typeof report.html !== 'string' || report.csv.length > 12000000 || report.html.length > 12000000 || typeof report.recipientEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(report.recipientEmail) || report.recipientEmail.length > 254 || report.folderId && !/^[A-Za-z0-9_-]{10,200}$/.test(report.folderId)) throw safeError('月報內容或寄送選擇已變更，請回家庭記帳重新下載相同寄送方式的程式。');
  }
  function stateKey(report) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, FAMBUDGET_EXPECTED_EXPORT_URL + '|' + report.recipientEmail.toLowerCase());
    var suffix = bytes.map(function (value) { return ('0' + (value & 255).toString(16)).slice(-2); }).join('').slice(0, 24);
    return 'FAMBUDGET_STATE_' + suffix + '_' + report.period;
  }
  function loadState(properties, key) {
    var raw = properties.getProperty(key);
    if (!raw) return { version: 1, drive: 'pending', email: 'pending' };
    var state;
    try { state = JSON.parse(raw); } catch (_) { throw safeError('保存的月報狀態無法核對。請先檢查信箱與雲端紀錄，不要直接重新傳送。'); }
    if (!state || state.version !== 1 || !['pending', 'attempting', 'uncertain', 'done'].includes(state.drive) || !['pending', 'attempting', 'uncertain', 'sent'].includes(state.email)) throw safeError('月報狀態無法核對。請先檢查信箱與雲端紀錄。');
    return state;
  }
  function saveState(properties, key, state) {
    try { properties.setProperty(key, JSON.stringify(state)); } catch (_) { throw safeError('無法保存月報傳送狀態。請先檢查信箱與雲端紀錄，避免重複傳送。'); }
  }
  function reportBlobs(report) {
    try {
      var prefix = 'FamBudget-' + report.period;
      return { pdf: Utilities.newBlob(report.html, 'text/html', prefix + '.html').getAs('application/pdf').setName(prefix + '.pdf'), csv: Utilities.newBlob(report.csv, 'text/csv; charset=utf-8', prefix + '.csv') };
    } catch (_) { throw safeError('月報檔案尚未產生，沒有傳送。請稍後再試。'); }
  }
  function installMonthlyReport() {
    try {
      configured();
      var triggers = ScriptApp.getProjectTriggers();
      // Create the replacement first; retain the old trigger if creation fails.
      var trigger = ScriptApp.newTrigger('runMonthlyReport').timeBased().onMonthDay(1).atHour(9).inTimezone(FAMBUDGET_TIMEZONE).create();
      triggers.forEach(function (old) { if (old.getHandlerFunction() === 'runMonthlyReport') ScriptApp.deleteTrigger(old); });
      return { installed: true, timezone: FAMBUDGET_TIMEZONE, day: 1, approximateHour: 9 };
    } catch (error) { if (error.fambudgetSafe) throw error; throw safeError('Google 排程尚未完成。請核對授權並查看執行紀錄；建立排程不會立即寄送月報。'); }
  }
  function removeMonthlyReport() {
    try { ScriptApp.getProjectTriggers().forEach(function (trigger) { if (trigger.getHandlerFunction() === 'runMonthlyReport') ScriptApp.deleteTrigger(trigger); }); return { removed: true }; }
    catch (_) { throw safeError('Google 排程未能停用，請到「觸發條件」手動刪除 runMonthlyReport。'); }
  }
  function storeFiles(report, blobs, properties, key, state) {
    if (state.drive === 'done') return;
    if (state.drive === 'attempting' || state.drive === 'uncertain') throw safeError('上次雲端保存結果未能確認。請先查看 Drive，確認後才手動解除暫停。');
    state.drive = 'attempting'; saveState(properties, key, state);
    try {
      var folderKey = key.replace(/_\d{4}-\d{2}$/, '') + '_FOLDER', folderId = report.folderId || properties.getProperty(folderKey), folder;
      if (folderId) folder = DriveApp.getFolderById(folderId);
      else {
        var name = '家庭記帳月報-' + folderKey.slice(16, 28), found = DriveApp.getFoldersByName(name);
        folder = found.hasNext() ? found.next() : DriveApp.createFolder(name);
        if (found.hasNext()) throw safeError('找到多個同名月報資料夾，請在家庭記帳指定私人資料夾。');
        properties.setProperty(folderKey, folder.getId());
      }
      ['pdf', 'csv'].forEach(function (type) {
        if (state[type + 'Id']) { DriveApp.getFileById(state[type + 'Id']); return; }
        var blob = blobs[type], files = folder.getFilesByName(blob.getName()), file = files.hasNext() ? files.next() : folder.createFile(blob);
        if (files.hasNext()) throw safeError('找到重複的月報檔案，請先在 Drive 核對後再處理。');
        state[type + 'Id'] = file.getId(); saveState(properties, key, state);
      });
      state.drive = 'done'; saveState(properties, key, state);
    } catch (_) { state.drive = 'uncertain'; saveState(properties, key, state); throw safeError('雲端保存結果未能確認。請先查看 Drive，這個月份不會自動再次上傳。'); }
  }
  function sendReport(report, blobs, properties, key, state) {
    if (state.email === 'sent') return;
    if (state.email === 'attempting' || state.email === 'uncertain') throw safeError('上次寄送結果未能確認。請先查看收件匣，確認未收到後才手動解除暫停。');
    if (MailApp.getRemainingDailyQuota() < 1) throw safeError('Google 今日寄送額度不足，尚未寄送。請稍後手動執行 runMonthlyReport。');
    state.email = 'attempting'; saveState(properties, key, state);
    try {
      MailApp.sendEmail({ to: report.recipientEmail, subject: '家庭記帳 ' + report.period + ' 月報', body: '附件為你已授權的個人收支月報（PDF 與 CSV）。報表不等於完整資料庫備份。', attachments: [blobs.pdf, blobs.csv] });
      state.email = 'sent'; saveState(properties, key, state);
    } catch (_) { state.email = 'uncertain'; saveState(properties, key, state); throw safeError('寄送結果未能確認。請先查看收件匣，這個月份不會自動再次寄送。'); }
  }
  function runMonthlyReport() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw safeError('另一個月報工作正在執行，請稍後再試。');
    try {
      var config = configured(), period = reportPeriod(), report = readReport(config, period), properties = config.properties, key = stateKey(report), state = loadState(properties, key);
      var needsDrive = FAMBUDGET_INSTALLED_DELIVERY !== 'email', needsEmail = FAMBUDGET_INSTALLED_DELIVERY !== 'drive';
      if ((!needsDrive || state.drive === 'done') && (!needsEmail || state.email === 'sent')) return { period: period, status: 'already-complete' };
      var blobs = reportBlobs(report);
      /* DRIVE_DELIVERY */
      /* EMAIL_DELIVERY */
      return { period: period, status: 'complete' };
    } catch (error) { if (error.fambudgetSafe) throw error; throw safeError('月報尚未完成。請查看 Google 執行紀錄與授權設定；不要直接重複傳送結果不明的月份。'); }
    finally { lock.releaseLock(); }
  }
  function resetUncertainMonthlyReport() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw safeError('另一個月報工作正在執行。');
    try {
      var config = configured(), period = reportPeriod();
      if (config.properties.getProperty('FAMBUDGET_CONFIRM_RETRY') !== period) throw safeError('先確認該月份未收到／未完成，再將指令碼屬性 FAMBUDGET_CONFIRM_RETRY 設為該月份 YYYY-MM。');
      var report = readReport(config, period), key = stateKey(report), state = loadState(config.properties, key);
      if (state.drive === 'uncertain' || state.drive === 'attempting') state.drive = 'pending';
      if (state.email === 'uncertain' || state.email === 'attempting') state.email = 'pending';
      saveState(config.properties, key, state); config.properties.deleteProperty('FAMBUDGET_CONFIRM_RETRY');
      return { period: period, retryAllowed: true };
    } catch (error) { if (error.fambudgetSafe) throw error; throw safeError('尚未解除暫停，請核對月報紀錄與設定。'); }
    finally { lock.releaseLock(); }
  }

  function el(tag, text, cls) { var node = document.createElement(tag); if (text != null) node.textContent = String(text); if (cls) node.className = cls; return node; }
  function button(text, action, primary) { var node = el('button', text, 'btn' + (primary ? ' btn--go' : '')); node.type = 'button'; node.dataset.monthlyAction = action; return node; }
  function field(text, node) { var label = el('label', null, 'monthly-field'); label.append(el('span', text), node); return label; }
  function status(s, text, bad) { if (alive(s)) { s.status.textContent = text; s.status.classList.toggle('is-error', !!bad); } }
  function alive(s) {
    if (current !== s || s.closed || !s.dialog.isConnected) return false;
    if (global.LifeFeatures && typeof global.LifeFeatures.user === 'function') { var user = global.LifeFeatures.user(); return !!user && String(user.id) === s.owner; }
    return true;
  }
  function clearPack(s) { s.token = ''; s.pack.replaceChildren(); s.pack.hidden = true; }
  function close() { var s = current; if (!s) return; s.closed = true; clearPack(s); current = null; s.dialog.close(); s.dialog.remove(); if (s.focus && s.focus.isConnected) s.focus.focus(); }
  function request(s, method, path, body) {
    if (!alive(s) || s.api.mode !== 'http' || typeof s.api.request !== 'function') return Promise.reject(new Error('請登入已連接資料庫的網站後再設定月報。'));
    return s.api.request('/api/monthly-reports/' + path, { method: method, body: body });
  }
  function loadSettings(s, settings) {
    if (!alive(s)) return;
    s.settings = settings; s.enabled.checked = settings.enabled === true; s.channel.value = delivery(settings.delivery); s.folder.value = settings.folderId || ''; s.email.value = settings.recipientEmail || ''; s.terms.checked = false;
    s.revoke.disabled = !settings.authorizationActive && !settings.enabled;
    s.submit.disabled = !settings.recipientVerified;
    s.folderWrap.hidden = s.channel.value === 'email';
    s.summary.textContent = settings.authorizationActive ? '個人月報讀取授權有效。Google 端是否已安裝排程，請到 Apps Script 的觸發條件確認。' : settings.enabled ? '已保存月報選擇，請建立或更新讀取金鑰，再到 Google 端安裝排程。' : '目前尚未啟用定期月報。';
    if (!settings.recipientVerified) status(s, '請先驗證個人信箱，再啟用每月報表。', true);
  }
  async function copy(s, text, fallback) {
    try { if (!global.navigator.clipboard || !global.navigator.clipboard.writeText) throw new Error('clipboard'); await global.navigator.clipboard.writeText(text); if (alive(s)) status(s, '已複製。請只貼到你自己的 Google 指令碼設定。'); }
    catch (_) { if (alive(s)) { fallback.focus(); fallback.select(); status(s, '請在已選取的欄位使用複製。'); } }
  }
  function showPack(s, result) {
    var url = exportURL(result.exportUrl), code = generateScript({ delivery: result.settings.delivery, exportUrl: url });
    if (!/^[A-Za-z0-9_-]{40,160}$/.test(result.token || '')) throw new Error('月報讀取金鑰格式不正確，請重新建立。');
    clearPack(s); s.token = result.token; s.pack.hidden = false;
    s.pack.append(el('h3', '完成 Google 端設定，才會自動寄送'), el('p', '專用金鑰只在這次視窗顯示。關閉後若未保存，需重新建立；新金鑰會讓舊排程的金鑰失效。請勿分享金鑰。', 'monthly-help'));
    [['FAMBUDGET_REPORT_URL', url], ['FAMBUDGET_REPORT_TOKEN', result.token]].forEach(function (pair) {
      var input = el('input'); input.type = pair[0].endsWith('TOKEN') ? 'password' : 'text'; input.readOnly = true; input.value = pair[1]; input.autocomplete = 'off'; input.dataset.monthlyProperty = pair[0];
      var row = el('div', null, 'monthly-copy-row'), copyButton = button('複製', 'copy'); copyButton.onclick = function () { copy(s, input.value, input); }; row.append(field(pair[0], input), copyButton); s.pack.append(row);
    });
    if (result.settings.tokenExpiresAt) s.pack.append(el('p', '讀取授權到期：' + new Date(result.settings.tokenExpiresAt).toLocaleDateString('zh-TW'), 'monthly-help'));
    var script = el('textarea'); script.readOnly = true; script.rows = 7; script.value = code; script.dataset.monthlyScript = ''; script.setAttribute('aria-label', 'Google Apps Script 程式（不含金鑰）');
    var actions = el('div', null, 'monthly-actions'), download = button('下載月報程式（.gs）', 'download', true), copyCode = button('複製程式', 'copy-script');
    download.onclick = function () { if (!alive(s)) return; var blob = new Blob([code], { type: 'text/plain;charset=utf-8' }), object = URL.createObjectURL(blob), link = el('a'); link.href = object; link.download = 'FamBudget-Monthly.gs'; link.click(); setTimeout(function () { URL.revokeObjectURL(object); }, 1000); status(s, '程式已提供下載；請繼續完成下方 Google 設定。'); };
    copyCode.onclick = function () { copy(s, code, script); }; actions.append(download, copyCode); s.pack.append(actions, script);
    var steps = el('ol', null, 'monthly-steps');
    ['開啟 Google Apps Script，登入自己的 Google 帳號，按「新增專案」。', '將上方程式貼到編輯器，取代預設的空白程式並儲存。', '進入左側「專案設定」→「指令碼屬性」，新增上方兩個名稱及對應內容。金鑰只貼到這裡，不要放進程式或網址。', '回到編輯器，選擇 installMonthlyReport，按「執行」，閱讀並同意需要的 Google 權限。此步只建立排程，不會立即寄送。', '在「觸發條件」確認 runMonthlyReport。預定每月 1 日臺灣時間上午 9 點附近處理上個月；Google 的實際執行時間與免費額度可能調整。', '如需立即取得上個月月報，可自行在 Google 執行 runMonthlyReport；這會實際寄信或存入雲端。已完成的月份會略過。'].forEach(function (text) { steps.append(el('li', text)); });
    var open = el('a', '開啟 Google Apps Script', 'btn'); open.href = 'https://script.google.com/home/start'; open.target = '_blank'; open.rel = 'noopener noreferrer'; s.pack.append(open, steps, el('p', '月報包含本人的 PDF 與 CSV 收支報表，不是整個系統或照片的完整備份。iCloud 可使用下載後的「儲存到檔案」。', 'monthly-help'));
    var recovery = el('details'); recovery.append(el('summary', '寄送結果不明或需要停用時'));
    recovery.append(el('p', '若程式顯示結果未能確認，先檢查收件匣與 Drive，確定該月份未完成後，才把指令碼屬性 FAMBUDGET_CONFIRM_RETRY 設為該月份（YYYY-MM），手動執行 resetUncertainMonthlyReport，再執行 runMonthlyReport。已確認完成的寄送不會重設。要停用可在此撤銷授權，並到 Google 執行 removeMonthlyReport 或刪除觸發條件。', 'monthly-help')); s.pack.append(recovery);
  }
  async function submit(s) {
    if (!alive(s) || s.busy) return;
    var mode = delivery(s.channel.value), folder = s.folder.value.trim();
    if (folder && mode !== 'email' && !/^[A-Za-z0-9_-]{10,200}$/.test(folder)) { status(s, '請輸入 Google Drive 資料夾 ID，或留白建立自己的月報資料夾。', true); return; }
    if (s.enabled.checked && !s.terms.checked) { status(s, '請先閱讀並勾選月報讀取授權說明。', true); s.terms.focus(); return; }
    s.busy = true; s.submit.disabled = s.revoke.disabled = true; clearPack(s); status(s, '正在保存月報選擇…');
    var body = { enabled: s.enabled.checked, delivery: mode, folderId: mode === 'email' ? null : folder || null, recipientEmail: '', termsAccepted: s.terms.checked };
    try {
      var result = await request(s, body.enabled ? 'POST' : 'PUT', body.enabled ? 'authorize' : 'settings', body);
      if (!alive(s)) return;
      loadSettings(s, body.enabled ? result.settings : result);
      if (body.enabled) { showPack(s, result); status(s, '讀取授權已建立。請完成 Google 端安裝與授權，才會開始定期寄送。'); }
      else status(s, '已停用個人月報讀取。Google 端的舊觸發條件可另行刪除。');
    } catch (error) { if (alive(s)) status(s, error && error.message || '月報設定未完成，請稍後重試。', true); }
    finally { if (alive(s)) { s.busy = false; s.submit.disabled = !s.settings || !s.settings.recipientVerified; s.revoke.disabled = !s.settings || !s.settings.authorizationActive && !s.settings.enabled; } }
  }
  function open(options) {
    options = options || {}; close();
    var api = options.api || global.API, owner = options.owner && typeof options.owner === 'object' ? options.owner.id : options.owner;
    if (!api || api.mode !== 'http' || typeof api.request !== 'function' || owner == null) { if (global.FamBudgetUI) global.FamBudgetUI.toast('請登入已連接資料庫的網站後再設定月報。', 'err'); return null; }
    var dialog = el('dialog', null, 'life-dialog monthly-report-dialog'), s = { api: api, owner: String(owner), dialog: dialog, closed: false, busy: false, token: '', settings: null, focus: document.activeElement }; current = s;
    dialog.dataset.monthlyReport = ''; dialog.dataset.i18nSkip = '';
    var header = el('div', null, 'monthly-header'), heading = el('h2', '每月報表與雲端保存'), closeButton = button('關閉', 'close'); heading.id = 'monthly-report-title'; dialog.setAttribute('aria-labelledby', heading.id); closeButton.onclick = close; header.append(heading, closeButton);
    dialog.append(header, el('p', '選擇寄送到已驗證的個人信箱、自己的 Google Drive，或兩者。未另選時預設信箱。採免費 Google 排程，需自行安裝並授權，關閉網站後仍由 Google 執行。', 'monthly-help'));
    s.summary = el('p', '正在讀取目前設定…', 'monthly-summary'); dialog.append(s.summary);
    var form = el('form'); form.dataset.monthlyForm = ''; s.enabled = el('input'); s.enabled.type = 'checkbox'; s.enabled.name = 'enabled'; form.append(field('我要啟用每月報表', s.enabled));
    s.channel = el('select'); s.channel.name = 'delivery'; [['email', '寄到已驗證的個人信箱（預設）'], ['drive', '只存到個人 Google Drive'], ['both', '信箱與 Google Drive 都要']].forEach(function (row) { var option = el('option', row[1]); option.value = row[0]; s.channel.append(option); }); s.channel.value = 'email';
    s.email = el('input'); s.email.type = 'email'; s.email.readOnly = true; s.email.name = 'recipientEmail'; s.email.autocomplete = 'off';
    s.folder = el('input'); s.folder.type = 'text'; s.folder.name = 'folderId'; s.folder.maxLength = 200; s.folder.placeholder = '可留白，Google 端會建立自己的月報資料夾'; s.folderWrap = field('Google Drive 私人資料夾 ID（選填）', s.folder); s.folderWrap.hidden = true;
    form.append(field('保存方式', s.channel), field('收件信箱（預設為本人已驗證信箱）', s.email), s.folderWrap, el('p', '選擇雲端時，請使用自己的私人資料夾。原始帳務仍保留在家庭記帳；月報只包含本人的收支資料。', 'monthly-help'));
    s.terms = el('input'); s.terms.type = 'checkbox'; s.terms.name = 'termsAccepted'; form.append(field('我同意建立僅可讀取本人月報的專用金鑰，並在 Google 端確認寄送方式及授權。', s.terms));
    var actions = el('div', null, 'monthly-actions'); s.submit = button('保存選擇／建立設定', 'save', true); s.submit.type = 'submit'; s.submit.disabled = true; s.revoke = button('停用並撤銷讀取授權', 'revoke'); s.revoke.disabled = true; actions.append(s.submit, s.revoke); form.append(actions); dialog.append(form);
    s.status = el('p', null, 'monthly-status'); s.status.setAttribute('role', 'status'); s.status.setAttribute('aria-live', 'polite'); s.pack = el('section', null, 'monthly-pack'); s.pack.hidden = true; dialog.append(s.status, s.pack);
    form.onsubmit = function (event) { event.preventDefault(); submit(s); };
    s.channel.onchange = function () { s.folderWrap.hidden = s.channel.value === 'email'; clearPack(s); };
    s.revoke.onclick = async function () { if (!alive(s) || s.busy) return; s.busy = true; s.submit.disabled = s.revoke.disabled = true; clearPack(s); try { var settings = await request(s, 'DELETE', 'authorization'); if (alive(s)) { loadSettings(s, settings); status(s, '已撤銷讀取金鑰，舊的 Google 排程無法再取得月報。請另行移除 Google 端觸發條件。'); } } catch (error) { if (alive(s)) status(s, error.message || '撤銷未完成，請重試。', true); } finally { if (alive(s)) { s.busy = false; s.submit.disabled = !s.settings || !s.settings.recipientVerified; s.revoke.disabled = !s.settings || !s.settings.authorizationActive && !s.settings.enabled; } } };
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); }); document.body.append(dialog); dialog.showModal();
    request(s, 'GET', 'settings').then(function (settings) { if (alive(s)) loadSettings(s, settings); }).catch(function (error) { if (alive(s)) status(s, error.message || '無法讀取月報設定。', true); });
    return { close: close };
  }
  if (global.document) { global.addEventListener('hashchange', close); global.addEventListener('pagehide', close); global.MonthlyReportSetup = Object.freeze({ open: open, close: close, generateScript: generateScript }); }
  if (typeof module === 'object' && module.exports) module.exports = { generateScript: generateScript, exportURL: exportURL };
})(typeof window !== 'undefined' ? window : globalThis);
