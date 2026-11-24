import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStrength } from './strength-storage';
import { parseStrengthParts, strengthIdentity, unitLabel } from './strength';
import { parseStrengthText } from './ingredient-correction';
import { strengthKey } from '../formulary/pharm-class-key';

test('storage and correction adapters accept the same strict strength grammar', () => {
	for (const text of [
		'.5 mg/mL',
		'5 [IU]/mL',
		'500 µg',
		'500 μg',
		'1,000 mg/5 mL',
		'5 mg per mL'
	]) {
		assert.ok(parseStrength(text), text);
		assert.ok(parseStrengthText(text), text);
	}
	for (const text of [
		'0 mg',
		'5 mg/0 mL',
		'5 mg/',
		'5 mg//mL',
		'5 mg/mL trailing',
		'1,00 mg',
		'5 mg + 2 mg'
	]) {
		assert.equal(parseStrength(text), null, text);
		assert.equal(parseStrengthText(text), null, text);
	}
});

test('classification strength keys retain decimal precision and share unit aliases', () => {
	const key = (strength: string) => strengthKey([{ moiety: null, strength }]);
	assert.notEqual(key('1.0000000000000001 mg'), key('1 mg'));
	assert.equal(key('500 µg/mL'), key('0.5 mg/mL'));
	assert.equal(key('500 μg/mL'), key('0.5 mg/mL'));
	assert.equal(key('5 [IU]/mL'), key('5 [IU]/1 mL'));
});

test('local comparison uses the same exact decimal and alias semantics as classification', async () => {
	const { sameStrength } = await import('../curation/local-concept');
	const strength = (value: string, unit = 'MG') => ({ name: 'drug', value, unit });
	assert.equal(sameStrength(strength('1.0000000000000001'), strength('1')), false);
	assert.equal(sameStrength(strength('1.0000000000000001'), strength('1.00000000000000010')), true);
	assert.equal(sameStrength(strength('.5'), strength('500', 'µg')), true);
	assert.equal(sameStrength(strength('0'), strength('0')), false);
});

test('SPL strength drops a container qualifier and a per-container denominator', () => {
	for (const text of [
		'5 g/1 VIAL, PHARMACY BULK PACKAGE',
		'5g/1VIAL,PHARMACYBULKPACKAGE',
		'5 g/1 VIAL',
		'5 g/1',
		'5 g'
	])
		assert.deepEqual(parseStrengthParts(text), { value: '5', unit: 'g', per: '1', perUnit: '' }, text);
});

test('SPL strength keeps a volume denominator and a multi-count one', () => {
	assert.equal(parseStrengthParts('1 g/20 mL, SINGLE-DOSE')?.perUnit, 'mL');
	assert.equal(parseStrengthParts('10 mg/2 TABLET')?.perUnit, 'TABLET');
	assert.equal(strengthIdentity('5 g/1 VIAL, PHARMACY BULK PACKAGE'), strengthIdentity('5000 mg'));
});

test('unitLabel spells units canonically', () => {
	assert.deepEqual(['ML', 'ml', 'L', 'DL', 'MG', '[iU]'].map(unitLabel), ['mL', 'mL', 'L', 'dL', 'mg', '[iU]']);
});
