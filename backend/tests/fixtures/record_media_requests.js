// Record the real JSON/multipart/binary adapters used by app.js, media.js and
// memories.js. These endpoints have no browser-only mock implementation.
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
const API = window.API;
const media = window.MediaTools;
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
async function image(url) {
  const objectURL = await media.imageURL(url);
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
  assert.deepEqual(Object.keys(out).sort(), Object.values(API.mediaRoutes).map(entry => entry[0]).sort(),
    'Every supplemental route needs an explicit request scenario');
  process.stdout.write(JSON.stringify({sent:out, auth}));
})().catch(error => {console.error(error); process.exit(1);});
