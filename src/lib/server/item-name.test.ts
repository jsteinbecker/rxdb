import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemName, parseNameOverride, strengthAsPercent } from '../item-name';

const glucose = 'Glucose 12500 MG/250ML Injection';

test('itemName uses the override, then the percent form', () => {
	assert.equal(itemName(glucose, { nameOverride: null, strengthAsPercent: false }), glucose);
	const dextrose = 'Dextrose 12500 MG/250ML Injection';
	assert.equal(itemName(glucose, { nameOverride: dextrose, strengthAsPercent: false }), dextrose);
	assert.equal(
		itemName(glucose, { nameOverride: dextrose, strengthAsPercent: true }),
		'Dextrose 5% 250ML Injection'
	);
});

test('itemName restates a quantified SCD before the percent form', () => {
	assert.equal(
		itemName('250 ML Glucose 50 MG/ML Injection', { nameOverride: null, strengthAsPercent: true }),
		'Glucose 5% 250ML Injection'
	);
});

test('strengthAsPercent handles grams, litres and fractions', () => {
	assert.equal(strengthAsPercent('Sodium Chloride 0.9 G/100ML Injection'), 'Sodium Chloride 0.9% 100ML Injection');
	assert.equal(strengthAsPercent('Dextrose 50 G/1 L Injection'), 'Dextrose 5% 1L Injection');
	assert.equal(strengthAsPercent('lidocaine 200 MG/20ML Injection'), 'lidocaine 1% 20ML Injection');
});

test('strengthAsPercent leaves combinations and unit-only strengths alone', () => {
	const combo = 'Glucose 12500 MG/250ML / sodium chloride 2250 MG/250ML Injection';
	assert.equal(strengthAsPercent(combo), combo);
	assert.equal(strengthAsPercent('heparin 5000 UNT/ML Injection'), 'heparin 5000 UNT/ML Injection');
	assert.equal(strengthAsPercent('metformin 500 MG Oral Tablet'), 'metformin 500 MG Oral Tablet');
});

test('parseNameOverride trims and clears', () => {
	assert.deepEqual(parseNameOverride('  Dextrose  5% '), { name: 'Dextrose 5%' });
	assert.deepEqual(parseNameOverride(''), { name: null });
	assert.ok('error' in parseNameOverride('x'.repeat(501)));
});

test('strength styles restate matching ingredients per dose form', async () => {
	const { applyStrengthStyles } = await import('../strength-style');
	const rules = [
		{ ingredient: 'water', doseForm: null, style: 'percent' as const },
		{ ingredient: 'sodium chloride', doseForm: 'Injection', style: 'percent' as const },
		{ ingredient: 'epinephrine', doseForm: 'Injection', style: 'ratio' as const }
	];
	assert.equal(applyStrengthStyles('water 1 G/ML Injectable Solution', rules), 'water 100% Injectable Solution');
	assert.equal(
		applyStrengthStyles('100 ML sodium chloride 9 MG/ML Injection', rules),
		'100 ML sodium chloride 0.9% Injection'
	);
	assert.equal(
		applyStrengthStyles('sodium chloride 0.9 G/100ML Injection', rules),
		'sodium chloride 0.9% 100ML Injection'
	);
	assert.equal(
		applyStrengthStyles('EPINEPHrine 0.01 MG/ML / lidocaine hydrochloride 10 MG/ML Injectable Solution', rules),
		'EPINEPHrine 1:100000 / lidocaine hydrochloride 10 MG/ML Injectable Solution'
	);
	// Wrong dose form, no rule, or not an amount per volume: unchanged.
	assert.equal(applyStrengthStyles('sodium chloride 1 G Oral Tablet', rules), 'sodium chloride 1 G Oral Tablet');
	assert.equal(applyStrengthStyles('sodium chloride 9 MG/ML Irrigation Solution', rules), 'sodium chloride 9 MG/ML Irrigation Solution');
	assert.equal(applyStrengthStyles('lidocaine 10 MG/ML Injectable Solution', rules), 'lidocaine 10 MG/ML Injectable Solution');
});
