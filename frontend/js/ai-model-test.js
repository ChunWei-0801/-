/* Public, synthetic-only local-model acceptance page. No account or ledger API. */
(function () {
  'use strict';
  var api = window.LocalAI, controller = null, generation = 0, running = false;
  var ids = ['modelLoad','modelCancel','modelUnload','modelCache','modelStatus','modelProgress','modelInput','modelRun','modelBenchmark','modelOutput','modelMetrics','modelLanguage'];
  var ui = {}; ids.forEach(function (id) { ui[id] = document.getElementById(id); });
  function text(value) { return window.I18n && I18n.translate ? I18n.translate(value) : value; }
  function localizePlaceholders() {
    [['modelOutput','尚未產生回覆。'],['modelMetrics','尚未完成真實推論，不顯示成功率。']].forEach(function (item) {
      var node=ui[item[0]];
      if(!node.dataset.actualResult){node.textContent=text(item[1]);}
    });
  }
  function status(value, failed) { ui.modelStatus.textContent = text(value); ui.modelStatus.classList.toggle('error',!!failed); if(!failed)delete ui.modelStatus.dataset.errorCode; }
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
  async function operation(work) {
    if(running)return;
    var mine=++generation; controller=new AbortController(); running=true; controls();
    try { await work(mine,controller.signal); }
    catch(error) { if(mine===generation){
      ui.modelOutput.textContent='';
      var deviceFailure=/^AI_(?:WEBGPU_UNAVAILABLE|GPU_UNAVAILABLE|WORKER_UNAVAILABLE|INSECURE_CONTEXT)$/.test(error.code||'');
      var message=deviceFailure&&window.I18n?I18n.t('aiTrial.unsupported'):error.message;
      status(message,true);ui.modelStatus.dataset.errorCode=error.code||'AI_ERROR';
    } }
    finally {if(mine===generation){controller=null;running=false;ui.modelProgress.hidden=true;controls();}}
  }
  function measure(result) { return {model:result.model,elapsedMs:result.elapsedMs,usage:result.usage,finishReason:result.finishReason}; }
  async function draft(input,signal) { return api.generate({task:'draft',input:input,context:context(),language:document.documentElement.lang||'zh-TW',signal:signal}); }
  ui.modelLoad.onclick=function(){operation(async function(mine,signal){
    if(!api)throw new Error(text('本機模型程式未載入，請重新整理後再試。'));
    status('正在檢查並載入模型…'); ui.modelProgress.hidden=false;
    await api.load({signal:signal,onProgress:function(value){if(mine!==generation)return;ui.modelProgress.value=Number(value.progress)||0;status(value.text||text('正在下載／載入模型…'));}});
    if(mine===generation)status('本機模型已就緒');
  });};
  ui.modelRun.onclick=function(){operation(async function(mine,signal){
    ui.modelOutput.textContent='';status('本機 AI 正在整理…');
    var result=await draft(ui.modelInput.value,signal);if(mine!==generation)return;
    ui.modelOutput.dataset.actualResult=ui.modelMetrics.dataset.actualResult='true';
    ui.modelOutput.textContent=JSON.stringify(JSON.parse(result.text),null,2);ui.modelMetrics.textContent=JSON.stringify(measure(result),null,2);status('已完成真實模型推論，請核對草稿。');
  });};
  ui.modelBenchmark.onclick=function(){operation(async function(mine,signal){
    var cases=[{input:'今天早餐65元，午餐120元。',expected:[65,120],kind:'expense',category:'FOOD'},{input:'今天收到薪資30000元。',expected:[30000],kind:'income',category:'SALARY'}],results=[];
    ui.modelOutput.textContent='';status('正在執行合成範例檢查…');
    for(var i=0;i<cases.length;i++){
      var result=await draft(cases[i].input,signal);if(mine!==generation)return;
      var value=JSON.parse(result.text),expected=cases[i].expected.slice().sort(function(a,b){return a-b;}),actual=value.items.map(function(item){return item.amount;}).sort(function(a,b){return a-b;});
      var passed=JSON.stringify(actual)===JSON.stringify(expected)&&value.items.every(function(item){return item.kind===cases[i].kind&&item.currency==='TWD'&&item.date===context().today&&item.category===cases[i].category;});
      results.push({syntheticCase:i+1,passed:passed,measurement:measure(result),output:value});
      ui.modelOutput.dataset.actualResult='true';ui.modelOutput.textContent=JSON.stringify(results,null,2);
    }
    ui.modelMetrics.dataset.actualResult='true';ui.modelMetrics.textContent=JSON.stringify({observedOnly:true,syntheticCases:results.length,passed:results.filter(function(item){return item.passed;}).length,measurements:results.map(function(item){return item.measurement;})},null,2);
    status('合成範例檢查完成；結果僅適用於這兩筆輸入。');
  });};
  ui.modelCancel.onclick=function(){cancel();ui.modelOutput.textContent='';status('已取消；沒有寫入任何資料。');};
  ui.modelUnload.onclick=function(){cancel();if(api)api.unload();ui.modelInput.value='';ui.modelOutput.textContent='';ui.modelMetrics.textContent='';delete ui.modelOutput.dataset.actualResult;delete ui.modelMetrics.dataset.actualResult;status('模型已卸載，本頁輸入與回覆已清除。');};
  ui.modelCache.onclick=function(){operation(async function(){if(api)await api.clearCache();status('模型下載快取已清除。');});};
  window.addEventListener('pagehide',function(){cancel();ui.modelInput.value='';ui.modelOutput.textContent='';ui.modelMetrics.textContent='';});
  controls();
  if(window.I18n)Promise.resolve(I18n.ready).then(function(){ui.modelLanguage.innerHTML=I18n.renderLanguageSelect();localizePlaceholders();});
  window.addEventListener('fambudget:languagechange',localizePlaceholders);
})();
