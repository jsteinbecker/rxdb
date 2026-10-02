import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBottleTable,
  parseCombinedConcentration,
  parseConcentrationMgPerMl,
  parseMassCell,
  parseMassMg,
  parseReconstitutionTable,
  reconstitutionFromLabel
} from '../reconstitution';
import {
  dedupeProseReconstitutions,
  parseBottleProse,
  parseReconstitutionProse,
  rowsForVial,
  statedReconstitutedConcentrations,
  withLabelConcentrations
} from '../dry-fill-volume';
import { parsePackageFacts } from './catalog-facts';

const table = `<table><tr><th>Vial size (mg)</th><th>Diluent added (mL)</th><th>Volume after reconstitution (mL)</th><th>Concentration (mg/mL)</th></tr><tr><td>1000</td><td>9.6</td><td>10</td><td>100</td></tr></table>`;

test('reads quantities with grouped digits, micrograms and explicit concentration denominators', () => {
  assert.equal(parseMassMg('1,000 mg'), 1000);
  assert.equal(parseMassMg('250 μg'), 0.25);
  assert.equal(parseConcentrationMgPerMl('250 milligrams per 5 milliliters'), 50);
  assert.equal(parseConcentrationMgPerMl('10 mg/0 mL'), null);
});

test('header units and resulting volume are distinct from diluent', () => {
  assert.deepEqual(parseReconstitutionTable(table), [
    { vialMassMg: 1000, diluentMl: 9.6, finalVolumeMl: 10, concentrationMgPerMl: 100 }
  ]);
});

test('namespaced tables and footnote markers retain their values', () => {
  const xml = table
    .replace(/<(\/?)(\w+)/g, '<$1hl7:$2')
    .replace('1000</', '1000<hl7:sup>1</hl7:sup></');
  assert.deepEqual(parseReconstitutionTable(xml), parseReconstitutionTable(table));
});

test('all table fields and multiple tables in one field are read independently', () => {
  const second = table
    .replace('<td>9.6</td>', '<td>19.6</td>')
    .replace('<td>10</td>', '<td>20</td>')
    .replace('<td>100</td>', '<td>50</td>');
  assert.equal(reconstitutionFromLabel({ instructions_for_use_table: [table + second] }).length, 2);
});

test('DailyMed XML supplies facts when openFDA has no label', () => {
  const facts = parsePackageFacts(
    '12345678901',
    null,
    'POWDER, FOR SOLUTION',
    [{ name: 'DRUG', strength: '1 g/1' }],
    null,
    `<document>${table}</document>`
  );
  assert.equal(facts.reconstitution.length, 1);
  assert.equal(facts.resolvedVolume?.finalVolumeMl, 10);
});

test('prose recognizes vial mass before the noun and adding phrasing', () => {
  const rows = parseReconstitutionProse(
    'Reconstitute the 1 g vial by adding 9.6 mL to yield 100 mg/mL.'
  );
  assert.equal(rows[0]?.vialMassMg, 1000);
  assert.equal(rows[0]?.diluentMl, 9.6);
  assert.equal(rows[0]?.concentrations[0]?.mgPerMl, 100);
  assert.deepEqual(
    parseReconstitutionProse('Dilute the reconstituted solution with 50 mL to yield 5 mg/mL.'),
    []
  );
});

test('incompatible yields are preserved as alternatives rather than merged', () => {
  const rows = [10, 20].map((finalVolumeMl) => ({
    vialMassMg: 1000,
    diluentMl: 9.6,
    finalVolumeMl,
    concentrations: [{ name: null, mgPerMl: 1000 / finalVolumeMl }]
  }));
  assert.equal(dedupeProseReconstitutions([...rows, rows[0]]).length, 2);
});

test('concentration-only and ambiguous volume tables do not invent diluent instructions', () => {
  assert.deepEqual(
    parseReconstitutionTable(
      '<table><tr><th>Vial</th><th>Concentration (mg/mL)</th></tr><tr><td>1 g</td><td>100</td></tr></table>'
    ),
    []
  );
  assert.deepEqual(
    parseReconstitutionTable(
      '<table><tr><th>Vial</th><th>A</th><th>B</th></tr><tr><td>1 g</td><td>10 mL</td><td>20 mL</td></tr></table>'
    ),
    []
  );
});

test('prose retains an explicitly stated final volume without inventing concentration', () => {
  const rows = parseReconstitutionProse('Reconstitute the 1 g vial with 9.6 mL to yield 10 mL.');
  assert.equal(rows[0]?.finalVolumeMl, 10);
  assert.deepEqual(rows[0]?.concentrations, []);
});

test('a sentence ending in a whole number does not consume the next instruction', () => {
  const rows = parseReconstitutionProse(
    'See Table 1. Reconstitute the 1 g vial with 9.6 mL to yield 100 mg/mL. Dilute with 50 mL.'
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].diluentMl, 9.6);
});

// Hikma vancomycin pharmacy bulk package (NDC 00143-9163-01), whose label
// covers the 5 g and 10 g vials and adds an oral compounding recipe.
const vancomycinBulk = [
  'Reconstitution and Dilution 5 g Pharmacy Bulk Package Vial At the time of use, reconstitute by adding 47 mL of Sterile Water for Injection to the 5 g vial of dry, sterile vancomycin powder following the reconstitution steps below.',
  'Reconstituted solutions of vancomycin (100 mg/mL) must be further diluted.',
  '10 g Pharmacy Bulk Package Vial At the time of use, reconstitute by adding 94 mL of Sterile Water for Injection to the 10 g vial of dry, sterile vancomycin powder following the reconstitution steps below.',
  'Prepare the sweetening agent separately from the reconstituted Vancomycin hydrochloride solution in a plastic-container following one of the preparation options below: Mix sucrose and sterile water for injection in a 1:2 ratio (e.g., 10 g sucrose and 20 mL sterile water for injection) OR Mix agave nectar with an equal volume of sterile water for injection 2.',
  'Mix the sweetening agent with the reconstituted Vancomycin hydrochloride solution in a 3:1 ratio (e.g., 30 mL sweetening agent with 10 mL vancomycin solution) to obtain a sweetened solution containing 25 mg/mL of vancomycin that is suitable for oral administration.'
].join(' ');

test('oral sweetening recipes are not reconstitution instructions', () => {
  const rows = parseReconstitutionProse(vancomycinBulk);
  assert.ok(rows.every((row) => row.diluentMl !== 20 && row.diluentMl !== 10));
});

test('per-package-size bulk instructions keep the vial they name', () => {
  const rows = parseReconstitutionProse(vancomycinBulk);
  assert.deepEqual(
    rows.map(({ vialMassMg, diluentMl }) => ({ vialMassMg, diluentMl })),
    [
      { vialMassMg: 5000, diluentMl: 47 },
      { vialMassMg: 10000, diluentMl: 94 }
    ]
  );
});

test('a salt-mass package selects the base-mass vial it is, not its sibling', () => {
  const rows = parseReconstitutionProse(vancomycinBulk);
  // 5.13 g vancomycin hydrochloride is the "5 g" vial.
  assert.deepEqual(
    rowsForVial(rows, 5130).map((row) => row.diluentMl),
    [47]
  );
  assert.deepEqual(rowsForVial(rows, 7500), []);
});

test('a salt-mass bulk vial resolves on the moiety mass its label names', () => {
  const facts = parsePackageFacts(
    '00143916301',
    '1 VIAL, PHARMACY BULK PACKAGE in 1 CARTON / 5.13 g in 1 VIAL, PHARMACY BULK PACKAGE',
    'INJECTION, POWDER, FOR SOLUTION',
    [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '5.13 g/1' }],
    {
      dosage_and_administration: [
        vancomycinBulk +
          ' Reconstituted solutions of vancomycin (100 mg/mL) must be further diluted.'
      ]
    },
    null,
    'vancomycin 100 MG/ML Injectable Solution'
  );
  assert.deepEqual(
    facts.reconstitution.map(({ vialMassMg, diluentMl }) => ({ vialMassMg, diluentMl })),
    [{ vialMassMg: 5000, diluentMl: 47 }]
  );
  assert.equal(facts.size?.value, 5);
  assert.equal(facts.size?.unit, 'g');
  assert.equal(
    facts.unitOfUseCorrection?.description,
    '1 VIAL, PHARMACY BULK PACKAGE in 1 CARTON / 5 g in 1 VIAL, PHARMACY BULK PACKAGE'
  );
  assert.equal(facts.resolvedVolume?.finalVolumeMl, 50);
  assert.equal(facts.resolvedVolume?.concentrationMgPerMl, 100);
});

test('a salt-mass unit of use is restated as the moiety in size and description', () => {
  // 0143-9162-01: the directory lists 1025 mg of vancomycin hydrochloride;
  // RxNorm, the SPL-corrected strength and the label call it the 1 g vial.
  const facts = parsePackageFacts(
    '00143916201',
    '1025 mg in 1 VIAL (0143-9162-01)',
    'INJECTION, POWDER, FOR SOLUTION',
    [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '1025 mg/mg' }],
    null,
    null,
    'vancomycin 1000 MG Injection'
  );
  assert.equal(facts.size?.value, 1000);
  assert.equal(facts.size?.unit, 'mg');
  assert.equal(facts.unitOfUseCorrection?.from, '1025 mg in 1 VIAL (0143-9162-01)');
  assert.equal(facts.unitOfUseCorrection?.description, '1000 mg in 1 VIAL (0143-9162-01)');
  assert.equal(
    facts.unitOfUseCorrection?.note,
    'Unit of use corrected from stated value of 1025 mg, equivalent to 1000 mg vancomycin as the hydrochloride salt'
  );
});

test('a unit of use already stated as the moiety is left alone', () => {
  const facts = parsePackageFacts(
    '12345678901',
    '10 VIAL in 1 CARTON / 1 g in 1 VIAL',
    'INJECTION, POWDER, FOR SOLUTION',
    [{ name: 'CEFAZOLIN SODIUM', strength: '1 g/1' }],
    null,
    null,
    'cefazolin 1000 MG Injection'
  );
  assert.equal(facts.size?.value, 1);
  assert.equal(facts.unitOfUseCorrection, null);
});

test('a quantified SCD mass outranks the salt mass for vial matching', () => {
  const label = {
    dosage_and_administration: [
      'Reconstitute the 500 mg vial with 10 mL of Sterile Water for Injection to a concentration of 50 mg/mL. Reconstitute the 1 g vial with 20 mL of Sterile Water for Injection to a concentration of 50 mg/mL.'
    ]
  };
  const facts = parsePackageFacts(
    '12345678901',
    '1 VIAL in 1 CARTON',
    'INJECTION, POWDER, FOR SOLUTION',
    // Listed as the salt, 8% over the moiety: outside plain matching, and
    // closer to nothing without the SCD saying which vial this is.
    [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '540 mg/1' }],
    label,
    null,
    'vancomycin 500 MG Injection'
  );
  assert.deepEqual(
    facts.reconstitution.map((row) => row.vialMassMg),
    [500]
  );
  assert.equal(facts.resolvedVolume?.finalVolumeMl, 10);
});

// ── Stub cells naming their route: cefepime ─────────────────────────────────

const cefepimeTable = `<table><thead><tr><th>Single-Dose Vials for Intravenous (IV)/Intramuscular (IM) Administration</th><th>Amount of Diluent to be added (mL)</th><th>Approximate Cefepime Concentration (mg/mL)</th><th>Amount of Reconstituted Volume to be Withdrawn (mL)</th></tr></thead><tbody><tr><td>Cefepime vial content</td><td/><td/><td/></tr><tr><td>1 g (IV)</td><td>10</td><td>100</td><td>10.5</td></tr><tr><td>1 g (IM)</td><td>2.4</td><td>280</td><td>3.6</td></tr><tr><td>2 g (IV)</td><td>10</td><td>160</td><td>12.5</td></tr></tbody></table>`;

test('a vial cell naming its route in parentheses is a vial of that route', () => {
  assert.deepEqual(parseMassCell('1 g (IV)'), { mg: 1000, routes: ['IV'] });
  assert.deepEqual(parseMassCell('500 mg (I.M.)'), { mg: 500, routes: ['IM'] });
  assert.equal(parseMassCell('1 g (as the sodium salt)'), null);
  assert.deepEqual(parseReconstitutionTable(cefepimeTable), [
    {
      vialMassMg: 1000,
      diluentMl: 10,
      concentrationMgPerMl: 100,
      finalVolumeMl: 10.5,
      routes: ['IV']
    },
    {
      vialMassMg: 1000,
      diluentMl: 2.4,
      concentrationMgPerMl: 280,
      finalVolumeMl: 3.6,
      routes: ['IM']
    },
    {
      vialMassMg: 2000,
      diluentMl: 10,
      concentrationMgPerMl: 160,
      finalVolumeMl: 12.5,
      routes: ['IV']
    }
  ]);
});

// ── Concentrations stated apart from the instruction: vancomycin ───────────

const vancomycinDescription =
  'When reconstituted with Sterile Water for Injection to a concentration of 50 mg/mL, the pH of the solution is between 2.5 and 4.5.';

test('a reconstituted concentration is read wherever the label states it, and a dilution limit is not', () => {
  assert.deepEqual(
    statedReconstitutedConcentrations(
      vancomycinDescription +
        ' Reconstituted solutions of vancomycin (500 mg/10 mL) must be further diluted in at least 100 mL. ' +
        'Further dilute the reconstituted solution to a concentration of no more than 5 mg/mL.'
    ),
    [{ mgPerMl: 50, vialMassMg: null }]
  );
  assert.deepEqual(
    statedReconstitutedConcentrations(
      'When reconstituted with Sterile Water for Injection to a concentration of 50 mg per mL for the 5 gram Pharmacy Bulk Package bottle and 100 mg per mL for the 10 gram Pharmacy Bulk Package bottle, the pH is between 2.5 and 4.5.'
    ),
    [
      { mgPerMl: 50, vialMassMg: 5000 },
      { mgPerMl: 100, vialMassMg: 10000 }
    ]
  );
  assert.deepEqual(
    statedReconstitutedConcentrations(
      'When reconstituted, each 5 mL contains approximately 250 mg of vancomycin.'
    ),
    [{ mgPerMl: 50, vialMassMg: null }]
  );
});

test('a label concentration fills a row only when it alone fits that vial and diluent', () => {
  const row = { vialMassMg: 500, diluentMl: 10, concentrations: [] };
  const bulk = { vialMassMg: null, diluentMl: 95, concentrations: [] };
  const stated = [
    { mgPerMl: 50, vialMassMg: null },
    { mgPerMl: 100, vialMassMg: null }
  ];
  // 500 mg at 50 mg/mL is 10 mL from 10 mL of diluent; at 100 mg/mL it
  // would be 5 mL, less than was added.
  assert.deepEqual(withLabelConcentrations([row], stated, 500)[0].concentrations, [
    { name: null, mgPerMl: 50 }
  ]);
  // The 10 g bulk bottle with 95 mL: only 100 mg/mL (100 mL) fits.
  assert.deepEqual(withLabelConcentrations([bulk], stated, 10000)[0].concentrations, [
    { name: null, mgPerMl: 100 }
  ]);
  // Attributed to the other vial, it does not apply to this one.
  assert.deepEqual(
    withLabelConcentrations([row], [{ mgPerMl: 50, vialMassMg: 10000 }], 500)[0].concentrations,
    []
  );
  // Two that both fit is ambiguity, and ambiguity resolves nothing.
  assert.deepEqual(
    withLabelConcentrations(
      [row],
      [
        { mgPerMl: 50, vialMassMg: null },
        { mgPerMl: 48, vialMassMg: null }
      ],
      500
    )[0].concentrations,
    []
  );
});

test('a vial whose yield is stated in another section resolves', () => {
  const facts = parsePackageFacts(
    '00143935601',
    '1  in 1 VIAL',
    'INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION',
    [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '500 mg/1' }],
    {
      description: [vancomycinDescription],
      dosage_and_administration: [
        'At the time of use, reconstitute the 500 mg vial by adding 10 mL of Sterile Water for Injection.'
      ]
    },
    null,
    'vancomycin 500 MG Injection'
  );
  assert.equal(facts.resolvedVolume?.finalVolumeMl, 10);
  assert.equal(facts.resolvedVolume?.concentrationMgPerMl, 50);
});

// ── Oral constitution bottles ───────────────────────────────────────────────

const amoxicillinTable = `<table><caption>Table 2. Amount of Water for Mixing Oral Suspension</caption><thead><tr><th>Strength</th><th>Bottle Size</th><th>Amount of Water  Required for  Reconstitution </th></tr></thead><tbody><tr><td>Oral Suspension 200 mg/5 mL</td><td>50 mL</td><td>35 mL</td></tr><tr><td/><td>100 mL</td><td>69 mL</td></tr><tr><td>Oral Suspension 400 mg/5 mL</td><td>50 mL</td><td>35 mL</td></tr><tr><td/><td>100 mL</td><td>69 mL</td></tr></tbody></table>`;

const amoxClavTable = `<table><tbody><tr><td><paragraph> Strength of Amoxicillin and Clavulanate Potassium for Oral Suspension</paragraph></td><td><paragraph> Bottle Size</paragraph></td><td><paragraph> Amount of Water for Reconstitution</paragraph></td><td><paragraph> Contents of Each Teaspoonful (5 mL)</paragraph></td></tr><tr><td> 250 mg/62.5 mg per 5 mL </td><td> 75 mL 100 mL 150 mL </td><td> 68 mL 86 mL 128 mL </td><td> 250 mg amoxicillin and 62.5 mg of clavulanic acid </td></tr></tbody></table>`;

test('bottle tables pair each bottle with its water at the strength above it', () => {
  assert.equal(parseCombinedConcentration('250 mg/62.5 mg per 5 mL'), 62.5);
  assert.equal(parseCombinedConcentration('Oral Suspension 200 mg/5 mL'), 40);
  assert.deepEqual(parseBottleTable(amoxicillinTable), [
    { bottleMl: 50, waterMl: 35, concentrationMgPerMl: 40 },
    { bottleMl: 100, waterMl: 69, concentrationMgPerMl: 40 },
    { bottleMl: 50, waterMl: 35, concentrationMgPerMl: 80 },
    { bottleMl: 100, waterMl: 69, concentrationMgPerMl: 80 }
  ]);
  assert.deepEqual(parseBottleTable(amoxClavTable), [
    { bottleMl: 75, waterMl: 68, concentrationMgPerMl: 62.5 },
    { bottleMl: 100, waterMl: 86, concentrationMgPerMl: 62.5 },
    { bottleMl: 150, waterMl: 128, concentrationMgPerMl: 62.5 }
  ]);
  // A reconstitution table is not a bottle table.
  assert.deepEqual(parseBottleTable(cefepimeTable), []);
});

test('bottle instructions in prose need the water they add', () => {
  assert.deepEqual(
    parseBottleProse(
      'Directions for mixing: 80 mL – Slowly add 80 mL water and shake vigorously. 150 mL – Slowly add 150 mL water and shake vigorously. The dose may be diluted in 1 oz of water.'
    ),
    [
      { bottleMl: 80, waterMl: 80, concentrationMgPerMl: null },
      { bottleMl: 150, waterMl: 150, concentrationMgPerMl: null }
    ]
  );
});

test('an oral powder bottle resolves as its finished volume, never as a vial', () => {
  const label = { dosage_and_administration_table: [amoxicillinTable] };
  const facts = parsePackageFacts(
    '61919040132',
    '100 mL in 1 BOTTLE (61919-401-32)',
    'POWDER, FOR SUSPENSION',
    [{ name: 'AMOXICILLIN', strength: '400 mg/5mL' }],
    label,
    null,
    'amoxicillin 80 MG/ML Oral Suspension'
  );
  assert.deepEqual(
    { ...facts.resolvedVolume, rowId: undefined },
    {
      meaning: 'final',
      finalVolumeMl: 100,
      diluentMl: 69,
      concentrationMgPerMl: 80,
      rowId: undefined
    }
  );
  // A bottle size the label never lists stays unresolved, rather than being
  // read as 400 mg of content at the 200 mg/5 mL row's concentration.
  const unlisted = parsePackageFacts(
    '61919040199',
    '150 mL in 1 BOTTLE',
    'POWDER, FOR SUSPENSION',
    [{ name: 'AMOXICILLIN', strength: '400 mg/5mL' }],
    label,
    null,
    'amoxicillin 80 MG/ML Oral Suspension'
  );
  assert.equal(unlisted.resolvedVolume?.finalVolumeMl ?? null, null);
});
