/**
 * Geometry for the floating bottom navigation bar.
 *
 * Kept free of React and the DOM so the shapes can be unit-tested with plain node
 * (`tests/floating-nav-geometry.test.mjs`) — which also means no enums and no constructor
 * parameter properties, since `--experimental-strip-types` cannot erase either.
 *
 * The bar is drawn as one SVG path rather than a rounded div with a cutout because the notch has
 * to *blend* into the bar: a circle cut out of a rectangle leaves two sharp corners where it meets
 * the top edge, and a CSS mask cannot round them. Here the notch is an arc around the floating
 * button joined to the top edge by two fillet arcs tangent to both, so the whole outline is smooth.
 */

export type NavShape = 'notch' | 'bump';

export interface BarMetrics {
  /** Bar width in px (measured). */
  width: number;
  /** Bar height in px, excluding anything that floats above it. */
  height: number;
  /** Corner radius of the pill. The top corners shrink when the notch reaches them. */
  radius: number;
  /** Horizontal inset before the first and after the last slot. */
  padding: number;
  /** Number of slots. */
  count: number;
  /** Extra width the active slot takes from the others, when there is room for it. */
  boost: number;
  /** Narrowest an inactive slot may get — the boost is given up before a tap target shrinks. */
  minSlot: number;
}

export interface NotchSpec {
  /** Radius of the floating button. */
  buttonRadius: number;
  /** Clearance between the button and the notch. */
  gap: number;
  /** Vertical position of the button's centre relative to the bar's top edge (negative = above). */
  centerY: number;
  /** Radius of the fillets that round the notch into the top edge. */
  fillet: number;
}

export interface BumpSpec {
  /** How far the hill rises above the top edge. */
  rise: number;
  /** Half the hill's width at the top edge. */
  halfWidth: number;
}

/** Everything the bar needs to draw one frame. */
export interface BarFrame {
  widths: number[];
  /** Horizontal centre of the active indicator. */
  x: number;
  /** Scale of the floating button (the notch follows it). */
  scale: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Slot widths with `activeIndex` widened. The active slot's extra width comes out of the other
 * slots evenly, so the total never changes and a tween between two layouts is a straight lerp.
 * A negative or out-of-range index gives every slot the same width.
 */
export function slotWidths(m: BarMetrics, activeIndex: number): number[] {
  if (m.count <= 0) return [];
  const inner = Math.max(0, m.width - m.padding * 2);
  const hasActive = activeIndex >= 0 && activeIndex < m.count;
  const boost = hasActive ? clamp(inner - m.count * m.minSlot, 0, m.boost) : 0;
  const base = (inner - boost) / m.count;
  return Array.from({ length: m.count }, (_, i) => base + (i === activeIndex ? boost : 0));
}

/** Left edge of every slot for a set of widths. */
export function slotOffsets(m: BarMetrics, widths: number[]): number[] {
  const offsets: number[] = [];
  let cursor = m.padding;
  for (const w of widths) {
    offsets.push(cursor);
    cursor += w;
  }
  return offsets;
}

export function slotCenter(m: BarMetrics, widths: number[], index: number): number {
  if (index < 0 || index >= widths.length) return m.width / 2;
  const offsets = slotOffsets(m, widths);
  return offsets[index] + widths[index] / 2;
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function lerpFrame(from: BarFrame, to: BarFrame, t: number, scale = 1): BarFrame {
  return {
    widths: to.widths.map((w, i) => lerp(from.widths[i] ?? w, w, t)),
    x: lerp(from.x, to.x, t),
    scale,
  };
}

/** The resting frame for `activeIndex`. */
export function restingFrame(m: BarMetrics, activeIndex: number): BarFrame {
  const widths = slotWidths(m, activeIndex);
  return { widths, x: slotCenter(m, widths, activeIndex), scale: 1 };
}

/**
 * Half-width of the notch where it meets the top edge: the fillet circle sits tangent to the top
 * edge (centre `fillet` below it) and tangent to the notch circle from outside, so the distance
 * between their centres is the sum of the radii.
 */
export function notchHalfWidth(spec: NotchSpec, scale = 1): number {
  const r = spec.buttonRadius * scale + spec.gap;
  const dy = spec.fillet - spec.centerY;
  return Math.sqrt(Math.max(0, (r + spec.fillet) ** 2 - dy ** 2));
}

/** Rounded top edge corners, shrunk so they end where the notch or hill begins. */
function cornerRadii(m: BarMetrics, x: number, reach: number) {
  const max = Math.min(m.radius, m.height / 2);
  return {
    left: clamp(x - reach, 0, max),
    right: clamp(m.width - x - reach, 0, max),
    bottom: max,
  };
}

function outlineStart(left: number) {
  return left > 0 ? `M0 ${round(left)} A${round(left)} ${round(left)} 0 0 1 ${round(left)} 0` : 'M0 0';
}

function outlineEnd(m: BarMetrics, right: number, bottom: number) {
  const w = m.width;
  const h = m.height;
  const topRight =
    right > 0
      ? `L${round(w - right)} 0 A${round(right)} ${round(right)} 0 0 1 ${round(w)} ${round(right)}`
      : `L${round(w)} 0`;
  return [
    topRight,
    `L${round(w)} ${round(h - bottom)}`,
    `A${round(bottom)} ${round(bottom)} 0 0 1 ${round(w - bottom)} ${round(h)}`,
    `L${round(bottom)} ${round(h)}`,
    `A${round(bottom)} ${round(bottom)} 0 0 1 0 ${round(h - bottom)}`,
    'Z',
  ].join(' ');
}

/** The top-edge segment of the notch, from its left shoulder to its right shoulder. */
function notchSegment(spec: NotchSpec, x: number, scale: number) {
  const r = spec.buttonRadius * scale + spec.gap;
  const f = spec.fillet;
  const fx = notchHalfWidth(spec, scale);
  const cy = spec.centerY;
  const dist = r + f;
  // A notch shrunk to nothing (no active tab) is just the straight top edge.
  if (dist < 0.5 || fx < 0.5) return '';
  // Tangent points lie on the line between each fillet centre and the notch centre.
  const t1x = x - fx + (fx / dist) * f;
  const t1y = f + ((cy - f) / dist) * f;
  const t2x = x + fx - (fx / dist) * f;
  const t2y = t1y;
  // The notch arc passes under the button; it spans more than half a circle only if the fillet
  // centres sit above the button's centre, which no sensible spec does — but stay correct if one does.
  const large = f - cy < 0 ? 1 : 0;
  return [
    `L${round(x - fx)} 0`,
    `A${round(f)} ${round(f)} 0 0 1 ${round(t1x)} ${round(t1y)}`,
    `A${round(r)} ${round(r)} 0 ${large} 0 ${round(t2x)} ${round(t2y)}`,
    `A${round(f)} ${round(f)} 0 0 1 ${round(x + fx)} 0`,
  ].join(' ');
}

/** Keeps the notch or hill inside the bar even when the indicator overshoots an end slot. */
function clampCenter(m: BarMetrics, x: number, reach: number) {
  return m.width <= reach * 2 ? m.width / 2 : clamp(x, reach, m.width - reach);
}

/** The bar outline with a smooth notch under the floating button at `x`. */
export function notchedBarPath(m: BarMetrics, spec: NotchSpec, x: number, scale = 1): string {
  if (m.width <= 0 || m.height <= 0) return '';
  const reach = notchHalfWidth(spec, scale);
  const cx = clampCenter(m, x, reach);
  const corners = cornerRadii(m, cx, reach);
  return [outlineStart(corners.left), notchSegment(spec, cx, scale), outlineEnd(m, corners.right, corners.bottom)].filter(Boolean).join(' ');
}

/** The top-edge segment of the hill: a bell of two cubics, flat at both feet and at the crest. */
function bumpSegment(spec: BumpSpec, x: number) {
  const hw = spec.halfWidth;
  const top = -spec.rise;
  if (hw < 0.5) return '';
  return [
    `L${round(x - hw)} 0`,
    `C${round(x - hw * 0.55)} 0 ${round(x - hw * 0.5)} ${round(top)} ${round(x)} ${round(top)}`,
    `C${round(x + hw * 0.5)} ${round(top)} ${round(x + hw * 0.55)} 0 ${round(x + hw)} 0`,
  ].join(' ');
}

/** The bar outline with a hill rising around `x` — the neon variant. */
export function bumpedBarPath(m: BarMetrics, spec: BumpSpec, x: number): string {
  if (m.width <= 0 || m.height <= 0) return '';
  const cx = clampCenter(m, x, spec.halfWidth);
  const corners = cornerRadii(m, cx, spec.halfWidth);
  return [outlineStart(corners.left), bumpSegment(spec, cx), outlineEnd(m, corners.right, corners.bottom)].filter(Boolean).join(' ');
}

/**
 * Only the top edge of the bumped bar, corner to corner — the neon variant strokes this with a
 * gradient centred on the active tab, so the glow travels along the rim instead of outlining the pill.
 */
export function bumpedTopEdgePath(m: BarMetrics, spec: BumpSpec, x: number): string {
  if (m.width <= 0 || m.height <= 0) return '';
  const cx = clampCenter(m, x, spec.halfWidth);
  const corners = cornerRadii(m, cx, spec.halfWidth);
  return [`M${round(corners.left)} 0`, bumpSegment(spec, cx), `L${round(m.width - corners.right)} 0`].filter(Boolean).join(' ');
}

/** Clamped centre used by the paths, exposed so the button and glow line up with the notch exactly. */
export function indicatorCenter(m: BarMetrics, reach: number, x: number) {
  return clampCenter(m, x, reach);
}

/**
 * Ease-out with a small overshoot: the indicator lands a touch past the tab and settles back,
 * which reads as springy without an actual spring simulation.
 */
export function easeOutBack(t: number, overshoot = 1.2) {
  const c3 = overshoot + 1;
  const p = t - 1;
  return 1 + c3 * p * p * p + overshoot * p * p;
}
