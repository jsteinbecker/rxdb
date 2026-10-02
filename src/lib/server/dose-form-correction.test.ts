import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correctDoseForm, type DoseFormInput } from '../dose-form-correction';

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
