import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unitOfSaleLabel, unitOfUseLabel } from './package-unit-label';

const vial = (container: string, packQty = 1) =>
	({ kind: 'volume', value: 4, unit: 'mL', container, packQty }) as const;
const solid = (unit: string, value: number, container: string, packQty = 1) =>
	({ kind: 'count', value, unit, container, packQty }) as const;

describe('package unit labels', () => {
	it('drops volumes from the unit of use', () => {
		assert.equal(unitOfUseLabel(vial('VIAL')), 'vial');
		assert.equal(unitOfUseLabel(vial('15 mL vial')), 'vial');
		assert.equal(unitOfUseLabel(vial('30mL vial')), 'vial');
	});
	it('states the unit of sale as a count of containers', () => {
		assert.equal(unitOfSaleLabel(vial('VIAL')), '1 vial');
		assert.equal(unitOfSaleLabel(vial('30 mL vial, single dose', 10)), '10 x vial, single dose');
	});
	it('uses the dose unit of an oral solid as its unit of use', () => {
		assert.equal(unitOfUseLabel(solid('TABLET', 90, 'BOTTLE')), 'tablet');
		assert.equal(unitOfUseLabel(solid('TABLET, FILM COATED', 30, 'BOTTLE')), 'tablet');
		assert.equal(unitOfUseLabel(solid('CAPSULE', 100, 'BOTTLE')), 'capsule');
	});
	it('counts the contents of an oral solid in its unit of sale', () => {
		assert.equal(unitOfSaleLabel(solid('TABLET', 90, 'BOTTLE')), '1 bottle x 90 tablets');
		assert.equal(
			unitOfSaleLabel(solid('CAPSULE, GELATIN COATED', 30, 'BOTTLE, PLASTIC')),
			'1 bottle, plastic x 30 capsules'
		);
		assert.equal(
			unitOfSaleLabel(solid('TABLET', 10, 'BLISTER PACK', 10)),
			'10 x blister pack x 10 tablets'
		);
		assert.equal(
			unitOfSaleLabel(solid('TABLET', 1, 'BLISTER PACK', 100)),
			'100 x blister pack x 1 tablet'
		);
	});
});
