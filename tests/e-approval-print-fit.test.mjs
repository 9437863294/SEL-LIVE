import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeEApprovalPrintFit,
  eApprovalPrintFit,
  LANDSCAPE_CONTENT_PX,
  MIN_SCALE,
  PORTRAIT_CONTENT_PX,
} from '../src/lib/e-approval-print-fit.ts';

/* ── the page itself ─────────────────────────────────────────────────────────────────────────── */

test('the printable widths are A4 less a half-inch margin and the safety allowance', () => {
  // A half-inch margin each side is exactly 96px of the 96 CSS px/inch page: 697 and 1026 raw.
  // The allowance then keeps the fit clear of the print pipeline's own rounding.
  const raw = (mm) => Math.floor(mm * (96 / 25.4) - 96);
  assert.equal(raw(210), 697);
  assert.equal(raw(297), 1026);
  assert.equal(PORTRAIT_CONTENT_PX, 681);
  assert.equal(LANDSCAPE_CONTENT_PX, 1003);
  assert.ok(PORTRAIT_CONTENT_PX < raw(210), 'the target must sit inside the paper, not on its edge');
  assert.ok(LANDSCAPE_CONTENT_PX < raw(297));
  assert.ok(LANDSCAPE_CONTENT_PX > PORTRAIT_CONTENT_PX);
});

/* ── nothing to do ───────────────────────────────────────────────────────────────────────────── */

test('a proposal that already fits is left alone', () => {
  const fit = eApprovalPrintFit(500);
  assert.equal(fit.orientation, 'portrait');
  assert.equal(fit.scale, 1);
  assert.equal(fit.clipped, false);
});

test('a proposal exactly the page width is not shrunk', () => {
  assert.equal(eApprovalPrintFit(PORTRAIT_CONTENT_PX).scale, 1);
});

test('a narrow proposal is never blown up to fill the page', () => {
  assert.equal(eApprovalPrintFit(120).scale, 1, 'scale is a fit, not a stretch');
});

test('a missing or nonsense measurement is treated as fitting rather than crashing', () => {
  for (const value of [0, -40, Number.NaN, Number.POSITIVE_INFINITY]) {
    const fit = eApprovalPrintFit(value);
    assert.equal(fit.scale, 1, String(value));
    assert.equal(fit.orientation, 'portrait', String(value));
  }
});

/* ── shrink before rotating ──────────────────────────────────────────────────────────────────── */

test('a slightly wide proposal is shrunk and stays portrait', () => {
  const fit = eApprovalPrintFit(800);
  assert.equal(fit.orientation, 'portrait', 'a mild shrink beats rotating the whole note');
  assert.ok(fit.scale > 0.8 && fit.scale < 1, `expected a mild shrink, got ${fit.scale}`);
  assert.equal(Math.round(800 * fit.scale), PORTRAIT_CONTENT_PX);
  assert.equal(fit.clipped, false);
});

test('the scale is exactly what makes the content fit the width', () => {
  const fit = eApprovalPrintFit(850);
  assert.equal(fit.scale, PORTRAIT_CONTENT_PX / 850);
});

test('past the readability floor the page turns landscape instead of shrinking further', () => {
  // 681 / 1000 = 0.68, below the 0.8 floor.
  const fit = eApprovalPrintFit(1000);
  assert.equal(fit.orientation, 'landscape');
  assert.equal(fit.scale, 1, 'landscape is wide enough on its own, so nothing is shrunk');
  assert.equal(fit.clipped, false);
});

test('the boundary between shrinking and rotating is the readability floor', () => {
  const justInside = Math.floor(PORTRAIT_CONTENT_PX / 0.8);
  assert.equal(eApprovalPrintFit(justInside).orientation, 'portrait');
  assert.equal(eApprovalPrintFit(justInside + 40).orientation, 'landscape');
});

test('a proposal too wide even for landscape is shrunk in landscape', () => {
  const fit = eApprovalPrintFit(1400);
  assert.equal(fit.orientation, 'landscape');
  assert.ok(fit.scale < 1);
  assert.equal(Math.round(1400 * fit.scale), LANDSCAPE_CONTENT_PX);
  assert.equal(fit.clipped, false);
});

/* ── the limits ──────────────────────────────────────────────────────────────────────────────── */

test('nothing is shrunk past the floor, and that case reports itself as clipped', () => {
  const fit = eApprovalPrintFit(9000);
  assert.equal(fit.scale, MIN_SCALE, 'illegible is not a fit');
  assert.equal(fit.clipped, true, 'and the print bar has to say so rather than quietly cropping');
});

test('a fit landing exactly on the floor is not reported as clipped', () => {
  const exact = LANDSCAPE_CONTENT_PX / MIN_SCALE;
  const fit = eApprovalPrintFit(exact);
  // Not strict equality: the round trip through the division lands a hair off the floor
  // (0.45000000000000007), which is exactly the case the rounded `clipped` check exists for.
  assert.ok(Math.abs(fit.scale - MIN_SCALE) < 1e-9, `expected ~${MIN_SCALE}, got ${fit.scale}`);
  assert.equal(fit.clipped, false, 'floating-point division must not raise a false warning');
});

/* ── the manual override ─────────────────────────────────────────────────────────────────────── */

test('forcing portrait shrinks rather than rotating, however wide the content', () => {
  const fit = eApprovalPrintFit(1400, { force: 'portrait' });
  assert.equal(fit.orientation, 'portrait');
  assert.equal(Math.round(1400 * fit.scale), PORTRAIT_CONTENT_PX);
});

test('forcing landscape keeps the page landscape even when portrait would have done', () => {
  const fit = eApprovalPrintFit(400, { force: 'landscape' });
  assert.equal(fit.orientation, 'landscape');
  assert.equal(fit.scale, 1);
});

/* ── what the user is told ───────────────────────────────────────────────────────────────────── */

test('the print bar explains what it did, in each case', () => {
  assert.match(describeEApprovalPrintFit(eApprovalPrintFit(400)), /Fits the page/);
  assert.match(describeEApprovalPrintFit(eApprovalPrintFit(800)), /scaled to 8[0-9]%/);
  assert.match(describeEApprovalPrintFit(eApprovalPrintFit(1000)), /^Landscape, so/);
  assert.match(describeEApprovalPrintFit(eApprovalPrintFit(1400)), /Landscape, scaled to/);
  assert.match(describeEApprovalPrintFit(eApprovalPrintFit(9000)), /will be clipped/);
});
