import assert from 'node:assert/strict';
import test from 'node:test';
import { isMadeUpForm, quarantineReason } from './quarantine.ts';

const row = { diluentMl: 78 } as never;
const powder = { doseForm: 'POWDER, FOR SUSPENSION', reconstitution: [] };

test('quarantines a powder with no reconstitution rows (50090-2251-0)', () => {
	assert.equal(quarantineReason(powder), 'reconstitution-missing');
	assert.equal(
		quarantineReason({ doseForm: 'INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION', reconstitution: [] }),
		'reconstitution-missing'
	);
});

test('clears once a row exists, a release is recorded, or the NDC is excluded', () => {
	assert.equal(quarantineReason({ ...powder, reconstitution: [row] }), null);
	assert.equal(quarantineReason({ ...powder, quarantineRelease: 'checked by hand' }), null);
	assert.equal(quarantineReason({ ...powder, manualExclusion: 'no 150 mL instructions' }), null);
});

test('leaves ready-to-use forms and dispersible tablets alone', () => {
	assert.equal(quarantineReason({ doseForm: 'INJECTION, SOLUTION', reconstitution: [] }), null);
	assert.equal(isMadeUpForm('TABLET, FOR SUSPENSION'), false);
	assert.equal(isMadeUpForm('GRANULE, FOR SUSPENSION'), true);
});

test('treats a dry fill as made up whatever its dose form says', () => {
	assert.equal(
		quarantineReason({ doseForm: 'INJECTION', isDryFill: true, reconstitution: [] }),
		'reconstitution-missing'
	);
});
