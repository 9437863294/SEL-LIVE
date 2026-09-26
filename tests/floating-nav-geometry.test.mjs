import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bumpedBarPath,
  bumpedTopEdgePath,
  easeOutBack,
  notchHalfWidth,
  notchedBarPath,
  restingFrame,
  slotCenter,
  slotOffsets,
  slotWidths,
} from '../src/components/navigation/geometry.ts';

/**
 * The floating bottom nav draws its own outline, so a geometry slip is not a styling nit — it is a
 * bar with a gash in it, or a notch that no longer sits under its button. These pin the shapes to
 * the numbers the component actually uses (FloatingBottomNav.tsx) at real phone widths.
 */
const BAR = { height: 72, radius: 30, padding: 24, boost: 40, minSlot: 48, count: 5 };
const NOTCH = { buttonRadius: 28, gap: 6, centerY: -4, fillet: 10 };
const BUMP = { rise: 14, halfWidth: 46 };
// 360, 390, 412 and 430px phones minus the bar's 12px side margins, then the 560px tablet cap.
const WIDTHS = [336, 366, 388, 406, 560];

const numbers = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);

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

test('slot widths always add up to the bar, with the active slot widened', () => {
  for (const width of WIDTHS) {
    const m = { ...BAR, width };
    for (const active of [-1, 0, 2, 4]) {
      const widths = slotWidths(m, active);
      const total = widths.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(total - (width - BAR.padding * 2)) < 1e-9, `width ${width}, active ${active}`);
      if (active >= 0) assert.ok(widths[active] > widths[(active + 1) % 5]);
    }
  }
});

test('no inactive tap target drops under the 48px floor, even on a 360px phone', () => {
  for (const width of WIDTHS) {
    const widths = slotWidths({ ...BAR, width }, 0);
    for (const w of widths.slice(1)) assert.ok(w >= 48 - 1e-9, `width ${width}: slot ${w}`);
  }
  // Too narrow for the boost at all: it is given up entirely rather than squeezing the others.
  const cramped = slotWidths({ ...BAR, width: 280 }, 1);
  assert.equal(new Set(cramped.map((w) => w.toFixed(6))).size, 1);
});

test('slot offsets and centres line up with the widths', () => {
  const m = { ...BAR, width: 366 };
  const widths = slotWidths(m, 1);
  const offsets = slotOffsets(m, widths);
  assert.equal(offsets[0], BAR.padding);
  assert.ok(Math.abs(offsets[4] + widths[4] - (366 - BAR.padding)) < 1e-9);
  assert.ok(Math.abs(slotCenter(m, widths, 1) - (offsets[1] + widths[1] / 2)) < 1e-9);
  assert.equal(restingFrame(m, 1).x, slotCenter(m, widths, 1));
});

test('the notch arc and its two fillets meet on both circles, so the outline has no corner', () => {
  for (const width of WIDTHS) {
    const m = { ...BAR, width };
    for (const active of [0, 2, 4]) {
      const { x } = restingFrame(m, active);
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
  const { x } = restingFrame(m, 2);
  const [arc] = arcs(notchedBarPath(m, NOTCH, x)).filter((a) => a.r === 34);
  // The deepest point of the notch is directly under the button: centre + radius + gap.
  const deepest = NOTCH.centerY + arc.r;
  assert.equal(deepest, NOTCH.centerY + NOTCH.buttonRadius + NOTCH.gap);
  assert.ok(arc.from[1] > 0 && arc.to[1] > 0, 'tangent points are inside the bar, below its top edge');
});

test('the top corners give way to a notch at the ends instead of colliding with it', () => {
  for (const width of WIDTHS) {
    const m = { ...BAR, width };
    const { x } = restingFrame(m, 0);
    const reach = notchHalfWidth(NOTCH);
    const d = notchedBarPath(m, NOTCH, x);
    const [corner] = arcs(d);
    assert.ok(Math.abs(corner.r - Math.min(30, x - reach)) < 0.01, `width ${width}: corner ${corner.r}`);
    // Still recognisably rounded on the smallest phone, not squared off.
    assert.ok(corner.r >= 24, `width ${width}: corner squashed to ${corner.r}`);
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
  const { x } = restingFrame(m, 3);
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
