// Isolated development server only. Verifies shared-device account boundaries.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.FAMBUDGET_URL || 'http://127.0.0.1:5174');
const at = route => { const url = new URL(base); url.hash = '#/' + route; return url.href; };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ locale: 'zh-TW', viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => localStorage.setItem('fambudget.tour', 'done'));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(at('login')); await page.waitForSelector('#loginF');
    const capabilities = await page.evaluate(() => fetch(API.base + '/capabilities').then(r => r.json()));
    assert.equal(capabilities.email_delivery_mode, 'demo', 'Synthetic accounts require an isolated demo-mail development server.');
    const suffix = Date.now(), password = 'Appearance-test-8!', emailA = `appearance.a.${suffix}@example.test`, emailB = `appearance.b.${suffix}@example.test`;
    async function register(email) {
      await page.goto(at('register')); await page.fill('#rgName', '背景帳號測試'); await page.fill('#rgEmail', email); await page.fill('#rgPw', password);
      await page.click('#regF button[type="submit"]'); await page.waitForSelector('[data-su-done="skip"]'); await page.click('[data-su-done="skip"]'); await page.waitForSelector('.dgrid');
    }
    async function logout() { await page.goto(at('settings')); await page.waitForSelector('#logout'); await page.click('#logout'); await page.waitForSelector('#loginF'); }
    async function login(email) {
      await page.fill('#lgEmail', email); await page.fill('#lgPw', password); await page.click('#loginF button[type="submit"]'); await page.waitForSelector('.dgrid');
    }
    async function setPhoto(color) {
      await page.goto(at('appearance')); await page.waitForSelector('[data-lbg-preset]'); await page.check('[data-lbg-preset][value="custom"]');
      const encoded = await page.evaluate(color => {
        const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png').split(',')[1];
      }, color);
      await page.locator('[data-lbg-file]').first().setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
      await page.waitForFunction(() => LoginBackground.getState().hasPhoto);
      await page.click('[data-appearance-apply]'); await page.waitForSelector('.settings-grid');
      return page.evaluate(async () => {
        const blob = LoginBackground.getPhotoBlob();
        return { size: blob.size, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).join(',') };
      });
    }
    async function photoColor() {
      return page.evaluate(async () => {
        const bitmap = await createImageBitmap(LoginBackground.getPhotoBlob()), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0, 1, 1); bitmap.close(); return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
      });
    }
    await register(emailA); const original = await setPhoto('#e02020');
    await page.goto(at('appearance')); await page.reload(); await page.waitForSelector('[data-lbg-preset]');
    assert.deepEqual(await page.evaluate(async () => {
      const blob = LoginBackground.getPhotoBlob();
      return { size: blob.size, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).join(',') };
    }), original, 'Same-account reload retains the exact original PNG.');
    await page.click('[data-appearance-cancel]'); await logout();
    await register(emailB); await page.waitForFunction(() => !LoginBackground.getState().hasPhoto && document.body.dataset.loginbackground === 'dawn');
    await setPhoto('#2040e0'); await logout(); await login(emailA);
    await page.waitForFunction(() => LoginBackground.getState().hasPhoto && document.body.dataset.loginbackground === 'custom');
    let color = await photoColor(); assert.ok(color[0] > 200 && color[2] < 70, 'Account A reloads its red photo, never account B\'s blue photo.');
    // Simulate another device replacing A's photo; updatedAt invalidates the local cached copy.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 80;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#20d040'; ctx.fillRect(0, 0, 80, 80);
      await API.request('/api/auth/me/appearance-image', { method: 'POST', body: { dataUrl: canvas.toDataURL('image/png') } });
    });
    await page.goto(at('appearance')); await page.reload(); await page.waitForSelector('[data-lbg-preset]');
    color = await photoColor(); assert.ok(color[1] > 180 && color[0] < 70, 'A direct theme-page reload receives the remotely updated green photo before preview.');
    await page.click('[data-appearance-cancel]');
    await page.evaluate(() => API.request('/api/auth/me/appearance-image', { method: 'DELETE' }));
    await page.reload(); await page.waitForSelector('.settings-grid');
    assert.equal(await page.evaluate(() => LoginBackground.getState().hasPhoto), false, 'Remote deletion removes the stale local photo.');
    assert.deepEqual(errors, []);
    console.log('Account appearance passed: original retained; new account has no stale photo; owner photo restored; remote replacement and deletion; direct theme-page hydration; no browser errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
