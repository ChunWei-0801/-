/* Genuine DOM regression with a local response fixture; no production data. */
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
let chromium;
try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch(_){}
const root=path.join(__dirname,'..');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');

test('whole-TWD jar edits and deposits preserve historical decimals until explicitly changed', {skip:!chromium},async()=>{
 const browser=await chromium.launch({headless:true,executablePath:fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main>');
  await page.addStyleTag({path:path.join(root,'css/tokens.css')});await page.addStyleTag({path:path.join(root,'css/savings-game.css')});
  await page.evaluate(()=>{
   window.fixture={jar:{name:'原願望',targetAmount:12.34,savedAmount:0.5,shape:'pig',imageUrl:null},requests:[]};
   const copy=value=>JSON.parse(JSON.stringify(value));
   window.LifeAPI={request:async(method,path,body)=>{
    fixture.requests.push({method,path,body:copy(body||null)});
    if(method==='GET'&&path==='/jars')return {jars:[{...copy(fixture.jar),id:'default'}]};
    if(method==='PUT'&&path==='/jar')Object.assign(fixture.jar,body);
    if(method==='PUT'&&path==='/jar/image')fixture.jar.imageUrl='/api/lifestyle/jar/image';
    return copy(fixture.jar);
   },imageURL:async()=>URL.createObjectURL(new Blob(['fixture'],{type:'image/png'}))};
  });
  await page.addScriptTag({path:path.join(root,'js/currency-units.js')});await page.addScriptTag({path:path.join(root,'js/savings-game.js')});
  await page.evaluate(()=>SavingsGame.mount(document.querySelector('#root')));
  assert.equal(await page.locator('[name="targetAmount"]').getAttribute('min'),'1');
  assert.equal(await page.locator('[name="targetAmount"]').getAttribute('step'),'1');
  assert.equal(await page.locator('[name="savedAmount"]').getAttribute('min'),'0');
  assert.equal(await page.locator('[name="delta"]').getAttribute('step'),'1');
  assert.equal(await page.locator('[data-sg-saved]').textContent(),'0.5');
  await page.locator('[name="name"]').fill('只改名稱');await page.locator('[data-sg-form]').dispatchEvent('submit');
  await page.waitForFunction(()=>fixture.requests.filter(r=>r.method==='PUT').length===1);
  assert.deepEqual(await page.evaluate(()=>fixture.requests.filter(r=>r.method==='PUT').at(-1).body),{name:'只改名稱'});
  assert.deepEqual(await page.evaluate(()=>[fixture.jar.targetAmount,fixture.jar.savedAmount]),[12.34,0.5]);
  for(const value of ['0.1','0','1']){
   await page.locator('[name="delta"]').fill(value);await page.locator('[data-sg-deposit]').dispatchEvent('submit');
   await page.locator('[data-sg-status].is-error').waitFor();
  }
  assert.equal(await page.evaluate(()=>fixture.requests.filter(r=>r.method==='PUT').length),1,'invalid delta and legacy fractional balance never cause a rounded write');
  await page.locator('[name="savedAmount"]').fill('1');await page.locator('[data-sg-form]').dispatchEvent('submit');
  await page.waitForFunction(()=>fixture.jar.savedAmount===1);
  assert.deepEqual(await page.evaluate(()=>fixture.requests.filter(r=>r.method==='PUT').at(-1).body),{name:'只改名稱',savedAmount:1});
  assert.equal(await page.evaluate(()=>fixture.jar.targetAmount),12.34);
  await page.locator('[name="targetAmount"]').fill('0');await page.locator('[data-sg-form]').dispatchEvent('submit');
  await page.locator('[data-sg-status].is-error').waitFor();assert.equal(await page.evaluate(()=>fixture.jar.targetAmount),12.34);
  await page.locator('[name="targetAmount"]').fill('1');await page.locator('[data-sg-form]').dispatchEvent('submit');
  await page.waitForFunction(()=>fixture.jar.targetAmount===1);
  await page.locator('[name="delta"]').fill('1');await page.locator('[data-sg-deposit]').dispatchEvent('submit');await page.waitForFunction(()=>fixture.jar.savedAmount===2);
  await page.locator('[data-sg-clear]').click();await page.waitForFunction(()=>fixture.jar.savedAmount===0);
  assert.equal(await page.locator('[data-sg-percent]').textContent(),'0%');

  // Replacing a photo and changing shape must not resubmit legacy amounts.
  await page.evaluate(()=>{fixture.jar.targetAmount=12.34;fixture.jar.savedAmount=0.5;});
  await page.evaluate(()=>SavingsGame.mount(document.querySelector('#root')));
  await page.locator('[data-sg-file]').setInputFiles({name:'wish.png',mimeType:'image/png',buffer:pixel});
  await page.waitForFunction(()=>fixture.jar.shape==='photo');
  const changes=await page.evaluate(()=>fixture.requests.filter(r=>r.method==='PUT').slice(-2));
  assert.equal(changes[0].path,'/jar/image');assert.deepEqual(Object.keys(changes[0].body),['image']);
  assert.deepEqual(changes[1].body,{shape:'photo'});assert.deepEqual(await page.evaluate(()=>[fixture.jar.targetAmount,fixture.jar.savedAmount]),[12.34,0.5]);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('multiple jars create once, retain independent balances/photos and recover an uncertain creation without duplicating', {skip:!chromium},async()=>{
 const browser=await chromium.launch({headless:true,executablePath:fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:320,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main>');
  await page.addStyleTag({path:path.join(root,'css/tokens.css')});await page.addStyleTag({path:path.join(root,'css/savings-game.css')});
  await page.evaluate(()=>{
   const copy=value=>JSON.parse(JSON.stringify(value));
   window.fixture={jars:[{id:'default',name:'原願望',targetAmount:100,savedAmount:15,shape:'heart',imageUrl:null}],requests:[],uncertain:false};
   window.LifeAPI={request:async(method,url,body)=>{
    fixture.requests.push({method,url,body:copy(body||null)});
    if(method==='GET'&&url==='/jars')return{jars:copy(fixture.jars)};
    if(method==='POST'&&url==='/jars'){const row={...body,id:String(fixture.jars.length),imageUrl:null};fixture.jars.push(row);if(fixture.uncertain){fixture.uncertain=false;throw new Error('Unknown network result');}return copy(row);}
    const id=url.startsWith('/jar/')||url==='/jar'?'default':url.split('/')[2],row=fixture.jars.find(j=>j.id===id);if(!row)throw new Error('Unexpected jar');
    if(url.endsWith('/image'))row.imageUrl='/api/lifestyle/jars/'+id+'/image';else Object.assign(row,body);return copy(row);
   },imageURL:async()=>URL.createObjectURL(new Blob(['fixture'],{type:'image/png'}))};
  });
  await page.addScriptTag({path:path.join(root,'js/currency-units.js')});await page.addScriptTag({path:path.join(root,'js/savings-game.js')});await page.evaluate(()=>SavingsGame.mount(document.querySelector('#root')));
  await page.locator('[data-sg-create]').click();await page.locator('[name="newName"]').fill('旅行');await page.locator('[name="newTarget"]').fill('0.5');await page.locator('[data-sg-new]').dispatchEvent('submit');
  assert.equal(await page.evaluate(()=>fixture.requests.filter(r=>r.method==='POST').length),0);
  await page.locator('[name="newTarget"]').fill('100');await page.locator('[name="newShape"]').selectOption('dinosaur');
  await page.locator('[data-sg-new]').dispatchEvent('submit');await page.locator('[data-sg-new]').dispatchEvent('submit');
  await page.waitForFunction(()=>document.querySelector('[data-sg-select]').value==='1');assert.equal(await page.evaluate(()=>fixture.requests.filter(r=>r.method==='POST').length),1);
  await page.locator('[name="delta"]').fill('1');await page.locator('[data-sg-deposit]').dispatchEvent('submit');await page.waitForFunction(()=>fixture.jars[1].savedAmount===1);
  assert.deepEqual(await page.evaluate(()=>fixture.jars.map(j=>j.savedAmount)),[15,1]);
  await page.locator('[data-sg-file]').setInputFiles({name:'wish.png',mimeType:'image/png',buffer:pixel});await page.waitForFunction(()=>fixture.jars[1].shape==='photo');
  assert.equal(await page.evaluate(()=>fixture.jars[0].imageUrl),null);assert.equal(await page.evaluate(()=>fixture.requests.some(r=>r.url==='/jars/1/image')),true);
  await page.locator('[name="name"]').fill('尚未儲存');page.once('dialog',dialog=>dialog.dismiss());await page.locator('[data-sg-select]').selectOption('default');assert.equal(await page.locator('[data-sg-select]').inputValue(),'1');
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-sg-select]').selectOption('default');assert.equal(await page.locator('[data-sg-saved]').textContent(),'15');
  assert.equal(await page.evaluate(()=>fixture.jars[1].name),'旅行');
  await page.locator('[data-sg-create]').click();await page.locator('[name="newName"]').fill('學費');await page.locator('[name="newTarget"]').fill('200');await page.evaluate(()=>fixture.uncertain=true);await page.locator('[data-sg-new]').dispatchEvent('submit');
  await page.locator('[data-sg-reload]').waitFor();assert.equal(await page.locator('[data-sg-create]').isDisabled(),true);assert.equal(await page.evaluate(()=>fixture.jars.length),3);
  await page.locator('[data-sg-reload]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-sg-select] option').length===3);
  assert.equal(await page.evaluate(()=>fixture.requests.filter(r=>r.method==='POST').length),2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
