/* A movable calculator. Expressions are parsed as arithmetic, never executed. */
(function (global) {
  'use strict';
  var MAX_INPUT = 256, MAX_DEPTH = 40, current = null;
  var words = {
    'zh-TW': {title:'工程計算機',open:'開啟計算機',hide:'暫時隱藏',move:'拖曳移動計算機；聚焦後可用方向鍵移動，Shift 加快',input:'計算式',calculate:'計算',clear:'清除',erase:'刪除一個字元',result:'計算結果',help:'支援括號、次方、三角函數與記憶。% 為百分比，mod 為餘數。',invalid:'請檢查計算式與函數的括號。',domain:'這個算式超出有效範圍，或除數為零。',complex:'計算式太長或太複雜，請分開計算。',memory:'記憶',recall:'取出記憶',addMemory:'加到記憶',subtractMemory:'從記憶扣除',clearMemory:'清除記憶',degrees:'角度制',radians:'弧度制'},
    'zh-CN': {title:'工程计算器',open:'打开计算器',hide:'暂时隐藏',move:'拖动计算器；聚焦后可用方向键移动，Shift 加快',input:'计算式',calculate:'计算',clear:'清除',erase:'删除一个字符',result:'计算结果',help:'支持括号、乘方、三角函数与记忆。% 为百分比，mod 为余数。',invalid:'请检查计算式与函数的括号。',domain:'此算式超出有效范围，或除数为零。',complex:'计算式太长或太复杂，请分开计算。',memory:'记忆',recall:'读取记忆',addMemory:'加到记忆',subtractMemory:'从记忆扣除',clearMemory:'清除记忆',degrees:'角度制',radians:'弧度制'},
    en: {title:'Scientific calculator',open:'Open calculator',hide:'Hide for now',move:'Drag to move; when focused use arrow keys, Shift for larger steps',input:'Expression',calculate:'Calculate',clear:'Clear',erase:'Delete one character',result:'Result',help:'Parentheses, powers, trigonometry and memory. % is percent; mod is remainder.',invalid:'Check the expression and function parentheses.',domain:'The expression is outside the valid range, or divides by zero.',complex:'This expression is too long or complex. Calculate in smaller steps.',memory:'Memory',recall:'Recall memory',addMemory:'Add to memory',subtractMemory:'Subtract from memory',clearMemory:'Clear memory',degrees:'Degrees',radians:'Radians'},
    ja: {title:'関数電卓',open:'電卓を開く',hide:'一時的に隠す',move:'ドラッグで移動。フォーカス後は矢印キー、Shift で大きく移動',input:'数式',calculate:'計算',clear:'クリア',erase:'1文字削除',result:'計算結果',help:'括弧、累乗、三角関数、メモリーに対応。% は百分率、mod は余り。',invalid:'数式と関数の括弧を確認してください。',domain:'有効範囲外、またはゼロによる除算です。',complex:'数式が長すぎるか複雑です。分けて計算してください。',memory:'メモリー',recall:'メモリー呼出',addMemory:'メモリー加算',subtractMemory:'メモリー減算',clearMemory:'メモリー消去',degrees:'度数法',radians:'弧度法'},
    ko: {title:'공학용 계산기',open:'계산기 열기',hide:'잠시 숨기기',move:'드래그해서 이동합니다. 초점 후 방향키, Shift 로 더 크게 이동',input:'계산식',calculate:'계산',clear:'지우기',erase:'한 글자 삭제',result:'결과',help:'괄호, 거듭제곱, 삼각함수, 메모리 지원. % 는 백분율, mod 는 나머지입니다.',invalid:'계산식과 함수의 괄호를 확인하세요.',domain:'유효 범위를 벗어났거나 0으로 나누었습니다.',complex:'계산식이 너무 길거나 복잡합니다. 나누어 계산하세요.',memory:'메모리',recall:'메모리 불러오기',addMemory:'메모리에 더하기',subtractMemory:'메모리에서 빼기',clearMemory:'메모리 지우기',degrees:'도',radians:'라디안'},
    es: {title:'Calculadora científica',open:'Abrir calculadora',hide:'Ocultar por ahora',move:'Arrastra para mover; con el foco usa las flechas, Mayús para pasos mayores',input:'Expresión',calculate:'Calcular',clear:'Borrar',erase:'Borrar un carácter',result:'Resultado',help:'Paréntesis, potencias, trigonometría y memoria. % es porcentaje; mod es resto.',invalid:'Revisa la expresión y los paréntesis de las funciones.',domain:'La expresión está fuera del intervalo válido o divide entre cero.',complex:'La expresión es demasiado larga o compleja. Calcula por partes.',memory:'Memoria',recall:'Recuperar memoria',addMemory:'Sumar a memoria',subtractMemory:'Restar de memoria',clearMemory:'Borrar memoria',degrees:'Grados',radians:'Radianes'}
  };
  function t(key) {
    var language = global.I18n && global.I18n.language ? global.I18n.language() : 'zh-TW';
    var fallback = (words[language] || words.en)[key] || key;
    return global.I18n && global.I18n.t ? global.I18n.t('calculator.' + key, fallback) : fallback;
  }
  function escape(value) { return String(value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function fail(code) { var error = new Error(code); error.code = code; throw error; }
  function finite(value) { if (!Number.isFinite(value)) fail('domain'); return Object.is(value, -0) ? 0 : value; }
  function evaluate(expression, options) {
    if (typeof expression !== 'string' || expression.length > MAX_INPUT) fail('complex');
    var input = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt').toLowerCase();
    var tokens = [], position = 0, depth = 0, angle = options && options.mode === 'RAD' ? 1 : Math.PI / 180;
    while (position < input.length) {
      var rest = input.slice(position), token;
      if (/^\s/.test(rest)) { position++; continue; }
      var number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/.exec(rest);
      var name = /^[a-z]+/.exec(rest);
      if (number) { token = {type:'number', value:finite(Number(number[0]))}; position += number[0].length; }
      else if (name) { token = {type:name[0], value:name[0]}; position += name[0].length; }
      else if (/^[+*/^()%!\-]/.test(rest)) { token = {type:rest[0]}; position++; }
      else fail('invalid');
      tokens.push(token);
      if (tokens.length > MAX_INPUT) fail('complex');
    }
    tokens.push({type:'end'}); var index = 0;
    function is(type) { return tokens[index].type === type; }
    function take(type) { if (!is(type)) return false; index++; return true; }
    function nested(callback) { if (++depth > MAX_DEPTH) fail('complex'); var value = callback(); depth--; return finite(value); }
    function sum() {
      var value = product();
      while (is('+') || is('-')) { var op = tokens[index++].type, right = product(); value = finite(op === '+' ? value + right : value - right); }
      return value;
    }
    function implicit() { return is('(') || is('pi') || is('e') || Object.prototype.hasOwnProperty.call(functions, tokens[index].type); }
    function product() {
      var value = unary();
      while (is('*') || is('/') || is('mod') || implicit()) {
        var op = implicit() ? '*' : tokens[index++].type, right = unary();
        if ((op === '/' || op === 'mod') && right === 0) fail('domain');
        value = finite(op === '*' ? value * right : op === '/' ? value / right : value % right);
      }
      return value;
    }
    function unary() { return nested(function () { if (take('+')) return unary(); if (take('-')) return -unary(); return power(); }); }
    function power() { var value = postfix(); return take('^') ? finite(Math.pow(value, unary())) : value; }
    function postfix() {
      var value = primary();
      while (is('!') || is('%')) {
        if (take('%')) value = finite(value / 100);
        else {
          index++;
          if (!Number.isInteger(value) || value < 0 || value > 170) fail('domain');
          var factorial = 1;
          for (var n = 2; n <= value; n++) factorial *= n;
          value = finite(factorial);
        }
      }
      return value;
    }
    var functions = {
      sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp,
      round: Math.round, floor: Math.floor, ceil: Math.ceil,
      sin: function (v) { return Math.sin(v * angle); },
      cos: function (v) { return Math.cos(v * angle); },
      tan: function (v) { if (Math.abs(Math.cos(v * angle)) < 1e-14) fail('domain'); return Math.tan(v * angle); },
      asin: function (v) { return Math.asin(v) / angle; },
      acos: function (v) { return Math.acos(v) / angle; },
      atan: function (v) { return Math.atan(v) / angle; }
    };
    function primary() {
      if (is('number')) return tokens[index++].value;
      if (take('pi')) return Math.PI;
      if (take('e')) return Math.E;
      if (take('(')) { var value = nested(sum); if (!take(')')) fail('invalid'); return value; }
      var fn = functions[tokens[index].type];
      if (Object.prototype.hasOwnProperty.call(functions, tokens[index].type)) {
        index++; if (!take('(')) fail('invalid');
        var argument = nested(sum); if (!take(')')) fail('invalid');
        return finite(fn(argument));
      }
      fail('invalid');
    }
    if (!tokens.length || is('end')) fail('invalid');
    var result = sum(); if (!is('end')) fail('invalid'); return finite(result);
  }
  function format(value) { return String(Number(finite(value).toPrecision(14))); }
  function storage(key, value) { try { if (arguments.length > 1) global.localStorage.setItem(key, JSON.stringify(value)); else return JSON.parse(global.localStorage.getItem(key)); } catch (_) {} return null; }
  function viewport() {
    var v = global.visualViewport;
    return {x:v ? v.offsetLeft : 0, y:v ? v.offsetTop : 0, width:v ? v.width : global.innerWidth, height:v ? v.height : global.innerHeight};
  }
  function clamp(ctx, x, y) {
    var v = viewport(), rect = ctx.panel.getBoundingClientRect(), margin = 8;
    ctx.position = {x:Math.max(v.x + margin, Math.min(x, v.x + Math.max(margin, v.width - rect.width - margin))), y:Math.max(v.y + margin, Math.min(y, v.y + Math.max(margin, v.height - rect.height - margin)))};
    ctx.panel.style.left = ctx.position.x + 'px'; ctx.panel.style.top = ctx.position.y + 'px';
  }
  function savePosition(ctx) { storage(ctx.key, {x:ctx.position.x, y:ctx.position.y}); }
  function show() {
    if (!current) return;
    var ctx = current; ctx.panel.hidden = false; ctx.pill.hidden = true;
    var v = viewport(); clamp(ctx, ctx.position ? ctx.position.x : v.x + v.width - ctx.panel.offsetWidth - 16, ctx.position ? ctx.position.y : v.y + Math.min(96, Math.max(8, v.height - ctx.panel.offsetHeight - 80)));
    ctx.input.focus({preventScroll:true});
  }
  function hide(ctx) { ctx.panel.hidden = true; ctx.pill.hidden = false; ctx.pill.focus({preventScroll:true}); }
  function destroy() {
    if (!current) return;
    current.abort.abort(); current.panel.remove(); current.pill.remove(); current = null;
  }
  function button(label, action, value, extra) { return '<button type="button" data-calc-action="' + action + '"' + (value ? ' data-calc-value="' + escape(value) + '"' : '') + (extra || '') + '>' + escape(label) + '</button>'; }
  function configure(options) {
    options = options || {};
    if (!options.enabled) { destroy(); return; }
    var userId = options.userId == null ? 'guest' : String(options.userId);
    if (current && current.userId === userId) return;
    destroy();
    var ctx = {userId:userId,key:'fambudget.calculator.position.' + encodeURIComponent(userId),abort:new AbortController(),memory:0,mode:'DEG',position:null,lastResult:null}, signal = ctx.abort.signal;
    var panel = document.createElement('section'); panel.className = 'floating-calculator'; panel.hidden = true; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', t('title'));
    panel.innerHTML = '<div class="floating-calculator__header"><div class="floating-calculator__handle" tabindex="0" role="group" aria-label="' + escape(t('move')) + '" title="' + escape(t('move')) + '"><span aria-hidden="true">⠿</span><strong data-calc-title>' + escape(t('title')) + '</strong></div>' + button('−','hide',null,' aria-label="' + escape(t('hide')) + '" title="' + escape(t('hide')) + '"') + '</div>' +
      '<div class="floating-calculator__body"><label class="floating-calculator__label" for="floating-calculator-input" data-calc-input-label>' + escape(t('input')) + '</label><input id="floating-calculator-input" class="floating-calculator__input" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="256" aria-describedby="floating-calculator-help"><output class="floating-calculator__result" data-calc-result role="status" aria-live="polite" aria-label="' + escape(t('result')) + '">0</output><div class="floating-calculator__meta"><span data-calc-memory aria-label="' + escape(t('memory')) + '">M: 0</span>' + button('DEG','mode',null,' aria-pressed="false" title="' + escape(t('degrees')) + '"') + '</div>' +
      '<div class="floating-calculator__memory">' + button('MC','mc',null,' title="' + escape(t('clearMemory')) + '" aria-label="' + escape(t('clearMemory')) + '"') + button('MR','mr',null,' title="' + escape(t('recall')) + '" aria-label="' + escape(t('recall')) + '"') + button('M+','mplus',null,' title="' + escape(t('addMemory')) + '" aria-label="' + escape(t('addMemory')) + '"') + button('M−','mminus',null,' title="' + escape(t('subtractMemory')) + '" aria-label="' + escape(t('subtractMemory')) + '"') + '</div>' +
      '<div class="floating-calculator__scientific">' + ['sin','cos','tan','sqrt','log','ln','asin','acos','atan','exp','abs'].map(function (fn) { return button(fn === 'sqrt' ? '√' : fn,'insert',fn + '('); }).join('') + button('x!','insert','!') + button('π','insert','pi') + button('e','insert','(e)') + button('xʸ','insert','^') + button('mod','insert',' mod ') + '</div>' +
      '<div class="floating-calculator__keys">' + button('AC','clear',null,' class="is-clear" aria-label="' + escape(t('clear')) + '"') + button('⌫','erase',null,' aria-label="' + escape(t('erase')) + '"') + button('(','insert','(') + button(')','insert',')') + ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','%','+'].map(function (key) { return button(key === '/' ? '÷' : key === '*' ? '×' : key,'insert',key); }).join('') + button('=','calculate',null,' class="is-equals" aria-label="' + escape(t('calculate')) + '"') + '</div>' +
      '<p id="floating-calculator-help" class="floating-calculator__help">' + escape(t('help')) + '</p></div>';
    var pill = document.createElement('button'); pill.type = 'button'; pill.className = 'floating-calculator-launcher'; pill.innerHTML = '<span aria-hidden="true">▦</span><span>' + escape(t('open')) + '</span>'; pill.setAttribute('aria-label', t('open')); pill.setAttribute('aria-controls', 'floating-calculator-input');
    ctx.panel = panel; ctx.pill = pill; ctx.input = panel.querySelector('input'); ctx.output = panel.querySelector('[data-calc-result]');
    current = ctx; document.body.append(panel, pill);
    var saved = storage(ctx.key); if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) ctx.position = {x:saved.x,y:saved.y};
    function displayError(error) { ctx.output.textContent = t(error.code || 'invalid'); ctx.output.classList.add('is-error'); ctx.lastResult = null; }
    function calculate() { try { var value = evaluate(ctx.input.value,{mode:ctx.mode}); ctx.output.textContent = format(value); ctx.output.classList.remove('is-error'); ctx.lastResult = value; return value; } catch (error) { displayError(error); return null; } }
    function insert(value) {
      var input = ctx.input, start = input.selectionStart == null ? input.value.length : input.selectionStart, end = input.selectionEnd == null ? start : input.selectionEnd;
      if (input.value.length - (end - start) + value.length > MAX_INPUT) { displayError({code:'complex'}); return; }
      input.setRangeText(value,start,end,'end'); ctx.output.classList.remove('is-error'); ctx.lastResult = null; input.focus({preventScroll:true});
    }
    function memory() { ctx.panel.querySelector('[data-calc-memory]').textContent = 'M: ' + format(ctx.memory); }
    panel.addEventListener('click', function (event) {
      var buttonNode = event.target.closest('[data-calc-action]'); if (!buttonNode) return;
      var action = buttonNode.dataset.calcAction;
      if (action === 'insert') insert(buttonNode.dataset.calcValue);
      else if (action === 'calculate') calculate();
      else if (action === 'hide') hide(ctx);
      else if (action === 'clear') { ctx.input.value = ''; ctx.output.textContent = '0'; ctx.output.classList.remove('is-error'); ctx.lastResult = null; ctx.input.focus({preventScroll:true}); }
      else if (action === 'erase') {
        var input = ctx.input, start = input.selectionStart || 0, end = input.selectionEnd || 0;
        if (start === end && start > 0) start--; input.setRangeText('',start,end,'end'); ctx.lastResult = null; input.focus({preventScroll:true});
      } else if (action === 'mode') { ctx.mode = ctx.mode === 'DEG' ? 'RAD' : 'DEG'; buttonNode.textContent = ctx.mode; buttonNode.setAttribute('aria-pressed', String(ctx.mode === 'RAD')); buttonNode.title = t(ctx.mode === 'RAD' ? 'radians' : 'degrees'); ctx.lastResult = null; }
      else if (action === 'mc') { ctx.memory = 0; memory(); }
      else if (action === 'mr') insert('(' + format(ctx.memory) + ')');
      else if (action === 'mplus' || action === 'mminus') {
        var value = calculate(); if (value !== null) { try { ctx.memory = finite(ctx.memory + (action === 'mplus' ? value : -value)); memory(); } catch (error) { displayError(error); } }
      }
    },{signal:signal});
    ctx.input.addEventListener('input', function () { ctx.lastResult = null; ctx.output.classList.remove('is-error'); },{signal:signal});
    panel.addEventListener('keydown', function (event) { if (event.key === 'Escape') { event.preventDefault(); hide(ctx); } else if (event.target === ctx.input && (event.key === 'Enter' || event.key === '=')) { event.preventDefault(); calculate(); } },{signal:signal});
    pill.addEventListener('click',show,{signal:signal});
    var handle = panel.querySelector('.floating-calculator__handle'), drag = null;
    handle.addEventListener('pointerdown',function (event) {
      if (event.button !== 0 && event.pointerType !== 'touch') return;
      var rect = panel.getBoundingClientRect(); drag = {id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
      handle.setPointerCapture(event.pointerId); panel.classList.add('is-dragging'); event.preventDefault(); handle.focus({preventScroll:true});
    },{signal:signal});
    handle.addEventListener('pointermove',function (event) { if (drag && drag.id === event.pointerId) { clamp(ctx,drag.left + event.clientX - drag.x,drag.top + event.clientY - drag.y); event.preventDefault(); } },{signal:signal});
    function endDrag(event) { if (!drag || drag.id !== event.pointerId) return; drag = null; panel.classList.remove('is-dragging'); savePosition(ctx); }
    handle.addEventListener('pointerup',endDrag,{signal:signal}); handle.addEventListener('pointercancel',endDrag,{signal:signal}); handle.addEventListener('lostpointercapture',endDrag,{signal:signal});
    handle.addEventListener('keydown',function (event) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      var step = event.shiftKey ? 32 : 8, rect = panel.getBoundingClientRect(), x = rect.left, y = rect.top, v = viewport();
      if (event.key === 'ArrowLeft') x -= step; else if (event.key === 'ArrowRight') x += step; else if (event.key === 'ArrowUp') y -= step; else if (event.key === 'ArrowDown') y += step;
      else if (event.key === 'Home') { x = v.x + 8; y = v.y + 8; } else if (event.key === 'End') { x = v.x + v.width; y = v.y + v.height; } else return;
      event.preventDefault(); clamp(ctx,x,y); savePosition(ctx);
    },{signal:signal});
    function onResize() { if (!panel.hidden) { var rect = panel.getBoundingClientRect(); clamp(ctx,rect.left,rect.top); savePosition(ctx); } }
    global.addEventListener('resize',onResize,{signal:signal});
    if (global.visualViewport) { global.visualViewport.addEventListener('resize',onResize,{signal:signal}); global.visualViewport.addEventListener('scroll',onResize,{signal:signal}); }
    global.addEventListener('fambudget:languagechange',function () { var wasShown = !ctx.panel.hidden; destroy(); configure({enabled:true,userId:userId}); if (wasShown) show(); },{signal:signal});
  }
  global.FloatingCalculator = Object.freeze({configure:configure,destroy:destroy,show:show,evaluate:evaluate});
})(typeof window !== 'undefined' ? window : globalThis);
