// Isolated browser contract tests for the three lifestyle screens.
// These exercise real UI modules and strict fixture responses; production checks run separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const frontend = path.join(__dirname, '..');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6xkAAAAASUVORK5CYII=', 'base64');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const css = ['tokens', 'app', 'wellness', 'savings-game', 'smoking', 'report-charts'].map(name => fs.readFileSync(path.join(frontend, 'css', name + '.css'), 'utf8')).join('\n');
    await page.setContent('<!doctype html><html lang="zh-Hant"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '\nbody{display:block;padding:14px;margin:0}#fixture{width:100%;min-width:0}.card{padding:18px}</style></head><body><main id="fixture"></main></body></html>');
    await page.evaluate(() => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part => [part.type,part.value]));
      const today = parts.year + '-' + parts.month + '-' + parts.day;
      const previous = new Date(today + 'T00:00:00Z'); previous.setUTCDate(previous.getUTCDate() - 1);
      window.__state = {
        today, previous:previous.toISOString().slice(0,10),
        prefs:{birthDate:'1990-06-15',timezone:'Asia/Taipei',smokingEnabled:true},
        jar:{name:'我的存錢筒',targetAmount:0,savedAmount:0,shape:'pig',imageUrl:null,progressPercent:0},
        health:[], smoke:[], monthlyLimit:4, requests:[], revoked:[], fail:null, holdPrefs:false, holdHealthPut:false, holdPhoto:false
      };
      window.I18n = {t:(key,fallback) => fallback,number:(value,options) => Number(value).toLocaleString('zh-TW',options)};
      window.LifeFeatures = {prefs:() => window.__state.prefs};
      const originalRevoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = value => { __state.revoked.push(value); originalRevoke(value); };
      const copy = value => JSON.parse(JSON.stringify(value));
      const exactKeys = (body, allowed) => { for (const key of Object.keys(body || {})) if (!allowed.includes(key)) throw new Error('Unexpected body field: ' + key); };
      window.LifeAPI = {
        async imageURL() {
          const blob = new Blob([new Uint8Array([137,80,78,71])], {type:'image/png'});
          if (__state.holdPhoto) return new Promise(resolve => { window.__releasePhoto = () => resolve(URL.createObjectURL(blob)); });
          return URL.createObjectURL(blob);
        },
        async request(method, suffix, body) {
          __state.requests.push({method,suffix,body:body ? copy(body) : null});
          if (__state.fail === method + ' ' + suffix) { __state.fail = null; throw new Error('測試連線中斷，資料尚未儲存。'); }
          const [route, query] = suffix.split('?'), parameters = new URLSearchParams(query || '');
          if (route === '/preferences') {
            if (method === 'GET' && __state.holdPrefs) return new Promise(resolve => { window.__releasePrefs = () => resolve(copy(__state.prefs)); });
            if (method === 'PUT') { exactKeys(body,['birthDate']); Object.assign(__state.prefs, body); }
            return copy(__state.prefs);
          }
          if (route === '/birthdays') return {members:[{displayName:'<img src=x onerror=alert(1)> 家人',isSelf:false}]};
          if (route === '/jar') {
            if (method === 'PUT') { exactKeys(body,['name','targetAmount','savedAmount','shape']); Object.assign(__state.jar, body); }
            return copy(__state.jar);
          }
          if (route === '/jar/image' && method === 'PUT') { exactKeys(body,['image']); __state.jar.imageUrl = '/api/lifestyle/jar/image'; return copy(__state.jar); }
          if (route === '/health') return {records:copy(__state.health.filter(row => !parameters.get('year') || row.date.startsWith(parameters.get('year') + '-')))};
          if (route.startsWith('/health/')) {
            const date = route.slice(8);
            if (method === 'DELETE') { __state.health = __state.health.filter(row => row.date !== date); return {ok:true}; }
            exactKeys(body,['heightCm','weightKg']);
            if (__state.holdHealthPut) await new Promise(resolve => { window.__releaseHealthPut = resolve; });
            const record = {date,...body,bmi:body.weightKg / (body.heightCm / 100) ** 2};
            __state.health = __state.health.filter(row => row.date !== date).concat(record); return copy(record);
          }
          if (route === '/smoking/settings') { exactKeys(body,['monthlyLimit']); __state.monthlyLimit = body.monthlyLimit; return {monthlyLimit:body.monthlyLimit}; }
          if (route === '/smoking') {
            const month = parameters.get('month'), days = __state.smoke.filter(row => row.date.startsWith(month + '-'));
            return {month,days:copy(days),totalBought:days.reduce((sum,row) => sum + row.boughtPacks,0),totalSmoked:days.reduce((sum,row) => sum + row.smokedPacks,0),monthlyLimit:__state.monthlyLimit};
          }
          if (route.startsWith('/smoking/')) {
            exactKeys(body,['boughtPacks','smokedPacks']); const record = {date:route.slice(9),...body};
            __state.smoke = __state.smoke.filter(row => row.date !== record.date).concat(record); return copy(record);
          }
          throw new Error('Unexpected request: ' + method + ' ' + suffix);
        }
      };
    });
    for (const name of ['report-charts', 'wellness', 'savings-game', 'smoking']) await page.addScriptTag({path:path.join(frontend,'js',name + '.js')});
    const overflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, '390px layout must not scroll horizontally');
    const saved = async selector => page.waitForFunction(selector => { const node = document.querySelector(selector); return node && !node.disabled; }, selector);

    // A first-time user has no goal yet: the screen must still allow setting one.
    await page.evaluate(() => SavingsGame.mount(document.querySelector('#fixture')));
    await page.locator('[data-sg-form]').waitFor();
    assert.equal(await page.locator('[data-sg-percent]').textContent(), '0%');
    assert.equal(await page.locator('body').innerText().then(text => /NaN|Infinity/.test(text)), false);
    await page.locator('[name="name"]').fill('旅行小恐龍');
    await page.locator('[name="targetAmount"]').fill('1000');
    await page.locator('[name="savedAmount"]').fill('200');
    assert.equal(await page.locator('[data-sg-percent]').textContent(), '20%');
    await page.locator('[data-sg-form] button[type="submit"]').click(); await saved('[data-sg-form] button[type="submit"]');
    await page.locator('[data-sg-shape="dinosaur"]').click();
    await page.locator('[data-sg-shape="dinosaur"][aria-pressed="true"]').waitFor();
    await page.locator('[name="delta"]').fill('100');
    await page.locator('[data-sg-deposit] button[type="submit"]').click(); await saved('[data-sg-form] button[type="submit"]');
    assert.equal(await page.locator('[data-sg-percent]').textContent(), '30%');
    assert.deepEqual(await page.evaluate(() => __state.requests.filter(request => request.method === 'PUT' && request.suffix === '/jar').map(request => request.body)), [
      {name:'旅行小恐龍',targetAmount:1000,savedAmount:200,shape:'pig'}, {shape:'dinosaur'}, {savedAmount:300}
    ]);
    await overflow();
    await page.evaluate(() => { __state.fail = 'PUT /jar'; });
    await page.locator('[name="delta"]').fill('50'); await page.locator('[data-sg-deposit] button[type="submit"]').click();
    await page.locator('[data-sg-status].is-error').waitFor();
    assert.equal(await page.locator('[data-sg-percent]').textContent(), '30%', 'Failed writes must leave saved progress unchanged');
    await page.locator('[data-sg-file]').setInputFiles({name:'wish.png',mimeType:'image/png',buffer:pixel});
    await page.locator('[data-sg-shape="photo"][aria-pressed="true"]').waitFor();
    await page.locator('.savings-game__photo-fill').waitFor();
    assert.equal(await page.locator('[data-sg-visual]').evaluate(node => node.style.getPropertyValue('--sg-empty')), '70%');
    await page.evaluate(() => { SavingsGame.cleanup(); __state.holdPhoto = true; });
    await page.evaluate(() => SavingsGame.mount(document.querySelector('#fixture')));
    await page.waitForFunction(() => typeof window.__releasePhoto === 'function');
    const previousRevokes = await page.evaluate(() => __state.revoked.length);
    await page.evaluate(() => { SavingsGame.cleanup(); __releasePhoto(); });
    await page.waitForFunction(count => __state.revoked.length > count, previousRevokes);
    assert.equal(await page.locator('.savings-game__photo-fill').count(), 0, 'A late private photo must be revoked instead of appearing after cleanup');

    // Birthday loading cannot accidentally erase an existing full birth date.
    await page.evaluate(() => { document.querySelector('#fixture').innerHTML = ''; __state.holdPrefs = true; Wellness.mountProfile(document.querySelector('#fixture')); });
    assert.equal(await page.locator('[data-wellness-birth-form] button').isDisabled(), true);
    await page.evaluate(() => { __state.holdPrefs = false; __releasePrefs(); });
    await saved('[data-wellness-birth-form] button');
    assert.equal(await page.locator('[data-wellness-birth-date]').inputValue(), '1990-06-15');
    await page.locator('[data-wellness-birth-date]').fill('2000-10-18');
    await page.locator('[data-wellness-birth-form] button').click(); await saved('[data-wellness-birth-form] button');
    assert.equal(await page.evaluate(() => __state.prefs.birthDate), '2000-10-18');
    await page.evaluate(() => Wellness.celebrate(document.querySelector('#fixture')));
    await page.locator('[data-wellness-birthday]').waitFor();
    assert.equal(await page.locator('[data-wellness-birthday] img').count(), 0, 'Family display names must remain escaped text');
    await overflow();
    await page.locator('[data-wellness-birthday-dismiss]').click();
    assert.equal(await page.locator('[data-wellness-birthday]').count(), 0);

    // Daily measurements persist, calculate BMI, and provide monthly/yearly chart choices.
    await page.evaluate(() => { Wellness.cleanup(); Wellness.mount(document.querySelector('#fixture'), {date:__state.today}); });
    await page.waitForFunction(() => document.querySelector('[data-wellness-chart]').getAttribute('aria-busy') === 'false');
    await page.locator('[data-wellness-height]').fill('170'); await page.locator('[data-wellness-weight]').fill('70');
    assert.equal(await page.locator('[data-wellness-bmi]').textContent(), '24.2');
    await page.locator('[data-wellness-save]').click(); await saved('[data-wellness-save]');
    assert.equal(await page.locator('[data-wellness-record]').count(), 1);
    await page.locator('[data-wellness-chart-type]').selectOption('bar');
    await page.locator('[data-wellness-period]').selectOption('year');
    assert.equal(await page.locator('[data-wellness-month-label]').isHidden(), true);
    await page.locator('[data-wellness-chart-type]').selectOption('table');
    assert.equal(await page.locator('[data-wellness-chart] table').count(), 1);
    await overflow();
    // Navigating away while moving a measurement must not start a second write under a new session.
    await page.locator('[data-wellness-edit]').click();
    await page.locator('[data-wellness-date]').fill(await page.evaluate(() => __state.previous));
    await page.evaluate(() => { __state.holdHealthPut = true; });
    await page.locator('[data-wellness-save]').click();
    await page.waitForFunction(() => typeof window.__releaseHealthPut === 'function');
    const deletesBefore = await page.evaluate(() => __state.requests.filter(request => request.method === 'DELETE').length);
    await page.evaluate(() => { Wellness.cleanup(); __releaseHealthPut(); });
    await page.waitForFunction(() => __state.health.length === 2);
    assert.equal(await page.evaluate(() => __state.requests.filter(request => request.method === 'DELETE').length), deletesBefore);

    // Smoking counts are distinct, persistent, reversible, and reflected in the monthly lung.
    await page.evaluate(() => SmokingTracker.mount(document.querySelector('#fixture')));
    await page.locator('[data-smoking-action="smoked-plus"]').waitFor();
    assert.equal(await page.locator('[data-smoking-action="smoked-minus"]').isDisabled(), true);
    await page.locator('[data-smoking-action="bought-plus"]').click(); await saved('[data-smoking-action="bought-plus"]');
    assert.equal(await page.locator('[data-smoking-total="bought"]').textContent(), '1 包');
    assert.equal(await page.locator('[data-smoking-total="smoked"]').textContent(), '0');
    await page.locator('[data-smoking-action="smoked-plus"]').click(); await saved('[data-smoking-action="smoked-plus"]');
    assert.equal(await page.locator('[data-smoking-lungs]').evaluate(node => node.style.getPropertyValue('--smoking-darkness')), '0.2500');
    await page.locator('[data-smoking-lungs].is-pulsing').waitFor();
    await page.locator('[data-smoking-metric]').selectOption('boughtPacks');
    await page.locator('[data-smoking-chart-type]').selectOption('bar');
    await page.locator('[name="monthlyLimit"]').fill('2');
    await page.locator('[data-smoking-action="save-limit"]').click(); await saved('[data-smoking-action="save-limit"]');
    assert.equal(await page.locator('[data-smoking-lungs]').evaluate(node => node.style.getPropertyValue('--smoking-darkness')), '0.5000');
    await page.locator('[data-smoking-action="smoked-minus"]').click(); await saved('[data-smoking-action="smoked-plus"]');
    assert.equal(await page.locator('[data-smoking-total="smoked"]').textContent(), '0');
    assert.equal(await page.locator('[data-smoking-action="smoked-minus"]').isDisabled(), true);
    await page.locator('[name="monthlyLimit"]').fill('0'); await page.locator('[data-smoking-action="save-limit"]').click(); await saved('[data-smoking-action="save-limit"]');
    assert.equal(await page.locator('[data-smoking-lungs]').evaluate(node => node.style.getPropertyValue('--smoking-darkness')), '0.0000');
    await overflow();
    await page.evaluate(() => { SmokingTracker.cleanup(); __state.prefs.smokingEnabled = false; SmokingTracker.mount(document.querySelector('#fixture')); });
    await page.locator('.smoking-disabled').waitFor();
    assert.equal(await page.locator('[data-smoking-action="smoked-plus"]').count(), 0);
    await page.evaluate(() => { SmokingTracker.cleanup(); SavingsGame.cleanup(); Wellness.cleanup(); });
    assert.deepEqual(errors, []);
    console.log('Lifestyle browser contracts passed: new jar, strict payloads, private photo cleanup, birthday load/save/escaping, BMI reports, stale health write, smoking counts/limits/disabled screen, 390px layouts.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
