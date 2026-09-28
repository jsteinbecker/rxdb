import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildTree,
	comboKey,
	normalizeStrength,
	strengthOf,
	summedStrength,
	parseLevels,
	packagingClass,
	packageSize,
	routeClass,
	NOT_SPECIFIED,
	hierarchyDoseForm,
	type FormularyRow
} from '../formulary-hierarchy';

const row = (overrides: Partial<FormularyRow>): FormularyRow => ({
	packageId: overrides.ndc ?? 'p',
	ndc: '00000000000',
	formularyItemId: 'f1',
	formularyItem: 'Amoxicillin 500 MG Oral Capsule',
	description: '100 CAPSULE in 1 BOTTLE (0000-0000-00)',
	routes: ['ORAL'],
	doseForm: 'CAPSULE',
	ingredients: [{ name: 'AMOXICILLIN', strength: '500 mg/1' }],
	brandName: null,
	genericName: 'Amoxicillin',
	labeler: 'Acme',
	size: { kind: 'count', value: 100, unit: 'CAPSULE', container: 'BOTTLE', packQty: 1 },
	isMultiDose: null,
	preferenceRank: 1,
	status: 'active',
	...overrides
});

test('routes classify into enteral and parenteral groups', () => {
	assert.equal(routeClass('ORAL'), 'Enteral');
	assert.equal(routeClass('INTRAVENOUS'), 'Parenteral');
	assert.equal(routeClass('WEIRD'), 'Other routes');
});

test('unit-dose packaging is recognized from the description', () => {
	assert.equal(
		packagingClass(row({ description: '10 BLISTER PACK in 1 CARTON' })),
		'Unit-dose packaging'
	);
	assert.equal(packagingClass(row({})), 'Bulk packaging');
});

test('package size omits single- and multi-dose container qualifiers', () => {
	assert.equal(
		packageSize(
			row({
				size: { kind: 'volume', value: 5, unit: 'mL', container: 'VIAL, MULTI-DOSE', packQty: 1 }
			})
		),
		'5mL Vial'
	);
	assert.equal(
		packageSize(
			row({
				size: { kind: 'volume', value: 5, unit: 'mL', container: 'VIAL, SINGLE-DOSE', packQty: 1 }
			})
		),
		'5mL Vial'
	);
});

test('buildTree nests levels and leaves rows at the last level', () => {
	const rows = [
		row({ ndc: '1', description: '100 CAPSULE in 1 BLISTER PACK' }),
		row({ ndc: '2' }),
		row({
			ndc: '3',
			routes: ['INTRAVENOUS'],
			doseForm: 'INJECTION, SOLUTION',
			formularyItem: 'Cefazolin'
		})
	];
	const tree = buildTree(rows, ['routeClass', 'routeForm', 'packaging']);
	assert.deepEqual(
		tree.map((node) => [node.label, node.count]),
		[
			['Enteral', 2],
			['Parenteral', 1]
		]
	);
	const oral = tree[0].children[0];
	assert.equal(oral.label, 'Oral Capsule');
	assert.deepEqual(
		oral.children.map((node) => node.label),
		['Bulk packaging', 'Unit-dose packaging']
	);
	assert.deepEqual(
		oral.children[1].rows.map((item) => item.ndc),
		['1']
	);
	assert.equal(oral.rows.length, 0);
});

test('missing values bucket last and multi-values repeat', () => {
	const tree = buildTree(
		[
			row({ ndc: '1', labeler: null }),
			row({
				ndc: '2',
				ingredients: [
					{ name: 'A', strength: null },
					{ name: 'B', strength: null }
				]
			})
		],
		['ingredient']
	);
	assert.deepEqual(
		tree.map((node) => node.label),
		['A', 'Amoxicillin', 'B']
	);
	const combined = buildTree(
		[
			row({ ndc: '1', ingredients: [{ name: 'A', strength: null }] }),
			row({
				ndc: '2',
				ingredients: [
					{ name: 'B', strength: null },
					{ name: 'A', strength: null }
				]
			})
		],
		['ingredientCombo']
	);
	assert.deepEqual(
		combined.map((node) => [node.label, node.rows.map((item) => item.ndc)]),
		[
			['A', ['1']],
			['A / B', ['2']]
		]
	);
	const byLabeler = buildTree([row({ labeler: null }), row({})], ['labeler']);
	assert.equal(byLabeler.at(-1)!.label, NOT_SPECIFIED);
});

test('parseLevels drops unknown and duplicate keys', () => {
	assert.deepEqual(parseLevels('route,bogus,route,labeler'), ['route', 'labeler']);
	assert.deepEqual(parseLevels(''), []);
});

test('PARENTERAL is not enteral, and child levels see only the parent route', () => {
	assert.equal(routeClass('PARENTERAL'), 'Parenteral');
	const tree = buildTree(
		[row({ routes: ['INTRAMUSCULAR', 'INTRAVENOUS', 'ORAL'], doseForm: 'SOLUTION' })],
		['routeClass', 'routeForm']
	);
	assert.deepEqual(
		tree.map((node) => [node.label, node.children.map((child) => child.label)]),
		[
			['Enteral', ['Oral Solution']],
			['Parenteral', ['Intramuscular Solution', 'Intravenous Solution']]
		]
	);
});

test('hierarchy combines lyophilized powder for solution with powder for solution', () => {
	assert.equal(
		hierarchyDoseForm('INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION'),
		'Injection, Powder, For Solution'
	);
	const tree = buildTree(
		[
			row({ ndc: '1', doseForm: 'INJECTION, POWDER, FOR SOLUTION' }),
			row({ ndc: '2', doseForm: 'INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION' }),
			row({ ndc: '3', doseForm: 'INJECTION, SOLUTION' })
		],
		['doseForm']
	);
	assert.deepEqual(
		tree.map((node) => [node.label, node.count]),
		[
			['Injection, Powder, For Solution', 2],
			['Injection, Solution', 1]
		]
	);
	const routeFormTree = buildTree(
		[
			row({ ndc: '1', routes: ['INTRAVENOUS'], doseForm: 'INJECTION, POWDER, FOR SOLUTION' }),
			row({
				ndc: '2',
				routes: ['INTRAVENOUS'],
				doseForm: 'INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION'
			})
		],
		['routeForm']
	);
	assert.deepEqual(
		routeFormTree.map((node) => [node.label, node.count]),
		[['Intravenous Injection, Powder, For Solution', 2]]
	);
});

test('combination dose display: each, sum in one unit, or a single ingredient', () => {
	const combo = row({
		ingredients: [
			{ name: 'AMOXICILLIN', strength: '875 mg' },
			{ name: 'CLAVULANATE', strength: '0.125 g' }
		]
	});
	assert.equal(comboKey(combo), 'Amoxicillin / Clavulanate');
	assert.equal(strengthOf(combo), '875mg / 125mg');
	assert.equal(strengthOf({ ...combo, doseDisplay: { mode: 'sum' } }), '1g total');
	assert.equal(
		strengthOf({ ...combo, doseDisplay: { mode: 'single', ingredient: 'Clavulanate' } }),
		'125mg'
	);
	assert.equal(summedStrength(['5 mg/5 mL', '1 mg/mL']), null);
	assert.equal(summedStrength(['250 mcg/mL', '0.25 mg/mL']), '500mcg/mL');
	assert.equal(summedStrength(['10 mg', '5 [iU]']), null);
	assert.equal(summedStrength(['2 g/1', '.25 g/1']), '2.25g');
});

test('equal strengths share one node however they are written', () => {
	assert.equal(normalizeStrength('1 g/1'), '1g');
	assert.equal(normalizeStrength('1000 mg/1'), '1g');
	assert.equal(normalizeStrength('1 g'), '1g');
	assert.equal(normalizeStrength('1.13 g/1'), '1.13g');
	assert.equal(normalizeStrength('500 mg/1'), '500mg');
	assert.equal(normalizeStrength('0.5 g'), '500mg');
	assert.equal(normalizeStrength('1000 mg/10 mL'), '1g/10mL');
	assert.equal(normalizeStrength('0.5 mg/mL'), '0.5mg/mL');
	assert.equal(normalizeStrength('250 mcg/mL'), '250mcg/mL');
	assert.equal(normalizeStrength('1000 mcg'), '1mg');
	assert.equal(normalizeStrength('5 [iU]/mL'), '5[iu]/mL');
	const cefepime = (strength: string, ndc: string) =>
		row({ ndc, ingredients: [{ name: 'CEFEPIME HYDROCHLORIDE', strength }] });
	const tree = buildTree(
		[cefepime('1 g/1', '1'), cefepime('1000 mg/1', '2'), cefepime('1 g', '3'), cefepime('2 g/1', '4')],
		['ingredient', 'strength']
	);
	assert.deepEqual(
		tree[0].children.map((node) => [node.label, node.count]),
		[['1g', 3], ['2g', 1]]
	);
});
