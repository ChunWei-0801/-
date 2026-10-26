/* Actual smoking UI, isolated account/API fixtures. These tests exercise controls,
 * carryover, corrections and stale replies; they never contact production. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engineName = process.env.FAMBUDGET_TEST_BROWSER || 'chromium';
const mobile = process.env.FAMBUDGET_TEST_DEVICE !== 'desktop';
const frontend = path.resolve(__dirname, '..');
const TODAY = '2026-10-26', MONTH = '2026-10';
async function fixture(t, records = []) {
  const browser = await playwright[engineName].launch({ headless: true,
    ...(engineName === 'chromium' ? { executablePath: process.env.CHROMIUM_EXECUTABLE || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] } : {}) });
  t.after(() => browser.close());
  const device = mobile ? (engineName === 'chromium' ? playwright.devices['Pixel 7'] : engineName === 'webkit' ? playwright.devices['iPhone 13'] : { viewport: { width: 390, height: 844 } }) : { viewport: { width: 1280, height: 900 } };
  const context = await browser.newContext({ ...device, timezoneId: 'Asia/Taipei', reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], unexpected = [];
  page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url() === 'http://smoking-inventory-fixture.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-TW" data-theme="paper"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="fixture"></main></body></html>' });
    unexpected.push(route.request().url()); return route.abort();
  });
  await page.goto('http://smoking-inventory-fixture.test/');
  await page.clock.setFixedTime(new Date('2026-10-26T04:00:00Z'));
  for (const file of ['tokens', 'app', 'life-features', 'smoking', 'report-charts']) await page.addStyleTag({ path: path.join(frontend, 'css', file + '.css') });
  await page.addStyleTag({ content: 'body{margin:0;padding:14px;display:block}#fixture{width:100%;min-width:0}' });
  await page.evaluate(records => {
    const copy = value => JSON.parse(JSON.stringify(value));
    window.__smoke = { owner: 'owner', rows: { owner: copy(records), other: [] }, calls: [], failNext: null, conflictNext: null, holdPut: false, loseCommittedReply: false, failRefreshOnce: false, timezone: 'Asia/Taipei' };
    function inventory(month, rows) {
      const start = month + '-01', end = month + '-31'; let balance = 0, opening = 0, minimum = 0, first = null;
      for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
        if (row.date > end) break;
        balance += row.boughtPacks - row.smokedPacks;
        if (row.date < start) opening = balance;
        if (balance < minimum) minimum = balance;
        if (balance < 0 && first === null) first = row.date;
      }
      return { openingPacks: opening, closingPacks: balance, minimumPacks: minimum, shortfallPacks: Math.max(0, -minimum), consistent: minimum >= 0, firstShortfallDate: first };
    }
    function snapshot(month, owner) {
      const rows = __smoke.rows[owner], days = rows.filter(row => row.date.startsWith(month + '-'));
      return { month, days: copy(days), totalBought: days.reduce((n, row) => n + row.boughtPacks, 0), totalSmoked: days.reduce((n, row) => n + row.smokedPacks, 0), monthlyLimit: 10, inventory: inventory(month, rows) };
    }
    function deficits(rows) {
      let balance = 0; const map = new Map();
      for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) { balance += row.boughtPacks - row.smokedPacks; map.set(row.date, balance); }
      return map;
    }
    function worsens(before, after) {
      const a = deficits(before), b = deficits(after); let priorA = 0, priorB = 0;
      for (const date of [...new Set([...a.keys(), ...b.keys()])].sort()) {
        if (a.has(date)) priorA = a.get(date); if (b.has(date)) priorB = b.get(date);
        if (priorB < Math.min(0, priorA)) return true;
      }
      return false;
    }
    window.I18n = { t: (_, fallback) => fallback, number: value => String(value),
      date: (value, options = {}) => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: options.timeZone || __smoke.timezone }).format(value) };
    window.LifeFeatures = { user: () => ({ id: __smoke.owner }) };
    window.LifeAPI = { request: async (method, suffix, body) => {
      const actor = __smoke.owner, [route, query] = suffix.split('?'), params = new URLSearchParams(query || '');
      __smoke.calls.push({ method, suffix, body: body == null ? null : copy(body), actor });
      if (route === '/preferences' && method === 'GET') return { smokingEnabled: true, timezone: __smoke.timezone };
      if (route === '/smoking' && method === 'GET') {
        if (__smoke.failRefreshOnce) { __smoke.failRefreshOnce = false; throw Error('無法重新核對最新紀錄'); }
        return snapshot(params.get('month'), actor);
      }
      if (route.startsWith('/smoking/') && method === 'PUT' && route !== '/smoking/settings') {
        if (Object.keys(body).sort().join(',') !== 'boughtPacks,smokedPacks') throw Error('Unexpected fixture payload');
        if (__smoke.holdPut) await new Promise(resolve => { window.__releaseSmokingPut = resolve; });
        if (__smoke.failNext) { const failure = __smoke.failNext; __smoke.failNext = null; throw Error(failure); }
        if (__smoke.conflictNext) {
          __smoke.rows[actor] = copy(__smoke.conflictNext); __smoke.conflictNext = null;
          const error = Error('剩餘包數不足，請重新核對購買與實抽紀錄。'); error.status = 409; throw error;
        }
        const date = route.slice('/smoking/'.length), previous = __smoke.rows[actor], next = previous.filter(row => row.date !== date).concat({ date, ...body });
        if (worsens(previous, next)) { const error = Error('減少購買會造成實抽超過可用包數，請先修正紀錄。'); error.status = 409; throw error; }
        __smoke.rows[actor] = next;
        if (__smoke.loseCommittedReply) { __smoke.loseCommittedReply = false; __smoke.failRefreshOnce = true; throw Error('儲存結果不明，請先重新核對'); }
        return { ...snapshot(date.slice(0, 7), actor), date, ...copy(body) };
      }
      throw Error('Unexpected fixture request ' + method + ' ' + suffix);
    } };
  }, records);
  await page.addScriptTag({ path: path.join(frontend, 'js/report-charts.js') });
  await page.addScriptTag({ path: path.join(frontend, 'js/smoking.js') });
  await page.evaluate(() => SmokingTracker.mount(document.querySelector('#fixture')));
  await page.locator('[data-smoking-stock]').waitFor();
  return { page, errors, unexpected };
}
async function idle(page) { await page.waitForFunction(() => document.querySelector('#fixture').getAttribute('aria-busy') !== 'true'); }
async function press(page, action) { await page.locator('[data-smoking-action="' + action + '"]').click(); await idle(page); }
async function selectMonth(page, month) { const input = page.locator('[data-smoking-month]'); await input.fill(month); await input.blur(); await idle(page); }
async function stock(page, value) { await page.waitForFunction(value => document.querySelector('[data-smoking-stock]')?.textContent.trim().startsWith(String(value)), value); }
async function edit(page, date, bought, smoked) {
  await page.locator('[data-smoking-edit-date="' + date + '"]').click();
  const form = page.locator('[data-smoking-edit-form]'); await form.waitFor();
  await form.locator('[name=boughtPacks]').fill(String(bought)); await form.locator('[name=smokedPacks]').fill(String(smoked));
  await form.locator('[data-smoking-edit-save]').click(); await idle(page);
}
async function fit(page) {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), engineName + ' inventory layout fits ' + width);
  }
}
function clean(h) { assert.deepEqual(h.errors, []); assert.deepEqual(h.unexpected, []); }

test('zero stock prevents over-consumption and spent purchases cannot be removed; lungs retain their DOM node', async t => {
  const h = await fixture(t), p = h.page;
  assert.equal(await p.locator('[data-smoking-action=smoked-plus]').isDisabled(), true);
  await p.locator('[data-smoking-action=smoked-plus]').evaluate(node => node.click());
  assert.equal(await p.evaluate(() => __smoke.calls.filter(call => call.method === 'PUT').length), 0);
  await p.evaluate(() => { window.__originalLungs = document.querySelector('[data-smoking-lungs]'); });
  await press(p, 'bought-plus'); await stock(p, 1);
  assert.equal(await p.locator('[data-smoking-action=smoked-plus]').isDisabled(), false);
  await press(p, 'smoked-plus'); await stock(p, 0);
  assert.equal(await p.locator('[data-smoking-action=smoked-plus]').isDisabled(), true);
  assert.equal(await p.locator('[data-smoking-action=bought-minus]').isDisabled(), true);
  assert.equal((await p.locator('[data-smoking-count=smoked]').textContent()).replace(/\s+/g, ''), '1包');
  assert.equal(await p.evaluate(() => __originalLungs === document.querySelector('[data-smoking-lungs]')), true);
  assert.equal(await p.evaluate(() => __smoke.calls.filter(call => call.method === 'PUT').length), 2);
  await press(p, 'smoked-minus'); await stock(p, 1);
  assert.equal(await p.locator('[data-smoking-action=bought-minus]').isDisabled(), false);
  await press(p, 'bought-minus'); await stock(p, 0);
  await fit(p); clean(h);
});

test('prior-month stock permits smoking without buying again; reducing an old purchase cannot invalidate later consumption', async t => {
  const h = await fixture(t, [{ date: '2026-09-30', boughtPacks: 2, smokedPacks: 0 }, { date: TODAY, boughtPacks: 0, smokedPacks: 1 }]), p = h.page;
  await stock(p, 1); assert.match(await p.locator('[data-smoking-opening]').innerText(), /2/);
  assert.match(await p.locator('[data-smoking-total=bought]').innerText(), /^0/);
  await press(p, 'smoked-plus'); await stock(p, 0);
  assert.match(await p.locator('[data-smoking-total=smoked]').innerText(), /^2/);
  await selectMonth(p, '2026-09'); await stock(p, 2);
  await edit(p, '2026-09-30', 1, 0);
  assert.match(await p.locator('[data-smoking-status]').innerText(), /超過|不足|修正/);
  assert.equal(await p.evaluate(() => __smoke.rows.owner.find(row => row.date === '2026-09-30').boughtPacks), 2);
  await stock(p, 2); await fit(p); clean(h);
});

test('historical deficits stay visible as signed stock and can be repaired progressively without erasing history', async t => {
  const h = await fixture(t, [{ date: '2026-09-30', boughtPacks: 0, smokedPacks: 2 }, { date: TODAY, boughtPacks: 1, smokedPacks: 0 }]), p = h.page;
  await stock(p, -1); assert.equal(await p.locator('[data-smoking-inventory-warning]').isVisible(), true);
  assert.match(await p.locator('[data-smoking-opening]').innerText(), /-2/);
  await selectMonth(p, '2026-09'); await stock(p, -2);
  await edit(p, '2026-09-30', 1, 2); await stock(p, -1);
  assert.equal(await p.locator('[data-smoking-inventory-warning]').isVisible(), true);
  await edit(p, '2026-09-30', 1, 1); await stock(p, 0);
  assert.equal(await p.locator('[data-smoking-inventory-warning]').isVisible(), false);
  await selectMonth(p, MONTH); await stock(p, 1);
  assert.equal(await p.evaluate(() => __smoke.rows.owner.length), 2, 'historical records are corrected, never silently dropped');
  await fit(p); clean(h);
});

test('failed or conflicting saves do not invent consumption, and an old account response cannot replace the new screen', async t => {
  const h = await fixture(t, [{ date: TODAY, boughtPacks: 2, smokedPacks: 0 }]), p = h.page;
  // The server committed, but both its reply and the follow-up read were lost.
  await p.evaluate(() => { __smoke.loseCommittedReply = true; });
  await press(p, 'smoked-plus');
  assert.equal(await p.evaluate(() => __smoke.rows.owner[0].smokedPacks), 1);
  assert.equal(await p.locator('[data-smoking-action=smoked-plus]').isDisabled(), true);
  assert.equal(await p.locator('[data-smoking-action=bought-plus]').isDisabled(), true);
  const writesBeforeRetry = await p.evaluate(() => __smoke.calls.filter(call => call.method === 'PUT').length);
  await p.locator('[data-smoking-action=smoked-plus]').evaluate(node => node.click());
  await p.locator('[data-smoking-action=bought-plus]').evaluate(node => node.click());
  assert.equal(await p.evaluate(() => __smoke.calls.filter(call => call.method === 'PUT').length), writesBeforeRetry);
  assert.equal(await p.locator('[data-smoking-lungs].is-coughing').count(), 0);
  await press(p, 'retry-month'); await stock(p, 1);
  assert.match(await p.locator('[data-smoking-count=smoked]').innerText(), /^1/);
  assert.equal(await p.locator('[data-smoking-action=smoked-plus]').isDisabled(), false);
  assert.equal(await p.evaluate(() => __smoke.calls.filter(call => call.method === 'PUT').length), writesBeforeRetry, 'read retry never repeats an uncertain write');
  await p.evaluate(() => { SmokingTracker.cleanup(); __smoke.rows.owner = [{ date: '2026-10-26', boughtPacks: 2, smokedPacks: 0 }]; SmokingTracker.mount(document.querySelector('#fixture')); });
  await stock(p, 2);
  await p.evaluate(() => { __smoke.failNext = '連線中斷，尚未確認儲存'; });
  await press(p, 'smoked-plus'); await stock(p, 2);
  assert.match(await p.locator('[data-smoking-count=smoked]').innerText(), /^0/);
  assert.equal(await p.locator('[data-smoking-lungs].is-coughing').count(), 0);
  await p.evaluate(() => { __smoke.conflictNext = [{ date: '2026-10-26', boughtPacks: 2, smokedPacks: 2 }]; });
  await press(p, 'smoked-plus'); await stock(p, 0);
  assert.match(await p.locator('[data-smoking-count=smoked]').innerText(), /^2/);
  assert.equal(await p.locator('[data-smoking-lungs].is-coughing').count(), 0);
  assert.equal(await p.locator('[data-smoking-action=smoked-plus]').isDisabled(), true);
  await p.evaluate(() => {
    SmokingTracker.cleanup(); __smoke.rows.owner = [{ date: '2026-10-26', boughtPacks: 3, smokedPacks: 2 }];
    SmokingTracker.mount(document.querySelector('#fixture'));
  });
  await stock(p, 1); await p.evaluate(() => { __smoke.holdPut = true; });
  await p.locator('[data-smoking-action=smoked-plus]').click(); await p.waitForFunction(() => typeof __releaseSmokingPut === 'function');
  await p.evaluate(() => { SmokingTracker.cleanup(); __smoke.owner = 'other'; SmokingTracker.mount(document.querySelector('#fixture')); });
  await stock(p, 0); await p.evaluate(() => { __releaseSmokingPut(); });
  await p.waitForTimeout(40);
  await stock(p, 0); assert.match(await p.locator('[data-smoking-count=smoked]').innerText(), /^0/);
  assert.equal(await p.evaluate(() => __smoke.rows.owner[0].smokedPacks), 3);
  assert.equal(await p.evaluate(() => __smoke.rows.other.length), 0);
  clean(h);
});


test('calendar dates stay on the recorded day in Honolulu and match the correction editor', async t => {
  const h = await fixture(t, [{ date: '2026-10-20', boughtPacks: 2, smokedPacks: 0 }]), p = h.page;
  await p.evaluate(() => { __smoke.timezone = 'Pacific/Honolulu'; SmokingTracker.cleanup(); return SmokingTracker.mount(document.querySelector('#fixture')); });
  const recorded = p.locator('[data-smoking-day="2026-10-20"] time');
  await recorded.waitFor();
  assert.equal(await recorded.getAttribute('datetime'), '2026-10-20');
  assert.equal(await recorded.innerText(), '10/20/2026', 'A calendar date is not converted to the previous timezone day');
  await p.locator('[data-smoking-edit-date="2026-10-20"]').click();
  assert.match(await p.locator('[data-smoking-edit-form] h3').innerText(), /2026-10-20/);
  assert.equal(await p.locator('[data-smoking-edit-form] [name=boughtPacks]').inputValue(), '2');
  await fit(p); clean(h);
});

test('successful writes adopt the authoritative month snapshot after another device adds a purchase', async t => {
  const h = await fixture(t, [{ date: TODAY, boughtPacks: 1, smokedPacks: 0 }]), p = h.page;
  await stock(p, 1);
  assert.match(await p.locator('[data-smoking-total=bought]').innerText(), /^1/);
  await p.evaluate(() => {
    window.__originalLungs = document.querySelector('[data-smoking-lungs]');
    __smoke.rows.owner.push({ date: '2026-10-25', boughtPacks: 2, smokedPacks: 0 });
  });
  // The new row is only on the simulated server until the successful PUT reply.
  assert.equal(await p.locator('[data-smoking-day="2026-10-25"]').count(), 0);
  await press(p, 'smoked-plus'); await stock(p, 2);
  assert.match(await p.locator('[data-smoking-total=bought]').innerText(), /^3/);
  assert.match(await p.locator('[data-smoking-total=smoked]').innerText(), /^1/);
  await p.locator('[data-smoking-day="2026-10-25"]').waitFor();
  assert.equal(await p.evaluate(() => __originalLungs === document.querySelector('[data-smoking-lungs]')), true);
  assert.equal(await p.evaluate(() => __smoke.calls.filter(call => call.method === 'PUT').length), 1);
  assert.equal(await p.evaluate(() => __smoke.calls.filter(call => call.method === 'GET' && call.suffix.startsWith('/smoking?')).length), 1, 'Snapshot updates do not need another round trip');
  clean(h);
});
