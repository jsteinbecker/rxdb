import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packageDisplayTitle } from '../package-title';

const rxnav = (conceptName: string) => ({ rxnav: { conceptName } });

test('title is generated from ingredients, strength and dose form', () => {
  assert.equal(
    packageDisplayTitle({
      description: '150 mL in 1 BAG (0338-3582-01)',
      doseForm: 'INJECTION, SOLUTION',
      brandName: 'VANCOMYCIN HYDROCHLORIDE',
      genericName: 'VANCOMYCIN HYDROCHLORIDE',
      ingredients: [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '750 mg/150mL' }],
      size: { kind: 'volume', value: 150, unit: 'mL', container: 'BAG', packQty: 1 },
      isMultiDose: false,
      details: rxnav('150 ML vancomycin 5 MG/ML Injection')
    }),
    'Vancomycin hydrochloride 750 mg/150 mL injection, solution'
  );
});

test('a dry fill takes the label per-vial strength and drops lyophilized', () => {
  assert.equal(
    packageDisplayTitle({
      description: '10 VIAL in 1 CARTON (31722-211-10)  / 20 mL in 1 VIAL (31722-211-33)',
      doseForm: 'INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION',
      brandName: 'VANCOMYCIN HYDROCHLORIDE',
      genericName: 'VANCOMYCIN HYDROCHLORIDE',
      labelerName: 'Example Labs',
      ingredients: [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '1 g/20mL' }],
      size: { kind: 'volume', value: 20, unit: 'mL', container: 'VIAL', packQty: 10 },
      isDryFill: true,
      details: {
        spl: {
          ingredients: [{ name: 'VANCOMYCIN HYDROCHLORIDE', kind: 'active', strength: '1000 mg' }]
        }
      }
    }),
    'Vancomycin hydrochloride 1 g injection, powder, for solution CARTON of 10 VIAL, [Example Labs]'
  );
});

test('a distinct brand leads, with the ingredients in parentheses', () => {
  assert.equal(
    packageDisplayTitle({
      doseForm: 'INJECTION, SOLUTION',
      brandName: 'Humulin R',
      genericName: 'Insulin human',
      ingredients: [{ name: 'INSULIN HUMAN', strength: '100 [iU]/mL' }],
      size: { kind: 'volume', value: 10, unit: 'mL', container: 'VIAL, MULTI-DOSE', packQty: 1 },
      isMultiDose: true
    }),
    'Humulin R (insulin human 100 units/mL) injection, solution MDV'
  );
});

test('an absolute amount in a liquid package reads over its volume', () => {
  assert.equal(
    packageDisplayTitle({
      doseForm: 'SOLUTION',
      ingredients: [],
      size: { kind: 'volume', value: 236, unit: 'mL', container: 'BOTTLE', packQty: 1 },
      details: { spl: { ingredients: [{ name: 'ALCOHOL', kind: 'active', strength: '165.2 mL' }] } }
    }),
    'Alcohol 165.2 mL/236 mL solution'
  );
});

test('combination ingredients join with a slash and drop a per-unit denominator', () => {
  assert.equal(
    packageDisplayTitle({
      doseForm: 'TABLET, FILM COATED',
      ingredients: [
        { name: 'AMLODIPINE BESYLATE', strength: '2.5 mg/1' },
        { name: 'ATORVASTATIN CALCIUM TRIHYDRATE', strength: '10 mg/1' }
      ]
    }),
    'Amlodipine besylate 2.5 mg / atorvastatin calcium trihydrate 10 mg tablet, film coated'
  );
});

test('falls back to the RxNorm name without ingredients, and null without either', () => {
  assert.equal(
    packageDisplayTitle({
      ingredients: [],
      labelerName: 'Pfizer',
      details: rxnav('atorvastatin 10 MG Oral Tablet [Lipitor]')
    }),
    'Atorvastatin 10 MG Oral Tablet [Lipitor] [Pfizer]'
  );
  assert.equal(packageDisplayTitle({ ingredients: [], brandName: 'Lipitor' }), null);
});
