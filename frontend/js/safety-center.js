/* Public safety information and cited financial reading. Never reads account or ledger data. */
(function (global) {
  'use strict';
  var KEY = 'fambudget.safety-banner.hidden', initialized = false, financialCache = {}, financialPending = {};
  var keys = ['title','tip','official','close','details','settings','show','device','intro','refresh','loading','failed','empty','stale','synced','attempt','published','source','references','readingIntro','principle','application','original','catalog','verified','education','ready','unavailable','retry','logoutOthers','sessionDescription','sessionSuccess'];
  var words = {
    'zh-TW':['防詐提醒','轉帳前先停一下；陌生投資、假客服或要求操作 ATM，請撥 165 查證。','165 全民防騙網','關閉防詐提醒','查看防詐消息','防詐提醒設定','顯示跨頁防詐提醒','此開關只保存在這台裝置，隨時可重新開啟。','政府公開防詐消息與官方查證管道。請依發布時間閱讀；有疑問先撥 165。','重新整理','正在讀取官方資料…','目前無法連線，請稍後重試或直接使用官方連結。','目前沒有可顯示的官方消息。','目前顯示上次成功同步的資料，尚未取得更新。','最近成功同步','最近嘗試更新','發布時間','資料來源','理財閱讀與參考來源','以下是書籍與官方教育資料的重點整理，供你核對觀念與繼續閱讀。','重點觀念','日常應用','來源原文語言','查看書目／原始來源','來源查核日期','一般理財教育；不是個人投資推薦，也不保證報酬。','官方資料已同步','暫時無法取得官方資料','請稍後再試','登出其他裝置','手機掉了、借別人的電腦忘了登出，可登出其他裝置；這一台會保持登入。','已登出其他裝置，這台保持登入'],
    'zh-CN':['防诈提醒','转账前先停一下；陌生投资、假客服或要求操作 ATM，请拨 165 核实。','165 全民防骗网','关闭防诈提醒','查看防诈消息','防诈提醒设置','显示跨页防诈提醒','此开关只保存在这台设备，随时可重新开启。','政府公开防诈消息与官方核实渠道。请注意发布时间；有疑问先拨 165。','刷新','正在读取官方资料…','目前无法连接，请稍后重试或直接使用官方链接。','目前没有可显示的官方消息。','目前显示上次成功同步的资料，尚未取得更新。','最近成功同步','最近尝试更新','发布时间','资料来源','理财阅读与参考来源','以下是书籍与官方教育资料的重点整理，供你核对观念与继续阅读。','重点观念','日常应用','来源原文语言','查看书目／原始来源','来源核实日期','一般理财教育；不是个人投资推荐，也不保证回报。','官方资料已同步','暂时无法取得官方资料','请稍后再试','退出其他设备','手机丢失或借用电脑忘记退出时，可退出其他设备；这台会保持登录。','已退出其他设备，这台保持登录'],
    en:['Fraud prevention','Pause before transferring money. For suspicious investments, fake support or ATM instructions in Taiwan, call 165.','165 official anti-fraud site','Dismiss fraud reminder','Read fraud alerts','Fraud reminder settings','Show the reminder across pages','This switch is saved only on this device. You can turn it on again anytime.','Public government alerts and official verification channels. Check publication dates; call 165 in Taiwan if unsure.','Refresh','Loading official information…','Connection unavailable. Retry later or use the official links.','No official alerts are available to display.','Showing the last successful sync; newer information could not be retrieved.','Last successful sync','Last update attempt','Published','Source','Financial reading and references','Paraphrased ideas from books and official education resources, with links for checking and further reading.','Key idea','Everyday use','Original source language','View catalog / original source','Source checked','General financial education, not personalized investment recommendations or a promise of returns.','Official information synced','Official information temporarily unavailable','Please try again later','Sign out other devices','Sign out other devices if you lose a phone or forget to sign out on a borrowed computer. This device stays signed in.','Other devices signed out. This device stays signed in.'],
    ja:['詐欺防止','送金前に立ち止まりましょう。不審な投資、偽のサポート、ATM 操作の指示は台湾の 165 で確認してください。','165 公式詐欺対策サイト','注意表示を閉じる','詐欺防止情報を見る','詐欺防止の表示設定','各ページに注意表示を出す','設定はこの端末だけに保存され、いつでも再表示できます。','政府の公開情報と公式の相談窓口です。公開日を確認し、不安な場合は台湾の 165 へ。','更新','公式情報を読み込み中…','接続できません。後で再試行するか公式リンクをご利用ください。','表示できる公式情報はありません。','前回の同期情報です。最新情報を取得できませんでした。','最終同期','最終更新試行','公開日','情報源','お金の学習と参考資料','書籍や公式教材の考え方を要約しています。出典で確認し、さらに学べます。','大切な考え方','日々の活用','出典の言語','書誌・出典を見る','出典の確認日','一般的な金融教育です。個別の投資推奨や利益の保証ではありません。','公式情報を同期しました','公式情報を一時的に取得できません','後でもう一度お試しください','他の端末からログアウト','端末を紛失した場合や共有パソコンでログアウトを忘れた場合に使えます。この端末はログインしたままです。','他の端末からログアウトしました。この端末はログインしたままです。'],
    ko:['사기 예방','송금하기 전 잠시 멈추세요. 의심스러운 투자, 가짜 고객센터, ATM 조작 요구는 대만 165로 확인하세요.','165 공식 사기 예방 사이트','사기 예방 알림 닫기','사기 예방 소식 보기','사기 예방 알림 설정','모든 페이지에 알림 표시','이 설정은 이 기기에만 저장되며 언제든 다시 켤 수 있습니다.','정부 공개 소식과 공식 확인 창구입니다. 게시 날짜를 확인하고 의심되면 대만 165로 문의하세요.','새로 고침','공식 정보를 불러오는 중…','연결할 수 없습니다. 나중에 다시 시도하거나 공식 링크를 이용하세요.','표시할 공식 소식이 없습니다.','마지막으로 동기화한 정보입니다. 최신 정보를 가져오지 못했습니다.','마지막 동기화','마지막 갱신 시도','게시일','출처','금융 학습과 참고 자료','도서와 공식 교육 자료의 개념을 요약했습니다. 출처를 확인하고 더 읽어 보세요.','핵심 개념','일상에서 활용','원문 언어','서지 / 원문 보기','출처 확인 날짜','일반 금융 교육이며 개인 투자 추천이나 수익 보장이 아닙니다.','공식 정보가 동기화되었습니다','공식 정보를 일시적으로 가져올 수 없습니다','나중에 다시 시도하세요','다른 기기에서 로그아웃','휴대전화를 잃어버리거나 빌린 컴퓨터에서 로그아웃을 잊었다면 사용하세요. 이 기기는 로그인 상태를 유지합니다.','다른 기기에서 로그아웃했습니다. 이 기기는 로그인 상태를 유지합니다.'],
    es:['Prevención de fraudes','Pausa antes de transferir dinero. Ante inversiones sospechosas, falso soporte o instrucciones de cajero en Taiwán, llama al 165.','Sitio oficial antifraude 165','Cerrar aviso de fraude','Ver alertas de fraude','Ajustes del aviso antifraude','Mostrar el aviso en todas las páginas','Este ajuste se guarda solo en este dispositivo. Puedes reactivarlo cuando quieras.','Alertas públicas del gobierno y canales oficiales. Revisa las fechas; ante dudas en Taiwán, llama al 165.','Actualizar','Cargando información oficial…','Sin conexión. Reintenta más tarde o usa los enlaces oficiales.','No hay alertas oficiales disponibles.','Se muestra la última sincronización; no se pudo obtener información nueva.','Última sincronización','Último intento','Publicado','Fuente','Lecturas y referencias financieras','Ideas resumidas de libros y recursos educativos oficiales, con enlaces para comprobarlas y seguir leyendo.','Idea principal','Uso cotidiano','Idioma original','Ver catálogo / fuente original','Fuente comprobada','Educación financiera general; no es una recomendación personal de inversión ni garantiza rendimientos.','Información oficial sincronizada','Información oficial temporalmente no disponible','Inténtalo más tarde','Cerrar sesión en otros dispositivos','Cierra las otras sesiones si pierdes el móvil u olvidas salir de un equipo prestado. Este dispositivo sigue conectado.','Se cerraron las otras sesiones. Este dispositivo sigue conectado.']
  };
  function language() { var lang = global.I18n && global.I18n.language ? global.I18n.language() : document.documentElement.lang; return words[lang] ? lang : /^zh/i.test(lang || '') ? 'zh-TW' : 'en'; }
  function t(key) { return words[language()][keys.indexOf(key)] || key; }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function safeURL(value, government) {
    try { var url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (!government || /(^|\.)gov\.tw$/.test(url.hostname) || url.hostname === '165dashboard.tw') ? url.href : ''; } catch (e) { return ''; }
  }
  function link(url, label, government) { var href = safeURL(url, government); return href ? '<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>' : esc(label); }
  function date(value) {
    if (!value) return '—';
    var parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value+'T00:00:00+08:00' : value);
    if (!isFinite(parsed.getTime())) return '—';
    return new Intl.DateTimeFormat(language(), {timeZone:'Asia/Taipei',year:'numeric',month:'short',day:'numeric',hour:/T/.test(value)?'2-digit':undefined,minute:/T/.test(value)?'2-digit':undefined}).format(parsed);
  }
  function hidden() { try { return localStorage.getItem(KEY) === 'true'; } catch (e) { return false; } }
  function setHidden(value) { try { localStorage.setItem(KEY, value ? 'true' : 'false'); } catch (e) {} drawBanner(value); document.querySelectorAll('[data-safety-toggle]').forEach(function (input) { input.checked = !value; }); }
  function drawBanner(forceHidden) {
    var old = document.getElementById('safetyBanner'); if (old) old.remove();
    if (forceHidden === true || (forceHidden !== false && hidden())) return;
    var banner = document.createElement('aside'); banner.id = 'safetyBanner'; banner.className = 'safety-banner'; banner.dataset.i18nSkip = ''; banner.setAttribute('aria-label', t('title'));
    banner.innerHTML = '<div><strong>'+esc(t('title'))+'</strong><p>'+esc(t('tip'))+'</p><div class="safety-links">'+link('https://165.npa.gov.tw/',t('official'),true)+'<a href="#/fraud">'+esc(t('details'))+'</a></div></div><button type="button" class="safety-close" aria-label="'+esc(t('close'))+'">×</button>';
    banner.querySelector('button').onclick = function () { setHidden(true); };
    document.body.appendChild(banner);
  }
  function request(suffix) {
    if(global.API && typeof global.API.fraudUpdates==='function' && /^anti-fraud(?:\?|$)/.test(suffix))return global.API.fraudUpdates({refresh:suffix.indexOf('refresh=true')>=0});
    if(global.API && typeof global.API.financialReferences==='function' && /^financial\?language=/.test(suffix))return global.API.financialReferences({language:decodeURIComponent(suffix.split('language=')[1])});
    var base = global.API && global.API.mode === 'http' ? global.API.base : location.origin;
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 15000);
    return fetch(base+'/api/resources/'+suffix, {method:'GET',headers:{Accept:'application/json'},credentials:'omit',cache:'no-store',signal:controller.signal}).then(function (response) { if (!response.ok) throw new Error('Public source unavailable'); return response.json(); }).finally(function () { clearTimeout(timer); });
  }
  function section(root, name) { var existing = root.querySelector('[data-safety-'+name+']'); if (existing) return existing; var card = document.createElement('section'); card.className = 'card safety-center'; card.setAttribute('data-safety-'+name,''); card.dataset.i18nSkip = ''; (root.querySelector('.page') || root).appendChild(card); return card; }
  function mountSettings(root) {
    var card = section(root, 'settings');
    card.innerHTML = '<h2>'+esc(t('settings'))+'</h2><label class="safety-toggle"><input type="checkbox" data-safety-toggle '+(!hidden()?'checked':'')+'> '+esc(t('show'))+'</label><p>'+esc(t('device'))+'</p><a class="btn" href="#/fraud">'+esc(t('details'))+'</a>';
    card.querySelector('input').onchange = function (e) { setHidden(!e.target.checked); };
  }
  function drawFraud(card) {
    var data = card._safetyData, busy = card._safetyBusy;
    card.innerHTML = '<header class="safety-heading"><h1>'+esc(t('title'))+'</h1><button type="button" class="btn" data-safety-refresh '+(busy?'disabled':'')+'>'+esc(t('refresh'))+'</button></header><p>'+esc(t('intro'))+'</p><div class="safety-links">'+link('https://165.npa.gov.tw/',t('official'),true)+'<a href="tel:165">165</a></div><div role="status" aria-live="polite" data-safety-status>'+esc(busy?t('loading'):card._safetyError?t('failed'):data && data.status==='ready'?t('ready'):t('unavailable'))+'</div>';
    if (data) {
      if (card._safetyError || data.stale || data.status === 'stale') card.insertAdjacentHTML('beforeend','<p class="safety-warning">'+esc(t('stale'))+'</p>');
      card.insertAdjacentHTML('beforeend','<dl class="safety-meta"><div><dt>'+esc(t('synced'))+'</dt><dd>'+esc(date(data.lastSyncedAt))+'</dd></div><div><dt>'+esc(t('attempt'))+'</dt><dd>'+esc(date(data.lastAttemptAt))+'</dd></div><div><dt>'+esc(t('source'))+'</dt><dd>'+link(data.source && data.source.url,data.source && data.source.name || t('official'),true)+'</dd></div></dl>');
      var list = Array.isArray(data.items) ? data.items : [];
      card.insertAdjacentHTML('beforeend',list.length?'<ul class="safety-news" lang="'+esc(data.contentLanguage || 'zh-TW')+'">'+list.map(function (item) { return '<li><h2>'+link(item.url,item.title,true)+'</h2><p>'+esc(item.summary)+'</p><p class="safety-date">'+esc(t('published'))+' <time>'+esc(date(item.publishedAt))+'</time></p></li>'; }).join('')+'</ul>':'<p>'+esc(t('empty'))+'</p>');
      card.insertAdjacentHTML('beforeend','<div class="safety-links">'+(data.officialLinks || []).map(function (item) { return link(item.url,item.title,true); }).join('')+'</div>');
    }
    card.querySelector('[data-safety-refresh]').onclick = function () { loadFraud(card, true); };
  }
  function loadFraud(card, refresh) {
    if (card._safetyBusy) return;
    card._safetyBusy = true; card._safetyError = false; drawFraud(card);
    request('anti-fraud'+(refresh?'?refresh=true':'')).then(function (data) { card._safetyData=data; }).catch(function () { card._safetyError=true; }).finally(function () { card._safetyBusy=false; if (card.isConnected) drawFraud(card); });
  }
  function mountFraud(root) { root.innerHTML='<div class="page safety-page" data-i18n-skip></div>'; var card=section(root,'fraud'); loadFraud(card,false); }
  function catalog(lang) {
    if(financialCache[lang])return Promise.resolve(financialCache[lang]);
    if(financialPending[lang])return financialPending[lang];
    financialPending[lang]=request('financial?language='+encodeURIComponent(lang)).then(function(data){financialCache[lang]=data;return data;}).finally(function(){delete financialPending[lang];});
    return financialPending[lang];
  }
  function drawFinancial(card) {
    var data = card._safetyData;
    card.innerHTML='<h2>'+esc(t('references'))+'</h2><p>'+esc(t('readingIntro'))+'</p><p class="safety-education">'+esc(t('education'))+'</p>';
    if (card._safetyBusy) { card.insertAdjacentHTML('beforeend','<p role="status">'+esc(t('loading'))+'</p>'); return; }
    if (!data) { card.insertAdjacentHTML('beforeend','<p role="status">'+esc(t('failed'))+'</p><button class="btn" data-safety-reading-retry>'+esc(t('refresh'))+'</button>'); card.querySelector('button').onclick=function(){loadFinancial(card);}; return; }
    card.insertAdjacentHTML('beforeend','<div class="safety-reading">'+(data.items || []).map(function(item){return '<article lang="'+esc(item.contentLanguage || 'en')+'"><h3>'+esc(item.title)+'</h3><p class="safety-byline">'+esc([item.author,item.publisher,item.year].filter(Boolean).join(' · '))+'</p><dl><dt>'+esc(t('principle'))+'</dt><dd>'+esc(item.principle)+'</dd><dt>'+esc(t('application'))+'</dt><dd>'+esc(item.application)+'</dd></dl><p>'+link(item.url,t('catalog'),false)+'</p><p class="safety-date">'+esc(t('original'))+': '+esc(item.contentLanguage || 'en')+' · '+esc(t('verified'))+': '+esc(date(item.sourceVerifiedOn))+'</p></article>';}).join('')+'</div>');
  }
  function loadFinancial(card) {
    if(card._safetyBusy)return card._safetyPending;
    card._safetyLanguage=language();card._safetyBusy=true;drawFinancial(card);
    card._safetyPending=catalog(card._safetyLanguage).then(function(data){card._safetyData=data;return data;}).catch(function(){card._safetyData=null;return null;}).finally(function(){
      card._safetyBusy=false;
      if(card.isConnected){if(card._safetyLanguage!==language())loadFinancial(card);else drawFinancial(card);}
    });
    return card._safetyPending;
  }
  function mountFinancial(root) { var card=section(root,'financial');if(card._safetyData && card._safetyLanguage===language()){drawFinancial(card);return Promise.resolve(card._safetyData);}return loadFinancial(card); }
  function financialContext() {
    // Only an explicit caller (for example a user-requested coach response) loads this public catalog.
    return catalog(language()).then(function(data){
      var items=Array.isArray(data.items) ? data.items : [];
      return {items:items.filter(function(item){return safeURL(item.url,false);}).slice(0,3).map(function(item){return {id:item.id,title:item.title,text:String(item.principle || '').slice(0,650)+' '+String(item.application || '').slice(0,650),sourceLink:safeURL(item.url,false)};})};
    });
  }
  function relabel() { drawBanner();if(location.hash==='#/fraud' && global.FamBudgetUI && global.FamBudgetUI.head)global.FamBudgetUI.head(t('title'),'');document.querySelectorAll('[data-safety-session-label]').forEach(function(node){node.textContent=t('logoutOthers');});document.querySelectorAll('[data-safety-session-description]').forEach(function(node){node.textContent=t('sessionDescription');});document.querySelectorAll('[data-nav="fraud"] .dtile__t').forEach(function(label){label.textContent=t('title');});document.querySelectorAll('[data-safety-settings]').forEach(mountSettingsCard);document.querySelectorAll('[data-safety-fraud]').forEach(drawFraud);document.querySelectorAll('[data-safety-financial]').forEach(function(card){if(card._safetyLanguage!==language())loadFinancial(card);else drawFinancial(card);}); }
  function mountSettingsCard(card) { mountSettings(card.parentElement); }
  function init() { if(initialized)return;initialized=true;drawBanner();global.addEventListener('fambudget:languagechange',relabel);global.addEventListener('storage',function(event){if(event.key===KEY)relabel();}); }
  global.SafetyCenter={init:init,refreshLanguage:relabel,mountSettings:mountSettings,mountFraud:mountFraud,mountFinancial:mountFinancial,mountFinancialReferences:mountFinancial,label:t,financialContext:financialContext};
})(window);
