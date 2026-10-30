// One package through every view's data path: the formulary tree, the item
// page's summary and package table, the NDC page (PackageDetail) and search's
// product grouping must agree on its dose form and dose type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildTree,
	packagingFacts,
	projectDoseForm,
	projectRows,
	resolveDoseTypes,
	NOT_SPECIFIED,
	type FormularyRow,
	type TreeNode
} from './hierarchy';
import { equivalence, type EquivalenceGroup } from './equivalence';
import { summarizeItem } from './item-summary';
import { packageLayout } from './item';
import type { StagedPackage } from '../catalog/types';

const groups: EquivalenceGroup[] = [
	{ dimension: 'doseForm', display: 'Injection', members: ['Injection, Solution'] }
];

/** Hikma bumetanide: -01 is the 10 mL vial inside -10's carton; only -10's label says multi-dose. */
const catalogPackage = (
	ndc: string,
	over: Partial<Pick<StagedPackage, 'description' | 'doseForm' | 'isMultiDose' | 'size'>>
) =>
	({
		ndc,
		description: '10 mL in 1 VIAL',
		doseForm: 'INJECTION',
		isMultiDose: null,
		size: { kind: 'volume', value: 10, unit: 'mL', container: 'VIAL', packQty: 1 },
		details: {
			product: { routes: ['INTRAMUSCULAR', 'INTRAVENOUS'] },
			rxnav: { conceptName: 'bumetanide 0.25 MG/ML Injectable Solution' }
		},
		...over
	}) as unknown as StagedPackage;

const vial = catalogPackage('00641628501', {});
const carton = catalogPackage('00641628510', {
	description: '10 VIAL in 1 CARTON (0641-6285-10)  / 10 mL in 1 VIAL (0641-6285-01)',
	doseForm: 'INJECTION, SOLUTION',
	isMultiDose: true,
	size: { kind: 'volume', value: 10, unit: 'mL', container: 'VIAL', packQty: 10 }
});

/** The formulary row `formularyRows` reads from the same package. */
const formularyRow = (item: StagedPackage): FormularyRow => ({
	packageId: item.ndc,
	ndc: item.ndc,
	formularyItemId: 'bumetanide',
	formularyItem: item.details!.rxnav!.conceptName!,
	description: item.description,
	routes: item.details!.product!.routes,
	doseForm: item.doseForm,
	ingredients: [{ name: 'BUMETANIDE', strength: '0.25 mg/mL' }],
	brandName: null,
	genericName: 'Bumetanide',
	labeler: 'Hikma',
	size: item.size,
	isMultiDose: item.isMultiDose,
	preferenceRank: 1,
	status: 'active'
});

const packages = [vial, carton];
const rows = projectRows(packages.map(formularyRow), groups);

/** Each view's reading of one NDC: [dose form, dose type]. */
function views(ndc: string) {
	const leaves = (nodes: TreeNode[], path: string[] = []): [string[], FormularyRow][] =>
		nodes.flatMap((node) =>
			node.children.length
				? leaves(node.children, [...path, node.label])
				: node.rows.map((row): [string[], FormularyRow] => [[...path, node.label], row])
		);
	const [treePath] = leaves(
		buildTree(rows, ['doseForm', 'packaging'], { equivalenceGroups: groups })
	)
		.filter(([, row]) => row.ndc === ndc)
		.map(([path]) => path);

	const summary = summarizeItem(rows, new Map());
	const summaryForm = summary.doseForms.find((entry) => entry.ndcs.includes(ndc))!;
	const summaryType = summary.doseTypes.find((entry) => entry.ndcs.includes(ndc))!;

	const layout = packageLayout(rows);
	const line = layout.groups
		.flatMap((group) => group.products.flatMap((product) => product.packages))
		.find((pkg) => pkg.ndc === ndc)!;
	const tableForm = layout.showDoseForm ? line.doseForm : layout.shared.at(-1);

	// PackageDetail on the NDC page: the package itself plus `productSiblings`.
	const item = packages.find((pkg) => pkg.ndc === ndc)!;
	const siblings = packages.filter((pkg) => pkg.ndc !== ndc).map(packagingFacts);
	const detailType = resolveDoseTypes([packagingFacts(item), ...siblings]).get(ndc)!;
	const detailForm = projectDoseForm(item.doseForm, groups)!;

	// Search's "In the catalog" product grouping.
	const searchForm = projectDoseForm(item.doseForm, equivalence(groups))!.display;

	return {
		tree: treePath,
		summary: [summaryForm.value, summaryType.value],
		table: [tableForm, line.doseType?.value],
		detail: [detailForm.display, detailType.value],
		search: searchForm,
		raw: { summary: summaryForm.raw, detail: detailForm.raw }
	};
}

for (const ndc of ['00641628501', '00641628510'])
	test(`${ndc} reads as one dose form and dose type in every view`, () => {
		const seen = views(ndc);
		assert.deepEqual(seen.tree, ['Injection', 'MDV']);
		assert.deepEqual(seen.summary, ['Injection', 'MDV']);
		assert.deepEqual(seen.table, ['Injection', 'MDV']);
		assert.deepEqual(seen.detail, ['Injection', 'MDV']);
		assert.equal(seen.search, 'Injection');
	});

test('the grouped dose form keeps the stored spellings behind it', () => {
	const seen = views('00641628501');
	assert.deepEqual(seen.raw.summary, ['INJECTION', 'INJECTION, SOLUTION']);
	assert.equal(seen.raw.detail, 'INJECTION');
	const summary = summarizeItem(rows, new Map());
	assert.equal(summary.doseForms.length, 1, 'one row, not INJECTION and INJECTION, SOLUTION');
	assert.equal(summary.doseForms[0].ndcs.length, 2);
});

test('an unlabeled vial takes its carton sibling’s dose type, and says where it came from', () => {
	const own = resolveDoseTypes([packagingFacts(vial)]).get(vial.ndc)!;
	assert.equal(own.value, NOT_SPECIFIED);
	const lent = resolveDoseTypes([vial, carton].map(packagingFacts)).get(vial.ndc)!;
	assert.equal(lent.value, 'MDV');
	assert.equal(lent.from, carton.ndc);
	assert.match(lent.reason, /0641-6285-10/);
	assert.equal(
		resolveDoseTypes([vial, carton].map(packagingFacts)).get(carton.ndc)!.from,
		undefined
	);
});

test('a sibling of another size, or siblings that disagree, lend nothing', () => {
	const bigger = catalogPackage('00641628520', {
		description: '30 mL in 1 VIAL, MULTI-DOSE',
		size: { kind: 'volume', value: 30, unit: 'mL', container: 'VIAL, MULTI-DOSE', packQty: 1 }
	});
	assert.equal(
		resolveDoseTypes([vial, bigger].map(packagingFacts)).get(vial.ndc)!.value,
		NOT_SPECIFIED
	);
	const single = catalogPackage('00641628530', { isMultiDose: false });
	assert.equal(
		resolveDoseTypes([vial, carton, single].map(packagingFacts)).get(vial.ndc)!.value,
		NOT_SPECIFIED
	);
	const otherProduct = catalogPackage('00641628610', { isMultiDose: true });
	assert.equal(
		resolveDoseTypes([vial, otherProduct].map(packagingFacts)).get(vial.ndc)!.value,
		NOT_SPECIFIED
	);
});
