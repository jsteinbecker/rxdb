import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelProductName, packageDisplayTitle, packageStrengthText, packageTitle, rxNormPackageTitle } from '../package-title';
import { splitBrand } from '../brand-name';

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
    'Vancomycin hydrochloride 5 mg/mL injection, solution'
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
    'Vancomycin hydrochloride 1 g injection, powder, for solution CARTON of 10 VIAL'
  );
});

test('a distinct brand closes the title in brackets, after its packaging', () => {
  assert.equal(
    packageDisplayTitle({
      doseForm: 'INJECTION, SOLUTION',
      brandName: 'Humulin R',
      genericName: 'Insulin human',
      ingredients: [{ name: 'INSULIN HUMAN', strength: '100 [iU]/mL' }],
      size: { kind: 'volume', value: 10, unit: 'mL', container: 'VIAL, MULTI-DOSE', packQty: 1 },
      isMultiDose: true
    }),
    'Insulin human 100 units/mL injection, solution MDV [Humulin R]'
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
    'Alcohol 0.7 mL/mL solution'
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
    'Atorvastatin 10 MG Oral Tablet [Lipitor]'
  );
  assert.equal(packageDisplayTitle({ ingredients: [], brandName: 'Lipitor' }), null);
});

test('the RxNorm title leads with the clinical drug and leaves the labeler to the page', () => {
  const crofab = {
    description: '1 in 1 VIAL, GLASS',
    brandName: 'CroFab',
    genericName: 'ovine crotalidae venoms immune fab',
    labelerName: 'BTG International Inc.',
    ingredients: [{ name: 'CROTALUS ATROX IMMUNE FAB ANTIVENIN (OVINE)', strength: '1 g/1' }],
    details: rxnav(
      'Agkistrodon piscivorus antivenin 780 UNT / Crotalus adamanteus antivenin 420 UNT / Crotalus atrox antivenin 1270 UNT / Crotalus scutulatus antivenin 5570 UNT Injection [CroFab]'
    )
  };
  assert.equal(
    rxNormPackageTitle(crofab),
    'Agkistrodon piscivorus antivenin 780 UNT / Crotalus adamanteus antivenin 420 UNT / Crotalus atrox antivenin 1270 UNT / Crotalus scutulatus antivenin 5570 UNT Injection [CroFab]'
  );
  assert.equal(labelProductName(crofab), 'CroFab (ovine crotalidae venoms immune fab)');
});

test('the RxNorm title restates a quantified SCD and keeps the package context', () => {
  assert.equal(
    rxNormPackageTitle({
      description: '10 VIAL, SINGLE-DOSE in 1 CARTON',
      labelerName: 'Merck',
      details: rxnav('4 ML pembrolizumab 25 MG/ML Injection')
    }),
    'Pembrolizumab 100 MG/4ML Injection CARTON of 10 VIAL'
  );
});

test('the RxNorm title falls back to the generated title without a concept', () => {
  const item = {
    doseForm: 'TABLET',
    labelerName: 'Pfizer',
    ingredients: [{ name: 'ATORVASTATIN CALCIUM', strength: '10 mg/1' }]
  };
  assert.equal(rxNormPackageTitle(item), packageDisplayTitle(item));
});

test('the label name is the generic alone when the brand only restates it', () => {
  assert.equal(
    labelProductName({ brandName: 'VANCOMYCIN HYDROCHLORIDE', genericName: 'VANCOMYCIN HYDROCHLORIDE' }),
    'vancomycin hydrochloride'
  );
  assert.equal(labelProductName({}), null);
});

test('packageTitle falls back from the RxNorm title to brand, generic, listing, then NDC', () => {
  // A loader's precomputed title wins, even when it is null.
  assert.equal(packageTitle({ ndc: '50633011011', displayTitle: 'CroFab', brandName: 'X' }), 'CroFab');
  assert.equal(packageTitle({ ndc: '50633011011', displayTitle: null, brandName: 'CroFab' }), 'CroFab');
  assert.equal(
    packageTitle({ ndc: '50633011011', genericName: 'crotalidae fab', brandName: 'CroFab' }),
    'crotalidae fab [CroFab]'
  );
  assert.equal(packageTitle({ ndc: '50633011011', genericName: 'crotalidae fab' }), 'crotalidae fab');
  assert.equal(packageTitle({ ndc: '50633011011', description: '1 VIAL in 1 CARTON' }), '1 VIAL in 1 CARTON');
  assert.equal(packageTitle({ ndc: '50633011011' }), 'NDC 50633-0110-11');
});

test('splitBrand takes a trailing bracket as the brand', () => {
  assert.deepEqual(splitBrand('atorvastatin 10 MG Oral Tablet [Lipitor]'), {
    name: 'atorvastatin 10 MG Oral Tablet',
    brand: 'Lipitor'
  });
  assert.deepEqual(splitBrand('insulin human 100 [iU]/mL injection'), {
    name: 'insulin human 100 [iU]/mL injection',
    brand: null
  });
});

test('a corrected strength that contradicts RxNorm titles the package from its ingredients', () => {
  const trophamine = {
    ndc: '0264-1933-55',
    brandName: 'TrophAmine',
    doseForm: 'INJECTION, SOLUTION',
    ingredients: [{ name: 'LYSINE ACETATE', strength: '0.85 g/100mL' }],
    details: {
      rxnav: { conceptName: 'lysine 12 MG/ML Injectable Solution [TrophAmine]' },
      spl: { ingredients: [{ name: 'LYSINE ACETATE', kind: 'active', strength: '0.85 g/100mL' }] }
    }
  };
  assert.equal(rxNormPackageTitle(trophamine), packageDisplayTitle(trophamine));
  assert.match(rxNormPackageTitle(trophamine)!, /0\.85|8\.5/);
});

test('a corrected strength that agrees with RxNorm keeps the RxNorm title', () => {
  assert.equal(
    rxNormPackageTitle({
      ingredients: [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '500 mg/1' }],
      details: {
        rxnav: { conceptName: 'vancomycin 500 MG Injection' },
        spl: { ingredients: [{ name: 'VANCOMYCIN HYDROCHLORIDE', kind: 'active', strength: '500 mg/1' }] }
      }
    }),
    'Vancomycin 500 MG Injection'
  );
});

test('a converted strength is rounded to the precision the others are written in', () => {
  assert.equal(
    packageStrengthText({
      ingredients: [
        { name: 'LEUCINE', strength: '1.4 g/100mL' },
        { name: 'ISOLEUCINE', strength: '.82 g/100mL' },
        { name: 'CYSTEINE HYDROCHLORIDE', strength: '0.016556 g/100mL' },
        { name: 'LYSINE ACETATE', strength: '0.850589 g/100mL' }
      ]
    }),
    'leucine 14 mg/mL / isoleucine 8.2 mg/mL / cysteine hydrochloride 0.17 mg/mL / lysine acetate 8.5 mg/mL'
  );
  assert.equal(
    packageStrengthText({
      ingredients: [
        { name: 'SULFAMETHOXAZOLE', strength: '800 mg/1' },
        { name: 'TRIMETHOPRIM', strength: '160 mg/1' }
      ]
    }),
    'sulfamethoxazole 800 mg / trimethoprim 160 mg'
  );
});
