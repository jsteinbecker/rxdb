import assert from 'node:assert/strict';
import test from 'node:test';
import type { PackageClassKey } from '../pharm-class-key';
import { resolvePharmClasses, type PharmClassRule } from '../pharm-class-rules';

const key: PackageClassKey = {
  moietyKey: 'U1',
  moietyNames: 'drug',
  doseFormGroup: 'oral-solid',
  routes: ['ORAL'],
  strengthKey: '5/1 mg/1'
};

const rule = (id: string, over: Partial<PharmClassRule>): PharmClassRule => ({
  id,
  moietyKey: 'U1',
  doseFormGroup: null,
  route: null,
  strengthKey: null,
  mode: 'replace',
  classes: [],
  ...over
});

test('no rules leaves the source unchanged', () => {
  const out = resolvePharmClasses(['S'], key, []);
  assert.deepEqual(out.classes, ['S']);
  assert.deepEqual(out.source, ['S']);
  assert.deepEqual(out.applied, []);
});

test('moiety-only replace', () => {
  const out = resolvePharmClasses(['S'], key, [rule('a', { classes: ['A'] })]);
  assert.deepEqual(out.classes, ['A']);
  assert.deepEqual(out.applied, [{ ruleId: 'a', mode: 'replace', classes: ['A'] }]);
});

test('form-level replace beats moiety-only replace', () => {
  const out = resolvePharmClasses(['S'], key, [
    rule('b', { doseFormGroup: 'oral-solid', classes: ['B'] }),
    rule('a', { classes: ['A'] })
  ]);
  assert.deepEqual(out.classes, ['B']);
});

test('form-level replace beats moiety-only add', () => {
  const out = resolvePharmClasses(['S'], key, [
    rule('c', { mode: 'add', classes: ['C'] }),
    rule('b', { doseFormGroup: 'oral-solid', classes: ['B'] })
  ]);
  assert.deepEqual(out.classes, ['B']);
});

test('strength-level add stacks on form-level replace', () => {
  const out = resolvePharmClasses(['S'], key, [
    rule('d', { strengthKey: '5/1 mg/1', mode: 'add', classes: ['D'] }),
    rule('b', { doseFormGroup: 'oral-solid', classes: ['B'] })
  ]);
  assert.deepEqual(out.classes, ['B', 'D']);
});

test('suppress removes a source class; add keeps order and de-duplicates', () => {
  const out = resolvePharmClasses(['S', 'T'], key, [
    rule('x', { mode: 'suppress', classes: ['S'] }),
    rule('y', { doseFormGroup: 'oral-solid', mode: 'add', classes: ['T', 'N'] })
  ]);
  assert.deepEqual(out.classes, ['T', 'N']);
});

test('a different form group does not match', () => {
  const out = resolvePharmClasses(['S'], key, [rule('a', { doseFormGroup: 'injectable', classes: ['A'] })]);
  assert.deepEqual(out.classes, ['S']);
  assert.deepEqual(out.applied, []);
});

test('route matches when among the package routes', () => {
  const hit = resolvePharmClasses(['S'], key, [rule('a', { route: 'ORAL', classes: ['A'] })]);
  assert.deepEqual(hit.classes, ['A']);
  const miss = resolvePharmClasses(['S'], key, [rule('a', { route: 'RECTAL', classes: ['A'] })]);
  assert.deepEqual(miss.classes, ['S']);
});

test('a single-ingredient rule does not match a combination key', () => {
  const combo = { ...key, moietyKey: 'U1|U2' };
  const out = resolvePharmClasses(['S'], combo, [rule('a', { classes: ['A'] })]);
  assert.deepEqual(out.classes, ['S']);
});

test('a strength rule never matches a null strengthKey', () => {
  const out = resolvePharmClasses(['S'], { ...key, strengthKey: null }, [
    rule('a', { strengthKey: '5/1 mg/1', classes: ['A'] })
  ]);
  assert.deepEqual(out.classes, ['S']);
});
