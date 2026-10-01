import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRequestNos, orderForReception, planReception } from '../src/lib/daily-requisition-receive.ts';

test('DEP numbers sort by serial as a number, departments kept together', () => {
  const ordered = orderForReception([
    { requestNo: 'SEL/EXP/FIN/2026-27/0010' },
    { requestNo: 'SEL/EXP/HR/2026-27/0001' },
    { requestNo: 'SEL/EXP/FIN/2026-27/0002' },
    { requestNo: 'SEL/EXP/FIN/2026-27/0001' },
  ]).map((r) => r.requestNo);
  assert.deepEqual(ordered, [
    'SEL/EXP/FIN/2026-27/0001',
    'SEL/EXP/FIN/2026-27/0002',
    'SEL/EXP/FIN/2026-27/0010',
    'SEL/EXP/HR/2026-27/0001',
  ]);
  assert.ok(compareRequestNos('X/9', 'X/10') < 0);
});

test('the lowest DEP serial takes the first reception number, the highest the last', () => {
  const { items, nextIndex } = planReception(
    [{ requestNo: 'D/0005' }, { requestNo: 'D/0001' }, { requestNo: 'D/0003' }],
    { prefix: 'SEL/REC/', format: '2025-26/', suffix: '', startingIndex: 57 },
  );
  assert.deepEqual(
    items.map((i) => [i.request.requestNo, i.receptionNo]),
    [
      ['D/0001', 'SEL/REC/2025-26/0057'],
      ['D/0003', 'SEL/REC/2025-26/0058'],
      ['D/0005', 'SEL/REC/2025-26/0059'],
    ],
  );
  assert.equal(nextIndex, 60);
});

test('nothing picked allocates nothing', () => {
  const { items, nextIndex } = planReception([], { startingIndex: 12 });
  assert.equal(items.length, 0);
  assert.equal(nextIndex, 12);
});
