import assert from 'node:assert/strict';
import { test } from 'node:test';
import { badgeText, editNdc, evidenceText, supersedesText } from '../local-concept-list.ts';

test('supersedesText marks stopped mappings and tolerates a missing name', () => {
  assert.equal(supersedesText(null), 'Nothing');
  assert.equal(supersedesText({ rxcui: '1', name: 'A', active: true }), 'RxCUI 1 · A');
  assert.equal(supersedesText({ rxcui: '1', name: null, active: false }), 'RxCUI 1 (stopped)');
});

test('evidenceText, editHref and badgeText', () => {
  assert.equal(evidenceText({ setId: 'abc', version: '3' }), 'abc · v3');
  assert.equal(editNdc('00264193310'), '00264193310');
  assert.equal(editNdc(null), null);
  assert.equal(editNdc('../x'), null);
  assert.equal(badgeText({ code: 'LC000001', supersedes: { rxcui: '99' } }), 'Local concept LC000001 · supersedes RxCUI 99');
});
