/* Exact accounting-unit contracts; no currency conversion is performed. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context=vm.createContext({Intl});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/currency-units.js'),'utf8'),context);
const unit=context.CurrencyUnits;

test('TWD savings is whole yuan while USD, JPY and KWD retain their genuine accounting precision',()=>{
  for(const [code,step,decimals] of [['TWD','1',0],['USD','0.01',2],['JPY','1',0],['KWD','0.001',3]]){
    assert.equal(unit.info(code).step,step);assert.equal(unit.info(code).decimals,decimals);
  }
  for(const [code,value,valid] of [['TWD','0.1',false],['TWD','0',false],['TWD','1',true],['TWD','1.00',true],['USD','0.01',true],['USD','0.001',false],['JPY','0.5',false],['JPY','1',true],['KWD','0.001',true],['KWD','0.0001',false]])assert.equal(unit.valid(value,code),valid,code+' '+value);
  assert.equal(unit.valid('0','TWD',{allowZero:true}),true);
});

test('minor units and addition use decimal strings rather than floating point modulo or silent rounding',()=>{
  assert.equal(unit.toMinor('0.10','USD'),'10');assert.equal(unit.toMinor('1.2300','USD'),'123');
  assert.equal(unit.toMinor('999999999999','TWD'),'999999999999');
  assert.equal(unit.add('0.1','0.2','USD'),0.3);assert.equal(unit.add('0.001','0.002','KWD'),0.003);
  assert.equal(unit.add('12.34','1','TWD'),null,'legacy decimals are not rounded by a deposit');
  assert.equal(unit.amount('1.234','USD'),null);assert.equal(unit.amount('0','TWD',{allowZero:true}),0);
});

test('unsupported codes, non-money syntax and nonfinite values never become a valid amount',()=>{
  for(const code of ['ABC','usd','US','',null])assert.equal(unit.info(code),null);
  for(const value of ['','-1','+1','1e2','1,000','0x10','Infinity',Infinity,NaN,true,null])assert.equal(unit.toMinor(value,'USD'),null,String(value));
  assert.equal(unit.amount('99999999999999999999','USD'),null,'unsafe numeric conversion is rejected');
});
