/* Real DOM and MediaRecorder/IndexedDB contract checks. Speech devices are
 * explicit fixtures; these do not establish physical microphone or TTS quality. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const root=path.join(__dirname,'..');
let chromium;try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch(_){}

async function fixture(browser,options={}){
  const context=await browser.newContext({viewport:{width:320,height:800},acceptDownloads:true});
  const errors=[],requests=[];
  const html='<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--ink:#123;--card:white;--line:#ccc;--down:#900}body{margin:8px;font:16px system-ui}main label{display:block}main input{max-width:100%;box-sizing:border-box}</style></head><body><main id="view"><h1>家庭記帳</h1><p>請先確認記帳內容。</p><p style="display:none">HIDDEN_SECRET</p><input type="hidden" value="HIDDEN_TOKEN"><form><label>消費備註<input id="note" value="原本"></label><label>金額<input id="amount" type="number"></label><label>日期<input id="date" type="date"></label><label>分類<select id="category"><option value="food">餐飲</option><option value="travel">交通</option></select></label><label>密碼<input id="password" type="password"></label><label>驗證碼<input id="verification_code"></label></form><section id="settings"></section></main></body></html>';
  await context.route('**/*',route=>{requests.push(route.request().url());return route.fulfill({contentType:'text/html',body:html});});
  await context.addInitScript(options=>{
    window.__voiceFixture={recognitionStarts:0,recognitionAborts:0,microphones:0,spoken:[],cancels:0,submits:0,voices:Array.from({length:6},(_,i)=>({voiceURI:'fixture-local-'+i,name:'Device voice '+i,lang:i<5?'zh-TW':'en-US',localService:true})).concat([{voiceURI:'fixture-network',name:'Network voice',lang:'zh-TW',localService:false}])};
    window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
    const listeners={};
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>__voiceFixture.voices,speak:utterance=>{__voiceFixture.spoken.push({text:utterance.text,rate:utterance.rate,pitch:utterance.pitch,voice:utterance.voice.voiceURI});},cancel:()=>{__voiceFixture.cancels++;},addEventListener:(name,callback)=>{listeners[name]=callback;}}});
    __voiceFixture.voicesChanged=()=>listeners.voiceschanged&&listeners.voiceschanged();
    if(options.storageFailure)Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){throw new Error('PRIVATE_STORAGE_DETAIL');}}});
    const nativeTimeout=window.setTimeout.bind(window);
    window.setTimeout=(callback,ms,...args)=>{if(ms===120000)__voiceFixture.recordingDeadline=callback;return nativeTimeout(callback,ms,...args);};
    const NativeRecorder=window.MediaRecorder;
    if(NativeRecorder)window.MediaRecorder=class extends NativeRecorder{constructor(...args){super(...args);__voiceFixture.recorder=this;}};
    window.SpeechRecognition=class{
      constructor(){__voiceFixture.recognition=this;}
      start(){__voiceFixture.recognitionStarts++;}
      stop(){this.onend&&this.onend();}
      abort(){__voiceFixture.recognitionAborts++;}
    };
    __voiceFixture.result=text=>{const result=[{transcript:text}];result.isFinal=true;__voiceFixture.recognition.onresult&&__voiceFixture.recognition.onresult({results:[result]});__voiceFixture.recognition.onend&&__voiceFixture.recognition.onend();};
    navigator.mediaDevices.getUserMedia=async()=>{
      __voiceFixture.microphones++;
      const audio=new AudioContext(),oscillator=audio.createOscillator(),destination=audio.createMediaStreamDestination();
      oscillator.connect(destination);oscillator.start();
      const stream=destination.stream;__voiceFixture.lastStream=stream;__voiceFixture.audio=audio;
      if(__voiceFixture.deferMicrophone)await new Promise(resolve=>{__voiceFixture.finishMicrophone=resolve;});
      return stream;
    };
    document.addEventListener('submit',event=>{event.preventDefault();__voiceFixture.submits++;});
  },options);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:47179/');
  await page.addStyleTag({path:path.join(root,'css/voice-accessibility.css')});
  await page.addScriptTag({path:path.join(root,'js/voice-accessibility.js')});
  await page.evaluate(()=>{VoiceAccessibility.init();VoiceAccessibility.setAccount({id:'account-a'});});
  return {context,page,errors,requests};
}

test('voice controls are opt-in, expose actual device voices and presets, and fill only an explicitly reviewed safe field',{skip:!chromium},async()=>{
  const browser=await chromium.launch({headless:true,executablePath:fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined,args:['--no-sandbox']});
  try{
    const {context,page,errors}=await fixture(browser);
    assert.equal(await page.evaluate(()=>__voiceFixture.microphones),0,'initialization never requests a microphone');
    await page.locator('#note').focus();await page.locator('#note').evaluate(node=>node.setSelectionRange(node.value.length,node.value.length));await page.locator('.voice-launch').click();
    assert.equal(await page.locator('.voice-panel select').first().locator('option').count(),6);
    assert.deepEqual(await page.evaluate(()=>VoiceAccessibility.styles()),['natural','warm','calm','bright','clear']);
    assert.equal(await page.locator('.voice-panel select').nth(1).locator('option').count(),5);
    await page.locator('[data-voice-action="start"]').click();
    assert.equal(await page.evaluate(()=>__voiceFixture.recognitionStarts),0,'network dictation requires explicit consent');
    await page.locator('.voice-panel section').first().locator('input[type=checkbox]').check();
    await page.locator('[data-voice-action="start"]').click();
    await page.evaluate(()=>__voiceFixture.result('早餐一百二十元'));
    assert.equal(await page.locator('#note').inputValue(),'原本','recognition does not alter the field before apply');
    await page.locator('[data-voice-action="apply"]').click();
    assert.equal(await page.locator('#note').inputValue(),'原本早餐一百二十元');
    assert.equal(await page.evaluate(()=>__voiceFixture.submits),0);
    await page.locator('[data-voice-action="close"]').click();
    await page.locator('#password').focus();await page.locator('.voice-launch').click();await page.locator('[data-voice-action="start"]').click();
    assert.equal(await page.evaluate(()=>__voiceFixture.recognitionStarts),1,'password cannot become a dictation target');
    assert.equal(await page.locator('#password').inputValue(),'');
    await page.locator('[data-voice-action="close"]').click();
    await page.locator('#verification_code').focus();await page.locator('.voice-launch').click();await page.locator('[data-voice-action="start"]').click();
    assert.equal(await page.evaluate(()=>__voiceFixture.recognitionStarts),1,'verification codes are excluded');
    await page.evaluate(()=>{__voiceFixture.voices=__voiceFixture.voices.slice(0,2);__voiceFixture.voicesChanged();});
    assert.equal(await page.locator('.voice-panel select').first().locator('option').count(),2,'fewer than five voices are not faked by duplicate options');
    assert.equal(await page.locator('.voice-panel details').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'voice UI fits a 320px page');
    assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();}
});

test('on-device recognition is preferred and fallback requires consent; recordings enforce limits and do not claim a failed save succeeded',{skip:!chromium},async()=>{
  const browser=await chromium.launch({headless:true,executablePath:fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  try{
    const {context,page,errors}=await fixture(browser);
    await page.evaluate(()=>{const Base=window.SpeechRecognition;window.SpeechRecognition=class extends Base{constructor(){super();this.processLocally=false;}};});
    await page.locator('#note').focus();await page.locator('.voice-launch').click();await page.locator('[data-voice-action="start"]').click();
    assert.equal(await page.evaluate(()=>__voiceFixture.recognition.processLocally),true,'a local recognition path does not require network consent');
    await page.evaluate(()=>__voiceFixture.recognition.onerror({error:'language-not-supported'}));
    assert.equal(await page.evaluate(()=>__voiceFixture.recognitionStarts),1,'a local language failure does not silently enable a cloud service');
    await page.locator('.voice-panel section').first().locator('input[type=checkbox]').check();await page.locator('[data-voice-action="start"]').click();
    assert.equal(await page.evaluate(()=>__voiceFixture.recognition.processLocally),true,'local speech remains preferred after granting optional network consent');
    await page.evaluate(()=>__voiceFixture.recognition.onerror({error:'language-not-supported'}));
    assert.equal(await page.evaluate(()=>__voiceFixture.recognition.processLocally),false,'only an explicitly permitted network fallback may run');
    await page.locator('[data-voice-action="stop-input"]').click();
    await page.locator('[data-voice-action="record"]').click();await page.waitForFunction(()=>typeof __voiceFixture.recordingDeadline==='function');await page.waitForTimeout(200);
    await page.evaluate(()=>__voiceFixture.recordingDeadline());await page.waitForSelector('.voice-pending:not([hidden])');
    assert.equal(await page.evaluate(()=>__voiceFixture.lastStream.getTracks().every(track=>track.readyState==='ended')),true,'the two-minute timer stops the real MediaRecorder stream');
    await page.locator('[data-voice-action="discard"]').click();await page.locator('[data-voice-action="record"]').click();await page.waitForFunction(()=>__voiceFixture.recorder.state==='recording');
    await page.evaluate(()=>__voiceFixture.recorder.ondataavailable({data:new Blob([new Uint8Array(8*1024*1024+1)],{type:'audio/webm'})}));
    assert.equal(await page.locator('.voice-pending').isVisible(),false,'oversized audio is never presented as a valid saved clip');
    assert.ok((await page.locator('.voice-status').textContent()).includes('大小限制'));
    assert.equal(await page.evaluate(()=>__voiceFixture.lastStream.getTracks().every(track=>track.readyState==='ended')),true);
    assert.deepEqual(errors,[]);await context.close();
    const failed=await fixture(browser,{storageFailure:true});
    await failed.page.locator('.voice-launch').click();await failed.page.locator('[data-voice-action="record"]').click();await failed.page.waitForFunction(()=>__voiceFixture.microphones===1);await failed.page.waitForTimeout(200);await failed.page.locator('[data-voice-action="stop-record"]').click();await failed.page.waitForSelector('.voice-pending:not([hidden])');
    await failed.page.locator('[data-voice-action="save"]').click();await failed.page.waitForFunction(()=>document.querySelector('.voice-status').textContent.includes('儲存空間無法使用'));
    assert.equal(await failed.page.locator('.voice-clip').count(),0);assert.equal(await failed.page.locator('.voice-pending').isVisible(),true,'a failed save keeps the original recording available for download');
    assert.equal((await failed.page.locator('body').textContent()).includes('PRIVATE_STORAGE_DETAIL'),false);
    const downloadPromise=failed.page.waitForEvent('download');await failed.page.locator('[data-voice-action="download-pending"]').click();assert.ok(await (await downloadPromise).path());
    assert.deepEqual(failed.errors,[]);await failed.context.close();
  }finally{await browser.close();}
});

test('dictation checks number/date/select formats and stale captures; reading excludes hidden content and requires a real selected voice',{skip:!chromium},async()=>{
  const browser=await chromium.launch({headless:true,executablePath:fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined,args:['--no-sandbox']});
  try{
    const {context,page,errors}=await fixture(browser);
    async function dictate(selector,text){await page.locator(selector).focus();await page.locator('.voice-launch').click();await page.locator('.voice-panel section').first().locator('input[type=checkbox]').check();await page.locator('[data-voice-action="start"]').click();await page.evaluate(value=>__voiceFixture.result(value),text);await page.locator('[data-voice-action="apply"]').click();await page.locator('[data-voice-action="close"]').click();}
    await dictate('#amount','六十五點五元');assert.equal(await page.locator('#amount').inputValue(),'65.5');
    await dictate('#date','2026年7月1日');assert.equal(await page.locator('#date').inputValue(),'2026-07-01');
    await dictate('#category','交通');assert.equal(await page.locator('#category').inputValue(),'travel');
    await page.locator('#note').focus();await page.locator('.voice-launch').click();await page.locator('[data-voice-action="start"]').click();await page.evaluate(()=>__voiceFixture.result('不應寫入'));
    await page.evaluate(()=>{document.querySelector('#note').value='已被修改';});await page.locator('[data-voice-action="apply"]').click();assert.equal(await page.locator('#note').inputValue(),'已被修改','a stale recognition cannot overwrite a field changed meanwhile');
    await page.locator('[data-voice-action="read"]').click();
    const spoken=await page.evaluate(()=>__voiceFixture.spoken);assert.ok(spoken.length);assert.ok(spoken.some(value=>value.text.includes('家庭記帳')));assert.equal(JSON.stringify(spoken).includes('HIDDEN_SECRET'),false);assert.equal(JSON.stringify(spoken).includes('HIDDEN_TOKEN'),false);
    await page.locator('.voice-panel select').nth(1).selectOption('clear');await page.locator('[data-voice-action="read"]').click();assert.equal(await page.evaluate(()=>__voiceFixture.spoken.at(-1).rate),0.75);
    const count=await page.evaluate(()=>__voiceFixture.spoken.length);await page.evaluate(()=>{__voiceFixture.voices=[];__voiceFixture.voicesChanged();});await page.locator('[data-voice-action="read"]').click();assert.equal(await page.evaluate(()=>__voiceFixture.spoken.length),count,'no fake/default voice is presented as installed');
    await page.locator('[data-voice-action="close"]').click();await page.locator('#note').focus();await page.locator('.voice-launch').click();await page.locator('[data-voice-action="start"]').click();
    await page.evaluate(()=>{location.hash='#/other';});await page.waitForFunction(()=>!document.querySelector('.voice-panel').open);
    assert.ok(await page.evaluate(()=>__voiceFixture.recognitionAborts)>0);assert.equal(await page.locator('#note').inputValue(),'已被修改');
    assert.equal(await page.evaluate(()=>__voiceFixture.submits),0);assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();}
});

test('real MediaRecorder encodes a synthetic tone, saved blobs stay account-scoped in IndexedDB, and stale permission streams are stopped',{skip:!chromium},async()=>{
  const browser=await chromium.launch({headless:true,executablePath:fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  try{
    const {context,page,errors}=await fixture(browser);
    await page.locator('.voice-launch').click();await page.locator('[data-voice-action="record"]').click();await page.waitForFunction(()=>__voiceFixture.microphones===1);
    await page.waitForTimeout(300);await page.locator('[data-voice-action="stop-record"]').click();await page.waitForSelector('.voice-pending:not([hidden])');
    await page.locator('.voice-pending input').fill('家人測試原音');await page.locator('[data-voice-action="save"]').click();await page.waitForSelector('.voice-clip');
    assert.equal(await page.locator('.voice-clip input').inputValue(),'家人測試原音');
    assert.ok(await page.locator('.voice-clip audio').getAttribute('src'));
    assert.equal(await page.evaluate(()=>__voiceFixture.lastStream.getTracks().every(track=>track.readyState==='ended')),true,'microphone tracks stop before preview');
    assert.equal(await page.evaluate(()=>Object.values(localStorage).join('').includes('家人測試原音')),false,'names and audio are not copied into localStorage');
    const downloadPromise=page.waitForEvent('download');await page.locator('.voice-clip').getByRole('button',{name:'下載原音備份'}).click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/\.webm$|\.ogg$|\.m4a$/);const file=await download.path();assert.ok(fs.statSync(file).size>0,'real encoded audio can be backed up');
    await page.evaluate(()=>VoiceAccessibility.setAccount({id:'account-b'}));await page.locator('.voice-launch').click();await page.waitForFunction(()=>document.querySelector('.voice-clips').textContent.includes('目前沒有'));
    assert.equal(await page.locator('.voice-clip').count(),0,'another account cannot list the old recording');
    await page.evaluate(()=>VoiceAccessibility.setAccount({id:'account-a'}));await page.locator('.voice-launch').click();await page.waitForSelector('.voice-clip');
    await page.locator('.voice-clip input').fill('<img src=x onerror=alert(1)>');await page.locator('.voice-clip').getByRole('button',{name:'儲存名稱',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.voice-status').textContent.includes('名稱已更新'));assert.equal(await page.locator('.voice-panel img').count(),0,'recording names are text, never HTML');
    await page.evaluate(()=>{window.confirm=()=>true;});await page.locator('.voice-clip').getByRole('button',{name:'刪除',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.voice-clip'));
    await page.evaluate(()=>{__voiceFixture.deferMicrophone=true;});await page.locator('[data-voice-action="record"]').click();await page.waitForFunction(()=>typeof __voiceFixture.finishMicrophone==='function');
    assert.equal(await page.locator('[data-voice-action="start"]').isDisabled(),true,'pending microphone permission prevents a concurrent dictation request');
    await page.evaluate(()=>VoiceAccessibility.beforeRoute());await page.evaluate(()=>__voiceFixture.finishMicrophone());await page.waitForTimeout(30);
    assert.equal(await page.evaluate(()=>__voiceFixture.lastStream.getTracks().every(track=>track.readyState==='ended')),true,'a late permission response does not leave the microphone running');
    await page.evaluate(()=>VoiceAccessibility.setAccount(null));await page.locator('.voice-launch').click();assert.equal(await page.locator('[data-voice-action="record"]').isDisabled(),true,'signed-out users cannot access account recordings');
    assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();}
});
