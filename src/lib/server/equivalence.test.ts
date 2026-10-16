import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	equivalence,
	equivalenceKey,
	memberMatches,
	parseEquivalenceGroups,
	preferredDisplay,
	relatedValues,
	similarity,
	suggestGroups
} from '../equivalence';

test('formatting, abbreviations, plurals and word order share a key', () => {
	const key = equivalenceKey('Tablet, Film Coated');
	for (const variant of [
		'TABLET, FILM COATED',
		'tablet, film-coated',
		'Film Coated Tablets',
		'TABS, FILM-COATED'
	])
		assert.equal(equivalenceKey(variant), key, variant);
	assert.notEqual(equivalenceKey('Tablet, Coated'), key);
	assert.equal(equivalenceKey('Tablet, ER'), equivalenceKey('Tablet, Extended Release'));
	assert.equal(equivalenceKey('IV route'), equivalenceKey('Intravenous Route'));
});

test('numbers keep their order and their units join them', () => {
	assert.equal(equivalenceKey('500 mg / 125 mg'), equivalenceKey('500mg/125MG'));
	assert.notEqual(equivalenceKey('500mg / 125mg'), equivalenceKey('125mg / 500mg'));
	assert.equal(equivalenceKey('0.5 mg/mL'), equivalenceKey('0.5mg/ml'));
});

test('patterns match words in order', () => {
	assert.ok(memberMatches('tablet*coated', 'TABLET, FILM COATED'));
	assert.ok(memberMatches('tablet*coated', 'Tablet, Sugar Coated'));
	assert.ok(memberMatches('tablet*', 'Tabs, chewable'));
	assert.ok(!memberMatches('tablet*coated', 'Capsule, Coated'));
	assert.ok(!memberMatches('tablet*', 'Capsule'));
});

test('an equivalence maps every captured spelling to the display', () => {
	const eq = equivalence([
		{ dimension: 'doseForm', display: 'Tablet, Coated', members: ['Tablet, Film Coated'] },
		{ dimension: 'labeler', display: 'Teva', members: ['teva*'] }
	]);
	assert.equal(eq('doseForm', 'TABLET, FILM-COATED'), 'Tablet, Coated');
	assert.equal(eq('doseForm', 'tablet, coated'), 'Tablet, Coated');
	assert.equal(eq('doseForm', 'Tablet'), 'Tablet');
	assert.equal(eq('labeler', 'Teva Pharmaceuticals USA'), 'Teva');
	// Groups apply only within their dimension.
	assert.equal(eq('route', 'Tablet, Film Coated'), 'Tablet, Film Coated');
});

test('similarity ranks close wording and spelling above unrelated values', () => {
	assert.equal(similarity('Tablet, Coated', 'TABLET COATED'), 1);
	assert.ok(similarity('Tablet, Coated', 'Tablet, Film Coated') > 0.8);
	assert.ok(similarity('Hydrocloride', 'Hydrochloride') > 0.85);
	assert.ok(similarity('Tablet', 'Tablet, Coated') < 0.67);
	assert.ok(similarity('5mg', '50mg') <= 0.5);
	assert.ok(similarity('Capsule', 'Solution') < 0.34);
});

test('related values exclude the seeds and sort by score', () => {
	const related = relatedValues(
		['Tablet, Coated'],
		[
			{ label: 'TABLET, COATED', count: 3 },
			{ label: 'Tablet, Film Coated', count: 5 },
			{ label: 'Tablet, Sugar Coated', count: 1 },
			{ label: 'Capsule', count: 9 }
		]
	);
	assert.deepEqual(
		related.map((value) => value.label),
		['Tablet, Film Coated', 'Tablet, Sugar Coated']
	);
});

test('suggestions cluster formatting variants first, and skip grouped values', () => {
	const values = [
		{ label: 'Tablet, Film Coated', count: 4 },
		{ label: 'TABLET, FILM COATED', count: 9 },
		{ label: 'Tablet, Coated', count: 2 },
		{ label: 'Capsule', count: 7 },
		{ label: 'CAPSULES', count: 1 },
		{ label: 'Tablet', count: 12 }
	];
	const suggestions = suggestGroups(values);
	assert.deepEqual(
		suggestions.map((s) => [s.kind, s.display, s.members.map((m) => m.label)]),
		[
			['formatting', 'Capsule', ['Capsule', 'CAPSULES']],
			[
				'similar',
				'Tablet, Film Coated',
				['TABLET, FILM COATED', 'Tablet, Film Coated', 'Tablet, Coated']
			]
		]
	);
	assert.equal(
		suggestGroups(values, [{ dimension: 'doseForm', display: 'Capsule', members: [] }]).length,
		1
	);
});

test('the preferred display avoids all caps', () => {
	assert.equal(
		preferredDisplay([
			{ label: 'TABLET, COATED', count: 9 },
			{ label: 'Tablet, Coated', count: 1 }
		]),
		'Tablet, Coated'
	);
});

test('stored groups are cleaned on parse', () => {
	assert.deepEqual(
		parseEquivalenceGroups(
			[
				{ dimension: 'doseForm', display: ' Tablet ', members: ['a', 'a', ' ', 3] },
				{ dimension: 'nope', display: 'x', members: [] },
				{ dimension: 'doseForm', display: '', members: [] },
				'junk'
			],
			new Set(['doseForm'])
		),
		[{ dimension: 'doseForm', display: 'Tablet', members: ['a'] }]
	);
});

test('values differing by a clinical modifier are never proposed together', () => {
	assert.ok(similarity('Tablet, Film Coated', 'Tablet, Film Coated, Extended Release') <= 0.5);
	assert.ok(similarity('Powder, For Suspension', 'Injection, Powder, For Suspension') <= 0.5);
	const suggestions = suggestGroups([
		{ label: 'Tablet, Film Coated', count: 9 },
		{ label: 'Tablet, Coated', count: 2 },
		{ label: 'Tablet, Extended Release', count: 5 },
		{ label: 'Tablet, Film Coated, Extended Release', count: 3 }
	]);
	assert.deepEqual(
		suggestions.map((s) => s.members.map((m) => m.label)),
		[
			['Tablet, Film Coated', 'Tablet, Coated'],
			// Differing only by a cosmetic coating, the extended-release forms pair among themselves.
			['Tablet, Extended Release', 'Tablet, Film Coated, Extended Release']
		]
	);
});
