import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	isBacteriostaticSodiumChloride,
	isBacteriostaticWater,
	isCathflo,
	isHeparinLockFlush,
	isSalineFlush,
	isSterileWaterForInjection,
	productSet,
	setPackageNdcs,
	setsMatching
} from './product-sets';
import type { FdaProduct } from '../providers/openfda';

const swfi = (over: Partial<FdaProduct> = {}): FdaProduct => ({
	product_ndc: '0409-4887',
	brand_name: 'Sterile Water',
	generic_name: 'WATER',
	product_type: 'HUMAN PRESCRIPTION DRUG',
	marketing_category: 'NDA',
	dosage_form: 'INJECTION, SOLUTION',
	route: ['INTRAVENOUS'],
	active_ingredients: [{ name: 'WATER', strength: '1 mL/mL' }],
	openfda: { spl_set_id: ['2b9ea23a-f9e9-48a8-25b7-519e3bbd6828'] },
	packaging: [
		{ package_ndc: '0409-4887-10', description: '25 VIAL, PLASTIC in 1 TRAY' },
		{ package_ndc: '0409-4887-99', description: 'sample', sample: true }
	],
	...over
});

test('approved prescription sterile water injections qualify', () => {
	assert.equal(isSterileWaterForInjection(swfi()), true);
	assert.equal(isSterileWaterForInjection(swfi({ marketing_category: 'ANDA' })), true);
});

test('lookalikes and unapproved or non-finished water products do not', () => {
	for (const over of [
		{ brand_name: 'Bacteriostatic Water' },
		{ brand_name: 'Sterile Diluent for Remodulin' },
		{ brand_name: 'Insulin Diluting Medium for NovoLog', marketing_category: 'BLA' },
		{ marketing_category: 'UNAPPROVED DRUG OTHER' },
		{ product_type: 'VACCINE', marketing_category: 'BLA' },
		{ product_type: 'BULK INGREDIENT', marketing_category: 'BULK INGREDIENT' },
		{
			product_type: 'DRUG FOR FURTHER PROCESSING',
			marketing_category: 'DRUG FOR FURTHER PROCESSING'
		},
		{ dosage_form: 'IRRIGANT', route: ['IRRIGATION'] },
		{ active_ingredients: [{ name: 'WATER' }, { name: 'SODIUM CHLORIDE' }] },
		{ openfda: {} }
	] satisfies Partial<FdaProduct>[])
		assert.equal(isSterileWaterForInjection(swfi(over)), false, JSON.stringify(over));
});

test('set packages are 11-digit, deduplicated, and skip samples', () => {
	const set = productSet('swfi')!;
	assert.deepEqual(
		setPackageNdcs(set, [swfi(), swfi(), swfi({ brand_name: 'Bacteriostatic Water' })]),
		['00409488710']
	);
});

test('searches that name sterile water offer the SWFI set', () => {
	for (const query of [
		'water',
		'Water',
		'sterile water',
		'Sterile Water for Injection',
		'water for injection',
		'water for inj',
		'SWFI',
		'wfi',
		'sterile water 10 mL vial',
		'sterile-water'
	])
		assert.deepEqual(
			setsMatching(query).map((set) => set.key),
			['swfi'],
			query
		);
});

test('other water products and unrelated words do not offer it', () => {
	for (const query of [
		'',
		'wa',
		'wat',
		'ster',
		'sterile water for irrigation',
		'dextrose 5% in water',
		'D5W',
		'sodium chloride in water',
		'watermelon',
		'metformin'
	])
		assert.deepEqual(setsMatching(query), [], query);
});

const product = (over: Partial<FdaProduct>): FdaProduct =>
	swfi({
		packaging: [{ package_ndc: '1234-5678-90', description: '25 VIAL in 1 CARTON' }],
		...over
	});

test('bacteriostatic water qualifies only for its own set', () => {
	const bwfi = product({ brand_name: 'Bacteriostatic Water', generic_name: 'WATER' });
	assert.equal(isBacteriostaticWater(bwfi), true);
	assert.equal(isSterileWaterForInjection(bwfi), false);
	assert.equal(isBacteriostaticWater(swfi()), false);
	assert.equal(
		isBacteriostaticWater(
			product({ brand_name: 'Bacteriostatic Water', marketing_category: 'UNAPPROVED DRUG OTHER' })
		),
		false
	);
	assert.equal(
		isBacteriostaticWater(product({ brand_name: 'Bacteriostatic Water Diluent Kit' })),
		false
	);
});

test('bacteriostatic sodium chloride qualifies, plain saline does not', () => {
	const bns = {
		brand_name: 'Bacteriostatic Sodium Chloride',
		generic_name: 'SODIUM CHLORIDE',
		active_ingredients: [{ name: 'SODIUM CHLORIDE', strength: '9 mg/mL' }]
	};
	assert.equal(isBacteriostaticSodiumChloride(product(bns)), true);
	assert.equal(
		isBacteriostaticSodiumChloride(product({ ...bns, brand_name: 'Sodium Chloride' })),
		false
	);
	assert.equal(isBacteriostaticWater(product(bns)), false);
});

test('saline flush syringes qualify, including unapproved listings', () => {
	const flush = {
		brand_name: 'Sodium Chloride Flush',
		generic_name: 'SODIUM CHLORIDE',
		marketing_category: 'UNAPPROVED DRUG OTHER',
		active_ingredients: [{ name: 'SODIUM CHLORIDE', strength: '9 mg/mL' }],
		packaging: [
			{ package_ndc: '8290-3062-10', description: '30 SYRINGE in 1 BOX > 10 mL in 1 SYRINGE' }
		]
	};
	assert.equal(isSalineFlush(product(flush)), true);
	assert.equal(isSalineFlush(product({ ...flush, marketing_category: 'ANDA' })), true);
	assert.equal(
		isSalineFlush(
			product({ ...flush, active_ingredients: [{ name: 'SODIUM CHLORIDE', strength: '30 mg/mL' }] })
		),
		false
	);
	assert.equal(
		isSalineFlush(
			product({ ...flush, packaging: [{ package_ndc: '1-1-1', description: '25 VIAL in 1 TRAY' }] })
		),
		false
	);
	assert.equal(isSalineFlush(product({ ...flush, brand_name: 'Sodium Chloride' })), false);
	assert.equal(isSalineFlush(product({ ...flush, marketing_category: 'EXPORT ONLY' })), false);
});

test('heparin lock flush qualifies at 10 and 100 units/mL only', () => {
	const hep = (strength: string) =>
		product({
			brand_name: 'Heparin Lock Flush',
			generic_name: 'HEPARIN SODIUM',
			marketing_category: 'ANDA',
			active_ingredients: [{ name: 'HEPARIN SODIUM', strength }]
		});
	assert.equal(isHeparinLockFlush(hep("100 [USP'U]/mL")), true);
	assert.equal(isHeparinLockFlush(hep("10 [USP'U]/1mL")), true);
	assert.equal(isHeparinLockFlush(hep("5000 [USP'U]/mL")), false);
	assert.equal(
		isHeparinLockFlush(
			product({
				brand_name: 'Heparin Sodium',
				generic_name: 'HEPARIN SODIUM',
				active_ingredients: [{ name: 'HEPARIN SODIUM', strength: "100 [USP'U]/mL" }]
			})
		),
		false
	);
});

test('Cathflo qualifies, Activase 50/100 mg does not', () => {
	const tpa = (brand: string) =>
		product({
			brand_name: brand,
			generic_name: 'ALTEPLASE',
			marketing_category: 'BLA',
			dosage_form: 'INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION',
			active_ingredients: [{ name: 'ALTEPLASE', strength: '2.2 mg/2.2mL' }]
		});
	assert.equal(isCathflo(tpa('Cathflo Activase')), true);
	assert.equal(isCathflo(tpa('Activase')), false);
});

test('searches offer the matching new set and nothing else', () => {
	const cases: [string, string][] = [
		['bacteriostatic water', 'bwfi'],
		['BWFI', 'bwfi'],
		['bacteriostatic saline', 'bns'],
		['bacteriostatic sodium chloride 30 mL', 'bns'],
		['saline flush', 'saline-flush'],
		['NS flush 10 mL', 'saline-flush'],
		['heparin flush', 'heparin-flush'],
		['heparin lock flush 100 units/mL', 'heparin-flush'],
		['cathflo', 'cathflo'],
		['alteplase 2 mg', 'cathflo'],
		['alteplase 2mg vial', 'cathflo']
	];
	for (const [query, key] of cases)
		assert.deepEqual(
			setsMatching(query).map((set) => set.key),
			[key],
			query
		);
	for (const query of ['alteplase 100 mg', 'heparin 5000 units', 'sodium chloride', 'normal saline'])
		assert.deepEqual(setsMatching(query), [], query);
});
