import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPLY_LEDGER_STAGES,
  SUPPLY_STAGE_DEFINITIONS,
  buildSupplyItemView,
  buildSupplyLedger,
  buildSupplyLedgers,
  buildSupplyRegisterRows,
  canPresentPoLine,
  canReleaseBillingForItem,
  checkSupplyBalance,
  deriveSupplyDocStatus,
  generateSupplyDocNumber,
  rebuildSupplyPoLineBalance,
  resolveUpstreamQty,
  supplyItemStatusFor,
  supplyPoLineKey,
  supplyRejectedQtyOf,
  supplyStage,
  validatePresentedQty,
  validateSupplyDecision,
  validateSupplyItems,
} from '../src/lib/project-management-supply-ledger.ts';

/* ── Fixtures ───────────────────────────────────────────────────────────────────────────────── */

const makeLine = (overrides = {}) => ({
  poId: 'po-1',
  poNumber: 'PO/2026/001',
  poLineId: 'pol-a',
  itemDescription: 'Tower Structure',
  unit: 'MT',
  orderedQty: 100,
  upstreamQty: 60,
  ...overrides,
});

const makeDoc = (overrides = {}) => ({
  id: 'doc-1',
  stage: 'mdcc',
  docNumber: 'MDCC/2026/001',
  globalProjectId: 'proj-1',
  docDate: '2026-06-10',
  status: 'Open',
  revision: 0,
  ...overrides,
});

const makeItem = (overrides = {}) => ({
  id: 'di-1',
  docId: 'doc-1',
  stage: 'mdcc',
  poId: 'po-1',
  poNumber: 'PO/2026/001',
  poLineId: 'pol-a',
  itemDescription: 'Tower Structure',
  unit: 'MT',
  presentedQty: 40,
  status: 'Pending',
  ...overrides,
});

const observation = (overrides = {}) => ({
  punchId: 'o-1',
  description: 'Nameplate detail mismatch',
  severity: 'Major',
  closed: false,
  ...overrides,
});

const ledgerFor = (stage, line, items = [], docs = [], options = {}) =>
  buildSupplyLedgers(stage, [line], items, docs, options).get(
    supplyPoLineKey(line.poId, line.poLineId),
  );

/* ── Stage definitions ──────────────────────────────────────────────────────────────────────── */

test('every stage is defined and each names a distinct set of collections', () => {
  const headers = new Set();
  const items = new Set();
  const balances = new Set();
  for (const stage of SUPPLY_LEDGER_STAGES) {
    const definition = supplyStage(stage);
    assert.equal(definition.stage, stage);
    headers.add(definition.headerCollection);
    items.add(definition.itemCollection);
    balances.add(definition.balanceCollection);
  }
  assert.equal(headers.size, SUPPLY_LEDGER_STAGES.length);
  assert.equal(items.size, SUPPLY_LEDGER_STAGES.length);
  assert.equal(balances.size, SUPPLY_LEDGER_STAGES.length);
});

test('the stages chain in supply order, each taking its ceiling from the one before', () => {
  assert.equal(SUPPLY_STAGE_DEFINITIONS.mdcc.upstream, 'inspection');
  assert.equal(SUPPLY_STAGE_DEFINITIONS.di.upstream, 'mdcc');
  assert.equal(SUPPLY_STAGE_DEFINITIONS.grn.upstream, 'di');
  assert.equal(SUPPLY_STAGE_DEFINITIONS.mvac.upstream, 'grn');
});

test('a document number carries its stage prefix and the date', () => {
  assert.equal(generateSupplyDocNumber('grn', '2026-06-10', 'abcdefgh'), 'GRN-20260610-ABCDE');
  assert.equal(generateSupplyDocNumber('mvac', '2026-06-10', 'abcdefgh'), 'MVAC-20260610-ABCDE');
});

/* ── The ceiling chain ──────────────────────────────────────────────────────────────────────── */

test('each stage draws its ceiling from its own upstream stage', () => {
  const qtys = { mc: 100, inspection: 80, mdcc: 70, di: 60, grn: 50 };
  assert.equal(resolveUpstreamQty('mdcc', qtys), 80);
  assert.equal(resolveUpstreamQty('di', qtys), 70);
  assert.equal(resolveUpstreamQty('grn', qtys), 60);
  assert.equal(resolveUpstreamQty('mvac', qtys), 50);
});

test('a direct-path line dispatches off cleared po quantity, skipping inspection and mdcc', () => {
  // A box of bolts: nothing inspected, no client certificate, but 100 cleared to manufacture.
  const qtys = { mc: 100, inspection: 0, mdcc: 0 };
  assert.equal(resolveUpstreamQty('di', qtys, { directPath: true }), 100);
  assert.equal(resolveUpstreamQty('di', qtys, { directPath: false }), 0);
});

test('only the dispatch stage has a direct path; the others ignore the flag', () => {
  const qtys = { mc: 100, inspection: 0, di: 0, grn: 0 };
  assert.equal(resolveUpstreamQty('mdcc', qtys, { directPath: true }), 0);
  assert.equal(resolveUpstreamQty('mvac', qtys, { directPath: true }), 0);
});

test('a missing upstream quantity reads as nothing passed down', () => {
  assert.equal(resolveUpstreamQty('grn', {}), 0);
});

/* ── The ledger ─────────────────────────────────────────────────────────────────────────────── */

test('an untouched line has its whole upstream quantity available', () => {
  const ledger = ledgerFor('mdcc', makeLine());
  assert.equal(ledger.upstreamQty, 60);
  assert.equal(ledger.availableQty, 60);
  assert.equal(ledger.status, 'Not Started');
});

test('a line with nothing passed down is awaiting its upstream stage', () => {
  const ledger = ledgerFor('mdcc', makeLine({ upstreamQty: 0 }));
  assert.equal(ledger.awaitingUpstream, true);
  assert.equal(canPresentPoLine(ledger), false);
});

test('an open document reserves the quantity it presented', () => {
  const ledger = ledgerFor('mdcc', makeLine(), [makeItem({ presentedQty: 40 })], [makeDoc()]);
  assert.equal(ledger.inFlightQty, 40);
  assert.equal(ledger.availableQty, 20);
});

test('a draft document holds nothing but is reported so a screen can warn', () => {
  const ledger = ledgerFor(
    'mdcc',
    makeLine(),
    [makeItem({ presentedQty: 50 })],
    [makeDoc({ status: 'Draft' })],
  );
  assert.equal(ledger.draftQty, 50);
  assert.equal(ledger.availableQty, 60);
  assert.equal(ledger.availableAfterDraftsQty, 10);
});

test('cancelling a document releases its quantity, including already accepted lines', () => {
  const ledger = ledgerFor(
    'mdcc',
    makeLine(),
    [makeItem({ presentedQty: 40, acceptedQty: 40, status: 'Accepted' })],
    [makeDoc({ status: 'Cancelled' })],
  );
  assert.equal(ledger.acceptedQty, 0);
  assert.equal(ledger.availableQty, 60);
});

test('accepted quantity consumes the ceiling and is what flows downstream', () => {
  const ledger = ledgerFor(
    'mdcc',
    makeLine(),
    [makeItem({ presentedQty: 40, acceptedQty: 40, status: 'Accepted' })],
    [makeDoc({ status: 'Completed' })],
  );
  assert.equal(ledger.acceptedQty, 40);
  assert.equal(ledger.availableQty, 20);
  assert.equal(ledger.status, 'Partial');
  assert.equal(ledger.acceptedPct, 67);
});

test('rejected quantity returns to the balance so it can be re-presented once fixed', () => {
  const ledger = ledgerFor(
    'mdcc',
    makeLine(),
    [makeItem({ presentedQty: 40, acceptedQty: 25, status: 'Accepted' })],
    [makeDoc({ status: 'Completed' })],
  );
  assert.equal(ledger.acceptedQty, 25);
  assert.equal(ledger.rejectedQty, 15);
  // 60 ceiling − 25 accepted = 35, which includes the 15 rejected.
  assert.equal(ledger.availableQty, 35);
});

test('a wholly rejected document returns everything it presented', () => {
  const ledger = ledgerFor(
    'mdcc',
    makeLine(),
    [makeItem({ presentedQty: 40, acceptedQty: 0, status: 'Rejected' })],
    [makeDoc({ status: 'Completed' })],
  );
  assert.equal(ledger.rejectedQty, 40);
  assert.equal(ledger.availableQty, 60);
  assert.equal(ledger.status, 'Not Started');
});

test('a line completes once accepted quantity reaches the upstream quantity', () => {
  const ledger = ledgerFor(
    'mdcc',
    makeLine({ upstreamQty: 60 }),
    [makeItem({ presentedQty: 60, acceptedQty: 60, status: 'Accepted' })],
    [makeDoc({ status: 'Completed' })],
  );
  assert.equal(ledger.complete, true);
  assert.equal(ledger.status, 'Complete');
  assert.equal(canPresentPoLine(ledger), false);
});

test('more upstream quantity reopens a line that had completed against the old ceiling', () => {
  const items = [makeItem({ presentedQty: 60, acceptedQty: 60, status: 'Accepted' })];
  const docs = [makeDoc({ status: 'Completed' })];
  assert.equal(ledgerFor('mdcc', makeLine({ upstreamQty: 60 }), items, docs).complete, true);
  const after = ledgerFor('mdcc', makeLine({ upstreamQty: 100 }), items, docs);
  assert.equal(after.complete, false);
  assert.equal(after.availableQty, 40);
});

test('items belonging to another stage are ignored even on the same po line', () => {
  const ledger = ledgerFor(
    'mdcc',
    makeLine(),
    [makeItem({ stage: 'grn', presentedQty: 60, acceptedQty: 60, status: 'Accepted' })],
    [makeDoc({ status: 'Completed' })],
  );
  assert.equal(ledger.acceptedQty, 0);
  assert.equal(ledger.availableQty, 60);
});

test('an item whose document cannot be found is not counted', () => {
  const ledger = ledgerFor('mdcc', makeLine(), [makeItem({ docId: 'gone' })], []);
  assert.equal(ledger.inFlightQty, 0);
  assert.equal(ledger.availableQty, 60);
});

test('a pending item has no rejected quantity yet', () => {
  assert.equal(supplyRejectedQtyOf({ presentedQty: 40, status: 'Pending' }), 0);
});

/* ── PO line identity ───────────────────────────────────────────────────────────────────────── */

test('the same material listed twice on one po keeps two independent balances at every stage', () => {
  for (const stage of SUPPLY_LEDGER_STAGES) {
    const lineA = makeLine({ poLineId: 'pol-a', upstreamQty: 60 });
    const lineB = makeLine({ poLineId: 'pol-b', upstreamQty: 25 });
    const ledgers = buildSupplyLedgers(
      stage,
      [lineA, lineB],
      [makeItem({ stage, poLineId: 'pol-a', presentedQty: 60, acceptedQty: 60, status: 'Accepted' })],
      [makeDoc({ stage, status: 'Completed' })],
    );
    assert.equal(ledgers.get(supplyPoLineKey('po-1', 'pol-a')).complete, true, stage);
    assert.equal(ledgers.get(supplyPoLineKey('po-1', 'pol-b')).availableQty, 25, stage);
  }
});

test('a document against one po does not touch the same material on another po', () => {
  const ledger = ledgerFor(
    'grn',
    makeLine(),
    [makeItem({ stage: 'grn', poId: 'po-2', presentedQty: 60, acceptedQty: 60, status: 'Accepted' })],
    [makeDoc({ stage: 'grn', status: 'Completed' })],
  );
  assert.equal(ledger.availableQty, 60);
});

/* ── Editing an existing document ───────────────────────────────────────────────────────────── */

test('a document being edited sees the balance without its own held quantity', () => {
  const items = [
    makeItem({ id: 'i1', docId: 'doc-1', presentedQty: 20, acceptedQty: 20, status: 'Accepted' }),
    makeItem({ id: 'i2', docId: 'doc-2', presentedQty: 15 }),
  ];
  const docs = [makeDoc({ id: 'doc-1', status: 'Completed' }), makeDoc({ id: 'doc-2' })];
  assert.equal(ledgerFor('mdcc', makeLine(), items, docs).availableQty, 25);
  assert.equal(
    ledgerFor('mdcc', makeLine(), items, docs, { excludeDocId: 'doc-2' }).availableQty,
    40,
  );
});

/* ── Presenting ─────────────────────────────────────────────────────────────────────────────── */

test('presenting within the balance is accepted', () => {
  assert.equal(validatePresentedQty('mdcc', 60, ledgerFor('mdcc', makeLine())).ok, true);
});

test('presenting more than the balance is refused with the maximum named', () => {
  const ledger = ledgerFor('grn', makeLine({ upstreamQty: 40 }));
  const result = validatePresentedQty('grn', 70, ledger);
  assert.equal(result.ok, false);
  assert.equal(
    result.message,
    'Received quantity exceeds the available balance. Maximum quantity available: 40.',
  );
});

test('the refusal names the stage the quantity should have come from', () => {
  const ledger = ledgerFor('mvac', makeLine({ upstreamQty: 0 }));
  const result = validatePresentedQty('mvac', 10, ledger);
  assert.equal(result.ok, false);
  assert.match(result.message, /has no GRN quantity yet/);
});

test('a direct-path dispatch refusal points at manufacturing clearance, not mdcc', () => {
  const ledger = ledgerFor('di', makeLine({ upstreamQty: 0 }));
  const result = validatePresentedQty('di', 10, ledger, { directPath: true });
  assert.equal(result.ok, false);
  assert.match(result.message, /no Manufacturing Clearance quantity yet/);
});

test('a gated dispatch refusal points at mdcc', () => {
  const ledger = ledgerFor('di', makeLine({ upstreamQty: 0 }));
  const result = validatePresentedQty('di', 10, ledger, { directPath: false });
  assert.equal(result.ok, false);
  assert.match(result.message, /no MDCC quantity yet/);
});

test('a zero or negative presented quantity is refused', () => {
  const ledger = ledgerFor('mdcc', makeLine());
  assert.equal(validatePresentedQty('mdcc', 0, ledger).ok, false);
  assert.equal(validatePresentedQty('mdcc', -5, ledger).ok, false);
});

test('a completed line refuses further documents in its own terms', () => {
  const ledger = ledgerFor(
    'mdcc',
    makeLine({ upstreamQty: 60 }),
    [makeItem({ presentedQty: 60, acceptedQty: 60, status: 'Accepted' })],
    [makeDoc({ status: 'Completed' })],
  );
  const result = validatePresentedQty('mdcc', 1, ledger);
  assert.equal(result.ok, false);
  assert.match(result.message, /already complete for its whole 60 MT/);
});

/* ── Whole-document validation ──────────────────────────────────────────────────────────────── */

test('a document with no lines cannot be raised', () => {
  const errors = validateSupplyItems('grn', [], new Map());
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /goods receipt/);
});

test('two lines on one document against the same po line are refused as a duplicate', () => {
  const ledgers = buildSupplyLedgers('mdcc', [makeLine()], [], []);
  const errors = validateSupplyItems(
    'mdcc',
    [makeItem({ id: 'i1', presentedQty: 30 }), makeItem({ id: 'i2', presentedQty: 30 })],
    ledgers,
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].itemId, 'i2');
  assert.match(errors[0].message, /twice/);
});

test('a line pointing at a po line that no longer exists is reported', () => {
  const errors = validateSupplyItems('mdcc', [makeItem({ poLineId: 'gone' })], new Map());
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /no longer a line on that purchase order/);
});

test('every over-presenting line is reported, not just the first', () => {
  const lines = [
    makeLine({ poLineId: 'pol-a', upstreamQty: 10 }),
    makeLine({ poLineId: 'pol-b', upstreamQty: 10 }),
  ];
  const ledgers = buildSupplyLedgers('mdcc', lines, [], []);
  const errors = validateSupplyItems(
    'mdcc',
    [
      makeItem({ id: 'i1', poLineId: 'pol-a', presentedQty: 50 }),
      makeItem({ id: 'i2', poLineId: 'pol-b', presentedQty: 50 }),
    ],
    ledgers,
  );
  assert.equal(errors.length, 2);
});

/* ── Decisions ──────────────────────────────────────────────────────────────────────────────── */

test('accepting the whole presented quantity is valid at every stage', () => {
  for (const stage of SUPPLY_LEDGER_STAGES) {
    assert.equal(validateSupplyDecision(stage, 40, 40).ok, true, stage);
  }
});

test('a splitting stage may accept part of what was presented', () => {
  assert.equal(validateSupplyDecision('grn', 40, 30).ok, true);
  assert.equal(validateSupplyDecision('mvac', 40, 30).ok, true);
  assert.equal(validateSupplyDecision('mdcc', 40, 30).ok, true);
});

test('a dispatch instruction is accepted in full or not at all, never partly', () => {
  const result = validateSupplyDecision('di', 40, 30);
  assert.equal(result.ok, false);
  assert.match(result.message, /accepted in full or not at all/);
});

test('a dispatch instruction cannot be dispatched as nothing; it is cancelled instead', () => {
  // Zero would be a full rejection, which the ledger can represent — but the all-or-nothing rule
  // refuses it here, because an instruction nobody acted on should be cancelled (which releases
  // the quantity) rather than recorded as a dispatch of zero.
  const result = validateSupplyDecision('di', 40, 0);
  assert.equal(result.ok, false);
  assert.match(result.message, /accepted in full or not at all/);
});

test('no stage may accept more than was presented', () => {
  for (const stage of SUPPLY_LEDGER_STAGES) {
    const result = validateSupplyDecision(stage, 40, 55);
    assert.equal(result.ok, false, stage);
    assert.match(result.message, /cannot exceed the 40/);
  }
});

test('a negative accepted quantity is refused', () => {
  assert.equal(validateSupplyDecision('grn', 40, -1).ok, false);
});

test('the item status follows the accepted quantity rather than being chosen', () => {
  assert.equal(supplyItemStatusFor(40), 'Accepted');
  assert.equal(supplyItemStatusFor(0), 'Rejected');
});

/* ── Document status ────────────────────────────────────────────────────────────────────────── */

test('a document with every line still awaiting a decision stays open', () => {
  assert.equal(deriveSupplyDocStatus([{ status: 'Pending' }, { status: 'Pending' }], 'Open'), 'Open');
});

test('a document with some lines decided is partially completed', () => {
  assert.equal(
    deriveSupplyDocStatus([{ status: 'Accepted' }, { status: 'Pending' }], 'Open'),
    'Partially Completed',
  );
});

test('a document whose every line has a decision is completed, accepted or rejected', () => {
  assert.equal(
    deriveSupplyDocStatus([{ status: 'Accepted' }, { status: 'Rejected' }], 'Open'),
    'Completed',
  );
});

test('a draft document keeps its status whatever its lines say', () => {
  assert.equal(deriveSupplyDocStatus([{ status: 'Accepted' }], 'Draft'), 'Draft');
});

test('a cancelled document is not revived by its line statuses', () => {
  assert.equal(deriveSupplyDocStatus([{ status: 'Accepted' }], 'Cancelled'), 'Cancelled');
});

test('a document whose every line has been cancelled is itself cancelled', () => {
  assert.equal(
    deriveSupplyDocStatus([{ status: 'Cancelled' }, { status: 'Cancelled' }], 'Open'),
    'Cancelled',
  );
});

test('a cancelled line is ignored when judging whether the rest is complete', () => {
  assert.equal(
    deriveSupplyDocStatus([{ status: 'Accepted' }, { status: 'Cancelled' }], 'Open'),
    'Completed',
  );
});

/* ── The document item row ──────────────────────────────────────────────────────────────────── */

test('a document line shows ceiling, previously accepted, presented, accepted and balance', () => {
  const items = [
    makeItem({ id: 'i1', docId: 'doc-1', presentedQty: 20, acceptedQty: 20, status: 'Accepted' }),
    makeItem({ id: 'i2', docId: 'doc-2', presentedQty: 30, acceptedQty: 25, status: 'Accepted' }),
  ];
  const docs = [
    makeDoc({ id: 'doc-1', status: 'Completed' }),
    makeDoc({ id: 'doc-2', status: 'Completed' }),
  ];
  const ledger = ledgerFor('mdcc', makeLine(), items, docs, { excludeDocId: 'doc-2' });

  const view = buildSupplyItemView(items[1], ledger);
  assert.equal(view.upstreamQty, 60);
  assert.equal(view.previouslyAcceptedQty, 20);
  assert.equal(view.presentedQty, 30);
  assert.equal(view.acceptedQty, 25);
  assert.equal(view.rejectedQty, 5);
  assert.equal(view.cumulativeAcceptedQty, 45);
  assert.equal(view.balanceQty, 15);
});

/* ── Observations and billing release ───────────────────────────────────────────────────────── */

test('a clean accepted mvac line may release billing', () => {
  assert.equal(
    canReleaseBillingForItem({ stage: 'mvac', status: 'Accepted', acceptedQty: 40 }),
    true,
  );
});

test('an open major observation blocks billing release even though the quantity was accepted', () => {
  assert.equal(
    canReleaseBillingForItem({
      stage: 'mvac',
      status: 'Accepted',
      acceptedQty: 40,
      observations: [observation()],
    }),
    false,
  );
});

test('a minor observation does not block billing release', () => {
  assert.equal(
    canReleaseBillingForItem({
      stage: 'mvac',
      status: 'Accepted',
      acceptedQty: 40,
      observations: [observation({ severity: 'Minor' })],
    }),
    true,
  );
});

test('closing the blocking observation releases billing', () => {
  assert.equal(
    canReleaseBillingForItem({
      stage: 'mvac',
      status: 'Accepted',
      acceptedQty: 40,
      observations: [observation({ closed: true })],
    }),
    true,
  );
});

test('an accepted line with no quantity cannot release billing', () => {
  assert.equal(
    canReleaseBillingForItem({ stage: 'mvac', status: 'Accepted', acceptedQty: 0 }),
    false,
  );
});

test('only mvac releases billing; an accepted grn line does not', () => {
  assert.equal(
    canReleaseBillingForItem({ stage: 'grn', status: 'Accepted', acceptedQty: 40 }),
    false,
  );
});

test('the ledger counts lines whose open observations block release', () => {
  const ledger = ledgerFor(
    'mvac',
    makeLine(),
    [
      makeItem({
        stage: 'mvac',
        presentedQty: 40,
        acceptedQty: 40,
        status: 'Accepted',
        observations: [observation()],
      }),
    ],
    [makeDoc({ stage: 'mvac', status: 'Completed' })],
  );
  assert.equal(ledger.blockingObservationCount, 1);
});

/* ── Concurrency guard ──────────────────────────────────────────────────────────────────────── */

test('the first document against a line sees the whole upstream quantity free', () => {
  assert.equal(checkSupplyBalance('mdcc', 60, 60, null).ok, true);
});

test('the guard refuses a document that no longer fits, naming what is left', () => {
  const result = checkSupplyBalance('grn', 20, 60, { acceptedQty: 20, inFlightQty: 30 });
  assert.equal(result.ok, false);
  assert.equal(
    result.message,
    'Received quantity exceeds the available balance. Maximum quantity available: 10.',
  );
});

test('the guard refuses any document once nothing is passed down', () => {
  const result = checkSupplyBalance('mvac', 5, 0, null);
  assert.equal(result.ok, false);
  assert.match(result.message, /No GRN quantity remains/);
});

test('a guard document rebuilds exactly from the ledger it came from', () => {
  const ledger = ledgerFor(
    'mdcc',
    makeLine(),
    [makeItem({ presentedQty: 40, acceptedQty: 30, status: 'Accepted' })],
    [makeDoc({ status: 'Completed' })],
  );
  assert.deepEqual(rebuildSupplyPoLineBalance(ledger), {
    poId: 'po-1',
    poLineId: 'pol-a',
    poNumber: 'PO/2026/001',
    upstreamQty: 60,
    acceptedQty: 30,
    inFlightQty: 0,
  });
});

/* ── Register ───────────────────────────────────────────────────────────────────────────────── */

test('a register row counts the pos and lines a document covers and totals its quantities', () => {
  const rows = buildSupplyRegisterRows(
    [makeDoc({ stage: 'grn', status: 'Completed' })],
    [
      makeItem({ id: 'i1', stage: 'grn', poId: 'po-1', poLineId: 'pol-a', presentedQty: 40, acceptedQty: 35, status: 'Accepted' }),
      makeItem({ id: 'i2', stage: 'grn', poId: 'po-2', poLineId: 'pol-b', presentedQty: 10, acceptedQty: 10, status: 'Accepted' }),
    ],
  );
  assert.equal(rows[0].poCount, 2);
  assert.equal(rows[0].itemCount, 2);
  assert.equal(rows[0].presentedQty, 50);
  assert.equal(rows[0].acceptedQty, 45);
  assert.equal(rows[0].rejectedQty, 5);
});

test('a cancelled line is left out of the register counts and totals', () => {
  const rows = buildSupplyRegisterRows(
    [makeDoc()],
    [
      makeItem({ id: 'i1', presentedQty: 40 }),
      makeItem({ id: 'i2', poId: 'po-2', presentedQty: 10, status: 'Cancelled' }),
    ],
  );
  assert.equal(rows[0].poCount, 1);
  assert.equal(rows[0].presentedQty, 40);
});

test('a document with no lines yet still produces a register row', () => {
  const rows = buildSupplyRegisterRows([makeDoc()], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemCount, 0);
});

/* ── Tolerant reads and rounding ────────────────────────────────────────────────────────────── */

test('quantities arriving from firestore as strings are read rather than rejected', () => {
  const ledger = buildSupplyLedger(
    'mdcc',
    makeLine({ upstreamQty: '60' }),
    [makeItem({ presentedQty: '40', acceptedQty: '30', status: 'Accepted' })],
    new Map([['doc-1', { status: 'Completed' }]]),
  );
  assert.equal(ledger.upstreamQty, 60);
  assert.equal(ledger.acceptedQty, 30);
  assert.equal(ledger.availableQty, 30);
});

test('an unreadable quantity counts as nothing rather than poisoning the ledger with NaN', () => {
  const ledger = buildSupplyLedger(
    'mdcc',
    makeLine(),
    [makeItem({ presentedQty: 'n/a' })],
    new Map([['doc-1', { status: 'Open' }]]),
  );
  assert.equal(ledger.inFlightQty, 0);
  assert.equal(ledger.availableQty, 60);
});

test('fractional acceptances that sum to the ceiling close the line exactly', () => {
  const docs = [
    makeDoc({ id: 'd1', status: 'Completed' }),
    makeDoc({ id: 'd2', status: 'Completed' }),
    makeDoc({ id: 'd3', status: 'Completed' }),
  ];
  const items = [
    makeItem({ id: 'i1', docId: 'd1', presentedQty: 20, acceptedQty: 19.999, status: 'Accepted' }),
    makeItem({ id: 'i2', docId: 'd2', presentedQty: 20, acceptedQty: 20, status: 'Accepted' }),
    makeItem({ id: 'i3', docId: 'd3', presentedQty: 20.001, acceptedQty: 20.001, status: 'Accepted' }),
  ];
  const ledger = ledgerFor('mdcc', makeLine({ upstreamQty: 60 }), items, docs);
  assert.equal(ledger.acceptedQty, 60);
  assert.equal(ledger.complete, true);
  assert.equal(ledger.availableQty, 0);
});

/* ── The chain end to end ───────────────────────────────────────────────────────────────────── */

test('quantity cannot be invented as it moves down the chain', () => {
  // 100 ordered, 60 cleared to manufacture, 50 inspected and accepted.
  let upstream = { mc: 60, inspection: 50 };

  // MDCC may present at most the 50 that passed inspection, and the client clears 45.
  const mdcc = ledgerFor(
    'mdcc',
    makeLine({ upstreamQty: resolveUpstreamQty('mdcc', upstream) }),
    [makeItem({ stage: 'mdcc', presentedQty: 50, acceptedQty: 45, status: 'Accepted' })],
    [makeDoc({ stage: 'mdcc', status: 'Completed' })],
  );
  assert.equal(mdcc.upstreamQty, 50);
  assert.equal(mdcc.acceptedQty, 45);
  assert.equal(validatePresentedQty('mdcc', 60, ledgerFor('mdcc', makeLine({ upstreamQty: 50 }))).ok, false);

  // DI may present at most the 45 the client cleared.
  upstream = { ...upstream, mdcc: mdcc.acceptedQty };
  const di = ledgerFor(
    'di',
    makeLine({ upstreamQty: resolveUpstreamQty('di', upstream) }),
    [makeItem({ stage: 'di', presentedQty: 45, acceptedQty: 45, status: 'Accepted' })],
    [makeDoc({ stage: 'di', status: 'Completed' })],
  );
  assert.equal(di.upstreamQty, 45);

  // GRN may receive at most the 45 dispatched; site accepts 42 and rejects 3.
  upstream = { ...upstream, di: di.acceptedQty };
  const grn = ledgerFor(
    'grn',
    makeLine({ upstreamQty: resolveUpstreamQty('grn', upstream) }),
    [makeItem({ stage: 'grn', presentedQty: 45, acceptedQty: 42, status: 'Accepted' })],
    [makeDoc({ stage: 'grn', status: 'Completed' })],
  );
  assert.equal(grn.upstreamQty, 45);
  assert.equal(grn.acceptedQty, 42);
  assert.equal(grn.rejectedQty, 3);

  // MVAC — the billing trigger — may accept at most the 42 site accepted.
  upstream = { ...upstream, grn: grn.acceptedQty };
  const mvac = ledgerFor('mvac', makeLine({ upstreamQty: resolveUpstreamQty('mvac', upstream) }));
  assert.equal(mvac.upstreamQty, 42);
  // Billing can never be raised for the 100 ordered, nor the 60 cleared, nor the 45 dispatched.
  assert.equal(validatePresentedQty('mvac', 45, mvac).ok, false);
  assert.equal(validatePresentedQty('mvac', 42, mvac).ok, true);
});
