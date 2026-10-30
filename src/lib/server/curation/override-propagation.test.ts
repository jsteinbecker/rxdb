import assert from 'node:assert/strict';
import test from 'node:test';
import { packageFixture } from '../testing/package-fixture';
import { siblingCopies } from './override-propagation';
import { isUnitOfUseKey, sameUnitOfUse } from '../../curation/property-override-fields';

const vial = (ndc: string, packQty: number, value = 10) =>
	packageFixture({
		ndc,
		size: { kind: 'volume', value, unit: 'mL', container: 'VIAL', packQty }
	});
const saved = (value: string, extra = {}) => ({
	value,
	createdAt: '2026-10-07T00:00:00.000Z',
	source: 'none' as const,
	...extra
});

test('the vial, its carton of 10 and its tray of 25 hold the same unit of use', () => {
	assert.ok(sameUnitOfUse(vial('1', 1), vial('2', 10)));
	assert.ok(sameUnitOfUse(vial('1', 10), vial('3', 25)));
	assert.ok(!sameUnitOfUse(vial('1', 1), vial('4', 1, 30)));
	assert.ok(!sameUnitOfUse(packageFixture({ size: null }), vial('2', 10)));
});

test('a corrected fill still matches siblings showing the value it replaced', () => {
	const corrected = {
		...vial('1', 1, 20),
		propertyOverrides: { 'size.value': saved('20') }
	};
	assert.ok(sameUnitOfUse(corrected, vial('2', 10, 10)));
});

test('unit-of-use corrections reach same-unit siblings; package fields stay put', () => {
	const overrides = {
		'reconstitution.0.diluentMl': saved('9.6'),
		'size.packQty': saved('10'),
		description: saved('Edited'),
		'details.spl.ingredients.0.strength': saved('500 mg')
	};
	assert.ok(isUnitOfUseKey('resolvedVolume.finalVolumeMl'));
	assert.deepEqual(Object.keys(siblingCopies(vial('1', 1), vial('2', 25), overrides)).sort(), [
		'details.spl.ingredients.0.strength',
		'reconstitution.0.diluentMl'
	]);
	assert.deepEqual(Object.keys(siblingCopies(vial('1', 1), vial('4', 1, 30), overrides)), [
		'details.spl.ingredients.0.strength'
	]);
	const copy = siblingCopies(vial('1', 1), vial('2', 25), overrides)['reconstitution.0.diluentMl'];
	assert.equal(copy.propagatedFrom, '1');
});

test("a sibling's own correction is kept and a copy already passed along is not restaged", () => {
	const overrides = { 'size.container': saved('VIAL, SINGLE-DOSE') };
	const own = { ...vial('2', 10), propertyOverrides: { 'size.container': saved('AMPULE') } };
	assert.deepEqual(siblingCopies(vial('1', 1), own, overrides), {});
	const copied = {
		...vial('2', 10),
		propertyOverrides: { 'size.container': saved('VIAL, SINGLE-DOSE', { propagatedFrom: '1' }) }
	};
	assert.deepEqual(siblingCopies(vial('1', 1), copied, overrides), {});
	const stale = {
		...vial('2', 10),
		propertyOverrides: { 'size.container': saved('VIAL', { propagatedFrom: '9' }) }
	};
	assert.ok(siblingCopies(vial('1', 1), stale, overrides)['size.container']);
});
