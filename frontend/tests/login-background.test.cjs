// Functional coverage for IndexedDB photos, storage fallback and route scope.
// PLAYWRIGHT_MODULE=/opt/codex/cua_node/lib/node_modules/playwright \
// CHROMIUM_EXECUTABLE=/usr/bin/chromium node frontend/tests/login-background.test.cjs
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const frontBase = (process.env.FAMBUDGET_URL || 'http://127.0.0.1:5174').replace(/\/$/, '');
const harness = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/themes.css"><link rel="stylesheet" href="/css/login-background.css"></head>
<body class="is-out login-background-on"><div class="app"><main class="main"><div id="view"><div class="gate"><div class="gate__c"><h1>登入</h1>
<label>Email<input type="email"></label><div class="login-bg-slot" id="slot"></div></div></div></div></main></div>
<script src="/js/login-background.js"></script><script>LoginBackground.mount('#slot')</script></body></html>`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      const revoke = URL.revokeObjectURL.bind(URL);
      window.revokedBackgroundUrls = [];
      URL.revokeObjectURL = url => { window.revokedBackgroundUrls.push(url); revoke(url); };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__login-background-test__', route => route.fulfill({ contentType: 'text/html', body: harness }));
    await page.goto(frontBase + '/__login-background-test__');
    await page.evaluate(() => LoginBackground.ready());
    await page.locator('.login-bg summary').click();
    assert.equal(await page.locator('[data-lbg-preset]').count(), 4);
    for (const preset of ['dawn', 'forest', 'night']) {
      await page.locator(`[data-lbg-preset][value="${preset}"]`).check();
      assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), preset);
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage), 'none');
    }
    await page.locator('[data-lbg-preset][value="custom"]').check();
    // A real, randomly textured PNG comfortably over historical 5 MB limits.
    const original = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600; canvas.height = 1600;
      const context = canvas.getContext('2d');
      const pixels = context.createImageData(canvas.width, canvas.height);
      for (let offset = 0; offset < pixels.data.length; offset += 65536) {
        crypto.getRandomValues(pixels.data.subarray(offset, Math.min(offset + 65536, pixels.data.length)));
      }
      for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
      context.putImageData(pixels, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'large-original.png', { type: 'image/png' }));
      const input = document.querySelector('[data-lbg-file]');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { size: blob.size, hash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') };
    });
    assert.ok(original.size > 5 * 1024 * 1024);
    await page.waitForFunction(() => LoginBackground.getState().photoStorage === 'saved');
    assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), 'custom');
    const stored = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('fambudget-login-background', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const saved = await new Promise((resolve, reject) => { const r = db.transaction('photos').objectStore('photos').get('custom'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      db.close();
      const digest = await crypto.subtle.digest('SHA-256', await saved.blob.arrayBuffer());
      return { size: saved.blob.size, hash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''), width: saved.width, height: saved.height };
    });
    assert.deepEqual(stored, { ...original, width: 1600, height: 1600 });
    assert.ok(await page.evaluate(() => localStorage.getItem('fambudget.login-background.v1').length < 1000));
    await page.locator('[data-lbg-setting="fit"]').selectOption('contain');
    await page.locator('[data-lbg-setting="x"]').evaluate(input => { input.value = 12; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('[data-lbg-setting="brightness"]').evaluate(input => { input.value = 75; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('[data-lbg-setting="blur"]').evaluate(input => { input.value = 4; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.reload();
    await page.evaluate(() => LoginBackground.ready());
    const restored = await page.evaluate(() => LoginBackground.getState());
    assert.equal(restored.photoStorage, 'saved'); assert.equal(restored.fit, 'contain'); assert.equal(restored.x, 12); assert.equal(restored.brightness, 75); assert.equal(restored.blur, 4);
    await page.locator('.login-bg summary').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // Repainting and remounting retain the current object URL and preferences.
    await page.evaluate(() => { LoginBackground.unmount(); document.querySelector('#slot').innerHTML = ''; LoginBackground.mount('#slot'); });
    assert.equal(await page.evaluate(() => LoginBackground.getState().photoStorage), 'saved');
    await page.locator('.login-bg summary').click();
    await page.locator('[data-lbg-setting="fit"]').selectOption('tile');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundRepeat), 'repeat');
    await page.locator('[data-lbg-setting="fit"]').selectOption('actual');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundRepeat), 'no-repeat');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundSize), 'auto');
    const activeUrl = await page.evaluate(() => document.body.style.getPropertyValue('--login-bg-photo').slice(5, -2));
    assert.equal(await page.evaluate(url => revokedBackgroundUrls.includes(url), activeUrl), false);
    await page.evaluate(() => document.body.classList.remove('login-background-on'));
    assert.equal(await page.evaluate(() => getComputedStyle(document.body, '::before').content), 'none');
    await page.evaluate(() => document.body.classList.add('login-background-on'));
    // A decode failure preserves the usable current image.
    await page.locator('[data-lbg-file]').first().setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid PNG') });
    await page.waitForFunction(() => document.querySelector('[data-lbg-status]').textContent.includes('無法由瀏覽器開啟'));
    assert.equal(await page.evaluate(() => LoginBackground.getState().photoStorage), 'saved');
    assert.equal(await page.evaluate(url => revokedBackgroundUrls.includes(url), activeUrl), false);
    // Quota failure keeps the new image temporary and never restores the older image on reload.
    await page.evaluate(() => {
      const originalPut = IDBObjectStore.prototype.put;
      window.restorePut = () => { IDBObjectStore.prototype.put = originalPut; };
      IDBObjectStore.prototype.put = function () { throw new DOMException('Full', 'QuotaExceededError'); };
    });
    const onePixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await page.locator('[data-lbg-file]').first().setInputFiles({ name: 'temporary.png', mimeType: 'image/png', buffer: onePixel });
    await page.waitForFunction(() => LoginBackground.getState().photoStorage === 'temporary' && document.querySelector('[data-lbg-status]').textContent.includes('儲存空間不足'));
    assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), 'custom');
    assert.equal(await page.locator('[data-lbg-retry]').isVisible(), true);
    assert.equal(await page.evaluate(url => revokedBackgroundUrls.includes(url), activeUrl), true);
    const temporaryUrl = await page.evaluate(() => document.body.style.getPropertyValue('--login-bg-photo').slice(5, -2));
    assert.equal(await page.evaluate(url => revokedBackgroundUrls.includes(url), temporaryUrl), false);
    await page.evaluate(() => restorePut());
    await page.locator('[data-lbg-retry]').click();
    await page.waitForFunction(() => LoginBackground.getState().photoStorage === 'saved');
    await page.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('Full', 'QuotaExceededError'); }; });
    await page.locator('[data-lbg-file]').first().setInputFiles({ name: 'temporary-again.png', mimeType: 'image/png', buffer: onePixel });
    await page.waitForFunction(() => LoginBackground.getState().photoStorage === 'temporary' && document.querySelector('[data-lbg-status]').textContent.includes('儲存空間不足'));
    await page.reload(); await page.evaluate(() => LoginBackground.ready());
    assert.equal(await page.evaluate(() => LoginBackground.getState().hasPhoto), false);
    assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), 'dawn');
    await page.locator('.login-bg summary').click();
    await page.locator('[data-lbg-file]').first().setInputFiles({ name: 'retry.png', mimeType: 'image/png', buffer: onePixel });
    await page.waitForFunction(() => LoginBackground.getState().photoStorage === 'saved');
    await page.locator('[data-lbg-reset]').click();
    await page.waitForFunction(() => LoginBackground.getState().preset === 'dawn' && !LoginBackground.getState().hasPhoto);
    await page.reload(); await page.evaluate(() => LoginBackground.ready());
    assert.equal(await page.evaluate(() => LoginBackground.getState().hasPhoto), false);
    assert.equal(await page.evaluate(() => LoginBackground.getState().brightness), 100);
    assert.deepEqual(errors, []);
    // Browsers without IndexedDB can still use a photo for this open session.
    const temporaryContext = await browser.newContext();
    await temporaryContext.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined }));
    const temporaryPage = await temporaryContext.newPage();
    await temporaryPage.route('**/__login-background-test__', route => route.fulfill({ contentType: 'text/html', body: harness }));
    await temporaryPage.goto(frontBase + '/__login-background-test__');
    await temporaryPage.evaluate(() => LoginBackground.ready());
    await temporaryPage.locator('.login-bg summary').click();
    await temporaryPage.locator('[data-lbg-preset][value="custom"]').check();
    await temporaryPage.locator('[data-lbg-file]').first().setInputFiles({ name: 'browser-session.png', mimeType: 'image/png', buffer: onePixel });
    await temporaryPage.waitForFunction(() => LoginBackground.getState().photoStorage === 'temporary' && document.querySelector('[data-lbg-status]').textContent.includes('無法儲存照片'));
    assert.equal(await temporaryPage.evaluate(() => document.body.dataset.loginbackground), 'custom');
    await temporaryContext.close();
    console.log('Login backgrounds passed: 4 choices; mobile controls; original >5 MB PNG preserved; reload/remount; fit controls; decode failure; quota fallback and retry; unavailable IndexedDB; safe URL lifecycle; stale-photo protection; reset; route isolation.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
