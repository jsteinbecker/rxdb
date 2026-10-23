import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ruleKeyText } from './pharm-class-rule-label';

test('spells out each facet that is set', () => {
	assert.equal(
		ruleKeyText({
			moietyNames: 'Lidocaine',
			doseFormGroup: 'injectable',
			route: null,
			strengthKey: '20/1 mg/mL'
		}),
		'Lidocaine · Injectable · 20 mg/mL'
	);
	assert.equal(
		ruleKeyText({ moietyNames: 'A', doseFormGroup: null, route: null, strengthKey: '1/2 mg/1' }),
		'A · 0.5 mg'
	);
});

test('leaves out unset facets and joins combination strengths', () => {
	assert.equal(
		ruleKeyText({ moietyNames: 'A / B', doseFormGroup: null, route: null, strengthKey: null }),
		'A / B'
	);
	assert.equal(
		ruleKeyText({
			moietyNames: 'A / B',
			doseFormGroup: 'oral-solid',
			route: 'ORAL',
			strengthKey: 'UA=5/1 mg/1|UB=1/2 g/mL'
		}),
		'A / B · Oral solid · Oral · A 5 mg + B 0.5 g/mL'
	);
});

test('pairs combination strengths with names in moiety-UNII order, not name order', () => {
	assert.equal(
		ruleKeyText({
			moietyNames: 'Zeta / Alpha',
			doseFormGroup: null,
			route: null,
			strengthKey: 'U1=5/1 mg/1|U2=10/1 mg/1'
		}),
		'Zeta / Alpha · Zeta 5 mg + Alpha 10 mg'
	);
});

test('claims no pairing when the name count does not match', () => {
	assert.equal(
		ruleKeyText({
			moietyNames: 'Only',
			doseFormGroup: null,
			route: null,
			strengthKey: 'U1=5/1 mg/1|U2=10/1 mg/1'
		}),
		'Only · 5 mg + 10 mg'
	);
});
