/* A second, browser-local rearranging game after server-owned piece collection.
 * Only numeric tile order/move counts are persisted; photos and achievements
 * remain in the existing private, authoritative server flow. */
(function (global) {
  'use strict';
  var counts = [9,16,25,36,64,100], prefix = 'fambudget.jigsaw.v1.', sessionStates=Object.create(null);
  var text = {
    'zh-TW':{title:'拼回這張回憶',intro:'拼圖片已集滿，現在請把打亂的圖片拼回原圖。點選兩片即可交換，也可以直接拖曳。',help:'鍵盤可用方向鍵移動，空白鍵或 Enter 選取兩片交換；Escape 取消選取。',progress:'位置正確',moves:'交換次數',selected:'已選取一片，再選另一片交換。',solved:'拼好了！你已親手完成這張拼圖，可以開始下一張。',shuffle:'重新打亂',shuffleConfirm:'確定打亂目前排列並重新計算步數嗎？',confirm:'確認打亂',cancel:'取消',undo:'復原上一步',reference:'查看原圖',back:'回到拼圖',clear:'取消選取',local:'拼回進度只保存在目前瀏覽器；照片、集片進度與成就仍保存在帳號。',noStorage:'此瀏覽器目前無法保存拼回進度；重新整理頁面或離開後可能需要重新拼。',piece:'第',row:'列',column:'欄',tile:'片',board:'交換拼圖',lock:'先把這張圖片拼回原圖，就能開始下一張。',ready:'已完成拼回，可以選擇下一張照片。'},
    en:{title:'Put this memory together',intro:'All pieces are collected. Restore the shuffled picture by selecting two tiles to swap, or drag one onto another.',help:'Use arrow keys to move focus, Space or Enter to swap two tiles, and Escape to clear the selection.',progress:'Correct positions',moves:'Swaps',selected:'One tile selected. Select another to swap.',solved:'Picture restored! You can start your next picture.',shuffle:'Shuffle again',shuffleConfirm:'Shuffle this arrangement and reset the move count?',confirm:'Confirm shuffle',cancel:'Cancel',undo:'Undo last swap',reference:'View original',back:'Back to puzzle',clear:'Clear selection',local:'Rearranging progress stays in this browser. Photos, collected pieces and achievements remain in your account.',noStorage:'This browser cannot save rearranging progress. You may need to start again after reloading or leaving.',piece:'Tile',row:'row',column:'column',tile:'',board:'Tile swapping puzzle',lock:'Restore this picture before starting the next one.',ready:'Picture restored. You can choose your next photo.'},
    'zh-CN':{title:'拼回这张回忆',intro:'拼图片已集满，请把打乱的图片拼回原图。点选两片即可交换，也可直接拖动。',help:'方向键移动，空格或 Enter 选择两片交换；Escape 取消选择。',progress:'位置正确',moves:'交换次数',selected:'已选一片，再选另一片交换。',solved:'拼好了！现在可以开始下一张。',shuffle:'重新打乱',shuffleConfirm:'打乱当前排列并重新计算步数？',confirm:'确认打乱',cancel:'取消',undo:'撤销上一步',reference:'查看原图',back:'回到拼图',clear:'取消选择',local:'拼回进度只保存在当前浏览器；照片、集片进度与成就仍保存在账号。',noStorage:'浏览器目前无法保存拼回进度，离开后可能需要重新拼。',piece:'第',row:'行',column:'列',tile:'片',board:'交换拼图',lock:'先拼回原图，才能开始下一张。',ready:'已拼回原图，可以选择下一张。'},
    ja:{title:'思い出を組み立てよう',intro:'ピースがそろいました。2枚を選んで交換するか、ドラッグして元の画像に戻してください。',help:'矢印キーで移動、Space・Enterで交換、Escapeで選択を解除します。',progress:'正しい位置',moves:'交換回数',selected:'次のピースを選んで交換します。',solved:'完成！次の画像を始められます。',shuffle:'もう一度混ぜる',shuffleConfirm:'配置と交換回数をリセットしますか？',confirm:'混ぜる',cancel:'キャンセル',undo:'1回戻す',reference:'元の画像',back:'パズルへ戻る',clear:'選択解除',local:'組み立ての進捗はこのブラウザーに保存されます。写真、獲得ピース、実績はアカウントに残ります。',noStorage:'進捗を保存できません。再度組み立てが必要になる場合があります。',piece:'ピース',row:'行',column:'列',tile:'',board:'交換パズル',lock:'元の画像に戻すと次の写真を選べます。',ready:'次の写真を選べます。'},
    ko:{title:'추억 사진 맞추기',intro:'조각을 모두 모았습니다. 두 조각을 선택하거나 끌어서 바꿔 원래 사진을 완성하세요.',help:'방향키로 이동하고 Space 또는 Enter로 교환하며 Escape로 선택을 취소합니다.',progress:'올바른 위치',moves:'교환 횟수',selected:'교환할 다른 조각을 선택하세요.',solved:'완성했습니다! 다음 사진을 시작할 수 있습니다.',shuffle:'다시 섞기',shuffleConfirm:'배열과 교환 횟수를 초기화할까요?',confirm:'섞기 확인',cancel:'취소',undo:'마지막 교환 취소',reference:'원본 보기',back:'퍼즐로 돌아가기',clear:'선택 취소',local:'맞추기 진행은 현재 브라우저에 저장됩니다. 사진, 수집 조각과 성취는 계정에 유지됩니다.',noStorage:'이 브라우저는 진행을 저장할 수 없습니다. 다시 맞춰야 할 수 있습니다.',piece:'조각',row:'행',column:'열',tile:'',board:'조각 교환 퍼즐',lock:'사진을 완성한 뒤 다음 사진을 시작하세요.',ready:'다음 사진을 선택할 수 있습니다.'},
    es:{title:'Reconstruye este recuerdo',intro:'Ya tienes todas las piezas. Selecciona dos para intercambiarlas o arrastra una sobre otra hasta reconstruir la foto.',help:'Usa las flechas para moverte, Espacio o Intro para intercambiar y Escape para cancelar la selección.',progress:'Posiciones correctas',moves:'Intercambios',selected:'Selecciona otra pieza para intercambiar.',solved:'¡Completado! Puedes empezar la siguiente foto.',shuffle:'Mezclar de nuevo',shuffleConfirm:'¿Mezclar la disposición y reiniciar los movimientos?',confirm:'Confirmar mezcla',cancel:'Cancelar',undo:'Deshacer intercambio',reference:'Ver original',back:'Volver al puzle',clear:'Cancelar selección',local:'El progreso del puzle se guarda en este navegador. Las fotos, piezas obtenidas y logros siguen en tu cuenta.',noStorage:'Este navegador no puede guardar el progreso. Quizá debas empezar de nuevo al volver.',piece:'Pieza',row:'fila',column:'columna',tile:'',board:'Puzle de intercambio',lock:'Reconstruye la foto antes de empezar la siguiente.',ready:'Puedes elegir la siguiente foto.'}
  };
  function words() { var language=global.I18n&&global.I18n.language?global.I18n.language():document.documentElement.lang; return text[language]||text['zh-TW']; }
  function identity(n) { return Array.from({length:n},function(_,i){return i;}); }
  function correct(order) { return order.reduce(function(total,value,index){return total+(value===index?1:0);},0); }
  function shuffled(n) {
    var order=identity(n);
    for(var i=n-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)),temp=order[i];order[i]=order[j];order[j]=temp;}
    if(correct(order)===n)order.push(order.shift());
    return order;
  }
  function valid(value,n) {
    return value&&value.v===1&&value.n===n&&Number.isSafeInteger(value.moves)&&value.moves>=0&&value.moves<=1000000000&&
      Array.isArray(value.order)&&value.order.length===n&&new Set(value.order).size===n&&value.order.every(function(v){return Number.isInteger(v)&&v>=0&&v<n;});
  }
  function key(owner,game) { return owner&&game?prefix+encodeURIComponent(String(owner)).replace(/\./g,'%2E')+'.'+encodeURIComponent(String(game)).replace(/\./g,'%2E'):null; }
  function element(tag,className,value) { var node=document.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=value;return node; }
  function mount(root,options) {
    options=options||{};
    var n=Number(options.pieceCount),cols=Math.sqrt(n),url=options.imageURL;
    if(!root||counts.indexOf(n)<0||typeof url!=='string'||!/^blob:[^\s"'<>]+$/.test(url))return null;
    var storageKey=key(options.owner,options.gameId),state=null,storageOK=!!storageKey,disposed=false,selected=null,previous=null,drag=null,ignoreClick=false,reference=false,confirming=false;
    var abort=new AbortController(),w=words(),buttons=[],ui={};
    function current(){return !disposed&&root.isConnected&&(!options.isCurrent||options.isCurrent());}
    if(!current())return null;
    if(storageKey)try{var raw=global.localStorage.getItem(storageKey);if(raw&&raw.length<8000){var saved=JSON.parse(raw);if(valid(saved,n))state=saved;}}catch(_){storageOK=false;}
    if(!state&&storageKey&&valid(sessionStates[storageKey],n))state={v:1,n:n,order:sessionStates[storageKey].order.slice(),moves:sessionStates[storageKey].moves};
    if(!state)state={v:1,n:n,order:shuffled(n),moves:0};
    root.className='memories-jigsaw';root.dataset.i18nSkip='';root.dataset.jigsawGame=String(options.gameId||'');root.style.setProperty('--jigsaw-cols',String(cols));
    root.replaceChildren();
    ui.title=element('h3','memories-jigsaw__title',w.title);root.append(ui.title,element('p','memories-help',w.intro));
    ui.summary=element('p','memories-jigsaw__summary');ui.summary.setAttribute('aria-live','polite');ui.summary.dataset.jigsawSummary='';root.append(ui.summary);
    ui.viewport=element('div','memories-jigsaw__viewport');ui.grid=element('div','memories-jigsaw__grid');ui.grid.setAttribute('role','group');ui.grid.setAttribute('aria-label',w.board);ui.grid.dataset.jigsawBoard='';
    for(var i=0;i<n;i++){var button=element('button','memories-jigsaw__tile');button.type='button';button.dataset.jigsawPosition=String(i);button.style.backgroundImage='url("'+url+'")';button.style.backgroundSize=cols*100+'% '+cols*100+'%';ui.grid.append(button);buttons.push(button);}
    ui.reference=element('img','memories-jigsaw__reference');ui.reference.src=url;ui.reference.alt=w.reference;ui.reference.hidden=true;ui.reference.draggable=false;
    ui.viewport.append(ui.grid,ui.reference);root.append(ui.viewport);
    ui.actions=element('div','memories-jigsaw__actions');
    function action(id,label){var b=element('button','btn btn--sm',label);b.type='button';b.dataset.jigsawAction=id;ui.actions.append(b);return b;}
    ui.hint=action('reference',w.reference);ui.undo=action('undo',w.undo);ui.clear=action('clear',w.clear);ui.shuffle=action('shuffle',w.shuffle);root.append(ui.actions);
    ui.confirm=element('div','memories-jigsaw__confirm');ui.confirm.hidden=true;ui.confirm.append(element('p','memories-help',w.shuffleConfirm));
    ['confirm','cancel'].forEach(function(id){var b=element('button','btn btn--sm',id==='confirm'?w.confirm:w.cancel);b.type='button';b.dataset.jigsawAction=id;ui.confirm.append(b);});root.append(ui.confirm);
    ui.notice=element('p','memories-jigsaw__notice');ui.notice.setAttribute('role','status');ui.notice.dataset.jigsawNotice='';root.append(ui.notice);
    root.append(element('p','memories-help memories-jigsaw__keyboard',w.help));ui.local=element('p','memories-help memories-jigsaw__local',storageOK?w.local:w.noStorage);root.append(ui.local);
    function persist(){if(!current()||!storageKey)return;sessionStates[storageKey]={v:1,n:n,order:state.order.slice(),moves:state.moves};try{global.localStorage.setItem(storageKey,JSON.stringify(sessionStates[storageKey]));storageOK=true;}catch(_){storageOK=false;}ui.local.textContent=storageOK?w.local:w.noStorage;}
    function draw(focusAt) {
      if(!current())return;
      var solved=correct(state.order)===n;
      buttons.forEach(function(b,position){var piece=state.order[position],x=piece%cols,y=Math.floor(piece/cols);b.dataset.jigsawPiece=String(piece);b.style.backgroundPosition=x/(cols-1)*100+'% '+y/(cols-1)*100+'%';b.classList.toggle('is-selected',position===selected);b.classList.toggle('is-correct',piece===position);b.setAttribute('aria-pressed',String(position===selected));b.setAttribute('aria-label',w.piece+' '+(piece+1)+' '+w.tile+' · '+w.row+' '+(Math.floor(position/cols)+1)+' · '+w.column+' '+(position%cols+1));b.tabIndex=focusAt===undefined?(position===0?0:-1):(position===focusAt?0:-1);b.disabled=reference;});
      root.classList.toggle('is-solved',solved);ui.summary.textContent=w.progress+' '+correct(state.order)+' / '+n+'　·　'+w.moves+' '+state.moves;
      ui.notice.textContent=solved?w.solved:selected!==null?w.selected:'';
      ui.undo.disabled=!previous;ui.clear.disabled=selected===null;ui.grid.hidden=reference;ui.reference.hidden=!reference;ui.hint.textContent=reference?w.back:w.reference;ui.confirm.hidden=!confirming;
      if(typeof options.onState==='function')options.onState({solved:solved,moves:state.moves,correct:correct(state.order),total:n,storageAvailable:storageOK});
      if(focusAt!==undefined&&!reference)buttons[focusAt].focus({preventScroll:true});
    }
    function swap(a,b){if(!current()||a===b||reference||!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=n||b>=n)return;previous={order:state.order.slice(),moves:state.moves};var piece=state.order[a];state.order[a]=state.order[b];state.order[b]=piece;state.moves=Math.min(1000000000,state.moves+1);selected=null;persist();draw(b);}
    function choose(position){if(reference||!current())return;if(selected===null){selected=position;draw(position);}else if(selected===position){selected=null;draw(position);}else swap(selected,position);}
    function clearDrag(){if(drag){var b=buttons[drag.position];b.classList.remove('is-dragging');try{if(b.hasPointerCapture(drag.id))b.releasePointerCapture(drag.id);}catch(_){}drag=null;}ui.grid.classList.remove('is-dragging');buttons.forEach(function(b){b.classList.remove('is-drop-target');});}
    root.addEventListener('click',function(event){
      if(!current())return;var tile=event.target.closest('[data-jigsaw-position]'),action=event.target.closest('[data-jigsaw-action]');
      if(tile){if(ignoreClick){ignoreClick=false;return;}choose(Number(tile.dataset.jigsawPosition));return;}
      if(!action)return;var type=action.dataset.jigsawAction;
      if(type==='reference'){clearDrag();selected=null;reference=!reference;draw();}
      if(type==='clear'){selected=null;draw();}
      if(type==='undo'&&previous){state.order=previous.order;state.moves=previous.moves;previous=null;selected=null;persist();draw();}
      if(type==='shuffle'){confirming=true;draw();ui.confirm.querySelector('[data-jigsaw-action="confirm"]').focus();}
      if(type==='cancel'){confirming=false;draw();ui.shuffle.focus();}
      if(type==='confirm'){state={v:1,n:n,order:shuffled(n),moves:0};previous=null;selected=null;confirming=false;reference=false;clearDrag();persist();draw();buttons[0].focus();}
    },{signal:abort.signal});
    root.addEventListener('keydown',function(event){
      if(!current())return;
      if(event.key==='Escape'){clearDrag();selected=null;confirming=false;if(reference)reference=false;draw();return;}
      var tile=event.target.closest('[data-jigsaw-position]');if(!tile||reference)return;
      var index=Number(tile.dataset.jigsawPosition),next=index;
      if(event.key==='ArrowRight')next=Math.min(n-1,index+1);
      else if(event.key==='ArrowLeft')next=Math.max(0,index-1);
      else if(event.key==='ArrowDown')next=Math.min(n-1,index+cols);
      else if(event.key==='ArrowUp')next=Math.max(0,index-cols);
      else if(event.key==='Home')next=Math.floor(index/cols)*cols;
      else if(event.key==='End')next=Math.min(n-1,Math.floor(index/cols)*cols+cols-1);
      else return;
      event.preventDefault();draw(next);
    },{signal:abort.signal});
    ui.grid.addEventListener('pointerdown',function(event){var tile=event.target.closest('[data-jigsaw-position]');if(!current()||!tile||reference||event.button!==0||event.isPrimary===false)return;clearDrag();drag={id:event.pointerId,position:Number(tile.dataset.jigsawPosition),x:event.clientX,y:event.clientY,moved:false};try{tile.setPointerCapture(event.pointerId);}catch(_){}},{signal:abort.signal});
    ui.grid.addEventListener('pointermove',function(event){if(!current()||!drag||drag.id!==event.pointerId)return;if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>7){drag.moved=true;buttons[drag.position].classList.add('is-dragging');ui.grid.classList.add('is-dragging');}if(!drag.moved)return;var over=document.elementFromPoint(event.clientX,event.clientY),tile=over&&over.closest('[data-jigsaw-position]');buttons.forEach(function(b){b.classList.toggle('is-drop-target',b===tile&&b!==buttons[drag.position]);});},{signal:abort.signal});
    ui.grid.addEventListener('pointerup',function(event){if(!drag||drag.id!==event.pointerId)return;var saved=drag,over=document.elementFromPoint(event.clientX,event.clientY),tile=over&&over.closest('[data-jigsaw-position]'),position=tile&&ui.grid.contains(tile)?Number(tile.dataset.jigsawPosition):null;clearDrag();if(saved.moved){ignoreClick=true;global.setTimeout(function(){ignoreClick=false;},0);if(position!==null)swap(saved.position,position);}}, {signal:abort.signal});
    ui.grid.addEventListener('pointercancel',function(){clearDrag();},{signal:abort.signal});
    global.addEventListener('storage',function(event){if(!current()||event.key!==storageKey||!event.newValue||event.newValue.length>=8000)return;try{var saved=JSON.parse(event.newValue);if(valid(saved,n)){clearDrag();state=saved;selected=null;previous=null;draw();}}catch(_){}},{signal:abort.signal});
    persist();draw();
    return {dispose:function(){if(disposed)return;clearDrag();disposed=true;abort.abort();root.replaceChildren();},solved:function(){return correct(state.order)===n;}};
  }
  global.MemoriesJigsaw=Object.freeze({mount:mount,words:words});
})(window);
