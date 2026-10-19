'use strict';
// Explicit production acceptance. Default is a local dry run; --auth adds own-account checks.
// No registration, email send, delete, record creation, household creation, or puzzle writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = 'https://fambudget-recovery-20261017.onrender.com';
const options = { execute: false, auth: false, qaEmail: process.env.FAMBUDGET_QA_EMAIL };
const argumentNames = { '--output': 'output', '--credentials': 'credentials', '--qa-email': 'qaEmail', '--site': 'site' };
try {
  for (let index = 2; index < process.argv.length; index++) {
    const argument = process.argv[index];
    if (argument === '--execute') options.execute = true;
    else if (argument === '--auth') options.auth = true;
    else if (argument === '--help') {
      console.log('Default: dry run. Execution: --execute --output PRIVATE_DIR [--auth --credentials PRIVATE_JSON --qa-email QA_ADDRESS].');
      process.exit(0);
    } else if (argumentNames[argument] && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) options[argumentNames[argument]] = process.argv[++index];
    else throw new Error('Invalid command line. Use --help.');
  }
  assert.ok(!options.site || options.site === base, 'Only the exact coordinated production origin is allowed.');
} catch (_) {
  console.error('Invalid command line or production origin. Use --help.');
  process.exit(1);
}
if (!options.execute) {
  console.log('Prepared only. No browser, HTTP calls, private-file reads, writes, form submissions, or emails.');
  console.log('Execution requires confirmed network policy and an existing external 0700 --output directory. Auth mode also requires explicit QA email and private 0600 credentials.');
  process.exit(0);
}
process.umask(0o077);
let output = null;
const authMode = options.auth;
const at = route => base + '/#/' + route;
const report = { target: base, mode: authMode ? 'auth' : 'public', viewportWidths: [389, 390], checks: [], pageErrors: [], blockedMutations: [], blockedExternalRequests: 0, optionalFontRequestsBlocked: 0, serverErrors: [], screenshots: [] };
let credentials = null;
function check(name) { report.checks.push(name); }
function outsideGit(filename) {
  for (let current = path.resolve(filename); ; current = path.dirname(current)) {
    assert.ok(!fs.existsSync(path.join(current, '.git')), 'Private artifacts must stay outside Git.');
    if (path.dirname(current) === current) break;
  }
}
function privateDirectory(filename) {
  assert.ok(filename, 'An explicit private path is required.');
  const info = fs.lstatSync(path.resolve(filename));
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o700 && info.uid === process.getuid(), 'Private directory must be owner-held with mode 0700.');
  const resolved = fs.realpathSync(filename); outsideGit(resolved); return resolved;
}
function privateFile(filename, mustExist = true) {
  const supplied = path.resolve(filename);
  const resolved = path.join(privateDirectory(path.dirname(supplied)), path.basename(supplied)); outsideGit(resolved);
  if (mustExist || fs.existsSync(resolved)) {
    const info = fs.lstatSync(resolved);
    assert.ok(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o600 && info.uid === process.getuid() && info.nlink === 1, 'Private file must be owner-held with mode 0600 and one link.');
  }
  return resolved;
}
async function run() {
  // Deliberately require the parent to confirm the hostname allowlist before any connection.
  assert.equal(process.env.PRODUCTION_QA_POLICY_READY, 'yes', 'Confirm network policy in the new task before setting PRODUCTION_QA_POLICY_READY=yes.');
  output = privateDirectory(options.output);
  if (authMode) {
    assert.ok(options.credentials && options.qaEmail, 'Auth mode requires explicit private credentials and QA email.');
    assert.ok(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.qaEmail) && !options.qaEmail.toLowerCase().endsWith('.test'), 'Use an actual authorized QA mailbox, never an example .test address.');
    const credentialPath = privateFile(options.credentials);
    assert.ok(credentialPath !== output && !credentialPath.startsWith(output + path.sep), 'Credentials must be outside the browser artifact directory.');
    credentials = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    assert.equal(credentials.qaOnly, true, 'Manifest must explicitly identify a dedicated QA account.');
    assert.equal(credentials.email, options.qaEmail);
    assert.ok(typeof credentials.password === 'string' && Buffer.byteLength(credentials.password) >= 12 && Buffer.byteLength(credentials.password) <= 72, 'Private QA password is invalid.');
    assert.equal(credentials.baseUrl, base);
    assert.ok(typeof credentials.name === 'string' && credentials.name.startsWith('QA '), 'Account must have a clear QA name.');
    assert.ok(credentials.expectedUserId && credentials.expectedFamilyId, 'Complete backend QA first; expected identity and household IDs are mandatory.');
  }
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  assert.ok(proxyUrl, 'The managed network policy proxy must be inherited.');
  const proxy = new URL(proxyUrl);
  assert.ok(['http:', 'https:'].includes(proxy.protocol), 'Unsupported inherited proxy scheme.');
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const launchOptions = { headless: true, proxy: { server: proxy.origin }, args: ['--no-sandbox'] };
  if (proxy.username) launchOptions.proxy.username = decodeURIComponent(proxy.username);
  if (proxy.password) launchOptions.proxy.password = decodeURIComponent(proxy.password);
  if (process.env.CHROMIUM_EXECUTABLE) launchOptions.executablePath = process.env.CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('fambudget.tour', 'done'));
    const page = await context.newPage(); let verifiedQA = false;
    page.setDefaultTimeout(60000);
    page.on('pageerror', () => report.pageErrors.push('Browser page error; private details withheld.'));
    page.on('response', response => { const url = new URL(response.url()); if (url.origin === base && response.status() >= 500) report.serverErrors.push({ status: response.status() }); });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (url.origin !== base) {
        if (['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(url.origin) && method === 'GET') report.optionalFontRequestsBlocked++;
        else report.blockedExternalRequests++;
        return route.abort('blockedbyclient');
      }
      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue();
      const login = authMode && method === 'POST' && ['/api/auth/login', '/api/auth/logout', '/api/auth/refresh'].includes(url.pathname);
      let payload = null; try { payload = request.postDataJSON(); } catch (_) {}
      const presentationPatch = method === 'PATCH' && url.pathname === '/api/auth/me' && payload && Object.keys(payload).length > 0 && Object.keys(payload).every(key => ['theme', 'language', 'appearance'].includes(key));
      const presentationPhoto = method === 'POST' && url.pathname === '/api/auth/me/appearance-image' && payload && Object.keys(payload).length === 1 && typeof payload.dataUrl === 'string' && payload.dataUrl.startsWith('data:image/png;base64,');
      const ownPresentation = authMode && verifiedQA && (presentationPatch || presentationPhoto);
      if (login || ownPresentation) return route.continue();
      report.blockedMutations.push(method + ' mutation blocked'); return route.abort('blockedbyclient');
    });
    async function overflow(label) { const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(size.scroll <= size.width + 1, label + ': ' + JSON.stringify(size)); }
    async function screenshot(name) {
      await page.evaluate(() => document.fonts.ready); await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(250); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(250);
      const filename = (authMode ? 'auth-' : 'public-') + name + '.png';
      const destination = privateFile(path.join(output, filename), false);
      await page.screenshot({ path: destination, fullPage: true, animations: 'disabled' }); fs.chmodSync(destination, 0o600); report.screenshots.push(filename);
    }
    async function photoFile() {
      const encoded = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
        const context = canvas.getContext('2d'), gradient = context.createLinearGradient(0, 0, 1200, 800);
        gradient.addColorStop(0, '#dce9c8'); gradient.addColorStop(1, '#176151'); context.fillStyle = gradient; context.fillRect(0, 0, 1200, 800);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      return { name: 'qa-background.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
    }
    async function digest() { return page.evaluate(async () => { const blob = LoginBackground.getPhotoBlob(); return { size: blob.size, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).join(',') }; }); }
    await page.goto(at('login'), { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForSelector('#loginF');
    await page.evaluate(() => I18n.ready);
    assert.equal(await page.evaluate(() => API.mode), 'http'); assert.equal(await page.evaluate(() => API.base), base);
    assert.equal(await page.locator('#lgRemember').isChecked(), false);
    assert.equal(await page.locator('a[href*="presentation"]').count(), 0);
    const capabilities = await page.evaluate(() => fetch('/capabilities').then(response => response.json()));
    assert.equal(capabilities.email_verification_required, true);
    assert.notEqual(capabilities.email_delivery_mode, 'demo');
    report.capabilities = { mailConfigured: capabilities.mail_configured, emailDeliveryMode: capabilities.email_delivery_mode, verificationRequired: capabilities.email_verification_required };
    check('Published same-origin real API; verification required; no demo email mode; optional remember checkbox defaults off.');
    for (const width of [389, 390]) { await page.setViewportSize({ width, height: 844 }); await overflow('login ' + width); await screenshot('login-' + width); }
    if (!authMode) {
      for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN', 'zh-TW']) {
        await page.locator('[data-language-select]').first().selectOption(language); await page.waitForFunction(language => document.documentElement.lang === language, language); await overflow('language ' + language);
      }
      check('All six public language selections render without horizontal overflow.');
      await page.goto(at('appearance')); await page.waitForSelector('[data-lbg-preset]');
      assert.equal(await page.locator('[data-lbg-preset]').count(), 4);
      for (const preset of ['dawn', 'forest', 'night']) { await page.check('[data-lbg-preset][value="' + preset + '"]'); assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), preset); }
      await page.click('[data-appearance-theme="sky"]'); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'sky');
      await page.click('[data-appearance-cancel]'); await page.waitForSelector('#loginF');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'paper'); assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), 'dawn');
      check('Independent appearance page: three real background presets, live color preview, cancel restores selection.');
      await page.goto(at('appearance')); await page.waitForSelector('[data-lbg-preset]'); await page.check('[data-lbg-preset][value="forest"]');
      await page.click('[data-appearance-apply]'); await page.waitForSelector('#loginF'); await page.reload(); await page.waitForSelector('#loginF');
      assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), 'forest');
      await page.goto(at('appearance')); await page.waitForSelector('[data-lbg-preset]'); await page.check('[data-lbg-preset][value="custom"]');
      assert.equal(await page.locator('[data-lbg-file][capture="environment"]').count(), 1);
      const photo = await photoFile(); await page.locator('[data-lbg-file]').first().setInputFiles(photo);
      await page.waitForFunction(bytes => LoginBackground.getState().hasPhoto && LoginBackground.getPhotoBlob().size === bytes && !document.querySelector('[data-lbg-file]').disabled, photo.buffer.length);
      await page.locator('[data-lbg-setting="fit"]').selectOption('contain');
      await page.locator('[data-lbg-setting="brightness"]').evaluate(input => { input.value = '82'; input.dispatchEvent(new Event('input', { bubbles: true })); });
      const original = await digest();
      for (const width of [389, 390]) { await page.setViewportSize({ width, height: 844 }); await overflow('theme ' + width); await screenshot('theme-custom-' + width); }
      await page.click('[data-appearance-apply]'); await page.waitForSelector('#loginF'); await page.reload(); await page.waitForSelector('#loginF'); await page.evaluate(() => LoginBackground.ready());
      assert.deepEqual(await digest(), original); assert.equal(await page.evaluate(() => document.body.dataset.loginbackground), 'custom');
      assert.equal(await page.evaluate(() => LoginBackground.getState().fit), 'contain'); assert.equal(await page.evaluate(() => LoginBackground.getState().brightness), 82);
      check('Apply/reload retains custom PNG bytes, fit and brightness locally; public phase sends no account writes.');
      await page.goto(at('tutorial')); await page.waitForSelector('[data-start-tour]'); assert.equal(await page.locator('.tutorial-topic').count(), 10); await overflow('tutorial'); await screenshot('tutorial-390');
      await page.goto(at('verify-email')); await page.waitForSelector('#verifyRequestF'); await overflow('verify'); await screenshot('verification-form-390');
      await page.goto(at('forgot')); await page.waitForSelector('#forgotF');
      await page.goto(at('register')); await page.waitForSelector('#regF'); await overflow('register');
      check('Public tutorial, verification, forgot-password and registration pages load; no form submissions or email sends.');
    } else {
      await page.fill('#lgEmail', credentials.email); await page.fill('#lgPw', credentials.password); await page.click('#loginF button[type="submit"]');
      await page.waitForFunction(() => !location.hash.includes('/login')); const me = await page.evaluate(() => API.me());
      assert.equal(me.user.email.toLowerCase(), credentials.email.toLowerCase());
      assert.equal(me.user.name, credentials.name);
      assert.ok(me.user.emailVerified, 'QA mailbox must already be verified.');
      assert.ok(me.user.onboardedAt, 'Backend QA setup must finish onboarding; browser does not create a household.');
      assert.equal(String(me.user.id), String(credentials.expectedUserId));
      assert.equal(String(me.user.familyId), String(credentials.expectedFamilyId));
      verifiedQA = true;
      await page.waitForSelector('.dgrid'); assert.equal(await page.evaluate(() => !!sessionStorage.getItem('fambudget.auth')), true); assert.equal(await page.evaluate(() => !!localStorage.getItem('fambudget.auth')), false);
      assert.equal(await page.evaluate(password => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].some(value => value.includes(password)), credentials.password), false);
      check('Dedicated verified QA identity/household checked; login uses session tokens and stores no password.');
      await screenshot('home-390'); await page.click('#accountAvatar'); await page.waitForSelector('#profF'); assert.equal(await page.locator('#avaF').count(), 1); assert.ok(await page.locator('[data-goal]').count()); await overflow('profile'); await screenshot('profile-390');
      await page.goto(at('tutorial')); await page.waitForSelector('[data-start-tour]'); await page.click('[data-start-tour]'); await page.waitForSelector('#tourSkip'); await page.click('#tourSkip');
      check('Avatar links to goals/photo settings; authenticated interactive tour starts and exits.');
      await page.goto(at('appearance')); await page.waitForSelector('[data-lbg-preset]'); await page.check('[data-lbg-preset][value="custom"]');
      const ownPhoto = await photoFile(); await page.locator('[data-lbg-file]').first().setInputFiles(ownPhoto);
      await page.waitForFunction(bytes => LoginBackground.getState().hasPhoto && LoginBackground.getPhotoBlob().size === bytes && !document.querySelector('[data-lbg-file]').disabled, ownPhoto.buffer.length);
      await page.click('[data-appearance-apply]'); await page.waitForSelector('.settings-grid');
      const saved = (await page.evaluate(() => API.me())).user; assert.equal(saved.appearance.preset, 'custom'); assert.equal(saved.appearanceImageUrl, '/api/auth/me/appearance-image');
      await page.reload(); await page.waitForSelector('.settings-grid'); await page.waitForFunction(() => LoginBackground.getState().hasPhoto);
      for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN', 'zh-TW']) { await page.locator('[data-language-select]').first().selectOption(language); await page.waitForFunction(async language => document.documentElement.lang === language && (await API.me()).user.language === language, language); await overflow('account language ' + language); }
      check('Only dedicated QA presentation changed: custom photo survives reload; six languages persist to account.');
      await page.goto(at('entry')); await page.waitForSelector('[data-manual-entry]'); await page.click('[data-manual-entry]'); await page.waitForSelector('#singleAmount');
      assert.equal(await page.locator('[data-media-pending][capture="environment"]').count(), 1); await overflow('manual entry'); await screenshot('manual-camera-390');
      await page.goto(at('memories')); await page.waitForSelector('[data-mem-settings]'); await overflow('memories'); await screenshot('memories-390');
      check('Manual actual-amount entry/camera and memory garden load; no record or puzzle changes.');
      await page.goto(at('settings')); await page.waitForSelector('#logout'); await page.click('#logout'); await page.waitForSelector('#loginF');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('fambudget.auth')), null); check('QA session revoked on logout.');
    }
    assert.deepEqual(report.blockedMutations, []); assert.equal(report.blockedExternalRequests, 0); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.serverErrors, []);
    report.result = 'PASS';
  } finally { await browser.close(); }
}
run().catch(() => { report.result = 'FAIL'; report.error = 'Production browser validation failed; check policy, private paths, dependencies and dedicated QA state. Private details withheld.'; process.exitCode = 1; }).finally(() => {
  let reportWritten = false;
  if (output) {
    try {
      const destination = privateFile(path.join(output, authMode ? 'auth-report.json' : 'public-report.json'), false);
      fs.writeFileSync(destination, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'w' });
      reportWritten = true;
    } catch (_) { process.exitCode = 1; }
  }
  console.log(JSON.stringify({ result: report.result, mode: report.mode, checks: report.checks.length, reportWritten }));
});
