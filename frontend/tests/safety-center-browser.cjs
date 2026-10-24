// Isolated browser checks: no production account, email, model or government fetches.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const frontend = path.resolve(__dirname, '..');
const fixture = '<!doctype html><html lang="zh-TW"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/safety-center.css"><style>body{display:block;margin:0;padding:12px}main{max-width:960px;margin:auto;min-width:0}</style></head><body><main id="fixture"></main></body></html>';
const server = http.createServer((req,res) => {
  const route = new URL(req.url,'http://localhost').pathname;
  if (route === '/fixture') { res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return; }
  const file = path.resolve(frontend, '.'+(route === '/' ? '/index.html' : route));
  if (!file.startsWith(frontend+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.json')?'application/json; charset=utf-8':'text/html; charset=utf-8');
  let body=fs.readFileSync(file);
  if(route==='/') body=Buffer.from(body.toString().replace('</head>','<link rel="stylesheet" href="/css/safety-center.css"></head>').replace(/<script[^>]+src="js\/app\.js[^>]*>/,'<script src="/js/safety-center.js"></script>$&'));
  res.end(body);
});
(async () => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium',args:['--no-sandbox']});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844},locale:'zh-TW'}), page=await context.newPage(), errors=[], calls=[];
    page.on('pageerror',error=>errors.push(error.message));
    let failNews=false;
    const news={status:'ready',items:[{id:'one',title:'官方查證 <img src=x onerror=alert(1)>',summary:'請勿交出提款卡。',publishedAt:'2026-10-20',url:'https://data.gov.tw/dataset/38262'},{id:'bad',title:'不安全網址不應成為連結',summary:'純文字',publishedAt:'bad-date',url:'javascript:alert(1)'}],source:{name:'內政部警政署',url:'https://data.gov.tw/dataset/38262'},lastSyncedAt:'2026-10-21T00:00:00Z',lastAttemptAt:'2026-10-21T00:00:00Z',officialLinks:[{title:'官方網站',url:'https://165.npa.gov.tw/'},{title:'假網址',url:'https://example.test/'}],stale:false};
    await page.route('**/api/resources/**',async route=>{
      const request=route.request(),url=new URL(request.url());calls.push({path:url.pathname,query:url.search,headers:request.headers(),method:request.method()});
      if(url.pathname.endsWith('anti-fraud')){
        if(failNews){await route.fulfill({status:503,body:'unavailable'});return;}
        await route.fulfill({json:url.search?{...news,status:'stale',stale:true}:news});return;
      }
      const language=url.searchParams.get('language');
      const book={id:'book',title:'The Psychology of Money',author:'Morgan Housel',publisher:'Harriman House',year:2020,url:'https://www.harriman-house.com/psychologyofmoney',principle:'A long-term plan needs room for uncertainty.',application:'Keep a cash buffer for unexpected expenses.',contentLanguage:language,sourceVerifiedOn:'2026-10-21'};
      await route.fulfill({json:{mode:'curated-referenced-education',liveBookFeed:false,items:[book,{...book,id:'unsafe',url:'javascript:alert(1)'},{...book,id:'book-two'},{...book,id:'book-three'},{...book,id:'book-four'}]}});
    });
    async function boot(){
      await page.goto(base+'/fixture');
      await page.evaluate(base=>{
        window.__prefs={shortcuts:[{id:'fraud',visible:true},{id:'stats',visible:false}]};window.__saved=[];window.__language='zh-TW';
        window.I18n={language:()=>__language};
        window.API={mode:'http',base,request:async(path,options)=>{if(path!=='/api/lifestyle/preferences')throw Error('Unexpected private call');if(options.method==='PUT'){Object.assign(__prefs,options.body);__saved.push(options.body);}return JSON.parse(JSON.stringify(__prefs));}};
        window.FamBudgetUI={toast:()=>{},refresh:()=>{}};
      },base);
      await page.addScriptTag({path:path.join(frontend,'js/safety-center.js')});
      await page.addScriptTag({path:path.join(frontend,'js/life-features.js')});
      await page.evaluate(()=>SafetyCenter.init());
    }
    await boot();
    assert.equal(calls.length,0,'Banner init makes no public/private fetch');
    assert.equal(await page.locator('#safetyBanner').count(),1);
    await page.evaluate(()=>SafetyCenter.init());assert.equal(await page.locator('#safetyBanner').count(),1,'Init is idempotent');
    await page.locator('.safety-close').click();assert.equal(await page.locator('#safetyBanner').count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('fambudget.safety-banner.hidden')),'true');
    await boot();assert.equal(await page.locator('#safetyBanner').count(),0,'Dismissal survives reload');
    await page.evaluate(()=>SafetyCenter.mountSettings(document.querySelector('main')));
    assert.equal(await page.locator('[data-safety-toggle]').isChecked(),false);
    await page.locator('[data-safety-toggle]').check();assert.equal(await page.locator('#safetyBanner').count(),1);
    assert.equal(calls.length,0,'Settings toggle never fetches news');
    for(const [language,label] of [['en','Fraud prevention'],['ja','詐欺防止'],['ko','사기 예방'],['es','Prevención de fraudes'],['zh-CN','防诈提醒'],['zh-TW','防詐提醒']]){
      await page.evaluate(language=>{__language=language;document.documentElement.lang=language;window.dispatchEvent(new CustomEvent('fambudget:languagechange'));},language);
      assert.match(await page.locator('#safetyBanner').innerText(),new RegExp(label));
      for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),language+' fits '+width);}
    }
    assert.equal(calls.length,0,'Language switches on banner/settings never fetch');
    await page.evaluate(async()=>{await LifeFeatures.setAccount({id:'fixture-user'});});
    assert.deepEqual(await page.evaluate(()=>LifeFeatures.orderTiles([{nav:'stats',label:'統計'},{nav:'entry',label:'明細'}]).map(t=>t.nav)),['fraud','entry','savings-game','health','calendar']);
    await page.evaluate(()=>LifeFeatures.openShortcuts());
    const fraud=page.locator('.life-shortcut-row').filter({hasText:'防詐提醒'});
    await fraud.locator('input[type=checkbox]').uncheck();
    await fraud.locator('[data-move="1"]').click();await page.locator('[data-life-save]').click();
    await page.waitForFunction(()=>__saved.length===1);
    assert.deepEqual(await page.evaluate(()=>__saved[0].shortcuts.slice(0,2)),[{id:'stats',visible:false},{id:'fraud',visible:false}],'Reorder and hide persist together');
    assert.equal(await page.evaluate(()=>LifeFeatures.orderTiles([]).some(t=>t.nav==='fraud')),false);
    await page.evaluate(()=>SafetyCenter.mountFraud(document.querySelector('main')));
    await page.locator('.safety-news li').first().waitFor();assert.equal(calls.length,1,'News fetch starts only after entering fraud screen');
    assert.equal(calls[0].headers.authorization,undefined);assert.equal(calls[0].method,'GET');
    assert.equal(await page.locator('.safety-news img').count(),0,'Source strings are escaped');
    assert.equal(await page.locator('[href^="javascript:"]').count(),0);assert.equal(await page.locator('[href="https://example.test/"]').count(),0,'Only government news links are clickable');
    assert.match(await page.locator('.safety-meta').innerText(),/2026/);
    await page.locator('[data-safety-refresh]').click();await page.locator('.safety-warning').waitFor();assert.equal(calls[1].query,'?refresh=true');
    failNews=true;await page.locator('[data-safety-refresh]').click();await page.waitForFunction(()=>!document.querySelector('[data-safety-refresh]').disabled);
    assert.match(await page.locator('[data-safety-status]').innerText(),/無法連線/);assert.equal(await page.locator('.safety-news li').count(),2,'A failed refresh retains clearly labelled prior information');
    const beforeCatalog=calls.length;
    assert.deepEqual(await page.evaluate(async()=>{
      const [first,second]=await Promise.all([SafetyCenter.financialContext(),SafetyCenter.financialContext()]);
      return {count:first.items.length,ids:first.items.map(item=>item.id),keys:Object.keys(first.items[0]).sort(),sourceLink:second.items[0].sourceLink};
    }),{count:3,ids:['book','book-two','book-three'],keys:['id','sourceLink','text','title'],sourceLink:'https://www.harriman-house.com/psychologyofmoney'});
    assert.equal(calls.length,beforeCatalog+1,'Concurrent explicit coach context requests share one public catalog fetch');
    await page.evaluate(()=>{document.querySelector('main').innerHTML='';SafetyCenter.mountFinancialReferences(document.querySelector('main'));});
    await page.locator('.safety-reading article').first().waitFor();assert.match(await page.locator('.safety-reading').innerText(),/Morgan Housel/);
    assert.equal(calls.length,beforeCatalog+1,'Visible reference cards reuse the coach context catalog');
    await page.evaluate(()=>{__language='en';window.dispatchEvent(new CustomEvent('fambudget:languagechange'));});
    await page.waitForFunction(()=>document.querySelector('.safety-reading article')?.lang==='en');assert.equal(calls.at(-1).query,'?language=en');
    assert.match(await page.locator('.safety-education').innerText(),/not personalized/);
    for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'References fit '+width);}
    assert.deepEqual(errors,[]);
    console.log('PASS: banner privacy, six languages, persistent dismissal/reopen, 320/390px, shortcut order/hide, official links, live timestamps/stale/error, and cited finance references.');

    // Exercise the actual HTTP adapter with remembered and tab-only credentials.
    for(const remember of [false,true]){
      const p=await context.newPage();await p.goto(base+'/fixture');
      await p.evaluate(({base,remember})=>{const meta=document.createElement('meta');meta.name='api-base';meta.content=base;document.head.appendChild(meta);localStorage.setItem('fambudget.remember-login',String(remember));localStorage.removeItem('fambudget.auth');sessionStorage.removeItem('fambudget.auth');(remember?localStorage:sessionStorage).setItem('fambudget.auth',JSON.stringify({accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresIn:1800}));},{base,remember});
      const authRequests=[];
      await p.route('**/api/auth/**',async route=>{authRequests.push({url:route.request().url(),auth:route.request().headers().authorization,method:route.request().method()});await route.fulfill({json:route.request().url().endsWith('sessions')?{sessions:[{id:'current',device:'Fixture',current:true,lastActiveAt:'2026-10-21T00:00:00Z'}]}:{revoked:2}});});
      await p.addScriptTag({path:path.join(frontend,'js/api.js')});
      const result=await p.evaluate(async()=>{const before=localStorage.getItem('fambudget.auth')||sessionStorage.getItem('fambudget.auth');const result=await API.logoutAll();const sessions=await API.sessions();return{before,after:localStorage.getItem('fambudget.auth')||sessionStorage.getItem('fambudget.auth'),auth:await API.authState(),remembered:!!localStorage.getItem('fambudget.auth'),result,current:sessions.sessions[0].current};});
      assert.equal(result.before,result.after);assert.equal(result.auth.loggedIn,true);assert.equal(result.remembered,remember);assert.equal(result.current,true);assert.equal(result.result.revoked,2);
      assert.equal(authRequests[0].method,'POST');assert.ok(authRequests.every(r=>r.auth==='Bearer fixture-access'));
      await p.close();
    }
    // Exercise the mock adapter as an isolated localhost-only user.
    const mock=await context.newPage();await mock.goto(base+'/fixture?api=');await mock.addScriptTag({path:path.join(frontend,'js/data.js')});await mock.addScriptTag({path:path.join(frontend,'js/api.js')});
    const mockResult=await mock.evaluate(async()=>{await API.register({name:'測試裝置',email:'session.fixture@example.test',password:'Fixture-password-9!'});const before=(await API.me()).user.id;const result=await API.logoutAll();return{mode:API.mode,before,after:(await API.me()).user.id,auth:await API.authState(),result};});
    assert.equal(mockResult.mode,'mock');assert.equal(mockResult.before,mockResult.after);assert.equal(mockResult.auth.loggedIn,true);assert.equal(mockResult.result.revoked,0);
    console.log('PASS: HTTP remembered/tab-only and mock logoutAll retain current identity, access token, refresh token and session.');
    // Use the real app router and delegated button handler, with its isolated localhost mock account.
    const appContext=await browser.newContext({viewport:{width:320,height:844},locale:'zh-TW'});
    await appContext.addInitScript(()=>{localStorage.setItem('fambudget.tour','done');localStorage.setItem('fambudget.language','zh-TW');});
    const app=await appContext.newPage(),privateRequests=[];
    await app.route('**/api/**',async route=>{
      if(new URL(route.request().url()).pathname==='/api/resources/anti-fraud')await route.fulfill({json:news});
      else {privateRequests.push(new URL(route.request().url()).pathname);await route.fulfill({status:503,json:{detail:'No backend is used by this isolated UI test'}});}
    });
    await app.goto(base+'/?api=#/fraud');await app.locator('.safety-news li').first().waitFor();
    assert.equal(new URL(app.url()).hash,'#/fraud','Fraud page is public');assert.deepEqual(privateRequests,[],'Public fraud page reads no account or ledger endpoint');
    assert.ok(await app.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Real public page fits 320px');
    await app.evaluate(async()=>{await API.register({name:'目前裝置驗收',email:'current.device.fixture@example.test',password:'Fixture-password-9!'});await API.updateProfile({onboarded:true});location.hash='#/profile';});
    await app.locator('#logoutAll').waitFor();const beforeUser=await app.evaluate(async()=>(await API.me()).user.id);
    await app.locator('#logoutAll').click();await app.waitForFunction(()=>!document.querySelector('#logoutAll')?.disabled);
    assert.equal(new URL(app.url()).hash,'#/profile','Logout other devices keeps the current route');
    assert.equal(await app.evaluate(async()=>(await API.authState()).loggedIn),true);
    assert.equal(await app.evaluate(async()=>(await API.me()).user.id),beforeUser);
    assert.equal(await app.locator('#sessBox .pill--safe').count(),0,'Current device is omitted from the other-device list');
    assert.match(await app.locator('#sessBox .sess__empty').innerText(),/目前沒有其他登入中的裝置/);
    assert.equal(await app.locator('body.is-out').count(),0,'Current app remains in its authenticated layout');
    await appContext.close();
    console.log('PASS: actual public router reads no private API; actual logout-other-devices click preserves identity, route and authenticated layout.');
    await context.close();
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
