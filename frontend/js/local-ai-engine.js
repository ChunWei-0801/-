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
  function diagnosticDetails(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var clean = {}, usage = {};
    if (typeof value.rawOutput === 'string') clean.rawOutput = value.rawOutput.slice(0,12000);
    if (typeof value.model === 'string') clean.model = value.model.slice(0,120);
    if (typeof value.finishReason === 'string') clean.finishReason = value.finishReason.slice(0,40);
    if (typeof value.elapsedMs === 'number' && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0) clean.elapsedMs = value.elapsedMs;
    if (Number.isInteger(value.attempts) && value.attempts > 0) clean.attempts = Math.min(value.attempts,2);
    ['prompt_tokens','completion_tokens','total_tokens','promptTokens','completionTokens','totalTokens'].forEach(function(key) {
      if (value.usage && typeof value.usage[key] === 'number' && Number.isFinite(value.usage[key]) && value.usage[key] >= 0) usage[key] = value.usage[key];
    });
    if (Object.keys(usage).length) clean.usage = usage;
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
    if (active) settle(active, error(typeof code === 'string' ? code : 'AI_CANCELLED', code === 'AI_TIMEOUT' ? 'Local AI timed out. Check the download and device.' : 'Local AI operation was cancelled.'));
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
      if (message.type === 'token') { call(job.onToken, message.text); return; }
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
      var job = {id:++nextId,type:type,resolve:resolve,reject:reject,signal:options.signal,onProgress:options.onProgress,onToken:options.onToken};
      active = job;
      job.abort = function () { if (active === job) reset('AI_CANCELLED'); };
      if (job.signal) job.signal.addEventListener('abort', job.abort, {once:true});
      // A failed import/download must not leave the shared engine busy forever.
      job.timer = global.setTimeout(function () { if (active === job) { reset('AI_TIMEOUT'); state.lastError = {code:'AI_TIMEOUT',message:'Local AI timed out. Check the download and device.'}; } }, type === 'load' ? 15 * 60 * 1000 : 3 * 60 * 1000);
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
    var ownedSession = session;
    state.phase = 'checking';
    var support = await prepareSupport(options);
    if (ownedSession !== session || options.signal && options.signal.aborted) { if (ownedSession === session) state.phase = 'idle'; throw error('AI_CANCELLED', 'Local AI operation was cancelled.'); }
    if (!support.supported) { state.phase = 'unsupported'; throw error(support.reason, 'This browser/device cannot run the local WebGPU model.'); }
    state.phase = 'loading'; state.progress = null; state.lastError = null;
    return request('load', {model:selected.model}, options);
  }
  async function generate(options) {
    options = options || {};
    if (active || state.phase === 'loading' || state.phase === 'checking' || state.phase === 'generating') throw error('AI_BUSY', 'Another local AI operation is running.');
    if (options.signal && options.signal.aborted) throw error('AI_CANCELLED', 'Local AI operation was cancelled.');
    var tasks = {draft:'draft',receipt:'draft',qa:'qa',ledger:'qa',coach:'coach',report:'report',rules:'rules',help:'rules'};
    var task = tasks[options.task];
    if (!task) throw error('AI_INVALID_TASK', 'Unknown local AI task.');
    if (typeof options.input !== 'string' || !options.input.trim()) throw error('AI_INVALID_INPUT', 'Enter text for the local AI request.');
    if (options.input.length > 3000) throw error('AI_INPUT_TOO_LARGE', 'Use a shorter question or receipt text.');
    var ownedSession = session;
    if (!state.loaded) await load({signal:options.signal});
    // Awaiting an already-ready load still allows logout or cancellation to win.
    if (ownedSession !== session || options.signal && options.signal.aborted) throw error('AI_CANCELLED', 'Local AI operation was cancelled.');
    state.phase = 'generating'; state.lastError = null;
    return request('generate', {task:task,input:options.input,context:options.context || {},language:options.language || 'zh-TW'}, options);
  }
  async function clearCache(options) {
    if (active || state.phase === 'checking') throw error('AI_BUSY', 'Cancel the current operation before clearing model files.');
    reset(); var ownedSession = session; state.phase = 'clearing';
    try { return await request('clearCache', {models:[models.f16.model,models.f32.model]}, options || {}); }
    finally { if (ownedSession === session) { dispose(); state.phase = 'idle'; state.loaded = false; } }
  }
  global.LocalAI = Object.freeze({checkSupport:checkSupport,load:load,generate:generate,unload:reset,cancel:reset,clearSession:reset,clearCache:clearCache,status:status,getStatus:status,Error:AIError});
})(typeof window !== 'undefined' ? window : globalThis);
