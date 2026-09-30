import test from 'node:test';
import assert from 'node:assert/strict';

const {
  countsTowardBudget,
  summariseAllocations,
  effectiveMonthlyBudget,
  canVerifyAllocation,
  canRejectAllocation,
  canAmendAllocation,
  validateAllocationDraft,
  periodDistance,
  sortAllocations,
  allocationsFor,
  ALLOCATION_STATUS_LABEL,
} = await import('../src/lib/site-account-statement-allocations.ts');

const APPROVAL = {
  name: 'sanction.pdf', url: 'https://example.test/sanction.pdf',
  storagePath: 'x/sanction.pdf', size: 1024, type: 'application/pdf',
};

function alloc(over = {}) {
  return {
    id: 'a1', projectId: 'p1', projectName: 'Site A', period: '2026-04',
    amount: 100000, allocationDate: '2026-04-05', status: 'pending', approval: null,
    ...over,
  };
}

function draft(over = {}) {
  return { amount: '100000', allocationDate: '2026-04-05', referenceNo: '', notes: '', ...over };
}

// ── What counts ───────────────────────────────────────────────────────────────

test('only verified allocations count towards the budget', () => {
  assert.equal(countsTowardBudget({ status: 'approved' }), true);
  assert.equal(countsTowardBudget({ status: 'pending' }), false);
  assert.equal(countsTowardBudget({ status: 'rejected' }), false);
});

test('summary separates verified, pending and rejected money', () => {
  const s = summariseAllocations([
    alloc({ id: '1', amount: 200000, status: 'approved' }),
    alloc({ id: '2', amount: 150000, status: 'approved' }),
    alloc({ id: '3', amount: 50000,  status: 'pending' }),
    alloc({ id: '4', amount: 90000,  status: 'rejected' }),
  ]);
  assert.equal(s.approved, 350000);
  assert.equal(s.pending, 50000);
  assert.equal(s.rejected, 90000);
  assert.equal(s.approvedCount, 2);
  assert.equal(s.pendingCount, 1);
  assert.equal(s.rejectedCount, 1);
  // `total` is what has been proposed and not turned down — rejected money is excluded.
  assert.equal(s.total, 400000);
});

test('summary of nothing is all zeroes, not NaN', () => {
  const s = summariseAllocations([]);
  assert.deepEqual(
    [s.approved, s.pending, s.rejected, s.total, s.approvedCount, s.pendingCount, s.rejectedCount],
    [0, 0, 0, 0, 0, 0, 0],
  );
});

test('summary tolerates amounts stored as strings or missing', () => {
  const s = summariseAllocations([
    alloc({ id: '1', amount: '250000', status: 'approved' }),
    alloc({ id: '2', amount: undefined, status: 'approved' }),
  ]);
  assert.equal(s.approved, 250000);
});

// ── The month's spendable figure ──────────────────────────────────────────────

test('effective budget adds verified allocations to the legacy figure', () => {
  const total = effectiveMonthlyBudget(500000, [
    alloc({ id: '1', amount: 200000, status: 'approved' }),
    alloc({ id: '2', amount: 300000, status: 'pending' }),
  ]);
  assert.equal(total, 700000);
});

test('pending money never reaches the spendable figure', () => {
  assert.equal(effectiveMonthlyBudget(0, [alloc({ amount: 900000, status: 'pending' })]), 0);
});

test('rejected money never reaches the spendable figure', () => {
  assert.equal(effectiveMonthlyBudget(0, [alloc({ amount: 900000, status: 'rejected' })]), 0);
});

test('a missing legacy budget is treated as zero, not as a broken sum', () => {
  assert.equal(effectiveMonthlyBudget(null, [alloc({ amount: 100000, status: 'approved' })]), 100000);
  assert.equal(effectiveMonthlyBudget(undefined, []), 0);
});

// ── Verification gate ─────────────────────────────────────────────────────────

test('an allocation with no approval attached cannot be verified', () => {
  const check = canVerifyAllocation(alloc({ approval: null }));
  assert.equal(check.ok, false);
  assert.match(check.reason, /approval/i);
});

test('an approval record with no url does not satisfy the gate', () => {
  const check = canVerifyAllocation(alloc({ approval: { ...APPROVAL, url: '' } }));
  assert.equal(check.ok, false);
});

test('an allocation with an approval attached can be verified', () => {
  assert.equal(canVerifyAllocation(alloc({ approval: APPROVAL })).ok, true);
});

test('an already-verified allocation cannot be verified twice', () => {
  const check = canVerifyAllocation(alloc({ status: 'approved', approval: APPROVAL }));
  assert.equal(check.ok, false);
  assert.match(check.reason, /already verified/i);
});

test('rejecting is allowed once, and refused on an already-rejected row', () => {
  assert.equal(canRejectAllocation(alloc({ status: 'pending' })).ok, true);
  assert.equal(canRejectAllocation(alloc({ status: 'approved' })).ok, true);
  assert.equal(canRejectAllocation(alloc({ status: 'rejected' })).ok, false);
});

test('a verified allocation is frozen until it is reopened', () => {
  const check = canAmendAllocation(alloc({ status: 'approved' }));
  assert.equal(check.ok, false);
  assert.match(check.reason, /reopen/i);
  assert.equal(canAmendAllocation(alloc({ status: 'pending' })).ok, true);
  assert.equal(canAmendAllocation(alloc({ status: 'rejected' })).ok, true);
});

// ── Draft validation ──────────────────────────────────────────────────────────

test('a well-formed draft passes', () => {
  assert.equal(validateAllocationDraft(draft(), '2026-04').ok, true);
});

test('an empty amount is reported before anything else', () => {
  const check = validateAllocationDraft(draft({ amount: '  ' }), '2026-04');
  assert.equal(check.ok, false);
  assert.match(check.reason, /enter the allocation amount/i);
});

test('zero and negative amounts are refused', () => {
  assert.equal(validateAllocationDraft(draft({ amount: '0' }), '2026-04').ok, false);
  assert.equal(validateAllocationDraft(draft({ amount: '-5000' }), '2026-04').ok, false);
});

test('a non-numeric amount is refused', () => {
  assert.equal(validateAllocationDraft(draft({ amount: 'two lakh' }), '2026-04').ok, false);
});

test('a missing or malformed date is refused', () => {
  assert.equal(validateAllocationDraft(draft({ allocationDate: '' }), '2026-04').ok, false);
  assert.equal(validateAllocationDraft(draft({ allocationDate: '05/04/2026' }), '2026-04').ok, false);
});

test('a sanction signed shortly before the month it funds is accepted', () => {
  // The common real case: March paperwork funding April.
  assert.equal(validateAllocationDraft(draft({ allocationDate: '2026-03-28' }), '2026-04').ok, true);
});

test('a sanction dated a month after the funded month is still accepted', () => {
  // Paperwork catching up with money already spent is normal.
  assert.equal(validateAllocationDraft(draft({ allocationDate: '2026-05-10' }), '2026-04').ok, true);
});

test('a date far from the funded month is refused as a mis-picked month', () => {
  const early = validateAllocationDraft(draft({ allocationDate: '2025-04-05' }), '2026-04');
  assert.equal(early.ok, false);
  assert.match(early.reason, /months from the month being funded/i);

  const late = validateAllocationDraft(draft({ allocationDate: '2026-09-05' }), '2026-04');
  assert.equal(late.ok, false);
});

test('the boundaries of the accepted window are inclusive', () => {
  assert.equal(validateAllocationDraft(draft({ allocationDate: '2026-07-01' }), '2026-04').ok, true);  // 3 months early
  assert.equal(validateAllocationDraft(draft({ allocationDate: '2026-08-01' }), '2026-04').ok, false); // 4 months early
});

// ── Period arithmetic ─────────────────────────────────────────────────────────

test('period distance counts whole months and crosses years', () => {
  assert.equal(periodDistance('2026-04', '2026-04'), 0);
  assert.equal(periodDistance('2026-04', '2026-07'), 3);
  assert.equal(periodDistance('2026-07', '2026-04'), -3);
  assert.equal(periodDistance('2025-12', '2026-01'), 1);
});

test('period distance is null when a period is unparseable', () => {
  assert.equal(periodDistance('', '2026-04'), null);
  assert.equal(periodDistance('2026-04', 'later'), null);
});

// ── Ordering and lookup ───────────────────────────────────────────────────────

test('pending rows sort to the top, then newest sanction first', () => {
  const sorted = sortAllocations([
    alloc({ id: 'approved-new', status: 'approved', allocationDate: '2026-04-20' }),
    alloc({ id: 'rejected',     status: 'rejected', allocationDate: '2026-04-25' }),
    alloc({ id: 'pending-old',  status: 'pending',  allocationDate: '2026-04-02' }),
    alloc({ id: 'pending-new',  status: 'pending',  allocationDate: '2026-04-18' }),
    alloc({ id: 'approved-old', status: 'approved', allocationDate: '2026-04-01' }),
  ]);
  assert.deepEqual(
    sorted.map(a => a.id),
    ['pending-new', 'pending-old', 'approved-new', 'approved-old', 'rejected'],
  );
});

test('sorting does not mutate the array it was given', () => {
  const input = [
    alloc({ id: 'approved', status: 'approved' }),
    alloc({ id: 'pending',  status: 'pending' }),
  ];
  sortAllocations(input);
  assert.deepEqual(input.map(a => a.id), ['approved', 'pending']);
});

test('allocations are looked up by project and month together', () => {
  const all = [
    alloc({ id: '1', projectId: 'p1', period: '2026-04' }),
    alloc({ id: '2', projectId: 'p1', period: '2026-05' }),
    alloc({ id: '3', projectId: 'p2', period: '2026-04' }),
  ];
  assert.deepEqual(allocationsFor(all, 'p1', '2026-04').map(a => a.id), ['1']);
  assert.deepEqual(allocationsFor(all, 'p3', '2026-04'), []);
});

test('every status has a label the UI can render', () => {
  for (const status of ['pending', 'approved', 'rejected']) {
    assert.equal(typeof ALLOCATION_STATUS_LABEL[status], 'string');
    assert.ok(ALLOCATION_STATUS_LABEL[status].length > 0);
  }
});
