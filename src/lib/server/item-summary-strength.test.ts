import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nominalStrength } from '../item-summary';
import { rxNormStrengths } from '../spl-strength-checks';

test('rxNormStrengths keeps an amount in the denominator', () => {
	const [strength] = rxNormStrengths('sodium chloride 900 MG/100ML Injection');
	assert.deepEqual(strength, { name: 'sodium chloride', value: 900, unit: 'MG', per: 100, perUnit: 'ML' });
	assert.equal(rxNormStrengths('heparin 5000 UNT/ML Injectable Solution')[0].per, 1);
});

test('nominalStrength scales label strengths to a per-100 mL title', () => {
	assert.equal(nominalStrength('9 g/1000 mL', 'MG/100ML'), '900 mg');
	assert.equal(nominalStrength('3.54 g/1000 mL', 'MG/100ML'), '354 mg');
	assert.equal(nominalStrength('900 mg/100 mL', 'MG/100ML'), '900 mg');
	assert.equal(nominalStrength('154 meq/1000 mL', 'MG/100ML'), '154 meq/1000 mL');
});
