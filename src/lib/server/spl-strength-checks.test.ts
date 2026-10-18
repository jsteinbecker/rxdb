import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSplIngredients, strengthText } from '../spl-ingredients';
import { checkProductStrengths, rxNormStrengths } from '../spl-strength-checks';

const ingredient = (classCode: string, name: string, unii: string, qty: string, moiety = '') => `
	<ingredient classCode="${classCode}">
		${qty}
		<ingredientSubstance>
			<code code="${unii}" codeSystem="2.16.840.1.113883.4.9"/>
			<name>${name}</name>
			${moiety}
		</ingredientSubstance>
	</ingredient>`;

const perMg = (value: string) =>
	`<quantity><numerator value="${value}" unit="mg"/><denominator value="1" unit="mg"/></quantity>`;

// NDC 0143-9161: every strength coded "in 1 mg", and the active's 513 mg is
// the hydrochloride's mass tagged as vancomycin-base strength.
const VANCOMYCIN = `<document><manufacturedProduct><manufacturedProduct>
	<code code="0143-9161" codeSystem="2.16.840.1.113883.6.69"/>
	<name>Vancomycin</name>
	<formCode code="C42957" displayName="INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION"/>
	${ingredient(
		'ACTIM',
		'VANCOMYCIN HYDROCHLORIDE',
		'71WO621TJD',
		perMg('513'),
		`<activeMoiety><activeMoiety><code code="6Q205EH1VU" codeSystem="2.16.840.1.113883.4.9"/><name>VANCOMYCIN</name></activeMoiety></activeMoiety>`
	)}
	${ingredient('IACT', 'TREHALOSE', 'B8WCK70T7I', perMg('125'))}
	${ingredient('IACT', 'POLYSORBATE 80', '6OZP39ZG8H', perMg('0.05'))}
	${ingredient('IACT', 'HYDROCHLORIC ACID', 'QTT17582CB', '')}
	<asContent>
		<quantity><numerator value="513" unit="mg"/><denominator value="1"/></quantity>
		<containerPackagedProduct>
			<code code="0143-9161-01" codeSystem="2.16.840.1.113883.6.69"/>
			<formCode code="C43226" displayName="VIAL"/>
		</containerPackagedProduct>
	</asContent>
</manufacturedProduct></manufacturedProduct></document>`;

test('miscoded mass denominators and salt-as-moiety strengths are corrected with notes', () => {
	const [product] = parseSplIngredients(VANCOMYCIN);
	assert.deepEqual(product.presentation, {
		amount: 513,
		amountUnit: 'mg',
		per: 1,
		form: 'VIAL'
	});

	const checked = checkProductStrengths(product, { rxNormName: 'vancomycin 500 MG Injection' });
	assert.deepEqual(checked.map(strengthText), [
		'500 mg/1 VIAL',
		'125 mg/1 VIAL',
		'0.05 mg/1 VIAL',
		null
	]);

	const presentation = 'Corrected unit of presentation to 1 VIAL from improper coding as 1 mg';
	assert.deepEqual(
		checked.map((row) => row.corrections.map((c) => c.note)),
		[
			[
				presentation,
				'Strength corrected from stated value of 513 mg, equivalent to 500 mg vancomycin as the hydrochloride salt'
			],
			[presentation],
			[presentation],
			[]
		]
	);
});

test('a plausible mass-in-mass strength and an unmatched RxNorm name are left alone', () => {
	const [product] = parseSplIngredients(
		VANCOMYCIN.replace(perMg('513'), perMg('0.5')).replace(perMg('125'), perMg('0.2'))
	);
	const checked = checkProductStrengths(product, { rxNormName: 'vancomycin 250 MG Oral Capsule' });
	assert.ok(checked.every((row) => row.corrections.length === 0));
	assert.equal(strengthText(checked[0]), '0.5 mg/1 mg');
});

test('RxNorm names split into per-component strengths', () => {
	assert.deepEqual(rxNormStrengths('amoxicillin 250 MG / clavulanate 62.5 MG Oral Tablet [Augmentin]'), [
		{ name: 'amoxicillin', value: 250, unit: 'MG', per: 1, perUnit: null },
		{ name: 'clavulanate', value: 62.5, unit: 'MG', per: 1, perUnit: null }
	]);
	assert.deepEqual(rxNormStrengths('lidocaine hydrochloride 10 MG/ML Injectable Solution'), [
		{ name: 'lidocaine hydrochloride', value: 10, unit: 'MG', per: 1, perUnit: 'ML' }
	]);
});

// NDC 0264-1933 (TrophAmine 10%): lysine acetate's 1.2 g/100 mL coded ACTIM
// as though it were lysine. RxNorm copied the number; the directory names the
// salt at the same mass, and GSRS weights give lysine's share.
const LYSINE_MOIETY = `<activeMoiety><activeMoiety><code code="K3Z4F929H6" codeSystem="2.16.840.1.113883.4.9"/><name>LYSINE</name></activeMoiety></activeMoiety>`;
const perDl = (value: string) =>
	`<quantity><numerator value="${value}" unit="g"/><denominator value="100" unit="mL"/></quantity>`;
const TROPHAMINE = `<document><manufacturedProduct><manufacturedProduct>
	<code code="0264-1933" codeSystem="2.16.840.1.113883.6.69"/>
	<name>TrophAmine</name>
	<formCode code="C42945" displayName="INJECTION, SOLUTION"/>
	${ingredient('ACTIM', 'LYSINE ACETATE', 'TTL6G7LIWZ', perDl('1.2'), LYSINE_MOIETY)}
</manufacturedProduct></manufacturedProduct></document>`;
// 146.19 / 206.24
const LYSINE_FACTOR = new Map([['TTL6G7LIWZ', { moietyUnii: 'K3Z4F929H6', factor: '0.708834367727889837' }]]);

test('a heavy salt stated as moiety strength converts when the directory names the salt at that mass', () => {
	const [product] = parseSplIngredients(TROPHAMINE);
	const [row] = checkProductStrengths(product, {
		rxNormName: 'lysine 1.2 MG/ML Injectable Solution',
		moietyFactors: LYSINE_FACTOR,
		directory: [{ name: 'LYSINE ACETATE', strength: '1.2 g/100mL' }]
	});
	assert.equal(strengthText(row), '0.8506 g/100 mL');
	assert.equal(row.corrections[0].kind, 'moiety-equivalent');
	assert.match(row.corrections[0].note, /1\.2 g, the mass of the acetate salt.*0\.8506 g lysine/);
	// Kept exactly, so undoing the correction restores the label's number
	// instead of converting the rounded one back.
	assert.equal(row.corrections[0].stated, 1.2);
});

test('a heavy salt is left alone without the directory agreeing on its mass', () => {
	const [product] = parseSplIngredients(TROPHAMINE);
	for (const directory of [[], [{ name: 'LYSINE ACETATE', strength: '1.7 g/100mL' }]]) {
		const [row] = checkProductStrengths(product, { moietyFactors: LYSINE_FACTOR, directory });
		assert.equal(row.strength, 1.2);
		assert.deepEqual(row.corrections, []);
	}
});

// NDC 14537-817 (ACD-A, 750 mL): citric acid monohydrate's 6 g coded ACTIM as
// anhydrous citric acid. Its name does not contain the moiety's, so rule 2
// never sees it; left as is, it summed hydrate mass with the trisodium
// citrate row's anhydrous equivalent.
const CITRIC_MOIETY = `<activeMoiety><activeMoiety><code code="XF417D3PSL" codeSystem="2.16.840.1.113883.4.9"/><name>ANHYDROUS CITRIC ACID</name></activeMoiety></activeMoiety>`;
const ACD_A = `<document><manufacturedProduct><manufacturedProduct>
	<code code="14537-817" codeSystem="2.16.840.1.113883.6.69"/>
	<name>ACD-A</name>
	<formCode code="C42945" displayName="INJECTION, SOLUTION"/>
	${ingredient(
		'ACTIM',
		'CITRIC ACID MONOHYDRATE',
		'2968PHW8QP',
		`<quantity><numerator value="6" unit="g"/><denominator value="750" unit="mL"/></quantity>`,
		CITRIC_MOIETY
	)}
</manufacturedProduct></manufacturedProduct></document>`;
// 192.12 / 210.14
const CITRIC_FACTOR = new Map([['2968PHW8QP', { moietyUnii: 'XF417D3PSL', factor: '0.914247644427519748' }]]);

test('a light hydrate stated as moiety strength converts when RxNorm cannot arbitrate', () => {
	const [product] = parseSplIngredients(ACD_A);
	const directory = [{ name: 'CITRIC ACID MONOHYDRATE', strength: '.8 g/100mL' }];
	const [row] = checkProductStrengths(product, { moietyFactors: CITRIC_FACTOR, directory });
	assert.equal(row.strength, 5.485);
	assert.equal(row.corrections[0].kind, 'moiety-equivalent');
	assert.equal(row.corrections[0].stated, 6);

	// Where RxNorm states the moiety, rule 2 owns light salts.
	const [kept] = checkProductStrengths(product, {
		rxNormName: 'anhydrous citric acid 8 MG/ML Injectable Solution',
		moietyFactors: CITRIC_FACTOR,
		directory
	});
	assert.equal(kept.strength, 6);
});

// Amoxicillin capsules: the label names AMOXICILLIN, whose UNII (804826J2HU) is
// the trihydrate in GSRS, with ACTIM basis on AMOXICILLIN ANHYDROUS. The bare
// name means the drug, so 500 mg stays 500 mg.
const AMOXICILLIN_MOIETY = `<activeMoiety><activeMoiety><code code="9EM05410Q9" codeSystem="2.16.840.1.113883.4.9"/><name>AMOXICILLIN ANHYDROUS</name></activeMoiety></activeMoiety>`;
const AMOXICILLIN = `<document><manufacturedProduct><manufacturedProduct>
	<code code="00000-0000" codeSystem="2.16.840.1.113883.6.69"/>
	<name>Amoxicillin</name>
	<formCode code="C25158" displayName="CAPSULE"/>
	${ingredient(
		'ACTIM',
		'AMOXICILLIN',
		'804826J2HU',
		`<quantity><numerator value="500" unit="mg"/><denominator value="1" unit="1"/></quantity>`,
		AMOXICILLIN_MOIETY
	)}
</manufacturedProduct></manufacturedProduct></document>`;
// 365.40 / 419.45
const AMOXICILLIN_FACTOR = new Map([['804826J2HU', { moietyUnii: '9EM05410Q9', factor: '0.871140779592323' }]]);

test('a bare drug name is not treated as its hydrate UNII', () => {
	const [product] = parseSplIngredients(AMOXICILLIN);
	const [row] = checkProductStrengths(product, {
		rxNormName: 'amoxicillin 500 MG Oral Capsule',
		moietyFactors: AMOXICILLIN_FACTOR,
		directory: [{ name: 'AMOXICILLIN', strength: '500 mg/1' }]
	});
	assert.equal(row.strength, 500);
	assert.deepEqual(row.corrections, []);
});

// Piperacillin and tazobactam (Hospira vials, Baxter and B. Braun bags): ACTIM
// on PIPERACILLIN SODIUM, moiety PIPERACILLIN ANHYDROUS, at 2 g — the usual
// "equivalent to 2 g piperacillin", and what the SCD says (2000 MG). The
// directory repeats that number under the salt's name. An exact name match
// missed RxNorm's `piperacillin`, and every one of these read 1.919 g.
const PIPERACILLIN_MOIETY = `<activeMoiety><activeMoiety><code code="9I628532GX" codeSystem="2.16.840.1.113883.4.9"/><name>PIPERACILLIN ANHYDROUS</name></activeMoiety></activeMoiety>`;
const pipTazo = (quantity: string) => `<document><manufacturedProduct><manufacturedProduct>
	<code code="00000-0001" codeSystem="2.16.840.1.113883.6.69"/>
	<name>Piperacillin and Tazobactam</name>
	<formCode code="C42974" displayName="INJECTION, POWDER, FOR SOLUTION"/>
	${ingredient('ACTIM', 'PIPERACILLIN SODIUM', 'M98T69Q7HP', quantity, PIPERACILLIN_MOIETY)}
</manufacturedProduct></manufacturedProduct></document>`;
const PIP_VIAL = pipTazo(`<quantity><numerator value="2" unit="g"/><denominator value="1" unit="1"/></quantity>`);
const PIP_BAG = pipTazo(`<quantity><numerator value="2" unit="g"/><denominator value="50" unit="mL"/></quantity>`);
// 517.56 / 539.54
const PIPERACILLIN_FACTOR = new Map([['M98T69Q7HP', { moietyUnii: '9I628532GX', factor: '0.959261592' }]]);

test('piperacillin sodium stated as piperacillin keeps the SCD\'s 2 g', () => {
	for (const [xml, listed] of [
		[PIP_VIAL, '2 g/1'],
		[PIP_BAG, '2 g/50mL']
	]) {
		for (const rxNormName of ['piperacillin 2000 MG / tazobactam 250 MG Injection', null]) {
			const [product] = parseSplIngredients(xml);
			const [row] = checkProductStrengths(product, {
				rxNormName,
				moietyFactors: PIPERACILLIN_FACTOR,
				directory: [{ name: 'PIPERACILLIN SODIUM', strength: listed }]
			});
			assert.equal(row.strength, 2, `${listed}, ${rxNormName ?? 'no RxNorm'}`);
			assert.deepEqual(row.corrections, []);
		}
	}
});

test('RxNorm matches a moiety whatever its hydrate word', () => {
	// Rule 2 still corrects toward RxNorm when the label printed the salt's mass.
	const [product] = parseSplIngredients(
		pipTazo(`<quantity><numerator value="2.085" unit="g"/><denominator value="1" unit="1"/></quantity>`)
	);
	const [row] = checkProductStrengths(product, {
		rxNormName: 'piperacillin 2000 MG / tazobactam 250 MG Injection'
	});
	assert.equal(row.strength, 2);
	assert.equal(row.corrections[0].kind, 'salt-equivalent');
});
