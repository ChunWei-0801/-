/* Public, synthetic-only local-model acceptance page. No account or ledger API. */
(function () {
  'use strict';
  var api=window.LocalAI,controller=null,generation=0,running=false,failureDetails=null,statusValue=null,view=null,languageReady=false;
  var ids=['modelLoad','modelCancel','modelUnload','modelCache','modelStatus','modelProgress','modelInput','modelRun','modelBenchmark','modelOutput','modelMetrics','modelMetricsSummary','modelTechnical','modelLanguage'];
  var ui={};ids.forEach(function(id){ui[id]=document.getElementById(id);});
  var diagnostics=document.createElement('details'),diagnosticTitle=document.createElement('summary'),diagnosticNotice=document.createElement('p'),diagnosticRaw=document.createElement('pre');
  diagnostics.id='modelDiagnostics';diagnostics.className='model-diagnostics';diagnostics.hidden=true;diagnosticTitle.textContent='查看模型原始回覆（未通過草稿驗證）';diagnosticTitle.setAttribute('data-i18n','aiTest.rawOutput');diagnosticTitle.setAttribute('data-i18n-fallback',diagnosticTitle.textContent);diagnosticNotice.textContent='原始回覆只保留在本頁，可能包含你的輸入內容；請勿公開分享。';diagnosticNotice.setAttribute('data-i18n','aiTest.rawOutputNotice');diagnosticNotice.setAttribute('data-i18n-fallback',diagnosticNotice.textContent);diagnosticRaw.id='modelRawOutput';diagnosticRaw.setAttribute('data-i18n-skip','');
  diagnostics.append(diagnosticTitle,diagnosticNotice,diagnosticRaw);ui.modelOutput.insertAdjacentElement('afterend',diagnostics);
  function named(key,vars){return window.I18n&&I18n.t?I18n.t(key,vars):key;}
  function text(value){return window.I18n&&I18n.translate?I18n.translate(value):value;}
  function node(tag,value,className){var result=document.createElement(tag);if(value!==undefined)result.textContent=String(value);if(className)result.className=className;return result;}
  function localizePlaceholders(){
    // Translate after the stable ready promise; inline headings remain readable if a pack is missing.
    if(window.I18n&&I18n.render){I18n.render(diagnostics);I18n.render(ui.modelTechnical);}
    if(statusValue)renderStatus();
    if(view||failureDetails)renderResults();
    else{if(!ui.modelOutput.dataset.actualResult)ui.modelOutput.textContent=text('尚未產生回覆。');if(!ui.modelMetrics.dataset.actualResult){ui.modelMetrics.textContent='';ui.modelMetricsSummary.textContent=text('尚未完成真實推論，不顯示成功率。');}}
  }
  function renderStatus(){ui.modelStatus.textContent=statusValue.key?named(statusValue.key,statusValue.vars):text(statusValue.value);}
  function status(value,failed,key,vars){statusValue={value:value,key:key,vars:vars};renderStatus();ui.modelStatus.classList.toggle('error',!!failed);if(!failed)delete ui.modelStatus.dataset.errorCode;}
  function clearResults(){
    failureDetails=null;view=null;diagnostics.hidden=true;diagnostics.open=false;diagnosticRaw.textContent='';
    ui.modelOutput.replaceChildren();ui.modelMetrics.textContent='';ui.modelMetricsSummary.textContent='';ui.modelTechnical.open=false;ui.modelTechnical.hidden=true;
    delete ui.modelOutput.dataset.actualResult;delete ui.modelMetrics.dataset.actualResult;
  }
  function safeUsage(usage){
    if(!usage||typeof usage!=='object')return null;var result={};
    ['promptTokens','completionTokens','totalTokens','prompt_tokens','completion_tokens','total_tokens'].forEach(function(key){if(Number.isFinite(usage[key])&&usage[key]>=0)result[key]=usage[key];});
    return Object.keys(result).length?result:null;
  }
  function errorKey(code){
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
  function fieldName(field){return named('aiTrial.'+field);}
  function display(field,value){
    if(value===null||value===undefined||value==='')return named('aiTrial.unknown');
    if(field==='kind')return value==='income'?named('aiTrial.income'):value==='expense'?named('aiTrial.expense'):String(value);
    if(field==='category'){var categories={FOOD:'餐飲',TRANSIT:'交通',SALARY:'薪資',OTHER:'其他'};return categories[value]?text(categories[value]):String(value);}
    return String(value);
  }
  function draftCard(item,index){
    var card=node('article',undefined,'model-draft'),title=node('h4',named('aiTest.entryNumber',{index:index+1}));card.dataset.draftIndex=String(index);card.append(title);
    var values=node('dl');
    ['amount','kind','category','date','currency'].forEach(function(field){var pair=node('div');pair.append(node('dt',fieldName(field)),node('dd',display(field,item[field])));values.append(pair);});card.append(values);
    if(item.note)card.append(node('p',named('aiTrial.note')+'：'+String(item.note)));
    return card;
  }
  function differences(expected,actual){
    // Compare the actual output to fixed synthetic expectations; never correct or invent a model field.
    var remaining=actual.map(function(item,index){return {item:item,index:index};}),result=[];
    expected.forEach(function(wanted,index){
      var found=remaining.findIndex(function(candidate){return candidate.item.amount===wanted.amount;});if(found<0&&remaining.length)found=0;
      if(found<0){result.push({entry:index+1,type:'missing'});return;}
      var observed=remaining.splice(found,1)[0].item;
      ['amount','kind','category','date','currency'].forEach(function(field){if(observed[field]!==wanted[field])result.push({entry:index+1,field:field,expected:wanted[field],actual:observed[field]});});
    });
    remaining.forEach(function(extra){result.push({entry:extra.index+1,type:'extra'});});return result;
  }
  function caseCard(item){
    var card=node('article',undefined,'model-case '+(item.state==='passed'?'passed':item.state==='failed'||item.state==='error'?'failed':''));card.dataset.syntheticCase=String(item.syntheticCase);card.dataset.caseState=item.state;
    var title=node('h3',named('aiTest.caseNumber',{index:item.syntheticCase})),badge=node('span',named(item.state==='passed'?'aiTest.passed':item.state==='failed'?'aiTest.notPassed':item.state==='error'?'aiTest.caseError':item.state==='running'?'aiTest.caseRunning':'aiTest.caseWaiting'),'model-case-state');
    title.append(document.createTextNode(' '),badge);card.append(title,node('p',item.input,'model-case-input'));
    if(item.output){if(item.normalization)card.append(node('p',named('aiTest.mappedDraft'),'note'));item.output.items.forEach(function(draft,index){card.append(draftCard(draft,index));});
      if(item.differences.length){var list=node('ul',undefined,'model-differences');item.differences.forEach(function(diff){var message=diff.type?named(diff.type==='missing'?'aiTest.missingEntry':'aiTest.extraEntry',{index:diff.entry}):named('aiTest.fieldDifference',{index:diff.entry,field:fieldName(diff.field),expected:display(diff.field,diff.expected),actual:display(diff.field,diff.actual)});list.append(node('li',message));});card.append(list);}
    }
    if(item.state==='error'&&failureDetails)card.append(node('p',named(failureDetails.key),'error'));
    return card;
  }
  function renderResults(){
    ui.modelOutput.replaceChildren();ui.modelOutput.dataset.actualResult=ui.modelMetrics.dataset.actualResult='true';ui.modelTechnical.hidden=false;
    if(view&&view.mode==='benchmark'){
      view.cases.forEach(function(item){ui.modelOutput.append(caseCard(item));});
      var completed=view.cases.filter(function(item){return item.state==='passed'||item.state==='failed';}).length,passed=view.cases.filter(function(item){return item.state==='passed';}).length;
      var key=failureDetails?'aiTest.partialBenchmark':running&&completed<view.cases.length?'aiTest.benchmarkProgress':'aiTest.benchmarkSummary';
      ui.modelMetricsSummary.textContent=named(key,{completed:completed,total:view.cases.length,passed:passed,index:view.current+1});
      ui.modelMetrics.textContent=JSON.stringify({observedOnly:true,completed:completed,total:view.cases.length,passed:passed,complete:!failureDetails&&completed===view.cases.length,cases:view.cases,failure:failureDetails&&failureDetails.measurement||null},null,2);
    }else if(view&&view.result){
      if(view.result.normalization)ui.modelOutput.append(node('p',named('aiTest.mappedDraft'),'note'));
      view.value.items.forEach(function(item,index){ui.modelOutput.append(draftCard(item,index));});
      if(Array.isArray(view.value.warnings)&&view.value.warnings.length){var notices=node('div',undefined,'note');notices.append(node('p',named('aiTrial.draftWarnings')));view.value.warnings.forEach(function(warning){notices.append(node('p',warning));});ui.modelOutput.append(notices);}
      ui.modelMetricsSummary.textContent=named('aiTest.draftMeasurement',{seconds:(view.result.elapsedMs/1000).toFixed(2)});
      ui.modelMetrics.textContent=JSON.stringify({measurement:measure(view.result),rawModelOutput:view.result.rawModelOutput||view.result.text,normalizedDraft:view.value,normalization:view.result.normalization||null},null,2);
    }else if(failureDetails){ui.modelOutput.append(node('p',named(failureDetails.key),'error'));ui.modelMetricsSummary.textContent=named('aiTest.failedMetrics');ui.modelMetrics.textContent=JSON.stringify(failureDetails.measurement,null,2);}
    var rawFailure=failureDetails&&failureDetails.rawOutput||'',revealFailure=!!rawFailure&&diagnostics.hidden;
    diagnosticRaw.textContent=rawFailure;diagnostics.hidden=!rawFailure;
    if(revealFailure)diagnostics.open=true;
  }
  function ready(){return api&&api.getStatus().loaded;}
  function controls(){ui.modelLoad.disabled=!languageReady||running||ready();ui.modelCancel.disabled=!running;ui.modelRun.disabled=ui.modelBenchmark.disabled=!languageReady||running||!ready();ui.modelCache.disabled=!languageReady||running;ui.modelInput.disabled=running;}
  function cancel(){generation++;if(controller)controller.abort();controller=null;if(api)api.cancel();running=false;ui.modelProgress.hidden=true;controls();}
  function context(){
    var parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(function(part){return [part.type,part.value];}));
    return {today:parts.year+'-'+parts.month+'-'+parts.day,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,currency:'TWD',categories:[{id:'FOOD',name:'餐飲',kind:'expense'},{id:'TRANSIT',name:'交通',kind:'expense'},{id:'SALARY',name:'薪資',kind:'income'},{id:'OTHER',name:'其他',kind:'expense'}]};
  }
  async function operation(work,kind){
    if(running)return;var mine=++generation,started=performance.now();controller=new AbortController();running=true;controls();
    try{await work(mine,controller.signal);}
    catch(error){if(mine===generation){
      var code=typeof error.code==='string'?error.code:'AI_ERROR',details=error.details&&typeof error.details==='object'?error.details:{},key=errorKey(code);
      // Runtime messages may contain user data; only known localized guidance is displayed.
      status('',true,key);ui.modelStatus.dataset.errorCode=code;
      if(kind==='draft'||kind==='benchmark'){
        var state=api&&api.getStatus?api.getStatus():{};
        failureDetails={key:key,rawOutput:typeof details.rawOutput==='string'?details.rawOutput.slice(0,12000):'',measurement:{status:'failed',usableDraft:false,operation:kind,errorCode:code,model:typeof details.model==='string'?details.model.slice(0,120):state.model||null,elapsedMs:Number.isFinite(details.elapsedMs)&&details.elapsedMs>=0?details.elapsedMs:Math.round(performance.now()-started),usage:safeUsage(details.usage),finishReason:typeof details.finishReason==='string'?details.finishReason.slice(0,40):null,attempts:Number.isInteger(details.attempts)&&details.attempts>0?details.attempts:null,validation:details.validation||null}};
        if(view&&view.mode==='benchmark')view.cases[view.current].state='error';
        renderResults();
      }else clearResults();
    }}finally{if(mine===generation){controller=null;running=false;ui.modelProgress.hidden=true;controls();}}
  }
  function measure(result){return {model:result.model,elapsedMs:result.elapsedMs,usage:safeUsage(result.usage),finishReason:result.finishReason,attempts:result.attempts};}
  async function draft(input,signal){return api.generate({task:'draft',input:input,context:context(),language:document.documentElement.lang||'zh-TW',signal:signal});}
  ui.modelLoad.onclick=function(){operation(async function(mine,signal){if(!api)throw new Error('Local model program unavailable');status('正在檢查並載入模型…');ui.modelProgress.hidden=false;await api.load({signal:signal,onProgress:function(value){if(mine!==generation)return;ui.modelProgress.value=Number(value.progress)||0;status(value.text||text('正在下載／載入模型…'));}});if(mine===generation)status('本機模型已就緒');});};
  ui.modelRun.onclick=function(){operation(async function(mine,signal){clearResults();status('本機 AI 正在整理…');var result=await draft(ui.modelInput.value,signal);if(mine!==generation)return;view={mode:'draft',result:result,value:JSON.parse(result.text)};renderResults();status('已完成真實模型推論，請核對草稿。');},'draft');};
  ui.modelBenchmark.onclick=function(){operation(async function(mine,signal){
    clearResults();var today=context().today;
    view={mode:'benchmark',current:0,cases:[{syntheticCase:1,input:'今天早餐65元，午餐120元。',state:'running',expected:[65,120].map(function(amount){return {amount:amount,kind:'expense',category:'FOOD',date:today,currency:'TWD'};})},{syntheticCase:2,input:'今天收到薪資30000元。',state:'waiting',expected:[{amount:30000,kind:'income',category:'SALARY',date:today,currency:'TWD'}]}]};
    status('正在執行合成範例檢查…');renderResults();
    for(var i=0;i<view.cases.length;i++){
      view.current=i;var item=view.cases[i];item.state='running';renderResults();
      var result=await draft(item.input,signal);if(mine!==generation)return;
      item.output=JSON.parse(result.text);item.rawModelOutput=result.rawModelOutput||result.text;item.normalization=result.normalization||null;item.measurement=measure(result);item.differences=differences(item.expected,item.output.items);item.passed=item.differences.length===0;item.state=item.passed?'passed':'failed';renderResults();
    }
    var allPassed=view.cases.every(function(item){return item.passed;});
    if(allPassed)status('合成範例檢查完成；結果僅適用於這兩筆輸入。');
    else{status('',true,'aiTest.benchmarkMismatch');ui.modelStatus.dataset.errorCode='AI_BENCHMARK_MISMATCH';}
  },'benchmark');};
  ui.modelCancel.onclick=function(){cancel();clearResults();status('已取消；沒有寫入任何資料。');};
  ui.modelUnload.onclick=function(){cancel();if(api)api.unload();ui.modelInput.value='';clearResults();status('模型已卸載，本頁輸入與回覆已清除。');};
  ui.modelCache.onclick=function(){operation(async function(){if(api)await api.clearCache();clearResults();status('模型下載快取已清除。');});};
  window.addEventListener('pagehide',function(){cancel();ui.modelInput.value='';clearResults();});controls();
  if(window.I18n)Promise.resolve(I18n.ready).then(function(){languageReady=true;ui.modelLanguage.innerHTML=I18n.renderLanguageSelect();localizePlaceholders();controls();});else{languageReady=true;controls();}
  window.addEventListener('fambudget:languagechange',localizePlaceholders);
})();
