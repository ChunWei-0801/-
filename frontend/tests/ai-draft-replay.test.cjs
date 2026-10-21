/*
 * Recorded-output regression, NOT a fresh model inference or model-quality test.
 * The failed user-device example is synthetic app-default text. Only WebLLM's
 * runtime/GPU probe is replaced: the actual worker, controller, HTML parser,
 * translations, source checks and result rendering run together in Chromium.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..');
const recordedFailure = {
  items: [
    {sourceText:'今天早餐65元',amountText:'65',classification:'支出（未選分類）',dateText:'今天',currency:'TWD',merchantText:null},
    {sourceText:'午餐120元',amountText:'120',classification:'收入｜薪資',dateText:'今天',currency:'TWD',merchantText:'收銀員3號'}
  ], warnings:[]
};
// Additional fixed transport fixture for the public page's second example.
// This is not represented as observed user-device output.
const salaryFixture = {items:[{sourceText:'今天收到薪資30000元',amountText:'30000',classification:'收入｜薪資',dateText:'今天',currency:'TWD',merchantText:null}],warnings:[]};

let chromium;
try { ({chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch (_) {}

test('recorded user-device failure crosses real worker/controller/browser and retains honest model-vs-assisted results', {skip:!chromium}, async () => {
  const executablePath = process.env.CHROMIUM_EXECUTABLE || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Taipei',serviceWorkers:'block'});
    const errors = [], unexpected = [], writes = [];
    await context.addInitScript(() => {
      localStorage.setItem('fambudget.language','zh-TW');
      window.__recordedReplay = {calls:0};
      Object.defineProperty(navigator, 'gpu', {configurable:true,value:{requestAdapter:async()=>({features:new Set(['shader-f16'])})}});
      const NativeWorker = window.Worker;
      window.Worker = class RecordedRuntimeWorker extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', event => {
            if (event.data && event.data.type === 'recorded-output-replay') window.__recordedReplay.calls = event.data.calls;
          });
        }
      };
    });
    const workerSource = fs.readFileSync(path.join(root,'js/local-ai-worker.js'),'utf8');
    assert.equal(workerSource.includes('import(RUNTIME_URL)'),true,'replace only the pinned runtime import, not validation or normalization');
    const replayRuntime = `
      // RECORDED OUTPUT REPLAY: no model weights, GPU computation or quality claim.
      let replayCalls = 0;
      self.__recordedRuntime = {
        CreateMLCEngine: async () => ({
          resetChat: async () => {}, unload: async () => {},
          chat: {completions:{create: async options => {
            const finalInput = options.messages[options.messages.length - 1].content;
            const literal = finalInput.includes('今天收到薪資30000元') ? ${JSON.stringify(JSON.stringify(salaryFixture))} : ${JSON.stringify(JSON.stringify(recordedFailure))};
            self.postMessage({type:'recorded-output-replay',calls:++replayCalls});
            return (async function* () {
              yield {choices:[{delta:{content:literal},finish_reason:null}]};
              yield {choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1136,completion_tokens:174,total_tokens:1310}};
            })();
          }}}
        }),
        prebuiltAppConfig:{model_list:[]}, deleteModelAllInfoInCache:async()=>{}
      };
    `;
    const permitted = new Set(['/ai-test.html','/js/i18n.js','/js/local-ai-engine.js','/js/ai-model-test.js','/js/local-ai-worker.js','/css/tokens.css','/css/ai-assistant.css']);
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') writes.push({method:request.method(),path:url.pathname});
      if (url.origin !== 'http://localhost:47171' || request.method() !== 'GET') { unexpected.push(request.url()); return route.abort(); }
      if (/^\/locales\/(zh-TW|zh-CN|en|ja|ko|es)\.json$/.test(url.pathname)) {
        return route.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(root,url.pathname.slice(1)),'utf8')});
      }
      if (!permitted.has(url.pathname)) { unexpected.push(url.pathname); return route.abort(); }
      if (url.pathname === '/js/local-ai-worker.js') {
        return route.fulfill({contentType:'text/javascript',body:replayRuntime+workerSource.replace('import(RUNTIME_URL)','Promise.resolve(self.__recordedRuntime)')});
      }
      const contentType = url.pathname.endsWith('.html') ? 'text/html' : url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
      return route.fulfill({contentType,body:fs.readFileSync(path.join(root,url.pathname.slice(1)),'utf8')});
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:47171/ai-test.html?v=recorded-replay');
    await page.waitForFunction(() => !document.querySelector('#modelLoad').disabled);
    assert.equal(await page.evaluate(() => __recordedReplay.calls),0,'mount does not start generation');
    await page.locator('#modelLoad').click();
    await page.waitForFunction(() => !document.querySelector('#modelRun').disabled);
    await page.locator('#modelInput').fill('今天早餐65元，午餐120元。');
    await page.locator('#modelRun').click();
    await page.waitForFunction(() => document.querySelectorAll('#modelOutput .model-draft').length === 2);
    const single = JSON.parse(await page.locator('#modelMetrics').textContent());
    assert.deepEqual(single.normalizedDraft.items.map(row => [row.amount,row.kind,row.category,row.merchant]), [[65,'expense','FOOD',null],[120,'expense','FOOD',null]]);
    assert.equal(single.measurement.attempts,1,'unsupported optional merchant does not cause another inference');
    assert.equal(await page.evaluate(() => __recordedReplay.calls),1);
    assert.deepEqual(JSON.parse(single.rawModelOutput),recordedFailure,'literal faulty inference is preserved, never replaced with expected output');
    assert.equal(single.modelDraft.items[1].kind,'income','pre-rule model classification remains visible');
    assert.equal(single.modelDraft.items[1].category,'SALARY');
    assert.equal(single.modelDraft.items[1].merchant,'收銀員3號','pre-rule invented merchant remains in model evidence while the editable merchant is cleared');
    assert.equal(single.normalization.sourceRuleAssisted,true);
    assert.ok(single.normalization.adjustments.some(change => change.rowIndex === 1 && change.field === 'merchant'));
    assert.ok(single.normalization.adjustments.some(change => change.rowIndex === 1 && change.field === 'kind'));
    assert.equal(await page.locator('#modelStatus').evaluate(node => node.classList.contains('error')),false);
    assert.equal(await page.locator('#modelDiagnostics').isVisible(),false);
    assert.ok(await page.locator('#modelOutput [data-review-checks]').count(),'source-check notices appear beside readable drafts');
    assert.equal(await page.locator('#modelTechnical').evaluate(node => node.open),false,'technical output stays folded');

    await page.setViewportSize({width:320,height:800});
    await page.locator('#modelBenchmark').click();
    await page.waitForFunction(() => {
      const details = document.querySelector('#modelMetrics').textContent;
      try { return JSON.parse(details).complete === true; } catch (_) { return false; }
    });
    const benchmark = JSON.parse(await page.locator('#modelMetrics').textContent());
    assert.deepEqual(benchmark.modelOnly,{matched:1,compared:2},'raw model mistakes remain failures even though assisted drafts are usable');
    assert.deepEqual(benchmark.sourceChecked,{matched:2,compared:2});
    assert.equal(benchmark.accuracyNotInferred,true);
    assert.equal(benchmark.cases[0].modelOnlyPassed,false);
    assert.equal(benchmark.cases[0].passed,true);
    assert.deepEqual(JSON.parse(benchmark.cases[0].rawModelOutput),recordedFailure);
    assert.equal(await page.locator('[data-synthetic-case="1"]').getAttribute('data-case-state'),'passed');
    assert.ok((await page.locator('[data-synthetic-case="1"] [data-review-stage="model"]').first().textContent()).includes('未通過'));
    assert.ok((await page.locator('[data-synthetic-case="1"] [data-review-stage="assisted"]').textContent()).includes('通過'));
    assert.ok(await page.locator('[data-synthetic-case="1"] .model-only-differences').count());
    assert.equal(await page.evaluate(() => __recordedReplay.calls),3,'each example is processed once through the actual worker');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,'source-check results fit a 320px screen');
    assert.equal(await page.locator('#modelStatus').evaluate(node => node.classList.contains('error')),false);
    assert.deepEqual(writes,[],'the public trial never writes a ledger/account');
    assert.deepEqual(unexpected,[],'no model weight, API, mail or other network request escaped the replay');
    assert.deepEqual(errors,[]);
    await page.locator('#modelUnload').click();
    assert.equal(await page.locator('#modelInput').inputValue(),'');
    assert.equal(await page.locator('#modelMetrics').textContent(),'');
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)),['fambudget.language'],'recorded output is never persisted');
  } finally { await browser.close(); }
});
