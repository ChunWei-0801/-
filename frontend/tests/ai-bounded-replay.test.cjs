/*
 * Recorded failure-shape + controlled label replay, NOT real Qwen inference.
 * Actual worker, controller, public HTML, translations, validators and UI run
 * together in Chromium. Only runtime import and GPU probe are replaced. The
 * production default profile is exercised without rewriting application code.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname,'..');
const messages = JSON.parse(fs.readFileSync(path.join(root,'locales/zh-TW.json'),'utf8')).messages;
let chromium;
try {({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch(_){}

function assertContentFree(report) {
  const forbidden=new Set(['input','rawOutput','rawModelOutput','sourceText','sourcePreview','amount','amountText','date','dateText','merchant','merchantText','note','items','classificationDraft','normalizedDraft','classification']);
  function visit(value){
    if(!value||typeof value!=='object')return;
    for(const [key,next] of Object.entries(value)){assert.equal(forbidden.has(key),false,'diagnostic must not contain '+key);visit(next);}
  }
  visit(report);
  const exported=JSON.stringify(report);
  assert.equal(exported.includes('今天早餐'),false);assert.equal(exported.includes('午餐120'),false);assert.equal(exported.includes('支出｜餐飲'),false);
  assert.equal(report.containsPrivateContent,false);assert.equal(report.accuracyNotInferred,true);
}

async function downloadDiagnostic(page) {
  assert.equal(await page.locator('#modelExport').isEnabled(),true);
  const downloading=page.waitForEvent('download');await page.locator('#modelExport').click();
  const file=await downloading;assert.equal(file.suggestedFilename(),'local-ai-trial-diagnostic.json');
  const report=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assertContentFree(report);return report;
}

test('bounded default crosses actual worker/controller/browser, stops the observed loop and safely retries classification',{skip:!chromium},async()=>{
  const executablePath=process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Taipei',serviceWorkers:'block',acceptDownloads:true});
    const errors=[],unexpected=[],writes=[];
    await context.addInitScript(()=>{
      localStorage.setItem('fambudget.language','zh-TW');
      window.__boundedReplay={workerCount:0,calls:0,closed:0,interrupts:0,yielded:0,requests:[]};
      Object.defineProperty(navigator,'gpu',{configurable:true,value:{requestAdapter:async()=>({features:new Set(['shader-f16'])})}});
      const NativeWorker=window.Worker;
      window.Worker=class BoundedReplayWorker extends NativeWorker {
        constructor(...args){
          super(...args);window.__boundedReplay.workerCount++;
          this.addEventListener('message',event=>{
            if(event.data&&event.data.type==='bounded-replay-stats')Object.assign(window.__boundedReplay,event.data.stats);
          });
        }
      };
    });
    const workerSource=fs.readFileSync(path.join(root,'js/local-ai-worker.js'),'utf8');
    assert.equal(workerSource.includes('import(RUNTIME_URL)'),true);
    const runtime=`
      // CONTROLLED REPLAY: no weights, GPU inference or latency/quality claim.
      const replay={calls:0,closed:0,interrupts:0,yielded:0,requests:[]};
      function reportReplay(){self.postMessage({type:'bounded-replay-stats',stats:replay});}
      self.__boundedRuntime={
        CreateMLCEngine:async()=>({
          resetChat:async()=>{},unload:async()=>{},
          interruptGenerate:()=>{replay.interrupts++;reportReplay();},
          chat:{completions:{create:async options=>{
            const input=JSON.parse(options.messages.at(-1).content);
            const schema=JSON.parse(options.response_format.schema);
            const food=input.options.find(entry=>entry[1]==='支出｜餐飲');
            if(!food)throw Error('Controlled fixture needs the supplied dining option');
            replay.calls++;const attempt=replay.calls;
            replay.requests.push({schema,maxTokens:options.max_tokens,optionsCount:input.options.length,rowCount:input.rows.length,foodChoice:food[0]});reportReplay();
            return (async function*(){
              try {
                if(attempt===1){
                  // Split the observed runaway shape into deltas. A bounded
                  // integer-array response must reject the very first object
                  // prefix before decoding repeated classification/context/result.
                  const chunks=['{"items":[','{"sourceText":"今天早餐65元，午餐120元","amountText":"65","classification":"支出（未選分類）"',
                    ...Array.from({length:640},()=>',"classification":"收入｜薪資","context":"今天早餐65元","result":{"items":[')];
                  for(const text of chunks){replay.yielded++;reportReplay();yield{choices:[{delta:{content:text},finish_reason:null}]};}
                }else{
                  const literal=JSON.stringify(input.rows.map(()=>food[0]));
                  for(const text of literal.match(/.{1,2}/g)){replay.yielded++;reportReplay();yield{choices:[{delta:{content:text},finish_reason:null}]};}
                }
                yield{choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:90,completion_tokens:7,total_tokens:97}};
              }finally{replay.closed++;reportReplay();}
            })();
          }}}
        }),prebuiltAppConfig:{model_list:[]},deleteModelAllInfoInCache:async()=>{}
      };
    `;
    const origin='http://localhost:47172';
    const permitted=new Set(['/ai-test.html','/js/i18n.js','/js/local-ai-engine.js','/js/local-ai-evaluation.js','/js/ai-model-test.js','/js/local-ai-worker.js','/css/tokens.css','/css/ai-assistant.css','/css/safety-center.css','/js/safety-center.js']);
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()!=='GET')writes.push({method:request.method(),path:url.pathname});
      if(url.origin!==origin||request.method()!=='GET'){unexpected.push(request.url());return route.abort();}
      if(/^\/locales\/(zh-TW|zh-CN|en|ja|ko|es)\.json$/.test(url.pathname))return route.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(root,url.pathname.slice(1)),'utf8')});
      if(!permitted.has(url.pathname)){unexpected.push(url.pathname);return route.abort();}
      if(url.pathname==='/js/local-ai-worker.js')return route.fulfill({contentType:'text/javascript',body:runtime+workerSource.replace('import(RUNTIME_URL)','Promise.resolve(self.__boundedRuntime)')});
      return route.fulfill({contentType:url.pathname.endsWith('.html')?'text/html':url.pathname.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(root,url.pathname.slice(1)),'utf8')});
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/ai-test.html?v=bounded-controlled-replay');
    await page.waitForFunction(()=>!document.querySelector('#modelLoad').disabled);
    assert.equal(await page.evaluate(()=>__boundedReplay.calls),0,'mount must not download or run a model');
    await page.locator('#modelLoad').click();await page.waitForFunction(()=>!document.querySelector('#modelRun').disabled);
    const today=await page.evaluate(()=>new Intl.DateTimeFormat('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
    await page.locator('#modelInput').fill('今天早餐65元，午餐120元。');await page.locator('#modelRun').click();
    await page.waitForFunction(()=>document.querySelector('#modelStatus').dataset.errorCode==='AI_INVALID_DRAFT'&&!document.querySelector('#modelRun').disabled);
    await page.waitForFunction(()=>__boundedReplay.closed===1);
    const failed=JSON.parse(await page.locator('#modelMetrics').textContent());
    assert.equal(failed.status,'failed');assert.equal(failed.usableDraft,false);assert.equal(failed.errorCode,'AI_INVALID_DRAFT');
    assert.equal(failed.promptProfile,'bounded-labels-v1');assert.equal(failed.modelTask,'classify-source-candidates');assert.equal(failed.inferencePerformed,true);
    assert.deepEqual(failed.sourcePreview.draft.items.map(item=>[item.amount,item.kind,item.date]),[[65,'expense',today],[120,'expense',today]]);
    assert.equal(failed.sourcePreview.modelTask,'source-extraction-only');assert.equal(failed.sourcePreview.inferencePerformed,false);assert.equal(failed.sourcePreview.modelDraft,null);
    assert.equal(await page.locator('#modelOutput [data-source-preview="failed"] .model-draft').count(),2);
    assert.ok((await page.locator('#modelOutput').textContent()).includes(messages['aiTest.previewFailed']));
    assert.ok((await page.locator('#modelMetricsSummary').textContent()).includes(messages['aiTest.failedMetrics']));
    assert.equal(await page.locator('#modelStatus').evaluate(node=>node.classList.contains('error')),true);
    const first=await page.evaluate(()=>__boundedReplay);
    assert.equal(first.calls,1);assert.equal(first.closed,1);assert.ok(first.interrupts>=1);assert.equal(first.yielded,1,'the first illegal object delta must end the actual worker stream');
    assert.equal(first.requests[0].schema.type,'array');assert.equal(first.requests[0].schema.minItems,2);assert.equal(first.requests[0].schema.maxItems,2);
    assert.deepEqual(first.requests[0].schema.items.enum,Array.from({length:first.requests[0].optionsCount},(_,index)=>index));assert.ok(first.requests[0].maxTokens<80);
    const failedDiagnostic=await downloadDiagnostic(page);
    assert.equal(failedDiagnostic.status,'failed');assert.equal(failedDiagnostic.errorCode,'AI_INVALID_DRAFT');assert.equal(failedDiagnostic.sourcePreviewRetained,true);
    assert.equal(failedDiagnostic.counts.draftRows,2);assert.equal(failedDiagnostic.counts.modelRows,null);assert.equal(failedDiagnostic.measurement.promptProfile,'bounded-labels-v1');

    // Retry through the same real worker. Only the controlled runtime's second
    // reply changes; no app/default/profile/validator code is rewritten.
    await page.locator('#modelRun').click();
    await page.waitForFunction(()=>{
      const node=document.querySelector('#modelMetrics');
      try{return JSON.parse(node.textContent).inferencePerformed===true&&JSON.parse(node.textContent).normalizedDraft?.items?.length===2&&!document.querySelector('#modelRun').disabled;}catch(_){return false;}
    });
    await page.waitForFunction(()=>__boundedReplay.closed===2);
    const success=JSON.parse(await page.locator('#modelMetrics').textContent());
    assert.equal(success.modelTask,'classify-source-candidates');assert.equal(success.inferencePerformed,true);assert.equal(success.modelDraft,null);
    assert.equal(success.measurement.promptProfile,'bounded-labels-v1');assert.equal(success.measurement.attempts,1);
    assert.deepEqual(success.normalizedDraft.items.map(item=>[item.amount,item.kind,item.category,item.date,item.merchant]),[[65,'expense','FOOD',today,null],[120,'expense','FOOD',today,null]]);
    assert.equal(success.classificationDraft.classificationOnly,true);assert.equal(success.classificationDraft.items.length,2);
    assert.deepEqual(success.classificationDraft.fieldOrigins,{amount:'source',date:'source',currency:'source',merchant:'source',kind:'model-label',category:'model-label'});
    assert.deepEqual(success.classificationDraft.items.map(item=>[item.kind,item.category]),[['expense','FOOD'],['expense','FOOD']]);
    assert.ok(success.normalization.rowMappings.every(item=>item.modelRowIndex===null));assert.equal(success.normalization.sourceExtraction,true);
    assert.equal(success.normalization.classificationOnly,true);assert.equal(success.normalization.sourceRuleAssisted,true);
    const final=await page.evaluate(()=>__boundedReplay);
    assert.equal(final.workerCount,1);assert.equal(final.calls,2);assert.equal(final.closed,2);
    assert.deepEqual(JSON.parse(success.rawModelOutput),[final.requests[1].foodChoice,final.requests[1].foodChoice]);
    assert.equal(await page.locator('#modelStatus').evaluate(node=>node.classList.contains('error')),false);
    assert.equal(await page.locator('#modelStatus').getAttribute('data-error-code'),null,'successful retry clears the previous error marker');
    assert.ok((await page.locator('#modelOutput').textContent()).includes(messages['aiTest.classificationScope']));
    assert.equal(await page.locator('#modelOutput .model-draft').count(),2);assert.equal(await page.locator('#modelOutput [data-source-preview="failed"]').count(),0);
    const successDiagnostic=await downloadDiagnostic(page);
    assert.equal(successDiagnostic.status,'completed');assert.equal(successDiagnostic.counts.draftRows,2);assert.equal(successDiagnostic.counts.modelRows,null);assert.equal(successDiagnostic.counts.classificationCandidates,2);
    assert.equal(successDiagnostic.measurement.modelTask,'classify-source-candidates');assert.equal(successDiagnostic.measurement.inferencePerformed,true);
    assert.equal(Object.hasOwn(successDiagnostic,'summary'),false,'a single arbitrary input never earns a fixed-suite accuracy score');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const storage=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}));
    assert.equal(JSON.stringify(storage).includes('今天早餐'),false);assert.equal(JSON.stringify(storage).includes('午餐120'),false);
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(writes,[]);
    await context.close();
  } finally {await browser.close();}
});
