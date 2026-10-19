import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStrengthStyles, parseStrengthStyles, ruleFor, ruleKey } from '../strength-style';

const RULES = parseStrengthStyles([
	{ ingredient: 'sodium chloride', style: 'percent', doseForm: null },
	{ ingredient: 'dextrose', style: 'percent' },
	{ ingredient: 'EPINEPHrine', style: 'ratio', doseForm: 'Injection' },
	{ ingredient: 'lidocaine', style: 'percent', doseForm: 'Topical' }
]);

test('electrolyte and dextrose concentrations read as percentages', () => {
	for (const [name, styled] of [
		['sodium chloride 9 MG/ML Injectable Solution', 'sodium chloride 0.9% Injectable Solution'],
		['sodium chloride 4.5 MG/ML Injectable Solution', 'sodium chloride 0.45% Injectable Solution'],
		['sodium chloride 234 MG/ML Injectable Solution', 'sodium chloride 23.4% Injectable Solution'],
		['sodium chloride 9 G/L Irrigation Solution', 'sodium chloride 0.9% Irrigation Solution'],
		['dextrose 500 MG/ML Injectable Solution', 'dextrose 50% Injectable Solution'],
		[
			'dextrose 50 MG/ML / sodium chloride 4.5 MG/ML Injectable Solution',
			'dextrose 5% / sodium chloride 0.45% Injectable Solution'
		]
	])
		assert.equal(applyStrengthStyles(name, RULES), styled, name);
});

test('a stated volume and a brand are kept', () => {
	assert.equal(
		applyStrengthStyles('sodium chloride 900 MG/100ML Injection', RULES),
		'sodium chloride 0.9% 100ML Injection'
	);
	assert.equal(
		applyStrengthStyles('100 ML sodium chloride 9 MG/ML Injection', RULES),
		'100 ML sodium chloride 0.9% Injection'
	);
	assert.equal(
		applyStrengthStyles('sodium chloride 9 MG/ML Injectable Solution [Normal Saline]', RULES),
		'sodium chloride 0.9% Injectable Solution [Normal Saline]'
	);
});

test('epinephrine in local anesthetics reads as a ratio, wherever it is listed', () => {
	assert.equal(
		applyStrengthStyles('EPINEPHrine 0.005 MG/ML / lidocaine hydrochloride 20 MG/ML Injectable Solution', RULES),
		'EPINEPHrine 1:200000 / lidocaine hydrochloride 20 MG/ML Injectable Solution'
	);
	assert.equal(
		applyStrengthStyles('lidocaine hydrochloride 20 MG/ML / EPINEPHrine 0.01 MG/ML Injectable Solution', RULES),
		'lidocaine hydrochloride 20 MG/ML / EPINEPHrine 1:100000 Injectable Solution'
	);
	// 1:10,000 and 1:1,000 are the two strengths a code cart mixes up.
	assert.equal(
		applyStrengthStyles('EPINEPHrine 0.1 MG/ML Injectable Solution', RULES),
		'EPINEPHrine 1:10000 Injectable Solution'
	);
	assert.equal(
		applyStrengthStyles('EPINEPHrine 1 MG/ML Auto-Injector', RULES),
		'EPINEPHrine 1:1000 Auto-Injector'
	);
});

test('a rule bound to a dose form leaves other forms alone', () => {
	assert.equal(
		applyStrengthStyles('lidocaine 40 MG/ML Topical Cream', RULES),
		'lidocaine 4% Topical Cream'
	);
	assert.equal(
		applyStrengthStyles('lidocaine 10 MG/ML Injectable Solution', RULES),
		'lidocaine 10 MG/ML Injectable Solution'
	);
	assert.equal(
		applyStrengthStyles('EPINEPHrine 0.1 MG/ML Prefilled Syringe', RULES),
		'EPINEPHrine 0.1 MG/ML Prefilled Syringe'
	);
});

test('strengths that are not an amount per volume are never restated', () => {
	for (const name of [
		'sodium chloride 1 MEQ/ML Injectable Solution',
		'sodium chloride 0.65 % Nasal Spray',
		'sodium chloride 1 GM Oral Tablet',
		'potassium chloride 2 MEQ/ML Injectable Solution'
	])
		assert.equal(applyStrengthStyles(name, RULES), name, name);
	assert.equal(
		applyStrengthStyles('potassium chloride 2 MEQ/ML / sodium chloride 9 MG/ML Injectable Solution', RULES),
		'potassium chloride 2 MEQ/ML / sodium chloride 0.9% Injectable Solution'
	);
	// No rules, no change.
	assert.equal(applyStrengthStyles('sodium chloride 9 MG/ML Injectable Solution', []), 'sodium chloride 9 MG/ML Injectable Solution');
});

test('an ingredient rule names its salts but not other drugs', () => {
	assert.equal(ruleFor(RULES, 'lidocaine hydrochloride', 'Topical Cream')?.ingredient, 'lidocaine');
	assert.equal(ruleFor(RULES, 'Sodium Chloride', 'Injection')?.ingredient, 'sodium chloride');
	// A name that only contains the rule's is a different drug.
	assert.equal(ruleFor(RULES, 'norepinephrine', 'Injection'), null);
	assert.equal(ruleFor(RULES, 'racepinephrine', 'Injection'), null);
	assert.equal(ruleFor(RULES, 'sodium', 'Injection'), null);
});

test('a rule for the dose form beats a rule for any form', () => {
	const rules = parseStrengthStyles([
		{ ingredient: 'epinephrine', style: 'percent', doseForm: null },
		{ ingredient: 'epinephrine', style: 'ratio', doseForm: 'Injection' }
	]);
	assert.equal(ruleFor(rules, 'epinephrine', 'Injectable Solution')?.style, 'ratio');
	assert.equal(ruleFor(rules, 'epinephrine', 'Nasal Spray')?.style, 'percent');
});

test('saved rules are cleaned, validated and deduplicated', () => {
	assert.deepEqual(
		parseStrengthStyles([
			{ ingredient: '  sodium   chloride ', style: 'percent', doseForm: '  ' },
			{ ingredient: 'Sodium Chloride', style: 'ratio', doseForm: null },
			{ ingredient: '', style: 'percent' },
			{ ingredient: 'dextrose', style: 'fraction' },
			{ ingredient: 42, style: 'percent' },
			null,
			'sodium chloride'
		]),
		[{ ingredient: 'Sodium Chloride', doseForm: null, style: 'ratio' }]
	);
	assert.deepEqual(parseStrengthStyles(null), []);
	assert.deepEqual(parseStrengthStyles({ ingredient: 'x', style: 'percent' }), []);
	assert.equal(ruleKey({ ingredient: 'Sodium Chloride', doseForm: 'Injection' }), 'sodium chloride|injection');
});
