import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScdName as parseForFill } from '../medication/concept-fill';
import { parseScdName as parseForLocal, sameStrength } from '../curation/local-concept';

test('quantified SCDs keep the same ingredient and strength across fill and local views', () => {
	for (const name of [
		'4 ML pembrolizumab 25 MG/ML Injection',
		'4 ML pembrolizumab 25 MG/ML Injection [Keytruda]'
	]) {
		const local = parseForLocal(name);
		const fill = parseForFill(name.replace(/ \[[^\]]+\]$/, ''));
		assert.ok(local);
		assert.ok(fill);
		assert.equal(local.ingredients[0].name, 'pembrolizumab');
		assert.equal(fill.ingredients[0].name, local.ingredients[0].name);
		assert.equal(
			sameStrength(local.ingredients[0], { name: 'pembrolizumab', value: '25', unit: 'MG/ML' }),
			true
		);
		assert.equal(local.doseForm, fill.doseForm);
	}
});

test('clinical name adapters share bracket units, decimal strengths and time denominators', () => {
	for (const name of [
		'vasopressin .5 [IU]/ML Injection',
		'vasopressin (USP) 20 UNT/1ML Injection',
		'fentanyl 0.025 MG/24HR Transdermal System',
		'dextrose 5 G/100ML Injectable Solution'
	]) {
		const fill = parseForFill(name);
		const local = parseForLocal(name);
		assert.ok(fill, name);
		assert.ok(local, name);
		assert.equal(fill.ingredients[0].name, local.ingredients[0].name);
		assert.equal(local.doseForm, fill.doseForm);
	}
});

test('neither clinical name adapter accepts zero strengths, zero denominators or packs', () => {
	for (const name of [
		'drug 0 MG Oral Tablet',
		'drug 5 MG/0ML Injection',
		'{7 (drug 5 MG Oral Tablet) } Pack'
	]) {
		assert.equal(parseForFill(name), null, name);
		assert.equal(parseForLocal(name), null, name);
	}
});

test('a terminal bracketed strength unit is not mistaken for a brand', () => {
	const parsed = parseForLocal('drug 5 [IU]');
	assert.equal(parsed?.brand, null);
	assert.equal(parsed?.ingredients[0].unit, '[IU]');
	assert.equal(parseForFill('drug 5 [IU]'), null);
});
