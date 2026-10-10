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
