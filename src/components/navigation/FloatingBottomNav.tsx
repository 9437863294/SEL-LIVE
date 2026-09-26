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
  easeOutBack,
  indicatorCenter,
  lerp,
  notchHalfWidth,
  notchedBarPath,
  restingFrame,
  slotOffsets,
  type BarFrame,
  type BarMetrics,
  type BumpSpec,
  type NotchSpec,
} from './geometry';
import { DEFAULT_FLOATING_NAV_THEME, floatingNavThemeMeta, type FloatingNavTheme } from './themes';

export type { FloatingNavItem } from './NavItem';

/* Keep in step with `.fbn` / `.fbn-svg` / `.fbn-indicator` in globals.css. */
const BAR_HEIGHT = 72;
const SVG_OVERHANG = 28;
const BUTTON_SIZE = 56;
const SPOT_WIDTH = 96;
const BAR: Omit<BarMetrics, 'width' | 'count'> = { height: BAR_HEIGHT, radius: 30, padding: 24, boost: 40, minSlot: 48 };
const NOTCH: NotchSpec = { buttonRadius: BUTTON_SIZE / 2, gap: 6, centerY: -4, fillet: 10 };
const BUMP: BumpSpec = { rise: 14, halfWidth: 46 };
const TRAVEL_MS = 480;
/** How far either side of the active tab the neon rim stays lit. */
const RIM_REACH = 120;

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
  items: FloatingNavItem[];
  /** Key of the active item; `null` when none is (the notch then closes up). */
  activeItem?: string | null;
  onChange?: (key: string, item: FloatingNavItem) => void;
  theme?: FloatingNavTheme;
  /** Labels under every icon (default), or only under the active one. */
  showLabels?: boolean;
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

/**
 * A floating pill-shaped bottom navigation bar whose active tab is marked by a button riding a
 * curved notch (or, in the neon theme, a glowing hill in the rim) that slides between tabs.
 *
 * Geometry is tweened in JS and written straight to the DOM each frame — the notch has to track
 * the button exactly, and neither can wait on React. See `geometry.ts` for the shapes.
 */
export function FloatingBottomNav({
  items,
  activeItem = null,
  onChange,
  theme = DEFAULT_FLOATING_NAV_THEME,
  showLabels = true,
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

  const resolvedItems = useMemo(
    () =>
      notificationCount === undefined
        ? items
        : items.map((item) =>
            item.key === notificationItem && item.badge === undefined ? { ...item, badge: notificationCount } : item,
          ),
    [items, notificationCount, notificationItem],
  );
  const currentKey = pending ?? activeItem;
  const activeIndex = resolvedItems.findIndex((item) => item.key === currentKey);

  const inView = useMediaQuery(hideAbove ? `(max-width: ${BREAKPOINT_PX[hideAbove] - 0.02}px)` : null, false);
  // The user's own Reduced motion setting, or the device's.
  const reducedMotion = useReducedMotion();
  const { hidden, actionBar } = useAutoHide(position === 'fixed' && autoHide && inView, currentKey);

  const stageRef = useRef<HTMLElement>(null);
  const barPathRef = useRef<SVGPathElement>(null);
  const rimRef = useRef<SVGPathElement>(null);
  const rimGlowRef = useRef<SVGPathElement>(null);
  const gradientRef = useRef<SVGLinearGradientElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  // A removed tab's ref callback nulls its slot, so the array can run past `resolvedItems` with
  // trailing nulls; `draw` and `onKeyDown` both skip empty slots.
  const slotEls = useRef<(HTMLElement | null)[]>([]);
  const frameRef = useRef<BarFrame | null>(null);
  const drawnWidthRef = useRef(0);
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

  const metrics = useMemo<BarMetrics>(() => ({ ...BAR, width, count: resolvedItems.length }), [width, resolvedItems.length]);

  const draw = useCallback(
    (frame: BarFrame) => {
      const offsets = slotOffsets(metrics, frame.widths);
      slotEls.current.forEach((el, i) => {
        if (!el || frame.widths[i] === undefined) return;
        el.style.width = `${frame.widths[i]}px`;
        el.style.transform = `translate3d(${offsets[i]}px, 0, 0)`;
      });
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
      frameRef.current = frame;
    },
    [metrics, shape],
  );

  useIsoLayoutEffect(() => {
    if (width <= 0 || metrics.count === 0) return;
    const target = restingFrame(metrics, activeIndex);
    const previous = frameRef.current;
    if (activeIndex < 0) target.scale = 0;
    if (activeIndex < 0 && previous) target.x = previous.x;

    const resized = drawnWidthRef.current !== width || previous?.widths.length !== target.widths.length;
    drawnWidthRef.current = width;
    cancelAnimationFrame(rafRef.current);
    if (!previous || resized || reducedMotion) {
      draw(target);
      return;
    }

    // Coming back from "nothing active", grow in place rather than sliding in from the old spot.
    const from = previous.scale < 0.05 ? { ...previous, x: target.x } : previous;
    const travels = Math.abs(from.x - target.x) > 0.5 && from.scale > 0.5 && target.scale > 0.5;
    // Paint the starting frame now: a theme switch mounts fresh paths that would otherwise sit
    // empty until the first animation frame.
    draw(from);
    const start = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - start) / TRAVEL_MS);
      const glide = easeOutBack(u, 1.1);
      const settle = 1 - (1 - u) ** 3;
      // The button dips a little mid-flight and swells back as it lands; the notch follows it.
      const dip = travels ? 0.12 * Math.sin(Math.PI * u) : 0;
      draw({
        widths: target.widths.map((w, i) => lerp(from.widths[i] ?? w, w, glide)),
        x: lerp(from.x, target.x, glide),
        scale: lerp(from.scale, target.scale, settle) * (1 - dip),
      });
      if (u < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [width, activeIndex, metrics, draw, reducedMotion]);

  const onSelect = (item: FloatingNavItem, event: MouseEvent<HTMLElement>) => {
    onChange?.(item.key, item);
    const plainClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (item.href && plainClick && !event.defaultPrevented) setPending(item.key);
  };

  // Arrow keys move between tabs, as in any toolbar; Tab still leaves the bar.
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
          {resolvedItems.map((item, i) => (
            <NavItem
              key={item.key}
              item={item}
              active={i === activeIndex}
              slotRef={(el) => {
                slotEls.current[i] = el;
              }}
              onSelect={onSelect}
              onKeyDown={onKeyDown}
            />
          ))}
        </nav>
      </div>
      {spacer && position === 'fixed' && !actionBar && <div className={cn('fbn-spacer', hideClass)} aria-hidden="true" />}
    </>
  );
}

export default FloatingBottomNav;
