import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemName, parseNameOverride } from './item-name';

const glucose = 'Glucose 12500 MG/250ML Injection';

test('itemName uses the override, then the item style', () => {
	assert.equal(itemName(glucose, { nameOverride: null, strengthStyle: null }), glucose);
	const dextrose = 'Dextrose 12500 MG/250ML Injection';
	assert.equal(itemName(glucose, { nameOverride: dextrose, strengthStyle: null }), dextrose);
	assert.equal(
		itemName(glucose, { nameOverride: dextrose, strengthStyle: 'percent' }),
		'Dextrose 5% 250ML Injection'
	);
});

test('itemName restates a quantified SCD before the item style', () => {
	assert.equal(
		itemName('250 ML Glucose 50 MG/ML Injection', { nameOverride: null, strengthStyle: 'percent' }),
		'Glucose 5% 250ML Injection'
	);
});

test('an item style handles grams, litres, fractions and combinations', () => {
	const percent = (name: string) => itemName(name, { nameOverride: null, strengthStyle: 'percent' });
	assert.equal(percent('Sodium Chloride 0.9 G/100ML Injection'), 'Sodium Chloride 0.9% 100ML Injection');
	assert.equal(percent('Dextrose 50 G/1 L Injection'), 'Dextrose 5% 1L Injection');
	assert.equal(percent('lidocaine 200 MG/20ML Injection'), 'lidocaine 1% 20ML Injection');
	assert.equal(
		percent('Glucose 12500 MG/250ML / sodium chloride 2250 MG/250ML Injection'),
		'Glucose 5% 250ML / sodium chloride 0.9% 250ML Injection'
	);
	assert.equal(percent('heparin 5000 UNT/ML Injection'), 'heparin 5000 UNT/ML Injection');
	assert.equal(percent('metformin 500 MG Oral Tablet'), 'metformin 500 MG Oral Tablet');
});

test('an item style replaces the formulary rules; "stored" shows the name as stored', () => {
	const rules = [{ ingredient: 'glucose', withIngredients: [], doseForm: null, style: 'ratio' as const }];
	assert.equal(itemName(glucose, { nameOverride: null, strengthStyle: null }, rules), 'Glucose 1:20 250ML Injection');
	assert.equal(itemName(glucose, { nameOverride: null, strengthStyle: 'stored' }, rules), glucose);
	assert.equal(itemName(glucose, { nameOverride: null, strengthStyle: 'bogus' }, rules), 'Glucose 1:20 250ML Injection');
});

test('parseNameOverride trims and clears', () => {
	assert.deepEqual(parseNameOverride('  Dextrose  5% '), { name: 'Dextrose 5%' });
	assert.deepEqual(parseNameOverride(''), { name: null });
	assert.ok('error' in parseNameOverride('x'.repeat(501)));
});

test('strength styles restate matching ingredients per dose form', async () => {
	const { applyStrengthStyles } = await import('../medication/strength-style');
	const rules = [
		{ ingredient: 'water', withIngredients: [], doseForm: null, style: 'percent' as const },
		{ ingredient: 'sodium chloride', withIngredients: [], doseForm: 'Injection', style: 'percent' as const },
		{ ingredient: 'epinephrine', withIngredients: [], doseForm: 'Injection', style: 'ratio' as const }
	];
	assert.equal(
		applyStrengthStyles('water 1 G/ML Injectable Solution', rules),
		'water 100% Injectable Solution'
	);
	assert.equal(
		applyStrengthStyles('100 ML sodium chloride 9 MG/ML Injection', rules),
		'100 ML sodium chloride 0.9% Injection'
	);
	assert.equal(
		applyStrengthStyles('sodium chloride 0.9 G/100ML Injection', rules),
		'sodium chloride 0.9% 100ML Injection'
	);
	assert.equal(
		applyStrengthStyles(
			'EPINEPHrine 0.01 MG/ML / lidocaine hydrochloride 10 MG/ML Injectable Solution',
			rules
		),
		'EPINEPHrine 1:100,000 / lidocaine hydrochloride 10 MG/ML Injectable Solution'
	);
	// Wrong dose form, no rule, or not an amount per volume: unchanged.
	assert.equal(
		applyStrengthStyles('sodium chloride 1 G Oral Tablet', rules),
		'sodium chloride 1 G Oral Tablet'
	);
	assert.equal(
		applyStrengthStyles('sodium chloride 9 MG/ML Irrigation Solution', rules),
		'sodium chloride 9 MG/ML Irrigation Solution'
	);
	assert.equal(
		applyStrengthStyles('lidocaine 10 MG/ML Injectable Solution', rules),
		'lidocaine 10 MG/ML Injectable Solution'
	);
});
