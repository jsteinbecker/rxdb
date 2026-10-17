import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyLocalConcepts,
  editActionLabel,
  resolveLocal,
  type LocalConceptRecord,
  type LocalConceptView
} from '../local-concept-view.ts';
import type { LocalIngredient } from '../local-concept.ts';

const ing: LocalIngredient = {
  substanceUnii: 'U1',
  substanceName: 'Leucine',
  basis: 'as_labeled',
  moietyUnii: null,
  moietyName: null,
  strengthNumMag: '14',
  strengthNumUom: 'mg',
  strengthDenMag: '1',
  strengthDenUom: 'mL'
};

const scd: LocalConceptRecord = {
  id: 'id-1',
  code: 'LC000001',
  tty: 'SCD',
  name: 'leucine 14 MG/ML Injectable Solution',
  doseForm: 'Injectable Solution',
  brandName: null,
  ingredients: [ing],
  ionicContent: null,
  supersedes: { rxcui: '1189639', name: null, mappingId: 'm1' }
};

describe('resolveLocal', () => {
  it('direct mapping is not derived and keeps the record name', () => {
    const out = resolveLocal(['1189639'], new Map([['1189639', scd]]), new Map(), new Map());
    const v = out.get('1189639')!;
    assert.equal(v.derived, false);
    assert.equal(v.name, scd.name);
    assert.equal(v.tty, 'SCD');
    assert.deepEqual(v.supersedes, { rxcui: '1189639', name: null });
    assert.equal('mappingId' in v.supersedes, false);
  });

  it('derives an SBD from the counterpart SCD', () => {
    const out = resolveLocal(
      ['1189640'],
      new Map([['1189639', scd]]),
      new Map([['1189640', '1189639']]),
      new Map([['1189640', 'TrophAmine']])
    );
    const v = out.get('1189640')!;
    assert.equal(v.tty, 'SBD');
    assert.equal(v.derived, true);
    assert.equal(v.brandName, 'TrophAmine');
    assert.equal(v.supersedes.rxcui, '1189640');
    assert.ok(v.name.endsWith(' [TrophAmine]'));
    assert.deepEqual(v.ingredients, scd.ingredients);
    assert.equal(v.code, scd.code);
    assert.equal(v.id, scd.id);
  });

  it('direct SBD mapping wins over derived', () => {
    const sbd: LocalConceptRecord = {
      ...scd,
      id: 'id-2',
      code: 'LC000002',
      tty: 'SBD',
      name: 'direct',
      brandName: 'TrophAmine',
      supersedes: { rxcui: '1189640', name: null, mappingId: 'm2' }
    };
    const out = resolveLocal(
      ['1189640'],
      new Map([
        ['1189640', sbd],
        ['1189639', scd]
      ]),
      new Map([['1189640', '1189639']]),
      new Map([['1189640', 'TrophAmine']])
    );
    assert.equal(out.get('1189640')!.derived, false);
    assert.equal(out.get('1189640')!.name, 'direct');
  });

  it('unmapped rxcui is absent', () => {
    const out = resolveLocal(['5'], new Map(), new Map([['5', '6']]), new Map([['5', 'X']]));
    assert.equal(out.has('5'), false);
  });
});

describe('applyLocalConcepts', () => {
  const item = (rxcui: string | null) => ({
    id: rxcui ?? 'none',
    details: { rxnav: { rxcui, extra: { a: 1 } } }
  });

  it('loads once with de-duplicated rxcuis and attaches views', async () => {
    const calls: string[][] = [];
    const view = {
      ...scd,
      supersedes: { rxcui: '1', name: null },
      derived: false
    } as LocalConceptView;
    const items = [item('1'), item('1'), item('2'), { id: 'x', details: null }];
    const before = structuredClone(items);
    const out = await applyLocalConcepts(items as never, async (r) => {
      calls.push(r);
      return new Map([['1', view]]);
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['1', '2']);
    assert.equal(out[0].localConcept, view);
    assert.equal(out[1].localConcept, view);
    assert.equal(out[2].localConcept, undefined);
    assert.notEqual(out[0], items[0]);
    assert.deepEqual(out[0].details, items[0].details);
    assert.deepEqual(items, before);
  });

  it('makes no call when no item has an rxcui', async () => {
    let called = 0;
    const items = [item(null), { id: 'x', details: null }];
    const out = await applyLocalConcepts(items as never, async () => {
      called++;
      return new Map();
    });
    assert.equal(called, 0);
    assert.equal(out.length, 2);
  });
});

describe('editActionLabel', () => {
  it('names the SCD for a derived SBD view and the concept otherwise', () => {
    assert.equal(editActionLabel({ derived: true }), 'Edit local SCD…');
    assert.equal(editActionLabel({ derived: false }), 'Edit local concept…');
  });
});
