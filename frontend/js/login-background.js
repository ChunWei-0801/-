/* Shared account backgrounds. Original photos stay as IndexedDB Blobs;
   the application synchronises an optimised copy after signing in. */
(function (root) {
  'use strict';

  var KEY = 'fambudget.login-background.v1';
  var DB_NAME = 'fambudget-login-background';
  var STORE = 'photos';
  var defaults = { preset: 'dawn', fit: 'cover', x: 50, y: 50, brightness: 100, blur: 0, overlay: 25, photoId: '' };
  var presets = [
    { id: 'dawn', name: '紙上晨光', en: 'Paper Sunrise', description: '柔暖光暈與細緻紙紋' },
    { id: 'forest', name: '森林微風', en: 'Forest Breeze', description: '綠意漸層與自然光影' },
    { id: 'night', name: '星空暮色', en: 'Starry Dusk', description: '靛藍夜色與淡淡星點' },
    { id: 'custom', name: '自己的照片', en: 'Your Photo', description: '選擇相簿、檔案或拍照' }
  ];
  var state = Object.assign({}, defaults);
  var photo = null;
  var host = null;
  var cleanup = null;
  var initPromise = null;
  var dbPromise = null;
  var writes = Promise.resolve();
  var revision = 0;
  var busy = false;
  var notice = '';
  var metaWarning = '';
  var editSnapshot = null;

  function number(value, min, max, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  function normalize(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      preset: presets.some(function (p) { return p.id === value.preset; }) ? value.preset : defaults.preset,
      fit: ['cover', 'contain', 'tile', 'actual'].indexOf(value.fit) >= 0 ? value.fit : defaults.fit,
      x: number(value.x, 0, 100, defaults.x),
      y: number(value.y, 0, 100, defaults.y),
      brightness: number(value.brightness, 30, 150, defaults.brightness),
      blur: number(value.blur, 0, 16, defaults.blur),
      overlay: number(value.overlay, 0, 70, defaults.overlay),
      photoId: typeof value.photoId === 'string' && value.photoId.length < 100 ? value.photoId : ''
    };
  }

  try { state = normalize(JSON.parse(root.localStorage.getItem(KEY) || '{}')); }
  catch (error) { /* Restricted storage does not prevent using the controls. */ }

  function savePreferences() {
    if (editSnapshot) return;
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); metaWarning = ''; }
    catch (error) { metaWarning = '瀏覽器無法保存背景設定；設定仍可在本次開啟使用。'; }
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('IndexedDBUnavailable')); return; }
      var request;
      var done = false;
      var timer = root.setTimeout(function () {
        if (!done) { done = true; reject(new Error('StorageTimeout')); }
      }, 10000);
      function fail(error) {
        if (done) return;
        done = true;
        root.clearTimeout(timer);
        reject(error || new Error('StorageUnavailable'));
      }
      try { request = root.indexedDB.open(DB_NAME, 1); }
      catch (error) { fail(error); return; }
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onerror = function () { fail(request.error); };
      request.onblocked = function () { fail(new Error('StorageBlocked')); };
      request.onsuccess = function () {
        if (done) { request.result.close(); return; }
        done = true;
        root.clearTimeout(timer);
        var db = request.result;
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resolve(db);
      };
    });
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }

  function databaseOperation(mode, operation) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction;
        var request;
        var result;
        try {
          transaction = db.transaction(STORE, mode);
          request = operation(transaction.objectStore(STORE));
        } catch (error) { reject(error); return; }
        request.onsuccess = function () { result = request.result; };
        transaction.oncomplete = function () { resolve(result); };
        transaction.onerror = transaction.onabort = function () {
          reject(transaction.error || request.error || new Error('StorageUnavailable'));
        };
      });
    });
  }

  function queueWrite(operation) {
    var pending = writes.catch(function () {}).then(operation);
    writes = pending;
    return pending;
  }

  function decode(blob) {
    return new Promise(function (resolve, reject) {
      var url;
      try { url = root.URL.createObjectURL(blob); }
      catch (error) { reject(error); return; }
      var img = new root.Image();
      img.onload = function () {
        if (!img.naturalWidth || !img.naturalHeight) {
          root.URL.revokeObjectURL(url);
          reject(new Error('ImageDecodeError'));
          return;
        }
        resolve({ url: url, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = function () {
        root.URL.revokeObjectURL(url);
        reject(new Error('ImageDecodeError'));
      };
      img.src = url;
    });
  }

  function replacePhoto(next) {
    var previous = photo;
    photo = next;
    sync(); // Stop using the previous URL before releasing it.
    if (previous && previous.url !== (next && next.url) && (!editSnapshot || editSnapshot.photo !== previous)) root.URL.revokeObjectURL(previous.url);
  }

  function storageExplanation(error) {
    if (error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      return '瀏覽器儲存空間不足，照片改為本次開啟暫用。清出網站儲存空間後，可按「重試儲存」；重新整理前請保留原檔。';
    }
    return '此瀏覽器目前無法儲存照片，照片改為本次開啟暫用。可按「重試儲存」，或重新整理後再次選擇原檔。';
  }

  function initialize() {
    if (initPromise) return initPromise;
    var initialRevision = revision;
    initPromise = databaseOperation('readonly', function (store) { return store.get('custom'); })
      .then(function (saved) {
        if (initialRevision !== revision) return;
        if (!saved || !(saved.blob instanceof root.Blob) || saved.id !== state.photoId) {
          if (state.preset === 'custom') notice = '上次的照片未保留下來，先顯示紙上晨光。請重新選擇原檔。';
          return;
        }
        return decode(saved.blob).then(function (decoded) {
          if (initialRevision !== revision) { root.URL.revokeObjectURL(decoded.url); return; }
          replacePhoto({ blob: saved.blob, id: saved.id, name: saved.name || '自訂照片', url: decoded.url,
            width: decoded.width, height: decoded.height, stored: true });
        });
      }).catch(function () {
        if (initialRevision === revision && state.preset === 'custom') {
          notice = '無法讀取上次的照片，先顯示紙上晨光。請重新選擇原檔；其他背景仍可使用。';
        }
      }).then(function () { sync(); updatePanel(); });
    return initPromise;
  }

  function persistPhoto(target, token) {
    if (editSnapshot) { notice = '照片已載入預覽。按「套用主題」後保存。'; updatePanel(); return Promise.resolve(); }
    return queueWrite(function () {
      if (revision !== token || photo !== target) return;
      return databaseOperation('readwrite', function (store) {
        return store.put({ blob: target.blob, id: target.id, name: target.name, width: target.width, height: target.height }, 'custom');
      });
    }).then(function () {
      if (revision !== token || photo !== target) return;
      target.stored = true;
      notice = '照片已儲存在此瀏覽器，重新整理後仍可使用。';
      updatePanel();
    }).catch(function (error) {
      if (revision !== token || photo !== target) return;
      target.stored = false;
      notice = storageExplanation(error);
      updatePanel();
    });
  }

  function selectPhoto(file) {
    if (!file) return;
    var token = ++revision;
    busy = true;
    notice = '正在讀取照片…';
    updatePanel();
    // No application size limit: the browser decodes the original file.
    // Browser memory and storage availability are handled as fallbacks below.
    decode(file).then(function (decoded) {
      if (revision !== token) { root.URL.revokeObjectURL(decoded.url); return; }
      var id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      var next = { blob: file, id: id, name: file.name || '相機照片', url: decoded.url,
        width: decoded.width, height: decoded.height, stored: false };
      state.preset = 'custom';
      state.photoId = id;
      busy = false;
      notice = '照片已套用，正在保存至此瀏覽器…';
      replacePhoto(next);
      savePreferences();
      updatePanel();
      return persistPhoto(next, token);
    }).catch(function () {
      if (revision !== token) return;
      busy = false;
      notice = '這張照片無法由瀏覽器開啟。請選擇可讀取的 JPEG、PNG、WebP 或其他支援的圖片；原本背景仍可使用。';
      updatePanel();
    });
  }

  function removePhoto(reset) {
    var token = ++revision;
    busy = false;
    if (reset) state = Object.assign({}, defaults);
    else if (state.preset === 'custom') state.preset = 'dawn';
    state.photoId = '';
    replacePhoto(null);
    savePreferences();
    notice = reset ? '已恢復紙上晨光及預設設定。' : '已移除自訂照片，改用紙上晨光。';
    updatePanel();
    if (editSnapshot) return;
    queueWrite(function () {
      return databaseOperation('readwrite', function (store) { return store.delete('custom'); });
    }).catch(function () {
      if (revision !== token) return;
      notice += ' 瀏覽器未能刪除儲存的照片；可在瀏覽器網站設定清除本站資料。';
      updatePanel();
    });
  }

  function sync() {
    if (!root.document.body) return;
    var body = root.document.body;
    body.dataset.loginbackground = state.preset === 'custom' && !photo ? 'dawn' : state.preset;
    body.style.setProperty('--login-bg-photo', photo ? 'url("' + photo.url + '")' : 'none');
    body.style.setProperty('--login-bg-fit', state.fit === 'tile' || state.fit === 'actual' ? 'auto' : state.fit);
    body.style.setProperty('--login-bg-repeat', state.fit === 'tile' ? 'repeat' : 'no-repeat');
    body.style.setProperty('--login-bg-position', state.x + '% ' + state.y + '%');
    body.style.setProperty('--login-bg-brightness', String(state.brightness / 100));
    body.style.setProperty('--login-bg-blur', state.blur + 'px');
    body.style.setProperty('--login-bg-overlay', String(state.overlay / 100));
  }

  function slider(id, label, min, max, step, left, right) {
    return '<label class="login-bg__slider"><span>' + label + '<output data-lbg-output="' + id + '"></output></span>' +
      '<input type="range" data-lbg-setting="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '">' +
      '<small><span>' + left + '</span><span>' + right + '</span></small></label>';
  }

  function markup() {
    return '<details class="login-bg"><summary><span>全站背景 <small lang="en">Shared background</small></span>' +
      '<span class="login-bg__summary-name" data-lbg-current></span></summary><div class="login-bg__panel">' +
      '<p class="login-bg__intro">在這裡瀏覽背景並即時預覽；按「套用主題」後，登入頁與登入後的每個頁面會使用同一個背景。</p>' +
      '<fieldset class="login-bg__presets"><legend>選擇背景</legend>' + presets.map(function (preset) {
        return '<label class="login-bg__preset"><input type="radio" name="login-background" value="' + preset.id + '" data-lbg-preset>' +
          '<span class="login-bg__thumb login-bg__thumb--' + preset.id + '" aria-hidden="true">' + (preset.id === 'custom' ? '＋' : '') + '</span>' +
          '<span><b>' + preset.name + '</b><small lang="en">' + preset.en + '</small><small>' + preset.description + '</small></span></label>';
      }).join('') + '</fieldset>' +
      '<section class="login-bg__photo" data-lbg-custom hidden aria-label="自訂照片">' +
        '<div class="login-bg__upload"><label class="login-bg__file">選擇照片<input type="file" accept="image/*" data-lbg-file aria-label="選擇自訂背景照片"></label>' +
        '<label class="login-bg__file login-bg__file--camera">拍照<input type="file" accept="image/*" capture="environment" data-lbg-file aria-label="拍照作為全站背景"></label></div>' +
        '<p class="login-bg__photo-info" data-lbg-photo-info data-i18n-skip></p>' +
        '<p class="login-bg__help">本功能不設原始檔案大小上限。照片原檔保存在此瀏覽器；登入後會同步適合瀏覽的壓縮版本，方便其他裝置使用。可用容量與格式仍取決於裝置及瀏覽器。</p>' +
        '<label class="login-bg__select">照片顯示方式<select data-lbg-setting="fit">' +
          '<option value="cover">填滿畫面 · Cover（可能裁切）</option><option value="contain">完整顯示 · Contain（保留全圖）</option>' +
          '<option value="tile">重複鋪排 · Tile</option><option value="actual">原始尺寸 · Actual size</option></select></label>' +
        '<div class="login-bg__sliders">' + slider('x', '左右位置', 0, 100, 1, '靠左', '靠右') + slider('y', '上下位置', 0, 100, 1, '靠上', '靠下') + '</div>' +
        '<p class="login-bg__help">位置滑桿控制圖片在可用空間中的對齊；填滿畫面時，也能調整被裁切的區域。原始尺寸使用瀏覽器辨識的圖片像素。</p>' +
        '<div class="login-bg__photo-actions"><button type="button" data-lbg-retry hidden>重試儲存</button>' +
        '<button type="button" data-lbg-remove hidden>移除照片</button></div></section>' +
      '<fieldset class="login-bg__adjust"><legend>調整氛圍</legend><div class="login-bg__sliders">' +
        slider('brightness', '背景亮度', 30, 150, 1, '較暗', '較亮') + slider('blur', '背景模糊', 0, 16, 1, '清晰', '柔焦') +
        slider('overlay', '主題色遮罩', 0, 70, 1, '原色', '柔和') + '</div></fieldset>' +
      '<p class="login-bg__status" data-lbg-status role="status" aria-live="polite"></p>' +
      '<button class="login-bg__reset" type="button" data-lbg-reset>恢復預設</button>' +
      '<p class="login-bg__help">套用恢復預設後會清除背景照片並重設滑桿。換裝置登入可載入同步版本；原始檔仍需保留自己的備份。</p>' +
      '</div></details>';
  }

  function updatePanel() {
    if (!host || !host.isConnected) return;
    host.querySelector('[data-lbg-current]').textContent = presets.find(function (p) { return p.id === state.preset; }).name;
    host.querySelectorAll('[data-lbg-preset]').forEach(function (radio) { radio.checked = radio.value === state.preset; });
    host.querySelector('[data-lbg-custom]').hidden = state.preset !== 'custom';
    host.querySelectorAll('[data-lbg-setting]').forEach(function (input) {
      var key = input.dataset.lbgSetting;
      input.value = state[key];
      var output = host.querySelector('[data-lbg-output="' + key + '"]');
      if (output) output.textContent = state[key] + (key === 'blur' ? ' px' : '%');
      if (key !== 'fit') input.setAttribute('aria-valuetext', state[key] + (key === 'blur' ? ' 像素' : ' 百分比'));
    });
    host.querySelectorAll('[data-lbg-file]').forEach(function (input) { input.disabled = busy; });
    host.querySelector('[data-lbg-photo-info]').textContent = photo
      ? photo.name + ' · ' + photo.width + ' × ' + photo.height + ' · ' + (photo.blob.size / 1024 / 1024).toLocaleString('zh-TW', { maximumFractionDigits: 2 }) + ' MB · ' + (photo.stored ? '已保存在此瀏覽器' : '本次開啟暫用')
      : '尚未選擇照片，先顯示紙上晨光。';
    host.querySelector('[data-lbg-retry]').hidden = !photo || photo.stored;
    host.querySelector('[data-lbg-retry]').disabled = busy;
    host.querySelector('[data-lbg-remove]').hidden = !photo;
    host.querySelector('[data-lbg-status]').textContent = [notice, metaWarning].filter(Boolean).join(' ');
  }

  function unmount() {
    if (editSnapshot) cancelEdit();
    if (cleanup) cleanup();
    cleanup = null;
    host = null;
    // Keep the photo URL alive while another route can reuse the same photo.
  }

  function mount(container, options) {
    var element = typeof container === 'string' ? root.document.querySelector(container) : container;
    if (!element) return null;
    unmount();
    host = element;
    if (options && options.preview) editSnapshot = { state: Object.assign({}, state), photo: photo };
    host.innerHTML = markup();
    if (options && options.preview) host.querySelector('details').open = true;
    function change(event) {
      var input = event.target;
      if (input.hasAttribute('data-lbg-preset')) {
        state.preset = input.value;
        notice = state.preset === 'custom' && !photo ? '選擇一張自己的照片，下方可調整顯示方式。' : '';
        savePreferences(); sync(); updatePanel();
      } else if (input.hasAttribute('data-lbg-file')) {
        selectPhoto(input.files && input.files[0]);
        input.value = ''; // Selecting the same image again remains possible.
      } else if (input.hasAttribute('data-lbg-setting')) {
        state = normalize(Object.assign({}, state, { [input.dataset.lbgSetting]: input.value }));
        savePreferences(); sync(); updatePanel();
      }
    }
    function slide(event) {
      if (event.target.matches('input[type="range"][data-lbg-setting]')) change(event);
    }
    function click(event) {
      var button = event.target.closest('button');
      if (!button || !element.contains(button)) return;
      if (button.hasAttribute('data-lbg-reset')) removePhoto(true);
      if (button.hasAttribute('data-lbg-remove')) removePhoto(false);
      if (button.hasAttribute('data-lbg-retry') && photo) {
        notice = '正在重試保存照片…'; updatePanel(); persistPhoto(photo, revision);
      }
    }
    element.addEventListener('change', change);
    element.addEventListener('input', slide);
    element.addEventListener('click', click);
    cleanup = function () {
      element.removeEventListener('change', change);
      element.removeEventListener('input', slide);
      element.removeEventListener('click', click);
    };
    sync(); updatePanel(); initialize();
    return element.querySelector('.login-bg');
  }


  function cancelEdit() {
    if (!editSnapshot) return;
    var old = editSnapshot;
    editSnapshot = null;
    ++revision;
    busy = false;
    state = old.state;
    replacePhoto(old.photo);
    notice = '';
    sync();
  }

  function commitEdit() {
    var old = editSnapshot;
    editSnapshot = null;
    savePreferences();
    if (old && old.photo && old.photo !== photo) root.URL.revokeObjectURL(old.photo.url);
    if (photo) return persistPhoto(photo, revision);
    return queueWrite(function () {
      return databaseOperation('readwrite', function (store) { return store.delete('custom'); });
    }).catch(function () {});
  }

  function importPreferences(value) {
    if (!value || editSnapshot) return;
    // The original photograph is device-local. Preserve its id on this device.
    state = normalize(Object.assign({}, value, { photoId: state.photoId }));
    savePreferences(); sync(); updatePanel(); initialize();
  }

  function clearAccountPhoto() {
    if (editSnapshot) return Promise.resolve();
    ++revision;
    busy = false;
    state.photoId = '';
    replacePhoto(null);
    savePreferences(); updatePanel();
    // Retain the selected preset while the next account's private photo loads.
    return queueWrite(function () {
      return databaseOperation('readwrite', function (store) { return store.delete('custom'); });
    }).catch(function () {});
  }

  root.LoginBackground = {
    mount: mount,
    sync: sync,
    unmount: unmount,
    ready: initialize,
    commit: commitEdit,
    cancel: cancelEdit,
    clearPhoto: clearAccountPhoto,
    importPreferences: importPreferences,
    getPhotoBlob: function () { return photo && photo.blob; },
    importPhoto: function (blob) {
      if (editSnapshot || !blob) return Promise.resolve();
      var token = ++revision;
      return decode(blob).then(function (decoded) {
        if (revision !== token) { root.URL.revokeObjectURL(decoded.url); return; }
        var id = 'account-' + Date.now().toString(36);
        state.photoId = id;
        var next = { blob: blob, id: id, name: '帳號背景照片', url: decoded.url, width: decoded.width, height: decoded.height, stored: false };
        replacePhoto(next); savePreferences(); return persistPhoto(next, token);
      });
    },
    getState: function () {
      return Object.assign({}, state, { hasPhoto: !!photo, photoStorage: photo ? (photo.stored ? 'saved' : 'temporary') : 'none' });
    }
  };
})(window);
