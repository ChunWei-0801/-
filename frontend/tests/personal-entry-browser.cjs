/* Actual HTML with isolated browser-only storage; no production data or LLM. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
let pw;try{pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');}catch(_){}
const engineName=process.env.FAMBUDGET_TEST_BROWSER||'chromium',mobile=process.env.FAMBUDGET_TEST_DEVICE!=='desktop';
async function fixture(t){
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');const f=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':f.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(f));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await pw[engineName].launch({headless:true,...(engineName==='chromium'?{executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']}: {})});
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const device=mobile?(engineName==='chromium'?pw.devices['Pixel 7']:engineName==='webkit'?pw.devices['iPhone 13']:{viewport:{width:390,height:844}}):{viewport:{width:1280,height:900}};
 const context=await browser.newContext({...device,timezoneId:'Asia/Taipei',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(9000);
 await context.addInitScript(()=>{localStorage.setItem('fambudget.tour','done');localStorage.setItem('fambudget.language','zh-TW');window.__FAMBUDGET_TODAY__='2026-10-28';});
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base)return route.abort();if(u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{detail:'Isolated fixture'}});return route.continue();});
 await page.goto(base+'/?api=#/login');await page.waitForFunction(()=>window.API&&window.I18n);await page.evaluate(()=>I18n.ready);
 await page.evaluate(async()=>{await API.register({name:'私人記帳驗收',email:'private.entry.fixture@example.test',password:'Fixture-password-9!'});await API.updateProfile({onboarded:true});location.hash='#/';});
 await page.reload();await page.locator('.gsw__empty').waitFor();
 await page.locator('#view [data-personal-details]').waitFor();
 return{page,errors};
}
test('no activity is needed for manual or parsed entries and the destination stays private after reload',{skip:!pw},async t=>{
 const {page,errors}=await fixture(t);
 await page.locator('#view [data-quick="entry"]').first().click();await page.locator('#paraText').waitFor();
 await page.locator('[data-manual-entry]').click();await page.locator('#singleAmount').fill('65');await page.locator('#singleMerchant').fill('無活動早餐');
 assert.match(await page.locator('#entryDestination').innerText(),/不必先建立活動/);
 await page.locator('#singleSave').click();await page.locator('#singleSave').click();await page.locator('#txList').getByText('無活動早餐',{exact:true}).waitFor();
 const first=await page.evaluate(async()=>({groups:(await API.groups()).groups,tx:(await API.transactions({})).transactions}));
 const personal=first.groups.find(g=>g.name==='收支明細');assert.ok(personal);assert.equal(first.groups.length,1);assert.equal(first.tx.find(x=>x.merchant==='無活動早餐').group,personal.id);
 await page.reload();await page.locator('[data-paragraph-entry]').click();await page.locator('#paraText').fill('今天午餐120元，捷運35元');
 await page.locator('#paraGo').click();await page.locator('.btbl__r').first().waitFor();assert.equal(await page.locator('#paraSave').isEnabled(),true);
 await page.locator('#paraSave').click();await page.waitForFunction(async()=>((await API.transactions({})).transactions||[]).length===3);
 assert.equal(await page.evaluate(async()=>(await API.groups()).groups.length),1,'private destination is reused');
 assert.equal(await page.evaluate(async()=>{const id=(await API.groups()).groups[0].id;return(await API.transactions({})).transactions.every(x=>x.group===id);}),true);
 await page.reload();await page.locator('.gsw__empty').waitFor();assert.match(await page.locator('.gsw__empty').innerText(),/目前尚未建立活動/);
 assert.deepEqual(errors,[]);
});
test('explicit activity stays explicit and switching to personal preserves the unsaved form',{skip:!pw},async t=>{
 const {page,errors}=await fixture(t);
 const activity=await page.evaluate(async()=>{const g=await API.createGroup({name:'朋友聚餐活動',kind:'standing'});location.hash='#/entry';return g;});
 await page.reload();await page.locator('#gswBtn').click();await page.locator('[data-group="'+activity.id+'"]').click();
 await page.locator('[data-manual-entry]').click();await page.locator('#singleAmount').fill('230');await page.locator('#singleMerchant').fill('先選活動後改私人');
 await page.evaluate(()=>{window.__confirmationTimers=[];window.__realSetTimeout=window.setTimeout;window.setTimeout=function(fn,ms,...args){if(ms===4000){__confirmationTimers.push(fn);return 0;}return __realSetTimeout(fn,ms,...args);};});
 await page.locator('#singleSave').click();await page.locator('[data-personal-entry]').click();
 assert.equal(await page.locator('#singleAmount').inputValue(),'230');assert.equal(await page.locator('#singleMerchant').inputValue(),'先選活動後改私人');
 assert.equal(await page.locator('#singleSave').getAttribute('data-sure'),'0');
 await page.locator('#singleSave').click();
 await page.evaluate(()=>{__confirmationTimers[0]();window.setTimeout=__realSetTimeout;});
 assert.equal(await page.locator('#singleSave').getAttribute('data-sure'),'1','old destination timer cannot clear a newer confirmation');
 await page.locator('#singleSave').click();await page.locator('#txList').getByText('先選活動後改私人',{exact:true}).waitFor();
 const result=await page.evaluate(async()=>({groups:(await API.groups()).groups,items:(await API.transactions({})).transactions}));
 const personal=result.groups.find(g=>g.name==='收支明細');assert.equal(result.items[0].group,personal.id);assert.notEqual(result.items[0].group,activity.id);
 await page.locator('#gswBtn').click();await page.locator('[data-group="'+activity.id+'"]').click();await page.locator('[data-manual-entry]').click();
 await page.locator('#singleAmount').fill('80');await page.locator('#singleMerchant').fill('明確選擇活動');
 await page.locator('#singleSave').click();await page.locator('#singleSave').click();await page.locator('#txList').getByText('明確選擇活動',{exact:true}).waitFor();
 assert.equal(await page.evaluate(async()=>(await API.transactions({})).transactions.find(x=>x.merchant==='明確選擇活動').group),activity.id);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(errors,[]);
});
test('actual application loads the completed-photo challenge and keeps its achievement',{skip:!pw},async t=>{
 const {page,errors}=await fixture(t);
 await page.evaluate(()=>{
  const state={settings:{wallName:'隔離拼圖成就',pieceCount:9,period:'month',timezone:'Asia/Taipei',changesPerPeriod:2,wallBackgroundUrl:null},current:{id:'fixture-collected',pieceCount:9,earnedPieces:9,completed:true,imageUrl:'/fixture-private-photo',createdAt:'2026-10-01T00:00:00Z',completedAt:'2026-10-28T00:00:00Z',year:2026,month:10,timezone:'Asia/Taipei'},creditsAvailable:3,period:{remaining:1,timezone:'Asia/Taipei'}};
  const original=MediaTools;
  window.MediaTools=Object.assign({},original,{
   json:async(route,opt)=>{if(route==='/api/memories')return structuredClone(state);if(route.startsWith('/api/memories/achievements?'))return{achievements:[state.current],years:[2026],page:1,pageSize:50,total:1};return original.json(route,opt);},
   imageURL:async()=>URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><rect width="90" height="90" fill="#176b68"/><path d="M0 90L90 0M0 0L90 90" stroke="gold" stroke-width="8"/></svg>'],{type:'image/svg+xml'}))
  });location.hash='#/memories';
 });
 await page.locator('[data-jigsaw-board]').waitFor();assert.equal(await page.locator('[data-jigsaw-position]').count(),9);
 assert.equal(await page.locator('[data-mem-file]').isDisabled(),true);
 await page.locator('.memories-achievement').waitFor();assert.equal(await page.locator('.memories-achievement').count(),1);
 await page.locator('[data-jigsaw-position="0"]').click();await page.locator('[data-jigsaw-position="1"]').click();
 assert.match(await page.locator('[data-jigsaw-summary]').innerText(),/交換次數 1/);
 await page.screenshot({path:path.join(process.env.RUNNER_TEMP||'/tmp','fambudget-'+engineName+'-jigsaw-'+(mobile?'mobile':'desktop')+'.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
});
