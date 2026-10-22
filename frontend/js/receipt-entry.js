/* Receipt totals are OCR/rule suggestions, never claimed as LLM predictions.
 * A person reviews one transaction; image upload is a separate retryable step.
 */
(function (global) {
  'use strict';
  var current=null;
  function t(key,fallback,values){var text=global.I18n&&global.I18n.t?global.I18n.t('receipt.'+key,fallback):fallback;return String(text).replace(/\{(\w+)\}/g,function(all,key){return values&&Object.prototype.hasOwnProperty.call(values,key)?String(values[key]):all;});}
  function el(tag,text,cls){var node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;return node;}
  function button(text,action){var node=el('button',text,'btn');node.type='button';node.dataset.receiptAction=action;return node;}
  function dateValid(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;var d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value&&Number(value.slice(0,4))>=1900&&Number(value.slice(0,4))<9999;}
  function amountValue(value){var clean=String(value).normalize('NFKC').replace(/,/g,'');return /^\d{1,12}(?:\.\d{1,2})?$/.test(clean)&&Number(clean)>0?Number(clean):null;}
  function analyze(text){
    text=String(text||'').normalize('NFKC').slice(0,30000);var lines=text.split(/[\r\n]+/).map(function(line){return line.trim().replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1');}).filter(Boolean),candidates=[],dates=[];
    var currency=/USD|US\$|美元/i.test(text)?'USD':/JPY|日[圓元]|円/i.test(text)?'JPY':/EUR|歐元|€/i.test(text)?'EUR':/CNY|RMB|人民幣/i.test(text)?'CNY':'TWD';
    var exclusion=/小計|稅額|營業稅|未稅|統[一編]{1,3}[號码碼]?|統編|發票[號号]|invoice\s*(?:no|number)|找零|找錢|單價|數量|折扣|折讓|優惠|cash\s*tendered|change\b|subtotal|tax\b/i;
    var total=/(?:\bgrand\s*total\b|\bamount\s*due\b|\bamount\s*paid\b|總[計額]|總金額|應付(?:金額)?|實付(?:金額)?|交易金額|發票金額|結帳金額|合計|\btotal\b)\s*[:：=]?\s*(?:NT\$|TWD|USD|US\$|\$|¥|￥|€)?\s*((?:\d{1,3}(?:,\d{3})+|\d{1,12})(?:\.\d{1,2})?)(?!\d|[.,]\d)/ig;
    var money=/(?:NT\$|TWD|USD|US\$|\$|¥|￥|€)\s*((?:\d{1,3}(?:,\d{3})+|\d{1,12})(?:\.\d{1,2})?)(?!\d|[.,]\d)/ig;
    function add(value,line,label,rank){var amount=amountValue(value);if(amount===null)return;var same=candidates.find(function(entry){return entry.amount===amount;});if(same){if(rank>same.rank){same.source=line;same.label=label;same.rank=rank;}return;}candidates.push({amount:amount,source:line.slice(0,180),label:label,rank:rank});}
    lines.forEach(function(line,index){
      var source=line;if(/(?:總[計額]|總金額|應付(?:金額)?|實付(?:金額)?|合計|total)\s*[:：]?\s*$/i.test(line)&&lines[index+1]&&/^(?:NT\$|TWD|\$)?\s*[\d,.]+\s*(?:元)?$/i.test(lines[index+1]))source+=' '+lines[index+1];
      for(var match of source.matchAll(total))add(match[1],source,match[0].slice(0,30),100);
      if(!exclusion.test(line)&&!/實收|現金|刷卡末|\bcash\b|\bcard\b|信用卡|visa|mastercard/i.test(line))for(var quote of line.matchAll(money))add(quote[1],line,quote[0],30);
      for(var found of line.matchAll(/\b(\d{3,4})[年\/.\-](\d{1,2})[月\/.\-](\d{1,2})日?/g)){var year=Number(found[1]);if(year<1900&&year>=1&&year<=300)year+=1911;var value=String(year)+'-'+found[2].padStart(2,'0')+'-'+found[3].padStart(2,'0');if(dateValid(value)&&!dates.includes(value))dates.push(value);}
    });
    candidates.sort(function(a,b){return b.rank-a.rank;});candidates=candidates.slice(0,20);
    var merchant=lines.slice(0,5).find(function(line){return /[A-Za-z\u3400-\u9fff]/.test(line)&&!/[\d]/.test(line)&&!/(?:電子|雲端|發票|交易明細|收據|證明聯|副本|receipt|invoice|total|歡迎|謝謝)/i.test(line)&&line.length<=80;})||'';
    // Equal top-ranked totals stay unselected: a human must choose the right one.
    return {currency:currency,date:dates.length===1?dates[0]:'',dateCandidates:dates,merchant:merchant,candidates:candidates,amount:candidates.length&&candidates[0].rank===100&&(candidates.length===1||candidates[0].rank>candidates[1].rank)?candidates[0].amount:null};
  }
  function alive(s){return current===s&&!s.closed;}
  function status(s,message,error){if(!alive(s))return;s.status.textContent=message;s.status.classList.toggle('is-error',!!error);}
  function cleanup(s){if(s.abort)s.abort.abort();if(s.url)URL.revokeObjectURL(s.url);s.url=null;s.file=null;s.raw='';s.draft=null;if(s.preview){s.preview.removeAttribute('src');s.preview.hidden=true;}}
  function close(force){var s=current;if(!s||s.saving&&!force)return;current=null;s.closed=true;cleanup(s);s.dialog.close();s.dialog.remove();if(s.options.onClose)s.options.onClose();if(s.focus&&s.focus.isConnected)s.focus.focus();}
  function field(label,node){var wrap=el('label',null,'receipt-field');wrap.append(el('span',label),node);return wrap;}
  function input(type,name,value){var node=el('input');node.type=type;node.name=name;if(value!=null)node.value=value;return node;}
  function renderReview(s,result){
    s.review.replaceChildren();s.draft=result;
    s.review.append(el('h3',t('review','請核對這一筆')),el('p',t('method','這是本機文字辨識與收據規則建議，不是 LLM 判斷。只會在你確認後寫入一筆。'),'receipt-help'));
    var form=el('form');form.dataset.receiptReview='';s.form=form;
    var grid=el('div',null,'receipt-grid'),amount=input('number','amount',result.amount===null?'':result.amount);amount.min='0.01';amount.step='0.01';amount.inputMode='decimal';amount.required=true;
    if(result.candidates.length){var choice=el('select');choice.name='candidate';choice.append(new Option(t('chooseTotal','選擇發票上的總額'),''));result.candidates.forEach(function(candidate,index){choice.append(new Option(candidate.amount+' · '+candidate.source,String(index)));});choice.value=result.amount===null?'':String(result.candidates.findIndex(function(entry){return entry.amount===result.amount;}));choice.onchange=function(){if(choice.value!==''){amount.value=result.candidates[Number(choice.value)].amount;s.accept.checked=false;}};grid.append(field(t('totalCandidates','辨識到的金額候選'),choice));}
    var date=input('date','date',result.date);date.required=true;grid.append(field(t('amount','金額（新臺幣）'),amount),field(t('date','發票日期'),date));
    var kind=el('select');kind.name='kind';kind.append(new Option(t('expense','支出'),'expense'),new Option(t('income','收入'),'income'));
    var category=el('select');category.name='cat';category.required=true;
    function categories(){category.replaceChildren(new Option(t('chooseCategory','請選擇分類'),''));s.categories.filter(function(c){return c.kind===kind.value;}).forEach(function(c){category.append(new Option(c.name,String(c.id)));});}
    categories();kind.onchange=categories;grid.append(field(t('kind','收支'),kind),field(t('category','分類'),category));
    var merchant=input('text','merchant',result.merchant);merchant.maxLength=120;var note=input('text','note','');note.maxLength=500;
    grid.append(field(t('merchant','店家'),merchant),field(t('note','備註'),note));form.append(grid);
    if(s.groups.length){var group=el('select');group.name='group';group.append(new Option(t('personal','個人收支'),''));s.groups.forEach(function(g){group.append(new Option(g.name,String(g.id)));});group.value=s.options.groupId==null?'':String(s.options.groupId);form.append(field(t('activity','活動'),group));}
    s.fx=input('checkbox','fx');if(result.currency!=='TWD'){amount.value='';form.append(el('p',t('foreignCurrency','辨識到其他幣別（{currency}）。系統以新臺幣入帳，請自行換算金額後確認。',{currency:result.currency}),'receipt-help'),field(t('fxConfirm','我已換算並核對新臺幣金額'),s.fx));}
    s.attach=input('checkbox','attach');s.attach.checked=true;form.append(field(t('attach','確認後附上這張發票照片'),s.attach));
    s.accept=input('checkbox','accept');s.accept.required=true;form.append(field(t('accept','我已核對總額、日期、收支、分類及活動，確認新增一筆'),s.accept));
    var save=button(t('save','確認記錄這一筆'),'save');save.type='submit';save.classList.add('btn--go');s.save=save;form.append(save);form.onsubmit=function(event){event.preventDefault();saveEntry(s);};
    form.addEventListener('input',function(event){if(event.target!==s.accept)s.accept.checked=false;});
    var details=el('details');details.append(el('summary',t('recognizedText','查看辨識文字（只留本頁）')),el('pre',s.raw));s.review.append(form,details);
    if(!result.candidates.length)status(s,t('noTotal','沒有找到可核對的總額。可重新拍攝，或在總額欄修正；不會自動記帳。'),true);else if(!result.date)status(s,t('dateMissing','請選擇發票日期，並核對下方欄位。'));else status(s,t('ready','辨識完成，請核對下方欄位。'));
  }
  async function choose(s,file){
    if(!alive(s)||s.busy||s.savedId)return;
    if(!file||!/^(image\/jpeg|image\/png|image\/webp)$/.test(file.type)||!file.size||file.size>12*1024*1024){status(s,t('imageInvalid','請選擇 12 MB 以內的 JPG、PNG 或 WebP 圖片。'),true);return;}
    cleanup(s);s.file=file;s.url=URL.createObjectURL(file);s.preview.src=s.url;s.preview.hidden=false;s.review.replaceChildren();s.abort=new AbortController();s.busy=true;s.selectors.forEach(function(node){node.disabled=true;});s.progress.hidden=false;s.progress.removeAttribute('value');status(s,t('recognizing','正在辨識發票，請稍候…'));
    try{if(!global.ReceiptOCR)throw new Error('OCR unavailable');var value=await global.ReceiptOCR.recognize(file,{signal:s.abort.signal,onProgress:function(value){if(!alive(s))return;if(value&&Number.isFinite(value.progress)){s.progress.value=Math.min(1,Math.max(0,value.progress));}else s.progress.removeAttribute('value');}});if(!alive(s))return;s.raw=value.text;renderReview(s,analyze(s.raw));}
    catch(error){if(alive(s))status(s,t(error&&error.code==='RECEIPT_OCR_TIMEOUT'?'timeout':'ocrFailed',error&&error.code==='RECEIPT_OCR_TIMEOUT'?'辨識逾時，請重新拍攝較清晰的發票。':'無法完成文字辨識，請重新選圖或拍攝；沒有新增記帳。'),true);}
    finally{if(alive(s)){s.busy=false;s.progress.hidden=true;s.selectors.forEach(function(node){node.disabled=false;});}}
  }
  async function upload(s){
    if(!alive(s)||!s.savedId||!s.file||s.uploading)return;s.uploading=true;if(s.retry)s.retry.disabled=true;
    try{var file=s.file;if(global.MediaTools&&global.MediaTools.preparePhoto)file=await global.MediaTools.preparePhoto(file);if(!alive(s))return;var body=new FormData();body.append('file',file,file.name||'receipt.jpg');if(!s.api.fetchMedia||s.api.mode!=='http')throw new Error('Photo backend unavailable');await s.api.fetchMedia('/api/transactions/'+encodeURIComponent(s.savedId)+'/photos',{method:'POST',body:body,signal:s.abort&&s.abort.signal});if(!alive(s))return;status(s,t('savedPhoto','記帳與發票照片已儲存。'));if(s.retry){s.retry.remove();s.retry=null;}cleanup(s);}
    catch(error){if(alive(s)){status(s,t('photoFailed','記帳已成功，但照片尚未上傳。請只重試照片，不要再次記帳。'),true);if(!s.retry){s.retry=button(t('retryPhoto','重試照片上傳'),'retry-photo');s.review.append(s.retry);}}}
    finally{if(alive(s)){s.uploading=false;if(s.retry)s.retry.disabled=false;}}
  }
  async function saveEntry(s){
    if(!alive(s)||s.saving||s.savedId||s.uncertain||!s.form)return;
    var values=new FormData(s.form),amount=amountValue(values.get('amount')),cat=s.categories.find(function(c){return String(c.id)===values.get('cat')&&c.kind===values.get('kind');}),group=values.get('group')||null;
    if(!s.accept.checked||!dateValid(values.get('date'))||amount===null||!cat||s.draft.currency!=='TWD'&&!s.fx.checked||group&&!s.groups.some(function(g){return String(g.id)===group;})){status(s,t('validation','請完成日期、正數金額、收支、分類、活動與核對勾選。'),true);return;}
    s.saving=true;s.form.querySelectorAll('input,select,button').forEach(function(node){node.disabled=true;});s.dialog.querySelector('[data-receipt-action="close"]').disabled=true;status(s,t('saving','正在儲存這一筆…'));
    try{var record=await s.api.createTransaction({date:values.get('date'),amount:amount,kind:values.get('kind'),cat:String(cat.id),merchant:String(values.get('merchant')||'').trim(),note:String(values.get('note')||'').trim(),groupId:group},{attachPendingPhotos:false});if(!alive(s))return;if(!record||record.id==null)throw new Error('Missing record id');s.savedId=String(record.id);s.review.replaceChildren(el('p',t('saved','已新增一筆收支明細。'),'receipt-success'));s.selectors.forEach(function(node){node.disabled=true;});if(typeof s.options.onSaved==='function')s.options.onSaved(record);if(s.attach.checked)await upload(s);else{status(s,t('saved','已新增一筆收支明細。'));cleanup(s);}}
    catch(error){if(alive(s)){s.uncertain=true;status(s,t('saveUncertain','未能確認寫入結果。請先查看收支明細，避免重複記帳；本視窗不會再次送出。'),true);s.review.append(el('a',t('openDetails','前往收支明細')));s.review.lastChild.href='#/entry';}}
    finally{if(alive(s)){s.saving=false;s.dialog.querySelector('[data-receipt-action="close"]').disabled=false;}}
  }
  function open(options){
    options=options||{};close();if(current)return null;var api=options.api||global.API;if(!api||typeof api.createTransaction!=='function')return null;
    var dialog=el('dialog',null,'receipt-dialog'),s={options:options,api:api,dialog:dialog,categories:options.categories||[],groups:(options.groups||[]).filter(function(g){return !g.settledAt&&!g.archivedAt&&g.canWrite!==false;}),closed:false,busy:false,saving:false,uploading:false,savedId:null,uncertain:false,file:null,url:null,raw:'',focus:document.activeElement};current=s;
    var header=el('div',null,'receipt-header');header.append(el('h2',t('title','掃描發票記帳')),button(t('close','關閉'),'close'));dialog.append(header,el('p',t('privacy','拍照或選擇發票後，在這台裝置辨識文字。首次需下載辨識程式與語言檔；確認之前不會上傳照片或新增記帳。'),'receipt-help'));
    var actions=el('div',null,'receipt-actions');s.selectors=[];[['choose','選擇發票照片',false],['camera','拍攝發票',true]].forEach(function(item){var file=input('file',item[0]);file.accept='image/jpeg,image/png,image/webp';if(item[2])file.setAttribute('capture','environment');file.dataset.receiptFile=item[0];file.addEventListener('change',function(){var selected=file.files&&file.files[0];file.value='';if(selected)choose(s,selected);});var label=field(t(item[0],item[1]),file);actions.append(label);s.selectors.push(file);});dialog.append(actions);
    s.preview=el('img',null,'receipt-preview');s.preview.alt=t('preview','已選發票預覽');s.preview.hidden=true;s.progress=el('progress');s.progress.max=1;s.progress.hidden=true;s.status=el('p',null,'receipt-status');s.status.setAttribute('role','status');s.status.setAttribute('aria-live','polite');s.review=el('div',null,'receipt-review');dialog.append(s.preview,s.progress,s.status,s.review);
    dialog.addEventListener('click',function(event){var node=event.target.closest('[data-receipt-action]');if(!node)return;if(node.dataset.receiptAction==='close')close();if(node.dataset.receiptAction==='retry-photo')upload(s);});dialog.addEventListener('cancel',function(event){event.preventDefault();close();});document.body.append(dialog);dialog.showModal();return {close:close};
  }
  global.addEventListener('hashchange',function(){close(true);});global.addEventListener('pagehide',function(){if(current){var s=current;current=null;s.closed=true;cleanup(s);s.dialog.remove();}});
  global.ReceiptEntry=Object.freeze({open:open,close:close,analyze:analyze});
})(window);
