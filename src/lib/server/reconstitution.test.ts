import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMassMg,
  parseConcentrationMgPerMl,
  parseReconstitutionTable,
  reconstitutionFromLabel
} from '../reconstitution';
import { parseReconstitutionProse, dedupeProseReconstitutions } from '../dry-fill-volume';
import { parsePackageFacts } from './catalog-facts';

const table = `<table><tr><th>Vial size (mg)</th><th>Diluent added (mL)</th><th>Volume after reconstitution (mL)</th><th>Concentration (mg/mL)</th></tr><tr><td>1000</td><td>9.6</td><td>10</td><td>100</td></tr></table>`;

test('reads quantities with grouped digits, micrograms and explicit concentration denominators', () => {
  assert.equal(parseMassMg('1,000 mg'), 1000);
  assert.equal(parseMassMg('250 μg'), 0.25);
  assert.equal(parseConcentrationMgPerMl('250 milligrams per 5 milliliters'), 50);
  assert.equal(parseConcentrationMgPerMl('10 mg/0 mL'), null);
});

test('header units and resulting volume are distinct from diluent', () => {
  assert.deepEqual(parseReconstitutionTable(table), [
    { vialMassMg: 1000, diluentMl: 9.6, finalVolumeMl: 10, concentrationMgPerMl: 100 }
  ]);
});

test('namespaced tables and footnote markers retain their values', () => {
  const xml = table
    .replace(/<(\/?)(\w+)/g, '<$1hl7:$2')
    .replace('1000</', '1000<hl7:sup>1</hl7:sup></');
  assert.deepEqual(parseReconstitutionTable(xml), parseReconstitutionTable(table));
});

test('all table fields and multiple tables in one field are read independently', () => {
  const second = table
    .replace('<td>9.6</td>', '<td>19.6</td>')
    .replace('<td>10</td>', '<td>20</td>')
    .replace('<td>100</td>', '<td>50</td>');
  assert.equal(reconstitutionFromLabel({ instructions_for_use_table: [table + second] }).length, 2);
});

test('DailyMed XML supplies facts when openFDA has no label', () => {
  const facts = parsePackageFacts(
    '12345678901',
    null,
    'POWDER, FOR SOLUTION',
    [{ name: 'DRUG', strength: '1 g/1' }],
    null,
    `<document>${table}</document>`
  );
  assert.equal(facts.reconstitution.length, 1);
  assert.equal(facts.resolvedVolume?.finalVolumeMl, 10);
});

test('prose recognizes vial mass before the noun and adding phrasing', () => {
  const rows = parseReconstitutionProse(
    'Reconstitute the 1 g vial by adding 9.6 mL to yield 100 mg/mL.'
  );
  assert.equal(rows[0]?.vialMassMg, 1000);
  assert.equal(rows[0]?.diluentMl, 9.6);
  assert.equal(rows[0]?.concentrations[0]?.mgPerMl, 100);
  assert.deepEqual(
    parseReconstitutionProse('Dilute the reconstituted solution with 50 mL to yield 5 mg/mL.'),
    []
  );
});

test('incompatible yields are preserved as alternatives rather than merged', () => {
  const rows = [10, 20].map((finalVolumeMl) => ({
    vialMassMg: 1000,
    diluentMl: 9.6,
    finalVolumeMl,
    concentrations: [{ name: null, mgPerMl: 1000 / finalVolumeMl }]
  }));
  assert.equal(dedupeProseReconstitutions([...rows, rows[0]]).length, 2);
});

test('concentration-only and ambiguous volume tables do not invent diluent instructions', () => {
  assert.deepEqual(
    parseReconstitutionTable(
      '<table><tr><th>Vial</th><th>Concentration (mg/mL)</th></tr><tr><td>1 g</td><td>100</td></tr></table>'
    ),
    []
  );
  assert.deepEqual(
    parseReconstitutionTable(
      '<table><tr><th>Vial</th><th>A</th><th>B</th></tr><tr><td>1 g</td><td>10 mL</td><td>20 mL</td></tr></table>'
    ),
    []
  );
});

test('prose retains an explicitly stated final volume without inventing concentration', () => {
  const rows = parseReconstitutionProse('Reconstitute the 1 g vial with 9.6 mL to yield 10 mL.');
  assert.equal(rows[0]?.finalVolumeMl, 10);
  assert.deepEqual(rows[0]?.concentrations, []);
});

test('a sentence ending in a whole number does not consume the next instruction', () => {
  const rows = parseReconstitutionProse(
    'See Table 1. Reconstitute the 1 g vial with 9.6 mL to yield 100 mg/mL. Dilute with 50 mL.'
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].diluentMl, 9.6);
});
