/* No private or public response caching: installation does not duplicate account data. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  var url=new URL(event.request.url);
  if(event.request.mode!=='navigate'||url.origin!==self.location.origin)return;
  event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="zh-TW"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>家庭記帳 · 目前離線</title><body><main><h1>目前沒有網路連線</h1><p>請連線後重新開啟家庭記帳。離線時不會新增或修改帳務資料。</p><a href="/">重新連線</a></main></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{var target=new URL('/#/calendar',self.location.origin).href,client=clients.find(c=>new URL(c.url).origin===self.location.origin);if(client){await client.navigate(target);return client.focus();}return self.clients.openWindow(target);}));});
