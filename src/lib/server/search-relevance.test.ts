import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filtersFrom, filtersQuery, knownWords, nameFacets, parseQuery, relevance } from '../search-relevance';

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

test('look-alike, sound-alike drugs are not each other\'s misspellings', () => {
	// ISMP's confused-name pairs: a search for one must not list the other as a match.
	for (const [query, name] of [
		['hydroxyzine', 'hydrALAZINE 25 MG Oral Tablet'],
		['morphine', 'HYDROmorphone 2 MG Oral Tablet'],
		['vinblastine', 'vinCRIStine 1 MG/ML Injectable Solution'],
		['dopamine', 'DOBUTamine 12.5 MG/ML Injectable Solution'],
		['epinephrine', 'norepinephrine 1 MG/ML Injectable Solution'],
		['cisplatin', 'CARBOplatin 10 MG/ML Injectable Solution'],
		['humalog', 'insulin lispro 100 UNT/ML Injectable Solution [Humulin]']
	])
		assert.equal(relevance(parseQuery(query), { name }).matched, false, `${query} → ${name}`);
});

test('a correctly spelled name is not a misspelling of a close look-alike in the same list', () => {
	// Within two edits of each other, so only the list can tell a typo from a drug.
	for (const [query, right, lookAlike] of [
		['prednisone', 'predniSONE 5 MG Oral Tablet', 'prednisoLONE 5 MG Oral Tablet'],
		['clonazepam', 'clonazePAM 1 MG Oral Tablet', 'LORazepam 1 MG Oral Tablet'],
		['lorazepam', 'LORazepam 1 MG Oral Tablet', 'clonazePAM 1 MG Oral Tablet'],
		['amoxicillin', 'amoxicillin 500 MG Oral Capsule', 'ampicillin 500 MG Oral Capsule'],
		['cefepime', 'cefepime 1000 MG Injection', 'cefixime 400 MG Oral Capsule'],
		['rocuronium', 'rocuronium bromide 10 MG/ML Injectable Solution', 'vecuronium bromide 10 MG Injection'],
		['bupivacaine', 'bupivacaine hydrochloride 5 MG/ML Injectable Solution', 'ropivacaine hydrochloride 5 MG/ML Injectable Solution'],
		['alteplase', 'alteplase 100 MG Injection', 'reteplase 10 UNT Injection'],
		['dexamethasone', 'dexamethasone 4 MG Oral Tablet', 'betamethasone 0.6 MG/ML Oral Solution'],
		['citalopram', 'citalopram 20 MG Oral Tablet', 'escitalopram 20 MG Oral Tablet'],
		['phenobarbital', 'PHENobarbital 65 MG/ML Injectable Solution', 'PENTobarbital 50 MG/ML Injectable Solution'],
		['quinidine', 'quiNIDine gluconate 324 MG Extended Release Oral Tablet', 'quiNINE sulfate 324 MG Oral Capsule']
	]) {
		const known = knownWords([right, lookAlike]);
		const parsed = parseQuery(query);
		assert.equal(relevance(parsed, { name: lookAlike }, known).matched, false, `${query} → ${lookAlike}`);
		assert.equal(relevance(parsed, { name: right }, known).matched, true, `${query} → ${right}`);
	}
});

test('a real misspelling still finds the drug beside its look-alikes', () => {
	const names = ['amoxicillin 500 MG Oral Capsule', 'ampicillin 500 MG Oral Capsule'];
	const known = knownWords(names);
	const [amoxicillin, ampicillin] = names.map((name) => relevance(parseQuery('amoxicilin'), { name }, known));
	assert.equal(amoxicillin.matched, true);
	assert.deepEqual(amoxicillin.reasons, ['spelling']);
	assert.equal(ampicillin.matched, false);
});

test('a strength only matches its own number', () => {
	const name = 'metoprolol tartrate 25 MG Oral Tablet';
	for (const query of ['metoprolol 2.5', 'metoprolol 5', 'metoprolol 250'])
		assert.equal(relevance(parseQuery(query), { name }).matched, false, query);
	assert.equal(relevance(parseQuery('metoprolol 25'), { name }).matched, true);
	assert.equal(relevance(parseQuery('haloperidol 0.5mg'), { name: 'haloperidol 0.5 MG Oral Tablet' }).matched, true);
});

test('a combination strength typed as 5/325 finds both numbers', () => {
	const result = relevance(parseQuery('hydrocodone 5/325'), {
		name: 'acetaminophen 325 MG / hydrocodone bitartrate 5 MG Oral Tablet'
	});
	assert.equal(result.matched, true);
	assert.ok(result.reasons.includes('strength'));
});

test('units and forms typed in any case or run together still parse', () => {
	assert.deepEqual(parseQuery('Lisinopril 10MG TAB'), {
		words: ['lisinopril'],
		strengths: [{ value: 10, unit: 'mg' }],
		forms: ['tablet']
	});
	assert.deepEqual(parseQuery('insulin 100 units').strengths, [{ value: 100, unit: 'unt' }]);
	assert.deepEqual(parseQuery('kcl 20 meq').strengths, [{ value: 20, unit: 'meq' }]);
	// Nothing to search for matches everything, without a score.
	assert.deepEqual(relevance(parseQuery('  '), { name: 'anything' }), { matched: true, score: 0, reasons: [], missing: [] });
});

test('a naked decimal is the strength typed, not ten times it', () => {
	assert.deepEqual(parseQuery('haloperidol .5').strengths, [{ value: 0.5, unit: null }]);
	assert.deepEqual(parseQuery('lorazepam .5mg').strengths, [{ value: 0.5, unit: 'mg' }]);
	assert.equal(relevance(parseQuery('haloperidol .5'), { name: 'haloperidol 5 MG Oral Tablet' }).matched, false);
	assert.equal(relevance(parseQuery('haloperidol .5'), { name: 'haloperidol 0.5 MG Oral Tablet' }).matched, true);
	// A sentence's full stop is still no number.
	assert.deepEqual(parseQuery('metformin.').words, ['metformin']);
});

test('a thousands separator is part of the number', () => {
	assert.deepEqual(parseQuery('heparin 5,000 units').strengths, [{ value: 5000, unit: 'unt' }]);
	assert.deepEqual(parseQuery('1,000,000 units').strengths, [{ value: 1000000, unit: 'unt' }]);
	assert.equal(
		relevance(parseQuery('heparin 5,000 units'), { name: 'heparin sodium, porcine 5000 UNT/ML Injectable Solution' }).matched,
		true
	);
	// A comma between strengths is a list, not a separator.
	assert.deepEqual(parseQuery('5,10').strengths, [
		{ value: 5, unit: null },
		{ value: 10, unit: null }
	]);
});

test('a strength in other units of the same amount matches', () => {
	assert.equal(
		relevance(parseQuery('levothyroxine 50 mcg'), { name: 'levothyroxine sodium 0.05 MG Oral Tablet' }).matched,
		true
	);
	assert.equal(relevance(parseQuery('ceftriaxone 1 g'), { name: 'ceftriaxone 1000 MG Injection' }).matched, true);
	assert.equal(relevance(parseQuery('ceftriaxone 1gm'), { name: 'ceftriaxone 1000 MG Injection' }).matched, true);
	// A different amount, or a unit that is no mass, still misses.
	assert.equal(relevance(parseQuery('levothyroxine 50 mcg'), { name: 'levothyroxine sodium 0.5 MG Oral Tablet' }).matched, false);
	assert.equal(relevance(parseQuery('heparin 1000 mg'), { name: 'heparin sodium 1000 UNT/ML Injectable Solution' }).matched, false);
	assert.equal(relevance(parseQuery('kcl 20 mmol'), { name: 'potassium chloride 20 MEQ Oral Tablet' }).matched, false);
});

test('facets read packs, brands, units and metered doses off RxNorm names', () => {
	assert.deepEqual(nameFacets('{21 (norgestimate 0.25 MG / ethinyl estradiol 0.035 MG Oral Tablet) } Pack [Sprintec]'), {
		form: 'Pack',
		strength: null
	});
	assert.deepEqual(nameFacets('albuterol 0.09 MG/ACTUAT Metered Dose Inhaler [ProAir]'), {
		form: 'Metered Dose Inhaler',
		strength: '0.09 MG/ACTUAT'
	});
	assert.deepEqual(nameFacets('insulin glargine 100 UNT/ML Pen Injector [Lantus]'), {
		form: 'Pen Injector',
		strength: '100 UNT/ML'
	});
	assert.deepEqual(nameFacets('Sterile Water'), { form: null, strength: null });
});
