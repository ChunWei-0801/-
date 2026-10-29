/* Educational-only API fixtures: never authenticates or sends bank/production requests. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.FAMBUDGET_TEST_BROWSER || 'chromium', mobile = process.env.FAMBUDGET_TEST_DEVICE !== 'desktop';
const frontend = path.resolve(__dirname, '..');
async function fixture(t, options = {}) {
  const browser = await playwright[engine].launch({ headless: true, ...(engine === 'chromium' ? { executablePath: process.env.CHROMIUM_EXECUTABLE || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ ...(!mobile ? { viewport: { width: 1280, height: 900 } } : engine === 'chromium' ? playwright.devices['Pixel 7'] : engine === 'webkit' ? playwright.devices['iPhone 13'] : { viewport: { width: 390, height: 844 } }), reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], requests = []; page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'http://allowance-fixture.test/' ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-TW" data-theme="paper"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="view"></main></body></html>' }) : (requests.push(route.request().url()), route.abort()));
  await page.goto('http://allowance-fixture.test/');
  for (const file of ['tokens', 'app', 'themes', 'allowance-simulation']) await page.addStyleTag({ path: path.join(frontend, 'css', file + '.css') });
  await page.addStyleTag({ content: 'body{margin:0;padding:12px;display:block}main{min-width:0}' });
  await page.evaluate(options => {
    window.__owner = { id: 'parent' }; window.__calls = []; window.__records = []; window.__failAfterSave = !!options.failAfterSave; window.__failLoad = !!options.failLoad; window.__holdPost = false; window.__getCount = 0;
    window.LifeFeatures = { user: () => __owner };
    window.__api = {
      allowanceSimulation: async () => {
        __getCount++;
        if (window.__holdLoad) { __holdLoad = false; await new Promise(resolve => { window.__releaseLoad = resolve; }); }
        if (__failLoad) { __failLoad = false; throw Error('fixture unavailable'); }
        return { simulation: true, recipients: __owner.id === 'parent' ? [{ id: 'child', name: '小朋友' }] : [], items: __records.filter(item => item.guardianId === __owner.id || item.wardId === __owner.id).map(item => ({ ...item })), nextBeforeId: null, truncated: false };
      },
      issueAllowanceSimulation: async payload => {
        __calls.push(JSON.parse(JSON.stringify(payload)));
        if (window.__revoked) { const error = new Error('fixture relationship revoked'); error.status = 403; throw error; }
        if (__holdPost) await new Promise(resolve => { window.__releasePost = resolve; });
        let item = __records.find(row => row._key === payload.idempotencyKey), replayed = !!item;
        if (!item) { item = { id: String(__records.length + 1), guardianId: 'parent', wardId: payload.wardId, guardianName: '家長', wardName: '小朋友', amount: String(payload.amount), note: payload.note, createdAt: '2026-10-29T01:00:00Z', _key: payload.idempotencyKey }; __records.unshift(item); }
        if (__failAfterSave) { __failAfterSave = false; throw Error('fixture connection lost after commit'); }
        return { simulation: true, item: { ...item }, replayed };
      }
    };
    Storage.prototype.setItem = () => { throw Error('No simulation data in browser storage'); };
  }, options);
  await page.addScriptTag({ path: path.join(frontend, 'js/allowance-simulation.js') });
  await page.evaluate(() => AllowanceSimulation.render(document.querySelector('#view'), { api: __api, user: __owner }));
  t.after(() => assert.deepEqual(errors, [])); t.after(() => assert.deepEqual(requests, [])); return { page, context };
}

test('issue requires a separate confirmation; both roles show the same educational record and no real-money claim', async t => {
  const { page } = await fixture(t);
  assert.equal(await page.getByText('模擬零用錢，未發生銀行轉帳', { exact: true }).isVisible(), true);
  await page.locator('[name=note]').fill('本週零用錢，先存50元');
  await page.getByRole('button', { name: '核對發放內容' }).click();
  assert.equal(await page.evaluate(() => __calls.length), 0);
  assert.equal(await page.locator('[name=amount]').isDisabled(), true);
  await page.getByRole('button', { name: '確認模擬發放', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.allowance-sim__record'));
  assert.equal(await page.evaluate(() => __calls.length), 1);
  assert.match(await page.locator('.allowance-sim__record').textContent(), /200 元/);
  assert.match(await page.locator('.allowance-sim__record').textContent(), /你發放/);
  await page.evaluate(() => { __owner = { id: 'child' }; return AllowanceSimulation.render(document.querySelector('#view'), { api: __api, user: __owner }); });
  assert.equal(await page.locator('.allowance-sim__form').isVisible(), false);
  assert.match(await page.locator('.allowance-sim__record').textContent(), /你收到/);
  assert.match(await page.locator('.allowance-sim__record').textContent(), /本週零用錢/);
  await page.evaluate(() => { __owner = { id: 'friend' }; return AllowanceSimulation.render(document.querySelector('#view'), { api: __api, user: __owner }); });
  assert.equal(await page.locator('.allowance-sim__record').count(), 0);
});

test('ambiguous network failure retries the same operation key and does not duplicate the saved record', async t => {
  const { page } = await fixture(t, { failAfterSave: true });
  await page.getByRole('button', { name: '核對發放內容' }).click();
  await page.getByRole('button', { name: '確認模擬發放', exact: true }).click();
  await page.getByRole('button', { name: '重試確認', exact: true }).waitFor();
  assert.match(await page.locator('.allowance-sim__status').textContent(), /尚未確認/);
  await page.getByRole('button', { name: '重試確認', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.allowance-sim__record'));
  const calls = await page.evaluate(() => __calls);
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  assert.match(calls[0].idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(await page.evaluate(() => __records.length), 1);
  assert.match(await page.locator('.allowance-sim__status').textContent(), /重試沒有重複/);
});

test('invalid whole-unit amounts do not post; notes render as text and rapid clicks only submit once', async t => {
  const { page } = await fixture(t);
  for (const value of ['0', '1.5', '-1', '1000001', 'NaN']) {
    await page.locator('[name=amount]').fill(value); await page.getByRole('button', { name: '核對發放內容' }).click();
    assert.equal(await page.evaluate(() => __calls.length), 0); assert.match(await page.locator('.allowance-sim__status').textContent(), /整元/);
  }
  await page.locator('[name=amount]').fill('1'); await page.locator('[name=note]').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: '核對發放內容' }).click();
  assert.equal(await page.locator('.allowance-sim__preview img').count(), 0);
  await page.evaluate(() => { __holdPost = true; const button = document.querySelector('[data-allowance-action=confirm]'); button.click(); button.click(); });
  await page.waitForFunction(() => typeof __releasePost === 'function'); assert.equal(await page.evaluate(() => __calls.length), 1);
  await page.evaluate(() => __releasePost()); await page.waitForFunction(() => document.querySelector('.allowance-sim__record'));
  assert.equal(await page.locator('.allowance-sim__record img').count(), 0);
});

test('loading errors are recoverable and account changes or route cleanup discard late responses', async t => {
  const { page } = await fixture(t, { failLoad: true });
  await page.getByRole('button', { name: '重新載入紀錄' }).click(); await page.waitForFunction(() => !document.querySelector('.allowance-sim__form').hidden);
  await page.evaluate(() => { __holdLoad = true; AllowanceSimulation.render(document.querySelector('#view'), { api: __api, user: __owner }); });
  await page.waitForFunction(() => typeof __releaseLoad === 'function');
  await page.evaluate(() => { __owner = { id: 'friend' }; return AllowanceSimulation.render(document.querySelector('#view'), { api: __api, user: __owner }); });
  await page.evaluate(() => __releaseLoad());
  assert.equal(await page.locator('.allowance-sim__form').isVisible(), false); assert.equal(await page.locator('[name=wardId] option').count(), 0);
  await page.evaluate(() => { location.hash = '#/another'; }); await page.waitForFunction(() => !document.querySelector('[data-allowance-simulation]'));
});

test('revoked guardianship gives an actionable denial and never claims an uncertain or completed issuance', async t => {
  const { page } = await fixture(t);
  await page.getByRole('button', { name: '核對發放內容' }).click(); await page.evaluate(() => { __revoked = true; });
  await page.getByRole('button', { name: '確認模擬發放', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.allowance-sim__status').textContent.includes('監管關係'));
  assert.equal(await page.locator('.allowance-sim__preview').isVisible(), false);
  assert.equal(await page.locator('[name=amount]').isDisabled(), false);
  assert.equal(await page.evaluate(() => __records.length), 0);
});

test('mobile large text and theme colors remain usable with touch targets and no horizontal overflow', async t => {
  const { page } = await fixture(t);
  for (const theme of ['paper', 'tech']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.style.fontSize = '24px'; }, theme);
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      const box = await page.locator('[data-allowance-action=preview]').boundingBox(); assert.ok(box.height >= 44);
    }
  }
  assert.equal(await page.locator('[name=amount]').getAttribute('inputmode'), 'numeric');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, 'fambudget-' + engine + '-allowance.png') : '/tmp/fambudget-' + engine + '-allowance.png', fullPage: true });
});
