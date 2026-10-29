/* Controlled, manual local-model comparison using fixed fictional facts.
 * No account/API adapter, credentials, arbitrary input or persistence. Export
 * contains measurements/ratings only; never raw model answers or ledger data.
 */
(function(g){
  'use strict';
  var s={data:null,current:null,retrieval:null,corpusVersion:null,busy:false,job:0,abort:null,pending:null,records:[],last:{},nextId:0,closed:false,loadMs:null};
  var labels={targetTwd:'目標金額 TWD',savedTwd:'已存金額 TWD',gapTwd:'資金缺口 TWD',remainingDays:'剩餘天數',contributionMonths:'投入期數（月）',requiredMonthlyTwd:'每月所需 TWD',weeklyAllowanceReserveTwd:'每月零用錢預留 TWD',recordedMonthlyNetTwd:'已記錄月結餘 TWD',availableMonthlyTwd:'每月可投入 TWD',capacitySource:'可投入金額依據',transactionCount:'示範交易筆數'};
  function q(selector){return document.querySelector(selector);}
  function el(tag,text,cls){var node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;return node;}
  function status(text,error){var node=q('[data-re-model-status]');node.textContent=text;node.classList.toggle('re-error',!!error);}
  function finite(n){return typeof n==='number'&&Number.isFinite(n)&&n>=0?Math.round(n):null;}
  function now(){return g.performance&&typeof g.performance.now==='function'?g.performance.now():Date.now();}
  function runtime(){return g.LocalAI&&typeof g.LocalAI.status==='function'?g.LocalAI.status():{};}
  function error(code,message){var value=new Error(message||code);value.code=code;return value;}
  function ready(){return !!s.data&&!!s.current&&!!s.retrieval&&!s.busy&&!s.closed&&q('[data-re-consent]').checked&&runtime().loaded===true;}
  function controls(){
    ['baseline','rag'].forEach(function(mode){q('[data-re-action="run-'+mode+'"]').disabled=!ready();});
    q('[data-re-action="load"]').disabled=s.busy;q('[data-re-action="unload"]').disabled=s.busy;q('[data-re-case]').disabled=s.busy||!s.data;
    q('[data-re-action="cancel"]').hidden=!s.busy;q('[data-re-action="download"]').disabled=s.busy||!s.records.length;
    q('[data-re-summary]').textContent='完成 '+s.records.filter(function(r){return r.status==='completed';}).length+' 次、失敗／取消 '+s.records.filter(function(r){return r.status==='failed'||r.status==='cancelled';}).length+' 次、人工完成兩項評分 '+s.records.filter(function(r){return r.status==='completed'&&r.rating.correct!==null&&r.rating.supported!==null;}).length+' 次。';
  }
  function metadata(value){
    value=value||{};var timing=value.timing&&typeof value.timing==='object'?value.timing:{},usage=value.usage&&typeof value.usage==='object'?value.usage:{};
    function used(a,b){return finite(usage[a])===null?finite(usage[b]):finite(usage[a]);}
    return {model:typeof value.model==='string'?value.model.slice(0,120):typeof runtime().model==='string'?runtime().model.slice(0,120):null,requestMs:finite(value.requestMs),loadMs:finite(value.loadMs),firstTokenMs:finite(timing.firstTokenMs),decodeMs:finite(timing.decodeMs),promptTokens:used('prompt_tokens','promptTokens'),completionTokens:used('completion_tokens','completionTokens'),totalTokens:used('total_tokens','totalTokens'),finishReason:typeof value.finishReason==='string'?value.finishReason.slice(0,40):null};
  }
  function formatMs(value){return value===null?'未提供':(value/1000).toFixed(2)+' 秒';}
  function ratingSelect(record,key,label){
    var wrap=el('label',label),select=el('select');select.dataset.reRating=key;select.dataset.reRecord=String(record.id);select.append(new Option('尚未評分',''),new Option('是，已逐項核對','yes'),new Option('否，有錯誤／未充分支持','no'));select.value=record.rating[key]===null?'':record.rating[key]?'yes':'no';wrap.append(select);return wrap;
  }
  function renderResult(mode){
    var root=q('[data-re-result="'+mode+'"]'),record=s.current&&s.last[s.current.id]&&s.last[s.current.id][mode];root.replaceChildren();
    if(!record){root.append(el('p','尚未執行；沒有分數。','re-empty'));return;}
    if(record.status==='running'){root.append(el('p','正在這台裝置推論；尚未產生完成結果。','re-help'));return;}
    if(record.status!=='completed'){root.append(el('p',(record.status==='cancelled'?'操作已取消':'模型回應未完成')+'；這次不計為成功，也沒有人工分數。'+(record.errorCode?'（'+record.errorCode+'）':''),'re-error'));}
    if(record.answer)root.append(el('pre',record.answer,'re-answer'));
    var m=record.measurement;
    root.append(el('p','本頁觀測耗時：'+formatMs(record.observedMs)+'；模型回報請求：'+formatMs(m.requestMs)+'；請求內載入：'+formatMs(m.loadMs)+'；首字：'+formatMs(m.firstTokenMs)+'。','re-metrics'));
    root.append(el('p','模型：'+(m.model||'未提供')+'；輸入 Token：'+(m.promptTokens===null?'未提供':m.promptTokens)+'；輸出 Token：'+(m.completionTokens===null?'未提供':m.completionTokens)+'；結束原因：'+(m.finishReason||'未提供')+'。','re-metrics'));
    if(record.status==='completed'){
      root.append(el('p','引用格式已核對；內容是否正確、來源是否支持答案，仍待下方人工評分。'+(mode==='rag'?(record.retrievedSourceIds.length?'本次引用檢索知識 '+record.knowledgeCitationIds.length+' 則。':'本次檢索沒有命中；不可當作有命中來源的 RAG 成效。'):''),'re-help'));
      var ratings=el('div',null,'re-ratings');ratings.append(ratingSelect(record,'correct','內容及數字是否正確？'),ratingSelect(record,'supported','引用是否支持回答內容？'));root.append(ratings);
    }
  }
  function showSources(){
    var root=q('[data-re-sources]');root.replaceChildren();var items=s.retrieval&&s.retrieval.items||[];
    if(!items.length){root.append(el('p','這一題目前沒有知識命中；有執行檢索，不代表找到可用依據。','re-help'));return;}
    items.forEach(function(item){var card=el('article',null,'re-source');card.append(el('p','['+item.id+'] '+item.title));var link=el('a','開啟原始參考資料');if(/^https:\/\//.test(item.sourceLink)){link.href=item.sourceLink;link.target='_blank';link.rel='noopener noreferrer';}card.append(link,el('p','摘要檢視日：'+(item.reviewedAt||'未提供')+'；原文發布日：'+(item.sourcePublishedAt||'未提供')));var detail=el('details');detail.append(el('summary','查看實際提供模型的摘要'),el('p',item.text));card.append(detail);root.append(card);});
  }
  function selectCase(id){
    if(!s.data||s.busy)return;s.current=s.data.cases.find(function(c){return c.id===id;})||s.data.cases[0];var scenario=s.data.scenarios[s.current.scenario];
    q('[data-re-question]').textContent=s.current.question;q('[data-re-scenario-note]').textContent=scenario.title+'。'+scenario.note;
    var facts=q('[data-re-facts]');facts.replaceChildren();Object.keys(scenario.facts).forEach(function(key){var value=scenario.facts[key];if(key==='capacitySource')value={ledger:'虛構帳務結餘假設','user-assumption':'使用者假設',unknown:'未知，尚無資料'}[value]||value;facts.append(el('dt',labels[key]||key),el('dd',value));});
    var rubric=q('[data-re-rubric]');rubric.replaceChildren();s.current.rubric.forEach(function(text){rubric.append(el('li',text));});
    try{s.retrieval=g.FinancialKnowledge.search(s.current.question,3);s.corpusVersion=s.retrieval.corpusVersion||s.corpusVersion;q('[data-re-data-status]').textContent='已載入 '+s.data.cases.length+' 題。此題 BM25 命中 '+s.retrieval.items.length+' 則摘要；尚未執行的模式沒有分數。';showSources();}
    catch(_){s.retrieval=null;q('[data-re-data-status]').textContent='知識檢索未完成，目前不能進行比較。';}
    renderResult('baseline');renderResult('rag');controls();
  }
  function reason(cause){var code=cause&&cause.code;return typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,60}$/.test(code)?code:'AI_OPERATION_FAILED';}
  async function load(){
    if(s.busy)return;if(!q('[data-re-consent]').checked){status('請先確認下載與本機執行模型的選項；尚未下載。',true);return;}
    var job=++s.job;s.abort=new AbortController();s.busy=true;controls();var started=now(),progress=q('[data-re-progress]');progress.hidden=false;progress.removeAttribute('value');status('正在檢查裝置並載入本機模型，尚未執行任何測試題目。');
    try{if(!g.LocalAI||typeof g.LocalAI.load!=='function')throw error('AI_UNAVAILABLE');await g.LocalAI.load({signal:s.abort.signal,onProgress:function(value){if(job!==s.job||s.closed)return;if(value&&Number.isFinite(value.progress))progress.value=Math.max(0,Math.min(1,value.progress));}});if(job!==s.job||s.closed)return;s.loadMs=Math.round(now()-started);status('模型已就緒。此步驟本頁觀測耗時 '+formatMs(s.loadMs)+'；請自行選擇要先執行哪一種模式。');}
    catch(cause){if(job===s.job&&!s.closed)status('模型尚未就緒／裝置可能不支援，尚未執行評估。（'+reason(cause)+'）',true);}
    finally{if(job===s.job&&!s.closed){s.busy=false;s.abort=null;progress.hidden=true;controls();}}
  }
  async function run(mode){
    if(!ready()){status('請先載入題庫、確認下載選項並啟動本機模型；尚未執行評估。',true);return;}
    var job=++s.job,which=s.current,scenario=s.data.scenarios[which.scenario],retrieved=mode==='rag'?s.retrieval.items.slice(0,3):[],sources=[{id:'planning:facts',title:'固定虛構財務試算（不是正式帳務）'}];
    var record={id:++s.nextId,caseId:which.id,scenarioId:which.scenario,mode:mode,status:'running',startedAt:new Date().toISOString(),modelWasLoadedBeforeRequest:runtime().loaded===true,retrievedSourceIds:retrieved.map(function(item){return item.id;}),knowledgeCitationIds:[],citationFormatValid:false,rating:{correct:null,supported:null},measurement:metadata(),observedMs:null,errorCode:null,answer:'',started:now()};
    s.records.push(record);if(!s.last[which.id])s.last[which.id]={};s.last[which.id][mode]=record;s.pending=record;s.abort=new AbortController();s.busy=true;renderResult(mode);controls();
    var context={currency:'TWD',planning:{facts:JSON.parse(JSON.stringify(scenario.facts)),plans:[]},sources:sources,knowledge:{items:retrieved.map(function(item){return {id:item.id,title:item.title,text:item.text};})}};
    try{
      var result=await g.LocalAI.generate({task:'coach',input:which.question,context:context,language:'zh-TW',promptProfile:'compact-v1',signal:s.abort.signal});if(job!==s.job||s.closed)return;record.measurement=metadata(result);record.observedMs=Math.round(now()-record.started);
      if(result.inferencePerformed===false)throw error('AI_NOT_INFERRED');if(result.finishReason!=='stop'||typeof result.text!=='string'||!result.text.trim()||result.text.length>12000)throw error('AI_INCOMPLETE');
      var text=result.text.trim(),allowed=['planning:facts'].concat(record.retrievedSourceIds),refs=Array.from(text.matchAll(/\[([A-Za-z0-9_.:/-]{1,100})\]/g),function(match){return match[1];});
      if(!refs.length||refs.some(function(ref){return !allowed.includes(ref);}))throw error('AI_UNGROUNDED');
      record.answer=text;record.status='completed';record.citationFormatValid=true;record.knowledgeCitationIds=Array.from(new Set(refs.filter(function(ref){return record.retrievedSourceIds.includes(ref);})));status('這次模型回應已完成，請依來源及核對標準人工評分；尚未評分的結果沒有正確率。');
    }catch(cause){if(job===s.job&&!s.closed){record.status='failed';record.observedMs=Math.round(now()-record.started);record.errorCode=reason(cause);if(cause&&cause.details)record.measurement=metadata(cause.details);status('這次回應未完成，不計為成功。可檢查裝置或稍後重試。（'+record.errorCode+'）',true);}}
    finally{if(job===s.job&&!s.closed){s.pending=null;s.busy=false;s.abort=null;renderResult(mode);controls();}}
  }
  function cancel(){
    var record=s.pending;s.job++;if(s.abort)s.abort.abort();else if(g.LocalAI&&s.busy)g.LocalAI.cancel();s.abort=null;s.pending=null;s.busy=false;q('[data-re-progress]').hidden=true;
    if(record&&record.status==='running'){record.status='cancelled';record.observedMs=Math.round(now()-record.started);record.errorCode='AI_CANCELLED';renderResult(record.mode);}status('目前操作已取消；未完成的推論不計為成功。');controls();
  }
  function exportValue(){
    return {version:1,caseVersion:s.data&&s.data.version||null,knowledgeVersion:s.corpusVersion,modelLoadObservedMs:s.loadMs,dataType:'fixed-fictional-facts',containsPrivateLedger:false,containsAnswers:false,claim:'Real measurements only when run on a user device. Manual ratings are not independently verified. No improvement rate is calculated.',records:s.records.filter(function(record){return record.status!=='running';}).map(function(record){return {caseId:record.caseId,scenarioId:record.scenarioId,mode:record.mode,status:record.status,startedAt:record.startedAt,modelWasLoadedBeforeRequest:record.modelWasLoadedBeforeRequest,retrievedSourceIds:record.retrievedSourceIds.slice(),knowledgeCitationIds:record.knowledgeCitationIds.slice(),citationFormatValid:record.citationFormatValid,observedMs:record.observedMs,measurement:Object.assign({},record.measurement),errorCode:record.errorCode,rating:Object.assign({},record.rating)};})};
  }
  function download(){
    if(s.busy||!s.records.length)return;var data=exportValue(),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=el('a');link.href=url;link.download='fambudget-financial-rag-evaluation.json';document.body.append(link);link.click();link.remove();g.setTimeout(function(){URL.revokeObjectURL(url);},1000);q('[data-re-download-status]').textContent='已準備匿名下載；不包含模型回答或正式帳務。';
  }
  function clear(){if(s.records.length&&!g.confirm('確定清除本頁所有評估紀錄與人工評分嗎？這些紀錄只保存在本頁，清除後無法復原；需要保存時請先下載匿名 JSON。'))return;if(s.busy)cancel();s.records=[];s.last={};s.pending=null;renderResult('baseline');renderResult('rag');q('[data-re-download-status]').textContent='本頁評估紀錄已清除；未修改任何帳務。';controls();}
  function validate(data){
    if(!data||typeof data.version!=='string'||!data.scenarios||!Array.isArray(data.cases)||data.cases.length<20||data.cases.length>30)throw error('EVALUATION_DATA_INVALID');
    var ids=new Set();data.cases.forEach(function(item){if(!item||!/^R\d{2}$/.test(item.id)||ids.has(item.id)||typeof item.question!=='string'||item.question.length>500||!data.scenarios[item.scenario]||!Array.isArray(item.rubric))throw error('EVALUATION_DATA_INVALID');ids.add(item.id);});return data;
  }
  async function init(){
    if(!q('#evaluation'))return;
    q('[data-re-case]').addEventListener('change',function(event){selectCase(event.target.value);});
    q('[data-re-consent]').addEventListener('change',function(event){if(!event.target.checked){if(s.busy)cancel();if(g.LocalAI)g.LocalAI.unload();status('已取消下載／執行同意，模型已卸載；已完成的紀錄仍只留在本頁。');}controls();});
    document.addEventListener('click',function(event){var node=event.target.closest('[data-re-action]');if(!node||node.disabled)return;switch(node.dataset.reAction){case'load':load();break;case'cancel':cancel();break;case'unload':if(g.LocalAI)g.LocalAI.unload();status('模型已卸載。評估紀錄仍只保留在本頁記憶體。');controls();break;case'run-baseline':run('baseline');break;case'run-rag':run('rag');break;case'download':download();break;case'clear':clear();break;}});
    document.addEventListener('change',function(event){var node=event.target.closest('[data-re-rating]');if(!node)return;var record=s.records.find(function(r){return String(r.id)===node.dataset.reRecord;});if(record&&record.status==='completed'&&['correct','supported'].includes(node.dataset.reRating)){record.rating[node.dataset.reRating]=node.value===''?null:node.value==='yes';controls();}});
    g.addEventListener('pagehide',function(){if(s.busy)cancel();s.closed=true;s.job++;if(g.LocalAI)g.LocalAI.unload();s.records=[];s.last={};document.querySelectorAll('[data-re-result]').forEach(function(node){node.replaceChildren();});});
    g.addEventListener('pageshow',function(event){if(event.persisted){s.closed=false;q('[data-re-consent]').checked=false;status('已返回本頁；先前評估與模型已清除，請重新確認後啟動。');if(s.current)selectCase(s.current.id);else controls();}});
    try{
      var values=await Promise.all([g.fetch('assets/financial-rag-cases.json',{credentials:'omit',cache:'no-cache'}).then(function(response){if(!response.ok)throw error('EVALUATION_DATA_UNAVAILABLE');return response.json();}).then(validate),g.FinancialKnowledge.load()]);if(s.closed)return;s.data=values[0];s.corpusVersion=values[1]&&values[1].version||null;
      var select=q('[data-re-case]');select.replaceChildren();s.data.cases.forEach(function(item){select.append(new Option(item.id+' · '+item.topic,item.id));});selectCase(s.data.cases[0].id);
    }catch(_){q('[data-re-data-status]').textContent='題庫或公開理財知識載入失敗，尚未進行任何模型評估。請檢查網路並重新整理。';controls();}
  }
  g.RAGEvaluation=Object.freeze({exportValue:exportValue});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
