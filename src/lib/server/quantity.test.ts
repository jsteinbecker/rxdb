import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalUnitLabel,
  convertQuantity,
  formatQuantity,
  mixedParts,
  parseQuantity,
  quantityDecimal
} from '../quantity';
import { parseRational } from '../rational';

test('numbers parse as decimals, fractions and mixed numbers', () => {
  assert.deepEqual(parseRational('131 11/19'), { n: 2500, d: 19 });
  assert.deepEqual(parseRational('1500/11.4'), { n: 2500, d: 19 });
  assert.deepEqual(parseRational('.5'), { n: 1, d: 2 });
  assert.deepEqual(parseRational('1,000'), { n: 1000, d: 1 });
  assert.equal(parseRational('131 22/19'), null);
  assert.equal(parseRational('131 11/'), null);
});

test('units, combination units and percents are read with their kind', () => {
  const conc = parseQuantity('131 11/19 mg/mL')!;
  assert.deepEqual(conc.rational, { n: 2500, d: 19 });
  assert.equal(conc.unit, 'mg/mL');
  assert.equal(conc.kind, 'ratio');
  assert.equal(parseQuantity('20,000 UNT/vial')!.unit, 'unit/vial');
  assert.equal(parseQuantity('0.9%')!.kind, 'percent');
  assert.equal(parseQuantity('10 mL')!.kind, 'volume');
  assert.equal(parseQuantity('1.5 G')!.unit, 'g');
  assert.equal(parseQuantity('150')!.kind, 'number');
  assert.deepEqual(parseQuantity('250 mg/5 mL')!.rational, { n: 50, d: 1 });
  assert.equal(parseQuantity('mg'), null);
  assert.equal(parseQuantity(''), null);
});

test('conversions stay exact and refuse mismatched dimensions', () => {
  const as = (text: string, unit: string) => {
    const converted = convertQuantity(parseQuantity(text)!, unit);
    return converted && formatQuantity(converted);
  };
  assert.equal(as('1.5 g', 'mg'), '1500 mg');
  assert.equal(as('0.9%', 'mg/mL'), '9 mg/mL');
  assert.equal(as('1 g/L', 'mg/mL'), '1 mg/mL');
  assert.equal(as('9 mg/mL', '%'), '0.9%');
  assert.equal(as('12', 'mL'), '12 mL');
  assert.equal(as('10 mL', 'mg'), null);
  assert.equal(as('10 mg', 'mg/mL'), null);
  assert.equal(canonicalUnitLabel('MG/ML'), 'mg/mL');
});

test('display splits into a stacked remainder only when the division does not come out', () => {
  assert.deepEqual(mixedParts({ n: 2500, d: 19 }), {
    whole: '131',
    numerator: '11',
    denominator: '19'
  });
  assert.deepEqual(mixedParts({ n: 9, d: 10 }), {
    whole: '0.9',
    numerator: null,
    denominator: null
  });
  assert.equal(quantityDecimal(parseQuantity('22 1/2')!), '22.5');
  assert.equal(quantityDecimal(parseQuantity('2500/19')!), String(2500 / 19));
});
