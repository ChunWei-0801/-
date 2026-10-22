/* Contract fixtures only; no model performance or fresh inference is claimed. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const context=vm.createContext({URLSearchParams,Date,Intl,console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/assistant-operations.js'),'utf8'),context);
const tools=context.AssistantOperations.testing;
const plain=value=>JSON.parse(JSON.stringify(value));
const quote=(extra={})=>({yearText:null,monthText:'7月',merchantText:'全聯',kindText:'消費',...extra});

test('model-selected report quotes map to editable filters without choosing a scope or account',()=>{
 const result=tools.mapPlan(quote(),'我要7月在全聯消費的報表',2026,2026);
 assert.deepEqual(plain(result),{year:2026,month:7,q:'全聯',kind:'expense',yearAssumed:true,kindAssumed:false});
 assert.equal('scope' in result,false);assert.equal('userId' in result,false);
 assert.equal(tools.mapPlan(quote({yearText:'去年',monthText:'十二月',kindText:'收入'}),'去年十二月全聯收入',2024,2026).year,2025,'relative years use the real calendar, not an old selected year');
 const missing=tools.mapPlan(quote({monthText:null,kindText:null}),'全聯報表',2023,2026);
 assert.equal(missing.year,2023);assert.equal(missing.month,null);assert.equal(missing.kind,'all');assert.equal(missing.kindAssumed,true);
});

test('invented quotes, unsupported fields and ambiguous date wording fail closed to manual filters',()=>{
 for(const value of [quote({merchantText:'不存在商家'}),quote({yearText:'2025'}),quote({monthText:'十三月'}),quote({monthText:'下個月'}),quote({kindText:'刪除'}),{...quote(),scope:'family'},{...quote(),sql:'DROP TABLE transactions'},quote({merchantText:''}),{...quote(),yearText:2026}]){
  assert.throws(()=>tools.mapPlan(value,'我要7月在全聯消費的報表',2026,2026));
 }
 assert.throws(()=>tools.mapPlan(quote(),'7月全聯消費',NaN,2026));assert.throws(()=>tools.mapPlan(quote({yearText:'2026'}),'12026年7月全聯消費',2026,2026));assert.throws(()=>tools.mapPlan(quote({monthText:'7'}),'全聯消費7元',2026,2026));
});

test('query URLs preserve Unicode and punctuation as a literal keyword rather than extra filters',()=>{
 const literal='全聯 台北 &scope=family/<商家>';
 const qs=tools.queryString({year:2026,month:7,q:literal,kind:'expense',scope:'me'},100);
 assert.equal(qs.includes('+'),false,'API wrapper accepts percent-encoded spaces');
 const parsed=new URLSearchParams(qs);assert.equal(parsed.get('q'),literal);assert.equal(parsed.get('scope'),'me');assert.equal(parsed.getAll('scope').length,1);assert.equal(parsed.get('offset'),'100');const exported=new URLSearchParams(tools.queryString({year:2026,month:7,q:literal,kind:'expense',scope:'me'},0,true));assert.equal(exported.has('limit'),false);assert.equal(exported.has('offset'),false);
});

const worker=vm.createContext({self:{},TextEncoder,performance,console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/local-ai-worker.js'),'utf8'),worker);
function normalize(value,input){worker.raw=JSON.stringify(value);worker.input=input;return vm.runInContext('normalizeReportQuery(raw,input)',worker);}

test('worker validates every report quote independently before the UI or API sees a plan',()=>{
 const input='我要2026年7月在全聯消費的報表';
 assert.equal(normalize(quote({yearText:'2026年'}),input).yearText,'2026年');
 for(const value of [quote({merchantText:'偽造商家'}),{...quote(),scope:'family'},quote({monthText:7}),quote({kindText:'收入'})])assert.throws(()=>normalize(value,input));
 worker.request={task:'report-query',input,context:{privateLedger:'NEVER_SEND'},language:'zh-TW'};
 const prepared=vm.runInContext('messagesFor(request)',worker);const prompt=JSON.stringify(prepared.messages);
 assert.equal(prompt.includes('NEVER_SEND'),false);assert.equal(prepared.sourceIds.length,0);
 const schema=vm.runInContext('reportQuerySchema',worker);assert.equal(schema.additionalProperties,false);assert.deepEqual(Object.keys(schema.properties),['yearText','monthText','merchantText','kindText']);
});

let chromium;
try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch(_){}
test('browser: two assistant modes, no-model exact reports, verified model filters, real download responses and account cleanup',{skip:!chromium},async()=>{
 const executablePath=process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
 const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:320,height:800},acceptDownloads:true});const pageErrors=[],external=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin!=='http://operations.test'){external.push(route.request().url());return route.abort();}return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="view"></main>'});});
  await page.goto('http://operations.test/');
  await page.addStyleTag({path:path.join(__dirname,'../css/ai-assistant.css')});await page.addStyleTag({path:path.join(__dirname,'../css/assistant-operations.css')});
  await page.evaluate(()=>{
   window.__fixture={loaded:false,runs:0,requests:[],downloads:[],defer:false};window.I18n={language:()=> 'en',t:(_key,fallback)=>fallback};
   window.LocalAI={getStatus:()=>({loaded:__fixture.loaded}),checkSupport:async()=>({supported:true}),load:async()=>{__fixture.loaded=true;},clearSession:()=>{__fixture.loaded=false;},cancel:()=>{__fixture.loaded=false;},generate:async options=>{__fixture.runs++;__fixture.lastTask=options.task;__fixture.modelContext=options.context;return {text:JSON.stringify({yearText:null,monthText:'July',merchantText:'Central',kindText:'expenses'}),model:'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',elapsedMs:10,finishReason:'stop',usage:{}};}};
   function report(path){const query=new URL(path,location.origin).searchParams;return {filters:{},currency:'TWD',totals:{income:'0.00',expense:'1234.50',net:'-1234.50',count:205},scopeInfo:{definition:'Authorized own entries only'},transactions:{items:[{date:'2026-07-02',kind:'expense',amount:'0.10',merchant:'<img src=x onerror=alert(1)>',groupName:'Trip',note:'=SUM(A1:A2)'}],offset:Number(query.get('offset')||0),limit:100,totalCount:205,returnedCount:1,hasMore:!Number(query.get('offset'))}};}
   window.API={mode:'http',categories:async()=>({categories:[]}),groups:async()=>({groups:[]}),request:async(path)=>{__fixture.requests.push(path);if(path.startsWith('/api/ai-local/report?')){if(__fixture.defer)return new Promise(resolve=>{__fixture.resolveReport=()=>resolve(report(path));});return report(path);}throw new Error('Unexpected fixture path '+path);},fetchMedia:async(path)=>{__fixture.downloads.push(path);return new Response(new Uint8Array([80,75,3,4]),{headers:{'Content-Type':path.includes('format=xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}});}};
  });
  await page.addScriptTag({path:path.join(__dirname,'../js/assistant-operations.js')});await page.addScriptTag({path:path.join(__dirname,'../js/ai-assistant.js')});
  await page.evaluate(()=>{AIAssistant.setAccount({id:'one'});AIAssistant.render(document.querySelector('#view'));});
  assert.deepEqual(await page.locator('[data-ai-mode]').evaluateAll(nodes=>nodes.map(n=>n.dataset.aiMode)),['coach','help']);assert.equal(await page.evaluate(()=>__fixture.runs),0);
  await page.locator('[data-ai-mode="help"]').click();
  assert.equal(await page.locator('[data-operation-action="understand"]').isDisabled(),true);assert.equal(await page.locator('[data-operation-action="manual"]').isDisabled(),false);
  await page.locator('[data-operation-filter="year"]').fill('2026');await page.locator('[data-operation-filter="month"]').selectOption('7');await page.locator('[data-operation-filter="keyword"]').fill('Shop / Branch & Co');await page.locator('[data-operation-filter="kind"]').selectOption('expense');
  await page.locator('[data-operation-action="manual"]').click();await page.waitForFunction(()=>document.querySelector('[data-operation-results]').textContent.includes('1234.50'));
  assert.equal(await page.evaluate(()=>__fixture.runs),0,'exact query works without inference');
  assert.match(await page.locator('[data-operation-results]').textContent(),/205/);assert.match(await page.locator('[data-operation-results]').textContent(),/1234\.50/,'server complete total is not recomputed from one sample row');assert.equal(await page.locator('[data-operation-results] img').count(),0);
  const firstQuery=new URLSearchParams((await page.evaluate(()=>__fixture.requests.at(-1))).split('?')[1]);assert.equal(firstQuery.get('q'),'Shop / Branch & Co');assert.equal(firstQuery.get('scope'),'me');
  const prev=page.locator('[data-operation-results] button').filter({hasText:'Previous page'});assert.equal(await prev.isDisabled(),true,'finishing retrieval does not re-enable unavailable pagination');
  for(const [label,format] of [['Download Excel','xlsx'],['Download Word','docx']]){const pending=page.waitForEvent('download');await page.getByRole('button',{name:new RegExp(label)}).click();const download=await pending;assert.match(download.suggestedFilename(),new RegExp('\\.'+format+'$'));}
  const downloadPaths=await page.evaluate(()=>__fixture.downloads);for(const path of downloadPaths){const query=new URL(path,'http://operations.test').searchParams;assert.equal(query.has('limit'),false);assert.equal(query.has('offset'),false);assert.equal(query.get('q'),'Shop / Branch & Co');}
  await page.locator('[data-ai-action="load"]').click();await page.waitForFunction(()=>__fixture.loaded);
  await page.locator('[data-operation-input]').fill('Show July expenses at Central');await page.locator('[data-operation-action="understand"]').click();await page.waitForFunction(()=>__fixture.runs===1&&document.querySelector('[data-operation-filter="keyword"]').value==='Central');
  assert.equal(await page.evaluate(()=>__fixture.lastTask),'report-query');assert.deepEqual(await page.evaluate(()=>__fixture.modelContext),{});assert.match(await page.locator('.ait-operations').textContent(),/did not specify a year/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'report table scrolls within its own container on 320px');
  await page.evaluate(()=>{__fixture.defer=true;});await page.locator('[data-operation-action="manual"]').click();await page.waitForFunction(()=>typeof __fixture.resolveReport==='function');await page.evaluate(()=>{AIAssistant.setAccount({id:'two'});__fixture.resolveReport();});await page.waitForTimeout(25);
  assert.equal(await page.locator('.ai-trial').count(),0,'old-account report and inputs are removed');assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);
 }finally{await browser.close();}
});

test('actual worker contract executes the bounded query task once and rejects fabricated filters',async()=>{
 for(const valid of [true,false]){
  const sent=[],requests=[];let resets=0;
  const raw=JSON.stringify(quote({merchantText:valid?'全聯':'不存在商家'}));
  const engine={resetChat:async()=>{resets++;},chat:{completions:{create:async options=>{requests.push(options);return(async function*(){yield{choices:[{delta:{content:raw},finish_reason:null}]};yield{choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:40,completion_tokens:20,total_tokens:60}};})();}}}};
  const self={postMessage:m=>sent.push(m),fake:{CreateMLCEngine:async()=>engine}};
  const worker=vm.createContext({self,TextEncoder,performance,console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/local-ai-worker.js'),'utf8').replace('import(RUNTIME_URL)','Promise.resolve(self.fake)'),worker);
  await self.onmessage({data:{id:1,type:'load',model:'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'}});
  await self.onmessage({data:{id:2,type:'generate',task:'report-query',input:'我要7月在全聯消費的報表',context:{privateLedger:'NEVER SEND'},language:'zh-TW'}});
  const reply=sent.at(-1);assert.equal(requests.length,1);assert.equal(resets,2);assert.equal(requests[0].max_tokens,160);assert.equal(requests[0].temperature,0);assert.equal(JSON.parse(requests[0].response_format.schema).additionalProperties,false);assert.equal(JSON.stringify(requests[0].messages).includes('NEVER SEND'),false);
  if(valid){assert.equal(reply.type,'result');assert.deepEqual(JSON.parse(reply.result.text),quote());assert.equal(reply.result.attempts,1);assert.ok(reply.result.timing.totalMs>=0);}else{assert.equal(reply.type,'error');assert.equal(reply.error.code,'AI_INVALID_QUERY');assert.equal(reply.error.details.attempts,1);}
 }
});
