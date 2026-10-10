import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceIon, constituentName, ionDisplayName, isIonName } from '../ions';

test('every source spelling of an ion reads the same', () => {
	for (const name of ['CHLORIDE ION', 'Chloride anion', 'chloride']) assert.equal(ionDisplayName(name), 'Chloride ion (Cl⁻)');
	assert.equal(ionDisplayName('SODIUM CATION'), 'Sodium ion (Na⁺)');
	assert.equal(ionDisplayName('SODIUM (combined counterion)'), 'Sodium ion (Na⁺)');
	assert.equal(ionDisplayName('CALCIUM CATION'), 'Calcium ion (Ca²⁺)');
});

test('only ion names are rewritten', () => {
	assert.ok(isIonName('POTASSIUM CATION'));
	assert.ok(!isIonName('POTASSIUM CHLORIDE'));
	assert.equal(constituentName('VANCOMYCIN'), 'VANCOMYCIN');
});

test('declared mg and mEq of an ion are checked against each other', () => {
	assert.deepEqual(balanceIon('sodium', 57.5, 2.5), { balanced: true, expectedMEq: 2.5 });
	assert.equal(balanceIon('sodium', 57.5, 5)?.balanced, false);
	assert.equal(balanceIon('calcium', 40, 2)?.balanced, true);
	assert.equal(balanceIon('unobtainium', 1, 1), null);
});
