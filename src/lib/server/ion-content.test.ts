import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ionDeclarationsFromLabel, ionRows } from './ion-content';
import type { LabelIngredient } from './catalog-providers';

const active = (name: string, unii: string, strength: string, extra: Partial<LabelIngredient> = {}): LabelIngredient => ({
	name,
	unii,
	kind: 'active',
	basis: 'ingredient',
	strength,
	moieties: [],
	productCode: null,
	...extra
});
const CEFTRIAXONE = { formula: 'C18H16N8Na2O7S3.7/2H2O', mw: 661.6 };

test('sodium is computed from the salt for every package, with no label statement', () => {
	const [row] = ionRows([active('CEFTRIAXONE SODIUM', 'CEF', '1 g/1')], new Map([['CEF', CEFTRIAXONE]]), new Map(), []);
	assert.equal(row.strength, '69.5 mg (3.02 mEq)');
	assert.equal(row.basis, 'ion constituent (from salt formula)');
	assert.deepEqual(row.ionicContent?.sourceIngredients, ['CEFTRIAXONE SODIUM']);
	assert.equal(row.strengthNotes, undefined);
});

test('a moiety-basis strength is turned back into the salt mass first', () => {
	// 1 g ceftriaxone as moiety; moiety/salt factor 554.6/661.6.
	const [row] = ionRows(
		[active('CEFTRIAXONE SODIUM', 'CEF', '1 g/1', { basis: 'moiety' })],
		new Map([['CEF', CEFTRIAXONE]]),
		new Map([['CEF', 554.6 / 661.6]]),
		[]
	);
	assert.equal(row.strength, '82.9 mg (3.61 mEq)');
});

test('salts sharing a denominator add up; per-mL strengths keep their denominator', () => {
	const rows = ionRows(
		[active('SODIUM CHLORIDE', 'NACL', '9 mg/1 mL'), active('POTASSIUM CHLORIDE', 'KCL', '1.5 mg/1 mL'), active('SODIUM LACTATE', 'NALAC', '3.1 mg/1 mL')],
		new Map([
			['NACL', { formula: 'ClNa', mw: 58.44 }],
			['KCL', { formula: 'ClK', mw: 74.55 }],
			['NALAC', { formula: 'C3H5NaO3', mw: 112.06 }]
		]),
		new Map(),
		[]
	);
	assert.deepEqual(rows.map((r) => r.strength), ['4.18 mg/mL (0.182 mEq/mL)', '0.787 mg/mL (0.0201 mEq/mL)']);
	assert.deepEqual(rows[0].ionicContent?.sourceIngredients, ['SODIUM CHLORIDE', 'SODIUM LACTATE']);
});

test('a label statement checks the computed figure, and stands in without a formula', () => {
	const [checked] = ionRows([active('CEFTRIAXONE SODIUM', 'CEF', '1 g/1')], new Map([['CEF', CEFTRIAXONE]]), new Map(), [
		{ ion: 'sodium', massMg: 83, mEq: 3.6 }
	]);
	assert.match(checked.strengthNotes?.[0] ?? '', /formula gives 69.5 mg/);
	const [fallback] = ionRows([active('CEFTRIAXONE SODIUM', 'CEF', '1 g/1')], new Map(), new Map(), [
		{ ion: 'sodium', massMg: 83, mEq: 3.6 }
	]);
	assert.equal(fallback.strength, '83 mg (3.6 mEq)');
	assert.equal(fallback.basis, 'ion constituent (label total)');
});

test('label statements are read in either order, in any section, only for this NDC', () => {
	const text =
		'Each 1 g vial contains approximately 83 mg (3.6 mEq) sodium. NDC 0409-7332-01. ' +
		'Sodium content: 7.2 mEq (166 mg) per 2 g vial, NDC 0409-7335-01.';
	assert.deepEqual(ionDeclarationsFromLabel([null, text], '00409733201'), [{ ion: 'sodium', massMg: 83, mEq: 3.6 }]);
	assert.deepEqual(ionDeclarationsFromLabel([text], '00409733501'), [{ ion: 'sodium', massMg: 166, mEq: 7.2 }]);
	assert.deepEqual(ionDeclarationsFromLabel([text], '00409999901'), []);
});
