import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoDate, nominalStrength, summarizeItem } from './item-summary';
import type { FormularyRow } from './hierarchy';
import type { ExternalPackage, PackageDetails } from '../catalog/types';

const row = (ndc: string, over: Partial<FormularyRow> = {}) =>
	({
		ndc,
		labeler: 'Pfizer',
		brandName: null,
		genericName: 'atorvastatin',
		doseForm: 'TABLET, FILM COATED',
		routes: ['ORAL'],
		size: null,
		kit: null,
		isMultiDose: null,
		status: 'active',
		...over
	}) as FormularyRow;

const ingredient = (
	name: string,
	unii: string,
	kind: 'active' | 'inactive',
	strength: string | null = null
) => ({
	name,
	unii,
	kind,
	basis: null,
	strength,
	moieties: kind === 'active' ? [{ name: 'ATORVASTATIN', unii: 'A0JWA85V8F' }] : [],
	productCode: null
});

const snapshot = (
	ndc: string,
	over: { application?: string; start?: string; inactives?: string[]; setId?: string }
) =>
	({
		ndc,
		listed: true,
		marketingEndDate: null,
		isVeterinary: false,
		isDryFill: false,
		ingredients: [],
		splSetId: over.setId ?? 'set-1',
		splTitle: 'Atorvastatin label',
		details: {
			product: {
				productType: 'HUMAN PRESCRIPTION DRUG',
				routes: ['ORAL'],
				marketingCategory: 'ANDA',
				applicationNumber: over.application ?? 'ANDA076477',
				deaSchedule: null,
				marketingStartDate: over.start ?? '20120530',
				listingExpirationDate: null,
				finished: true,
				pharmClasses: ['HMG-CoA Reductase Inhibitor [EPC]'],
				rxcuis: ['617310'],
				uniis: [],
				manufacturers: [],
				splId: null
			},
			packaging: null,
			label: null,
			rxnav: null,
			spl: {
				version: '3',
				publishedDate: null,
				doseForm: null,
				appearances: [],
				otherLabels: [],
				ingredients: [
					ingredient('ATORVASTATIN CALCIUM', '48A5M73Z4Q', 'active', '10 mg'),
					...(over.inactives ?? []).map((name) => ingredient(name, name, 'inactive'))
				]
			}
		} as unknown as PackageDetails
	}) as unknown as ExternalPackage;

test('isoDate reads openFDA and ISO dates', () => {
	assert.equal(isoDate('20120530'), '2012-05-30');
	assert.equal(isoDate('2012-05-30T00:00:00Z'), '2012-05-30');
	assert.equal(isoDate('soon'), null);
});

test('summarizeItem consolidates facts and keeps which NDCs state each', () => {
	const summary = summarizeItem(
		[row('1'), row('2', { labeler: 'Greenstone' }), row('3')],
		new Map([
			['1', snapshot('1', { inactives: ['LACTOSE', 'TALC'] })],
			[
				'2',
				snapshot('2', {
					application: 'NDA020702',
					start: '19961217',
					inactives: ['LACTOSE'],
					setId: 'set-2'
				})
			]
		])
	);
	assert.equal(summary.packageCount, 3);
	assert.equal(summary.enriched, 2);
	assert.deepEqual(summary.labelers, [
		{ value: 'Pfizer', ndcs: ['1', '3'] },
		{ value: 'Greenstone', ndcs: ['2'] }
	]);
	assert.deepEqual(summary.marketingStart, { earliest: '1996-12-17', latest: '2012-05-30' });
	assert.deepEqual(
		summary.applications.map((a) => [a.number, a.labelers]),
		[
			['ANDA076477', ['Pfizer']],
			['NDA020702', ['Greenstone']]
		]
	);
	assert.equal(summary.active.length, 1);
	assert.deepEqual(summary.active[0].moieties, ['ATORVASTATIN']);
	assert.deepEqual(summary.active[0].strengths, [{ value: '10 mg', ndcs: ['1', '2'] }]);
	assert.deepEqual(summary.inactive, [
		{ value: 'LACTOSE', ndcs: ['1', '2'] },
		{ value: 'TALC', ndcs: ['1'] }
	]);
	assert.deepEqual(
		summary.rxcuis.map((r) => [r.rxcui, r.ndcs]),
		[['617310', ['1', '2']]]
	);
	assert.equal(summary.labels.length, 2);
	assert.deepEqual(summary.doseTypes, []);
});

test('summarizeItem folds directory-only ingredients into the same-named SPL ingredient', () => {
	const bare = {
		ndc: '2',
		ingredients: [{ name: 'Atorvastatin Calcium Trihydrate', strength: '10 mg/1' }],
		details: null
	} as unknown as ExternalPackage;
	const labeled = snapshot('1', {});
	labeled.details!.spl!.ingredients[0].name = 'ATORVASTATIN CALCIUM TRIHYDRATE';
	const summary = summarizeItem(
		[row('2'), row('1')],
		new Map([
			['2', bare],
			['1', labeled]
		])
	);
	assert.equal(summary.active.length, 1);
	assert.deepEqual(summary.active[0].ndcs, ['1', '2']);
	assert.deepEqual(
		summary.active[0].strengths.map((s) => s.value),
		['10 mg', '10 mg/1']
	);
});

test('summarizeItem does not flag an unlisted NDC enriched through a listed sibling', () => {
	const unlisted = (ndc: string, siblings: string[]) => {
		const item = snapshot(ndc, {});
		Object.assign(item, { listed: false });
		item.details!.packaging = {
			marketingStartDate: null,
			sample: null,
			siblings: siblings.map((sibling) => ({ ndc: sibling, description: null }))
		};
		return item;
	};
	const bag = unlisted('1', ['2']);
	const orphan = unlisted('3', []);
	const summary = summarizeItem(
		[row('1'), row('2'), row('3')],
		new Map([
			['1', bag],
			['2', snapshot('2', {})],
			['3', orphan]
		])
	);
	assert.deepEqual(summary.unlisted, ['3']);
});

test('nominalStrength restates label strengths in the title unit', () => {
	const cases: [string, string][] = [
		['10 g', '10000 mg'],
		['10000 mg', '10000 mg'],
		['10 g/15 g', '10000 mg'],
		['10 g/15g', '10000 mg'],
		['100 mg/1 mL', '100 mg/mL'],
		['100 mg/mL', '100 mg/mL']
	];
	for (const [label, shown] of cases) assert.equal(nominalStrength(label, 'MG/ML'), shown);
	assert.equal(nominalStrength('5 g', null), '5 g');
});
