/* Real Chromium: device colour mode, same-theme variants and isolated full-HTML previews. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://system-appearance-fixture.test';
const key = 'fambudget.color-mode.v1';
const themes = ['paper','sky','tech','literary','pop','girly','cute','art'];

function launch() {
  return chromium.launch({ headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox'] });
}
async function fixture({ scheme = 'light', stored, blocked = false, legacy = false, noMedia = false } = {}) {
  const browser = await launch();
  const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(({key,stored,blocked,legacy,noMedia}) => {
    if (stored !== undefined) localStorage.setItem(key, stored);
    if (blocked) { Storage.prototype.getItem = function () { throw new DOMException('Fixture blocked', 'SecurityError'); };
      Storage.prototype.setItem = function () { throw new DOMException('Fixture blocked', 'SecurityError'); }; }
    if (noMedia) window.matchMedia = undefined;
    else if (legacy) {
      window.__media = { matches: false, addListener: listener => { window.__legacyListener = listener; } };
      window.matchMedia = () => window.__media;
    }
  }, {key,stored,blocked,legacy,noMedia});
  const page = await context.newPage(), errors = [], unexpected = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { unexpected.push(url.href); return route.abort(); }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><html lang="zh-TW" data-theme="paper"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">'+
      '<meta name="theme-color" content="#E3EEE8"><script src="/js/system-appearance.js"></script>'+
      '<script>window.__boot={mode:document.documentElement.dataset.colorMode,scheme:document.documentElement.dataset.colorScheme,theme:document.documentElement.dataset.theme};</script>'+
      ['tokens','app','themes','login-background','system-appearance'].map(name=>'<link rel="stylesheet" href="/css/'+name+'.css">').join('')+
      '<style>body{padding:16px}#view{max-width:600px;margin:auto}.test-primary{color:var(--ink)}.test-secondary{color:var(--ink-soft)}.test-faint{color:var(--ink-faint)}</style>'+
      '</head><body class="login-background-on" data-loginbackground="dawn"><main id="view">'+
      '<section class="card"><h2 class="test-primary">本月收支</h2><p class="test-secondary">保留主題風格的深淺模式</p><p class="test-faint">日常記帳與提醒</p>'+
      '<button class="btn btn--go">記一筆</button><label>日期<input type="date" value="2026-10-25"></label></section>'+
      '<div class="thm__pv" data-theme="sky"><span class="test-preview">晴空藍預覽</span></div></main></body></html>' });
    const file = path.resolve(root, '.'+url.pathname);
    if (file.startsWith(root+path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({
      contentType: file.endsWith('.js') ? 'application/javascript' : 'text/css', body: fs.readFileSync(file) });
    unexpected.push(url.pathname); return route.abort();
  });
  await page.goto(origin);
  await page.waitForFunction(() => !!window.SystemAppearance);
  return {browser,context,page,errors,unexpected};
}
function clean(h) { assert.deepEqual(h.errors, []); assert.deepEqual(h.unexpected, []); }
function luminance(rgb) {
  const v = rgb.map(value => { const s = value/255; return s <= .04045 ? s/12.92 : ((s+.055)/1.055)**2.4; });
  return .2126*v[0]+.7152*v[1]+.0722*v[2];
}
function contrast(a,b) { const l=[luminance(a),luminance(b)].sort((a,b)=>b-a); return (l[0]+.05)/(l[1]+.05); }
async function palette(page) {
  return page.evaluate(() => {
    const root=document.documentElement, s=getComputedStyle(root), canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d');
    const rgb=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3);};
    const token=name=>{const n=document.createElement('span');n.style.color='var('+name+')';document.body.append(n);const v=rgb(getComputedStyle(n).color);n.remove();return v;};
    const action=getComputedStyle(document.querySelector('.btn--go'));
    return { theme:root.dataset.theme,mode:root.dataset.colorMode,scheme:root.dataset.colorScheme,native:s.colorScheme,
      paper:token('--paper'),card:token('--card'),ink:token('--ink'),soft:token('--ink-soft'),faint:token('--ink-faint'),
      accent:token('--accent'),onAccent:token('--on-accent'),radius:s.getPropertyValue('--r-card').trim(),
      buttonInk:rgb(action.color),buttonFill:rgb(action.backgroundColor),
      meta:rgb(document.querySelector('meta[name="theme-color"]').content),band:token('--band'),
      preview:rgb(getComputedStyle(document.querySelector('.thm__pv[data-theme="sky"]')).getPropertyValue('--paper').trim()) };
  });
}

test('first paint and live OS changes adapt the selected theme without replacing its ID or writing preferences', async () => {
  const h=await fixture({scheme:'dark'});try {
    const p=h.page;
    assert.deepEqual(await p.evaluate(()=>__boot),{mode:'system',scheme:'dark',theme:'paper'});
    assert.equal(await p.evaluate(k=>localStorage.getItem(k),key),null,'automatic brightness does not persist an OS-resolved theme');
    await p.evaluate(()=>{document.documentElement.dataset.theme='girly';SystemAppearance.refresh();});
    const dark=await palette(p);assert.equal(dark.scheme,'dark');assert.equal(dark.native,'dark');assert.deepEqual(dark.meta,dark.paper);
    await p.emulateMedia({colorScheme:'light'});await p.waitForFunction(()=>document.documentElement.dataset.colorScheme==='light');
    const light=await palette(p);assert.equal(light.theme,'girly');assert.equal(light.native,'light');assert.deepEqual(light.meta,light.band);assert.notDeepEqual(light.paper,dark.paper);
    await p.emulateMedia({colorScheme:'dark'});await p.waitForFunction(()=>document.documentElement.dataset.colorScheme==='dark');
    assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'girly');
    assert.equal(await p.evaluate(()=>localStorage.getItem('fambudget.theme')),null);
    clean(h);
  }finally{await h.browser.close();}
});

test('all eight themes have readable same-theme light and dark variants, stable shape and local previews', async () => {
  const h=await fixture();try {
    const p=h.page,darkAccents=[];
    for(const theme of themes){
      await p.emulateMedia({colorScheme:'light'});
      await p.evaluate(theme=>{document.documentElement.dataset.theme=theme;SystemAppearance.refresh();},theme);
      const light=await palette(p);
      await p.emulateMedia({colorScheme:'dark'});await p.waitForFunction(()=>document.documentElement.dataset.colorScheme==='dark');
      const dark=await palette(p);darkAccents.push(dark.accent.join(','));
      assert.equal(dark.theme,theme);assert.equal(light.scheme,'light');assert.equal(dark.scheme,'dark');
      assert.equal(dark.radius,light.radius,theme+' keeps its shapes');assert.notDeepEqual(dark.paper,light.paper,theme+' changes brightness');
      assert.deepEqual(dark.preview,light.preview,theme+' does not recolor the separate light theme preview');
      for(const [name,value] of [['light',light],['dark',dark]]){
        for(const color of ['ink','soft','faint'])assert.ok(contrast(value[color],value.card)>=4.5,`${theme}/${name}/${color} contrast ${contrast(value[color],value.card)}`);
        assert.ok(contrast(value.ink,value.paper)>=4.5,theme+'/'+name+' page text contrast');
        assert.ok(contrast(value.buttonInk,value.buttonFill)>=4.5,`${theme}/${name} action contrast ${contrast(value.buttonInk,value.buttonFill)}`);
        assert.equal(value.native,name);
      }
    }
    assert.ok(new Set(darkAccents).size>=6,'dark variants preserve distinct theme color families');
    await p.setViewportSize({width:320,height:844});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    clean(h);
  }finally{await h.browser.close();}
});

test('manual theme brightness, stored selection and cross-tab changes remain independent of OS settings', async () => {
  const h=await fixture({scheme:'dark'});try{
    const p=h.page;
    await p.evaluate(()=>{SystemAppearance.setMode('theme');});assert.equal(await p.evaluate(k=>localStorage.getItem(k),key),'theme');
    assert.equal((await palette(p)).scheme,'light','manual paper remains light at night');
    await p.reload();assert.equal(await p.evaluate(()=>SystemAppearance.mode()),'theme');
    await p.evaluate(()=>{document.documentElement.dataset.theme='tech';SystemAppearance.refresh();});assert.equal((await palette(p)).scheme,'dark');
    await p.emulateMedia({colorScheme:'light'});assert.equal((await palette(p)).scheme,'dark','manual tech remains dark in daylight');
    await p.evaluate(k=>{window.dispatchEvent(new StorageEvent('storage',{key:k,newValue:'system'}));},key);
    assert.equal(await p.evaluate(()=>SystemAppearance.mode()),'system');assert.equal((await palette(p)).scheme,'light');
    await p.evaluate(()=>{window.dispatchEvent(new StorageEvent('storage',{key:'unrelated',newValue:'theme'}));});assert.equal(await p.evaluate(()=>SystemAppearance.mode()),'system');
    await p.evaluate(()=>{SystemAppearance.setMode('theme',false);window.dispatchEvent(new StorageEvent('storage',{key:null,newValue:null}));});assert.equal(await p.evaluate(()=>SystemAppearance.mode()),'system');
    clean(h);
  }finally{await h.browser.close();}
});

test('blocked storage and older media-query APIs keep the display usable without errors', async () => {
  const blocked=await fixture({scheme:'dark',blocked:true});try{
    const p=blocked.page;assert.equal((await palette(p)).scheme,'dark');
    await p.evaluate(()=>SystemAppearance.setMode('theme'));assert.equal((await palette(p)).scheme,'light');
    await p.evaluate(()=>SystemAppearance.setMode('system'));assert.equal((await palette(p)).scheme,'dark');clean(blocked);
  }finally{await blocked.browser.close();}
  const legacy=await fixture({legacy:true});try{
    await legacy.page.evaluate(()=>{__media.matches=true;__legacyListener();});assert.equal((await palette(legacy.page)).scheme,'dark');clean(legacy);
  }finally{await legacy.browser.close();}
  const absent=await fixture({noMedia:true});try{assert.equal((await palette(absent.page)).scheme,'light');clean(absent);}finally{await absent.browser.close();}
});

test('dark mode dims the shared background while preserving stored photo controls and form rendering', async () => {
  const h=await fixture({scheme:'light'});try{
    const p=h.page;
    await p.evaluate(()=>{document.body.dataset.loginbackground='custom';document.body.style.setProperty('--login-bg-brightness','1.2');document.body.style.setProperty('--login-bg-blur','3px');document.body.style.setProperty('--login-bg-overlay','.25');});
    const before=await p.evaluate(()=>({filter:getComputedStyle(document.body,'::before').filter,opacity:Number(getComputedStyle(document.body,'::after').opacity)}));
    await p.emulateMedia({colorScheme:'dark'});await p.waitForFunction(()=>document.documentElement.dataset.colorScheme==='dark');
    await p.waitForFunction(()=>Number(getComputedStyle(document.body,'::after').opacity)>.25);
    const after=await p.evaluate(()=>({filter:getComputedStyle(document.body,'::before').filter,opacity:Number(getComputedStyle(document.body,'::after').opacity),raw:document.body.style.getPropertyValue('--login-bg-brightness'),native:getComputedStyle(document.querySelector('input')).colorScheme}));
    const brightness=value=>Number(/brightness\(([^)]+)\)/.exec(value)?.[1]||1);
    assert.ok(brightness(after.filter)<brightness(before.filter));assert.ok(after.opacity>before.opacity,JSON.stringify({before,after}));assert.equal(after.raw,'1.2');assert.match(after.filter,/blur\(3px\)/);assert.equal(after.native,'dark');
    clean(h);
  }finally{await h.browser.close();}
});

async function applicationFixture(t){
  const server=http.createServer((req,res)=>{const route=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(route==='/'?'/index.html':route));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port,browser=await launch();t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('fambudget.tour','done');localStorage.setItem('fambudget.language','zh-TW');});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==base)return route.abort();if(url.pathname==='/api/auth/me/appearance-image'&&route.request().method()==='DELETE')return route.fulfill({json:{deleted:true}});if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{detail:'Isolated UI: no backend'}});return route.continue();});
  await page.goto(base+'/?api=#/login');await page.waitForFunction(()=>window.API&&window.SystemAppearance);await page.evaluate(()=>I18n.ready);
  await page.evaluate(async()=>{await API.register({name:'深淺主題測試',email:'system.theme.fixture@example.test',password:'Fixture-password-8!'});await API.updateProfile({onboarded:true});location.hash='#/settings';});
  await page.reload();await page.locator('.settings-grid').waitFor();
  return {page,base,errors};
}

async function settleAppearance(page) {
  await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-route-moving'));
  await page.evaluate(async()=>{await Promise.allSettled(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().iterations)).map(a=>a.finished));});
  await page.locator('[data-system-appearance]').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>{const input=document.querySelector('[data-system-appearance]'),card=input?.closest('.appearance-colors');return card&&Number(getComputedStyle(card).opacity)>=.99&&getComputedStyle(card).visibility==='visible';});
  const hit=await page.locator('[data-system-appearance]').evaluate(input=>{const r=input.getBoundingClientRect(),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {width:r.width,height:r.height,hit:target===input||input.contains(target)};});
  assert.ok(hit.width>=20&&hit.height>=20&&hit.hit,'the rendered theme-mode control is visible and receives taps');
  await page.locator('.appearance-preview h2').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.appearance-preview h2').isVisible(),true);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

test('real HTML stages mode with theme preview, cancels safely, and syncs selected theme instead of OS-resolved brightness', async t=>{
  const {page:p,base,errors}=await applicationFixture(t);
  await p.goto(base+'/?api=#/appearance');await p.locator('[data-system-appearance]').waitFor();
  assert.equal(await p.locator('[data-system-appearance]').isChecked(),true);
  const original=await p.evaluate(()=>document.documentElement.dataset.theme);
  await p.locator('[data-system-appearance]').uncheck();await p.locator('[data-appearance-theme="girly"]').click();
  assert.equal(await p.evaluate(()=>SystemAppearance.mode()),'theme');assert.equal(await p.evaluate(k=>localStorage.getItem(k),key),null,'preview does not persist mode');
  await p.locator('[data-appearance-cancel]').click();await p.locator('.settings-grid').waitFor();
  assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),original);assert.equal(await p.evaluate(()=>SystemAppearance.mode()),'system');assert.equal(await p.evaluate(()=>document.documentElement.dataset.colorScheme),'dark');
  await p.goto(base+'/?api=#/appearance');await p.locator('[data-system-appearance]').waitFor();
  await p.locator('[data-system-appearance]').uncheck();await p.locator('[data-appearance-theme="girly"]').click();await p.locator('[data-appearance-apply]').click();await p.locator('.settings-grid').waitFor();
  assert.equal(await p.evaluate(k=>localStorage.getItem(k),key),'theme');assert.equal(await p.evaluate(async()=>(await API.me()).user.theme),'girly');
  await p.reload();await p.locator('.settings-grid').waitFor();assert.equal(await p.evaluate(()=>SystemAppearance.mode()),'theme');assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'girly');assert.equal(await p.evaluate(()=>document.documentElement.dataset.colorScheme),'light');
  await p.goto(base+'/?api=#/appearance');await p.locator('[data-system-appearance]').waitFor();
  await p.locator('[data-system-appearance]').check();await p.locator('[data-appearance-theme="sky"]').click();await p.locator('[data-appearance-apply]').click();await p.locator('.settings-grid').waitFor();
  assert.equal(await p.evaluate(async()=>(await API.me()).user.theme),'sky','dark mode never replaces saved selected theme with tech');
  await p.reload();await p.locator('.settings-grid').waitFor();assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'sky');assert.equal(await p.evaluate(()=>document.documentElement.dataset.colorScheme),'dark');
  await p.evaluate(()=>{window.__profileWrites=[];var original=API.updateProfile;API.updateProfile=function(patch){__profileWrites.push(patch);return original.apply(API,arguments);};});
  await p.emulateMedia({colorScheme:'light'});await p.waitForFunction(()=>document.documentElement.dataset.colorScheme==='light');await p.emulateMedia({colorScheme:'dark'});await p.waitForFunction(()=>document.documentElement.dataset.colorScheme==='dark');
  assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'sky');assert.deepEqual(await p.evaluate(()=>__profileWrites),[],'OS changes never write account preferences');
  await p.setViewportSize({width:320,height:844});await p.goto(base+'/?api=#/appearance');await p.locator('[data-system-appearance]').waitFor();await settleAppearance(p);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const previewDirectory=process.env.SYSTEM_APPEARANCE_PREVIEW_DIR;
  if(previewDirectory){fs.mkdirSync(previewDirectory,{recursive:true});await p.setViewportSize({width:390,height:844});await settleAppearance(p);assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'sky');await p.screenshot({path:path.join(previewDirectory,'sky-dark-mobile.png'),fullPage:true,animations:'disabled'});await p.emulateMedia({colorScheme:'light'});await p.waitForFunction(()=>document.documentElement.dataset.colorScheme==='light');await settleAppearance(p);await p.screenshot({path:path.join(previewDirectory,'sky-light-mobile.png'),fullPage:true,animations:'disabled'});}
  assert.deepEqual(errors,[]);
});
