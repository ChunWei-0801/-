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
test('browser contract fixture: rejected drafts remain local, localized, measurable and clear on retry, cancellation or unload',{skip:!chromium},async()=>{
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
      window.LocalAI={getStatus:()=>({loaded:__modelFixture.loaded,model:'CONTRACT FIXTURE — NOT INFERENCE'}),load:async()=>{__modelFixture.loads++;__modelFixture.loaded=true;},cancel:()=>{__modelFixture.loaded=false;},unload:()=>{__modelFixture.loaded=false;},clearCache:async()=>{__modelFixture.loaded=false;},generate:async()=>{
        __modelFixture.calls++;
        const success={text:JSON.stringify({items:[{amount:65,kind:'expense',currency:'TWD',date:'2026-10-20',category:'FOOD'}],warnings:[]}),model:'CONTRACT FIXTURE — NOT INFERENCE',elapsedMs:12,usage:{promptTokens:4,completionTokens:5,totalTokens:9},finishReason:'stop'};
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
    await page.locator('#modelDiagnostics summary').click();
    const raw=await page.locator('#modelRawOutput').textContent();
    assert.match(raw,/<img src=x/);assert.equal(await page.locator('#modelDiagnostics img').count(),0,'raw model HTML remains text');
    assert.equal((await page.locator('body').textContent()).includes('PRIVATE INPUT'),false,'raw runtime error is hidden');
    for(const language of languages){
      await page.locator('[data-language-select]').selectOption(language);
      await page.waitForFunction(language=>document.documentElement.lang===language,language);
      assert.equal(await page.locator('#modelStatus').textContent(),packs[language].messages['aiTest.invalidDraft']);
      assert.equal(await page.locator('#modelDiagnostics summary').textContent(),packs[language].messages['aiTest.rawOutput']);
      assert.equal(await page.locator('#modelRawOutput').textContent(),raw,'changing language never rewrites model content');
      assert.ok((await page.locator('#modelMetrics').textContent()).startsWith(packs[language].messages['aiTest.failedMetrics']));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,language+' stays within 320px');
    }
    await page.evaluate(()=>{__modelFixture.mode='success';});
    await page.locator('#modelRun').click();
    await page.waitForFunction(()=>document.querySelector('#modelOutput').textContent.includes('"amount": 65'));
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
    await page.locator('#modelUnload').click();
    assert.equal(await page.locator('#modelInput').inputValue(),'');
    assert.equal(await page.locator('#modelDiagnostics').isVisible(),false);
    assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),['fambudget.language'],'no draft or diagnostics persisted');
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  }finally{await browser.close();}
});
