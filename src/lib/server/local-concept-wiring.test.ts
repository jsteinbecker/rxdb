import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { itemName } from '../item-name.ts';
import type { LocalIngredient } from '../local-concept.ts';
import type { LocalConceptRecord } from '../local-concept-view.ts';
import { sbdIndex } from './catalog-store.ts';
import { localConceptsByRxcui, withLocalConcepts } from './local-concept-view.ts';

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

const db = {} as never;
const pkg = (rxcui: string) => ({ id: rxcui, details: { rxnav: { rxcui } } });
const trophamineScd = {
  rxcui: '1189639',
  tty: 'SCD',
  name: 'amino acids Injectable Solution',
  details: {
    counterparts: [{ rxcui: '1189640', name: 'amino acids Injectable Solution [Trophamine 10 %]', tty: 'SBD' }]
  }
};
const active = async () => new Map([['1189639', scd] as const]);
/** A snapshot loader that records which rxcuis were read. */
const snapshotLoader = (concepts: { rxcui: string }[]) => {
  const calls: string[][] = [];
  const load = async (_d: unknown, rxcuis: string[]) => {
    calls.push(rxcuis);
    return new Map(concepts.filter((c) => rxcuis.includes(c.rxcui)).map((c) => [c.rxcui, c] as const));
  };
  return { calls, load: load as never };
};

describe('withLocalConcepts', () => {
  it('gives an SBD-coded package a derived view via its mapped SCD', async () => {
    const snapshots = snapshotLoader([trophamineScd]);
    const [out] = await withLocalConcepts(db, 's', [pkg('1189640')] as never, active, snapshots.load);
    assert.equal(out.localConcept?.derived, true);
    assert.equal(out.localConcept?.tty, 'SBD');
    assert.equal(out.localConcept?.supersedes.rxcui, '1189640');
    assert.deepEqual(snapshots.calls, [['1189639']]);
  });

  it('returns the items unchanged when the lookup throws', async () => {
    const items = [pkg('1189640')];
    const out = await withLocalConcepts(db, 's', items as never, async () => {
      throw new Error('boom');
    });
    assert.equal(out, items as never);
  });
});

describe('localConceptsByRxcui', () => {
  it('reads no snapshots when the scope has no active mappings', async () => {
    const snapshots = snapshotLoader([trophamineScd]);
    const out = await localConceptsByRxcui(db, 's', ['1189640', '42'], async () => new Map(), snapshots.load);
    assert.equal(out.size, 0);
    assert.deepEqual(snapshots.calls, []);
  });

  it('reads no snapshots when every requested rxcui is mapped directly', async () => {
    const snapshots = snapshotLoader([trophamineScd]);
    const out = await localConceptsByRxcui(db, 's', ['1189639'], active, snapshots.load);
    assert.equal(out.get('1189639')?.derived, false);
    assert.deepEqual(snapshots.calls, []);
  });

  it('a mapped SCD whose snapshot claims a requested SBD gives that SBD a derived view', async () => {
    const snapshots = snapshotLoader([trophamineScd]);
    const out = await localConceptsByRxcui(db, 's', ['1189640', '42'], active, snapshots.load);
    assert.deepEqual([...out.keys()], ['1189640']);
    assert.match(out.get('1189640')?.name ?? '', /\[Trophamine 10 %\]$/);
    assert.deepEqual(snapshots.calls, [['1189639']]);
  });

  it('a missing snapshot means no localConcept, not an error', async () => {
    const out = await localConceptsByRxcui(db, 's', ['42'], active, snapshotLoader([]).load);
    assert.equal(out.size, 0);
  });
});

describe('local name vs nameOverride', () => {
  const naming = (nameOverride: string | null) => ({ nameOverride, strengthAsPercent: false });
  it('uses the local name when there is no override', () => {
    assert.equal(itemName(scd.name, naming(null)), scd.name);
  });
  it('the override wins over the local name', () => {
    assert.equal(itemName(scd.name, naming('My name')), 'My name');
  });
});

describe('sbdIndex', () => {
  const scdConcept = (rxcui: string, counterparts: { rxcui: string; name: string; tty: string }[], tty = 'SCD') =>
    ({ rxcui, tty, name: 'n', details: { counterparts } }) as never;
  const trophamine = { rxcui: '1189640', name: 'amino acids Injectable Solution [Trophamine 10 %]', tty: 'SBD' };

  it('finds the SBD through its SCD counterparts and parses the brand', () => {
    const out = sbdIndex([scdConcept('800611', [trophamine])], ['1189640']);
    assert.deepEqual(out.get('1189640'), { scdRxcui: '800611', brand: 'Trophamine 10 %' });
  });
  it('omits an SBD no SCD lists', () => {
    assert.equal(sbdIndex([scdConcept('800611', [trophamine])], ['999']).size, 0);
  });
  it('keeps the first SCD by rxcui when two claim one SBD', () => {
    const out = sbdIndex([scdConcept('900', [trophamine]), scdConcept('800', [trophamine])], ['1189640']);
    assert.equal(out.get('1189640')?.scdRxcui, '800');
  });
  it('ignores non-SCD concepts', () => {
    assert.equal(sbdIndex([scdConcept('1', [trophamine], 'SBD')], ['1189640']).size, 0);
  });
});
