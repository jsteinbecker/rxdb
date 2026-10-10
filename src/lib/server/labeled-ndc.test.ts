import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labeledNdc } from '../ndc';

test('labeledNdc rebuilds the printed hyphenation from the labeled product code', () => {
	assert.equal(labeledNdc('00409488710', '0409-4887'), '0409-4887-10');
	assert.equal(labeledNdc('42367054032', '42367-540'), '42367-540-32');
	assert.equal(labeledNdc('76329331601', '76329-3316'), '76329-3316-1');
});

test('labeledNdc refuses a product code that does not belong to the NDC', () => {
	assert.equal(labeledNdc('00409488710', '0409-4888'), null);
	assert.equal(labeledNdc('00409488710', null), null);
	assert.equal(labeledNdc('0409-4887-10', '0409-4887'), null);
});
