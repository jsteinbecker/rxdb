import assert from 'node:assert/strict';
import { test } from 'node:test';
import { badgeText, editNdc, editState, evidenceText, supersedeItem, supersedesText } from '../local-concept-list.ts';

test('supersedesText marks stopped mappings and tolerates a missing name', () => {
  assert.equal(supersedesText(null), 'Nothing');
  assert.equal(supersedesText({ rxcui: '1', name: 'A', active: true }), 'RxCUI 1 · A');
  assert.equal(supersedesText({ rxcui: '1', name: null, active: false }), 'RxCUI 1 (stopped)');
});

test('editState allows edit only for an active mapping with a valid evidence NDC', () => {
  const evidence = { ndc: '00264193310' };
  assert.deepEqual(editState({ supersedes: { active: true }, evidence }), { ndc: '00264193310' });
  const stopped = editState({ supersedes: { active: false }, evidence });
  assert.equal(stopped.ndc, null);
  assert.match(stopped.reason ?? '', /Supersede again/);
  const never = editState({ supersedes: null, evidence });
  assert.match(never.reason ?? '', /Not superseding anything; choose Supersede…/);
  assert.equal(editState({ supersedes: { active: true }, evidence: { ndc: null } }).ndc, null);
});

test('supersedeItem: Supersede… when never mapped, Supersede again when stopped, none when active', () => {
  assert.deepEqual(supersedeItem({ supersedes: null }), { action: 'localConceptSupersede', label: 'Supersede…' });
  assert.deepEqual(supersedeItem({ supersedes: { active: false } }), {
    action: 'localConceptResupersede',
    label: 'Supersede again'
  });
  assert.equal(supersedeItem({ supersedes: { active: true } }), null);
});

test('evidenceText, editNdc and badgeText', () => {
  assert.equal(evidenceText({ setId: 'abc', version: '3' }), 'abc · v3');
  assert.equal(editNdc('00264193310'), '00264193310');
  assert.equal(editNdc(null), null);
  assert.equal(editNdc('../x'), null);
  assert.equal(badgeText({ code: 'LC000001', supersedes: { rxcui: '99' } }), 'Local concept LC000001 · supersedes RxCUI 99');
});
