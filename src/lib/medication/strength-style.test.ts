import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	applyStrengthStyles,
	formContext,
	parseStrengthStyles,
	ruleFor,
	ruleKey,
	styleStrength,
	stylesForItem
} from './strength-style';

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
		applyStrengthStyles(
			'EPINEPHrine 0.005 MG/ML / lidocaine hydrochloride 20 MG/ML Injectable Solution',
			RULES
		),
		'EPINEPHrine 1:200,000 / lidocaine hydrochloride 20 MG/ML Injectable Solution'
	);
	assert.equal(
		applyStrengthStyles(
			'lidocaine hydrochloride 20 MG/ML / EPINEPHrine 0.01 MG/ML Injectable Solution',
			RULES
		),
		'lidocaine hydrochloride 20 MG/ML / EPINEPHrine 1:100,000 Injectable Solution'
	);
	// 1:10,000 and 1:1,000 are the two strengths a code cart mixes up.
	assert.equal(
		applyStrengthStyles('EPINEPHrine 0.1 MG/ML Injectable Solution', RULES),
		'EPINEPHrine 1:10,000 Injectable Solution'
	);
	assert.equal(
		applyStrengthStyles('EPINEPHrine 1 MG/ML Auto-Injector', RULES),
		'EPINEPHrine 1:1,000 Auto-Injector'
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
		applyStrengthStyles(
			'potassium chloride 2 MEQ/ML / sodium chloride 9 MG/ML Injectable Solution',
			RULES
		),
		'potassium chloride 2 MEQ/ML / sodium chloride 0.9% Injectable Solution'
	);
	// No rules, no change.
	assert.equal(
		applyStrengthStyles('sodium chloride 9 MG/ML Injectable Solution', []),
		'sodium chloride 9 MG/ML Injectable Solution'
	);
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
		[{ ingredient: 'Sodium Chloride', withIngredients: [], doseForm: null, style: 'ratio' }]
	);
	assert.deepEqual(parseStrengthStyles(null), []);
	assert.deepEqual(parseStrengthStyles({ ingredient: 'x', style: 'percent' }), []);
	assert.equal(
		ruleKey({ ingredient: 'Sodium Chloride', doseForm: 'Injection' }),
		'sodium chloride||injection'
	);
});

test('weight-in-weight and volume-in-volume strengths read as percentages', () => {
	const rules = parseStrengthStyles([
		{ ingredient: 'hydrocortisone', style: 'percent' },
		{ ingredient: 'isopropyl alcohol', style: 'percent' }
	]);
	assert.equal(
		applyStrengthStyles('hydrocortisone 10 MG/G Topical Cream', rules),
		'hydrocortisone 1% Topical Cream'
	);
	assert.equal(
		applyStrengthStyles('hydrocortisone 25 MG/GM Topical Ointment', rules),
		'hydrocortisone 2.5% Topical Ointment'
	);
	assert.equal(
		applyStrengthStyles('isopropyl alcohol 0.7 ML/ML Topical Solution', rules),
		'isopropyl alcohol 70% Topical Solution'
	);
});

test('a rule naming companion ingredients applies only in that combination, and beats a plain one', () => {
	const rules = parseStrengthStyles([
		{ ingredient: 'epinephrine', style: 'percent', doseForm: null },
		{ ingredient: 'epinephrine', withIngredients: ['lidocaine'], style: 'ratio', doseForm: 'Injection' },
		{ ingredient: 'lidocaine', style: 'percent', doseForm: 'Injection' }
	]);
	assert.equal(
		applyStrengthStyles(
			'EPINEPHrine 0.01 MG/ML / lidocaine hydrochloride 10 MG/ML Injectable Solution',
			rules
		),
		'EPINEPHrine 1:100,000 / lidocaine hydrochloride 1% Injectable Solution'
	);
	assert.equal(
		applyStrengthStyles('EPINEPHrine 0.1 MG/ML Injectable Solution', rules),
		'EPINEPHrine 0.01% Injectable Solution'
	);
	assert.equal(
		applyStrengthStyles('articaine hydrochloride 40 MG/ML / EPINEPHrine 0.01 MG/ML Injectable Solution', rules),
		'articaine hydrochloride 40 MG/ML / EPINEPHrine 0.001% Injectable Solution'
	);
	assert.equal(
		ruleFor(rules, 'epinephrine', 'Injectable Solution', ['lidocaine hydrochloride'])?.style,
		'ratio'
	);
	assert.equal(ruleFor(rules, 'epinephrine', 'Injectable Solution', ['articaine'])?.style, 'percent');
});

test('companion ingredients are part of a rule key, so both rules can be kept', () => {
	const rules = parseStrengthStyles([
		{ ingredient: 'epinephrine', style: 'percent', doseForm: 'Injection' },
		{ ingredient: 'epinephrine', withIngredients: ['  Lidocaine ', 'lidocaine', ''], style: 'ratio', doseForm: 'Injection' }
	]);
	assert.equal(rules.length, 2);
	assert.deepEqual(rules[1].withIngredients, ['Lidocaine']);
	assert.equal(ruleKey(rules[1]), 'epinephrine|lidocaine|injection');
});

test('styleStrength restates a single stored strength, or gives null', () => {
	assert.equal(styleStrength('0.01 mg/mL', 'ratio'), '1:100,000');
	assert.equal(styleStrength('9 mg/1 mL', 'percent'), '0.9%');
	assert.equal(styleStrength('900 MG/100ML', 'percent'), '0.9%');
	assert.equal(styleStrength('10 mg/g', 'percent'), '1%');
	assert.equal(styleStrength('1 mg/mL', 'ratio'), '1:1,000');
	assert.equal(styleStrength('2 mEq/mL', 'percent'), null);
	assert.equal(styleStrength('500 mg', 'percent'), null);
	assert.equal(styleStrength('5000 [USP\'U]/mL', 'percent'), null);
	assert.equal(styleStrength(null, 'percent'), null);
	// A ratio below 1:1 is not a ratio anyone writes.
	assert.equal(styleStrength('2 g/mL', 'ratio'), null);
});

test('an item style replaces the formulary rules for that item', () => {
	const rules = parseStrengthStyles([{ ingredient: 'dextrose', style: 'ratio' }]);
	const name = 'dextrose 50 MG/ML / sodium chloride 4.5 MG/ML Injectable Solution';
	assert.equal(
		applyStrengthStyles(name, stylesForItem(rules, null)),
		'dextrose 1:20 / sodium chloride 4.5 MG/ML Injectable Solution'
	);
	assert.equal(
		applyStrengthStyles(name, stylesForItem(rules, 'percent')),
		'dextrose 5% / sodium chloride 0.45% Injectable Solution'
	);
	assert.equal(applyStrengthStyles(name, stylesForItem(rules, 'stored')), name);
});

test('formContext gathers the form a title ends in, the label form and routes', () => {
	assert.equal(
		formContext('Hydrocortisone 10 MG/G Topical Cream [Cortaid]', 'CREAM', ['TOPICAL']),
		'Topical Cream CREAM TOPICAL'
	);
	assert.equal(formContext(null, 'INJECTION, SOLUTION'), 'INJECTION, SOLUTION');
	// The label's form alone still matches a rule for "Injection".
	assert.equal(ruleFor(RULES, 'epinephrine', formContext(null, 'INJECTION, SOLUTION'))?.style, 'ratio');
});

test('a strength list without a dose form takes the form from context', () => {
	const strengths = 'EPINEPHrine 0.01 MG/ML / lidocaine hydrochloride 20 MG/ML';
	assert.equal(applyStrengthStyles(strengths, RULES), strengths);
	assert.equal(
		applyStrengthStyles(strengths, RULES, 'INJECTION, SOLUTION'),
		'EPINEPHrine 1:100,000 / lidocaine hydrochloride 20 MG/ML'
	);
});
