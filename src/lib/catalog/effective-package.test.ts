import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEffectivePackage, mergePackage } from './effective-package';
import { packageFixture } from '../server/testing/package-fixture';

const corrected = () =>
	packageFixture({
		ingredients: [{ name: 'DRUG', strength: '1000 mg' }],
		reconstitution: [
			{ id: 'vial', vialMassMg: 1000, diluentMl: 9, finalVolumeMl: 10, concentrations: [] }
		],
		propertyOverrides: {
			'resolvedVolume.finalVolumeMl': { value: '12', createdAt: '2026-10-19', source: 'none' },
			'resolvedVolume.powderDisplacementMl': { value: '3', createdAt: '2026-10-19', source: 'none' }
		}
	});

test('explicit volume corrections win after recomputation and resolution does not mutate its input', () => {
	const source = corrected();
	const result = resolveEffectivePackage(source, { recomputeVolume: true });
	assert.equal(result.resolvedVolume?.finalVolumeMl, 12);
	assert.equal(result.resolvedVolume?.powderDisplacementMl, 3);
	assert.equal(source.resolvedVolume, null);
	assert.deepEqual(resolveEffectivePackage(result, { recomputeVolume: true }), result);
});

test('fresh and partial refreshes keep manual volume decisions through the same resolver', () => {
	const previous = resolveEffectivePackage(corrected());
	for (const complete of [true, false]) {
		const fresh = packageFixture({
			complete,
			ingredients: [{ name: 'DRUG', strength: '1000 mg' }],
			reconstitution: previous.reconstitution
		});
		const result = mergePackage(previous, fresh);
		assert.equal(result.resolvedVolume?.finalVolumeMl, 12);
		assert.equal(result.resolvedVolume?.powderDisplacementMl, 3);
	}
});

test('manual dose-form changes use the same classification and volume policy as review', () => {
	const item = corrected();
	item.propertyOverrides = {
		doseForm: { value: 'INJECTION, SOLUTION', createdAt: '2026-10-19', source: 'none' }
	};
	const result = resolveEffectivePackage(item);
	assert.equal(result.isDryFill, false);
	assert.equal(result.resolvedVolume, null);
});

test('an explicit dry-fill correction wins over derived dose-form classification regardless of order', () => {
	const doseForm = {
		value: 'INJECTION, SOLUTION',
		createdAt: '2026-10-19',
		source: 'none' as const
	};
	const isDryFill = { ...doseForm, value: 'true' };
	for (const propertyOverrides of [
		{ doseForm, isDryFill },
		{ isDryFill, doseForm }
	]) {
		assert.equal(resolveEffectivePackage({ ...corrected(), propertyOverrides }).isDryFill, true);
	}
});
