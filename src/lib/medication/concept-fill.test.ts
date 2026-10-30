import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSplForm, fillFromConcept, parseScdName, splFormsFor } from './concept-fill';
import type { FormularyRow } from '../formulary/hierarchy';

test('an SCD name gives its ingredients, strengths and RxNorm dose form', () => {
	assert.deepEqual(parseScdName('amoxicillin 500 MG Oral Capsule'), {
		ingredients: [{ name: 'amoxicillin', strength: '500 MG' }],
		doseForm: 'Oral Capsule'
	});
	assert.deepEqual(parseScdName('amoxicillin 50 MG/ML / clavulanate 12.5 MG/ML Oral Suspension'), {
		ingredients: [
			{ name: 'amoxicillin', strength: '50 MG/ML' },
			{ name: 'clavulanate', strength: '12.5 MG/ML' }
		],
		doseForm: 'Oral Suspension'
	});
});

test('release periods, bulk markers and quantified names leave a clean dose form', () => {
	const adderall = parseScdName(
		'amphetamine aspartate 1.25 MG / amphetamine sulfate 1.25 MG / dextroamphetamine saccharate 1.25 MG / dextroamphetamine sulfate 1.25 MG Extended Release (24 HR) Oral Capsule'
	);
	assert.equal(adderall?.ingredients.length, 4);
	assert.equal(adderall?.doseForm, 'Extended Release Oral Capsule');
	assert.equal(
		parseScdName('24 HR metoprolol succinate 100 MG Extended Release Oral Tablet')?.doseForm,
		'Extended Release Oral Tablet'
	);
	assert.deepEqual(parseScdName('vancomycin 10000 MG Injection (Bulk)'), {
		ingredients: [{ name: 'vancomycin', strength: '10000 MG' }],
		doseForm: 'Injection'
	});
	assert.deepEqual(parseScdName('4 ML pembrolizumab 25 MG/ML Injection')?.ingredients, [
		{ name: 'pembrolizumab', strength: '100 MG/4ML' }
	]);
});

test('names with digits, brackets and suffixes in the ingredient still parse', () => {
	assert.deepEqual(parseScdName('vasopressin (USP) 20 UNT/1ML Injection')?.ingredients, [
		{ name: 'vasopressin', strength: '20 UNT/1ML' }
	]);
	assert.deepEqual(
		parseScdName("Crotalidae immune F(ab')2 (equine) 120 MG Injection")?.ingredients,
		[{ name: "Crotalidae immune F(ab')2 (equine)", strength: '120 MG' }]
	);
	assert.equal(
		parseScdName('sodium chloride 0.003 MEQ/ML Injectable Solution')?.ingredients[0].strength,
		'0.003 MEQ/ML'
	);
	assert.equal(
		parseScdName('infliximab-abda 100 MG Injection')?.ingredients[0].name,
		'infliximab-abda'
	);
});

test('names that are not SCDs are left alone', () => {
	assert.equal(parseScdName('{7 (amoxicillin 500 MG Oral Capsule) } Pack'), null);
	assert.equal(parseScdName('Amoxicillin 500 mg capsule [Teva]'), null);
	assert.equal(parseScdName(''), null);
});

test('only mixed-case RxNorm forms map to label forms', () => {
	assert.equal(splFormsFor('Oral Tablet')?.[0], 'TABLET');
	assert.equal(splFormsFor('Injection')?.[0], 'INJECTION');
	assert.equal(splFormsFor('INJECTION'), null);
	assert.equal(splFormsFor('TABLET, FILM COATED'), null);
	assert.equal(splFormsFor('Topical Cream'), null);
});

test('label form spellings that mean the same package compare equal', () => {
	assert.equal(
		canonicalSplForm('INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION'),
		'INJECTION, POWDER, FOR SOLUTION'
	);
	assert.equal(canonicalSplForm('FOR SUSPENSION'), 'POWDER, FOR SUSPENSION');
	assert.equal(canonicalSplForm('Tablet, Film Coated'), 'TABLET, FILM COATED');
});

const row = (
	ndc: string,
	doseForm: string | null,
	ingredients: FormularyRow['ingredients'] = []
): FormularyRow => ({
	packageId: ndc,
	ndc,
	formularyItemId: 'item',
	formularyItem: 'amoxicillin 50 MG/ML / clavulanate 12.5 MG/ML Oral Suspension',
	description: null,
	routes: [],
	doseForm,
	ingredients,
	brandName: null,
	genericName: null,
	labeler: null,
	size: null,
	isMultiDose: null,
	preferenceRank: 1,
	status: 'active'
});

test('an unenriched package takes its concept ingredients and its siblings’ label form', () => {
	const [own, other, bare, missing] = fillFromConcept([
		row('1', 'POWDER, FOR SUSPENSION', [{ name: 'AMOXICILLIN', strength: '400 mg/5mL' }]),
		row('2', 'FOR SUSPENSION'),
		row('3', 'Oral Suspension'),
		row('4', null)
	]);
	// Stated facts are kept as they are.
	assert.equal(own.doseForm, 'POWDER, FOR SUSPENSION');
	assert.deepEqual(own.ingredients, [{ name: 'AMOXICILLIN', strength: '400 mg/5mL' }]);
	assert.equal(own.inferred, undefined);
	// A label form is never replaced, only its ingredients are filled.
	assert.equal(other.doseForm, 'FOR SUSPENSION');
	assert.deepEqual(other.inferred, { ingredients: true });
	assert.deepEqual(
		bare.ingredients.map((item) => item.name),
		['amoxicillin', 'clavulanate']
	);
	assert.equal(bare.doseForm, 'POWDER, FOR SUSPENSION');
	assert.deepEqual(bare.inferred, { ingredients: true, doseForm: true });
	assert.equal(missing.doseForm, 'POWDER, FOR SUSPENSION');
});

test('without a clear sibling majority the plain label equivalent is used', () => {
	const rows = [
		{ ...row('1', 'TABLET, FILM COATED'), formularyItem: 'atorvastatin 10 MG Oral Tablet' },
		{ ...row('2', 'TABLET'), formularyItem: 'atorvastatin 10 MG Oral Tablet' },
		{ ...row('3', 'Oral Tablet'), formularyItem: 'atorvastatin 10 MG Oral Tablet' }
	];
	assert.equal(fillFromConcept(rows)[2].doseForm, 'TABLET');
	// A sibling form outside what the RxNorm form allows is no evidence.
	const capsules = [
		{ ...row('1', 'CAPSULE'), formularyItem: 'atorvastatin 10 MG Oral Tablet' },
		{ ...row('2', 'Oral Tablet'), formularyItem: 'atorvastatin 10 MG Oral Tablet' }
	];
	assert.equal(fillFromConcept(capsules)[1].doseForm, 'TABLET');
});
