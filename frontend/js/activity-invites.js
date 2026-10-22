/* Activity invitations are separate from family membership. No account/code is persisted. */
(function (global) {
  'use strict';
  var fallback = {
    joinTitle:'加入活動', joinHelp:'輸入朋友提供的活動邀請碼。加入活動不會加入對方的家庭，也不會公開其他收支。',
    mock:'目前是單機模擬；跨帳號活動邀請需使用已連線的正式網站。',
    code:'活動邀請碼', join:'加入活動', received:'收到的活動邀請', noReceived:'目前沒有待回覆的活動邀請。',
    invite:'邀請朋友', inviteHelp:'朋友不必先加入家庭；只有加入這個活動後，才能查看活動內授權的紀錄。',
    email:'朋友的完整 email', search:'尋找帳號', send:'送出邀請', available:'找到帳號，可送出活動邀請。',
    member:'這個帳號已是活動成員。', invited:'已送出邀請，等待對方回覆。', unavailable:'目前無法邀請這個帳號。',
    codeTitle:'或產生活動邀請碼', label:'邀請碼名稱（選填）', createCode:'產生邀請碼', codeNotice:'邀請碼只在這次顯示，7 天內可使用一次。請只分享給要加入的朋友。',
    copy:'複製邀請碼', copied:'已複製邀請碼。', copyManual:'無法自動複製，請選取上方邀請碼後複製。',
    pending:'等待加入', noPending:'目前沒有待回覆的邀請。', cancel:'取消邀請', accept:'接受並加入', decline:'婉拒',
    codeInvitation:'活動邀請碼', expires:'有效期限', loading:'載入中…', failed:'暫時無法完成，請稍後再試。',
    sent:'活動邀請已送出。', cancelled:'已取消邀請。', declined:'已婉拒邀請。', joined:'已加入活動。',
    unsafe:'回應格式不符，請重新整理後再試。', closed:'活動已結算，不能新增成員。'
  };
  function t(key) { return global.I18n ? global.I18n.t('activity.' + key, fallback[key] || key) : fallback[key] || key; }
  function el(tag, cls, value) { var node=document.createElement(tag);if(cls)node.className=cls;if(value!=null)node.textContent=String(value);return node; }
  function label(node,key){node.dataset.activityLabel=key;node.textContent=t(key);return node;}
  function text(tag,key,cls){return label(el(tag,cls),key);}
  function add(root){for(var i=1;i<arguments.length;i++)if(arguments[i])root.appendChild(arguments[i]);return root;}
  function button(key,kind){var node=text('button',key,'btn btn--sm'+(kind?' '+kind:''));node.type='button';return node;}
  function status(root,key,error){root.textContent=t(key);root.classList.toggle('is-error',!!error);}
  function message(root,error){root.textContent=error&&typeof error.message==='string'?error.message:t('failed');root.classList.add('is-error');}
  function live(root){return root&&root.isConnected;}
  function busy(button,promise){button.disabled=true;return Promise.resolve(promise).finally(function(){if(button.isConnected)button.disabled=false;});}
  function safeList(value,key){if(!value||!Array.isArray(value[key]))throw Error(t('unsafe'));return value[key];}
  function api(){return global.API;}
  function field(key,input){var lab=el('label','fld');add(lab,text('span',key),input);return lab;}
  function expiration(value){if(!value)return '';var date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString(global.I18n?global.I18n.language():'zh-TW'):'';}
  function prepare(root){root.replaceChildren();root.classList.add('activity-invites');root.setAttribute('data-i18n-skip','');if(api()&&api().mode==='mock')root.appendChild(text('p','mock','activity-mock-note'));}

  function mountReceived(root,onChange) {
    if(!root)return;prepare(root);
    var joinForm=el('form','activity-join'),code=el('input'),join=button('join','btn--go'),feedback=el('p','activity-feedback');
    code.type='text';code.required=true;code.maxLength=64;code.autocomplete='off';code.spellcheck=false;code.autocapitalize='characters';
    join.type='submit';feedback.setAttribute('role','status');
    add(joinForm,field('code',code),join);
    var received=el('div','activity-received');
    add(root,text('h2','joinTitle'),text('p','joinHelp','flow-help'),joinForm,feedback,text('h3','received'),received);
    joinForm.addEventListener('submit',function(event){event.preventDefault();var literal=code.value.trim();if(!literal||join.disabled)return;
      busy(join,Promise.resolve().then(function(){return api().joinGroup(literal);})).then(function(result){if(!live(root))return;code.value='';status(feedback,'joined');if(onChange)onChange(result.group);}).catch(function(error){if(live(root))message(feedback,error);});
    });
    received.appendChild(text('p','loading'));
    Promise.resolve().then(function(){return api().receivedGroupInvites();}).then(function(result){
      if(!live(root))return;var rows=safeList(result,'received').filter(function(item){return item.status==='pending';});received.replaceChildren();
      if(!rows.length){received.appendChild(text('p','noReceived','flow-help'));return;}
      rows.forEach(function(item){
        var card=el('article','activity-invitation'),name=el('strong','',item.groupName||''),by=el('p','',item.inviterName||''),when=el('small','',expiration(item.expiresAt)),actions=el('div','activity-actions'),accept=button('accept','btn--go'),decline=button('decline');
        add(actions,accept,decline);add(card,name,by,when,actions);received.appendChild(card);
        accept.addEventListener('click',function(){if(accept.disabled)return;decline.disabled=true;busy(accept,api().acceptGroupInvite(item.id)).then(function(result){if(!live(root))return;status(feedback,'joined');card.remove();if(onChange)onChange(result.group);}).catch(function(error){if(live(root)){decline.disabled=false;message(feedback,error);}});});
        decline.addEventListener('click',function(){if(decline.disabled)return;accept.disabled=true;busy(decline,api().declineGroupInvite(item.id)).then(function(){if(!live(root))return;card.remove();status(feedback,'declined');if(!received.children.length)received.appendChild(text('p','noReceived','flow-help'));}).catch(function(error){if(live(root)){accept.disabled=false;message(feedback,error);}});});
      });
    }).catch(function(error){if(live(root))message(received,error);});
  }

  function mountOwner(root,group,onChange) {
    if(!root||!group)return;prepare(root);
    if(group.settled){root.appendChild(text('p','closed'));return;}
    var feedback=el('p','activity-feedback'),searchForm=el('form','activity-invite-search'),email=el('input'),search=button('search'),found=el('div','activity-found');
    feedback.setAttribute('role','status');found.setAttribute('aria-live','polite');email.type='email';email.required=true;email.maxLength=254;email.autocomplete='off';search.type='submit';
    add(searchForm,field('email',email),search);
    var codeForm=el('form','activity-code-form'),codeLabel=el('input'),create=button('createCode'),codeResult=el('div','activity-code-result'),pending=el('div','activity-pending');
    codeLabel.type='text';codeLabel.maxLength=30;create.type='submit';add(codeForm,field('label',codeLabel),create);
    add(root,text('h3','invite'),text('p','inviteHelp','flow-help'),searchForm,found,text('h4','codeTitle'),codeForm,codeResult,feedback,text('h4','pending'),pending);
    function loadPending(){
      pending.replaceChildren(text('p','loading'));
      return Promise.resolve().then(function(){return api().groupInvites(group.id);}).then(function(result){
        if(!live(root))return;var rows=safeList(result,'sent').filter(function(item){return item.status==='pending';});pending.replaceChildren();
        if(!rows.length){pending.appendChild(text('p','noPending','flow-help'));return;}
        rows.forEach(function(item){var row=el('div','activity-pending-row'),info=el('div'),title=item.isCode?(item.label||t('codeInvitation')):(item.inviteeName||''),cancel=button('cancel');
          add(info,el('b','',title),el('small','',expiration(item.expiresAt)));add(row,info,cancel);pending.appendChild(row);
          cancel.addEventListener('click',function(){busy(cancel,api().cancelGroupInvite(group.id,item.id)).then(function(){if(!live(root))return;status(feedback,'cancelled');loadPending();}).catch(function(error){if(live(root))message(feedback,error);});});
        });
      }).catch(function(error){if(live(root))message(pending,error);});
    }
    searchForm.addEventListener('submit',function(event){event.preventDefault();if(search.disabled)return;var literal=email.value.trim();if(!literal)return;found.replaceChildren();
      busy(search,Promise.resolve().then(function(){return api().lookupGroupUser({groupId:group.id,email:literal});})).then(function(result){
        if(!live(root))return;var state=['available','member','invited','unavailable'].indexOf(result.status)>=0?result.status:'unavailable';
        if(result.user&&typeof result.user.name==='string')found.appendChild(el('b','',result.user.name));found.appendChild(text('p',state));
        if(state==='available'&&result.user&&result.user.id){var send=button('send','btn--go');found.appendChild(send);send.addEventListener('click',function(){busy(send,api().inviteGroupMember(group.id,result.user.id)).then(function(){if(!live(root))return;found.replaceChildren(text('p','invited'));status(feedback,'sent');loadPending();}).catch(function(error){if(live(root))message(feedback,error);});});}
      }).catch(function(error){if(live(root))message(found,error);});
    });
    codeForm.addEventListener('submit',function(event){event.preventDefault();if(create.disabled)return;
      busy(create,api().createGroupInviteCode(group.id,{label:(codeLabel.value.trim()||t('invite')).slice(0,30)})).then(function(result){
        if(!live(root))return;if(!result||typeof result.code!=='string'||!result.code.trim())throw Error(t('unsafe'));
        codeResult.replaceChildren();var literal=el('input','activity-code'),copy=button('copy');literal.value=result.code;literal.readOnly=true;literal.setAttribute('aria-label',t('code'));
        add(codeResult,literal,copy,text('p','codeNotice','flow-help'),el('small','',expiration(result.expiresAt)));
        copy.addEventListener('click',function(){var clipboard=global.navigator&&global.navigator.clipboard;if(!clipboard||!clipboard.writeText){literal.focus();literal.select();status(feedback,'copyManual');return;}
          clipboard.writeText(literal.value).then(function(){if(live(root))status(feedback,'copied');}).catch(function(){if(live(root)){literal.focus();literal.select();status(feedback,'copyManual');}});});
        codeLabel.value='';loadPending();
      }).catch(function(error){if(live(root))message(feedback,error);});
    });
    loadPending();
  }
  global.addEventListener('fambudget:languagechange',function(){document.querySelectorAll('[data-activity-label]').forEach(function(node){node.textContent=t(node.dataset.activityLabel);});});
  global.ActivityInvites={mountReceived:mountReceived,mountOwner:mountOwner};
})(window);
