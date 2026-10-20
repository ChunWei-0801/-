/* Real local API/browser integration. Only the model boundary uses a labelled
 * contract fixture: no model weights, inference quality, OCR, or email delivery
 * are tested here. Use a fresh, migrated, isolated demo-mail development DB. */
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.FAMBUDGET_URL || 'http://127.0.0.1:8039');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) {
  throw new Error('AI integration tests require an isolated localhost server.');
}
const at = route => { const url = new URL(base); url.hash = '#/' + route; return url.href; };
const password = 'Local-AI-contract-9!';
const suffix = Date.now();
const email = `ai.api.${suffix}@example.test`;
const otherEmail = `ai.other.${suffix}@example.test`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      locale: 'zh-TW', timezoneId: 'Asia/Taipei', reducedMotion: 'reduce' });
    const errors = [], externalRequests = [], skippedFonts = [];
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === base.origin) return route.continue();
      if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(route.request().url()).hostname)) {
        skippedFonts.push(new URL(route.request().url()).hostname); return route.abort();
      }
      externalRequests.push(new URL(route.request().url()).hostname); return route.abort();
    });
    await context.addInitScript(() => localStorage.setItem('fambudget.tour', 'done'));
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    const capability = await context.request.get(new URL('/capabilities', base).href);
    assert.equal(capability.status(), 200);
    const capabilities = await capability.json();
    assert.equal(capabilities.email_delivery_mode, 'demo', 'Never create synthetic accounts on a real-mail server.');
    assert.equal(capabilities.mail_configured, false);
    assert.equal(capabilities.email_verification_required, false);

    const registered = await context.request.post(new URL('/api/auth/register', base).href,
      { data: { name: 'AI 本機整合驗收', email, password } });
    assert.equal(registered.status(), 201);
    assert.ok((await registered.json()).accessToken, 'Isolated development registration permits direct login.');
    await page.goto(at('login')); await page.locator('#loginF').waitFor();
    assert.equal(await page.evaluate(() => API.mode), 'http');
    await page.fill('#lgEmail', email); await page.fill('#lgPw', password);
    await page.click('#loginF button[type="submit"]');
    await page.locator('[data-su-done="skip"]').waitFor();
    await page.locator('[data-su-done="skip"]').click(); await page.locator('.dgrid').waitFor();
    const boot = await page.evaluate(async () => {
      await API.createFamily({ name: 'AI 本機驗收家庭' });
      const group = await API.createGroup({ name: 'AI 本機驗收帳本', kind: 'standing' });
      const categories = (await API.categories()).categories;
      const category = categories.find(item => item.kind === 'expense');
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date()).map(part => [part.type, part.value]));
      const today = `${parts.year}-${parts.month}-${parts.day}`;
      const seed = await API.createTransaction({ date: today, amount: 25.5, kind: 'expense', cat: category.id,
        groupId: group.id, merchant: 'LOCAL API SEED', note: 'Synthetic owner fact, not a model result' });
      return { groupId: group.id, categoryId: category.id, categoryName: category.name,
        today, period: today.slice(0, 7), seedId: seed.id, userId: (await API.me()).user.id };
    });
    const otherRegistered = await context.request.post(new URL('/api/auth/register', base).href,
      { data: { name: 'AI 隔離驗收帳號', email: otherEmail, password } });
    assert.equal(otherRegistered.status(), 201);
    const otherToken = (await otherRegistered.json()).accessToken;
    const otherHeaders = { Authorization: 'Bearer ' + otherToken };
    const otherGroupResponse = await context.request.post(new URL('/api/groups', base).href,
      { headers: otherHeaders, data: { name: 'Unrelated ledger', kind: 'standing' } });
    assert.equal(otherGroupResponse.status(), 201);
    const otherGroup = await otherGroupResponse.json();
    const otherSeed = await context.request.post(new URL('/api/transactions', base).href,
      { headers: otherHeaders, data: { date: boot.today, amount: 9999, kind: 'expense', cat: boot.categoryId,
        groupId: otherGroup.id, note: 'UNRELATED SYNTHETIC TRANSACTION' } });
    assert.equal(otherSeed.status(), 201);

    await page.goto(at('ai')); await page.locator('.ai-trial').waitFor();
    assert.equal(await page.evaluate(() => LocalAI.getStatus().loaded), false, 'Opening AI never downloads or starts a model.');
    assert.equal(await page.locator('[data-ai-action="run"]').isDisabled(), true);
    const contextResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ai-local/context');
    await page.locator('[data-ai-mode="ledger"]').click(); await page.locator('[data-ai-action="facts"]').click();
    const factsResponse = await contextResponse; assert.equal(factsResponse.status(), 200);
    const facts = await factsResponse.json();
    assert.equal(facts.current.expense, '25.50'); assert.equal(facts.transactions.totalCount, 1);
    assert.deepEqual(facts.transactions.items.map(item => item.id), [boot.seedId]);
    assert.ok(facts.sources.some(source => source.id === `tx:${boot.seedId}`));
    assert.ok(facts.sources.some(source => source.id === `summary:${boot.period}`));
    await page.waitForFunction(() => document.querySelector('.ait-facts').textContent.includes('TWD 25.50'));
    assert.equal(await page.evaluate(() => LocalAI.getStatus().loaded), false, 'Exact facts use the real server without a model.');
    console.log('PASS: real owner-only context and evidence; no automatic model load.');

    await page.evaluate(boot => {
      // The sole double is the LocalAI model boundary. Lifecycle/status methods
      // support its fixture load/generate; all API/network methods remain real.
      window.__aiContract = { label: 'CONTRACT FIXTURE — NOT INFERENCE OR QUALITY EVIDENCE',
        loadCalls: 0, generationCalls: 0, loaded: false,
        items: [
          { date: boot.today, amount: 65, currency: 'TWD', kind: 'expense', category: boot.categoryId, merchant: 'Fixture breakfast', note: 'SYNTHETIC BATCH A' },
          { date: boot.today, amount: 120, currency: 'TWD', kind: 'expense', category: boot.categoryId, merchant: 'Fixture lunch', note: 'SYNTHETIC BATCH B' }
        ] };
      const clear = () => { __aiContract.loaded = false; };
      window.LocalAI = { checkSupport: async () => ({ supported: true }),
        getStatus: () => ({ loaded: __aiContract.loaded, phase: __aiContract.loaded ? 'ready' : 'idle', model: __aiContract.label }),
        load: async () => { __aiContract.loadCalls++; __aiContract.loaded = true; },
        generate: async options => { __aiContract.generationCalls++; assertDraftTask(options.task);
          return { text: JSON.stringify({ items: __aiContract.items, warnings: [] }), model: __aiContract.label,
            elapsedMs: 1, usage: {}, finishReason: 'stop' }; },
        cancel: clear, unload: clear, clearSession: clear };
      function assertDraftTask(task) { if (task !== 'draft') throw new Error('This explicit contract fixture only supports drafts.'); }
    }, boot);
    await page.locator('[data-ai-action="load"]').click();
    await page.waitForFunction(() => __aiContract.loaded);
    console.log('PASS: explicit contract-fixture model load; real HTTP API unchanged.');
    await page.locator('[data-ai-mode="draft"]').click();
    await page.locator('.ait-input').fill('CONTRACT FIXTURE ONLY: breakfast 65, lunch 120.');
    await page.locator('[data-ai-action="run"]').click();
    await page.locator('[data-ai-row="1"]').waitFor();
    const snapshot = () => page.evaluate(async () => ({ transactions: (await API.transactions()).total,
      credits: (await API.request('/api/memories')).totalEarned }));
    assert.deepEqual(await snapshot(), { transactions: 1, credits: 1 }, 'Draft generation never writes.');
    await page.locator('[data-ai-field="amount"]').first().fill('66.50');
    await page.locator('[data-ai-action="save"]').click();
    assert.deepEqual(await snapshot(), { transactions: 1, credits: 1 }, 'Explicit ledger choice is required.');
    await page.locator('[data-ai-group]').selectOption(boot.groupId);
    await page.locator('[data-ai-action="save"]').click();
    assert.deepEqual(await snapshot(), { transactions: 1, credits: 1 }, 'Review consent is required.');
    await page.locator('[data-ai-approve]').check();
    assert.equal(await page.locator('[data-ai-approve]').isChecked(), true);
    const batchResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/nlp/confirm-batch', { timeout: 5000 }).catch(() => null);
    await page.locator('[data-ai-action="save"]').click();
    const batch = await batchResponse;
    assert.ok(batch, 'Reviewed batch must reach the real API. UI status: ' + await page.locator('.ait-status').textContent());
    assert.equal(batch.status(), 201); assert.equal((await batch.json()).created, 2);
    await page.locator('.ait-success').first().waitFor();
    const afterBatch = await page.evaluate(async () => (await API.transactions()).transactions);
    for (const [note, amount] of [['SYNTHETIC BATCH A', 66.5], ['SYNTHETIC BATCH B', 120]]) {
      const entry = afterBatch.find(item => item.note === note);
      assert.ok(entry); assert.equal(entry.date, boot.today); assert.equal(entry.amount, amount);
      assert.equal(entry.group, boot.groupId); assert.equal(entry.source, 'nlp');
    }
    assert.deepEqual(await snapshot(), { transactions: 3, credits: 3 }, 'Each of the two real saved entries earns one puzzle credit.');
    console.log('PASS: edited reviewed batch persisted through real API; two entries earned two puzzle credits.');

    for (const [label, patch, status] of [
      ['malformed amount', { amount: 'not-a-number' }, 422],
      ['unknown category', { cat: 'unknown-category' }, 400],
      ['unauthorized ledger', { groupId: otherGroup.id }, 404]
    ]) {
      const rejected = await page.evaluate(async ({ boot, patch }) => {
        const row = { date: boot.today, amount: 11, kind: 'expense', cat: boot.categoryId, groupId: boot.groupId,
          merchant: 'SHOULD NOT SAVE', note: 'Atomic rejection fixture' };
        const changed = { ...row, amount: 12, ...patch };
        // Category/amount failures follow a valid row to catch partial writes.
        // Batch destinations are selected from the first row by the API.
        const items = patch.groupId ? [changed, row] : [row, changed];
        try { await API.nlpConfirmBatch(items); return 201; } catch (error) { return error.status; }
      }, { boot, patch });
      assert.equal(rejected, status, label + ' is rejected by the actual server');
      assert.deepEqual(await snapshot(), { transactions: 3, credits: 3 }, label + ' cannot create a transaction or puzzle credit');
    }
    console.log('PASS: actual server rejects malformed amount, unknown category, and unauthorized ledger atomically.');

    const receipt = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 120;
      const drawing = canvas.getContext('2d'); drawing.fillStyle = '#fff'; drawing.fillRect(0, 0, 240, 120);
      drawing.fillStyle = '#16493f'; drawing.font = '15px sans-serif'; drawing.fillText('SYNTHETIC RECEIPT', 15, 35);
      drawing.fillText('Contract fixture TWD 87.25', 15, 70); return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('.ait-receipt summary').click();
    await page.locator('[data-ai-file]').first().setInputFiles({ name: 'synthetic-receipt.png', mimeType: 'image/png', buffer: Buffer.from(receipt, 'base64') });
    await page.evaluate(boot => { __aiContract.items = [{ date: boot.today, amount: 87.25, currency: 'TWD', kind: 'expense',
      category: boot.categoryId, merchant: 'Fixture receipt', note: 'SYNTHETIC RECEIPT ENTRY' }]; }, boot);
    await page.locator('.ait-input').fill('CONTRACT FIXTURE ONLY: receipt entry TWD 87.25.');
    await page.locator('[data-ai-action="run"]').click(); await page.locator('[data-ai-attach]').waitFor();
    await page.locator('[data-ai-group]').selectOption(boot.groupId);
    await page.locator('[data-ai-attach]').check(); await page.locator('[data-ai-approve]').check();
    const oneResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/nlp/confirm');
    const photoResponse = page.waitForResponse(response => /\/api\/transactions\/\d+\/photos$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
    await page.locator('[data-ai-action="save"]').click();
    const one = await oneResponse; assert.equal(one.status(), 201);
    const uploaded = await photoResponse; assert.equal(uploaded.status(), 201);
    // The UI only needs upload acceptance; verify persisted metadata through a
    // fresh authenticated read instead of relying on the upload response body.
    const savedReceipt = await page.evaluate(async () => {
      const entry = (await API.transactions()).transactions.find(item => item.note === 'SYNTHETIC RECEIPT ENTRY');
      return { entry, photo: (await API.request(`/api/transactions/${entry.id}/photos`)).photos[0] };
    });
    const { entry, photo } = savedReceipt;
    assert.ok(photo && photo.id);
    const mediaHash = () => page.evaluate(async path => {
      const response = await API.fetchMedia(path); const bytes = await response.arrayBuffer();
      return { bytes: bytes.byteLength, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).join(',') };
    }, photo.url);
    const beforeLogin = await mediaHash(); assert.ok(beforeLogin.bytes > 0);
    assert.equal((await context.request.get(new URL(photo.url, base).href, { headers: otherHeaders })).status(), 403);
    assert.equal((await context.request.get(new URL(`/api/transactions/${entry.id}/photos`, base).href, { headers: otherHeaders })).status(), 403);
    assert.equal((await context.request.get(new URL(photo.url, base).href)).status(), 401);
    assert.deepEqual(await snapshot(), { transactions: 4, credits: 4 });
    console.log('PASS: actual receipt confirmation/upload; owner-only photo ACL.');

    await page.evaluate(async () => { await API.logout(); location.hash = '#/login'; });
    await page.locator('#loginF').waitFor(); await page.fill('#lgEmail', email); await page.fill('#lgPw', password);
    await page.click('#loginF button[type="submit"]'); await page.locator('.dgrid').waitFor();
    await page.goto(at('ai')); await page.locator('.ai-trial').waitFor();
    assert.deepEqual(await mediaHash(), beforeLogin, 'Saved receipt bytes survive logout and login.');
    const persisted = await page.evaluate(async id => ({ photos: (await API.request(`/api/transactions/${id}/photos`)).photos,
      entry: (await API.transactions()).transactions.find(item => item.id === id) }), entry.id);
    assert.equal(persisted.photos[0].id, photo.id); assert.equal(persisted.entry.amount, 87.25);
    assert.equal(persisted.entry.date, boot.today); assert.equal(persisted.entry.group, boot.groupId);
    console.log('PASS: saved entry and exact receipt bytes persisted after logout/login.');
    for (const locale of ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'es']) {
      // Match the actual user flow: language is changed in Settings, then the
      // AI page remounts in that language without retaining old private inputs.
      await page.evaluate(() => { location.hash = '#/settings'; });
      await page.locator('[data-language-select]').first().waitFor();
      await page.locator('[data-language-select]').first().selectOption(locale);
      await page.waitForFunction(async code => document.documentElement.lang === code && (await API.me()).user.language === code, locale);
      await page.evaluate(() => { location.hash = '#/ai'; });
      await page.waitForFunction(() => { const heading = document.querySelector('.ait-hero h1'); return heading && heading.textContent === I18n.t('aiTrial.title'); });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
        if (!fits) console.log('LAYOUT DIAGNOSTIC', await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth,
          overflowing: Array.from(document.querySelectorAll('body *')).map(node => ({ tag: node.tagName, id: node.id,
            class: typeof node.className === 'string' ? node.className : '', right: Math.round(node.getBoundingClientRect().right),
            width: Math.round(node.getBoundingClientRect().width) })).filter(node => node.width && node.right > innerWidth + 1).slice(0, 15) })));
        assert.equal(fits, true,
          `Authenticated AI route fits ${width}px in ${locale}`);
      }
    }
    console.log('PASS: authenticated AI route in six languages at 390/320px.');

    const unsupported = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
    await unsupported.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => undefined }));
    await unsupported.route('**/*', route => {
      if (new URL(route.request().url()).origin === base.origin) return route.continue();
      externalRequests.push(new URL(route.request().url()).hostname); return route.abort();
    });
    const publicPage = await unsupported.newPage(); publicPage.on('pageerror', error => errors.push(error.message));
    publicPage.setDefaultTimeout(15000);
    await publicPage.goto(new URL('/ai-test.html', base).href); await publicPage.evaluate(() => I18n.ready);
    assert.equal(await publicPage.evaluate(() => LocalAI.getStatus().phase), 'idle');
    await publicPage.click('#modelLoad');
    await publicPage.waitForFunction(() => document.querySelector('#modelStatus').dataset.errorCode === 'AI_WEBGPU_UNAVAILABLE');
    assert.equal(await publicPage.locator('#modelOutput').textContent(), '', 'Unsupported real engine never invents an answer.');
    assert.equal(await publicPage.evaluate(() => LocalAI.getStatus().loaded), false);
    assert.equal(await publicPage.locator('#modelRun').isDisabled(), true);
    for (const locale of ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'es']) {
      await publicPage.selectOption('[data-language-select]', locale);
      await publicPage.waitForFunction(() => document.querySelector('h1').textContent === I18n.t('aiTest.title'));
      for (const width of [390, 320]) {
        await publicPage.setViewportSize({ width, height: 844 });
        assert.equal(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
          `Public AI test fits ${width}px in ${locale}`);
      }
    }
    assert.deepEqual(errors, []); assert.deepEqual(externalRequests, [], 'No weights, OCR downloads, external mail, or remote endpoints were requested.');
    console.log('PASS: real local API registration/login/onboarding/family/ledger; scoped evidence; reviewed two-row batch with two puzzle credits; atomic server rejections; receipt owner ACL and relogin persistence; six locales at 390/320px; real unsupported-device error. Model load/generation used an explicit contract fixture, not model-quality evidence.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
