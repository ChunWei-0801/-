/* Contract fixture tests. These do not execute or evaluate the language model. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const context = vm.createContext({console, Date, Intl});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/ai-assistant.js'), 'utf8'), context);
const tools = context.AIAssistant.testing;
const categories = [{id:'1',name:'Food',kind:'expense'},{id:'2',name:'Salary',kind:'income'}];
const groups = [{id:'5',name:'My ledger'}];
const draft = (extra={}) => JSON.stringify({items:[{date:'2026-10-19',amount:65,currency:'TWD',kind:'expense',category:'Food',merchant:'Shop',note:'',...extra}],warnings:[]});

test('contract fixture: JSON drafts remain independently validated and require an authorized ledger', () => {
  const {items} = tools.checkDraft(draft(), categories);
  assert.equal(items[0].cat,'1');
  assert.equal(tools.validateRows(items,categories,'5',groups),true);
  assert.equal(tools.validateRows(items,categories,'',groups),false);
  assert.equal(tools.validateRows(items,categories,'another-family',groups),false);
  items[0].kind='income';
  assert.equal(tools.validateRows(items,categories,'5',groups),false);
});

test('contract fixture: unknown and foreign currencies require manual TWD conversion', () => {
  for (const currency of [null,'USD','JPY']) {
    const {items} = tools.checkDraft(draft({currency}),categories);
    assert.equal(items[0].amount,'');
    assert.equal(items[0].originalAmount,'65');
    assert.equal(tools.validateRows(items,categories,'5',groups),false);
    items[0].amount='2015.00';
    assert.equal(tools.validateRows(items,categories,'5',groups),false);
    items[0].fxConfirmed=true;
    assert.equal(tools.validateRows(items,categories,'5',groups),true);
  }
});

test('contract fixture: invalid model output never becomes an invented draft', () => {
  for (const invalid of ['breakfast 65','{}','{"items":[]}','{"items":[null]}',JSON.stringify({items:Array(11).fill({})})]) {
    assert.throws(()=>tools.checkDraft(invalid,categories));
  }
  const {items}=tools.checkDraft(draft({date:null,amount:null,kind:null,category:null}),categories);
  assert.equal(items[0].date,'');assert.equal(items[0].amount,'');assert.equal(items[0].kind,'');assert.equal(items[0].cat,'');
  assert.equal(tools.validateRows(items,categories,'5',groups),false);
});

test('contract fixture: calendar and money validation prevents permissive Number coercion', () => {
  for (const value of ['2026-02-29','2026-13-01','2026-10-32','2026-1-1',''])assert.equal(tools.validDate(value),false,value);
  assert.equal(tools.validDate('2024-02-29'),true);
  for (const value of ['0','-1','1e4','Infinity','1.234',' 65 ','0x10','1,000'])assert.equal(tools.validMoney(value),false,value);
  assert.equal(tools.validMoney('65.50'),true);
});

test('contract fixture: local model receives exact facts without merchant, note, emails, or account records', () => {
  const facts={period:'2026-10',previousPeriod:'2026-09',scope:'me',current:{income:'900719925474099.01',expense:'65.00',net:'900719925474034.01'},previous:{income:'0.00',expense:'0.00',net:'0.00'},comparison:{expenseDelta:'65.00'},transactions:{totalCount:100,truncated:true,items:[{id:'8',evidenceId:'tx:8',date:'2026-10-19',kind:'expense',amount:'65.00',categoryName:'Food a@example.com',merchant:'private merchant',note:'private health detail',includedInIncome:false}]},categories:{items:[]},sources:[{id:'tx:8',title:'Transaction'}],healthEntries:[{secret:'never'}],email:'never@example.com'};
  const result=tools.contextForModel(facts), serialized=JSON.stringify(result);
  assert.equal(result.current.income,'900719925474099.01');
  assert.equal(result.transactions.totalCount,100);assert.equal(result.transactions.truncated,true);
  for(const excluded of ['private merchant','private health detail','never@example.com','a@example.com','healthEntries'])assert.equal(serialized.includes(excluded),false,excluded);
  assert.equal(serialized.includes('[email removed]'),true);
});

test('contract fixture: model and source URLs cannot inject navigation', () => {
  for(const route of ['javascript:alert(1)','https://example.com','#/transactions/<svg>','#/admin','#/transactions?x=" onclick="bad','#/transactions?token=abc#bad'])assert.equal(tools.safeRoute(route),null,route);
  assert.equal(tools.safeRoute('#/entry?period=2026-10'),'#/entry?period=2026-10');
  assert.equal(tools.safeRoute('/api/ai-local/context?period=2026-10&scope=me'),'#/entry');
  assert.equal(tools.safeRoute('/docs/tutorial.html#entry'),'#/tutorial');
  assert.equal(tools.safeRoute('/#/profile'),'#/profile');
  assert.equal(tools.scrub('mail user@example.com then save'),'mail [email removed] then save');
});

test('contract fixture: downloadable evaluation excludes input, ledger, answer, receipt, and raw errors', () => {
  const data=tools.evaluation({measurements:[{task:'ledger',model:'local-model',elapsedMs:123,usage:{promptTokens:12,completionTokens:9,privateText:'secret'},sourceCount:4,sourceRuleAssisted:true,sourceAdjustmentCount:3,excludedCandidateCount:2,rating:'supported',finishReason:'stop',input:'private question',text:'private answer'}],failedMeasurements:[{task:'draft',model:'local-model',elapsedMs:42,usage:{completion_tokens:6,privateText:'secret'},attempts:2,errorCode:'AI_NO_DRAFT',rawOutput:'private model output',message:'private raw error'}],context:{privateLedger:'never'},rawInput:'private input',rawModelOutput:'private raw extraction',file:'private image'});
  const json=JSON.stringify(data);
  assert.equal(data.containsPrivateContent,false);assert.equal(data.modelRuns[0].usage.promptTokens,12);assert.equal(data.modelRuns[0].sourceRuleAssisted,true);assert.equal(data.modelRuns[0].sourceAdjustmentCount,3);assert.equal(data.modelRuns[0].excludedCandidateCount,2);
  assert.equal(data.failedRuns[0].errorCode,'AI_NO_DRAFT');assert.equal(data.failedRuns[0].attempts,2);
  for(const value of ['private question','private answer','privateLedger','private input','private image','private model output','private raw error','private raw extraction','secret'])assert.equal(json.includes(value),false,value);
});

test('contract fixture: review notes accept only fixed reasons and stay attached to their original row',()=>{
  const normalization={adjustments:[{rowIndex:1,field:'kind',reason:'SOURCE_KIND_CUE',action:'set',previous:'income',value:'expense'},{rowIndex:1,field:'merchant',reason:'OPTIONAL_MERCHANT_UNSUPPORTED',action:'clear',previous:'PRIVATE NAME'},{rowIndex:0,field:'date',reason:'OPTIONAL_DATE_UNSUPPORTED',action:'clear'},{rowIndex:1,field:'kind',reason:'PRIVATE SECRET',action:'set'},{rowIndex:1,field:'password',reason:'SOURCE_KIND_CUE',action:'set'}]};
  const notes=JSON.parse(JSON.stringify(tools.rowChecks(normalization,1)));
  assert.deepEqual(notes,[{field:'kind',reason:'SOURCE_KIND_CUE',action:'set'},{field:'merchant',reason:'OPTIONAL_MERCHANT_UNSUPPORTED',action:'clear'}]);
  assert.equal(JSON.stringify(notes).includes('PRIVATE'),false,'private before/after values are not copied into review metadata');
});

test('contract fixture: final-field reminders replace intermediate clears while pure review stays unmodified',()=>{
  const normalization={adjustments:[{rowIndex:0,field:'classification',reason:'OPTIONAL_FIELD_EMPTY',action:'clear'},{rowIndex:0,field:'category',reason:'SOURCE_CATEGORY_CUE',action:'set'},{rowIndex:0,field:'kind',reason:'SOURCE_CLASSIFICATION_UNVERIFIED',action:'review'}]};
  assert.deepEqual(JSON.parse(JSON.stringify(tools.rowChecks(normalization,0))),[{field:'category',reason:'SOURCE_CATEGORY_CUE',action:'set'},{field:'kind',reason:'SOURCE_CLASSIFICATION_UNVERIFIED',action:'review'}]);
  assert.equal(tools.rowChecks(normalization,0,true).length,3,'provenance retains all approved events even when presentation keeps the final one');
});

test('contract fixture: OCR pins an actual worker and core; languages contain no image upload endpoint', () => {
  assert.match(tools.ocr.script,/tesseract\.js@7\.0\.0/);
  assert.match(tools.ocr.worker,/tesseract\.js@7\.0\.0\/dist\/worker\.min\.js$/);
  assert.match(tools.ocr.core,/tesseract\.js-core@7\.0\.0$/);
});

let chromium;
try { ({chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch (_) {}
test('browser contract fixture: explicit load, reviewed writes, help retrieval, rejected streaming, account isolation and 320px layout', {skip:!chromium}, async () => {
  const executablePath=process.env.CHROMIUM_EXECUTABLE || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:320,height:740}}), pageErrors=[];
    page.on('pageerror', error=>pageErrors.push(error.message));
    await page.route('http://ai-contract.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="view"></main>'}));
    await page.goto('http://ai-contract.test/');
    await page.addStyleTag({path:path.join(__dirname,'../css/ai-assistant.css')});
    await page.evaluate(() => {
      // Explicit contract fixture: no network, model download, inference or quality claim.
      window.__fixture={loadCalls:0,generationCalls:0,cancels:0,loaded:false,writes:[],requests:[],foreign:true,reject:false,defer:false,lastContext:null};
      window.I18n={language:()=> 'en',t:(key,fallback)=>fallback};
      window.LocalAI={getStatus:()=>({loaded:__fixture.loaded,phase:__fixture.loaded?'ready':'idle'}),checkSupport:async()=>({supported:true}),load:async({onProgress})=>{__fixture.loadCalls++;onProgress({progress:1,text:'Contract fixture loaded'});__fixture.loaded=true;},cancel:()=>{__fixture.cancels++;__fixture.loaded=false;},unload:()=>{__fixture.loaded=false;},clearSession:()=>{__fixture.loaded=false;},generate:async(options)=>{
        if(!__fixture.loaded)throw new Error('Fixture model was unloaded');
        __fixture.generationCalls++;__fixture.lastContext=options.context;
        if(__fixture.draftFailure){const error=new Error('The model did not produce usable draft items.');error.code='AI_NO_DRAFT';error.details={rawOutput:'{"items":[],"warnings":["<img src=x onerror=alert(1)>"]}',elapsedMs:42,model:'CONTRACT FIXTURE — NOT INFERENCE',finishReason:'stop',usage:{completion_tokens:6},attempts:2};throw error;}
        const result={text:options.task==='draft'?JSON.stringify({items:[{date:'2026-10-19',amount:65,currency:__fixture.foreign?'USD':'TWD',kind:'expense',category:'1',merchant:'<img src=x onerror=alert(1)>',note:'fixture note',missingFields:[]}],warnings:[]}):'Explanation <img src=x onerror=alert(1)> [summary:2026-10]',model:'CONTRACT FIXTURE — NOT INFERENCE',elapsedMs:20,usage:{promptTokens:10,completionTokens:12},finishReason:'stop'};
        if(options.task==='draft')result.rawModelOutput='{"items":[{"sourceText":"MODEL SOURCE FIXTURE","amountText":"65","classification":"支出｜Food"}],"warnings":[]}';
        if(__fixture.hybrid && options.task==='draft'){
          const items=[{date:'2026-10-19',amount:65,currency:'TWD',kind:'expense',category:'1',merchant:null,note:'fixture breakfast',missingFields:[]},{date:'2026-10-19',amount:120,currency:'TWD',kind:'expense',category:'1',merchant:null,note:'fixture lunch',missingFields:[]}];
          result.text=JSON.stringify({items,warnings:['INTERNAL SOURCE RULE WARNING SHOULD NOT APPEAR']});
          result.modelDraft={items:[items[0],{...items[1],kind:'income',category:'2'}],warnings:['MODEL WARNING FIXTURE']};
          result.normalization={sourceRuleAssisted:true,adjustments:[{rowIndex:0,field:'merchant',reason:'OPTIONAL_MERCHANT_UNSUPPORTED',action:'clear',previous:'invented'},{rowIndex:1,field:'kind',reason:'SOURCE_KIND_CUE',action:'set',previous:'income',value:'expense'},{rowIndex:1,field:'category',reason:'SOURCE_CATEGORY_CUE',action:'set',previous:'2',value:'1'}]};
        }
        if(__fixture.reviewOnly && options.task==='draft'){
          const item={...JSON.parse(result.text).items[0],merchant:null};result.text=JSON.stringify({items:[item],warnings:[]});result.modelDraft={items:[item],warnings:[]};
          result.normalization={sourceRuleAssisted:false,adjustments:[{rowIndex:0,field:'kind',reason:'SOURCE_CLASSIFICATION_UNVERIFIED',action:'review',previous:item.kind,value:item.kind},{rowIndex:0,field:'category',reason:'SOURCE_CLASSIFICATION_UNVERIFIED',action:'review',previous:item.category,value:item.category}]};
        }
        if(__fixture.partial && options.task==='draft'){
          const food={date:'2026-10-19',amount:65,currency:'TWD',kind:'expense',category:'1',merchant:null,note:'fixture food',missingFields:[]};
          const salary={...food,amount:30000,kind:'income',category:'2',note:'fixture salary'};
          result.text=JSON.stringify({items:[food,salary],warnings:[]});result.modelDraft={items:[null,food,salary],warnings:[]};
          result.normalization={sourceRuleAssisted:true,adjustments:[],rejectedRows:[{modelRowIndex:0,reason:'INVALID_SHAPE',field:'sourceText'}],rowMappings:[{draftIndex:0,modelRowIndex:1},{draftIndex:1,modelRowIndex:2}]};
        }
        if(__fixture.reject){options.onToken('REJECTED PROVISIONAL TEXT');throw new Error('AI_UNGROUNDED fixture rejection');}
        if(__fixture.defer)return new Promise(resolve=>{__fixture.resolve=()=>resolve(result);});
        return result;
      }};
      const facts=()=>({period:'2026-10',previousPeriod:'2026-09',scope:'me',current:{income:'10000.00',expense:'65.00',net:'9935.00'},previous:{income:'9000.00',expense:'50.00',net:'8950.00'},comparison:{expenseDelta:'15.00'},categories:{items:[]},budgets:{items:[]},savings:{goal:'1000.00',shortfall:'0.00'},transactions:{items:[{id:'8',evidenceId:'tx:8',date:'2026-10-19',kind:'expense',amount:'65.00',categoryName:'Food',merchant:'PRIVATE',note:'PRIVATE',sourceLink:'/api/ai-local/context?period=2026-10&scope=me'}],totalCount:1,returnedCount:1,offset:0,truncated:false,hasMore:false},sources:[{id:'summary:2026-10',title:'Monthly total',link:'/api/ai-local/context?period=2026-10&scope=me'}]});
      window.API={mode:'http',categories:async()=>({categories:[{id:'1',name:'Food',kind:'expense'},{id:'2',name:'Salary',kind:'income'}]}),groups:async()=>({groups:[{id:'5',name:'My ledger'}]}),me:async()=>({user:{id:'one'}}),request:async(path,options={})=>{__fixture.requests.push(path);if(path.includes('/knowledge?'))return {method:'bm25',items:[{id:'help-entry',title:'Entry confirmation',text:'Review every draft before saving.',sourceLink:'/docs/tutorial.html#entry'}]};if(path.startsWith('/api/ai-local/context?'))return facts();if(path==='/api/nlp/confirm'){__fixture.writes.push(options.body);return {id:'100'};}throw new Error('Unexpected fixture request '+path);},nlpConfirmBatch:async(items)=>{__fixture.writes.push(items);return {created:items.length};}};
    });
    await page.addScriptTag({path:path.join(__dirname,'../js/ai-assistant.js')});
    await page.evaluate(()=>{AIAssistant.setAccount({id:'one'});AIAssistant.render(document.querySelector('#view'));});
    assert.equal(await page.evaluate(()=>__fixture.loadCalls),0,'mount never loads weights');
    assert.equal(await page.locator('[data-ai-action="run"]').isDisabled(),true);
    await page.locator('[data-ai-action="load"]').click();
    await page.waitForFunction(()=>__fixture.loaded);
    await page.locator('[data-ai-mode="ledger"]').click();
    assert.equal(await page.evaluate(()=>__fixture.loaded),true,'idle tab change preserves loaded model');
    await page.locator('[data-ai-action="facts"]').click();
    await page.waitForFunction(()=>document.querySelector('.ait-facts').textContent.includes('TWD 10000.00'));
    assert.equal(await page.evaluate(()=>__fixture.loaded),true,'retrieval preserves loaded model');
    assert.equal(await page.evaluate(()=>__fixture.generationCalls),0,'facts are not fabricated inference');
    await page.locator('[data-ai-mode="draft"]').click();
    await page.evaluate(()=>{__fixture.draftFailure=true;});
    await page.locator('textarea').fill('CONTRACT FIXTURE ONLY: breakfast TWD 65');
    await page.locator('[data-ai-action="run"]').click();
    await page.waitForFunction(()=>document.querySelector('.ait-output').textContent.includes('AI_NO_DRAFT'));
    assert.equal(await page.locator('.ait-status').textContent(),'The model returned an incomplete draft format. The original is preserved below. Revise the input and retry, or enter it manually.');
    assert.equal(await page.locator('textarea').inputValue(),'CONTRACT FIXTURE ONLY: breakfast TWD 65','failure preserves input for correction');
    assert.equal(await page.locator('[data-ai-row]').count(),0,'failed generation creates no editable or savable fake entries');
    assert.equal(await page.locator('.ait-output img').count(),0,'raw failed model output is inert text');
    assert.equal(await page.evaluate(()=>__fixture.writes.length),0,'failure never writes accounting');
    await page.evaluate(()=>{__fixture.draftFailure=false;});
    await page.locator('textarea').fill('CONTRACT FIXTURE ONLY: breakfast USD 65');
    await page.locator('[data-ai-action="run"]').click();
    await page.waitForSelector('[data-ai-row]');
    assert.match(await page.locator('.ait-raw').textContent(),/MODEL SOURCE FIXTURE/,'review preserves the actual model extraction, separately from canonical editable fields');
    assert.equal(await page.evaluate(()=>__fixture.writes.length),0,'generation never writes');
    assert.equal(await page.locator('[data-ai-field="amount"]').inputValue(),'','foreign amount is never auto-converted');
    await page.locator('[data-ai-group]').selectOption('5');
    await page.locator('[data-ai-approve]').check();
    await page.locator('[data-ai-action="save"]').click();
    assert.equal(await page.evaluate(()=>__fixture.writes.length),0,'invalid currency draft is blocked');
    await page.locator('[data-ai-field="amount"]').fill('2015.00');
    await page.locator('[data-ai-field="fxConfirmed"]').check();
    await page.locator('[data-ai-approve]').check();
    await page.locator('[data-ai-action="save"]').click();
    await page.waitForFunction(()=>__fixture.writes.length===1);
    const saved=await page.evaluate(()=>__fixture.writes[0]);
    assert.equal(saved.amount,2015);assert.equal(saved.groupId,'5');assert.equal(saved.raw,'CONTRACT FIXTURE ONLY: breakfast USD 65');
    assert.equal(await page.locator('.ait-output img').count(),0,'model HTML stays text or input values');
    // A hybrid draft remains editable, keeps model choices for audit, and preserves per-row notes after deletion.
    await page.evaluate(()=>{__fixture.hybrid=true;__fixture.foreign=false;});
    await page.locator('textarea').fill('CONTRACT FIXTURE ONLY: breakfast 65 and lunch 120');
    await page.locator('[data-ai-action="run"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-ai-row]').length===2);
    assert.equal(await page.evaluate(()=>__fixture.writes.length),1,'hybrid assistance still never saves automatically');
    assert.equal(await page.locator('[data-ai-review-checks]').count(),2);
    assert.match(await page.locator('[data-ai-row="1"] [data-ai-review-checks]').textContent(),/Original model choice: Income \/ Salary/);
    assert.match(await page.locator('[data-ai-row="1"] [data-ai-review-checks]').textContent(),/Draft to review: Expenses \/ Food/);
    assert.equal((await page.locator('.ait-review').textContent()).includes('SOURCE_KIND_CUE'),false,'daily review hides fixed internal reason codes');
    assert.equal((await page.locator('.ait-review').textContent()).includes('INTERNAL SOURCE RULE WARNING'),false,'program checks and model warnings are not conflated');
    assert.ok((await page.locator('.ait-review').textContent()).includes('MODEL WARNING FIXTURE'));
    await page.locator('[data-ai-row="0"] [data-ai-action="remove-row"]').click();
    assert.equal(await page.locator('[data-ai-row]').count(),1);
    assert.match(await page.locator('[data-ai-row="0"] [data-ai-review-checks]').textContent(),/Original model choice: Income \/ Salary/,'deleting another draft does not move or discard its check notes');
    await page.locator('[data-ai-group]').selectOption('5');await page.locator('[data-ai-approve]').check();
    await page.locator('[data-ai-action="save"]').click();await page.waitForFunction(()=>__fixture.writes.length===2);
    const hybrid=await page.evaluate(()=>__fixture.writes[1]);
    assert.equal(hybrid.kind,'expense');assert.equal(hybrid.cat,'1');assert.equal(hybrid.amount,120);
    assert.equal(hybrid.orig.by,'hybrid');assert.equal(hybrid.orig.kind,'income');assert.equal(hybrid.orig.cat,'2');assert.equal(hybrid.orig.amount,120,'audit original remains the unassisted model choice');
    assert.equal(JSON.stringify(hybrid).includes('rawModelOutput'),false,'model raw JSON is not uploaded during confirmation');
    await page.evaluate(()=>{__fixture.hybrid=false;__fixture.reviewOnly=true;});
    await page.locator('textarea').fill('CONTRACT FIXTURE ONLY: an item requiring manual review');
    await page.locator('[data-ai-action="run"]').click();await page.waitForSelector('[data-ai-row]');
    assert.match(await page.locator('[data-ai-review-checks]').textContent(),/has not been confirmed by the source-text rules/);
    assert.equal((await page.locator('[data-ai-review-checks]').textContent()).includes('was adjusted'),false,'a review reminder does not claim that any field was corrected');
    await page.locator('[data-ai-group]').selectOption('5');await page.locator('[data-ai-approve]').check();await page.locator('[data-ai-action="save"]').click();
    await page.waitForFunction(()=>__fixture.writes.length===3);
    assert.equal(await page.evaluate(()=>__fixture.writes[2].orig.by),'model','review-only notes never relabel an unchanged model draft as hybrid');
    await page.evaluate(()=>{__fixture.reviewOnly=false;});

    await page.evaluate(()=>{__fixture.partial=true;});
    await page.locator('textarea').fill('CONTRACT FIXTURE ONLY: malformed candidate, food65, salary30000');
    await page.locator('[data-ai-action="run"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-ai-row]').length===2);
    assert.equal(await page.locator('[data-excluded-candidates]').count(),1,'discarded candidates are disclosed');
    assert.equal(await page.locator('[data-ai-row]').count(),2,'the malformed original never becomes a draft');
    await page.locator('[data-ai-row="0"] [data-ai-action="remove-row"]').click();
    assert.equal(await page.locator('[data-excluded-candidates]').count(),1,'exclusion notice survives deleting a retained row');
    await page.locator('[data-ai-group]').selectOption('5');await page.locator('[data-ai-approve]').check();await page.locator('[data-ai-action="save"]').click();
    await page.waitForFunction(()=>__fixture.writes.length===4);
    const filtered=await page.evaluate(()=>__fixture.writes[3]);
    assert.equal(filtered.amount,30000);assert.equal(filtered.orig.amount,30000);assert.equal(filtered.orig.kind,'income');assert.equal(filtered.orig.cat,'2');
    assert.equal(filtered.orig.by,'hybrid','candidate filtering is not reported as an untouched model run');
    await page.evaluate(()=>{__fixture.partial=false;});

    await page.evaluate(()=>{
      window.__bookCalls=0;window.SafetyCenter={financialContext:async()=>{__bookCalls++;return {items:[{id:'finance:test-book',title:'Sourced book fixture',text:'Keep a buffer for uncertainty.',sourceLink:'https://www.harriman-house.com/psychologyofmoney'}]};},mountFinancialReferences:async(root)=>{const a=document.createElement('a');a.textContent='VISIBLE BOOK SOURCE FIXTURE';a.href='https://www.harriman-house.com/psychologyofmoney';root.append(a);}};
    });
    await page.locator('[data-ai-mode="coach"]').click();await page.locator('textarea').fill('How can I build saving habits?');
    await page.locator('[data-ai-action="run"]').click();await page.waitForFunction(()=>__fixture.lastContext&&__fixture.lastContext.knowledge&&__fixture.lastContext.knowledge.items[0].id==='finance:test-book');
    assert.equal(await page.evaluate(()=>__bookCalls),1,'only explicit coaching retrieves public source principles');
    assert.equal(await page.evaluate(()=>__fixture.lastContext.current.income),'10000.00','book RAG retains exact authorized ledger facts');
    assert.match(await page.locator('.ait-facts').textContent(),/VISIBLE BOOK SOURCE FIXTURE/,'cited book source is visible beside ledger sources');

    await page.locator('[data-ai-mode="help"]').click();
    await page.locator('textarea').fill('PRIVATE QUESTION user@example.com — this must not be the search query');
    await page.locator('[data-ai-action="run"]').click();
    await page.waitForFunction(()=>__fixture.lastContext&&__fixture.lastContext.knowledge);
    assert.equal(await page.evaluate(()=>Array.isArray(__fixture.lastContext.knowledge.items)),true,'worker receives knowledge object contract');
    const search=await page.evaluate(()=>__fixture.requests.find(path=>path.includes('/knowledge?')));
    assert.equal(search.includes('PRIVATE'),false);assert.equal(search.includes('user%40'),false);
    assert.equal(await page.locator('.ait-answer img').count(),0,'generated HTML is escaped with textContent');
    await page.evaluate(()=>{__fixture.reject=true;});
    await page.locator('[data-ai-action="run"]').click();
    await page.waitForFunction(()=>document.querySelector('.ait-status').textContent.includes('AI_UNGROUNDED'));
    assert.equal(await page.locator('.ait-output').textContent(),'','rejected provisional output is removed');
    await page.evaluate(()=>{__fixture.reject=false;__fixture.defer=true;});
    await page.locator('[data-ai-action="run"]').click();
    await page.waitForFunction(()=>typeof __fixture.resolve==='function');
    await page.evaluate(()=>{AIAssistant.setAccount({id:'two'});__fixture.resolve();});
    await page.waitForTimeout(30);
    assert.equal(await page.locator('.ai-trial').count(),0,'account change removes old private DOM');
    assert.equal(await page.evaluate(()=>__fixture.writes.length),4,'stale generated result never writes');
    await page.evaluate(()=>{AIAssistant.render(document.querySelector('#view'));});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'320px page has no horizontal overflow');
    assert.deepEqual(pageErrors,[]);
  } finally { await browser.close(); }
});
