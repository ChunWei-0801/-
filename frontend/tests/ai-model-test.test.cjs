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
test('browser contract fixture: readable drafts, field mismatches and partial failures remain local and clear on cancellation',{skip:!chromium},async()=>{
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
      if(url.pathname==='/css/tokens.css'||url.pathname==='/css/ai-assistant.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(root,url.pathname.slice(1)),'utf8')});
      unexpected.push(url.pathname);return route.abort();
    });
    await page.addInitScript(()=>localStorage.setItem('fambudget.language','zh-TW'));
    await page.goto('http://public-ai-contract.test/');
    await page.evaluate(()=>{
      // Explicit transport fixture. Never downloads weights or makes inference/quality claims.
      window.__modelFixture={loads:0,loaded:false,mode:'invalid',calls:0};
      window.LocalAI={getStatus:()=>({loaded:__modelFixture.loaded,model:'CONTRACT FIXTURE — NOT INFERENCE'}),load:async()=>{__modelFixture.loads++;__modelFixture.loaded=true;},cancel:()=>{__modelFixture.loaded=false;},unload:()=>{__modelFixture.loaded=false;},clearCache:async()=>{__modelFixture.loaded=false;},generate:async(options)=>{
        __modelFixture.calls++;
        const success={text:JSON.stringify({items:[{amount:65,kind:'expense',currency:'TWD',date:options.context.today,category:'FOOD'}],warnings:[]}),model:'CONTRACT FIXTURE — NOT INFERENCE',elapsedMs:12,usage:{promptTokens:4,completionTokens:5,totalTokens:9},finishReason:'stop',rawModelOutput:'CONTRACT RAW MODEL OUTPUT — NOT INFERENCE',normalization:{version:'source-grounded-v1',mechanicalMapping:true,requiresHumanReview:true}};
        if(__modelFixture.mode==='benchmarkWrong'||__modelFixture.mode==='benchmarkPartial'||__modelFixture.mode==='benchmarkDefer'){
          if(options.input.includes('薪資')){
            if(__modelFixture.mode==='benchmarkDefer')return new Promise(resolve=>{__modelFixture.resolve=()=>resolve(success);});
            if(__modelFixture.mode==='benchmarkPartial'){const error=new Error('PRIVATE INPUT must not leak');error.code='AI_INVALID_DRAFT';error.details={rawOutput:'{"items":[]}',elapsedMs:55,model:'CONTRACT FIXTURE — NOT INFERENCE'};throw error;}
            return {...success,text:JSON.stringify({items:[{amount:30000,kind:'income',currency:'TWD',date:options.context.today,category:'SALARY'}],warnings:[]})};
          }
          return {...success,text:JSON.stringify({items:[{amount:65,kind:__modelFixture.mode==='benchmarkWrong'?'income':'expense',currency:'TWD',date:options.context.today,category:__modelFixture.mode==='benchmarkWrong'?'SALARY':'FOOD'},{amount:120,kind:'expense',currency:'TWD',date:options.context.today,category:__modelFixture.mode==='benchmarkWrong'?'TRANSIT':'FOOD'}],warnings:[]})};
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
    await page.addScriptTag({path:path.join(root,'js/ai-model-test.js')});
    await page.waitForSelector('[data-language-select]');
    assert.equal(await page.evaluate(()=>__modelFixture.loads),0,'mount never downloads a model');
    assert.equal(await page.locator('#modelRun').isDisabled(),true);
    await page.locator('#modelLoad').click();
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
    // Syntax-valid model fields can still be semantically wrong. Show every difference without repairing the output.
    await page.locator('[data-language-select]').selectOption('zh-TW');
    await page.locator('#modelLoad').click();
    await page.waitForFunction(()=>!document.querySelector('#modelBenchmark').disabled);
    await page.evaluate(()=>{__modelFixture.mode='benchmarkWrong';});
    await page.locator('#modelBenchmark').click();
    await page.waitForFunction(()=>document.querySelector('#modelStatus').dataset.errorCode==='AI_BENCHMARK_MISMATCH');
    assert.equal(await page.locator('[data-synthetic-case="1"]').getAttribute('data-case-state'),'failed');
    assert.equal(await page.locator('[data-synthetic-case="2"]').getAttribute('data-case-state'),'passed');
    const diffs=await page.locator('[data-synthetic-case="1"] .model-differences').textContent();
    for(const expected of ['收入','支出','薪資','餐飲','交通'])assert.ok(diffs.includes(expected),expected+' difference is explicit');
    assert.ok((await page.locator('#modelMetricsSummary').textContent()).startsWith('1／2'));
    assert.equal(await page.locator('#modelTechnical').evaluate(node=>node.open),false);
    assert.equal(await page.locator('[data-synthetic-case="1"] [data-draft-index="0"]').locator('dd').nth(1).textContent(),'收入','display does not silently correct wrong kind');
    for(const language of languages){
      await page.locator('[data-language-select]').selectOption(language);
      await page.waitForFunction(language=>document.documentElement.lang===language,language);
      assert.ok((await page.locator('[data-synthetic-case="1"]').textContent()).includes(packs[language].messages['aiTest.notPassed']));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,language+' result cards stay within 320px');
    }
    // The second case fails to produce a draft: retain the completed first case and say where it stopped.
    await page.evaluate(()=>{__modelFixture.mode='benchmarkPartial';});
    await page.locator('#modelBenchmark').click();
    await page.waitForFunction(()=>document.querySelector('[data-synthetic-case="2"]').dataset.caseState==='error');
    assert.equal(await page.locator('[data-synthetic-case="1"]').getAttribute('data-case-state'),'passed');
    assert.equal(await page.locator('[data-synthetic-case="1"] [data-draft-index]').count(),2);
    assert.equal(await page.locator('[data-synthetic-case="2"]').getAttribute('data-case-state'),'error');
    const partial=JSON.parse(await page.locator('#modelMetrics').textContent());
    assert.equal(partial.complete,false);assert.equal(partial.completed,1);assert.equal(partial.passed,1);assert.equal(partial.failure.usableDraft,false);
    assert.ok((await page.locator('#modelMetricsSummary').textContent()).includes('1'));
    assert.equal(await page.locator('#modelDiagnostics').isVisible(),true);
    // Cancellation clears both completed partial results and a pending second case; late replies cannot reappear.
    await page.evaluate(()=>{__modelFixture.mode='benchmarkDefer';delete __modelFixture.resolve;});
    await page.locator('#modelBenchmark').click();
    await page.waitForFunction(()=>typeof __modelFixture.resolve==='function');
    assert.equal(await page.locator('[data-synthetic-case="1"]').getAttribute('data-case-state'),'passed');
    await page.locator('#modelCancel').click();
    await page.evaluate(()=>__modelFixture.resolve());
    await page.waitForTimeout(25);
    assert.equal(await page.locator('[data-synthetic-case]').count(),0);assert.equal(await page.locator('#modelMetrics').textContent(),'');
    assert.equal(await page.locator('#modelRawOutput').textContent(),'');assert.equal(await page.locator('#modelTechnical').isVisible(),false);
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
        if(url.pathname==='/js/i18n.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'js/i18n.js'),'utf8')});
        if(url.pathname==='/js/ai-model-test.js')return route.fulfill({contentType:'text/javascript',body:'window.__parserCapture={readyState:document.readyState,readyThen:typeof I18n.ready.then};\n'+fs.readFileSync(path.join(root,'js/ai-model-test.js'),'utf8')});
        if(url.pathname==='/js/local-ai-engine.js')return route.fulfill({contentType:'text/javascript',body:`window.__parserModel={loads:0,loaded:false};window.LocalAI={getStatus:()=>({loaded:__parserModel.loaded,model:'PARSER CONTRACT FIXTURE — NOT INFERENCE'}),load:async()=>{__parserModel.loads++;__parserModel.loaded=true;},cancel:()=>{__parserModel.loaded=false;},generate:async()=>{const error=new Error('PRIVATE untranslated error');error.code='AI_INVALID_DRAFT';error.details={rawOutput:'{"items":[]}',elapsedMs:12};throw error;}};`});
        if(url.pathname==='/css/tokens.css'||url.pathname==='/css/ai-assistant.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(root,url.pathname.slice(1)),'utf8')});
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
        if(url.pathname==='/js/i18n.js'||url.pathname==='/js/ai-model-test.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,url.pathname.slice(1)),'utf8')});
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
