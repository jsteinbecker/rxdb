import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPharmClassRules } from '../pharm-class-view';
import type { PharmClassRule } from '../pharm-class-rules';

const rule: PharmClassRule = {
  id: 'r1',
  moietyKey: 'U1',
  doseFormGroup: null,
  route: null,
  strengthKey: null,
  mode: 'replace',
  classes: ['New [EPC]']
};

const item = (unii: string, classes: string[]) =>
  ({
    doseForm: 'TABLET',
    details: {
      spl: null,
      product: { routes: ['ORAL'], pharmClasses: classes, uniis: [unii] }
    }
  }) as never;

test('resolves a mixed batch without touching its input', async () => {
  const withRule = item('U1', ['Old [EPC]']);
  const other = item('U2', ['Keep [EPC]']);
  const bare = { doseForm: null, details: null } as never;
  const input = [withRule, other, bare];
  const snapshot = structuredClone(input);
  let calls = 0;
  const out = (await applyPharmClassRules(input, async (keys) => {
    calls++;
    assert.deepEqual(keys.sort(), ['U1', 'U2']);
    return [rule];
  })) as any[];
  assert.equal(calls, 1);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(out[0].details.product.pharmClasses, ['New [EPC]']);
  assert.deepEqual(out[0].details.product.pharmClassResolution.source, ['Old [EPC]']);
  assert.equal(out[0].details.product.pharmClassResolution.applied[0].ruleId, 'r1');
  assert.deepEqual(out[1].details.product.pharmClasses, ['Keep [EPC]']);
  assert.deepEqual(out[1].details.product.pharmClassResolution.applied, []);
  assert.equal(out[2], bare);
  assert.notEqual(out[0], withRule);
});

test('skips the query when no item has a moiety key', async () => {
  const bare = { doseForm: null, details: null } as never;
  const noKey = item('', []);
  const out = await applyPharmClassRules([bare, noKey], async () => {
    throw new Error('should not load');
  });
  assert.deepEqual(out, [bare, noKey]);
});
