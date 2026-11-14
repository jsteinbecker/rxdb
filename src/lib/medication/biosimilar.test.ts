import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withBiosimilarSuffix } from './biosimilar';
import { correctedIngredients } from '../catalog/package-title';
import { buildTree, ingredientLabel, type FormularyRow } from '../formulary/hierarchy';

test('the suffix is recovered from the generic name or title', () => {
	assert.equal(withBiosimilarSuffix('ADALIMUMAB', ['adalimumab-adaz']), 'ADALIMUMAB-ADAZ');
	assert.equal(
		withBiosimilarSuffix('INSULIN GLARGINE', ['HOMEPLEX- insulin glargine-yfgn injection']),
		'INSULIN GLARGINE-YFGN'
	);
	assert.equal(withBiosimilarSuffix('adalimumab', ['Adalimumab-AACF']), 'adalimumab-aacf');
});

test('reference products and look-alikes are left alone', () => {
	assert.equal(withBiosimilarSuffix('ADALIMUMAB', ['adalimumab']), 'ADALIMUMAB');
	assert.equal(withBiosimilarSuffix('ADALIMUMAB-ADAZ', ['adalimumab-aacf']), 'ADALIMUMAB-ADAZ');
	assert.equal(
		withBiosimilarSuffix('SULFAMETHOXAZOLE', ['sulfamethoxazole-trimethoprim']),
		'SULFAMETHOXAZOLE'
	);
	assert.equal(withBiosimilarSuffix('INSULIN', ['insulin glargine-yfgn']), 'INSULIN');
});

test('a biosimilar stays a separate ingredient from its reference', () => {
	assert.deepEqual(
		correctedIngredients({
			genericName: 'adalimumab-adaz',
			ingredients: [{ name: 'ADALIMUMAB', strength: '40 mg/0.8mL' }]
		}).map((ingredient) => ingredient.name),
		['ADALIMUMAB-ADAZ']
	);
	const row = (id: string, name: string): FormularyRow => ({
		packageId: id,
		ndc: id,
		formularyItemId: 'x',
		formularyItem: 'x',
		description: null,
		routes: [],
		doseForm: null,
		ingredients: [{ name, strength: null }],
		brandName: null,
		genericName: null,
		labeler: null,
		size: null,
		isMultiDose: null,
		preferenceRank: 1,
		status: 'active'
	});
	assert.equal(ingredientLabel('ADALIMUMAB-ADAZ'), 'Adalimumab-adaz');
	assert.deepEqual(
		buildTree([row('1', 'ADALIMUMAB'), row('2', 'ADALIMUMAB-ADAZ')], ['ingredientCombo']).map(
			(n) => n.label
		),
		['Adalimumab', 'Adalimumab-adaz']
	);
});
