import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	addBrand,
	brandKey,
	mergeBrands,
	parseBrandName,
	removeBrand,
	type BrandRow
} from './brand-tags';

const row = (
	name: string,
	source: BrandRow['source'] = 'rxnorm',
	suppressed = false
): BrandRow => ({
	name,
	nameKey: brandKey(name),
	source,
	suppressed
});

test('parseBrandName trims, collapses whitespace, and bounds length', () => {
	assert.deepEqual(parseBrandName('  Vaso   pressin '), { name: 'Vaso pressin' });
	assert.ok('error' in parseBrandName('   '));
	assert.ok('error' in parseBrandName('x'.repeat(121)));
});

test('mergeBrands seeds a first load, deduping case-insensitively', () => {
	assert.deepEqual(mergeBrands([], ['Vasostrict', 'VASOSTRICT', 'Pitressin']), [
		'Vasostrict',
		'Pitressin'
	]);
});

test('mergeBrands on reload adds only new brands', () => {
	assert.deepEqual(mergeBrands([row('Vasostrict')], ['vasostrict', 'Pitressin']), ['Pitressin']);
});

test('mergeBrands never resurrects a dismissed brand or drops a dropped one', () => {
	const existing = [row('Vasostrict', 'rxnorm', true), row('Old Brand')];
	assert.deepEqual(mergeBrands(existing, ['Vasostrict']), []);
});

test('mergeBrands leaves a manual tag alone even if RxNorm later reports it', () => {
	assert.deepEqual(mergeBrands([row('Custom', 'manual')], ['custom']), []);
});

test('addBrand inserts, un-suppresses, or does nothing', () => {
	assert.deepEqual(addBrand([], 'New'), { action: 'insert' });
	assert.deepEqual(addBrand([row('New', 'rxnorm', true)], 'new'), {
		action: 'unsuppress',
		key: 'new'
	});
	assert.deepEqual(addBrand([row('New')], 'NEW'), { action: 'none' });
});

test('removeBrand deletes manual tags and suppresses RxNorm tags', () => {
	assert.deepEqual(removeBrand([row('Mine', 'manual')], 'mine'), { action: 'delete' });
	assert.deepEqual(removeBrand([row('Theirs')], 'theirs'), { action: 'suppress' });
	assert.deepEqual(removeBrand([row('Theirs', 'rxnorm', true)], 'theirs'), { action: 'none' });
	assert.deepEqual(removeBrand([], 'x'), { action: 'none' });
});
