/* Isolated real-HTML integration. Mock storage and invitation replies are fixtures,
 * never real accounts, mail, production writes, model inference or quality proof. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const engineName=process.env.FAMBUDGET_TEST_BROWSER||'chromium',engine=playwright[engineName];
const mobile=process.env.FAMBUDGET_TEST_DEVICE!=='desktop';
const root=path.resolve(__dirname,'..');
async function fixture(t){
 const server=http.createServer((req,res)=>{const route=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(route==='/'?'/index.html':route));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await engine.launch({headless:true,...(engineName==='chromium'?{executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']}:{} )});
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const device=mobile?(engineName==='chromium'?playwright.devices['Pixel 7']:engineName==='webkit'?playwright.devices['iPhone 13']:{viewport:{width:390,height:844}}):{viewport:{width:1280,height:900}};
 const context=await browser.newContext({...device,timezoneId:'Asia/Taipei',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{localStorage.setItem('fambudget.tour','done');localStorage.setItem('fambudget.language','zh-TW');window.__FAMBUDGET_TODAY__='2026-10-22';});
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==base)return route.abort();if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{detail:'Isolated UI: no backend or model'}});return route.continue();});
 await page.goto(base+'/?api=#/login');await page.waitForFunction(()=>window.API&&window.ActivityInvites&&window.TransactionArchive);await page.evaluate(()=>I18n.ready);
 await page.evaluate(async()=>{await API.register({name:'活動驗收',email:'activity.ui.fixture@example.test',password:'Fixture-password-9!'});await API.updateProfile({onboarded:true});location.hash='#/';});
 await page.reload();await page.locator('[data-personal-details]').waitFor();
 assert.equal(await page.evaluate(()=>typeof window.VoiceAccessibility),'undefined','Cancelled voice features are not loaded');
 assert.equal(await page.locator('[data-voice-root],[data-voice-settings]').count(),0,'No microphone launcher or voice settings remain');
 return{page,errors,base,context};
}

test('real application wires buyer details, review imports and opt-in report settings on mobile and desktop',async t=>{
 const {page,errors}=await fixture(t);
 await page.evaluate(async()=>{
  await API.createGroup({name:'個人帳本',kind:'standing'});
  API.mode='http';window.__featureCalls=[];
  API.request=async function(path,options={}){
   __featureCalls.push({path,options});
   if(path==='/api/billing/profile')return {buyerTaxId:'00123456',companyName:'我的單位'};
   if(path==='/api/monthly-reports/settings')return {enabled:false,delivery:'email',recipientEmail:'verified@example.test',recipientVerified:true,authorizationActive:false,scope:'only-me',timezone:'Asia/Taipei',scheduleDay:1};
   throw Error('Unexpected fixture request '+path);
  };
 });
 await page.evaluate(()=>location.hash='#/entry');await page.locator('[data-manual-entry]').click();
 await page.waitForFunction(()=>document.querySelector('#entryBox [name=buyerTaxId]')?.value==='00123456');
 await page.locator('#singleAmount').fill('65');await page.locator('#singleMerchant').fill('統編驗收店');
 await page.locator('#entryBox [name=paymentMethod]').selectOption('credit_card');
 await page.locator('#entryBox [name=buyerTaxId]').fill('123');await page.locator('#singleSave').click();assert.equal(await page.locator('#singleSave').getAttribute('data-sure'),null);
 await page.locator('#entryBox [name=buyerTaxId]').fill('00123456');await page.locator('#singleSave').click();
 await page.locator('#entryBox [name=buyerTaxId]').fill('87654321');await page.locator('#singleSave').click();assert.match(await page.locator('#singleSave').innerText(),/再按一次/);
 await page.locator('#singleSave').click();const row=page.locator('#txList .txr').filter({hasText:'統編驗收店'});await row.waitFor();assert.match(await row.innerText(),/87654321/);assert.match(await row.innerText(),/信用卡/);
 await row.locator('[data-edit]').click();assert.equal(await page.locator('#txEd [name=buyerTaxId]').inputValue(),'87654321');
 await page.locator('#txEd [name=buyerTaxId]').fill('');await page.locator('#txEdOk').click();await page.locator('#txEd').waitFor({state:'hidden'});await page.waitForFunction(()=>!document.querySelector('#txList')?.textContent.includes('87654321'));
 await page.locator('.entry-access [data-statement-import]').click();await page.locator('.statement-dialog').waitFor();await page.locator('[data-statement-action=close]').click();
 await page.evaluate(()=>location.hash='#/settings');await page.locator('[data-billing-profile]').click();await page.locator('[data-billing-profile].billing-dialog').waitFor();assert.equal(await page.locator('.billing-dialog [name=buyerTaxId]').inputValue(),'00123456');await page.locator('[data-billing-close]').click();
 await page.locator('[data-monthly-report-setup]').click();await page.locator('.monthly-report-dialog').waitFor();assert.equal(await page.locator('[name=delivery]').inputValue(),'email');assert.equal(await page.locator('[name=enabled]').isChecked(),false);assert.equal(await page.locator('[name=recipientEmail]').inputValue(),'verified@example.test');assert.equal(await page.locator('[data-monthly-form]').evaluate(n=>getComputedStyle(n).display),'block');assert.ok(await page.locator('[name=termsAccepted]').locator('..').evaluate(n=>n.getBoundingClientRect().width>250),'Consent uses the dialog width');
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'settings and dialog fit '+width);}
 assert.equal(await page.evaluate(()=>__featureCalls.some(c=>c.path.includes('/authorize'))),false,'Opening settings does not authorize delivery');await page.setViewportSize({width:mobile?390:1280,height:mobile?844:900});await page.screenshot({path:require('node:path').join(process.env.RUNNER_TEMP||'/tmp','fambudget-'+engineName+'-'+(mobile?'mobile':'desktop')+'.png')});assert.deepEqual(errors,[]);
});

test('browser engine supports responsive routes, OS colours, touch controls and camera file selection',async t=>{
 const {page,context,errors}=await fixture(t);
 if(mobile&&engineName==='chromium')assert.match(await page.evaluate(()=>navigator.userAgent),/Android/);
 if(mobile&&engineName==='webkit')assert.match(await page.evaluate(()=>navigator.userAgent),/iPhone/);
 if(mobile&&engineName==='chromium')assert.ok(await page.evaluate(()=>navigator.maxTouchPoints)>0);
 for(const scheme of ['dark','light']){
  await page.emulateMedia({colorScheme:scheme});await page.waitForFunction(s=>document.documentElement.dataset.colorScheme===s,scheme);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),scheme);
 }
 for(const route of ['entry','stats','advice','members','groups','profile','settings','tutorial','exchange','ai','fraud','memories','health','smoking','calendar','savings-game','reports']){
  await page.evaluate(r=>location.hash='#/'+r,route);
  await page.waitForFunction(r=>location.hash==='#/'+r&&document.querySelector('#ptitle')?.textContent.trim(),route);
  await page.waitForFunction(()=>document.documentElement.dataset.routeMoving!=='true');
  await page.waitForTimeout(60);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),engineName+' '+route+' fits');
 }
 await page.evaluate(()=>location.hash='#/entry');await page.locator('[data-receipt-entry]').waitFor();
 if(mobile&&engineName!=='firefox')await page.locator('[data-receipt-entry]').tap();else await page.locator('[data-receipt-entry]').click();
 await page.locator('.receipt-dialog').waitFor();assert.equal(await page.locator('[data-receipt-file=camera]').getAttribute('capture'),'environment');assert.match(await page.locator('[data-receipt-file=camera]').getAttribute('accept'),/image/);
 await page.locator('[data-receipt-action=close]').click();
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{Object.defineProperty(document,'startViewTransition',{configurable:true,value:undefined});location.hash='#/settings';});
 await page.locator('[data-monthly-report-setup]').waitFor();await page.waitForFunction(()=>document.documentElement.dataset.routeMoving!=='true');
 assert.deepEqual(errors,[],'Route, CSS, dialog and fallback animation must not throw');
});
