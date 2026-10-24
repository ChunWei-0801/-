/* Installable online web app. Never caches account/API responses. */
(function(g){'use strict';var promptEvent=null;
  g.addEventListener('beforeinstallprompt',function(event){event.preventDefault();promptEvent=event;});
  function show(){if(g.matchMedia('(display-mode: standalone)').matches||navigator.standalone){if(g.FamBudgetUI)g.FamBudgetUI.toast('目前已在App模式使用。','ok');return;}if(promptEvent){var e=promptEvent;promptEvent=null;e.prompt();return;}
    var d=document.createElement('dialog');d.className='life-dialog';d.innerHTML='<div class="life-dialog-head"><h2>安裝家庭記帳</h2><button class="btn" type="button">關閉</button></div><p>iPhone：使用Safari開啟網站，按「分享」→「加入主畫面」，選擇以網頁App開啟。</p><p>Android：開啟瀏覽器選單，選擇「安裝應用程式」或「加入主畫面」。</p><p>加入後可用獨立圖示與全螢幕操作。帳務及行事曆仍需要網路連線；手機系統提醒可使用行事曆匯出檔。</p>';d.querySelector('button').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();}
  if('serviceWorker'in navigator&&location.protocol==='https:')g.addEventListener('load',function(){navigator.serviceWorker.register('/service-worker.js',{scope:'/'}).catch(function(){});},{once:true});
  g.AppInstall={show:show};
})(window);
