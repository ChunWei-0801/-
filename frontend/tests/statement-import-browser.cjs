/* Isolated Chromium files/API fixtures: never connects to a bank, uploads a raw statement or writes production data. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),origin='http://localhost:49427';
async function fixture(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true}),page=await context.newPage(),errors=[],unexpected=[];
 page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin){unexpected.push(u.href);return route.abort();}if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-TW"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><button id="open">匯入帳單</button></body></html>'});unexpected.push(u.href);return route.abort();});
 await page.goto(origin);
 for(const file of ['css/tokens.css','css/app.css','css/statement-import.css'])await page.addStyleTag({path:path.join(root,file)});
 await page.evaluate(()=>{
  window.__owner='owner-a';window.__saved=[];window.__calls=[];window.__created=0;window.__commits=new Map();window.__preview={exact:[],possible:[]};
  window.LifeFeatures={user:()=>({id:__owner})};window.__categories=[{id:'C01',kind:'expense',name:'餐飲'},{id:'I01',kind:'income',name:'其他收入'}];
  window.API={mode:'http',request:async(path,options)=>{
   __calls.push({path,method:options.method,body:options.body?JSON.parse(JSON.stringify(options.body)):null});
   if(path==='/api/billing/profile')return {buyerTaxId:'88112345',companyName:'測試公司'};
   if(path==='/api/statement-import/preview'){
    if(window.__holdPreview)await new Promise(resolve=>{window.__releasePreview=resolve;});
    return {items:options.body.items.map(row=>({...row,exactDuplicate:__preview.exact.includes(row.rowIndex),possibleDuplicate:__preview.possible.includes(row.rowIndex),eligible:!__preview.exact.includes(row.rowIndex),matchingTransactionIds:__preview.possible.includes(row.rowIndex)?['old-1']:[]})),total:options.body.items.length};
   }
   if(path==='/api/statement-import/confirm'){
    if(window.__confirm4xx){window.__confirm4xx=false;var e=new Error('Fixture:核對資料後重試');e.status=409;throw e;}
    const key=options.body.idempotencyKey;if(__commits.has(key))return {...__commits.get(key),replayed:true};
    const rows=options.body.items.map(row=>({rowIndex:row.rowIndex,id:String(++__created)})),result={created:rows,skipped:[],createdCount:rows.length,skippedCount:0,replayed:false};__commits.set(key,result);
    if(window.__failAfterCommit){window.__failAfterCommit=false;throw Error('Fixture disconnected after commit');}return result;
   }
   throw Error('Unexpected fixture endpoint');
  }};
  Storage.prototype.setItem=function(){throw Error('No imported finance data in browser storage');};
 });
 await page.addScriptTag({path:path.join(root,'js/statement-parser.js')});await page.addScriptTag({path:path.join(root,'js/statement-import.js')});
 await page.evaluate(()=>{document.querySelector('#open').onclick=()=>StatementImport.open({api:API,owner:{id:__owner},categories:__categories,groups:[{id:'7',name:'旅行活動',canWrite:true}],onSaved:result=>__saved.push(result)});});
 await page.locator('#open').click();await page.locator('[data-statement-file]').waitFor();
 return {browser,context,page,errors,unexpected};
}
async function file(h,text,name='statement.csv',buffer){await h.page.locator('[name="provider"]').fill('測試信用卡');await h.page.locator('[name="paymentMethod"]').selectOption('credit_card');await h.page.locator('[data-statement-file]').setInputFiles({name,mimeType:'text/csv',buffer:buffer||Buffer.from(text,'utf8')});}
async function drafts(h,text){await file(h,text);await h.page.locator('[name="direction"]').selectOption('kind');await h.page.locator('[data-statement-mapping-accepted]').check();await h.page.locator('[data-statement-action="drafts"]').click();await h.page.locator('.statement-row').first().waitFor();}
async function bulkExpense(h){await h.page.locator('[name="bulkCategory"]').selectOption('C01');await h.page.locator('[data-statement-action="bulk-category"]').click();}
async function check(h){await h.page.locator('[data-statement-action="check"]').click();await h.page.waitForFunction(()=>document.querySelector('.statement-status').textContent.includes('重複檢查完成'));}
function clean(h){assert.deepEqual(h.errors,[]);assert.deepEqual(h.unexpected,[]);}
const standard='日期,金額,收支,店家,備註,交易序號,幣別\n2026-10-01,65,支出,早餐店,餐點,A001,TWD\n2026-10-02,120,支出,午餐店,餐點,A002,TWD\n2026-10-03,185,支出,信用卡繳款,還款,A003,TWD\n';

test('file and mapping are local until explicit duplicate review; exact imports are skipped and only reviewed selections confirm',async()=>{
 const h=await fixture();try{const p=h.page;await drafts(h,standard);assert.equal(await p.locator('.statement-row').count(),3);assert.equal(await p.locator('[data-statement-include="4"]').isChecked(),false,'repayment is not an expense by default');assert.equal(await p.evaluate(()=>__calls.some(c=>c.path.includes('statement-import'))),false);
 await bulkExpense(h);await p.evaluate(()=>{__preview.exact=[2];});await check(h);assert.equal(await p.locator('[data-statement-include="2"]').isDisabled(),true);assert.equal(await p.locator('[data-statement-include="2"]').isChecked(),false);assert.equal(await p.locator('[data-statement-action="confirm"]').isDisabled(),true);await p.locator('[data-statement-accept]').check();await p.locator('[data-statement-action="confirm"]').click();await p.waitForFunction(()=>__saved.length===1);
 const sent=await p.evaluate(()=>__calls.find(c=>c.path.endsWith('/confirm')).body);assert.equal(sent.items.length,1);assert.equal(sent.items[0].rowIndex,3);assert.equal(sent.items[0].buyerTaxId,'88112345');assert.equal(sent.items[0].cat,'C01');assert.match(sent.statementId,/^[a-f0-9]{64}$/);assert.match(sent.idempotencyKey,/^[a-f0-9-]{36}$/);assert.equal(Object.hasOwn(sent,'file'),false);assert.match(await p.locator('.statement-review, .statement-dialog').innerText(),/已新增 1 筆/);clean(h);
 }finally{await h.browser.close();}
});

test('possible existing purchases require their own acknowledgement and any record edit invalidates prior duplicate review',async()=>{
 const h=await fixture();try{const p=h.page;await drafts(h,standard.split('\n').slice(0,2).join('\n'));await bulkExpense(h);await p.evaluate(()=>{__preview.possible=[2];});await check(h);await p.locator('[data-statement-accept]').check();assert.equal(await p.locator('[data-statement-action="confirm"]').isDisabled(),true);await p.locator('[data-statement-allow-duplicate="2"]').check();assert.equal(await p.locator('[data-statement-action="confirm"]').isDisabled(),false);
 await p.locator('[data-statement-row="2"] [name="amount"]').fill('66.00');assert.equal(await p.locator('[data-statement-action="confirm"]').isDisabled(),true);assert.equal(await p.locator('[data-statement-accept]').isChecked(),false);await check(h);await p.locator('[data-statement-allow-duplicate="2"]').check();await p.locator('[data-statement-accept]').check();await p.locator('[data-statement-action="confirm"]').click();await p.waitForFunction(()=>__saved.length===1);assert.equal(await p.evaluate(()=>__calls.find(c=>c.path.endsWith('/confirm')).body.items[0].allowPossibleDuplicate),true);clean(h);
 }finally{await h.browser.close();}
});

test('an unknown network outcome freezes edits and retries the exact same payload and batch key',async()=>{
 const h=await fixture();try{const p=h.page;await drafts(h,standard.split('\n').slice(0,2).join('\n'));await bulkExpense(h);await check(h);await p.locator('[data-statement-accept]').check();await p.evaluate(()=>{__failAfterCommit=true;});await p.locator('[data-statement-action="confirm"]').click();await p.waitForFunction(()=>document.querySelector('[data-statement-action="confirm"]').textContent.includes('相同批次'));
 assert.equal(await p.locator('[name="provider"]').isDisabled(),true);assert.equal(await p.locator('[data-statement-row="2"] [name="amount"]').isDisabled(),true);await p.locator('[data-statement-action="confirm"]').click();await p.waitForFunction(()=>__saved.length===1);const calls=await p.evaluate(()=>__calls.filter(c=>c.path.endsWith('/confirm')).map(c=>c.body));assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(await p.evaluate(()=>__created),1);assert.equal(await p.evaluate(()=>__saved[0].replayed),true);clean(h);
 }finally{await h.browser.close();}
});

test('foreign currency and refund rows need explicit correction and review; screenshot-only or Excel files are not accepted',async()=>{
 const h=await fixture();try{const p=h.page;await file(h,'not a csv','statement.xlsx');await p.waitForFunction(()=>document.querySelector('.statement-status').textContent.includes('CSV或TSV'));
 await drafts(h,'日期,金額,收支,店家,備註,交易序號,幣別\n2026-10-01,10,支出,海外商店,消費,F001,USD\n2026-10-02,65,收入,早餐退款,退款,F002,TWD\n');assert.equal(await p.locator('[data-statement-include="2"]').isChecked(),false);assert.equal(await p.locator('[data-statement-include="3"]').isChecked(),false);
 await p.locator('[data-statement-include="2"]').check();await p.locator('[data-statement-row="2"] [name="kind"]').selectOption('expense');await p.locator('[data-statement-row="2"] [name="cat"]').selectOption('C01');await p.locator('[data-statement-row="2"] [name="amount"]').fill('320.00');await p.locator('[data-statement-row-review="2"]').check();await p.locator('[data-statement-action="check"]').click();assert.match(await p.locator('.statement-status').innerText(),/換算/);assert.equal(await p.evaluate(()=>__calls.some(c=>c.path.endsWith('/preview'))),false);
 await p.locator('[data-statement-fx="2"]').check();await check(h);await p.locator('[data-statement-accept]').check();await p.locator('[data-statement-action="confirm"]').click();await p.waitForFunction(()=>__saved.length===1);const row=await p.evaluate(()=>__calls.find(c=>c.path.endsWith('/confirm')).body.items[0]);assert.equal(row.amount,'320.00');assert.equal(row.currency,'TWD');clean(h);
 }finally{await h.browser.close();}
});

test('Big5 is an explicit local decoding choice, and header/mapping controls remain within a narrow enlarged interface',async()=>{
 const h=await fixture();try{const p=h.page;const bytes=Buffer.concat([Buffer.from('date,amount,kind,merchant\n2026-10-01,65,expense,','ascii'),Buffer.from([0xa4,0x40]),Buffer.from('\n','ascii')]);await file(h,'','statement.csv',bytes);await p.waitForFunction(()=>document.querySelector('.statement-status').textContent.includes('編碼'));await p.locator('[name="encoding"]').selectOption('big5');await p.locator('[data-statement-column="date"]').waitFor();await p.locator('[name="direction"]').selectOption('kind');await p.locator('[data-statement-mapping-accepted]').check();await p.locator('[data-statement-action="drafts"]').click();await p.locator('.statement-row').waitFor();assert.equal(await p.locator('[data-statement-row="2"] [name="merchant"]').inputValue(),'一');
 await p.setViewportSize({width:320,height:844});await p.evaluate(()=>{document.documentElement.style.fontSize='32px';});assert.equal(await p.evaluate(()=>document.querySelector('.statement-dialog').getBoundingClientRect().width<=innerWidth),true);assert.equal(await p.locator('.statement-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth+1),true);const buttons=await p.locator('.statement-dialog button:visible').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));assert.ok(buttons.every(v=>v>=44));clean(h);
 }finally{await h.browser.close();}
});

test('account changes discard in-memory drafts and ignore a late preview result without issuing any confirmation',async()=>{
 const h=await fixture();try{const p=h.page;await drafts(h,standard.split('\n').slice(0,2).join('\n'));await bulkExpense(h);await p.evaluate(()=>{__holdPreview=true;});await p.locator('[data-statement-action="check"]').click();await p.waitForFunction(()=>typeof __releasePreview==='function');await p.evaluate(()=>{__owner='owner-b';document.body.append(document.createElement('span'));});await p.waitForFunction(()=>!document.querySelector('.statement-dialog'));await p.evaluate(()=>__releasePreview());await p.waitForTimeout(30);assert.equal(await p.evaluate(()=>__calls.some(c=>c.path.endsWith('/confirm'))),false);assert.equal(await p.evaluate(()=>__saved.length),0);clean(h);
 }finally{await h.browser.close();}
});


test('unknown yen currency stays blocked until a person confirms conversion, and large files can be selected in200-row batches',async()=>{
 const h=await fixture();try{const p=h.page;await drafts(h,'日期,金額,收支,店家,備註,交易序號\n2026-10-01,¥10,支出,海外商店,消費,Y001\n');await p.locator('[data-statement-include="2"]').check();await p.locator('[data-statement-row="2"] [name="kind"]').selectOption('expense');await p.locator('[data-statement-row="2"] [name="amount"]').fill('320.00');await p.locator('[data-statement-row="2"] [name="cat"]').selectOption('C01');await p.locator('[data-statement-row-review="2"]').check();await p.locator('[data-statement-action="check"]').click();assert.match(await p.locator('.statement-status').innerText(),/換算/);assert.equal(await p.locator('[data-statement-fx="2"]').count(),1);
 const large='日期,金額,收支,店家,交易序號,幣別\n'+Array.from({length:201},(_,i)=>'2026-10-01,65,支出,早餐店,ROW-'+i+',TWD').join('\n');await drafts(h,large);await bulkExpense(h);await p.locator('[data-statement-action="check"]').click();assert.match(await p.locator('.statement-status').innerText(),/最多確認200筆/);assert.equal(await p.evaluate(()=>__calls.some(c=>c.path.endsWith('/preview'))),false);await p.locator('[data-statement-action="select-first"]').click();assert.equal(await p.locator('[data-statement-include]:checked').count(),200);await check(h);assert.equal(await p.evaluate(()=>__calls.find(c=>c.path.endsWith('/preview')).body.items.length),200);clean(h);
 }finally{await h.browser.close();}
});

test('a definitive validation failure returns to editable review instead of retrying an obsolete batch',async()=>{
 const h=await fixture();try{const p=h.page;await drafts(h,standard.split('\n').slice(0,2).join('\n'));await bulkExpense(h);await check(h);await p.locator('[data-statement-accept]').check();await p.evaluate(()=>{__confirm4xx=true;});await p.locator('[data-statement-action="confirm"]').click();await p.waitForFunction(()=>document.querySelector('.statement-status').textContent.includes('核對資料'));assert.equal(await p.locator('[name="provider"]').isDisabled(),false);assert.equal(await p.locator('[data-statement-action="confirm"]').isDisabled(),true);assert.equal(await p.evaluate(()=>__created),0);await check(h);await p.locator('[data-statement-accept]').check();await p.locator('[data-statement-action="confirm"]').click();await p.waitForFunction(()=>__saved.length===1);const keys=await p.evaluate(()=>__calls.filter(c=>c.path.endsWith('/confirm')).map(c=>c.body.idempotencyKey));assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1]);clean(h);
 }finally{await h.browser.close();}
});
