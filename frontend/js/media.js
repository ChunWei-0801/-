/* Authenticated transaction photographs. Original files stay on this device until
   the user confirms a transaction or explicitly uploads to an existing record. */
(function (global) {
  'use strict';
  var pending = [], retries = {}, wrapInstalled = false, preparing = 0, selectionRevision = 0;
  var dialog = null, dialogUrls = [], activeId = null, activeEditable = false;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function t(key, fallback) { return global.I18n && global.I18n.t ? global.I18n.t(key, fallback) : fallback; }
  function api(path, options) {
    if (!global.API || global.API.mode !== 'http') return Promise.reject(new Error(t('media.realBackend', '相片需要連接正式資料服務，請先登入。')));
    if (typeof global.API.fetchMedia !== 'function') return Promise.reject(new Error(t('media.reload', '相片服務正在更新，請重新整理後再試。')));
    return global.API.fetchMedia(path, options || {});
  }
  function json(path, options) { return api(path, options).then(function (response) { return response.status === 204 ? null : response.json(); }); }
  function imageURL(path) { return api(path).then(function (r) { return r.blob(); }).then(function (blob) { return URL.createObjectURL(blob); }); }
  function message(error) { return error && error.message ? error.message : t('media.failed', '操作未完成，請稍後再試。'); }
  function decode(file) {
    if (global.createImageBitmap) return global.createImageBitmap(file).catch(function () { return decodeWithImage(file); });
    return decodeWithImage(file);
  }
  function decodeWithImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error(t('media.invalidImage', '無法讀取這張相片，請選擇 JPG、PNG 或 WebP。'))); };
      img.src = url;
    });
  }
  function preparePhoto(file) {
    if (!file || !file.size || (file.type && !/^image\//.test(file.type))) return Promise.reject(new Error(t('media.invalidImage', '無法讀取這張相片，請選擇 JPG、PNG 或 WebP。')));
    return decode(file).then(function (bitmap) {
      var width = bitmap.width || bitmap.naturalWidth, height = bitmap.height || bitmap.naturalHeight;
      if (!width || !height) throw new Error(t('media.invalidImage', '無法讀取這張相片，請選擇 JPG、PNG 或 WebP。'));
      var ratio = Math.min(1, 1920 / Math.max(width, height)), canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
      var ctx = canvas.getContext('2d');
      if (!ctx) { if (bitmap.close) bitmap.close(); throw new Error(t('media.invalidImage', '無法讀取這張相片，請選擇 JPG、PNG 或 WebP。')); }
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (bitmap.close) bitmap.close();
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          canvas.width = canvas.height = 1;
          if (!blob) { reject(new Error(t('media.invalidImage', '無法讀取這張相片，請選擇 JPG、PNG 或 WebP。'))); return; }
          resolve(new File([blob], 'memory-photo.jpg', {type:'image/jpeg'}));
        }, 'image/jpeg', 0.86);
      });
    });
  }
  function prepareSquarePhoto(file) {
    return preparePhoto(file).then(decode).then(function (bitmap) {
      var width = bitmap.width || bitmap.naturalWidth, height = bitmap.height || bitmap.naturalHeight;
      var side = Math.min(width, height), canvas = document.createElement('canvas'); canvas.width = canvas.height = side;
      canvas.getContext('2d').drawImage(bitmap, (width - side) / 2, (height - side) / 2, side, side, 0, 0, side, side);
      if (bitmap.close) bitmap.close();
      return new Promise(function (resolve, reject) { canvas.toBlob(function (blob) { canvas.width = canvas.height = 1; if (blob) resolve(new File([blob], 'puzzle-photo.jpg', {type:'image/jpeg'})); else reject(new Error(t('media.invalidImage', '無法讀取這張相片，請選擇 JPG、PNG 或 WebP。'))); }, 'image/jpeg', 0.9); });
    });
  }
  function upload(id, file) {
    var body = new FormData(); body.append('file', file, file.name || 'memory-photo.jpg');
    return json('/api/transactions/' + encodeURIComponent(id) + '/photos', {method:'POST', body:body});
  }
  function revokeDialogUrls() { dialogUrls.forEach(function (url) { URL.revokeObjectURL(url); }); dialogUrls = []; }
  function closeDialog() {
    revokeDialogUrls(); activeId = null;
    if (dialog) { if (dialog.open && dialog.close) dialog.close(); dialog.remove(); dialog = null; }
  }
  function status(text, error) {
    if (!dialog) return;
    var node = dialog.querySelector('[data-media-status]');
    node.textContent = text || ''; node.classList.toggle('is-error', !!error);
  }
  function notice(text, id) {
    var node = document.getElementById('mediaNotice');
    if (!node) { node = document.createElement('div'); node.id = 'mediaNotice'; node.className = 'media-notice'; node.setAttribute('role', 'status'); document.body.appendChild(node); }
    node.innerHTML = '<span>' + esc(text) + '</span>' + (id ? '<button class="btn btn--sm" data-transaction-photo="' + esc(id) + '" data-media-can-edit="true">' + esc(t('media.retryPhotos', '查看／重試相片')) + '</button>' : '') + '<button class="media-close" type="button" aria-label="' + esc(t('media.close', '關閉')) + '" data-media-notice-close>×</button>';
  }
  function renderGallery() {
    if (!dialog || !activeId) return Promise.resolve();
    var id = activeId, currentDialog = dialog;
    revokeDialogUrls(); status(t('media.loading', '正在讀取相片…'));
    currentDialog.querySelector('[data-media-gallery]').innerHTML = '';
    return json('/api/transactions/' + encodeURIComponent(id) + '/photos').then(function (data) {
      if (dialog !== currentDialog) return;
      var photos = data.photos || [], max = data.maxPhotos || 4;
      currentDialog.dataset.photoCount = String(photos.length); currentDialog.dataset.maxPhotos = String(max);
      var gallery = currentDialog.querySelector('[data-media-gallery]');
      if (!photos.length) gallery.innerHTML = '<p class="media-empty">' + esc(t('media.empty', '還沒有相片。留下購買當下、收據或和家人一起的回憶。')) + '</p>';
      photos.forEach(function (photo) {
        var card = document.createElement('figure'); card.className = 'media-photo';
        card.innerHTML = '<div class="media-photo__image" aria-busy="true"><span>' + esc(t('media.loading', '正在讀取相片…')) + '</span></div>' +
          '<figcaption>' + (activeEditable ? '<button class="btn btn--sm" data-media-delete="' + esc(photo.id) + '">' + esc(t('media.removePhoto', '移除相片')) + '</button>' : esc(t('media.readOnly', '僅供檢視'))) + '</figcaption>';
        gallery.appendChild(card);
        imageURL(photo.url).then(function (url) {
          if (dialog !== currentDialog) { URL.revokeObjectURL(url); return; }
          dialogUrls.push(url);
          card.querySelector('.media-photo__image').innerHTML = '<a href="' + esc(url) + '" target="_blank" rel="noopener" aria-label="' + esc(t('media.fullSize', '開啟完整相片')) + '"><img src="' + esc(url) + '" alt="' + esc(t('media.transactionPhoto', '這筆記帳的回憶相片')) + '"></a>';
        }).catch(function (error) { if (dialog === currentDialog) card.querySelector('.media-photo__image').textContent = message(error); });
      });
      var uploadBox = currentDialog.querySelector('[data-media-upload-box]');
      uploadBox.hidden = !activeEditable || photos.length >= max;
      currentDialog.querySelector('[data-media-count]').textContent = photos.length + ' / ' + max;
      status(photos.length >= max ? t('media.full', '這筆記帳已存滿 4 張相片；可先移除再新增。') : '');
      var retry = currentDialog.querySelector('[data-media-retry-pending]');
      retry.hidden = !retries[id] || !retries[id].length || !activeEditable;
    }).catch(function (error) {
      if (dialog === currentDialog) { status(message(error), true); currentDialog.querySelector('[data-media-gallery]').innerHTML = '<button class="btn" data-media-refresh>' + esc(t('media.retry', '重新讀取')) + '</button>'; }
    });
  }
  function openDialog(id, editable) {
    closeDialog(); activeId = id; activeEditable = editable;
    dialog = document.createElement('dialog'); dialog.className = 'media-dialog';
    dialog.setAttribute('aria-labelledby', 'mediaTitle');
    dialog.innerHTML = '<div class="media-dialog__head"><div><p class="media-eyebrow">' + esc(t('media.memory', '留住生活回憶')) + '</p><h2 id="mediaTitle">' + esc(t('media.recordPhotos', '記帳相片')) + ' <small data-media-count></small></h2></div><button class="media-close" data-media-close aria-label="' + esc(t('media.close', '關閉')) + '">×</button></div>' +
      '<p class="media-help">' + esc(t('media.savedOnAccount', '相片會儲存於你的帳號，只有有權查看這筆記帳的人能讀取。每筆最多 4 張；系統保存適合瀏覽的壓縮版本。')) + '</p>' +
      '<div class="media-actions" data-media-upload-box' + (editable ? '' : ' hidden') + '><label class="btn media-file-label" tabindex="0" role="button"><span>' + esc(t('media.browse', '選擇相片')) + '</span><input type="file" accept="image/*" multiple data-media-upload hidden></label><label class="btn media-file-label" tabindex="0" role="button"><span>' + esc(t('media.camera', '拍照')) + '</span><input type="file" accept="image/*" capture="environment" data-media-upload hidden></label></div>' +
      '<button class="btn" data-media-retry-pending hidden>' + esc(t('media.retrySelected', '重新上傳剛才的相片')) + '</button>' +
      '<p class="media-status" data-media-status role="status" aria-live="polite"></p><div class="media-gallery" data-media-gallery></div>';
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) closeDialog(); });
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    renderGallery();
  }
  async function uploadFiles(files, alreadyPrepared) {
    if (!dialog || !activeId || !activeEditable || dialog.dataset.busy === 'true') return;
    var id = activeId, currentDialog = dialog;
    var available = Number(dialog.dataset.maxPhotos || 4) - Number(dialog.dataset.photoCount || 0);
    if (files.length > available) { status(t('media.tooMany', '每筆最多 4 張相片，請減少這次選擇的數量。'), true); return; }
    dialog.dataset.busy = 'true';
    currentDialog.querySelectorAll('input,button:not([data-media-close])').forEach(function (el) { el.disabled = true; });
    var unsent = [], uploaded = 0;
    try {
      for (var i = 0; i < files.length; i++) {
        status(t('media.saving', '正在整理並儲存相片…') + ' ' + (i + 1) + ' / ' + files.length);
        try { var file = alreadyPrepared ? files[i] : await preparePhoto(files[i]); await upload(id, file); uploaded++; }
        catch (error) { unsent = files.slice(i); throw error; }
      }
      delete retries[id];
      if (alreadyPrepared) { var banner = document.getElementById('mediaNotice'); if (banner && banner.querySelector('[data-transaction-photo="' + id + '"]')) banner.remove(); }
      await renderGallery(); status(t('media.saved', '相片已儲存。'));
    } catch (error) {
      // Prepared files from a failed post-transaction upload remain retryable.
      if (alreadyPrepared) retries[id] = unsent;
      if (uploaded) await renderGallery();
      status(message(error) + ' ' + t('media.retrySafe', '已成功的相片會保留，請重新選擇尚未儲存的相片再試。'), true);
    } finally {
      if (dialog === currentDialog) { dialog.dataset.busy = 'false'; dialog.querySelectorAll('input,button').forEach(function (el) { el.disabled = false; }); }
    }
  }
  function pendingHTML() {
    return '<div class="media-entry" data-media-entry><h3>' + esc(t('media.optionalPhotos', '回憶相片（選填）')) + '</h3><p>' + esc(t('media.entryHelp', '可從相簿挑選或直接拍照。記帳確認寫入後才會上傳，最多 4 張。')) + '</p><div class="media-actions"><label class="btn btn--sm media-file-label" tabindex="0" role="button">' + esc(t('media.browse', '選擇相片')) + '<input type="file" accept="image/*" multiple data-media-pending hidden></label><label class="btn btn--sm media-file-label" tabindex="0" role="button">' + esc(t('media.camera', '拍照')) + '<input type="file" accept="image/*" capture="environment" data-media-pending hidden></label></div><div class="media-pending" data-media-pending-list></div><p class="media-status" data-media-pending-status role="status"></p></div>';
  }
  function paintPending() {
    var list = document.querySelector('[data-media-pending-list]'); if (!list) return;
    list.innerHTML = '';
    pending.forEach(function (item, index) {
      var card = document.createElement('div'); card.className = 'media-pending__item';
      card.innerHTML = '<img src="' + esc(item.url) + '" alt="' + esc(t('media.selectedPhoto', '待儲存相片')) + '"><button type="button" class="media-close" data-media-pending-remove="' + index + '" aria-label="' + esc(t('media.removePhoto', '移除相片')) + '">×</button>';
      list.appendChild(card);
    });
  }
  function installCreateHook() {
    if (wrapInstalled || !global.API || !global.API.createTransaction) return;
    wrapInstalled = true;
    var create = global.API.createTransaction;
    global.API.createTransaction = function () {
      if (preparing) return Promise.reject(new Error(t('media.preparing', '正在整理相片，請稍候…')));
      var args = arguments, selected = pending.slice(), revision = selectionRevision;
      // Remove only after creation succeeds, so a rejected transaction keeps its photos.
      return create.apply(global.API, args).then(async function (record) {
        if (!selected.length) return record;
        if (revision !== selectionRevision) { selected.forEach(function (item) { URL.revokeObjectURL(item.url); }); return record; }
        pending = pending.filter(function (item) { return selected.indexOf(item) < 0; });
        var remaining = selected.map(function (item) { return item.file; });
        try {
          for (var i = 0; i < selected.length; i++) { if (revision !== selectionRevision) break; await upload(record.id, selected[i].file); remaining.shift(); }
          if (revision === selectionRevision) notice(t('media.savedWithRecord', '記帳與回憶相片已儲存。'), record.id);
        } catch (error) {
          if (revision === selectionRevision) { retries[record.id] = remaining; notice(t('media.recordSavedPhotosFailed', '記帳已成功，部分相片未儲存；請查看／重試相片，無需再記一筆。') + ' ' + message(error), record.id); }
        }
        selected.forEach(function (item) { URL.revokeObjectURL(item.url); });
        return record;
      });
    };
  }
  function mountEntryHook(root) {
    installCreateHook(); root = root || document;
    var save = root.querySelector('#singleSave');
    if (save && !root.querySelector('[data-media-entry]')) {
      save.closest('.prs__a').insertAdjacentHTML('beforebegin', pendingHTML()); paintPending();
    }
    var paragraph = root.querySelector('#paraText');
    if (paragraph && !root.querySelector('[data-media-paragraph-help]')) paragraph.insertAdjacentHTML('afterend', '<p class="media-help" data-media-paragraph-help>' + esc(t('media.paragraphHelp', '想替文字解析的每筆記帳留相片？確認寫入後，在下方明細按「相片」即可逐筆拍照或選圖。')) + '</p>');
  }
  function mountRecordButtons(root) {
    root = root || document;
    root.querySelectorAll('[data-transaction-id]').forEach(function (row) {
      if (row.querySelector('[data-transaction-photo]')) return;
      var cell = row.querySelector('.txr__t') || row;
      var button = document.createElement('button'); button.type = 'button'; button.className = 'media-record-btn';
      button.dataset.transactionPhoto = row.dataset.transactionId; button.dataset.mediaCanEdit = row.dataset.mediaEditable || 'false';
      button.textContent = '▧ ' + t('media.photos', '相片'); cell.appendChild(button);
    });
  }
  document.addEventListener('click', async function (event) {
    var target = event.target.closest('button,[data-transaction-photo]'); if (!target) return;
    if (target.hasAttribute('data-transaction-photo')) { event.preventDefault(); openDialog(target.dataset.transactionPhoto, target.dataset.mediaCanEdit === 'true'); return; }
    if (target.hasAttribute('data-media-close')) { closeDialog(); return; }
    if (target.hasAttribute('data-media-notice-close')) { target.closest('.media-notice').remove(); return; }
    if (target.id === 'singleClear') { selectionRevision++; pending.forEach(function (item) { URL.revokeObjectURL(item.url); }); pending = []; paintPending(); return; }
    if (target.hasAttribute('data-media-refresh')) { renderGallery(); return; }
    if (target.hasAttribute('data-media-retry-pending')) { uploadFiles(retries[activeId] || [], true); return; }
    if (target.hasAttribute('data-media-pending-remove')) {
      var removed = pending.splice(Number(target.dataset.mediaPendingRemove), 1)[0]; if (removed) URL.revokeObjectURL(removed.url); paintPending(); return;
    }
    if (target.hasAttribute('data-media-delete') && dialog && activeEditable) {
      if (!global.confirm(t('media.confirmRemove', '確定移除這張相片？這筆記帳仍會保留。'))) return;
      target.disabled = true;
      try { await api('/api/transaction-photos/' + encodeURIComponent(target.dataset.mediaDelete), {method:'DELETE'}); await renderGallery(); }
      catch (error) { status(message(error), true); target.disabled = false; }
    }
  });
  document.addEventListener('keydown', function (event) {
    if ((event.key !== 'Enter' && event.key !== ' ') || !event.target.matches('.media-file-label')) return;
    event.preventDefault(); var input = event.target.querySelector('input[type="file"]'); if (input && !input.disabled) input.click();
  });
  document.addEventListener('change', async function (event) {
    var input = event.target;
    if (input.hasAttribute('data-media-upload')) { var files = Array.from(input.files || []); input.value = ''; if (files.length) await uploadFiles(files); }
    if (input.hasAttribute('data-media-pending')) {
      var selected = Array.from(input.files || []); input.value = '';
      var feedback = document.querySelector('[data-media-pending-status]');
      if (pending.length + selected.length > 4) { if (feedback) feedback.textContent = t('media.tooMany', '每筆最多 4 張相片，請減少這次選擇的數量。'); return; }
      preparing++;
      var revision = selectionRevision;
      var save = document.getElementById('singleSave'); if (save) save.disabled = true;
      input.closest('[data-media-entry]').querySelectorAll('input').forEach(function (node) { node.disabled = true; });
      if (feedback) feedback.textContent = t('media.preparing', '正在整理相片，請稍候…');
      try {
        for (var i = 0; i < selected.length; i++) { var file = await preparePhoto(selected[i]); if (revision !== selectionRevision) break; pending.push({file:file, url:URL.createObjectURL(file)}); }
        paintPending(); if (feedback) feedback.textContent = t('media.pendingReady', '相片準備完成，會隨下一筆手動記帳儲存。');
      } catch (error) { if (feedback) feedback.textContent = message(error); paintPending(); }
      finally { preparing--; var box = document.querySelector('[data-media-entry]'); if (box) box.querySelectorAll('input').forEach(function (node) { node.disabled = false; }); var save = document.getElementById('singleSave'); if (save && save.dataset.pending !== '1') save.disabled = false; }
    }
  });
  global.addEventListener('hashchange', function () {
    if (!/^#\/(?:login|register)(?:\/|$)/.test(global.location.hash)) return;
    selectionRevision++;
    pending.forEach(function (item) { URL.revokeObjectURL(item.url); }); pending = []; retries = {}; closeDialog();
    var notice = document.getElementById('mediaNotice'); if (notice) notice.remove();
  });
  global.MediaTools = {esc:esc, t:t, api:api, json:json, imageURL:imageURL, preparePhoto:preparePhoto, prepareSquarePhoto:prepareSquarePhoto, message:message};
  global.TransactionMedia = {mountRecordButtons:mountRecordButtons, mountEntryHook:mountEntryHook, open:openDialog};
})(window);
