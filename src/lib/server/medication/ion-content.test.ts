import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ionDeclarationsFromLabel, ionRows } from './ion-content';
import type { LabelIngredient } from '../../catalog/types';

const active = (
	name: string,
	unii: string,
	strength: string,
	extra: Partial<LabelIngredient> = {}
): LabelIngredient => ({
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
	const [row] = ionRows(
		[active('CEFTRIAXONE SODIUM', 'CEF', '1 g/1')],
		new Map([['CEF', CEFTRIAXONE]]),
		new Map(),
		[]
	);
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
		[
			active('SODIUM CHLORIDE', 'NACL', '9 mg/1 mL'),
			active('POTASSIUM CHLORIDE', 'KCL', '1.5 mg/1 mL'),
			active('SODIUM LACTATE', 'NALAC', '3.1 mg/1 mL')
		],
		new Map([
			['NACL', { formula: 'ClNa', mw: 58.44 }],
			['KCL', { formula: 'ClK', mw: 74.55 }],
			['NALAC', { formula: 'C3H5NaO3', mw: 112.06 }]
		]),
		new Map(),
		[]
	);
	assert.deepEqual(
		rows.map((r) => r.strength),
		['4.18 mg/mL (0.182 mEq/mL)', '0.787 mg/mL (0.0201 mEq/mL)']
	);
	assert.deepEqual(rows[0].ionicContent?.sourceIngredients, ['SODIUM CHLORIDE', 'SODIUM LACTATE']);
});

test('a label total beats the formula it disagrees with, and stands in without a formula', () => {
	// Zosyn: the label's 5.58 mEq counts its citrate buffer's sodium too, which
	// no active salt's formula can see. What the label declares is shown.
	const [checked] = ionRows(
		[active('CEFTRIAXONE SODIUM', 'CEF', '1 g/1')],
		new Map([['CEF', CEFTRIAXONE]]),
		new Map(),
		[{ ion: 'sodium', massMg: 83, mEq: 3.6 }]
	);
	assert.equal(checked.strength, '83 mg (3.6 mEq)');
	assert.equal(checked.basis, 'ion constituent (label total)');
	assert.match(checked.strengthNotes?.[0] ?? '', /formula gives 69.5 mg/);
	// A statement within 5% only confirms the computation.
	const [agreeing] = ionRows(
		[active('CEFTRIAXONE SODIUM', 'CEF', '1 g/1')],
		new Map([['CEF', CEFTRIAXONE]]),
		new Map(),
		[{ ion: 'sodium', massMg: 70, mEq: 3.04 }]
	);
	assert.equal(agreeing.strength, '69.5 mg (3.02 mEq)');
	assert.equal(agreeing.basis, 'ion constituent (from salt formula)');
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
	assert.deepEqual(ionDeclarationsFromLabel([null, text], '00409733201'), [
		{ ion: 'sodium', massMg: 83, mEq: 3.6 }
	]);
	assert.deepEqual(ionDeclarationsFromLabel([text], '00409733501'), [
		{ ion: 'sodium', massMg: 166, mEq: 7.2 }
	]);
	assert.deepEqual(ionDeclarationsFromLabel([text], '00409999901'), []);
});

test('a per-gram label statement is scaled by the drug it is per gram of', () => {
	// Zosyn (Galaxy bags): "2.84 mEq (65 mg) of sodium (Na + ) per gram of
	// piperacillin". Its citrate buffer's sodium is in that figure; the
	// salts' formulas alone give 4.69 mEq for the 2 g bag, not 5.68.
	const text =
		'ZOSYN contains a total of 2.84 mEq (65 mg) of sodium (Na + ) per gram of piperacillin in the combination product.';
	const declared = ionDeclarationsFromLabel([text], '00206886001');
	assert.deepEqual(declared, [{ ion: 'sodium', massMg: 65, mEq: 2.84, perGramOf: 'piperacillin' }]);
	const salts = new Map([
		['PIP', { formula: 'C23H26N5NaO7S', mw: 539.54 }],
		['TAZ', { formula: 'C10H11N4NaO5S', mw: 322.27 }]
	]);
	const moiety = (name: string) => ({ basis: 'moiety', moieties: [{ name, unii: null }] });
	const [row] = ionRows(
		[
			active('PIPERACILLIN SODIUM', 'PIP', '2 g', moiety('PIPERACILLIN ANHYDROUS')),
			active('TAZOBACTAM SODIUM', 'TAZ', '250 mg', moiety('TAZOBACTAM'))
		],
		salts,
		new Map([
			['PIP', 517.55 / 539.54],
			['TAZ', 300.29 / 322.27]
		]),
		declared
	);
	assert.equal(row.strength, '130 mg (5.68 mEq)');
	assert.equal(row.basis, 'ion constituent (label total)');
	assert.match(row.strengthNotes?.[0] ?? '', /per gram of piperacillin/);
	// Without a row measuring piperacillin itself there is nothing to scale by.
	const [unscaled] = ionRows(
		[active('TAZOBACTAM SODIUM', 'TAZ', '250 mg', moiety('TAZOBACTAM'))],
		salts,
		new Map([['TAZ', 300.29 / 322.27]]),
		declared
	);
	assert.equal(unscaled.basis, 'ion constituent (from salt formula)');
});
