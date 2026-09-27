import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeStatus, statusLabel, statusTone } from '../src/lib/status-tone.ts';

/**
 * Every module's status words resolve to the same six tones, whatever their casing — so "Pending",
 * "PAYMENT_PENDING" and "pending-approval" are the same amber everywhere.
 */

test('casing and separators do not matter', () => {
  assert.equal(normalizeStatus('PAYMENT_PENDING'), 'payment pending');
  assert.equal(normalizeStatus('due-soon'), 'due soon');
  assert.equal(normalizeStatus('  In  Progress '), 'in progress');
  assert.equal(normalizeStatus('pendingApproval'), 'pending approval');
  assert.equal(normalizeStatus(undefined), '');
});

test('the vocabularies the modules use land on the tone a reader expects', () => {
  const cases = {
    success: ['Approved', 'ACTIVE', 'Paid', 'Settled', 'Completed', 'Valid', 'VERIFIED', 'Joined', 'In stock', 'On Track', 'Present', 'Online', 'Received'],
    warning: ['Pending', 'Pending Approval', 'PAYMENT_PENDING', 'Awaiting Bill', 'Due Soon', 'due-soon', 'Mature Soon', 'MATURITY_APPROACHING', 'Near', 'Low stock', 'Needs Review', 'Under Verification', 'Clarification', 'Returned', 'On Hold', 'Partially Paid', 'Partially Approved', 'EXTENSION_DUE', 'Late', 'Idle'],
    danger: ['Rejected', 'REJECTED', 'Failed', 'Overdue', 'Expired', 'EXPIRED', 'Missing', 'Over Budget', 'Disputed', 'Invoked', 'No Show', 'Absent', 'Blocked', 'Out of stock'],
    neutral: ['Draft', 'DRAFT', 'Cancelled', 'Closed', 'Inactive', 'Not Started', 'Not Applicable', 'No Budget', 'Superseded', 'Offline', 'Matured', 'Waived', 'something else entirely', ''],
    progress: ['In Progress', 'IN_PROGRESS', 'Processing', 'Screening', 'Interview', 'OFFER', 'Shortlisted', 'Sourcing'],
    info: ['Submitted', 'Resubmitted', 'Open', 'Scheduled', 'Sent', 'Issued', 'Upcoming', 'TALENT_POOL'],
  };
  for (const [tone, words] of Object.entries(cases)) {
    for (const word of words) assert.equal(statusTone(word), tone, `${JSON.stringify(word)} should be ${tone}`);
  }
});

test('whole words only: "unpaid" is not paid, "inactive" is not active', () => {
  assert.equal(statusTone('Unpaid'), 'neutral');
  assert.equal(statusTone('Inactive'), 'neutral');
  assert.equal(statusTone('Not Started'), 'neutral');
});

test('labels: codes become words, words stay as written', () => {
  assert.equal(statusLabel('PAYMENT_PENDING'), 'Payment Pending');
  assert.equal(statusLabel('due-soon'), 'Due Soon');
  assert.equal(statusLabel('Pending Approval'), 'Pending Approval');
  assert.equal(statusLabel('In stock'), 'In stock');
  assert.equal(statusLabel(''), '');
});
