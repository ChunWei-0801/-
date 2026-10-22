// Synthetic public-adapter regression. No model, account or ledger writes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/api.js'),'utf8');
const categories=[{id:'C08',name:'其他',kind:'expense'},{id:'I04',name:'其他收入',kind:'income'}];
function adapter(mock){
  const calls=[],values=new Map([['fambudget.state.v2',JSON.stringify({me:'fixture',auth:{loggedIn:true}})]]),window={location:new URL(mock?'http://localhost:5174/?api=':'https://budget.example/'),fbToday:()=> '2026-10-22',DATA:{categories,transactions:[],budgets:[],members:[{id:'fixture',name:'Fixture',savingsGoal:0}],families:[],familyMembers:[],guardianships:[],groups:[],groupMembers:[]}};
  vm.runInNewContext(source,{window,URL,AbortController,document:{querySelector:()=>null},localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},setTimeout:(fn,ms)=>ms<=1100?setTimeout(fn,0):setTimeout(fn,ms).unref(),clearTimeout,
    fetch:async(url,options)=>{
      const p=new URL(url).pathname;calls.push([options.method||'GET',p]);
      const failure=p.startsWith('/api/nlp/parse');
      const body=failure?{detail:'Model not configured'}:p==='/api/categories'?{categories:categories.map((c,i)=>({...c,id:'server-'+i}))}:{family:null,members:[],me:'fixture'};
      return{ok:!failure,status:failure?503:200,json:async()=>body,text:async()=>JSON.stringify(body)};
    }});
  return{api:window.API,calls};
}
for(const mock of [true,false]){
  test((mock?'mock':'HTTP 503 fallback')+' preserves winnings vs ticket-purchase directions and discloses rules',async()=>{
    const {api,calls}=adapter(mock);
    const win=await api.nlpParseBatch('威力彩中了200000000');
    assert.equal(win.by,'rules');assert.equal(win.fallback,true);assert.equal(win.items.length,1);
    assert.deepEqual([win.items[0].kind,win.items[0].amount,win.items[0].cat],['income',200000000,mock?'I04':'server-1']);
    const buy=await api.nlpParseBatch('買威力彩100元沒有中獎');assert.equal(buy.items[0].kind,'expense');
    for(const text of ['沒有中獎200元','如果威力彩中了200元','朋友威力彩中了200元','他威力彩中了200元','威力彩中了200元嗎','威力彩頭獎金額200元','買彩券100元中了200元']){
      const result=await api.nlpParseBatch(text);const row=result.items[0];
      assert.equal(row.kind,null,text);assert.equal(row.cat,null,text);assert.ok(row.missing.includes('kind'));assert.ok(row.missing.includes('cat'));
    }
    const hypothetical=await api.nlpParseBatch('如果去買彩券，就威力彩中了200元');assert.equal(hypothetical.items.at(-1).kind,null);
    const single=await api.nlpParse('威力彩中了200000000');assert.equal(single.out.kind,'income');assert.equal(single.by,'rules');
    assert.equal(calls.some(([method,p])=>method!=='GET'&&!p.startsWith('/api/nlp/parse')),false,'No confirmation/write API is called');
  });
}
