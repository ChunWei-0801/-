/* Real standalone HTML and isolated local data; not a model-quality benchmark. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
let pw;try{pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');}catch(_){}
const engine=process.env.FAMBUDGET_TEST_BROWSER||'chromium',mobile=process.env.FAMBUDGET_TEST_DEVICE!=='desktop';
async function fixture(t,blocked=false){
 let browser;
 const root=path.resolve(__dirname,'..'),server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});const base='http://127.0.0.1:'+server.address().port;browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']}:{})});
 const device=mobile?(engine==='chromium'?pw.devices['Pixel 7']:engine==='webkit'?pw.devices['iPhone 13']:{viewport:{width:390,height:844}}):{viewport:{width:1280,height:900}},context=await browser.newContext({...device,timezoneId:'Asia/Taipei',colorScheme:'dark',reducedMotion:'reduce'}),page=await context.newPage(),errors=[],apiRequests=[],externalRequests=[];
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
 await context.addInitScript(({blocked})=>{localStorage.setItem('fambudget.auth','production-session-fixture');localStorage.setItem('fambudget.language','en');localStorage.setItem('fambudget.theme','paper');if(blocked)Storage.prototype.setItem=function(){throw new Error('Fixture storage denied');};},{blocked});
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base){externalRequests.push(u.href);return route.abort();}if(u.pathname.startsWith('/api/')){apiRequests.push(u.pathname);return route.abort();}return route.continue();});
 await page.goto(base+'/demo.html');await page.locator('[data-demo-role="demo-parent"]').waitFor();
 return{page,context,errors,apiRequests,externalRequests,base};
}
async function state(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('fambudget.demo.v187')));}
async function unchanged(page){assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key!=='fambudget.demo.v187').map(key=>[key,localStorage.getItem(key)]))),{'fambudget.auth':'production-session-fixture','fambudget.language':'en','fambudget.theme':'paper'});}
test('standalone demo seeds three months, isolates production storage and supports safe editable entries',{skip:!pw},async t=>{
 const {page,errors,apiRequests,externalRequests}=await fixture(t),initial=await state(page);assert.equal(initial.people.length,3);assert.equal(initial.transactions.length,81);assert.equal(new Set(initial.transactions.map(row=>row.date.slice(0,7))).size,3);
 const note='<img src=x onerror="window.demoXss=true">';await page.locator('#demo-amount').fill('123');await page.locator('#demo-note').fill(note);await page.getByRole('button',{name:'新增示範記帳',exact:true}).click();
 assert.equal((await state(page)).transactions.length,82);assert.equal(await page.locator('#demo-panel img').count(),0);assert.equal(await page.evaluate(()=>!!window.demoXss),false);await page.getByRole('button',{name:'編輯 '+note+' 123元',exact:true}).click();await page.locator('#demo-amount').fill('456');await page.getByRole('button',{name:'保存編輯',exact:true}).click();assert.equal((await state(page)).transactions.find(row=>row.note===note).amount,456);
 await page.getByRole('button',{name:'刪除 '+note+' 456元',exact:true}).click();assert.equal((await state(page)).transactions.length,82);await page.getByRole('button',{name:'刪除 '+note+' 456元',exact:true}).click();assert.equal((await state(page)).transactions.length,81);
 await page.locator('#demo-paragraph').fill('早餐65元，午餐120元');await page.getByRole('button',{name:'解析成示範草稿',exact:true}).click();assert.equal((await state(page)).transactions.length,81);await page.getByRole('button',{name:'確認新增這 2 筆',exact:true}).click();assert.equal((await state(page)).transactions.length,83);
 await page.reload();assert.equal((await state(page)).transactions.length,83);assert.match(await page.locator('#demo-progress').innerText(),/1 \/ 5/);await unchanged(page);assert.deepEqual(errors,[]);assert.deepEqual(apiRequests,[]);assert.deepEqual(externalRequests,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
});
test('demo invitation, month search and CSV exports operate without leaking raw notes into anonymous experience',{skip:!pw},async t=>{
 const {page,errors,apiRequests}=await fixture(t);await page.locator('[data-demo-tab="activity"]').click();await page.getByRole('button',{name:'模擬邀請朋友小晴',exact:true}).click();assert.equal((await state(page)).activities[0].memberIds.includes('demo-friend'),true);
 await page.locator('[data-demo-role="demo-friend"]').click();assert.match(await page.locator('#demo-panel').innerText(),/已加入活動/);await page.locator('[data-demo-tab="entry"]').click();await page.locator('#demo-amount').fill('80');await page.locator('#demo-note').fill('=HYPERLINK("https://example.test","private-fixture-note")');await page.locator('#demo-activity').selectOption('demo-picnic');await page.getByRole('button',{name:'新增示範記帳',exact:true}).click();
 await page.locator('[data-demo-tab="report"]').click();await page.locator('#demo-report-search').fill('private-fixture-note');assert.match(await page.locator('#demo-panel').innerText(),/符合 1 筆/);
 const csvDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下載目前篩選的 CSV',exact:true}).click();const csv=fs.readFileSync(await(await csvDownload).path(),'utf8');assert.match(csv,/"'=HYPERLINK/);assert.match(csv,/週末野餐/);assert.doesNotMatch(csv,/虛構薪資/);
 await page.locator('[data-demo-tab="feedback"]').click();await page.locator('#demo-rating').selectOption('4');await page.locator('#demo-feedback-comment').fill('sensitive-feedback-fixture');await page.getByRole('button',{name:'保存本機回饋',exact:true}).click();
 const metricDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下載匿名體驗紀錄',exact:true}).click();const metrics=fs.readFileSync(await(await metricDownload).path(),'utf8'),record=JSON.parse(metrics);assert.equal(record.completedCount,3);assert.equal(record.rating,4);for(const forbidden of ['private-fixture-note','sensitive-feedback-fixture','demo-friend','HYPERLINK','transactions','accessToken'])assert.equal(metrics.includes(forbidden),false,forbidden+' must be absent');
 await unchanged(page);assert.deepEqual(apiRequests,[]);assert.deepEqual(errors,[]);
});
test('demo planning and shared allowance records remain separate from ledger totals and reset touches only its namespace',{skip:!pw},async t=>{
 const {page,errors,apiRequests}=await fixture(t);await page.locator('[data-demo-tab="planning"]').click();await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();await page.locator('.fp-plan').first().waitFor();assert.equal(await page.locator('.fp-plan').count(),2);assert.ok(await page.locator('.fp-sources li').count()>0);assert.match(await page.locator('.fp-results').innerText(),/沒有呼叫外部匯率/);
 await page.locator('[data-fp-confirm="goal"]').check();await page.getByRole('button',{name:'建立存錢筒',exact:true}).click();await page.getByText('示範目標已建立。 未產生銀行交易。',{exact:true}).waitFor();assert.equal((await state(page)).goals.length,2);
 await page.locator('[data-demo-tab="allowance"]').click();await page.getByRole('button',{name:'核對發放內容',exact:true}).click();await page.getByRole('button',{name:'確認模擬發放',exact:true}).click();await page.locator('.allowance-sim__record').waitFor();assert.equal((await state(page)).transfers.length,1);assert.equal((await state(page)).transactions.length,81);
 await page.locator('[data-demo-role="demo-child"]').click();await page.locator('.allowance-sim__record').waitFor();assert.match(await page.locator('.allowance-sim__record').innerText(),/你收到的模擬零用錢/);assert.equal(await page.locator('.allowance-sim__form').isVisible(),false);
 await page.locator('[data-demo-role="demo-friend"]').click();assert.equal(await page.locator('.allowance-sim__record').count(),0);assert.match(await page.locator('.allowance-sim').innerText(),/還沒有模擬發放紀錄/);
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'重設示範資料',exact:true}).click();assert.equal((await state(page)).transfers.length,1);page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'重設示範資料',exact:true}).click();assert.equal((await state(page)).transfers.length,0);assert.equal((await state(page)).goals.length,1);assert.equal((await state(page)).activeUserId,'demo-parent');await unchanged(page);assert.deepEqual(apiRequests,[]);assert.deepEqual(errors,[]);
});
test('storage denial keeps demo usable in memory with an explicit persistence warning',{skip:!pw},async t=>{
 const {page,errors,apiRequests}=await fixture(t,true);await page.locator('#demo-storage-warning').waitFor();assert.match(await page.locator('#demo-storage-warning').innerText(),/重新整理或關閉後/);await page.locator('#demo-amount').fill('90');await page.locator('#demo-note').fill('暫存早餐');await page.getByRole('button',{name:'新增示範記帳',exact:true}).click();await page.getByRole('button',{name:'編輯 暫存早餐 90元',exact:true}).waitFor();await page.locator('[data-demo-role="demo-child"]').click();assert.equal(await page.getByRole('button',{name:'編輯 暫存早餐 90元',exact:true}).count(),0);await unchanged(page);assert.deepEqual(errors,[]);assert.deepEqual(apiRequests,[]);
});
test('funded demo goal still needs allowance capacity and accepts the same sixty-character jar name limit as the real feature',{skip:!pw},async t=>{
 const {page,errors}=await fixture(t);
 await page.locator('[data-demo-tab="planning"]').click();
 await page.locator('[data-fp-field="targetAmount"]').fill('10000');
 await page.locator('[data-fp-field="savedTwd"]').fill('10000');
 await page.locator('[data-fp-field="monthlyContributionTwd"]').fill('0');
 await page.locator('[data-fp-field="weeklyAllowanceTwd"]').fill('200');
 await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();
 await page.locator('.fp-plan').first().waitFor();
 assert.equal(await page.locator('.fp-plan').filter({hasText:'目前投入金額不足'}).count(),2);
 assert.doesNotMatch(await page.locator('.fp-plan').first().innerText(),/依目前假設可達成/);
 const name='長'.repeat(55);await page.locator('[data-fp-field="goalName"]').fill(name);
 await page.locator('[data-fp-confirm="goal"]').check();
 await page.getByRole('button',{name:'建立存錢筒',exact:true}).click();
 await page.getByText('示範目標已建立。 未產生銀行交易。',{exact:true}).waitFor();
 assert.ok((await state(page)).goals.some(g=>g.name===name));assert.deepEqual(errors,[]);
});
test('demo ignores a final partial month when checking monthly savings capacity',{skip:!pw},async t=>{
 const {page,errors}=await fixture(t);await page.clock.setFixedTime(new Date('2026-10-29T04:00:00Z'));
 await page.locator('[data-demo-tab="planning"]').click();
 for(const [key,value] of Object.entries({targetAmount:'8000',savedTwd:'0',monthlyContributionTwd:'2500',weeklyAllowanceTwd:'0',deadline:'2027-01-31'}))await page.locator('[data-fp-field="'+key+'"]').fill(value);
 await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();await page.locator('.fp-plan').first().waitFor();
 assert.match(await page.locator('.fp-results').innerText(),/3 期/);
 assert.match(await page.locator('.fp-plan').first().innerText(),/2,667/);
 assert.match(await page.locator('.fp-plan').first().innerText(),/目前投入金額不足/);
 assert.match(await page.locator('.fp-plan').nth(1).innerText(),/調整期限後須重新試算/);assert.deepEqual(errors,[]);
});
test('demo does not treat a monthly assumption as cash available on a same-day deadline',{skip:!pw},async t=>{
 const {page,errors}=await fixture(t);await page.clock.setFixedTime(new Date('2026-10-29T04:00:00Z'));
 await page.locator('[data-demo-tab="planning"]').click();
 for(const [key,value] of Object.entries({targetAmount:'1000',savedTwd:'0',monthlyContributionTwd:'10000',weeklyAllowanceTwd:'0',deadline:'2026-10-29'}))await page.locator('[data-fp-field="'+key+'"]').fill(value);
 await page.getByRole('button',{name:'試算並檢索資料',exact:true}).click();await page.locator('.fp-plan').first().waitFor();
 assert.match(await page.locator('.fp-results').innerText(),/不足一個完整月/);
 assert.match(await page.locator('.fp-plan').first().innerText(),/尚待補足資料/);
 assert.doesNotMatch(await page.locator('.fp-plan').first().innerText(),/依目前假設可達成/);
 assert.match(await page.locator('.fp-plan').nth(1).innerText(),/2026-11-29/);assert.deepEqual(errors,[]);
});
test('demo parsing rejects whole unsupported money expressions and a mixed batch without extracting numeric tails',{skip:!pw},async t=>{
 const {page,errors,apiRequests,externalRequests}=await fixture(t);
 for(const input of ['早餐65.5元','午餐-120元','午餐−120元','午餐+120元','午餐1e3元','午餐65~120元','午餐65至120元','早餐0元','早餐1000001元','早餐9999999999999元','早餐1,200元','午餐美元120元','午餐USD120元','早餐65元，午餐65.5元']){
  await page.locator('#demo-paragraph').fill(input);await page.getByRole('button',{name:'解析成示範草稿',exact:true}).click();
  assert.equal(await page.locator('[data-demo-action="confirm-parsed"]').count(),0,input);
  assert.equal((await state(page)).transactions.length,81,input);assert.ok(await page.locator('#demo-message').innerText(),input);
 }
 await page.locator('#demo-paragraph').fill('早餐65元，午餐120元');await page.getByRole('button',{name:'解析成示範草稿',exact:true}).click();
 await page.getByRole('button',{name:'確認新增這 2 筆',exact:true}).click();const items=(await state(page)).transactions.slice(-2);assert.deepEqual(items.map(x=>x.amount),[65,120]);
 await unchanged(page);assert.deepEqual(errors,[]);assert.deepEqual(apiRequests,[]);assert.deepEqual(externalRequests,[]);
});
test('demo rules refuse unoccurred, negated, hypothetical, other-person and unknown intents instead of inventing transactions',{skip:!pw},async t=>{
 const {page,errors}=await fixture(t);
 for(const input of ['明天預計午餐120元','如果買午餐120元','我沒有買午餐120元','午餐還沒付120元','朋友午餐120元','小明買午餐120元','別人收到薪資50000元','昨天午餐120元','午餐120元嗎？','預算120元','不明款項120元','早餐65元，朋友午餐120元']){
  await page.locator('#demo-paragraph').fill(input);await page.getByRole('button',{name:'解析成示範草稿',exact:true}).click();
  assert.equal(await page.locator('[data-demo-action="confirm-parsed"]').count(),0,input);assert.equal((await state(page)).transactions.length,81,input);
 }
 await page.locator('#demo-paragraph').fill('我今天收到薪資50000元，買便當120元');await page.getByRole('button',{name:'解析成示範草稿',exact:true}).click();await page.getByRole('button',{name:'確認新增這 2 筆',exact:true}).click();
 const items=(await state(page)).transactions.slice(-2);assert.deepEqual(items.map(x=>[x.amount,x.kind,x.category]),[[50000,'income','薪資'],[120,'expense','餐飲']]);assert.deepEqual(errors,[]);
});
test('source, date, activity and role changes invalidate a demo review; confirmation rechecks programmatic edits and can only commit once',{skip:!pw},async t=>{
 const {page,errors}=await fixture(t);
 async function parse(){await page.locator('#demo-paragraph').fill('早餐65元');await page.getByRole('button',{name:'解析成示範草稿',exact:true}).click();await page.locator('[data-demo-action="confirm-parsed"]').waitFor();}
 await parse();assert.match(await page.locator('.demo-notice').innerText(),/個人收支/);
 await page.locator('#demo-paragraph').fill('早餐999元');assert.equal(await page.locator('[data-demo-action="confirm-parsed"]').count(),0);assert.match(await page.locator('#demo-message').innerText(),/草稿已失效/);
 await parse();await page.locator('#demo-date').fill('2026-01-01');assert.equal(await page.locator('[data-demo-action="confirm-parsed"]').count(),0);
 await parse();await page.locator('#demo-activity').selectOption('demo-picnic');assert.equal(await page.locator('[data-demo-action="confirm-parsed"]').count(),0);
 await parse();assert.match(await page.locator('.demo-notice').innerText(),/週末野餐/);assert.match(await page.locator('.demo-notice').innerText(),/2026-01-01/);
 await page.evaluate(()=>{document.querySelector('#demo-paragraph').value='早餐888元';});await page.locator('[data-demo-action="confirm-parsed"]').click();assert.equal((await state(page)).transactions.length,81);assert.equal(await page.locator('[data-demo-action="confirm-parsed"]').count(),0);
 await parse();await page.evaluate(()=>{document.querySelector('#demo-activity').value='';});await page.locator('[data-demo-action="confirm-parsed"]').click();assert.equal((await state(page)).transactions.length,81);assert.equal(await page.locator('[data-demo-action="confirm-parsed"]').count(),0);
 await parse();await page.evaluate(()=>{document.querySelector('#demo-date').value='2026-01-02';});await page.locator('[data-demo-action="confirm-parsed"]').click();assert.equal((await state(page)).transactions.length,81);
 await parse();await page.locator('[data-demo-role="demo-child"]').click();assert.equal(await page.locator('[data-demo-action="confirm-parsed"]').count(),0);assert.equal((await state(page)).transactions.length,81);
 await page.locator('[data-demo-role="demo-parent"]').click();await page.locator('#demo-activity').selectOption('demo-picnic');await parse();
 await page.evaluate(()=>{const button=document.querySelector('[data-demo-action="confirm-parsed"]');button.click();button.click();});const after=await state(page);assert.equal(after.transactions.length,82);assert.equal(after.transactions.at(-1).amount,65);assert.equal(after.transactions.at(-1).activityId,'demo-picnic');assert.equal(after.transactions.at(-1).userId,'demo-parent');
 await unchanged(page);assert.deepEqual(errors,[]);
});
