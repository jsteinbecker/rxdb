import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standardConcentration } from './standard-concentration';
import type { VialPrepPackage } from './vial-prep-consensus';
import type { ProseReconstitution } from '../labels/dry-fill-volume';

const row = (
	vialMassMg: number | null,
	diluentMl: number,
	mgPerMl: number | null,
	over: Partial<ProseReconstitution> = {}
): ProseReconstitution => ({
	vialMassMg,
	diluentMl,
	concentrations: mgPerMl === null ? [] : [{ name: null, mgPerMl }],
	routes: ['IV'],
	...over
});
const pkg = (
	ndc: string,
	rows: ProseReconstitution[],
	isDryFill: boolean | null = true
): VialPrepPackage => ({
	packageId: ndc,
	ndc,
	title: ndc,
	isDryFill,
	reconstitution: rows
});

test('ampicillin IV: vial sizes that agree give one standard', () => {
	const result = standardConcentration('IV', [
		{ itemId: '1g', packages: [pkg('a', [row(1000, 10, 100)]), pkg('b', [row(1000, 10, 100)])] },
		{ itemId: '2g', packages: [pkg('c', [row(2000, 20, 100)])] },
		{ itemId: '500mg', packages: [pkg('d', [row(500, 5, 100)])] }
	]);
	assert.equal(result.status, 'agreed');
	assert.equal(result.mgPerMl, 100);
	assert.deepEqual(
		result.items.map((i) => i.status),
		['agreed', 'agreed', 'agreed']
	);
});

test('an item whose labels split takes the standard when one of them states it', () => {
	const result = standardConcentration('IV', [
		{ itemId: 'x', packages: [pkg('a', [row(1000, 10, 100)])] },
		{ itemId: 'y', packages: [pkg('b', [row(1000, 10, 100)])] },
		{ itemId: 'tied', packages: [pkg('c', [row(1000, 10, 100)]), pkg('d', [row(1000, 5, 200)])] }
	]);
	assert.equal(result.mgPerMl, 100);
	const tied = result.items[2];
	assert.equal(tied.status, 'standardized');
	assert.equal(tied.mgPerMl, 100);
	assert.ok(tied.flags.includes('conflict'));
	assert.ok(!tied.flags.includes('tie'));
});

test('a bulk vial made up differently keeps its own value and is listed as differing', () => {
	const result = standardConcentration('IV', [
		{ itemId: '1g', packages: [pkg('a', [row(1000, 10, 100)])] },
		{ itemId: '2g', packages: [pkg('b', [row(2000, 20, 100)])] },
		{ itemId: '10g', packages: [pkg('c', [row(10000, 94, 95)])] }
	]);
	assert.equal(result.mgPerMl, 100);
	assert.equal(result.items[2].status, 'differs');
	assert.deepEqual(result.differing, ['10g']);
});

test('a lone tie with no standard to settle it needs review', () => {
	const result = standardConcentration('IV', [
		{ itemId: 'x', packages: [pkg('a', [row(1000, 10, 100)]), pkg('b', [row(1000, 5, 200)])] }
	]);
	assert.equal(result.status, 'review');
	assert.equal(result.mgPerMl, null);
	assert.equal(result.items[0].status, 'review');
	assert.ok(result.items[0].flags.includes('tie'));
});

test('alternatives every label states are settled by the standard', () => {
	const im = (ndc: string) =>
		pkg(ndc, [row(1000, 2.1, 350, { routes: ['IM'] }), row(1000, 3.6, 250, { routes: ['IM'] })]);
	const result = standardConcentration('IM', [
		{ itemId: 'both', packages: [im('a'), im('b')] },
		{ itemId: 'one', packages: [pkg('c', [row(500, 1.8, 250, { routes: ['IM'] })])] }
	]);
	assert.equal(result.mgPerMl, 250);
	assert.equal(result.items[0].status, 'standardized');
	assert.equal(result.items[0].mgPerMl, 250);
});

test('only another route stated: falls back to route-less steps and asks for review', () => {
	const result = standardConcentration('IV', [
		{
			itemId: 'x',
			packages: [
				pkg('a', [row(1000, 10, 100, { routes: undefined }), row(1000, 3, 330, { routes: ['IM'] })])
			]
		}
	]);
	assert.equal(result.items[0].mgPerMl, 100);
	assert.equal(result.items[0].status, 'review');
	assert.ok(result.items[0].flags.includes('route-unstated'));
});

test('no stated concentration: computed from final volume, else diluent (displacement)', () => {
	const withFinal = standardConcentration('IV', [
		{ itemId: 'x', packages: [pkg('a', [row(1000, 9.3, null, { finalVolumeMl: 10 })])] }
	]);
	assert.equal(withFinal.items[0].mgPerMl, 100);
	assert.ok(withFinal.items[0].flags.includes('computed'));
	assert.ok(!withFinal.items[0].flags.includes('displacement'));
	assert.equal(withFinal.items[0].status, 'review');
	assert.equal(withFinal.status, 'review');

	const diluentOnly = standardConcentration('IV', [
		{ itemId: 'x', packages: [pkg('a', [row(1000, 10, null)])] }
	]);
	assert.ok(diluentOnly.items[0].flags.includes('displacement'));
});

test('a stated value outranks a computed one at the same concentration', () => {
	const result = standardConcentration('IV', [
		{ itemId: 'x', packages: [pkg('a', [row(1000, 10, null)]), pkg('b', [row(1000, 10, 100)])] }
	]);
	assert.equal(result.items[0].options.length, 1);
	assert.equal(result.items[0].options[0].computed, false);
	assert.ok(!result.items[0].flags.includes('computed'));
});

test('ready-to-use items need nothing; silent dry fills are flagged', () => {
	const result = standardConcentration('IV', [
		{ itemId: 'rtu', packages: [pkg('a', [], false)] },
		{ itemId: 'quiet', packages: [pkg('b', [row(1000, 10, 100)]), pkg('c', []), pkg('d', [])] },
		{ itemId: 'none', packages: [pkg('e', [])] }
	]);
	assert.equal(result.items[0].status, 'not-needed');
	assert.equal(result.items[1].status, 'review');
	assert.ok(result.items[1].flags.includes('silent-packages'));
	assert.equal(result.items[2].status, 'review');
	assert.ok(result.items[2].flags.includes('no-data'));
	assert.deepEqual(result.review, ['quiet', 'none']);
});

test('a combination uses the lead named ingredient and flags unnamed values', () => {
	const named = standardConcentration(
		'IV',
		[
			{
				itemId: 'pt',
				packages: [
					pkg('a', [
						row(4500, 20, null, {
							concentrations: [
								{ name: 'PIPERACILLIN', mgPerMl: 200 },
								{ name: 'TAZOBACTAM', mgPerMl: 25 }
							]
						})
					])
				]
			}
		],
		true
	);
	assert.equal(named.items[0].mgPerMl, 200);
	assert.equal(named.items[0].status, 'agreed');

	const unnamed = standardConcentration(
		'IV',
		[{ itemId: 'pt', packages: [pkg('a', [row(4500, 20, 225)])] }],
		true
	);
	assert.equal(unnamed.items[0].status, 'review');
	assert.ok(unnamed.items[0].flags.includes('combination'));
});

test('oral bottles only count for PO', () => {
	const bottle = row(null, 90, 50, { bottle: true, finalVolumeMl: 100, routes: ['PO'] });
	assert.equal(
		standardConcentration('IV', [{ itemId: 'x', packages: [pkg('a', [bottle], null)] }]).status,
		'not-needed'
	);
	assert.equal(
		standardConcentration('PO', [{ itemId: 'x', packages: [pkg('a', [bottle])] }]).mgPerMl,
		50
	);
});
