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

/**
 * How the active tab is marked. `notch` and `bump` reshape the bar's outline around it; `pill`,
 * `tile` and `line` leave the bar a plain pill and slide a marker along it instead.
 */
export type NavShape = 'notch' | 'bump' | 'pill' | 'tile' | 'line';

export interface BarMetrics {
  /** Bar width in px (measured). */
  width: number;
  /** Bar height in px, excluding anything that floats above it. */
  height: number;
  /** Corner radius of the pill. The top corners shrink when the notch reaches them. */
  radius: number;
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
  /** Horizontal centre of the active indicator, in bar coordinates. */
  x: number;
  /** Scale of the floating button (the notch follows it). */
  scale: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/* ── Slots ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * Where the slots go. The bar holds a strip of tabs that scrolls sideways, then any pinned items
 * ("More") that stay put at the right-hand end. Every slot is the same width: up to `maxInView`
 * strip tabs plus the pinned ones share the bar, so a short list spreads out to fill it and a long
 * one shows exactly `maxInView` at a time with the rest a swipe away.
 */
export interface SlotLayout {
  /** Width of every slot, strip and pinned alike. */
  slot: number;
  /** Tabs in the strip, and pinned items after it. */
  count: number;
  pinned: number;
  /** Strip tabs visible at once. */
  inView: number;
  /** Left edge of the strip in bar coordinates — the bar's own inset. */
  trackLeft: number;
  /** Visible width of the strip. */
  trackWidth: number;
  /** Width of everything in the strip; more than `trackWidth` exactly when it scrolls. */
  contentWidth: number;
  scrollable: boolean;
}

export function slotLayout(width: number, padding: number, count: number, pinned: number, maxInView: number): SlotLayout {
  const inView = Math.max(0, Math.min(count, maxInView));
  const slots = inView + pinned;
  const inner = Math.max(0, width - padding * 2);
  const slot = slots > 0 ? inner / slots : 0;
  return {
    slot,
    count,
    pinned,
    inView,
    trackLeft: padding,
    trackWidth: inView * slot,
    contentWidth: count * slot,
    scrollable: count > inView,
  };
}

/** How the bar sizes its tabs around their labels. */
export interface LabelFit {
  /** Clear space kept between two neighbouring labels. */
  gap: number;
  /** No label box is wider than this; longer labels end in "…". */
  maxLabel: number;
  /** Narrowest a slot may get, however short the labels — it is still a thumb's tap target. */
  minSlot: number;
  /** Fewest strip tabs to show, however long the labels. */
  minInView: number;
  /**
   * Share of neighbouring label pairs that should fit in full. The rest — the odd "Insurance
   * Workflow" among "Trips" and "Fuel" — end in "…" rather than cost every page of the bar a tab.
   */
  coverage: number;
}

/** The value `share` of the way through `values` once sorted (linear between neighbours). */
function quantile(values: readonly number[], share: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = clamp(share, 0, 1) * (sorted.length - 1);
  const low = Math.floor(at);
  const high = Math.min(sorted.length - 1, low + 1);
  return lerp(sorted[low], sorted[high], at - low);
}

/**
 * How many strip tabs to show at once: the most, up to `maxInView`, whose slots are wide enough for
 * `coverage` of the neighbouring label pairs to sit side by side in full.
 *
 * Two centred labels one slot apart clear each other when half of each, plus the gap, fits in the
 * slot. Widths are the labels as rendered — font, weight, the user's text size — so a bar of short
 * names shows six, and long names or large text show fewer. Whatever the count, `labelBoxes` keeps
 * every pair from overlapping; this only decides how often a label has to end in "…".
 */
export function fitInView(
  width: number,
  padding: number,
  strip: readonly number[],
  pinned: readonly number[],
  maxInView: number,
  fit: LabelFit,
): number {
  const count = strip.length;
  if (count === 0) return 0;
  const clip = (w: number) => Math.min(Math.max(0, w), fit.maxLabel);
  const pairs: number[] = [];
  for (let i = 0; i + 1 < count; i++) pairs.push((clip(strip[i]) + clip(strip[i + 1])) / 2);
  if (pinned.length) pairs.push((clip(strip[count - 1]) + clip(pinned[0])) / 2);
  // A lone tab is its own "pair".
  if (!pairs.length) pairs.push(clip(strip[0]));
  const needed = Math.max(fit.minSlot, quantile(pairs, fit.coverage) + fit.gap);
  const inner = Math.max(0, width - padding * 2);
  const slots = Math.floor(inner / needed + 1e-9);
  const upper = Math.max(1, Math.min(maxInView, count));
  return clamp(slots - pinned.length, Math.min(fit.minInView, upper), upper);
}

/**
 * Width of every label's box, strip tabs then pinned items, such that no two labels that can end up
 * side by side ever overlap — whatever the slot width, the scroll position or the label lengths.
 *
 * Each label may use half a slot less half the gap on a side, plus whatever a shorter neighbour
 * leaves unused. Worked through for a pair: two long labels get half the room each; a short one
 * keeps its own width and the long one gets the rest; two short ones fit anyway. The neighbours
 * checked are the tabs either side in the strip, and "More" for every strip tab — any of them can
 * scroll to the end beside it; and for "More", the longest strip tab.
 */
export function labelBoxes(slot: number, strip: readonly number[], pinned: readonly number[], fit: LabelFit): number[] {
  const clip = (w: number) => Math.min(Math.max(0, w), fit.maxLabel);
  const room = Math.max(0, slot - fit.gap);
  // How much of the shared room a label may take beside this neighbour.
  const beside = (neighbour: number) => Math.max(room / 2, room - clip(neighbour) / 2);
  const box = (neighbours: number[]) =>
    Math.max(0, Math.min(fit.maxLabel, 2 * Math.min(fit.maxLabel / 2, ...neighbours.map(beside))));
  const longestStrip = strip.length ? Math.max(...strip.map(clip)) : 0;
  const stripBoxes = strip.map((_, i) =>
    box([
      ...(i > 0 ? [strip[i - 1]] : []),
      ...(i + 1 < strip.length ? [strip[i + 1]] : []),
      ...(pinned.length ? [pinned[0]] : []),
    ]),
  );
  const pinnedBoxes = pinned.map((_, j) =>
    box([
      ...(strip.length && j === 0 ? [longestStrip] : []),
      ...(j > 0 ? [pinned[j - 1]] : []),
      ...(j + 1 < pinned.length ? [pinned[j + 1]] : []),
    ]),
  );
  return [...stripBoxes, ...pinnedBoxes];
}

/** Furthest the strip can scroll. */
export function maxScroll(layout: SlotLayout) {
  return Math.max(0, layout.contentWidth - layout.trackWidth);
}

/**
 * The indicator's resting place for slot `index` (strip tabs first, then pinned items) with the
 * strip scrolled to `scrollLeft`. A strip tab scrolled partly out of view shrinks its indicator —
 * gone by the time half the tab is hidden — rather than letting it slide over the pinned "More".
 * Returns scale 0 for an index that is not a slot.
 */
export function indicatorTarget(layout: SlotLayout, index: number, scrollLeft: number): BarFrame {
  const { slot, trackLeft, trackWidth } = layout;
  if (index < 0 || index >= layout.count + layout.pinned || slot <= 0) {
    return { x: trackLeft + (trackWidth + layout.pinned * slot) / 2, scale: 0 };
  }
  if (index >= layout.count) {
    const left = trackLeft + trackWidth + (index - layout.count) * slot;
    return { x: left + slot / 2, scale: 1 };
  }
  const left = trackLeft + index * slot - scrollLeft;
  const right = trackLeft + trackWidth;
  // Snapped scroll positions land within a rounding error of a slot edge; that is not "hidden".
  const hidden = Math.max(0, trackLeft - left) + Math.max(0, left + slot - right);
  const shown = hidden < 0.5 ? 1 : 1 - hidden / slot;
  return {
    x: clamp(left + slot / 2, trackLeft, right),
    scale: clamp((shown - 0.5) * 2, 0, 1),
  };
}

/**
 * Where to scroll the strip so strip tab `index` is in view: `null` when it already fully is,
 * otherwise the position that centres it as nearly as the ends allow, on a whole slot so it agrees
 * with the strip's scroll snapping.
 */
export function revealScroll(layout: SlotLayout, index: number, scrollLeft: number): number | null {
  if (!layout.scrollable || index < 0 || index >= layout.count || layout.slot <= 0) return null;
  const left = index * layout.slot;
  const epsilon = 0.5;
  if (left >= scrollLeft - epsilon && left + layout.slot <= scrollLeft + layout.trackWidth + epsilon) return null;
  const first = clamp(Math.round(index - (layout.inView - 1) / 2), 0, layout.count - layout.inView);
  return clamp(first * layout.slot, 0, maxScroll(layout));
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
