/* Real browser interactions with explicit OCR transport fixtures. These tests
 * do not measure real OCR or vision-model accuracy and never contact accounts. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const engine=process.env.FAMBUDGET_TEST_BROWSER||'chromium',mobile=process.env.FAMBUDGET_TEST_DEVICE!=='desktop';
const root=path.resolve(__dirname,'..');
async function fixture(t){
 const browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']}:{})});t.after(()=>browser.close());
 const context=await browser.newContext({...(!mobile?{viewport:{width:1280,height:900}}:engine==='chromium'?playwright.devices['Pixel 7']:engine==='webkit'?playwright.devices['iPhone 13']:{viewport:{width:390,height:844}}),acceptDownloads:true,reducedMotion:'reduce'});
 const page=await context.newPage(),errors=[],unexpected=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.protocol==='blob:')return route.continue();if(url.origin!=='http://receipt-lab-fixture.test'){unexpected.push(url.href);return route.abort();}const relative=url.pathname==='/'?'receipt-lab.html':url.pathname.slice(1),file=path.join(root,relative);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){unexpected.push(url.href);return route.abort();}const contentType=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'application/octet-stream';return route.fulfill({contentType,body:fs.readFileSync(file)});});
 await page.addInitScript(()=>{
  localStorage.setItem('fambudget.token','fixture-formal-token-must-not-change');
  window.__ocrFixture={calls:0,terminated:0,defer:false};
  window.Tesseract={createWorker:async()=>({terminate:async()=>{__ocrFixture.terminated++;},recognize:async()=>{__ocrFixture.calls++;if(__ocrFixture.defer)return new Promise(resolve=>{__ocrFixture.resolve=resolve;});return{data:{text:'小松咖啡\n115/10/24\n早餐三明治 65\n拿鐵 45\n折扣 -10\n總計 NT$100'}};}})};
 });
 await page.goto('http://receipt-lab-fixture.test/');
 t.after(()=>assert.deepEqual(errors,[]));t.after(()=>assert.deepEqual(unexpected,[]));
 return {page,context};
}
async function image(page){return Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=12;c.getContext('2d').fillRect(0,0,12,12);return c.toDataURL('image/png').split(',')[1];}),'base64');}
test('sample text is labelled, item differences require explicit review, export never writes accounts',async t=>{
 const {page}=await fixture(t);assert.match(await page.locator('.rl-hero').innerText(),/尚未使用視覺語言模型/);assert.equal(await page.locator('[data-rl-file="camera"]').getAttribute('capture'),'environment');
 assert.equal(await page.evaluate(()=>ReceiptLab.money('1,23',false)),null);assert.equal(await page.evaluate(()=>ReceiptLab.money('1e3',false)),null);assert.equal(await page.evaluate(()=>ReceiptLab.money('1,000',false)),100000);
 await page.locator('[data-rl-action="sample"]').click();assert.match(await page.locator('[data-rl-origin]').innerText(),/示範文字.*非真實 OCR 推論/);assert.equal(await page.evaluate(()=>__ocrFixture.calls),0);
 assert.equal(await page.locator('[name="amount"]').inputValue(),'100');assert.equal(await page.locator('[name="date"]').inputValue(),'2026-10-24');assert.equal(await page.locator('[data-rl-item]').count(),3);assert.match(await page.locator('[data-rl-balance]').innerText(),/與收據總額相符/);
 await page.locator('[data-rl-action="prepare"]').click();assert.match(await page.locator('[data-rl-review-status]').innerText(),/請填入有效日期/);
 await page.locator('[data-rl-accept]').check();await page.locator('[data-rl-action="prepare"]').click();
 let value=JSON.parse(await page.locator('[data-rl-json]').inputValue());assert.equal(value.source.mode,'sample');assert.equal(value.source.visionModelUsed,false);assert.equal(value.source.ocrEngine,null);assert.equal(value.transaction.amount,'100.00');assert.equal(value.itemCheck.status,'matches');assert.equal(value.writtenToLedger,false);assert.equal(value.source.sourceImageIncluded,false);assert.equal(value.source.rawTextIncluded,false);
 await page.locator('[data-rl-accept]').uncheck();assert.equal(await page.locator('[data-rl-action="download"]').isDisabled(),true);assert.equal(await page.locator('[data-rl-json]').isVisible(),false);
 await page.locator('[name="amount"]').fill('120');assert.equal(await page.locator('[data-rl-accept]').isChecked(),false);assert.equal(await page.locator('[data-rl-json]').isVisible(),false);assert.equal(await page.locator('[data-rl-action="download"]').isDisabled(),true);assert.match(await page.locator('[data-rl-balance]').innerText(),/相差 20.00/);
 await page.locator('[data-rl-accept]').check();await page.locator('[data-rl-action="prepare"]').click();assert.match(await page.locator('[data-rl-review-status]').innerText(),/不一致時需另行確認/);assert.equal(await page.locator('[data-rl-json]').isVisible(),false);
 await page.locator('[data-rl-mismatch]').check();await page.locator('[data-rl-action="prepare"]').click();value=JSON.parse(await page.locator('[data-rl-json]').inputValue());assert.equal(value.itemCheck.status,'difference-reviewed');assert.equal(value.itemCheck.difference,'20.00');
 const downloaded=page.waitForEvent('download');await page.locator('[data-rl-action="download"]').click();const download=await downloaded;assert.equal(download.suggestedFilename(),'fambudget-receipt-reviewed-draft.json');
 assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),['fambudget.token']);assert.equal(await page.evaluate(()=>localStorage.getItem('fambudget.token')),'fixture-formal-token-must-not-change');assert.equal(await page.evaluate(()=>typeof window.API),'undefined');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.emulateMedia({colorScheme:'dark'});assert.equal(await page.locator('[data-rl-action="download"]').isVisible(),true);
});
test('real file selection alone never runs OCR; empty and oversized/non-image inputs cannot create a draft',async t=>{
 const {page}=await fixture(t),png=await image(page);
 await page.locator('[data-rl-file="choose"]').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:png});assert.equal(await page.evaluate(()=>__ocrFixture.calls),0);assert.equal(await page.locator('[data-rl-image]').isVisible(),true);
 await page.locator('[data-rl-action="ocr"]').click();await page.locator('[name="amount"]').waitFor();assert.equal(await page.locator('[name="amount"]').inputValue(),'100');assert.match(await page.locator('[data-rl-origin]').innerText(),/圖片 OCR 原文/);assert.equal(await page.evaluate(()=>__ocrFixture.calls),1);
 await page.locator('[data-rl-raw]').fill('日期未明\n只有無法確認的文字');assert.match(await page.locator('[data-rl-origin]').innerText(),/手動輸入/);assert.equal(await page.locator('[name="amount"]').count(),0);await page.locator('[data-rl-action="analyze"]').click();assert.equal(await page.locator('[name="amount"]').inputValue(),'');assert.equal(await page.locator('[name="date"]').inputValue(),'');assert.match(await page.locator('.rl-review-warnings').innerText(),/不會自動套用今天/);
 await page.locator('[data-rl-file="choose"]').setInputFiles({name:'unsupported.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});assert.match(await page.locator('[data-rl-status]').innerText(),/12 MB 以內/);assert.equal(await page.locator('[data-rl-action="ocr"]').isDisabled(),true);assert.equal(await page.evaluate(()=>__ocrFixture.calls),1);
 await page.locator('[data-rl-file="choose"]').setInputFiles({name:'too-large.png',mimeType:'image/png',buffer:Buffer.alloc(12*1024*1024+1)});assert.match(await page.locator('[data-rl-status]').innerText(),/12 MB 以內/);assert.equal(await page.locator('[data-rl-image]').isVisible(),false);
});
test('cancelled or cleared late OCR responses cannot replace a newer source',async t=>{
 const {page}=await fixture(t),png=await image(page);await page.evaluate(()=>{__ocrFixture.defer=true;});
 await page.locator('[data-rl-file="choose"]').setInputFiles({name:'private.png',mimeType:'image/png',buffer:png});await page.locator('[data-rl-action="ocr"]').click();await page.waitForFunction(()=>typeof __ocrFixture.resolve==='function');
 await page.locator('[data-rl-action="cancel"]').click();assert.match(await page.locator('[data-rl-status]').innerText(),/已取消/);await page.locator('[data-rl-action="sample"]').click();await page.evaluate(()=>__ocrFixture.resolve({data:{text:'PRIVATE LATE OCR OUTPUT'}}));await page.waitForTimeout(40);
 assert.equal(await page.locator('[data-rl-raw]').inputValue(),'小松咖啡\n電子發票證明聯\n115/10/24 09:30\n早餐三明治 65\n拿鐵 45\n折扣 -10\n總計 NT$100');assert.match(await page.locator('[data-rl-origin]').innerText(),/示範文字/);assert.equal(await page.locator('[name="amount"]').inputValue(),'100');assert.equal(await page.evaluate(()=>__ocrFixture.terminated),1);
 await page.locator('[data-rl-action="clear"]').click();assert.equal(await page.locator('[data-rl-raw]').inputValue(),'');assert.equal(await page.locator('[data-rl-image]').getAttribute('src'),null);assert.equal(await page.locator('[data-rl-json]').count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('fambudget.token')),'fixture-formal-token-must-not-change');
});
