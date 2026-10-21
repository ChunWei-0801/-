// Public resources use the real HTTP transport in both adapters, without any account lookup.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/api.js'),'utf8');

function adapter(url){
  const values=new Map([['fambudget.auth',JSON.stringify({accessToken:'private-fixture',refreshToken:'private-refresh'})]]), calls=[];
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  const window={location:new URL(url),AbortController};
  let status=200, malformed=false;
  vm.runInNewContext(source,{
    window,URL,AbortController,setTimeout,clearTimeout,localStorage:storage,sessionStorage:storage,
    document:{querySelector:()=>null},
    fetch:async(url,options)=>{
      calls.push({url,options});
      const body=malformed?{items:[{id:123}],mode:'curated-referenced-education',liveBookFeed:false,notice:'Public education'}:url.includes('anti-fraud')?{
        status:'unavailable',items:[],source:{name:'Government',url:'https://data.gov.tw/dataset/38262'},
        lastSyncedAt:null,lastAttemptAt:null,stale:false,officialLinks:[]
      }:{items:[],mode:'curated-referenced-education',liveBookFeed:false,notice:'Public education'};
      return {ok:status<400,status,json:async()=>body,text:async()=>JSON.stringify({detail:'Public source unavailable'})};
    }
  });
  return {api:window.API,calls,fail:()=>{status=401;},malformed:()=>{malformed=true;},values};
}

for(const url of ['https://fambudget.example/','http://localhost:5174/?api=']){
  test('public resources omit saved credentials and account lookups: '+url,async()=>{
    const {api,calls,values}=adapter(url),saved=values.get('fambudget.auth');
    const fraud=await api.fraudUpdates({refresh:true,userId:'never-send-this',ledger:{amount:99}});
    const catalog=await api.financialReferences({language:'es',q:'private prompt must never be sent'});
    assert.equal(fraud.status,'unavailable');assert.equal(catalog.liveBookFeed,false);
    assert.deepEqual(calls.map(call=>new URL(call.url).pathname),['/api/resources/anti-fraud','/api/resources/financial']);
    assert.equal(new URL(calls[0].url).search,'?refresh=true');assert.equal(new URL(calls[1].url).search,'?language=es');
    for(const {options} of calls){assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,undefined);}
    assert.equal(values.get('fambudget.auth'),saved);
    assert.equal(api.routes.fraudUpdates[0],'GET /api/resources/anti-fraud');
    assert.equal(api.routes.financialReferences[0],'GET /api/resources/financial');
  });
  test('a public 401 never refreshes or removes the active session: '+url,async()=>{
    const {api,calls,fail,values}=adapter(url),saved=values.get('fambudget.auth');fail();
    await assert.rejects(api.fraudUpdates(),error=>error.status===401);
    assert.equal(calls.length,1);assert.equal(new URL(calls[0].url).pathname,'/api/resources/anti-fraud');
    assert.equal(values.get('fambudget.auth'),saved);
  });
  test('malformed public catalog data is rejected rather than filled with fake references: '+url,async()=>{
    const {api,malformed}=adapter(url);malformed();
    await assert.rejects(api.financialReferences(),error=>error.kind==='shape');
  });
}
