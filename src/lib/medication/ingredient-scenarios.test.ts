import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingredientScenarios, profileNames, remainingNdcs } from './ingredient-scenarios';

const summary = {
	active: [
		{ name: 'CEFAZOLIN', unii: 'U1', moieties: ['CEFAZOLIN'], strengths: [], ndcs: ['1', '2', '3'] }
	],
	inactive: [
		{ value: 'Water', ndcs: ['1', '2', '3'] },
		{ value: 'Dextrose', ndcs: ['1', '2'] },
		{ value: 'Sodium citrate', ndcs: ['2'] }
	]
};

test('inactives in every NDC are fixed; the rest vary; actives lead the columns', () => {
	const scenarios = ingredientScenarios(summary);
	assert.deepEqual(
		scenarios.fixed.map((entry) => entry.name),
		['Water']
	);
	assert.deepEqual(
		scenarios.columns.map((entry) => entry.name),
		['CEFAZOLIN', 'Dextrose', 'Sodium citrate']
	);
	assert.deepEqual(
		scenarios.varying.map((entry) => entry.name),
		['Dextrose', 'Sodium citrate']
	);
});

test('NDCs group by the varying ingredients they share', () => {
	const { profiles } = ingredientScenarios(summary);
	assert.deepEqual(
		profiles.map((profile) => [profile.ndcs, profile.avoids]),
		[
			[['3'], ['i:DEXTROSE', 'i:SODIUM CITRATE']],
			[['1'], ['i:SODIUM CITRATE']],
			[['2'], []]
		]
	);
});

test('avoiding ingredients leaves the NDCs without any of them', () => {
	const scenarios = ingredientScenarios(summary);
	assert.deepEqual(remainingNdcs(scenarios, ['i:SODIUM CITRATE']), ['1', '3']);
	assert.deepEqual(remainingNdcs(scenarios, ['i:DEXTROSE']), ['3']);
	assert.deepEqual(remainingNdcs(scenarios, []), ['1', '2', '3']);
});

test('groups are named for their few companies, else lettered', () => {
	const profiles = [
		{ has: [], avoids: [], ndcs: ['1', '2'] },
		{ has: [], avoids: [], ndcs: ['3', '4', '5'] },
		{ has: [], avoids: [], ndcs: ['6'] },
		{ has: [], avoids: [], ndcs: ['7'] }
	];
	const labelers = [
		{ value: 'NuCare Pharmaceuticals, Inc.', ndcs: ['1', '2', '3', '6', '7'] },
		{ value: 'Teva', ndcs: ['4'] },
		{ value: 'Sandoz Inc', ndcs: ['5'] }
	];
	assert.deepEqual(profileNames(profiles, labelers), [
		'NuCare 1',
		'Group A',
		'NuCare 2',
		'NuCare 3'
	]);
});

test('actives group by moiety unless listed forms are asked for', () => {
	const salts = {
		active: [
			{ name: 'VANCOMYCIN', unii: 'V1', moieties: [], strengths: [], ndcs: ['1'] },
			{ name: 'VANCOMYCIN HYDROCHLORIDE', unii: 'V2', moieties: [], strengths: [], ndcs: ['2'] }
		],
		inactive: []
	};
	const grouped = ingredientScenarios(salts);
	assert.deepEqual(
		grouped.columns.map((entry) => [entry.name, entry.listed]),
		[['VANCOMYCIN', ['VANCOMYCIN', 'VANCOMYCIN HYDROCHLORIDE']]]
	);
	assert.equal(grouped.profiles.length, 1);
	const listed = ingredientScenarios(salts, { byMoiety: false });
	assert.equal(listed.columns.length, 2);
	assert.equal(listed.profiles.length, 2);
});

test('an NDC listing no inactives is left out rather than shown avoiding them all', () => {
	const scenarios = ingredientScenarios({
		active: [
			{ name: 'AMOXICILLIN', unii: 'A1', moieties: [], strengths: [], ndcs: ['1', '2', '3'] }
		],
		inactive: [
			{ value: 'Gelatin', ndcs: ['1', '2'] },
			{ value: 'Talc', ndcs: ['1', '2'] }
		]
	});
	assert.deepEqual(scenarios.ndcs, ['1', '2']);
	assert.deepEqual(scenarios.incomplete, ['3']);
	assert.equal(scenarios.profiles.length, 1);
	assert.deepEqual(scenarios.columns[0].ndcs, ['1', '2']);
});

test('one company’s groups are told apart by product NDC when each is one product', () => {
	const profiles = [
		{ has: [], avoids: [], ndcs: ['00093310901', '00093310905'] },
		{ has: [], avoids: [], ndcs: ['00093226801'] }
	];
	const labelers = [
		{ value: 'Teva Pharmaceuticals USA, Inc.', ndcs: ['00093310901', '00093310905', '00093226801'] }
	];
	assert.deepEqual(profileNames(profiles, labelers), ['Teva 00093-3109', 'Teva 00093-2268']);
});
