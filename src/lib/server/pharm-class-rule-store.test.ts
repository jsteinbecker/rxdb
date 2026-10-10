import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeRuleClasses, RuleInputError } from '../pharm-class-rule-input';

test('trims, drops blanks and de-duplicates', () => {
	assert.deepEqual(normalizeRuleClasses([' A ', '', 'A', 'B'], 'replace'), ['A', 'B']);
});
test('rejects an empty list unless suppress', () => {
	assert.throws(() => normalizeRuleClasses([' '], 'add'), RuleInputError);
	assert.deepEqual(normalizeRuleClasses([], 'suppress'), []);
});
test('rejects a class over 160 characters', () => {
	assert.throws(() => normalizeRuleClasses(['x'.repeat(161)], 'replace'), RuleInputError);
	assert.equal(normalizeRuleClasses(['x'.repeat(160)], 'replace').length, 1);
});
