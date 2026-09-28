import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReconstitutionTable, reconstitutionFromLabel } from '../reconstitution';
import { parseReconstitutionProse, dedupeProseReconstitutions } from '../dry-fill-volume';
import { parsePackageFacts } from './catalog-facts';
import { applyPropertyOverrides } from './apply-property-overrides';
import { packageFixture } from './catalog-test-fixtures';
import { overrideTargets, validOverrideValue } from '../property-override-fields';

// Ceftriaxone-style labels give one instruction per route, and the rows only
// mean something with the route and diluent attached.
const imSentence =
  'For Intramuscular Administration: Reconstitute the 1 g vial with 1.3 mL of Sterile Water for Injection to yield 2 mL of 500 mg/mL.';
const ivSentence =
  'For Intravenous Administration: Reconstitute the 1 g vial with 10 mL of Sterile Water for Injection or 0.9% Sodium Chloride Injection.';
const perRouteProse = `${imSentence} ${ivSentence}`;

test('prose rows carry the route and diluents their sentence names', () => {
  assert.deepEqual(parseReconstitutionProse(perRouteProse), [
    {
      vialMassMg: 1000,
      diluentMl: 1.3,
      concentrations: [{ name: null, mgPerMl: 500 }],
      finalVolumeMl: 2,
      routes: ['IM'],
      diluents: ['SWFI']
    },
    {
      vialMassMg: 1000,
      diluentMl: 10,
      concentrations: [],
      routes: ['IV'],
      diluents: ['SWFI', 'NS']
    }
  ]);
});

test('a route heading governs the instructions under it until the next heading', () => {
  const text = [
    'Intramuscular Injection',
    'Reconstitute with 2.1 mL of 1% Lidocaine Hydrochloride Injection.',
    'Intravenous Injection',
    'Reconstitute with 9.6 mL of Bacteriostatic Water for Injection.',
    'Storage',
    'Reconstitute with 5 mL of 5% Dextrose Injection.'
  ].join('\n');
  assert.deepEqual(
    parseReconstitutionProse(text).map(({ diluentMl, routes, diluents }) => ({
      diluentMl,
      routes,
      diluents
    })),
    [
      { diluentMl: 2.1, routes: ['IM'], diluents: ['lidocaine 1%'] },
      { diluentMl: 9.6, routes: ['IV'], diluents: ['BWFI'] },
      { diluentMl: 5, routes: undefined, diluents: ['D5W'] }
    ]
  );
});

test('one instruction may name several routes, and later pairs inherit the earlier route', () => {
  assert.deepEqual(
    parseReconstitutionProse(
      'For IM or IV use, reconstitute the 500 mg vial with 2 mL and the 1 g vial with 4 mL of Sterile Water for Injection.'
    ).map(({ vialMassMg, routes, diluents }) => ({ vialMassMg, routes, diluents })),
    [
      { vialMassMg: 500, routes: ['IM', 'IV'], diluents: ['SWFI'] },
      { vialMassMg: 1000, routes: ['IM', 'IV'], diluents: ['SWFI'] }
    ]
  );
});

test('a diluent named after a later "then dilute" clause is not the reconstitution diluent', () => {
  const [row] = parseReconstitutionProse(
    'Reconstitute the 1 g vial with 10 mL of Sterile Water for Injection, then further dilute in 100 mL of 0.9% Sodium Chloride.'
  );
  assert.deepEqual(row.diluents, ['SWFI']);
});

test('dedupe keeps same-volume rows for different routes apart', () => {
  const base = { vialMassMg: 1000, diluentMl: 10, concentrations: [] };
  assert.equal(
    dedupeProseReconstitutions([
      { ...base, routes: ['IM'] },
      { ...base, routes: ['IV'] }
    ]).length,
    2
  );
});

test('dedupe folds a route-less duplicate into the routed row and unions diluents', () => {
  const base = { vialMassMg: 1000, diluentMl: 10, concentrations: [] };
  assert.deepEqual(
    dedupeProseReconstitutions([
      { ...base, diluents: ['SWFI'] },
      { ...base, routes: ['IV'], diluents: ['NS'] }
    ]),
    [{ ...base, finalVolumeMl: undefined, routes: ['IV'], diluents: ['SWFI', 'NS'] }]
  );
});

test('table section rows name the route of the rows beneath them', () => {
  const markup =
    '<table><tr><th>Vial Size</th><th>Volume of Sterile Water for Injection to be Added</th><th>Approximate Concentration</th></tr>' +
    '<tr><td colspan="3">Intramuscular</td></tr>' +
    '<tr><td>500 mg</td><td>1.8 mL</td><td>250 mg/mL</td></tr>' +
    '<tr><td colspan="3">Intravenous</td></tr>' +
    '<tr><td>500 mg</td><td>4.8 mL</td><td>100 mg/mL</td></tr></table>';
  assert.deepEqual(parseReconstitutionTable(markup), [
    {
      vialMassMg: 500,
      diluentMl: 1.8,
      concentrationMgPerMl: 250,
      finalVolumeMl: null,
      routes: ['IM'],
      diluents: ['SWFI']
    },
    {
      vialMassMg: 500,
      diluentMl: 4.8,
      concentrationMgPerMl: 100,
      finalVolumeMl: null,
      routes: ['IV'],
      diluents: ['SWFI']
    }
  ]);
});

test('a table column header can name the route', () => {
  const markup =
    '<table><tr><th>Vial</th><th>Diluent for IM Use</th><th>Diluent for IV Use</th></tr>' +
    '<tr><td>1 g</td><td>2.1 mL</td><td>9.6 mL</td></tr></table>';
  assert.deepEqual(
    parseReconstitutionTable(markup).map(({ diluentMl, routes }) => ({ diluentMl, routes })),
    [
      { diluentMl: 2.1, routes: ['IM'] },
      { diluentMl: 9.6, routes: ['IV'] }
    ]
  );
});

const facts = (text: string) =>
  parsePackageFacts(
    '00000000001',
    '1 VIAL in 1 CARTON',
    'INJECTION, POWDER, FOR SOLUTION',
    [{ name: 'CEFTRIAXONE SODIUM', strength: '1 g/1' }],
    { dosage_and_administration: [text] }
  );

test('package rows get ids that depend on content, not position', () => {
  const forward = facts(perRouteProse).reconstitution;
  const reversed = facts(`${ivSentence} ${imSentence}`).reconstitution;
  assert.equal(forward.length, 2);
  assert.match(forward[0].id!, /^r[0-9a-f]{8}$/);
  assert.notEqual(forward[0].id, forward[1].id);
  const idFor = (rows: typeof forward, route: string) =>
    rows.find((row) => row.routes?.includes(route as never))?.id;
  assert.equal(idFor(forward, 'IM'), idFor(reversed, 'IM'));
  assert.equal(idFor(forward, 'IV'), idFor(reversed, 'IV'));
});

test('the resolved volume names the row it was taken from', () => {
  const result = facts(perRouteProse);
  assert.equal(result.resolvedVolume?.finalVolumeMl, 2);
  assert.ok(result.resolvedVolume?.rowId);
  assert.equal(
    result.resolvedVolume?.rowId,
    result.reconstitution.find((row) => row.routes?.includes('IM'))?.id
  );
});

const cited = (value: string) => ({
  value,
  excerpt: 'Reconstitute with 10 mL.',
  sectionKey: 'dosage_and_administration',
  sectionTitle: 'Dosage and administration',
  subsectionTitle: null,
  splSetId: '11111111-1111-1111-1111-111111111111',
  createdAt: '2026-09-28T00:00:00.000Z'
});

test('overrides address rows by id, including route and diluents', () => {
  const rows = [
    {
      id: 'raaaaaaaa',
      vialMassMg: 1000,
      diluentMl: 1.3,
      concentrations: [],
      routes: ['IM' as const]
    },
    { id: 'rbbbbbbbb', vialMassMg: 1000, diluentMl: 10, concentrations: [] }
  ];
  const item = packageFixture({
    reconstitution: rows,
    propertyOverrides: {
      'reconstitution.rbbbbbbbb.diluentMl': cited('9.6'),
      'reconstitution.rbbbbbbbb.routes': cited('IV'),
      'reconstitution.rbbbbbbbb.diluents': cited('SWFI, NS')
    }
  });
  const keys = overrideTargets(item).map((target) => target.key);
  assert.ok(keys.includes('reconstitution.rbbbbbbbb.routes'));
  assert.ok(keys.includes('reconstitution.raaaaaaaa.diluents'));
  assert.ok(!keys.some((key) => /^reconstitution\.\d/.test(key)));
  assert.equal(validOverrideValue('reconstitution.rbbbbbbbb.routes', 'IV, IM'), true);
  assert.equal(validOverrideValue('reconstitution.rbbbbbbbb.routes', 'oral'), false);
  assert.equal(validOverrideValue('reconstitution.rbbbbbbbb.diluents', ' '), false);

  const applied = applyPropertyOverrides(item);
  assert.equal(applied.reconstitution[0].diluentMl, 1.3);
  assert.equal(applied.reconstitution[1].diluentMl, 9.6);
  assert.deepEqual(applied.reconstitution[1].routes, ['IV']);
  assert.deepEqual(applied.reconstitution[1].diluents, ['SWFI', 'NS']);

  // Reordered by a reparse, the override still lands on its row.
  const reordered = applyPropertyOverrides({ ...item, reconstitution: [rows[1], rows[0]] });
  assert.equal(reordered.reconstitution[0].diluentMl, 9.6);
  assert.equal(reordered.reconstitution[1].diluentMl, 1.3);
});

// Apotex ceftriaxone (60505-6148): the route is the paragraph heading above
// each table, not anything in the table or the "with N mL" prose.
const ceftriaxoneSpl =
  '<section><title>DIRECTIONS FOR USE</title><text><paragraph>Intramuscular Administration: Reconstitute Ceftriaxone for injection powder with the appropriate diluent. As with all intramuscular preparations, inject well within a large muscle.</paragraph>' +
  '<table><thead><tr><th rowspan="2">Vial Dosage Size</th><th colspan="2">Amount of Diluent to be Added</th></tr><tr><th>250 mg/mL</th><th>350 mg/mL</th></tr></thead>' +
  '<tbody><tr><td>1 g</td><td>3.6 mL</td><td>2.1 mL</td></tr></tbody></table>' +
  '<paragraph>Intravenous Administration: Ceftriaxone should be administered intravenously by infusion over 30 minutes. Reconstitute vials with an appropriate IV diluent.</paragraph>' +
  '<table><thead><tr><th>Vial Dosage Size</th><th>Amount of Diluent to be Added</th></tr></thead>' +
  '<tbody><tr><td>1 g</td><td>9.6 mL</td></tr></tbody></table></text></section>';

test('an SPL table takes its route from the administration heading above it', () => {
  assert.deepEqual(
    reconstitutionFromLabel({ spl_tables_table: [ceftriaxoneSpl] }).map(
      ({ diluentMl, routes }) => ({ diluentMl, routes })
    ),
    [
      { diluentMl: 3.6, routes: ['IM'] },
      { diluentMl: 2.1, routes: ['IM'] },
      { diluentMl: 9.6, routes: ['IV'] }
    ]
  );
});

test('route-less openFDA table rows fold into the routed SPL rows for the package', () => {
  const imTable = ceftriaxoneSpl.match(/<table>[\s\S]*?<\/table>/)![0];
  const result = parsePackageFacts(
    '60505614800',
    '1 VIAL, SINGLE-USE in 1 CARTON',
    'INJECTION, POWDER, FOR SOLUTION',
    [{ name: 'CEFTRIAXONE SODIUM', strength: '1 g/1' }],
    { dosage_and_administration_table: [imTable] },
    ceftriaxoneSpl
  );
  assert.deepEqual(
    result.reconstitution.map(({ diluentMl, routes }) => ({ diluentMl, routes })),
    [
      { diluentMl: 3.6, routes: ['IM'] },
      { diluentMl: 2.1, routes: ['IM'] },
      { diluentMl: 9.6, routes: ['IV'] }
    ]
  );
});
