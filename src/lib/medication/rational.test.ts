import assert from 'node:assert/strict';
import test from 'node:test';
import {
	compare,
	divide,
	equals,
	fromNumber,
	isRational,
	multiply,
	parseRational,
	rational
} from './rational';

const max = Number.MAX_SAFE_INTEGER;

test('rational inputs reject unsafe integers and fractional numerator/denominator objects', () => {
	assert.equal(rational(max + 1), null);
	assert.equal(rational(1, max + 1), null);
	assert.equal(fromNumber(max + 1), null);
	assert.equal(isRational({ n: 1.5, d: 2 }), false);
	assert.equal(parseRational({ n: max + 1, d: 1 }), null);
	assert.equal(parseRational('9007199254740992'), null);
});

test('arithmetic refuses results outside the safe representation', () => {
	assert.equal(multiply({ n: max, d: 1 }, { n: 3, d: 1 }), null);
	assert.equal(divide({ n: max, d: 1 }, { n: 1, d: 3 }), null);
	assert.equal(divide({ n: 1, d: 2 }, { n: 0, d: 1 }), null);
});

test('large intermediate products reduce exactly before the safety check', () => {
	assert.deepEqual(multiply({ n: max, d: 2 }, { n: 2, d: max }), { n: 1, d: 1 });
	assert.deepEqual(divide({ n: max, d: 2 }, { n: max, d: 2 }), { n: 1, d: 1 });
	// Adjacent products differ by one but round to the same floating-point value.
	const a = { n: max, d: max - 1 };
	const b = { n: max - 1, d: max - 2 };
	assert.equal(equals(a, b), false);
	assert.ok(compare(a, b) < 0);
});
