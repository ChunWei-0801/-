/* Public, synthetic-only local-model acceptance page. No account or ledger API. */
(function () {
  'use strict';
  if(window.SafetyCenter)window.SafetyCenter.init();
  if(window.VoiceAccessibility)window.VoiceAccessibility.init();
  var api=window.LocalAI,controller=null,generation=0,running=false,failureDetails=null,statusValue=null,view=null,languageReady=false,clock=null,clockTimer=null,lastLoadMs=null;
  var ids=['modelLoad','modelCancel','modelUnload','modelCache','modelStatus','modelProgress','modelInput','modelRun','modelBenchmark','modelOutput','modelMetrics','modelMetricsSummary','modelTechnical','modelLanguage','modelTiming','modelCompare','modelExport'];
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
    if(statusValue)renderStatus();renderClock();
    if(view||failureDetails)renderResults();
    else{if(!ui.modelOutput.dataset.actualResult)ui.modelOutput.textContent=text('尚未產生回覆。');if(!ui.modelMetrics.dataset.actualResult){ui.modelMetrics.textContent='';ui.modelMetricsSummary.textContent=text('尚未完成真實推論，不顯示成功率。');}}
  }
  function renderStatus(){ui.modelStatus.textContent=statusValue.key?named(statusValue.key,statusValue.vars):text(statusValue.value);}
  function status(value,failed,key,vars){statusValue={value:value,key:key,vars:vars};renderStatus();ui.modelStatus.classList.toggle('error',!!failed);if(!failed)delete ui.modelStatus.dataset.errorCode;}
  function renderClock(){
    if(!ui.modelTiming)return;var parts=[];
    if(lastLoadMs!==null)parts.push(named('aiTest.loadElapsed',{seconds:(lastLoadMs/1000).toFixed(2)}));
    if(clock){var elapsed=(performance.now()-clock.started)/1000;parts.push(named(clock.done?'aiTest.stageElapsed':'aiTest.elapsedStage',{stage:named(clock.stage),seconds:(clock.done?clock.elapsedMs/1000:elapsed).toFixed(1)}));}
    ui.modelTiming.textContent=parts.join(' · ');ui.modelTiming.hidden=!parts.length;
  }
  function startClock(stage){stopClock();clock={stage:stage,started:performance.now(),done:false};renderClock();clockTimer=setInterval(renderClock,250);}
  function stopClock(){if(clockTimer!==null)clearInterval(clockTimer);clockTimer=null;if(clock&&!clock.done){clock.elapsedMs=performance.now()-clock.started;clock.done=true;}renderClock();}
  function setClockStage(stage){if(clock)clock.stage=stage;renderClock();}
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
  function fieldName(field){return named('aiTrial.'+(field==='classification'?'category':field));}
  function display(field,value){
    if(value===null||value===undefined||value==='')return named('aiTrial.unknown');
    if(field==='kind')return value==='income'?named('aiTrial.income'):value==='expense'?named('aiTrial.expense'):String(value);
    if(field==='category'){var categories={FOOD:'餐飲',TRANSIT:'交通',SALARY:'薪資',WINNINGS:'中獎收入',OTHER:'其他'};return categories[value]?text(categories[value]):String(value);}
    return String(value);
  }
  function rowChecks(normalization,index){
    var reasons=['OPTIONAL_MERCHANT_UNSUPPORTED','OPTIONAL_DATE_UNSUPPORTED','OPTIONAL_FIELD_EMPTY','SOURCE_KIND_CUE','SOURCE_CATEGORY_CUE','SOURCE_CATEGORY_AMBIGUOUS','SOURCE_CLASSIFICATION_UNCLEAR','SOURCE_CLASSIFICATION_UNVERIFIED','SOURCE_NONACTUAL_OR_AMBIGUOUS'];
    var notes=normalization&&Array.isArray(normalization.adjustments)?normalization.adjustments.filter(function(item){return item&&item.rowIndex===index&&['kind','category','merchant','date','amount','currency','classification'].includes(item.field)&&['clear','set','review'].includes(item.action)&&reasons.includes(item.reason);}).slice(0,30):[],latest={};
    notes.forEach(function(item){latest[item.field==='classification'?'category':item.field]=item;});return Object.keys(latest).map(function(field){return latest[field];});
  }
  function originalRowIndex(normalization,index){
    if(!normalization||!Array.isArray(normalization.rowMappings))return index;
    var entries=normalization.rowMappings.filter(function(item){return item&&item.draftIndex===index&&Number.isInteger(item.modelRowIndex)&&item.modelRowIndex>=0&&item.modelRowIndex<10;});return entries.length===1?entries[0].modelRowIndex:null;
  }
  function originalItem(modelDraft,normalization,index){
    var sourceIndex=originalRowIndex(normalization,index);return modelDraft&&Array.isArray(modelDraft.items)&&sourceIndex!==null?modelDraft.items[sourceIndex]:null;
  }
  function showExcluded(parent,normalization){
    var excluded=normalization&&Array.isArray(normalization.rejectedRows)?normalization.rejectedRows.filter(function(item){return item&&Number.isInteger(item.modelRowIndex)&&item.modelRowIndex>=0&&item.modelRowIndex<10;}).slice(0,10):[];if(!excluded.length)return;
    var notice=node('section',undefined,'note');notice.dataset.excludedCandidates='';notice.append(node('strong',named('aiTest.excludedTitle')),node('p',named('aiTest.excludedNotice',{count:excluded.length})));
    var list=node('ul');excluded.forEach(function(item){var why=item.reason==='SOURCE_NOT_FOUND'?'aiTest.excludedSource':['AMOUNT_NOT_IN_SOURCE','AMOUNT_BOUNDARY','EVIDENCE_REUSED'].includes(item.reason)?'aiTest.excludedAmount':'aiTest.excludedFields',line=node('li',named('aiTest.excludedRow',{index:item.modelRowIndex+1})+' '+named(why));line.dataset.excludedRow=String(item.modelRowIndex);list.append(line);});notice.append(list);parent.append(notice);
  }
  function showChecks(card,finalItem,originalItem,normalization,index){
    var checks=rowChecks(normalization,index);if(!checks.length)return;
    var notice=node('div',undefined,'note');notice.dataset.reviewChecks='';notice.append(node('strong',named('aiTest.reviewChecksTitle')));
    if(checks.some(function(item){return item.reason==='SOURCE_NONACTUAL_OR_AMBIGUOUS'||item.reason==='SOURCE_CLASSIFICATION_UNCLEAR';}))notice.append(node('p',named('aiTest.ambiguousSource')));
    if(originalItem&&(originalItem.kind!==finalItem.kind||originalItem.category!==finalItem.category)){
      notice.append(node('p',named('aiTest.originalChoice',{kind:display('kind',originalItem.kind),category:display('category',originalItem.category)})),node('p',named('aiTest.finalChoice',{kind:display('kind',finalItem.kind),category:display('category',finalItem.category)})));
    }
    var seen={};checks.forEach(function(item){var key=item.field+'|'+item.action;if(seen[key])return;seen[key]=true;notice.append(node('p',named(item.action==='review'?'aiTest.sourceUnverified':item.action==='clear'?'aiTest.sourceCleared':'aiTest.sourceChange',{field:fieldName(item.field)})));});card.append(notice);
  }
  function draftCard(item,index,originalItem,normalization){
    var card=node('article',undefined,'model-draft'),title=node('h4',named('aiTest.entryNumber',{index:index+1}));card.dataset.draftIndex=String(index);card.append(title);
    var values=node('dl');
    ['amount','kind','category','date','currency'].forEach(function(field){var pair=node('div');pair.append(node('dt',fieldName(field)),node('dd',display(field,item[field])));values.append(pair);});card.append(values);
    showChecks(card,item,originalItem,normalization,originalRowIndex(normalization,index));
    if(item.note)card.append(node('p',named('aiTrial.note')+'：'+String(item.note)));
    return card;
  }
  function differences(expected,actual){
    // Compare the actual output to fixed synthetic expectations; never correct or invent a model field.
    var remaining=actual.map(function(item,index){return {item:item&&typeof item==='object'&&!Array.isArray(item)?item:{},index:index};}),result=[];
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
    var title=node('h3',named('aiTest.caseNumber',{index:item.syntheticCase})+(item.promptProfile?' · '+profileLabel(item.promptProfile):'')),badge=node('span',named(item.state==='passed'?'aiTest.passed':item.state==='failed'?'aiTest.notPassed':item.state==='error'?'aiTest.caseError':item.state==='notrun'?'aiTest.caseNotRun':item.state==='cancelled'?'aiTest.caseCancelled':item.state==='running'?'aiTest.caseRunning':'aiTest.caseWaiting'),'model-case-state');
    title.append(document.createTextNode(' '),badge);card.append(title,node('p',item.input,'model-case-input'));
    if(item.output){
      showExcluded(card,item.normalization);
      var modelLine=node('p',named('aiTest.modelOnlyLabel')+'：'+(item.modelOnlyPassed===null?named('aiTest.scoreMissing'):named(item.modelOnlyPassed?'aiTest.passed':'aiTest.notPassed')),item.modelOnlyPassed===false?'error':'note');modelLine.dataset.reviewStage='model';card.append(modelLine);
      var finalLine=node('p',named('aiTest.assistedLabel')+'：'+named(item.passed?'aiTest.passed':'aiTest.notPassed'),'note');finalLine.dataset.reviewStage='assisted';card.append(finalLine);
      if(item.normalization&&item.normalization.sourceRuleAssisted)card.append(node('p',named('aiTest.sourceAssistBenchmark'),'note'));
      else if(item.normalization)card.append(node('p',named('aiTest.mappedDraft'),'note'));
      item.output.items.forEach(function(draft,index){card.append(draftCard(draft,index,originalItem(item.modelDraft,item.normalization,index),item.normalization));});
      if(item.modelOnlyDifferences&&item.modelOnlyDifferences.length){var originalList=node('ul',undefined,'model-differences model-only-differences');originalList.dataset.reviewStage='model';originalList.append(node('li',named('aiTest.modelOnlyLabel')));item.modelOnlyDifferences.forEach(function(diff){var message=diff.type?named(diff.type==='missing'?'aiTest.missingEntry':'aiTest.extraEntry',{index:diff.entry}):named('aiTest.fieldDifference',{index:diff.entry,field:fieldName(diff.field),expected:display(diff.field,diff.expected),actual:display(diff.field,diff.actual)});originalList.append(node('li',message));});card.append(originalList);}

      if(item.differences.length){var list=node('ul',undefined,'model-differences');item.differences.forEach(function(diff){var message=diff.type?named(diff.type==='missing'?'aiTest.missingEntry':'aiTest.extraEntry',{index:diff.entry}):named('aiTest.fieldDifference',{index:diff.entry,field:fieldName(diff.field),expected:display(diff.field,diff.expected),actual:display(diff.field,diff.actual)});list.append(node('li',message));});card.append(list);}
    }
    if(item.state==='error')card.append(node('p',named(item.errorKey||'aiTest.runtimeFailure'),'error'));if(item.state==='error'&&item.rawModelOutput){var rawDetails=node('details');rawDetails.append(node('summary',named('aiTest.rawOutput')),node('pre',item.rawModelOutput));card.append(rawDetails);}if(item.abstained)card.append(node('p',named('aiTest.noDraftExpected'),'note'));if(item.measurement){var measured=measurementLine(item.measurement);if(measured)card.append(node('p',measured,'note'));}
    return card;
  }
  function renderResults(){
    ui.modelOutput.replaceChildren();ui.modelOutput.dataset.actualResult=ui.modelMetrics.dataset.actualResult='true';ui.modelTechnical.hidden=false;
    if(view&&view.mode==='benchmark'){
      view.cases.forEach(function(item){ui.modelOutput.append(caseCard(item));});
      var completed=view.cases.filter(function(item){return !!item.observation&&['passed','failed','error'].includes(item.state);}).length,passed=view.cases.filter(function(item){return item.state==='passed';}).length;
      var observations=view.cases.filter(function(item){return !!item.observation;}).map(function(item){return item.observation;});
      ui.modelMetricsSummary.style.whiteSpace='pre-line';
      ui.modelMetricsSummary.textContent=named(view.cancelled?'aiTest.cancelledBenchmark':'aiTest.suiteSummary',{completed:completed,total:view.cases.length,passed:passed});
      var summaries={};['baseline','compact-v1'].forEach(function(profile){var rows=observations.filter(function(item){return item.promptProfile===profile;});if(!rows.length)return;var summary=window.LocalAIEvaluation.summarize(rows);summaries[profile]=summary;ui.modelMetricsSummary.textContent+='\n'+named('aiTest.profileScore',{profile:profileLabel(profile),model:summary.model.passed,assisted:summary.assisted.passed,total:summary.attempted});var group=summary.latency.warm,timing=group.requestMs.samples?group.requestMs:group.totalMs.samples?group.totalMs:group.elapsedMs;ui.modelMetricsSummary.textContent+='\n'+named('aiTest.profileTiming',{profile:profileLabel(profile),median:timing.median===null?named('aiTrial.noMeasurement'):(timing.median/1000).toFixed(2),samples:timing.samples});});
      ui.modelMetrics.textContent=JSON.stringify({observedOnly:true,completed:completed,total:view.cases.length,passed:passed,accuracyNotInferred:true,complete:!view.cancelled&&view.cases.every(function(item){return !!item.observation&&!['waiting','running','cancelled','notrun'].includes(item.state);}),summaries:summaries,cases:view.cases},null,2);
    }else if(view&&view.result){
      ui.modelOutput.append(node('p',named('aiTest.draftCount',{count:view.value.items.length}),'note'));showExcluded(ui.modelOutput,view.result.normalization);
      if(view.result.normalization)ui.modelOutput.append(node('p',named(view.result.normalization.sourceRuleAssisted?'aiTest.sourceAssistNotice':'aiTest.mappedDraft'),'note'));
      view.value.items.forEach(function(item,index){ui.modelOutput.append(draftCard(item,index,originalItem(view.result.modelDraft,view.result.normalization,index),view.result.normalization));});
      var modelWarnings=view.result.modelDraft&&Array.isArray(view.result.modelDraft.warnings)?view.result.modelDraft.warnings:view.value.warnings;
      if(Array.isArray(modelWarnings)&&modelWarnings.length){var notices=node('div',undefined,'note');notices.append(node('p',named('aiTrial.draftWarnings')));modelWarnings.forEach(function(warning){notices.append(node('p',warning));});ui.modelOutput.append(notices);}
      ui.modelMetricsSummary.textContent=measurementLine(measure(view.result));
      ui.modelMetrics.textContent=JSON.stringify({measurement:measure(view.result),rawModelOutput:view.result.rawModelOutput||view.result.text,modelDraft:view.result.modelDraft||null,normalizedDraft:view.value,normalization:view.result.normalization||null},null,2);
    }else if(failureDetails){ui.modelOutput.append(node('p',named(failureDetails.key),'error'));ui.modelMetricsSummary.textContent=named('aiTest.failedMetrics');ui.modelMetrics.textContent=JSON.stringify(failureDetails.measurement,null,2);}
    var rawFailure=failureDetails&&failureDetails.rawOutput||'',revealFailure=!!rawFailure&&diagnostics.hidden;
    diagnosticRaw.textContent=rawFailure;diagnostics.hidden=!rawFailure;
    if(revealFailure)diagnostics.open=true;
  }
  function ready(){return api&&api.getStatus().loaded;}
  function controls(){ui.modelLoad.disabled=!languageReady||running||ready();ui.modelCancel.disabled=!running;ui.modelRun.disabled=!languageReady||running||!ready();ui.modelBenchmark.disabled=ui.modelCompare.disabled=!languageReady||running||!ready()||!window.LocalAIEvaluation;ui.modelExport.disabled=running||!view||view.mode!=='benchmark'||!view.cases.some(function(item){return !!item.observation;});ui.modelCache.disabled=!languageReady||running;ui.modelInput.disabled=running;}
  function cancel(){generation++;if(controller)controller.abort();controller=null;if(api)api.cancel();running=false;stopClock();ui.modelProgress.hidden=true;controls();}
  function context(){
    var parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(function(part){return [part.type,part.value];}));
    var today=parts.year+'-'+parts.month+'-'+parts.day;return window.LocalAIEvaluation?LocalAIEvaluation.context({today:today}):{today:today,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,currency:'TWD',categories:[{id:'FOOD',name:'餐飲',kind:'expense'},{id:'TRANSIT',name:'交通',kind:'expense'},{id:'SALARY',name:'薪資',kind:'income'},{id:'OTHER',name:'其他',kind:'expense'}]};
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
    }}finally{if(mine===generation){controller=null;running=false;stopClock();ui.modelProgress.hidden=true;controls();}}
  }
  function measure(result){
    var measured=window.LocalAIEvaluation?LocalAIEvaluation.safeMeasurement(result,{phase:'warm'}):{model:result.model,elapsedMs:result.elapsedMs,usage:safeUsage(result.usage),finishReason:result.finishReason,attempts:result.attempts};
    return measured;
  }
  function measurementLine(measured){var lines=[];var completion=Number.isFinite(measured.requestMs)?measured.requestMs:Number.isFinite(measured.totalMs)?measured.totalMs:measured.elapsedMs;if(Number.isFinite(completion))lines.push(named('aiTest.generationElapsed',{seconds:(completion/1000).toFixed(2)}));if(Number.isFinite(measured.firstTokenMs))lines.push(named('aiTest.firstTokenElapsed',{seconds:(measured.firstTokenMs/1000).toFixed(2)}));return lines.join(' · ');}
  function profileLabel(profile){return named(profile==='baseline'?'aiTest.baselineLabel':'aiTest.compactLabel');}
  async function draft(input,signal,profile){return api.generate({task:'draft',input:input,context:context(),language:document.documentElement.lang||'zh-TW',signal:signal,promptProfile:profile||'compact-v1'});}
  ui.modelLoad.onclick=function(){operation(async function(mine,signal){
    if(!api)throw new Error('Local model program unavailable');startClock('aiTrial.checking');status('正在檢查並載入模型…');ui.modelProgress.hidden=false;ui.modelProgress.removeAttribute('value');var started=performance.now();
    await api.load({signal:signal,onProgress:function(value){if(mine!==generation)return;setClockStage('aiTrial.loading');var fraction=typeof value==='number'?value:value&&(value.progress!=null?value.progress:value.fraction);if(Number.isFinite(fraction)){ui.modelProgress.value=Math.max(0,Math.min(1,fraction>1?fraction/100:fraction));}else ui.modelProgress.removeAttribute('value');status(value&&value.text||text('正在下載／載入模型…'));}});
    if(mine===generation){lastLoadMs=performance.now()-started;clock=null;status('本機模型已就緒');}
  });};
  ui.modelRun.onclick=function(){operation(async function(mine,signal){clearResults();startClock('aiTrial.running');status('本機 AI 正在整理…');var result=await draft(ui.modelInput.value,signal);if(mine!==generation)return;view={mode:'draft',result:result,value:JSON.parse(result.text)};renderResults();status('已完成真實模型推論，請核對草稿。');},'draft');};
  function emptyDetected(error){var details=error&&error.details;if(!details||error.code!=='AI_NO_DRAFT'||!details.validation||details.validation.reason!=='NO_TRANSACTIONS')return false;try{var parsed=JSON.parse(details.rawOutput);return !!parsed&&Array.isArray(parsed.items)&&parsed.items.length===0;}catch(_){return false;}}
  function recordResult(item,result){
    item.output=JSON.parse(result.text);item.rawModelOutput=result.rawModelOutput||result.text;item.normalization=result.normalization||null;item.modelDraft=result.modelDraft&&Array.isArray(result.modelDraft.items)?result.modelDraft:null;item.measurement=measure(result);
    item.modelOnlyDifferences=item.modelDraft?differences(item.expected,item.modelDraft.items):null;item.modelOnlyPassed=item.modelDraft?LocalAIEvaluation.score(item.expectation,item.modelDraft.items).caseExact:null;item.differences=differences(item.expected,item.output.items);item.passed=LocalAIEvaluation.score(item.expectation,item.output.items).caseExact;item.state=item.passed?'passed':'failed';
    item.observation={caseId:item.caseId,split:item.split,expected:item.expectation,modelItems:item.modelDraft?item.modelDraft.items:null,assistedItems:item.output.items,measurement:item.measurement,status:'completed',promptProfile:item.promptProfile};
  }
  async function runSuite(compare){operation(async function(mine,signal){
    clearResults();startClock('aiTrial.running');var today=context().today,cases=LocalAIEvaluation.cases({split:'quick',today:today}),planned=[];
    cases.forEach(function(entry,index){var profiles=compare?(index%2?['compact-v1','baseline']:['baseline','compact-v1']):['compact-v1'];profiles.forEach(function(profile){planned.push({syntheticCase:planned.length+1,caseId:entry.id,split:entry.split,input:entry.input,state:'waiting',expected:entry.expected.items,expectation:entry.expected,promptProfile:profile});});});
    view={mode:'benchmark',current:0,cases:planned,compare:compare,cancelled:false};status('',false,'aiTest.suiteRunning');renderResults();
    for(var i=0;i<planned.length;i++){
      if(mine!==generation)return;view.current=i;var item=planned[i];item.state='running';renderResults();startClock('aiTrial.running');
      try{var result=await draft(item.input,signal,item.promptProfile);if(mine!==generation)return;recordResult(item,result);}
      catch(error){if(mine!==generation)return;var details=error&&error.details||{},empty=emptyDetected(error);item.measurement=measure(details);item.rawModelOutput=typeof details.rawOutput==='string'?details.rawOutput.slice(0,12000):'';item.errorKey=errorKey(error&&error.code||'AI_ERROR');item.state=empty&&item.expected.length===0?'passed':empty?'failed':'error';item.passed=item.state==='passed';item.abstained=empty;item.modelOnlyPassed=empty?item.expected.length===0:null;item.observation={caseId:item.caseId,split:item.split,expected:item.expectation,modelItems:null,assistedItems:null,measurement:item.measurement,status:'failed',errorCode:error&&error.code||'AI_ERROR',emptyDetected:empty,promptProfile:item.promptProfile};}
      renderResults();
      // A failed draft does not erase prior measurements or prevent later fixed cases.
      if(!ready()&&i+1<planned.length){for(var pending=i+1;pending<planned.length;pending++){planned[pending].state='notrun';}break;}
    }
    renderResults();status('',false,'aiTest.suiteComplete');
  },'benchmark');}
  ui.modelBenchmark.onclick=function(){runSuite(false);};
  ui.modelCompare.onclick=function(){runSuite(true);};
  ui.modelExport.onclick=function(){if(!view||view.mode!=='benchmark'||!window.LocalAIEvaluation)return;var rows=view.cases.filter(function(item){return !!item.observation;}).map(function(item){return item.observation;}),report=LocalAIEvaluation.exportReport(rows,{suite:'quick'}),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=node('a');link.href=url;link.download='local-ai-synthetic-evaluation.json';link.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);};
  ui.modelCancel.onclick=function(){var partial=view&&view.mode==='benchmark'?view:null;cancel();if(partial){partial.cancelled=true;partial.cases.forEach(function(item){if(item.state==='running'){item.observation={caseId:item.caseId,split:item.split,expected:item.expectation,measurement:{},status:'cancelled',errorCode:'AI_CANCELLED',promptProfile:item.promptProfile};item.state='cancelled';}else if(item.state==='waiting')item.state='notrun';});failureDetails=null;renderResults();controls();status('',false,'aiTest.cancelledBenchmark',{completed:partial.cases.filter(function(item){return item.state==='passed'||item.state==='failed'||item.state==='error';}).length});}else{clearResults();status('已取消；沒有寫入任何資料。');}};
  ui.modelUnload.onclick=function(){cancel();if(api)api.unload();clock=null;lastLoadMs=null;renderClock();ui.modelInput.value='';clearResults();status('模型已卸載，本頁輸入與回覆已清除。');};
  ui.modelCache.onclick=function(){operation(async function(){if(api)await api.clearCache();clock=null;lastLoadMs=null;renderClock();clearResults();status('模型下載快取已清除。');});};
  window.addEventListener('pagehide',function(){cancel();ui.modelInput.value='';clearResults();});controls();
  if(window.I18n)Promise.resolve(I18n.ready).then(function(){languageReady=true;ui.modelLanguage.innerHTML=I18n.renderLanguageSelect();localizePlaceholders();controls();});else{languageReady=true;controls();}
  window.addEventListener('fambudget:languagechange',localizePlaceholders);
})();
