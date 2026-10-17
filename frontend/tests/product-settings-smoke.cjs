// Functional browser checks against an isolated development account/server.
// FAMBUDGET_URL may include ?api=http://127.0.0.1:8000 for separate local ports.
// PLAYWRIGHT_MODULE=... CHROMIUM_EXECUTABLE=... node frontend/tests/product-settings-smoke.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = new URL(process.env.FAMBUDGET_URL || 'http://127.0.0.1:5174');
const at = route => { const url = new URL(base); url.hash = '#/' + route; return url.href; };
const suppliedEmail = process.env.FAMBUDGET_TEST_EMAIL;
const email = suppliedEmail || `product.settings.${Date.now()}@example.test`;
const password = process.env.FAMBUDGET_TEST_PASSWORD || 'Local-product-settings-9!';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'zh-TW' });
    await context.addInitScript(() => { localStorage.setItem('fambudget.tour', 'done'); });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(at('login')); await page.waitForSelector('#loginF');
    if (!suppliedEmail) {
      const created = await page.evaluate(async ({ email, password }) => {
        const capabilities = await fetch(API.base + '/capabilities').then(r => r.json());
        if (capabilities.email_delivery_mode !== 'demo') throw new Error('Automatic synthetic accounts require an isolated demo-mail server.');
        const response = await fetch(API.base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '主題設定驗收', email, password }) });
        return { status: response.status, body: await response.json() };
      }, { email, password });
      assert.equal(created.status, 201, JSON.stringify(created.body));
    }
    assert.equal(await page.locator('a[href*="presentation"]').count(), 0);
    assert.equal(await page.locator('.login-bg').count(), 0);
    assert.equal(await page.locator('#lgRemember').isChecked(), false);
    await page.locator('a[href="#/appearance"]').first().click();
    await page.waitForSelector('[data-lbg-preset]');
    await page.locator('[data-lbg-preset][value="forest"]').check();
    await page.locator('[data-appearance-theme="sky"]').click();
    assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), 'forest');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'sky');
    await page.click('[data-appearance-cancel]'); await page.waitForSelector('#loginF');
    assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), 'dawn');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'paper');
    await page.locator('a[href="#/appearance"]').first().click(); await page.waitForSelector('[data-lbg-preset]');
    await page.locator('[data-lbg-preset][value="forest"]').check();
    await page.click('[data-appearance-apply]'); await page.waitForSelector('#loginF'); await page.reload(); await page.waitForSelector('#loginF');
    assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), 'forest');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('a[href="#/appearance"]').first().click(); await page.waitForSelector('[data-lbg-preset]');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.click('[data-appearance-cancel]'); await page.waitForSelector('#loginF');
    await page.fill('#lgEmail', email); await page.fill('#lgPw', password); await page.click('#loginF button[type="submit"]');
    await page.waitForFunction(() => !location.hash.includes('/login'));
    await page.waitForSelector('.dgrid, [data-su-done="skip"]');
    if (await page.locator('[data-su-done="skip"]').count()) await page.click('[data-su-done="skip"]');
    await page.goto(at('')); await page.waitForSelector('.dgrid');
    assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), 'forest');
    assert.equal(await page.evaluate(() => !!localStorage.getItem('fambudget.auth')), false);
    assert.equal(await page.evaluate(() => !!sessionStorage.getItem('fambudget.auth')), true);
    await page.waitForFunction(async () => (await API.me()).user.appearance.preset === 'forest');
    await page.click('#pav a'); await page.waitForSelector('#profF'); assert.ok(await page.locator('[data-goal]').count());
    await page.goto(at('tutorial')); await page.waitForSelector('[data-start-tour]');
    assert.equal(await page.locator('.tutorial-topic').count(), 10);
    await page.click('[data-start-tour]'); await page.waitForSelector('#tourSkip'); await page.click('#tourSkip');
    await page.goto(at('settings')); await page.waitForSelector('#logout'); await page.click('#logout'); await page.waitForSelector('#loginF');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('fambudget.auth')), null);
    assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), 'forest');
    await page.fill('#lgEmail', email); await page.fill('#lgPw', password); await page.check('#lgRemember'); await page.click('#loginF button[type="submit"]');
    await page.waitForSelector('.dgrid');
    assert.equal(await page.evaluate(() => !!localStorage.getItem('fambudget.auth')), true);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('fambudget.auth')), null);
    // A large original is kept locally while a smaller account copy follows a new browser context.
    await page.goto(at('appearance')); await page.waitForSelector('[data-lbg-preset]');
    await page.locator('[data-lbg-preset][value="custom"]').check();
    const originalBytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 2200; canvas.height = 1400;
      const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(canvas.width, canvas.height);
      for (let offset = 0; offset < pixels.data.length; offset += 65536) crypto.getRandomValues(pixels.data.subarray(offset, Math.min(offset + 65536, pixels.data.length)));
      for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'large-original.png', { type: 'image/png' }));
      const input = document.querySelector('[data-lbg-file]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      return blob.size;
    });
    assert.ok(originalBytes > 5 * 1024 * 1024);
    await page.waitForFunction(() => LoginBackground.getState().hasPhoto);
    await page.click('[data-appearance-apply]'); await page.waitForSelector('.settings-grid');
    assert.equal(await page.evaluate(() => LoginBackground.getPhotoBlob().size), originalBytes);
    assert.equal((await page.evaluate(() => API.me())).user.appearanceImageUrl, '/api/auth/me/appearance-image');
    const secondContext = await browser.newContext({ locale: 'zh-TW' });
    await secondContext.addInitScript(() => localStorage.setItem('fambudget.tour', 'done'));
    const second = await secondContext.newPage(); second.on('pageerror', error => errors.push(error.message));
    await second.goto(at('login')); await second.fill('#lgEmail', email); await second.fill('#lgPw', password); await second.click('#loginF button[type="submit"]');
    await second.waitForFunction(() => LoginBackground.getState().hasPhoto && document.body.dataset.loginbackground === 'custom');
    const restored = await second.evaluate(async () => { const blob = LoginBackground.getPhotoBlob(), image = await createImageBitmap(blob); return { width: image.width, height: image.height, size: blob.size }; });
    assert.equal(restored.width, 1920); assert.equal(restored.height, 1222); assert.ok(restored.size < originalBytes);
    await second.goto(at('settings')); await second.waitForSelector('[data-language-select]');
    for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN', 'zh-TW']) {
      await second.locator('[data-language-select]').first().selectOption(language);
      await second.waitForFunction(language => document.documentElement.lang === language, language);
      await second.waitForFunction(async language => (await API.me()).user.language === language, language);
      assert.ok(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), language + ' fits the viewport.');
    }
    await second.locator('[data-language-select]').first().selectOption('en');
    await second.waitForFunction(async () => (await API.me()).user.language === 'en');
    await second.reload(); await second.waitForSelector('.settings-grid');
    await second.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(await second.locator('#ptitle').innerText(), 'Settings');
    assert.equal(await second.evaluate(password => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].some(storage => storage.includes(password)), password), false, 'Application storage never contains the login password.');
    assert.deepEqual(errors, []);
    console.log('Product settings passed: independent preview/apply/cancel; shared signed-in background; account photo sync with >5 MB original retained; profile avatar link; help and repeatable guided tour; desktop/mobile; optional persistent login without plaintext passwords; six languages saved to account and restored; no project links; no JS errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
