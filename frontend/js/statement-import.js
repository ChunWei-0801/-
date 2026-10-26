/* CSV/TSV files stay in memory. Only selected, reviewed fields reach the authenticated API.
 * StatementImport.open({api,owner,categories,groups,groupId,isCurrentUser?,onSaved?,onClose?}).
 * Unknown confirmation outcomes retain the exact payload and idempotency key for retry.
 */
(function (global) {
  'use strict';
  var current = null;
  var payments = [['credit_card','信用卡'],['jkopay','街口支付'],['line_pay','LINE Pay'],['bank_transfer','銀行轉帳'],['cash','現金'],['easycard','悠遊卡／電子票證'],['other','其他']];
  var columns = [['date','日期'],['amount','金額'],['kind','收支方向'],['merchant','店家／交易說明'],['note','備註'],['externalId','交易序號'],['currency','幣別'],['buyerTaxId','買方統一編號'],['debit','支出／借方金額'],['credit','收入／貸方金額']];
  function el(tag,text,cls){var n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n;}
  function button(text,action){var n=el('button',text,'btn');n.type='button';n.dataset.statementAction=action;return n;}
  function input(type,name,value){var n=el('input');n.type=type;n.name=name;if(value!=null)n.value=value;return n;}
  function field(label,n){var wrap=el('label',null,'statement-field');wrap.append(el('span',label),n);return wrap;}
  function select(name,items,value){var n=el('select');n.name=name;items.forEach(function(pair){n.append(new Option(pair[1],pair[0]));});if(value!=null)n.value=value;return n;}
  function ownerId(value){return value&&typeof value==='object'&&value.id!=null?String(value.id):value==null?'':String(value);}
  function baseLive(s){return current===s&&!s.closed&&s.dialog.isConnected;}
  function live(s){
    if(!baseLive(s))return false;
    var user=global.LifeFeatures&&typeof global.LifeFeatures.user==='function'?global.LifeFeatures.user():undefined;
    if(user!==undefined&&ownerId(user)!==s.owner||s.options.isCurrentUser&&s.options.isCurrentUser()!==true){close(true);return false;}
    return true;
  }
  function status(s,text,bad){if(baseLive(s)){s.status.textContent=text;s.status.classList.toggle('is-error',!!bad);}}
  function dateValid(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;var d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
  function moneyValid(value){return /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(String(value||''))&&Number(value)>0;}
  function taxValid(value){return !value||/^\d{8}$/.test(value);}
  function uuid(){if(global.crypto&&typeof global.crypto.randomUUID==='function')return global.crypto.randomUUID();if(!global.crypto||!global.crypto.getRandomValues)throw new Error('此瀏覽器無法建立安全的匯入批次，請更新瀏覽器。');var a=global.crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;var h=Array.from(a,function(v){return v.toString(16).padStart(2,'0');}).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
  function request(s,path,method,body){if(!live(s))return Promise.reject(new Error('帳號或頁面已變更，請重新開啟匯入。'));return s.api.request(path,{method:method,body:body,signal:s.abort.signal});}
  function close(force){
    var s=current;if(!s||s.saving&&!force)return;current=null;s.closed=true;s.abort.abort();s.rows=[];s.parsed=null;s.file=null;s.checkedSignature=null;s.pendingBody=null;
    if(s.observer)s.observer.disconnect();if(s.dialog.open)s.dialog.close();s.dialog.remove();if(s.options.onClose)s.options.onClose();if(s.focus&&s.focus.isConnected)s.focus.focus();
  }
  function changed(s){s.checkedSignature=null;s.accept.checked=false;if(!s.uncertain){s.pendingBody=null;s.idempotencyKey=null;}update(s);}
  function setBusy(s,value){s.busy=value;s.dialog.setAttribute('aria-busy',String(value));s.dialog.querySelectorAll('input,select,button').forEach(function(n){n.disabled=value||s.uncertain;});s.close.disabled=!!s.saving;s.confirm.disabled=value;update(s);}
  function markStep(s,step){s.step=step;s.steps.forEach(function(n,i){n.classList.toggle('is-current',i===step-1);n.setAttribute('aria-current',i===step-1?'step':'false');});}
  function body(s,requireCategory){
    var provider=s.provider.value.trim(),payment=s.payment.value,tax=s.tax.value.trim();
    if(!provider||provider.length>60)throw new Error('請填來源名稱，例如「台新信用卡」或「街口」，下次匯入請使用相同名稱。');
    if(!payments.some(function(p){return p[0]===payment;}))throw new Error('請選擇付款方式。');
    if(!taxValid(tax))throw new Error('買方統一編號請填8位數字，或留白。');
    var rows=s.rows.filter(function(row){return row.include.checked&&!row.exactDuplicate;});
    if(!rows.length)throw new Error('請選擇至少一筆要匯入的紀錄。');
    if(requireCategory&&rows.length>200)throw new Error('每批最多確認200筆，請減少勾選後分批匯入。');
    var items=rows.map(function(row){
      var date=row.date.value,amount=row.amount.value.trim(),kind=row.kind.value,cat=row.category.value,taxId=row.tax.value.trim()||tax;
      if(!dateValid(date)||!moneyValid(amount)||!['expense','income'].includes(kind))throw new Error('第'+row.index+'列請完成有效日期、正數金額及收支方向。');
      if(!taxValid(taxId))throw new Error('第'+row.index+'列的買方統編須為8位數字或留白。');
      if(requireCategory&&!s.categories.some(function(c){return String(c.id)===cat&&c.kind===kind;}))throw new Error('第'+row.index+'列請選擇符合收支方向的分類。');
      if(row.attention&&!row.review.checked)throw new Error('第'+row.index+'列有退款、轉帳或資料疑點，請先勾選該列的核對確認。');
      if(row.currency!=='TWD'&&!row.fx.checked)throw new Error('第'+row.index+'列請先填入實際新臺幣金額，並確認已換算。');
      var item={rowIndex:row.index,date:date,amount:amount,kind:kind,cat:cat||null,merchant:row.merchant.value.trim(),note:row.note.value.trim(),externalId:row.externalId||null,currency:'TWD',buyerTaxId:taxId||null,allowPossibleDuplicate:row.allowDuplicate.checked};
      if(s.group.value)item.groupId=s.group.value;return item;
    });
    var payload={provider:provider,paymentMethod:payment,items:items};if(s.statementId)payload.statementId=s.statementId;return payload;
  }
  function signature(payload){var value=JSON.parse(JSON.stringify(payload));value.items.forEach(function(row){delete row.allowPossibleDuplicate;});return JSON.stringify(value);}
  function update(s){
    if(!baseLive(s)||!s.confirm)return;
    var selected=s.rows.filter(function(row){return row.include.checked&&!row.exactDuplicate;}),pending=selected.filter(function(row){return row.possibleDuplicate&&!row.allowDuplicate.checked;});
    s.count.textContent='已勾選 '+selected.length+' 筆，共 '+s.rows.length+' 筆；每次最多確認200筆。';
    var value=null,error='';try{value=body(s,true);}catch(e){error=e.message;}
    var checked=value&&s.checkedSignature===signature(value);
    s.confirm.disabled=s.busy||s.saving||s.completed||(!s.uncertain&&(!checked||!!error||pending.length>0||!s.accept.checked));
    if(s.uncertain)s.confirm.disabled=!!s.busy||!!s.saving;
    s.confirm.textContent=s.uncertain?'以相同批次重試':'確認記帳所選項目';
    s.check.disabled=s.busy||s.saving||s.uncertain||s.completed||!s.rows.length;
    s.accept.disabled=s.busy||s.saving||s.uncertain||s.completed;
    s.hint.textContent=s.uncertain?'結果尚未確認；重試會使用同一批次，不會建立新的請求。':pending.length?'有疑似重複紀錄，請逐筆勾選「仍要匯入」或取消該筆。':error||(!checked?'填好分類後，先按「檢查重複紀錄」，再核對確認。':'重複檢查完成；請核對所選項目後確認記帳。');
  }
  function categoryOptions(s,row){var value=row.category.value;row.category.replaceChildren(new Option('請選分類',''));s.categories.filter(function(c){return c.kind===row.kind.value;}).forEach(function(c){row.category.append(new Option(c.name,String(c.id)));});row.category.value=value;}
  function rowCard(s,draft){
    var card=el('article',null,'statement-row');card.dataset.statementRow=String(draft.rowIndex);var row={index:draft.rowIndex,currency:draft.currency==null?'TWD':draft.currency||'UNKNOWN',externalId:draft.externalId||'',attention:!!draft.excluded,suggested:!draft.excluded,exactDuplicate:false,possibleDuplicate:false};
    row.include=input('checkbox','include');row.include.checked=!draft.excluded&&dateValid(draft.date)&&moneyValid(draft.amount)&&['expense','income'].includes(draft.kind);row.include.dataset.statementInclude=String(row.index);
    var head=el('div',null,'statement-row__head'),title=el('label',null,'statement-row__pick');title.append(row.include,el('b','第 '+row.index+' 列'));row.flag=el('span',null,'statement-row__flag');head.append(title,row.flag);card.append(head);
    if(draft.reason)card.append(el('p',draft.reason,'statement-help'));var grid=el('div',null,'statement-grid');
    row.date=input('date','date',draft.date||'');row.amount=input('text','amount',draft.amount||'');row.amount.inputMode='decimal';row.amount.maxLength=15;
    row.kind=select('kind',[['','請確認收支'],['expense','支出'],['income','收入']],draft.excluded?'':draft.kind||'');row.category=select('cat',[['','請選分類']]);categoryOptions(s,row);
    row.merchant=input('text','merchant',draft.merchant||'');row.merchant.maxLength=120;row.note=input('text','note',draft.note||'');row.note.maxLength=500;
    row.tax=input('text','buyerTaxId',draft.buyerTaxId||'');row.tax.inputMode='numeric';row.tax.maxLength=8;
    [['日期',row.date],['金額（新臺幣）',row.amount],['收支',row.kind],['分類',row.category],['店家／交易說明',row.merchant],['備註',row.note],['買方統編（可留白）',row.tax]].forEach(function(pair){grid.append(field(pair[0],pair[1]));});card.append(grid);
    row.review=input('checkbox','review');row.review.dataset.statementRowReview=String(row.index);var attention=field('我已核對此列，確認是要記錄的收入或支出',row.review);attention.classList.add('statement-check');attention.hidden=!row.attention;card.append(attention);
    row.fx=input('checkbox','fx');row.fx.dataset.statementFx=String(row.index);if(row.currency!=='TWD'){var fx=field('原幣別 '+(row.currency==='UNKNOWN'?'尚未確認':row.currency)+'：我已填入實際新臺幣扣款／入帳金額',row.fx);fx.classList.add('statement-check');card.append(fx);}
    row.allowDuplicate=input('checkbox','allowPossibleDuplicate');row.allowDuplicate.dataset.statementAllowDuplicate=String(row.index);row.duplicateWrap=field('已核對疑似重複紀錄，這筆仍要匯入',row.allowDuplicate);row.duplicateWrap.classList.add('statement-check');row.duplicateWrap.hidden=true;card.append(row.duplicateWrap);
    card.addEventListener('input',function(event){if(!live(s))return;if(event.target===row.allowDuplicate){update(s);return;}row.exactDuplicate=false;row.flag.textContent='';row.include.disabled=false;if(event.target!==s.accept)changed(s);});
    row.kind.addEventListener('change',function(){categoryOptions(s,row);changed(s);});
    card.addEventListener('change',function(event){if(event.target!==row.allowDuplicate)changed(s);});
    row.card=card;s.rowHost.append(card);return row;
  }
  function buildDrafts(s){
    if(!live(s)||s.busy||!s.parsed)return;
    try{
      if(!s.mappingAccepted.checked)throw new Error('請先確認欄位對應。');if(!s.direction.value)throw new Error('請選擇這份帳單的收支判讀方式。');
      var mapping={};Object.keys(s.mapping).forEach(function(k){mapping[k]=Number(s.mapping[k].value);});
      if(mapping.date<0)throw new Error('請對應日期欄位。');if(mapping.amount<0&&(mapping.debit<0||mapping.credit<0))throw new Error('請對應金額欄位，或分開的借方／貸方欄位。');
      var options={rowNumbers:s.parsed.rowNumbers,paymentMethod:s.payment.value,currency:'TWD'};
      if(s.direction.value==='expense')options.explicitExpense=true;
      if(s.direction.value==='kind'){
        if(mapping.kind<0)throw new Error('請對應收支方向欄位。');options.kindMap={};s.expenseValues.value.split(',').forEach(function(v){if(v.trim())options.kindMap[v.trim()]='expense';});s.incomeValues.value.split(',').forEach(function(v){if(v.trim())options.kindMap[v.trim()]='income';});
      }
      if(s.direction.value==='positive-expense'||s.direction.value==='negative-expense')options.signedAmount=s.direction.value;
      if(s.direction.value==='debit-expense'||s.direction.value==='credit-expense')options.debitCreditMode=s.direction.value;
      var drafts=global.StatementParser.normalize(s.parsed.rows,mapping,options);s.rowHost.replaceChildren();s.rows=drafts.map(function(d){return rowCard(s,d);});s.review.hidden=false;markStep(s,3);changed(s);status(s,'草稿已在此裝置建立，尚未寫入帳本。繳款、轉帳、儲值、退款及有疑點的列預設不勾選。');s.review.scrollIntoView({block:'start'});
    }catch(error){status(s,error.message||'無法產生草稿，請檢查欄位對應。',true);}
  }
  function renderMapping(s){
    s.mappingHost.replaceChildren();s.mapping={};var suggested=global.StatementParser.suggest(s.parsed.headers),grid=el('div',null,'statement-grid'),more=el('details'),extra=el('div',null,'statement-grid');more.append(el('summary','其他欄位：備註、交易序號、幣別與統編'));
    columns.forEach(function(pair,index){var choices=[['-1','不使用此欄位']].concat(s.parsed.headers.map(function(label,i){return [String(i),(i+1)+'. '+label];})),n=select(pair[0],choices,String(suggested[pair[0]]==null?-1:suggested[pair[0]]));n.dataset.statementColumn=pair[0];n.onchange=function(){s.mappingAccepted.checked=false;};s.mapping[pair[0]]=n;(index<4?grid:extra).append(field(pair[1],n));});
    more.append(extra);s.mappingHost.append(grid,more);s.mapSection.hidden=false;s.mappingAccepted.checked=false;markStep(s,2);
  }
  async function readFile(s){
    if(!live(s)||s.busy||!s.file)return;var file=s.file,version=++s.fileVersion;s.parsed=null;s.rows=[];s.review.hidden=true;s.mapSection.hidden=true;setBusy(s,true);status(s,'正在本機讀取檔案…');
    try{if(file.size>2*1024*1024||!file.size||!(/\.(?:csv|tsv)$/i).test(file.name))throw new Error('請選擇2MB以內的CSV或TSV文字帳單；此入口不讀取Excel或PDF。');
      var bytes=await file.arrayBuffer();if(!live(s)||version!==s.fileVersion)return;s.statementId=null;if(global.crypto&&global.crypto.subtle){var hash=await global.crypto.subtle.digest('SHA-256',bytes);if(!live(s)||version!==s.fileVersion)return;s.statementId=Array.from(new Uint8Array(hash),function(v){return v.toString(16).padStart(2,'0');}).join('');}var text;try{text=new TextDecoder(s.encoding.value,{fatal:true}).decode(bytes);}catch(_){throw new Error('無法用所選編碼讀取，請改選Big5或UTF-8後重新讀取。');}
      var value=global.StatementParser.parse(text,{headerRow:Number(s.headerRow.value)-1,maxRows:500});if(!live(s)||version!==s.fileVersion)return;s.parsed=value;s.fileName.textContent=file.name+' · '+value.rows.length+' 筆';renderMapping(s);status(s,'檔案僅在此裝置讀取。請確認日期、金額、收支與店家欄位。');
    }catch(error){if(live(s))status(s,error.message||'無法讀取檔案，請確認CSV格式。',true);}finally{if(live(s)&&version===s.fileVersion)setBusy(s,false);}
  }
  async function checkDuplicates(s){
    if(!live(s)||s.busy||s.uncertain)return;var payload;try{payload=body(s,true);}catch(error){status(s,error.message,true);return;}setBusy(s,true);status(s,'正在檢查是否已記過…');
    try{var result=await request(s,'/api/statement-import/preview','POST',payload);if(!live(s))return;if(!result||!Array.isArray(result.items))throw new Error('重複檢查回應不完整，請稍後重試。');
      var byIndex=new Map(result.items.map(function(item){return [item.rowIndex,item];}));
      s.rows.forEach(function(row){var item=byIndex.get(row.index);if(!item)return;row.exactDuplicate=item.exactDuplicate===true;row.possibleDuplicate=item.possibleDuplicate===true;row.allowDuplicate.checked=false;row.duplicateWrap.hidden=!row.possibleDuplicate;if(item.identityConflict){row.include.checked=false;row.exactDuplicate=true;row.flag.textContent='同一來源交易的內容不同，請核對原有明細；此筆不會新增或覆寫';}else if(row.exactDuplicate){row.include.checked=false;row.flag.textContent='已匯入，這次略過';}else if(row.possibleDuplicate){row.flag.textContent='疑似已記過，請核對';}else row.flag.textContent='尚無相同匯入紀錄';});
      var next;try{next=body(s,true);}catch(_){next=null;}s.checkedSignature=next?signature(next):null;s.accept.checked=false;status(s,'重複檢查完成。相同匯入會略過；疑似相同消費仍需你核對。');
    }catch(error){if(live(s)){s.checkedSignature=null;status(s,error.message||'無法完成重複檢查，沒有新增記帳。',true);}}finally{if(live(s)){setBusy(s,false);s.rows.forEach(function(row){if(row.exactDuplicate)row.include.disabled=true;});}}
  }
  async function confirm(s){
    if(!live(s)||s.busy||s.saving||s.completed)return;var payload;
    try{if(s.uncertain)payload=s.pendingBody;else{payload=body(s,true);if(signature(payload)!==s.checkedSignature||!s.accept.checked||s.rows.some(function(row){return row.include.checked&&row.possibleDuplicate&&!row.allowDuplicate.checked;}))throw new Error('請先檢查重複紀錄並完成核對勾選。');s.idempotencyKey=uuid();payload.idempotencyKey=s.idempotencyKey;s.pendingBody=JSON.parse(JSON.stringify(payload));}}catch(error){status(s,error.message,true);return;}
    s.saving=true;setBusy(s,true);status(s,'正在記帳所選項目…');
    try{var result=await request(s,'/api/statement-import/confirm','POST',payload);if(!live(s))return;if(!result||!Number.isInteger(result.createdCount)||!Number.isInteger(result.skippedCount))throw new Error('未能確認完整寫入結果。');s.uncertain=false;s.completed=true;s.pendingBody=null;s.checkedSignature=null;s.review.replaceChildren(el('h3','匯入完成'),el('p','已新增 '+result.createdCount+' 筆；略過已匯入紀錄 '+result.skippedCount+' 筆。'));s.mapSection.hidden=true;s.fileSection.hidden=true;status(s,'本批已完成。你可以回到收支明細查看。');if(s.options.onSaved)s.options.onSaved(result);
    }catch(error){if(!live(s))return;if(error&&error.status>=400&&error.status<500){s.uncertain=false;s.pendingBody=null;s.idempotencyKey=null;s.checkedSignature=null;status(s,error.message||'資料尚未寫入，請核對後再檢查。',true);}else{s.uncertain=true;status(s,'未能確認寫入結果。可用同一批次重試；請勿另外建立新批次，以免重複。',true);}}
    finally{if(live(s)){s.saving=false;setBusy(s,false);}}
  }
  function sample(){var value='\uFEFF日期,金額,收支,店家,備註,交易序號,幣別\r\n2026-10-01,65,支出,早餐店,範例消費,SAMPLE-001,TWD\r\n2026-10-02,120,支出,午餐店,範例消費,SAMPLE-002,TWD\r\n2026-10-03,185,支出,信用卡繳款,範例：繳款預設不計入消費,SAMPLE-003,TWD\r\n',url=URL.createObjectURL(new Blob([value],{type:'text/csv;charset=utf-8'})),a=el('a');a.href=url;a.download='記帳匯入範例.csv';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);}
  function open(options){
    options=options||{};close();if(current)return null;var api=options.api||global.API,owner=ownerId(options.owner);var dialog=el('dialog',null,'statement-dialog');
    var s={options:options,api:api,owner:owner,dialog:dialog,abort:new AbortController(),closed:false,busy:false,saving:false,uncertain:false,completed:false,rows:[],file:null,fileVersion:0,parsed:null,checkedSignature:null,categories:options.categories||[],focus:document.activeElement};current=s;
    var header=el('div',null,'statement-header');s.close=button('關閉','close');header.append(el('h2','匯入付款帳單'),s.close);dialog.append(header);s.steps=[];var steps=el('ol',null,'statement-steps');['1 選擇帳單','2 對應欄位','3 核對記帳'].forEach(function(text){var n=el('li',text);steps.append(n);s.steps.push(n);});dialog.append(steps);
    s.status=el('p',null,'statement-status');s.status.setAttribute('role','status');s.status.setAttribute('aria-live','polite');dialog.append(s.status);document.body.append(dialog);
    s.close.onclick=function(){close();};dialog.addEventListener('cancel',function(event){event.preventDefault();close();});dialog.addEventListener('close',function(){if(baseLive(s))close(true);});dialog.showModal();
    if(!owner||!api||api.mode!=='http'||typeof api.request!=='function'){status(s,'請登入已連接資料庫的網站後使用帳單匯入；示範模式不會匯入私人帳單。',true);return {close:close};}
    if(!global.StatementParser){status(s,'帳單讀取程式尚未載入，請重新整理網站。',true);return {close:close};}
    dialog.append(el('p','免費讀取CSV／TSV帳單，不會連接銀行帳號。原始檔案留在此裝置；確認前只會傳送所選欄位供重複檢查。','statement-help'));
    s.fileSection=el('section');s.fileSection.append(el('h3','選擇付款紀錄'));var setup=el('div',null,'statement-grid');s.provider=input('text','provider','');s.provider.maxLength=60;s.provider.placeholder='例如：台新信用卡、街口';s.payment=select('paymentMethod',[['','請選付款方式']].concat(payments));s.tax=input('text','buyerTaxId','');s.tax.inputMode='numeric';s.tax.maxLength=8;
    var groups=(options.groups||[]).filter(function(g){return !g.settledAt&&!g.archivedAt&&g.canWrite!==false;});s.group=select('groupId',[['','個人收支']].concat(groups.map(function(g){return [String(g.id),g.name];})),options.groupId==null?'':String(options.groupId));
    [['來源名稱（每次請用相同名稱）',s.provider],['付款方式',s.payment],['買方統編（可留白）',s.tax],['記到哪個活動',s.group]].forEach(function(pair){setup.append(field(pair[0],pair[1]));});s.fileSection.append(setup);
    var fileGrid=el('div',null,'statement-grid');s.fileInput=input('file','statementFile');s.fileInput.accept='.csv,.tsv,text/csv,text/tab-separated-values';s.fileInput.dataset.statementFile='';s.encoding=select('encoding',[['utf-8','UTF-8（常用）'],['big5','Big5（部分銀行帳單）']]);s.headerRow=input('number','headerRow','1');s.headerRow.min='1';s.headerRow.max='51';fileGrid.append(field('CSV／TSV檔案（最多2MB、500筆）',s.fileInput),field('文字編碼',s.encoding),field('標題所在資料列',s.headerRow));s.fileSection.append(fileGrid);s.fileName=el('p',null,'statement-help');s.fileSection.append(s.fileName,button('下載範例CSV','sample'));dialog.append(s.fileSection);
    s.mapSection=el('section');s.mapSection.hidden=true;s.mapSection.append(el('h3','核對欄位對應'),el('p','不同銀行的欄位不同，請依你的檔案選擇；畫面不會假設所有銀行格式都相同。','statement-help'));s.mappingHost=el('div');s.mapSection.append(s.mappingHost);
    s.direction=select('direction',[['','請選收支判讀方式'],['kind','依收支欄位'],['expense','這份帳單的正常列都是支出'],['positive-expense','正數支出、負數收入（請核對退款）'],['negative-expense','負數支出、正數收入（請核對退款）'],['debit-expense','借方為支出、貸方為收入'],['credit-expense','貸方為支出、借方為收入']]);s.expenseValues=input('text','expenseValues','支出,expense,消費,扣款');s.incomeValues=input('text','incomeValues','收入,income,入帳');var meanings=el('div',null,'statement-grid');meanings.append(field('這份帳單如何表示收支',s.direction),field('收支欄代表支出的值（逗號分隔）',s.expenseValues),field('收支欄代表收入的值（逗號分隔）',s.incomeValues));s.mapSection.append(meanings);s.mappingAccepted=input('checkbox','mappingAccepted');s.mappingAccepted.dataset.statementMappingAccepted='';var mapped=field('我已確認欄位與收支方向的對應',s.mappingAccepted);mapped.classList.add('statement-check');s.mapSection.append(mapped,button('產生待確認草稿','drafts'));dialog.append(s.mapSection);
    s.review=el('section');s.review.hidden=true;s.review.append(el('h3','待確認的記帳'));s.count=el('p',null,'statement-help');s.review.append(s.count);var bulk=el('div',null,'statement-bulk');s.bulkCategory=select('bulkCategory',[['','請選要套用的分類']].concat(s.categories.map(function(c){return [String(c.id),(c.kind==='income'?'收入':'支出')+' · '+c.name];})));bulk.append(field('快速設定所選紀錄的分類',s.bulkCategory),button('套用分類到勾選項目','bulk-category'),button('取消全部勾選','clear-selection'),button('勾選前200筆正常紀錄','select-first'));s.review.append(bulk);s.rowHost=el('div',null,'statement-rows');s.review.append(s.rowHost);s.check=button('檢查重複紀錄','check');s.review.append(s.check);s.accept=input('checkbox','accept');s.accept.dataset.statementAccept='';var accepted=field('我已逐筆核對所選紀錄，確認金額、日期、收支、分類及活動',s.accept);accepted.classList.add('statement-check');s.hint=el('p',null,'statement-help');s.confirm=button('確認記帳所選項目','confirm');s.confirm.classList.add('btn--go');s.review.append(accepted,s.hint,s.confirm);dialog.append(s.review);
    dialog.addEventListener('click',function(event){if(!live(s))return;var target=event.target.closest('[data-statement-action]');if(!target||target.disabled)return;var action=target.dataset.statementAction;if(action==='sample')sample();if(action==='drafts')buildDrafts(s);if(action==='check')checkDuplicates(s);if(action==='confirm')confirm(s);if(action==='clear-selection'){s.rows.forEach(function(row){row.include.checked=false;});changed(s);}if(action==='select-first'){var chosen=0;s.rows.forEach(function(row){var safe=row.suggested&&!row.exactDuplicate&&dateValid(row.date.value)&&moneyValid(row.amount.value)&&['expense','income'].includes(row.kind.value);row.include.checked=!!safe&&chosen<200;if(row.include.checked)chosen++;});changed(s);}if(action==='bulk-category'){var category=s.categories.find(function(c){return String(c.id)===s.bulkCategory.value;});if(!category)return;s.rows.forEach(function(row){if(row.include.checked&&row.kind.value===category.kind)row.category.value=String(category.id);});changed(s);}});
    s.fileInput.onchange=function(){var file=s.fileInput.files&&s.fileInput.files[0];s.fileInput.value='';if(file){s.file=file;readFile(s);}};s.encoding.onchange=function(){if(s.file)readFile(s);};s.headerRow.onchange=function(){if(s.file)readFile(s);};[s.provider,s.payment,s.tax,s.group].forEach(function(n){n.addEventListener('input',function(){if(n===s.tax)s.taxTouched=true;changed(s);});n.addEventListener('change',function(){if(n===s.tax)s.taxTouched=true;changed(s);});});s.accept.onchange=function(){update(s);};s.direction.onchange=function(){s.mappingAccepted.checked=false;};markStep(s,1);update(s);
    request(s,'/api/billing/profile','GET').then(function(profile){if(live(s)&&profile&&profile.buyerTaxId&&!s.tax.value&&!s.taxTouched)s.tax.value=profile.buyerTaxId;}).catch(function(){});
    if(global.MutationObserver){s.observer=new MutationObserver(function(){if(baseLive(s))live(s);});s.observer.observe(document.body,{childList:true,subtree:true});}
    return {close:close};
  }
  global.addEventListener('hashchange',function(){close(true);});global.addEventListener('pagehide',function(){close(true);});
  global.StatementImport=Object.freeze({open:open,close:close});
})(window);
