/* Scoring/dataset/privacy contract tests using synthetic fixtures.
 * No model is loaded; passing these tests is not model quality evidence.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/local-ai-evaluation.js'),'utf8'),sandbox);
const api = sandbox.LocalAIEvaluation;
const plain = value => JSON.parse(JSON.stringify(value));
const today = '2026-03-01';
const find = id => api.cases({today,split:'all'}).find(entry=>entry.id===id);
const expected = (items,mode='transactions') => ({mode,items});
const row = (overrides={}) => Object.assign({amount:87,kind:'expense',category:'FOOD',date:today,currency:'TWD',merchant:null},overrides);
const observation = (overrides={}) => Object.assign({caseId:'dev-food',split:'dev',status:'completed',expected:expected([row()]),modelItems:[row()],assistedItems:[row()],measurement:{}},overrides);

test('single-trial diagnostics preserve only finite timing, format and counts, never content or benchmark scores',()=>{
  const secret='PRIVATE_ACCOUNT_SHOP_RAW_INPUT',item=row({note:secret,merchant:secret});
  const report=api.exportTrialDiagnostic({text:JSON.stringify({items:[item],warnings:[secret]}),rawModelOutput:secret,input:secret,model:'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',promptProfile:'fast-json-v1',modelDraft:{items:[item],warnings:[secret]},normalization:{sourceRuleAssisted:true,coverage:{status:'partial',sourceCandidateCount:2,uncoveredSourceCount:1,raw:secret},sourceRecovery:{recoveredRows:[{note:secret}]},rejectedRows:[]},timing:{firstTokenMs:42,passes:[{attempt:1,format:'post-validated-json',runtime:{grammarInitMs:0,prefillTokensPerSecond:88,decodeTokensPerSecond:Infinity,private:secret}},{attempt:2,format:secret}]} });
  assert.equal(report.type,'local-ai-trial-diagnostic');assert.equal(report.counts.draftRows,1);assert.equal(report.counts.recoveredRows,1);assert.equal(report.counts.modelWarnings,1);
  assert.equal(report.measurement.promptProfile,'fast-json-v1');assert.equal(report.measurement.timing.passes[0].format,'post-validated-json');
  assert.equal(report.measurement.timing.passes[0].runtime.prefillTokensPerSecond,88);assert.equal(report.measurement.timing.passes[0].runtime.decodeTokensPerSecond,null);assert.equal(report.measurement.timing.passes[1].format,null);
  assert.equal(JSON.stringify(report).includes(secret),false);assert.equal(Object.hasOwn(report,'model'),false);assert.equal(Object.hasOwn(report,'summary'),false);assert.equal(report.accuracyNotInferred,true);
  const failed=api.exportTrialDiagnostic({rawOutput:secret,promptProfile:'fast-json-v1',requestMs:123},{failed:true,errorCode:'AI_INVALID_DRAFT'});
  assert.equal(failed.status,'failed');assert.equal(failed.errorCode,'AI_INVALID_DRAFT');assert.equal(failed.measurement.requestMs,123);assert.equal(failed.counts.modelRows,null);assert.equal(failed.counts.draftRows,null);
});

test('24 fixed synthetic references have disjoint dev8/heldout16 and an explicit quick4 subset',()=>{
  const all=api.cases({today,split:'all'}),dev=api.cases({today,split:'dev'}),heldout=api.cases({today,split:'heldout'}),quick=api.cases({today,split:'quick'});
  assert.equal(all.length,24);assert.equal(dev.length,8);assert.equal(heldout.length,16);assert.equal(quick.length,4);
  assert.equal(new Set(all.map(entry=>entry.id)).size,24);
  assert.ok(!dev.some(entry=>heldout.some(other=>entry.id===other.id)));
  assert.deepEqual(plain(quick.map(entry=>entry.id)),['dev-mixed','heldout-salary','heldout-prize','heldout-third-party']);
  assert.ok(quick.every(entry=>all.some(other=>JSON.stringify(entry)===JSON.stringify(other))));
  const text=all.map(entry=>entry.input).join('\n');
  for(const term of ['咖啡','公車','薪資','威力彩','沒有','如果','同事','美元','６８．５０'])assert.ok(text.includes(term),term);
  assert.ok(all.some(entry=>entry.expected.mode==='abstain' && !entry.expected.items.length));
  assert.ok(all.some(entry=>entry.expected.items.length===3));
  assert.ok(all.some(entry=>entry.expected.items.some(item=>item.amount===null)));
  assert.ok(all.some(entry=>entry.expected.items.some(item=>item.category===null)));
  assert.ok(all.some(entry=>entry.expected.items.some(item=>item.date===null)));
  assert.ok(!text.includes('早餐65') && !text.includes('薪資30000'));
});

test('reference calendar is supplied, uses real month boundaries, and never invents missing dates',()=>{
  assert.equal(find('dev-transit').expected.items[0].date,'2026-02-28');
  assert.equal(find('heldout-transit').expected.items[0].date,'2026-04-18');
  assert.equal(find('heldout-no-date').expected.items[0].date,null);
  assert.equal(api.cases({today:'2024-03-01',split:'dev'})[1].expected.items[0].date,'2024-02-29');
  assert.throws(()=>api.cases({today:'2026-02-30'}),/calendar/);
  assert.throws(()=>api.context({}),/calendar/);
  assert.throws(()=>api.cases({today,split:'private-ledger'}),/suite/);
  const context=api.context({today});
  assert.equal(context.today,today);assert.equal(context.timezone,'Asia/Taipei');
  assert.deepEqual(plain(context.categories.map(entry=>entry.id)),['FOOD','TRANSIT','SALARY','WINNINGS','OTHER']);
  assert.ok(!JSON.stringify(context).includes('expected'));
  const first=api.cases({today,split:'dev'});first[0].input='mutated';first[0].expected.items[0].amount=999;
  assert.equal(find('dev-food').expected.items[0].amount,87);
  context.categories[0].name='mutated';assert.equal(api.context({today}).categories[0].name,'餐飲');
});

test('detection precision does not disguise an incorrect category as a fully correct case',()=>{
  const score=api.score(expected([row()]),[row({category:'SALARY'})]);
  assert.equal(score.transactionDetection.truePositive,1);
  assert.equal(score.transactionDetection.precision,1);assert.equal(score.transactionDetection.recall,1);
  assert.equal(score.fieldsExact.matched,5);assert.equal(score.fieldsExact.total,6);
  assert.equal(score.fieldsExact.byField.category.ratio,0);assert.equal(score.caseExact,false);
});

test('matching is one-to-one and resolves repeated amounts using all exact reference fields',()=>{
  const reference=[row({amount:45}),row({amount:45,category:'TRANSIT'})];
  const reversed=[row({amount:45,category:'TRANSIT'}),row({amount:45})];
  const score=api.score(expected(reference),reversed);
  assert.equal(score.caseExact,true);assert.equal(score.transactionDetection.truePositive,2);
  assert.equal(score.fieldsExact.ratio,1);
  const duplicate=api.score(expected(reference),[row({amount:45}),row({amount:45})]);
  assert.equal(duplicate.transactionDetection.truePositive,2);assert.equal(duplicate.caseExact,false);
  assert.equal(duplicate.fieldsExact.byField.category.matched,1);
});

test('missing, duplicate, wrong-kind and illegal overflow transactions remain visible',()=>{
  const missing=api.score(expected([row(),row({amount:28,category:'TRANSIT'})]),[row()]);
  assert.equal(missing.transactionDetection.falseNegative,1);
  assert.equal(missing.transactionDetection.recall,0.5);assert.equal(missing.fieldsExact.ratio,0.5);
  const duplicate=api.score(expected([row()]),[row(),row()]);
  assert.equal(duplicate.transactionDetection.falsePositive,1);assert.equal(duplicate.transactionDetection.candidateFalsePositive,1);
  assert.equal(duplicate.transactionDetection.precision,0.5);assert.equal(duplicate.caseExact,false);
  const wrongKind=api.score(expected([row()]),[row({kind:'income'})]);
  assert.equal(wrongKind.transactionDetection.truePositive,0);assert.equal(wrongKind.transactionDetection.falsePositive,1);
  assert.equal(wrongKind.transactionDetection.falseNegative,1);assert.equal(wrongKind.fieldsExact.matched,0);
  const overflow=api.score(expected([row()]),Array.from({length:12},()=>row()));
  assert.equal(overflow.observedCandidates,12);assert.equal(overflow.transactionDetection.falsePositive,11);
});

test('unbookable candidates count review and extra-candidate errors without becoming bookable false positives',()=>{
  const reference=expected([],'abstain');
  const score=api.score(reference,[row({kind:null,category:null}),row({amount:null})]);
  assert.equal(score.manualReview,2);assert.equal(score.transactionDetection.falsePositive,0);
  assert.equal(score.transactionDetection.candidateFalsePositive,2);
  assert.equal(score.transactionDetection.precision,null);assert.equal(score.transactionDetection.recall,null);
  assert.equal(score.caseExact,false);
  const hallucination=api.score(reference,[row()]);
  assert.equal(hallucination.transactionDetection.falsePositive,1);
  assert.equal(hallucination.transactionDetection.precision,0);assert.equal(hallucination.caseExact,false);
  assert.equal(api.score(reference,[]).caseExact,true);
});

test('explicitly unknown fields, including date/currency/category, require null rather than a guessed value',()=>{
  const unknown=row({amount:null,kind:null,category:null,date:null,currency:null});
  const exact=api.score(expected([unknown],'review'),[Object.assign({},unknown)]);
  assert.equal(exact.caseExact,true);assert.equal(exact.manualReview,1);
  assert.equal(exact.fieldsExact.ratio,1);assert.equal(exact.transactionDetection.precision,null);
  const guesses=api.score(expected([unknown],'review'),[Object.assign({},unknown,{category:'FOOD',date:today,currency:'TWD'})]);
  assert.equal(guesses.caseExact,false);assert.equal(guesses.fieldsExact.matched,3);
  const missing=Object.assign({},unknown);delete missing.date;
  assert.equal(api.score(expected([unknown],'review'),[missing]).fieldsExact.byField.date.matched,0);
  assert.throws(()=>api.score(expected([row()]),null),/items array/);
});

test('model and assisted scores stay separate and failures/cancellation never raise the success denominator',()=>{
  const rows=[
    observation({modelItems:[row({category:'SALARY'})]}),
    observation({status:'failed',errorCode:'AI_INVALID_DRAFT'}),
    observation({status:'cancelled',errorCode:'AI_CANCELLED'})
  ];
  const summary=api.summarize(rows);
  assert.equal(summary.attempted,3);assert.equal(summary.completed,1);assert.equal(summary.failed,1);assert.equal(summary.cancelled,1);
  assert.equal(summary.model.scored,1);assert.equal(summary.model.passed,0);assert.equal(summary.model.passRateAmongAttempted,0);
  assert.equal(summary.assisted.passed,1);assert.equal(summary.assisted.passRateAmongAttempted,1/3);
  assert.equal(summary.model.transactionDetection.precision,1);assert.equal(summary.model.fieldsExact.byField.category.ratio,0);
  const empty=api.summarize([]);assert.equal(empty.model.passRateAmongAttempted,null);assert.equal(empty.model.fieldsExact.ratio,null);
  assert.equal(empty.latency.cold.totalMs.median,null);
});

test('only verified NO_TRANSACTIONS empty replies count abstention, never arbitrary failed requests',()=>{
  const negative=expected([],'abstain');
  const rows=[
    observation({caseId:'dev-negated',status:'failed',errorCode:'AI_NO_DRAFT',emptyDetected:true,expected:negative}),
    observation({caseId:'dev-negated',status:'failed',errorCode:'AI_NO_DRAFT',expected:negative}),
    observation({caseId:'dev-negated',status:'failed',errorCode:'AI_TIMEOUT',emptyDetected:true,expected:negative}),
    observation({status:'failed',errorCode:'AI_NO_DRAFT',emptyDetected:true})
  ];
  const summary=api.summarize(rows);
  assert.equal(summary.attempted,4);assert.equal(summary.abstained,2);assert.equal(summary.completed,2);assert.equal(summary.failed,2);
  assert.equal(summary.model.scored,2);assert.equal(summary.model.passed,1);assert.equal(summary.model.passRateAmongAttempted,0.25);
  assert.equal(summary.model.transactionDetection.falseNegative,1);
  const report=api.exportReport(rows,{suite:'quick'});
  assert.equal(report.cases[0].status,'failed');assert.equal(report.cases[0].outcome,'abstained');assert.equal(report.cases[0].model.caseExact,true);
  assert.equal(report.cases[1].model,null);assert.equal(report.cases[2].model,null);assert.equal(report.cases[3].model.caseExact,false);
});

test('failed positive references remain in recall and field denominators; failed negatives are never a pass',()=>{
  const summary=api.summarize([
    observation(),
    observation({status:'failed',errorCode:'AI_INVALID_DRAFT'}),
    observation({status:'failed',errorCode:'AI_NO_DRAFT',expected:expected([],'abstain')})
  ]);
  assert.equal(summary.model.scored,1);assert.equal(summary.model.referenceCases,3);assert.equal(summary.model.passed,1);
  assert.equal(summary.model.passRateAmongAttempted,1/3);
  assert.equal(summary.model.transactionDetection.truePositive,1);assert.equal(summary.model.transactionDetection.falseNegative,1);
  assert.equal(summary.model.transactionDetection.recall,0.5);
  assert.equal(summary.model.fieldsExact.matched,6);assert.equal(summary.model.fieldsExact.total,12);assert.equal(summary.model.fieldsExact.ratio,0.5);
  assert.equal(summary.model.fieldsExact.byField.category.total,2);
  const cancelled=api.summarize([observation(),observation({status:'cancelled'})]);
  assert.equal(cancelled.model.transactionDetection.recall,0.5);assert.equal(cancelled.model.fieldsExact.ratio,0.5);
});

test('timing is observed, optional and explicitly cold/warm; missing TTFT/total is never inferred',()=>{
  const bare=api.safeMeasurement({elapsedMs:100,phase:'warm'});
  assert.equal(bare.elapsedMs,100);assert.equal(bare.firstTokenMs,null);assert.equal(bare.totalMs,null);
  assert.equal(bare.phase,null);assert.equal(bare.loadMs,null);assert.equal(bare.requestMs,null);assert.equal(bare.timing,null);
  const nested=api.safeMeasurement({model:'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',timing:{totalMs:88,firstTokenMs:22,decodeMs:61,cleanupMs:5,passes:[{attempt:1,totalMs:83,firstTokenMs:22,promptTokens:101,completionTokens:33,raw:'PRIVATE'}]},requestMs:95,loadMs:500,promptProfile:'compact-v1',usage:{prompt_tokens:101,completion_tokens:33,total_tokens:134,raw:'PRIVATE'},attempts:1,finishReason:'stop'},{phase:'cold'});
  assert.equal(nested.firstTokenMs,22);assert.equal(nested.totalMs,88);assert.equal(nested.elapsedMs,null);
  assert.equal(nested.phase,'cold');assert.equal(nested.timing.passes[0].totalMs,83);
  assert.equal(nested.timing.passes[0].attempt,1);assert.equal(nested.timing.passes[0].promptTokens,101);assert.equal(nested.timing.passes[0].completionTokens,33);
  assert.ok(!JSON.stringify(nested).includes('PRIVATE'));
  const summary=api.summarize([
    observation({measurement:api.safeMeasurement({totalMs:80,firstTokenMs:20},{phase:'cold'})}),
    observation({measurement:api.safeMeasurement({totalMs:100},{phase:'cold'})}),
    observation({measurement:api.safeMeasurement({totalMs:30,firstTokenMs:5},{phase:'warm'})}),
    observation({measurement:api.safeMeasurement({elapsedMs:40})})
  ]);
  assert.deepEqual(plain(summary.latency.cold.totalMs),{samples:2,median:90,p95:100});
  assert.deepEqual(plain(summary.latency.cold.firstTokenMs),{samples:1,median:20,p95:20});
  assert.equal(summary.latency.warm.totalMs.median,30);assert.equal(summary.latency.unknown.totalMs.samples,0);
  assert.equal(summary.latency.unknown.elapsedMs.median,40);
  const invalid=api.safeMeasurement({totalMs:Infinity,firstTokenMs:-1,attempts:0,usage:{total_tokens:-4,prompt_tokens:1.5},promptProfile:'PRIVATE',finishReason:'PRIVATE'});
  assert.equal(invalid.totalMs,null);assert.equal(invalid.firstTokenMs,null);assert.equal(invalid.attempts,null);assert.equal(invalid.usage,null);assert.equal(invalid.promptProfile,null);
  const overflow=api.safeMeasurement({attempts:7,timing:{passes:[{attempt:1},{attempt:7},{attempt:2}]}});
  assert.equal(overflow.attempts,null);assert.equal(overflow.timing.passes.length,2);assert.equal(overflow.timing.passes[1].attempt,null);
});

test('export whitelists metrics and excludes raw, reference/actual values and private identifiers',()=>{
  const sentinel='PRIVATE_ACCOUNT_SENTINEL@example.invalid';
  const privateRow=row({amount:987654321.23,merchant:sentinel,note:sentinel});
  const run=observation({caseId:sentinel,input:sentinel,rawModelOutput:sentinel,privateLedger:[privateRow],expected:expected([privateRow]),modelItems:[privateRow],assistedItems:[privateRow],measurement:{model:sentinel,raw:sentinel,input:sentinel,totalMs:20,usage:{total_tokens:25,private:sentinel},finishReason:sentinel,timing:{totalMs:20,raw:sentinel,passes:[{totalMs:19,text:sentinel}]}}});
  const report=api.exportReport([run],{suite:sentinel});
  const serialized=JSON.stringify(report);
  assert.equal(report.containsPrivateContent,false);assert.equal(report.accuracyNotInferred,true);
  assert.equal(report.suite,null);assert.equal(report.cases[0].caseId,null);assert.equal(report.cases[0].split,null);
  for(const forbidden of [sentinel,'987654321.23','rawModelOutput','privateLedger','modelItems','assistedItems','"expected"','"input"'])assert.ok(!serialized.includes(forbidden),forbidden);
  assert.deepEqual(Object.keys(report.cases[0].model.fieldsExact.byField.merchant).sort(),['matched','ratio','total']);
  assert.equal(report.cases[0].measurement.model,null);
  const ascii=api.exportReport([observation({measurement:{model:'PRIVATE_ACCOUNT_JunWeiWu'}})],{suite:'quick'});
  assert.equal(ascii.cases[0].measurement.model,null);assert.ok(!JSON.stringify(ascii).includes('PRIVATE_ACCOUNT_JunWeiWu'));
  assert.equal(report.cases[0].model.fieldsExact.ratio,1);
  assert.equal(report.summary.attempted,1);
});

test('paired pipeline reports preserve the requested profile even when inference fails before returning metadata',()=>{
  const report=api.exportReport([
    observation({promptProfile:'baseline',status:'failed',errorCode:'AI_TIMEOUT',measurement:{}}),
    observation({promptProfile:'compact-v1',measurement:{promptProfile:'compact-v1',totalMs:90}}),
    observation({promptProfile:'PRIVATE_PROFILE',status:'cancelled'})
  ],{suite:'quick'});
  assert.deepEqual(plain(report.comparisonProfiles),['baseline','compact-v1']);
  assert.equal(report.cases[0].requestedProfile,'baseline');assert.equal(report.cases[0].measurement.promptProfile,null);
  assert.equal(report.cases[2].requestedProfile,null);
  assert.equal(report.profiles.baseline.attempted,1);assert.equal(report.profiles.baseline.failed,1);assert.equal(report.profiles.baseline.model.passRateAmongAttempted,0);
  assert.equal(report.profiles['compact-v1'].attempted,1);assert.equal(report.profiles['compact-v1'].model.passRateAmongAttempted,1);
  assert.equal(report.summary.attempted,3);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_PROFILE'));
});

test('bounded label results score only kind/category given source candidates and never earn six-field model credit',()=>{
  const reference=expected([row()]),prediction=row({merchant:'DIFFERENT_SOURCE_MERCHANT',note:'PRIVATE_CLASSIFICATION_NOTE'});
  const classified=observation({promptProfile:'bounded-labels-v1',modelTask:'classify-source-candidates',inferencePerformed:true,expected:reference,modelItems:[row()],classificationItems:[prediction],classificationSourceItems:[row()],assistedItems:[row()]});
  const summary=api.summarize([classified]);
  assert.equal(summary.model,null);assert.equal(summary.classification.passed,1);assert.equal(summary.classification.eligibleCases,1);
  assert.equal(summary.classification.fieldsExact.matched,2);assert.equal(summary.classification.fieldsExact.total,2);assert.equal(summary.assisted.fieldsExact.matched,6);
  const wrong=api.scoreClassification(reference,[row({kind:'income',category:'SALARY'})],[row()]);
  assert.equal(wrong.caseExact,false);assert.equal(wrong.fieldsExact.matched,0);assert.equal(wrong.eligible,true);
  const missingSource=api.scoreClassification(reference,[row()],[row({amount:999})]);
  assert.equal(missingSource.eligible,false);assert.equal(missingSource.caseExact,false);assert.equal(missingSource.fieldsExact.total,0);
  const report=api.exportReport([classified],{suite:'quick'});
  assert.equal(report.cases[0].model,null);assert.equal(report.profiles['bounded-labels-v1'].model,null);assert.equal(report.cases[0].classification.fieldsExact.total,2);
  assert.equal(JSON.stringify(report).includes('PRIVATE_CLASSIFICATION_NOTE'),false);assert.equal(JSON.stringify(report).includes('DIFFERENT_SOURCE_MERCHANT'),false);
});

test('bounded no-inference source results are not model abstention or classification success; failures remain visible',()=>{
  const classified=observation({promptProfile:'bounded-labels-v1',modelTask:'classify-source-candidates',inferencePerformed:true,classificationItems:[row()],classificationSourceItems:[row()]});
  const failed={...classified,status:'failed',errorCode:'AI_TIMEOUT',classificationItems:null};
  const empty={...classified,expected:expected([],'abstain'),inferencePerformed:false,classificationItems:null,classificationSourceItems:[],assistedItems:[]};
  const summary=api.summarize([classified,failed,empty]);
  assert.equal(summary.model,null);assert.equal(summary.abstained,0);assert.equal(summary.failed,1);
  assert.equal(summary.classification.passed,1);assert.equal(summary.classification.eligibleCases,2);assert.equal(summary.classification.passRateAmongEligible,0.5);
  assert.equal(summary.classification.notRun,1);assert.equal(summary.classification.failed,1);assert.equal(summary.assisted.passed,2);
  const malformedEmpty=api.summarize([{...empty,status:'failed',errorCode:'AI_NO_DRAFT',emptyDetected:true}]);
  assert.equal(malformedEmpty.abstained,0);assert.equal(malformedEmpty.assisted.passed,0,'only legacy verified model empty answers can abstain');
});

test('failed bounded diagnostics retain only preview counts and known metadata, never source values or looping raw text',()=>{
  const secret='PRIVATE_LOOPING_RESULT_SOURCE',item=row({merchant:secret,note:secret});
  const sourcePreview={modelTask:'source-extraction-only',draft:{items:[item],warnings:[secret]},normalization:{sourceExtraction:true,coverage:{status:'partial',sourceCandidateCount:2,uncoveredSourceCount:1}}};
  const report=api.exportTrialDiagnostic({promptProfile:'bounded-labels-v1',modelTask:'classify-source-candidates',rawOutput:secret.repeat(50),sourcePreview,requestMs:74671,finishReason:'length',inferencePerformed:true},{failed:true,errorCode:'AI_TRUNCATED'});
  assert.equal(report.status,'failed');assert.equal(report.sourcePreviewRetained,true);assert.equal(report.counts.draftRows,1);assert.equal(report.counts.modelRows,null);
  assert.equal(report.measurement.promptProfile,'bounded-labels-v1');assert.equal(report.measurement.modelTask,'classify-source-candidates');assert.equal(report.measurement.requestMs,74671);
  assert.equal(JSON.stringify(report).includes(secret),false);assert.equal(Object.hasOwn(report,'sourcePreview'),false);
  assert.equal(api.safeMeasurement({attempts:0,inferencePerformed:false}).attempts,0);
});
