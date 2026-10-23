/* Bounded local-model protocol and interruption contracts. All inference output
 * is controlled. These tests are not measurements of real Qwen quality/speed. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {TextEncoder} = require('node:util');
const workerSource = () => fs.readFileSync(path.join(__dirname,'../js/local-ai-worker.js'),'utf8');
const controllerSource = () => fs.readFileSync(path.join(__dirname,'../js/local-ai-engine.js'),'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const context = {
  today:'2026-10-24',timezone:'Asia/Taipei',currency:'TWD',
  categories:[{id:'food',name:'餐飲',kind:'expense'},{id:'transit',name:'交通',kind:'expense'},{id:'salary',name:'薪資',kind:'income'}]
};

function workerHarness(options={}) {
  const sent=[],calls={requests:[],resets:0,interrupts:0,yielded:0,closed:0},clock={ms:0};
  const engine={
    resetChat:async()=>{calls.resets++;clock.ms+=options.cleanupMs||0;},
    unload:async()=>{},
    interruptGenerate:async()=>{calls.interrupts++;},
    chat:{completions:{create:async config=>{
      calls.requests.push(config);
      const chunks=typeof options.chunks==='function'?options.chunks(config,calls.requests.length):options.chunks||[{text:'[]'}];
      return (async function*(){
        try {
          for(const item of chunks){
            clock.ms+=item.advanceMs||0;calls.yielded++;
            yield {choices:[{delta:{content:item.text||''},finish_reason:item.finishReason||null}]};
          }
          clock.ms+=options.finalMs||0;
          yield {choices:[{delta:{},finish_reason:options.finishReason||'stop'}],usage:options.usage===null?undefined:options.usage||{prompt_tokens:80,completion_tokens:7,total_tokens:87}};
        } finally {calls.closed++;}
      })();
    }}}
  };
  const self={postMessage:message=>sent.push(message),__runtime:{CreateMLCEngine:async()=>engine,prebuiltAppConfig:{model_list:[]},deleteModelAllInfoInCache:async()=>{}}};
  const sandbox=vm.createContext({self,TextEncoder,console,performance:{now:()=>clock.ms},setTimeout,clearTimeout});
  vm.runInContext(workerSource().replace('import(RUNTIME_URL)','Promise.resolve(self.__runtime)'),sandbox);
  return {calls,sent,clock,sandbox,
    load:async()=>self.onmessage({data:{id:0,type:'load',model:'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'}}),
    generate:async(input='今天早餐65元，午餐120元。',extras={})=>{
      sent.length=0;
      await self.onmessage({data:{id:1,type:'generate',task:'draft',input,language:'zh-TW',context,...extras}});
      return sent.at(-1);
    }
  };
}

function controllerHarness() {
  const workers=[],timers=[];
  class FakeWorker {
    constructor(){this.messages=[];this.terminated=false;workers.push(this);}
    postMessage(message){this.messages.push(message);}
    terminate(){this.terminated=true;}
    emit(type,extras={}){this.onmessage?.({data:{id:this.messages.at(-1).id,type,...extras}});}
  }
  const sandbox=vm.createContext({URL,Promise,AbortController,Worker:FakeWorker,isSecureContext:true,
    document:{currentScript:{src:'https://contract.example/js/local-ai-engine.js?v=180'}},
    navigator:{gpu:{requestAdapter:async()=>({features:new Set(['shader-f16'])})}},
    setTimeout:(fn,ms)=>{const timer={fn,ms,cleared:false};timers.push(timer);return timer;},
    clearTimeout:timer=>{if(timer)timer.cleared=true;},
    localStorage:{setItem(){throw Error('Financial content must not be persisted');}}
  });
  vm.runInContext(controllerSource(),sandbox);
  return {api:sandbox.LocalAI,workers,timers};
}

async function loadController(h) {
  const pending=h.api.load();await tick();h.workers[0].emit('result',{result:{model:'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'}});await pending;
}

test('the draft default no longer selects the runaway unconstrained JSON pipeline',async t=>{
  const h=controllerHarness();t.after(()=>h.api.unload());await loadController(h);
  const pending=h.api.generate({task:'receipt',input:'今天早餐65元，午餐120元。',context});
  const request=h.workers[0].messages.at(-1);
  assert.equal(request.task,'draft');assert.notEqual(request.promptProfile,'fast-json-v1');
  assert.notEqual(request.promptProfile,'baseline','do not silently revert to the large extraction prompt');
  h.workers[0].emit('result',{result:{text:'{}'}});await pending;
});

test('a stalled generation is terminated by the main-thread deadline and late replies cannot revive it',async t=>{
  const h=controllerHarness();t.after(()=>h.api.unload());await loadController(h);
  const pending=h.api.generate({task:'draft',input:'今天早餐65元，午餐120元。',context});
  const worker=h.workers[0],late=worker.onmessage,job=worker.messages.at(-1);
  const deadline=h.timers.filter(timer=>!timer.cleared).at(-1);
  assert.ok(deadline.ms<=45000,'a stalled prefill must not wait the old three-minute generation timeout');
  const rejected=assert.rejects(pending,error=>error.code==='AI_TIMEOUT');deadline.fn();await rejected;
  assert.equal(worker.terminated,true);assert.equal(h.api.status().loaded,false);assert.equal(h.api.status().busy,false);
  late({data:{id:job.id,type:'result',result:{text:'{"items":[{"amount":999999}]}'}}});
  assert.equal(h.api.status().loaded,false);assert.equal(h.api.status().busy,false);
  assert.equal(JSON.stringify(h.api.status()).includes('999999'),false);
});

const PROFILE='bounded-labels-v1';
function choiceIndex(label,ctx=context) {
  const labels=[...new Set([...ctx.categories.map(category=>(category.kind==='income'?'收入｜':'支出｜')+category.name), '支出（未選分類）','收入（未選分類）'])].sort();
  const found=[null,...labels].indexOf(label);assert.notEqual(found,-1);return found;
}
function answer(labels) {return [{text:JSON.stringify(labels)}];}
async function runBounded(options={},input,extras={}) {
  const h=workerHarness(options);await h.load();const reply=await h.generate(input,{promptProfile:PROFILE,...extras});
  return {h,reply,value:reply.type==='result'?JSON.parse(reply.result.text):null};
}

test('bounded classification fixes exact row count and valid IDs while category renames reuse its grammar',async()=>{
  const food=choiceIndex('支出｜餐飲');
  const first=await runBounded({chunks:answer([food,food])});
  const changed={...context,categories:context.categories.map(category=>({...category,name:category.id==='food'?'日常膳食':category.name}))};
  const second=await runBounded({chunks:answer([choiceIndex('支出｜日常膳食',changed),choiceIndex('支出｜日常膳食',changed)])},undefined,{context:changed});
  const single=await runBounded({chunks:answer([food])},'今天午餐120元。');
  assert.equal(first.reply.type,'result');assert.equal(second.reply.type,'result');
  const one=first.h.calls.requests[0],two=second.h.calls.requests[0];
  assert.equal(one.response_format.type,'json_object');
  assert.deepEqual(JSON.parse(one.response_format.schema),JSON.parse(two.response_format.schema),'renaming category labels with the same row/choice counts must not produce a new grammar');
  const grammar=JSON.parse(one.response_format.schema);
  assert.equal(grammar.type,'array');assert.equal(grammar.maxItems,2);assert.equal(grammar.minItems,2);
  const singleGrammar=JSON.parse(single.h.calls.requests[0].response_format.schema);assert.equal(singleGrammar.minItems,1);assert.equal(singleGrammar.maxItems,1);
  assert.ok(grammar.items.enum.every(Number.isInteger));assert.equal(grammar.items.enum.length,6);assert.deepEqual(grammar.items.enum,[0,1,2,3,4,5]);
  assert.ok(one.max_tokens<80&&two.max_tokens<80,'the short response contract cannot inherit the old 640-token extraction budget');
  assert.equal(one.repetition_penalty,1,'repeated legitimate category IDs must remain possible');
  assert.equal(first.h.calls.requests.length,1);assert.deepEqual(first.value.items.map(item=>item.amount),[65,120]);
  assert.deepEqual(first.value.items.map(item=>item.category),['food','food']);
  assert.deepEqual(second.value.items.map(item=>item.amount),[65,120]);assert.deepEqual(single.value.items.map(item=>item.amount),[120]);
});

test('source amounts/dates cannot earn model-extraction credit and raw semantic choices remain separate',async()=>{
  const {reply,value}=await runBounded({chunks:answer([0,0])});
  assert.equal(reply.type,'result');assert.equal(reply.result.modelTask,'classify-source-candidates');assert.equal(reply.result.inferencePerformed,true);
  assert.equal(reply.result.modelDraft,null,'source-provided amounts must never be relabeled as LLM six-field extraction');
  assert.ok(reply.result.classificationDraft&&reply.result.classificationDraft.items.length===2);
  assert.ok(reply.result.classificationDraft.items.every(item=>item.kind===null&&item.category===null),'unknown model choices remain unknown before source adjustment');
  assert.equal(reply.result.rawModelOutput,'[0,0]');assert.equal(reply.result.attempts,1);
  assert.equal(reply.result.normalization.sourceExtraction,true);assert.equal(reply.result.normalization.classificationOnly,true);assert.equal(reply.result.normalization.sourceRuleAssisted,true);
  assert.ok(reply.result.normalization.rowMappings.every(mapping=>mapping.modelRowIndex===null));
  assert.deepEqual(value.items.map(item=>item.amount),[65,120]);assert.ok(value.items.every(item=>item.date===context.today));
});

test('labels align one-to-one and never accept duplicate-key objects, nested results, foreign IDs or partial JSON',async()=>{
  const food=choiceIndex('支出｜餐飲');
  const invalid=['{"labels":[1,1],"labels":[2,2]}','{"items":[{"classification":"支出｜餐飲"}],"result":{"items":[]}}',`[${food}]`,`[${food},${food},${food}]`,'[43,43]','[-1,-1]','["1","1"]','[1.5,1.5]','[null,null]','[true,true]','[1,1] [1,1]','[1,','[01,01]','[1,,1]','[1,1,]','[[1],[1]]','[]'];
  for(const text of invalid){
    const {h,reply}=await runBounded({chunks:[{text}]});
    assert.equal(reply.type,'error',text);assert.equal(reply.error.code,'AI_INVALID_DRAFT',text);
    assert.equal(h.calls.requests.length,1,'the new bounded contract does not retry into another large extraction');
    assert.equal(h.calls.closed,1,'invalid response must close the iterator');
    assert.ok(reply.error.details.sourcePreview,'safe source preview can survive model failure without claiming model success');
    assert.equal(reply.error.details.sourcePreview.modelTask,'source-extraction-only');assert.equal(reply.error.details.sourcePreview.inferencePerformed,false);
    assert.equal(reply.error.details.sourcePreview.modelDraft,null);
  }
});

test('the screenshot-style object loop is interrupted before the remaining stream is decoded',async()=>{
  const runaway=[{text:'{"items":[{"sourceText":"今天早餐65元，午餐120元","classification":"支出"'}];
  for(let i=0;i<640;i++)runaway.push({text:',"classification":"支出","result":{"items":[',advanceMs:1});
  const {h,reply}=await runBounded({chunks:runaway});
  assert.equal(reply.type,'error');assert.equal(reply.error.code,'AI_INVALID_DRAFT');
  assert.ok(h.calls.interrupts>=1,'interrupt the real runtime rather than only discarding its eventual answer');
  assert.ok(h.calls.yielded<runaway.length/10);assert.equal(h.calls.closed,1,'for-await early exit must run generator finally and release its lock');
  assert.equal(reply.error.details.usage,null,'an interrupted stream has no final usage totals to fabricate');
});

test('a lexically legal integer loop reaches a small byte limit and closes the underlying generator',async()=>{
  const chunks=[{text:'['},...Array.from({length:640},()=>({text:'1,',advanceMs:1}))];
  const {h,reply}=await runBounded({chunks});
  assert.equal(reply.type,'error');assert.equal(reply.error.code,'AI_TRUNCATED');
  assert.ok(h.calls.interrupts>=1);assert.ok(h.calls.yielded<100,'do not decode hundreds of repeated labels');assert.equal(h.calls.closed,1);
  assert.equal(reply.error.details.usage,null);assert.equal(reply.error.details.attempts,1);
});

test('decode and total generation budgets stop work, retain elapsed failure evidence and release the worker',async()=>{
  for(const chunks of [
    [{text:'[',advanceMs:1},{text:'1',advanceMs:10001}],
    [{text:'[',advanceMs:45001}]
  ]){
    const {h,reply}=await runBounded({chunks,cleanupMs:2});
    assert.equal(reply.type,'error');assert.equal(reply.error.code,'AI_TIMEOUT');
    assert.ok(h.calls.interrupts>=1);assert.equal(h.calls.closed,1);assert.equal(h.calls.requests.length,1);
    assert.ok(reply.error.details.elapsedMs>=chunks.reduce((total,chunk)=>total+(chunk.advanceMs||0),0));
    assert.equal(reply.error.details.usage,null);assert.equal(reply.error.details.attempts,1);
    if(chunks.length>1)assert.ok(reply.error.details.timing.decodeMs>=10001,'failed decode time must survive early exit');
  }
});

test('a runtime length finish never promotes even a valid short response into successful model classification',async()=>{
  const food=choiceIndex('支出｜餐飲');
  const {reply}=await runBounded({chunks:answer([food,food]),finishReason:'length'});
  assert.equal(reply.type,'error');assert.equal(reply.error.code,'AI_TRUNCATED');assert.equal(reply.error.details.finishReason,'length');
  assert.equal(reply.error.details.sourcePreview.modelTask,'source-extraction-only');assert.equal(reply.error.details.sourcePreview.inferencePerformed,false);
});

test('empty or unsafe source candidates are source-only observations and never fake a model refusal or success',async()=>{
  for(const input of ['今天沒有早餐65元。','如果午餐120元。','媽媽買午餐120元。','明天午餐120元。','發票號碼12065','今天買了午餐']){
    const {h,reply,value}=await runBounded({chunks:answer([1])},input);
    assert.equal(reply.type,'result',input);assert.equal(h.calls.requests.length,0,input);
    assert.equal(reply.result.inferencePerformed,false);assert.equal(reply.result.attempts,0);assert.equal(reply.result.modelDraft,null);assert.equal(reply.result.classificationDraft,null);
    assert.equal(reply.result.modelTask,'classify-source-candidates');assert.equal(value.items.length,0);assert.ok(!reply.result.rawModelOutput);
  }
});

test('an unsupported extra amount remains visible as partial coverage instead of silently disappearing',async()=>{
  const {reply,value}=await runBounded({chunks:answer([choiceIndex('支出｜餐飲')])},'今天早餐65元，買菜85。');
  assert.equal(reply.type,'result');assert.deepEqual(value.items.map(item=>item.amount),[65]);
  assert.equal(reply.result.normalization.coverage.status,'partial');assert.ok(reply.result.normalization.coverage.uncoveredSourceCount>=1);
});

test('a closed failed stream cannot keep the worker busy or poison the next classification request',async()=>{
  const food=choiceIndex('支出｜餐飲'),h=workerHarness({chunks:(_config,index)=>index===1?[{text:'{"result":'}]:answer([food,food])});await h.load();
  const failed=await h.generate(undefined,{promptProfile:PROFILE});assert.equal(failed.type,'error');
  const next=await h.generate(undefined,{promptProfile:PROFILE});assert.equal(next.type,'result');
  assert.deepEqual(JSON.parse(next.result.text).items.map(item=>item.amount),[65,120]);assert.equal(h.calls.closed,2);
});

test('the source preview arrives before model output and is retained privately on a hard timeout',async t=>{
  const source=await runBounded({chunks:answer([0,0])});
  const firstPreview=source.h.sent.findIndex(message=>message.type==='draft-preview');
  const firstToken=source.h.sent.findIndex(message=>message.type==='token');
  assert.ok(firstPreview>=0&&firstPreview<firstToken,'source review should not wait for GPU prefill');
  const preview=plain(source.h.sent[firstPreview].preview);preview.draft.items[0].note='PRIVATE_SOURCE_NOTE';preview.secret='PRIVATE_EXTRA';
  const h=controllerHarness(),seen=[];t.after(()=>h.api.unload());await loadController(h);
  const pending=h.api.generate({task:'draft',input:'PRIVATE_SOURCE_NOTE',context,onDraftPreview:value=>seen.push(value)});
  const worker=h.workers[0];worker.emit('draft-preview',{preview});
  assert.equal(seen.length,1);assert.equal(seen[0].inferencePerformed,false);assert.equal(seen[0].modelDraft,null);assert.equal(seen[0].secret,undefined);
  assert.equal(JSON.stringify(h.api.status()).includes('PRIVATE_SOURCE_NOTE'),false);
  const failed=assert.rejects(pending,error=>{
    assert.equal(error.code,'AI_TIMEOUT');assert.equal(error.details.sourcePreview.draft.items[0].note,'PRIVATE_SOURCE_NOTE');
    assert.equal(error.details.sourcePreview.inferencePerformed,false);assert.equal(error.details.sourcePreview.secret,undefined);return true;
  });
  h.timers.filter(timer=>!timer.cleared).at(-1).fn();await failed;
  assert.equal(worker.terminated,true);assert.equal(JSON.stringify(h.api.status()).includes('PRIVATE_SOURCE_NOTE'),false);
});
