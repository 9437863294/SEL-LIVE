import test from 'node:test';
import assert from 'node:assert/strict';

import { combineSummaries, entryValues, lastMonths, percent, summarizeProject, toMillis } from '../src/lib/billing-recon/dashboard.ts';

const NOW = Date.UTC(2026, 10, 3, 12); // 2026-11-03
const day = 86_400_000;
const ts = (ms) => ({ toMillis: () => ms });

const jmc = (id, over = {}) => ({
  id,
  jmcNo: `J-${id}`,
  jmcDate: '2026-10-15',
  status: 'In Progress',
  stage: 'Site Verification',
  createdAt: ts(NOW - 5 * day),
  deadline: ts(NOW + day),
  items: [{ rate: 100, executedQty: 10, certifiedQty: 4, totalAmount: 1000 }],
  ...over,
});

test('entry values use qty × rate and fall back to the stored amount', () => {
  assert.deepEqual(entryValues({ items: [{ rate: 50, executedQty: 2, certifiedQty: 1 }] }), { executed: 100, certified: 50 });
  assert.deepEqual(entryValues({ items: [{ rate: 0, executedQty: 2, totalAmount: 75 }] }), { executed: 75, certified: 0 });
  assert.deepEqual(entryValues({ items: [{ rate: '1,000', executedQty: '3' }, null, 'x'] }), { executed: 3000, certified: 0 });
  assert.deepEqual(entryValues({ items: undefined }), { executed: 0, certified: 0 });
});

test('dates parse from timestamps, seconds, ISO and dd-mm-yyyy', () => {
  assert.equal(toMillis(ts(5)), 5);
  assert.equal(toMillis({ seconds: 2 }), 2000);
  assert.equal(toMillis('2026-10-15'), Date.UTC(2026, 9, 15));
  assert.equal(toMillis('15-10-2026'), Date.UTC(2026, 9, 15));
  assert.equal(toMillis('15/10/2026'), Date.UTC(2026, 9, 15));
  assert.equal(toMillis('not a date'), null);
  assert.equal(toMillis(null), null);
});

test('a project summary separates pending, certified and billed value', () => {
  const s = summarizeProject(
    {
      jmcEntries: [
        jmc('1'),
        jmc('2', { status: 'Completed', items: [{ rate: 100, executedQty: 5, certifiedQty: 5 }] }),
        jmc('3', { status: 'Rejected', items: [{ rate: 100, executedQty: 99, certifiedQty: 99 }] }),
        jmc('4', { deadline: ts(NOW - day) }),
      ],
      mvacEntries: [{ id: 'm1', mvacNo: 'M-1', mvacDate: '2026-09-02', status: 'Pending', stage: 'Store Check', items: [{ rate: 10, executedQty: 10, certifiedQty: 10 }] }],
      bills: [
        { status: 'Submitted', totalAmount: 600, billDate: '2026-10-20', createdAt: ts(NOW - 2 * day) },
        { status: 'Draft', totalAmount: 100, billDate: '2026-10-25', createdAt: ts(NOW - day) },
        { status: 'Cancelled', totalAmount: 5000, billDate: '2026-10-25', createdAt: ts(NOW) },
      ],
    },
    NOW,
  );
  // executed: 1000 + 500 + 1000 (J4) + 100 (MVAC) = 2600; rejected J3 excluded
  assert.equal(s.values.executed, 2600);
  // certified: 400 + 500 + 400 + 100 = 1400
  assert.equal(s.values.certified, 1400);
  assert.equal(s.values.billed, 700);
  assert.equal(s.values.awaitingCertification, 1200);
  assert.equal(s.values.certifiedUnbilled, 700);
  assert.deepEqual(s.counts, { jmc: 4, mvac: 1, bills: 2, draftBills: 1 });
  // pending: J1, J4 (overdue), M1 — Completed and Rejected are closed
  assert.deepEqual(s.pending.map((p) => p.number), ['J-4', 'J-1', 'M-1']);
  assert.equal(s.overdueCount, 1);
  assert.deepEqual(s.byStage.find((x) => x.stage === 'Site Verification'), { stage: 'Site Verification', jmc: 2, mvac: 0, overdue: 1 });
  assert.equal(s.statusCounts.Rejected, 1);
  // the cancelled bill's creation still counts as activity
  assert.equal(s.lastActivity, NOW);
  const oct = s.byMonth.find((m) => m.month === '2026-10');
  assert.deepEqual(oct, { month: '2026-10', executed: 2500, certified: 1300, billed: 700 });
});

test('combining summaries adds values, stages and months', () => {
  const a = summarizeProject({ jmcEntries: [jmc('1')], mvacEntries: [], bills: [] }, NOW);
  const b = summarizeProject({ jmcEntries: [jmc('2', { deadline: ts(NOW - day) })], mvacEntries: [], bills: [{ status: 'Submitted', totalAmount: 50, billDate: '2026-10-01', createdAt: null }] }, NOW);
  const all = combineSummaries([a, b]);
  assert.equal(all.values.executed, 2000);
  assert.equal(all.values.billed, 50);
  assert.equal(all.pendingCount, 2);
  assert.equal(all.overdueCount, 1);
  assert.deepEqual(all.byStage, [{ stage: 'Site Verification', jmc: 2, mvac: 0, overdue: 1 }]);
});

test('the trend window fills empty months and ends at the current month', () => {
  const months = lastMonths([{ month: '2026-10', executed: 1, certified: 0, billed: 0 }], NOW, 3);
  assert.deepEqual(months.map((m) => m.month), ['2026-09', '2026-10', '2026-11']);
  assert.equal(months[1].executed, 1);
  assert.equal(months[0].executed, 0);
});

test('percent is safe against zero', () => {
  assert.equal(percent(1, 0), 0);
  assert.equal(percent(1, 3), 33);
});
