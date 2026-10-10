import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doseFormGroup, moietyKeyOf, packageClassKey, strengthKey } from '../pharm-class-key';

type Ing = {
  name: string;
  unii: string | null;
  kind: 'active' | 'inactive' | 'ionic';
  strength?: string | null;
  moieties?: { name: string; unii: string | null }[];
};

const item = (ingredients: Ing[] | null, opts: { uniis?: string[]; routes?: string[]; doseForm?: string | null } = {}) =>
  ({
    doseForm: opts.doseForm ?? null,
    details: {
      product: { routes: opts.routes ?? [], uniis: opts.uniis ?? [] },
      spl: ingredients
        ? {
            ingredients: ingredients.map((i) => ({
              basis: null,
              strength: null,
              moieties: [],
              productCode: null,
              ...i
            }))
          }
        : null
    }
  }) as never;

test('moietyKey: a salt collapses onto its base', () => {
  const salt = item([{ name: 'LIDOCAINE HYDROCHLORIDE', unii: 'SALT1', kind: 'active', moieties: [{ name: 'LIDOCAINE', unii: 'BASE1' }] }]);
  const base = item([{ name: 'LIDOCAINE', unii: 'BASE1', kind: 'active' }]);
  assert.equal(packageClassKey(salt).moietyKey, 'BASE1');
  assert.equal(packageClassKey(salt).moietyKey, packageClassKey(base).moietyKey);
});

test('moietyKey: two actives sort, inactives are ignored', () => {
  const key = packageClassKey(
    item([
      { name: 'B', unii: 'UB', kind: 'active' },
      { name: 'WATER', unii: 'ZZ', kind: 'inactive' },
      { name: 'A', unii: 'UA', kind: 'active' }
    ])
  );
  assert.equal(key.moietyKey, 'UA|UB');
  assert.equal(key.moietyNames, 'A / B');
});

test('moietyKey: falls back to product uniis, then empty', () => {
  assert.equal(packageClassKey(item(null, { uniis: ['U2', 'U1'] })).moietyKey, 'U1|U2');
  assert.equal(packageClassKey(item(null)).moietyKey, '');
  assert.equal(moietyKeyOf(null), '');
});

test('doseFormGroup maps SPL forms', () => {
  assert.equal(doseFormGroup('INJECTION, SOLUTION', []), 'injectable');
  assert.equal(doseFormGroup('TABLET, FILM COATED', []), 'oral-solid');
  assert.equal(doseFormGroup('CAPSULE', []), 'oral-solid');
  assert.equal(doseFormGroup('SYRUP', []), 'oral-liquid');
  assert.equal(doseFormGroup('PATCH', []), 'transdermal');
  assert.equal(doseFormGroup('AEROSOL, METERED', []), 'inhalation');
});

test('doseFormGroup: route breaks ties for ambiguous forms', () => {
  assert.equal(doseFormGroup('SOLUTION', ['OPHTHALMIC']), 'ophthalmic');
  assert.equal(doseFormGroup('SOLUTION', ['ORAL']), 'oral-liquid');
  assert.equal(doseFormGroup('SOLUTION', ['INTRAVENOUS']), 'injectable');
  assert.equal(doseFormGroup('SUSPENSION', ['OTIC']), 'otic');
  assert.equal(doseFormGroup('CREAM', []), 'topical');
  assert.equal(doseFormGroup('CREAM', ['VAGINAL']), 'vaginal');
});

test('doseFormGroup: unknown is other', () => {
  assert.equal(doseFormGroup('WIDGET', []), 'other');
  assert.equal(doseFormGroup(null, []), 'other');
  assert.equal(doseFormGroup('SOLUTION', []), 'other');
});

test('strengthKey normalizes to an exact rational', () => {
  assert.equal(strengthKey(['20 mg/mL']), '20/1 mg/mL');
  assert.equal(strengthKey(['100 mg/5 mL']), strengthKey(['20 mg/mL']));
  assert.equal(strengthKey(['1 g/50 mL']), strengthKey(['20 mg/mL']));
  assert.equal(strengthKey(['500 mcg']), '1/2 mg/1');
  assert.equal(strengthKey(['0.1 mg']), '1/10 mg/1');
});

test('strengthKey sorts actives and is null if any is unparseable', () => {
  assert.equal(strengthKey(['5 mg', '10 mg']), strengthKey(['10 mg', '5 mg']));
  assert.equal(strengthKey(['10 mg', 'some text']), null);
  assert.equal(strengthKey(['10 mg', null]), null);
  assert.equal(strengthKey([]), null);
});

test('packageClassKey carries routes and strengths of actives', () => {
  const key = packageClassKey(
    item([{ name: 'LIDOCAINE', unii: 'U', kind: 'active', strength: '100 mg/5 mL' }], {
      routes: ['INTRAVENOUS'],
      doseForm: 'SOLUTION'
    })
  );
  assert.deepEqual(key.routes, ['INTRAVENOUS']);
  assert.equal(key.doseFormGroup, 'injectable');
  assert.equal(key.strengthKey, '20/1 mg/mL');
});
