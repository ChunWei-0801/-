/* Synthetic, browser-only teaching data. Never imports production account data. */
(function (global) {
  'use strict';
  function today() {
    var parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date());
    function part(type) { return parts.find(function (item) { return item.type === type; }).value; }
    return part('year') + '-' + part('month') + '-' + part('day');
  }
  function monthBefore(value, offset) {
    var date = new Date(Date.UTC(Number(value.slice(0,4)), Number(value.slice(5,7)) - 1 - offset, 1));
    return date.toISOString().slice(0,7);
  }
  function create() {
    var day = today(), people = [
      {id:'demo-parent',name:'小安家長',role:'parent',description:'記錄家庭收支、安排目標、發放模擬零用錢'},
      {id:'demo-child',name:'小安',role:'child',description:'記錄生活消費、查看收到的模擬零用錢'},
      {id:'demo-friend',name:'朋友小晴',role:'friend',description:'記錄個人消費，接受活動邀請'}
    ], transactions = [], sequence = 0;
    people.forEach(function (person, personIndex) {
      for (var month = 0; month < 3; month++) {
        var key = monthBefore(day,month);
        transactions.push({id:'seed-' + (++sequence),userId:person.id,date:key+'-01',kind:'income',amount:personIndex===0?52000:personIndex===1?800:38000,category:personIndex===1?'零用錢':'薪資',note:personIndex===1?'示範零用錢收入':'虛構薪資',activityId:null});
        for (var item = 0; item < 8; item++) {
          var dates = [2,4,7,10,13,16,19,22], amounts = personIndex===1?[45,30,60,25,40,50,35,20]:[1200,980,350,2400,120,650,1800,450];
          transactions.push({id:'seed-' + (++sequence),userId:person.id,date:key+'-'+String(dates[item]).padStart(2,'0'),kind:'expense',amount:amounts[item]+(personIndex===2?50:0),category:['餐飲','生活','交通','居住','餐飲','娛樂','生活','餐飲'][item],note:['家庭採買','生活用品','交通支出','固定費用','午餐','休閒活動','日常用品','晚餐'][item]+'（虛構）',activityId:item===5&&personIndex===0?'demo-picnic':null});
        }
      }
    });
    return {version:187,createdAt:new Date().toISOString(),referenceDay:day,activeUserId:'demo-parent',people:people,transactions:transactions,
      activities:[{id:'demo-picnic',name:'週末野餐',ownerId:'demo-parent',memberIds:['demo-parent','demo-child']}],
      goals:[{id:'seed-goal',userId:'demo-parent',name:'家庭旅遊基金',targetAmount:30000,savedAmount:6000,shape:'pig'}],
      transfers:[],feedback:null,experience:{startedAt:Date.now(),completed:{}}};
  }
  global.FamBudgetDemoData = Object.freeze({create:create,today:today,monthBefore:monthBefore});
})(window);
