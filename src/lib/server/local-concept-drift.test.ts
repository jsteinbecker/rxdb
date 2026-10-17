import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyDrift } from '../local-concept-drift.ts';
import type { LocalIngredient } from '../local-concept.ts';

const glycine: LocalIngredient = {
  substanceUnii: 'ABCDE12345',
  substanceName: 'Glycine',
  basis: 'as_labeled',
  moietyUnii: null,
  moietyName: null,
  strengthNumMag: '10',
  strengthNumUom: 'mg',
  strengthDenMag: '1',
  strengthDenUom: 'mL'
};
const name = 'glycine 5 MG/ML Injectable Solution';

test('same name and active status is not drift', () => {
  assert.equal(classifyDrift({ supersededName: name }, { name, inactive: false }, [glycine]), null);
});

test('a null superseded name carries no rename information', () => {
  assert.equal(classifyDrift({ supersededName: null }, { name, inactive: false }, [glycine]), null);
});

test('a changed name is an info rename', () => {
  assert.deepEqual(
    classifyDrift(
      { supersededName: name },
      { name: 'glycine 6 MG/ML Injectable Solution', inactive: false },
      [glycine]
    ),
    { severity: 'info', reason: 'renamed' }
  );
});

test('an inactive concept is a warning, ahead of a rename', () => {
  assert.deepEqual(
    classifyDrift({ supersededName: name }, { name: 'other', inactive: true }, [glycine]),
    { severity: 'warning', reason: 'inactive' }
  );
});

test('a new name matching the local concept is caught up', () => {
  assert.deepEqual(
    classifyDrift(
      { supersededName: name },
      { name: 'glycine 10 MG/ML Injectable Solution', inactive: false },
      [glycine]
    ),
    { severity: 'info', reason: 'caught_up' }
  );
});

test('an unparseable new name is only a rename', () => {
  assert.deepEqual(
    classifyDrift({ supersededName: name }, { name: 'Glycine kit', inactive: false }, [glycine]),
    { severity: 'info', reason: 'renamed' }
  );
});
