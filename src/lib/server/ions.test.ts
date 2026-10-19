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

test('electrolyte salts deliver the textbook mEq', () => {
	// What every nurse checks against: 0.9 g NaCl is 15.4 mEq Na, 1.49 g KCl is 20 mEq K.
	assert.deepEqual(ionFromSalt({ formula: 'NaCl', mw: 58.44 }, 900, 'sodium'), { massMg: 354, mEq: 15.4 });
	assert.deepEqual(ionFromSalt({ formula: 'KCl', mw: 74.55 }, 1490, 'potassium'), { massMg: 781, mEq: 20 });
	// Calcium chloride dihydrate 1 g is 13.6 mEq, the figure on the vial.
	assert.deepEqual(ionFromSalt({ formula: 'CaCl2.2H2O', mw: 147.01 }, 1000, 'calcium'), { massMg: 273, mEq: 13.6 });
	assert.equal(balanceIon('potassium', 1564, 40)?.balanced, true);
});

test('a salt with no formula, no weight or none of the ion gives nothing', () => {
	assert.equal(ionFromSalt({ formula: 'NaCl', mw: 0 }, 900, 'sodium'), null);
	assert.equal(ionFromSalt({ formula: null, mw: 58.44 }, 900, 'sodium'), null);
	assert.equal(ionFromSalt({ formula: 'C6H12O6', mw: 180.16 }, 900, 'sodium'), null);
	assert.equal(ionFromSalt({ formula: 'NaCl', mw: 58.44 }, 0, 'sodium'), null);
	assert.equal(balanceIon('sodium', 0, 1), null);
	assert.equal(balanceIon('unobtainium', 10, 1), null);
});

test('unreadable formulas are refused rather than miscounted', () => {
	assert.equal(ionAtoms('C6H11O7)2Ca', 'calcium'), null);
	assert.equal(ionAtoms('(C6H11O7', 'calcium'), null);
	assert.equal(ionAtoms('', 'sodium'), null);
	assert.equal(ionAtoms('   ', 'sodium'), null);
	// Covalent halogens are never counted as ions.
	assert.equal(ionAtoms('NaCl', 'chloride'), null);
	// A dotted count on the cation part.
	assert.equal(ionAtoms('C10H12N2O8.2Na.2H2O', 'sodium'), 2);
});

test('a decimal hydrate count is read, not refused', () => {
	assert.equal(ionAtoms('C18H16N8Na2O7S3.3.5H2O', 'sodium'), 2);
	assert.equal(ionAtoms('2.5Na2CO3.H2O', 'sodium'), 5);
	// A dot between parts is still a separator, a leading count still a count.
	assert.equal(ionAtoms('C6H5O7.3Na', 'sodium'), 3);
	assert.equal(ionAtoms('NaCl..H2O', 'sodium'), null);
});

test('counted cations in a salt name are found', () => {
	assert.deepEqual(cationsNamedIn('PEMETREXED DISODIUM HEPTAHYDRATE'), ['sodium']);
	assert.deepEqual(cationsNamedIn('TRISODIUM CITRATE DIHYDRATE'), ['sodium']);
	assert.deepEqual(cationsNamedIn('DIPOTASSIUM PHOSPHATE'), ['potassium']);
	assert.deepEqual(cationsNamedIn('EDETATE CALCIUM DISODIUM'), ['sodium', 'calcium']);
	// Only a cation word counts, not one that merely ends in its letters.
	assert.deepEqual(cationsNamedIn('PROSODIUM'), []);
});
