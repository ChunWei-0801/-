/* Actual index.html/router/modules with isolated browser accounts and synthetic
 * service replies. No production database, external FX or real model is used. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
let pw;try{pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');}catch(_){}
const engineName=process.env.FAMBUDGET_TEST_BROWSER||'chromium',mobile=process.env.FAMBUDGET_TEST_DEVICE!=='desktop';

function evidence(){return {version:1,currency:'TWD',generatedAt:'2026-10-29T00:00:00Z',input:{targetAmount:'10000',targetCurrency:'TWD',savedTwd:'2000',deadline:'2027-02-28',question:'家庭旅行'},facts:{targetTwd:'10000',savedTwd:'2000',gapTwd:'8000',requiredMonthlyTwd:'2000',contributionMonths:4,weeklyAllowanceReserveTwd:'800',availableMonthlyTwd:'5200',recordedMonthlyNetTwd:'6000',capacitySource:'ledger',transactionCount:20},quote:null,plans:[{id:'deadline',title:'維持原期限',monthlyTwd:'2000',months:4,deadline:'2027-02-28',feasible:true,description:'依虛構投入假設安排。',evidenceIds:['planning:facts']},{id:'comfortable',title:'延長期限再試算',monthlyTwd:'1000',months:8,deadline:null,feasible:null,description:'延長方案仍需重新試算。',evidenceIds:['planning:facts']}],knowledge:{query:'家庭旅行',method:'bm25',items:[{id:'finance:budget-basics',title:'先整理收支，再安排家庭預算',text:'請先確認必要生活支出，再安排旅行目標。',sourceLink:'https://consumer.gov/your-money/making-budget',reviewedAt:'2026-10-29',sourcePublishedAt:null,license:'專題自行撰寫的合成測試摘要',score:1}],totalMatches:1,truncated:false},sources:[{id:'planning:facts',title:'虛構帳務試算',link:'#facts'},{id:'finance:budget-basics',title:'預算教育參考',link:'https://consumer.gov/your-money/making-budget'}],warnings:[],dataPolicy:{readOnly:true,inferencePerformed:false}};}

async function fixture(t){
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;let browser;
 try{browser=await pw[engineName].launch({headless:true,...(engineName==='chromium'?{executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']}:{})});}catch(error){await new Promise(resolve=>server.close(resolve));throw error;}
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const device=mobile?(engineName==='chromium'?pw.devices['Pixel 7']:engineName==='webkit'?pw.devices['iPhone 13']:{viewport:{width:390,height:844}}):{viewport:{width:1280,height:900}};
 const context=await browser.newContext({...device,timezoneId:'Asia/Taipei',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await context.addInitScript(()=>{localStorage.setItem('fambudget.tour','done');localStorage.setItem('fambudget.language','zh-TW');window.__FAMBUDGET_TODAY__='2026-10-29';});
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base)return route.abort();if(u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{detail:'Isolated integration fixture'}});return route.continue();});
 await page.goto(base+'/?api=#/login');await page.waitForFunction(()=>window.API&&window.I18n&&window.FinancialPlanning&&window.AllowanceSimulation);await page.evaluate(()=>I18n.ready);
 const loginDemoLink=await page.locator('#view a[href="demo.html"]').count();
 await page.evaluate(async synthetic=>{
  await API.register({name:'整合測試家長',email:'teacher-integration@example.test',password:'Fixture-password-9!'});await API.updateProfile({onboarded:true});
  const me=(await API.me()).user;window.__integrationUser=me;window.__integrationEvidence=synthetic;
  window.__integrationCalls={preview:[],jars:[],issue:[],preferences:[]};window.__integrationHistory=[];
  window.__integrationPrefs={birthDate:null,timezone:'Asia/Taipei',smokingEnabled:false,calculatorEnabled:false,shortcuts:[],customHabits:[],hiddenHabitIds:[]};
  API.mode='http';API.request=async function(route,options){if(route==='/api/lifestyle/preferences'){if(options&&options.method==='PUT'){__integrationCalls.preferences.push(structuredClone(options.body));Object.assign(__integrationPrefs,structuredClone(options.body));}return structuredClone(__integrationPrefs);}throw Object.assign(Error('Isolated integration fixture'),{status:503});};
  API.financialPlanningPreview=async function(body){__integrationCalls.preview.push(structuredClone(body));if(window.__holdIntegrationPreview)return new Promise(resolve=>{window.__releaseIntegrationPreview=()=>resolve(structuredClone(__integrationEvidence));});return structuredClone(__integrationEvidence);};
  API.createSavingsJar=async function(body){__integrationCalls.jars.push(structuredClone(body));return {id:'isolated-jar',...body};};
  API.allowanceSimulation=async function(){return {simulation:true,recipients:[{id:'isolated-child',name:'整合測試孩子'}],items:structuredClone(__integrationHistory),truncated:false,nextBeforeId:null};};
  API.issueAllowanceSimulation=async function(body){__integrationCalls.issue.push(structuredClone(body));const item={id:'isolated-allowance',guardianId:String(me.id),wardId:body.wardId,guardianName:me.name||'整合測試家長',wardName:'整合測試孩子',amount:String(body.amount),note:body.note,createdAt:'2026-10-29T00:00:00Z'};__integrationHistory.unshift(item);return {simulation:true,item:structuredClone(item),replayed:false};};
  window.LocalAI={generate:async()=>{throw Error('A real model must not start in this integration fixture');},status:()=>({loaded:false,busy:false})};
  await LifeFeatures.setAccount(null);await LifeFeatures.setAccount(me);location.hash='#/';
 },evidence());
 await page.locator('#view [data-nav="financial-planning"]').waitFor();await page.locator('#view [data-nav="allowance-simulation"]').waitFor();
 return {page,errors,base,loginDemoLink};
}

test('actual application exposes planning and requires confirmation before creating a savings goal',{skip:!pw},async t=>{
 const {page,errors,loginDemoLink}=await fixture(t);assert.equal(loginDemoLink,1);
 await page.locator('#view [data-nav="financial-planning"]').click();await page.locator('[data-fp-field="targetAmount"]').waitFor();
 await page.locator('[data-fp-field="targetCurrency"]').selectOption('TWD');await page.locator('[data-fp-field="targetAmount"]').fill('10000');
 await page.locator('[data-fp-action="preview"]').click();await page.locator('.fp-results').waitFor({state:'visible'});
 assert.match(await page.locator('.fp-results').innerText(),/程式試算/);assert.equal(await page.locator('.fp-sources a').count(),1);
 assert.equal(await page.locator('[data-fp-action="create-goal"]').isDisabled(),true);assert.equal(await page.evaluate(()=>__integrationCalls.jars.length),0);
 await page.locator('[data-fp-confirm="goal"]').check();await page.locator('[data-fp-action="create-goal"]').click();await page.waitForFunction(()=>__integrationCalls.jars.length===1);
 const calls=await page.evaluate(()=>({preview:__integrationCalls.preview,jars:__integrationCalls.jars,routes:[API.routes.financialPlanningPreview[0],API.routes.issueAllowanceSimulation[0]]}));
 assert.equal(calls.preview[0].targetCurrency,'TWD');assert.equal(calls.jars[0].targetAmount,10000);assert.equal(calls.jars[0].savedAmount,0);
 assert.deepEqual(calls.routes,['POST /api/financial-planning/preview','POST /api/allowance-simulation']);
 await page.evaluate(()=>{location.hash='#/';});await page.locator('#view [data-nav="allowance-simulation"]').waitFor();assert.equal(await page.locator('.fp-results').count(),0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
});

test('actual allowance route confirms one simulated issuance and a late planner reply cannot replace the signed-out screen',{skip:!pw},async t=>{
 const {page,errors}=await fixture(t);
 await page.locator('#view [data-nav="allowance-simulation"]').click();await page.locator('.allowance-sim__form').waitFor();
 await page.locator('.allowance-sim__form [name="amount"]').fill('200');await page.locator('.allowance-sim__form [name="note"]').fill('虛構用途');
 await page.locator('[data-allowance-action="preview"]').click();assert.equal(await page.evaluate(()=>__integrationCalls.issue.length),0);
 await page.locator('[data-allowance-action="confirm"]').click();await page.locator('.allowance-sim__record').waitFor();
 const issued=await page.evaluate(()=>__integrationCalls.issue);assert.equal(issued.length,1);assert.equal(issued[0].wardId,'isolated-child');assert.equal(Number(issued[0].amount),200);assert.match(issued[0].idempotencyKey,/^[0-9a-f-]{36}$/i);
 assert.match(await page.locator('.allowance-sim').innerText(),/未發生銀行轉帳/);
 await page.evaluate(()=>{location.hash='#/financial-planning';});await page.locator('[data-fp-action="preview"]').waitFor();await page.evaluate(()=>{__holdIntegrationPreview=true;});
 await page.locator('[data-fp-action="preview"]').click();await page.waitForFunction(()=>typeof __releaseIntegrationPreview==='function');
 await page.evaluate(async()=>{await API.logout();location.hash='#/login';});await page.locator('#loginF').waitFor();await page.evaluate(()=>__releaseIntegrationPreview());
 await page.waitForFunction(()=>document.querySelector('#loginF')&&!document.querySelector('.fp-results'));assert.equal(await page.locator('.allowance-sim__record').count(),0);assert.deepEqual(errors,[]);
});

test('new shortcuts are included in the complete 22-item visibility preference and the settings expose the trial entry',{skip:!pw},async t=>{
 const {page,errors}=await fixture(t);
 await page.evaluate(()=>{location.hash='#/settings';});await page.locator('#view [data-life-shortcuts]').waitFor();assert.equal(await page.locator('#view a.settings-link[href="demo.html"]').count(),1);
 await page.locator('#view [data-life-shortcuts]').click();await page.locator('.life-dialog [data-life-list]').waitFor();assert.equal(await page.locator('.life-dialog [data-visible]').count(),22);
 await page.locator('.life-dialog').getByLabel('家庭理財規劃',{exact:true}).uncheck();await page.locator('.life-dialog [data-life-save]').click();await page.waitForFunction(()=>__integrationCalls.preferences.length===1);
 const rows=await page.evaluate(()=>__integrationCalls.preferences[0].shortcuts);assert.equal(rows.length,22);assert.equal(new Set(rows.map(r=>r.id)).size,22);
 assert.equal(rows.find(r=>r.id==='financial-planning').visible,false);assert.equal(rows.find(r=>r.id==='allowance-simulation').visible,true);
 await page.evaluate(()=>{location.hash='#/';});await page.locator('#view [data-nav="allowance-simulation"]').waitFor();assert.equal(await page.locator('#view [data-nav="financial-planning"]').count(),0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
});
