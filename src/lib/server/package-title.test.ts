import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelProductName, packageDisplayTitle, packageStrengthText, packageTitle, rxNormPackageTitle, strengthDisplay } from '../package-title';
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
    // The quantified SCD agrees on 5 mg/mL, so the active takes its name.
    'Vancomycin 5 mg/mL injection, solution'
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

test('a salt corrected to its moiety equivalent is titled as printed', () => {
  // ACD-A 14537-817: citric acid monohydrate's 6 g, coded ACTIM as anhydrous
  // citric acid, is the hydrate's mass (rule 3). The equivalent 5.4855 g is a
  // derived figure for the ingredient table, never the title's.
  const acd = {
    ndc: '14537081775',
    doseForm: 'INJECTION, SOLUTION',
    size: { kind: 'volume' as const, value: 750, unit: 'mL', container: 'BAG', packQty: 1 },
    ingredients: [
      { name: 'CITRIC ACID MONOHYDRATE', strength: '.7314 g/100mL' },
      { name: 'DEXTROSE MONOHYDRATE', strength: '2.45 g/100mL' },
      { name: 'TRISODIUM CITRATE DIHYDRATE', strength: '2.2 g/100mL' }
    ],
    details: {
      rxnav: { conceptName: 'Dextrose Monohydrate 2.45 g in 100 mL / Citric Acid Monohydrate 0.80 g in 100 mL INTRAVENOUS INJECTION, SOLUTION [ACD A]' },
      spl: {
        ingredients: [
          {
            name: 'Citric Acid Monohydrate',
            kind: 'active',
            basis: 'moiety',
            moieties: [{ name: 'Anhydrous Citric Acid' }],
            strength: '5.4855 g',
            labelStrength: { strength: '6 g', correction: 'moiety-equivalent' as const }
          },
          { name: 'Dextrose Monohydrate', kind: 'active', basis: 'ingredient', strength: '18.375 g' },
          { name: 'Trisodium Citrate Dihydrate', kind: 'active', basis: 'ingredient', strength: '16.5 g' }
        ]
      }
    }
  };
  assert.equal(
    packageStrengthText(acd),
    'citric acid monohydrate 8 mg/mL / dextrose monohydrate 24.5 mg/mL / trisodium citrate dihydrate 22 mg/mL'
  );
});

test('a light salt corrected to the SCD keeps the SCD figure', () => {
  // Rule 2, vancomycin HCl 513 mg → the SCD's 500 mg: RxNorm arbitrated, so the
  // corrected figure is the displayed one.
  assert.equal(
    packageStrengthText({
      details: {
        rxnav: { conceptName: 'vancomycin 500 MG Injection' },
        spl: {
          ingredients: [
            {
              name: 'VANCOMYCIN HYDROCHLORIDE',
              kind: 'active',
              basis: 'moiety',
              moieties: [{ name: 'VANCOMYCIN' }],
              strength: '500 mg',
              labelStrength: { strength: '513 mg', correction: 'salt-equivalent' as const }
            }
          ]
        }
      }
    }),
    'vancomycin 500 mg'
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
    'cysteine hydrochloride 0.17 mg/mL / isoleucine 8.2 mg/mL / leucine 14 mg/mL / lysine acetate 8.5 mg/mL'
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

// Baxter's Zosyn Galaxy bag (0338-9636-24): the label codes PIPERACILLIN
// SODIUM and TAZOBACTAM SODIUM on their moieties, and the SCD states each as
// the bag's amount. The title follows the SCD in name and number.
const ZOSYN_BAG = {
  description: '24 BAG in 1 CARTON (0338-9636-24)  / 50 mL in 1 BAG (0338-9636-01)',
  doseForm: 'INJECTION, SOLUTION',
  ingredients: [
    { name: 'PIPERACILLIN SODIUM', strength: '3 g/50mL' },
    { name: 'TAZOBACTAM SODIUM', strength: '.375 g/50mL' }
  ],
  size: { kind: 'volume' as const, value: 50, unit: 'mL', container: 'BAG', packQty: 24 },
  details: {
    rxnav: { conceptName: 'piperacillin 3000 MG / tazobactam 375 MG Injection [Zosyn]' },
    spl: {
      ingredients: [
        { name: 'PIPERACILLIN SODIUM', kind: 'active', strength: '3 g', basis: 'moiety', moieties: [{ name: 'PIPERACILLIN ANHYDROUS' }] },
        { name: 'TAZOBACTAM SODIUM', kind: 'active', strength: '0.375 g', basis: 'moiety', moieties: [{ name: 'TAZOBACTAM' }] }
      ]
    }
  }
};

test('a moiety-basis salt is named by its moiety, as the SCD spells it', () => {
  assert.equal(packageStrengthText(ZOSYN_BAG), 'piperacillin 3 g / tazobactam 375 mg');
});

test('a bag whose SCD states amounts reads its total, not per mL', () => {
  // Without the label's rows, the directory's concentration read over the bag
  // is the SCD's amount, so it reads as the SCD does.
  assert.equal(
    packageStrengthText({ ...ZOSYN_BAG, details: { rxnav: ZOSYN_BAG.details.rxnav } }),
    'piperacillin 3 g / tazobactam 375 mg'
  );
  // An amount that disagrees with the SCD keeps the salt's name and its own number.
  assert.equal(
    packageStrengthText({
      ...ZOSYN_BAG,
      ingredients: [{ name: 'PIPERACILLIN SODIUM', strength: '3.13 g/50mL' }],
      details: { rxnav: ZOSYN_BAG.details.rxnav }
    }),
    'piperacillin sodium 3.13 g'
  );
  // An SCD that states a concentration keeps mg/mL.
  assert.equal(
    packageStrengthText({
      ...ZOSYN_BAG,
      details: { ...ZOSYN_BAG.details, rxnav: { conceptName: 'piperacillin 60 MG/ML / tazobactam 7.5 MG/ML Injectable Solution' } }
    }),
    'piperacillin 60 mg/mL / tazobactam 7.5 mg/mL'
  );
});

test('a hydrate renamed to its moiety takes the label number, never the directory salt mass', () => {
  // ACD-A (14537-817): no RxNorm. Citric acid monohydrate is measured as
  // anhydrous citric acid (0.8 g of it is 0.7314 g); trisodium citrate is
  // no form of citric acid, so it keeps its own name and the directory's 22 mg/mL.
  assert.equal(
    packageStrengthText({
      doseForm: 'INJECTION, SOLUTION',
      ingredients: [
        { name: 'CITRIC ACID MONOHYDRATE', strength: '.8 g/100mL' },
        { name: 'DEXTROSE MONOHYDRATE', strength: '2.45 g/100mL' },
        { name: 'TRISODIUM CITRATE DIHYDRATE', strength: '2.2 g/100mL' }
      ],
      size: { kind: 'volume', value: 750, unit: 'mL', container: 'BAG', packQty: 1 },
      details: {
        spl: {
          ingredients: [
            { name: 'CITRIC ACID MONOHYDRATE', kind: 'active', strength: '5.4855 g', basis: 'moiety', moieties: [{ name: 'ANHYDROUS CITRIC ACID' }] },
            { name: 'DEXTROSE MONOHYDRATE', kind: 'active', strength: '18.375 g', basis: 'ingredient', moieties: [{ name: 'ANHYDROUS DEXTROSE' }] },
            { name: 'TRISODIUM CITRATE DIHYDRATE', kind: 'active', strength: '10.7775 g', basis: 'moiety', moieties: [{ name: 'ANHYDROUS CITRIC ACID' }] }
          ]
        }
      }
    }),
    'anhydrous citric acid 7.314 mg/mL / dextrose monohydrate 24.5 mg/mL / trisodium citrate dihydrate 22 mg/mL'
  );
});

test('an electrolyte is not renamed to its ion', () => {
  assert.equal(
    packageStrengthText({
      ingredients: [{ name: 'POTASSIUM CHLORIDE', strength: '20 meq/100mL' }],
      size: { kind: 'volume', value: 100, unit: 'mL', container: 'BAG', packQty: 1 },
      details: {
        spl: {
          ingredients: [{ name: 'POTASSIUM CHLORIDE', kind: 'active', strength: '20 meq', basis: 'moiety', moieties: [{ name: 'POTASSIUM CATION' }] }]
        }
      }
    }),
    'potassium chloride 0.2 mEq/mL'
  );
});

test('actives read in RxNorm order whatever order the directory lists them', () => {
  // Wyeth's Zosyn Galaxy lists tazobactam first.
  assert.equal(
    packageStrengthText({
      ...ZOSYN_BAG,
      ingredients: [...ZOSYN_BAG.ingredients].reverse(),
      details: { ...ZOSYN_BAG.details, spl: { ingredients: [...ZOSYN_BAG.details.spl.ingredients].reverse() } }
    }),
    'piperacillin 3 g / tazobactam 375 mg'
  );
});

test('a concept name in the listing own words is no SCD', () => {
  // RxNav's name for ACD-A 14537-817-75: not RxNorm's, so neither its
  // spelling nor its amounts stand in for an SCD's.
  const item = {
    ingredients: [{ name: 'CITRIC ACID MONOHYDRATE', strength: '.8 g/100mL' }],
    size: { kind: 'volume' as const, value: 750, unit: 'mL', container: 'BAG', packQty: 12 },
    details: {
      rxnav: { conceptName: 'Dextrose Monohydrate 2.45 g in 100 mL / Citric Acid Monohydrate 0.80 g in 100 mL INTRAVENOUS INJECTION, SOLUTION [ACD A]' },
      spl: {
        ingredients: [{ name: 'Citric Acid Monohydrate', kind: 'active', strength: '5.4855 g', basis: 'moiety', moieties: [{ name: 'Anhydrous Citric Acid' }] }]
      }
    }
  };
  assert.equal(packageStrengthText(item), 'anhydrous citric acid 7.314 mg/mL');
});

test('a directory amount that is the SCD\'s takes its name, whatever the denominator', () => {
  // Hikma's ampicillin and sulbactam (0641-6116-01): per 1.5 g of powder, no label rows.
  assert.equal(
    packageStrengthText({
      description: '1.5 g in 1 VIAL',
      doseForm: 'INJECTION, POWDER, FOR SOLUTION',
      ingredients: [
        { name: 'AMPICILLIN SODIUM', strength: '1 g/1.5g' },
        { name: 'SULBACTAM SODIUM', strength: '.5 g/1.5g' }
      ],
      size: { kind: 'mass', value: 1.5, unit: 'g', container: 'VIAL', packQty: 1 },
      details: { rxnav: { conceptName: 'ampicillin 1000 MG / sulbactam 500 MG Injection' } }
    }),
    'ampicillin 1 g / sulbactam 500 mg'
  );
});

test('a blank directory ingredient is skipped, not fatal', () => {
	assert.equal(
		packageDisplayTitle({
			doseForm: 'TABLET',
			ingredients: [
				{ name: '  ', strength: '5 mg/1' },
				{ name: 'LISINOPRIL', strength: '10 mg/1' }
			]
		}),
		'Lisinopril 10 mg tablet'
	);
	assert.equal(packageDisplayTitle({ doseForm: 'TABLET', ingredients: [{ name: '', strength: null }] }), null);
	assert.equal(packageTitle({ ndc: '00093000101', ingredients: [{ name: '', strength: null }] }), 'NDC 00093-0001-01');
});

test('strengths read as RxNorm writes them, every volume per mL', () => {
	for (const [stated, shown] of [
		['1.25 g/250mL', '5 mg/mL'],
		['0.9 g/100mL', '9 mg/mL'],
		['5 mg/5mL', '1 mg/mL'],
		['100 mcg/0.5mL', '0.2 mg/mL'],
		['20 mEq/100mL', '0.2 mEq/mL'],
		['1000 [iU]/10mL', '100 units/mL'],
		['1000 mg/1 VIAL', '1 g'],
		['1000 mg', '1 g'],
		['2,000 mg', '2 g'],
		['0.25 g/1', '250 mg'],
		['3.375 g/1', '3.375 g'],
		['0.5 g', '500 mg'],
		['1.5 kg', '1.5 kg'],
		['50 mcg/1', '50 mcg'],
		['40 mEq/1', '40 mEq'],
		['10 mg/g', '10 mg/g'],
		['0.09 mg/actuat', '0.09 mg/actuat'],
		['  80 mg/1  ', '80 mg'],
		['.5 mg/1', '0.5 mg']
	])
		assert.equal(strengthDisplay(stated), shown, stated);
	// Text that is not a strength comes back as written.
	assert.equal(strengthDisplay(' see label '), 'see label');
});

test('a brand that is only the generic in other words is not bracketed', () => {
	assert.equal(
		packageDisplayTitle({
			doseForm: 'INJECTION, SOLUTION',
			brandName: 'Sodium Chloride',
			genericName: 'SODIUM CHLORIDE',
			ingredients: [{ name: 'SODIUM CHLORIDE', strength: '9 mg/mL' }]
		}),
		'Sodium chloride 9 mg/mL injection, solution'
	);
	assert.equal(
		labelProductName({
			brandName: 'Vancomycin Hydrochloride for Injection',
			genericName: 'vancomycin hydrochloride',
			ingredients: [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '1 g/20mL' }]
		}),
		'vancomycin hydrochloride'
	);
	// A name that adds a diluent says something the ingredients don't.
	assert.equal(
		labelProductName({
			brandName: 'Vasopressin in Sodium Chloride',
			genericName: 'vasopressin',
			ingredients: [{ name: 'VASOPRESSIN', strength: "20 [USP'U]/100mL" }]
		}),
		'Vasopressin in Sodium Chloride (vasopressin)'
	);
});

test('a carton of single-dose vials reads its count without the dose qualifier', () => {
	assert.equal(
		packageDisplayTitle({
			doseForm: 'INJECTION, SOLUTION',
			genericName: 'HEPARIN SODIUM',
			ingredients: [{ name: 'HEPARIN SODIUM', strength: "5000 [USP'U]/mL" }],
			description: '25 VIAL, SINGLE-DOSE in 1 CARTON (63323-262-01)  / 1 mL in 1 VIAL, SINGLE-DOSE',
			isMultiDose: false
		}),
		'Heparin sodium 5000 USP units/mL injection, solution CARTON of 25 VIAL'
	);
});

test('look-alike salts keep their full names in titles', () => {
	for (const name of ['EDETATE DISODIUM', 'EDETATE CALCIUM DISODIUM'])
		assert.equal(
			packageDisplayTitle({
				doseForm: 'INJECTION, SOLUTION',
				genericName: name,
				ingredients: [{ name, strength: '200 mg/mL' }]
			}),
			`${name.charAt(0)}${name.slice(1).toLowerCase()} 200 mg/mL injection, solution`
		);
});

test('a title never depends on the order the sources list ingredients in', () => {
	const ingredients = [
		{ name: 'TAZOBACTAM SODIUM', strength: '375 mg/1' },
		{ name: 'PIPERACILLIN SODIUM', strength: '3 g/1' }
	];
	const titles = [ingredients, [...ingredients].reverse()].map((list) =>
		packageDisplayTitle({ doseForm: 'INJECTION, POWDER, FOR SOLUTION', ingredients: list })
	);
	assert.equal(titles[0], titles[1]);
	assert.match(titles[0]!, /^Piperacillin sodium 3 g \/ tazobactam sodium 375 mg/);
});
