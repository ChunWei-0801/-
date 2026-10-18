(function (global) {
  'use strict';
  var account = null, prefs = {}, prefsError = null, revision = 0, pending = null;
  var defaultIds = ['quick-entry','entry','manual-entry','exchange','groups','stats','advice','members','profile','savings-game','health','memories','smoking','calculator','settings','appearance','logout'];
  var labels = ['記一筆','收支明細','手動記帳','國際匯率換算','帳本','統計','財務建議','家庭成員','個人資料與目標','我的存錢筒','身體紀錄與 BMI','記帳小天地','抽菸紀錄','活動計算機','設定與使用教學','主題與背景','登出'];
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function message(e) { return e && e.message || '儲存失敗，請稍後重試。'; }
  function notify(s, bad) { if (global.FamBudgetUI) global.FamBudgetUI.toast(s, bad ? 'err' : 'ok'); }
  function path(p) { if (typeof p !== 'string' || p.indexOf('..') >= 0) throw new Error('不支援的路徑'); return p.indexOf('/api/lifestyle/') === 0 ? p : '/api/lifestyle' + p; }
  function request(method, suffix, data) {
    if (!global.API || global.API.mode !== 'http') return Promise.reject(new Error('此功能需要登入已連接資料庫的網站。'));
    var mine=revision;
    return global.API.request(path(suffix), {method:method, body:data}).then(function(result){
      if(suffix==='/preferences' && mine===revision && account){prefs=result;prefsError=null;configure();}
      return result;
    });
  }
  function imageURL(suffix) { return global.API.fetchMedia(path(suffix)).then(function(r){return r.blob();}).then(function(b){return URL.createObjectURL(b);}); }
  function configure() { if (global.FloatingCalculator) global.FloatingCalculator.configure({enabled:!!(account && prefs.calculatorEnabled),userId:account && account.id}); }
  function setAccount(user) {
    var id = user && String(user.id);
    if (account && id === String(account.id)) { account = user; return pending || Promise.resolve(prefs); }
    document.querySelectorAll('.life-dialog').forEach(function(d){d.close();d.remove();});
    revision++; account = user || null; prefs = {}; prefsError = null; configure();
    if (!user || !global.API || global.API.mode !== 'http') return Promise.resolve(prefs);
    var mine = revision;
    pending = request('GET','/preferences').then(function(p){ if (mine === revision) {prefs=p;configure();} return p; })
      .catch(function(e){if(mine===revision)prefsError=e;return {};}).finally(function(){if(mine===revision)pending=null;});
    return pending;
  }
  function save(patch) { var mine=revision; return request('PUT','/preferences',patch).then(function(p){if(mine!==revision)throw new Error('登入帳號已變更，請重新開啟設定。');prefs=p;prefsError=null;configure();return p;}); }
  function tileId(t) { return t.quick ? 'quick-entry' : t.manual ? 'manual-entry' : t.id || t.nav || (t.href === '#/appearance' ? 'appearance' : ''); }
  function orderTiles(tiles) {
    var byId={}; tiles.filter(Boolean).forEach(function(t){byId[tileId(t)]=t;});
    byId['savings-game']={nav:'savings-game',label:'我的存錢筒',icon:'goal'};
    byId.health={nav:'health',label:'身體紀錄與 BMI',icon:'profile'};
    if (prefs.smokingEnabled) byId.smoking={nav:'smoking',label:'抽菸紀錄',icon:'lungs'};
    if (prefs.calculatorEnabled) byId.calculator={id:'lifeCalculatorOpen',label:'活動計算機',icon:'calculator'};
    var order=(prefs.shortcuts||[]).map(function(s){return s.id;});defaultIds.forEach(function(id){if(order.indexOf(id)<0)order.push(id);});
    return order.filter(function(id){var s=(prefs.shortcuts||[]).find(function(x){return x.id===id;});return byId[id]&&(!s||s.visible);}).map(function(id){return byId[id];});
  }
  function dialog(title, html) {
    var d=document.createElement('dialog'); d.className='life-dialog';
    d.innerHTML='<div class="life-dialog-head"><h2>'+esc(title)+'</h2><button type="button" class="btn btn--sm" data-life-close aria-label="關閉">✕</button></div>'+html;
    document.body.appendChild(d);d.querySelector('[data-life-close]').onclick=function(){d.close();};d.addEventListener('close',function(){d.remove();});d.showModal();return d;
  }
  function openShortcuts() {
    if(prefsError){notify(message(prefsError),true);return;}
    var rows=(prefs.shortcuts||[]).map(function(s){return {id:s.id,visible:s.visible};});defaultIds.forEach(function(id){if(!rows.some(function(s){return s.id===id;}))rows.push({id:id,visible:true});});
    var d=dialog('調整常用功能','<p>勾選要顯示的功能，拖曳列或使用上下按鈕調整順序。設定與登出仍可從右上角設定開啟。</p><div data-life-list></div><p role="status" data-life-status></p><button class="btn btn--go" data-life-save>儲存排列</button>');
    var list=d.querySelector('[data-life-list]'),drag=-1;
    function draw(){list.innerHTML=rows.map(function(s,i){var disabled=s.id==='smoking'&&!prefs.smokingEnabled||s.id==='calculator'&&!prefs.calculatorEnabled;return '<div class="life-shortcut-row" draggable="true" data-row="'+i+'"><label><input type="checkbox" data-visible="'+i+'" '+(s.visible?'checked':'')+'> '+esc(labels[defaultIds.indexOf(s.id)]||s.id)+(disabled?'（功能未開啟）':'')+'</label><div><button class="btn btn--sm" data-move="-1" data-i="'+i+'" '+(!i?'disabled':'')+' aria-label="'+esc(labels[defaultIds.indexOf(s.id)])+'上移">↑</button> <button class="btn btn--sm" data-move="1" data-i="'+i+'" '+(i===rows.length-1?'disabled':'')+' aria-label="'+esc(labels[defaultIds.indexOf(s.id)])+'下移">↓</button></div></div>';}).join('');}
    function move(a,b){if(b<0||b>=rows.length)return;rows.splice(b,0,rows.splice(a,1)[0]);draw();}
    list.onchange=function(e){if(e.target.dataset.visible!==undefined)rows[Number(e.target.dataset.visible)].visible=e.target.checked;};
    list.onclick=function(e){var b=e.target.closest('[data-move]');if(b)move(Number(b.dataset.i),Number(b.dataset.i)+Number(b.dataset.move));};
    list.ondragstart=function(e){var row=e.target.closest('[data-row]');drag=row?Number(row.dataset.row):-1;if(e.dataTransfer)e.dataTransfer.setData('text/plain',String(drag));};
    list.ondragover=function(e){e.preventDefault();};list.ondrop=function(e){e.preventDefault();var row=e.target.closest('[data-row]');if(row&&drag>=0)move(drag,Number(row.dataset.row));drag=-1;};draw();
    d.querySelector('[data-life-save]').onclick=function(e){e.target.disabled=true;save({shortcuts:rows}).then(function(){d.close();notify('常用功能已保存');global.FamBudgetUI.refresh();}).catch(function(err){d.querySelector('[data-life-status]').textContent=message(err);e.target.disabled=false;});};
  }
  function mountSettings(root) {
    var card=document.createElement('section');card.className='card life-settings';
    card.innerHTML='<h2>生活工具與常用功能</h2><p>開關只影響入口顯示；關閉後，已保存的紀錄仍會保留。</p><label><input type="checkbox" data-life-toggle="smokingEnabled" '+(prefs.smokingEnabled?'checked':'')+'> 啟用抽菸紀錄與肺部圖示</label><label><input type="checkbox" data-life-toggle="calculatorEnabled" '+(prefs.calculatorEnabled?'checked':'')+'> 啟用跨頁活動工程計算機</label><p role="status" data-life-status></p><div class="life-settings-links"><button class="btn" data-life-shortcuts>調整常用功能</button><button class="btn" data-life-habits>管理理財習慣選項</button><a class="btn" href="#/savings-game">我的存錢筒</a><a class="btn" href="#/health">身體紀錄與 BMI</a><a class="btn" href="#/reports">日／月／年報表</a></div>';
    (root.querySelector('.page')||root).appendChild(card);
    if(prefsError){card.querySelector('[data-life-status]').textContent='生活設定讀取失敗：'+message(prefsError);card.querySelectorAll('input,button').forEach(function(b){b.disabled=true;});return;}
    card.onchange=function(e){var key=e.target.dataset.lifeToggle;if(!key)return;var input=e.target,patch={};patch[key]=input.checked;input.disabled=true;save(patch).then(function(){notify('功能設定已保存');}).catch(function(err){input.checked=!input.checked;card.querySelector('[data-life-status]').textContent=message(err);}).finally(function(){input.disabled=false;});};
  }
  function openHabits() {
    if(prefsError){notify(message(prefsError),true);return;}
    var mine=revision;
    global.API.financeProfile().then(function(fin){
      if(mine!==revision || !account)return;
      var custom=(prefs.customHabits||[]).map(function(x){return {id:x.id,name:x.name};}), hidden=(prefs.hiddenHabitIds||[]).slice();
      var built=(fin.allHabits||fin.habits||[]).filter(function(x){return x.id.indexOf('custom-')!==0;});
      var d=dialog('管理理財習慣','<p>可隱藏預設選項、新增自己的習慣，或移除自訂選項。</p><div data-habit-built></div><div data-habit-custom></div><form data-habit-add><label>新增習慣<input name="name" maxlength="40" required placeholder="例如：每週存零錢"></label><button class="btn" type="submit">新增</button></form><p role="status" data-life-status></p><button class="btn btn--go" data-habit-save>儲存選項</button>');
      d.querySelector('[data-habit-built]').innerHTML=built.map(function(x){return '<label class="life-habit"><input type="checkbox" data-habit-preset="'+esc(x.id)+'" '+(hidden.indexOf(x.id)<0?'checked':'')+'> '+esc(x.name)+'</label>';}).join('');
      function draw(){d.querySelector('[data-habit-custom]').innerHTML=custom.map(function(x,i){return '<div class="life-shortcut-row"><span data-i18n-skip>'+esc(x.name)+'</span><button class="btn btn--sm" data-remove-habit="'+i+'">移除</button></div>';}).join('');}draw();
      d.querySelector('[data-habit-add]').onsubmit=function(e){e.preventDefault();var input=e.target.elements.name,name=input.value.trim();if(!name||custom.length>=50)return;var seed=global.crypto&&global.crypto.randomUUID?global.crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);custom.push({id:'custom-'+seed,name:name});input.value='';draw();};
      d.addEventListener('change',function(e){var id=e.target.dataset.habitPreset;if(!id)return;hidden=hidden.filter(function(v){return v!==id;});if(!e.target.checked)hidden.push(id);});
      d.addEventListener('click',function(e){var b=e.target.closest('[data-remove-habit]');if(b){custom.splice(Number(b.dataset.removeHabit),1);draw();}});
      d.querySelector('[data-habit-save]').onclick=function(e){e.target.disabled=true;save({customHabits:custom,hiddenHabitIds:hidden}).then(function(){d.close();notify('理財習慣選項已保存');global.FamBudgetUI.refresh();}).catch(function(err){d.querySelector('[data-life-status]').textContent=message(err);e.target.disabled=false;});};
    }).catch(function(e){notify(message(e),true);});
  }
  function enhanceStats(root,rows) {
    var box=document.createElement('section');box.className='card life-report-choice';box.innerHTML='<h2>選擇報表呈現方式</h2><div class="life-chart-controls"><label>圖表<select data-chart-type><option value="line">曲線圖</option><option value="bar">長條圖</option><option value="pie">圓餅圖</option><option value="table">數值表格</option></select></label><label>數值<select data-chart-metric><option value="expense">支出</option><option value="income">收入</option><option value="net">結餘</option></select></label><a class="btn" href="#/reports">選日期看日／月／年報表 →</a></div><div data-chart-host></div>';
    (root.querySelector('.page')||root).prepend(box);function draw(){var metric=box.querySelector('[data-chart-metric]').value;global.ReportCharts.render(box.querySelector('[data-chart-host]'),{rows:rows.map(function(r){return {label:r.label,value:metric==='net'?r.income-r.expense:r[metric]};}),type:box.querySelector('[data-chart-type]').value,title:metric==='income'?'收入':metric==='expense'?'支出':'結餘',unit:'TWD'});}box.onchange=draw;if(global.ReportCharts)draw();
  }
  function beforeRoute(loggedIn){['Wellness','SavingsGame','SmokingTracker'].forEach(function(k){if(global[k]&&global[k].cleanup)global[k].cleanup();});if(global.FinancialReports&&global.FinancialReports.cleanup)global.FinancialReports.cleanup();if(!loggedIn)setAccount(null);}
  document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-life-shortcuts], [data-life-habits], #lifeCalculatorOpen');if(!t)return;e.preventDefault();if(t.id==='lifeCalculatorOpen'){if(global.FloatingCalculator)global.FloatingCalculator.show();}else if(t.hasAttribute('data-life-shortcuts'))openShortcuts();else openHabits();});
  global.LifeAPI={request:request,imageURL:imageURL};
  global.LifeFeatures={setAccount:setAccount,user:function(){return account;},prefs:function(){return prefs;},save:save,orderTiles:orderTiles,mountSettings:mountSettings,openShortcuts:openShortcuts,openHabits:openHabits,enhanceStats:enhanceStats,beforeRoute:beforeRoute};
})(window);
