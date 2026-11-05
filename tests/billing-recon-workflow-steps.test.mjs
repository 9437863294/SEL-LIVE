import test from 'node:test';
import assert from 'node:assert/strict';

import { readWorkflowSteps } from '../src/lib/billing-recon/workflow-steps.ts';

test('saved step ids are kept as strings', () => {
  const steps = readWorkflowSteps([{ id: 7, name: 'Site Verification', tat: 24 }, { id: 'qa', name: 'QA' }], 'JMC');
  assert.deepEqual(steps.map((s) => [s.id, s.name]), [['7', 'Site Verification'], ['qa', 'QA']]);
  assert.equal(steps[0].tat, 24, 'other step fields are kept');
});

test('JMC steps without an id fall back to their position among named steps', () => {
  const steps = readWorkflowSteps([{ name: 'A' }, null, { id: '', name: 'B' }, { notAName: true }], 'JMC');
  assert.deepEqual(steps.map((s) => s.id), ['1', '2']);
});

test('MVAC steps without an id fall back to their slugged name', () => {
  const steps = readWorkflowSteps([{ name: 'Store Check & Count' }, { id: 'x', name: 'Final' }], 'MVAC');
  assert.deepEqual(steps.map((s) => s.id), ['store-check--count', 'x']);
});

test('anything that is not a list gives no steps', () => {
  assert.deepEqual(readWorkflowSteps(undefined, 'JMC'), []);
  assert.deepEqual(readWorkflowSteps({ steps: [] }, 'MVAC'), []);
});
