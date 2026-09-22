'use client';

/**
 * Animate a figure from its previous value to its next one.
 *
 * Used on the dashboard's four counts. The point is not decoration: the numbers change when a
 * refresh lands, and a figure that jumps from 17 to 12 gives no clue that anything happened, while
 * one that counts down draws the eye to the card that moved.
 *
 * ── Three things it deliberately does ─────────────────────────────────────────────────────────
 *
 * 1. **Animates from the previous value, not from zero.** Counting up from zero on every refresh
 *    would make a number that did not change look like news. The first render is the exception —
 *    there is no previous value, so it opens from zero, which is the entrance everyone expects.
 *
 * 2. **Honours `prefers-reduced-motion`.** Checked with a media-query listener rather than once at
 *    mount, so toggling the OS setting takes effect without a reload. When set, the value is
 *    returned as-is and no frame is ever scheduled.
 *
 * 3. **Runs on `requestAnimationFrame`, not an interval.** An interval fights the compositor and
 *    drops frames; rAF is also paused by the browser in a background tab, so a dashboard left open
 *    on another monitor is not burning cycles counting to seventeen.
 */

import { useEffect, useRef, useState } from 'react';

/** Long enough to read as movement, short enough not to delay the number. */
const DURATION_MS = 550;

/** Ease-out cubic: quick off the mark, settling gently, so the final value feels arrived-at. */
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  const [reduced, setReduced] = useState(false);

  // `from` is the value on screen when the target last changed, held in a ref so changing it does
  // not itself trigger the effect that reads it.
  const from = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (reduced || prefersReducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = from.current;
    const delta = value - start;
    if (delta === 0) {
      setShown(value);
      return;
    }

    let startedAt: number | null = null;
    const step = (now: number) => {
      if (startedAt === null) startedAt = now;
      const progress = Math.min(1, (now - startedAt) / DURATION_MS);
      // Rounded per frame so the reader only ever sees whole items, never 12.4 approvals.
      setShown(Math.round(start + delta * easeOut(progress)));
      if (progress < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        from.current = value;
        frame.current = null;
      }
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      // Landing on the target on unmount, so a remount does not animate from a half-way number.
      from.current = value;
    };
  }, [value, reduced]);

  return shown;
}
