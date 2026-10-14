import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  asConceptIngredient,
  diffIngredients,
  ingredientKey,
  localConceptName,
  parseScdName,
  rxnormNumber,
  sameStrength,
  type ConceptIngredient,
  type LocalIngredient
} from '../local-concept.ts';

const row = (name: string, mag: string, over: Partial<LocalIngredient> = {}): LocalIngredient => ({
  substanceUnii: 'U-' + name,
  substanceName: name,
  basis: 'as_labeled',
  moietyUnii: null,
  moietyName: null,
  strengthNumMag: mag,
  strengthNumUom: 'mg',
  strengthDenMag: '1',
  strengthDenUom: 'mL',
  ...over
});

const RXNORM_800611 =
  'alanine 5.4 MG/ML / arginine 12 MG/ML / aspartate 3.2 MG/ML / cysteine 0.24 MG/ML / glutamate 5 MG/ML / glycine 3.6 MG/ML / histidine 4.8 MG/ML / isoleucine 8.2 MG/ML / leucine 1.4 MG/ML / lysine 1.2 MG/ML / methionine 3.4 MG/ML / phenylalanine 4.8 MG/ML / proline 6.8 MG/ML / serine 3.8 MG/ML / sodium acetate 0.097 MEQ/ML / sodium chloride 0.003 MEQ/ML / sodium metabisulfite 0.5 MG/ML / taurine 0.25 MG/ML / threonine 4.2 MG/ML / tryptophan 2 MG/ML / tyrosine 2.84 MG/ML / valine 7.8 MG/ML Injectable Solution';

describe('rxnormNumber', () => {
  it('formats like RxNorm', () => {
    assert.equal(rxnormNumber('8.510'), '8.51');
    assert.equal(rxnormNumber('.5'), '0.5');
    assert.equal(rxnormNumber('14.0'), '14');
    assert.equal(rxnormNumber('0.166'), '0.166');
  });
});

describe('ingredientKey', () => {
  it('lower-cases, trims, collapses whitespace and applies aliases', () => {
    assert.equal(ingredientKey('  ASPARTIC   ACID '), 'aspartate');
    assert.equal(ingredientKey('Glutamic Acid'), 'glutamate');
    assert.equal(ingredientKey('LEUCINE'), 'leucine');
  });
});

describe('localConceptName', () => {
  const rows = [
    row('taurine', '0.25'),
    row('alanine', '5.4'),
    row('lysine acetate', '8.51', {
      basis: 'active_moiety',
      moietyUnii: 'U-lys',
      moietyName: 'lysine'
    })
  ];
  const base = 'alanine 5.4 MG/ML / lysine 8.51 MG/ML / taurine 0.25 MG/ML Injectable Solution';

  it('sorts alphabetically and uses the moiety name', () => {
    assert.equal(localConceptName({ ingredients: rows, doseForm: 'Injectable Solution' }), base);
  });
  it('appends the brand', () => {
    assert.equal(
      localConceptName({
        ingredients: rows,
        doseForm: 'Injectable Solution',
        brandName: 'TrophAmine'
      }),
      base + ' [TrophAmine]'
    );
  });
  it('normalizes a 100 mL denominator', () => {
    const name = localConceptName({
      ingredients: [row('lysine', '0.851', { strengthNumUom: 'g', strengthDenMag: '100' })],
      doseForm: 'Injectable Solution'
    });
    assert.equal(name, 'lysine 8.51 MG/ML Injectable Solution');
  });
  it('keeps mEq as its own unit', () => {
    const c = asConceptIngredient(
      row('sodium acetate', '97', { strengthNumUom: 'meq', strengthDenMag: '1000' })
    );
    assert.deepEqual(c, { name: 'sodium acetate', value: '0.097', unit: 'MEQ/ML' });
  });
});

describe('parseScdName', () => {
  it('parses RxCUI 800611', () => {
    const p = parseScdName(RXNORM_800611);
    assert.ok(p);
    assert.equal(p.ingredients.length, 22);
    const by = (n: string) => p.ingredients.find((i) => i.name === n);
    assert.deepEqual(by('sodium acetate'), {
      name: 'sodium acetate',
      value: '0.097',
      unit: 'MEQ/ML'
    });
    assert.equal(by('leucine')?.value, '1.4');
    assert.equal(by('leucine')?.unit, 'MG/ML');
    assert.equal(p.doseForm, 'Injectable Solution');
    assert.equal(p.brand, null);
  });
  it('parses a brand suffix', () => {
    const p = parseScdName(RXNORM_800611 + ' [Trophamine 10 %]');
    assert.equal(p?.brand, 'Trophamine 10 %');
    assert.equal(p?.ingredients.length, 22);
    assert.equal(p?.doseForm, 'Injectable Solution');
  });
  it('returns null without strengths', () => {
    assert.equal(parseScdName('Trophamine'), null);
  });
  it('parses units with digits after the slash', () => {
    const patch = parseScdName('nicotine 0.583 MG/HR / fentanyl 0.025 MG/24HR Transdermal System');
    assert.deepEqual(
      patch?.ingredients.map((i) => i.unit),
      ['MG/HR', 'MG/24HR']
    );
    assert.equal(patch?.doseForm, 'Transdermal System');
    const bag = parseScdName('dextrose 5 G/100ML Injectable Solution');
    assert.deepEqual(bag?.ingredients[0], { name: 'dextrose', value: '5', unit: 'G/100ML' });
    assert.equal(bag?.doseForm, 'Injectable Solution');
  });
});

describe('sameStrength', () => {
  const c = (value: string, unit: string): ConceptIngredient => ({ name: 'x', value, unit });
  it('compares exactly across units', () => {
    assert.equal(sameStrength(c('8.51', 'MG/ML'), c('851', 'MG/100ML')), true);
    assert.equal(sameStrength(c('8.51', 'MG/ML'), c('0.851', 'G/100ML')), true);
    assert.equal(sameStrength(c('1.4', 'MG/ML'), c('14', 'MG/ML')), false);
  });
  it('never equates MG/ML with MEQ/ML', () => {
    assert.equal(sameStrength(c('1', 'MG/ML'), c('1', 'MEQ/ML')), false);
    assert.equal(sameStrength(c('0.097', 'MEQ/ML'), c('97', 'MEQ/L')), true);
  });
});

describe('diffIngredients (TrophAmine)', () => {
  const rx = parseScdName(RXNORM_800611)!.ingredients;
  const dropped = new Set([
    'sodium acetate',
    'sodium chloride',
    'sodium metabisulfite',
    'leucine',
    'lysine',
    'cysteine',
    'tyrosine'
  ]);
  const spl: Record<string, string> = { aspartate: 'ASPARTIC ACID', glutamate: 'GLUTAMIC ACID' };
  const local: LocalIngredient[] = rx
    .filter((i) => !dropped.has(i.name))
    .map((i) =>
      row(
        (spl[i.name] ?? i.name).toUpperCase(),
        // taurine written per 100 mL to prove unit equivalence
        i.name === 'taurine' ? '0.025' : i.value,
        i.name === 'taurine' ? { strengthNumUom: 'g', strengthDenMag: '100' } : {}
      )
    );
  local.push(
    row('LEUCINE', '14'),
    row('LYSINE ACETATE', '8.51', { basis: 'active_moiety', moietyName: 'LYSINE' }),
    row('CYSTEINE HYDROCHLORIDE', '0.166', { basis: 'active_moiety', moietyName: 'CYSTEINE' }),
    row('TYROSINE', '0.44'),
    row('ACETYL L-TYROSINE', '2.4')
  );

  const diff = diffIngredients(rx, local.map(asConceptIngredient));
  const names = (change: string) =>
    diff
      .filter((d) => d.change === change)
      .map((d) => d.name)
      .sort();

  it('classifies every ingredient', () => {
    assert.deepEqual(names('removed'), ['sodium acetate', 'sodium chloride', 'sodium metabisulfite']);
    assert.deepEqual(names('changed'), ['cysteine', 'leucine', 'lysine', 'tyrosine']);
    assert.deepEqual(names('added'), ['acetyl l-tyrosine']);
    assert.equal(names('same').length, 15);
    assert.ok(names('same').includes('isoleucine'));
    assert.ok(names('same').includes('taurine'));
    assert.ok(names('same').includes('aspartate'));
    assert.equal(diff.length, 23);
  });
  it('carries both sides', () => {
    const lys = diff.find((d) => d.name === 'lysine')!;
    assert.equal(lys.rxnorm?.value, '1.2');
    assert.equal(lys.local?.value, '8.51');
    assert.equal(diff.find((d) => d.name === 'sodium acetate')!.local, null);
  });
});
