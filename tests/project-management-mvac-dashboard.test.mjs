import assert from 'node:assert/strict';
import test from 'node:test';

const {
  buildMvacCandidates,
  filterMvacCandidates,
  formatMvacQty,
  isMvacLive,
  mvacDate,
  mvacDocTotals,
  mvacGrnSourcesByLine,
  mvacRaisedOn,
  mvacStagePosition,
  summariseMvacRegister,
} = await import('../src/lib/project-management-mvac-dashboard.ts');

const { workflowRunPosition, approvedStepNames } = await import(
  '../src/lib/workflow-run-position.ts'
);

/* ── Fixtures ───────────────────────────────────────────────────────────────────────────────── */

const steps = [
  { id: '1', name: 'Site Verification' },
  { id: '2', name: 'Client Joint Acceptance' },
];

const approve = (stepName, timestamp = '2026-11-10T00:00:00.000Z') => ({
  stepName,
  action: 'Approve',
  timestamp,
});

const certificate = (id, overrides = {}) => ({
  id,
  docNumber: `MVAC-${id}`,
  docDate: '2026-11-10',
  status: 'Open',
  vendorName: 'Havells',
  history: [],
  ...overrides,
});

const line = (docId, overrides = {}) => ({
  docId,
  poId: 'po1',
  poLineId: 'l1',
  presentedQty: 10,
  acceptedQty: 10,
  ...overrides,
});

const NOW = new Date('2026-11-20T00:00:00.000Z');

/* ── Dates ──────────────────────────────────────────────────────────────────────────────────── */

test('mvacDate reads every shape the register holds', () => {
  assert.equal(mvacDate('2026-11-10')?.getUTCFullYear(), 2026);
  assert.equal(mvacDate({ seconds: 1763337600 })?.getTime(), 1763337600 * 1000);
  assert.equal(mvacDate(new Date('2026-01-02T00:00:00Z'))?.getUTCMonth(), 0);
  assert.equal(mvacDate(''), null);
  assert.equal(mvacDate('not a date'), null);
});

test('a certificate is raised on its document date, falling back to when it was created', () => {
  assert.equal(mvacRaisedOn({ id: 'a', docDate: '2026-11-10' })?.getUTCDate(), 10);
  assert.equal(
    mvacRaisedOn({ id: 'a', createdAt: { seconds: 1762992000 } })?.getTime(),
    1762992000 * 1000,
  );
  assert.equal(mvacRaisedOn({ id: 'a' }), null);
});

/* ── What holds quantity ────────────────────────────────────────────────────────────────────── */

test('drafts and cancellations hold no quantity', () => {
  assert.equal(isMvacLive(certificate('1')), true);
  assert.equal(isMvacLive(certificate('1', { status: 'Completed' })), true);
  assert.equal(isMvacLive(certificate('1', { status: 'Draft' })), false);
  assert.equal(isMvacLive(certificate('1', { status: 'Cancelled' })), false);
});

test('what was presented and not accepted counts as rejected, never below zero', () => {
  assert.deepEqual(mvacDocTotals([line('d1'), line('d1', { presentedQty: 6, acceptedQty: 4 })]), {
    presented: 16,
    accepted: 14,
    rejected: 2,
    lines: 2,
  });
  // A correction that accepted more than was presented is a data error, not a negative rejection.
  assert.equal(mvacDocTotals([line('d1', { presentedQty: 2, acceptedQty: 5 })]).rejected, 0);
  assert.deepEqual(mvacDocTotals(), { presented: 0, accepted: 0, rejected: 0, lines: 0 });
});

/* ── Where a certificate sits ───────────────────────────────────────────────────────────────── */

test('a certificate sits at the first step its history has no approval for', () => {
  assert.equal(mvacStagePosition(certificate('1'), steps), 0);
  assert.equal(
    mvacStagePosition(certificate('1', { history: [approve('Site Verification')] }), steps),
    1,
  );
  assert.equal(
    mvacStagePosition(
      certificate('1', {
        history: [approve('Site Verification'), approve('Client Joint Acceptance')],
      }),
      steps,
    ),
    2,
  );
});

test('a skipped step is reported as the gap, not as progress', () => {
  const skipped = certificate('1', { history: [approve('Client Joint Acceptance')] });
  assert.equal(mvacStagePosition(skipped, steps), 0);
});

test('the position rule is the shared one, not a second copy', () => {
  const history = [approve('Site Verification')];
  assert.equal(mvacStagePosition(certificate('1', { history }), steps), workflowRunPosition(history, steps));
  assert.deepEqual([...approvedStepNames(history)], ['Site Verification']);
});

/* ── Where material comes from ──────────────────────────────────────────────────────────────── */

const grnDocs = [
  { id: 'g1', docNumber: 'GRN-0001', docDate: '2026-10-01', decidedDate: '2026-10-02' },
  { id: 'g2', docNumber: 'GRN-0002', docDate: '2026-11-01', decidedDate: '2026-11-03' },
  { id: 'g3', docNumber: 'GRN-0003', docDate: '2026-11-05', status: 'Cancelled' },
];

test('each purchase-order line lists the GRNs that delivered it, newest first', () => {
  const sources = mvacGrnSourcesByLine(
    [
      { docId: 'g1', poId: 'po1', poLineId: 'l1', acceptedQty: 4 },
      { docId: 'g2', poId: 'po1', poLineId: 'l1', acceptedQty: 6 },
      { docId: 'g2', poId: 'po2', poLineId: 'l9', acceptedQty: 2 },
    ],
    grnDocs,
  );
  assert.deepEqual(sources.get('po1::l1'), [
    { grnNumber: 'GRN-0002', date: '2026-11-03', qty: 6 },
    { grnNumber: 'GRN-0001', date: '2026-10-02', qty: 4 },
  ]);
  assert.equal(sources.get('po2::l9')?.length, 1);
});

test('a cancelled GRN never appears behind a line, and nor does a nil receipt', () => {
  const sources = mvacGrnSourcesByLine(
    [
      { docId: 'g3', poId: 'po1', poLineId: 'l1', acceptedQty: 5 },
      { docId: 'g1', poId: 'po1', poLineId: 'l1', acceptedQty: 0 },
    ],
    grnDocs,
  );
  assert.equal(sources.has('po1::l1'), false);
});

/* ── What may go on a certificate ───────────────────────────────────────────────────────────── */

const ledger = (overrides = {}) => ({
  poId: 'po1',
  poLineId: 'l1',
  poNumber: 'PO-1',
  itemDescription: 'LT Cable 3.5C x 300',
  unit: 'Mtr',
  upstreamQty: 100,
  inFlightQty: 0,
  acceptedQty: 0,
  availableQty: 100,
  ...overrides,
});

const vendors = new Map([
  ['po1', { vendorName: 'Havells' }],
  ['po2', { vendorName: 'Polycab' }],
]);

test('the picker offers every received line, whoever supplied it', () => {
  const rows = buildMvacCandidates({
    ledgers: [
      ledger(),
      ledger({ poId: 'po2', poLineId: 'l9', poNumber: 'PO-2', itemDescription: 'Earth Strip' }),
    ],
    grnSources: mvacGrnSourcesByLine(
      [
        { docId: 'g1', poId: 'po1', poLineId: 'l1', acceptedQty: 100 },
        { docId: 'g2', poId: 'po2', poLineId: 'l9', acceptedQty: 100 },
      ],
      grnDocs,
    ),
    vendorByPoId: vendors,
  });

  assert.deepEqual(
    rows.map((row) => row.vendorName),
    ['Polycab', 'Havells'],
    'sorted by item, not grouped by vendor',
  );
  assert.equal(rows[1].grns[0].grnNumber, 'GRN-0001');
  assert.equal(rows[1].availableQty, 100);
});

test('a line with nothing left, or nothing received, is not offered', () => {
  const rows = buildMvacCandidates({
    ledgers: [
      ledger({ availableQty: 0 }),
      ledger({ poLineId: 'l2', upstreamQty: 0, availableQty: 0 }),
    ],
    grnSources: new Map(),
    vendorByPoId: vendors,
  });
  assert.equal(rows.length, 0);
});

test('a draft keeps its own lines even once their balance has gone', () => {
  const ledgers = [ledger({ availableQty: 0, inFlightQty: 100 })];
  assert.equal(
    buildMvacCandidates({ ledgers, grnSources: new Map(), vendorByPoId: vendors }).length,
    0,
    'not offered to a new certificate',
  );

  const [kept] = buildMvacCandidates({
    ledgers,
    grnSources: new Map(),
    vendorByPoId: vendors,
    alwaysInclude: new Set(['po1::l1']),
  });
  assert.equal(kept.key, 'po1::l1');
  assert.equal(kept.availableQty, 0, 'shown with its real balance, so saving still refuses it');
});

test('what is already covered by a certificate is reported as used', () => {
  const [row] = buildMvacCandidates({
    ledgers: [ledger({ inFlightQty: 30, acceptedQty: 20, availableQty: 50 })],
    grnSources: new Map(),
    vendorByPoId: vendors,
  });
  assert.equal(row.usedQty, 50);
  assert.equal(row.availableQty, 50);
  assert.equal(row.receivedQty, 100);
});

test('the search reads the item, the order, the vendor and the GRN numbers', () => {
  const rows = buildMvacCandidates({
    ledgers: [ledger(), ledger({ poId: 'po2', poLineId: 'l9', poNumber: 'PO-2', itemDescription: 'Earth Strip' })],
    grnSources: mvacGrnSourcesByLine(
      [{ docId: 'g2', poId: 'po2', poLineId: 'l9', acceptedQty: 10 }],
      grnDocs,
    ),
    vendorByPoId: vendors,
  });

  assert.equal(filterMvacCandidates(rows, 'cable')[0]?.poNumber, 'PO-1');
  assert.equal(filterMvacCandidates(rows, 'polycab')[0]?.poNumber, 'PO-2');
  assert.equal(filterMvacCandidates(rows, 'GRN-0002')[0]?.poNumber, 'PO-2');
  assert.equal(filterMvacCandidates(rows, '').length, 2);
  assert.equal(filterMvacCandidates(rows, 'nothing').length, 0);
});

/* ── The dashboard ──────────────────────────────────────────────────────────────────────────── */

test('the reading counts certificates by where they sit, and quantity by what they hold', () => {
  const reading = summariseMvacRegister({
    docs: [
      certificate('a'),
      certificate('b', { history: [approve('Site Verification')] }),
      certificate('c', {
        status: 'Completed',
        vendorName: 'Polycab',
        history: [approve('Site Verification'), approve('Client Joint Acceptance')],
      }),
      certificate('d', { status: 'Draft' }),
      certificate('e', { status: 'Cancelled' }),
    ],
    items: [
      line('a'),
      line('b', { presentedQty: 20, acceptedQty: 15 }),
      line('c', { presentedQty: 5, acceptedQty: 5 }),
      line('d', { presentedQty: 99, acceptedQty: 0 }),
    ],
    steps,
    now: NOW,
  });

  assert.equal(reading.count, 3);
  assert.equal(reading.drafts, 1);
  assert.equal(reading.cancelled, 1);
  assert.equal(reading.inWorkflow, 2);
  assert.equal(reading.completed, 1);
  assert.equal(reading.lines, 3, 'the draft holds no quantity, so its line is not counted');
  assert.equal(reading.presentedQty, 35);
  assert.equal(reading.acceptedQty, 30);
  assert.equal(reading.rejectedQty, 5);
  assert.equal(reading.vendors, 2);

  assert.deepEqual(
    reading.stages.map((stage) => [stage.name, stage.waiting, stage.cleared, stage.waitingQty]),
    [
      ['Site Verification', 1, 2, 10],
      ['Client Joint Acceptance', 1, 1, 20],
    ],
  );
});

test('with no workflow configured, a signed certificate still reads as finished', () => {
  const reading = summariseMvacRegister({
    docs: [certificate('a', { status: 'Completed' }), certificate('b', { status: 'Open' })],
    items: [],
    steps: [],
    now: NOW,
  });
  assert.equal(reading.completed, 1);
  assert.equal(reading.inWorkflow, 1);
  assert.deepEqual(reading.stages, []);
});

test('the oldest waiting certificate is reported in days, and only while it is waiting', () => {
  const reading = summariseMvacRegister({
    docs: [
      certificate('a', { docDate: '2026-11-01' }),
      certificate('b', { docDate: '2026-11-18' }),
      certificate('c', {
        docDate: '2026-01-01',
        history: [approve('Site Verification'), approve('Client Joint Acceptance')],
      }),
    ],
    items: [],
    steps,
    now: NOW,
  });
  assert.equal(reading.oldestWaitingDays, 19);

  const settled = summariseMvacRegister({
    docs: [
      certificate('c', {
        docDate: '2026-01-01',
        history: [approve('Site Verification'), approve('Client Joint Acceptance')],
      }),
    ],
    items: [],
    steps,
    now: NOW,
  });
  assert.equal(settled.oldestWaitingDays, null);
});

test('the month series keeps empty months as gaps', () => {
  const reading = summariseMvacRegister({
    docs: [certificate('a', { docDate: '2026-11-10' }), certificate('b', { docDate: '2026-09-02' })],
    items: [line('a', { acceptedQty: 7 })],
    steps,
    now: NOW,
    months: 4,
  });

  assert.deepEqual(
    reading.months.map((month) => [month.key, month.raised, month.acceptedQty]),
    [
      ['2026-08', 0, 0],
      ['2026-09', 1, 0],
      ['2026-10', 0, 0],
      ['2026-11', 1, 7],
    ],
  );
});

test('a certificate raised outside the window is counted but not plotted', () => {
  const reading = summariseMvacRegister({
    docs: [certificate('old', { docDate: '2024-01-01' })],
    items: [line('old')],
    steps,
    now: NOW,
    months: 3,
  });
  assert.equal(reading.count, 1);
  assert.equal(
    reading.months.reduce((sum, month) => sum + month.raised, 0),
    0,
  );
});

/* ── Formatting ─────────────────────────────────────────────────────────────────────────────── */

test('quantities are quoted plainly, with their unit where there is one', () => {
  assert.equal(formatMvacQty(1240), '1,240');
  assert.equal(formatMvacQty(1240.5, 'Mtr'), '1,240.5 Mtr');
  assert.equal(formatMvacQty(Number.NaN), '0');
});
