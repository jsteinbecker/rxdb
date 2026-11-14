import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applyPackageReview,
	curatedPackage,
	packageReviewPatch,
	providerBaseline,
	recoverLegacyBaseline
} from './package-state';
import { packageFixture } from '../server/testing/package-fixture';

const stamp = (value: string) => ({ value, createdAt: '2026-10-20', source: 'none' as const });

test('removing a correction replays the pristine baseline without any provider request', () => {
	const baseline = packageFixture({ doseForm: 'INJECTION, POWDER, FOR SOLUTION' });
	assert.equal(
		curatedPackage(baseline, { doseForm: stamp('INJECTION, SOLUTION') }, {}, 1).doseForm,
		'INJECTION, SOLUTION'
	);
	assert.equal(curatedPackage(baseline, {}, {}, 2).doseForm, 'INJECTION, POWDER, FOR SOLUTION');
	assert.equal(baseline.doseForm, 'INJECTION, POWDER, FOR SOLUTION');
});

test('baseline serialization removes scope decorations, decisions and concurrency metadata', () => {
	const effective = packageFixture({
		editRevision: 3,
		manualExclusion: 'Hold',
		localConcept: { name: 'Local' } as never,
		propertyOverrides: { doseForm: stamp('TABLET') },
		details: {
			product: {
				pharmClasses: ['Resolved'],
				pharmClassResolution: { source: ['Original'], applied: [] }
			}
		} as never
	});
	const baseline = providerBaseline(effective);
	assert.equal(baseline.editRevision, undefined);
	assert.equal(baseline.localConcept, undefined);
	assert.equal(baseline.propertyOverrides, undefined);
	assert.equal(baseline.manualExclusion, undefined);
	assert.deepEqual(baseline.details?.product?.pharmClasses, ['Original']);
	assert.deepEqual(effective.details?.product?.pharmClasses, ['Resolved']);
});

test('legacy recovery restores only correction-owned groups and preserves unrelated newer facts', () => {
	const original = packageFixture({
		description: 'Original',
		brandName: 'Old brand',
		doseForm: 'CAPSULE'
	});
	const latest = packageFixture({
		description: 'Corrected',
		brandName: 'New brand',
		doseForm: 'CAPSULE',
		propertyOverrides: { description: stamp('Corrected') }
	});
	const { baseline, unknownKeys } = recoverLegacyBaseline(latest, original);
	assert.equal(baseline.description, 'Original');
	assert.equal(baseline.brandName, 'New brand');
	assert.deepEqual(unknownKeys, []);
});

test('a legacy value with no recorded original is cleared honestly rather than treated as provider evidence', () => {
	const latest = packageFixture({
		doseForm: 'TABLET',
		propertyOverrides: { doseForm: stamp('TABLET') }
	});
	const { baseline, unknownKeys } = recoverLegacyBaseline(latest, null);
	assert.equal(baseline.doseForm, null);
	assert.deepEqual(unknownKeys, ['doseForm']);
	assert.equal(
		curatedPackage(baseline, latest.propertyOverrides!, {}, 1, unknownKeys).doseForm,
		'TABLET'
	);
	assert.equal(curatedPackage(baseline, {}, {}, 2, unknownKeys).doseForm, null);
});

test('review patches remain independent from retained field overrides', () => {
	const baseline = packageFixture({ brandName: 'Provider' });
	const reviewed = { ...baseline, brandName: 'Reviewed' };
	const review = packageReviewPatch(baseline, reviewed);
	assert.deepEqual(review, { brandName: 'Reviewed' });
	assert.equal(
		curatedPackage(baseline, { labelerName: stamp('Corrected labeler') }, review, 1).brandName,
		'Reviewed'
	);
	assert.equal(applyPackageReview(baseline, review).labelerName, baseline.labelerName);
});
