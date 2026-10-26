/* Generated Google Apps Script is executed against isolated service doubles only. */
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), crypto = require('node:crypto');
const { generateScript, exportURL } = require('../js/monthly-report-setup.js');
const url = 'https://fambudget-recovery-20261017.onrender.com/api/monthly-reports/export';
const token = 'fixture_private_token_abcdefghijklmnopqrstuvwxyz0123456789';
function fixture(channel = 'email', options = {}) {
  const properties = new Map([['FAMBUDGET_REPORT_URL', url], ['FAMBUDGET_REPORT_TOKEN', token]]);
  const state = { properties, fetches: [], sends: [], files: [], folders: [], sleeps: [], triggers: [{ handler: 'unrelated' }, { handler: 'runMonthlyReport' }], pdfs: 0, quota: 100, responseCodes: [], throwMail: false, throwCSV: false, throwProperties: false };
  const fixed = options.date || '2026-11-01T01:00:00Z';
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [fixed])); } }
  const report = { version: 1, period: '2026-10', timezone: 'Asia/Taipei', recipientEmail: 'verified@example.test', delivery: channel, folderId: null, totals: { income: '500.00', expense: '65.00', net: '435.00', count: 2 }, transactions: [{ date: '2026-10-20', amount: '65.00', kind: 'expense' }], csv: '\ufeff日期,商家,金額\r\n2026-10-20,\'=HYPERLINK("x"),65.00\r\n', html: '<!doctype html><html><body>已跳脫 &lt;script&gt;</body></html>' };
  Object.assign(report, options.report || {}); state.report = report;
  const props = { getProperty: key => properties.get(key) ?? null, setProperty: (key, value) => { if (state.throwProperties && key.startsWith('FAMBUDGET_STATE_')) throw Error('private provider failure'); properties.set(key, value); return props; }, deleteProperty: key => properties.delete(key) };
  function iterator(values) { let index = 0; return { hasNext: () => index < values.length, next: () => values[index++] }; }
  function blob(data, type, name) { return { data, type, name, getAs(nextType) { state.pdfs++; return blob(this.data, nextType, this.name); }, setName(value) { this.name = value; return this; }, getName() { return this.name; } }; }
  function folder(name, id = 'folder_' + String(state.folders.length + 1).padStart(12, '0')) {
    const entry = { name, id, getId: () => id, getFilesByName: name => iterator(state.files.filter(file => file.folder === id && file.name === name)), createFile(value) { const file = { id: 'file_' + (state.files.length + 1), folder: id, name: value.getName(), getId() { return this.id; } }; state.files.push(file); if (state.throwCSV && value.getName().endsWith('.csv')) throw Error('uncertain private response'); return file; } };
    state.folders.push(entry); return entry;
  }
  const context = vm.createContext({ Date: Clock, console: { log() { throw Error('No private logs'); }, error() { throw Error('No private logs'); } },
    PropertiesService: { getScriptProperties: () => props },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, value) => [...crypto.createHash('sha256').update(value).digest()], formatDate: (date, timezone) => new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit' }).format(date), sleep: value => state.sleeps.push(value), newBlob: blob },
    LockService: { getScriptLock: () => ({ tryLock: () => !state.locked, releaseLock: () => { state.released = true; } }) },
    UrlFetchApp: { fetch(value, config) { state.fetches.push({ url: value, config }); const code = state.responseCodes.length ? state.responseCodes.shift() : 200; if (code === 'network') throw Error('network private'); return { getResponseCode: () => code, getContentText: () => state.rawResponse || JSON.stringify(report) }; } },
    MailApp: { getRemainingDailyQuota: () => state.quota, sendEmail(value) { state.sends.push(value); if (state.throwMail) throw Error('provider response unknown'); } },
    DriveApp: { getFoldersByName: name => iterator(state.folders.filter(row => row.name === name)), createFolder: name => folder(name), getFolderById: id => { const found = state.folders.find(row => row.id === id); if (!found) throw Error('missing folder'); return found; }, getFileById: id => { const found = state.files.find(row => row.id === id); if (!found) throw Error('missing file'); return found; } },
    ScriptApp: { getProjectTriggers: () => state.triggers.map(row => ({ ...row, getHandlerFunction: () => row.handler })), deleteTrigger: value => { const index = state.triggers.findIndex(row => row.handler === value.handler); if (index >= 0) state.triggers.splice(index, 1); }, newTrigger: handler => { const spec = { handler }, builder = { timeBased() { return this; }, onMonthDay(value) { spec.day = value; return this; }, atHour(value) { spec.hour = value; return this; }, inTimezone(value) { spec.timezone = value; return this; }, create() { state.triggers.push(spec); return spec; } }; return builder; } }
  });
  vm.runInContext(generateScript({ delivery: channel, exportUrl: url }), context);
  state.context = context; state.folder = folder; return state;
}
function saved(state) { const entry = [...state.properties].find(([key]) => /^FAMBUDGET_STATE_.*_\d{4}-\d{2}$/.test(key)); return entry && JSON.parse(entry[1]); }

test('generated packs contain no token, select only requested Google services, and pin the export destination', () => {
  for (const mode of ['email', 'drive', 'both']) {
    const code = generateScript({ delivery: mode, exportUrl: url });
    assert.ok(!code.includes(token)); assert.ok(code.includes('FAMBUDGET_REPORT_TOKEN')); new vm.Script(code);
    assert.equal(code.includes('DriveApp'), mode !== 'email'); assert.equal(code.includes('MailApp'), mode !== 'drive');
  }
  assert.match(generateScript({ exportUrl: url }), /FAMBUDGET_INSTALLED_DELIVERY = "email"/);
  for (const invalid of ['http://localhost/api/monthly-reports/export', 'https://attacker.test/api/monthly-reports/export', url + '?token=secret', url + '#secret', 'https://user:secret@fambudget-recovery-20261017.onrender.com/api/monthly-reports/export']) assert.throws(() => exportURL(invalid));
});

test('install is explicit and replaces only this monthly trigger without fetching or delivering a report', () => {
  const h = fixture(); h.context.installMonthlyReport();
  assert.equal(h.fetches.length, 0); assert.equal(h.sends.length, 0); assert.equal(h.files.length, 0);
  assert.equal(h.triggers.filter(row => row.handler === 'runMonthlyReport').length, 1);
  const trigger = h.triggers.find(row => row.handler === 'runMonthlyReport'); assert.equal(trigger.day, 1); assert.equal(trigger.hour, 9); assert.equal(trigger.timezone, 'Asia/Taipei');
  h.context.removeMonthlyReport(); assert.deepEqual(h.triggers.map(row => row.handler), ['unrelated']);
  h.properties.delete('FAMBUDGET_REPORT_TOKEN'); assert.throws(() => h.context.installMonthlyReport(), /指令碼屬性/);
});

test('default email targets only the verified server recipient and repeated or rotated-token jobs do not resend', () => {
  const h = fixture(); assert.equal(h.context.runMonthlyReport().status, 'complete');
  assert.equal(h.fetches[0].url, url + '?period=2026-10'); assert.equal(h.fetches[0].config.headers.Authorization, 'Bearer ' + token); assert.equal(h.fetches[0].config.followRedirects, false); assert.ok(!h.fetches[0].url.includes(token));
  assert.equal(h.sends.length, 1); assert.equal(h.sends[0].to, 'verified@example.test'); assert.equal(h.sends[0].attachments.length, 2); assert.equal(h.sends[0].attachments[0].getName(), 'FamBudget-2026-10.pdf'); assert.equal(h.sends[0].attachments[1].data, h.report.csv); assert.equal(h.files.length, 0);
  assert.equal(h.context.runMonthlyReport().status, 'already-complete'); h.properties.set('FAMBUDGET_REPORT_TOKEN', 'new_private_token_abcdefghijklmnopqrstuvwxyz0123456789'); h.context.runMonthlyReport(); assert.equal(h.sends.length, 1); assert.equal(saved(h).email, 'sent');
});

test('Drive-only and both-channel packs save one PDF/CSV pair without overwriting or repeated sends', () => {
  for (const mode of ['drive', 'both']) {
    const h = fixture(mode); h.context.runMonthlyReport(); h.context.runMonthlyReport();
    assert.equal(h.files.length, 2); assert.equal(h.folders.length, 1); assert.equal(h.sends.length, mode === 'both' ? 1 : 0); assert.equal(saved(h).drive, 'done');
  }
  const h = fixture('drive'); const chosen = h.folder('My private reports', 'private_folder_12345'); h.report.folderId = chosen.id; h.context.runMonthlyReport(); assert.equal(h.folders.length, 1); assert.ok(h.files.every(row => row.folder === chosen.id));
});

test('bounded cold-start retries occur only before delivery and failures or changed channels never send', () => {
  const h = fixture('email'); h.responseCodes = [503, 502, 200]; h.context.runMonthlyReport(); assert.equal(h.fetches.length, 3); assert.deepEqual(h.sleeps, [1500, 4000]); assert.equal(h.sends.length, 1);
  for (const code of [401, 403, 302]) { const f = fixture(); f.responseCodes = [code]; assert.throws(() => f.context.runMonthlyReport()); assert.equal(f.fetches.length, 1); assert.equal(f.sends.length, 0); }
  const mismatch = fixture('email', { report: { delivery: 'both' } }); assert.throws(() => mismatch.context.runMonthlyReport(), /內容或寄送選擇/); assert.equal(mismatch.sends.length, 0); assert.equal(mismatch.files.length, 0);
  const down = fixture(); down.responseCodes = [503, 503, 503, 503, 503, 503]; assert.throws(() => down.context.runMonthlyReport()); assert.equal(down.fetches.length, 6); assert.equal(down.sends.length, 0);
});

test('uncertain email is never retried automatically and explicit recovery cannot reset a known successful send', () => {
  const h = fixture(); h.throwMail = true; assert.throws(() => h.context.runMonthlyReport(), /未能確認/); assert.equal(saved(h).email, 'uncertain');
  h.throwMail = false; assert.throws(() => h.context.runMonthlyReport(), /未能確認/); assert.equal(h.sends.length, 1); assert.throws(() => h.context.resetUncertainMonthlyReport(), /FAMBUDGET_CONFIRM_RETRY/);
  h.properties.set('FAMBUDGET_CONFIRM_RETRY', '2026-10'); h.context.resetUncertainMonthlyReport(); assert.equal(h.sends.length, 1, 'recovery only changes status, never sends'); h.context.runMonthlyReport(); assert.equal(h.sends.length, 2);
  h.properties.set('FAMBUDGET_CONFIRM_RETRY', '2026-10'); h.context.resetUncertainMonthlyReport(); h.context.runMonthlyReport(); assert.equal(h.sends.length, 2, 'known successful send remains sent');
});

test('partial Drive uncertainty blocks automatic retries, then explicit recovery reuses existing files', () => {
  const h = fixture('both'); h.throwCSV = true; assert.throws(() => h.context.runMonthlyReport(), /雲端保存結果/); assert.equal(h.files.length, 2); assert.equal(h.sends.length, 0);
  h.throwCSV = false; assert.throws(() => h.context.runMonthlyReport(), /上次雲端/); assert.equal(h.files.length, 2);
  h.properties.set('FAMBUDGET_CONFIRM_RETRY', '2026-10'); h.context.resetUncertainMonthlyReport(); h.context.runMonthlyReport(); assert.equal(h.files.length, 2); assert.equal(h.sends.length, 1); assert.equal(saved(h).drive, 'done');
});

test('quota, state-storage failure and invalid report formats stop before exposing private data', () => {
  const quota = fixture(); quota.quota = 0; assert.throws(() => quota.context.runMonthlyReport(), /額度不足/); assert.equal(quota.sends.length, 0); assert.equal(saved(quota), undefined); quota.quota = 1; quota.context.runMonthlyReport(); assert.equal(quota.sends.length, 1);
  const storage = fixture(); storage.throwProperties = true; assert.throws(() => storage.context.runMonthlyReport(), /保存月報傳送狀態/); assert.equal(storage.sends.length, 0);
  for (const report of [{ recipientEmail: 'invalid' }, { period: '2026-09' }, { timezone: 'UTC' }, { folderId: '../../private' }]) { const h = fixture('email', { report }); assert.throws(() => h.context.runMonthlyReport()); assert.equal(h.sends.length, 0); }
  const raw = fixture(); raw.rawResponse = 'server secret ' + token; let error; try { raw.context.runMonthlyReport(); } catch (value) { error = value; } assert.ok(error); assert.ok(!error.message.includes(token));
});

test('Taipei January scheduling selects December of the preceding year and concurrent execution is rejected', () => {
  const h = fixture('email', { date: '2026-12-31T17:30:00Z', report: { period: '2026-12' } }); h.context.runMonthlyReport(); assert.match(h.fetches[0].url, /period=2026-12$/);
  const locked = fixture(); locked.locked = true; assert.throws(() => locked.context.runMonthlyReport(), /正在執行/); assert.equal(locked.fetches.length, 0);
});
