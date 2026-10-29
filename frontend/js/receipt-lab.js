/* Receipt research UI: local OCR, quoted rules, item checks, explicit review.
 * No API adapter, account access, persistence, bank action or automatic entry.
 */
(function(global){
  'use strict';
  var state={job:0,file:null,url:null,abort:null,busy:false,origin:'none',rawOrigin:'none',draft:null,exported:null,closed:false};
  var SAMPLE='小松咖啡\n電子發票證明聯\n115/10/24 09:30\n早餐三明治 65\n拿鐵 45\n折扣 -10\n總計 NT$100';
  var MAX=1000000;
  var modes={none:'尚未提供',sample:'示範文字（未執行圖片 OCR，非真實 OCR 推論）',ocr:'圖片 OCR 原文（Tesseract.js 7）',manual:'手動輸入／修改的文字（非新的 OCR 推論）'};
  function q(selector){return document.querySelector(selector);}
  function el(tag,text,cls){var node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;return node;}
  function action(label,key){var node=el('button',label);node.type='button';node.dataset.rlAction=key;return node;}
  function status(text,error){var node=q('[data-rl-status]');node.textContent=text;node.classList.toggle('is-error',!!error);}
  function origin(mode){state.origin=mode;q('[data-rl-origin]').textContent='來源：'+modes[mode];}
  function money(value,negative){var text=String(value==null?'':value).normalize('NFKC').trim();if(!(negative?/^-?(?:\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.\d{1,2})?$/:/^(?:\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.\d{1,2})?$/).test(text))return null;var n=Number(text.replace(/,/g,''));if(!Number.isFinite(n)||Math.abs(n)>MAX||(!negative&&n<=0))return null;return Math.round(n*100);}
  function exact(cents){return (cents/100).toFixed(2);}
  function dateValid(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;var d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value&&Number(value.slice(0,4))>=1900&&Number(value.slice(0,4))<9999;}
  function itemCandidates(raw){
    var excluded=/(?:總[計額]|總金額|合計|小計|稅額|營業稅|未稅|應付|實付|找零|找錢|現金|信用卡|刷卡|統編|統一編號|發票|收據|數量|單價|subtotal|total|tax|cash|change|invoice|receipt|card|visa|mastercard)/i;
    return String(raw).normalize('NFKC').split(/[\r\n]+/).slice(0,200).flatMap(function(line){
      line=line.trim();if(!line||excluded.test(line))return [];
      var match=line.match(/^(.{1,80}?)\s+(?:(?:NT\$|TWD|USD|US\$|JPY|EUR|\$|¥|￥|€)\s*)?(-?(?:\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.\d{1,2})?)\s*(?:元)?$/i);
      if(!match||!/[A-Za-z\u3400-\u9fff]/.test(match[1])||/[\d]|[×*=]/.test(match[1]))return [];
      var amount=money(match[2],true);if(amount===null||amount===0||amount<0&&!/折扣|折讓|優惠|discount/i.test(match[1]))return [];
      if(/折扣|折讓|優惠|discount/i.test(match[1])&&amount>0)amount=-amount;
      return [{name:match[1].trim(),cents:amount,source:line.slice(0,180)}];
    }).slice(0,30);
  }
  function invalidate(){state.exported=null;var accept=q('[data-rl-accept]');if(accept)accept.checked=false;var json=q('[data-rl-json]');if(json){json.value='';json.hidden=true;}var download=q('[data-rl-action="download"]');if(download)download.disabled=true;}
  function fields(){var root=q('[data-rl-review]');return root&&root.querySelector('form');}
  function summary(){
    var form=fields();if(!form)return null;
    var total=money(form.elements.amount.value,false),rows=Array.from(form.querySelectorAll('[data-rl-item]')),valid=true,sum=0;
    var items=rows.map(function(row){var name=row.querySelector('[data-rl-item-name]').value.trim(),cents=money(row.querySelector('[data-rl-item-amount]').value,true);if(!name||name.length>80||cents===null||!cents)valid=false;else sum+=cents;return {name:name,amount:cents===null?null:exact(cents)};});
    var whole=/^(TWD|JPY)$/.test(form.elements.currency.value),fractional=total!==null&&total%100!==0||items.some(function(item){return item.amount!==null&&money(item.amount,true)%100!==0;});
    if(whole&&fractional)valid=false;
    var mismatch=total!==null&&items.length>0&&valid&&sum!==total;
    var validation=whole&&fractional?'TWD、JPY 使用整元，請核對總額與品項金額；系統不會自動四捨五入。':!valid?'請核對品項名稱及有效金額。':total===null?'請填入正數且格式正確的收據總額。':null;
    var box=q('[data-rl-balance]');box.textContent=validation?validation:!items.length?'目前沒有品項，請核對總額，或自行補上品項。':mismatch?'品項合計 '+exact(sum)+'，收據總額 '+exact(total)+'，相差 '+exact(total-sum)+'。請核對是否漏列品項、稅額或折扣。':'品項合計 '+exact(sum)+' 與收據總額相符；仍需核對原圖。';
    box.classList.toggle('rl-warning',mismatch||!!validation);
    var mismatchWrap=q('[data-rl-mismatch-wrap]');mismatchWrap.hidden=!mismatch;if(!mismatch)q('[data-rl-mismatch]').checked=false;
    return {total:total,sum:sum,items:items,valid:valid,mismatch:mismatch,validation:validation};
  }
  function addItem(item){
    var row=el('div',null,'rl-item');row.dataset.rlItem='';
    var nameLabel=el('label','品項名稱'),name=el('input');name.maxLength=80;name.value=item?item.name:'';name.dataset.rlItemName='';nameLabel.append(name);
    var amountLabel=el('label','金額／折扣'),amount=el('input');amount.type='text';amount.inputMode='decimal';amount.maxLength=12;amount.value=item?exact(item.cents):'';amount.dataset.rlItemAmount='';amountLabel.append(amount);
    var remove=action('×','remove-item');remove.setAttribute('aria-label','移除此品項');row.append(nameLabel,amountLabel,remove);q('[data-rl-items]').append(row);
  }
  function field(label,name,type,value){var wrap=el('label',label,'rl-field'),node=el('input');node.type=type||'text';node.name=name;if(value!=null)node.value=value;wrap.append(node);return {wrap:wrap,node:node};}
  function render(raw){
    var parsed=global.ReceiptEntry.analyze(raw);state.draft=parsed;state.exported=null;
    var root=q('[data-rl-review]');root.replaceChildren();var form=el('form');form.noValidate=true;
    var warnings=[];if(parsed.amount===null)warnings.push(parsed.candidates.length?'總額候選不一致，請對照原圖選擇或手動填入。':'沒有辨識到明確總額，請自行核對並填入。');if(!parsed.date)warnings.push('日期無法唯一確認，請對照收據填入；不會自動套用今天。');if(!parsed.merchant)warnings.push('店家名稱不明，可自行補上或留白。');
    if(warnings.length){var list=el('ul',null,'rl-review-warnings');warnings.forEach(function(text){list.append(el('li',text));});form.append(list);}
    var grid=el('div',null,'rl-fields');var merchant=field('店家（可留白）','merchant','text',parsed.merchant);merchant.node.maxLength=80;grid.append(merchant.wrap);
    var date=field('日期','date','date',parsed.date);date.node.min='1900-01-01';date.node.max='9998-12-31';grid.append(date.wrap);
    var currWrap=el('label','幣別','rl-field'),currency=el('select');currency.name='currency';['TWD','JPY','USD','EUR','CNY'].forEach(function(code){currency.append(new Option(code,code));});currency.value=parsed.currency;currWrap.append(currency);grid.append(currWrap);
    var amount=field('收據總額','amount','text',parsed.amount===null?'':String(parsed.amount));amount.node.inputMode='decimal';amount.node.maxLength=12;grid.append(amount.wrap);form.append(grid);
    if(parsed.candidates.length){var pickWrap=el('label','來源中的總額候選','rl-field'),pick=el('select');pick.dataset.rlTotalCandidate='';pick.append(new Option('請核對後選擇',''));parsed.candidates.forEach(function(candidate,index){pick.append(new Option(candidate.amount+' · '+candidate.source,String(index)));});pickWrap.append(pick);form.append(pickWrap);}
    form.append(el('h3','品項與折扣候選'));var items=el('div',null,'rl-items');items.dataset.rlItems='';form.append(items);root.append(form);
    itemCandidates(raw).forEach(addItem);
    var itemActions=el('div',null,'rl-actions');itemActions.append(action('新增品項','add-item'));form.append(itemActions);
    var balance=el('p',null,'rl-balance');balance.dataset.rlBalance='';form.append(balance);
    var mismatchWrap=el('label',null,'rl-check');mismatchWrap.dataset.rlMismatchWrap='';mismatchWrap.hidden=true;var mismatch=el('input');mismatch.type='checkbox';mismatch.dataset.rlMismatch='';mismatchWrap.append(mismatch,el('span','品項未完整列出或有其他差額；我已對照原圖，確認仍以收據總額為準。'));form.append(mismatchWrap);
    var acceptWrap=el('label',null,'rl-check'),accept=el('input');accept.type='checkbox';accept.dataset.rlAccept='';acceptWrap.append(accept,el('span','我已核對日期、幣別、總額與品項。這份草稿尚未寫入正式帳務。'));form.append(acceptWrap);
    var actions=el('div',null,'rl-actions'),prepare=action('產生確認草稿','prepare');prepare.className='rl-primary';var download=action('下載草稿 JSON','download');download.disabled=true;actions.append(prepare,download);form.append(actions);
    var output=el('textarea',null,'rl-json');output.readOnly=true;output.hidden=true;output.dataset.rlJson='';output.setAttribute('aria-label','待下載的確認草稿 JSON');form.append(output);
    var message=el('p',null,'rl-status');message.dataset.rlReviewStatus='';message.setAttribute('role','status');form.append(message);
    form.addEventListener('submit',function(event){event.preventDefault();prepareDraft();});
    form.addEventListener('input',function(event){if(!event.target.matches('[data-rl-accept],[data-rl-mismatch]'))invalidate();else if(!event.target.checked){state.exported=null;q('[data-rl-json]').value='';q('[data-rl-json]').hidden=true;q('[data-rl-action="download"]').disabled=true;}summary();});
    form.addEventListener('change',function(event){if(event.target===currency){invalidate();summary();}if(event.target.matches('[data-rl-total-candidate]')&&event.target.value!==''){amount.node.value=String(parsed.candidates[Number(event.target.value)].amount);invalidate();summary();}});
    summary();status(state.origin==='sample'?'已整理示範文字；未執行圖片 OCR，也沒有新增記帳。':'已依來源文字整理草稿，請逐項對照原圖核對。');
  }
  function reviewMessage(text,error){var node=q('[data-rl-review-status]');if(node){node.textContent=text;node.classList.toggle('is-error',!!error);}}
  function prepareDraft(){
    var form=fields();if(!form)return;var result=summary();
    if(!result||result.total===null||!result.valid||!dateValid(form.elements.date.value)||!q('[data-rl-accept]').checked||result.mismatch&&!q('[data-rl-mismatch]').checked){reviewMessage(result&&result.validation||'請填入有效日期、正數總額與品項金額，完成核對勾選；合計不一致時需另行確認差額。',true);return;}
    var value={version:1,stage:'human-reviewed-draft',source:{mode:state.origin,ocrEngine:state.rawOrigin==='ocr'?'Tesseract.js 7':null,visionModelUsed:false,sourceImageIncluded:false,rawTextIncluded:false},transaction:{kind:'expense',amount:exact(result.total),currency:form.elements.currency.value,date:form.elements.date.value,merchant:form.elements.merchant.value.trim()||null},items:result.items,itemCheck:{status:!result.items.length?'not-provided':result.mismatch?'difference-reviewed':'matches',sum:result.items.length?exact(result.sum):null,difference:result.items.length?exact(result.total-result.sum):null},humanConfirmed:true,writtenToLedger:false};
    state.exported=value;var output=q('[data-rl-json]');output.value=JSON.stringify(value,null,2);output.hidden=false;q('[data-rl-action="download"]').disabled=false;reviewMessage('確認草稿已產生。下載只保存這份 JSON，不包含原圖與辨識全文，也不會新增記帳。');
  }
  function cancel(message){state.job++;if(state.abort)state.abort.abort();state.abort=null;state.busy=false;q('[data-rl-progress]').hidden=true;q('[data-rl-action="cancel"]').hidden=true;q('[data-rl-action="ocr"]').disabled=!state.file;if(message)status(message);}
  function forgetImage(){if(state.url)URL.revokeObjectURL(state.url);state.url=null;state.file=null;var image=q('[data-rl-image]');image.removeAttribute('src');q('[data-rl-image-wrap]').hidden=true;q('[data-rl-image-name]').textContent='';q('[data-rl-action="ocr"]').disabled=true;}
  function clear(){cancel();forgetImage();state.draft=null;state.exported=null;state.rawOrigin='none';origin('none');q('[data-rl-raw]').value='';q('[data-rl-review]').replaceChildren(el('p','整理文字後，會在這裡顯示待核對欄位。','rl-empty'));status('已清除本頁圖片與文字；正式帳務沒有任何變更。');}
  function choose(file){
    cancel();forgetImage();state.draft=null;state.exported=null;state.rawOrigin='none';origin('none');q('[data-rl-raw]').value='';q('[data-rl-review]').replaceChildren(el('p','辨識後會顯示待核對欄位。','rl-empty'));
    if(!file||!/^(image\/jpeg|image\/png|image\/webp)$/.test(file.type)||!file.size||file.size>12*1024*1024){status('請選擇 12 MB 以內的 JPG、PNG 或 WebP 圖片；沒有辨識或新增記帳。',true);return;}
    state.file=file;state.url=URL.createObjectURL(file);q('[data-rl-image]').src=state.url;q('[data-rl-image-wrap]').hidden=false;q('[data-rl-image-name]').textContent=file.name;q('[data-rl-action="ocr"]').disabled=false;status('圖片已在本機選取。按「辨識圖片文字」後才啟動 OCR。');
  }
  async function recognize(){
    if(!state.file||state.busy)return;var job=++state.job,file=state.file;state.abort=new AbortController();state.busy=true;q('[data-rl-action="ocr"]').disabled=true;q('[data-rl-action="cancel"]').hidden=false;var progress=q('[data-rl-progress]');progress.hidden=false;progress.removeAttribute('value');status('正在本機辨識文字；首次需下載程式與語言檔，請稍候。');
    try{var value=await global.ReceiptOCR.recognize(file,{signal:state.abort.signal,onProgress:function(value){if(job!==state.job||state.closed)return;if(value&&Number.isFinite(value.progress))progress.value=Math.max(0,Math.min(1,value.progress));}});if(job!==state.job||state.closed)return;state.rawOrigin='ocr';origin('ocr');q('[data-rl-raw]').value=value.text;render(value.text);}
    catch(error){if(job===state.job&&!state.closed)status(error&&error.code==='RECEIPT_OCR_EMPTY'?'圖片沒有辨識出可用文字，請重新拍攝。':error&&error.code==='RECEIPT_OCR_TIMEOUT'?'辨識逾時，請使用更清晰、裁切適當的照片重試。':'辨識未完成，請檢查圖片或網路後重試。沒有新增記帳。',true);}
    finally{if(job===state.job&&!state.closed){state.busy=false;state.abort=null;progress.hidden=true;q('[data-rl-action="cancel"]').hidden=true;q('[data-rl-action="ocr"]').disabled=!state.file;}}
  }
  function download(){if(!state.exported)return;var url=URL.createObjectURL(new Blob([JSON.stringify(state.exported,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='fambudget-receipt-reviewed-draft.json';document.body.append(a);a.click();a.remove();global.setTimeout(function(){URL.revokeObjectURL(url);},1000);}
  function init(){
    if(!q('#receiptLab'))return;
    document.querySelectorAll('[data-rl-file]').forEach(function(input){input.addEventListener('change',function(){var file=input.files&&input.files[0];input.value='';if(file)choose(file);});});
    q('[data-rl-raw]').addEventListener('input',function(){cancel();origin('manual');invalidate();q('[data-rl-review]').replaceChildren(el('p','來源文字已變更，請重新整理文字草稿。','rl-empty'));status('文字已修改，先前草稿已失效。');});
    document.addEventListener('click',function(event){var button=event.target.closest('[data-rl-action]');if(!button||button.disabled)return;switch(button.dataset.rlAction){case'ocr':recognize();break;case'cancel':cancel('已取消辨識；沒有新增記帳。');break;case'clear':clear();break;case'sample':cancel();forgetImage();state.rawOrigin='sample';origin('sample');q('[data-rl-raw]').value=SAMPLE;render(SAMPLE);break;case'analyze':var raw=q('[data-rl-raw]').value;if(!raw.trim()){status('請先提供圖片辨識文字、示範文字或自行輸入文字。',true);return;}cancel();render(raw);break;case'add-item':addItem();invalidate();summary();break;case'remove-item':button.closest('[data-rl-item]').remove();invalidate();summary();break;case'prepare':prepareDraft();break;case'download':download();break;}});
    global.addEventListener('pagehide',function(){state.closed=true;cancel();forgetImage();q('[data-rl-raw]').value='';q('[data-rl-review]').replaceChildren();state.exported=null;state.draft=null;});
    global.addEventListener('pageshow',function(event){if(event.persisted){state.closed=false;clear();}});
  }
  global.ReceiptLab=Object.freeze({itemCandidates:itemCandidates,money:money,dateValid:dateValid});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
