import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eApprovalActivityGroupOf,
  summarizeEApprovalMyActivity,
} from '../src/lib/e-approval-policy.ts';

/* ── the personal activity log ("My Activity") ───────────────────────────────────────────────── */

test('every action kind falls into exactly one of the seven groups', () => {
  assert.equal(eApprovalActivityGroupOf('Approve'), 'Approved');
  assert.equal(eApprovalActivityGroupOf('Approve And Complete'), 'Approved');
  assert.equal(eApprovalActivityGroupOf('Verify'), 'Verified');
  assert.equal(eApprovalActivityGroupOf('Provide Clarification'), 'Clarified');
  assert.equal(eApprovalActivityGroupOf('Return'), 'Returned');
  assert.equal(eApprovalActivityGroupOf('Auto Returned'), 'Returned');
  assert.equal(eApprovalActivityGroupOf('Reject'), 'Rejected');
  for (const kind of ['Forward', 'Delegate', 'Escalate', 'Assign', 'Add Approver', 'Take Ownership']) {
    assert.equal(eApprovalActivityGroupOf(kind), 'Routed', kind);
  }
  for (const kind of ['Submit', 'Resubmit', 'Cancel', 'Hold', 'Resume', 'Add Participant', 'Recall', 'Reverse', 'Comment', 'Attachment', 'Created', 'Superseded']) {
    assert.equal(eApprovalActivityGroupOf(kind), 'Other', kind);
  }
});

test('the summary tallies every entry once and counts this month separately', () => {
  const NOW = '2026-08-22T10:00:00.000Z';
  const entries = [
    { kind: 'Approve', at: '2026-08-20T10:00:00.000Z' },
    { kind: 'Approve And Complete', at: '2026-08-01T10:00:00.000Z' },
    { kind: 'Verify', at: '2026-07-30T10:00:00.000Z' }, // last month
    { kind: 'Return', at: '2026-08-15T10:00:00.000Z' },
    { kind: 'Reject', at: '2026-08-10T10:00:00.000Z' },
    { kind: 'Forward', at: '2026-08-05T10:00:00.000Z' },
    { kind: 'Submit', at: '2026-08-02T10:00:00.000Z' },
  ];
  const summary = summarizeEApprovalMyActivity(entries, NOW);
  assert.equal(summary.total, 7);
  assert.equal(summary.thisMonth, 6, 'everything except the July verification');
  assert.deepEqual(summary.byGroup, {
    Approved: 2,
    Verified: 1,
    Clarified: 0,
    Returned: 1,
    Rejected: 1,
    Routed: 1,
    Other: 1,
  });
});

test('an empty log summarises to all zeros, not a crash', () => {
  const summary = summarizeEApprovalMyActivity([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.thisMonth, 0);
  assert.equal(Object.values(summary.byGroup).every((count) => count === 0), true);
});
