import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedPackageRevision, PackageConflict } from './package-state-store';

test('edit revisions reject absent, malformed, fractional and unsafe form values', () => {
	for (const value of [undefined, null, 0, '', '-1', '1.5', '1e2', ' 1', '9007199254740992'])
		assert.throws(() => expectedPackageRevision(value), PackageConflict);
	assert.equal(expectedPackageRevision('0'), 0);
	assert.equal(expectedPackageRevision('42'), 42);
});
