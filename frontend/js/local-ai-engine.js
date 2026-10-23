/* Shared browser-local LLM controller. Only model weights are cached by WebLLM. */
(function (global) {
  'use strict';
  var VERSION = '0.2.86';
  var script = typeof document !== 'undefined' && document.currentScript;
  var engineURL = new URL(script && script.src || new URL('js/local-ai-engine.js', global.location && global.location.href || 'http://localhost/'));
  var workerLocation = new URL('local-ai-worker.js', engineURL);
  // A new controller release must not reuse an older unversioned worker.
  if (engineURL.searchParams.has('v')) workerLocation.searchParams.set('v', engineURL.searchParams.get('v'));
  var workerURL = workerLocation.href;
  var models = {
    f16: {model:'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',precision:'q4f16_1',estimatedDownloadBytes:290000000,estimatedVramMB:944.62},
    f32: {model:'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',precision:'q4f32_1',estimatedDownloadBytes:290000000,estimatedVramMB:1060.2}
  };
  var worker = null, active = null, nextId = 0, session = 0, selected = null, supportPromise = null;
  var state = {phase:'idle',loaded:false,progress:null,lastError:null};

  function AIError(code, message) { this.name = 'LocalAIError'; this.code = code; this.message = message || code; if (Error.captureStackTrace) Error.captureStackTrace(this, AIError); }
  AIError.prototype = Object.create(Error.prototype); AIError.prototype.constructor = AIError;
  function error(code, message) { return new AIError(code, message); }
  function now() { return global.performance && typeof global.performance.now === 'function' ? global.performance.now() : Date.now(); }
  function sourcePreview(value) {
    if (!value || value.modelTask!=='source-extraction-only' || !value.normalization || value.normalization.sourceExtraction!==true || !value.draft || !Array.isArray(value.draft.items) || value.draft.items.length>10) return null;
    var keys=['kind','amount','currency','date','category','merchant','note','missingFields'],items=[];
    for(var item of value.draft.items){
      if(!item || !['expense','income',null].includes(item.kind) || !(typeof item.amount==='number'&&Number.isFinite(item.amount)&&item.amount>0) || !/^[A-Z]{3}$/.test(item.currency) || !(item.date===null||typeof item.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(item.date)) || !(item.category===null||typeof item.category==='string') || item.merchant!==null || typeof item.note!=='string' || !Array.isArray(item.missingFields))return null;
      var copy={};keys.forEach(function(key){copy[key]=key==='note'?item.note.slice(0,1500):key==='category'&&item[key]!==null?item[key].slice(0,100):key==='missingFields'?item[key].filter(function(field){return keys.slice(0,6).includes(field);}).slice(0,6):item[key];});items.push(copy);
    }
    var coverage=value.normalization.coverage||{},cleanCoverage={status:['complete','partial','unknown'].includes(coverage.status)?coverage.status:'unknown'};
    ['sourceCandidateCount','modelRowCount','draftRowCount','uncoveredSourceCount'].forEach(function(key){cleanCoverage[key]=Number.isInteger(coverage[key])&&coverage[key]>=0?coverage[key]:null;});
    ['missingAmountRows','missingRequiredRows'].forEach(function(key){cleanCoverage[key]=Array.isArray(coverage[key])?coverage[key].filter(function(index){return Number.isInteger(index)&&index>=0&&index<items.length;}).slice(0,10):[];});
    return {draft:{items:items,warnings:[]},modelTask:'source-extraction-only',inferencePerformed:false,modelDraft:null,normalization:{version:'source-candidates-v1',sourceExtraction:true,classificationOnly:true,sourceRuleAssisted:true,requiresHumanReview:true,sourceEvidenceChecked:true,coverage:cleanCoverage,adjustments:[],rejectedRows:[],rowMappings:items.map(function(_,index){return {draftIndex:index,modelRowIndex:null};}),sourceRecovery:{recoveredRows:[],mergedModelRows:[],omittedSourceCount:cleanCoverage.uncoveredSourceCount}}};
  }
  function safeTiming(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var clean = {};
    ['totalMs','firstTokenMs','decodeMs','cleanupMs'].forEach(function(key) { clean[key] = typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 ? value[key] : null; });
    clean.passes = Array.isArray(value.passes) ? value.passes.slice(0,2).map(function(pass) {
      var result = {};
      ['totalMs','firstTokenMs','decodeMs','promptTokens','completionTokens'].forEach(function(key) { result[key] = pass && typeof pass[key] === 'number' && Number.isFinite(pass[key]) && pass[key] >= 0 ? pass[key] : null; });
      result.attempt = pass && Number.isInteger(pass.attempt) && pass.attempt > 0 && pass.attempt <= 2 ? pass.attempt : null;
      result.format = pass && ['json-schema','post-validated-json'].includes(pass.format) ? pass.format : null;
      if (pass && pass.runtime && typeof pass.runtime === 'object' && !Array.isArray(pass.runtime)) {
        result.runtime = {};
        ['e2eMs','firstTokenMs','grammarInitMs','grammarPerTokenMs','prefillTokensPerSecond','decodeTokensPerSecond','outputTokenMs'].forEach(function(key) {
          var value = pass.runtime[key];
          result.runtime[key] = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
        });
      }
      return result;
    }) : [];
    return clean;
  }
  function diagnosticDetails(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var clean = {}, usage = {};
    if (typeof value.rawOutput === 'string') clean.rawOutput = value.rawOutput.slice(0,12000);
    if (typeof value.model === 'string') clean.model = value.model.slice(0,120);
    if (typeof value.finishReason === 'string') clean.finishReason = value.finishReason.slice(0,40);
    if (typeof value.elapsedMs === 'number' && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0) clean.elapsedMs = value.elapsedMs;
    if (['baseline','compact-v1','fast-json-v1','bounded-labels-v1'].includes(value.promptProfile)) clean.promptProfile = value.promptProfile;
    if (['classify-source-candidates','source-extraction-only'].includes(value.modelTask)) clean.modelTask=value.modelTask;
    if (typeof value.inferencePerformed==='boolean') clean.inferencePerformed=value.inferencePerformed;
    var preview=sourcePreview(value.sourcePreview);if(preview)clean.sourcePreview=preview;
    var timing = safeTiming(value.timing); if (timing) clean.timing = timing;
    if (Number.isInteger(value.attempts) && value.attempts > 0) clean.attempts = Math.min(value.attempts,2);
    ['prompt_tokens','completion_tokens','total_tokens','promptTokens','completionTokens','totalTokens'].forEach(function(key) {
      if (value.usage && typeof value.usage[key] === 'number' && Number.isFinite(value.usage[key]) && value.usage[key] >= 0) usage[key] = value.usage[key];
    });
    if (Object.keys(usage).length) clean.usage = usage;
    var validation = value.validation;
    var reasons = ['SOURCE_NOT_FOUND','AMOUNT_NOT_IN_SOURCE','AMOUNT_UNSUPPORTED','AMOUNT_BOUNDARY','EVIDENCE_REUSED','DATE_QUOTE_NOT_FOUND','MERCHANT_QUOTE_NOT_FOUND','INVALID_SHAPE','CLASSIFICATION_NOT_ALLOWED','NO_TRANSACTIONS','NO_USABLE_FIELDS'];
    var fields = ['items','warnings','sourceText','amountText','classification','dateText','currency','merchantText','amount','kind','category','date','merchant','note','missingFields'];
    if (validation && reasons.includes(validation.reason)) {
      clean.validation = {reason:validation.reason};
      if (Number.isInteger(validation.rowIndex) && validation.rowIndex >= 0 && validation.rowIndex < 10) clean.validation.rowIndex = validation.rowIndex;
      if (fields.includes(validation.field)) clean.validation.field = validation.field;
    }
    return Object.keys(clean).length ? clean : null;
  }
  function status() {
    return Object.assign({library:'WebLLM',libraryVersion:VERSION,contextWindow:4096,cachedWeightsRetained:true,busy:!!active}, models.f16, selected || {}, state);
  }
  function call(callback, value) { if (typeof callback === 'function') { try { callback(value); } catch (_) {} } }
  function dispose() { if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); worker = null; } }
  function settle(job, failure, value) {
    if (active !== job) return;
    active = null;
    if (job.signal && job.abort) job.signal.removeEventListener('abort', job.abort);
    if (job.timer) global.clearTimeout(job.timer);
    if (failure) job.reject(failure); else job.resolve(value);
  }
  function reset(code) {
    session++;
    dispose();
    state = {phase:'idle',loaded:false,progress:null,lastError:null};
    if (active) {
      var rejected=error(typeof code === 'string' ? code : 'AI_CANCELLED', code === 'AI_TIMEOUT' ? 'Local AI timed out. Check the download and device.' : 'Local AI operation was cancelled.');
      if(code==='AI_TIMEOUT')rejected.details={promptProfile:active.promptProfile,model:selected&&selected.model||null,elapsedMs:Math.max(0,Math.round(now()-active.started)),modelTask:active.promptProfile==='bounded-labels-v1'?'classify-source-candidates':undefined,sourcePreview:active.preview||null,timing:{totalMs:Math.max(0,Math.round(now()-active.started)),firstTokenMs:active.firstTokenMs,decodeMs:active.firstTokenMs===null?null:Math.max(0,Math.round(now()-active.started-active.firstTokenMs)),cleanupMs:null,passes:[]}};
      settle(active,rejected);
    }
    return status();
  }
  function failWorker(code, message) {
    dispose();
    state.phase = 'error'; state.loaded = false; state.lastError = {code:code,message:message};
    if (active) settle(active, error(code, message));
  }
  function ensureWorker() {
    if (worker) return worker;
    try { worker = new global.Worker(workerURL, {type:'module',name:'fambudget-local-ai'}); }
    catch (_) { throw error('AI_WORKER_FAILED', 'Could not start the local AI worker.'); }
    var ownedWorker = worker;
    worker.onmessage = function (event) {
      if (worker !== ownedWorker || !active) return;
      var message = event.data || {}, job = active;
      if (message.id !== job.id) return;
      if (message.type === 'progress') { state.progress = message.progress; call(job.onProgress, message.progress); return; }
      if (message.type === 'draft-preview') { var preview=job.task==='draft'&&sourcePreview(message.preview);if(preview){job.preview=preview;call(job.onDraftPreview,preview);}return; }
      if (message.type === 'token') { if(job.firstTokenMs===null&&typeof message.text==='string'&&message.text)job.firstTokenMs=Math.max(0,Math.round(now()-job.started));call(job.onToken, message.text); return; }
      if (message.type === 'error') {
        var failure = message.error || {};
        if (job.type === 'load') { dispose(); state.loaded = false; }
        state.phase = state.loaded ? 'ready' : 'error';
        state.lastError = {code:failure.code || 'AI_RUNTIME_FAILED',message:failure.message || 'Local inference failed.'};
        var rejected = error(state.lastError.code, state.lastError.message);
        // Raw output is delivered only to this request's caller, never status or storage.
        var details = diagnosticDetails(failure.details);
        if (details) rejected.details = details;
        settle(job, rejected); return;
      }
      if (message.type === 'result') {
        state.lastError = null;
        if (job.type === 'load') { state.loaded = true; state.progress = {progress:1,text:'Model ready'}; }
        state.phase = state.loaded ? 'ready' : 'idle';
        settle(job, null, job.type === 'load' ? Object.assign(status(),{busy:false}) : message.result);
      }
    };
    worker.onerror = function () { if (worker === ownedWorker) failWorker('AI_WORKER_FAILED', 'The local AI worker stopped. Reload the model to retry.'); };
    worker.onmessageerror = function () { if (worker === ownedWorker) failWorker('AI_WORKER_FAILED', 'The local AI worker returned an unreadable message.'); };
    return worker;
  }
  function request(type, payload, options) {
    options = options || {};
    if (active) return Promise.reject(error('AI_BUSY', 'Another local AI operation is running.'));
    if (options.signal && options.signal.aborted) return Promise.reject(error('AI_CANCELLED', 'Local AI operation was cancelled.'));
    return new Promise(function (resolve, reject) {
      var job = {id:++nextId,type:type,task:payload&&payload.task,promptProfile:payload&&payload.promptProfile,started:now(),firstTokenMs:null,preview:null,resolve:resolve,reject:reject,signal:options.signal,onProgress:options.onProgress,onToken:options.onToken,onDraftPreview:options.onDraftPreview};
      active = job;
      job.abort = function () { if (active === job) reset('AI_CANCELLED'); };
      if (job.signal) job.signal.addEventListener('abort', job.abort, {once:true});
      // A failed import/download must not leave the shared engine busy forever.
      job.timer = global.setTimeout(function () { if (active === job) { reset('AI_TIMEOUT'); state.lastError = {code:'AI_TIMEOUT',message:'Local AI timed out. Check the download and device.'}; } }, type === 'load' ? 15 * 60 * 1000 : payload&&payload.task==='draft' ? 45000 : 3 * 60 * 1000);
      try { ensureWorker().postMessage(Object.assign({id:job.id,type:type}, payload || {})); }
      catch (failure) { dispose(); state.loaded = false; state.phase = 'error'; settle(job, failure.code ? failure : error('AI_WORKER_FAILED', 'Could not send the local AI request.')); }
    });
  }
  async function checkSupport() {
    if (supportPromise) return supportPromise;
    supportPromise = (async function () {
      var reason = null, adapter = null;
      if (global.isSecureContext === false) reason = 'AI_INSECURE_CONTEXT';
      else if (typeof global.Worker !== 'function') reason = 'AI_WORKER_UNAVAILABLE';
      else if (!global.navigator || !global.navigator.gpu) reason = 'AI_WEBGPU_UNAVAILABLE';
      else {
        var timer;
        try { adapter = await Promise.race([global.navigator.gpu.requestAdapter(),new Promise(function (_,reject) { timer = global.setTimeout(function () { reject(error('AI_GPU_TIMEOUT','Device check timed out.')); },10000); })]); if (!adapter) reason = 'AI_GPU_UNAVAILABLE'; }
        catch (cause) { reason = cause && cause.code === 'AI_GPU_TIMEOUT' ? 'AI_GPU_TIMEOUT' : 'AI_GPU_UNAVAILABLE'; }
        finally { if (timer) global.clearTimeout(timer); }
      }
      if (adapter) selected = adapter.features && adapter.features.has('shader-f16') ? models.f16 : models.f32;
      return Object.assign({supported:!reason,reason:reason,library:'WebLLM',libraryVersion:VERSION,contextWindow:4096}, models.f16, selected || {});
    })();
    return supportPromise;
  }
  function prepareSupport(options) {
    return new Promise(function (resolve,reject) {
      var job = {id:++nextId,type:'checking',resolve:resolve,reject:reject,signal:options.signal};
      active = job;
      job.abort = function () { if (active === job) reset('AI_CANCELLED'); };
      if (job.signal) job.signal.addEventListener('abort',job.abort,{once:true});
      checkSupport().then(function (result) { settle(job,null,result); },function () { settle(job,error('AI_GPU_UNAVAILABLE','Could not check the local GPU.')); });
    });
  }
  async function load(options) {
    options = options || {};
    if (active || state.phase === 'loading' || state.phase === 'checking' || state.phase === 'generating') throw error('AI_BUSY', 'Another local AI operation is running.');
    if (options.signal && options.signal.aborted) throw error('AI_CANCELLED', 'Local AI operation was cancelled.');
    if (state.loaded) return status();
    var ownedSession = session, started = now();
    state.phase = 'checking';
    var support = await prepareSupport(options);
    if (ownedSession !== session || options.signal && options.signal.aborted) { if (ownedSession === session) state.phase = 'idle'; throw error('AI_CANCELLED', 'Local AI operation was cancelled.'); }
    if (!support.supported) { state.phase = 'unsupported'; throw error(support.reason, 'This browser/device cannot run the local WebGPU model.'); }
    state.phase = 'loading'; state.progress = null; state.lastError = null;
    var result = await request('load', {model:selected.model}, options);
    return Object.assign({},result,{loadMs:Math.max(0,Math.round(now()-started))});
  }
  async function generate(options) {
    options = options || {};
    if (active || state.phase === 'loading' || state.phase === 'checking' || state.phase === 'generating') throw error('AI_BUSY', 'Another local AI operation is running.');
    if (options.signal && options.signal.aborted) throw error('AI_CANCELLED', 'Local AI operation was cancelled.');
    var tasks = {draft:'draft',receipt:'draft',qa:'qa',ledger:'qa',coach:'coach',report:'report',rules:'rules',help:'rules','report-query':'report-query'};
    var task = tasks[options.task];
    if (!task) throw error('AI_INVALID_TASK', 'Unknown local AI task.');
    if (typeof options.input !== 'string' || !options.input.trim()) throw error('AI_INVALID_INPUT', 'Enter text for the local AI request.');
    if (options.input.length > 3000) throw error('AI_INPUT_TOO_LARGE', 'Use a shorter question or receipt text.');
    var promptProfile = options.promptProfile === undefined ? (task === 'draft' ? 'bounded-labels-v1' : 'compact-v1') : options.promptProfile;
    if (!['baseline','compact-v1','fast-json-v1','bounded-labels-v1'].includes(promptProfile)) throw error('AI_INVALID_PROFILE', 'Unknown local AI generation profile.');
    var ownedSession = session, started = now(), loadMs = 0;
    try {
      if (!state.loaded) {
        var loadStarted = now();
        try { await load({signal:options.signal,onProgress:options.onProgress}); }
        finally { loadMs = Math.max(0,Math.round(now()-loadStarted)); }
      }
      // Awaiting an already-ready load still allows logout or cancellation to win.
      if (ownedSession !== session || options.signal && options.signal.aborted) throw error('AI_CANCELLED', 'Local AI operation was cancelled.');
      state.phase = 'generating'; state.lastError = null;
      var result = await request('generate', {task:task,input:options.input,context:options.context || {},language:options.language || 'zh-TW',promptProfile:promptProfile}, options);
      return Object.assign({},result,{requestMs:Math.max(0,Math.round(now()-started)),loadMs:loadMs});
    } catch (cause) {
      cause.details = Object.assign({},cause.details || {},{requestMs:Math.max(0,Math.round(now()-started)),loadMs:loadMs,promptProfile:promptProfile});
      throw cause;
    }
  }
  async function clearCache(options) {
    if (active || state.phase === 'checking') throw error('AI_BUSY', 'Cancel the current operation before clearing model files.');
    reset(); var ownedSession = session; state.phase = 'clearing';
    try { return await request('clearCache', {models:[models.f16.model,models.f32.model]}, options || {}); }
    finally { if (ownedSession === session) { dispose(); state.phase = 'idle'; state.loaded = false; } }
  }
  global.LocalAI = Object.freeze({checkSupport:checkSupport,load:load,generate:generate,unload:reset,cancel:reset,clearSession:reset,clearCache:clearCache,status:status,getStatus:status,Error:AIError});
})(typeof window !== 'undefined' ? window : globalThis);
