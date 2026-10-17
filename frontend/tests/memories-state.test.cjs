// Browser regressions for delayed file preparation, durable mutation responses,
// stale reads and private-image lifetime. No network or account data is used.
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE || undefined, args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<main id="view"></main>');
    await page.evaluate(() => {
      const photo = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>'], {type:'image/svg+xml'});
      const clone = value => JSON.parse(JSON.stringify(value));
      const state = {settings:{wallName:'生活收藏',pieceCount:9,period:'week',timezone:'Asia/Taipei',changesPerPeriod:2,wallBackgroundUrl:null}, current:null, creditsAvailable:0, period:{remaining:2,timezone:'Asia/Taipei'}};
      const createURL = URL.createObjectURL.bind(URL), revokeURL = URL.revokeObjectURL.bind(URL);
      window.test = {state, preparations:{}, created:[], revoked:[], requests:[], posts:[], failReads:false, deferRead:false};
      URL.createObjectURL = blob => { const url = createURL(blob); test.created.push(url); return url; };
      URL.revokeObjectURL = url => { test.revoked.push(url); revokeURL(url); };
      window.MediaTools = {
        esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
        t: (_, fallback) => fallback,
        message: error => error.message,
        prepareSquarePhoto: file => new Promise(resolve => { test.preparations[file.name] = () => resolve(file); }),
        preparePhoto: file => Promise.resolve(file),
        imageURL: () => Promise.resolve(URL.createObjectURL(photo)),
        json: async (route, options = {}) => {
          test.requests.push({route, method:options.method || 'GET'});
          if (route === '/api/memories') {
            if (test.failReads) throw new Error('Read service unavailable');
            if (test.deferRead) return new Promise(resolve => { test.resolveRead = () => resolve(clone({...state,settings:{...state.settings,wallName:'過期資料'}})); });
            return clone(state);
          }
          if (route.startsWith('/api/memories/achievements?')) {
            const params = new URL(route, 'https://test.invalid').searchParams;
            return {achievements:state.current?.completed && params.get('month') !== '11' ? [clone(state.current)] : [],years:[2026],page:1,pageSize:50,total:state.current?.completed && params.get('month') !== '11' ? 1 : 0};
          }
          if (route === '/api/memories/settings') { Object.assign(state.settings, JSON.parse(options.body)); return clone(state); }
          if (route === '/api/memories/puzzles') {
            test.posts.push(options.body.get('file').name);
            state.current = {id:'puzzle-1',pieceCount:9,earnedPieces:0,completed:false,imageUrl:'/private/puzzle',createdAt:'2026-10-17T01:00:00Z',timezone:'Asia/Taipei'};
            state.period.remaining--;
            return clone(state);
          }
          if (route === '/api/memories/wall-background') {
            state.settings.wallBackgroundUrl = options.method === 'DELETE' ? null : '/private/wall';
            return {settings:clone(state.settings)};
          }
          throw new Error('Unexpected request: ' + route);
        }
      };
    });
    await page.addScriptTag({path:path.join(__dirname, '../js/memories.js')});
    await page.evaluate(() => Memories.render(document.getElementById('view')));
    assert.equal(await page.locator('[data-mem-start-button]').isDisabled(), true);
    assert.equal(await page.locator('[name="wallName"]').getAttribute('maxlength'), '60');
    assert.ok(await page.locator('progress').getAttribute('aria-label'));

    const file = name => ({name,mimeType:'image/png',buffer:Buffer.from(name)});
    await page.locator('[data-mem-file]').setInputFiles(file('slow.png'));
    await page.locator('[data-mem-file]').setInputFiles(file('chosen.png'));
    await page.evaluate(() => test.preparations['chosen.png']());
    await page.waitForFunction(() => !document.querySelector('[data-mem-start-button]').disabled);
    const preview = await page.locator('[data-mem-preview] img').getAttribute('src');
    await page.evaluate(() => test.preparations['slow.png']());
    await page.waitForFunction(() => document.querySelector('[data-mem-preview] img').getAttribute('src') !== '');
    assert.equal(await page.locator('[data-mem-preview] img').getAttribute('src'), preview, 'The most recently chosen photo must win');
    await page.evaluate(() => { test.failReads = true; });
    await page.locator('[data-mem-start-button]').click();
    await page.getByText('新拼圖已開始！接下來每筆記帳都會收集一片。', {exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(() => test.posts), ['chosen.png']);
    assert.equal(await page.locator('[data-mem-file]').count(), 0, 'An unfinished photo remains locked even if a follow-up read is unavailable');
    assert.equal(await page.evaluate(() => test.requests.filter(r => r.route === '/api/memories').length), 1, 'Successful writes render their committed response without a second read');

    await page.evaluate(async () => { test.failReads = false; test.state.current.completed = true; test.state.current.earnedPieces = 9; test.state.current.completedAt = '2026-10-17T02:00:00Z'; test.state.current.year = 2026; test.state.current.month = 10; await Memories.render(document.getElementById('view')); });
    await page.locator('.memories-achievement img').waitFor();
    const archivedPhoto = await page.locator('.memories-achievement img').getAttribute('src');
    await page.locator('[data-mem-year]').selectOption('2026');
    await page.locator('[data-mem-month]').selectOption('11');
    await page.getByText('這個年月還沒有完成的拼圖。每筆記帳，都會讓下一張成就更接近。', {exact:true}).waitFor();
    assert.ok(await page.evaluate(url => test.revoked.includes(url), archivedPhoto), 'Changing archive filters releases private photo URLs');
    assert.ok(await page.evaluate(() => test.requests.some(r => r.route.includes('year=2026') && r.route.includes('month=11'))), 'Year and month both reach the API');
    await page.locator('[data-mem-month]').selectOption('10');
    await page.locator('.memories-achievement img').waitFor();
    await page.locator('[data-mem-wall-file]').setInputFiles(file('background.png'));
    await page.getByText('成就牆背景已儲存。', {exact:true}).waitFor();
    assert.equal(await page.locator('[data-mem-wall]').evaluate(node => node.classList.contains('has-background')), true);
    assert.equal(await page.locator('[data-mem-year]').inputValue(), '2026');
    assert.equal(await page.locator('[data-mem-month]').inputValue(), '10');
    await page.locator('[data-mem-wall-clear]').click();
    await page.getByText('牆面背景已移除。', {exact:true}).waitFor();
    assert.equal(await page.locator('[data-mem-wall]').evaluate(node => node.classList.contains('has-background')), false);

    await page.evaluate(() => { test.deferRead = true; });
    await page.locator('[data-mem-refresh]').click();
    await page.locator('[name="wallName"]').fill('新的收藏名稱');
    await page.locator('[data-mem-settings] button').click();
    await page.getByText('收集設定已儲存。', {exact:true}).waitFor();
    await page.evaluate(() => test.resolveRead());
    assert.equal(await page.locator('[data-mem-wall-name]').textContent(), '新的收藏名稱', 'An older refresh cannot overwrite a committed setting');
    await page.evaluate(() => Memories.dispose());
    assert.equal(await page.evaluate(() => test.created.filter(url => !test.revoked.includes(url)).length), 0, 'Leaving the page releases all private photo URLs');
    assert.deepEqual(errors, []);
    console.log('PASS: latest photo wins; committed write survives read outage; unfinished image locked; YYYY/MM filters; background save/remove; stale refresh ignored; all private photo URLs released.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
