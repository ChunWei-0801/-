/* Financial planning: exact server calculations, cited retrieval and optional local AI.
 * Account facts and model answers remain in this mounted page. No automatic writes. */
(function (global) {
  'use strict';
  var live = null;
  function el(tag, cls, text) { var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n; }
  function button(text, action, primary) { var n=el('button','fp-button'+(primary?' fp-button--primary':''),text);n.type='button';n.dataset.fpAction=action;return n; }
  function own(user) { return user&&user.id!==undefined?String(user.id):''; }
  function active(s, job) { return live===s&&!s.dead&&s.root.isConnected&&(job===undefined||s.job===job)&&(!s.options.getAccountId||String(s.options.getAccountId())===s.owner); }
  function money(value) { var text=String(value===undefined||value===null?'':value);if(!/^-?\d+(?:\.\d+)?$/.test(text))return '未提供';var p=text.split('.');return p[0].replace(/\B(?=(\d{3})+(?!\d))/g,',')+(p[1]&&Number(p[1])?'.'+p[1]:''); }
  function twd(value) { return 'NT$ '+money(value); }
  function cleanError(error, fallback) { var text=error&&typeof error.message==='string'?error.message:'';return text&&text.length<=300&&!/https?:|Bearer |token|traceback/i.test(text)?text:fallback; }
  function dateText() { var now=new Date(), parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now), v={};parts.forEach(function(p){v[p.type]=p.value;});return v.year+'-'+v.month+'-'+v.day; }
  function futureDate(months) { var today=dateText().split('-').map(Number), month=today[1]-1+months, year=today[0]+Math.floor(month/12), m=month%12, day=Math.min(today[2],new Date(Date.UTC(year,m+1,0)).getUTCDate());return year+'-'+String(m+1).padStart(2,'0')+'-'+String(day).padStart(2,'0'); }
  function announce(s, text, error) { if(!active(s))return;s.status.textContent=text;s.status.classList.toggle('fp-status--error',!!error); }
  function field(form, name, label, type, value, hint) { var wrap=el('label','fp-field'), title=el('span','fp-field__label',label), input=el(type==='textarea'?'textarea':'input');input.name=name;if(type!=='textarea')input.type=type;input.value=value===undefined?'':value;input.dataset.fpField=name;wrap.append(title,input);if(hint)wrap.append(el('small','fp-muted',hint));form.append(wrap);return input; }
  function select(form,name,label,values,value) { var wrap=el('label','fp-field'),n=el('select');n.name=name;n.dataset.fpField=name;values.forEach(function(pair){var o=el('option','',pair[1]);o.value=pair[0];n.append(o);});n.value=value;wrap.append(el('span','fp-field__label',label),n);form.append(wrap);return n; }
  function safeURL(value) { try { var u=new URL(value,global.location.href);return u.protocol==='https:'||u.origin===global.location.origin?u.href:null; }catch(_){return null;} }
  function sourceLink(value,title) { var url=safeURL(value),n=el(url?'a':'span','',title);if(url){n.href=url;if(new URL(url).origin!==global.location.origin){n.target='_blank';n.rel='noopener noreferrer';}}return n; }
  function abortAI(s) { if(s.controller){s.controller.abort();s.controller=null;}s.aiJob++; }
  function invalidated(s) { if(!active(s))return;s.job++;abortAI(s);s.preview=null;s.results.replaceChildren();s.results.hidden=true;setBusy(s,false);announce(s,'欄位已修改，請重新試算。'); }
  function validPreview(data) { return data&&data.facts&&['targetTwd','gapTwd','requiredMonthlyTwd'].every(function(k){return /^\d+(?:\.\d+)?$/.test(String(data.facts[k]));})&&Array.isArray(data.plans)&&Array.isArray(data.sources)&&data.knowledge&&Array.isArray(data.knowledge.items); }
  function values(s) { var f=s.fields, result={targetAmount:f.targetAmount.value.trim(),targetCurrency:f.targetCurrency.value,savedTwd:f.savedTwd.value.trim()||'0',deadline:f.deadline.value,period:f.period.value,scope:f.scope.value,weeklyAllowanceTwd:f.weeklyAllowanceTwd.value.trim()||'0',question:f.question.value.trim()};if(f.monthlyContributionTwd.value.trim())result.monthlyContributionTwd=f.monthlyContributionTwd.value.trim();return result; }
  function setBusy(s,busy) { s.calculate.disabled=busy;s.form.setAttribute('aria-busy',String(busy)); }
  function stat(root,title,value,detail) { var item=el('div','fp-stat');item.append(el('span','fp-muted',title),el('strong','',value));if(detail)item.append(el('small','fp-muted',detail));root.append(item); }
  function section(root,title) { var card=el('section','fp-card');card.append(el('h3','',title));root.append(card);return card; }
  function showSources(s,data) {
    var box=section(s.results,'知識來源與參考依據'),items=data.knowledge.items.slice(0,8);
    box.append(el('p','fp-muted','依這次目標檢索到 '+items.length+' 則理財摘要；可展開核對摘要、日期與原始來源。內容供一般理財教育參考。'));
    if(!items.length){box.append(el('p','','目前沒有相符的參考資料；可先調整目標描述。'));return;}
    var list=el('ul','fp-sources');items.forEach(function(item){var row=el('li'),detail=el('details');detail.append(el('summary','',String(item.title)),sourceLink(item.sourceLink,'查看原始來源'),el('p','',String(item.text||'')),el('small','fp-muted','引用代號：'+String(item.id)));var notes=[];if(item.sourcePublishedAt)notes.push('原文日期：'+item.sourcePublishedAt);if(item.reviewedAt)notes.push('摘要核對：'+item.reviewedAt);if(item.license)notes.push(String(item.license));if(notes.length)detail.append(el('p','fp-muted',notes.join(' · ')));row.append(detail);list.append(row);});box.append(list);
  }
  function showQuote(s,data) {
    var box=section(s.results,'匯率與資料時間'),q=data.quote;
    if(!q){box.append(el('p','','本次目標以新臺幣設定，沒有呼叫外部匯率服務。'));return;}
    box.append(el('p','','1 '+String(q.fromCurrency)+' ≈ '+money(q.rate)+' '+String(q.toCurrency)),el('p','',money(q.amount)+' '+q.fromCurrency+' ≈ '+twd(q.convertedAmount)),el('p','fp-muted','匯率僅供預算估算，實際換匯須以銀行報價及手續費為準。'));
    var detail=el('p','fp-muted');detail.append(document.createTextNode('來源：'),sourceLink(q.sourceUrl,String(q.provider||'匯率資料提供者')),document.createTextNode(' · 資料時間：'+String(q.updatedAt||'未提供')));box.append(detail);
    if(q.fetchedAt)box.append(el('small','fp-muted','擷取時間：'+String(q.fetchedAt)));
    if(q.stale||q.warning)box.append(el('p','fp-warning',String(q.warning||'外部服務暫時無法更新，目前使用上次成功取得的資料。')));
  }
  function planningContext(data) {
    return {planning:{facts:data.facts,plans:data.plans.slice(0,2),input:{deadline:data.input&&data.input.deadline,targetCurrency:data.input&&data.input.targetCurrency,targetAmount:data.input&&String(data.input.targetAmount),weeklyAllowanceTwd:data.input&&String(data.input.weeklyAllowanceTwd)},quote:data.quote},knowledge:{items:data.knowledge.items.slice(0,3)},sources:data.sources.slice(0,24)};
  }
  function validateAnswer(text,data) {
    if(typeof text!=='string'||!text.trim()||text.length>6000)throw Error('AI 沒有產生完整的解釋，請稍後重試。');
    var allowed=new Set(data.sources.map(function(x){return String(x.id);}));data.knowledge.items.forEach(function(x){allowed.add(String(x.id));});
    var matches=Array.from(text.matchAll(/\[([^\]\n]+)\]/g)).map(function(m){return m[1].trim();});
    if(!matches.length||matches.some(function(id){return !allowed.has(id);})||!matches.some(function(id){return data.knowledge.items.some(function(x){return String(x.id)===id;});}))throw Error('AI 解釋的引用尚未通過核對，請以試算及下方原始來源為準。');
    return text.trim();
  }
  function showAI(s,data) {
    var box=section(s.results,'AI 解釋方案'),answer=el('div','fp-answer'),state=el('p','fp-muted','尚未執行模型；上方金額與方案來自程式試算。'),run=button('啟動本機 AI 並解釋','ai',true),cancel=button('取消 AI 解釋','cancel-ai');
    cancel.hidden=true;box.append(el('p','fp-muted','本機 AI 首次可能下載約 290 MB，需支援 WebGPU 的裝置。解釋仍需核對，金額請以上方試算為準。'),run,cancel,state,answer);
    if(!data.knowledge.items.length){run.disabled=true;state.textContent='尚無可用的檢索資料，因此不產生帶來源的 AI 解釋。';}
    run.addEventListener('click',async function(){
      if(!active(s)||s.preview!==data)return;
      if(!global.LocalAI||typeof global.LocalAI.generate!=='function'){state.textContent='這個頁面尚未提供本機 AI；仍可使用試算與參考資料。';return;}
      var runtime=typeof global.LocalAI.status==='function'?global.LocalAI.status():{};
      if(runtime.busy){state.textContent='另一項 AI 工作正在執行，請完成或取消後再試。';return;}
      abortAI(s);var aiJob=s.aiJob,controller=new AbortController();s.controller=controller;run.disabled=true;cancel.hidden=false;answer.replaceChildren();state.textContent='本機 AI 準備中…';
      try {
        var result=await global.LocalAI.generate({task:'coach',input:String(data.input&&data.input.question||s.fields.question.value||'請說明已試算的兩個儲蓄方案及其取捨，引用提供的理財資料。').slice(0,500),context:planningContext(data),language:'zh-TW',signal:controller.signal,onProgress:function(){if(active(s)&&s.aiJob===aiJob)state.textContent='本機 AI 載入或生成中…';}});
        if(!active(s)||s.aiJob!==aiJob||s.preview!==data)return;
        if(result.finishReason==='length')throw Error('AI 解釋尚未生成完整，請縮短補充描述後重試。');
        var text=validateAnswer(result.text,data);answer.textContent=text;state.textContent='AI 解釋已產生，請核對引用內容；未變更任何記帳資料。';
        if(typeof s.options.onMeasurement==='function'){try{s.options.onMeasurement({task:'financial-planning',rag:true,model:result.model||null,elapsedMs:Number.isFinite(result.elapsedMs)?result.elapsedMs:null,requestMs:Number.isFinite(result.requestMs)?result.requestMs:null,loadMs:Number.isFinite(result.loadMs)?result.loadMs:null,sourceCount:data.knowledge.items.length,usage:result.usage||null});}catch(_){}}
      }catch(error){if(active(s)&&s.aiJob===aiJob){answer.replaceChildren();state.textContent=controller.signal.aborted?'已取消 AI 解釋。':cleanError(error,'AI 解釋未完成，試算與參考資料仍可使用。');}}
      finally{if(active(s)&&s.aiJob===aiJob){s.controller=null;run.disabled=false;cancel.hidden=true;}}
    });
    cancel.addEventListener('click',function(){abortAI(s);run.disabled=false;cancel.hidden=true;answer.replaceChildren();state.textContent='已取消 AI 解釋。';});
  }
  function showGoal(s,data) {
    var box=section(s.results,'確認後建立存錢目標'),target=Math.ceil(Number(data.facts.targetTwd)),goalName='旅行儲蓄計畫',name=field(box,'goalName','存錢筒名稱','text',goalName),check=el('label','fp-check'),input=el('input'),save=button('建立存錢筒','create-goal',true),status=el('p','fp-muted');name.maxLength=60;input.type='checkbox';input.dataset.fpConfirm='goal';check.append(input,el('span','','我確認以 '+twd(target)+' 建立新目標；新存錢筒已存金額為 0 元。'));box.append(el('p','fp-muted','這只建立目標，不會扣款、轉帳或新增收支。上方「已備妥金額」是規劃假設，不會自動轉入存錢筒。'),check,save,status);save.disabled=true;
    if(!(target>=1&&Number.isSafeInteger(target)&&target<=999999999999)){save.disabled=true;input.disabled=true;status.textContent='這個目標超出存錢筒可建立的金額範圍。';return;}
    if(!s.api||typeof s.api.createSavingsJar!=='function'){input.disabled=true;status.textContent='這個試用頁目前只提供規劃，請到存錢筒建立目標。';return;}
    var attempted=false;
    input.addEventListener('change',function(){save.disabled=!input.checked||attempted;});
    name.addEventListener('input',function(){input.checked=false;save.disabled=true;});
    save.addEventListener('click',async function(){
      if(!active(s)||s.preview!==data||attempted||!input.checked)return;
      var title=name.value.trim();if(!title){status.textContent='請輸入存錢筒名稱。';name.focus();return;}
      attempted=true;save.disabled=true;input.disabled=true;name.disabled=true;status.textContent='正在建立目標…';
      try{var saved=await s.api.createSavingsJar({name:title,targetAmount:target,savedAmount:0,shape:'pig'});if(!active(s)||s.preview!==data)return;if(!saved||saved.id===undefined)throw Error('無法確認建立結果');status.textContent=(s.options.demo?'示範目標已建立。':'存錢目標已建立，可到「我的存錢筒」查看。')+' 未產生銀行交易。';if(typeof s.options.onGoalCreated==='function'){try{s.options.onGoalCreated(saved);}catch(_){}}}
      catch(_){if(active(s)&&s.preview===data)status.textContent='建立結果尚未確認，請先到存錢筒查看，避免重複建立。';}
    });
  }
  function showResults(s,data) {
    s.results.replaceChildren();s.results.hidden=false;var f=data.facts;
    var summary=section(s.results,'程式試算'),stats=el('div','fp-stats');summary.append(el('p','fp-muted','依欄位、授權帳務與參考匯率計算；尚未執行 AI。'),stats);
    stat(stats,'目標預算',twd(f.targetTwd));stat(stats,'仍需準備',twd(f.gapTwd));stat(stats,'每期至少存',twd(f.requiredMonthlyTwd),String(f.contributionMonths)+' 期，實際日期見下方');stat(stats,'每期零用錢預留',twd(f.allowanceMonthlyReserveTwd===undefined?f.weeklyAllowanceReserveTwd:f.allowanceMonthlyReserveTwd));
    var capacity=f.capacitySource==='ledger'?'歷史帳務試算，非銀行可用餘額':f.capacitySource==='user-assumption'?'依你填入的每月可投入金額':'資料不足，尚未判斷能否負擔';summary.append(el('p','fp-muted',capacity));
    if(f.ledgerIncomeTwd!==undefined&&f.ledgerExpenseTwd!==undefined){var records=el('details','fp-dates');records.append(el('summary','','查看參考帳務'),el('p','','已記錄收入：'+twd(f.ledgerIncomeTwd)+'；支出：'+twd(f.ledgerExpenseTwd)+'；結餘：'+twd(f.recordedMonthlyNetTwd)+'。'),el('small','fp-muted','參考 '+String(f.transactionCount||0)+' 筆有權限查看的紀錄；請確認該月份是否已完整記帳。'));summary.append(records);}
    if(f.availableMonthlyTwd!==null&&f.availableMonthlyTwd!==undefined)summary.append(el('p','','扣除零用錢預留後，每期可投入估計：'+twd(f.availableMonthlyTwd)));
    if(Array.isArray(f.contributionDates)&&f.contributionDates.length){var dates=el('details','fp-dates');dates.append(el('summary','','查看各期日期'),el('p','',f.contributionDates.join('、')));summary.append(dates);}
    if(f.allowancePaymentCount!==undefined)summary.append(el('small','fp-muted','期間預計發放 '+f.allowancePaymentCount+' 次零用錢，合計 '+twd(f.allowanceTotalTwd)+'。'));
    if(Array.isArray(data.warnings)&&data.warnings.length){var warnings=el('ul','fp-warning');data.warnings.slice(0,12).forEach(function(w){warnings.append(el('li','',String(w)));});summary.append(warnings);}
    var plans=section(s.results,'方案比較'),grid=el('div','fp-plans');plans.append(grid);if(data.plans.length>=2&&data.plans[0].feasible===true&&data.plans[1].feasible===true&&data.plans[0].monthlyTwd===data.plans[1].monthlyTwd&&data.plans[0].months===data.plans[1].months)plans.prepend(el('p','fp-muted','目前投入假設已足夠，兩方案相同，可維持原期限；仍需核對未來收入與必要支出。'));
    data.plans.slice(0,2).forEach(function(plan){var card=el('article','fp-plan'),badge=plan.feasible===true?'依目前假設可達成':plan.feasible===false?'目前投入金額不足':plan.id==='comfortable'?'調整期限後須重新試算':'尚待補足資料';card.append(el('h4','',String(plan.title)),el('p','fp-plan__amount',plan.monthlyTwd===null||plan.monthlyTwd===undefined?'每期金額待確認':twd(plan.monthlyTwd)+'／期'),el('p','fp-badge',badge),el('p','',String(plan.description||'')));if(plan.months!==null&&plan.months!==undefined)card.append(el('small','fp-muted','預計 '+String(plan.months)+' 期'));if(plan.deadline)card.append(el('p','fp-muted','參考達成日：'+String(plan.deadline)));else card.append(el('p','fp-muted','達成日期待確認'));grid.append(card);});
    showQuote(s,data);showSources(s,data);showAI(s,data);showGoal(s,data);
    if(data.generatedAt)s.results.append(el('p','fp-muted','試算時間：'+data.generatedAt));
  }
  async function preview(s) {
    if(!active(s))return;if(!s.form.reportValidity())return;
    if(!s.api||typeof s.api.financialPlanningPreview!=='function'){announce(s,'目前無法連接理財規劃服務，請稍後再試。',true);return;}
    abortAI(s);var job=++s.job;s.preview=null;s.results.replaceChildren();s.results.hidden=true;setBusy(s,true);announce(s,'正在檢索參考資料並試算…');
    try{var data=await s.api.financialPlanningPreview(values(s));if(!active(s,job))return;if(!validPreview(data))throw Error('試算資料不完整，請稍後再試。');s.preview=data;showResults(s,data);announce(s,'試算已完成，請先核對假設與參考資料。');}
    catch(error){if(active(s,job))announce(s,cleanError(error,'試算未完成，請確認欄位或稍後重試。'),true);}
    finally{if(active(s,job))setBusy(s,false);}
  }
  function render(root,options) {
    cleanup();options=options||{};if(!root)return null;var s={root:root,options:options,owner:own(options.user),api:options.api||global.API,job:0,aiJob:0,dead:false,controller:null,preview:null,fields:{}};live=s;root.replaceChildren();root.classList.add('financial-planning');root.append(el('h2','','家庭理財規劃'),el('p','fp-intro','設定目標、比較可行方案，再決定如何安排。試算不會自動修改帳務。'));
    if(options.demo)root.append(el('p','fp-warning','這是本機示範資料，與正式帳務分開；不同裝置不會同步。'));
    var form=el('form','fp-form'),grid=el('div','fp-fields');s.form=form;form.append(grid);root.append(form);var f=s.fields;
    f.targetAmount=field(grid,'targetAmount','目標預算','number',options.demo?'10000':'300000');f.targetAmount.required=true;f.targetAmount.min='1';f.targetAmount.max='100000000';f.targetAmount.step='1';f.targetAmount.inputMode='decimal';
    f.targetCurrency=select(grid,'targetCurrency','目標幣別',[['TWD','新臺幣 TWD'],['JPY','日圓 JPY'],['USD','美元 USD'],['EUR','歐元 EUR']],options.demo?'TWD':'JPY');
    f.savedTwd=field(grid,'savedTwd','已備妥金額（新臺幣）','number',options.demo?'2000':'0','只供試算，不代表系統或銀行餘額');f.savedTwd.min='0';f.savedTwd.max='100000000';f.savedTwd.step='1';f.savedTwd.inputMode='numeric';
    f.deadline=field(grid,'deadline','希望達成的日期','date',futureDate(4));f.deadline.required=true;f.deadline.min=dateText();f.deadline.max=futureDate(120);
    f.period=field(grid,'period','參考帳務月份','month',dateText().slice(0,7));f.period.required=true;
    f.scope=select(grid,'scope','參考資料範圍',[['me','自己的收支'],['family','有權限查看的家庭收支']],'me');
    f.weeklyAllowanceTwd=field(grid,'weeklyAllowanceTwd','尚未計入帳務、另需預留的每週零用錢（新臺幣）','number','200','已記入參考月份支出的零用錢請勿重複填入；以每 7 天一次估算');f.weeklyAllowanceTwd.min='0';f.weeklyAllowanceTwd.max='1000000';f.weeklyAllowanceTwd.step='1';f.weeklyAllowanceTwd.inputMode='numeric';
    f.monthlyContributionTwd=field(grid,'monthlyContributionTwd','每月可投入金額（選填，新臺幣）','number','','含零用錢預留前；填入後以此假設取代歷史結餘');f.monthlyContributionTwd.min='0';f.monthlyContributionTwd.max='100000000';f.monthlyContributionTwd.step='1';f.monthlyContributionTwd.inputMode='numeric';
    f.question=field(form,'question','目標與補充偏好（選填）','textarea','家庭旅行儲蓄，希望保留孩子的零用錢。','金額與日期以以上欄位為準。');f.question.maxLength=500;f.question.rows=2;
    var actions=el('div','fp-actions');s.calculate=button('試算並檢索資料','preview',true);s.calculate.type='submit';var example=button('套用赴日旅行範例','example');actions.append(s.calculate,example);form.append(actions,el('p','fp-muted','試算不需下載模型。歷史收支只是規劃參考，不保證未來收入或支出相同。'));
    s.status=el('p','fp-status');s.status.setAttribute('role','status');s.status.setAttribute('aria-live','polite');s.results=el('div','fp-results');s.results.hidden=true;root.append(s.status,s.results);
    form.addEventListener('submit',function(e){e.preventDefault();preview(s);});form.addEventListener('input',function(){if(s.preview||s.calculate.disabled)invalidated(s);});form.addEventListener('change',function(){if(s.preview||s.calculate.disabled)invalidated(s);});
    f.targetCurrency.addEventListener('change',function(){var whole=['TWD','JPY'].includes(f.targetCurrency.value);f.targetAmount.min=whole?'1':'0.01';f.targetAmount.step=whole?'1':'0.01';});
    example.addEventListener('click',function(){f.targetAmount.value='300000';f.targetCurrency.value='JPY';f.targetAmount.step='1';f.targetAmount.min='1';f.savedTwd.value='0';f.deadline.value=futureDate(4);f.weeklyAllowanceTwd.value='200';f.question.value='四個月後想帶孩子去日本，預計花費 30 萬日圓，期間每週給孩子 200 元零用錢。';invalidated(s);announce(s,'赴日旅行範例已填入，可修改後再試算。');});
    return {destroy:function(){if(live===s)cleanup();},preview:function(){return preview(s);}};
  }
  function cleanup() { if(!live)return;var s=live;live=null;s.dead=true;s.job++;abortAI(s);s.preview=null;s.root.replaceChildren();s.root.classList.remove('financial-planning'); }
  function setAccount(user) { if(live&&own(user)!==live.owner)cleanup(); }
  global.FinancialPlanning=Object.freeze({render:render,cleanup:cleanup,setAccount:setAccount});
})(typeof window!=='undefined'?window:globalThis);
