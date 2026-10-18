// Real API integration on an isolated local development server only.
// Requires a migrated development DB, demo mail, and frontend served together.
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.FAMBUDGET_URL || 'http://127.0.0.1:8038');
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw new Error('Lifestyle browser tests only run against an isolated local server.');
const at = route => { const value = new URL(base); value.hash = '#/' + route; return value.href; };
const email = `lifestyle.browser.${Date.now()}@example.test`, password = 'Local-lifestyle-9!';

(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},locale:'zh-TW',timezoneId:'Asia/Taipei',reducedMotion:'reduce'});
    await context.addInitScript(() => localStorage.setItem('fambudget.tour','done'));
    const page = await context.newPage(), errors = [];
    page.on('pageerror',error => errors.push(error.message));
    async function route(name, selector) { await page.evaluate(hash => { location.hash=hash; },'#/' + name); await page.locator(selector).first().waitFor(); }
    async function saved(action, suffix, method='PUT') { const response=page.waitForResponse(r => new URL(r.url()).pathname.endsWith(suffix) && r.request().method() === method); await action(); assert.equal((await response).status(),200); }
    async function fits() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),true,'Page fits the mobile viewport'); }
    await page.goto(at('login')); await page.locator('#loginF').waitFor();
    const created = await page.evaluate(async ({email,password}) => {
      const caps = await fetch('/capabilities').then(r => r.json());
      if (caps.email_delivery_mode !== 'demo') throw new Error('Synthetic test accounts require an isolated demo-mail server.');
      const response = await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'生活整合驗收',email,password})});
      const body = await response.json(); return {status:response.status,directLogin:!!body.accessToken};
    },{email,password});
    assert.deepEqual(created,{status:201,directLogin:true});
    await page.fill('#lgEmail',email); await page.fill('#lgPw',password); await page.click('#loginF button[type="submit"]');
    await page.locator('[data-su-done="skip"]').waitFor(); await page.locator('[data-su-done="skip"]').click();
    await page.locator('.dgrid').waitFor();
    const boot = await page.evaluate(async () => {
      await API.createFamily({name:'生活驗收家庭'});
      const group = await API.createGroup({name:'生活驗收帳本',kind:'standing'});
      const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
      return {today:`${parts.year}-${parts.month}-${parts.day}`,groupId:group.id,userId:(await API.me()).user.id};
    });
    const birthday = '1990' + boot.today.slice(4);
    await route('profile','[data-wellness-birth-date]');
    await page.locator('[data-wellness-birth-date]').fill(birthday);
    await saved(() => page.locator('[data-wellness-birth-form] button[type="submit"]').click(),'/api/lifestyle/preferences');
    await page.waitForFunction(date => LifeFeatures.prefs().birthDate === date,birthday);
    await route('','[data-wellness-birthday]');
    assert.match(await page.locator('[data-wellness-birthday]').innerText(),/生活整合驗收/);
    assert.equal((await page.locator('[data-wellness-birthday]').innerText()).includes('1990'),false,'Family birthday wishes do not disclose the birth year');
    await route('profile','[data-wellness-birth-date]');
    assert.equal(await page.locator('[data-wellness-birth-date]').inputValue(),birthday,'Saved birthday survives client-side navigation');
    await page.reload(); await page.locator('[data-wellness-birth-date]').waitFor();
    assert.equal(await page.locator('[data-wellness-birth-date]').inputValue(),birthday);
    console.log('PASS: complete birthday saved, restored, and celebrated on the actual current date.');

    await route('health','[data-wellness-height]');
    await page.locator('[data-wellness-height]').fill('180'); await page.locator('[data-wellness-weight]').fill('81');
    assert.equal(await page.locator('[data-wellness-bmi]').textContent(),'25.0');
    await saved(() => page.locator('[data-wellness-save]').click(),'/api/lifestyle/health/'+boot.today);
    await page.locator(`[data-wellness-record="${boot.today}"]`).waitFor();
    await page.locator('[data-wellness-chart-type]').selectOption('table');
    assert.match(await page.locator('[data-wellness-chart] table').innerText(),/25/);
    await page.locator('[data-wellness-period]').selectOption('year');
    assert.match(await page.locator('[data-wellness-report-note]').textContent(),/平均/);
    await page.locator('[data-wellness-chart-type]').selectOption('bar'); await page.locator('[data-wellness-chart] .report-chart__bar').first().waitFor();
    await page.reload(); await page.locator(`[data-wellness-record="${boot.today}"]`).waitFor();
    assert.match(await page.locator('[data-wellness-summary]').innerText(),/25/); await fits();
    console.log('PASS: 180 cm / 81 kg gives BMI 25; day record and monthly/yearly charts survive reload.');

    await route('savings-game','[data-sg-form]');
    await page.locator('[data-sg-form] [name="name"]').fill('我的恐龍旅行願望');
    await page.locator('[data-sg-form] [name="targetAmount"]').fill('2000');
    await page.locator('[data-sg-form] [name="savedAmount"]').fill('500');
    await saved(() => page.locator('[data-sg-form] button[type="submit"]').click(),'/api/lifestyle/jar');
    await saved(() => page.locator('[data-sg-shape="dinosaur"]').click(),'/api/lifestyle/jar');
    assert.equal(await page.locator('[data-sg-percent]').textContent(),'25%');
    const photo = await page.evaluate(() => { const canvas=document.createElement('canvas');canvas.width=240;canvas.height=240;const ctx=canvas.getContext('2d');ctx.fillStyle='#ebf4ef';ctx.fillRect(0,0,240,240);ctx.fillStyle='#1b6b5a';ctx.beginPath();ctx.arc(120,120,90,0,Math.PI*2);ctx.fill();return canvas.toDataURL('image/png'); });
    await saved(() => page.locator('[data-sg-file]').setInputFiles({name:'my-savings-photo.png',mimeType:'image/png',buffer:Buffer.from(photo.split(',')[1],'base64')}),'/api/lifestyle/jar/image');
    await page.waitForFunction(() => { const img=document.querySelector('[data-sg-photo] img');return img && img.complete && img.naturalWidth>0; });
    assert.equal(await page.locator('[data-sg-progress]').getAttribute('value'),'25');
    await page.reload(); await page.locator('[data-sg-form]').waitFor();
    assert.equal(await page.locator('[data-sg-form] [name="name"]').inputValue(),'我的恐龍旅行願望');
    assert.equal(await page.locator('[data-sg-percent]').textContent(),'25%');
    await page.waitForFunction(() => { const img=document.querySelector('[data-sg-photo] img');return img && img.complete && img.naturalWidth>0; });
    await saved(() => page.locator('[data-sg-shape="heart"]').click(),'/api/lifestyle/jar');
    await saved(() => page.locator('[data-sg-shape="photo"]').click(),'/api/lifestyle/jar');
    assert.equal(await page.locator('[data-sg-percent]').textContent(),'25%'); await fits();
    console.log('PASS: actual saved/target amounts produce 25% in dinosaur, custom photo, and other shapes; image and amounts restore.');

    await route('settings','[data-life-toggle="smokingEnabled"]');
    await saved(() => page.locator('[data-life-toggle="smokingEnabled"]').check(),'/api/lifestyle/preferences');
    await route('','[data-nav="smoking"]'); await page.locator('[data-nav="smoking"]').click();
    await page.locator('[data-smoking-settings]').waitFor();
    await page.locator('[name="monthlyLimit"]').fill('4');
    await saved(() => page.locator('[data-smoking-action="save-limit"]').click(),'/api/lifestyle/smoking/settings');
    await saved(() => page.locator('[data-smoking-action="bought-plus"]').click(),'/api/lifestyle/smoking/'+boot.today);
    await page.waitForFunction(() => document.querySelector('[data-smoking-total="bought"]').textContent.trim().startsWith('1'));
    await saved(() => page.locator('[data-smoking-action="smoked-plus"]').click(),'/api/lifestyle/smoking/'+boot.today);
    await page.waitForFunction(() => document.querySelector('[data-smoking-total="smoked"]').textContent.trim()==='1');
    assert.equal(await page.locator('[data-smoking-lungs]').evaluate(el => el.style.getPropertyValue('--smoking-darkness')),'0.2500');
    await saved(() => page.locator('[data-smoking-action="smoked-minus"]').click(),'/api/lifestyle/smoking/'+boot.today);
    await page.waitForFunction(() => document.querySelector('[data-smoking-total="smoked"]').textContent.trim()==='0');
    await saved(() => page.locator('[data-smoking-action="smoked-plus"]').click(),'/api/lifestyle/smoking/'+boot.today);
    await page.reload(); await page.locator('[data-smoking-total="smoked"]').waitFor();
    assert.equal((await page.locator('[data-smoking-total="smoked"]').textContent()).trim(),'1');
    assert.equal((await page.locator('[data-smoking-total="bought"]').textContent()).trim(),'1 包');
    const previousDate = new Date(boot.today.slice(0,7)+'-01T12:00:00+08:00'); previousDate.setUTCMonth(previousDate.getUTCMonth()-1);
    const previousMonth = previousDate.toISOString().slice(0,7);
    await saved(async () => { await page.locator('[data-smoking-month]').fill(previousMonth); await page.locator('[data-smoking-month]').blur(); },'/api/lifestyle/smoking','GET');
    await page.waitForFunction(() => document.querySelector('[data-smoking-total="smoked"]').textContent.trim()==='0');
    assert.equal(await page.locator('[data-smoking-lungs]').evaluate(el => el.style.getPropertyValue('--smoking-darkness')),'0.0000','An empty month starts with clean lungs');
    assert.equal(await page.locator('[data-smoking-action="smoked-plus"]').count(),0,'Archived months cannot accidentally add today’s count');
    await saved(() => page.locator('[data-smoking-action="today"]').click(),'/api/lifestyle/smoking','GET');
    await page.waitForFunction(() => document.querySelector('[data-smoking-total="smoked"]').textContent.trim()==='1');
    await page.locator('[data-smoking-chart-type]').selectOption('table'); await page.locator('[data-smoking-chart] table').waitFor(); await fits();
    console.log('PASS: optional smoking tile, separate bought/smoked counts, increment/decrement, monthly target color, persistent history.');

    await route('settings','[data-life-habits]'); await page.locator('[data-life-habits]').first().click();
    await page.locator('dialog [data-habit-add]').waitFor();
    await page.locator('[data-habit-add] [name="name"]').fill('每週存零錢'); await page.locator('[data-habit-add] button').click();
    const preset = await page.locator('[data-habit-preset]').first().getAttribute('data-habit-preset');
    await page.locator('[data-habit-preset]').first().uncheck();
    await saved(() => page.locator('[data-habit-save]').click(),'/api/lifestyle/preferences');
    await page.locator('dialog').waitFor({state:'detached'});
    const customId = await page.evaluate(() => LifeFeatures.prefs().customHabits.find(x=>x.name==='每週存零錢').id);
    await route('profile','[data-fold="fin"]');
    if (!(await page.locator('#finF').count())) await page.locator('[data-fold="fin"]').click();
    await page.locator(`[name="finHabit"][value="${customId}"]`).waitFor();
    assert.equal(await page.locator(`[name="finHabit"][value="${preset}"]`).count(),0);
    await page.locator(`[name="finHabit"][value="${customId}"]`).check();
    await saved(() => page.locator('#finF button[type="submit"]').click(),'/api/auth/me/finance');
    await page.reload(); await page.locator('[data-fold="fin"]').waitFor();
    if (!(await page.locator('#finF').count())) await page.locator('[data-fold="fin"]').click();
    await page.locator('#finF').waitFor();
    assert.equal(await page.locator(`[name="finHabit"][value="${customId}"]`).isChecked(),true);
    await route('settings','[data-life-habits]'); await page.locator('[data-life-habits]').first().click();
    await page.locator('[data-habit-custom] .life-shortcut-row').filter({hasText:'每週存零錢'}).locator('[data-remove-habit]').click();
    await saved(() => page.locator('[data-habit-save]').click(),'/api/lifestyle/preferences');
    await page.locator('dialog').waitFor({state:'detached'});
    assert.equal(await page.evaluate(async id => (await API.financeProfile()).finance.habits.includes(id),customId),false);
    console.log('PASS: add/select/persist/remove a custom financial habit; hide a preset.');

    await page.locator('[data-life-shortcuts]').first().click(); await page.locator('[data-life-list]').waitFor();
    const shortcutRows = page.locator('[data-life-list] .life-shortcut-row');
    await shortcutRows.filter({hasText:'國際匯率換算'}).locator('input[type="checkbox"]').uncheck();
    let jarIndex = Number(await shortcutRows.filter({hasText:'我的存錢筒'}).getAttribute('data-row'));
    while (jarIndex-- > 0) await shortcutRows.filter({hasText:'我的存錢筒'}).locator('[data-move="-1"]').click();
    await saved(() => page.locator('[data-life-save]').click(),'/api/lifestyle/preferences'); await page.locator('dialog').waitFor({state:'detached'});
    await route('','.dgrid');
    assert.equal(await page.locator('.dgrid .dtile').first().getAttribute('data-nav'),'savings-game');
    assert.equal(await page.locator('.dgrid [data-nav="exchange"]').count(),0);
    await page.reload(); await page.locator('.dgrid').waitFor();
    assert.equal(await page.locator('.dgrid .dtile').first().getAttribute('data-nav'),'savings-game');
    assert.equal(await page.locator('.dgrid [data-nav="exchange"]').count(),0);
    console.log('PASS: popup shortcut visibility and ordering persist after reload.');

    await route('settings','[data-life-toggle="calculatorEnabled"]');
    await saved(() => page.locator('[data-life-toggle="calculatorEnabled"]').check(),'/api/lifestyle/preferences');
    await page.locator('.floating-calculator-launcher').click();
    await page.locator('.floating-calculator__input').fill('sqrt(144)+sin(30)'); await page.locator('.floating-calculator__input').press('Enter');
    assert.equal(await page.locator('[data-calc-result]').textContent(),'12.5');
    const handle = page.locator('.floating-calculator__handle'), handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x+35,handleBox.y+20); await page.mouse.down(); await page.mouse.move(handleBox.x+45,handleBox.y+35,{steps:3}); await page.mouse.up();
    await route('health','[data-wellness-height]');
    assert.equal(await page.locator('[data-calc-result]').textContent(),'12.5');
    await page.locator('.floating-calculator__input').press('Escape'); assert.equal(await page.locator('.floating-calculator').isVisible(),false);
    await route('settings','[data-life-toggle="calculatorEnabled"]');
    await saved(() => page.locator('[data-life-toggle="calculatorEnabled"]').uncheck(),'/api/lifestyle/preferences');
    await page.waitForFunction(() => !document.querySelector('.floating-calculator, .floating-calculator-launcher'));
    assert.equal(await page.locator('.floating-calculator, .floating-calculator-launcher').count(),0);
    console.log('PASS: enable, calculate, drag, preserve across pages, temporarily hide, and disable the calculator.');

    await page.evaluate(async ({date,groupId}) => {
      const cats=(await API.categories()).categories;
      await API.createTransaction({date,amount:125,kind:'expense',cat:cats.find(c=>c.kind==='expense').id,merchant:'整合驗收支出',groupId});
      await API.createTransaction({date,amount:1000,kind:'income',cat:cats.find(c=>c.kind==='income').id,merchant:'整合驗收收入',groupId});
    },{date:boot.today,groupId:boot.groupId});
    await route('reports','[data-report-results][aria-busy="false"] [data-report-chart]');
    await page.waitForFunction(() => document.querySelector('[data-report-status]').textContent.includes('完整讀取 2'));
    assert.match(await page.locator('[data-report-summary]').textContent(),/1,000/); assert.match(await page.locator('[data-report-summary]').textContent(),/125/); assert.match(await page.locator('[data-report-summary]').textContent(),/875/);
    for (const period of ['day','month','year']) {
      await page.locator('[data-report-period]').selectOption(period);
      await page.waitForFunction(() => document.querySelector('[data-report-results]').getAttribute('aria-busy')==='false' && document.querySelector('[data-report-status]').textContent.includes('完整讀取 2'));
      for (const style of ['line','bar','pie','table']) {
        await page.locator('[data-report-style]').selectOption(style);
        assert.equal(await page.locator('[data-report-chart] table').count(),1);
        if (style !== 'table') assert.equal(await page.locator('[data-report-chart] svg').count(),1);
        assert.match(await page.locator('[data-report-summary]').textContent(),/875/);
      }
    }
    await page.reload(); await page.locator('[data-report-style]').waitFor();
    assert.equal(await page.locator('[data-report-style]').inputValue(),'table'); await fits();
    console.log('PASS: actual financial totals in day/month/year reports, line/bar/pie/table formats, saved chart preference.');

    const shared = await page.evaluate(async ({email,password,today,userId}) => {
      const invite=await API.createInviteCode({role:'parent',label:'生日驗收家人'});
      const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'生活驗收家人',email:email.replace('@','-member@'),password})});
      if (r.status!==201) throw new Error('Second local account could not be created');
      const member=await r.json(), headers={Authorization:'Bearer '+member.accessToken,'Content-Type':'application/json'};
      const joined=await fetch('/api/family/join',{method:'POST',headers,body:JSON.stringify({code:invite.code})});
      if (!joined.ok) throw new Error('Second local account could not join its test family');
      const birthdays=await fetch('/api/lifestyle/birthdays',{headers}).then(r=>r.json());
      const health=await fetch('/api/lifestyle/health?year='+today.slice(0,4),{headers}).then(r=>r.json());
      return {sharedBirthday:birthdays.members.some(m=>m.userId===String(userId)&&m.displayName==='生活整合驗收'&&!m.isSelf),exposesYear:birthdays.members.some(m=>'birthDate' in m || 'birthYear' in m),ownHealth:health.records};
    },{email,password,today:boot.today,userId:boot.userId});
    assert.equal(shared.sharedBirthday,true); assert.equal(shared.exposesYear,false); assert.deepEqual(shared.ownHealth,[]);
    await route('settings','#logout'); await page.locator('#logout').click(); await page.locator('#loginF').waitFor();
    assert.equal(await page.evaluate(() => LifeFeatures.user()),null);
    assert.equal(await page.evaluate(async () => { try { await LifeAPI.request('GET','/preferences'); return false; } catch (_) { return true; } }),true,'Signed-out preference requests must be rejected');
    assert.equal(await page.evaluate(async () => (await fetch('/api/lifestyle/preferences')).status),401,'The server rejects unauthenticated preference reads');
    assert.deepEqual(await page.evaluate(() => LifeFeatures.prefs()),{});
    assert.equal(await page.locator('.floating-calculator, .floating-calculator-launcher').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: an actual second family member receives the birthday wish without birth year or another member’s private health data. All lifestyle integration checks passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
