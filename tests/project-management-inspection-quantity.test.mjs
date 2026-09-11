import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInspectionItemView,
  buildInspectionLedger,
  buildInspectionLedgers,
  buildInspectionRegisterRows,
  canIssueMdccForItem,
  canOfferPoLine,
  checkBalanceForOffer,
  deriveInspectionCallStatus,
  inspectionPoLineKey,
  rebuildInspectionPoLineBalance,
  rejectedQtyOf,
  resultStatusFor,
  validateInspectionItems,
  validateInspectionResult,
  validateOfferQty,
} from '../src/lib/project-management-inspection-quantity.ts';

/* ── Fixtures ───────────────────────────────────────────────────────────────────────────────── */

/** A PO line of 100 with 60 cleared for manufacturing. */
const makeLine = (overrides = {}) => ({
  poId: 'po-1',
  poNumber: 'PO/2026/001',
  poLineId: 'pol-a',
  itemDescription: 'Tower Structure',
  unit: 'MT',
  orderedQty: 100,
  mcApprovedQty: 60,
  ...overrides,
});

const makeCall = (overrides = {}) => ({
  id: 'ic-1',
  callNumber: 'IC/2026/001',
  globalProjectId: 'proj-1',
  vendorId: 'v-1',
  vendorName: 'Alpha Fabricators',
  callDate: '2026-05-12',
  status: 'Called',
  revision: 0,
  ...overrides,
});

const makeItem = (overrides = {}) => ({
  id: 'ici-1',
  callId: 'ic-1',
  poId: 'po-1',
  poNumber: 'PO/2026/001',
  poLineId: 'pol-a',
  itemDescription: 'Tower Structure',
  unit: 'MT',
  offeredQty: 40,
  status: 'Pending',
  ...overrides,
});

const punch = (overrides = {}) => ({
  punchId: 'p-1',
  description: 'Weld undercut at node 3',
  severity: 'Major',
  closed: false,
  ...overrides,
});

const ledgerFor = (line, items = [], calls = [], options = {}) =>
  buildInspectionLedgers([line], items, calls, options).get(
    inspectionPoLineKey(line.poId, line.poLineId),
  );

/* ── The cleared quantity is the ceiling ────────────────────────────────────────────────────── */

test('the inspectable ceiling is the cleared quantity, not the ordered quantity', () => {
  const ledger = ledgerFor(makeLine({ orderedQty: 100, mcApprovedQty: 60 }));
  assert.equal(ledger.orderedQty, 100);
  assert.equal(ledger.clearedQty, 60);
  assert.equal(ledger.availableQty, 60);
});

test('a line with nothing cleared has nothing to offer and says it is awaiting clearance', () => {
  const ledger = ledgerFor(makeLine({ mcApprovedQty: 0 }));
  assert.equal(ledger.awaitingClearance, true);
  assert.equal(ledger.availableQty, 0);
  assert.equal(canOfferPoLine(ledger), false);
});

test('offering against a line with no clearance is refused and points at the clearance, not a number', () => {
  const ledger = ledgerFor(makeLine({ mcApprovedQty: 0 }));
  const result = validateOfferQty(10, ledger);
  assert.equal(result.ok, false);
  assert.match(result.message, /no approved Manufacturing Clearance quantity yet/);
});

test('offering more than the cleared balance is refused with the maximum named', () => {
  const ledger = ledgerFor(makeLine({ orderedQty: 100, mcApprovedQty: 40 }));
  const result = validateOfferQty(70, ledger);
  assert.equal(result.ok, false);
  assert.equal(
    result.message,
    'Offered quantity exceeds the cleared balance available for inspection. Maximum quantity available: 40.',
  );
});

test('offering exactly the cleared balance is accepted', () => {
  const ledger = ledgerFor(makeLine({ mcApprovedQty: 40 }));
  assert.equal(validateOfferQty(40, ledger).ok, true);
});

/* ── Reservation ────────────────────────────────────────────────────────────────────────────── */

test('a called inspection reserves its offered quantity', () => {
  const ledger = ledgerFor(makeLine(), [makeItem({ offeredQty: 40 })], [makeCall()]);
  assert.equal(ledger.offeredPendingQty, 40);
  assert.equal(ledger.acceptedQty, 0);
  assert.equal(ledger.availableQty, 20);
});

test('a draft call holds no quantity but is reported so a screen can warn', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ offeredQty: 50 })],
    [makeCall({ status: 'Draft' })],
  );
  assert.equal(ledger.draftQty, 50);
  assert.equal(ledger.offeredPendingQty, 0);
  assert.equal(ledger.availableQty, 60);
  assert.equal(ledger.availableAfterDraftsQty, 10);
});

test('cancelling a call releases the quantity it was holding', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ offeredQty: 50 })],
    [makeCall({ status: 'Cancelled' })],
  );
  assert.equal(ledger.offeredPendingQty, 0);
  assert.equal(ledger.availableQty, 60);
});

test('cancelling a call voids even its already passed lines', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ offeredQty: 50, acceptedQty: 50, status: 'Passed' })],
    [makeCall({ status: 'Cancelled' })],
  );
  assert.equal(ledger.acceptedQty, 0);
  assert.equal(ledger.availableQty, 60);
});

test('an item whose call cannot be found is not counted rather than guessed at', () => {
  const ledger = ledgerFor(makeLine(), [makeItem({ callId: 'ic-missing', offeredQty: 50 })], []);
  assert.equal(ledger.offeredPendingQty, 0);
  assert.equal(ledger.availableQty, 60);
});

/* ── Accepted, rejected and rework ──────────────────────────────────────────────────────────── */

test('accepted quantity consumes the cleared balance', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ offeredQty: 40, acceptedQty: 40, status: 'Passed' })],
    [makeCall({ status: 'Completed' })],
  );
  assert.equal(ledger.acceptedQty, 40);
  assert.equal(ledger.availableQty, 20);
  assert.equal(ledger.status, 'Partially Inspected');
});

test('rejected quantity returns to the balance so it can be reworked and re-offered', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ offeredQty: 40, acceptedQty: 30, status: 'Passed' })],
    [makeCall({ status: 'Completed' })],
  );
  assert.equal(ledger.acceptedQty, 30);
  assert.equal(ledger.rejectedQty, 10);
  // 60 cleared − 30 accepted = 30 available, which includes the 10 rejected.
  assert.equal(ledger.availableQty, 30);
});

test('a wholly failed inspection returns its entire offered quantity for rework', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ offeredQty: 40, acceptedQty: 0, status: 'Failed' })],
    [makeCall({ status: 'Completed' })],
  );
  assert.equal(ledger.acceptedQty, 0);
  assert.equal(ledger.rejectedQty, 40);
  assert.equal(ledger.availableQty, 60);
  assert.equal(ledger.status, 'Not Inspected');
});

test('reworked material can be re-offered under the same cleared balance', () => {
  const calls = [
    makeCall({ id: 'ic-1', status: 'Completed' }),
    makeCall({ id: 'ic-2', status: 'Called' }),
  ];
  const items = [
    makeItem({ id: 'i1', callId: 'ic-1', offeredQty: 40, acceptedQty: 0, status: 'Failed' }),
    makeItem({ id: 'i2', callId: 'ic-2', offeredQty: 40, status: 'Pending' }),
  ];
  const ledger = ledgerFor(makeLine(), items, calls);
  assert.equal(ledger.rejectedQty, 40);
  assert.equal(ledger.offeredPendingQty, 40);
  assert.equal(ledger.availableQty, 20);
});

test('a pending item has no rejected quantity yet', () => {
  assert.equal(rejectedQtyOf({ offeredQty: 40, status: 'Pending' }), 0);
});

test('a line is fully inspected once accepted quantity reaches the cleared quantity', () => {
  const ledger = ledgerFor(
    makeLine({ mcApprovedQty: 60 }),
    [makeItem({ offeredQty: 60, acceptedQty: 60, status: 'Passed' })],
    [makeCall({ status: 'Completed' })],
  );
  assert.equal(ledger.fullyInspected, true);
  assert.equal(ledger.status, 'Fully Inspected');
  assert.equal(ledger.acceptedPct, 100);
  assert.equal(canOfferPoLine(ledger), false);
});

test('a fully inspected line refuses further offers in its own terms', () => {
  const ledger = ledgerFor(
    makeLine({ mcApprovedQty: 60 }),
    [makeItem({ offeredQty: 60, acceptedQty: 60, status: 'Passed' })],
    [makeCall({ status: 'Completed' })],
  );
  const result = validateOfferQty(1, ledger);
  assert.equal(result.ok, false);
  assert.match(result.message, /already been inspected for its whole cleared quantity/);
});

test('further clearance reopens a line that had been fully inspected against the old ceiling', () => {
  const items = [makeItem({ offeredQty: 60, acceptedQty: 60, status: 'Passed' })];
  const calls = [makeCall({ status: 'Completed' })];
  const before = ledgerFor(makeLine({ mcApprovedQty: 60 }), items, calls);
  assert.equal(before.fullyInspected, true);
  // MC clears another 40, so there is inspectable quantity again without anything else changing.
  const after = ledgerFor(makeLine({ mcApprovedQty: 100 }), items, calls);
  assert.equal(after.fullyInspected, false);
  assert.equal(after.availableQty, 40);
});

/* ── PO line identity ───────────────────────────────────────────────────────────────────────── */

test('the same material listed twice on one po keeps two independent inspection balances', () => {
  const lineA = makeLine({ poLineId: 'pol-a', mcApprovedQty: 60 });
  const lineB = makeLine({ poLineId: 'pol-b', mcApprovedQty: 25 });
  const ledgers = buildInspectionLedgers(
    [lineA, lineB],
    [makeItem({ poLineId: 'pol-a', offeredQty: 60, acceptedQty: 60, status: 'Passed' })],
    [makeCall({ status: 'Completed' })],
  );
  const a = ledgers.get(inspectionPoLineKey('po-1', 'pol-a'));
  const b = ledgers.get(inspectionPoLineKey('po-1', 'pol-b'));
  assert.equal(a.fullyInspected, true);
  assert.equal(b.fullyInspected, false);
  assert.equal(b.availableQty, 25);
  assert.equal(b.acceptedQty, 0);
});

test('inspection against one po does not touch the same material on another po', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ poId: 'po-2', offeredQty: 60, acceptedQty: 60, status: 'Passed' })],
    [makeCall({ status: 'Completed' })],
  );
  assert.equal(ledger.availableQty, 60);
});

/* ── Editing an existing call ───────────────────────────────────────────────────────────────── */

test('a call being edited sees the balance without its own held quantity', () => {
  const items = [
    makeItem({ id: 'i1', callId: 'ic-1', offeredQty: 20, acceptedQty: 20, status: 'Passed' }),
    makeItem({ id: 'i2', callId: 'ic-2', offeredQty: 15 }),
  ];
  const calls = [makeCall({ id: 'ic-1', status: 'Completed' }), makeCall({ id: 'ic-2' })];

  assert.equal(ledgerFor(makeLine(), items, calls).availableQty, 25);
  assert.equal(
    ledgerFor(makeLine(), items, calls, { excludeCallId: 'ic-2' }).availableQty,
    40,
  );
});

/* ── Whole-call validation ──────────────────────────────────────────────────────────────────── */

test('a call with no lines cannot be raised', () => {
  assert.equal(validateInspectionItems([], new Map()).length, 1);
});

test('two lines on one call against the same po line are refused as a duplicate', () => {
  const ledgers = buildInspectionLedgers([makeLine()], [], []);
  const errors = validateInspectionItems(
    [makeItem({ id: 'i1', offeredQty: 30 }), makeItem({ id: 'i2', offeredQty: 30 })],
    ledgers,
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].itemId, 'i2');
  assert.match(errors[0].message, /twice/);
});

test('a line pointing at a po line that no longer exists is reported', () => {
  const errors = validateInspectionItems([makeItem({ poLineId: 'pol-gone' })], new Map());
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /no longer a line on that purchase order/);
});

test('every over-offering line is reported, not just the first', () => {
  const lines = [
    makeLine({ poLineId: 'pol-a', mcApprovedQty: 10 }),
    makeLine({ poLineId: 'pol-b', mcApprovedQty: 10 }),
  ];
  const ledgers = buildInspectionLedgers(lines, [], []);
  const errors = validateInspectionItems(
    [
      makeItem({ id: 'i1', poLineId: 'pol-a', offeredQty: 50 }),
      makeItem({ id: 'i2', poLineId: 'pol-b', offeredQty: 50 }),
    ],
    ledgers,
  );
  assert.equal(errors.length, 2);
});

/* ── Recording a result ─────────────────────────────────────────────────────────────────────── */

test('accepting the whole offered quantity is a pass', () => {
  assert.equal(validateInspectionResult(40, 40).ok, true);
  assert.equal(resultStatusFor(40), 'Passed');
});

test('accepting part of what was offered is still a pass, with the rest rejected', () => {
  assert.equal(validateInspectionResult(40, 30).ok, true);
  assert.equal(resultStatusFor(30), 'Passed');
  assert.equal(rejectedQtyOf({ offeredQty: 40, acceptedQty: 30, status: 'Passed' }), 10);
});

test('accepting nothing is a failure', () => {
  assert.equal(resultStatusFor(0), 'Failed');
});

test('an inspector cannot pass more than was offered', () => {
  const result = validateInspectionResult(40, 55);
  assert.equal(result.ok, false);
  assert.match(result.message, /cannot exceed the 40 offered/);
});

test('a negative accepted quantity is refused', () => {
  assert.equal(validateInspectionResult(40, -1).ok, false);
});

test('a pass carrying punch items is recorded as conditional', () => {
  assert.equal(resultStatusFor(40, [punch()]), 'Passed with Punch Items');
});

/* ── MDCC gating ────────────────────────────────────────────────────────────────────────────── */

test('a clean pass may proceed to mdcc', () => {
  assert.equal(canIssueMdccForItem({ status: 'Passed' }), true);
});

test('an open major punch item blocks mdcc even though the quantity passed', () => {
  assert.equal(
    canIssueMdccForItem({ status: 'Passed with Punch Items', punchItems: [punch()] }),
    false,
  );
});

test('a minor punch item may be carried to site and does not block mdcc', () => {
  assert.equal(
    canIssueMdccForItem({
      status: 'Passed with Punch Items',
      punchItems: [punch({ severity: 'Minor' })],
    }),
    true,
  );
});

test('closing the blocking punch item releases mdcc', () => {
  assert.equal(
    canIssueMdccForItem({
      status: 'Passed with Punch Items',
      punchItems: [punch({ closed: true, closedDate: '2026-06-01' })],
    }),
    true,
  );
});

test('a failed item may not proceed to mdcc', () => {
  assert.equal(canIssueMdccForItem({ status: 'Failed' }), false);
});

/* ── The call item row ──────────────────────────────────────────────────────────────────────── */

test('a call line shows cleared, previously accepted, offered, accepted, rejected and balance', () => {
  const items = [
    makeItem({ id: 'i1', callId: 'ic-1', offeredQty: 20, acceptedQty: 20, status: 'Passed' }),
    makeItem({ id: 'i2', callId: 'ic-2', offeredQty: 30, acceptedQty: 25, status: 'Passed' }),
  ];
  const calls = [
    makeCall({ id: 'ic-1', status: 'Completed' }),
    makeCall({ id: 'ic-2', status: 'Completed' }),
  ];
  const ledger = ledgerFor(makeLine(), items, calls, { excludeCallId: 'ic-2' });

  const view = buildInspectionItemView(items[1], ledger);
  assert.equal(view.clearedQty, 60);
  assert.equal(view.previouslyAcceptedQty, 20);
  assert.equal(view.offeredQty, 30);
  assert.equal(view.acceptedQty, 25);
  assert.equal(view.rejectedQty, 5);
  assert.equal(view.cumulativeAcceptedQty, 45);
  assert.equal(view.balanceQty, 15);
});

/* ── Call status ────────────────────────────────────────────────────────────────────────────── */

test('a call with every line still awaiting inspection stays called', () => {
  const items = [{ status: 'Pending' }, { status: 'Pending' }];
  assert.equal(deriveInspectionCallStatus(items, 'Called'), 'Called');
});

test('a call with some lines inspected is partially inspected', () => {
  const items = [{ status: 'Passed' }, { status: 'Pending' }];
  assert.equal(deriveInspectionCallStatus(items, 'Called'), 'Partially Inspected');
});

test('a call whose every line has a result is completed, pass or fail', () => {
  const items = [{ status: 'Passed' }, { status: 'Failed' }];
  assert.equal(deriveInspectionCallStatus(items, 'Called'), 'Completed');
});

test('a draft call keeps its status whatever its lines say', () => {
  assert.equal(deriveInspectionCallStatus([{ status: 'Passed' }], 'Draft'), 'Draft');
});

test('a cancelled call is not revived by its line statuses', () => {
  assert.equal(deriveInspectionCallStatus([{ status: 'Passed' }], 'Cancelled'), 'Cancelled');
});

test('a call whose every line has been cancelled is itself cancelled', () => {
  const items = [{ status: 'Cancelled' }, { status: 'Cancelled' }];
  assert.equal(deriveInspectionCallStatus(items, 'Called'), 'Cancelled');
});

test('a cancelled line is ignored when judging whether the rest of the call is complete', () => {
  const items = [{ status: 'Passed' }, { status: 'Cancelled' }];
  assert.equal(deriveInspectionCallStatus(items, 'Called'), 'Completed');
});

/* ── Concurrency guard ──────────────────────────────────────────────────────────────────────── */

test('the first offer against a line sees the whole cleared quantity free', () => {
  assert.equal(checkBalanceForOffer(60, 60, null).ok, true);
});

test('the guard refuses an offer that no longer fits, naming what is left', () => {
  const balance = { acceptedQty: 20, offeredPendingQty: 30 };
  const result = checkBalanceForOffer(20, 60, balance);
  assert.equal(result.ok, false);
  assert.equal(
    result.message,
    'Offered quantity exceeds the cleared balance available for inspection. Maximum quantity available: 10.',
  );
});

test('the guard refuses any offer once nothing is cleared', () => {
  const result = checkBalanceForOffer(5, 0, null);
  assert.equal(result.ok, false);
  assert.match(result.message, /No approved Manufacturing Clearance quantity remains/);
});

test('a guard document rebuilds exactly from the ledger it was derived from', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ offeredQty: 40, acceptedQty: 30, status: 'Passed' })],
    [makeCall({ status: 'Completed' })],
  );
  const balance = rebuildInspectionPoLineBalance(ledger);
  assert.deepEqual(balance, {
    poId: 'po-1',
    poLineId: 'pol-a',
    poNumber: 'PO/2026/001',
    clearedQty: 60,
    acceptedQty: 30,
    offeredPendingQty: 0,
  });
});

/* ── Register ───────────────────────────────────────────────────────────────────────────────── */

test('a register row counts the pos and lines a call covers and totals its quantities', () => {
  const rows = buildInspectionRegisterRows(
    [makeCall({ status: 'Completed' })],
    [
      makeItem({ id: 'i1', poId: 'po-1', poLineId: 'pol-a', offeredQty: 40, acceptedQty: 35, status: 'Passed' }),
      makeItem({ id: 'i2', poId: 'po-2', poLineId: 'pol-b', offeredQty: 10, acceptedQty: 10, status: 'Passed' }),
    ],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].poCount, 2);
  assert.equal(rows[0].itemCount, 2);
  assert.equal(rows[0].offeredQty, 50);
  assert.equal(rows[0].acceptedQty, 45);
  assert.equal(rows[0].rejectedQty, 5);
});

test('the register counts lines whose open punch items block mdcc', () => {
  const rows = buildInspectionRegisterRows(
    [makeCall({ status: 'Completed' })],
    [
      makeItem({
        id: 'i1',
        offeredQty: 40,
        acceptedQty: 40,
        status: 'Passed with Punch Items',
        punchItems: [punch()],
      }),
      makeItem({
        id: 'i2',
        poLineId: 'pol-b',
        offeredQty: 10,
        acceptedQty: 10,
        status: 'Passed with Punch Items',
        punchItems: [punch({ severity: 'Minor' })],
      }),
    ],
  );
  assert.equal(rows[0].blockingPunchCount, 1);
});

test('a cancelled line is left out of the register counts and totals', () => {
  const rows = buildInspectionRegisterRows(
    [makeCall()],
    [
      makeItem({ id: 'i1', offeredQty: 40 }),
      makeItem({ id: 'i2', poId: 'po-2', offeredQty: 10, status: 'Cancelled' }),
    ],
  );
  assert.equal(rows[0].poCount, 1);
  assert.equal(rows[0].itemCount, 1);
  assert.equal(rows[0].offeredQty, 40);
});

test('a call with no lines yet still produces a register row', () => {
  const rows = buildInspectionRegisterRows([makeCall()], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemCount, 0);
  assert.equal(rows[0].offeredQty, 0);
});

/* ── Tolerant reads and rounding ────────────────────────────────────────────────────────────── */

test('quantities arriving from firestore as strings are read rather than rejected', () => {
  const ledger = buildInspectionLedger(
    makeLine({ mcApprovedQty: '60' }),
    [makeItem({ offeredQty: '40', acceptedQty: '30', status: 'Passed' })],
    new Map([['ic-1', { status: 'Completed' }]]),
  );
  assert.equal(ledger.clearedQty, 60);
  assert.equal(ledger.acceptedQty, 30);
  assert.equal(ledger.availableQty, 30);
});

test('an unreadable quantity counts as nothing rather than poisoning the ledger with NaN', () => {
  const ledger = buildInspectionLedger(
    makeLine(),
    [makeItem({ offeredQty: 'n/a', status: 'Pending' })],
    new Map([['ic-1', { status: 'Called' }]]),
  );
  assert.equal(ledger.offeredPendingQty, 0);
  assert.equal(ledger.availableQty, 60);
});

test('fractional acceptances that sum to the cleared quantity close the line exactly', () => {
  const calls = [
    makeCall({ id: 'ic-1', status: 'Completed' }),
    makeCall({ id: 'ic-2', status: 'Completed' }),
    makeCall({ id: 'ic-3', status: 'Completed' }),
  ];
  const items = [
    makeItem({ id: 'i1', callId: 'ic-1', offeredQty: 20, acceptedQty: 19.999, status: 'Passed' }),
    makeItem({ id: 'i2', callId: 'ic-2', offeredQty: 20, acceptedQty: 20, status: 'Passed' }),
    makeItem({ id: 'i3', callId: 'ic-3', offeredQty: 20.001, acceptedQty: 20.001, status: 'Passed' }),
  ];
  const ledger = ledgerFor(makeLine({ mcApprovedQty: 60 }), items, calls);
  assert.equal(ledger.acceptedQty, 60);
  assert.equal(ledger.fullyInspected, true);
  assert.equal(ledger.availableQty, 0);
});
