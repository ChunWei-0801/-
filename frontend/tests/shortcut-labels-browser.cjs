/* Real Chromium display-preference checks; all accounts and requests are fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const origin = 'http://shortcut-labels-fixture.test';
const key = 'fambudget.shortcuts.labels.v1.';
const assets = new Map([
  ['/tokens.css', 'css/tokens.css'],
  ['/app.css', 'css/app.css'],
  ['/direct-shortcuts.css', 'css/direct-shortcuts.css'],
  ['/direct-shortcuts.js', 'js/direct-shortcuts.js'],
]);
const setup = `
  window.__user = {id:'a'};
  window.__lang = 'zh-TW';
  window.__writes = [];
  window.__navigation = [];
  window.__prefs = {shortcuts:[
    {id:'quick-entry',visible:true},{id:'entry',visible:true},
    {id:'groups',visible:true},{id:'profile',visible:true}
  ]};
  window.API = {mode:'http'};
  window.I18n = {language:()=>__lang,t:(key,fallback)=>fallback};
  window.LifeFeatures = {
    user:()=>__user,prefs:()=>__prefs,preferencesReady:()=>true,
    save:async patch=>{
      __writes.push(JSON.parse(JSON.stringify(patch)));
      __prefs={...__prefs,...patch};
      return __prefs;
    }
  };
  window.__render = function(){
    document.querySelector('#view').innerHTML = '<section class="qk">'+
      '<div class="qk__h"><h2 class="qk__t">常用功能</h2></div>'+
      '<nav class="dgrid" aria-label="功能">'+[
        ['data-quick="entry"','記一筆'],['data-nav="entry"','收支明細'],
        ['data-nav="groups"','活動'],['data-nav="profile"','個人資料與目標']
      ].map(row=>'<button class="dtile" '+row[0]+'><span class="dtile__ic">'+
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" '+
        'stroke="currentColor" stroke-width="1.8"/></svg></span>'+
        '<span class="dtile__t">'+row[1]+'</span></button>').join('')+'</nav></section>';
  };
  document.addEventListener('click',event=>{
    const tile=event.target.closest('.dtile');
    if(tile)__navigation.push(tile.querySelector('.dtile__t').textContent);
  });
  __render();
`;

async function fixture({ storageBlocked = false } = {}) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE ||
      (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  if (storageBlocked) await context.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('Fixture storage blocked', 'SecurityError'); };
  });
  const page = await context.newPage();
  const errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      unexpected.push(url.href);
      return route.abort();
    }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/app.css">'+
      '<link rel="stylesheet" href="/direct-shortcuts.css">'+
      '<style>body{padding:18px}#view{max-width:960px;margin:auto}</style></head><body>'+
      '<main id="view"></main><script>'+setup+'</script>'+ 
      '<script src="/direct-shortcuts.js"></script></body></html>' });
    const asset = assets.get(url.pathname);
    if (asset) return route.fulfill({
      contentType: asset.endsWith('.js') ? 'application/javascript' : 'text/css',
      body: fs.readFileSync(path.join(root, asset)),
    });
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(origin);
  await page.locator('[data-shortcut-arrange]').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return { browser, context, page, errors, unexpected };
}

async function enterEdit(page) {
  await page.locator('[data-shortcut-arrange]').click();
  await page.locator('[data-shortcut-labels]').waitFor({ state: 'visible' });
}

async function order(page) {
  return page.locator('.dgrid>.dtile').evaluateAll(nodes => nodes.map(node =>
    node.hasAttribute('data-quick') ? 'quick-entry' : node.dataset.nav));
}

function clean(h) {
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.unexpected, []);
}

test('labels default to visible, persist through reload and remount, and remain isolated by account', async () => {
  const h = await fixture();
  try {
    const p = h.page;
    assert.equal(await p.locator('[data-shortcut-labels]').isHidden(), true);
    assert.equal(await p.locator('.dgrid.is-icon-only').count(), 0);
    await enterEdit(p);
    assert.equal(await p.locator('[data-shortcut-labels]').getAttribute('aria-pressed'), 'true');
    await p.locator('[data-shortcut-labels]').click();
    assert.equal(await p.locator('[data-shortcut-labels]').getAttribute('aria-pressed'), 'false');
    assert.equal(await p.evaluate(k => localStorage.getItem(k+'a'), key), 'false');
    assert.equal(await p.evaluate(() => __writes.length), 0, 'display preference does not write financial/server preferences');
    await p.locator('[data-shortcut-cancel]').click();
    assert.equal(await p.locator('.dgrid.is-icon-only').count(), 1, 'cancelling order leaves the immediate display setting intact');
    await p.reload();
    await p.locator('.dgrid.is-icon-only').waitFor();
    await p.evaluate(() => __render());
    await p.locator('.dgrid.is-icon-only').waitFor();
    await p.evaluate(() => { __user={id:'b'}; __render(); });
    await p.waitForFunction(() => !document.querySelector('.dgrid').classList.contains('is-icon-only'));
    await enterEdit(p);
    assert.equal(await p.locator('[data-shortcut-labels]').getAttribute('aria-pressed'), 'true');
    await p.evaluate(() => { __user={id:'a'}; __render(); });
    await p.locator('.dgrid.is-icon-only').waitFor();
    assert.equal(await p.evaluate(() => __writes.length), 0);
    clean(h);
  } finally { await h.browser.close(); }
});

test('icon mode preserves accessible button names and tooltips while keyboard and pointer ordering work', async () => {
  const h = await fixture();
  try {
    const p = h.page;
    await enterEdit(p);
    await p.locator('[data-shortcut-labels]').click();
    const entry = p.getByRole('button', { name: '收支明細', exact: true });
    assert.equal(await entry.count(), 1, 'clipped text remains in the accessible name');
    assert.equal(await entry.getAttribute('title'), '收支明細');
    const label = await entry.locator('.dtile__t').boundingBox();
    assert.ok(label.width <= 1 && label.height <= 1, 'label is visually clipped in icon mode');
    await p.locator('[data-quick]').focus();
    await p.keyboard.press('ArrowRight');
    assert.deepEqual(await order(p), ['entry','quick-entry','groups','profile']);
    await p.keyboard.press('Escape');
    assert.deepEqual(await order(p), ['quick-entry','entry','groups','profile']);
    assert.equal(await p.locator('.dgrid.is-icon-only').count(), 1);

    await enterEdit(p);
    const a = await p.locator('[data-quick]').boundingBox();
    await p.mouse.move(a.x+a.width/2, a.y+a.height/2);
    await p.mouse.down();
    const ghost = p.locator('.shortcut-drag-ghost.is-icon-only');
    await ghost.waitFor();
    const ghostLabel = await ghost.locator('.dtile__t').boundingBox();
    assert.ok(ghostLabel.width <= 1 && ghostLabel.height <= 1, 'the body-level drag ghost keeps icon-only mode');
    const b = await p.locator('[data-nav="profile"]').boundingBox();
    await p.mouse.move(b.x+b.width/2, b.y+b.height/2, { steps: 8 });
    await p.mouse.up();
    assert.deepEqual(await order(p), ['entry','groups','profile','quick-entry']);
    assert.equal(await p.evaluate(() => __navigation.length), 0);
    await p.locator('[data-shortcut-done]').click();
    await p.waitForFunction(() => __writes.length === 1 && !document.querySelector('[data-shortcut-arrange]').hidden);
    assert.equal(await p.evaluate(() => __writes[0].shortcuts[0].id), 'entry');
    assert.equal(await p.locator('.dgrid.is-icon-only').count(), 1);
    clean(h);
  } finally { await h.browser.close(); }
});

test('blocked browser storage still permits session-only toggling and reports the limitation honestly', async () => {
  const h = await fixture({ storageBlocked: true });
  try {
    const p = h.page;
    await enterEdit(p);
    await p.locator('[data-shortcut-labels]').click();
    assert.equal(await p.locator('.dgrid.is-icon-only').count(), 1);
    assert.match(await p.locator('.shortcut-arrange-status').textContent(), /無法儲存/);
    assert.equal(await p.evaluate(k => localStorage.getItem(k+'a'), key), null);
    await p.evaluate(() => __render());
    await p.locator('.dgrid.is-icon-only').waitFor();
    await enterEdit(p);
    await p.locator('[data-shortcut-labels]').click();
    assert.equal(await p.locator('.dgrid.is-icon-only').count(), 0);
    assert.equal(await p.evaluate(() => __writes.length), 0);
    await p.reload();
    await p.locator('[data-shortcut-arrange]').waitFor();
    assert.equal(await p.locator('.dgrid.is-icon-only').count(), 0);
    clean(h);
  } finally { await h.browser.close(); }
});

test('localized controls and long labels fit at 320px with 200% root text size in either mode', async () => {
  const h = await fixture();
  try {
    const p = h.page;
    await p.setViewportSize({ width: 320, height: 1100 });
    await p.evaluate(() => { document.documentElement.style.fontSize='32px'; });
    await enterEdit(p);
    const locales = [
      ['zh-TW','顯示文字','個人資料與家庭理財目標設定'],
      ['en','Show labels','Personal information and financial savings goals'],
      ['zh-CN','显示文字','个人资料与家庭理财目标设置'],
      ['ja','文字を表示','個人情報と家族の貯蓄目標の設定'],
      ['ko','글자 표시','개인 정보 및 가족 재무 목표 설정'],
      ['es','Mostrar texto','Información personal y objetivos de ahorro familiar'],
    ];
    for (const [lang, control, title] of locales) {
      await p.evaluate(({lang,title}) => {
        __lang=lang;
        document.documentElement.lang=lang;
        document.querySelector('[data-nav="profile"] .dtile__t').textContent=title;
        dispatchEvent(new Event('fambudget:languagechange'));
      }, { lang, title });
      assert.equal(await p.locator('[data-shortcut-labels]').textContent(), control);
      for (const iconOnly of [true, false]) {
        await p.locator('[data-shortcut-labels]').click();
        assert.equal(await p.locator('.dgrid.is-icon-only').count(), iconOnly ? 1 : 0);
        if (iconOnly) assert.equal(await p.locator('[data-nav="profile"]').getAttribute('title'), title);
        const overflow = await p.evaluate(() => ({
          document: document.documentElement.scrollWidth > innerWidth,
          controls: [...document.querySelectorAll('.shortcut-arrange .btn:not([hidden]), .dgrid>.dtile')]
            .some(n => n.getBoundingClientRect().left < -1 || n.getBoundingClientRect().right > innerWidth+1),
        }));
        assert.deepEqual(overflow, { document: false, controls: false }, lang+' fits without horizontal overflow');
        const hit = await p.locator('[data-shortcut-labels]').boundingBox();
        assert.ok(hit.height >= 44 && hit.width >= 44);
        assert.equal(await p.getByRole('button', { name: title, exact: true }).count(), 1);
      }
    }
    clean(h);
  } finally { await h.browser.close(); }
});

test('invalid stored display values default to readable text and storage events synchronize only their owner', async () => {
  const h = await fixture();
  try {
    const p = h.page;
    await p.evaluate(k => localStorage.setItem(k+'a','{"show":false}'), key);
    await p.reload();
    await p.locator('[data-shortcut-arrange]').waitFor();
    assert.equal(await p.locator('.dgrid.is-icon-only').count(), 0);
    await p.evaluate(k => dispatchEvent(new StorageEvent('storage', {key:k+'b',newValue:'false'})), key);
    assert.equal(await p.locator('.dgrid.is-icon-only').count(), 0);
    await p.evaluate(k => dispatchEvent(new StorageEvent('storage', {key:k+'a',newValue:'false'})), key);
    await p.locator('.dgrid.is-icon-only').waitFor();
    await p.evaluate(k => dispatchEvent(new StorageEvent('storage', {key:k+'a',newValue:null})), key);
    await p.waitForFunction(() => !document.querySelector('.dgrid').classList.contains('is-icon-only'));
    clean(h);
  } finally { await h.browser.close(); }
});
