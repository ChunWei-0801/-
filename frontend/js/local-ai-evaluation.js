/* Synthetic evaluation and content-free trial diagnostics. No network, storage
 * or model inference. Single trials are never scored against fixed gold cases.
 * Detection (amount + kind) is distinct from exact fields and whole-case success.
 * These fixed cases cannot establish general real-world model accuracy.
 */
(function (root) {
  'use strict';
  var VERSION = 'synthetic-zh-TW-v1';
  var FIELDS = ['amount','kind','category','date','currency','merchant'];
  var QUICK = ['dev-mixed','heldout-salary','heldout-prize','heldout-third-party'];
  var SUITES = ['dev','heldout','quick','all'];
  var PROFILES = ['baseline','compact-v1','fast-json-v1','bounded-labels-v1'];
  var MODELS = ['Qwen2.5-0.5B-Instruct-q4f16_1-MLC','Qwen2.5-0.5B-Instruct-q4f32_1-MLC'];
  var ERROR_CODES = ['AI_ERROR','AI_CANCELLED','AI_TIMEOUT','AI_BUSY','AI_INVALID_DRAFT','AI_NO_DRAFT','AI_EMPTY_OUTPUT','AI_TRUNCATED','AI_INVALID_INPUT','AI_INPUT_TOO_LARGE','AI_CONTEXT_TOO_LARGE','AI_WEBGPU_UNAVAILABLE','AI_GPU_UNAVAILABLE','AI_GPU_TIMEOUT','AI_WORKER_UNAVAILABLE','AI_INSECURE_CONTEXT','AI_RUNTIME_DOWNLOAD_FAILED','AI_MODEL_LOAD_FAILED','AI_NOT_READY'];
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4)) < 1900 || Number(value.slice(0,4)) > 9998) return false;
    var date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
  }
  function suppliedToday(options) {
    if (!options || !validDate(options.today)) throw new TypeError('Provide a valid calendar date in today.');
    return options.today;
  }
  function shifted(today, offset) { return new Date(new Date(today + 'T00:00:00Z').getTime() + offset * 86400000).toISOString().slice(0,10); }
  function context(options) {
    return {today:suppliedToday(options),timezone:'Asia/Taipei',currency:'TWD',categories:[
      {id:'FOOD',name:'餐飲',kind:'expense'},
      {id:'TRANSIT',name:'交通',kind:'expense'},
      {id:'SALARY',name:'薪資',kind:'income'},
      {id:'WINNINGS',name:'中獎收入',kind:'income'},
      {id:'OTHER',name:'其他',kind:'expense'}
    ]};
  }
  function item(amount, kind, category, date, currency, merchant) {
    return {amount:amount,kind:kind,category:category,date:date,currency:currency === undefined ? 'TWD' : currency,merchant:merchant === undefined ? null : merchant};
  }
  function registry(today) {
    var yesterday = shifted(today,-1), result = [];
    function add(id, split, input, items, mode) { result.push({id:id,split:split,input:input,expected:{mode:mode || (items.length ? 'transactions' : 'abstain'),items:items}}); }
    add('dev-food','dev','今天在小松咖啡買三明治87元。',[item(87,'expense','FOOD',today,'TWD','小松咖啡')]);
    add('dev-transit','dev','昨天搭公車23元。',[item(23,'expense','TRANSIT',yesterday)]);
    add('dev-salary','dev','今天領到薪水28460元。',[item(28460,'income','SALARY',today)]);
    add('dev-prize','dev','今天威力彩中了800元。',[item(800,'income','WINNINGS',today)]);
    add('dev-mixed','dev','今天買咖啡49元，今天搭捷運31元。',[item(49,'expense','FOOD',today),item(31,'expense','TRANSIT',today)]);
    add('dev-negated','dev','今天沒有買晚餐96元。',[]);
    add('dev-hypothetical','dev','如果下週中了6400元，我會開始記帳。',[]);
    add('dev-missing-amount','dev','今天買了早餐，但忘記金額。',[item(null,'expense','FOOD',today)],'review');
    add('heldout-food','heldout','昨天晚餐花了116元。',[item(116,'expense','FOOD',yesterday)]);
    add('heldout-transit','heldout','2026-04-18搭台鐵花了172元。',[item(172,'expense','TRANSIT','2026-04-18')]);
    add('heldout-salary','heldout','今天薪資入帳41750元。',[item(41750,'income','SALARY',today)]);
    add('heldout-prize','heldout','今天統一發票中獎1200元。',[item(1200,'income','WINNINGS',today)]);
    add('heldout-ticket','heldout','今天買威力彩花了100元。',[item(100,'expense','OTHER',today)]);
    add('heldout-mixed','heldout','今天領到薪資36000元，今天早餐花了93元。',[item(36000,'income','SALARY',today),item(93,'expense','FOOD',today)]);
    add('heldout-equal-amounts','heldout','今天咖啡45元，今天公車45元。',[item(45,'expense','FOOD',today),item(45,'expense','TRANSIT',today)]);
    add('heldout-three-items','heldout','今天早餐58元；今天捷運42元；今天午餐135元。',[item(58,'expense','FOOD',today),item(42,'expense','TRANSIT',today),item(135,'expense','FOOD',today)]);
    add('heldout-no-win','heldout','今天彩券沒有中獎5000元。',[]);
    add('heldout-third-party','heldout','同事今天領了薪資52000元，這不是我的收入。',[]);
    add('heldout-question','heldout','如果明天買便當105元，應該怎麼記帳？',[]);
    add('heldout-no-transaction','heldout','今天只查看存錢目標，沒有任何交易。',[]);
    add('heldout-no-date','heldout','買早餐72元。',[item(72,'expense','FOOD',null)]);
    add('heldout-currency','heldout','今天午餐花了9.5美元。',[item(9.5,'expense','FOOD',today,'USD')]);
    add('heldout-fullwidth','heldout','今天買咖啡６８．５０元。',[item(68.5,'expense','FOOD',today)]);
    add('heldout-unknown-category','heldout','今天付了46元，商家沒有寫。',[item(46,'expense',null,today)],'review');
    return result;
  }
  function cases(options) {
    var today = suppliedToday(options), split = options.split || 'all';
    if (!SUITES.includes(split)) throw new TypeError('Unknown synthetic suite.');
    return registry(today).filter(function(entry) { return split === 'all' || split === 'quick' && QUICK.includes(entry.id) || entry.split === split; });
  }
  function ratio(numerator, denominator) { return denominator ? numerator / denominator : null; }
  function hasTransaction(row) { return !!row && ['income','expense'].includes(row.kind) && typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount > 0; }
  function fieldEqual(a, b, key) { return Object.prototype.hasOwnProperty.call(a,key) && Object.prototype.hasOwnProperty.call(b,key) && a[key] === b[key]; }
  function fieldMatches(a,b) { return FIELDS.reduce(function(total,key) { return total + (fieldEqual(a,b,key) ? 1 : 0); },0); }
  function compatible(expected, actual) {
    if (hasTransaction(expected)) return hasTransaction(actual) && expected.amount === actual.amount && expected.kind === actual.kind;
    // An explicitly unknown amount/kind is a review reference, never a new transaction.
    return !hasTransaction(actual) && fieldEqual(expected,actual,'amount') && fieldEqual(expected,actual,'kind');
  }
  function assignment(expected, actual) {
    // Optimal one-to-one matching handles two purchases of the same amount without
    // making correctness depend on output order. At most ten model rows are legal.
    var memo = new Map();
    function visit(index, mask) {
      if (index >= expected.length) return {count:0,fields:0,pairs:[]};
      var key = index + ':' + mask;
      if (memo.has(key)) return memo.get(key);
      var best = visit(index+1,mask);
      for (var j=0;j<actual.length;j++) if (!(mask & (1<<j)) && compatible(expected[index],actual[j])) {
        var rest = visit(index+1,mask | (1<<j));
        var choice = {count:rest.count+1,fields:rest.fields+fieldMatches(expected[index],actual[j]),pairs:[[index,j]].concat(rest.pairs)};
        if (choice.count > best.count || choice.count === best.count && choice.fields > best.fields) best = choice;
      }
      memo.set(key,best);return best;
    }
    return visit(0,0).pairs;
  }
  function validReference(expected) { return !!expected && ['transactions','abstain','review'].includes(expected.mode) && Array.isArray(expected.items) && expected.items.length <= 10 && expected.items.every(function(row){return row && typeof row === 'object' && !Array.isArray(row);}); }
  function score(expected, actual) {
    if (!validReference(expected)) throw new TypeError('Invalid synthetic reference.');
    if (!Array.isArray(actual)) throw new TypeError('A completed observation needs an items array.');
    // Do not silently discard illegal extra rows. Ten are eligible for matching;
    // every overflow/malformed row remains an extra candidate and fails the case.
    var observed = actual.map(function(row) { return row && typeof row === 'object' && !Array.isArray(row) ? row : {}; });
    var pairs = assignment(expected.items,observed.slice(0,10)), used = new Set(pairs.map(function(pair){return pair[1];}));
    var referenceTransactions = expected.items.filter(hasTransaction).length;
    var tp = pairs.filter(function(pair){return hasTransaction(expected.items[pair[0]]);}).length;
    var extra = observed.filter(function(_,index){return !used.has(index);});
    var fp = extra.filter(hasTransaction).length, fn = referenceTransactions - tp, matched = 0, byField = {};
    FIELDS.forEach(function(field) {
      var count = pairs.filter(function(pair){return fieldEqual(expected.items[pair[0]],observed[pair[1]],field);}).length;
      matched += count;byField[field] = {matched:count,total:expected.items.length,ratio:ratio(count,expected.items.length)};
    });
    return {
      expectedMode:expected.mode,
      observedCandidates:observed.length,
      manualReview:observed.filter(function(row){return !hasTransaction(row) || !validDate(row.date) || typeof row.category !== 'string' || !row.category || typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency);}).length,
      caseExact:expected.items.length === observed.length && pairs.length === expected.items.length && matched === expected.items.length * FIELDS.length,
      transactionDetection:{truePositive:tp,falsePositive:fp,falseNegative:fn,candidateFalsePositive:extra.length,precision:ratio(tp,tp+fp),recall:ratio(tp,tp+fn)},
      fieldsExact:{matched:matched,total:expected.items.length * FIELDS.length,ratio:ratio(matched,expected.items.length * FIELDS.length),byField:byField}
    };
  }
  function nonnegative(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
  function classificationOnly(row) { return row && (row.modelTask==='classify-source-candidates' || row.promptProfile==='bounded-labels-v1'); }
  function scoreClassification(expected, actual, sourceItems) {
    if(!validReference(expected))throw new TypeError('Invalid synthetic reference.');
    if(!Array.isArray(actual))throw new TypeError('Provide observed classification items.');
    // Source amount/date/currency locate the provided candidates; they earn no
    // model credit. Only kind/category are scored, conditional on source coverage.
    var sources=Array.isArray(sourceItems)?sourceItems:actual,used=new Set(),pairs=[];
    expected.items.forEach(function(reference,index){
      var candidate=sources.findIndex(function(source,at){return at<10&&!used.has(at)&&source&&['amount','date','currency'].every(function(key){return fieldEqual(reference,source,key);});});
      if(candidate>=0){used.add(candidate);pairs.push([index,candidate]);}
    });
    var byField={kind:{matched:0,total:pairs.length},category:{matched:0,total:pairs.length}};
    pairs.forEach(function(pair){['kind','category'].forEach(function(key){var prediction=actual[pair[1]];if(prediction&&fieldEqual(expected.items[pair[0]],prediction,key))byField[key].matched++;});});
    var matched=byField.kind.matched+byField.category.matched,total=pairs.length*2;
    var eligible=expected.items.length>0&&expected.items.length===sources.length&&pairs.length===expected.items.length;
    ['kind','category'].forEach(function(key){byField[key].ratio=ratio(byField[key].matched,byField[key].total);});
    return {scope:'kind-category-given-source-candidates',eligible:eligible,sourceCoverageComplete:eligible,sourceMatchedCandidates:pairs.length,referenceCandidates:expected.items.length,observedCandidates:actual.length,caseExact:eligible&&actual.length===sources.length&&matched===total,fieldsExact:{matched:matched,total:total,ratio:ratio(matched,total),byField:byField}};
  }
  function count(value) { return Number.isInteger(value) && value >= 0 ? value : null; }
  function safeUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    var result = {};
    ['prompt_tokens','completion_tokens','total_tokens','promptTokens','completionTokens','totalTokens'].forEach(function(key){var value=count(usage[key]);if(value !== null)result[key]=value;});
    return Object.keys(result).length ? result : null;
  }
  function safeTiming(timing) {
    if (!timing || typeof timing !== 'object' || Array.isArray(timing)) return null;
    var result={};
    ['totalMs','firstTokenMs','decodeMs','cleanupMs'].forEach(function(key){result[key]=nonnegative(timing[key]);});
    result.passes=Array.isArray(timing.passes) ? timing.passes.slice(0,2).map(function(pass){
      pass=pass && typeof pass==='object' ? pass : {};var entry={attempt:Number.isInteger(pass.attempt) && pass.attempt > 0 && pass.attempt <= 2 ? pass.attempt : null};
      ['totalMs','firstTokenMs','decodeMs'].forEach(function(key){entry[key]=nonnegative(pass[key]);});
      ['promptTokens','completionTokens'].forEach(function(key){entry[key]=count(pass[key]);});
      entry.format=['json-schema','post-validated-json','bounded-labels'].includes(pass.format) ? pass.format : null;
      if(pass.runtime && typeof pass.runtime==='object' && !Array.isArray(pass.runtime)){
        entry.runtime={};['e2eMs','firstTokenMs','grammarInitMs','grammarPerTokenMs','prefillTokensPerSecond','decodeTokensPerSecond','outputTokenMs'].forEach(function(key){entry.runtime[key]=nonnegative(pass.runtime[key]);});
      }
      return entry;
    }) : null;
    return result;
  }
  function safeMeasurement(result, options) {
    result = result && typeof result === 'object' ? result : {};options = options || {};
    var timing=safeTiming(result.timing);
    return {
      model:MODELS.includes(result.model) ? result.model : null,
      elapsedMs:nonnegative(result.elapsedMs),firstTokenMs:nonnegative(result.firstTokenMs) !== null ? result.firstTokenMs : timing && timing.firstTokenMs,
      totalMs:nonnegative(result.totalMs) !== null ? result.totalMs : timing && timing.totalMs,loadMs:nonnegative(result.loadMs),requestMs:nonnegative(result.requestMs),timing:timing,
      usage:safeUsage(result.usage),attempts:Number.isInteger(result.attempts) && (result.attempts > 0 || result.attempts===0&&result.inferencePerformed===false) && result.attempts <= 2 ? result.attempts : null,
      finishReason:['stop','length','tool_calls','content_filter','cancelled','error'].includes(result.finishReason) ? result.finishReason : null,
      promptProfile:PROFILES.includes(result.promptProfile) ? result.promptProfile : null,
      modelTask:['classify-source-candidates','source-extraction-only'].includes(result.modelTask) ? result.modelTask : null,
      inferencePerformed:typeof result.inferencePerformed==='boolean' ? result.inferencePerformed : null,
      phase:['cold','warm'].includes(options.phase) ? options.phase : null
    };
  }
  function stats(values) {
    var sorted = values.filter(function(value){return nonnegative(value) !== null;}).sort(function(a,b){return a-b;});
    var middle = Math.floor(sorted.length/2);
    return {samples:sorted.length,median:sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2 : null,p95:sorted.length ? sorted[Math.ceil(sorted.length*0.95)-1] : null};
  }
  // The runner may set this flag ONLY after checking validation.reason ===
  // NO_TRANSACTIONS and parsing rawOutput as a real object with items: []. The
  // raw response never crosses this module's report/export interface.
  function detectedEmpty(row) { return !classificationOnly(row) && row.status === 'failed' && row.errorCode === 'AI_NO_DRAFT' && row.emptyDetected === true; }
  function measuredItems(row,key) { return detectedEmpty(row) ? [] : row[key]; }
  function completed(row) { return row.status === 'completed' || detectedEmpty(row); }
  function stageSummary(observations, key) {
    var references=observations.filter(function(row){return validReference(row.expected);}),scored=0;
    var measured=references.map(function(row){
      var observed=completed(row) && Array.isArray(measuredItems(row,key));
      if(observed)scored++;
      // Failed, cancelled or missing results are no observed predictions. Their
      // reference fields and transactions still count in denominator/recall.
      var entry=score(row.expected,observed ? measuredItems(row,key) : []);
      if(!observed)entry.caseExact=false;
      return entry;
    });
    var detection = {truePositive:0,falsePositive:0,falseNegative:0,candidateFalsePositive:0,precision:null,recall:null};
    var fields = {matched:0,total:0,ratio:null,byField:{}};
    FIELDS.forEach(function(field){fields.byField[field]={matched:0,total:0,ratio:null};});
    measured.forEach(function(entry){
      ['truePositive','falsePositive','falseNegative','candidateFalsePositive'].forEach(function(field){detection[field]+=entry.transactionDetection[field];});
      fields.matched+=entry.fieldsExact.matched;fields.total+=entry.fieldsExact.total;
      FIELDS.forEach(function(field){fields.byField[field].matched+=entry.fieldsExact.byField[field].matched;fields.byField[field].total+=entry.fieldsExact.byField[field].total;});
    });
    detection.precision=ratio(detection.truePositive,detection.truePositive+detection.falsePositive);detection.recall=ratio(detection.truePositive,detection.truePositive+detection.falseNegative);
    fields.ratio=ratio(fields.matched,fields.total);FIELDS.forEach(function(field){var entry=fields.byField[field];entry.ratio=ratio(entry.matched,entry.total);});
    var passed=measured.filter(function(entry){return entry.caseExact;}).length;
    return {scored:scored,referenceCases:references.length,passed:passed,passRateAmongAttempted:ratio(passed,observations.length),transactionDetection:detection,fieldsExact:fields,manualReview:measured.reduce(function(total,entry){return total+entry.manualReview;},0)};
  }
  function summarize(observations) {
    if (!Array.isArray(observations)) throw new TypeError('Provide observations.');
    var latency={};
    ['cold','warm','unknown'].forEach(function(phase){
      var measurements=observations.map(function(row){return safeMeasurement(row.measurement,{phase:row.measurement && row.measurement.phase});}).filter(function(entry){return (entry.phase || 'unknown') === phase;});
      var entry={runs:measurements.length};['elapsedMs','firstTokenMs','totalMs','loadMs','requestMs'].forEach(function(key){entry[key]=stats(measurements.map(function(measurement){return measurement[key];}));});latency[phase]=entry;
    });
    var extraction=observations.filter(function(row){return !classificationOnly(row);}),classifications=observations.filter(classificationOnly),classification=null;
    if(classifications.length){
      var scores=classifications.filter(function(row){return validReference(row.expected)&&row.inferencePerformed!==false;}).map(function(row){return scoreClassification(row.expected,completed(row)&&Array.isArray(row.classificationItems)?row.classificationItems:[],row.classificationSourceItems);});
      var eligible=scores.filter(function(entry){return entry.eligible;}),passed=eligible.filter(function(entry){return entry.caseExact;}).length;
      classification={scope:'kind-category-given-source-candidates',attempted:classifications.length,failed:classifications.filter(function(row){return row.status==='failed';}).length,cancelled:classifications.filter(function(row){return row.status==='cancelled';}).length,scored:classifications.filter(function(row){return completed(row)&&row.inferencePerformed!==false&&Array.isArray(row.classificationItems);}).length,eligibleCases:eligible.length,passed:passed,passRateAmongEligible:ratio(passed,eligible.length),notRun:classifications.filter(function(row){return row.inferencePerformed===false;}).length,sourceCoverageIncomplete:scores.filter(function(entry){return !entry.eligible;}).length,fieldsExact:{matched:scores.reduce(function(sum,entry){return sum+entry.fieldsExact.matched;},0),total:scores.reduce(function(sum,entry){return sum+entry.fieldsExact.total;},0)}};
      classification.fieldsExact.ratio=ratio(classification.fieldsExact.matched,classification.fieldsExact.total);
    }
    return {attempted:observations.length,completed:observations.filter(completed).length,abstained:observations.filter(detectedEmpty).length,failed:observations.filter(function(row){return row.status==='failed' && !detectedEmpty(row);}).length,cancelled:observations.filter(function(row){return row.status==='cancelled';}).length,model:extraction.length||!classifications.length?stageSummary(extraction,'modelItems'):null,classification:classification,assisted:stageSummary(observations,'assistedItems'),latency:latency};
  }
  var KNOWN_IDS = new Map(registry('2001-06-10').map(function(entry){return [entry.id,entry.split];}));
  function requestedProfile(row) { return PROFILES.includes(row.promptProfile) ? row.promptProfile : null; }
  function exportReport(observations, options) {
    // The export deliberately contains no input, reference/actual values, raw
    // output, notes, labels, merchant names, dates or user-supplied identifiers.
    options=options || {};
    var safe=observations.map(function(row){
      var known=KNOWN_IDS.has(row.caseId), status=['completed','failed','cancelled'].includes(row.status) ? row.status : 'failed';
      return {caseId:known ? row.caseId : null,split:known ? KNOWN_IDS.get(row.caseId) : null,requestedProfile:requestedProfile(row),status:status,outcome:detectedEmpty(row) ? 'abstained' : status,errorCode:ERROR_CODES.includes(row.errorCode) ? row.errorCode : null,measurement:safeMeasurement(row.measurement,{phase:row.measurement && row.measurement.phase}),model:!classificationOnly(row)&&completed(row) && row.expected && Array.isArray(measuredItems(row,'modelItems')) ? score(row.expected,measuredItems(row,'modelItems')) : null,classification:classificationOnly(row)&&row.inferencePerformed!==false&&completed(row)&&row.expected&&Array.isArray(row.classificationItems)?scoreClassification(row.expected,row.classificationItems,row.classificationSourceItems):null,assisted:completed(row) && row.expected && Array.isArray(measuredItems(row,'assistedItems')) ? score(row.expected,measuredItems(row,'assistedItems')) : null};
    });
    var profiles={},comparisonProfiles=PROFILES.filter(function(profile){return observations.some(function(row){return requestedProfile(row)===profile;});});
    comparisonProfiles.forEach(function(profile){profiles[profile]=summarize(observations.filter(function(row){return requestedProfile(row)===profile;}));});
    return {schemaVersion:1,type:'local-ai-synthetic-evaluation',suiteVersion:VERSION,suite:SUITES.includes(options.suite) ? options.suite : null,containsPrivateContent:false,accuracyNotInferred:true,comparisonProfiles:comparisonProfiles,metricNotes:{profileComparison:'Use separate profile summaries. Extraction and candidate-classification perform different tasks; classification scores are not extraction accuracy. The combined summary is not a profile comparison.',classification:'Only kind/category are scored, conditional on source amount/date/currency matching provided reference candidates. Source fields earn no model credit. No-inference source-only results never count as model classification successes.',transactionDetection:'One-to-one amount + kind; correct detection does not imply correct classification or other fields. Failed, cancelled and missing results still contribute reference false negatives.',candidateFalsePositive:'All unmatched candidates, including unbookable review rows. falsePositive counts only unmatched rows with a positive amount and known kind.',fieldsExact:'Six fields per reference in all attempted cases, including explicit nulls; unmatched or unobserved reference rows earn no field matches.',caseSuccess:'Exact cases divided by all attempted cases. Failed, cancelled and unmeasured cases never increase success.',latency:'Only observed timings; missing values remain null. Cold/warm is explicitly supplied by the runner.'},summary:summarize(observations),profiles:profiles,cases:safe};
  }
  function exportTrialDiagnostic(result, options) {
    result=result && typeof result==='object' ? result : {};options=options || {};
    var draft=null;try{draft=JSON.parse(result.text);}catch(_){}
    var preview=options.failed===true&&result.sourcePreview&&result.sourcePreview.modelTask==='source-extraction-only'?result.sourcePreview:null;
    if(!draft&&preview)draft=preview.draft;
    var items=draft && Array.isArray(draft.items) ? draft.items : null;
    var original=!classificationOnly(result)&&result.modelDraft && Array.isArray(result.modelDraft.items) ? result.modelDraft.items : null;
    var normalization=result.normalization || preview&&preview.normalization || {},coverage=normalization.coverage || {},recovery=normalization.sourceRecovery || {};
    return {schemaVersion:1,type:'local-ai-trial-diagnostic',containsPrivateContent:false,accuracyNotInferred:true,requiresHumanReview:true,
      status:options.failed===true ? 'failed' : 'completed',errorCode:ERROR_CODES.includes(options.errorCode) ? options.errorCode : null,sourcePreviewRetained:!!preview,
      measurement:safeMeasurement(result,{phase:'warm'}),
      counts:{modelRows:original ? original.length : null,draftRows:items ? items.length : null,
        classificationCandidates:result.classificationDraft&&Array.isArray(result.classificationDraft.items)?result.classificationDraft.items.length:null,
        modelWarnings:result.modelDraft && Array.isArray(result.modelDraft.warnings) ? result.modelDraft.warnings.length : null,
        recoveredRows:Array.isArray(recovery.recoveredRows) ? recovery.recoveredRows.length : null,
        rejectedRows:Array.isArray(normalization.rejectedRows) ? normalization.rejectedRows.length : null,
        rowsMissingRequiredFields:items ? items.filter(function(item){return !item || !Number.isFinite(item.amount) || item.amount<=0 || !['expense','income'].includes(item.kind) || !validDate(item.date) || typeof item.category!=='string' || !item.category || typeof item.currency!=='string' || !/^[A-Z]{3}$/.test(item.currency);}).length : null,
        sourceCandidates:count(coverage.sourceCandidateCount),uncoveredSource:count(coverage.uncoveredSourceCount)},
      coverageStatus:['complete','partial','unknown'].includes(coverage.status) ? coverage.status : null,
      sourceRuleAssisted:typeof normalization.sourceRuleAssisted==='boolean' ? normalization.sourceRuleAssisted : null};
  }
  root.LocalAIEvaluation=Object.freeze({version:VERSION,context:context,cases:cases,score:score,scoreClassification:scoreClassification,summarize:summarize,safeMeasurement:safeMeasurement,exportReport:exportReport,exportTrialDiagnostic:exportTrialDiagnostic});
})(typeof window !== 'undefined' ? window : globalThis);
