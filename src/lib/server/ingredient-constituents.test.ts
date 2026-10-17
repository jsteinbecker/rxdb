import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nestIngredients, rxNormNames } from '../ingredient-constituents';
import type { LabelIngredient } from './catalog-providers';

const ing = (name: string, strength: string, moiety: string, basis = 'ingredient'): LabelIngredient => ({
	name,
	unii: null,
	kind: 'active',
	basis,
	strength,
	moieties: [{ name: moiety, unii: null }],
	productCode: null
});

test('ingredients a total adds up are grouped together under it', () => {
	const result = nestIngredients([
		ing('A SULFATE', '1 mg', 'a'),
		ing('B HCL', '2 mg', 'b'),
		ing('A ACETATE', '3 mg', 'a'),
		{ ...ing('LACTOSE', '', 'lactose'), kind: 'inactive', strength: null }
	], { rxNormName: 'a sulfate 1 MG / a acetate 3 MG / b 2 MG Oral Tablet' });
	assert.deepEqual(
		result.groups.map((g) => g.nodes.map((n) => n.ingredient.name)),
		[['A SULFATE', 'A ACETATE'], ['B HCL']]
	);
	assert.deepEqual(
		result.groups[0].totals.map((t) => [t.name, t.strength, t.sources]),
		[['a', '4 mg', ['A SULFATE', 'A ACETATE']]]
	);
	assert.deepEqual(result.others.map((n) => n.ingredient.name), ['LACTOSE']);
});

test('a whole shared moiety gets no row repeating its parent', () => {
	const result = nestIngredients([ing('N-ACETYL TYROSINE', '1 mg', 'tyrosine'), ing('TYROSINE', '3 mg', 'tyrosine')], {
		totalShared: true
	});
	assert.ok(result.nodes.every((node) => node.constituents.length === 0));
	assert.equal(result.totals.length, 1);
});

test('a salt mass is not added to a moiety mass', () => {
	const [total] = nestIngredients([ing('A SULFATE', '1 mg', 'a'), ing('A ACETATE', '3 mg', 'a', 'moiety')], {
		totalShared: true
	}).totals;
	assert.equal(total.strength, null);
	assert.equal(total.unsummed, 'basis');
});

// NDC 14537-817 (ACD-A): both citrate salts code anhydrous citric acid as their
// moiety, but they are a buffer pair, not one drug given as two salts.
const ACD_A = [
	ing('Citric Acid Monohydrate', '5.485 g', 'Anhydrous Citric Acid', 'moiety'),
	ing('Trisodium Citrate Dihydrate', '10.7775 g', 'Anhydrous Citric Acid', 'moiety')
];

test('a shared moiety RxNorm does not name gets no total', () => {
	const result = nestIngredients(ACD_A);
	assert.deepEqual(result.totals, []);
	assert.equal(result.groups.length, 2);
});

test('the product override forces totals on or off', () => {
	assert.equal(nestIngredients(ACD_A, { totalShared: true }).totals.length, 1);
	const adderall = [ing('AMPHETAMINE SULFATE', '1 mg', 'dextroamphetamine'), ing('DEXTROAMPHETAMINE SULFATE', '1 mg', 'dextroamphetamine')];
	const name = 'amphetamine sulfate 1 MG / dextroamphetamine sulfate 1 MG Oral Tablet';
	assert.equal(nestIngredients(adderall, { rxNormName: name }).totals.length, 1);
	assert.equal(nestIngredients(adderall, { rxNormName: name, totalShared: false }).totals.length, 0);
});

test('RxNorm names a moiety regardless of hydration or handedness', () => {
	assert.ok(rxNormNames('citric acid 8 MG/ML / sodium citrate 22 MG/ML', 'Anhydrous Citric Acid'));
	assert.ok(rxNormNames('amphetamine aspartate 1.25 MG Oral Tablet', 'levoamphetamine'));
	assert.ok(!rxNormNames('sodium citrate 22 MG/ML Injectable Solution', 'Anhydrous Citric Acid'));
	assert.ok(!rxNormNames(null, 'tyrosine'));
});
