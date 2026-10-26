/* Real imported-value cases. No account, network, model, browser storage or posting. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/statement-parser.js'),'utf8'), context);
const parser = context.StatementParser;
const plain = value => JSON.parse(JSON.stringify(value));
const mapping = {date:0,amount:1,merchant:2,note:3,externalId:4,currency:5,buyerTaxId:6,kind:7};
function rows(data, options={}) { return plain(parser.normalize(data,mapping,{paymentMethod:'credit_card',...options})); }
function code(value, expected, options) { assert.throws(()=>parser.parse(value,options), error=>error.code===expected); }

test('UTF8 BOM, quoted delimiters, escaped quotes and physical multiline rows stay intact',()=>{
  const parsed = plain(parser.parse('\uFEFF日期,金額,店家,備註\r\n\r\n2026/10/26,"NT$ 1,234.50","家人\"\"咖啡","第一行\r\n第二行"\r\n20261027,65,早餐,\r\n'));
  assert.deepEqual(parsed.headers,['日期','金額','店家','備註']);
  assert.deepEqual(parsed.rowNumbers,[3,5]);
  assert.equal(parsed.rows[0][2],'家人"咖啡');
  assert.equal(parsed.rows[0][3],'第一行\n第二行');
  const drafts = plain(parser.normalize(parsed.rows,parser.suggest(parsed.headers),{rowNumbers:parsed.rowNumbers,explicitExpense:true}));
  assert.equal(drafts[0].amount,'1234.50');assert.equal(drafts[0].date,'2026-10-26');assert.equal(drafts[0].rowIndex,3);assert.equal(drafts[0].excluded,false);assert.equal(drafts[0].needsReview,true);
});

test('tab and semicolon files, title preambles and blank delimiter rows can be mapped explicitly',()=>{
  const tab = plain(parser.parse('日期\t金額\t店家\n2026/10/26\t1,234.50\t全聯\n'));
  assert.equal(tab.delimiter,'\t');assert.equal(tab.rows[0][1],'1,234.50');
  const semi = plain(parser.parse('日期;金額;店家\n2026/10/26;65;甲,乙\n'));
  assert.equal(semi.delimiter,';');assert.equal(semi.rows[0][2],'甲,乙');
  const preamble = plain(parser.parse('某銀行交易明細\n,,\n日期,金額,店家\n2026/10/26,65,早餐\n',{headerRow:1}));
  assert.deepEqual(preamble.headers,['日期','金額','店家']);assert.deepEqual(preamble.rowNumbers,[4]);
  const emptyQuotes = plain(parser.parse('"",""\n日期,金額\n2026/10/26,65'));
  assert.deepEqual(emptyQuotes.headers,['日期','金額']);
});

test('unclosed/misplaced quotes and mismatching columns fail without truncating or shifting data',()=>{
  for(const value of ['日期,金額\n2026,"65','日期,金額\n2026,"65"junk','日期,金額\n2026,6"5'])code(value,'CSV_QUOTES');
  code('日期,金額\n2026/10/26,65,多餘欄位','COLUMN_COUNT');
  code('日期,金額,店家\n2026/10/26,65','COLUMN_COUNT');
  code('日期;金額,店家\n2026;65,早餐','DELIMITER_AMBIGUOUS');
  const selected=plain(parser.parse('日期;金額,店家\n2026;65,早餐',{delimiter:';'}));assert.equal(selected.rows[0][1],'65,早餐');
});

test('limits and decoding failures are explicit; exactly500 records are retained',()=>{
  const csv='日期,金額\n'+Array.from({length:500},()=> '2026/10/26,65').join('\n');
  assert.equal(parser.parse(csv).rows.length,500);code(csv+'\n2026/10/27,70','ROW_LIMIT');
  code('', 'EMPTY_FILE');code('   \n\t','EMPTY_FILE');code('日期,金額\n2026,\uFFFD65','ENCODING_INVALID');code('日期,金額\n2026,\u000065','ENCODING_INVALID');
  code('x'.repeat(parser.limits.textCharacters+1),'FILE_LIMIT');
  code('日期,金額\n2026,'+'1'.repeat(4001),'CELL_LIMIT');
  code(Array.from({length:81},(_,i)=> '欄'+i).join(','),'COLUMN_LIMIT');
  code('a,b\nx,y','OPTIONS_INVALID',{delimiter:'|'});
  assert.throws(()=>parser.normalize(Array(501).fill([]),{}),error=>error.code==='ROW_LIMIT');
});

test('header suggestions use only unique aliases and retain index mapping for duplicate labels',()=>{
  const suggested=plain(parser.suggest(['消費日期','交易金額（新臺幣）','特店名稱','備註','交易序號','幣別','買方統一編號','收支別','借方金額','貸方金額']));
  assert.deepEqual(suggested,{date:0,amount:1,kind:7,merchant:2,note:3,externalId:4,currency:5,buyerTaxId:6,debit:8,credit:9});
  const ambiguous=plain(parser.suggest(['日期','消費日期','金額','外幣金額','餘額']));
  assert.equal(ambiguous.date,-1);assert.equal(ambiguous.amount,2);assert.equal(ambiguous.currency,-1);
  assert.equal(parser.suggest(['金額','金額']).amount,-1);
  const nullable=plain(parser.normalize([['2026-10-26','65']],{date:0,amount:1,debit:null,credit:null},{explicitExpense:true}));assert.equal(nullable[0].excluded,false);
});

test('money is normalized exactly to decimal strings without exponent parsing or rounding',()=>{
  const accepted=rows([['2026-10-26','NT$ 1,234.50','咖啡'],['2026-10-26','00065.1','早餐'],['2026-10-26','999999999999.99','大額']],{explicitExpense:true});
  assert.deepEqual(accepted.map(r=>r.amount),['1234.50','65.10','999999999999.99']);assert.ok(accepted.every(r=>r.excluded===false&&typeof r.amount==='string'));
  for(const amount of ['','0','-0','0.00','1.001','1.2300','1e3','0x10','Infinity','NaN','12,34','1.234,56','1,2345','1000000000000','++1','(--1)','NT$ -+65']){
    const draft=rows([['2026-10-26',amount,'測試']],{explicitExpense:true})[0];assert.equal(draft.excluded,true,amount);assert.equal(draft.amount,null,amount);
  }
});

test('Gregorian, ROC, compact and explicit date-order formats validate actual calendar dates',()=>{
  const values=['2026-10-26','2026/10/26','20261026','115/10/26','1151026','民國115年10月26日','2026/10/26 15:34:59'];
  assert.ok(rows(values.map(date=>[date,'65','早餐']),{explicitExpense:true}).every(r=>r.date==='2026-10-26'));
  for(const date of ['10/11/2026','2026-02-29','2026/13/1','2026/1/0','115/2/29','26/10/05','民國000年10月26日','民國301年10月26日','2026/10/26 25:01','45291','2026-10-26T00:00:00Z']){
    const draft=rows([[date,'65','早餐']],{explicitExpense:true})[0];assert.equal(draft.date,'',date);assert.equal(draft.excluded,true,date);
  }
  assert.equal(rows([['10/11/2026','65','甲']],{explicitExpense:true,dateOrder:'MDY'})[0].date,'2026-10-11');
  assert.equal(rows([['10/11/2026','65','甲']],{explicitExpense:true,dateOrder:'DMY'})[0].date,'2026-11-10');
  assert.equal(rows([['2024-02-29','65','甲']],{explicitExpense:true})[0].excluded,false);
});

test('expense direction is never inferred until explicitly selected or mapped',()=>{
  const untouched=rows([['2026-10-26','65','早餐']])[0];assert.equal(untouched.kind,'');assert.equal(untouched.excluded,true);assert.match(untouched.reason,/指定收入或支出/);
  const explicit=rows([['2026-10-26','65','早餐']],{explicitExpense:true})[0];assert.equal(explicit.kind,'expense');assert.equal(explicit.excluded,false);
  const mapped=rows([['2026-10-26','200','獎金','','','','','加薪']],{kindMap:{'加薪':'income'}})[0];assert.equal(mapped.kind,'income');assert.equal(mapped.excluded,false);
  const unknown=rows([['2026-10-26','200','獎金','','','','','加薪']])[0];assert.equal(unknown.kind,'');assert.equal(unknown.excluded,true);
});

test('signed amount direction is a user choice and never silently converts negative values to income',()=>{
  const raw=rows([['2026-10-26','-65','早餐']],{explicitExpense:true})[0];assert.equal(raw.amount,'65.00');assert.equal(raw.excluded,true);assert.equal(raw.kind,'');
  const negativeExpense=rows([['2026-10-26','-65','早餐'],['2026-10-26','200','獎金']],{signedAmount:'negative-expense'});
  assert.deepEqual(negativeExpense.map(r=>[r.kind,r.excluded]),[['expense',false],['income',false]]);
  const positiveExpense=rows([['2026-10-26','NT$ -65','早餐']],{signedAmount:'positive-expense'})[0];assert.equal(positiveExpense.kind,'income');assert.equal(positiveExpense.amount,'65.00');
  const conflicting=rows([['2026-10-26','-65','早餐','','','','','支出']],{signedAmount:'positive-expense'})[0];assert.equal(conflicting.excluded,true);assert.match(conflicting.reason,/不一致/);
});

test('debit-credit statements require explicit column direction and reject ambiguous double amounts',()=>{
  const split={date:0,debit:1,credit:2,merchant:3};
  const data=[['2026-10-26','100','0','早餐'],['2026-10-26','','200','薪資'],['2026-10-26','100','200','不明'],['2026-10-26','-100','','沖銷']];
  const blocked=plain(parser.normalize(data,split));assert.ok(blocked.every(r=>r.excluded));assert.match(blocked[0].reason,/指定借方/);
  const drafts=plain(parser.normalize(data,split,{debitCreditMode:'debit-expense'}));
  assert.deepEqual(drafts.slice(0,2).map(r=>[r.amount,r.kind,r.excluded]),[['100.00','expense',false],['200.00','income',false]]);assert.equal(drafts[2].excluded,true);assert.equal(drafts[3].excluded,true);
  const flipped=plain(parser.normalize(data.slice(0,2),split,{debitCreditMode:'credit-expense'}));assert.deepEqual(flipped.map(r=>r.kind),['income','expense']);
});

test('repayments, transfers and wallet topups are retained but excluded; genuine transfer fees stay expenses',()=>{
  const merchant=['信用卡繳款','繳卡費','信用卡帳單還款','信用卡扣款','街口儲值','悠遊卡加值','轉帳給家人','銀行轉入','Transfer to savings','PAYMENT RECEIVED'];
  const drafts=rows(merchant.map((name,i)=>['2026-10-26',String(50+i),name]),{explicitExpense:true});
  assert.equal(drafts.length,merchant.length);assert.ok(drafts.every(r=>r.excluded&&r.needsReview));
  const fees=rows([['2026-10-26','15','轉帳手續費'],['2026-10-26','15','銀行','transfer fee'],['2026-10-26','499','電信帳單繳款']],{explicitExpense:true});
  assert.ok(fees.every(r=>!r.excluded));
});

test('refunds and cancellations remain review-only even with explicit income mapping',()=>{
  for(const cue of ['退款','退貨','退費','沖銷','折讓','Refund purchase','REVERSAL','chargeback']){
    const draft=rows([['2026-10-26','65',cue,'','','','','收入']])[0];assert.equal(draft.kind,'income');assert.equal(draft.excluded,true);assert.match(draft.reason,/退款或沖銷/);
  }
});

test('foreign and conflicting currency values never become accepted TWD amounts or receive invented exchange rates',()=>{
  const values=[['2026-10-26','US$ 12.50','咖啡'],['2026-10-26','12.50','咖啡','','','USD'],['2026-10-26','USD 12.50','咖啡','','','TWD'],['2026-10-26','NT$ 65','早餐','','','JPY']];
  const drafts=rows(values,{explicitExpense:true});assert.ok(drafts.every(r=>r.excluded));assert.deepEqual(drafts.map(r=>r.amount),['12.50','12.50','12.50','65.00']);assert.equal(drafts[2].currency,'USD');
  assert.equal(rows([['2026-10-26','NT$ 65','早餐','','','新臺幣']],{explicitExpense:true})[0].excluded,false);
  assert.equal(rows([['2026-10-26','65','早餐','','','不明']],{explicitExpense:true})[0].excluded,true);
  for(const amount of ['¥ 100','￥100']){const yen=rows([['2026-10-26',amount,'店家']],{explicitExpense:true})[0];assert.equal(yen.currency,'');assert.equal(yen.excluded,true);}
  const yuan=rows([['2026-10-26','¥100','店家','','','CNY']],{explicitExpense:true})[0];assert.equal(yuan.currency,'CNY');assert.equal(yuan.excluded,true);
});

test('buyer tax ID remains a string with leading zeros, and formula/HTML text is never evaluated',()=>{
  const formula='=HYPERLINK("https://example.invalid","click")', html='<img src=x onerror=alert(1)>';
  const draft=rows([['2026-10-26','65',html,formula,'','','01234567']],{explicitExpense:true})[0];
  assert.equal(draft.buyerTaxId,'01234567');assert.equal(draft.merchant,html);assert.equal(draft.note,formula);assert.equal(draft.excluded,false);
  for(const tax of ['1234567','123456789','1234A678'])assert.equal(rows([['2026-10-26','65','店家','','','',tax]],{explicitExpense:true})[0].excluded,true);
  assert.equal(rows([['2026-10-26','65','店家','a'.repeat(501)]],{explicitExpense:true})[0].excluded,true);
});

test('duplicate candidates are not dropped, local fingerprints are canonical, and same-count changed content is observable',()=>{
  const data=[['2026-10-26','65','咖啡'],['2026-10-26','65.00','咖啡'],['2026-10-26','65','另一家'],['2026-10-26','65','咖啡','','provider-order-1'],['2026-10-26','120','不同金額','','provider-order-1']];
  const drafts=rows(data,{explicitExpense:true,provider:'fixture-bank'});assert.equal(drafts.length,5);assert.equal(drafts[0].possibleDuplicate,false);assert.equal(drafts[1].possibleDuplicate,true);assert.equal(drafts[1].excluded,true);assert.equal(drafts[2].possibleDuplicate,false);assert.equal(drafts[4].possibleDuplicate,true);
  assert.equal(drafts[0].fingerprint,drafts[1].fingerprint);assert.notEqual(drafts[0].fingerprint,drafts[2].fingerprint);
  const changed=rows([['2026-10-26','66','咖啡']],{explicitExpense:true,provider:'fixture-bank'})[0];assert.notEqual(changed.fingerprint,drafts[0].fingerprint);
  assert.notEqual(rows(data.slice(0,1),{explicitExpense:true,provider:'other-bank'})[0].fingerprint,drafts[0].fingerprint);
});
