import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewPackage } from './review-package';
import { resolveEffectivePackage } from './effective-package';
import { packageFixture } from '../server/testing/package-fixture';
import type { ReviewRequest } from '../curation/reinterpret';

const request = (patch: Partial<ReviewRequest> = {}): ReviewRequest => ({
	marks: {},
	notes: {},
	note: '',
	overrides: {},
	keepRows: {},
	preferredSetId: '',
	...patch
});
const stamp = (value: string) => ({ value, source: 'none' as const, createdAt: '2026-10-19' });
const vial = () =>
	packageFixture({
		ingredients: [{ name: 'DRUG', strength: '1000 mg' }],
		reconstitution: [
			{ id: 'vial', vialMassMg: 1000, diluentMl: 9, finalVolumeMl: 10, concentrations: [] }
		]
	});

test('a locked review preserves provider-derived and manually corrected volumes', () => {
	const original = resolveEffectivePackage({
		...vial(),
		propertyOverrides: { 'resolvedVolume.finalVolumeMl': stamp('12') }
	});
	const before = structuredClone(original);
	const { item } = reviewPackage(original, vial(), request());
	assert.equal(item.resolvedVolume?.finalVolumeMl, 12);
	assert.deepEqual(original, before);
});

test('reviewing new reconstitution facts recomputes volume before applying retained manual corrections', () => {
	const current = { ...vial(), propertyOverrides: { 'resolvedVolume.finalVolumeMl': stamp('12') } };
	const fresh = {
		...vial(),
		reconstitution: [
			{ id: 'new', vialMassMg: 1000, diluentMl: 7, finalVolumeMl: 8, concentrations: [] }
		]
	};
	const { item, rows } = reviewPackage(
		current,
		fresh,
		request({ marks: { reconstitution: 'refresh' } })
	);
	assert.equal(item.resolvedVolume?.diluentMl, 7);
	assert.equal(item.resolvedVolume?.finalVolumeMl, 12);
	assert.equal(rows.find((row) => row.key === 'reconstitution')?.changed, true);
});

test('refreshing a detail section removes its old nested overrides instead of replaying them over fresh facts', () => {
	const current = {
		...vial(),
		propertyOverrides: { 'details.product.routes': stamp('ORAL'), brandName: stamp('Keep brand') }
	};
	const fresh = packageFixture({ details: { product: { routes: ['INTRAVENOUS'] } } as never });
	const { item } = reviewPackage(current, fresh, request({ marks: { product: 'refresh' } }));
	assert.deepEqual(item.details?.product?.routes, ['INTRAVENOUS']);
	assert.equal(item.propertyOverrides?.['details.product.routes'], undefined);
	assert.equal(item.brandName, 'Keep brand');
});

test('manual dose-form changes derive dry-fill state and clear incompatible volume facts', () => {
	const current = resolveEffectivePackage(vial(), { recomputeVolume: true });
	const { item } = reviewPackage(
		current,
		vial(),
		request({ overrides: { doseForm: 'INJECTION, SOLUTION' } })
	);
	assert.equal(item.isDryFill, false);
	assert.equal(item.resolvedVolume, null);
	assert.equal(item.doseFormCorrection, null);
});
