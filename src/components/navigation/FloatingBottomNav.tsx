'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/components/theme/ThemeProvider';
import { ActiveIndicator } from './ActiveIndicator';
import { NavItem, type FloatingNavItem } from './NavItem';
import {
  bumpedBarPath,
  bumpedTopEdgePath,
  clamp,
  easeOutBack,
  fitInView,
  indicatorCenter,
  indicatorTarget,
  labelBoxes,
  lerp,
  notchHalfWidth,
  notchedBarPath,
  revealScroll,
  slotLayout,
  type BarFrame,
  type BarMetrics,
  type BumpSpec,
  type LabelFit,
  type NavShape,
  type NotchSpec,
} from './geometry';
import { DEFAULT_FLOATING_NAV_THEME, floatingNavThemeMeta, type FloatingNavTheme } from './themes';

export type { FloatingNavItem } from './NavItem';

/* Keep in step with `.fbn` / `.fbn-svg` / `.fbn-indicator` / `.fbn-track` in globals.css. */
const BAR_HEIGHT = 60;
const BAR_RADIUS = 24;
const SVG_OVERHANG = 28;
const BUTTON_SIZE = 44;
const SPOT_WIDTH = 80;
/**
 * Inset before the first slot and after the last — enough that the notch under an end tab still
 * leaves the pill a rounded corner with seven slots on a 360px phone.
 */
const PADDING = 17;
/**
 * The button sits just above the rim — low enough that the active label can tuck in right under
 * it, high enough that the notch stays narrow at the rim and clears the neighbouring icons.
 */
const NOTCH: NotchSpec = { buttonRadius: BUTTON_SIZE / 2, gap: 3, centerY: -4, fillet: 7 };
const BUMP: BumpSpec = { rise: 12, halfWidth: 36 };
const TRAVEL_MS = 480;
/** How far either side of the active tab the neon rim stays lit. */
const RIM_REACH = 110;
/** Most strip tabs in view at once; any past this scroll. Fewer show when their labels need the room. */
const DEFAULT_MAX_IN_VIEW = 6;
/**
 * Keep 6px between neighbouring labels; cap a label at 60px; slots of at least 40px; never fewer
 * than three tabs; and show as many as leave three in five neighbouring label pairs whole — a long
 * label beside a short one borrows its room, so in practice only long-beside-long ends in "…".
 */
const LABEL_FIT: LabelFit = { gap: 6, maxLabel: 60, minSlot: 40, minInView: 3, coverage: 0.6 };

const HIDE_CLASS = { md: 'md:hidden', lg: 'lg:hidden', xl: 'xl:hidden' } as const;
const BREAKPOINT_PX = { md: 768, lg: 1024, xl: 1280 } as const;

/**
 * A page with its own bar pinned to the bottom (a form's Save/Submit strip) gets the screen to
 * itself, the way a pushed screen hides the tab bar on iOS — stacking the two would leave a phone
 * with a fifth of its height in chrome. `data-floating-nav="hide"` lets any page ask explicitly.
 */
const ACTION_BAR_SELECTOR = '.sticky.bottom-0, .hr-sticky-actions, .tt-sticky-actions, [data-floating-nav="hide"]';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function scaleNotch(s: number): NotchSpec {
  return { buttonRadius: NOTCH.buttonRadius * s, gap: NOTCH.gap * s, centerY: NOTCH.centerY * s, fillet: NOTCH.fillet * s };
}

function scaleBump(s: number): BumpSpec {
  return { rise: BUMP.rise * s, halfWidth: BUMP.halfWidth * s };
}

/** Width of the sliding marker: a capsule or tile just inside its slot, or a short fixed line. */
function markWidth(shape: NavShape, slot: number) {
  if (shape === 'line') return 22;
  return clamp(slot - 4, 36, shape === 'pill' ? 76 : 80);
}

function useMediaQuery(query: string | null, serverValue: boolean) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!query) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (query ? window.matchMedia(query).matches : true),
    () => serverValue,
  );
}

function isTextEntry(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image', 'hidden'].includes(type);
}

function hasActionBar() {
  for (const el of document.querySelectorAll(ACTION_BAR_SELECTOR)) {
    // A dialog's own sticky footer: the dialog's overlay already covers the bar.
    if (el.closest('[role="dialog"], .fbn')) continue;
    if (el.getClientRects().length > 0) return true;
  }
  return false;
}

/**
 * When the bar should step out of the way: scrolling down (back on scrolling up, near the top or
 * at the very bottom), while the on-screen keyboard is up, and on pages with their own action bar.
 */
function useAutoHide(enabled: boolean, resetKey: string | null) {
  const [scrolledAway, setScrolledAway] = useState(false);
  const [typing, setTyping] = useState(false);
  const [actionBar, setActionBar] = useState(false);

  // Both resets are made during render, not in an effect, so the bar never paints a frame in the
  // wrong state: a new tab brings it back, and switching auto-hide off forgets what it had seen, so
  // turning it on again starts from a visible bar.
  const [shownKey, setShownKey] = useState(resetKey);
  if (shownKey !== resetKey) {
    setShownKey(resetKey);
    setScrolledAway(false);
  }
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    setScrolledAway(false);
    setTyping(false);
    setActionBar(false);
  }

  useEffect(() => {
    if (!enabled) return;
    let anchor = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 24;
        if (y < 64 || atEnd) {
          setScrolledAway(false);
          anchor = y;
        } else if (Math.abs(y - anchor) > 12) {
          setScrolledAway(y > anchor);
          anchor = y;
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    // Only a touch keyboard takes screen space; a desktop window narrowed to phone width keeps its bar.
    const coarse = window.matchMedia('(pointer: coarse)');
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      // Focus is on <body> between focusout and the next focusin, so look once it has settled.
      timer = window.setTimeout(() => setTyping(coarse.matches && isTextEntry(document.activeElement)), 0);
    };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      setActionBar(hasActionBar());
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);

  // Nothing is hidden while auto-hide is off, whatever was last seen.
  if (!enabled) return { hidden: false, actionBar: false };
  return { hidden: scrolledAway || typing || actionBar, actionBar };
}

export interface FloatingBottomNavProps {
  /**
   * In display order. Items marked `pinned` (a "More" menu) stay at the right-hand end; the rest
   * form a strip that scrolls sideways once there are more than `maxInView` of them.
   */
  items: FloatingNavItem[];
  /** Key of the active item; `null` when none is (the notch then closes up). */
  activeItem?: string | null;
  onChange?: (key: string, item: FloatingNavItem) => void;
  theme?: FloatingNavTheme;
  /** Labels under every icon (default), or only under the active one. */
  showLabels?: boolean;
  /** Strip tabs in view at once (default 6). Fewer than this spread out to fill the bar. */
  maxInView?: number;
  /** Badge shown on the item keyed `notificationItem` (default `inbox`) unless it sets its own. */
  notificationCount?: number;
  notificationItem?: string;
  /** `absolute` pins the bar to the bottom of its positioned parent — for previews. */
  position?: 'fixed' | 'absolute';
  /** Hidden from this breakpoint up, where a module's sidebar takes over. `null` never hides. */
  hideAbove?: keyof typeof HIDE_CLASS | null;
  /** Step aside while scrolling down, typing, or on a page with its own action bar. */
  autoHide?: boolean;
  /** Reserve space at the end of the page so the last row can scroll clear of the bar. */
  spacer?: boolean;
  ariaLabel?: string;
  className?: string;
}

interface Travel {
  from: BarFrame;
  start: number;
  /** Moving between two visible tabs, not growing or shrinking in place: the button dips mid-flight. */
  travels: boolean;
}

/**
 * A floating pill-shaped bottom navigation bar whose active tab is marked by a button riding a
 * curved notch (or, in the neon theme, a glowing hill in the rim) that slides between tabs.
 *
 * The tabs sit in a strip that scrolls natively (swipe, snap, momentum), with pinned items such as
 * "More" held outside it. The notch and button are not inside the strip — they have to stay one
 * smooth outline with the bar — so they are redrawn against the strip's scroll position every frame
 * it moves, and shrink away when the active tab is scrolled out of view. Geometry is written
 * straight to the DOM rather than through React; see `geometry.ts` for the shapes.
 */
export function FloatingBottomNav({
  items,
  activeItem = null,
  onChange,
  theme = DEFAULT_FLOATING_NAV_THEME,
  showLabels = true,
  maxInView = DEFAULT_MAX_IN_VIEW,
  notificationCount,
  notificationItem = 'inbox',
  position = 'fixed',
  hideAbove = 'lg',
  autoHide = true,
  spacer = true,
  ariaLabel = 'Primary',
  className,
}: FloatingBottomNavProps) {
  const shape = floatingNavThemeMeta[theme].shape;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  // A tapped link is marked active straight away rather than when the route finally changes.
  const [pending, setPending] = useState<string | null>(null);
  // The route catching up (or moving elsewhere) ends the wait — dropped during render, not in an effect.
  const [seenActive, setSeenActive] = useState(activeItem);
  if (seenActive !== activeItem) {
    setSeenActive(activeItem);
    setPending(null);
  }
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setPending(null), 6000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  // Strip tabs first, then the pinned ones: every index below is into this order.
  const ordered = useMemo(() => {
    const resolved =
      notificationCount === undefined
        ? items
        : items.map((item) =>
            item.key === notificationItem && item.badge === undefined ? { ...item, badge: notificationCount } : item,
          );
    return [...resolved.filter((item) => !item.pinned), ...resolved.filter((item) => item.pinned)];
  }, [items, notificationCount, notificationItem]);
  const stripCount = ordered.filter((item) => !item.pinned).length;
  const currentKey = pending ?? activeItem;
  const activeIndex = ordered.findIndex((item) => item.key === currentKey);

  const inView = useMediaQuery(hideAbove ? `(max-width: ${BREAKPOINT_PX[hideAbove] - 0.02}px)` : null, false);
  // The user's own Reduced motion setting, or the device's.
  const reducedMotion = useReducedMotion();
  const { hidden, actionBar } = useAutoHide(position === 'fixed' && autoHide && inView, currentKey);

  const stageRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const barPathRef = useRef<SVGPathElement>(null);
  const rimRef = useRef<SVGPathElement>(null);
  const rimGlowRef = useRef<SVGPathElement>(null);
  const gradientRef = useRef<SVGLinearGradientElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  // A removed tab's ref callback nulls its slot, so the array can run past `ordered` with trailing
  // nulls; `onKeyDown` skips empty slots.
  const slotEls = useRef<(HTMLElement | null)[]>([]);
  const frameRef = useRef<BarFrame | null>(null);
  const travelRef = useRef<Travel | null>(null);
  const drawnRef = useRef({ width: 0, count: 0, slot: 0 });
  const rafRef = useRef(0);
  const [width, setWidth] = useState(0);

  useIsoLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Every label's natural width as rendered — its font, weight and the user's text size — which
  // decides how many tabs fit side by side without their labels touching. Read again whenever the
  // labels change, and once web fonts arrive (a fallback font measures differently).
  const count = ordered.length;
  const labelKey = ordered.map((item) => item.label).join('\u0000');
  const [labelWidths, setLabelWidths] = useState<number[] | null>(null);
  useIsoLayoutEffect(() => {
    if (!showLabels) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const next = Array.from({ length: count }, (_, i) => {
        const text = slotEls.current[i]?.querySelector<HTMLElement>('.fbn-label-text');
        // offsetWidth is layout size, untouched by the bar's entrance scale; +1 for its rounding.
        return text ? text.offsetWidth + 1 : 0;
      });
      setLabelWidths((prev) => (prev && prev.length === next.length && prev.every((w, i) => w === next[i]) ? prev : next));
    };
    measure();
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    void fonts?.ready.then(measure);
    fonts?.addEventListener('loadingdone', measure);
    return () => {
      cancelled = true;
      fonts?.removeEventListener('loadingdone', measure);
    };
  }, [labelKey, count, showLabels]);

  const pinnedCount = count - stripCount;
  // Labels only under the active tab never meet a neighbour, and unmeasured ones are unknown.
  const measured = showLabels && labelWidths !== null && labelWidths.length === count ? labelWidths : null;
  const inViewCount = useMemo(() => {
    const cap = Math.max(1, maxInView);
    if (!measured) return cap;
    return fitInView(width, PADDING, measured.slice(0, stripCount), measured.slice(stripCount), cap, LABEL_FIT);
  }, [measured, width, stripCount, maxInView]);
  const layout = useMemo(
    () => slotLayout(width, PADDING, stripCount, pinnedCount, Math.max(1, inViewCount)),
    [width, stripCount, pinnedCount, inViewCount],
  );
  // Each label's box, sized against its neighbours so no two can overlap (see `labelBoxes`).
  const labelBoxWidths = useMemo(
    () => (measured && layout.slot > 0 ? labelBoxes(layout.slot, measured.slice(0, stripCount), measured.slice(stripCount), LABEL_FIT) : null),
    [measured, layout.slot, stripCount],
  );
  const slotStyle = (i: number, extra?: CSSProperties): CSSProperties => ({
    width: layout.slot,
    ...(labelBoxWidths ? ({ '--fbn-label-w': `${labelBoxWidths[i]}px` } as CSSProperties) : null),
    ...extra,
  });

  /** Draw one frame. `lifted` says whether the active icon should ride up into the button. */
  const paint = useCallback(
    (frame: BarFrame, lifted: boolean) => {
      const metrics: BarMetrics = { width, height: BAR_HEIGHT, radius: BAR_RADIUS };
      const s = frame.scale;
      const indicator = indicatorRef.current;
      if (shape === 'notch') {
        const spec = scaleNotch(s);
        const cx = indicatorCenter(metrics, notchHalfWidth(spec), frame.x);
        barPathRef.current?.setAttribute('d', notchedBarPath(metrics, spec, cx));
        if (indicator) {
          const half = BUTTON_SIZE / 2;
          indicator.style.transform = `translate3d(${cx - half}px, ${spec.centerY - half}px, 0) scale(${s})`;
          indicator.style.opacity = s < 0.05 ? '0' : '1';
        }
      } else if (shape !== 'bump') {
        // Pill, tile, line: the bar stays a plain pill and one marker slides along it, sized to
        // the slot. The line shrinks sideways only, so it never thickens as it lands.
        barPathRef.current?.setAttribute('d', notchedBarPath(metrics, scaleNotch(0), frame.x));
        if (indicator) {
          const w = markWidth(shape, layout.slot);
          const cx = indicatorCenter(metrics, w / 2, frame.x);
          indicator.style.width = `${w}px`;
          indicator.style.transform = `translate3d(${cx - w / 2}px, 0, 0) scale(${shape === 'line' ? `${s}, 1` : s})`;
          indicator.style.opacity = s < 0.05 ? '0' : '1';
        }
      } else {
        const spec = scaleBump(s);
        const cx = indicatorCenter(metrics, spec.halfWidth, frame.x);
        barPathRef.current?.setAttribute('d', bumpedBarPath(metrics, spec, cx));
        const rim = bumpedTopEdgePath(metrics, spec, cx);
        for (const path of [rimRef.current, rimGlowRef.current]) {
          path?.setAttribute('d', rim);
          if (path) path.style.opacity = String(s);
        }
        gradientRef.current?.setAttribute('x1', String(cx - RIM_REACH));
        gradientRef.current?.setAttribute('x2', String(cx + RIM_REACH));
        if (indicator) {
          indicator.style.transform = `translate3d(${cx - SPOT_WIDTH / 2}px, 0, 0)`;
          indicator.style.opacity = String(s);
        }
      }
      stageRef.current?.setAttribute('data-lifted', lifted ? 'true' : 'false');
      frameRef.current = frame;
    },
    [width, shape, layout.slot],
  );

  /** Where the indicator belongs right now, with the strip wherever it has been scrolled to. */
  const liveTarget = useCallback((): BarFrame => {
    // With nothing active the notch closes where it last was, rather than drifting to the middle.
    if (activeIndex < 0 && frameRef.current) return { x: frameRef.current.x, scale: 0 };
    return indicatorTarget(layout, activeIndex, trackRef.current?.scrollLeft ?? 0);
  }, [layout, activeIndex]);

  /** Paint the current frame; true while a travel is still under way. */
  const render = useCallback(() => {
    const target = liveTarget();
    const travel = travelRef.current;
    let frame = target;
    if (travel) {
      const u = Math.min(1, (performance.now() - travel.start) / TRAVEL_MS);
      const glide = easeOutBack(u, 1.1);
      const settle = 1 - (1 - u) ** 3;
      // The button dips a little mid-flight and swells back as it lands; the notch follows it.
      const dip = travel.travels ? 0.12 * Math.sin(Math.PI * u) : 0;
      frame = {
        x: lerp(travel.from.x, target.x, glide),
        scale: lerp(travel.from.scale, target.scale, settle) * (1 - dip),
      };
      if (u >= 1) travelRef.current = null;
    }
    paint(frame, target.scale > 0.6);
    return travelRef.current !== null;
  }, [liveTarget, paint]);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    const loop = () => {
      rafRef.current = 0;
      if (render()) rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [render]);

  useIsoLayoutEffect(() => {
    if (width <= 0 || ordered.length === 0) return;
    const previous = frameRef.current;
    // A new slot width (the bar resized, or its labels re-measured) moves every tab: jump, not glide.
    const resized =
      drawnRef.current.width !== width || drawnRef.current.count !== ordered.length || drawnRef.current.slot !== layout.slot;
    drawnRef.current = { width, count: ordered.length, slot: layout.slot };
    const instant = !previous || resized || reducedMotion;

    // Keep the active tab in view: already there on arrival, scrolled to after a change elsewhere.
    const track = trackRef.current;
    if (track) {
      const reveal = revealScroll(layout, activeIndex, track.scrollLeft);
      if (reveal !== null) track.scrollTo({ left: reveal, behavior: instant ? 'instant' : 'smooth' });
    }

    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    const target = liveTarget();
    if (instant || !previous) {
      travelRef.current = null;
      paint(target, target.scale > 0.6);
      return;
    }
    // Coming back from "nothing active", grow in place rather than sliding in from the old spot.
    const from = previous.scale < 0.05 ? { x: target.x, scale: previous.scale } : previous;
    travelRef.current = {
      from,
      start: performance.now(),
      travels: Math.abs(from.x - target.x) > 0.5 && from.scale > 0.5 && target.scale > 0.5,
    };
    // Paint the starting frame now: a theme switch mounts fresh paths that would otherwise sit
    // empty until the first animation frame.
    paint(from, target.scale > 0.6);
    schedule();
    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [width, ordered.length, activeIndex, layout, liveTarget, paint, schedule, reducedMotion]);

  // The strip's own scrolling: redraw the notch against it, fade whichever edge has more to see,
  // and let a mouse wheel (which only scrolls up and down) move it sideways.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const edges = () => {
      const end = track.scrollWidth - track.clientWidth;
      track.setAttribute('data-at-start', track.scrollLeft <= 1 ? 'true' : 'false');
      track.setAttribute('data-at-end', track.scrollLeft >= end - 1 ? 'true' : 'false');
    };
    const onScroll = () => {
      edges();
      schedule();
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (track.scrollWidth <= track.clientWidth + 1) return;
      event.preventDefault();
      track.scrollBy({ left: event.deltaY });
    };
    edges();
    track.addEventListener('scroll', onScroll, { passive: true });
    track.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      track.removeEventListener('scroll', onScroll);
      track.removeEventListener('wheel', onWheel);
    };
  }, [schedule, layout]);

  const onSelect = (item: FloatingNavItem, event: MouseEvent<HTMLElement>) => {
    onChange?.(item.key, item);
    const plainClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (item.href && plainClick && !event.defaultPrevented) setPending(item.key);
  };

  // Arrow keys move between tabs, as in any toolbar; Tab still leaves the bar. Focusing a tab the
  // strip has scrolled away brings it into view.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const slots = slotEls.current.filter((el): el is HTMLElement => Boolean(el));
    const index = slots.indexOf(event.currentTarget);
    const last = slots.length - 1;
    const next =
      event.key === 'ArrowRight' ? (index + 1) % slots.length
      : event.key === 'ArrowLeft' ? (index - 1 + slots.length) % slots.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : -1;
    if (next < 0 || index < 0) return;
    event.preventDefault();
    slots[next]?.focus();
  };

  const hideClass = hideAbove ? HIDE_CLASS[hideAbove] : undefined;
  const slotRef = (i: number) => (el: HTMLElement | null) => {
    slotEls.current[i] = el;
  };

  return (
    <>
      <div
        className={cn('fbn', hideClass, className)}
        data-theme={theme}
        data-shape={shape}
        data-labels={showLabels ? 'all' : 'active'}
        data-position={position}
        data-hidden={hidden ? 'true' : 'false'}
        data-measured={width > 0 ? 'true' : 'false'}
      >
        <nav ref={stageRef} className="fbn-stage" aria-label={ariaLabel}>
          <svg
            className="fbn-svg"
            width={width}
            height={BAR_HEIGHT + SVG_OVERHANG}
            viewBox={`0 ${-SVG_OVERHANG} ${Math.max(width, 1)} ${BAR_HEIGHT + SVG_OVERHANG}`}
            aria-hidden="true"
            focusable="false"
          >
            {shape === 'bump' && (
              <defs>
                <linearGradient ref={gradientRef} id={`${uid}-rim`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="0">
                  <stop offset="0" style={{ stopColor: 'var(--fbn-accent)', stopOpacity: 0 }} />
                  <stop offset="0.32" style={{ stopColor: 'var(--fbn-accent)', stopOpacity: 0.55 }} />
                  <stop offset="0.5" style={{ stopColor: 'var(--fbn-accent)', stopOpacity: 1 }} />
                  <stop offset="0.68" style={{ stopColor: 'var(--fbn-accent)', stopOpacity: 0.55 }} />
                  <stop offset="1" style={{ stopColor: 'var(--fbn-accent)', stopOpacity: 0 }} />
                </linearGradient>
                <filter id={`${uid}-blur`} x="-10%" y="-300%" width="120%" height="700%">
                  <feGaussianBlur stdDeviation="3.5" />
                </filter>
              </defs>
            )}
            <path ref={barPathRef} className="fbn-bar-path" />
            {shape === 'bump' && (
              <>
                <path ref={rimGlowRef} className="fbn-rim-glow" stroke={`url(#${uid}-rim)`} strokeWidth={6} filter={`url(#${uid}-blur)`} />
                <path ref={rimRef} className="fbn-rim-glow" stroke={`url(#${uid}-rim)`} strokeWidth={2} />
              </>
            )}
          </svg>
          <ActiveIndicator shape={shape} glowKey={currentKey ?? 'none'} indicatorRef={indicatorRef} />
          <div
            ref={trackRef}
            className="fbn-track"
            data-scrollable={layout.scrollable ? 'true' : 'false'}
            style={{ left: layout.trackLeft, width: layout.trackWidth }}
          >
            <div className="fbn-track-content" style={{ width: layout.contentWidth }}>
              {ordered.slice(0, stripCount).map((item, i) => (
                <NavItem
                  key={item.key}
                  item={item}
                  active={i === activeIndex}
                  slotRef={slotRef(i)}
                  style={slotStyle(i)}
                  onSelect={onSelect}
                  onKeyDown={onKeyDown}
                />
              ))}
            </div>
          </div>
          {ordered.slice(stripCount).map((item, j) => {
            const i = stripCount + j;
            return (
              <NavItem
                key={item.key}
                item={item}
                active={i === activeIndex}
                slotRef={slotRef(i)}
                style={slotStyle(i, {
                  transform: `translate3d(${layout.trackLeft + layout.trackWidth + j * layout.slot}px, 0, 0)`,
                })}
                onSelect={onSelect}
                onKeyDown={onKeyDown}
              />
            );
          })}
        </nav>
      </div>
      {spacer && position === 'fixed' && !actionBar && <div className={cn('fbn-spacer', hideClass)} aria-hidden="true" />}
    </>
  );
}

export default FloatingBottomNav;
