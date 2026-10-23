import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemPackages, packageLayout, runSpans } from './item';
import type { FormularyRow } from './hierarchy';

const row = (ndc: string, formularyItemId: string, preferenceRank: number) =>
	({ ndc, formularyItemId, preferenceRank }) as FormularyRow;

test("itemPackages keeps only the item's packages, ordered by rank then NDC", () => {
	const rows = [row('3', 'a', 2), row('2', 'b', 1), row('1', 'a', 2), row('4', 'a', 1)];
	assert.deepEqual(
		itemPackages(rows, 'a').map((r) => r.ndc),
		['4', '1', '3']
	);
});

test('itemPackages is empty for an item with no linked packages', () => {
	assert.deepEqual(itemPackages([row('1', 'a', 1)], 'zzz'), []);
});

const full = (over: Partial<FormularyRow>) =>
	({
		packageId: over.ndc,
		doseForm: 'TABLET',
		routes: ['ORAL'],
		ingredients: [{ name: 'atorvastatin', strength: '10 mg' }],
		brandName: null,
		genericName: 'atorvastatin',
		labeler: 'A',
		size: null,
		isMultiDose: null,
		preferenceRank: 1,
		status: 'active',
		...over
	}) as FormularyRow;

test('packageLayout groups by labeler then product and hoists shared facts', () => {
	const layout = packageLayout([
		full({ ndc: '1', brandName: 'Lipitor', labeler: 'Viatris' }),
		full({ ndc: '2', brandName: 'Lipitor', labeler: 'Viatris', preferenceRank: 2 }),
		full({ ndc: '3', labeler: 'Teva', preferenceRank: 3 })
	]);
	assert.deepEqual(
		layout.groups.map((g) => g.labeler),
		['Viatris', 'Teva']
	);
	assert.equal(layout.groups[0].products[0].product, 'Lipitor');
	assert.equal(layout.groups[0].products[0].packages.length, 2);
	assert.equal(layout.groups[1].products[0].product, 'atorvastatin');
	assert.deepEqual(layout.shared, ['Atorvastatin 10 mg', 'TABLET']);
	assert.deepEqual(layout.sharedRoutes, ['ORAL']);
	assert.equal(layout.showDoseForm, false);
	assert.equal(layout.showRank, true);
});

test('packageLayout promotes dose form to a column when packages differ', () => {
	const layout = packageLayout([
		full({ ndc: '1' }),
		full({ ndc: '2', doseForm: 'TABLET, FILM COATED' })
	]);
	assert.equal(layout.showDoseForm, true);
	assert.deepEqual(layout.shared, ['Atorvastatin 10 mg']);
});

test('runSpans merges adjacent equal keys and never merges nulls', () => {
	assert.deepEqual(runSpans(['a', 'a', 'b', 'a', 'a', 'a']), [2, 0, 1, 3, 0, 0]);
	assert.deepEqual(runSpans([null, null, 'a']), [1, 1, 1]);
	assert.deepEqual(runSpans([]), []);
});

test('packageLayout lists unenriched packages apart, by labeler, most first', () => {
	const layout = packageLayout([
		full({ ndc: '1', labeler: 'Teva Pharmaceuticals USA, Inc.' }),
		full({ ndc: '2', labeler: 'A-S Medication Solutions', enriched: false, routes: [] }),
		full({ ndc: '3', labeler: 'Sandoz Inc', enriched: false, routes: [] }),
		full({ ndc: '4', labeler: 'A-S Medication Solutions', enriched: false, routes: [] })
	]);
	assert.deepEqual(
		layout.groups.map((g) => [g.labeler, g.count]),
		[['Teva', 1]]
	);
	assert.deepEqual(layout.pending, [
		{ labeler: 'A-S Medication Solutions', ndcs: ['2', '4'] },
		{ labeler: 'Sandoz', ndcs: ['3'] }
	]);
	assert.equal(layout.pendingCount, 3);
	// Unenriched packages have no routes; that must not open a routes column.
	assert.equal(layout.showRoutes, false);
});

test('packageLayout merges spellings of one labeler and names an unnamed product by its code', () => {
	const layout = packageLayout([
		full({ ndc: '42708001030', labeler: 'QPharma, Inc', genericName: null }),
		full({ ndc: '42708007630', labeler: 'QPharma Inc', genericName: 'Amoxicillin' })
	]);
	assert.equal(layout.groups.length, 1);
	assert.deepEqual(
		layout.groups[0].products.map((p) => p.product),
		['Product 42708-0010', 'Amoxicillin']
	);
});
