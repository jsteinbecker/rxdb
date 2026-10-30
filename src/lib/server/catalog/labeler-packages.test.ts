import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labeledFormat, zeroSegment } from './labeler-packages';

const pkg = (ndc: string, productCode: string | null = null) => ({ ndc, productCode });

test('a hyphenated product NDC states the format outright', () => {
	assert.deepEqual(labeledFormat(pkg('00143916201', '0143-9162')), {
		format: '4-4-2',
		basis: 'labeled'
	});
	assert.deepEqual(labeledFormat(pkg('25021032104', '25021-321')), {
		format: '5-3-2',
		basis: 'labeled'
	});
	assert.deepEqual(labeledFormat(pkg('63323026201', '63323-262')), {
		format: '5-3-2',
		basis: 'labeled'
	});
	assert.deepEqual(labeledFormat(pkg('12345678901', '12345-6789')), {
		format: '5-4-1',
		basis: 'labeled'
	});
});

test('without a product NDC, only one segment able to drop a zero decides it', () => {
	assert.deepEqual(labeledFormat(pkg('12345678901')), { format: '5-4-1', basis: 'inferred' });
	assert.deepEqual(labeledFormat(pkg('12345067810')), { format: '5-3-2', basis: 'inferred' });
	assert.equal(labeledFormat(pkg('01234067801')), null);
});

test('a 4-digit labeler code puts the zero in the first segment for every NDC', () => {
	const result = zeroSegment('00143', [pkg('00143916201', '0143-9162'), pkg('00143010101')]);
	assert.equal(result.segment, 'first');
	assert.equal(result.basis, 'inferred');
});

test('a labeler code without a leading zero rules out the first segment', () => {
	const result = zeroSegment('63323', [pkg('63323026201', '63323-262'), pkg('63323047010')]);
	assert.equal(result.segment, 'second');
	assert.deepEqual(result.counts, { '4-4-2': 0, '5-3-2': 2, '5-4-1': 0, unknown: 0 });
});

test('the labeler’s consistent format fills in undetermined packages', () => {
	const result = zeroSegment('12345', [pkg('12345067801'), pkg('12345678901', '12345-6789')]);
	assert.equal(result.segment, 'third');
	assert.equal(result.basis, 'inferred');
});

test('conflicting formats are reported as mixed', () => {
	const result = zeroSegment('12345', [
		pkg('12345678901', '12345-6789'),
		pkg('12345012302', '12345-123')
	]);
	assert.equal(result.segment, 'mixed');
});
