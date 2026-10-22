/* Isolated real-HTML integration. Mock storage and invitation replies are fixtures,
 * never real accounts, mail, production writes, model inference or quality proof. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
async function fixture(t){
 const server=http.createServer((req,res)=>{const route=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(route==='/'?'/index.html':route));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Taipei',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{localStorage.setItem('fambudget.tour','done');localStorage.setItem('fambudget.language','zh-TW');window.__FAMBUDGET_TODAY__='2026-10-22';});
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==base)return route.abort();if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{detail:'Isolated UI: no backend or model'}});return route.continue();});
 await page.goto(base+'/?api=#/login');await page.waitForFunction(()=>window.API&&window.ActivityInvites&&window.TransactionArchive);await page.evaluate(()=>I18n.ready);
 await page.evaluate(async()=>{await API.register({name:'活動驗收',email:'activity.ui.fixture@example.test',password:'Fixture-password-9!'});await API.updateProfile({onboarded:true});location.hash='#/';});
 await page.reload();await page.locator('[data-personal-details]').waitFor();
 assert.equal(await page.evaluate(()=>typeof window.VoiceAccessibility),'undefined','Cancelled voice features are not loaded');
 assert.equal(await page.locator('[data-voice-root],[data-voice-settings]').count(),0,'No microphone launcher or voice settings remain');
 return{page,errors,base};
}

test('real HTML keeps private details on dashboard, activity-only selection, month details and current-device login',async t=>{
 const {page,errors}=await fixture(t);await page.locator('.gsw__empty').waitFor();assert.match(await page.locator('.gsw__empty').innerText(),/目前尚未建立活動/);
 const activity=await page.evaluate(async()=>{await API.createGroup({name:'個人帳本',kind:'standing'});const g=await API.createGroup({name:'測試旅行活動',kind:'standing'});await API.createTransaction({date:'2025-12-15',amount:65,kind:'expense',cat:'C01',merchant:'Archive shop',note:'資料夾驗收',groupId:g.id});location.hash='#/groups';return g;});
 await page.reload();await page.locator('#gswBtn').waitFor();await page.locator('#gswBtn').click();assert.equal(await page.locator('#gswPanel [data-group="all"]').count(),0);assert.equal(await page.locator('#gswPanel [data-group]').count(),1);assert.match(await page.locator('#gswPanel').innerText(),/測試旅行活動/);assert.equal((await page.locator('#gswPanel').innerText()).includes('個人帳本'),false);
 await page.locator('#gswPanel [data-group="'+activity.id+'"]').click();await page.evaluate(()=>{location.hash='#/';});await page.locator('[data-personal-details]').waitFor();await page.locator('[data-personal-details]').click();await page.locator('#txArchive [data-archive-month="2025-12"]').waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('fambudget.group')),'all');assert.match(await page.locator('#ptitle').innerText(),/收支明細/);await page.locator('#txList').getByText('Archive shop',{exact:true}).waitFor();assert.match(await page.locator('#txList').innerText(),/測試旅行活動/);
 assert.equal(await page.locator('#pickToggle').count(),1,'Original multi-select control remains');assert.ok(await page.locator('#txList [data-transaction-photo]').count()>0,'Original private photo action remains');
 const noteRow=page.locator('#txList .txr').first();
 assert.equal(await noteRow.locator('td').last().getAttribute('class'),'txr__note');assert.equal(await noteRow.locator('td').last().innerText(),'資料夾驗收');
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.equal(await noteRow.locator('.txr__note-mobile').isVisible(),width<=700);assert.equal(await noteRow.locator('.txr__note').isVisible(),width>700);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Notes fit '+width);}
 await page.locator('.entry-access [data-receipt-entry]').click();await page.locator('.receipt-dialog').waitFor();assert.equal(await page.locator('[data-receipt-file="camera"]').getAttribute('capture'),'environment');await page.locator('[data-receipt-action="close"]').click();
 await page.locator('[data-paragraph-entry]').click();await page.locator('#paraText').fill('朋友威力彩中了200元');await page.locator('#paraGo').click();await page.locator('.btbl__r').waitFor();assert.equal(await page.locator('[data-b="kind"]').inputValue(),'');assert.equal(await page.locator('[data-b="cat"]').inputValue(),'');assert.equal(await page.locator('#paraSave').isDisabled(),true);
 await page.locator('[data-b="kind"]').selectOption('income');await page.locator('[data-b="cat"]').selectOption('I04');assert.equal(await page.locator('#paraSave').isDisabled(),false,'Only an explicit manual choice permits confirmation');
 await page.evaluate(()=>{location.hash='#/profile';});await page.locator('#logoutAll').waitFor();assert.equal(await page.locator('#sessBox .sess__i').count(),0);assert.match(await page.locator('#sessBox').innerText(),/目前沒有其他登入中的裝置/);const user=await page.evaluate(async()=>(await API.me()).user.id);await page.locator('#logoutAll').click();await page.waitForFunction(()=>!document.querySelector('#logoutAll')?.disabled);assert.equal(await page.evaluate(async()=>(await API.me()).user.id),user);assert.equal(new URL(page.url()).hash,'#/profile');
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Profile fits '+width);}
 assert.deepEqual(errors,[]);
});

test('actual activity panels invite by account or single-use code without a family-join action',async t=>{
 const {page,errors}=await fixture(t);const activity=await page.evaluate(async()=>{
  const g=await API.createGroup({name:'朋友旅行',kind:'standing'});window.__activityCalls=[];window.__sent=[];
  API.receivedGroupInvites=async()=>({received:[{id:'received-fixture',groupName:'朋友活動',inviterName:'其他家庭朋友',status:'pending',expiresAt:'2026-11-01T00:00:00Z'}]});
  API.groupInvites=async groupId=>({sent:__sent});
  API.lookupGroupUser=async p=>{__activityCalls.push(['lookup',p]);return{user:{id:'outside-family',name:'外部朋友 <img src=x>'},status:'available'};};
  API.inviteGroupMember=async(gid,uid)=>{__activityCalls.push(['invite',gid,uid]);__sent=[{id:'sent-fixture',inviteeName:'外部朋友',isCode:false,status:'pending',expiresAt:'2026-11-01T00:00:00Z'}];return{id:'sent-fixture',status:'pending'};};
  API.createGroupInviteCode=async(gid,p)=>{__activityCalls.push(['code',gid,p]);return{id:'code-fixture',code:'FIXTURE-ONLY-CODE',expiresAt:'2026-11-01T00:00:00Z',status:'pending'};};
  API.cancelGroupInvite=async(gid,id)=>{__activityCalls.push(['cancel',gid,id]);__sent=[];return{id,status:'cancelled'};};
  API.acceptGroupInvite=async id=>{__activityCalls.push(['accept',id]);return{group:g,status:'accepted'};};
  API.joinGroup=async code=>{__activityCalls.push(['join',code]);return{group:g,status:'accepted'};};
  API.joinFamily=async()=>{throw Error('Activity invitation must never join a family');};location.hash='#/groups';return g;
 });
 await page.locator('[data-lg="'+activity.id+'"]').click();const owner=page.locator('[data-activity-invite-owner="'+activity.id+'"]');await owner.locator('.activity-invite-search input').fill('outside.fixture@example.test');await owner.locator('.activity-invite-search button').click();await owner.locator('.activity-found button').click();await owner.locator('.activity-pending-row').waitFor();assert.equal(await owner.locator('.activity-found img').count(),0);
 await owner.locator('.activity-code-form button').click();await owner.locator('.activity-code').waitFor();assert.equal(await owner.locator('.activity-code').inputValue(),'FIXTURE-ONLY-CODE');const calls=await page.evaluate(()=>__activityCalls);assert.deepEqual(calls[0],['lookup',{groupId:activity.id,email:'outside.fixture@example.test'}]);assert.deepEqual(calls[1],['invite',activity.id,'outside-family']);assert.ok(calls.find(r=>r[0]==='code')[2].label.length>0,'Optional code label has a valid default');
 await owner.locator('.activity-pending-row button').click();await page.waitForFunction(()=>__activityCalls.some(r=>r[0]==='cancel'));
 const received=page.locator('#activityInvitations');await received.locator('.activity-invitation button').first().click();await page.waitForFunction(()=>__activityCalls.some(r=>r[0]==='accept'));await page.locator('#activityInvitations .activity-join input').fill('FRIEND-CODE');await page.locator('#activityInvitations .activity-join button').click();await page.waitForFunction(()=>__activityCalls.some(r=>r[0]==='join'));
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Activity screen fits '+width);}
 assert.deepEqual(errors,[]);
});
