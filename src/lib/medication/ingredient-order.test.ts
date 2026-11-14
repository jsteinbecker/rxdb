import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	nameIngredients,
	orderIngredients,
	orderNameIngredients,
	parseIngredientOrder
} from './ingredient-order';

const augmentin = 'amoxicillin 875 MG / clavulanate potassium 125 MG Oral Tablet';

test('orderNameIngredients moves each strength with its own ingredient', () => {
	assert.equal(
		orderNameIngredients(augmentin, ['clavulanate', 'amoxicillin']),
		'clavulanate potassium 125 MG / amoxicillin 875 MG Oral Tablet'
	);
	assert.equal(
		orderNameIngredients(
			'piperacillin 2000 MG / tazobactam 250 MG Injection [Zosyn]',
			['tazobactam']
		),
		'tazobactam 250 MG / piperacillin 2000 MG Injection [Zosyn]'
	);
});

test('orderNameIngredients keeps concentrations and three-way combos intact', () => {
	const name = 'EPINEPHrine 0.01 MG/ML / lidocaine hydrochloride 10 MG/ML Injectable Solution';
	assert.equal(
		orderNameIngredients(name, ['lidocaine', 'epinephrine']),
		'lidocaine hydrochloride 10 MG/ML / EPINEPHrine 0.01 MG/ML Injectable Solution'
	);
	assert.equal(
		orderNameIngredients('a 1 MG / b 2 MG / c 3 MG Oral Tablet', ['c']),
		'c 3 MG / a 1 MG / b 2 MG Oral Tablet'
	);
});

test('orderNameIngredients leaves names it cannot split whole', () => {
	assert.equal(orderNameIngredients('amoxicillin 500 MG Oral Capsule', ['x']), 'amoxicillin 500 MG Oral Capsule');
	const odd = 'Custom Pack Oral Kit / something';
	assert.equal(orderNameIngredients(odd, ['something']), odd);
	assert.equal(orderNameIngredients(augmentin, []), augmentin);
});

test('orderIngredients ranks unnamed ingredients last, in their own order', () => {
	const rows = [
		{ name: 'A', strength: '1' },
		{ name: 'B', strength: '2' },
		{ name: 'C', strength: '3' }
	];
	assert.deepEqual(
		orderIngredients(rows, ['c'], (row) => row.name).map((row) => `${row.name}${row.strength}`),
		['C3', 'A1', 'B2']
	);
});

test('parseIngredientOrder keys by substance and drops repeats', () => {
	assert.deepEqual(parseIngredientOrder(['Clavulanate Potassium', 'clavulanate', ' ', 3, 'Amoxicillin']), [
		'clavulanate',
		'amoxicillin'
	]);
	assert.deepEqual(nameIngredients(augmentin), ['amoxicillin', 'clavulanate potassium']);
});
