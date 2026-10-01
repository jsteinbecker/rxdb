import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEdit,
  decimalOf,
  effectiveTotalVolume,
  finalConcentrations,
  fromMixed,
  packageConcentration,
  parseCompoundName,
  parseLinesPayload,
  solveLine,
  toMixed,
  type Line
} from '../compound-builder';
import { rational, type Rational } from '../rational';

const r = (n: number, d = 1): Rational => rational(n, d)!;
const line = (over: Partial<Line> = {}): Line => ({
  slotId: 's1',
  role: 'active',
  label: 'Cefepime',
  doseUnit: 'mg',
  conc: null,
  dose: null,
  volume: null,
  ...over
});

test('editing dose computes volume from concentration', () => {
  const out = solveLine(line({ conc: r(100), dose: r(1500) }), 'dose');
  assert.deepEqual(out.volume, r(15));
});

test('editing volume computes dose from concentration', () => {
  const out = solveLine(line({ conc: r(10), volume: r(3, 2) }), 'volume');
  assert.deepEqual(out.dose, r(15));
});

test('editing concentration recomputes volume from dose, exactly', () => {
  // 1500 mg at 2500/19 mg/mL is 11.4 mL = 57/5, with no rounding.
  const out = solveLine(line({ conc: r(2500, 19), dose: r(1500) }), 'conc');
  assert.deepEqual(out.volume, r(57, 5));
});

test('editing concentration with only a volume recomputes dose', () => {
  const out = solveLine(line({ conc: r(5), volume: r(10) }), 'conc');
  assert.deepEqual(out.dose, r(50));
});

test('a diluent line is never solved', () => {
  const input = line({ role: 'diluent', conc: r(5), volume: r(10) });
  assert.deepEqual(solveLine(input, 'volume'), input);
});

test('zero or negative inputs leave the line unchanged', () => {
  const zeroConc = line({ conc: r(0), dose: r(5) });
  assert.deepEqual(solveLine(zeroConc, 'dose'), zeroConc);
  const negDose = line({ conc: r(5), dose: r(-5) });
  assert.deepEqual(solveLine(negDose, 'dose'), negDose);
  const noConc = line({ dose: r(5) });
  assert.deepEqual(solveLine(noConc, 'dose'), noConc);
});

test('a product too large to be exact leaves the line unchanged', () => {
  const huge = r(Number.MAX_SAFE_INTEGER);
  const input = line({ conc: huge, volume: huge });
  assert.deepEqual(solveLine(input, 'volume'), input);
});

test('total volume: explicit wins, else the sum, else null', () => {
  const lines = [line({ volume: r(10) }), line({ slotId: 's2', volume: r(5, 2) })];
  assert.deepEqual(effectiveTotalVolume(lines, r(30)), r(30));
  assert.deepEqual(effectiveTotalVolume(lines, null), r(25, 2));
  assert.deepEqual(effectiveTotalVolume(lines, r(0)), r(25, 2));
  assert.equal(effectiveTotalVolume([line()], null), null);
});

test('final concentrations: dose over total, diluents show their volume', () => {
  const lines = [
    line({ dose: r(1500) }),
    line({ slotId: 's2', role: 'diluent', label: 'NS', volume: r(30) })
  ];
  const rows = finalConcentrations(lines, r(30));
  assert.deepEqual(rows[0].amount, r(50));
  assert.equal(rows[0].unit, 'mg/mL');
  assert.deepEqual(rows[1].amount, r(30));
  assert.equal(rows[1].unit, 'mL');
});

test('final concentrations are blank without a usable total', () => {
  const rows = finalConcentrations([line({ dose: r(1500) })], null);
  assert.equal(rows[0].amount, null);
});

test('mixed-number storage round-trips and rejects non-positive values', () => {
  const mixed = toMixed(r(2500, 19));
  assert.deepEqual(mixed, { whole: 131n, num: 11n, den: 19n });
  assert.deepEqual(fromMixed(mixed), r(2500, 19));
  assert.deepEqual(toMixed(null), { whole: null, num: null, den: null });
  assert.deepEqual(toMixed(r(-1)), { whole: null, num: null, den: null });
  assert.equal(fromMixed({ whole: null, num: null, den: null }), null);
  assert.deepEqual(fromMixed({ whole: 3n, num: null, den: null }), r(3));
  // the slot columns default to 0/1 when unset, which is "no value", not zero
  assert.equal(fromMixed({ whole: null, num: 0n, den: 1n }), null);
  assert.equal(fromMixed({ whole: 0n, num: 0n, den: 1n }), null);
});

test('decimalOf is exact when it can be', () => {
  assert.equal(decimalOf(r(9, 2)), '4.5');
  assert.ok(Number(decimalOf(r(2500, 19))) > 131.57 && Number(decimalOf(r(2500, 19))) < 131.58);
});

test('package concentration reads a single per-volume strength', () => {
  assert.deepEqual(packageConcentration([{ name: 'cefepime', strength: '100 mg/mL' }]), {
    conc: r(100),
    doseUnit: 'mg'
  });
  assert.deepEqual(packageConcentration([{ name: 'cefepime', strength: '1000 MG/10 ML' }]), {
    conc: r(100),
    doseUnit: 'mg'
  });
});

test('package concentration is null for dry fill, combos, percents and blanks', () => {
  assert.equal(packageConcentration([{ name: 'cefepime', strength: '1 g' }]), null);
  assert.equal(packageConcentration([{ name: 'a', strength: '5 mg/mL' }, { name: 'b', strength: '1 mg/mL' }]), null);
  assert.equal(packageConcentration([{ name: 'saline', strength: '0.9%' }]), null);
  assert.equal(packageConcentration([{ name: 'x', strength: null }]), null);
  assert.equal(packageConcentration([]), null);
});

test('lines payload parses fractions and blanks', () => {
  const parsed = parseLinesPayload(
    JSON.stringify({
      total: '30/1',
      lines: [{ slotId: 'a', conc: '2500/19', dose: '1500/1', volume: null }]
    })
  );
  assert.ok(!('error' in parsed));
  if ('error' in parsed) return;
  assert.deepEqual(parsed.total, r(30));
  assert.deepEqual(parsed.lines[0], { slotId: 'a', conc: r(2500, 19), dose: r(1500), volume: null });
});

test('lines payload rejects garbage, non-positive numbers and bad shapes', () => {
  for (const bad of [
    'not json',
    '{}',
    JSON.stringify({ lines: [{ slotId: 'a', dose: '-1/1' }] }),
    JSON.stringify({ lines: [{ slotId: 'a', dose: '0/1' }] }),
    JSON.stringify({ lines: [{ slotId: 'a', volume: 'abc' }] }),
    JSON.stringify({ lines: [{ dose: '1/1' }] }),
    JSON.stringify({ lines: [], total: 'x' })
  ])
    assert.ok('error' in (parseLinesPayload(bad) as object), bad);
});

test('compound names are trimmed and bounded', () => {
  assert.deepEqual(parseCompoundName('  Vanc 1 g in NS '), { name: 'Vanc 1 g in NS' });
  assert.ok('error' in (parseCompoundName('   ') as object));
  assert.ok('error' in (parseCompoundName(null) as object));
  assert.ok('error' in (parseCompoundName('x'.repeat(121)) as object));
});

test('applyEdit stores the edit and solves the dependent field', () => {
  const out = applyEdit(line({ conc: r(100) }), 'dose', r(1500));
  assert.deepEqual(out?.dose, r(1500));
  assert.deepEqual(out?.volume, r(15));
});

test('applyEdit refuses an edit whose solve cannot be exact', () => {
  // 123456790 ÷ (6000/46419753090) is 19102779030279937/20: past 2^53, so no honest fraction.
  assert.equal(applyEdit(line({ conc: r(6000, 46419753090) }), 'dose', r(123456790)), null);
});

test('applyEdit refuses a value that is not a safe fraction', () => {
  assert.equal(applyEdit(line({ conc: r(100) }), 'dose', { n: 1e21, d: 1 }), null);
});

test('a total that cannot be summed exactly is unknown, not partial', () => {
  const lines = [
    line({ volume: r(1e15) }),
    line({ slotId: 's2', volume: r(1, 97) }),
    line({ slotId: 's3', volume: r(1, 89) })
  ];
  assert.equal(effectiveTotalVolume(lines, null), null);
});

test('lines payload rejects numbers past int8 and non-string values', () => {
  for (const bad of [
    JSON.stringify({ lines: [{ slotId: 'a', dose: '100000000000000000000/1' }] }),
    JSON.stringify({ lines: [{ slotId: 'a', dose: { n: 5, d: 1e300 } }] }),
    JSON.stringify({ lines: [], total: '100000000000000000000/1' })
  ])
    assert.ok('error' in (parseLinesPayload(bad) as object), bad);
});
