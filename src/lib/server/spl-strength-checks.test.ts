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
