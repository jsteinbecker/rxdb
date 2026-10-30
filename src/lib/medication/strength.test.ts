import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStrength } from './strength-storage';
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
