/* Calendar folders are a read-only view of existing transactions, never a move,
 * lock or backup. The server supplies the authorized Asia/Taipei month index.
 * No account data or search terms are persisted by this module. */
(function (global) {
  'use strict';
  var PAGE_SIZE = 200;
  var FILTERS = ['userId','groupId','from','to','categoryId','kind','source','q'];
  var WORDS = {
    'zh-TW': {title:'依年月查看',intro:'每月結束會自動歸入月份資料夾；仍可補記與修改。',activity:'活動',all:'全部活動',unknown:'目前活動',none:'尚未加入活動',count:'筆',year:'年',month:'月',closed:'已打包',current:'本月',future:'未封存',empty:'沒有符合條件的年月紀錄',emptyHelp:'請調整活動或篩選條件，或先新增一筆紀錄。',loading:'正在讀取年月紀錄…',failed:'年月紀錄讀取失敗，請稍後再試。',retry:'重新讀取',searchNote:'資料夾筆數不含文字搜尋；搜尋套用於目前選取的月份。',selected:'目前月份',previous:'上一頁',next:'下一頁',page:'頁',of:'／',results:'符合條件',noneSelected:'點選月份後顯示該月明細',tz:'月份依臺灣時間（Asia/Taipei）劃分。'},
    'zh-CN': {title:'按年月查看',intro:'每月结束会自动归入月份文件夹；仍可补记和修改。',activity:'活动',all:'全部活动',unknown:'当前活动',none:'尚未加入活动',count:'笔',year:'年',month:'月',closed:'已打包',current:'本月',future:'未归档',empty:'没有符合条件的年月记录',emptyHelp:'请调整活动或筛选条件，或先新增一笔记录。',loading:'正在读取年月记录…',failed:'年月记录读取失败，请稍后重试。',retry:'重新读取',searchNote:'文件夹笔数不含文字搜索；搜索应用于当前选中的月份。',selected:'当前月份',previous:'上一页',next:'下一页',page:'页',of:'／',results:'符合条件',noneSelected:'选择月份后显示该月明细',tz:'月份按台湾时间（Asia/Taipei）划分。'},
    en: {title:'Browse by year and month',intro:'Completed months are grouped automatically. You can still add or edit entries.',activity:'Activity',all:'All activities',unknown:'Current activity',none:'No joined activities',count:'entries',year:'',month:'',closed:'Archived',current:'This month',future:'Not archived',empty:'No months match these filters',emptyHelp:'Change the activity or filters, or add your first entry.',loading:'Loading calendar folders…',failed:'Calendar folders could not be loaded. Please try again.',retry:'Try again',searchNote:'Folder counts exclude text search. Text search applies to the selected month.',selected:'Selected month',previous:'Previous page',next:'Next page',page:'Page',of:'of',results:'matching entries',noneSelected:'Choose a month to see its entries',tz:'Month boundaries use Taiwan time (Asia/Taipei).'},
    ja: {title:'年月で表示',intro:'終了した月は自動的に月別フォルダーにまとまります。追記や編集も可能です。',activity:'活動',all:'すべての活動',unknown:'現在の活動',none:'参加中の活動はありません',count:'件',year:'年',month:'月',closed:'整理済み',current:'今月',future:'未整理',empty:'条件に合う年月の記録がありません',emptyHelp:'活動や絞り込みを変更するか、記録を追加してください。',loading:'年月の記録を読み込み中…',failed:'年月の記録を読み込めませんでした。',retry:'再読み込み',searchNote:'フォルダーの件数に文字検索は含まれません。文字検索は選択中の月に適用されます。',selected:'選択中の月',previous:'前のページ',next:'次のページ',page:'ページ',of:'／',results:'一致する記録',noneSelected:'月を選択すると明細を表示します',tz:'月の区切りは台湾時間（Asia/Taipei）です。'},
    ko: {title:'연도와 월별 보기',intro:'지난달 기록은 자동으로 월별 폴더에 묶입니다. 추가와 수정은 계속 가능합니다.',activity:'활동',all:'모든 활동',unknown:'현재 활동',none:'참여 중인 활동이 없습니다',count:'건',year:'년',month:'월',closed:'정리됨',current:'이번 달',future:'정리 전',empty:'조건에 맞는 월별 기록이 없습니다',emptyHelp:'활동이나 필터를 바꾸거나 기록을 추가하세요.',loading:'월별 기록을 불러오는 중…',failed:'월별 기록을 불러올 수 없습니다.',retry:'다시 시도',searchNote:'폴더 개수에는 텍스트 검색이 반영되지 않습니다. 검색은 선택한 달에 적용됩니다.',selected:'선택한 달',previous:'이전 페이지',next:'다음 페이지',page:'페이지',of:'／',results:'일치하는 기록',noneSelected:'월을 선택하면 상세 내역이 표시됩니다',tz:'월 구분은 대만 시간（Asia/Taipei）을 따릅니다.'},
    es: {title:'Ver por año y mes',intro:'Los meses terminados se agrupan automáticamente. Puedes seguir añadiendo o editando registros.',activity:'Actividad',all:'Todas las actividades',unknown:'Actividad actual',none:'No hay actividades',count:'registros',year:'',month:'',closed:'Archivado',current:'Este mes',future:'Sin archivar',empty:'No hay meses con estos filtros',emptyHelp:'Cambia la actividad o los filtros, o añade un registro.',loading:'Cargando carpetas por mes…',failed:'No se pudieron cargar las carpetas por mes.',retry:'Reintentar',searchNote:'El total de las carpetas no incluye la búsqueda de texto. La búsqueda se aplica al mes elegido.',selected:'Mes seleccionado',previous:'Página anterior',next:'Página siguiente',page:'Página',of:'de',results:'registros coincidentes',noneSelected:'Elige un mes para ver sus registros',tz:'Los meses se delimitan según la hora de Taiwán (Asia/Taipei).'}
  };
  function language() { return global.I18n && global.I18n.language ? global.I18n.language() : 'zh-TW'; }
  function t(key) { return (WORDS[language()] || WORDS.en)[key]; }
  function node(tag, className, text) { var el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=String(text);return el; }
  function taipeiPeriod(value) { var date=new Date((value instanceof Date ? value.getTime() : value===undefined ? Date.now() : Number(value))+8*60*60*1000);return date.getUTCFullYear()+'-'+String(date.getUTCMonth()+1).padStart(2,'0'); }
  function nextBoundaryDelay(value) { var ms=value instanceof Date?value.getTime():value===undefined?Date.now():Number(value), d=new Date(ms+8*60*60*1000), next=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)-8*60*60*1000;return Math.max(1,Math.min(24*60*60*1000,next-ms+50)); }
  function cloneFilters(source) { var out={};FILTERS.forEach(function(key){if(source && source[key]!==undefined && source[key]!==null && source[key]!=='')out[key]=source[key];});return out; }
  function validCount(value) { return Number.isSafeInteger(value) && value>=0; }
  function validateIndex(value) {
    if(!value || value.timezone!=='Asia/Taipei' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.currentPeriod || '') || !validCount(value.total) || !Array.isArray(value.years) || value.years.length>300)throw new Error('Invalid transaction calendar response');
    var seen=new Set(), seenYears=new Set(), count=0;
    var years=value.years.map(function(year){
      if(!year || !Number.isInteger(year.year) || year.year<1900 || year.year>9999 || seenYears.has(year.year) || !validCount(year.count) || !Array.isArray(year.months) || !year.months.length || year.months.length>12)throw new Error('Invalid transaction calendar year');
      seenYears.add(year.year);var total=0;
      var months=year.months.map(function(month){
        var period=year.year+'-'+String(month && month.month).padStart(2,'0');
        if(!month || month.year!==year.year || !Number.isInteger(month.month) || month.month<1 || month.month>12 || month.period!==period || seen.has(period) || !validCount(month.count) || month.count===0 || typeof month.closed!=='boolean' || month.closed!==(period<value.currentPeriod))throw new Error('Invalid transaction calendar month');
        var end=new Date(Date.UTC(year.year,month.month,0)).getUTCDate();
        if(month.from!==period+'-01' || month.to!==period+'-'+end)throw new Error('Invalid transaction calendar dates');
        seen.add(period);total+=month.count;
        return {period:period,year:year.year,month:month.month,count:month.count,closed:month.closed,from:month.from,to:month.to};
      }).sort(function(a,b){return b.period.localeCompare(a.period);});
      if(total!==year.count)throw new Error('Invalid transaction calendar total');count+=total;
      return {year:year.year,count:year.count,months:months};
    }).sort(function(a,b){return b.year-a.year;});
    if(count!==value.total)throw new Error('Invalid transaction calendar count');
    return {timezone:value.timezone,currentPeriod:value.currentPeriod,total:value.total,years:years};
  }
  function monthTitle(month) { return language()==='en' || language()==='es' ? new Intl.DateTimeFormat(language(),{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(month.year,month.month-1,1))) : month.month+t('month'); }
  var active=null;
  function mount(root, options) {
    options=options || {};
    if(!root || !options.api || typeof options.api.transactionArchives!=='function')throw new Error('Transaction calendar API unavailable');
    if(active)active.destroy();
    root.classList.add('transaction-archive');root.setAttribute('data-i18n-skip','');
    var state={root:root,api:options.api,onChange:typeof options.onChange==='function'?options.onChange:function(){},destroyed:false,data:null,groups:[],base:{},activity:null,baseActivity:undefined,period:null,page:1,total:0,rowCount:0,loading:false,error:false,request:0,pending:null,pendingKey:'',queryKey:'',openYears:new Set(),initialized:false,timer:null,clockPeriod:taipeiPeriod(now())};
    function now(){return options.now?options.now():Date.now();}
    function alive(){return !state.destroyed && root.isConnected;}
    function changed(){if(alive())state.onChange();}
    function pickMonth(period){if(!state.data)return null;for(var i=0;i<state.data.years.length;i++){var found=state.data.years[i].months.filter(function(m){return m.period===period;})[0];if(found)return found;}return null;}
    function currentMonth(){return pickMonth(state.period);}
    function updateClock(){
      if(!alive()){destroy();return;}
      var period=taipeiPeriod(now());
      if(period!==state.clockPeriod){state.clockPeriod=period;state.page=1;changed();}
      schedule();
    }
    function schedule(){clearTimeout(state.timer);if(!state.destroyed){state.timer=setTimeout(updateClock,nextBoundaryDelay(now()));if(state.timer && state.timer.unref)state.timer.unref();}}
    function focusKey(){var target=document.activeElement;return target && root.contains(target)?target.getAttribute('data-archive-focus'):null;}
    function render(){
      if(!alive())return;
      var focus=focusKey(), frag=document.createDocumentFragment();
      var heading=node('div','transaction-archive__heading');heading.appendChild(node('h2','',t('title')));
      var label=node('label','transaction-archive__activity'), select=node('select');label.appendChild(node('span','',t('activity')));select.setAttribute('data-archive-activity','');select.setAttribute('data-archive-focus','activity');select.setAttribute('aria-label',t('activity'));
      var all=node('option','',t('all'));all.value='all';select.appendChild(all);
      var groups=state.groups.slice();if(state.activity && state.activity!=='all' && !groups.some(function(g){return g.id===state.activity;}))groups.unshift({id:state.activity,name:t('unknown')});
      groups.forEach(function(g){var option=node('option','',g.name);option.value=g.id;select.appendChild(option);});select.value=state.activity || 'all';select.disabled=state.loading;label.appendChild(select);heading.appendChild(label);frag.appendChild(heading);
      frag.appendChild(node('p','transaction-archive__intro',t('intro')));frag.appendChild(node('p','transaction-archive__note',t('searchNote')+' '+t('tz')));
      var status=node('p','transaction-archive__status',state.loading?t('loading'):state.error?t('failed'):'');status.setAttribute('role','status');status.setAttribute('data-archive-status','');status.hidden=!state.loading&&!state.error;frag.appendChild(status);
      if(state.error){var retry=node('button','btn btn--sm',t('retry'));retry.type='button';retry.setAttribute('data-archive-retry','');retry.setAttribute('data-archive-focus','retry');frag.appendChild(retry);}
      var folders=node('div','transaction-archive__folders');folders.setAttribute('aria-label',t('title'));
      (state.data?state.data.years:[]).forEach(function(year){
        var details=node('details','transaction-archive__year');details.setAttribute('data-archive-year',year.year);details.open=state.openYears.has(year.year);
        var summary=node('summary');summary.setAttribute('data-archive-focus','year-'+year.year);summary.appendChild(node('strong','',year.year+t('year')));summary.appendChild(node('span','transaction-archive__count',year.count+' '+t('count')));details.appendChild(summary);
        var months=node('div','transaction-archive__months');
        year.months.forEach(function(month){var button=node('button','transaction-archive__month');button.type='button';button.setAttribute('data-archive-month',month.period);button.setAttribute('data-archive-focus','month-'+month.period);button.setAttribute('aria-pressed',month.period===state.period?'true':'false');button.disabled=state.loading;button.appendChild(node('strong','',monthTitle(month)));button.appendChild(node('span','transaction-archive__count',month.count+' '+t('count')));button.appendChild(node('span','transaction-archive__badge'+(month.closed?' is-closed':''),month.closed?t('closed'):month.period===state.data.currentPeriod?t('current'):t('future')));months.appendChild(button);});details.appendChild(months);folders.appendChild(details);
      });frag.appendChild(folders);
      if(state.data && !state.data.years.length && !state.error){var empty=node('div','transaction-archive__empty');empty.appendChild(node('strong','',t('empty')));empty.appendChild(node('p','',t('emptyHelp')));frag.appendChild(empty);}
      var month=currentMonth();
      if(month){var footer=node('div','transaction-archive__navigation');footer.appendChild(node('strong','transaction-archive__selected',t('selected')+' '+month.period));var result=node('span','transaction-archive__result',t('results')+' '+state.total+' '+t('count'));result.setAttribute('data-archive-result','');footer.appendChild(result);var controls=node('div','transaction-archive__pages');var previous=node('button','btn btn--sm',t('previous'));previous.type='button';previous.setAttribute('data-archive-page','previous');previous.setAttribute('data-archive-focus','previous');previous.disabled=state.loading||state.page<=1;controls.appendChild(previous);var pages=Math.max(1,Math.ceil(state.total/PAGE_SIZE));controls.appendChild(node('span','',t('page')+' '+state.page+' '+t('of')+' '+pages));var next=node('button','btn btn--sm',t('next'));next.type='button';next.setAttribute('data-archive-page','next');next.setAttribute('data-archive-focus','next');next.disabled=state.loading||state.page>=pages;controls.appendChild(next);footer.appendChild(controls);frag.appendChild(footer);}
      root.replaceChildren(frag);root.setAttribute('aria-busy',state.loading?'true':'false');
      if(focus){var replacement=Array.prototype.find.call(root.querySelectorAll('[data-archive-focus]'),function(el){return el.getAttribute('data-archive-focus')===focus;});if(replacement && !replacement.disabled)replacement.focus({preventScroll:true});}
    }
    function indexFilters(base){var out=cloneFilters(base);delete out.q;out.groupId=state.activity || 'all';return out;}
    function makeQuery(base){var month=currentMonth();if(!month)return null;var query=cloneFilters(base);query.groupId=state.activity || 'all';query.from=base.from && base.from>month.from?base.from:month.from;query.to=base.to && base.to<month.to?base.to:month.to;query.page=state.page;return query;}
    async function prepare(base){
      if(!alive())return null;
      base=cloneFilters(base);var baseActivity=String(base.groupId || 'all');
      if(state.baseActivity!==baseActivity){state.baseActivity=baseActivity;state.activity=baseActivity;state.period=null;state.page=1;state.openYears.clear();}
      state.base=base;
      var queryKey=JSON.stringify(base)+'|'+state.activity;
      if(queryKey!==state.queryKey){state.queryKey=queryKey;state.page=1;}
      var filters=indexFilters(base), key=JSON.stringify(filters)+'|'+state.clockPeriod, request;
      if(state.pending && state.pendingKey===key){await state.pending;if(!alive()||state.queryKey!==queryKey)return null;return makeQuery(base);}
      request=++state.request;state.pendingKey=key;state.loading=true;state.error=false;render();
      var task=Promise.resolve().then(function(){return state.api.transactionArchives(filters);}).then(function(value){
        if(!alive()||request!==state.request)return;
        var data=validateIndex(value);state.data=data;
        if(!pickMonth(state.period)){state.period=data.years.length?data.years[0].months[0].period:null;state.page=1;}
        var month=currentMonth();if(month && (!state.initialized || !state.openYears.has(month.year)))state.openYears.add(month.year);
        state.initialized=true;state.total=month?month.count:0;state.rowCount=0;
      }).catch(function(error){if(alive()&&request===state.request){state.error=true;state.data=null;state.period=null;state.total=0;}throw error;}).finally(function(){if(alive()&&request===state.request){state.loading=false;state.pending=null;render();}});
      state.pending=task;await task;if(!alive()||request!==state.request||state.queryKey!==queryKey)return null;return makeQuery(base);
    }
    function setResult(result){if(!alive())return;if(!result || !validCount(result.total) || !Array.isArray(result.transactions))throw new Error('Invalid transaction page');state.total=result.total;state.rowCount=result.transactions.length;var lastPage=Math.max(1,Math.ceil(state.total/PAGE_SIZE));if(state.page>lastPage){state.page=lastPage;render();changed();return;}render();}
    function setGroups(groups){if(!alive())return;var seen=new Set();state.groups=(Array.isArray(groups)?groups:[]).filter(function(g){return g && typeof g.id==='string' && g.id && g.id.length<=150 && typeof g.name==='string' && !seen.has(g.id) && seen.add(g.id);}).slice(0,1000).map(function(g){return {id:g.id,name:g.name.slice(0,200)};});render();}
    function click(event){if(!alive())return;var target=event.target.closest && event.target.closest('[data-archive-month],[data-archive-page],[data-archive-retry]');if(!target||!root.contains(target)||target.disabled)return;if(target.hasAttribute('data-archive-month')){state.period=target.getAttribute('data-archive-month');state.page=1;var month=currentMonth();if(month)state.openYears.add(month.year);changed();}else if(target.hasAttribute('data-archive-page')){state.page=Math.max(1,state.page+(target.getAttribute('data-archive-page')==='next'?1:-1));changed();}else changed();}
    function change(event){if(event.target.hasAttribute('data-archive-activity')){state.activity=event.target.value;state.period=null;state.page=1;state.openYears.clear();changed();}}
    function toggle(event){var target=event.target;if(target && target.hasAttribute && target.hasAttribute('data-archive-year')){var year=Number(target.getAttribute('data-archive-year'));if(target.open)state.openYears.add(year);else state.openYears.delete(year);}}
    function relabel(){render();}
    function visibility(){if(!document.hidden)updateClock();}
    function destroy(){if(state.destroyed)return;state.destroyed=true;state.request++;clearTimeout(state.timer);root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('toggle',toggle,true);document.removeEventListener('visibilitychange',visibility);global.removeEventListener('fambudget:languagechange',relabel);if(active===controller)active=null;}
    root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('toggle',toggle,true);document.addEventListener('visibilitychange',visibility);global.addEventListener('fambudget:languagechange',relabel);
    var controller={prepare:prepare,setResult:setResult,setGroups:setGroups,destroy:destroy,refresh:function(){changed();}};active=controller;render();schedule();return controller;
  }
  global.TransactionArchive={mount:mount,currentPeriod:taipeiPeriod,nextBoundaryDelay:nextBoundaryDelay};
})(window);
