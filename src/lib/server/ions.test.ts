import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceIon, cationsNamedIn, constituentName, ionAtoms, ionDisplayName, ionFromSalt, isIonName } from '../ions';

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

test('an ion is counted in a GSRS formula, across dotted parts and hydrates', () => {
	assert.equal(ionAtoms('C16H18N3NaO4S', 'sodium'), 1);
	assert.equal(ionAtoms('C18H16N8Na2O7S3.7/2H2O', 'sodium'), 2);
	assert.equal(ionAtoms('C16H18N3O4S.Na', 'sodium'), 1);
	assert.equal(ionAtoms('2C6H11O7.Ca', 'calcium'), 1);
	assert.equal(ionAtoms('(C6H11O7)2Ca.H2O', 'calcium'), 1);
	assert.equal(ionAtoms('3C6H5O7.2K.Na', 'potassium'), 2);
	assert.equal(ionAtoms('C8H10N4O2', 'sodium'), 0);
	assert.equal(ionAtoms('', 'sodium'), null);
	assert.equal(ionAtoms('C2H3O2', 'acetate'), null);
});

test('a salt mass becomes the ion mass and mEq it delivers', () => {
	// Ceftriaxone sodium (C18H16N8Na2O7S3·3.5H2O, 661.6): 1 g → 69.5 mg, 3.02 mEq.
	assert.deepEqual(ionFromSalt({ formula: 'C18H16N8Na2O7S3.7/2H2O', mw: 661.6 }, 1000, 'sodium'), {
		massMg: 69.5,
		mEq: 3.02
	});
	// Sodium chloride: 900 mg → 354 mg, 15.4 mEq.
	assert.deepEqual(ionFromSalt({ formula: 'ClNa', mw: 58.44 }, 900, 'sodium'), { massMg: 354, mEq: 15.4 });
	assert.equal(ionFromSalt({ formula: 'C8H10N4O2', mw: 194 }, 100, 'sodium'), null);
	assert.equal(ionFromSalt({ formula: 'ClNa', mw: null }, 100, 'sodium'), null);
});

test('salt names say which cations to look for', () => {
	assert.deepEqual(cationsNamedIn('CEFTRIAXONE SODIUM'), ['sodium']);
	assert.deepEqual(cationsNamedIn('Potassium Citrate and Sodium Citrate'), ['sodium', 'potassium']);
	assert.deepEqual(cationsNamedIn('MAGNESIUM SULFATE HEPTAHYDRATE'), ['magnesium']);
	assert.deepEqual(cationsNamedIn('VANCOMYCIN HYDROCHLORIDE'), []);
});
