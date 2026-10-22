/* Pinned, on-device OCR shared by receipt entry and the optional AI draft UI.
 * Images/text are never uploaded by this service. Only OCR assets are fetched.
 */
(function (global) {
  'use strict';
  var assets = Object.freeze({script:'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',worker:'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',core:'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',languages:'https://cdn.jsdelivr.net/gh/naptha/tessdata@806cd9adc8c6e8abc11c782db1818c990576bebc/4.0.0_best_int'});
  var scriptPromise = null, busy = false;
  function error(code) { var value = new Error(code); value.code = code; return value; }
  function runtime() {
    if (global.Tesseract && typeof global.Tesseract.createWorker === 'function') return Promise.resolve(global.Tesseract);
    if (!scriptPromise) scriptPromise = new Promise(function (resolve,reject) {
      var script = document.createElement('script');script.src=assets.script;script.crossOrigin='anonymous';script.dataset.receiptOcr='';
      var timer=global.setTimeout(function(){scriptPromise=null;script.remove();reject(error('RECEIPT_OCR_UNAVAILABLE'));},40000);
      script.onload=function(){global.clearTimeout(timer);if(global.Tesseract && typeof global.Tesseract.createWorker==='function')resolve(global.Tesseract);else{scriptPromise=null;script.remove();reject(error('RECEIPT_OCR_UNAVAILABLE'));}};
      script.onerror=function(){global.clearTimeout(timer);scriptPromise=null;script.remove();reject(error('RECEIPT_OCR_UNAVAILABLE'));};document.head.appendChild(script);
    });
    return scriptPromise;
  }
  async function recognize(file, options) {
    options=options || {};var signal=options.signal;
    if (busy) throw error('RECEIPT_OCR_BUSY');
    if (signal && signal.aborted) throw error('RECEIPT_OCR_CANCELLED');
    if (!file || !/^(image\/jpeg|image\/png|image\/webp)$/.test(file.type) || !file.size || file.size>12*1024*1024) throw error('RECEIPT_IMAGE_INVALID');
    var language=options.language==='eng'?'eng':'chi_tra+eng',worker=null,ended=false,timer,abort;
    busy=true;
    var stopped=new Promise(function(_,reject){abort=function(){reject(error('RECEIPT_OCR_CANCELLED'));};if(signal)signal.addEventListener('abort',abort,{once:true});timer=global.setTimeout(function(){reject(error('RECEIPT_OCR_TIMEOUT'));},120000);});
    var work=(async function(){
      var engine=await runtime();if(ended || signal && signal.aborted)throw error('RECEIPT_OCR_CANCELLED');
      var created=await engine.createWorker(language,1,{workerPath:assets.worker,corePath:assets.core,langPath:assets.languages,logger:function(progress){if(!ended && typeof options.onProgress==='function')options.onProgress(progress);}});
      if(ended || signal && signal.aborted){await created.terminate();throw error('RECEIPT_OCR_CANCELLED');}worker=created;
      var value=await worker.recognize(file);if(ended || signal && signal.aborted)throw error('RECEIPT_OCR_CANCELLED');
      var text=value && value.data && value.data.text;
      if(typeof text!=='string' || !text.trim())throw error('RECEIPT_OCR_EMPTY');
      if(text.length>30000)throw error('RECEIPT_OCR_TOO_LARGE');
      return {text:text};
    })();
    try{return await Promise.race([work,stopped]);}
    finally{ended=true;global.clearTimeout(timer);if(signal)signal.removeEventListener('abort',abort);if(worker){try{await worker.terminate();}catch(_){}}busy=false;}
  }
  global.ReceiptOCR=Object.freeze({recognize:recognize,assets:assets});
})(window);
