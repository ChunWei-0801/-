const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/calculator.js'), 'utf8'), context);
const calculate = context.FloatingCalculator.evaluate;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≠ ${expected}`);

test('scientific precedence, right-associative powers, unary signs, and percentages', () => {
  assert.equal(calculate('2+3*4'), 14);
  assert.equal(calculate('(2+3)*4'), 20);
  assert.equal(calculate('2^3^2'), 512);
  assert.equal(calculate('-2^2'), -4);
  assert.equal(calculate('(-2)^2'), 4);
  assert.equal(calculate('2^-3'), .125);
  assert.equal(calculate('200*15%'), 30);
  assert.equal(calculate('10 mod 3'), 1);
  assert.equal(calculate('3!+0!'), 7);
  assert.equal(calculate('1e-5*100000'), 1);
  assert.equal(calculate('2(3+4)'), 14);
  near(calculate('2pi'), Math.PI * 2);
  assert.equal(calculate('5×(8−2)÷3'), 10);
});

test('DEG/RAD functions, inverse trigonometry, roots, exponentials, and logs', () => {
  near(calculate('sin(30)'), .5);
  near(calculate('cos(60)'), .5);
  near(calculate('tan(45)'), 1);
  near(calculate('asin(.5)'), 30);
  near(calculate('acos(.5)'), 60);
  near(calculate('atan(1)'), 45);
  near(calculate('sin(pi/2)', {mode:'RAD'}), 1);
  near(calculate('asin(1)', {mode:'RAD'}), Math.PI / 2);
  near(calculate('ln(e)+log(1000)+sqrt(16)+exp(0)'), 9);
  assert.equal(calculate('abs(-5)+ceil(1.1)+floor(1.9)+round(1.5)'), 10);
});

test('malformed, injected, excessive and nonfinite inputs are rejected', () => {
  const invalid = ['', '2+', '(1+2', 'sin 2', '2 3', '1,2', 'Math.sin(1)', 'alert(1)', 'constructor(1)', '__proto__', 'globalThis', '1;2', '2**3'];
  for (const expression of invalid) assert.throws(() => calculate(expression), undefined, expression);
  for (const expression of ['1/0', '0/0', '5 mod 0', 'sqrt(-1)', 'log(0)', 'ln(-1)', 'asin(2)', 'tan(90)', '(-1)^.5', '171!', '2.5!', 'exp(1000)', '1e309']) {
    assert.throws(() => calculate(expression), error => error.code === 'domain', expression);
  }
  assert.throws(() => calculate('1'.repeat(257)), error => error.code === 'complex');
  assert.throws(() => calculate('('.repeat(45) + '1' + ')'.repeat(45)), error => error.code === 'complex');
  assert.throws(() => calculate('-'.repeat(45) + '1'), error => error.code === 'complex');
});
