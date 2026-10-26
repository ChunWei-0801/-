/* Private synthetic billing profiles and receipt text; no real accounts or requests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

async function fixture() {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], unexpected = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.href === 'http://billing-fixture.test/') return route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="view"><button id="trigger">常用統編</button><div id="entryBox"></div></main></body></html>' });
    unexpected.push(url.href); return route.abort();
  });
  await page.goto('http://billing-fixture.test/');
  for (const file of ['css/tokens.css', 'css/app.css', 'css/billing-profile.css', 'css/receipt-entry.css']) await page.addStyleTag({ path: path.join(root, file) });
  await page.evaluate(() => {
    window.__user = { id: 'a' }; window.__calls = []; window.__copies = []; window.__creates = [];
    window.__profile = { buyerTaxId: '01234567', companyName: '測試單位' };
    window.LifeFeatures = { user: () => __user };
    window.API = { mode: 'http', request: async (path, options) => {
      __calls.push({ path, method: options.method, body: options.body });
      if (options.method === 'GET') {
        if (window.__getFail) { __getFail = false; throw Error('Isolated unavailable'); }
        if (window.__getHold) return new Promise(resolve => { window.__release = resolve; });
        return structuredClone(__profile);
      }
      if (options.method === 'PUT') { __profile = structuredClone(options.body); return structuredClone(__profile); }
      throw Error('Unexpected fixture call');
    }, createTransaction: async (payload, options) => {
      __creates.push({ payload, options }); return { id: String(__creates.length) };
    } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { __copies.push(value); } } });
    window.ReceiptOCR = { recognize: async () => {
      if (window.__holdOCR) return new Promise(resolve => { window.__releaseOCR = resolve; });
      return { text: '測試咖啡店\n2026/10/26\n總計120' };
    } };
  });
  await page.addScriptTag({ path: path.join(root, 'js/billing-profile.js') });
  await page.addScriptTag({ path: path.join(root, 'js/receipt-entry.js') });
  return { browser, page, errors, unexpected };
}
function clean(h) { assert.deepEqual(h.errors, []); assert.deepEqual(h.unexpected, []); }
async function openProfile(p) {
  await p.evaluate(() => { BillingProfile.open({ api: API, owner: 'a' }); });
  await p.waitForFunction(() => !document.querySelector('[data-billing-save]').disabled);
}

test('remembered buyer ID is private, format checked, explicitly copied, saved and cleared', async () => {
  const h = await fixture(); try {
    const p = h.page; await openProfile(p);
    assert.equal(await p.locator('.billing-dialog [name="buyerTaxId"]').inputValue(), '01234567');
    assert.deepEqual(await p.evaluate(() => __copies), [], 'no automatic clipboard write');
    await p.locator('[data-billing-copy]').click(); assert.deepEqual(await p.evaluate(() => __copies), ['01234567']);
    await p.locator('.billing-dialog [name="buyerTaxId"]').fill('1234567');
    await p.locator('[data-billing-save]').click(); assert.equal(await p.evaluate(() => __calls.filter(x => x.method === 'PUT').length), 0);
    assert.match(await p.locator('.billing-status').innerText(), /8 位數字/);
    await p.locator('.billing-dialog [name="buyerTaxId"]').fill(' 87654321 ');
    await p.locator('.billing-dialog [name="companyName"]').fill('<img src=x onerror=alert(1)>');
    await p.locator('[data-billing-save]').click(); await p.waitForFunction(() => __calls.some(x => x.method === 'PUT'));
    assert.deepEqual(await p.evaluate(() => __calls.find(x => x.method === 'PUT').body), { buyerTaxId: '87654321', companyName: '<img src=x onerror=alert(1)>' });
    assert.equal(await p.locator('.billing-dialog img').count(), 0);
    await p.locator('[data-billing-clear]').click(); await p.waitForFunction(() => __calls.filter(x => x.method === 'PUT').length === 2);
    assert.deepEqual(await p.evaluate(() => __profile), { buyerTaxId: null, companyName: '' });
    assert.equal(await p.locator('[data-billing-copy]').isDisabled(), true);
    assert.deepEqual(await p.evaluate(() => Object.keys(localStorage)), []);
    for (const width of [320, 390, 768]) { await p.setViewportSize({ width, height: 844 }); assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
    await p.locator('[data-billing-close]').click(); assert.equal(await p.locator('.billing-dialog').count(), 0); clean(h);
  } finally { await h.browser.close(); }
});

test('generic entry containers preserve edits and owner scope during delayed default loading and remounting', async () => {
  const h = await fixture(); try {
    const p = h.page;
    await p.evaluate(() => { __getHold = true; window.__enhanced = BillingProfile.enhanceForm(document.querySelector('#entryBox'), { api: API, owner: 'a' }); });
    await p.waitForFunction(() => typeof __release === 'function');
    await p.locator('#entryBox [name="buyerTaxId"]').fill('22222222');
    await p.evaluate(() => __release({ buyerTaxId: '11111111', companyName: 'Never overwrite' }));
    await p.evaluate(() => __enhanced.ready);
    assert.equal(await p.locator('#entryBox [name="buyerTaxId"]').inputValue(), '22222222');
    await p.evaluate(() => { document.querySelector('#entryBox').replaceChildren(); window.__enhanced = BillingProfile.enhanceForm(document.querySelector('#entryBox'), { api: API, owner: 'a' }); });
    await p.waitForFunction(() => __calls.filter(x => x.method === 'GET').length === 2);
    await p.evaluate(() => { __user = { id: 'b' }; __release({ buyerTaxId: '33333333', companyName: 'Other account' }); });
    await p.evaluate(() => __enhanced.ready);
    assert.equal(await p.locator('#entryBox [name="buyerTaxId"]').inputValue(), '', 'late response never hydrates a different account');
    await p.evaluate(() => { __user = { id: 'a' }; document.querySelector('#entryBox').replaceChildren(); window.__enhanced = BillingProfile.enhanceForm(document.querySelector('#entryBox'), { api: API, owner: 'a', prefill: false, values: { buyerTaxId: null, paymentMethod: 'jkopay' } }); });
    assert.equal(await p.locator('#entryBox [name="buyerTaxId"]').count(), 1);
    assert.deepEqual(await p.evaluate(() => BillingProfile.values(document.querySelector('#entryBox'))), { paymentMethod: 'jkopay', buyerTaxId: null });
    assert.equal(await p.evaluate(() => BillingProfile.valid(document.querySelector('#entryBox'))), true);
    await p.locator('#entryBox [name="buyerTaxId"]').fill('bad');
    assert.equal(await p.evaluate(() => BillingProfile.valid(document.querySelector('#entryBox'))), false); clean(h);
  } finally { await h.browser.close(); }
});

test('profile read failure cannot overwrite saved data and account changes discard late private responses', async () => {
  const h = await fixture(); try {
    const p = h.page;
    await p.evaluate(() => { __getFail = true; BillingProfile.open({ api: API, owner: 'a' }); });
    await p.locator('[data-billing-retry]').waitFor({ state: 'visible' });
    assert.equal(await p.locator('[data-billing-save]').isDisabled(), true);
    assert.equal(await p.locator('[data-billing-clear]').isDisabled(), true);
    await p.locator('[data-billing-retry]').click(); await p.waitForFunction(() => !document.querySelector('[data-billing-save]').disabled);
    await p.locator('[data-billing-close]').click();
    await p.evaluate(() => { __getHold = true; BillingProfile.open({ api: API, owner: 'a' }); });
    await p.waitForFunction(() => typeof __release === 'function');
    await p.evaluate(() => { __user = { id: 'b' }; __release({ buyerTaxId: '87654321', companyName: 'Private A' }); });
    await p.waitForFunction(() => !document.querySelector('.billing-dialog'));
    assert.equal(await p.locator('body').innerText().then(x => x.includes('Private A')), false);
    assert.equal(await p.evaluate(() => __calls.filter(x => x.method === 'PUT').length), 0); clean(h);
  } finally { await h.browser.close(); }
});

test('loading can be closed without saving, and unavailable clipboard provides explicit selection fallback', async () => {
  const h = await fixture(); try {
    const p = h.page;
    await p.evaluate(() => { __getHold = true; BillingProfile.open({ api: API, owner: 'a' }); });
    await p.waitForFunction(() => typeof __release === 'function');
    await p.locator('[data-billing-close]').click();
    assert.equal(await p.locator('.billing-dialog').count(), 0);
    await p.evaluate(() => { __release({ buyerTaxId: '99999999', companyName: 'Discarded' }); __getHold = false; });
    await openProfile(p);
    await p.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
    await p.locator('[data-billing-copy]').click();
    assert.match(await p.locator('.billing-status').innerText(), /已選取統一編號/);
    assert.equal(await p.locator('.billing-dialog [name="buyerTaxId"]').evaluate(n => n.value.slice(n.selectionStart, n.selectionEnd)), '01234567');
    assert.deepEqual(await p.evaluate(() => __copies), []);
    assert.equal(await p.evaluate(() => __calls.filter(x => x.method === 'PUT').length), 0); clean(h);
  } finally { await h.browser.close(); }
});

test('receipt review carries optional payment and buyer ID, rechecks edits, and never writes invalid metadata', async () => {
  const h = await fixture(); try {
    const p = h.page;
    await p.evaluate(() => { ReceiptEntry.open({ api: API, owner: 'a', categories: [{ id: 'food', name: '餐飲', kind: 'expense' }], groups: [] }); });
    const png = Buffer.from(await p.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL('image/png').split(',')[1]; }), 'base64');
    await p.locator('[data-receipt-file="choose"]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
    await p.locator('[data-receipt-review]').waitFor(); await p.waitForFunction(() => document.querySelector('.receipt-dialog [name="buyerTaxId"]').value === '01234567');
    await p.locator('.receipt-dialog [name="cat"]').selectOption('food'); await p.locator('.receipt-dialog [name="attach"]').uncheck();
    await p.locator('.receipt-dialog [name="accept"]').check();
    await p.locator('.receipt-dialog [name="buyerTaxId"]').fill('1234567');
    assert.equal(await p.locator('.receipt-dialog [name="accept"]').isChecked(), false, 'changing tax metadata requires review again');
    await p.evaluate(() => { const f = document.querySelector('[data-receipt-review]'); f.querySelector('[name="accept"]').checked = true; f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(await p.evaluate(() => __creates.length), 0);
    await p.locator('.receipt-dialog [name="buyerTaxId"]').fill('87654321'); await p.locator('.receipt-dialog [name="paymentMethod"]').selectOption('jkopay');
    await p.locator('.receipt-dialog [name="accept"]').check(); await p.locator('[data-receipt-action="save"]').click();
    await p.waitForFunction(() => __creates.length === 1);
    const created = await p.evaluate(() => __creates[0]);
    assert.equal(created.payload.buyerTaxId, '87654321'); assert.equal(created.payload.paymentMethod, 'jkopay'); assert.equal(created.payload.amount, 120); assert.equal(created.options.attachPendingPhotos, false);
    await p.locator('[data-receipt-action="close"]').click();
    await p.evaluate(() => { __holdOCR = true; ReceiptEntry.open({ api: API, owner: 'a', categories: [{ id: 'food', name: '餐飲', kind: 'expense' }], groups: [] }); });
    await p.locator('[data-receipt-file="choose"]').setInputFiles({ name: 'other.png', mimeType: 'image/png', buffer: png });
    await p.waitForFunction(() => typeof __releaseOCR === 'function');
    await p.evaluate(() => { __user = { id: 'b' }; __releaseOCR({ text: 'PRIVATE OLD RECEIPT\n總計999' }); });
    await p.waitForFunction(() => !document.querySelector('.receipt-dialog'));
    assert.equal(await p.evaluate(() => __creates.length), 1); clean(h);
  } finally { await h.browser.close(); }
});

test('blank billing metadata remains optional and receipt creation retains its original payload', async () => {
  const h = await fixture(); try {
    const p = h.page;
    await p.evaluate(() => { __profile = { buyerTaxId: null, companyName: '' }; ReceiptEntry.open({ api: API, owner: 'a', categories: [{ id: 'food', name: '餐飲', kind: 'expense' }], groups: [] }); });
    const png = Buffer.from(await p.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL('image/png').split(',')[1]; }), 'base64');
    await p.locator('[data-receipt-file="choose"]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
    await p.locator('[data-receipt-review]').waitFor(); await p.locator('.receipt-dialog [name="cat"]').selectOption('food'); await p.locator('.receipt-dialog [name="attach"]').uncheck(); await p.locator('.receipt-dialog [name="accept"]').check(); await p.locator('[data-receipt-action="save"]').click();
    await p.waitForFunction(() => __creates.length === 1);
    assert.equal(await p.evaluate(() => Object.hasOwn(__creates[0].payload, 'paymentMethod')), false);
    assert.equal(await p.evaluate(() => Object.hasOwn(__creates[0].payload, 'buyerTaxId')), false); clean(h);
  } finally { await h.browser.close(); }
});
