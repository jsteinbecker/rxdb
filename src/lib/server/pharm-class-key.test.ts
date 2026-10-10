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

test('moietyKey: an SPL with no ingredients falls back to product uniis', () => {
  assert.equal(packageClassKey(item([], { uniis: ['U2', 'U1'] })).moietyKey, 'U1|U2');
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

const one = (strength: string | null, moiety = 'M') => ({ moiety, strength });

test('strengthKey normalizes to an exact rational', () => {
  assert.equal(strengthKey([one('20 mg/mL')]), '20/1 mg/mL');
  assert.equal(strengthKey([one('100 mg/5 mL')]), strengthKey([one('20 mg/mL')]));
  assert.equal(strengthKey([one('1 g/50 mL')]), strengthKey([one('20 mg/mL')]));
  assert.equal(strengthKey([one('500 mcg')]), '1/2 mg/1');
  assert.equal(strengthKey([one('0.1 mg')]), '1/10 mg/1');
});

test('strengthKey pairs each strength with its moiety and is order independent', () => {
  assert.equal(
    strengthKey([one('5 mg', 'A'), one('10 mg', 'B')]),
    strengthKey([one('10 mg', 'B'), one('5 mg', 'A')])
  );
  assert.equal(strengthKey([one('5 mg', 'A'), one('10 mg', 'B')]), 'A=5/1 mg/1|B=10/1 mg/1');
});

test('strengthKey tells 5/10 from 10/5 of the same pair', () => {
  assert.notEqual(
    strengthKey([one('5 mg', 'A'), one('10 mg', 'B')]),
    strengthKey([one('10 mg', 'A'), one('5 mg', 'B')])
  );
});

test('strengthKey is null if any is unparseable', () => {
  assert.equal(strengthKey([one('10 mg', 'A'), one('some text', 'B')]), null);
  assert.equal(strengthKey([one('10 mg', 'A'), one(null, 'B')]), null);
  assert.equal(strengthKey([]), null);
});

test('packageClassKey: combination strengths keep their ingredient', () => {
  const combo = (a: string, b: string) =>
    packageClassKey(
      item([
        { name: 'A', unii: 'UA', kind: 'active', strength: a },
        { name: 'B', unii: 'UB', kind: 'active', strength: b }
      ])
    ).strengthKey;
  assert.notEqual(combo('5 mg', '10 mg'), combo('10 mg', '5 mg'));
  assert.equal(combo('5 mg', '10 mg'), 'UA=5/1 mg/1|UB=10/1 mg/1');
});

test('doseFormGroup: implants are not oral solids', () => {
  assert.equal(doseFormGroup('PELLET, IMPLANTABLE', ['SUBCUTANEOUS']), 'other');
  assert.equal(doseFormGroup('IMPLANT', ['SUBCUTANEOUS']), 'other');
  assert.equal(doseFormGroup('PELLET', ['SUBCUTANEOUS']), 'other');
  assert.equal(doseFormGroup('PELLET', ['ORAL']), 'oral-solid');
});

test('doseFormGroup: films and oral gels', () => {
  assert.equal(doseFormGroup('FILM', ['ORAL']), 'oral-solid');
  assert.equal(doseFormGroup('FILM, SOLUBLE', ['BUCCAL']), 'oral-solid');
  assert.equal(doseFormGroup('FILM', ['OPHTHALMIC']), 'ophthalmic');
  assert.equal(doseFormGroup('GEL', ['ORAL']), 'other');
  assert.equal(doseFormGroup('GEL', ['TOPICAL']), 'topical');
});

test('doseFormGroup: kits follow the route', () => {
  assert.equal(doseFormGroup('KIT', ['INTRAVENOUS']), 'injectable');
  assert.equal(doseFormGroup('KIT', ['ORAL']), 'other');
  assert.equal(doseFormGroup('KIT', ['TOPICAL']), 'topical');
  assert.equal(doseFormGroup('KIT', []), 'other');
});

test('doseFormGroup: less common routes', () => {
  assert.equal(doseFormGroup('SOLUTION', ['INTRAVESICAL']), 'other');
  assert.equal(doseFormGroup('GEL', ['DENTAL']), 'other');
  assert.equal(doseFormGroup('SOLUTION', ['INTRACAVERNOUS']), 'injectable');
  assert.equal(doseFormGroup('SOLUTION', ['PERCUTANEOUS']), 'injectable');
  assert.equal(doseFormGroup('SOLUTION', ['INTRALESIONAL']), 'injectable');
  assert.equal(doseFormGroup('SOLUTION', ['INTRAOCULAR']), 'injectable');
  assert.equal(doseFormGroup('CAPSULE', ['RESPIRATORY (INHALATION)']), 'inhalation');
});

test('doseFormGroup: suppositories follow the route', () => {
  assert.equal(doseFormGroup('SUPPOSITORY', ['RECTAL']), 'rectal');
  assert.equal(doseFormGroup('SUPPOSITORY', ['VAGINAL']), 'vaginal');
  assert.equal(doseFormGroup('SUPPOSITORY', []), 'rectal');
  assert.equal(doseFormGroup('ENEMA', ['RECTAL']), 'rectal');
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
