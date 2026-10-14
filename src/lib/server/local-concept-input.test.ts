import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LocalConceptInputError, parseLocalConceptInput } from '../local-concept-input.ts';

const row = (over: Record<string, unknown> = {}) => ({
  substanceUnii: 'abcde12345',
  substanceName: '  Glycine ',
  basis: 'as_labeled',
  moietyUnii: null,
  moietyName: null,
  strengthNumMag: '10',
  strengthNumUom: 'mg',
  strengthDenMag: '1',
  strengthDenUom: 'mL',
  ...over
});

const input = (over: Record<string, unknown> = {}) => ({
  doseForm: ' Injectable Solution ',
  ingredients: [row()],
  evidenceSetId: ' set-1 ',
  evidenceVersion: '3',
  evidenceNdc: null,
  ionicContent: null,
  note: null,
  ...over
});

const rejects = (raw: unknown) =>
  assert.throws(() => parseLocalConceptInput(raw), LocalConceptInputError);

describe('parseLocalConceptInput', () => {
  it('trims names and upper-cases UNIIs', () => {
    const out = parseLocalConceptInput(input());
    assert.equal(out.doseForm, 'Injectable Solution');
    assert.equal(out.evidenceSetId, 'set-1');
    assert.equal(out.ingredients[0].substanceUnii, 'ABCDE12345');
    assert.equal(out.ingredients[0].substanceName, 'Glycine');
  });

  it('rejects a UNII that is not 10 characters of [A-Z0-9]', () => {
    rejects(input({ ingredients: [row({ substanceUnii: 'SHORT' })] }));
    rejects(input({ ingredients: [row({ substanceUnii: 'ABCDE-2345' })] }));
  });

  it('rejects duplicate substance UNIIs', () => {
    rejects(input({ ingredients: [row(), row({ substanceUnii: 'ABCDE12345' })] }));
  });

  it('rejects active_moiety with no moiety', () => {
    rejects(input({ ingredients: [row({ basis: 'active_moiety' })] }));
    const ok = parseLocalConceptInput(
      input({
        ingredients: [
          row({ basis: 'active_moiety', moietyUnii: 'zzzzz11111', moietyName: ' Lysine ' })
        ]
      })
    );
    assert.equal(ok.ingredients[0].moietyUnii, 'ZZZZZ11111');
    assert.equal(ok.ingredients[0].moietyName, 'Lysine');
  });

  it('rejects bases other than as_labeled and active_moiety', () => {
    rejects(input({ ingredients: [row({ basis: 'salt' })] }));
    rejects(input({ ingredients: [row({ basis: 'reference' })] }));
  });

  it('rejects a strength that is not a positive decimal', () => {
    for (const bad of ['0', '-1', 'abc', '', '1e3', '1.']) {
      rejects(input({ ingredients: [row({ strengthNumMag: bad })] }));
    }
    rejects(input({ ingredients: [row({ strengthDenMag: '0' })] }));
    rejects(input({ ingredients: [row({ strengthNumUom: ' ' })] }));
  });

  it('rejects no ingredients', () => {
    rejects(input({ ingredients: [] }));
  });

  it('rejects a blank evidence set id or dose form', () => {
    rejects(input({ evidenceSetId: '  ' }));
    rejects(input({ doseForm: '' }));
  });

  it('rejects non-objects', () => {
    rejects(null);
    rejects('x');
  });

  it('parses a 21-row TrophAmine-style input', () => {
    const ingredients = Array.from({ length: 21 }, (_, i) =>
      row({
        substanceUnii: `UNII${String(i).padStart(6, '0')}`,
        substanceName: `Amino ${i}`,
        strengthNumMag: '8.51'
      })
    );
    assert.equal(parseLocalConceptInput(input({ ingredients })).ingredients.length, 21);
  });
});

describe('parseLocalConceptInput ionic content', () => {
  it('keeps label electrolyte rows, trimmed', () => {
    const out = parseLocalConceptInput(
      input({
        ionicContent: [
          { element: ' Acetate ', comparator: '~', mEqPerL: '96', source: ' provided as acetic acid ' },
          { element: 'Chloride', comparator: '<', mEqPerL: '3', source: '' }
        ]
      })
    );
    assert.deepEqual(out.ionicContent, [
      { element: 'Acetate', comparator: '~', mEqPerL: '96', source: 'provided as acetic acid' },
      { element: 'Chloride', comparator: '<', mEqPerL: '3', source: null }
    ]);
  });

  it('treats an empty list as none', () => {
    assert.equal(parseLocalConceptInput(input({ ionicContent: [] })).ionicContent, null);
  });

  it('rejects malformed rows', () => {
    rejects(input({ ionicContent: { element: 'Acetate' } }));
    rejects(input({ ionicContent: [{ element: '', comparator: '', mEqPerL: '96' }] }));
    rejects(input({ ionicContent: [{ element: 'Acetate', comparator: '>', mEqPerL: '96' }] }));
    rejects(input({ ionicContent: [{ element: 'Acetate', comparator: '', mEqPerL: 'lots' }] }));
  });
});
