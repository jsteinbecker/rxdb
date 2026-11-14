import assert from 'node:assert/strict';
import test from 'node:test';
import { convertStrength, conversionFactor, roundSignificant } from './strength-conversion';

test('factor is MW(to) / (n · MW(from))', () => {
	assert.equal(conversionFactor(2, 1), '0.5');
	assert.equal(conversionFactor('513.6', '444.4', 1)?.slice(0, 8), '0.865264');
	assert.equal(conversionFactor(100, 100, 2), '0.5');
	assert.equal(conversionFactor(3, 1), '0.333333333333333333');
});

test('n above 1 scales the denominator', () => {
	assert.equal(conversionFactor(50, 100, 2), '1');
	assert.equal(conversionFactor('50.5', 100, '2.5')?.slice(0, 6), '0.7920');
});

test('converts a strength by an exact factor', () => {
	assert.equal(convertStrength(500, '0.5'), '250');
	assert.equal(convertStrength('2.5', '0.1'), '0.25');
	const factor = conversionFactor('444.4', '513.6')!;
	assert.equal(roundSignificant(convertStrength(500, factor)!), '577.9');
});

test('relabel only is the identity factor', () => {
	assert.equal(convertStrength('500', '1'), '500');
});

test('rounds to significant digits', () => {
	assert.equal(roundSignificant('577.9338'), '577.9');
	assert.equal(roundSignificant('0.0012345'), '0.001235');
	assert.equal(roundSignificant('123456'), '123500');
	assert.equal(roundSignificant('12'), '12');
});

test('rejects non-positive and non-numeric inputs', () => {
	assert.equal(conversionFactor(0, 5), null);
	assert.equal(conversionFactor(-1, 5), null);
	assert.equal(conversionFactor(5, 5, 0), null);
	assert.equal(conversionFactor('abc', 5), null);
	assert.equal(conversionFactor(NaN, 5), null);
	assert.equal(convertStrength('x', '1'), null);
	assert.equal(convertStrength(5, '0'), null);
});
