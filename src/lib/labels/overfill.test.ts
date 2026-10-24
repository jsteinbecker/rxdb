import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliveredAmount } from './overfill';

// Cathflo Activase (50242-041), DESCRIPTION and administration, abridged.
const cathflo =
	'Each vial of Cathflo Activase contains 2.2 mg of Alteplase (which includes a 10% overfill), ' +
	'77 mg of L-arginine, 0.2 mg of polysorbate 80, and phosphoric acid for pH adjustment. ' +
	'Each reconstituted vial will deliver 2 mg of Cathflo Activase, at a pH of approximately 7.3. ' +
	'Withdraw 2 mL (2 mg) of solution from the reconstituted vial.';

test('a stated overfill gives the delivered amount', () => {
	assert.equal(deliveredAmount('2.2 mg/2mL', cathflo), '2 mg');
	assert.equal(deliveredAmount('2.2 mg', cathflo), '2 mg');
});

test('no overfill statement is no evidence', () => {
	const text = cathflo.replace(' (which includes a 10% overfill)', '');
	assert.equal(deliveredAmount('2.2 mg/2mL', text), null);
});

test('the delivered amount must sit just under the printed one, in its unit', () => {
	assert.equal(deliveredAmount('2 mg', cathflo), null);
	assert.equal(deliveredAmount('5 mg', cathflo), null);
	assert.equal(deliveredAmount('2.2 g', cathflo), null);
});

test('a label naming two delivered amounts for one printed number says nothing', () => {
	const text = `${cathflo} The 2.1 mg vial will deliver 1.9 mg.`;
	assert.equal(deliveredAmount('2.2 mg', text), null);
});

test('a two-strength label picks the amount this vial delivers', () => {
	const text =
		'Each vial includes an overfill. The 52.5 mg vial will deliver 50 mg; the 105 mg vial will deliver 100 mg.';
	assert.equal(deliveredAmount('52.5 mg', text), '50 mg');
	assert.equal(deliveredAmount('105 mg', text), '100 mg');
});
