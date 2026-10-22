// Record the real JSON/multipart/binary adapters used by app.js, media.js,
// memories.js and life-features.js. These endpoints have no mock fallback.
// Explicit scenarios must cover every supplemental API.mediaRoutes entry.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.argv[2];
const storage = () => {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)};
};
global.localStorage = storage();
global.sessionStorage = storage();
global.window = {
  location: {hostname:'localhost', origin:'http://localhost:5174', protocol:'http:',
    port:'5174', pathname:'/', search:'', hash:''},
  addEventListener() {},
};
global.document = {
  querySelector: selector => selector.includes('api-base') ? {content:'http://api.test'} : null,
  addEventListener() {},
};
const photo = new Blob([Buffer.from('contract-photo')], {type:'image/jpeg'});
let requests = [];
global.fetch = async (url, options = {}) => {
  const request = {method:options.method || 'GET', url:url.replace('http://api.test', ''),
    headers:options.headers || {}};
  if (options.body instanceof FormData) {
    request.bodyKind = 'multipart';
    request.body = {};
    for (const [key, value] of options.body.entries()) {
      assert.equal(typeof value, 'object', 'Uploads must contain actual file parts');
      request.body[key] = {filename:value.name, contentType:value.type, size:value.size};
    }
  } else if (options.body != null) {
    request.bodyKind = 'json';
    request.body = JSON.parse(options.body);
  }
  requests.push(request);
  if (request.url === '/api/auth/login') {
    return Response.json({accessToken:'contract-access-token', refreshToken:'contract-refresh-token',
      user:{id:'101', name:'契約測試'}});
  }
  if (/\/(?:image|appearance-image)(?:\?|$)/.test(request.url) && request.method === 'GET') {
    return new Response(photo, {headers:{'Content-Type':'image/jpeg'}});
  }
  return Response.json({ok:true});
};
require(path.join(root, 'frontend/js/data.js'));
require(path.join(root, 'frontend/js/api.js'));
require(path.join(root, 'frontend/js/media.js'));
require(path.join(root, 'frontend/js/life-features.js'));
const API = window.API;
const media = window.MediaTools;
const life = window.LifeAPI;
const out = {};
let imageBlob;
const createObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = blob => { imageBlob = blob; return createObjectURL(blob); };
const multipart = () => {const body = new FormData(); body.append('file', photo, 'memory-photo.jpg'); return body;};
async function record(route, call) {
  const declarations = Object.entries(API.mediaRoutes || {}).filter(([, entry]) => entry[0] === route);
  assert.equal(declarations.length, 1, 'Missing or duplicated API.mediaRoutes declaration: ' + route);
  requests = [];
  const response = await call();
  assert.equal(requests.length, 1, 'Each media scenario must send exactly its own request: ' + route);
  out[route] = [{fn:declarations[0][0], adapter:'media', request:requests[0], response}];
}
async function image(url, bridge = media.imageURL) {
  const objectURL = await bridge(url);
  // The browser consumes a private response Blob, rather than a public URL.
  assert.ok(objectURL.startsWith('blob:'));
  assert.ok(imageBlob instanceof Blob);
  URL.revokeObjectURL(objectURL);
  return {contentType:imageBlob.type, size:imageBlob.size};
}
(async () => {
  await API.login({email:'contract@example.test', password:'contract-password-123'});
  const auth = {session:!!sessionStorage.getItem('fambudget.auth'),
    persistent:!!localStorage.getItem('fambudget.auth')};
  await record('GET /api/auth/me/appearance-image', () => image('/api/auth/me/appearance-image'));
  await record('POST /api/auth/me/appearance-image', () => API.request('/api/auth/me/appearance-image',
    {method:'POST', body:{dataUrl:'data:image/jpeg;base64,Y29udHJhY3Q='}}));
  await record('DELETE /api/auth/me/appearance-image', () => API.request('/api/auth/me/appearance-image', {method:'DELETE'}));
  await record('GET /api/transactions/{transaction_id}/photos', () => media.json('/api/transactions/101/photos'));
  await record('POST /api/transactions/{transaction_id}/photos', () => media.json('/api/transactions/101/photos', {method:'POST', body:multipart()}));
  await record('GET /api/transaction-photos/{photo_id}/image', () => image('/api/transaction-photos/201/image'));
  await record('DELETE /api/transaction-photos/{photo_id}', () => media.json('/api/transaction-photos/201', {method:'DELETE'}));
  await record('GET /api/memories', () => media.json('/api/memories'));
  await record('PATCH /api/memories/settings', () => media.json('/api/memories/settings', {method:'PATCH',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify({wallName:'全家回憶', period:'month',
      timezone:'Asia/Taipei', pieceCount:16, changesPerPeriod:2})}));
  await record('POST /api/memories/puzzles', () => media.json('/api/memories/puzzles', {method:'POST', body:multipart()}));
  await record('GET /api/memories/puzzles/{game_id}/image', () => image('/api/memories/puzzles/contract-game-1/image'));
  await record('GET /api/memories/achievements', () => media.json('/api/memories/achievements?year=2026&month=10&page=1'));
  await record('PUT /api/memories/wall-background', () => media.json('/api/memories/wall-background', {method:'PUT', body:multipart()}));
  await record('DELETE /api/memories/wall-background', () => media.json('/api/memories/wall-background', {method:'DELETE'}));
  await record('GET /api/memories/wall-background/image', () => image('/api/memories/wall-background/image'));
  await record('GET /api/lifestyle/preferences', () => life.request('GET', '/preferences'));
  await record('PUT /api/lifestyle/preferences', () => life.request('PUT', '/preferences', {
    birthDate:'1990-10-18', timezone:'Asia/Taipei', smokingEnabled:true, calculatorEnabled:true,
    shortcuts:[{id:'health',visible:true},{id:'smoking',visible:false},{id:'savings-game',visible:true}],
    customHabits:[{id:'custom-weekly-coins',name:'每週存零錢'}], hiddenHabitIds:['rent']
  }));
  await record('GET /api/lifestyle/birthdays', () => life.request('GET', '/birthdays?date=2026-10-18'));
  await record('GET /api/lifestyle/health', () => life.request('GET', '/health?year=2026&month=10'));
  // The date belongs to the route; daily measurement and smoking forms do not duplicate it in JSON.
  await record('PUT /api/lifestyle/health/{entry_date}', () => life.request('PUT', '/health/2026-10-18',
    {heightCm:170.5,weightKg:65.25}));
  await record('DELETE /api/lifestyle/health/{entry_date}', () => life.request('DELETE', '/health/2026-10-18'));
  await record('GET /api/lifestyle/smoking/settings', () => life.request('GET', '/smoking/settings'));
  await record('PUT /api/lifestyle/smoking/settings', () => life.request('PUT', '/smoking/settings', {monthlyLimit:20}));
  await record('GET /api/lifestyle/smoking', () => life.request('GET', '/smoking?month=2026-10'));
  await record('PUT /api/lifestyle/smoking/{entry_date}', () => life.request('PUT', '/smoking/2026-10-18',
    {boughtPacks:2,smokedPacks:1}));
  await record('GET /api/lifestyle/jar', () => life.request('GET', '/jar'));
  await record('PUT /api/lifestyle/jar', () => life.request('PUT', '/jar',
    {name:'旅行小恐龍',targetAmount:10000,savedAmount:1251,shape:'photo'}));
  // Server-provided full image paths must use the same authenticated binary bridge as suffixes.
  await record('GET /api/lifestyle/jar/image', () => image('/api/lifestyle/jar/image', life.imageURL));
  await record('PUT /api/lifestyle/jar/image', () => life.request('PUT', '/jar/image',
    {image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6xkAAAAASUVORK5CYII='}));
  await record('DELETE /api/lifestyle/jar/image', () => life.request('DELETE', '/jar/image'));
  await record('GET /api/lifestyle/jars', () => life.request('GET', '/jars'));
  await record('POST /api/lifestyle/jars', () => life.request('POST', '/jars', {name:'另一個願望',targetAmount:100,savedAmount:0,shape:'pig'}));
  await record('PUT /api/lifestyle/jars/{jar_id}', () => life.request('PUT', '/jars/901', {savedAmount:1}));
  await record('PUT /api/lifestyle/jars/{jar_id}/image', () => life.request('PUT', '/jars/901/image', {image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6xkAAAAASUVORK5CYII='}));
  await record('GET /api/lifestyle/jars/{jar_id}/image', () => image('/api/lifestyle/jars/901/image', life.imageURL));
  await record('GET /api/ai-local/report', () => API.request('/api/ai-local/report?year=2026&month=7&q='+encodeURIComponent('全聯/台北店')+'&kind=expense&scope=me&limit=100&offset=0'));
  await record('GET /api/ai-local/report/export', () => API.fetchMedia('/api/ai-local/report/export?year=2026&month=7&kind=expense&scope=me&format=xlsx'));
  assert.deepEqual(Object.keys(out).sort(), Object.values(API.mediaRoutes).map(entry => entry[0]).sort(),
    'Every supplemental route needs an explicit request scenario');
  process.stdout.write(JSON.stringify({sent:out, auth}));
})().catch(error => {console.error(error); process.exit(1);});
