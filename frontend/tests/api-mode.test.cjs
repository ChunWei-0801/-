// No package installation needed: node --test frontend/tests/api-mode.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/api.js'), 'utf8');

function adapter(url, meta = '', saved = '') {
  const location = new URL(url);
  const storage = new Map([['fambudget.api', saved]]);
  const window = { location };
  vm.runInNewContext(source, {
    window, URL,
    document: { querySelector: () => ({ content: meta }) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  });
  return window.API;
}

test('standard local static frontend connects to the real backend', () => {
  const api = adapter('http://localhost:5174/');
  assert.equal(api.mode, 'http');
  assert.equal(api.base, 'http://localhost:8000');
});

test('single-service deployment uses its own origin', () => {
  const api = adapter('https://fambudget.example/');
  assert.equal(api.mode, 'http');
  assert.equal(api.base, 'https://fambudget.example');
});

test('mock requires an explicit parameter on a localhost page', () => {
  assert.equal(adapter('http://127.0.0.1:5174/?api=').mode, 'mock');
  assert.equal(adapter('http://localhost:5174/', '', '').mode, 'http');
  assert.equal(adapter('http://localhost:5174/', '', 'https://old-api.example').base, 'http://localhost:8000');
});

test('published pages ignore arbitrary API and mock overrides', () => {
  assert.equal(adapter('https://fambudget.example/?api=https://untrusted.example').base, 'https://fambudget.example');
  assert.equal(adapter('https://fambudget.example/?api=').mode, 'http');
});

test('local overrides accept HTTP and HTTPS URLs without embedded credentials', () => {
  assert.equal(adapter('http://localhost:5174/?api=http%3A%2F%2Flocalhost%3A8080').base, 'http://localhost:8080');
  assert.equal(adapter('http://localhost:5174/?api=javascript%3Aalert(1)').base, 'http://localhost:8000');
  assert.equal(adapter('http://localhost:5174/?api=https%3A%2F%2Fuser%3Apassword%40example.test').base, 'http://localhost:8000');
});

test('an explicit deployment configuration supports a separate trusted backend', () => {
  assert.equal(adapter('https://fambudget.example/', 'https://api.fambudget.example/').base, 'https://api.fambudget.example');
});
