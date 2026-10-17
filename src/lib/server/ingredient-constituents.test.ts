import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nestIngredients } from '../ingredient-constituents';
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
	]);
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
	const result = nestIngredients([ing('N-ACETYL TYROSINE', '1 mg', 'tyrosine'), ing('TYROSINE', '3 mg', 'tyrosine')]);
	assert.ok(result.nodes.every((node) => node.constituents.length === 0));
	assert.equal(result.totals.length, 1);
});

test('a salt mass is not added to a moiety mass', () => {
	const [total] = nestIngredients([ing('A SULFATE', '1 mg', 'a'), ing('A ACETATE', '3 mg', 'a', 'moiety')]).totals;
	assert.equal(total.strength, null);
	assert.equal(total.unsummed, 'basis');
});
