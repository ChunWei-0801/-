/* Public page contract fixtures: UI failures and cleanup, not real model inference or quality evidence. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname,'..');
const languages = ['zh-TW','zh-CN','en','ja','ko','es'];
const packs = Object.fromEntries(languages.map(language=>[language,JSON.parse(fs.readFileSync(path.join(root,'locales',language+'.json'),'utf8'))]));

test('public-page failure messages are present in all six locales',()=>{
  for(const language of languages){
    for(const key of ['invalidDraft','noOutput','incomplete','runtimeFailure','timeout','busy','failedMetrics','rawOutput','rawOutputNotice']){
      assert.ok(packs[language].messages['aiTest.'+key],language+' '+key);
    }
    assert.deepEqual(Object.keys(packs[language].messages).sort(),Object.keys(packs['zh-TW'].messages).sort());
  }
});

let chromium;
try {({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch(_){}
test('browser contract fixture: readable drafts, honest paired scoring, continued failures and retained synthetic cancellation',{skip:!chromium},async()=>{
  const executablePath=process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:320,height:800}}),errors=[],unexpected=[];
    page.on('pageerror',error=>errors.push(error.message));
    const html=fs.readFileSync(path.join(root,'ai-test.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!=='http://public-ai-contract.test'){unexpected.push(url.origin);return route.abort();}
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
      const match=url.pathname.match(/^\/locales\/(zh-TW|zh-CN|en|ja|ko|es)\.json$/);
      if(match)return route.fulfill({contentType:'application/json',body:JSON.stringify(packs[match[1]])});
      if(url.pathname==='/css/tokens.css'||url.pathname==='/css/ai-assistant.css'||url.pathname==='/css/safety-center.css'||url.pathname==='/css/voice-accessibility.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(root,url.pathname.slice(1)),'utf8')});
      unexpected.push(url.pathname);return route.abort();
    });
    await page.addInitScript(()=>localStorage.setItem('fambudget.language','zh-TW'));
    await page.goto('http://public-ai-contract.test/');
    await page.evaluate(()=>{
      // Explicit transport fixture. Never downloads weights or makes inference/quality claims.
      window.__modelFixture={loads:0,loaded:false,mode:'invalid',calls:0,profiles:[]};
      window.LocalAI={getStatus:()=>({loaded:__modelFixture.loaded,model:'CONTRACT FIXTURE — NOT INFERENCE'}),load:async(options)=>{__modelFixture.loads++;if(__modelFixture.deferLoad){options.onProgress({text:'Contract load phase'});await new Promise(resolve=>{__modelFixture.finishLoad=resolve;});}__modelFixture.loaded=true;},cancel:()=>{__modelFixture.loaded=false;},unload:()=>{__modelFixture.loaded=false;},clearCache:async()=>{__modelFixture.loaded=false;},generate:async(options)=>{
        __modelFixture.calls++;__modelFixture.profiles.push(options.promptProfile);
        const success={text:JSON.stringify({items:[{amount:65,kind:'expense',currency:'TWD',date:options.context.today,category:'FOOD'}],warnings:[]}),model:'CONTRACT FIXTURE — NOT INFERENCE',elapsedMs:12,usage:{promptTokens:4,completionTokens:5,totalTokens:9},finishReason:'stop',rawModelOutput:'CONTRACT RAW MODEL OUTPUT — NOT INFERENCE',normalization:{version:'source-grounded-v1',mechanicalMapping:true,requiresHumanReview:true}};
        if(__modelFixture.mode.startsWith('benchmark')){
          const cases=LocalAIEvaluation.cases({split:'quick',today:options.context.today}),index=cases.findIndex(entry=>entry.input===options.input),entry=cases[index];
          if(!entry)throw new Error('Unknown fixed fixture');
          if(index===1&&__modelFixture.mode==='benchmarkDefer')return new Promise(resolve=>{__modelFixture.resolve=()=>resolve({...success,text:JSON.stringify({items:entry.expected.items,warnings:[]}),modelDraft:{items:entry.expected.items,warnings:[]}});});
          if(index===1&&__modelFixture.mode==='benchmarkPartial'){const error=new Error('PRIVATE INPUT must not leak');error.code='AI_INVALID_DRAFT';error.details={rawOutput:'{"items":[]}',elapsedMs:55,model:'fixture-model'};throw error;}
          const items=entry.expected.items.map(item=>({...item}));
          const original=items.length?items.map(item=>({...item,kind:item.kind==='income'?'expense':'income',category:item.kind==='income'?'OTHER':'SALARY'})):[{amount:52000,kind:'income',currency:'TWD',date:options.context.today,category:'SALARY',merchant:null}];
          if(__modelFixture.mode==='benchmarkEmptyError'&&index===3){const error=new Error('Empty fixture');error.code='AI_NO_DRAFT';error.details={rawOutput:'{"items":[]}',elapsedMs:15,validation:{reason:'NO_TRANSACTIONS'}};throw error;}
          if(__modelFixture.mode==='benchmarkWrong'&&index===0)items[0]={...items[0],kind:'income',category:'SALARY'};
          const assisted=__modelFixture.mode==='benchmarkHybrid';
          return {...success,text:JSON.stringify({items,warnings:assisted?['INTERNAL RULE WARNING']:[]}),modelDraft:{items:assisted?original:items,warnings:[]},promptProfile:options.promptProfile,timing:{firstTokenMs:4,totalMs:12},normalization:assisted?{sourceRuleAssisted:true,adjustments:items.flatMap((item,rowIndex)=>[{rowIndex,field:'kind',reason:'SOURCE_KIND_CUE',action:'set',previous:original[rowIndex].kind,value:item.kind},{rowIndex,field:'category',reason:'SOURCE_CATEGORY_CUE',action:'set',previous:original[rowIndex].category,value:item.category}])}:null};
        }
        if(__modelFixture.mode==='defer')return new Promise(resolve=>{__modelFixture.resolve=()=>resolve(success);});
        if(__modelFixture.mode==='success')return success;
        const error=new Error('PRIVATE INPUT must not leak through raw error messages');
        if(__modelFixture.mode==='unknown'){error.code='AI_UNKNOWN_FAILURE';throw error;}
        error.code='AI_INVALID_DRAFT';
        error.details={rawOutput:'{"items":[],"warnings":["<img src=x onerror=alert(1)> 今天早餐65元"]}',model:'CONTRACT FIXTURE — NOT INFERENCE',elapsedMs:123.4,usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13,privateText:'SECRET'},finishReason:'stop',attempts:2,privateInput:'SECRET'};
        throw error;
      }};
    });
    await page.addScriptTag({path:path.join(root,'js/i18n.js')});
    await page.evaluate(()=>I18n.ready);
    await page.addScriptTag({path:path.join(root,'js/local-ai-evaluation.js')});
    await page.addScriptTag({path:path.join(root,'js/ai-model-test.js')});
    await page.waitForSelector('[data-language-select]');
    assert.equal(await page.evaluate(()=>__modelFixture.loads),0,'mount never downloads a model');
    assert.equal(await page.locator('#modelRun').isDisabled(),true);
    await page.evaluate(()=>{__modelFixture.deferLoad=true;});await page.locator('#modelLoad').click();
    await page.waitForFunction(()=>typeof __modelFixture.finishLoad==='function');
    assert.equal(await page.locator('#modelProgress').getAttribute('value'),null,'unknown load progress remains indeterminate');
    assert.equal(await page.locator('#modelRun').isDisabled(),true);assert.equal(await page.locator('#modelLoad').isDisabled(),true);
    await page.evaluate(()=>document.querySelector('#modelLoad').click());assert.equal(await page.evaluate(()=>__modelFixture.loads),1,'disabled load cannot create a duplicate request');
    await page.waitForTimeout(300);assert.match(await page.locator('#modelTiming').textContent(),/0\.[2-9]/,'live timer shows actual time elapsed');
    await page.evaluate(()=>{__modelFixture.deferLoad=false;__modelFixture.finishLoad();});
    await page.waitForFunction(()=>!document.querySelector('#modelRun').disabled);
    await page.locator('#modelInput').fill('今天早餐65元，午餐120元。');
    await page.locator('#modelRun').click();
    await page.waitForFunction(()=>document.querySelector('#modelStatus').dataset.errorCode==='AI_INVALID_DRAFT');
    assert.equal(await page.locator('#modelStatus').textContent(),packs['zh-TW'].messages['aiTest.invalidDraft']);
    assert.equal(await page.locator('#modelInput').inputValue(),'今天早餐65元，午餐120元。','failure preserves editable input');
    const failedMetrics=await page.locator('#modelMetrics').textContent();
    assert.match(failedMetrics,/"status": "failed"/);assert.match(failedMetrics,/"usableDraft": false/);assert.match(failedMetrics,/123.4/);assert.match(failedMetrics,/"attempts": 2/);assert.match(failedMetrics,/"completion_tokens": 3/);
    assert.equal(failedMetrics.includes('SECRET'),false);assert.equal(failedMetrics.includes('今天早餐'),false);
    assert.equal(await page.locator('#modelDiagnostics').isVisible(),true);
    assert.equal(await page.locator('#modelRawOutput').isVisible(),true,'failed output is expanded so a user can copy it without finding a hidden disclosure');
    const raw=await page.locator('#modelRawOutput').textContent();
    assert.match(raw,/<img src=x/);assert.equal(await page.locator('#modelDiagnostics img').count(),0,'raw model HTML remains text');
    assert.equal((await page.locator('body').textContent()).includes('PRIVATE INPUT'),false,'raw runtime error is hidden');
    for(const language of languages){
      await page.locator('[data-language-select]').selectOption(language);
      await page.waitForFunction(language=>document.documentElement.lang===language,language);
      assert.equal(await page.locator('#modelStatus').textContent(),packs[language].messages['aiTest.invalidDraft']);
      assert.equal(await page.locator('#modelDiagnostics summary').textContent(),packs[language].messages['aiTest.rawOutput']);
      assert.equal(await page.locator('#modelRawOutput').textContent(),raw,'changing language never rewrites model content');
      assert.equal(await page.locator('#modelMetricsSummary').textContent(),packs[language].messages['aiTest.failedMetrics']);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,language+' stays within 320px');
    }
    await page.evaluate(()=>{__modelFixture.mode='success';});
    await page.locator('#modelRun').click();
    await page.waitForSelector('[data-draft-index]');
    assert.equal(await page.locator('#modelTechnical').evaluate(node=>node.open),false,'technical JSON starts folded');
    assert.ok((await page.locator('[data-draft-index]').textContent()).includes('65'));
    assert.equal((await page.locator('#modelOutput').textContent()).includes('"items"'),false,'drafts appear as readable cards, not raw JSON');
    assert.ok((await page.locator('#modelOutput').textContent()).includes(packs.es.messages['aiTest.mappedDraft']));
    const normalizedEvidence=JSON.parse(await page.locator('#modelMetrics').textContent());
    assert.equal(normalizedEvidence.rawModelOutput,'CONTRACT RAW MODEL OUTPUT — NOT INFERENCE');
    assert.equal(normalizedEvidence.normalizedDraft.items[0].amount,65);
    assert.equal(normalizedEvidence.normalization.requiresHumanReview,true);
    assert.equal(await page.locator('#modelDiagnostics').isVisible(),false,'successful retry hides prior failure');
    assert.equal(await page.locator('#modelRawOutput').textContent(),'','successful retry clears rejected content');
    assert.equal((await page.locator('#modelMetrics').textContent()).includes('"status": "failed"'),false);
    await page.evaluate(()=>{__modelFixture.mode='unknown';});
    await page.locator('#modelRun').click();
    await page.waitForFunction(()=>document.querySelector('#modelStatus').dataset.errorCode==='AI_UNKNOWN_FAILURE');
    assert.equal(await page.locator('#modelStatus').textContent(),packs.es.messages['aiTest.runtimeFailure']);
    assert.equal((await page.locator('body').textContent()).includes('PRIVATE INPUT'),false);
    assert.equal(await page.locator('#modelDiagnostics').isVisible(),false);
    await page.evaluate(()=>{__modelFixture.mode='defer';});
    await page.locator('#modelRun').click();
    await page.waitForFunction(()=>typeof __modelFixture.resolve==='function');
    await page.locator('#modelCancel').click();
    await page.evaluate(()=>__modelFixture.resolve());
    await page.waitForTimeout(25);
    assert.equal(await page.locator('#modelOutput').textContent(),'','cancelled late result is ignored');
    assert.equal(await page.locator('#modelMetrics').textContent(),'');
    assert.equal(await page.locator('#modelRawOutput').textContent(),'');
    // Fixed-synthetic checks compare raw model decisions and assisted fields separately.
    await page.locator('[data-language-select]').selectOption('zh-TW');
    await page.locator('#modelLoad').click();await page.waitForFunction(()=>!document.querySelector('#modelBenchmark').disabled);
    await page.evaluate(()=>{__modelFixture.mode='benchmarkWrong';});await page.locator('#modelBenchmark').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-synthetic-case]').length===4&&!document.querySelector('#modelBenchmark').disabled);
    assert.equal(await page.locator('[data-synthetic-case="1"]').getAttribute('data-case-state'),'failed');
    assert.equal(await page.locator('[data-synthetic-case="2"]').getAttribute('data-case-state'),'passed');
    const diffs=await page.locator('[data-synthetic-case="1"] .model-differences').first().textContent();
    for(const expected of ['收入','支出','薪資','餐飲'])assert.ok(diffs.includes(expected),expected+' difference is explicit');
    assert.ok((await page.locator('#modelMetricsSummary').textContent()).includes('4／4'));
    assert.equal(await page.locator('#modelTechnical').evaluate(node=>node.open),false);
    assert.equal(await page.locator('[data-synthetic-case="1"] [data-draft-index="0"]').locator('dd').nth(1).textContent(),'收入','display does not silently correct wrong kind');
    for(const language of languages){await page.locator('[data-language-select]').selectOption(language);await page.waitForFunction(language=>document.documentElement.lang===language,language);assert.ok((await page.locator('[data-synthetic-case="1"]').textContent()).includes(packs[language].messages['aiTest.notPassed']));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,language+' results stay within 320px');}
    await page.locator('[data-language-select]').selectOption('zh-TW');await page.evaluate(()=>{__modelFixture.mode='benchmarkHybrid';});await page.locator('#modelBenchmark').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-case-state="passed"]').length===4&&!document.querySelector('#modelBenchmark').disabled);
    const hybrid=JSON.parse(await page.locator('#modelMetrics').textContent());
    assert.equal(hybrid.summaries['compact-v1'].model.passed,0);assert.equal(hybrid.summaries['compact-v1'].assisted.passed,4);assert.equal(hybrid.accuracyNotInferred,true);
    assert.equal(await page.locator('#modelStatus').getAttribute('data-error-code'),null);
    assert.ok((await page.locator('[data-synthetic-case="1"] [data-review-checks]').first().textContent()).includes(packs['zh-TW'].messages['aiTest.reviewChecksTitle']));
    assert.equal((await page.locator('#modelOutput').textContent()).includes('SOURCE_KIND_CUE'),false);
    // A failed case stays in the denominator while subsequent cases continue.
    await page.evaluate(()=>{__modelFixture.mode='benchmarkPartial';});await page.locator('#modelBenchmark').click();
    await page.waitForFunction(()=>document.querySelector('[data-synthetic-case="4"]').dataset.caseState==='passed'&&!document.querySelector('#modelBenchmark').disabled);
    const partial=JSON.parse(await page.locator('#modelMetrics').textContent());
    assert.equal(partial.summaries['compact-v1'].failed,1);assert.equal(partial.summaries['compact-v1'].attempted,4);assert.equal(partial.summaries['compact-v1'].assisted.passed,3);
    assert.equal(await page.locator('[data-synthetic-case="2"]').getAttribute('data-case-state'),'error');
    // An explicitly verified empty response is a valid abstention, never a blanket error-as-success shortcut.
    await page.evaluate(()=>{__modelFixture.mode='benchmarkEmptyError';});await page.locator('#modelBenchmark').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-case-state="passed"]').length===4&&!document.querySelector('#modelBenchmark').disabled);
    const abstained=JSON.parse(await page.locator('#modelMetrics').textContent());assert.equal(abstained.summaries['compact-v1'].abstained,1);assert.equal(abstained.summaries['compact-v1'].assisted.passed,4);
    // A/B runs only after explicit action and counterbalances order for each case.
    await page.locator('#modelComparison summary').click();await page.evaluate(()=>{__modelFixture.mode='benchmarkSuccess';__modelFixture.profiles=[];});
    await page.locator('#modelCompare').click();await page.waitForFunction(()=>document.querySelectorAll('[data-case-state="passed"]').length===8&&!document.querySelector('#modelCompare').disabled);
    assert.deepEqual(await page.evaluate(()=>__modelFixture.profiles),['baseline','compact-v1','compact-v1','baseline','baseline','compact-v1','compact-v1','baseline']);
    const paired=JSON.parse(await page.locator('#modelMetrics').textContent());assert.equal(paired.summaries.baseline.attempted,4);assert.equal(paired.summaries['compact-v1'].attempted,4);
    assert.equal(paired.summaries.baseline.latency.warm.firstTokenMs.median,4);assert.equal(await page.locator('#modelExport').isEnabled(),true);
    const downloading=page.waitForEvent('download');await page.locator('#modelExport').click();const download=await downloading,exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(exported.containsPrivateContent,false);assert.equal(exported.suite,'quick');assert.deepEqual(exported.comparisonProfiles,['baseline','compact-v1']);assert.equal(exported.profiles.baseline.attempted,4);
    const exportedText=JSON.stringify(exported);for(const forbidden of ['sourceText','rawModelOutput','三明治','52000','fieldDifference','PRIVATE INPUT'])assert.equal(exportedText.includes(forbidden),false,'export excludes '+forbidden);
    assert.deepEqual(exported.cases.map(item=>item.requestedProfile),['baseline','compact-v1','compact-v1','baseline','baseline','compact-v1','compact-v1','baseline']);
    assert.ok((await page.locator('#modelTiming').textContent()).includes('秒'),'uses observed elapsed time instead of a made-up progress percentage');
    // Cancellation retains completed synthetic results but never accepts a late reply.
    await page.evaluate(()=>{__modelFixture.mode='benchmarkDefer';delete __modelFixture.resolve;});await page.locator('#modelBenchmark').click();
    await page.waitForFunction(()=>typeof __modelFixture.resolve==='function');assert.equal(await page.locator('[data-synthetic-case="1"]').getAttribute('data-case-state'),'passed');
    await page.locator('#modelCancel').click();await page.evaluate(()=>__modelFixture.resolve());await page.waitForTimeout(25);
    assert.equal(await page.locator('[data-synthetic-case="1"]').getAttribute('data-case-state'),'passed');assert.equal(await page.locator('[data-case-state="cancelled"]').count(),1);assert.equal(await page.locator('[data-case-state="notrun"]').count(),2);
    const cancelled=JSON.parse(await page.locator('#modelMetrics').textContent());assert.equal(cancelled.complete,false);assert.equal(cancelled.summaries['compact-v1'].cancelled,1);assert.equal(cancelled.summaries['compact-v1'].attempted,2);assert.equal(cancelled.summaries['compact-v1'].assisted.passed,1);
    assert.equal(await page.locator('#modelRawOutput').textContent(),'');assert.equal(await page.locator('#modelTechnical').evaluate(node=>node.open),false);
    await page.locator('#modelUnload').click();
    assert.equal(await page.locator('#modelInput').inputValue(),'');
    assert.equal(await page.locator('#modelDiagnostics').isVisible(),false);
    assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),['fambudget.language'],'no draft or diagnostics persisted');
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  }finally{await browser.close();}
});

test('browser parser startup: stable ready promise waits for versioned locale packs before enabling model actions',{skip:!chromium},async()=>{
  const executablePath=process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  try{
    const html=fs.readFileSync(path.join(root,'ai-test.html'),'utf8');
    const version=new URL(html.match(/src="(js\/i18n\.js\?[^\"]+)"/)[1],'http://parser-ai-contract.test').searchParams.get('v');
    for(const language of languages){
      const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[];
      page.on('pageerror',error=>errors.push(error.message));
      let release;const localeGate=new Promise(resolve=>{release=resolve;});
      await page.addInitScript(language=>{
        localStorage.setItem('fambudget.language',language);
        const original=window.fetch;window.__localeFetchOptions=[];
        window.fetch=function(url,options){if(String(url).includes('/locales/'))__localeFetchOptions.push({url:String(url),cache:options&&options.cache,credentials:options&&options.credentials});return original.apply(this,arguments);};
      },language);
      await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.origin!=='http://parser-ai-contract.test')throw new Error('Unexpected parser fixture origin');
        if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
        const match=url.pathname.match(/^\/locales\/(zh-TW|zh-CN|en|ja|ko|es)\.json$/);
        if(match){
          requests.push(url);await localeGate;
          // An old, unversioned HTTP-cache response would omit the new keys.
          const pack=JSON.parse(JSON.stringify(packs[match[1]]));
          if(url.searchParams.get('v')!==version){delete pack.messages['aiTest.rawOutput'];delete pack.messages['aiTest.technical'];}
          return route.fulfill({contentType:'application/json',body:JSON.stringify(pack)});
        }
        if(url.pathname==='/js/voice-accessibility.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'js/voice-accessibility.js'),'utf8')});
        if(url.pathname==='/js/safety-center.js'||url.pathname==='/js/voice-accessibility.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'js/safety-center.js'),'utf8')});
        if(url.pathname==='/js/i18n.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'js/i18n.js'),'utf8')});
        if(url.pathname==='/js/local-ai-evaluation.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'js/local-ai-evaluation.js'),'utf8')});
        if(url.pathname==='/js/ai-model-test.js')return route.fulfill({contentType:'text/javascript',body:'window.__parserCapture={readyState:document.readyState,readyThen:typeof I18n.ready.then};\n'+fs.readFileSync(path.join(root,'js/ai-model-test.js'),'utf8')});
        if(url.pathname==='/js/local-ai-engine.js')return route.fulfill({contentType:'text/javascript',body:`window.__parserModel={loads:0,loaded:false};window.LocalAI={getStatus:()=>({loaded:__parserModel.loaded,model:'PARSER CONTRACT FIXTURE — NOT INFERENCE'}),load:async()=>{__parserModel.loads++;__parserModel.loaded=true;},cancel:()=>{__parserModel.loaded=false;},generate:async()=>{const error=new Error('PRIVATE untranslated error');error.code='AI_INVALID_DRAFT';error.details={rawOutput:'{"items":[]}',elapsedMs:12};throw error;}};`});
        if(url.pathname==='/css/tokens.css'||url.pathname==='/css/ai-assistant.css'||url.pathname==='/css/safety-center.css'||url.pathname==='/css/voice-accessibility.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(root,url.pathname.slice(1)),'utf8')});
        return route.abort();
      });
      await page.goto('http://parser-ai-contract.test/',{waitUntil:'domcontentloaded'});
      assert.deepEqual(await page.evaluate(()=>__parserCapture),{readyState:'loading',readyThen:'function'},'actual parser reads an existing pending ready promise');
      assert.equal(await page.locator('#modelLoad').isDisabled(),true,'locale loading does not enable a model operation');
      assert.equal(await page.evaluate(()=>__parserModel.loads),0);
      assert.equal((await page.locator('body').textContent()).includes('aiTest.'),false,'pending locale never exposes a translation key');
      release();await page.evaluate(()=>I18n.ready);
      await page.waitForFunction(()=>!document.querySelector('#modelLoad').disabled);
      assert.equal(await page.locator('#modelTechnical summary').textContent(),packs[language].messages['aiTest.technical']);
      assert.equal(await page.locator('#modelDiagnostics summary').textContent(),packs[language].messages['aiTest.rawOutput']);
      assert.equal(await page.locator('[data-language-select]').inputValue(),language);
      assert.equal(requests.length,language==='zh-TW'?1:2,'duplicate base-language loads share a request');
      for(const request of requests)assert.equal(request.searchParams.get('v'),version,'locale URL inherits the script resource version');
      for(const options of await page.evaluate(()=>__localeFetchOptions)){assert.equal(options.cache,'no-cache');assert.equal(options.credentials,'same-origin');}
      await page.locator('#modelLoad').click();await page.locator('#modelRun').click();
      await page.waitForFunction(()=>document.querySelector('#modelStatus').dataset.errorCode==='AI_INVALID_DRAFT');
      assert.equal(await page.locator('#modelDiagnostics summary').textContent(),packs[language].messages['aiTest.rawOutput']);
      assert.equal(await page.locator('#modelStatus').textContent(),packs[language].messages['aiTest.invalidDraft']);
      assert.equal((await page.locator('body').textContent()).includes('aiTest.'),false);
      assert.equal((await page.locator('body').textContent()).includes('PRIVATE untranslated'),false);
      assert.deepEqual(errors,[]);await page.close();
    }
  }finally{await browser.close();}
});

test('browser parser startup: missing or unavailable packs keep readable headings and never leak keys',{skip:!chromium},async()=>{
  const executablePath=process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  try{
    const html=fs.readFileSync(path.join(root,'ai-test.html'),'utf8');
    for(const scenario of ['missingSelectedKeys','missingAllKeys','unavailable']){
      const page=await browser.newPage();
      await page.addInitScript(()=>localStorage.setItem('fambudget.language','ja'));
      await page.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
        const match=url.pathname.match(/^\/locales\/(zh-TW|ja)\.json$/);
        if(match){
          if(scenario==='unavailable')return route.fulfill({status:503,contentType:'application/json',body:'{}'});
          const pack=JSON.parse(JSON.stringify(packs[match[1]]));
          if(scenario==='missingAllKeys'||match[1]==='ja'){delete pack.messages['aiTest.rawOutput'];delete pack.messages['aiTest.technical'];}
          return route.fulfill({contentType:'application/json',body:JSON.stringify(pack)});
        }
        if(url.pathname==='/js/i18n.js'||url.pathname==='/js/ai-model-test.js'||url.pathname==='/js/safety-center.js'||url.pathname==='/js/voice-accessibility.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,url.pathname.slice(1)),'utf8')});
        if(url.pathname==='/js/local-ai-engine.js')return route.fulfill({contentType:'text/javascript',body:'window.LocalAI={getStatus:()=>({loaded:false})};'});
        return route.fulfill({contentType:'text/css',body:''});
      });
      await page.goto('http://missing-i18n-contract.test/');await page.evaluate(()=>I18n.ready);
      await page.waitForFunction(()=>!document.querySelector('#modelLoad').disabled);
      for(const selector of ['#modelDiagnostics summary','#modelTechnical summary']){
        const label=await page.locator(selector).textContent();assert.ok(label.length>3);assert.equal(label.includes('aiTest.'),false);
      }
      assert.equal((await page.locator('body').textContent()).includes('aiTest.'),false);
      const unknown=await page.evaluate(()=>I18n.t('aiTest.thisKeyDoesNotExist'));
      assert.ok(unknown.length>3);assert.equal(unknown.includes('aiTest.'),false,'a missing arbitrary key falls back to a localized readable message');
      await page.close();
    }
  }finally{await browser.close();}
});
