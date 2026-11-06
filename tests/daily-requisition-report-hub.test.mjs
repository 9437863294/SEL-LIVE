import test from 'node:test';
import assert from 'node:assert/strict';
import { HUB_BACKLOG_DAYS, hubFigures } from '../src/lib/daily-requisition-report-hub.ts';

const TODAY = '2026-11-06';
const row = (patch) => ({
  dateKey: '2026-11-02',
  status: 'Pending',
  gross: 100,
  net: 100,
  paid: 0,
  balance: 100,
  igst: 0,
  cgst: 0,
  sgst: 0,
  tds: 0,
  retention: 0,
  other: 0,
  departmentId: 'd1',
  projectId: 'p1',
  party: 'Party A',
  stage: 'work:receiving',
  ...patch,
});
const stages = ['step:v', 'work:receiving', 'work:gst', 'work:payment'];

test('totals in the range leave cancelled out; backlog counts what is open past 180 days', () => {
  const figures = hubFigures(
    [
      row({ stage: 'step:v' }),
      row({ dateKey: '2026-04-01', stage: 'work:gst', balance: 300, net: 300, status: 'Received' }),
      row({ status: 'Paid', paid: 50, balance: 0, net: 50, stage: null }),
      row({ status: 'Cancelled', stage: null }),
      row({ dateKey: '2025-01-01', status: 'Received', stage: 'work:gst', balance: 70, net: 70 }),
    ],
    { todayKey: TODAY, range: { from: '', to: TODAY }, stages },
  );
  assert.deepEqual(figures.totals, { count: 4, net: 520, paid: 50, outstanding: 470, open: 3, overBacklog: 2, overBacklogBalance: 370 });
  assert.equal(HUB_BACKLOG_DAYS, 180);
  assert.equal(figures.thisMonthCount, 2, 'received this month, cancelled left out');
  assert.deepEqual(
    figures.pipeline.map((p) => [p.key, p.count, p.balance]),
    [
      ['step:v', 1, 100],
      ['work:receiving', 0, 0],
      ['work:gst', 2, 370],
      ['work:payment', 0, 0],
    ],
  );
});

test('the range narrows totals and breakdowns, but not the 12 months nor the ageing of what is open now', () => {
  const rows = [row({ dateKey: '2026-11-02' }), row({ dateKey: '2026-08-10', departmentId: 'd2', net: 400, balance: 400 })];
  const figures = hubFigures(rows, { todayKey: TODAY, range: { from: '2026-11-01', to: TODAY }, stages });
  assert.equal(figures.totals.count, 1);
  assert.deepEqual(figures.departments.map((d) => d.key), ['d1']);
  assert.equal(figures.monthly.length, 12);
  assert.equal(figures.monthly[11].key, '2026-11');
  assert.equal(figures.monthly[11].net, 100);
  assert.equal(figures.monthly[8].net, 400, 'August, outside the range, still on the trend');
  assert.deepEqual(figures.ageing.map((b) => b.count), [1, 0, 1, 0]);
});

test('money and tax add up; groups come largest first', () => {
  const figures = hubFigures(
    [
      row({ gross: 1000, net: 1100, igst: 180, tds: 20, retention: 50, other: 10, party: 'Big', projectId: 'p2', balance: 1100 }),
      row({ gross: 500, net: 545, cgst: 22.5, sgst: 22.5, party: 'Small' }),
      row({ party: '  ' }),
    ],
    { todayKey: TODAY, range: { from: '', to: TODAY }, stages },
  );
  assert.deepEqual(figures.money, { gross: 1600, net: 1745, gst: 225, tds: 20, retention: 50, other: 10 });
  assert.deepEqual(figures.tax, { igst: 180, cgst: 22.5, sgst: 22.5, tds: 20, bills: 2 });
  assert.deepEqual(figures.parties.map((p) => p.key), ['Big', 'Small', '—']);
  assert.deepEqual(figures.projects.map((p) => p.key), ['p2', 'p1'], 'projects by what is still owed');
});
