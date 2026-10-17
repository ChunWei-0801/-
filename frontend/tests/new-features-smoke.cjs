// Run against an isolated local development server with email_delivery_mode=demo.
// A configured mail service is deliberately not represented as a delivered test email.
// Optional FAMBUDGET_TEST_PHOTO supplies a real original file; otherwise a PNG fixture is generated.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const base = new URL(process.env.FAMBUDGET_URL || 'http://127.0.0.1:5174');
const at = route => { const url = new URL(base); url.hash = '#/' + route; return url.href; };
const photoPath = process.env.FAMBUDGET_TEST_PHOTO;
const artifacts = process.env.FAMBUDGET_ARTIFACT_DIR || os.tmpdir();
const shot = name => path.join(artifacts, name);
(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:1366,height:900},locale:'zh-TW'});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(()=>localStorage.setItem('fambudget.tour','done'));
    await page.goto(at('login')); await page.locator('#loginF').waitFor();
    assert.equal(await page.evaluate(()=>API.mode),'http');
    const capabilities = await page.evaluate(()=>fetch(API.base+'/capabilities').then(r=>r.json()));
    assert.equal(capabilities.email_delivery_mode,'demo','This smoke requires an isolated demo-mail server; do not send synthetic addresses through a real mail service.');
    assert.equal(capabilities.mail_configured,false);
    assert.equal(await page.locator('.login-bg').count(),0,'Background settings have their own route.');
    await page.locator('a[href="#/appearance"]').first().click(); await page.locator('[data-lbg-preset]').first().waitFor();
    assert.equal(await page.locator('[data-lbg-preset]').count(),4);
    for(const preset of ['dawn','forest','night','custom']) {
      await page.locator(`[data-lbg-preset][value="${preset}"]`).check();
      assert.equal(await page.evaluate(()=>LoginBackground.getState().preset),preset);
    }
    let photo = photoPath;
    if (!photo) {
      const encoded = await page.evaluate(()=> {
        const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;
        const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,1200,800);
        gradient.addColorStop(0,'#e8d9b4');gradient.addColorStop(.5,'#a6c9b7');gradient.addColorStop(1,'#244c44');
        ctx.fillStyle=gradient;ctx.fillRect(0,0,1200,800);ctx.fillStyle='#ffffff55';ctx.beginPath();ctx.arc(900,180,100,0,Math.PI*2);ctx.fill();
        return canvas.toDataURL('image/png').split(',')[1];
      });
      photo={name:'background-original.png',mimeType:'image/png',buffer:Buffer.from(encoded,'base64')};
    }
    const photoBytes=photoPath?fs.statSync(photoPath).size:photo.buffer.length;
    await page.locator('[data-lbg-file]').first().setInputFiles(photo);
    await page.waitForFunction(()=>LoginBackground.getState().hasPhoto);
    await page.locator('[data-lbg-setting="fit"]').selectOption('contain');
    await page.locator('[data-lbg-setting="blur"]').evaluate(input=>{input.value='4';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('[data-appearance-theme="sky"]').click();
    await page.locator('[data-appearance-apply]').click(); await page.locator('#loginF').waitFor();
    await page.waitForFunction(()=>LoginBackground.getState().photoStorage==='saved');
    const storedBytes = await page.evaluate(async()=> {
      const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('fambudget-login-background',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const saved=await new Promise((resolve,reject)=>{const r=db.transaction('photos').objectStore('photos').get('custom');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      db.close();return saved.blob.size;
    });
    assert.equal(storedBytes,photoBytes);
    await page.reload();await page.locator('#loginF').waitFor();await page.evaluate(()=>LoginBackground.ready());
    assert.equal(await page.evaluate(()=>LoginBackground.getState().hasPhoto),true);
    assert.equal(await page.evaluate(()=>LoginBackground.getState().blur),4);
    assert.equal(await page.evaluate(()=>LoginBackground.getState().fit),'contain');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'sky');
    await page.screenshot({path:shot('fambudget-login-photo-desktop.png'),fullPage:true});
    await page.locator('#loginF a[data-gate="register"]').click();
    assert.equal(await page.evaluate(()=>document.body.dataset.loginbackground),'custom');
    const mail=`new.features.${Date.now()}@example.test`,password='Local-features-7!';
    await page.locator('#rgName').fill('家庭生活驗收');await page.locator('#rgEmail').fill(mail);await page.locator('#rgPw').fill(password);
    await page.locator('#regF button[type="submit"]').click();await page.locator('[data-su-done="skip"]').waitFor();
    assert.equal(await page.evaluate(()=>document.body.classList.contains('login-background-on')),true);
    assert.equal(await page.evaluate(()=>document.body.dataset.loginbackground),'custom');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'sky');
    // Visit the appearance confirmation step; merely completing setup must not replace a chosen style.
    await page.locator('[data-su-next]').click();await page.locator('#suFinF').waitFor();
    await page.locator('[data-su-next]').click();await page.locator('[data-su-done="finish"]').waitFor();
    assert.equal(await page.locator('[data-theme-pick]').count(),0);
    assert.equal(await page.evaluate(()=>document.body.dataset.loginbackground),'custom');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'sky');
    await page.locator('[data-su-done="finish"]').click();await page.locator('.verification-nudge').waitFor();
    await page.locator('.verification-nudge').click();await page.locator('#verifyEmail').fill(mail);
    const verificationResponse=page.waitForResponse(r=>r.url().includes('/api/auth/email-verification/request')&&r.request().method()==='POST');
    await page.locator('#verifyRequestF button[type="submit"]').click();
    const verification=await (await verificationResponse).json();
    assert.equal(verification.delivery,'demo');assert.ok(verification.demoVerificationUrl);
    await page.locator('#verifyOut a').waitFor();assert.match(await page.locator('#verifyOut').innerText(),/開發展示連結，未寄出郵件/);
    assert.match(await page.locator('#verifyOut a').getAttribute('href'),/#\/verify-email\/.+/);
    // Keep the isolated frontend/API port override when following the returned development token.
    await page.goto(at(new URL(verification.demoVerificationUrl).hash.replace(/^#\//,'')));
    await page.locator('#verifyConfirmF').waitFor();assert.equal(await page.evaluate(()=>location.hash),'#/verify-email');
    await page.locator('#verifyConfirmF button[type="submit"]').click();await page.getByText('信箱驗證完成',{exact:true}).waitFor();
    await page.locator('#verifyOut a').click();
    if(await page.locator('#loginF').count()) {
      await page.locator('#lgEmail').fill(mail);await page.locator('#lgPw').fill(password);await page.locator('#loginF button[type="submit"]').click();
    }
    await page.locator('.wal__card').waitFor();
    const verifiedMe=(await page.evaluate(()=>API.me())).user;
    assert.equal(verifiedMe.emailVerified,true);assert.equal(verifiedMe.theme,'sky');assert.equal(verifiedMe.appearance.preset,'custom');
    assert.equal(await page.locator('.dgrid a[href*="docs"],.dgrid a[href*="presentation"]').count(),0);
    assert.doesNotMatch(await page.locator('.dgrid').innerText(),/專題|發表|工程|API/);
    await page.goto(at('exchange'));await page.waitForFunction(()=>!document.getElementById('exchange-submit').disabled);
    assert.ok(await page.locator('#exchange-from option').count()>30);
    await page.locator('#exchange-search').fill('Japanese Yen');assert.match(await page.locator('#exchange-search-status').innerText(),/1/);await page.locator('#exchange-search').fill('');
    await page.locator('#exchange-from').selectOption('USD');await page.locator('#exchange-to').selectOption('TWD');await page.locator('#exchange-amount').fill('100.50');
    const quoteResponse=page.waitForResponse(r=>r.url().includes('/api/exchange/convert')&&r.request().method()==='POST');
    await page.locator('#exchange-submit').click();const quote=await (await quoteResponse).json();await page.locator('#exchange-use').waitFor();
    assert.equal(quote.fromCurrency,'USD');assert.equal(quote.toCurrency,'TWD');assert.ok(Number(quote.convertedAmount)>0);assert.ok(quote.provider);assert.ok(quote.updatedAt);
    assert.match(await page.locator('#exchange-source').innerText(),/來源|Source/);await page.screenshot({path:shot('fambudget-exchange-desktop.png'),fullPage:true});
    await page.locator('#exchange-use').click();await page.locator('#singleAmount').waitFor();assert.equal(await page.locator('#singleAmount').inputValue(),quote.convertedAmount);
    assert.match(await page.locator('#singleNote').inputValue(),/USD/);await page.locator('#singleAmount').fill('600.50');await page.locator('#singleMerchant').fill('海外付款驗收');
    let parseCalls=0;page.on('request',r=>{if(r.url().includes('/api/nlp/'))parseCalls++;});
    await page.locator('#singleSave').click();await page.locator('#singleSave').click();await page.waitForFunction(async()=> (await API.transactions({})).transactions.length===1);
    const transactions=(await page.evaluate(()=>API.transactions({}))).transactions;
    assert.equal(transactions[0].amount,600.5);assert.equal(transactions[0].source,'manual');assert.equal(parseCalls,0);assert.equal((await page.evaluate(()=>API.summary({scope:'me'}))).expense,600.5);
    await page.goto(at(''));await page.locator('.wal__strip--2 b').waitFor();assert.match(await page.locator('.wal__strip--2 b').innerText(),/600\.50/);
    await page.goto(at('stats'));await page.locator('.dt').waitFor();assert.match(await page.locator('.dt').innerText(),/600\.50/);assert.equal(await page.locator('.dnt svg text').last().textContent(),'600.50');
    await page.setViewportSize({width:390,height:844});await page.goto(at('exchange'));await page.waitForFunction(()=>!document.getElementById('exchange-submit').disabled);
    await page.locator('#exchange-from').selectOption('JPY');await page.locator('#exchange-to').selectOption('TWD');await page.locator('#exchange-amount').fill('1000');
    await page.locator('#exchange-submit').click();await page.locator('#exchange-use').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.screenshot({path:shot('fambudget-exchange-mobile.png'),fullPage:true});await page.locator('#exchange-use').click();await page.locator('#singleAmount').waitFor();
    assert.ok(Number(await page.locator('#singleAmount').inputValue())>0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.equal(await page.locator('[data-media-pending][capture="environment"]').count(),1,'Mobile manual entry offers a camera.');
    assert.equal(await page.locator('[data-media-pending]:not([capture])').count(),1,'Mobile manual entry offers the photo library.');
    await page.evaluate(()=>API.logout());await page.goto(at('login'));await page.locator('#loginF').waitFor();
    await page.locator('a[href="#/appearance"]').first().click();await page.locator('[data-lbg-preset]').first().waitFor();await page.locator('[data-lbg-preset][value="custom"]').check();
    await page.locator('[data-lbg-file]').first().setInputFiles(photo);await page.waitForFunction(()=>LoginBackground.getState().hasPhoto);
    await page.locator('[data-lbg-setting="blur"]').evaluate(input=>{input.value='8';input.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('[data-lbg-file][capture="environment"]').count(),1);assert.equal(await page.locator('[data-lbg-file]:not([capture])').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.locator('[data-appearance-apply]').click();await page.locator('#loginF').waitFor();
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:shot('fambudget-login-photo-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'passed',photoBytes,originalBlobPreserved:true,themeSurvivedSetup:true,emailVerified:true,emailDelivery:'demo (not sent)',actualAmountPersisted:600.5,manualSource:true,nlpCalls:parseCalls,quoteProvider:quote.provider,quoteDate:quote.updatedAt,mobilePhotoAndExchange:true,browserErrors:errors}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
