import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doseFormAbbreviation, packageDescriptionCase, productNameCase } from './package-text';

test('dose forms abbreviate base form first, from SPL or RxNorm spellings', () => {
	for (const [form, abbreviation] of [
		['TABLET', 'TAB'],
		['TABLET, FILM COATED', 'TAB FC'],
		['TABLET, FILM COATED, EXTENDED RELEASE', 'TAB FC ER'],
		['CAPSULE, DELAYED RELEASE', 'CAP DR'],
		['INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION', 'INJ PWD SOLN'],
		['INJECTION, SOLUTION', 'INJ SOLN'],
		['FOR SUSPENSION', 'PWD SUSP'],
		['TABLET, ORALLY DISINTEGRATING', 'ODT'],
		['SOLUTION/ DROPS', 'SOLN DROPS'],
		['Oral Tablet', 'TAB'],
		['Extended Release Oral Tablet', 'TAB ER'],
		['Delayed Release Oral Capsule', 'CAP DR'],
		['KIT', 'KIT']
	]) {
		assert.equal(doseFormAbbreviation(form), abbreviation, form);
	}
});

test('package descriptions lose their shouting but keep NDCs and units', () => {
	assert.equal(
		packageDescriptionCase(
			'1 VIAL, SINGLE-DOSE in 1 CARTON (60505-6147-0)  / 1 INJECTION, POWDER, FOR SOLUTION in 1 VIAL, SINGLE-DOSE'
		),
		'1 vial, single-dose in 1 carton (60505-6147-0) / 1 injection, powder, for solution in 1 vial, single-dose'
	);
	assert.equal(packageDescriptionCase('500 mL in 1 BOTTLE, HDPE'), '500 mL in 1 bottle, HDPE');
	assert.equal(packageDescriptionCase('1 L in 1 BAG'), '1 L in 1 bag');
});

test('product names are title-cased only when all one case', () => {
	assert.equal(productNameCase('METOPROLOL TARTRATE'), 'Metoprolol Tartrate');
	assert.equal(productNameCase('WELLBUTRIN XL'), 'Wellbutrin XL');
	assert.equal(productNameCase('clonazepam'), 'Clonazepam');
	assert.equal(productNameCase('SERTRALINE HCL'), 'Sertraline HCl');
	assert.equal(productNameCase('Bupropion Hydrochloride XL'), 'Bupropion Hydrochloride XL');
	assert.equal(productNameCase('pH-Balanced'), 'pH-Balanced');
});
