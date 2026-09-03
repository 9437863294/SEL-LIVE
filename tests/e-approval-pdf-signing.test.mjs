import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEApprovalSignaturePlacement } from '../src/lib/e-approval-pdf-signing.ts';
import { canSignEApprovalDocument } from '../src/lib/e-approval-policy.ts';

/* ── signature placement geometry ────────────────────────────────────────────────────────────── */

// A4 in points, and a 3:1 (wide, short) signature — the common case for a handwritten name.
const A4 = { pageWidth: 595, pageHeight: 842 };
const SIGNATURE = { imageWidth: 300, imageHeight: 100 };

test('width is a percentage of the page, height follows the image aspect ratio', () => {
  const placement = computeEApprovalSignaturePlacement({
    ...A4,
    ...SIGNATURE,
    position: 'bottom-right',
    widthPct: 20,
  });
  assert.equal(placement.width, 595 * 0.2);
  assert.equal(placement.height, placement.width * (100 / 300));
});

test('the nine anchors land in the expected thirds of the page, margin respected', () => {
  const margin = 24;
  const at = (position) => computeEApprovalSignaturePlacement({ ...A4, ...SIGNATURE, position, widthPct: 20, margin });

  const bottomLeft = at('bottom-left');
  assert.equal(bottomLeft.x, margin);
  assert.equal(bottomLeft.y, margin);

  const topRight = at('top-right');
  assert.equal(topRight.x, A4.pageWidth - margin - topRight.width);
  assert.equal(topRight.y, A4.pageHeight - margin - topRight.height);

  const middleCenter = at('middle-center');
  assert.equal(middleCenter.x, (A4.pageWidth - middleCenter.width) / 2);
  assert.equal(middleCenter.y, (A4.pageHeight - middleCenter.height) / 2);
});

test('a fine offset shifts the mark from its anchor', () => {
  const base = computeEApprovalSignaturePlacement({ ...A4, ...SIGNATURE, position: 'bottom-left', widthPct: 20 });
  const shifted = computeEApprovalSignaturePlacement({
    ...A4,
    ...SIGNATURE,
    position: 'bottom-left',
    widthPct: 20,
    offsetX: 40,
    offsetY: 10,
  });
  assert.equal(shifted.x, base.x + 40);
  assert.equal(shifted.y, base.y + 10);
});

test('an extreme offset is clamped fully on the page rather than pushed off it', () => {
  const placement = computeEApprovalSignaturePlacement({
    ...A4,
    ...SIGNATURE,
    position: 'bottom-left',
    widthPct: 20,
    offsetX: -10_000,
    offsetY: -10_000,
  });
  assert.equal(placement.x, 0);
  assert.equal(placement.y, 0);

  const other = computeEApprovalSignaturePlacement({
    ...A4,
    ...SIGNATURE,
    position: 'top-right',
    widthPct: 20,
    offsetX: 10_000,
    offsetY: 10_000,
  });
  assert.equal(other.x, A4.pageWidth - other.width);
  assert.equal(other.y, A4.pageHeight - other.height);
});

test('a zero-width source image falls back to a sane aspect ratio instead of dividing by zero', () => {
  const placement = computeEApprovalSignaturePlacement({
    ...A4,
    imageWidth: 0,
    imageHeight: 0,
    position: 'bottom-left',
    widthPct: 20,
  });
  assert.ok(Number.isFinite(placement.height) && placement.height > 0);
});

/* ── when a document may still be signed ─────────────────────────────────────────────────────── */

test('a closed approval can no longer be signed, whatever closed it', () => {
  for (const status of ['Approved', 'Rejected', 'Cancelled', 'Closed', 'Superseded']) {
    assert.equal(canSignEApprovalDocument({ status }), false, status);
  }
});

test('a live approval can be signed at any stage it is still moving through', () => {
  for (const status of [
    'Submitted',
    'Pending Approval',
    'Pending Verification',
    'Pending Clarification',
    'Returned',
    'Resubmitted',
    'On Hold',
    'Partially Approved',
  ]) {
    assert.equal(canSignEApprovalDocument({ status }), true, status);
  }
});

test('a draft is still signable — nothing has been decided to contradict a signature yet', () => {
  assert.equal(canSignEApprovalDocument({ status: 'Draft' }), true);
});
