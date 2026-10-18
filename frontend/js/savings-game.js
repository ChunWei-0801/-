/* A private, account-backed savings jar. Its fill always follows real amounts. */
(function (global) {
  'use strict';
  var active = null, sequence = 0;
  var shapes = {
    pig: 'M69 105C63 86 65 65 79 49L97 65C113 59 128 59 141 64L160 46L168 79C184 91 195 107 199 126L219 130Q227 131 227 141L227 166Q227 176 217 177L202 179Q194 195 177 204L175 224L153 224L149 214Q121 219 94 210L88 224L66 224L64 198Q42 178 43 151C20 155 16 130 30 123Q43 118 48 132C48 121 56 111 69 105Z',
    dinosaur: 'M35 165Q51 166 62 151L80 126Q89 111 111 107L133 106L133 64Q130 37 155 29L181 29Q200 30 202 49L218 52Q228 54 228 66L228 84Q227 96 213 97L181 96L182 141Q179 167 164 186L166 218Q166 225 158 225L137 225L133 200L112 201L102 225L78 225L84 192Q66 186 60 176Q41 180 25 165L13 145Q24 160 35 165Z',
    heart: 'M128 226C106 207 28 151 26 93C24 52 49 29 80 32C103 32 119 45 128 62C137 45 153 32 176 32C207 29 232 52 230 93C228 151 150 207 128 226Z'
  };
  function t(key, fallback) { return global.I18n && global.I18n.t ? global.I18n.t('savingsGame.' + key, fallback) : fallback; }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function number(value) { return global.I18n && global.I18n.number ? global.I18n.number(value, {maximumFractionDigits:2}) : new Intl.NumberFormat('zh-TW', {maximumFractionDigits:2}).format(value); }
  function request(method, path, data) {
    if (!global.LifeAPI || !global.LifeAPI.request) return Promise.reject(new Error(t('serviceUnavailable', '暫時無法連接存錢服務，請重新整理後再試。')));
    try { return Promise.resolve(global.LifeAPI.request(method, path, data)); } catch (error) { return Promise.reject(error); }
  }
  function normalize(result) {
    var jar = result && (result.jar || result);
    if (!jar || jar.targetAmount == null || jar.savedAmount == null || !Number.isFinite(Number(jar.targetAmount)) || Number(jar.targetAmount) < 0 || !Number.isFinite(Number(jar.savedAmount)) || Number(jar.savedAmount) < 0 || ['pig','dinosaur','heart','photo'].indexOf(jar.shape) < 0) throw new Error(t('invalidState', '存錢資料暫時無法讀取，請稍後重試。'));
    return Object.assign({}, jar, {targetAmount:Number(jar.targetAmount), savedAmount:Number(jar.savedAmount)});
  }
  function percent(jar) { return jar.targetAmount > 0 ? Math.max(0, Math.min(100, jar.savedAmount / jar.targetAmount * 100)) : 0; }
  function jarPayload(jar) {
    // Read-only image URLs and progress values are never sent back as input fields.
    var result = {};
    ['name','targetAmount','savedAmount','shape'].forEach(function (key) { if (Object.prototype.hasOwnProperty.call(jar, key)) result[key] = jar[key]; });
    return result;
  }
  function usable(ctx) { return active === ctx && ctx.root.isConnected; }
  function status(ctx, message, error) {
    if (!usable(ctx)) return;
    var node = ctx.root.querySelector('[data-sg-status]');
    if (node) { node.textContent = message || ''; node.classList.toggle('is-error', !!error); }
  }
  function toast(message) { if (global.FamBudgetUI && global.FamBudgetUI.toast) global.FamBudgetUI.toast(message, 'ok'); }
  function cleanup() {
    if (!active) return;
    active.abort.abort(); active.imageVersion++;
    if (active.photoURL) URL.revokeObjectURL(active.photoURL);
    active.root.removeAttribute('aria-busy');
    active = null;
  }
  function icon(shape) { return '<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path d="' + shapes[shape] + '"></path></svg>'; }
  function silhouette(ctx) {
    var shape = ctx.jar.shape, path = shapes[shape], id = 'savings-shape-' + ctx.id;
    if (shape === 'photo') return '<div class="savings-game__photo" data-sg-photo><div class="savings-game__photo-placeholder"><span aria-hidden="true">＋</span><p>' + esc(ctx.jar.imageUrl ? t('photoLoading', '正在讀取你的願望照片…') : t('uploadPhoto', '上傳自己的願望照片')) + '</p></div></div>';
    var details = shape === 'pig' ? '<circle cx="181" cy="121" r="4"/><path d="M215 145L215 160M105 84L139 84" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>' : shape === 'dinosaur' ? '<circle cx="185" cy="52" r="4"/><path d="M184 80L205 80M156 126L173 130" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>' : '<path d="M62 82Q63 60 83 59" fill="none" stroke="white" stroke-opacity=".45" stroke-width="9" stroke-linecap="round"/>';
    return '<svg class="savings-game__silhouette" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><defs><clipPath id="' + id + '"><path d="' + path + '"/></clipPath><linearGradient id="' + id + '-green" x1="0" x2="1" y1="1" y2="0"><stop stop-color="#1c6c52"/><stop offset="1" stop-color="#6eb78d"/></linearGradient></defs><path class="savings-game__empty" d="' + path + '"/><g clip-path="url(#' + id + ')"><g class="savings-game__fill"><rect x="0" y="0" width="256" height="256" fill="url(#' + id + '-green)"/><path d="M16 202Q76 173 135 202T266 198L266 256L0 256Z" fill="#175d47" opacity=".18"/></g></g><path class="savings-game__outline" d="' + path + '"/><g class="savings-game__details">' + details + '</g></svg>';
  }
  function amountField(name, label, value, min) { return '<label class="savings-game__field"><span>' + esc(label) + '</span><div class="savings-game__money-input"><span aria-hidden="true">NT$</span><input name="' + name + '" type="number" inputmode="decimal" min="' + min + '" max="999999999999" step="0.01" value="' + esc(value) + '" required></div></label>'; }
  function paint(ctx) {
    var jar = ctx.jar, progress = percent(jar), labels = {pig:t('pig','小豬'),dinosaur:t('dinosaur','小恐龍'),heart:t('heart','愛心')};
    ctx.root.innerHTML = '<div class="page savings-game"><div class="savings-game__heading"><div><p class="savings-game__eyebrow">' + esc(t('eyebrow','一點一滴，讓願望長大')) + '</p><h2>' + esc(t('title','我的存錢小夥伴')) + '</h2><p>' + esc(t('intro','每一筆存下的金額，都讓喜歡的模樣多一點色彩。')) + '</p></div><a class="savings-game__back" href="#/settings">' + esc(t('back','回到設定')) + '<span aria-hidden="true"> ↗</span></a></div><p class="savings-game__status" data-sg-status role="status" aria-live="polite"></p>' +
      '<div class="savings-game__layout"><section class="savings-game__garden" aria-labelledby="savings-name-' + ctx.id + '"><div class="savings-game__garden-head"><span class="savings-game__tag">' + esc(t('yourWish','正在累積的願望')) + '</span><span class="savings-game__percentage" data-sg-percent>' + number(progress) + '%</span></div><h3 id="savings-name-' + ctx.id + '" data-sg-name data-i18n-skip>' + esc(jar.name) + '</h3><div class="savings-game__stage"><span class="savings-game__spark savings-game__spark--one" aria-hidden="true">✦</span><span class="savings-game__spark savings-game__spark--two" aria-hidden="true">✧</span><div class="savings-game__visual" data-sg-visual role="img" aria-label="' + esc(t('progress','存錢進度')) + ' ' + number(progress) + '%" style="--sg-empty:' + (100-progress) + '%">' + silhouette(ctx) + '</div><div class="savings-game__ground" aria-hidden="true"></div></div><div class="savings-game__totals"><div><span>' + esc(t('saved','目前已存')) + '</span><strong><small>NT$</small> <b data-sg-saved>' + number(jar.savedAmount) + '</b></strong></div><div><span>' + esc(t('target','目標金額')) + '</span><strong><small>NT$</small> <b data-sg-target>' + number(jar.targetAmount) + '</b></strong></div></div><progress class="savings-game__progress" data-sg-progress max="100" value="' + progress + '" aria-label="' + esc(t('progress','存錢進度')) + '">' + number(progress) + '%</progress><p class="savings-game__encouragement" data-sg-encouragement></p><p class="savings-game__preview-note" data-sg-preview-note hidden>' + esc(t('preview','金額預覽，按「儲存目標與金額」後保存。')) + '</p></section>' +
      '<div class="savings-game__controls"><section class="savings-game__panel" aria-labelledby="savings-shapes-' + ctx.id + '"><div class="savings-game__section-title"><span aria-hidden="true">✦</span><h3 id="savings-shapes-' + ctx.id + '">' + esc(t('chooseShape','選一個陪你存錢的模樣')) + '</h3></div><div class="savings-game__shapes" role="group" aria-label="' + esc(t('shape','存錢造型')) + '">' + ['pig','dinosaur','heart'].map(function (shape) { return '<button class="savings-game__shape' + (jar.shape === shape ? ' is-selected' : '') + '" type="button" data-sg-shape="' + shape + '" aria-pressed="' + (jar.shape === shape) + '">' + icon(shape) + '<span>' + esc(labels[shape]) + '</span></button>'; }).join('') + '<button class="savings-game__shape' + (jar.shape === 'photo' ? ' is-selected' : '') + '" type="button" data-sg-shape="photo" aria-pressed="' + (jar.shape === 'photo') + '"><span class="savings-game__photo-icon" aria-hidden="true">▧</span><span>' + esc(t('myPhoto','我的照片')) + '</span></button></div><button class="savings-game__photo-button" type="button" data-sg-upload>' + esc(jar.imageUrl ? t('replacePhoto','更換願望照片') : t('uploadPhoto','上傳自己的願望照片')) + '<span aria-hidden="true"> ＋</span></button><input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif" data-sg-file hidden><p class="savings-game__help">' + esc(t('photoHelp','把喜歡的照片變成存錢目標；存得越多，照片就會由下往上亮起。')) + '</p></section>' +
      '<section class="savings-game__panel"><div class="savings-game__section-title"><span aria-hidden="true">↗</span><h3>' + esc(t('editGoal','給願望一個目標')) + '</h3></div><form data-sg-form><label class="savings-game__field"><span>' + esc(t('name','願望名稱')) + '</span><input name="name" type="text" maxlength="60" value="' + esc(jar.name) + '" required></label><div class="savings-game__amounts">' + amountField('targetAmount',t('target','目標金額'),jar.targetAmount,'0.01') + amountField('savedAmount',t('saved','目前已存'),jar.savedAmount,'0') + '</div><button class="savings-game__primary" type="submit">' + esc(t('save','儲存目標與金額')) + '<span aria-hidden="true"> →</span></button></form></section>' +
      '<section class="savings-game__panel savings-game__deposit"><div class="savings-game__section-title"><span aria-hidden="true">＋</span><h3>' + esc(t('deposit','今天，再靠近一點')) + '</h3></div><form data-sg-deposit><label class="savings-game__field"><span>' + esc(t('addAmount','這次存入金額')) + '</span><div class="savings-game__deposit-row"><div class="savings-game__money-input"><span aria-hidden="true">NT$</span><input name="delta" type="number" inputmode="decimal" min="0.01" max="999999999999" step="0.01" placeholder="0" required></div><button class="savings-game__primary" type="submit">' + esc(t('add','存入')) + '</button></div></label><div class="savings-game__quick" role="group" aria-label="' + esc(t('quickAmounts','快速填入存入金額')) + '">' + [100,500,1000].map(function (amount) { return '<button type="button" data-sg-quick="' + amount + '">＋' + number(amount) + '</button>'; }).join('') + '</div></form><div class="savings-game__reset"><p>' + esc(t('manualNote','這裡記錄你填入的實際存款，金額可隨時修正。')) + '</p><button type="button" data-sg-clear>' + esc(t('clear','清空已存金額')) + '</button></div></section></div></div></div>';
    updatePreview(ctx, jar, false); loadPhoto(ctx);
  }
  function updatePreview(ctx, jar, preview) {
    var progress = percent(jar), visual = ctx.root.querySelector('[data-sg-visual]');
    visual.style.setProperty('--sg-empty', (100-progress) + '%'); visual.setAttribute('aria-label', t('progress','存錢進度') + ' ' + number(progress) + '%');
    ctx.root.querySelector('[data-sg-percent]').textContent = number(progress) + '%';
    ctx.root.querySelector('[data-sg-progress]').value = progress;
    ctx.root.querySelector('[data-sg-name]').textContent = jar.name;
    ctx.root.querySelector('[data-sg-saved]').textContent = number(jar.savedAmount);
    ctx.root.querySelector('[data-sg-target]').textContent = number(jar.targetAmount);
    ctx.root.querySelector('[data-sg-encouragement]').textContent = jar.targetAmount <= 0 ? t('setTargetFirst','先設定一個大於 0 的目標金額，讓每次存款都變成看得見的進度。') : progress >= 100 ? t('complete','願望裝滿了，這份努力值得慶祝！') : jar.savedAmount > 0 ? t('remaining','距離願望，還差') + ' NT$ ' + number(Math.max(0,jar.targetAmount-jar.savedAmount)) : t('firstStep','從第一筆開始，慢慢存成喜歡的生活。');
    ctx.root.querySelector('[data-sg-preview-note]').hidden = !preview;
  }
  async function loadPhoto(ctx) {
    var version = ++ctx.imageVersion;
    if (ctx.photoURL) { URL.revokeObjectURL(ctx.photoURL); ctx.photoURL = null; }
    if (ctx.jar.shape !== 'photo' || !ctx.jar.imageUrl) return;
    try {
      if (!global.LifeAPI.imageURL) throw new Error(t('photoUnavailable','暫時無法讀取照片，請重新整理後再試。'));
      var url = await global.LifeAPI.imageURL(ctx.jar.imageUrl);
      if (!usable(ctx) || version !== ctx.imageVersion) { URL.revokeObjectURL(url); return; }
      ctx.photoURL = url;
      var photo = ctx.root.querySelector('[data-sg-photo]');
      if (photo) photo.innerHTML = '<img class="savings-game__photo-empty" src="' + esc(url) + '" alt=""><img class="savings-game__photo-fill" src="' + esc(url) + '" alt="">';
    } catch (error) {
      if (!usable(ctx) || version !== ctx.imageVersion) return;
      var placeholder = ctx.root.querySelector('.savings-game__photo-placeholder p'); if (placeholder) placeholder.textContent = error.message || t('photoUnavailable','暫時無法讀取照片，請重新整理後再試。');
      status(ctx, error.message, true);
    }
  }
  function busy(ctx, value) {
    ctx.busy = value; ctx.root.setAttribute('aria-busy', String(value));
    ctx.root.querySelectorAll('button,input').forEach(function (node) { node.disabled = value; });
  }
  function readForm(ctx) {
    var form = ctx.root.querySelector('[data-sg-form]'), values = new FormData(form);
    var name = String(values.get('name') || '').trim(), target = Number(values.get('targetAmount')), saved = Number(values.get('savedAmount'));
    if (!name || name.length > 60) throw new Error(t('nameRequired','請為願望取個 60 字以內的名稱。'));
    if (!Number.isFinite(target) || target <= 0 || target > 999999999999 || !Number.isFinite(saved) || saved < 0 || saved > 999999999999) throw new Error(t('amountInvalid','請填入有效金額；目標需大於 0，已存金額不可小於 0。'));
    return {name:name,targetAmount:Math.round(target*100)/100,savedAmount:Math.round(saved*100)/100,shape:ctx.jar.shape};
  }
  async function save(ctx, body, message) {
    if (ctx.busy) return;
    busy(ctx, true); status(ctx, t('saving','正在儲存…'));
    try {
      var result = normalize(await request('PUT','/jar',jarPayload(body)));
      if (!usable(ctx)) return;
      ctx.jar = result; paint(ctx); status(ctx, message); toast(message);
    } catch (error) { status(ctx, error.message || t('saveFailed','儲存未完成，請稍後重試。'), true); }
    finally { if (usable(ctx)) busy(ctx, false); }
  }
  function prepareImage(file) {
    if (!file || !file.size || file.size > 25*1024*1024 || (file.type && !/^image\//.test(file.type))) return Promise.reject(new Error(t('invalidPhoto','請選擇 25 MB 以內、瀏覽器可開啟的照片。')));
    return new Promise(function (resolve,reject) {
      var url = URL.createObjectURL(file), image = new Image();
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error(t('photoDecode','無法讀取這張照片，請改用 JPG、PNG 或 WebP。'))); };
      image.onload = function () {
        URL.revokeObjectURL(url);
        try {
          var ratio = Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight)), canvas = document.createElement('canvas');
          canvas.width = Math.max(1,Math.round(image.naturalWidth*ratio)); canvas.height = Math.max(1,Math.round(image.naturalHeight*ratio));
          var context = canvas.getContext('2d'); if (!context) throw new Error(t('photoDecode','無法讀取這張照片，請改用 JPG、PNG 或 WebP。'));
          context.drawImage(image,0,0,canvas.width,canvas.height);
          // PNG keeps an existing cutout transparent. The server controls its stored format.
          var encoded = canvas.toDataURL(file.type === 'image/png' || file.type === 'image/webp' ? 'image/png' : 'image/jpeg',0.88);
          if (encoded.length > 6*1024*1024) encoded = canvas.toDataURL('image/jpeg',0.82);
          canvas.width = canvas.height = 1; resolve(encoded);
        } catch (error) { reject(error); }
      };
      image.src = url;
    });
  }
  function bind(ctx) {
    ctx.root.addEventListener('input',function (event) {
      if (!usable(ctx) || ctx.busy || !event.target.closest('[data-sg-form]')) return;
      try { updatePreview(ctx,readForm(ctx),true); } catch (_) { /* Keep the last valid preview while a number is being edited. */ }
    },{signal:ctx.abort.signal});
    ctx.root.addEventListener('click',function (event) {
      var button = event.target.closest('button'); if (!button || !usable(ctx) || ctx.busy || button.disabled) return;
      if (button.hasAttribute('data-sg-upload')) { ctx.root.querySelector('[data-sg-file]').click(); return; }
      if (button.hasAttribute('data-sg-shape')) {
        var shape = button.dataset.sgShape;
        if (shape === 'photo' && !ctx.jar.imageUrl) { ctx.root.querySelector('[data-sg-file]').click(); return; }
        if (shape !== ctx.jar.shape) save(ctx,{shape:shape},t('shapeSaved','存錢小夥伴已更換。'));
      }
      if (button.hasAttribute('data-sg-quick')) { var field = ctx.root.querySelector('[name="delta"]'); field.value = button.dataset.sgQuick; field.focus(); }
      if (button.hasAttribute('data-sg-clear')) save(ctx,{savedAmount:0},t('cleared','已存金額已清空，目標仍為你保留。'));
    },{signal:ctx.abort.signal});
    ctx.root.addEventListener('submit',function (event) {
      if (!event.target.matches('[data-sg-form],[data-sg-deposit]')) return;
      event.preventDefault(); if (!usable(ctx) || ctx.busy) return;
      try {
        var body;
        if (event.target.hasAttribute('data-sg-form')) body = readForm(ctx);
        else {
          var delta = Number(new FormData(event.target).get('delta'));
          if (!Number.isFinite(delta) || delta <= 0 || ctx.jar.savedAmount + delta > 999999999999) throw new Error(t('deltaInvalid','請填入大於 0 的存入金額。'));
          body = {savedAmount:Math.round((ctx.jar.savedAmount+delta)*100)/100};
        }
        save(ctx,body,t('savedSuccess','願望與存款進度已儲存。'));
      } catch (error) { status(ctx,error.message,true); }
    },{signal:ctx.abort.signal});
    ctx.root.addEventListener('change',async function (event) {
      var input = event.target;
      if (!input.hasAttribute('data-sg-file') || !usable(ctx) || ctx.busy) return;
      var file = input.files && input.files[0]; input.value = ''; if (!file) return;
      busy(ctx,true); status(ctx,t('preparingPhoto','正在整理並儲存願望照片…'));
      try {
        var image = await prepareImage(file); if (!usable(ctx)) return;
        var result = normalize(await request('PUT','/jar/image',{image:image})); if (!usable(ctx)) return;
        if (result.shape !== 'photo') result = normalize(await request('PUT','/jar',{name:result.name,targetAmount:result.targetAmount,savedAmount:result.savedAmount,shape:'photo'}));
        if (!usable(ctx)) return;
        ctx.jar = result; paint(ctx); status(ctx,t('photoSaved','願望照片已儲存，現在一起把它填滿吧。')); toast(t('photoSaved','願望照片已儲存，現在一起把它填滿吧。'));
      } catch (error) { status(ctx,error.message || t('photoFailed','照片未能儲存，請稍後再試。'),true); }
      finally { if (usable(ctx)) busy(ctx,false); }
    },{signal:ctx.abort.signal});
  }
  async function mount(root) {
    cleanup();
    var ctx = {root:root,id:++sequence,jar:null,busy:false,photoURL:null,imageVersion:0,abort:new AbortController()}; active = ctx;
    if (global.FamBudgetUI && global.FamBudgetUI.head) global.FamBudgetUI.head(t('title','我的存錢小夥伴'),t('intro','每一筆存下的金額，都讓喜歡的模樣多一點色彩。'));
    root.innerHTML = '<div class="savings-game__loading" role="status">' + esc(t('loading','正在讀取你的存錢小夥伴…')) + '</div>';
    try {
      ctx.jar = normalize(await request('GET','/jar')); if (!usable(ctx)) return;
      paint(ctx); bind(ctx);
    } catch (error) {
      if (!usable(ctx)) return;
      root.innerHTML = '<section class="savings-game__error"><h2>' + esc(t('loadFailed','暫時無法開啟存錢小夥伴')) + '</h2><p>' + esc(error.message) + '</p><button type="button" class="savings-game__primary" data-sg-retry>' + esc(t('retry','重新讀取')) + '</button></section>';
      root.querySelector('[data-sg-retry]').addEventListener('click',function () { mount(root); },{signal:ctx.abort.signal});
    }
  }
  global.addEventListener('hashchange',function () { if (!/^#\/savings-game(?:\/|$)/.test(global.location.hash)) cleanup(); });
  global.SavingsGame = {mount:mount,cleanup:cleanup};
})(window);
