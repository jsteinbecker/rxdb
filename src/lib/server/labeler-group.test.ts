import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelerGroup } from '../labeler-group';
import { buildTree, labelerLabel, type FormularyRow } from '../formulary-hierarchy';

test('legal-form, national-arm and industry suffixes are dropped', () => {
	for (const [name, group] of [
		['Teva Pharmaceuticals Inc.', 'Teva'],
		['Teva Pharmaceuticals USA Inc', 'Teva'],
		['Teva, Inc.', 'Teva'],
		['TEVA PHARMACEUTICALS USA, INC.', 'TEVA'],
		['Fresenius Kabi USA, LLC', 'Fresenius Kabi'],
		['Hikma Pharmaceuticals USA Inc.', 'Hikma'],
		['Sun Pharmaceutical Industries, Inc.', 'Sun'],
		['Dr. Reddy’s Laboratories Limited', 'Dr. Reddy’s'],
		['Pfizer Laboratories Div Pfizer Inc', 'Pfizer'],
		['Mylan Institutional Inc.', 'Mylan Institutional']
	])
		assert.equal(labelerGroup(name), group, name);
});

test('distinctive words and one-word names survive', () => {
	assert.equal(labelerGroup('Amneal Biosciences LLC'), 'Amneal Biosciences');
	assert.notEqual(labelerGroup('Amneal Biosciences LLC'), labelerGroup('Amneal Pharmaceuticals LLC'));
	assert.equal(labelerGroup('Pharmaceutical Associates, Inc.'), 'Pharmaceutical Associates');
	assert.equal(labelerGroup('Pharma Inc'), 'Pharma');
	assert.equal(labelerGroup('Apotex Corp.'), 'Apotex');
});

test('labeler dimension puts every spelling of one company in one node', () => {
	const base = { routes: [], doseForm: null, ingredients: [], brandName: null, genericName: null,
		description: null, size: null, isMultiDose: null, preferenceRank: 0, status: 'active',
		formularyItemId: 'f', formularyItem: 'F' };
	const rows = ['Teva Pharmaceuticals Inc.', 'Teva Pharmaceuticals USA Inc', 'Teva, Inc.', 'TEVA PHARMACEUTICALS USA',
		'Amneal Biosciences'].map((labeler, i) => ({ ...base, packageId: `${i}`, ndc: `${i}`, labeler }) as FormularyRow);
	const tree = buildTree(rows, ['labeler']);
	assert.deepEqual(tree.map((node) => [node.label, node.count]), [['Amneal Biosciences', 1], ['Teva', 4]]);
	assert.equal(labelerLabel('TEVA PHARMACEUTICALS USA'), 'Teva');
});
