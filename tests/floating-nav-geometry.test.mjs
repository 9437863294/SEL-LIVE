import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bumpedBarPath,
  bumpedTopEdgePath,
  easeOutBack,
  fitInView,
  indicatorTarget,
  labelBoxes,
  maxScroll,
  notchHalfWidth,
  notchedBarPath,
  revealScroll,
  slotLayout,
} from '../src/components/navigation/geometry.ts';

/**
 * The floating bottom nav draws its own outline, so a geometry slip is not a styling nit — it is a
 * bar with a gash in it, or a notch that no longer sits under its button. These pin the shapes to
 * the numbers the component actually uses (FloatingBottomNav.tsx) at real phone widths.
 */
const BAR = { height: 60, radius: 24 };
const PADDING = 17;
const IN_VIEW = 6;
const NOTCH = { buttonRadius: 22, gap: 3, centerY: -4, fillet: 7 };
const BUMP = { rise: 12, halfWidth: 36 };
// 360, 390, 412 and 430px phones minus the bar's 12px side margins, then the 560px tablet cap.
const WIDTHS = [336, 366, 388, 406, 560];

const numbers = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/** Every `A` command in a path, with its endpoint and the point the pen was at before it. */
function arcs(d) {
  const tokens = d.match(/[MLACZ]|-?\d+(?:\.\d+)?/g);
  const out = [];
  let pen = [0, 0];
  for (let i = 0; i < tokens.length; ) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'L') {
      pen = [Number(tokens[i++]), Number(tokens[i++])];
    } else if (cmd === 'A') {
      const [rx, , , large, sweep, x, y] = tokens.slice(i, i + 7).map(Number);
      i += 7;
      out.push({ from: pen, to: [x, y], r: rx, large, sweep });
      pen = [x, y];
    } else if (cmd === 'C') {
      pen = [Number(tokens[i + 4]), Number(tokens[i + 5])];
      i += 6;
    }
  }
  return out;
}

/** A module bar: `count` tabs in the strip plus a pinned "More". */
const layoutAt = (width, count = 12, pinned = 1) => slotLayout(width, PADDING, count, pinned, IN_VIEW);

test('a short list spreads out to fill the bar, with nothing to scroll', () => {
  for (const width of WIDTHS) {
    for (const count of [1, 3, 5, 6]) {
      const layout = layoutAt(width, count);
      assert.equal(layout.scrollable, false, `width ${width}, ${count} tabs`);
      assert.equal(layout.inView, count);
      assert.ok(near(layout.trackWidth + layout.slot, width - PADDING * 2), 'strip plus More fill the bar');
      assert.ok(near(layout.contentWidth, layout.trackWidth));
    }
  }
  // Without a pinned item the tabs alone fill it.
  const bare = slotLayout(366, PADDING, 4, 0, IN_VIEW);
  assert.ok(near(bare.slot * 4, 366 - PADDING * 2));
});

test('a long list shows six at a time beside More, and the rest scroll', () => {
  for (const width of WIDTHS) {
    const layout = layoutAt(width, 17);
    assert.equal(layout.scrollable, true);
    assert.equal(layout.inView, 6);
    assert.ok(near(layout.slot, (width - PADDING * 2) / 7), 'six tabs and More share the bar evenly');
    assert.ok(near(layout.trackWidth, 6 * layout.slot));
    assert.ok(near(layout.contentWidth, 17 * layout.slot));
    assert.ok(near(maxScroll(layout), 11 * layout.slot));
  }
  // Even seven to a 360px phone, a slot is still a fair thumb target.
  assert.ok(layoutAt(336).slot > 43, `slot ${layoutAt(336).slot}`);
});

test('the indicator sits over its tab, and shrinks away as the tab scrolls out of view', () => {
  const layout = layoutAt(366, 12);
  const { slot, trackLeft, trackWidth } = layout;
  const at = indicatorTarget(layout, 2, 0);
  assert.ok(near(at.x, trackLeft + 2.5 * slot));
  assert.equal(at.scale, 1);
  // Scrolled by one slot, the same tab has moved one slot left and is still whole.
  const moved = indicatorTarget(layout, 2, slot);
  assert.ok(near(moved.x, trackLeft + 1.5 * slot));
  assert.equal(moved.scale, 1);
  // A quarter hidden: half size. Half hidden or more: gone, and never past the strip's edge.
  assert.ok(near(indicatorTarget(layout, 0, slot / 4).scale, 0.5));
  assert.equal(indicatorTarget(layout, 0, slot / 2).scale, 0);
  const gone = indicatorTarget(layout, 0, slot * 3);
  assert.equal(gone.scale, 0);
  assert.ok(gone.x >= trackLeft);
  // Off the right-hand end it stays short of More rather than sliding over it.
  const right = indicatorTarget(layout, 9, 0);
  assert.equal(right.scale, 0);
  assert.ok(right.x <= trackLeft + trackWidth);
});

test('the pinned More slot ignores the strip scroll', () => {
  const layout = layoutAt(366, 12);
  const more = layout.count;
  for (const scroll of [0, 40, maxScroll(layout)]) {
    const at = indicatorTarget(layout, more, scroll);
    assert.ok(near(at.x, layout.trackLeft + layout.trackWidth + layout.slot / 2));
    assert.equal(at.scale, 1);
  }
  assert.equal(indicatorTarget(layout, -1, 0).scale, 0, 'no active tab');
  assert.equal(indicatorTarget(layout, more + 1, 0).scale, 0, 'past the last slot');
});

test('revealing a tab centres it on a whole slot, clamped to the ends, and leaves a visible one alone', () => {
  const layout = layoutAt(366, 17);
  const { slot } = layout;
  assert.equal(revealScroll(layout, 3, 0), null, 'already in view');
  assert.equal(revealScroll(layout, 5, 0), null, 'last whole tab in view');
  const middle = revealScroll(layout, 10, 0);
  assert.ok(near(middle / slot, Math.round(middle / slot)), 'lands on a slot boundary');
  assert.ok(middle / slot <= 10 && middle / slot + 6 > 10, 'tab 10 is in the six shown');
  assert.ok(near(revealScroll(layout, 16, 0), maxScroll(layout)), 'the last tab scrolls only to the end');
  assert.equal(revealScroll(layout, 0, slot * 4), 0, 'the first tab scrolls back to the start');
  assert.equal(revealScroll(layoutAt(366, 4), 3, 0), null, 'nothing to scroll');
  assert.equal(revealScroll(layout, layout.count, 0), null, 'More is never scrolled to');
});

const FIT = { gap: 6, maxLabel: 60, minSlot: 40, minInView: 3, coverage: 0.6 };
// Label widths at the bar's 10px medium weight: Home, Renewals, Vehicles, Trips, Fuel, Service, Reports.
const VEHICLE_PICKS = [25, 46, 40, 25, 19, 37, 38];
// …then the rest of its menu: Renewal History, Vehicle Health, Insurance Workflow, Insurance, PUC,
// Fitness, Road Tax, Permit, Driver Master, Documents, Settings.
const VEHICLE_ALL = [...VEHICLE_PICKS, 72, 66, 90, 45, 21, 33, 42, 33, 64, 48, 40];
const MORE_LABEL = [25];
const fitAt = (width, strip, pinned = MORE_LABEL) => fitInView(width, PADDING, strip, pinned, IN_VIEW, FIT);

test('how many tabs show adjusts to the labels: six when they are short, fewer when they are long', () => {
  // Short names: the six-tab cap is what limits it, on every phone.
  for (const width of WIDTHS) assert.equal(fitAt(width, Array(12).fill(20)), 6, `width ${width}`);
  // A real module's names, a few of them long: the long ones are cut short rather than costing
  // every screen of the bar a tab, so it still shows five on a 360px phone and six on a 430px one.
  assert.equal(fitAt(336, VEHICLE_ALL), 5);
  assert.equal(fitAt(406, VEHICLE_ALL), 6);
  assert.equal(fitAt(336, VEHICLE_PICKS), 6, 'its first seven names are all short');
  // Long names throughout (or large system text) give up tabs, never below three.
  assert.equal(fitAt(336, Array(12).fill(58)), 3);
  assert.equal(fitAt(336, Array(12).fill(400)), 3, 'a huge label is cut short, not allowed to empty the bar');
  // A short list that fits is shown whole; an empty one shows nothing.
  assert.equal(fitAt(336, [25, 46, 40]), 3);
  assert.equal(fitAt(336, []), 0);
});

test('neighbouring labels never overlap, at any phone width, scroll position or label length', () => {
  // A deterministic pseudo-random sweep: widths from a 6px word to a 200px sentence, slots from
  // whatever the fit chose down to cramped ones it never would.
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let run = 0; run < 600; run++) {
    const width = 240 + Math.floor(rand() * 340);
    const count = 1 + Math.floor(rand() * 16);
    const strip = Array.from({ length: count }, () => 6 + rand() * (rand() < 0.2 ? 200 : 60));
    const pinned = rand() < 0.8 ? [20 + rand() * 20] : [];
    const inView = run % 3 === 0 ? 1 + Math.floor(rand() * 6) : fitInView(width, PADDING, strip, pinned, IN_VIEW, FIT);
    const { slot } = slotLayout(width, PADDING, count, pinned.length, inView);
    const boxes = labelBoxes(slot, strip, pinned, FIT);
    const shown = (i) => Math.min(i < count ? strip[i] : pinned[i - count], boxes[i]);
    const clear = (a, b) => (shown(a) + shown(b)) / 2 + FIT.gap <= slot + 1e-6 || slot <= FIT.gap;
    for (let i = 0; i + 1 < count; i++) assert.ok(clear(i, i + 1), `run ${run}: tabs ${i}/${i + 1}`);
    // Any strip tab can scroll to the end, beside More.
    if (pinned.length) for (let i = 0; i < count; i++) assert.ok(clear(i, count), `run ${run}: tab ${i} beside More`);
    assert.ok(boxes.every((b) => b >= 0 && b <= FIT.maxLabel + 1e-9), `run ${run}: boxes within 0…cap`);
  }
});

test('a label borrows the room a short neighbour leaves, and splits it with a long one', () => {
  const slot = 50;
  const room = slot - FIT.gap;
  // Short neighbours either side (and a short More): the long middle label may run past its slot.
  const [, middle] = labelBoxes(slot, [20, 100, 20], [20], FIT);
  assert.equal(middle, Math.min(FIT.maxLabel, 2 * (room - 20 / 2)));
  // Between two long ones it gets exactly its share.
  const [, squeezed] = labelBoxes(slot, [100, 100, 100], [], FIT);
  assert.equal(squeezed, room);
  // Nobody beside it: the cap is all that limits a lone label.
  assert.deepEqual(labelBoxes(slot, [100], [], FIT), [FIT.maxLabel]);
});

test('the notch arc and its two fillets meet on both circles, so the outline has no corner', () => {
  for (const width of WIDTHS) {
    const m = { ...BAR, width };
    const layout = layoutAt(width);
    for (const active of [0, 2, 5, layout.count]) {
      const { x } = indicatorTarget(layout, active, 0);
      const d = notchedBarPath(m, NOTCH, x);
      assert.ok(!/NaN|Infinity/.test(d), d);
      assert.match(d, /^M0 /);
      assert.match(d, /Z$/);
      const notch = arcs(d).filter((a) => a.r === NOTCH.buttonRadius + NOTCH.gap);
      assert.equal(notch.length, 1, 'one arc around the button');
      const [arc] = notch;
      // Both ends of the notch arc sit on the circle around the button's centre…
      for (const [px, py] of [arc.from, arc.to]) {
        const dist = Math.hypot(px - x, py - NOTCH.centerY);
        assert.ok(Math.abs(dist - arc.r) < 0.05, `off the notch circle by ${dist - arc.r}`);
      }
      // …and on the fillet circles either side, which is what makes the joins tangent.
      const fx = notchHalfWidth(NOTCH);
      const onLeft = Math.hypot(arc.from[0] - (x - fx), arc.from[1] - NOTCH.fillet);
      const onRight = Math.hypot(arc.to[0] - (x + fx), arc.to[1] - NOTCH.fillet);
      assert.ok(Math.abs(onLeft - NOTCH.fillet) < 0.05 && Math.abs(onRight - NOTCH.fillet) < 0.05);
      // …and it passes under the button, which it could only do sweeping counter-clockwise.
      assert.equal(arc.sweep, 0);
      assert.equal(arc.large, 0);
    }
  }
});

test('the notch leaves the button an even gap all the way round', () => {
  const m = { ...BAR, width: 366 };
  const { x } = indicatorTarget(layoutAt(366), 2, 0);
  const r = NOTCH.buttonRadius + NOTCH.gap;
  const [arc] = arcs(notchedBarPath(m, NOTCH, x)).filter((a) => a.r === r);
  // The deepest point of the notch is directly under the button: centre + radius + gap.
  assert.equal(NOTCH.centerY + arc.r, NOTCH.centerY + NOTCH.buttonRadius + NOTCH.gap);
  assert.ok(arc.from[1] > 0 && arc.to[1] > 0, 'tangent points are inside the bar, below its top edge');
});

test('the notch is narrow enough at the rim to clear the neighbouring icons', () => {
  // Icons are 22px; with seven slots on a 360px phone the next icon starts slot − 11px away.
  const { slot } = layoutAt(336);
  assert.ok(notchHalfWidth(NOTCH) < slot - 11, `reach ${notchHalfWidth(NOTCH)} vs ${slot - 11}`);
});

test('the top corners give way to a notch at the ends instead of colliding with it', () => {
  for (const width of WIDTHS) {
    const m = { ...BAR, width };
    const { x } = indicatorTarget(layoutAt(width), 0, 0);
    const reach = notchHalfWidth(NOTCH);
    const d = notchedBarPath(m, NOTCH, x);
    const [corner] = arcs(d);
    assert.ok(Math.abs(corner.r - Math.min(BAR.radius, x - reach)) < 0.01, `width ${width}: corner ${corner.r}`);
    // Still recognisably rounded with seven slots on the smallest phone, not squared off.
    assert.ok(corner.r >= 8, `width ${width}: corner squashed to ${corner.r}`);
  }
});

test('an overshooting indicator never pushes the notch out of the bar', () => {
  const m = { ...BAR, width: 336 };
  for (const x of [-40, 0, 5, 331, 400]) {
    const d = notchedBarPath(m, NOTCH, x);
    assert.ok(!/NaN/.test(d));
    const coords = numbers(d);
    assert.ok(Math.min(...coords) >= -0.01, `x ${x}`);
    assert.ok(Math.max(...coords) <= 336.01, `x ${x}`);
  }
});

test('a notch shrunk to nothing is a plain pill', () => {
  const m = { ...BAR, width: 366 };
  const zero = { buttonRadius: 0, gap: 0, centerY: 0, fillet: 0 };
  const d = notchedBarPath(m, zero, 180);
  assert.ok(!/NaN/.test(d), d);
  assert.equal(arcs(d).length, 4, 'just the four corners');
});

test('the neon hill rises exactly `rise` above the rim and the rim path follows it', () => {
  const m = { ...BAR, width: 388 };
  const { x } = indicatorTarget(layoutAt(388), 3, 0);
  const bar = bumpedBarPath(m, BUMP, x);
  const rim = bumpedTopEdgePath(m, BUMP, x);
  assert.ok(!/NaN/.test(bar) && !/NaN/.test(rim));
  assert.equal(Math.min(...numbers(bar)), -BUMP.rise);
  assert.equal(Math.min(...numbers(rim)), -BUMP.rise);
  assert.match(rim, /^M\d/);
  assert.doesNotMatch(rim, /Z/);
  assert.ok(rim.includes(`${Math.round(x * 100) / 100} -${BUMP.rise}`), 'crest sits over the active tab');
});

test('the travel easing starts at 0, lands on 1 and overshoots in between', () => {
  assert.ok(Math.abs(easeOutBack(0)) < 1e-12);
  assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-12);
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => easeOutBack(i / 100)));
  assert.ok(peak > 1 && peak < 1.12, `peak ${peak}`);
});
