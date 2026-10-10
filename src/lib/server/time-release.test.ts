import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abbreviatedRelease, parseReleaseAbbreviation, releasePeriod } from '../time-release';

const bupropion = 'bupropion hydrochloride 150 MG Extended Release (12 HR) Oral Tablet';

test('releasePeriod finds leading, placed and missing periods', () => {
  assert.equal(releasePeriod(bupropion), '12 HR');
  assert.equal(releasePeriod('24 HR metoprolol succinate 100 MG Extended Release Oral Tablet'), '24 HR');
  assert.equal(releasePeriod('metformin 500 MG Oral Tablet'), null);
  assert.equal(releasePeriod('omeprazole 20 MG Delayed Release Oral Capsule'), null);
});

test('abbreviatedRelease swaps the modifier and period', () => {
  assert.equal(abbreviatedRelease(bupropion, 'SR'), 'bupropion hydrochloride 150 MG SR Oral Tablet');
  assert.equal(
    abbreviatedRelease('24 HR bupropion hydrochloride 150 MG Extended Release Oral Tablet', 'XR'),
    'bupropion hydrochloride 150 MG XR Oral Tablet'
  );
  assert.equal(abbreviatedRelease(bupropion, null), bupropion);
  assert.equal(abbreviatedRelease('metformin 500 MG Oral Tablet', 'XR'), 'metformin 500 MG Oral Tablet');
});

test('parseReleaseAbbreviation upper-cases, clears and rejects', () => {
  assert.deepEqual(parseReleaseAbbreviation(' sr '), { abbreviation: 'SR' });
  assert.deepEqual(parseReleaseAbbreviation(''), { abbreviation: null });
  assert.ok('error' in parseReleaseAbbreviation('S R'));
  assert.ok('error' in parseReleaseAbbreviation('TOOLONGABBR'));
});
