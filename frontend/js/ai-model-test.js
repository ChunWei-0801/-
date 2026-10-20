/* Public, synthetic-only local-model acceptance page. No account or ledger API. */
(function () {
  'use strict';
  var api = window.LocalAI, controller = null, generation = 0, running = false, failureDetails = null, statusValue = null;
  var ids = ['modelLoad','modelCancel','modelUnload','modelCache','modelStatus','modelProgress','modelInput','modelRun','modelBenchmark','modelOutput','modelMetrics','modelLanguage'];
  var ui = {}; ids.forEach(function (id) { ui[id] = document.getElementById(id); });
  var diagnostics = document.createElement('details'), diagnosticTitle = document.createElement('summary'), diagnosticNotice = document.createElement('p'), diagnosticRaw = document.createElement('pre');
  diagnostics.id='modelDiagnostics'; diagnostics.hidden=true; diagnosticRaw.id='modelRawOutput'; diagnosticRaw.setAttribute('data-i18n-skip','');
  diagnostics.append(diagnosticTitle,diagnosticNotice,diagnosticRaw); ui.modelOutput.insertAdjacentElement('afterend',diagnostics);
  function named(key) { return window.I18n && I18n.t ? I18n.t(key) : key; }
  function text(value) { return window.I18n && I18n.translate ? I18n.translate(value) : value; }
  function localizePlaceholders() {
    diagnosticTitle.textContent=named('aiTest.rawOutput'); diagnosticNotice.textContent=named('aiTest.rawOutputNotice');
    if(statusValue)renderStatus();
    if(failureDetails)renderFailure();
    [['modelOutput','尚未產生回覆。'],['modelMetrics','尚未完成真實推論，不顯示成功率。']].forEach(function (item) {
      var node=ui[item[0]];
      if(!node.dataset.actualResult){node.textContent=text(item[1]);}
    });
  }
  function renderStatus() { ui.modelStatus.textContent=statusValue.key ? named(statusValue.key) : text(statusValue.value); }
  function status(value, failed, key) { statusValue={value:value,key:key}; renderStatus(); ui.modelStatus.classList.toggle('error',!!failed); if(!failed)delete ui.modelStatus.dataset.errorCode; }
  function clearResults() { failureDetails=null; diagnostics.hidden=true; diagnostics.open=false; diagnosticRaw.textContent=''; ui.modelOutput.textContent='';ui.modelMetrics.textContent='';delete ui.modelOutput.dataset.actualResult;delete ui.modelMetrics.dataset.actualResult; }
  function safeUsage(usage) {
    if(!usage||typeof usage!=='object')return null; var result={};
    ['promptTokens','completionTokens','totalTokens','prompt_tokens','completion_tokens','total_tokens'].forEach(function(key){if(Number.isFinite(usage[key])&&usage[key]>=0)result[key]=usage[key];});
    return Object.keys(result).length?result:null;
  }
  function errorKey(code) {
    if(/^AI_(?:WEBGPU_UNAVAILABLE|GPU_UNAVAILABLE|GPU_TIMEOUT|WORKER_UNAVAILABLE|INSECURE_CONTEXT)$/.test(code))return 'aiTrial.unsupported';
    if(code==='AI_NO_DRAFT'||code==='AI_INVALID_DRAFT')return 'aiTest.invalidDraft';
    if(code==='AI_EMPTY_OUTPUT')return 'aiTest.noOutput';
    if(code==='AI_TRUNCATED')return 'aiTest.incomplete';
    if(code==='AI_CONTEXT_TOO_LARGE'||code==='AI_INPUT_TOO_LARGE')return 'aiTrial.tooLong';
    if(code==='AI_INVALID_INPUT')return 'aiTrial.enterText';
    if(code==='AI_CANCELLED')return 'aiTest.cancelled';
    if(code==='AI_TIMEOUT')return 'aiTest.timeout';
    if(code==='AI_BUSY')return 'aiTest.busy';
    return 'aiTest.runtimeFailure';
  }
  function renderFailure() {
    ui.modelMetrics.dataset.actualResult='true';
    ui.modelMetrics.textContent=named('aiTest.failedMetrics')+'\n'+JSON.stringify(failureDetails.measurement,null,2);
    ui.modelOutput.textContent=named(failureDetails.key); ui.modelOutput.dataset.actualResult='true';
    diagnosticRaw.textContent=failureDetails.rawOutput||''; diagnostics.hidden=!failureDetails.rawOutput;
  }
  function ready() { return api && api.getStatus().loaded; }
  function controls() {
    ui.modelLoad.disabled = running || ready(); ui.modelCancel.disabled = !running;
    ui.modelRun.disabled = ui.modelBenchmark.disabled = running || !ready();
    ui.modelCache.disabled = running; ui.modelInput.disabled = running;
  }
  function cancel() { generation++; if (controller) controller.abort(); controller=null; if(api)api.cancel(); running=false; ui.modelProgress.hidden=true; controls(); }
  function context() {
    var parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(function (part) { return [part.type,part.value]; }));
    var day = parts.year + '-' + parts.month + '-' + parts.day;
    return {today:day,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,currency:'TWD',categories:[{id:'FOOD',name:'餐飲',kind:'expense'},{id:'TRANSIT',name:'交通',kind:'expense'},{id:'SALARY',name:'薪資',kind:'income'},{id:'OTHER',name:'其他',kind:'expense'}]};
  }
  async function operation(work,kind) {
    if(running)return;
    var mine=++generation, started=performance.now(); controller=new AbortController(); running=true; controls();
    try { await work(mine,controller.signal); }
    catch(error) { if(mine===generation){
      var code=typeof error.code==='string'?error.code:'AI_ERROR',details=error.details&&typeof error.details==='object'?error.details:{},key=errorKey(code);
      // Never display arbitrary runtime error messages: they may contain user data or untranslated implementation details.
      status('',true,key);ui.modelStatus.dataset.errorCode=code;
      if(kind==='draft'||kind==='benchmark'){
        var state=api&&api.getStatus?api.getStatus():{};
        failureDetails={key:key,rawOutput:typeof details.rawOutput==='string'?details.rawOutput.slice(0,12000):'',measurement:{status:'failed',usableDraft:false,operation:kind,errorCode:code,model:typeof details.model==='string'?details.model.slice(0,120):state.model||null,elapsedMs:Number.isFinite(details.elapsedMs)&&details.elapsedMs>=0?details.elapsedMs:Math.round(performance.now()-started),usage:safeUsage(details.usage),finishReason:typeof details.finishReason==='string'?details.finishReason.slice(0,40):null,attempts:Number.isInteger(details.attempts)&&details.attempts>0?details.attempts:null}};
        renderFailure();
      } else {clearResults();}

    } }
    finally {if(mine===generation){controller=null;running=false;ui.modelProgress.hidden=true;controls();}}
  }
  function measure(result) { return {model:result.model,elapsedMs:result.elapsedMs,usage:safeUsage(result.usage),finishReason:result.finishReason,attempts:result.attempts}; }
  async function draft(input,signal) { return api.generate({task:'draft',input:input,context:context(),language:document.documentElement.lang||'zh-TW',signal:signal}); }
  ui.modelLoad.onclick=function(){operation(async function(mine,signal){
    if(!api)throw new Error(text('本機模型程式未載入，請重新整理後再試。'));
    status('正在檢查並載入模型…'); ui.modelProgress.hidden=false;
    await api.load({signal:signal,onProgress:function(value){if(mine!==generation)return;ui.modelProgress.value=Number(value.progress)||0;status(value.text||text('正在下載／載入模型…'));}});
    if(mine===generation)status('本機模型已就緒');
  });};
  ui.modelRun.onclick=function(){operation(async function(mine,signal){
    clearResults();status('本機 AI 正在整理…');
    var result=await draft(ui.modelInput.value,signal);if(mine!==generation)return;
    ui.modelOutput.dataset.actualResult=ui.modelMetrics.dataset.actualResult='true';
    ui.modelOutput.textContent=JSON.stringify(JSON.parse(result.text),null,2);ui.modelMetrics.textContent=JSON.stringify(measure(result),null,2);status('已完成真實模型推論，請核對草稿。');
  },'draft');};
  ui.modelBenchmark.onclick=function(){operation(async function(mine,signal){
    var cases=[{input:'今天早餐65元，午餐120元。',expected:[65,120],kind:'expense',category:'FOOD'},{input:'今天收到薪資30000元。',expected:[30000],kind:'income',category:'SALARY'}],results=[];
    clearResults();status('正在執行合成範例檢查…');
    for(var i=0;i<cases.length;i++){
      var result=await draft(cases[i].input,signal);if(mine!==generation)return;
      var value=JSON.parse(result.text),expected=cases[i].expected.slice().sort(function(a,b){return a-b;}),actual=value.items.map(function(item){return item.amount;}).sort(function(a,b){return a-b;});
      var passed=JSON.stringify(actual)===JSON.stringify(expected)&&value.items.every(function(item){return item.kind===cases[i].kind&&item.currency==='TWD'&&item.date===context().today&&item.category===cases[i].category;});
      results.push({syntheticCase:i+1,passed:passed,measurement:measure(result),output:value});
      ui.modelOutput.dataset.actualResult='true';ui.modelOutput.textContent=JSON.stringify(results,null,2);
    }
    ui.modelMetrics.dataset.actualResult='true';ui.modelMetrics.textContent=JSON.stringify({observedOnly:true,syntheticCases:results.length,passed:results.filter(function(item){return item.passed;}).length,measurements:results.map(function(item){return item.measurement;})},null,2);
    status('合成範例檢查完成；結果僅適用於這兩筆輸入。');
  },'benchmark');};
  ui.modelCancel.onclick=function(){cancel();clearResults();status('已取消；沒有寫入任何資料。');};
  ui.modelUnload.onclick=function(){cancel();if(api)api.unload();ui.modelInput.value='';clearResults();status('模型已卸載，本頁輸入與回覆已清除。');};
  ui.modelCache.onclick=function(){operation(async function(){if(api)await api.clearCache();clearResults();status('模型下載快取已清除。');});};
  window.addEventListener('pagehide',function(){cancel();ui.modelInput.value='';clearResults();});
  controls();
  if(window.I18n)Promise.resolve(I18n.ready).then(function(){ui.modelLanguage.innerHTML=I18n.renderLanguageSelect();localizePlaceholders();});
  window.addEventListener('fambudget:languagechange',localizePlaceholders);
})();
