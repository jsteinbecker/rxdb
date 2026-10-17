import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filtersFrom, filtersQuery, nameFacets, parseQuery, relevance } from '../search-relevance';

test('a query splits into name words, strengths and dose forms', () => {
	assert.deepEqual(parseQuery('Metformin 500mg ER tab'), {
		words: ['metformin'],
		strengths: [{ value: 500, unit: 'mg' }],
		forms: ['extended', 'tablet']
	});
	assert.deepEqual(parseQuery('hydrocodone/apap 5/325').strengths, [
		{ value: 5, unit: null },
		{ value: 325, unit: null }
	]);
});

test('strength and form decide between otherwise equal names', () => {
	const query = parseQuery('metformin 500 ER');
	const er = relevance(query, {
		name: '24 HR metformin hydrochloride 500 MG Extended Release Oral Tablet'
	});
	const ir = relevance(query, { name: 'metformin hydrochloride 1000 MG Oral Tablet' });
	assert.equal(er.matched, true);
	assert.deepEqual(ir.missing, ['500', 'extended']);
	assert.ok(er.score > ir.score);
});

test('a brand name matches the generic node it rolled up into', () => {
	const result = relevance(parseQuery('lipitor 20'), {
		name: 'atorvastatin 20 MG Oral Tablet',
		aliases: ['atorvastatin 20 MG Oral Tablet [Lipitor]']
	});
	assert.equal(result.matched, true);
	assert.deepEqual(result.reasons.sort(), ['brand', 'strength']);
});

test('a misspelling still matches, and is flagged as one', () => {
	const result = relevance(parseQuery('amoxicilin'), { name: 'amoxicillin 500 MG Oral Capsule' });
	assert.equal(result.matched, true);
	assert.deepEqual(result.reasons, ['spelling']);
	assert.equal(relevance(parseQuery('amoxicilin'), { name: 'ampicillin 500 MG Oral Capsule' }).matched, false);
});

test('combinations rank below single drugs unless the query names both ingredients', () => {
	const single = { name: 'lisinopril 10 MG Oral Tablet' };
	const combo = { name: 'hydrochlorothiazide 12.5 MG / lisinopril 10 MG Oral Tablet' };
	const one = parseQuery('lisinopril');
	assert.ok(relevance(one, single).score > relevance(one, combo).score);
	const both = parseQuery('amlodipine benazepril');
	assert.equal(relevance(both, { name: 'amlodipine 5 MG Oral Tablet' }).matched, false);
	assert.equal(
		relevance(both, { name: 'amlodipine 5 MG / benazepril hydrochloride 10 MG Oral Capsule' }).matched,
		true
	);
});

test('dose form and strength are read off RxNorm names', () => {
	assert.deepEqual(nameFacets('24 HR metoprolol succinate 25 MG Extended Release Oral Tablet'), {
		form: 'Extended Release Oral Tablet',
		strength: '25 MG'
	});
	assert.deepEqual(nameFacets('insulin glargine 100 UNT/ML Pen Injector [Lantus]'), {
		form: 'Pen Injector',
		strength: '100 UNT/ML'
	});
	assert.equal(nameFacets('{28 (norethindrone 0.35 MG Oral Tablet) } Pack').form, 'Pack');
});

test('filters round-trip through the URL', () => {
	const filters = { form: 'Oral Tablet', combos: true };
	assert.deepEqual(
		filtersFrom(new URLSearchParams(filtersQuery(filters).slice(1))),
		{ form: 'Oral Tablet', strength: undefined, combos: true, weak: undefined }
	);
});
