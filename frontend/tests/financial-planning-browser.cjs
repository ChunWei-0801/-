/* Real-browser UI contracts with synthetic financial evidence/model replies.
 * These tests do not measure WebLLM quality, call an FX provider or touch production. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const engineName=process.env.FAMBUDGET_TEST_BROWSER||'chromium';
const source=fs.readFileSync(path.join(__dirname,'../js/financial-planning.js'),'utf8');
const style=fs.readFileSync(path.join(__dirname,'../css/financial-planning.css'),'utf8');

function evidence(){return {version:1,currency:'TWD',generatedAt:'2026-10-29T12:00:00+08:00',input:{targetAmount:'10000',targetCurrency:'TWD',savedTwd:'2000',deadline:'2027-02-28',question:'旅行'},facts:{targetTwd:'10000.00',savedTwd:'2000.00',gapTwd:'8000.00',remainingDays:122,contributionMonths:4,requiredMonthlyTwd:'2000',weeklyAllowanceReserveTwd:'800',allowanceMonthlyReserveTwd:'800',allowancePaymentCount:16,allowanceTotalTwd:'3200',recordedMonthlyNetTwd:'6000',availableMonthlyTwd:'5200',capacitySource:'ledger',transactionCount:30,contributionDates:['2026-11-29','2026-12-29','2027-01-29','2027-02-28']},quote:null,plans:[{id:'deadline',title:'維持原定日期',monthlyTwd:'2000',months:4,feasible:true,description:'依目前假設可達成。',evidenceIds:['planning:facts']},{id:'comfortable',title:'保留更多彈性',monthlyTwd:'1000',months:8,feasible:true,description:'延長至八期。',evidenceIds:['planning:facts']}],knowledge:{query:'旅行儲蓄',method:'bm25',items:[{id:'finance:budget',title:'先安排必要支出',text:'先確認必要支出，再安排儲蓄及零用錢。',sourceLink:'https://www.consumerfinance.gov/consumer-tools/budgeting/',reviewedAt:'2026-10-29',sourcePublishedAt:null,license:'自行撰寫摘要，原文依來源規定使用',score:2.1}],totalMatches:1,truncated:false},sources:[{id:'planning:facts',title:'授權帳務試算',link:'#facts'},{id:'planning:plan:deadline',title:'維持期限方案',link:'#plan'},{id:'finance:budget',title:'必要支出',link:'https://www.consumerfinance.gov/consumer-tools/budgeting/'}],warnings:[],dataPolicy:{readOnly:true}};}

async function fixture(){
  const executablePath=process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  const browser=await pw[engineName].launch({headless:true,...(engineName==='chromium'?{executablePath,args:['--no-sandbox']}:{})});
  const mobile=process.env.FAMBUDGET_TEST_DEVICE!=='desktop',device=mobile?(engineName==='chromium'?pw.devices['Pixel 7']:engineName==='webkit'?pw.devices['iPhone 13']:{viewport:{width:390,height:844}}):{viewport:{width:1280,height:900}};
  const context=await browser.newContext({...device,timezoneId:'Asia/Taipei',reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    if(route.request().url()==='http://planning-fixture.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;font-family:Arial,sans-serif}*{box-sizing:border-box}'+style+'</style></head><body><main id="root"></main></body></html>'});
    requests.push(route.request().url());return route.abort();
  });
  await page.goto('http://planning-fixture.test/');
  await page.evaluate(data=>{
    window.__data=data;window.__calls=[];window.__creates=[];window.__aiCalls=[];window.__owner='parent';window.__api={
      financialPlanningPreview:async body=>{__calls.push(JSON.parse(JSON.stringify(body)));if(window.__fail)throw Error('匯率暫時無法更新，請稍後再試。');return JSON.parse(JSON.stringify(__data));},
      createSavingsJar:async body=>{__creates.push(JSON.parse(JSON.stringify(body)));if(window.__createFail)throw Error('測試網路中斷');return Object.assign({id:'jar-1'},body);}
    };
    window.LocalAI={status:()=>({loaded:false,busy:false}),generate:async opts=>{__aiCalls.push(JSON.parse(JSON.stringify({task:opts.task,context:opts.context,input:opts.input})));return {text:window.__answer||'先保留必要支出，再選擇合適的方案。[finance:budget] 維持期限每期 2000 元。[planning:facts]',model:'synthetic-contract-fixture',finishReason:'stop',elapsedMs:15,usage:{prompt_tokens:10,completion_tokens:20}};}};
  },evidence());
  await page.addScriptTag({content:source});
  await page.evaluate(()=>{window.__mount=()=>FinancialPlanning.render(document.querySelector('#root'),{api:__api,user:{id:__owner},demo:true,getAccountId:()=>__owner});__mount();});
  return {browser,context,page,errors,requests};
}

test('planning is explicit, displays program evidence and sources, and fits mobile without starting a model or writing',async()=>{
  const h=await fixture();try{
    const {page}=h;
    assert.equal(await page.locator('[name=targetCurrency]').inputValue(),'TWD');
    assert.equal(await page.evaluate(()=>__aiCalls.length),0);assert.equal(await page.evaluate(()=>__creates.length),0);
    await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();
    await page.getByRole('heading',{name:'程式試算',exact:true}).waitFor();
    assert.match(await page.locator('.fp-stats').innerText(),/8,000/);assert.match(await page.locator('.fp-stats').innerText(),/2,000/);
    assert.match(await page.locator('.fp-results').innerText(),/歷史帳務試算，非銀行可用餘額/);
    assert.match(await page.locator('.fp-results').innerText(),/沒有呼叫外部匯率/);
    assert.match(await page.locator('.fp-results').innerText(),/尚未執行模型/);
    assert.equal(await page.locator('.fp-sources a').getAttribute('rel'),'noopener noreferrer');
    assert.equal(await page.evaluate(()=>__aiCalls.length),0);assert.equal(await page.evaluate(()=>__creates.length),0);
    for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'fits '+width);}
    await page.evaluate(()=>{__data.knowledge.items[0].title='<img src=x onerror=alert(1)>';__data.knowledge.items[0].sourceLink='javascript:alert(1)';__data.knowledge.items[0].text='<script>bad</script>';});
    await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.fp-sources').textContent.includes('<img'));
    assert.equal(await page.locator('.fp-sources img,.fp-sources script,.fp-sources a').count(),0);
    assert.deepEqual(h.errors,[]);assert.deepEqual(h.requests,[]);
  }finally{await h.browser.close();}
});

test('form edits and account changes invalidate results; detached and old requests cannot overwrite a new preview',async()=>{
  const h=await fixture();try{
    const {page}=h;
    await page.evaluate(()=>{__api.financialPlanningPreview=body=>{__calls.push(body);return new Promise(resolve=>{window.__resolveOld=resolve;});};});
    await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();
    await page.locator('[name=targetAmount]').fill('15000');
    assert.equal(await page.getByRole('button',{name:'試算並檢索資料',exact:true}).isDisabled(),false);
    await page.evaluate(()=>{__api.financialPlanningPreview=async()=>{var d=JSON.parse(JSON.stringify(__data));d.facts.gapTwd='13000';return d;};});
    await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.fp-stats')&&document.querySelector('.fp-stats').textContent.includes('13,000'));
    await page.evaluate(()=>__resolveOld(__data));
    assert.match(await page.locator('.fp-stats').innerText(),/13,000/,'old result ignored');
    await page.locator('[name=targetAmount]').fill('16000');
    assert.equal(await page.locator('.fp-results').isHidden(),true);
    await page.evaluate(()=>{__api.financialPlanningPreview=()=>new Promise(resolve=>window.__resolveAfterLogout=resolve);});
    await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();
    await page.evaluate(()=>{__owner='child';FinancialPlanning.setAccount({id:'child'});__resolveAfterLogout(__data);});
    assert.equal(await page.locator('.fp-results').count(),0,'account owner changed before response clears sensitive content');
    await page.evaluate(()=>{__mount();__api.financialPlanningPreview=async()=>{throw Error('匯率暫時無法更新，請稍後再試。');};});
    await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('匯率暫時'));
    assert.equal(await page.locator('.fp-results').isHidden(),true);assert.deepEqual(h.errors,[]);
  }finally{await h.browser.close();}
});

test('AI runs only on explicit request with planning evidence and retrieved citations; invalid or truncated replies do not appear as success',async()=>{
  const h=await fixture();try{
    const {page}=h;
    await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();
    const ai=page.getByRole('button',{name:'啟動本機 AI 並解釋',exact:true});await ai.waitFor();
    await ai.click();await page.waitForFunction(()=>document.querySelector('.fp-answer').textContent.includes('finance:budget'));
    assert.equal(await page.evaluate(()=>__aiCalls.length),1);
    assert.equal(await page.evaluate(()=>__aiCalls[0].task),'coach');
    assert.equal(await page.evaluate(()=>__aiCalls[0].context.planning.facts.gapTwd),'8000.00');
    assert.equal(await page.evaluate(()=>__aiCalls[0].context.knowledge.items[0].id),'finance:budget');
    assert.equal(await page.evaluate(()=>__creates.length),0);
    await page.evaluate(()=>{__answer='保證達成。[invented:source]';});await ai.click();
    await page.waitForFunction(()=>document.querySelector('.fp-results').textContent.includes('引用尚未通過核對'));
    assert.equal(await page.locator('.fp-answer').innerText(),'');
    await page.evaluate(()=>{LocalAI.generate=async()=>({text:'部分解釋[finance:budget]',finishReason:'length'});});await ai.click();
    await page.waitForFunction(()=>document.querySelector('.fp-results').textContent.includes('尚未生成完整'));
    assert.equal(await page.locator('.fp-answer').innerText(),'');assert.deepEqual(h.errors,[]);
  }finally{await h.browser.close();}
});

test('creating a goal requires confirmation, starts at zero and cannot be repeated after an uncertain network result',async()=>{
  const h=await fixture();try{
    const {page}=h;
    await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();
    const create=page.getByRole('button',{name:'建立存錢筒',exact:true});await create.waitFor();
    assert.equal(await create.isDisabled(),true);assert.equal(await page.evaluate(()=>__creates.length),0);
    await page.locator('[data-fp-confirm=goal]').check();await page.locator('[name=goalName]').fill('親子旅行');
    assert.equal(await create.isDisabled(),true,'name change requires confirmation again');
    await page.locator('[data-fp-confirm=goal]').check();await create.click();
    await page.waitForFunction(()=>document.querySelector('.fp-results').textContent.includes('示範目標已建立'));
    assert.deepEqual(await page.evaluate(()=>__creates),[{name:'親子旅行',targetAmount:10000,savedAmount:0,shape:'pig'}]);
    assert.equal(await create.isDisabled(),true);
    await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();
    await page.evaluate(()=>{__createFail=true;});await page.locator('[data-fp-confirm=goal]').check();await create.click();
    await page.waitForFunction(()=>document.querySelector('.fp-results').textContent.includes('建立結果尚未確認'));
    assert.equal(await create.isDisabled(),true,'uncertain create is not immediately retried');assert.equal(await page.locator('[data-fp-confirm=goal]').isDisabled(),true);
    assert.deepEqual(h.errors,[]);assert.deepEqual(h.requests,[]);
  }finally{await h.browser.close();}
});
