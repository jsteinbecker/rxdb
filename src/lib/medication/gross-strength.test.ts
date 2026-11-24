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

test('the formulary item settles a volume the package does not give', () => {
	const count = { kind: 'count' as const, value: 36, unit: null };
	// A carton of bags: the SCD names the bag volume.
	const bag = grossStrength('9 mg/mL', { size: count, itemName: 'sodium chloride 0.9% 250ML Injection' });
	assert.equal(normalizeStrength(bag!.strength), '2.25g/250mL');
	// A bulk powder with no label volume: the SCD's total over the concentration.
	const bulk = { size: vial(100), isDryFill: true, resolvedVolume: null, itemName: 'vancomycin 10000 MG Injection (Bulk)' };
	assert.equal(normalizeStrength(grossStrength('100 mg/mL', bulk)!.strength), '10g');
	// A concentration-only SCD settles nothing.
	assert.equal(
		grossStrength('100 mg/mL', { size: null, itemName: 'amoxicillin 80 MG/ML Oral Suspension' })!.basis,
		'unresolved'
	);
});

test("an oral powder for suspension's bottle volume is its constituted volume", () => {
	const bottle = { size: vial(75), isDryFill: true, resolvedVolume: null, doseForm: 'POWDER, FOR SUSPENSION' };
	assert.equal(normalizeStrength(grossStrength('50 mg/mL', bottle)!.strength), '3.75g');
	// An injectable powder's packaging volume stays untrusted.
	assert.equal(
		grossStrength('50 mg/mL', { ...bottle, doseForm: 'INJECTION, POWDER, FOR SOLUTION' })!.basis,
		'unresolved'
	);
});
