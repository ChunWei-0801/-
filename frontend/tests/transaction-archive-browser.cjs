/* Isolated read-only calendar-folder UI: real Chromium, synthetic responses.
 * Does not load a model, reach production, mutate records or persist account data. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const frontend = path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(frontend,'js/transaction-archive.js'),'utf8');
const style=fs.readFileSync(path.join(frontend,'css/transaction-archive.css'),'utf8');
const month=(year,month,count,closed)=>({period:year+'-'+String(month).padStart(2,'0'),year,month,count,closed,from:year+'-'+String(month).padStart(2,'0')+'-01',to:year+'-'+String(month).padStart(2,'0')+'-'+new Date(Date.UTC(year,month,0)).getUTCDate()});
const initial={timezone:'Asia/Taipei',currentPeriod:'2026-01',asOf:'2026-01-15T12:00:00+08:00',total:409,years:[{year:2026,count:401,months:[month(2026,1,401,false)]},{year:2025,count:8,months:[month(2025,12,5,true),month(2025,11,3,true)]}]};

async function browserFixture(){
  const executablePath=process.env.CHROMIUM_EXECUTABLE || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'});
  const page=await context.newPage(), unexpected=[], errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    const request=route.request();
    if(request.url()==='http://localhost:47222/' && request.method()==='GET')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;box-sizing:border-box;font-family:Arial,sans-serif}*{box-sizing:border-box}.btn{border:1px solid #8fa894;border-radius:8px;background:white;padding:8px 10px}'+style+'</style></head><body><main id="root"></main></body></html>'});
    unexpected.push(request.url());return route.abort();
  });
  await page.goto('http://localhost:47222/');
  await page.evaluate(value=>{
    window.__index=value;window.__calls=[];window.__queries=[];window.__language='zh-TW';window.__base={userId:'all',kind:'all',source:'all',q:'',groupId:'all'};window.__now=Date.parse('2026-01-15T04:00:00Z');
    window.I18n={language:()=>window.__language};
    window.__api={transactionArchives:async filters=>{__calls.push(JSON.parse(JSON.stringify(filters)));if(window.__fail)throw Error('isolated fixture failure');return JSON.parse(JSON.stringify(__index));}};
    Storage.prototype.setItem=function(){throw Error('Account/calendar data must not be persisted');};
  },initial);
  await page.addScriptTag({content:source});
  await page.evaluate(()=>{
    window.__reload=async()=>{const query=await __controller.prepare(__base);__queries.push(query);if(query)__controller.setResult({transactions:[],total:window.__total===undefined?401:window.__total});else __controller.setResult({transactions:[],total:0});};
    window.__controller=TransactionArchive.mount(document.querySelector('#root'),{api:__api,now:()=>__now,onChange:()=>{window.__pending=__reload();}});
    __controller.setGroups([{id:'activity-a',name:'春季旅行 <img src=x onerror=alert(1)>'},{id:'activity-b',name:'讀書會'}]);
  });
  return {browser,context,page,unexpected,errors};
}

test('year/month folders retain filters, month search, activity choice and 200-row pagination without replacing transaction controls',async()=>{
  const h=await browserFixture();
  try{
    const {page}=h;
    await page.evaluate(()=>__reload());
    assert.deepEqual(await page.evaluate(()=>__queries.at(-1)),{userId:'all',kind:'all',source:'all',groupId:'all',from:'2026-01-01',to:'2026-01-31',page:1});
    assert.equal(await page.locator('[data-archive-year]').count(),2);
    assert.equal(await page.locator('[data-archive-month]').count(),3);
    assert.equal(await page.locator('[data-archive-month="2026-01"]').getAttribute('aria-pressed'),'true');
    assert.match(await page.locator('[data-archive-month="2025-12"]').textContent(),/已打包/);
    assert.match(await page.locator('[data-archive-month="2026-01"]').innerText(),/本月/);
    await page.locator('[data-archive-page="next"]').click();await page.evaluate(()=>__pending);
    assert.equal(await page.evaluate(()=>__queries.at(-1).page),2);
    await page.locator('[data-archive-page="previous"]').click();await page.evaluate(()=>__pending);
    assert.equal(await page.evaluate(()=>__queries.at(-1).page),1);
    await page.locator('[data-archive-year="2025"]>summary').click();
    await page.locator('[data-archive-month="2025-12"]').focus();await page.keyboard.press('Enter');await page.evaluate(()=>__pending);
    assert.equal(await page.evaluate(()=>__queries.at(-1).from),'2025-12-01');
    assert.equal(await page.evaluate(()=>__queries.at(-1).to),'2025-12-31');
    await page.evaluate(async()=>{__base.q='不存在的店家';__total=0;await __reload();});
    assert.equal(await page.evaluate(()=>__queries.at(-1).q),'不存在的店家');
    assert.equal(await page.evaluate(()=>__queries.at(-1).from),'2025-12-01','a no-result text search stays in the chosen month');
    assert.equal(await page.evaluate(()=>Object.hasOwn(__calls.at(-1),'q')),false,'search does not silently hide or switch calendar folders');
    await page.evaluate(async()=>{__base.from='2025-12-15';__base.to='2025-12-20';await __reload();});
    assert.equal(await page.evaluate(()=>__queries.at(-1).from),'2025-12-15','month navigation must not widen a pre-existing date filter');
    assert.equal(await page.evaluate(()=>__queries.at(-1).to),'2025-12-20');
    await page.evaluate(()=>{delete __base.from;delete __base.to;});
    await page.locator('[data-archive-activity]').selectOption('activity-a');await page.evaluate(()=>__pending);
    assert.equal(await page.evaluate(()=>__queries.at(-1).groupId),'activity-a');
    assert.equal(await page.locator('img').count(),0,'activity names are literal text');
    assert.match(await page.locator('[data-archive-activity]').innerText(),/<img/);
    for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow at '+width);}
    for(const [language,title] of [['en','Browse by year and month'],['zh-CN','按年月查看'],['ja','年月で表示'],['ko','연도와 월별 보기'],['es','Ver por año y mes']]){
      await page.evaluate(language=>{__language=language;window.dispatchEvent(new Event('fambudget:languagechange'));},language);
      assert.equal(await page.locator('.transaction-archive h2').innerText(),title);
    }
    assert.deepEqual(h.errors,[]);assert.deepEqual(h.unexpected,[]);
  }finally{await h.browser.close();}
});

test('Taipei month boundaries refresh grouping even when the browser timezone differs, and empty/error states stay honest',async()=>{
  const h=await browserFixture();
  try{
    const {page}=h;
    assert.deepEqual(await page.evaluate(()=>[
      TransactionArchive.currentPeriod(Date.parse('2025-12-31T15:59:59Z')),
      TransactionArchive.currentPeriod(Date.parse('2025-12-31T16:00:00Z')),
      TransactionArchive.currentPeriod(Date.parse('2026-02-28T15:59:59Z')),
      TransactionArchive.currentPeriod(Date.parse('2026-02-28T16:00:00Z'))
    ]),['2025-12','2026-01','2026-02','2026-03']);
    await page.evaluate(async()=>{__now=Date.parse('2026-01-31T15:59:59Z');await __reload();});
    const before=await page.evaluate(()=>__calls.length);
    await page.evaluate(()=>{__now=Date.parse('2026-01-31T16:00:00Z');__index.currentPeriod='2026-02';__index.years[0].months[0].closed=true;document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(before=>__calls.length>before,before);await page.evaluate(()=>__pending);
    assert.match(await page.locator('[data-archive-month="2026-01"]').innerText(),/已打包/,'ended month automatically changes to packed status');
    await page.evaluate(async()=>{__index={timezone:'Asia/Taipei',currentPeriod:'2026-02',asOf:'2026-02-01T00:00:00+08:00',years:[],total:0};__total=0;await __reload();});
    assert.equal(await page.evaluate(()=>__queries.at(-1)),null);assert.match(await page.locator('.transaction-archive__empty').innerText(),/沒有符合條件/);
    await page.evaluate(async()=>{__fail=true;try{await __reload();}catch(_){}});
    assert.match(await page.locator('[data-archive-status]').innerText(),/讀取失敗/);assert.equal(await page.locator('[data-archive-year]').count(),0);
    await page.evaluate(()=>{__fail=false;});await page.locator('[data-archive-retry]').click();await page.evaluate(()=>__pending);
    assert.equal(await page.locator('[data-archive-retry]').count(),0);
    const calls=await page.evaluate(()=>__calls.length);
    await page.evaluate(()=>{__controller.destroy();__controller.destroy();document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await page.evaluate(()=>__calls.length),calls,'destroy detaches automatic refresh');
    assert.deepEqual(h.errors,[]);assert.deepEqual(h.unexpected,[]);
  }finally{await h.browser.close();}
});

test('malformed month dates are rejected and page shrink returns to a reachable page',async()=>{
  const h=await browserFixture();
  try{
    const {page}=h;
    await page.evaluate(()=>__reload());
    await page.locator('[data-archive-page="next"]').click();await page.evaluate(()=>__pending);
    await page.evaluate(()=>{__total=1;__controller.setResult({transactions:[],total:1});});await page.evaluate(()=>__pending);
    assert.equal(await page.evaluate(()=>__queries.at(-1).page),1);
    await page.evaluate(async()=>{__index.years[0].months[0].to='2026-02-01';try{await __reload();}catch(_){}});
    assert.match(await page.locator('[data-archive-status]').innerText(),/讀取失敗/);assert.equal(await page.locator('[data-archive-year]').count(),0);
    assert.deepEqual(h.errors,[]);assert.deepEqual(h.unexpected,[]);
  }finally{await h.browser.close();}
});
