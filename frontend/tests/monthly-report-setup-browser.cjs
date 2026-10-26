/* The setup UI never sends mail or connects to Google in these real-browser fixtures. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), origin = 'http://monthly-report-fixture.test', endpoint = 'https://fambudget-recovery-20261017.onrender.com/api/monthly-reports/export';
async function fixture(options = {}) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }), page = await context.newPage(), errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { unexpected.push(url.href); return route.abort(); }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-TW"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><head><style>body{margin:0;padding:12px;font-family:Arial;background:#f7f7f7}*{box-sizing:border-box}</style></head><body><button id="open">每月報表</button></body></html>' });
    return route.abort();
  });
  await page.goto(origin);
  for (const file of ['css/tokens.css', 'css/app.css', 'css/monthly-report-setup.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
  await page.evaluate(options => {
    window.__owner = { id: 'a' }; window.__calls = []; window.__copied = []; window.__tokens = 0;
    window.__settings = { enabled: false, delivery: 'email', folderId: null, recipientEmail: 'verified@example.test', recipientVerified: options.verified !== false, authorizationActive: false, tokenExpiresAt: null, scope: 'only-me', timezone: 'Asia/Taipei', scheduleDay: 1 };
    window.LifeFeatures = { user: () => __owner };
    window.API = { mode: 'http', request: async (path, options) => {
      __calls.push({ path, options: JSON.parse(JSON.stringify(options)) });
      if (window.__fail) { __fail = false; throw new Error('<img src=x onerror=alert(1)>'); }
      if (path.endsWith('/settings') && options.method === 'GET') return { ...__settings };
      if (path.endsWith('/authorize')) {
        if (window.__hold) await new Promise(resolve => { window.__release = resolve; });
        __settings = { ...__settings, ...options.body, recipientEmail: 'verified@example.test', authorizationActive: true, tokenExpiresAt: '2027-10-26T00:00:00Z' };
        return { token: 'private_fixture_token_' + String(++__tokens).padStart(25, 'a'), exportUrl: 'https://fambudget-recovery-20261017.onrender.com/api/monthly-reports/export', settings: { ...__settings } };
      }
      if (path.endsWith('/authorization') && options.method === 'DELETE') { __settings = { ...__settings, enabled: false, authorizationActive: false, tokenExpiresAt: null }; return { ...__settings }; }
      if (path.endsWith('/settings') && options.method === 'PUT') { __settings = { ...__settings, ...options.body, recipientEmail: 'verified@example.test', enabled: false, authorizationActive: false }; return { ...__settings }; }
      throw Error('Unexpected fixture request');
    } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { __copied.push(value); } } });
    Storage.prototype.setItem = function () { throw Error('No report tokens in browser storage'); };
  }, options);
  await page.addScriptTag({ path: path.join(root, 'js/monthly-report-setup.js') });
  await page.evaluate(() => { document.querySelector('#open').onclick = () => MonthlyReportSetup.open({ api: API, owner: __owner }); });
  await page.locator('#open').click(); await page.waitForFunction(() => document.querySelector('[name=recipientEmail]')?.value === 'verified@example.test');
  return { browser, context, page, errors, unexpected };
}
async function activate(page) { await page.locator('[name=enabled]').check(); await page.locator('[name=termsAccepted]').check(); await page.locator('[data-monthly-action=save]').click(); await page.locator('[data-monthly-script]').waitFor(); }
function clean(h) { assert.deepEqual(h.errors, []); assert.deepEqual(h.unexpected, []); }

test('default email is opt-in, consented and private; downloaded script contains no token and setup never sends mail', async () => {
  const h = await fixture(); try {
    const p = h.page;
    assert.equal(await p.locator('[name=delivery]').inputValue(), 'email'); assert.equal(await p.locator('[name=enabled]').isChecked(), false); assert.equal(await p.locator('[name=recipientEmail]').getAttribute('readonly'), '');
    assert.equal(await p.evaluate(() => __calls.length), 1); assert.equal(await p.locator('[data-monthly-property]').count(), 0);
    await p.locator('[name=enabled]').check(); await p.locator('[data-monthly-action=save]').click(); assert.equal(await p.evaluate(() => __calls.length), 1); assert.match(await p.locator('.monthly-status').textContent(), /勾選/);
    await p.locator('[name=termsAccepted]').check(); await p.locator('[data-monthly-action=save]').click(); await p.locator('[data-monthly-script]').waitFor();
    const calls = await p.evaluate(() => __calls); assert.equal(calls.length, 2); assert.equal(calls[1].path, '/api/monthly-reports/authorize'); assert.deepEqual(calls[1].options.body, { enabled: true, delivery: 'email', folderId: null, recipientEmail: '', termsAccepted: true });
    const token = await p.locator('[data-monthly-property=FAMBUDGET_REPORT_TOKEN]').inputValue(); assert.equal(await p.locator('[data-monthly-property=FAMBUDGET_REPORT_TOKEN]').getAttribute('type'), 'password');
    const script = await p.locator('[data-monthly-script]').inputValue(); assert.ok(!script.includes(token)); assert.ok(!script.includes('DriveApp')); assert.ok(script.includes('MailApp')); assert.match(await p.locator('.monthly-status').textContent(), /Google 端安裝/);
    await p.locator('.monthly-copy-row').last().getByRole('button', { name: '複製', exact: true }).click(); assert.deepEqual(await p.evaluate(() => __copied), [token]);
    const downloading = p.waitForEvent('download'); await p.locator('[data-monthly-action=download]').click(); const downloaded = await downloading; assert.equal(downloaded.suggestedFilename(), 'FamBudget-Monthly.gs'); assert.ok(!fs.readFileSync(await downloaded.path(), 'utf8').includes(token));
    await p.locator('[data-monthly-action=close]').click(); assert.equal(await p.locator('[data-monthly-report]').count(), 0); assert.ok(!await p.locator('body').textContent().then(value => value.includes(token))); clean(h);
  } finally { await h.browser.close(); }
});

test('cloud choices require explicit activation and valid destination; rotation and revocation clear old private values', async () => {
  const h = await fixture(); try {
    const p = h.page; await p.locator('[name=delivery]').selectOption('both'); assert.equal(await p.locator('[name=folderId]').isVisible(), true); await p.locator('[name=folderId]').fill('https://evil.test/folder'); await p.locator('[name=enabled]').check(); await p.locator('[name=termsAccepted]').check(); await p.locator('[data-monthly-action=save]').click(); assert.equal(await p.evaluate(() => __calls.length), 1); assert.match(await p.locator('.monthly-status').textContent(), /資料夾 ID/);
    await p.locator('[name=folderId]').fill('private_folder_12345'); await p.locator('[data-monthly-action=save]').click(); await p.locator('[data-monthly-script]').waitFor(); const first = await p.locator('[data-monthly-property=FAMBUDGET_REPORT_TOKEN]').inputValue(); let script = await p.locator('[data-monthly-script]').inputValue(); assert.ok(script.includes('DriveApp') && script.includes('MailApp'));
    await p.locator('[name=delivery]').selectOption('drive'); assert.equal(await p.locator('[data-monthly-script]').count(), 0); await p.locator('[name=termsAccepted]').check(); await p.locator('[data-monthly-action=save]').click(); await p.locator('[data-monthly-script]').waitFor(); const second = await p.locator('[data-monthly-property=FAMBUDGET_REPORT_TOKEN]').inputValue(); assert.notEqual(first, second); script = await p.locator('[data-monthly-script]').inputValue(); assert.ok(script.includes('DriveApp')); assert.ok(!script.includes('MailApp')); assert.ok(!script.includes(first) && !script.includes(second));
    await p.locator('[data-monthly-action=revoke]').click(); await p.waitForFunction(() => document.querySelector('.monthly-status').textContent.includes('已撤銷')); assert.equal(await p.locator('[data-monthly-property]').count(), 0); const calls = await p.evaluate(() => __calls); assert.equal(calls.at(-1).path, '/api/monthly-reports/authorization'); assert.equal(calls.at(-1).options.method, 'DELETE'); assert.ok(calls.every(row => !row.path.includes(first) && !row.path.includes(second))); clean(h);
  } finally { await h.browser.close(); }
});

test('unverified recipient, API errors, account change and route cleanup never reveal a stale authorization token', async () => {
  const unverified = await fixture({ verified: false }); try { assert.equal(await unverified.page.locator('[data-monthly-action=save]').isDisabled(), true); assert.match(await unverified.page.locator('.monthly-status').textContent(), /先驗證/); assert.equal(await unverified.page.evaluate(() => __calls.length), 1); clean(unverified); } finally { await unverified.browser.close(); }
  const h = await fixture(); try {
    const p = h.page; await p.evaluate(() => { __fail = true; }); await p.locator('[name=enabled]').check(); await p.locator('[name=termsAccepted]').check(); await p.locator('[data-monthly-action=save]').click(); await p.waitForFunction(() => document.querySelector('.monthly-status').classList.contains('is-error'));
    // A failed request never inserts HTML from an error string.
    assert.equal(await p.locator('.monthly-status img').count(), 0); assert.match(await p.locator('.monthly-status').textContent(), /<img/);
    await p.locator('[name=termsAccepted]').check(); await p.evaluate(() => { __hold = true; }); await p.locator('[data-monthly-action=save]').click(); await p.waitForFunction(() => typeof __release === 'function');
    await p.evaluate(() => { __owner = { id: 'b' }; window.dispatchEvent(new Event('hashchange')); __release(); }); await p.waitForTimeout(30); assert.equal(await p.locator('[data-monthly-report]').count(), 0); assert.equal(await p.locator('[data-monthly-property]').count(), 0); clean(h);
  } finally { await h.browser.close(); }
});

test('setup remains readable at narrow sizes and large text in light and dark themes', async () => {
  const h = await fixture(); try {
    const p = h.page; await activate(p);
    for (const theme of ['paper', 'tech']) {
      await p.addStyleTag({ content: fs.readFileSync(path.join(root, 'css/themes.css'), 'utf8') }); await p.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [320, 390, 768]) {
        await p.setViewportSize({ width, height: 844 }); await p.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        assert.equal(await p.locator('[data-monthly-report]').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
        const box = await p.locator('[data-monthly-action=save]').boundingBox(); assert.ok(box.height >= 44);
      }
    }
    assert.equal(await p.locator('a[href="https://script.google.com/home/start"]').getAttribute('rel'), 'noopener noreferrer'); clean(h);
  } finally { await h.browser.close(); }
});
