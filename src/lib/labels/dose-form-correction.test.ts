import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correctDoseForm, type DoseFormInput } from './dose-form-correction';

// Excerpts from the Cipla amoxicillin/clavulanate label, NDC 69097-098-43.
const amoxClav: DoseFormInput = {
	doseForm: 'SUSPENSION',
	identity: {
		generic_name: 'Amoxicillin and Clavulanate Potassium',
		spl_title: 'AMOXICILLIN AND CLAVULANATE POTASSIUM SUSPENSION [CIPLA USA INC.]',
		package_label_principal_display_panel:
			'NDC 69097-098-43 Amoxicillin and Clavulanate Potassium for Oral Suspension, USP 250 mg/62.5 mg per 5 mL',
		dosage_forms_and_strengths:
			'Powder for Oral Suspension: 250 mg/62.5 mg per 5 mL: Orange-flavored powder for oral suspension'
	},
	instructions: {
		dosage_and_administration:
			'Tap bottle until all powder flows freely. Measure a total of water. Add approximately 2/3 of the water to the powder.',
		how_supplied: 'Store dry powder for oral suspension at 20° -25°C.'
	},
	siblingForms: []
};

test('69097-098-43: SUSPENSION with a powder-for label is promoted', () => {
	const result = correctDoseForm(amoxClav);
	assert.equal(result?.from, 'SUSPENSION');
	assert.equal(result?.to, 'POWDER, FOR SUSPENSION');
	assert.deepEqual(
		result?.evidence.map((item) => item.kind),
		['declaration', 'preparation']
	);
	assert.equal(result?.evidence[0].source, 'package_label_principal_display_panel');
});

test('a genuine ready-made oral suspension is left alone', () => {
	assert.equal(
		correctDoseForm({
			doseForm: 'SUSPENSION',
			identity: {
				package_label_principal_display_panel: 'Ibuprofen Oral Suspension USP 100 mg/5 mL'
			},
			instructions: { dosage_and_administration: 'Shake well before using.' }
		}),
		null
	);
});

test('declaration alone, without preparation evidence, is not enough', () => {
	assert.equal(correctDoseForm({ ...amoxClav, instructions: {} }), null);
});

test('preparation wording in the body without an identity declaration is not enough', () => {
	assert.equal(correctDoseForm({ ...amoxClav, identity: { generic_name: 'Amoxicillin' } }), null);
});

test('a sibling product already coded as the powder vetoes the correction', () => {
	assert.equal(correctDoseForm({ ...amoxClav, siblingForms: ['POWDER, FOR SUSPENSION'] }), null);
});

test('ready-to-use wording vetoes the correction', () => {
	assert.equal(
		correctDoseForm({
			...amoxClav,
			instructions: {
				...amoxClav.instructions,
				how_supplied: 'Supplied as a ready-to-use suspension.'
			}
		}),
		null
	);
});

test('a diluent named "for Injection" does not declare an injectable powder', () => {
	assert.equal(
		correctDoseForm({
			doseForm: 'INJECTION, SOLUTION',
			identity: {
				package_label_principal_display_panel:
					'Ondansetron Injection, USP. Dilute with Sterile Water for Injection.'
			},
			instructions: { dosage_and_administration: 'Reconstitution is not applicable.' }
		}),
		null
	);
});

test('an injectable powder coded as a solution is promoted', () => {
	assert.equal(
		correctDoseForm({
			doseForm: 'INJECTION, SOLUTION',
			identity: { generic_name: 'Ceftriaxone for Injection, USP' },
			instructions: {},
			reconstitutionRows: 3
		})?.to,
		'INJECTION, POWDER, FOR SOLUTION'
	);
});

test('forms outside the promotion table are never touched', () => {
	for (const doseForm of ['TABLET', 'POWDER, FOR SUSPENSION', 'INJECTION, POWDER, FOR SOLUTION']) {
		assert.equal(correctDoseForm({ ...amoxClav, doseForm }), null);
	}
});

test('a sibling coded as any powder variant vetoes the correction', () => {
	// Keytruda 0006-3026 (solution) shares its SPL with 0006-3029 (lyophilized
	// powder); the label's "for Injection … reconstitute" text describes the latter.
	assert.equal(
		correctDoseForm({
			doseForm: 'INJECTION, SOLUTION',
			identity: {
				package_label_principal_display_panel:
					'NDC 0006-3029-02 Keytruda (pembrolizumab) for Injection 50 mg/vial'
			},
			instructions: {
				dosage_and_administration:
					'Lyophilized powder must be reconstituted with Sterile Water for Injection.'
			},
			siblingForms: ['INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION']
		}),
		null
	);
});

// ── Plain INJECTION described as a powder in Description / How Supplied ──────

// Hikma's meropenem 0143-9430 is coded INJECTION throughout; only the label's
// prose says the vial holds a powder. Its sibling 1 g vial is coded the same.
const meropenem: DoseFormInput = {
	doseForm: 'INJECTION',
	identity: { generic_name: 'Meropenem', spl_title: 'MEROPENEM INJECTION [HIKMA]' },
	instructions: {
		dosage_and_administration: 'Constitute the vial with Sterile Water for Injection and shake.'
	},
	supplied: {
		description:
			'Meropenem is a white to pale yellow crystalline powder with a molecular weight of 437.52. Each vial is supplied as a white to pale yellow crystalline powder containing 500 mg of meropenem.',
		how_supplied:
			'Single-dose vials containing 500 mg meropenem NDC 0143-9430-10. Single-dose vials containing 1 gram meropenem NDC 0143-9431-10.'
	},
	ownCodes: ['0143-9430', '0143-9430-01', '0143-9430-10'],
	siblingCodes: ['0143-9431', '0143-9431-10'],
	siblingForms: ['INJECTION']
};

test('0143-9430: INJECTION described as a powder in the vial is promoted', () => {
	const result = correctDoseForm(meropenem);
	assert.equal(result?.to, 'INJECTION, POWDER, FOR SOLUTION');
	assert.deepEqual(
		result?.evidence.map((item) => item.kind),
		['description', 'preparation']
	);
	assert.equal(result?.evidence[0].source, 'description');
});

test('a drug substance described as a powder does not make the product one', () => {
	assert.equal(
		correctDoseForm({
			...meropenem,
			doseForm: 'INJECTION',
			supplied: {
				description:
					'Ondansetron hydrochloride is a white to off-white powder that is soluble in water.'
			}
		}),
		null
	);
});

test('the product described as a clear solution vetoes the correction', () => {
	assert.equal(
		correctDoseForm({
			...meropenem,
			supplied: {
				description:
					'Each vial contains a sterile crystalline powder. Meropenem Injection is a clear, colorless, sterile solution.'
			}
		}),
		null
	);
});

test('powder wording alone, without preparation evidence, is not enough', () => {
	assert.equal(correctDoseForm({ ...meropenem, instructions: {} }), null);
});

test('lyophilized wording selects the lyophilized powder form', () => {
	assert.equal(
		correctDoseForm({
			...meropenem,
			supplied: { how_supplied: 'Supplied as a lyophilized powder in single-dose vials.' }
		})?.to,
		'INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION'
	);
});

test('the RxNorm form "Injection" is corrected like the FDA one', () => {
	assert.equal(correctDoseForm({ ...meropenem, doseForm: 'Injection' })?.from, 'Injection');
});

// A label covering this vial and a differently coded sibling: only text that
// names this product, by NDC or by its strength, may count.
const shared: DoseFormInput = {
	doseForm: 'INJECTION',
	identity: { generic_name: 'Examplemab' },
	instructions: { dosage_and_administration: 'Reconstitute the 50 mg vial with 2.3 mL.' },
	ownCodes: ['1234-0002', '1234-0002-01'],
	siblingCodes: ['1234-0001', '1234-0001-01'],
	siblingForms: ['INJECTION, SOLUTION'],
	scope: {
		own: {
			family: 'injection',
			formLabel: 'injection',
			strengths: [{ text: '100 mg / 4 mL vial', mg: 100, containerMl: 4 }]
		},
		siblings: [
			{
				family: 'injection',
				formLabel: 'injection',
				strengths: [{ text: '50 mg vial', mg: 50, containerMl: null }]
			}
		]
	}
};

test('powder text naming only a sibling NDC does not count', () => {
	assert.equal(
		correctDoseForm({
			...shared,
			supplied: {
				how_supplied: 'Lyophilized powder in a single-dose vial NDC 1234-0001-01.'
			}
		}),
		null
	);
});

test('powder text naming only a sibling strength does not count', () => {
	assert.equal(
		correctDoseForm({
			...shared,
			supplied: { how_supplied: 'For injection: 50 mg, white lyophilized powder in a vial.' }
		}),
		null
	);
});

test('unattributed powder text is ambiguous when a sibling is coded differently', () => {
	assert.equal(
		correctDoseForm({
			...shared,
			supplied: { description: 'Examplemab for injection is a sterile, white lyophilized powder.' }
		}),
		null
	);
});

test('powder text naming this NDC counts despite a differently coded sibling', () => {
	assert.equal(
		correctDoseForm({
			...shared,
			supplied: {
				how_supplied:
					'Injection: 100 mg/4 mL clear solution, NDC 1234-0001-01. For injection: sterile powder in a vial, NDC 1234-0002-01.'
			}
		})?.to,
		'INJECTION, POWDER, FOR SOLUTION'
	);
});

test('a powder-coded sibling still blocks unless this NDC is named', () => {
	const powderSibling = {
		...shared,
		siblingForms: ['INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION']
	};
	assert.equal(
		correctDoseForm({
			...powderSibling,
			supplied: { how_supplied: '100 mg lyophilized powder in a single-dose vial.' }
		}),
		null
	);
	assert.ok(
		correctDoseForm({
			...powderSibling,
			supplied: { how_supplied: '100 mg lyophilized powder in a vial, NDC 1234-0002-01.' }
		})
	);
});

test('drug-substance chemistry and a diluent chamber do not veto the correction', () => {
	// B. Braun's ceftriaxone Duplex 0264-3153: a powder chamber beside a dextrose one.
	assert.ok(
		correctDoseForm({
			...meropenem,
			supplied: {
				description:
					'Each vial contains a sterile crystalline powder. The pH of a 1% aqueous solution is approximately 6.7. Dextrose Injection, USP is a sterile, nonpyrogenic, hypertonic solution.'
			}
		})
	);
});

test('"until ready to use" is not ready-to-use wording', () => {
	// B. Braun's piperacillin/tazobactam Duplex 0264-3446.
	assert.ok(
		correctDoseForm({
			...meropenem,
			instructions: {
				...meropenem.instructions,
				how_supplied: 'Do not remove the foil strip until ready to use to protect from light.'
			}
		})
	);
});
