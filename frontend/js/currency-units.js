/* Currency accounting units. The existing savings jar uses whole TWD only. */
(function (root) {
  'use strict';
  var fallback = {TWD:0,JPY:0,KRW:0,VND:0,CLP:0,USD:2,EUR:2,GBP:2,CNY:2,HKD:2,AUD:2,CAD:2,CHF:2,SGD:2,MYR:2,THB:2,INR:2,KWD:3,BHD:3,JOD:3,OMR:3,TND:3};
  var supported = null;
  try { if (typeof Intl.supportedValuesOf === 'function') supported = new Set(Intl.supportedValuesOf('currency')); } catch (_) {}
  function info(code) {
    if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code) || (supported ? !supported.has(code) : !Object.prototype.hasOwnProperty.call(fallback,code))) return null;
    var decimals;
    try { decimals = code === 'TWD' ? 0 : new Intl.NumberFormat('en',{style:'currency',currency:code}).resolvedOptions().maximumFractionDigits; }
    catch (_) { decimals = fallback[code]; }
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) return null;
    var unit = decimals ? '0.'+'0'.repeat(decimals-1)+'1' : '1';
    return Object.freeze({code:code,decimals:decimals,step:unit,min:unit});
  }
  function toMinor(value,code) {
    var unit = info(code);
    if (!unit || !['string','number'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) return null;
    var text = String(value).trim();
    if (!/^(?:\d{1,20}(?:\.\d{0,20})?|\.\d{1,20})$/.test(text)) return null;
    var parts=text.split('.'), whole=parts[0]||'0', fraction=(parts[1]||'').replace(/0+$/,'');
    if (fraction.length > unit.decimals) return null;
    return BigInt(whole + fraction.padEnd(unit.decimals,'0')).toString();
  }
  function valid(value,code,options) {
    var minor=toMinor(value,code);
    return minor !== null && (options && options.allowZero ? BigInt(minor)>=0n : BigInt(minor)>0n);
  }
  function amount(value,code,options) {
    if (!valid(value,code,options)) return null;
    var minor=toMinor(value,code), number=Number(minor);
    if (!Number.isSafeInteger(number)) return null;
    return number / Math.pow(10,info(code).decimals);
  }
  function add(left,right,code) {
    var a=toMinor(left,code),b=toMinor(right,code),unit=info(code);
    if(a===null||b===null||!unit)return null;
    var sum=Number(BigInt(a)+BigInt(b));
    return Number.isSafeInteger(sum)?sum/Math.pow(10,unit.decimals):null;
  }
  root.CurrencyUnits=Object.freeze({info:info,toMinor:toMinor,valid:valid,amount:amount,add:add});
})(typeof window !== 'undefined' ? window : globalThis);
