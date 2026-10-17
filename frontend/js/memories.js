/* The server owns puzzle credits, completion locks and the achievement archive.
   This module displays that state and never awards pieces in browser storage. */
(function (global) {
  'use strict';
  var active = null;
  function tools() { return global.MediaTools; }
  function esc(value) { return tools().esc(value); }
  function t(key, fallback) { return tools().t(key, fallback); }
  function json(path, opt) { return tools().json(path, opt); }
  function date(value, zone) { if (!value) return '—'; var d = new Date(value), options = {dateStyle:'medium'}; if (zone) options.timeZone = zone; return Number.isNaN(d.getTime()) ? String(value).slice(0,10) : (global.I18n && global.I18n.date ? global.I18n.date(d, options) : d.toLocaleDateString(undefined, options)); }
  function option(value, label, current) { return '<option value="' + esc(value) + '"' + (String(value) === String(current) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function status(ctx, text, error) {
    if (active !== ctx || !ctx.root.isConnected) return;
    var node = ctx.root.querySelector('[data-mem-status]');
    if (node) { node.textContent = text || ''; node.classList.toggle('is-error', !!error); }
  }
  function keepURL(ctx, promise, wallRequest) {
    var generation = ctx.generation;
    return promise.then(function (url) {
      if (active !== ctx || !ctx.root.isConnected || generation !== ctx.generation || (wallRequest != null && wallRequest !== ctx.wallRequest)) { URL.revokeObjectURL(url); return null; }
      (wallRequest == null ? ctx.urls : ctx.wallUrls).push(url); return url;
    });
  }
  function dispose() {
    if (!active) return;
    active.abort.abort();
    active.urls.forEach(function (url) { URL.revokeObjectURL(url); }); active.urls = [];
    active.wallUrls.forEach(function (url) { URL.revokeObjectURL(url); }); active.wallUrls = [];
    if (active.previewURL) URL.revokeObjectURL(active.previewURL);
    active = null;
  }
  function settingsHTML(data) {
    var settings = data.settings;
    var zones = global.Intl && Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC','Asia/Taipei','Asia/Tokyo','America/New_York','Europe/London'];
    if (zones.indexOf('UTC') < 0) zones.unshift('UTC');
    if (settings.timezone && zones.indexOf(settings.timezone) < 0) zones.unshift(settings.timezone);
    return '<section class="card memories-settings"><div class="card__h"><h2 class="card__t">' + esc(t('memories.preferences', '我的收集方式')) + '</h2></div>' +
      '<form data-mem-settings><div class="memories-form-grid"><label><span>' + esc(t('memories.wallName', '成就牆名稱')) + '</span><input name="wallName" type="text" maxlength="60" required value="' + esc(settings.wallName) + '"></label>' +
      '<label><span>' + esc(t('memories.pieceCount', '每張拼圖片數')) + '</span><select name="pieceCount">' + [9,16,25,36,64,100].map(function (n) { return option(n, String(n), settings.pieceCount); }).join('') + '</select></label>' +
      '<label><span>' + esc(t('memories.period', '換圖額度週期')) + '</span><select name="period">' + option('week', t('memories.week', '每週'), settings.period) + option('month', t('memories.month', '每月'), settings.period) + '</select></label>' +
      '<label><span>' + esc(t('memories.changes', '每個週期可開始幾張')) + '</span><input name="changesPerPeriod" type="number" inputmode="numeric" min="1" max="31" value="' + esc(settings.changesPerPeriod) + '" required></label>' +
      '<label><span>' + esc(t('memories.timezone', '週期計算時區')) + '</span><select name="timezone">' + zones.map(function (zone) { return option(zone, zone, settings.timezone || 'UTC'); }).join('') + '</select></label></div>' +
      '<p class="memories-help">' + esc(t('memories.nextSettings', '片數設定套用於下一張；目前拼圖必須完成後才能換圖。週／月額度依選擇的時區計算。')) + '</p><button class="btn" type="submit">' + esc(t('memories.saveSettings', '儲存收集設定')) + '</button></form></section>';
  }
  function puzzleHTML(data) {
    var game = data.current, complete = game && game.completed;
    var count = game ? game.pieceCount : data.settings.pieceCount;
    var earned = game ? game.earnedPieces : 0;
    var cols = Math.sqrt(count), percent = Math.min(100, Math.round(earned / count * 100));
    var h = '<section class="card memories-current"><div class="card__h"><div><p class="media-eyebrow">' + esc(t('memories.personalWorld', '每一筆，拼出生活')) + '</p><h2 class="card__t">' + esc(game ? (complete ? t('memories.completed', '這張拼圖已完成！') : t('memories.currentPuzzle', '正在收集的拼圖')) : t('memories.startFirst', '選一張照片，開始你的第一張拼圖')) + '</h2></div></div>' +
      '<div class="memories-current__body"><div><div class="memories-puzzle" data-mem-puzzle style="--puzzle-cols:' + cols + '" role="img" aria-label="' + esc(t('memories.puzzleProgress', '拼圖收集進度')) + ' ' + earned + '/' + count + '">';
    for (var i = 0; i < count; i++) h += '<div class="memories-tile' + (game && i < earned ? ' is-earned' : '') + '" data-piece="' + i + '"><span>' + (i < earned ? '✓' : String(i + 1)) + '</span></div>';
    h += '</div>' + (game ? '<p class="memories-help">' + esc(t('memories.startedAt', '開始日期')) + ' ' + esc(date(game.createdAt, game.timezone)) + (complete ? ' · ' + esc(t('memories.completedAt', '完成日期')) + ' ' + esc(date(game.completedAt, game.timezone)) : '') + '</p>' : '') + '</div>' +
      '<div class="memories-progress"><div class="memories-progress__count">' + earned + '<small> / ' + count + '</small></div><p>' + esc(t('memories.piecesCollected', '片已收集')) + '</p><progress value="' + earned + '" max="' + count + '" aria-label="' + esc(t('memories.puzzleProgress', '拼圖收集進度')) + '">' + percent + '%</progress><p class="memories-help">' + esc(t('memories.oneRecordOnePiece', '每確認一筆記帳就獲得一片。尚未選圖或多出的片數會先存起來。')) + '</p><div class="memories-credit"><b>' + esc(data.creditsAvailable) + '</b><span>' + esc(t('memories.availableCredits', '片等待下一張')) + '</span></div>' +
      '<p class="memories-help">' + esc(t('memories.periodRemaining', '這個週期剩餘可開始張數')) + ' <strong>' + esc(data.period.remaining) + '</strong><br>' + esc(t('memories.timezone', '週期計算時區')) + ' ' + esc(data.period.timezone || 'UTC') + '</p>' +
      ((!game || complete) ? '<form data-mem-start><label class="memories-file"><span>' + esc(t('memories.choosePuzzlePhoto', '選擇下一張拼圖照片')) + '</span><input type="file" accept="image/*" data-mem-file required' + (data.period.remaining < 1 ? ' disabled' : '') + '></label><div class="memories-photo-preview" data-mem-preview hidden></div><p class="memories-help">' + esc(t('memories.puzzlePhotoHelp', '照片以置中方式裁成方形，會先顯示預覽；建立後需集滿才可換下一張。')) + '</p><button class="btn btn--go" data-mem-start-button type="submit" disabled>' + esc(t('memories.startPuzzle', '開始這張拼圖')) + '</button></form>' : '<div class="memories-lock">' + esc(t('memories.finishBeforeChanging', '先完成目前拼圖，就能選下一張照片。跨週、跨月也會保留目前進度。')) + '</div>') +
      '</div></div></section>';
    return h;
  }
  function wallHTML(data, years) {
    var currentYear = new Date().getFullYear(), yearValues = (years || []).slice();
    if (yearValues.indexOf(currentYear) < 0) yearValues.unshift(currentYear);
    return '<section class="memories-wall" data-mem-wall><div class="memories-wall__head"><div><p class="media-eyebrow">' + esc(t('memories.achievementWall', '我的成就牆')) + '</p><h2 data-mem-wall-name>' + esc(data.settings.wallName) + '</h2><p>' + esc(t('memories.wallHelp', '完成的拼圖會依完成年月永久收藏在這裡。')) + '</p></div><div class="media-actions"><label class="btn btn--sm media-file-label" tabindex="0" role="button">' + esc(t('memories.wallBackground', '更換牆面背景')) + '<input type="file" accept="image/*" data-mem-wall-file hidden></label>' +
      (data.settings.wallBackgroundUrl ? '<button class="btn btn--sm" data-mem-wall-clear>' + esc(t('memories.clearWallBackground', '移除背景')) + '</button>' : '') + '</div></div><div class="memories-wall__filters"><label>' + esc(t('memories.year', '年份')) + '<select data-mem-year>' + option('', t('memories.allYears', '所有年份'), '') + yearValues.map(function (year) { return option(year, String(year), ''); }).join('') + '</select></label><label>' + esc(t('memories.archiveMonth', '月份')) + '<select data-mem-month>' + option('', t('memories.allMonths', '所有月份'), '') + Array.from({length:12}, function (_, i) { return option(i + 1, String(i + 1).padStart(2, '0'), ''); }).join('') + '</select></label></div><div class="memories-achievements" data-mem-achievements aria-live="polite"></div><div class="memories-pagination" data-mem-pagination></div></section>';
  }
  async function applyGamePhoto(ctx) {
    var game = ctx.data.current;
    if (!game || !game.imageUrl) return;
    try {
      var url = await keepURL(ctx, tools().imageURL(game.imageUrl)); if (!url) return;
      var cols = Math.sqrt(game.pieceCount), tiles = ctx.root.querySelectorAll('[data-mem-puzzle] .is-earned');
      tiles.forEach(function (tile) {
        var i = Number(tile.dataset.piece), x = i % cols, y = Math.floor(i / cols);
        tile.style.backgroundImage = 'url("' + url + '")'; tile.style.backgroundSize = cols * 100 + '% ' + cols * 100 + '%';
        tile.style.backgroundPosition = (cols === 1 ? 0 : x / (cols - 1) * 100) + '% ' + (cols === 1 ? 0 : y / (cols - 1) * 100) + '%';
      });
    } catch (error) { status(ctx, tools().message(error), true); }
  }
  async function applyWallBackground(ctx) {
    if (!ctx.data.settings.wallBackgroundUrl) return;
    try {
      var url = await keepURL(ctx, tools().imageURL(ctx.data.settings.wallBackgroundUrl)); if (!url) return;
      var wall = ctx.root.querySelector('[data-mem-wall]'); if (wall) { wall.style.setProperty('--wall-image', 'url("' + url + '")'); wall.classList.add('has-background'); }
    } catch (error) { status(ctx, tools().message(error), true); }
  }
  async function loadAchievements(ctx, page) {
    var area = ctx.root.querySelector('[data-mem-achievements]'); if (!area) return;
    var query = new URLSearchParams({page:String(page || 1)}), year = ctx.root.querySelector('[data-mem-year]').value, month = ctx.root.querySelector('[data-mem-month]').value;
    if (year) query.set('year', year); if (month) query.set('month', month);
    ctx.wallYear = year; ctx.wallMonth = month;
    ctx.wallUrls.forEach(function (url) { URL.revokeObjectURL(url); }); ctx.wallUrls = [];
    ctx.root.querySelector('[data-mem-pagination]').innerHTML = '';
    area.setAttribute('aria-busy', 'true');
    area.innerHTML = '<p class="memories-empty">' + esc(t('memories.loadingWall', '正在讀取成就收藏…')) + '</p>';
    var request = ++ctx.wallRequest;
    try {
      var data = await json('/api/memories/achievements?' + query.toString());
      if (active !== ctx || request !== ctx.wallRequest) return;
      var games = data.achievements || [];
      area.innerHTML = games.length ? '' : '<p class="memories-empty">' + esc(t('memories.noAchievements', '這個年月還沒有完成的拼圖。每筆記帳，都會讓下一張成就更接近。')) + '</p>';
      games.forEach(function (game) {
        var card = document.createElement('article'); card.className = 'memories-achievement';
        card.innerHTML = '<div class="memories-achievement__photo"><span>' + esc(t('media.loading', '正在讀取相片…')) + '</span></div><div class="memories-achievement__info"><h3>' + esc(game.year) + ' / ' + esc(String(game.month).padStart(2,'0')) + '</h3><p>' + esc(t('memories.completedAt', '完成日期')) + ' ' + esc(date(game.completedAt, game.timezone)) + '</p><span class="memories-badge">' + esc(game.pieceCount) + ' ' + esc(t('memories.pieceUnit', '片')) + ' · ' + esc(t('memories.completedBadge', '完成收藏')) + '</span></div>';
        area.appendChild(card);
        keepURL(ctx, tools().imageURL(game.imageUrl), request).then(function (url) {
          if (url && active === ctx && request === ctx.wallRequest && card.isConnected) card.querySelector('.memories-achievement__photo').innerHTML = '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img src="' + esc(url) + '" alt="' + esc(t('memories.completedPuzzle', '已完成的回憶拼圖')) + '"></a>';
        }).catch(function (error) { if (card.isConnected) card.querySelector('.memories-achievement__photo').textContent = tools().message(error); });
      });
      var pagination = ctx.root.querySelector('[data-mem-pagination]');
      // The API paginates completed photographs, never browser-local achievements.
      var pageNumber = Number(data.page || page || 1), pageSize = Number(data.pageSize || 50);
      pagination.innerHTML = (pageNumber > 1 ? '<button class="btn btn--sm" data-mem-page="' + (pageNumber - 1) + '">' + esc(t('memories.previous', '上一頁')) + '</button>' : '') +
        (data.total > pageNumber * pageSize ? '<button class="btn btn--sm" data-mem-page="' + (pageNumber + 1) + '">' + esc(t('memories.next', '下一頁')) + '</button>' : '');
      var yearSelect = ctx.root.querySelector('[data-mem-year]');
      ctx.wallYears = data.years || [];
      ctx.wallYears.forEach(function (value) { if (!Array.from(yearSelect.options).some(function (opt) { return String(opt.value) === String(value); })) yearSelect.add(new Option(String(value), String(value))); });
    } catch (error) { if (active === ctx && request === ctx.wallRequest) { area.innerHTML = '<p class="memories-empty">' + esc(tools().message(error)) + '</p><button class="btn" data-mem-retry-wall>' + esc(t('media.retry', '重新讀取')) + '</button>'; } }
    finally { if (active === ctx && request === ctx.wallRequest) area.setAttribute('aria-busy', 'false'); }
  }
  function paint(ctx) {
    ctx.generation++;
    ctx.root.innerHTML = '<div class="page memories"><div class="memories-intro"><span class="memories-intro__icon" aria-hidden="true">✦</span><div><h2>' + esc(t('memories.title', '我的小天地')) + '</h2><p>' + esc(t('memories.intro', '把每天的記帳，拼成值得收藏的生活。')) + '</p></div><button class="btn btn--sm" data-mem-refresh>' + esc(t('memories.refresh', '更新進度')) + '</button></div><p class="media-status" data-mem-status role="status" aria-live="polite"></p>' + puzzleHTML(ctx.data) + settingsHTML(ctx.data) +
      '<details class="memories-rules"><summary>' + esc(t('memories.collectionRules', '收集與保存規則')) + '</summary><ul><li>' + esc(t('memories.ruleActivation', '系統更新後的每筆新記帳都會自動累積；即使還沒選拼圖照片，也會先保留片數。')) + '</li><li>' + esc(t('memories.ruleUnique', '每筆有效記帳僅獎勵一次；刪除未完成拼圖所用的記帳會扣回片數，相同內容刪除再建不會重複獎勵。')) + '</li><li>' + esc(t('memories.ruleCompletion', '集滿會自動加入成就牆；多出的片數保留給下一張。完成的成就永久保留。')) + '</li><li>' + esc(t('memories.rulePeriod', '每週／每月的換圖額度依設定的時區計算；未完成的照片與片數會延續，不因週期重置而遺失。')) + '</li><li>' + esc(t('memories.rulePhotos', '拼圖照片與牆面背景會儲存到你的帳號，僅供你本人查看；系統保存適合瀏覽的壓縮版本。')) + '</li></ul></details>' + wallHTML(ctx.data, ctx.wallYears) + '</div>';
    ctx.root.querySelector('[data-mem-year]').value = ctx.wallYear || '';
    ctx.root.querySelector('[data-mem-month]').value = ctx.wallMonth || '';
    applyGamePhoto(ctx); applyWallBackground(ctx); loadAchievements(ctx, 1);
  }
  function applyState(ctx, data, success) {
    if (active !== ctx || !ctx.root.isConnected) return;
    ctx.loadRequest++; ctx.fileRequest++;
    ctx.urls.forEach(function (url) { URL.revokeObjectURL(url); }); ctx.urls = [];
    ctx.wallUrls.forEach(function (url) { URL.revokeObjectURL(url); }); ctx.wallUrls = [];
    if (ctx.previewURL) { URL.revokeObjectURL(ctx.previewURL); ctx.previewURL = null; }
    ctx.data = data; ctx.selectedFile = null; paint(ctx); status(ctx, success || '');
  }
  async function refresh(ctx, success) {
    var request = ++ctx.loadRequest;
    status(ctx, t('memories.loading', '正在同步你的拼圖…'));
    var data = await json('/api/memories');
    if (active !== ctx || request !== ctx.loadRequest) return;
    applyState(ctx, data, success);
  }
  async function selectFile(ctx, input) {
    var file = input.files && input.files[0], request = ++ctx.fileRequest;
    ctx.selectedFile = null;
    if (ctx.previewURL) { URL.revokeObjectURL(ctx.previewURL); ctx.previewURL = null; }
    var preview = ctx.root.querySelector('[data-mem-preview]'); preview.hidden = true; preview.innerHTML = '';
    var submit = ctx.root.querySelector('[data-mem-start-button]'); submit.disabled = true;
    if (!file) { status(ctx, ''); return; }
    status(ctx, t('media.preparing', '正在整理相片，請稍候…'));
    try {
      var prepared = await tools().prepareSquarePhoto(file);
      if (active !== ctx || request !== ctx.fileRequest || !input.isConnected) return;
      ctx.selectedFile = prepared;
      ctx.previewURL = URL.createObjectURL(prepared);
      preview.hidden = false;
      preview.innerHTML = '<img src="' + esc(ctx.previewURL) + '" alt="' + esc(t('memories.preview', '下一張拼圖預覽')) + '">';
      status(ctx, t('memories.previewReady', '請先查看方形預覽，喜歡這張照片再按「開始這張拼圖」。'));
    } catch (error) { if (active === ctx && request === ctx.fileRequest) { status(ctx, tools().message(error), true); input.value = ''; } }
    finally { if (active === ctx && request === ctx.fileRequest && submit.isConnected) submit.disabled = ctx.saving || !ctx.selectedFile || ctx.data.period.remaining < 1; }
  }
  function setSaving(ctx, saving) {
    ctx.saving = saving;
    if (saving) ctx.loadRequest++;
    ctx.root.setAttribute('aria-busy', String(saving));
    ctx.root.querySelectorAll('button,input[type="file"],[data-mem-year],[data-mem-month]').forEach(function (node) {
      if (saving) { node.dataset.memDisabled = node.disabled ? '1' : '0'; node.disabled = true; }
      else if (node.hasAttribute('data-mem-disabled')) { node.disabled = node.dataset.memDisabled === '1'; delete node.dataset.memDisabled; }
    });
    if (!saving) { var start = ctx.root.querySelector('[data-mem-start-button]'); if (start) start.disabled = !ctx.selectedFile || ctx.data.period.remaining < 1; }
  }
  function bind(ctx) {
    ctx.root.addEventListener('click', async function (event) {
      if (active !== ctx) return;
      var target = event.target.closest('button'); if (!target) return;
      if (ctx.saving || target.disabled) return;
      if (target.hasAttribute('data-mem-page')) { loadAchievements(ctx, Number(target.dataset.memPage)); return; }
      if (target.hasAttribute('data-mem-retry-wall')) { loadAchievements(ctx, 1); return; }
      if (target.hasAttribute('data-mem-refresh')) {
        target.disabled = true;
        try { await refresh(ctx); } catch (error) { status(ctx, tools().message(error), true); }
        finally { if (active === ctx && target.isConnected) { if (ctx.saving) target.dataset.memDisabled = '0'; else target.disabled = false; } }
        return;
      }
      if (target.hasAttribute('data-mem-wall-clear')) {
        setSaving(ctx, true);
        try { var result = await json('/api/memories/wall-background', {method:'DELETE'}); applyState(ctx, Object.assign({}, ctx.data, result), t('memories.wallBackgroundRemoved', '牆面背景已移除。')); }
        catch (error) { status(ctx, tools().message(error), true); }
        finally { if (active === ctx) setSaving(ctx, false); }
      }
    }, {signal:ctx.abort.signal});
    ctx.root.addEventListener('change', async function (event) {
      if (active !== ctx || ctx.saving) return;
      var input = event.target;
      if (input.hasAttribute('data-mem-file')) { selectFile(ctx, input); return; }
      if (input.hasAttribute('data-mem-year') || input.hasAttribute('data-mem-month')) { loadAchievements(ctx, 1); return; }
      if (input.hasAttribute('data-mem-wall-file')) {
        var file = input.files && input.files[0]; if (!file) return;
        setSaving(ctx, true);
        status(ctx, t('media.saving', '正在整理並儲存相片…'));
        try {
          var prepared = await tools().preparePhoto(file);
          if (active !== ctx || !input.isConnected) return;
          var body = new FormData(); body.append('file', prepared);
          var result = await json('/api/memories/wall-background', {method:'PUT', body:body});
          applyState(ctx, Object.assign({}, ctx.data, result), t('memories.wallBackgroundSaved', '成就牆背景已儲存。'));
        }
        catch (error) { status(ctx, tools().message(error), true); input.value = ''; }
        finally { if (active === ctx) setSaving(ctx, false); }
      }
    }, {signal:ctx.abort.signal});
    ctx.root.addEventListener('submit', async function (event) {
      if (active !== ctx) return;
      var form = event.target; if (!form.hasAttribute('data-mem-settings') && !form.hasAttribute('data-mem-start')) return;
      event.preventDefault(); var button = form.querySelector('button[type="submit"]'); if (button.disabled || ctx.saving) return;
      setSaving(ctx, true);
      try {
        if (form.hasAttribute('data-mem-settings')) {
          var values = new FormData(form), name = String(values.get('wallName') || '').trim();
          if (!name) throw new Error(t('memories.nameRequired', '請為成就牆取一個名稱。'));
          var result = await json('/api/memories/settings', {method:'PATCH', body:JSON.stringify({wallName:name,period:values.get('period'),timezone:values.get('timezone'),pieceCount:Number(values.get('pieceCount')),changesPerPeriod:Number(values.get('changesPerPeriod'))}),headers:{'Content-Type':'application/json'}});
          applyState(ctx, result, t('memories.settingsSaved', '收集設定已儲存。'));
        } else {
          if (!ctx.selectedFile) throw new Error(t('memories.photoRequired', '請先選擇照片並查看預覽。'));
          var body = new FormData(); body.append('file', ctx.selectedFile);
          var result = await json('/api/memories/puzzles', {method:'POST', body:body});
          applyState(ctx, result, t('memories.puzzleStarted', '新拼圖已開始！接下來每筆記帳都會收集一片。'));
        }
      } catch (error) { status(ctx, tools().message(error), true); }
      finally { if (active === ctx) setSaving(ctx, false); }
    }, {signal:ctx.abort.signal});
  }
  async function render(root) {
    dispose();
    var ctx = {root:root, urls:[], wallUrls:[], wallYears:[], data:null, selectedFile:null, previewURL:null, wallRequest:0, loadRequest:0, fileRequest:0, generation:0, saving:false, abort:new AbortController()}; active = ctx;
    root.innerHTML = '<p class="memories-empty" role="status">' + esc(t('memories.loading', '正在同步你的拼圖…')) + '</p>';
    bind(ctx);
    try { await refresh(ctx); }
    catch (error) {
      if (active !== ctx) return;
      root.innerHTML = '<div class="card memories-error"><h2>' + esc(t('memories.unavailable', '暫時無法開啟小天地')) + '</h2><p>' + esc(tools().message(error)) + '</p><button class="btn" data-mem-refresh>' + esc(t('media.retry', '重新讀取')) + '</button></div>';
    }
  }
  global.addEventListener('hashchange', function () { if (!/^#\/memories(?:\/|$)/.test(global.location.hash)) dispose(); });
  global.Memories = {render:render, dispose:dispose};
})(window);
