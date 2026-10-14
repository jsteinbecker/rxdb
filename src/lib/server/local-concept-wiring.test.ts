import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { itemName } from '../item-name.ts';
import type { LocalIngredient } from '../local-concept.ts';
import type { LocalConceptRecord } from '../local-concept-view.ts';
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
const snapshots = async () =>
  new Map([
    [
      '1189640',
      {
        rxcui: '1189640',
        details: {
          counterparts: [
            { rxcui: '9', name: 'x', tty: 'SBD' },
            { rxcui: '1189639', name: 'y', tty: 'SCD' }
          ],
          brands: [{ rxcui: '5', name: 'TrophAmine', tty: 'BN' }]
        }
      }
    ]
  ]) as never;

describe('withLocalConcepts', () => {
  it('gives an SBD-coded package a derived view via its SCD counterpart', async () => {
    const loadRecords = async (_d: unknown, _s: string, keys: string[]) =>
      new Map(keys.includes('1189639') ? [['1189639', scd] as const] : []);
    const [out] = await withLocalConcepts(db, 's', [pkg('1189640')] as never, loadRecords as never, snapshots);
    assert.equal(out.localConcept?.derived, true);
    assert.equal(out.localConcept?.tty, 'SBD');
    assert.equal(out.localConcept?.supersedes.rxcui, '1189640');
  });

  it('returns the items unchanged when the lookup throws', async () => {
    const items = [pkg('1189640')];
    const out = await withLocalConcepts(db, 's', items as never, async () => {
      throw new Error('boom');
    });
    assert.equal(out, items as never);
  });

  it('a missing snapshot means no localConcept, not an error', async () => {
    const out = await localConceptsByRxcui(db, 's', ['42'], async () => new Map(), async () => new Map());
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
