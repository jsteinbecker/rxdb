import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
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
		'bacteriostatic water',
		'sterile water for irrigation',
		'dextrose 5% in water',
		'D5W',
		'sodium chloride in water',
		'watermelon',
		'metformin'
	])
		assert.deepEqual(setsMatching(query), [], query);
});
