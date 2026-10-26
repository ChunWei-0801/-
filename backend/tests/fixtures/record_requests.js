// 從空的資料開始，用 mock 把前端的每一支 API 走過一次（沒登入的註冊、家長、子女、平台管理員都有），
// 同一組參數再交給 http 轉接器，記下它「真的會送出去」的請求：方法、網址、查詢字串、主體。
//
// 由 tests/test_frontend_adapter.py 呼叫：node record_requests.js <repo 根目錄>
// 輸出 JSON：{ "METHOD /api/path": [{ fn, request, response }] }
//
// ⚠️ 前端改了送出的欄位、或後端改了收的欄位，pytest 會拿這份去跟 FastAPI 的請求模型比對。
const path = require('path');
const root = process.argv[2];
const store = new Map();
global.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const session = new Map();
global.sessionStorage = { getItem: k => session.has(k) ? session.get(k) : null, setItem: (k, v) => session.set(k, String(v)), removeItem: k => session.delete(k) };
global.setTimeout = f => setImmediate(f);
function boot(http) {
  for (const f of ['frontend/js/data.js', 'frontend/js/api.js']) delete require.cache[require.resolve(path.join(root, f))];
  global.document = { querySelector: s => (http && s.indexOf('api-base') >= 0 ? { content: 'http://api.test' } : null) };
  global.window = global.window || {};
  global.window.location = { hostname: 'localhost', origin: 'http://localhost:5174', protocol: 'http:', port: '5174', pathname: '/', search: http ? '' : '?api=' };
  global.window.__FAMBUDGET_TODAY__ = '2026-09-14';
  require(path.join(root, 'frontend/js/data.js'));
  require(path.join(root, 'frontend/js/api.js'));
  return window.API;
}
let reqs = [];
global.fetch = (url, opt) => {
  reqs.push({ method: (opt && opt.method) || 'GET', url: url.replace('http://api.test', ''), body: opt && opt.body ? JSON.parse(opt.body) : undefined, headers: opt && opt.headers || {}, credentials: opt && opt.credentials });
  return Promise.resolve({ ok: false, status: 501, json: () => Promise.resolve({ detail: 'x' }), text: () => Promise.resolve('{"detail":"x"}') });
};
global.window = {};
const H = boot(true);
const A = boot(false);
const settle = p => Promise.resolve(p).then(r => r, e => ({ ERROR: e.message, status: e.status || null }));
const out = {};
async function rec(name, ...args) {
  const r = await settle(A[name](...args));
  reqs = [];
  await settle(H[name](...args));
  const key = H.routes[name][0];
  (out[key] = out[key] || []).push({ fn: name, request: reqs[0] || null, response: r });
  return r;
}
(async () => {
  // Even with a saved session, public resources omit credentials and do not require mock login.
  sessionStorage.setItem('fambudget.auth', JSON.stringify({accessToken:'fixture-private-access',refreshToken:'fixture-private-refresh'}));
  await rec('fraudUpdates', {refresh:true});
  await rec('billingProfile');
  await rec('setBillingProfile', {buyerTaxId:'00123456',companyName:'測試單位'});
  const statement={provider:'信用卡CSV',paymentMethod:'credit_card',statementId:'a'.repeat(64),items:[{rowIndex:2,date:'2026-10-01',amount:'65.00',kind:'expense',cat:'1',merchant:'早餐店',currency:'TWD'}]};
  await rec('previewStatementImport', statement);
  await rec('confirmStatementImport', {...statement,idempotencyKey:'00000000-0000-4000-8000-000000000001'});
  await rec('monthlyReportSettings');
  await rec('setMonthlyReportSettings', {enabled:false,delivery:'email'});
  await rec('authorizeMonthlyReport', {enabled:true,delivery:'email',termsAccepted:true});
  await rec('revokeMonthlyReport');
  await rec('financialReferences', {language:'ja'});
  sessionStorage.removeItem('fambudget.auth');
  const dad = await rec('register', { name: '王大明', email: 'daming@wang.tw', password: 'daming-pass-1' });
  const verification = await rec('requestEmailVerification', 'daming@wang.tw');
  await rec('confirmEmailVerification', verification.demoVerificationUrl.split('/').pop());
  // Mock deliberately has no exchange feed. Record the real HTTP request shape
  // while retaining that unavailable result rather than inventing a quote.
  await rec('exchangeRates', { base: 'USD', refresh: false });
  await rec('exchangeConvert', { amount: '100.50', fromCurrency: 'USD', toCurrency: 'TWD' });
  // The mock deliberately has no authoritative grounding corpus or ledger
  // tool. Keep its explicit 503 while recording real authenticated GET shapes.
  await rec('aiLocalContext', { period: '2026-09', scope: 'me', limit: 12, offset: 0 });
  await rec('aiLocalKnowledge', { q: 'monthly budget', language: 'en', limit: 4 });
  const kid = await A.register({ name: '王小華', email: 'xiaohua@wang.tw', password: 'xiaohua-pass-1' });
  const mom = await A.register({ name: '陳美玲', email: 'meiling@wang.tw', password: 'meiling-pass-1' });
  await rec('logout');
  await rec('login', { email: 'daming@wang.tw', password: 'daming-pass-1' });
  await rec('updateProfile', { displayName: '王大明', birthYear: 1978 });
  await rec('updateProfile', { theme: 'sky' });
  await rec('updateProfile', { onboarded: true });
  const jpg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]).toString('base64');
  await rec('uploadAvatar', jpg);
  await rec('deleteAvatar');
  await rec('financeProfile');
  await rec('setFinanceProfile', { style: 'balanced', goals: ['emergency', 'travel'], habits: ['dca'], note: '每月定期定額 3,000' });
  await rec('verifyPassword', 'daming-pass-1');
  await rec('sessions');
  await rec('categories');
  await rec('createFamily', { name: '王家' });
  const code = await rec('createInviteCode', { role: 'parent', label: '給外婆' });
  const found = await rec('lookupUser', 'xiaohua@wang.tw');
  await rec('sendInvite', { userId: found.user.id, role: 'child' });
  await rec('invites');
  await A.login({ email: 'meiling@wang.tw', password: 'meiling-pass-1' });
  await rec('joinFamily', { code: code.code });
  await A.login({ email: 'xiaohua@wang.tw', password: 'xiaohua-pass-1' });
  const got = await A.invites();
  await rec('acceptInvite', got.received[0].id);
  const kg = await A.createGroup({ name: '小華零用' });
  await A.createTransaction({ date: '2026-09-12', amount: 180, kind: 'expense', cat: 'C05', groupId: kg.id, merchant: '誠品', note: '漫畫' });
  await A.login({ email: 'daming@wang.tw', password: 'daming-pass-1' });
  await rec('members');
  await rec('createGuardianship', { wardId: kid.user.id });
  await rec('guardianships');
  await rec('me');
  await rec('createCategory', { name: '寵物', kind: 'expense' });
  const g = await rec('createGroup', { name: '家用', color: 'book-indigo', note: '日常開銷' });
  // Cross-account invitations deliberately have no mock implementation. Record
  // their real private HTTP transport while retaining the explicit mock 503.
  sessionStorage.setItem('fambudget.auth', JSON.stringify({accessToken:'contract-activity-access',refreshToken:'contract-activity-refresh'}));
  await rec('lookupGroupUser', {groupId:g.id,email:'meiling@wang.tw'});
  await rec('groupInvites', g.id);
  await rec('receivedGroupInvites');
  await rec('inviteGroupMember', g.id, mom.user.id);
  await rec('createGroupInviteCode', g.id, {label:'旅行朋友'});
  await rec('cancelGroupInvite', g.id, '301');
  await rec('acceptGroupInvite', '302');
  await rec('declineGroupInvite', '303');
  await rec('joinGroup', 'ABCD2345');
  sessionStorage.removeItem('fambudget.auth');
  await rec('groups', {});
  await rec('updateGroup', g.id, { note: '日常開銷，全家共用' });
  await rec('addGroupMember', g.id, kid.user.id);
  await rec('setGroupNotify', g.id, true);
  const t1 = await rec('createTransaction', { date: '2026-09-13', amount: 1280, kind: 'expense', cat: 'C01', groupId: g.id, merchant: '全聯', note: '一週的菜' });
  await A.createTransaction({ date: '2026-09-01', amount: 62000, kind: 'income', cat: 'I01', groupId: g.id, merchant: '', note: '九月薪水' });
  await rec('transactions', { from: '2026-09-01', to: '2026-09-30' });
  sessionStorage.setItem('fambudget.auth', JSON.stringify({accessToken:'contract-activity-access',refreshToken:'contract-activity-refresh'}));
  await rec('transactionArchives', {userId:dad.user.id,groupId:g.id,from:'2026-09-01',to:'2026-09-30',
    categoryId:'C01',kind:'expense',source:'manual',q:'全聯'});
  sessionStorage.removeItem('fambudget.auth');
  await rec('updateTransaction', t1.id, { amount: 1350, note: '一週的菜＋水果' });
  const p1 = await rec('nlpParse', '早餐55');
  const pb = await rec('nlpParseBatch', '早上買早餐55，晚上加油1200');
  await rec('nlpConfirm', Object.assign({}, p1.out, { raw: '早餐55', groupId: g.id }));
  const items = pb.items.map(x => Object.assign({}, x, { orig: { by: 'model', date: x.date, amount: x.amount, kind: x.kind, cat: x.cat, merchant: x.merchant, note: x.note } }));
  items[0].groupId = g.id;
  await rec('nlpConfirmBatch', items);
  const all = await A.transactions({});
  const nlpIds = all.transactions.filter(t => t.source === 'nlp').map(t => t.id);
  await rec('deleteTransaction', nlpIds[0]);
  await rec('deleteTransactions', nlpIds.slice(1));
  await rec('setSavingsGoal', dad.user.id, 15000);
  await rec('savingsGoals');
  await rec('setBudget', { cat: 'C01', limit: 8000, period: 'month' });
  await rec('budgets', {});
  await rec('summary', { scope: 'family' });
  await rec('generateAdvices', { scope: 'me' });
  await rec('advices', { scope: 'me' });
  const al = await rec('createAlert', { percent: 80, groupId: null });
  await rec('alerts');
  await rec('updateAlert', al.id, { enabled: false });
  await rec('deleteAlert', al.id);
  await rec('setAllowance', kid.user.id, 3000);
  await rec('allowances');
  const nt = await rec('notifications', {});
  if (nt.notifications && nt.notifications[0]) {
    await rec('readNotification', nt.notifications[0].id);
    await rec('readNotifications', nt.maxId);
  }
  const tg = await A.createGroup({ name: '墾丁三天', kind: 'temp', endsOn: '2026-09-20' });
  await rec('settleGroup', tg.id);
  await rec('removeGroup', tg.id);
  await rec('removeGroupMember', g.id, kid.user.id);
  await rec('archiveGroup', g.id);
  await rec('changeMemberRole', kid.user.id, 'parent');
  await A.login({ email: 'xiaohua@wang.tw', password: 'xiaohua-pass-1' });
  await A.changeMemberRole(kid.user.id, 'child');
  await A.login({ email: 'daming@wang.tw', password: 'daming-pass-1' });
  const gs2 = await A.createGuardianship({ wardId: kid.user.id });
  await rec('endGuardianship', gs2.id);
  await rec('declineInvite', 'I-none');
  await rec('removeMember', kid.user.id);
  await A.login({ email: 'meiling@wang.tw', password: 'meiling-pass-1' });
  await rec('leaveFamily');
  await A.login({ email: 'daming@wang.tw', password: 'daming-pass-1' });
  await rec('dissolveFamily');
  await rec('changePassword', { oldPassword: 'daming-pass-1', newPassword: 'daming-pass-2' });
  await rec('requestPasswordReset', 'daming@wang.tw');
  await rec('confirmPasswordReset', 'x'.repeat(43), 'daming-pass-3');
  await A.login({ email: 'daming@wang.tw', password: 'daming-pass-2' });
  // 平台管理員：mock 沒有註冊管理員的方法，手動標一個（等於 python -m app.cli make-admin）
  window.DATA.members.find(m => m.id === mom.user.id).isPlatformAdmin = true;
  await A.login({ email: 'meiling@wang.tw', password: 'meiling-pass-1' });
  await rec('adminUsers');
  await rec('suspendUser', kid.user.id, '多次騷擾其他使用者');
  await rec('unsuspendUser', kid.user.id);
  await rec('audit');
  await A.login({ email: 'daming@wang.tw', password: 'daming-pass-2' });
  await rec('logoutAll');
  process.stdout.write(JSON.stringify(out));
})().catch(e => { console.error('CRASH', e); process.exit(1); });
