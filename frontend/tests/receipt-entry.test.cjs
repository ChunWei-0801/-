/* OCR transport fixtures and receipt-rule tests, not real OCR/model accuracy. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function parser(){const window={addEventListener(){}};vm.runInNewContext(fs.readFileSync(path.join(root,'js/receipt-entry.js'),'utf8'),{window});return window.ReceiptEntry.analyze;}
const analyze=parser();
test('receipt total excludes tax, subtotal, invoice numbers, cash and change; ROC date resolves exactly',()=>{
 const value=analyze('小松咖啡\n電子發票證明聯\n統編12345678\nAB-12345678\n115/07/03 13:45\n小計100\n稅額5\n總計 NT$105\n現金NT$200\n找零NT$95');
 assert.equal(value.amount,105);assert.equal(value.date,'2026-07-03');assert.equal(value.merchant,'小松咖啡');assert.deepEqual([...value.candidates].map(x=>x.amount),[105]);
 assert.equal(analyze('Subtotal $100\nTax $5\nTOTAL $105\nCash tendered $200\nChange $95').amount,105);
 assert.equal(analyze('小計100 稅額5 合計105').amount,105);
 assert.equal(analyze('小 計100\n稅 額5\n總 計105\n現 金NT$200\n找 零95').amount,105);
});
test('conflicting totals remain selectable rather than guessing; a stronger total beats an item price',()=>{
 const ambiguous=analyze('2026/07/03\n總計105\n交易金額120');assert.equal(ambiguous.amount,null);assert.deepEqual([...ambiguous.candidates].map(x=>x.amount),[105,120]);
 const ranked=analyze('品項 NT$65\n品項 NT$40\n合計\nNT$105');assert.equal(ranked.amount,105);assert.equal(ranked.candidates[0].rank,100);
 assert.equal(analyze('統編12345678\n115/07/03\n稅額NT$5\n找零NT$95').amount,null);
 assert.equal(analyze('CASH $200\nCHANGE $95').candidates.length,0);
 assert.equal(analyze('品項 NT$65').amount,null,'an isolated item price is not silently promoted to the total');
});
test('invalid dates/zero/negative money never become default values and other currencies stay explicit',()=>{
 assert.equal(analyze('2026/02/31\n總計0\n統編00001234').date,'');assert.equal(analyze('總計0').amount,null);assert.equal(analyze('總計-105').amount,null);
 assert.equal(analyze('TOTAL USD 9.50').currency,'USD');assert.equal(analyze('TOTAL USD 9.50').amount,9.5);
 assert.equal(analyze('總計 1,23').amount,null,'a malformed thousands group must not become amount 1');
 assert.equal(analyze('總計 000105').amount,105);
 const full=analyze('１１５／０７／０３\n總計ＮＴ＄１，２３４．５０');assert.equal(full.date,'2026-07-03');assert.equal(full.amount,1234.5);
 assert.equal(analyze('2026/07/03\n2026/07/04\n總計105').date,'');
});
test('shared OCR cancels pending workers, rejects empty recognition and never persists input',async()=>{
 let resolveWorker,terminated=0,recognitions=0;
 const window={setTimeout,clearTimeout,Tesseract:{createWorker:()=>new Promise(resolve=>{resolveWorker=resolve;})}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'js/receipt-ocr.js'),'utf8'),{window,Promise,Error,Number});
 const abort=new AbortController(),pending=window.ReceiptOCR.recognize({type:'image/png',size:10},{signal:abort.signal});await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(window.ReceiptOCR.recognize({type:'image/png',size:10}),e=>e.code==='RECEIPT_OCR_BUSY');abort.abort();await assert.rejects(pending,e=>e.code==='RECEIPT_OCR_CANCELLED');
 resolveWorker({terminate:async()=>{terminated++;},recognize:async()=>{recognitions++;return{data:{text:'PRIVATE RAW'}};}});await new Promise(resolve=>setImmediate(resolve));assert.equal(terminated,1);assert.equal(recognitions,0);
 window.Tesseract.createWorker=async()=>({terminate:async()=>{terminated++;},recognize:async()=>({data:{text:''}})});
 await assert.rejects(window.ReceiptOCR.recognize({type:'image/png',size:10}),e=>e.code==='RECEIPT_OCR_EMPTY');assert.equal(terminated,2);
 await assert.rejects(window.ReceiptOCR.recognize({type:'text/plain',size:10}),e=>e.code==='RECEIPT_IMAGE_INVALID');
});
let chromium;try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch(_){}
test('real receipt UI scans without text input, confirms once, separates photo retry and clears on navigation',{skip:!chromium},async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:320,height:800}}),errors=[],unexpected=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!=='http://receipt-contract.test'){unexpected.push(url.href);return route.abort();}if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div class="prs__a"><button id="singleSave">Save</button></div></body></html>'});unexpected.push(url.pathname);return route.abort();});await page.goto('http://receipt-contract.test/');
  await page.addStyleTag({path:path.join(root,'css/tokens.css')});await page.addStyleTag({path:path.join(root,'css/receipt-entry.css')});
  await page.evaluate(()=>{
   window.__receiptFixture={creates:[],uploads:0,ocr:0,terminated:0,photoFails:true,saved:0};
   window.Tesseract={createWorker:async()=>({terminate:async()=>{__receiptFixture.terminated++;},recognize:async()=>{__receiptFixture.ocr++;if(__receiptFixture.defer)return new Promise(resolve=>{__receiptFixture.resolveOCR=resolve;});return{data:{text:'小松咖啡\n115/07/03\n小計100\n稅額5\n總計105\n現金200\n找零95'}};}})};
   window.API={mode:'http',createTransaction:async(payload,options)=>{__receiptFixture.creates.push({payload,options});await new Promise(resolve=>setTimeout(resolve,50));return{id:'receipt-test-1'};},fetchMedia:async(path,options)=>{__receiptFixture.uploads++;if(__receiptFixture.photoFails)throw new Error('Fixture upload failure');return{status:201,json:async()=>({id:'photo-fixture'})};}};
   window.__openReceipt=()=>ReceiptEntry.open({api:API,categories:[{id:'food',name:'餐飲',kind:'expense'}],groups:[],onSaved:()=>{__receiptFixture.saved++;}});
  });
  await page.addScriptTag({path:path.join(root,'js/media.js')});await page.evaluate(()=>TransactionMedia.mountEntryHook(document));
  await page.addScriptTag({path:path.join(root,'js/receipt-ocr.js')});await page.addScriptTag({path:path.join(root,'js/receipt-entry.js')});
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=16;c.getContext('2d').fillRect(0,0,16,16);return c.toDataURL('image/png').split(',')[1];}),'base64');
  await page.locator('[data-media-pending]').first().setInputFiles({name:'unrelated-manual-photo.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>document.querySelectorAll('.media-pending__item').length===1);
  await page.evaluate(()=>__openReceipt());assert.equal(await page.locator('[data-receipt-file="camera"]').getAttribute('capture'),'environment');
  await page.locator('[data-receipt-file="choose"]').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:png});await page.locator('[data-receipt-review]').waitFor();
  assert.equal(await page.locator('[name="amount"]').inputValue(),'105');assert.equal(await page.locator('[name="date"]').inputValue(),'2026-07-03');assert.equal(await page.evaluate(()=>__receiptFixture.creates.length),0);
  await page.locator('[name="cat"]').selectOption('food');await page.locator('[name="accept"]').check();
  await page.locator('[data-receipt-action="save"]').click();await page.evaluate(()=>document.querySelector('[data-receipt-review]')?.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await page.locator('[data-receipt-action="retry-photo"]').waitFor();
  let state=await page.evaluate(()=>__receiptFixture);assert.equal(state.creates.length,1);assert.equal(state.creates[0].payload.amount,105);assert.equal(state.creates[0].payload.date,'2026-07-03');assert.equal(state.creates[0].options.attachPendingPhotos,false);assert.equal(state.saved,1);assert.equal(state.uploads,1);assert.equal(await page.locator('.media-pending__item').count(),1,'receipt does not consume unrelated pending manual photos');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>{__receiptFixture.photoFails=false;});await page.locator('[data-receipt-action="retry-photo"]').click();await page.waitForFunction(()=>!document.querySelector('[data-receipt-action="retry-photo"]'));
  state=await page.evaluate(()=>__receiptFixture);assert.equal(state.creates.length,1);assert.equal(state.uploads,2);
  await page.locator('[data-receipt-action="close"]').click();
  await page.evaluate(()=>{__receiptFixture.defer=true;__openReceipt();});await page.locator('[data-receipt-file="choose"]').setInputFiles({name:'private-receipt.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>typeof __receiptFixture.resolveOCR==='function');
  await page.evaluate(()=>{location.hash='#/profile';});await page.waitForFunction(()=>!document.querySelector('.receipt-dialog'));await page.evaluate(()=>__receiptFixture.resolveOCR({data:{text:'PRIVATE LATE RESPONSE'}}));
  assert.equal(await page.locator('.receipt-dialog').count(),0);assert.equal(await page.evaluate(()=>__receiptFixture.creates.length),1);assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),[]);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 }finally{await browser.close();}
});
