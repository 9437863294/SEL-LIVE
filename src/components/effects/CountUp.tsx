'use client';

import * as React from 'react';

/**
 * Rolls a number up to `value` instead of just printing it — the KPI-card idiom React Bits calls
 * "count up". Driven by `requestAnimationFrame` rather than an interval, so it stays smooth without
 * piling up timers, and it eases out (quick start, gentle stop) rather than landing abruptly.
 *
 * Starts from 0 on first mount, then animates from whatever it last showed on every value change
 * after that — a KPI that goes from 40 to 42 after a refresh rolls by two, it does not restart from
 * zero.
 */
export function CountUp({
  value,
  durationMs = 900,
  formatter = (n: number) => Math.round(n).toLocaleString(),
  className,
}: {
  value: number;
  durationMs?: number;
  formatter?: (n: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = React.useState(0);
  const fromRef = React.useRef(0);

  React.useEffect(() => {
    if (!Number.isFinite(value)) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }

    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    let frame: number;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3; // ease-out cubic
      setDisplay(from + (to - from) * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return <span className={className}>{formatter(display)}</span>;
}
