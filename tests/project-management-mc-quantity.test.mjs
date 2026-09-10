import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MC_GROUPING_RULE,
  buildMcItemView,
  buildMcRegisterRows,
  buildPoLineLedger,
  buildPoLineLedgers,
  canSelectPoLine,
  computeMcAmendment,
  deriveMcHeaderStatus,
  effectivePoQty,
  poLineKey,
  validateMcGrouping,
  validateMcItemQty,
  validateMcItems,
  validatePoQtyRevision,
} from '../src/lib/project-management-mc-quantity.ts';
import { ensurePoLineIds, newPoLineId, resolvePoLineId } from '../src/lib/purchase-orders.ts';

/* ── Fixtures ───────────────────────────────────────────────────────────────────────────────── */

const makeLine = (overrides = {}) => ({
  poId: 'po-1',
  poNumber: 'PO/2026/001',
  poLineId: 'pol-a',
  itemDescription: 'Tower Structure',
  unit: 'MT',
  orderedQty: 100,
  cancelledQty: 0,
  ...overrides,
});

const makeHeader = (overrides = {}) => ({
  id: 'mc-1',
  mcNumber: 'MC/2026/001',
  globalProjectId: 'proj-1',
  vendorId: 'v-1',
  vendorName: 'Alpha Fabricators',
  mcDate: '2026-04-10',
  status: 'Submitted',
  revision: 0,
  ...overrides,
});

const makeItem = (overrides = {}) => ({
  id: 'mci-1',
  mcId: 'mc-1',
  poId: 'po-1',
  poNumber: 'PO/2026/001',
  poLineId: 'pol-a',
  itemDescription: 'Tower Structure',
  unit: 'MT',
  currentMcQty: 40,
  status: 'Pending',
  ...overrides,
});

/** One line's ledger, the way a screen would ask for it. */
const ledgerFor = (line, items = [], headers = [], options = {}) =>
  buildPoLineLedgers([line], items, headers, options).get(poLineKey(line.poId, line.poLineId));

/* ── Effective PO quantity ──────────────────────────────────────────────────────────────────── */

test('cancelled quantity is deducted from the quantity available to clear', () => {
  assert.equal(effectivePoQty({ orderedQty: 100, cancelledQty: 30 }), 70);
});

test('a fully cancelled po line has no clearable quantity', () => {
  assert.equal(effectivePoQty({ orderedQty: 100, cancelledQty: 100 }), 0);
});

test('cancelling more than was ordered floors at zero rather than going negative', () => {
  assert.equal(effectivePoQty({ orderedQty: 100, cancelledQty: 140 }), 0);
});

test('a missing cancelled quantity reads as nothing cancelled', () => {
  assert.equal(effectivePoQty({ orderedQty: 100 }), 100);
});

/* ── The ledger ─────────────────────────────────────────────────────────────────────────────── */

test('an untouched po line has its whole effective quantity available', () => {
  const ledger = ledgerFor(makeLine());
  assert.equal(ledger.availableQty, 100);
  assert.equal(ledger.approvedQty, 0);
  assert.equal(ledger.status, 'Not Cleared');
  assert.equal(ledger.clearedPct, 0);
});

test('approved clearance reduces the quantity available to a further mc', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 40, status: 'Approved' })],
    [makeHeader({ status: 'Approved' })],
  );
  assert.equal(ledger.approvedQty, 40);
  assert.equal(ledger.availableQty, 60);
  assert.equal(ledger.status, 'Partially Cleared');
  assert.equal(ledger.clearedPct, 40);
});

test('a submitted mc reserves its quantity so two buyers cannot claim the same balance', () => {
  const ledger = ledgerFor(makeLine(), [makeItem({ currentMcQty: 70 })], [makeHeader()]);
  assert.equal(ledger.reservedQty, 70);
  assert.equal(ledger.approvedQty, 0);
  assert.equal(ledger.availableQty, 30);
});

test('a draft mc holds no quantity, because an abandoned draft would block the line forever', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 70 })],
    [makeHeader({ status: 'Draft' })],
  );
  assert.equal(ledger.draftQty, 70);
  assert.equal(ledger.reservedQty, 0);
  assert.equal(ledger.availableQty, 100);
});

test('draft quantity is reported separately so a screen can warn before the submission fails', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 80 })],
    [makeHeader({ status: 'Draft' })],
  );
  assert.equal(ledger.availableQty, 100);
  assert.equal(ledger.availableAfterDraftsQty, 20);
});

test('rejecting an mc releases the quantity it was holding', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 70 })],
    [makeHeader({ status: 'Rejected' })],
  );
  assert.equal(ledger.reservedQty, 0);
  assert.equal(ledger.availableQty, 100);
});

test('cancelling an mc releases the quantity it was holding', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 70 })],
    [makeHeader({ status: 'Cancelled' })],
  );
  assert.equal(ledger.availableQty, 100);
});

test('cancelling an mc voids even its already approved lines', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 70, status: 'Approved' })],
    [makeHeader({ status: 'Cancelled' })],
  );
  assert.equal(ledger.approvedQty, 0);
  assert.equal(ledger.availableQty, 100);
});

test('a rejected line releases its quantity while the rest of the mc stays live', () => {
  const ledger = ledgerFor(
    makeLine(),
    [
      makeItem({ id: 'mci-1', currentMcQty: 30, status: 'Approved' }),
      makeItem({ id: 'mci-2', currentMcQty: 50, status: 'Rejected' }),
    ],
    [makeHeader({ status: 'Partially Approved' })],
  );
  assert.equal(ledger.approvedQty, 30);
  assert.equal(ledger.availableQty, 70);
});

test('a returned line is still awaiting a decision, so it keeps holding its quantity', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 30, status: 'Returned' })],
    [makeHeader({ status: 'Partially Approved' })],
  );
  assert.equal(ledger.reservedQty, 30);
  assert.equal(ledger.availableQty, 70);
});

test('approved and reserved quantity are deducted together', () => {
  const ledger = ledgerFor(
    makeLine(),
    [
      makeItem({ id: 'mci-1', mcId: 'mc-1', currentMcQty: 40, status: 'Approved' }),
      makeItem({ id: 'mci-2', mcId: 'mc-2', currentMcQty: 25 }),
    ],
    [makeHeader({ id: 'mc-1', status: 'Approved' }), makeHeader({ id: 'mc-2' })],
  );
  assert.equal(ledger.approvedQty, 40);
  assert.equal(ledger.reservedQty, 25);
  assert.equal(ledger.availableQty, 35);
});

test('a line clears across a succession of mcs until the po quantity is reached', () => {
  const headers = [
    makeHeader({ id: 'mc-1', status: 'Approved' }),
    makeHeader({ id: 'mc-2', status: 'Approved' }),
    makeHeader({ id: 'mc-3', status: 'Approved' }),
  ];
  const items = [
    makeItem({ id: 'i1', mcId: 'mc-1', currentMcQty: 40, status: 'Approved' }),
    makeItem({ id: 'i2', mcId: 'mc-2', currentMcQty: 35, status: 'Approved' }),
    makeItem({ id: 'i3', mcId: 'mc-3', currentMcQty: 25, status: 'Approved' }),
  ];
  const ledger = ledgerFor(makeLine(), items, headers);
  assert.equal(ledger.approvedQty, 100);
  assert.equal(ledger.availableQty, 0);
  assert.equal(ledger.status, 'Fully Cleared');
  assert.equal(ledger.fullyCleared, true);
  assert.equal(canSelectPoLine(ledger), false);
});

test('an item whose mc header cannot be found is not counted, rather than guessed at', () => {
  const ledger = ledgerFor(makeLine(), [makeItem({ mcId: 'mc-missing', currentMcQty: 70 })], []);
  assert.equal(ledger.reservedQty, 0);
  assert.equal(ledger.availableQty, 100);
});

/* ── PO line identity ───────────────────────────────────────────────────────────────────────── */

test('the same material listed twice on one po keeps two independent balances', () => {
  const lineA = makeLine({ poLineId: 'pol-a', orderedQty: 100 });
  const lineB = makeLine({ poLineId: 'pol-b', orderedQty: 60 });
  const ledgers = buildPoLineLedgers(
    [lineA, lineB],
    [makeItem({ poLineId: 'pol-a', currentMcQty: 100, status: 'Approved' })],
    [makeHeader({ status: 'Approved' })],
  );

  const a = ledgers.get(poLineKey('po-1', 'pol-a'));
  const b = ledgers.get(poLineKey('po-1', 'pol-b'));
  assert.equal(a.fullyCleared, true);
  assert.equal(a.availableQty, 0);
  // The second line shares its description with the first and must not have been pooled with it.
  assert.equal(b.fullyCleared, false);
  assert.equal(b.availableQty, 60);
  assert.equal(b.approvedQty, 0);
});

test('clearance against one po does not touch the same material on another po', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ poId: 'po-2', poLineId: 'pol-a', currentMcQty: 90, status: 'Approved' })],
    [makeHeader({ status: 'Approved' })],
  );
  assert.equal(ledger.availableQty, 100);
});

test('a po line id survives being resolved from a record written before the field existed', () => {
  assert.equal(resolvePoLineId({ poLineId: 'pol-x' }, 3), 'pol-x');
  assert.equal(resolvePoLineId({}, 3), 'idx_3');
  assert.equal(resolvePoLineId({ poLineId: '   ' }, 0), 'idx_0');
});

test('stamping po line ids leaves existing ids untouched and fills only the gaps', () => {
  const stamped = ensurePoLineIds([
    { poLineId: 'pol-keep', description: 'A', unit: 'MT', qty: 1, rate: 1, amount: 1 },
    { description: 'B', unit: 'MT', qty: 1, rate: 1, amount: 1 },
  ]);
  assert.equal(stamped[0].poLineId, 'pol-keep');
  assert.ok(stamped[1].poLineId);
  assert.notEqual(stamped[1].poLineId, stamped[0].poLineId);
});

test('minted po line ids are distinct within the same millisecond', () => {
  const ids = new Set([newPoLineId(0), newPoLineId(1), newPoLineId(2), newPoLineId(3)]);
  assert.equal(ids.size, 4);
});

/* ── Editing an existing mc ─────────────────────────────────────────────────────────────────── */

test('an mc being edited sees the balance without its own held quantity', () => {
  const items = [
    makeItem({ id: 'i1', mcId: 'mc-1', currentMcQty: 40, status: 'Approved' }),
    makeItem({ id: 'i2', mcId: 'mc-2', currentMcQty: 30 }),
  ];
  const headers = [makeHeader({ id: 'mc-1', status: 'Approved' }), makeHeader({ id: 'mc-2' })];

  const asSeenByOthers = ledgerFor(makeLine(), items, headers);
  assert.equal(asSeenByOthers.availableQty, 30);

  const asSeenWhileEditingMc2 = ledgerFor(makeLine(), items, headers, { excludeMcId: 'mc-2' });
  assert.equal(asSeenWhileEditingMc2.availableQty, 60);
});

/* ── Quantity validation ────────────────────────────────────────────────────────────────────── */

test('a clearance quantity within the balance is accepted', () => {
  const ledger = ledgerFor(makeLine());
  assert.equal(validateMcItemQty(60, ledger).ok, true);
});

test('a clearance quantity equal to the whole remaining balance is accepted', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 50, status: 'Approved' })],
    [makeHeader({ status: 'Approved' })],
  );
  assert.equal(validateMcItemQty(50, ledger).ok, true);
});

test('exceeding the balance is refused with the maximum quantity named in the message', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 50, status: 'Approved' })],
    [makeHeader({ status: 'Approved' })],
  );
  const result = validateMcItemQty(60, ledger);
  assert.equal(result.ok, false);
  assert.equal(
    result.message,
    'MC quantity exceeds available PO balance. Maximum clearance quantity available: 50.',
  );
});

test('a zero or negative clearance quantity is refused', () => {
  const ledger = ledgerFor(makeLine());
  assert.equal(validateMcItemQty(0, ledger).ok, false);
  assert.equal(validateMcItemQty(-5, ledger).ok, false);
});

test('a fully cleared line refuses further quantity and says so in its own terms', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 100, status: 'Approved' })],
    [makeHeader({ status: 'Approved' })],
  );
  const result = validateMcItemQty(1, ledger);
  assert.equal(result.ok, false);
  assert.match(result.message, /already fully cleared/);
});

test('a reserved quantity blocks a second mc from claiming the same balance', () => {
  const ledger = ledgerFor(makeLine(), [makeItem({ currentMcQty: 100 })], [makeHeader()]);
  const result = validateMcItemQty(10, ledger);
  assert.equal(result.ok, false);
  assert.equal(
    result.message,
    'MC quantity exceeds available PO balance. Maximum clearance quantity available: 0.',
  );
});

/* ── Whole-mc validation ────────────────────────────────────────────────────────────────────── */

test('an mc with no lines cannot be submitted', () => {
  assert.equal(validateMcItems([], new Map()).length, 1);
});

test('two lines on one mc against the same po line are refused as a duplicate', () => {
  const line = makeLine();
  const ledgers = buildPoLineLedgers([line], [], []);
  const errors = validateMcItems(
    [
      makeItem({ id: 'i1', currentMcQty: 60 }),
      makeItem({ id: 'i2', currentMcQty: 60 }),
    ],
    ledgers,
  );
  // Each is valid alone against a 100 balance; together they exceed it.
  assert.equal(errors.length, 1);
  assert.equal(errors[0].itemId, 'i2');
  assert.match(errors[0].message, /twice/);
});

test('a line pointing at a po line that no longer exists is reported rather than ignored', () => {
  const errors = validateMcItems([makeItem({ poLineId: 'pol-gone' })], new Map());
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /no longer a line on that purchase order/);
});

test('every over-claiming line is reported, not just the first', () => {
  const lines = [
    makeLine({ poLineId: 'pol-a', orderedQty: 10 }),
    makeLine({ poLineId: 'pol-b', orderedQty: 10 }),
  ];
  const ledgers = buildPoLineLedgers(lines, [], []);
  const errors = validateMcItems(
    [
      makeItem({ id: 'i1', poLineId: 'pol-a', currentMcQty: 50 }),
      makeItem({ id: 'i2', poLineId: 'pol-b', currentMcQty: 50 }),
    ],
    ledgers,
  );
  assert.equal(errors.length, 2);
});

/* ── The mc item row ────────────────────────────────────────────────────────────────────────── */

test('an mc line shows po, previous, current, cumulative and balance quantity', () => {
  const items = [
    makeItem({ id: 'i1', mcId: 'mc-1', currentMcQty: 40, status: 'Approved' }),
    makeItem({ id: 'i2', mcId: 'mc-2', currentMcQty: 25 }),
  ];
  const headers = [makeHeader({ id: 'mc-1', status: 'Approved' }), makeHeader({ id: 'mc-2' })];
  const ledger = ledgerFor(makeLine(), items, headers, { excludeMcId: 'mc-2' });

  const view = buildMcItemView(items[1], ledger);
  assert.equal(view.poQty, 100);
  assert.equal(view.previousMcQty, 40);
  assert.equal(view.currentMcQty, 25);
  assert.equal(view.cumulativeMcQty, 65);
  assert.equal(view.balanceQty, 35);
});

test('the mc line balance is measured against the effective po quantity, not the ordered one', () => {
  const line = makeLine({ orderedQty: 100, cancelledQty: 20 });
  const item = makeItem({ currentMcQty: 30 });
  const view = buildMcItemView(item, ledgerFor(line, [], []));
  assert.equal(view.poQty, 80);
  assert.equal(view.balanceQty, 50);
});

/* ── Header status ──────────────────────────────────────────────────────────────────────────── */

test('an mc whose every line is approved is approved', () => {
  const items = [{ status: 'Approved' }, { status: 'Approved' }];
  assert.equal(deriveMcHeaderStatus(items, 'Submitted'), 'Approved');
});

test('an mc with some lines approved and some pending is partially approved', () => {
  const items = [{ status: 'Approved' }, { status: 'Pending' }];
  assert.equal(deriveMcHeaderStatus(items, 'Submitted'), 'Partially Approved');
});

test('an mc with a returned line alongside an approved one is partially approved', () => {
  const items = [{ status: 'Approved' }, { status: 'Returned' }];
  assert.equal(deriveMcHeaderStatus(items, 'Submitted'), 'Partially Approved');
});

test('an mc whose every line is rejected is rejected', () => {
  const items = [{ status: 'Rejected' }, { status: 'Rejected' }];
  assert.equal(deriveMcHeaderStatus(items, 'Submitted'), 'Rejected');
});

test('an mc still awaiting every decision stays submitted', () => {
  const items = [{ status: 'Pending' }, { status: 'Pending' }];
  assert.equal(deriveMcHeaderStatus(items, 'Submitted'), 'Submitted');
});

test('a draft mc keeps its status whatever its lines say', () => {
  assert.equal(deriveMcHeaderStatus([{ status: 'Approved' }], 'Draft'), 'Draft');
});

test('an mc cancelled as a whole is not revived by its line statuses', () => {
  assert.equal(deriveMcHeaderStatus([{ status: 'Approved' }], 'Cancelled'), 'Cancelled');
});

test('an mc whose every line has been cancelled is itself cancelled', () => {
  const items = [{ status: 'Cancelled' }, { status: 'Cancelled' }];
  assert.equal(deriveMcHeaderStatus(items, 'Submitted'), 'Cancelled');
});

test('a cancelled line is ignored when judging whether the rest of the mc is approved', () => {
  const items = [{ status: 'Approved' }, { status: 'Cancelled' }];
  assert.equal(deriveMcHeaderStatus(items, 'Submitted'), 'Approved');
});

/* ── PO amendment guard ─────────────────────────────────────────────────────────────────────── */

test('a po quantity may be revised up freely', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 60, status: 'Approved' })],
    [makeHeader({ status: 'Approved' })],
  );
  assert.equal(validatePoQtyRevision(150, ledger).ok, true);
});

test('a po quantity cannot be cut below what has already been cleared', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 60, status: 'Approved' })],
    [makeHeader({ status: 'Approved' })],
  );
  const result = validatePoQtyRevision(40, ledger);
  assert.equal(result.ok, false);
  assert.match(result.message, /cannot be reduced below the already approved/);
  assert.match(result.message, /60/);
});

test('a po quantity may be cut to exactly what has been cleared', () => {
  const ledger = ledgerFor(
    makeLine(),
    [makeItem({ currentMcQty: 60, status: 'Approved' })],
    [makeHeader({ status: 'Approved' })],
  );
  assert.equal(validatePoQtyRevision(60, ledger).ok, true);
});

test('a reserved but unapproved quantity does not block a po reduction', () => {
  // Reserved quantity has not been granted, so the amendment is allowed; the pending MC will
  // fail its own balance check when it comes up for approval.
  const ledger = ledgerFor(makeLine(), [makeItem({ currentMcQty: 60 })], [makeHeader()]);
  assert.equal(validatePoQtyRevision(20, ledger).ok, true);
});

test('a negative po quantity is refused', () => {
  assert.equal(validatePoQtyRevision(-1, ledgerFor(makeLine())).ok, false);
});

/* ── Amendment ──────────────────────────────────────────────────────────────────────────────── */

test('reducing an approved mc quantity releases the difference back to the po balance', () => {
  const items = [makeItem({ id: 'i1', currentMcQty: 60, status: 'Approved' })];
  const result = computeMcAmendment(items, { i1: 25 });
  assert.equal(result.amendments.length, 1);
  assert.equal(result.amendments[0].originalQty, 60);
  assert.equal(result.amendments[0].revisedQty, 25);
  assert.equal(result.amendments[0].releasedQty, 35);
  assert.equal(result.totalReleasedQty, 35);
  assert.equal(result.errors.length, 0);
});

test('an amendment cannot increase cleared quantity, which has to go through a new mc', () => {
  const items = [makeItem({ id: 'i1', currentMcQty: 60, status: 'Approved' })];
  const result = computeMcAmendment(items, { i1: 90 });
  assert.equal(result.amendments.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /Raise a new MC for the additional quantity/);
});

test('an amendment to zero cancels the line and releases all of it', () => {
  const items = [makeItem({ id: 'i1', currentMcQty: 60, status: 'Approved' })];
  const result = computeMcAmendment(items, { i1: 0 });
  assert.equal(result.amendments[0].releasedQty, 60);
});

test('lines left out of the amendment and lines revised to their own value are not amendments', () => {
  const items = [
    makeItem({ id: 'i1', currentMcQty: 60, status: 'Approved' }),
    makeItem({ id: 'i2', currentMcQty: 20, status: 'Approved' }),
  ];
  const result = computeMcAmendment(items, { i1: 60 });
  assert.equal(result.amendments.length, 0);
  assert.equal(result.totalReleasedQty, 0);
});

test('a negative revised quantity is refused', () => {
  const items = [makeItem({ id: 'i1', currentMcQty: 60, status: 'Approved' })];
  assert.equal(computeMcAmendment(items, { i1: -5 }).errors.length, 1);
});

/* ── Grouping ───────────────────────────────────────────────────────────────────────────────── */

const makeCandidate = (overrides = {}) => ({
  poId: 'po-1',
  poNumber: 'PO/2026/001',
  vendorId: 'v-1',
  globalProjectId: 'proj-1',
  ...overrides,
});

test('a single po line always satisfies the grouping rule', () => {
  assert.equal(validateMcGrouping([makeCandidate()]).length, 0);
});

test('several pos on one mc are allowed when they share the vendor and project', () => {
  const candidates = [makeCandidate({ poId: 'po-1' }), makeCandidate({ poId: 'po-2' })];
  assert.equal(validateMcGrouping(candidates).length, 0);
});

test('pos from two vendors cannot share one clearance', () => {
  const candidates = [makeCandidate(), makeCandidate({ poId: 'po-2', vendorId: 'v-2' })];
  const errors = validateMcGrouping(candidates);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /one vendor/);
});

test('pos from two projects cannot share one clearance', () => {
  const candidates = [makeCandidate(), makeCandidate({ poId: 'po-2', globalProjectId: 'proj-2' })];
  const errors = validateMcGrouping(candidates);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /different projects/);
});

test('mixing packages on one mc is allowed by default and refused once the rule is switched on', () => {
  const candidates = [
    makeCandidate({ packageId: 'pkg-1' }),
    makeCandidate({ poId: 'po-2', packageId: 'pkg-2' }),
  ];
  assert.equal(validateMcGrouping(candidates, DEFAULT_MC_GROUPING_RULE).length, 0);
  const errors = validateMcGrouping(candidates, { ...DEFAULT_MC_GROUPING_RULE, samePackage: true });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /different packages/);
});

/* ── Register ───────────────────────────────────────────────────────────────────────────────── */

test('a register row counts the pos and lines an mc covers and totals its quantity', () => {
  const rows = buildMcRegisterRows(
    [makeHeader()],
    [
      makeItem({ id: 'i1', poId: 'po-1', poLineId: 'pol-a', currentMcQty: 40 }),
      makeItem({ id: 'i2', poId: 'po-1', poLineId: 'pol-b', currentMcQty: 10 }),
      makeItem({ id: 'i3', poId: 'po-2', poLineId: 'pol-c', currentMcQty: 25 }),
    ],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].poCount, 2);
  assert.equal(rows[0].itemCount, 3);
  assert.equal(rows[0].currentMcQty, 75);
});

test('a cancelled line is left out of the register counts and totals', () => {
  const rows = buildMcRegisterRows(
    [makeHeader()],
    [
      makeItem({ id: 'i1', currentMcQty: 40 }),
      makeItem({ id: 'i2', poId: 'po-2', currentMcQty: 25, status: 'Cancelled' }),
    ],
  );
  assert.equal(rows[0].poCount, 1);
  assert.equal(rows[0].itemCount, 1);
  assert.equal(rows[0].currentMcQty, 40);
});

test('an mc with no lines yet still produces a register row', () => {
  const rows = buildMcRegisterRows([makeHeader()], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemCount, 0);
  assert.equal(rows[0].currentMcQty, 0);
});

/* ── Tolerant reads and rounding ────────────────────────────────────────────────────────────── */

test('quantities arriving from firestore as strings are read rather than rejected', () => {
  const ledger = buildPoLineLedger(
    makeLine({ orderedQty: '100', cancelledQty: '10' }),
    [makeItem({ currentMcQty: '30', status: 'Approved' })],
    new Map([['mc-1', { status: 'Approved' }]]),
  );
  assert.equal(ledger.effectiveQty, 90);
  assert.equal(ledger.approvedQty, 30);
  assert.equal(ledger.availableQty, 60);
});

test('an unreadable quantity counts as nothing rather than poisoning the ledger with NaN', () => {
  const ledger = buildPoLineLedger(
    makeLine(),
    [makeItem({ currentMcQty: 'n/a', status: 'Approved' })],
    new Map([['mc-1', { status: 'Approved' }]]),
  );
  assert.equal(ledger.approvedQty, 0);
  assert.equal(ledger.availableQty, 100);
});

test('fractional clearances that sum to the po quantity close the line exactly', () => {
  const headers = [
    makeHeader({ id: 'mc-1', status: 'Approved' }),
    makeHeader({ id: 'mc-2', status: 'Approved' }),
    makeHeader({ id: 'mc-3', status: 'Approved' }),
  ];
  const items = [
    makeItem({ id: 'i1', mcId: 'mc-1', currentMcQty: 33.333, status: 'Approved' }),
    makeItem({ id: 'i2', mcId: 'mc-2', currentMcQty: 33.333, status: 'Approved' }),
    makeItem({ id: 'i3', mcId: 'mc-3', currentMcQty: 33.334, status: 'Approved' }),
  ];
  const ledger = ledgerFor(makeLine(), items, headers);
  assert.equal(ledger.approvedQty, 100);
  assert.equal(ledger.fullyCleared, true);
  assert.equal(ledger.availableQty, 0);
});
