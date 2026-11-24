import assert from 'node:assert/strict';
import test from 'node:test';
import { grossIngredients, grossStrength } from './gross-strength';
import { normalizeStrength } from '../formulary/hierarchy';

const vial = (value: number, unit = 'mL') => ({ kind: 'volume' as const, value, unit });

test('a liquid concentration becomes the container total over its volume', () => {
	const gross = grossStrength('100 mg/mL', { size: vial(100) });
	assert.deepEqual(gross, { strength: '10000 mg/100 mL', basis: 'gross' });
	assert.equal(normalizeStrength(gross!.strength), '10g/100mL');
	assert.equal(normalizeStrength(grossStrength('5 mg/5 mL', { size: vial(473) })!.strength), '473mg/473mL');
	assert.equal(normalizeStrength(grossStrength('1 g/10 mL', { size: vial(0.01, 'L') })!.strength), '1g/10mL');
});

test('a dry-fill powder reads as its mass, from the label-resolved volume only', () => {
	const powder = { size: vial(250), isDryFill: true, resolvedVolume: { finalVolumeMl: 100 } };
	assert.equal(normalizeStrength(grossStrength('100 mg/mL', powder)!.strength), '10g');
	// The packaging volume of a powder may be diluent or capacity: never trusted.
	assert.deepEqual(
		grossStrength('100 mg/mL', { size: vial(250), isDryFill: true, resolvedVolume: null }),
		{ strength: '100 mg/mL', basis: 'unresolved' }
	);
});

test('a concentration with no volume is flagged, not passed off as contents', () => {
	const count = { kind: 'count' as const, value: 1, unit: 'VIAL' };
	assert.equal(grossStrength('100 mg/mL', { size: count })!.basis, 'unresolved');
	assert.equal(grossStrength('100 mg/mL', { size: null })!.basis, 'unresolved');
	const { concentrationOnly } = grossIngredients([{ name: 'x', strength: '2 mg/mL' }], { size: null });
	assert.equal(concentrationOnly, true);
});

test('amounts per unit are left alone', () => {
	for (const strength of ['500 mg', '5 g/1 VIAL, PHARMACY BULK PACKAGE', '10 mg/2 TABLET'])
		assert.equal(grossStrength(strength, { size: null })!.basis, 'as-is');
	assert.equal(grossStrength(null, { size: null }), null);
	assert.equal(grossIngredients([{ name: 'x', strength: '500 mg' }], { size: null }).concentrationOnly, false);
});

test('an unresolved dry-fill powder takes the RxNorm concept’s per-vial mass', () => {
	const bulk = {
		size: vial(100),
		isDryFill: true,
		resolvedVolume: null,
		conceptStrengths: [{ name: 'vancomycin', value: 10000, unit: 'MG', perUnit: null }]
	};
	assert.equal(normalizeStrength(grossStrength('100 mg/mL', bulk, 'VANCOMYCIN')!.strength), '10g');
	// A concept stated as a concentration settles nothing.
	const conc = { ...bulk, conceptStrengths: [{ name: 'vancomycin', value: 100, unit: 'MG', perUnit: 'ML' }] };
	assert.equal(grossStrength('100 mg/mL', conc, 'VANCOMYCIN')!.basis, 'unresolved');
});
