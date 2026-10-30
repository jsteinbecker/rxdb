import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompoundName,
  DEFAULT_NAMING,
  fillTemplate,
  parseNaming,
  uniqueName,
  type NamedComponent
} from './compound-naming';

const vanc: NamedComponent = {
  role: 'active',
  ingredients: ['vancomycin'],
  doseUnit: 'mg',
  conc: { n: 50, d: 1 },
  dose: { n: 1250, d: 1 },
  volume: { n: 25, d: 1 }
};
const saline: NamedComponent = {
  role: 'diluent',
  ingredients: ['sodium chloride'],
  doseUnit: 'mg',
  conc: null,
  dose: null,
  volume: { n: 250, d: 1 }
};

test('optional sections drop when a token inside is empty', () => {
  assert.equal(fillTemplate('{a}[ in {b}]', { a: 'x', b: '' }), 'x');
  assert.equal(fillTemplate('{a}[ in {b}]', { a: 'x', b: 'y' }), 'x in y');
});

test('the name grows as components are added', () => {
  assert.equal(buildCompoundName([], DEFAULT_NAMING), 'New compound');
  assert.equal(buildCompoundName([{ ...vanc, dose: null }], DEFAULT_NAMING), 'vancomycin');
  assert.equal(buildCompoundName([vanc], DEFAULT_NAMING), 'vancomycin 1250 mg');
  assert.equal(
    buildCompoundName([vanc, saline], DEFAULT_NAMING),
    'vancomycin 1250 mg in sodium chloride 250 mL'
  );
});

test('custom rules: concentration, case, joiner, total', () => {
  const naming = parseNaming({
    template: '{actives}[ ({total})]',
    active: '{ingredient} {conc}',
    joiner: ' + ',
    letterCase: 'title'
  });
  assert.equal(
    buildCompoundName([vanc, vanc], naming, { n: 275, d: 1 }),
    'Vancomycin 50 mg/mL + Vancomycin 50 mg/mL (275 mL)'
  );
});

test('parseNaming falls back on blank or malformed values', () => {
  assert.deepEqual(parseNaming({ template: '  ', letterCase: 'shout' }), DEFAULT_NAMING);
  assert.deepEqual(parseNaming(null), DEFAULT_NAMING);
});

test('uniqueName suffixes collisions', () => {
  assert.equal(uniqueName('A', new Set()), 'A');
  assert.equal(uniqueName('A', new Set(['A', 'A (2)'])), 'A (3)');
});
