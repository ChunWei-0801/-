/* Browser regressions for complete financial totals, signed charts and private
   owner scope. Uses isolated response fixtures, never production accounts. */
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const asset = name => path.join(__dirname, '..', name);
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE || undefined, args:['--no-sandbox']});
  const errors = [];
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}main{box-sizing:border-box;width:100%;padding:16px}.card{border:1px solid #ddd;border-radius:20px}.btn{padding:10px}*{box-sizing:border-box}</style><main id="root"></main>');
    await page.addStyleTag({path:asset('css/tokens.css')});
    await page.addStyleTag({path:asset('css/report-charts.css')});
    await page.addStyleTag({path:asset('css/financial-reports.css')});
    await page.evaluate(() => {
      const OriginalDate = Date;
      window.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-10-18T05:00:00Z'])); } static now() { return new OriginalDate('2026-10-18T05:00:00Z').getTime(); } };
      const tx = (id,kind,amount,date='2026-10-18',cat='food') => ({id:String(id),user:'owner',kind,amount,date,cat,catName:cat==='salary'?'薪水':cat==='transfer'?'轉帳':'餐飲'});
      const rows = Array.from({length:200}, (_,index) => tx(index+1,'expense',.1));
      rows.push(tx(201,'income',12.35,'2026-10-17','salary'),tx(202,'income',12.35,'2026-10-17','salary'),tx(203,'transfer',1000,'2026-10-18','transfer'),tx(204,'transfer',1000,'2026-10-18','transfer'),tx(205,'expense',.2));
      window.fixture = {rows,requests:[],mode:'normal',pending:[],changeRequests:0};
      window.API = {transactions: async query => {
        fixture.requests.push({...query});
        if (fixture.mode === 'deferred') return new Promise(resolve => fixture.pending.push({query,resolve}));
        if (fixture.mode === 'tooMany') return {transactions:[],total:20001};
        const filtered = fixture.rows.filter(row => row.date >= query.from && row.date <= query.to);
        if (fixture.mode === 'foreign') return {transactions:[{...filtered[0],user:'different-user'}],total:1};
        if (fixture.mode === 'duplicate' && query.page>1) return {transactions:filtered.slice(0,5),total:filtered.length};
        if (fixture.mode === 'changing' && query.page>1) return {transactions:filtered.slice(200),total:filtered.length+1};
        return {transactions:filtered.slice((query.page-1)*200, query.page*200),total:filtered.length};
      }};
      window.testMount = null;
    });
    await page.addScriptTag({path:asset('js/report-charts.js')});
    await page.addScriptTag({path:asset('js/financial-reports.js')});
    await page.evaluate(() => { window.testMount = FinancialReports.mount(document.getElementById('root'),{id:'owner'}); });
    await page.getByText('已完整讀取 205 筆紀錄，其中 203 筆收入／支出列入統計。',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(() => fixture.requests),[
      {userId:'owner',from:'2026-10-01',to:'2026-10-31',page:1},
      {userId:'owner',from:'2026-10-01',to:'2026-10-31',page:2}
    ]);
    assert.deepEqual(await page.locator('.financial-reports__total dd').allTextContents(),['NT$ 24.7','NT$ 20.2','NT$ 4.5'],'Totals include every page, exclude transfers and avoid floating point artifacts');
    assert.equal(await page.locator('[data-report-chart] tbody tr').count(),31,'A full month includes every actual date');
    const count = await page.evaluate(() => fixture.requests.length);
    await page.locator('[data-report-metric]').selectOption('net');
    await page.locator('[data-report-style]').selectOption('pie');
    await page.getByText('數值含有負數，改用正負長條圖呈現；完整數值保留於表格。',{exact:true}).waitFor();
    assert.equal(await page.locator('.report-chart__bar.is-negative').count(),1);
    assert.equal(await page.evaluate(() => fixture.requests.length),count,'Style and metric changes do not refetch');
    await page.locator('summary').click();
    assert.equal(await page.locator('[data-report-chart] tbody tr').count(),31);
    assert.ok((await page.locator('svg').getAttribute('aria-labelledby')).includes('-title'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth>innerWidth),false,'Report fits a 390px viewport');
    await page.locator('[data-report-period]').selectOption('day');
    await page.getByText('已完整讀取 203 筆紀錄，其中 201 筆收入／支出列入統計。',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-report-date]').inputValue(),'2026-10-18');
    assert.equal(await page.locator('[data-report-chart] tbody tr').count(),1,'Daily charts aggregate actual categories, without invented hours');
    assert.match(await page.locator('[data-report-chart] tbody').textContent(),/餐飲.*-20\.2/s);
    await page.locator('[data-report-period]').selectOption('year');
    await page.getByText('已完整讀取 205 筆紀錄，其中 203 筆收入／支出列入統計。',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-report-chart] tbody tr').count(),12);
    assert.equal(await page.locator('[data-report-date]').inputValue(),'2026');
    await page.locator('[data-report-period]').selectOption('month');
    await page.locator('[data-report-date]').fill('2024-02');
    await page.locator('[data-report-date]').dispatchEvent('change');
    await page.getByText('已完整讀取 0 筆紀錄，其中 0 筆收入／支出列入統計。',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-report-chart] tbody tr').count(),29,'Leap month has 29 actual dates');
    assert.equal(await page.evaluate(() => fixture.requests.at(-1).to),'2024-02-29');

    // Reject incomplete or inconsistent pagination without showing any totals.
    await page.locator('[data-report-date]').fill('2026-10');
    await page.evaluate(() => { fixture.mode='changing'; });
    await page.locator('[data-report-date]').dispatchEvent('change');
    await page.getByRole('alert').getByText('讀取期間記帳內容有變更',{exact:false}).waitFor();
    assert.equal(await page.locator('.financial-reports__total').count(),0);
    await page.evaluate(() => { fixture.mode='duplicate'; });
    await page.locator('[data-report-refresh]').click();
    await page.getByRole('alert').getByText('讀取期間記帳內容有變更',{exact:false}).waitFor();
    assert.equal(await page.locator('.financial-reports__total').count(),0);
    await page.evaluate(() => { fixture.mode='tooMany'; });
    await page.locator('[data-report-refresh]').click();
    await page.getByRole('alert').getByText('這段期間超過 20,000 筆紀錄。',{exact:false}).waitFor();
    assert.equal(await page.locator('.financial-reports__total').count(),0);
    await page.evaluate(() => { fixture.mode='foreign'; });
    await page.locator('[data-report-refresh]').click();
    await page.getByRole('alert').getByText('記帳資料不完整，請重新讀取。',{exact:true}).waitFor();
    assert.equal(await page.locator('.financial-reports__total').count(),0,'Out of scope data is never displayed');

    // A cancelled or unmounted fetch never requests its next page or paints.
    await page.evaluate(() => { fixture.mode='deferred'; });
    await page.locator('[data-report-refresh]').click();
    await page.waitForFunction(() => fixture.pending.length===1);
    await page.locator('[data-report-cancel]').click();
    const requestsBefore = await page.evaluate(() => fixture.requests.length);
    await page.evaluate(() => { const pending=fixture.pending.shift(); pending.resolve({transactions:fixture.rows.slice(0,200),total:205}); });
    await page.getByText('已停止讀取。按「更新報表」可重新讀取完整資料。',{exact:true}).waitFor();
    assert.equal(await page.evaluate(() => fixture.requests.length),requestsBefore);
    assert.equal(await page.locator('.financial-reports__total').count(),0);
    await page.locator('[data-report-refresh]').click();
    await page.waitForFunction(() => fixture.pending.length===1);
    await page.evaluate(() => { testMount(); const pending=fixture.pending.shift(); pending.resolve({transactions:fixture.rows.slice(0,200),total:205}); document.getElementById('root').textContent='Another route'; });
    assert.equal(await page.locator('#root').textContent(),'Another route');

    // SVG construction escapes labels and keeps signed / empty data truthful.
    await page.evaluate(() => { ReportCharts.render(document.getElementById('root'),{rows:[{label:'<img src=x onerror=alert(1)>',value:-5},{label:'收入',value:3}],type:'pie',title:'<script>bad</script>',unit:'元'}); });
    assert.equal(await page.locator('#root img,#root script').count(),0);
    assert.equal(await page.locator('.report-chart__bar.is-negative').count(),1);
    assert.equal(await page.locator('tbody tr').count(),2);
    assert.match(await page.locator('tbody').textContent(),/-5/);
    await page.evaluate(() => { ReportCharts.render(document.getElementById('root'),{rows:[{label:'零',value:0}],type:'pie'}); });
    await page.getByText('所有數值皆為零，目前沒有圓餅比例可顯示。',{exact:true}).waitFor();
    assert.equal(await page.locator('.report-chart__slice').count(),0);
    await page.evaluate(() => { ReportCharts.render(document.getElementById('root'),{rows:[{label:'有效',value:1},{label:'缺值',value:null}],type:'table'}); });
    assert.equal(await page.locator('tbody tr').count(),1);
    await page.getByText('部分紀錄沒有有效數值，未繪入圖表。',{exact:true}).waitFor();
    await page.evaluate(() => { ReportCharts.render(document.getElementById('root'),{rows:[],type:'line'}); });
    await page.getByText('這段期間還沒有紀錄。',{exact:true}).waitFor();
    assert.equal(await page.locator('svg').count(),0);
    assert.deepEqual(errors,[]);
    console.log('Flexible reports: pagination, owner scope, cents, all periods, signed pie fallback, cancellation, escaping, accessible data and mobile checks passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
