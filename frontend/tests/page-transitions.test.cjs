const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../js/page-transitions.js'),'utf8');
function harness(options={}){
  const dataset={},events={},timers=new Map();let timerId=0,cancelled=0;
  const document={documentElement:{dataset},hidden:false,addEventListener:(name,fn)=>events[name]=fn};
  if(options.native)document.startViewTransition=options.native;
  const window={matchMedia:()=>({matches:!!options.reduced}),addEventListener:(name,fn)=>events[name]=fn,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(source,{window,document,Promise});
  const content={animate:()=>({finished:new Promise(()=>{}),cancel:()=>cancelled++})};
  return{api:window.PageTransitions,view:{isConnected:true,firstElementChild:content},dataset,events,timers,cancelled:()=>cancelled};
}
test('route motion never duplicates rendering after a native capture error',()=>{
  let renders=0,captures=0;
  const h=harness({native:fn=>{captures++;fn();throw new Error('capture unavailable');}});
  h.api.run(h.view,{route:'#/',authenticated:true,accountId:1},()=>renders++);
  h.api.run(h.view,{route:'#/entry',authenticated:true,accountId:1},()=>renders++);
  assert.equal(captures,1);assert.equal(renders,2);assert.deepEqual(h.dataset,{});
});
test('same-route refresh, account switches and reduced-motion avoid outgoing snapshots',()=>{
  let captures=0,renders=0;
  const h=harness({native:()=>{captures++;throw new Error('must not snapshot');}});
  for(const options of [{route:'#/',authenticated:true,accountId:1},{route:'#/',authenticated:true,accountId:1},{route:'#/entry',authenticated:true,accountId:2},{route:'#/login',authenticated:false}])h.api.run(h.view,options,()=>renders++);
  assert.equal(captures,0);assert.equal(renders,4);
  const reduced=harness({reduced:true,native:()=>{throw new Error('must not animate');}});
  reduced.api.run(reduced.view,{route:'#/'},()=>{});reduced.api.run(reduced.view,{route:'#/entry'},()=>renders++);
  assert.equal(renders,5);assert.deepEqual(reduced.dataset,{});
});
test('fallback animation is bounded and stops when hidden or navigation starts',()=>{
  const h=harness();let renders=0;
  h.api.run(h.view,{route:'#/'},()=>renders++);h.api.run(h.view,{route:'#/entry'},()=>renders++);
  assert.equal(renders,2);assert.equal(h.dataset.routeDirection,'forward');
  h.events.hashchange();assert.equal(h.cancelled(),1);assert.deepEqual(h.dataset,{});assert.equal(h.timers.size,0);
  h.api.run(h.view,{route:'#/'},()=>renders++);assert.equal(h.dataset.routeDirection,'back');h.events.pagehide();assert.equal(h.cancelled(),2);
});
