/* Real DOM and pointer/keyboard tests. Private-photo fixtures and browser-local
 * numeric puzzle state only; never creates accounts or contacts production. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const engine=process.env.FAMBUDGET_TEST_BROWSER||'chromium',mobile=process.env.FAMBUDGET_TEST_DEVICE!=='desktop';
const frontend=path.resolve(__dirname,'..');
async function fixture(t,n=9){
 const browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']}:{})});
 t.after(()=>browser.close());
 const context=await browser.newContext({...(!mobile?{viewport:{width:1280,height:900}}:engine==='chromium'?playwright.devices['Pixel 7']:engine==='webkit'?playwright.devices['iPhone 13']:{viewport:{width:390,height:844}}),reducedMotion:'reduce'});
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(8000);
 await page.route('**/*',route=>{if(route.request().url()==='http://jigsaw-fixture.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-TW" data-theme="paper"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="view"></main></body></html>'});requests.push(route.request().url());return route.abort();});
 await page.goto('http://jigsaw-fixture.test/');
 async function install(){
  for(const file of ['tokens','app','memories'])await page.addStyleTag({path:path.join(frontend,'css',file+'.css')});
  await page.addStyleTag({content:'body{margin:0;display:block;padding:12px}#view{max-width:960px;margin:auto;min-width:0}.standalone{max-width:480px}'});
  await page.evaluate(()=>{
   const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   window.__jigsaw={owner:'owner',events:[],calls:[],urls:[],state:null};
   window.LifeFeatures={user:()=>({id:__jigsaw.owner})};
   window.I18n={language:()=>document.documentElement.lang,t:(_,fallback)=>fallback};
   window.MediaTools={esc:escape,t:(_,fallback)=>fallback,message:error=>error.message,imageURL:async()=>{const url=URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><rect width="90" height="90" fill="#176b68"/><path d="M0 90L90 0M0 0L90 90" stroke="gold" stroke-width="8"/></svg>'],{type:'image/svg+xml'}));__jigsaw.urls.push(url);return url;},json:async route=>{__jigsaw.calls.push(route);if(route==='/api/memories')return JSON.parse(JSON.stringify(__jigsaw.state));if(route.startsWith('/api/memories/achievements?'))return{achievements:[__jigsaw.state.current],years:[2026],page:1,pageSize:50,total:1};throw Error('Unexpected mutation '+route);}};
   window.__mount=async(n=9,owner='owner',game='puzzle-1')=>{if(window.__board)__board.dispose();document.querySelector('#view').innerHTML='<section class="standalone"><div id="board"></div></section>';__jigsaw.owner=owner;const url=await MediaTools.imageURL();window.__board=MemoriesJigsaw.mount(document.querySelector('#board'),{owner,gameId:game,pieceCount:n,imageURL:url,isCurrent:()=>__jigsaw.owner===owner,onState:s=>__jigsaw.events.push(s)});};
  });
  await page.addScriptTag({path:path.join(frontend,'js/memories-jigsaw.js')});
 }
 await install();await page.evaluate(n=>__mount(n),n);
 t.after(()=>assert.deepEqual(errors,[]));t.after(()=>assert.deepEqual(requests,[]));
 return{page,context,errors,install};
}
async function order(page){return page.locator('[data-jigsaw-position]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.jigsawPiece)));}
async function solve(page){for(let i=0;i<100;i++){const a=await order(page),bad=a.findIndex((piece,pos)=>piece!==pos);if(bad<0)return;const target=a.indexOf(bad);await page.locator('[data-jigsaw-position="'+bad+'"]').click();await page.locator('[data-jigsaw-position="'+target+'"]').click();}throw Error('Could not solve fixture');}
async function swap(page,a,b){await page.locator('[data-jigsaw-position="'+a+'"]').click();await page.locator('[data-jigsaw-position="'+b+'"]').click();}

test('completed collection starts shuffled; keyboard swap, undo, reference and cancel keep the picture intact',async t=>{
 const {page}=await fixture(t);const first=await order(page);
 assert.deepEqual([...first].sort((a,b)=>a-b),[0,1,2,3,4,5,6,7,8]);assert.notDeepEqual(first,[0,1,2,3,4,5,6,7,8]);
 await page.locator('[data-jigsaw-position="0"]').focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 const changed=await order(page);assert.equal(changed[0],first[1]);assert.equal(changed[1],first[0]);assert.match(await page.locator('[data-jigsaw-summary]').innerText(),/交換次數 1/);
 await page.locator('[data-jigsaw-action="undo"]').click();assert.deepEqual(await order(page),first);assert.match(await page.locator('[data-jigsaw-summary]').innerText(),/交換次數 0/);
 await page.locator('[data-jigsaw-action="reference"]').click();assert.equal(await page.locator('.memories-jigsaw__reference').isVisible(),true);assert.equal(await page.locator('[data-jigsaw-board]').isVisible(),false);
 await page.keyboard.press('Escape');assert.equal(await page.locator('[data-jigsaw-board]').isVisible(),true);assert.deepEqual(await order(page),first);
 await page.locator('[data-jigsaw-action="shuffle"]').click();await page.locator('[data-jigsaw-action="cancel"]').click();assert.deepEqual(await order(page),first);
 await page.locator('[data-jigsaw-position="1"]').click();await page.keyboard.press('Escape');assert.equal(await page.locator('[aria-pressed="true"]').count(),0);
});
test('tile order persists through a real reload; local storage contains numeric progress and no private photo',async t=>{
 const {page,install}=await fixture(t);await swap(page,0,1);const saved=await order(page);
 const records=await page.evaluate(()=>Object.entries(localStorage));assert.equal(records.length,1);const state=JSON.parse(records[0][1]);assert.deepEqual(Object.keys(state).sort(),['moves','n','order','v']);assert.equal(state.moves,1);assert.equal(/blob:|image|svg|base64/.test(records[0][1]),false);
 await page.reload();await install();await page.evaluate(()=>__mount());assert.deepEqual(await order(page),saved);assert.match(await page.locator('[data-jigsaw-summary]').innerText(),/交換次數 1/);
 await solve(page);assert.match(await page.locator('[data-jigsaw-notice]').innerText(),/拼好了/);const completed=await order(page);
 await page.reload();await install();await page.evaluate(()=>__mount());assert.deepEqual(await order(page),completed);assert.match(await page.locator('[data-jigsaw-notice]').innerText(),/拼好了/);
});
test('accounts and puzzle IDs are isolated; stale owner and corrupt saved permutations cannot change progress',async t=>{
 const {page}=await fixture(t);await swap(page,0,1);const ownerState=await order(page);
 await page.evaluate(()=>__mount(9,'other','puzzle-1'));await swap(page,0,1);
 const keys=await page.evaluate(()=>Object.keys(localStorage));assert.equal(keys.length,2);
 await page.evaluate(()=>__mount(9,'owner','puzzle-2'));assert.equal((await page.evaluate(()=>Object.keys(localStorage))).length,3);
 await page.evaluate(()=>__mount(9,'owner','puzzle-1'));assert.deepEqual(await order(page),ownerState);
 const old=await page.evaluate(()=>localStorage.getItem('fambudget.jigsaw.v1.owner.puzzle-1'));await page.evaluate(()=>{__jigsaw.owner='someone-else';});await swap(page,0,1);assert.equal(await page.evaluate(()=>localStorage.getItem('fambudget.jigsaw.v1.owner.puzzle-1')),old);
 await page.evaluate(()=>{localStorage.setItem('fambudget.jigsaw.v1.owner.corrupt',JSON.stringify({v:1,n:9,order:[0,0,0,0,0,0,0,0,0],moves:0}));return __mount(9,'owner','corrupt');});
 assert.equal(new Set(await order(page)).size,9);assert.notDeepEqual(await order(page),[0,1,2,3,4,5,6,7,8]);
});
test('pointer dragging exchanges exactly two pieces for mouse and touch',async t=>{
 const {page}=await fixture(t);const initial=await order(page),a=await page.locator('[data-jigsaw-position="0"]').boundingBox(),b=await page.locator('[data-jigsaw-position="1"]').boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:7});await page.mouse.up();
 let changed=await order(page);assert.equal(changed[0],initial[1]);assert.equal(changed[1],initial[0]);assert.match(await page.locator('[data-jigsaw-summary]').innerText(),/交換次數 1/);
 const before=changed;
 await page.evaluate(()=>{
  const a=document.querySelector('[data-jigsaw-position="1"]'),b=document.querySelector('[data-jigsaw-position="2"]'),ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect(),base={bubbles:true,pointerId:75,pointerType:'touch',isPrimary:true,button:0};
  a.dispatchEvent(new PointerEvent('pointerdown',{...base,clientX:ra.x+ra.width/2,clientY:ra.y+ra.height/2}));
  a.dispatchEvent(new PointerEvent('pointermove',{...base,clientX:rb.x+rb.width/2,clientY:rb.y+rb.height/2}));
  a.dispatchEvent(new PointerEvent('pointerup',{...base,clientX:rb.x+rb.width/2,clientY:rb.y+rb.height/2}));
 });
 changed=await order(page);assert.equal(changed[1],before[2]);assert.equal(changed[2],before[1]);assert.match(await page.locator('[data-jigsaw-summary]').innerText(),/交換次數 2/);
 await page.locator('[data-jigsaw-action="undo"]').click();assert.deepEqual(await order(page),before);
 await page.evaluate(()=>{
  const a=document.querySelector('[data-jigsaw-position="0"]'),b=document.querySelector('[data-jigsaw-position="1"]'),ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect(),base={bubbles:true,pointerId:90,pointerType:'touch',isPrimary:true,button:0};
  a.dispatchEvent(new PointerEvent('pointerdown',{...base,clientX:ra.x+ra.width/2,clientY:ra.y+ra.height/2}));
  a.dispatchEvent(new PointerEvent('pointermove',{...base,clientX:rb.x+rb.width/2,clientY:rb.y+rb.height/2}));
  a.dispatchEvent(new PointerEvent('pointercancel',base));
  a.dispatchEvent(new PointerEvent('pointerup',{...base,clientX:rb.x+rb.width/2,clientY:rb.y+rb.height/2}));
 });
 assert.deepEqual(await order(page),before,'A cancelled drag does not exchange pieces');assert.equal(await page.locator('.is-dragging,.is-drop-target').count(),0);
 if(mobile&&engine==='chromium'){
  const session=await page.context().newCDPSession(page),from=await page.locator('[data-jigsaw-position="0"]').boundingBox(),to=await page.locator('[data-jigsaw-position="1"]').boundingBox();
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x+from.width/2,y:from.y+from.height/2,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:to.x+to.width/2,y:to.y+to.height/2,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.querySelector('[data-jigsaw-summary]').textContent.includes('交換次數 2'));
  const nativeTouch=await order(page);assert.equal(nativeTouch[0],before[1]);assert.equal(nativeTouch[1],before[0]);
  await session.detach();
 }
});
test('a completed current puzzle locks the next photo until rearranged; archive and server data remain untouched',async t=>{
 const {page}=await fixture(t);
 await page.addScriptTag({path:path.join(frontend,'js/memories.js')});
 await page.evaluate(async()=>{
  __board.dispose();localStorage.clear();
  __jigsaw.state={settings:{wallName:'原有成就',pieceCount:9,period:'month',timezone:'Asia/Taipei',changesPerPeriod:2,wallBackgroundUrl:null},current:{id:'collected',pieceCount:9,earnedPieces:9,completed:true,imageUrl:'/private/puzzle',createdAt:'2026-10-01T00:00:00Z',completedAt:'2026-10-28T00:00:00Z',year:2026,month:10,timezone:'Asia/Taipei'},creditsAvailable:3,period:{remaining:1,timezone:'Asia/Taipei'}};
  await Memories.render(document.querySelector('#view'),{id:'owner'});
 });
 await page.locator('[data-jigsaw-board]').waitFor();await page.locator('.memories-achievement img').waitFor();
 assert.equal(await page.locator('[data-mem-file]').isDisabled(),true);assert.match(await page.locator('[data-mem-jigsaw-lock]').innerText(),/先把這張圖片拼回原圖/);
 assert.equal(await page.locator('.memories-achievement').count(),1);assert.equal(await page.locator('.memories-tile.is-earned').count(),9,'Server earned pieces remain intact behind challenge');
 await solve(page);assert.equal(await page.locator('[data-mem-file]').isDisabled(),false);
 await page.locator('[data-mem-refresh]').click();await page.locator('[data-jigsaw-board]').waitFor();assert.equal(await page.locator('[data-mem-file]').isDisabled(),false,'Refresh retains the solved stage');
 await page.locator('[data-jigsaw-action="shuffle"]').click();await page.locator('[data-jigsaw-action="confirm"]').click();assert.equal(await page.locator('[data-mem-file]').isDisabled(),true);
 assert.equal(await page.locator('.memories-achievement').count(),1);assert.equal(await page.evaluate(()=>__jigsaw.state.current.earnedPieces),9);assert.equal(await page.evaluate(()=>__jigsaw.state.current.completed),true);assert.equal(await page.evaluate(()=>__jigsaw.calls.some(path=>!path.startsWith('/api/memories'))),false);
 await page.evaluate(()=>Memories.dispose());assert.equal(await page.locator('[data-jigsaw-position]').count(),0);
});
test('all supported sizes fit small screens; blocked storage, reduced motion and six languages stay usable',async t=>{
 const {page}=await fixture(t);
 for(const n of [9,16,25,36,64,100]){
  await page.evaluate(n=>__mount(n),n);
  assert.equal(await page.locator('[data-jigsaw-position]').count(),n);
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'No page overflow for '+n+' at '+width);}
 }
 assert.ok(await page.locator('[data-jigsaw-position="0"]').evaluate(node=>getComputedStyle(node).transitionDuration.split(',').every(value=>parseFloat(value)<=.001)));
 for(const lang of ['zh-TW','zh-CN','en','ja','ko','es']){await page.evaluate(lang=>{document.documentElement.lang=lang;return __mount();},lang);assert.ok((await page.locator('.memories-jigsaw__title').innerText()).length>0);}
 await page.evaluate(()=>{document.documentElement.lang='zh-TW';Storage.prototype.setItem=function(){throw Error('blocked');};Storage.prototype.getItem=function(){throw Error('blocked');};return __mount(9,'owner','blocked-storage');});assert.match(await page.locator('.memories-jigsaw__local').innerText(),/無法保存/);await swap(page,0,1);assert.match(await page.locator('[data-jigsaw-summary]').innerText(),/交換次數 1/);
 const temporary=await order(page);await page.evaluate(()=>__mount(9,'owner','blocked-storage'));assert.deepEqual(await order(page),temporary,'An in-page refresh preserves a blocked-storage game within this session');
});
