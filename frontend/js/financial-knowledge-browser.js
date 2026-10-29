/* Public, authored financial summaries only. Same sparse BM25 as the server.
 * No account, transaction, token or user text is stored or sent by retrieval. */
(function (g) {
  'use strict';
  var corpus=null,pending=null,index=null;
  var stop=new Set('a an the i me my how do does is are can what to of and or for in on it please with this that'.split(' '));
  var queryStop=new Set('如何 可以 需要 多少 安排 應該 我們 我的 目前 請問 等等 希望 提供 資訊 顯示 之後 所有 這個 那個 沒有 什麼 使用 計算 人的 規則'.split(' '));
  function tokens(text){var out=(String(text).toLowerCase().match(/[a-z0-9]+/g)||[]).filter(function(w){return w.length>1&&!stop.has(w);});(String(text).match(/[\u3400-\u9fff]+/g)||[]).forEach(function(run){if(run.length===1)out.push(run);else for(var i=0;i<run.length-1;i++)out.push(run.slice(i,i+2));});return out.filter(function(t){return !queryStop.has(t);});}
  function prepare(value){
    if(!Array.isArray(value)||!value.length||value.length>100)throw Error('理財知識資料格式不符，請重新整理。');
    corpus=value.map(function(row){if(!row||!/^finance:[a-z0-9-]+$/.test(row.id)||typeof row.text!=='string'||row.text.length>2000||typeof row.title!=='string'||!/^https:\/\//.test(row.sourceLink))throw Error('理財知識來源格式不符。');return Object.assign({},row);});
    var df=new Map(),lengths=[],counts=corpus.map(function(row){var map=new Map(),list=tokens([row.title,row.text].concat(row.keywords||[]).join(' '));list.forEach(function(token){map.set(token,(map.get(token)||0)+1);});map.forEach(function(_,token){df.set(token,(df.get(token)||0)+1);});lengths.push(list.length);return map;});
    index={counts:counts,df:df,lengths:lengths,subjects:corpus.map(function(row){return new Set(tokens((row.keywords||[]).join(' ')));}),average:lengths.reduce(function(a,b){return a+b;},0)/lengths.length||1};return {version:'financial-education-20261029-v1',count:corpus.length};
  }
  function load(){if(corpus)return Promise.resolve({version:'financial-education-20261029-v1',count:corpus.length});if(!pending)pending=g.fetch('assets/financial-knowledge.json',{credentials:'omit',cache:'no-cache'}).then(function(r){if(!r.ok)throw Error('目前無法載入公開理財知識。');return r.json();}).then(prepare).catch(function(e){pending=null;throw e;});return pending;}
  function search(q,limit){
    if(!corpus||!index)throw Error('請先載入公開理財知識。');q=String(q||'').trim().slice(0,500);limit=Math.max(1,Math.min(8,Number.isInteger(limit)?limit:4));var query=new Set(tokens(q)),N=corpus.length;
    var scores=index.counts.map(function(doc,i){var score=0,subject=false;query.forEach(function(t){if(index.subjects[i].has(t))subject=true;});if(subject)query.forEach(function(t){var tf=doc.get(t)||0;if(tf){var df=index.df.get(t);score+=Math.log(1+(N-df+0.5)/(df+0.5))*tf*2.5/(tf+1.5*(0.25+0.75*index.lengths[i]/index.average));}});return {score:score,row:corpus[i]};}).filter(function(x){return x.score>0;}).sort(function(a,b){return b.score-a.score||(a.row.id<b.row.id?-1:a.row.id>b.row.id?1:0);});
    return {query:q,method:'bm25',corpusVersion:'financial-education-20261029-v1',items:scores.slice(0,limit).map(function(x){var row={score:Math.round(x.score*1000000)/1000000};['id','title','text','sourceLink','sourceTitle','reviewedAt','sourcePublishedAt','license'].forEach(function(k){row[k]=x.row[k]===undefined?null:x.row[k];});return row;}),totalMatches:scores.length,truncated:scores.length>limit};
  }
  g.FinancialKnowledge=Object.freeze({load:load,search:search});
})(typeof window!=='undefined'?window:globalThis);
