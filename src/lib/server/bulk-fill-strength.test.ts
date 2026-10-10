import test from 'node:test';
import assert from 'node:assert/strict';
import { absoluteFillStrength, pharmacyBulkFillMl } from '../ingredient-content';

const BULK = '1 VIAL, PHARMACY BULK PACKAGE in 1 CARTON (0409-5017-01)  / 100 mL in 1 VIAL, PHARMACY BULK PACKAGE';

test('bulk vial keeps a reconstituted concentration (vancomycin 0409-5017)', () => {
	assert.equal(absoluteFillStrength('500 mg/5mL', pharmacyBulkFillMl(BULK, 100)), '500 mg/5mL');
});

test('bulk vial whose volume matches the denominator reads per vial', () => {
	assert.equal(absoluteFillStrength('12 g/60mL', pharmacyBulkFillMl(BULK, 60)), '12 g');
	assert.equal(absoluteFillStrength('36 g/250mL', pharmacyBulkFillMl(BULK, 152)), '36 g');
});

test('single-dose vial still strips the denominator', () => {
	assert.equal(absoluteFillStrength('500 mg/10mL', pharmacyBulkFillMl('20 mL in 1 VIAL', 20)), '500 mg');
	assert.equal(absoluteFillStrength('1 g/20mL'), '1 g');
});

test('per-mL dry-fill strength is a concentration, not the fill (Anavip 66621-0790)', () => {
	assert.equal(absoluteFillStrength('12 mg/mL', null, 10), '120 mg');
	assert.equal(absoluteFillStrength('12 mg/1 mL', null, 10), '120 mg');
	assert.equal(absoluteFillStrength('12 mg/mL'), '12 mg/mL');
});
