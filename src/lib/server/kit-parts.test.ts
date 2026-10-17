import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSplIngredients } from '../spl-ingredients';
import { kitComposition, partContent, suppliedRowFor } from '../kit-parts';
import { dryFillStrength } from '../ingredient-content';
import { packageDisplayTitle } from '../package-title';
import { parsePackageFacts } from './catalog-facts';

// One kit product, two parts, as Wilshire codes it: each part carries its own
// bottle NDC, and the kit's carton is listed only on the kit.
const part = (code: string | null, quantity: string, name: string, form: string, ingredients: string) => `
  <part>
    <quantity><numerator value="${quantity.split(' ')[0]}" unit="${quantity.split(' ')[1]}"/><denominator value="1"/></quantity>
    <partProduct>
      ${code ? `<code code="${code}" codeSystem="2.16.840.1.113883.6.69"/>` : ''}
      <name>${name}</name>
      <formCode code="C" codeSystem="2.16.840.1.113883.3.26.1.1" displayName="${form}"/>
      ${ingredients}
      <asContent>
        <quantity><numerator value="${quantity.split(' ')[0]}" unit="${quantity.split(' ')[1]}"/><denominator value="1"/></quantity>
        <containerPackagedProduct>
          ${code ? `<code code="${code}-05" codeSystem="2.16.840.1.113883.6.69"/>` : '<code/>'}
          <formCode code="C" codeSystem="2.16.840.1.113883.3.26.1.1" displayName="BOTTLE"/>
        </containerPackagedProduct>
      </asContent>
    </partProduct>
  </part>`;
const POWDER = `<ingredient classCode="ACTIM">
  <quantity><numerator unit="g" value="1"/><denominator unit="g" value="1"/></quantity>
  <ingredientSubstance><code code="71WO621TJD" codeSystem="2.16.840.1.113883.4.9"/><name>VANCOMYCIN HYDROCHLORIDE</name></ingredientSubstance>
</ingredient>`;
const DILUENT = `<ingredient classCode="IACT"><ingredientSubstance><name>WATER</name></ingredientSubstance></ingredient>
<ingredient classCode="IACT"><ingredientSubstance><name>SUCRALOSE</name></ingredientSubstance></ingredient>`;
const kit = (code: string, cartons: string[], parts: string) => `
<manufacturedProduct><manufacturedProduct>
  <code code="${code}" codeSystem="2.16.840.1.113883.6.69"/>
  <name>Vancomycin Hydrochloride for Oral Solution</name>
  <formCode code="C47916" codeSystem="2.16.840.1.113883.3.26.1.1" displayName="KIT"/>
  ${cartons
    .map(
      (carton) => `<asContent><quantity><numerator value="1" unit="1"/><denominator value="1"/></quantity>
    <containerPackagedProduct><code code="${carton}" codeSystem="2.16.840.1.113883.6.69"/>
    <formCode code="C43182" codeSystem="2.16.840.1.113883.3.26.1.1" displayName="CARTON"/></containerPackagedProduct></asContent>`
    )
    .join('')}
  ${parts}
</manufacturedProduct></manufacturedProduct>`;

const WILSHIRE = `<document>${kit(
  '52536-106',
  ['52536-106-05'],
  part('52536-096', '7.5 g', 'VANCOMYCIN HYDROCHLORIDE', 'POWDER, FOR SOLUTION', POWDER) +
    part('52536-086', '145 mL', 'GRAPE-FLAVORED DILUENT', 'SOLUTION', DILUENT)
)}</document>`;

// Aurobindo lists both sizes' parts under one kit, sold in two cartons.
const AUROBINDO = `<document>${kit(
  '59651-670',
  ['59651-670-55', '59651-670-03'],
  part('59651-749', '7.5 g', 'vancomycin hydrochloride', 'POWDER, FOR SOLUTION', POWDER) +
    part('59651-750', '145 mL', 'GRAPE FLAVORED DILUENT', 'SOLUTION', DILUENT) +
    part('59651-751', '15 g', 'vancomycin hydrochloride', 'POWDER, FOR SOLUTION', POWDER) +
    part('59651-752', '289 mL', 'GRAPE FLAVORED DILUENT', 'SOLUTION', DILUENT)
)}</document>`;

const AUROBINDO_TABLE =
  'Table 5: Vancomycin Strength, Diluent Volume and National Drug Code (NDC) Numbers Vancomycin Strength per Bottle Diluent Volume NDC Numbers 3.75 g 147 mL 59651-669-55 7.5 g 295 mL 59651-669-03 7.5 g 145 mL 59651-670-55 15 g 289 mL 59651-670-03 Storage and Handling';

// Table 3 of the vancomycin kit labels, as openFDA serves it: a blank cell
// under a concentration repeats the one above it.
const cell = (text: string) => (text ? `<td><paragraph>${text}</paragraph></td>` : '<td/>');
const KIT_TABLE = {
  description_table: [
    '<table><caption>Table 3: Vancomycin Strength, Diluent Volume and Vancomycin Concentration after Reconstitution</caption>' +
      '<thead><tr><th>Vancomycin Strength per Bottle</th><th>Equivalent Amount of Vancomycin Hydrochloride per Bottle</th><th>Diluent Volume</th><th>Vancomycin Concentration after Reconstitution</th></tr></thead><tbody>' +
      [
        ['3.75 g', '3.84 g', '147 mL', '25 mg/mL'],
        ['7.5 g', '7.7 g', '295 mL', ''],
        ['7.5 g', '7.7 g', '145 mL', '50 mg/mL'],
        ['15.0 g', '15.4 g', '289 mL', '']
      ]
        .map((row) => `<tr>${row.map(cell).join('')}</tr>`)
        .join('') +
      '</tbody></table>'
  ]
};

test('a kit part keeps its quantity and kit, and is attributed to the kit carton as well as its own bottle', () => {
  const products = parseSplIngredients(WILSHIRE);
  assert.equal(products.length, 2);
  const [powder, diluent] = products;
  assert.deepEqual(powder.part, { amount: 7.5, amountUnit: 'g', kitCode: '52536-106' });
  assert.deepEqual(powder.packageCodes, ['52536-096-05', '52536-106-05']);
  assert.deepEqual(diluent.part, { amount: 145, amountUnit: 'mL', kitCode: '52536-106' });
  assert.deepEqual(diluent.packageCodes, ['52536-086-05', '52536-106-05']);
  // A sibling part's bottle is not this part's package.
  assert.ok(!powder.packageCodes.includes('52536-086-05'));
});

test('a 1 g/1 g powder part holds its bottle quantity', () => {
  assert.deepEqual(
    partContent(
      { strength: 1, strengthUnit: 'g', per: 1, perUnit: 'g' },
      { amount: 7.5, amountUnit: 'g' }
    ),
    { value: 7.5, unit: 'g' }
  );
  assert.deepEqual(
    partContent(
      { strength: 500, strengthUnit: 'mg', per: 1, perUnit: 'g' },
      { amount: 15, amountUnit: 'g' }
    ),
    { value: 7500, unit: 'mg' }
  );
  // Mass per volume of a mass-measured part says nothing about content.
  assert.equal(
    partContent(
      { strength: 50, strengthUnit: 'mg', per: 1, perUnit: 'mL' },
      { amount: 7.5, amountUnit: 'g' }
    ),
    null
  );
});

test("How Supplied rows are read up to each NDC, whatever its hyphens look like", () => {
  assert.deepEqual(suppliedRowFor(AUROBINDO_TABLE, '59651067003'), { massMg: 15000, volumeMl: 289 });
  assert.deepEqual(suppliedRowFor(AUROBINDO_TABLE, '59651067055'), { massMg: 7500, volumeMl: 145 });
  assert.deepEqual(suppliedRowFor(AUROBINDO_TABLE, '59651066955'), { massMg: 3750, volumeMl: 147 });
  // Ascend splits the NDC across table cells; Firvanq uses non-breaking hyphens.
  assert.deepEqual(
    suppliedRowFor('3.75 g 147 mL 67877- 750- 81 7.5 g 145 mL 67877- 751- 81', '67877075181'),
    { massMg: 7500, volumeMl: 145 }
  );
  assert.deepEqual(suppliedRowFor('7.5 g 145 mL 65628‑206‑05', '65628020605'), {
    massMg: 7500,
    volumeMl: 145
  });
  // ANI lists bottles by constituted volume, with the content beside it.
  assert.deepEqual(
    suppliedRowFor('80 mL bottle (4 g*) NDC 62559-830-80 150 mL bottle (7.5 g*) NDC 62559-830-55', '62559083055'),
    { massMg: 7500, volumeMl: 150 }
  );
  assert.equal(suppliedRowFor(AUROBINDO_TABLE, '59651067099'), null);
});

test("a kit listing a sibling size's parts takes the pair its How Supplied row names", () => {
  const products = parseSplIngredients(AUROBINDO);
  const description =
    '1 KIT in 1 CARTON (59651-670-03)  *  145 mL in 1 BOTTLE *  15 g in 1 BOTTLE *  289 mL in 1 BOTTLE *  7.5 g in 1 BOTTLE';
  const large = kitComposition(products, '59651067003', { howSupplied: AUROBINDO_TABLE, description });
  assert.equal(large?.selectedBy, 'how-supplied');
  assert.deepEqual(
    large?.parts.map((p) => [p.role, p.amount, p.unit]),
    [
      ['active', 15, 'g'],
      ['diluent', 289, 'mL']
    ]
  );
  const small = kitComposition(products, '59651067055', { howSupplied: AUROBINDO_TABLE, description });
  assert.deepEqual(
    small?.parts.map((p) => p.amount),
    [7.5, 145]
  );
  // Nothing to tell the sizes apart: every part is kept, and marked so.
  const unknown = kitComposition(products, '59651067003', { description });
  assert.equal(unknown?.selectedBy, 'ambiguous');
  assert.equal(unknown?.parts.length, 4);
  // A one-size kit needs no table.
  assert.equal(kitComposition(parseSplIngredients(WILSHIRE), '52536010605')?.selectedBy, 'spl');
});

test('a powder kit is a dry fill of its drug bottle, made up with its own diluent', () => {
  const products = parseSplIngredients(WILSHIRE);
  const composition = kitComposition(products, '52536010605');
  const facts = parsePackageFacts(
    '52536010605',
    '1 KIT in 1 CARTON (52536-106-05)  *  7.5 g in 1 BOTTLE (52536-096-05)  *  145 mL in 1 BOTTLE (52536-086-05)',
    'KIT',
    [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '7.5 g' }],
    KIT_TABLE,
    null,
    'vancomycin 50 MG/ML Oral Solution',
    composition
  );
  // Never the diluent's 145 mL, which the description happens to list last.
  assert.deepEqual(facts.size, { kind: 'mass', value: 7.5, unit: 'g', container: 'BOTTLE', packQty: 1 });
  assert.equal(facts.isDryFill, true);
  assert.equal(facts.kit?.parts.length, 2);
  assert.equal(facts.resolvedVolume?.finalVolumeMl, 150);
  assert.equal(facts.resolvedVolume?.diluentMl, 145);
  assert.equal(facts.resolvedVolume?.concentrationMgPerMl, 50);
});

test("RxNorm's concentration picks between a bottle's rows when no diluent does", () => {
  // Wilshire's 7.5 g powder bottle, an NDC in its own right with no kit diluent.
  const products = parseSplIngredients(WILSHIRE).slice(0, 1);
  const facts = parsePackageFacts(
    '52536009605',
    '7.5 g in 1 BOTTLE (52536-096-05)',
    'POWDER, FOR SOLUTION',
    [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '7.5 g' }],
    KIT_TABLE,
    null,
    'vancomycin 50 MG/ML Oral Solution',
    kitComposition(products, '52536009605')
  );
  assert.deepEqual(
    facts.reconstitution.map((row) => [row.diluentMl, row.concentrations[0]?.mgPerMl]),
    [[145, 50]]
  );
});

test("an oral bottle's per-5 mL strength is its concentration, and only its own bottle row applies", () => {
  assert.equal(dryFillStrength('250 mg/5mL', 'POWDER, FOR SOLUTION', null, 80), '250 mg/5mL');
  // An injectable vial's per-volume figure is still its fill.
  assert.equal(dryFillStrength('500 mg/10mL', 'INJECTION, POWDER, FOR SOLUTION', null, 20), '500 mg');

  const label = {
    dosage_and_administration: [
      'Mix the contents of the bottle with water as directed below. When reconstituted, each 5 mL contains approximately 250 mg of vancomycin. 80 mL – Slowly add 80 mL water and shake vigorously. 150 mL – Slowly add 150 mL water and shake vigorously. 300 mL – Slowly add 300 mL water and shake vigorously.'
    ]
  };
  const facts = parsePackageFacts(
    '62559083080',
    '80 mL in 1 BOTTLE, PLASTIC (62559-830-80)',
    'POWDER, FOR SOLUTION',
    [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '250 mg/5mL' }],
    label
  );
  assert.deepEqual(
    facts.reconstitution.map(({ id: _id, ...row }) => row),
    [
      {
        vialMassMg: 4000,
        diluentMl: 80,
        concentrations: [{ name: null, mgPerMl: 50 }],
        finalVolumeMl: 80,
        bottle: true
      }
    ]
  );
  assert.equal(facts.resolvedVolume?.meaning, 'final');
  assert.equal(facts.resolvedVolume?.concentrationMgPerMl, 50);
});

test("a shared label's same-size bottle at another strength is not this package's", () => {
  // Teva's amoxicillin/clavulanate label tabulates two 100 mL bottles; the
  // 400 mg/57 mg one takes 87 mL, and the 200 mg/28.5 mg one's 92 mL is wrong for it.
  const cell = (text: string) => `<td><paragraph>${text}</paragraph></td>`;
  const label = {
    dosage_and_administration_table: [
      `<table><tbody><tr>${['Strength', 'Bottle Size', 'Amount of Water for Reconstitution', 'Contents of Each Teaspoonful (5 mL)'].map(cell).join('')}</tr>` +
        `<tr>${['200 mg/28.5 mg per 5 mL', '100 mL', '92 mL', '200 mg of amoxicillin and 28.5 mg of clavulanic acid'].map(cell).join('')}</tr>` +
        `<tr>${['400 mg/57 mg per 5 mL', '100 mL', '87 mL', '400 mg of amoxicillin and 57 mg of clavulanic acid'].map(cell).join('')}</tr></tbody></table>`
    ]
  };
  const facts = parsePackageFacts(
    '00093227973',
    '100 mL in 1 BOTTLE (0093-2279-73)',
    'POWDER, FOR SUSPENSION',
    [
      { name: 'AMOXICILLIN', strength: '400 mg/5mL' },
      { name: 'CLAVULANATE POTASSIUM', strength: '57 mg/5mL' }
    ],
    label
  );
  assert.deepEqual(
    facts.reconstitution.map((row) => row.diluentMl),
    [87]
  );
});

test('titles read an oral powder by its concentration and a kit by its drug bottle', () => {
  assert.equal(
    packageDisplayTitle({
      doseForm: 'POWDER, FOR SOLUTION',
      isDryFill: true,
      genericName: 'Vancomycin Hydrochloride',
      ingredients: [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '250 mg/5mL' }],
      size: { kind: 'volume', value: 80, unit: 'mL', container: 'BOTTLE', packQty: 1 }
    }),
    'Vancomycin hydrochloride 50 mg/mL powder, for solution'
  );
  // A "brand" that is the generic and its dose form is not a brand.
  assert.equal(
    packageDisplayTitle({
      doseForm: 'KIT',
      isDryFill: true,
      brandName: 'Vancomycin Hydrochloride for Oral Solution',
      genericName: 'vancomycin hydrochloride',
      ingredients: [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength: '7.5 g' }]
    }),
    'Vancomycin hydrochloride 7.5 g kit'
  );
});
