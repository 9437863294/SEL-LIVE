'use client';

/**
 * The Aurora Glass home page's moving backgrounds — Settings › Appearance › Branding › Home page.
 *
 * `BannerFx` goes inside the greeting card and `ModulesFx` inside the "All modules" area, each as a
 * decorative layer behind the content (the parent must be `relative isolate`). The real home page
 * and the settings preview both draw from here, so the preview is the real thing.
 */

import { useEffect, useId, useRef, type CSSProperties } from 'react';
import {
  HOME_BANNER_EFFECTS,
  HOME_MODULES_EFFECTS,
  isOneOf,
  type HomeBannerEffect,
  type HomeModulesEffect,
} from '@/lib/appearance/model';
import { cn } from '@/lib/utils';
import styles from './home-effects.module.css';

/** A published value from before the backgrounds existed (or a stale cache) is none. */
export const bannerEffectOf = (value: unknown): HomeBannerEffect => (isOneOf(HOME_BANNER_EFFECTS, value) ? value : 'none');
export const modulesEffectOf = (value: unknown): HomeModulesEffect => (isOneOf(HOME_MODULES_EFFECTS, value) ? value : 'none');

/* ── Banner: Power line, computed once ────────────────────────────────────────────────────── */

const TOWER_XS = [-40, 260, 560, 860, 1160, 1460, 1760, 2060];

const TOWERS_D = TOWER_XS.map(
  (x) =>
    `M${x - 11} 230 L${x - 4} 40 L${x + 4} 40 L${x + 11} 230 M${x - 18} 46 L${x + 18} 46 M${x - 14} 62 L${x + 14} 62 ` +
    `M${x - 8} 120 L${x + 8} 120 M${x - 10} 170 L${x + 10} 170 M${x} 28 L${x} 40`,
).join(' ');

const LINES = (
  [
    [46, -18, '#14b8a6', '0s'],
    [62, 14, '#6366f1', '-3s'],
    [46, 18, '#f59e0b', '-5s'],
  ] as const
).map(([y, dx, color, delay]) => {
  let d = `M${TOWER_XS[0] + dx} ${y}`;
  for (let index = 1; index < TOWER_XS.length; index += 1) {
    const a = TOWER_XS[index - 1] + dx;
    const b = TOWER_XS[index] + dx;
    d += ` Q${(a + b) / 2} ${y + 40} ${b} ${y}`;
  }
  return { d, color, delay };
});

function PowerLine() {
  return (
    <svg className={styles.powerScene} viewBox="0 0 1900 230" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <path className={styles.tw} d={TOWERS_D} />
      {LINES.map(({ d, color, delay }) => (
        <g key={color}>
          <path className={styles.wr} d={d} />
          <path className={styles.pl} d={d} style={{ stroke: color, color, animationDelay: delay }} />
        </g>
      ))}
    </svg>
  );
}

/* ── Banner: Rising sparks, from a fixed seed so every render draws the same ones ────────── */

const SPARK_COLOURS = ['#14b8a6', '#6366f1', '#ec4899', '#f59e0b', '#22c55e'];

const SPARKS = (() => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  return Array.from({ length: 34 }, (_, index) => {
    const size = 3 + random() * 6;
    return {
      left: `${(random() * 100).toFixed(2)}%`,
      size: `${size.toFixed(1)}px`,
      background: SPARK_COLOURS[index % SPARK_COLOURS.length],
      dx: `${Math.round(random() * 80 - 40)}px`,
      duration: `${(7 + random() * 9).toFixed(1)}s`,
      delay: `${(-random() * 14).toFixed(1)}s`,
    };
  });
})();

function Sparks() {
  return (
    <>
      {SPARKS.map((spark, index) => (
        <i
          key={index}
          className={styles.spark}
          style={
            {
              left: spark.left,
              width: spark.size,
              height: spark.size,
              background: spark.background,
              animationDuration: spark.duration,
              animationDelay: spark.delay,
              '--dx': spark.dx,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

/** Behind the greeting card. Nothing for `none`, so the card stays exactly as it was. */
export function BannerFx({ effect }: { effect: HomeBannerEffect }) {
  if (effect === 'none') return null;
  return (
    <div aria-hidden="true" className={cn(styles.layer, styles.banner)} data-effect={effect}>
      {effect === 'aurora' ? (
        <>
          <span className={cn(styles.blob, styles.ba1)} />
          <span className={cn(styles.blob, styles.ba2)} />
          <span className={cn(styles.blob, styles.ba3)} />
          <span className={cn(styles.blob, styles.ba4)} />
          <span className={styles.veil} />
        </>
      ) : effect === 'mesh' ? (
        <span className={styles.mesh} />
      ) : effect === 'power-line' ? (
        <>
          <PowerLine />
          <span className={styles.veil} />
        </>
      ) : effect === 'sparks' ? (
        <Sparks />
      ) : effect === 'shimmer' ? (
        <>
          <span className={styles.sweepTrack}>
            <span className={styles.sweep} />
          </span>
          <span className={styles.dots} />
        </>
      ) : (
        <>
          <span className={styles.wheel} />
          <span className={styles.veil} />
        </>
      )}
    </div>
  );
}

/* ── Modules area ─────────────────────────────────────────────────────────────────────────── */

const WAVE_D = 'M0 90 C 360 40 720 140 1080 90 S 1800 40 2160 90 S 2700 130 2880 90 V160 H0Z';

function WaveBands() {
  // The home page and the settings preview can share a page, so each gradient id must be unique.
  const base = `hm-wave-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <>
      {[styles.mw1, styles.mw2, styles.mw3].map((className, index) => (
        <svg key={index} className={cn(styles.mwave, className)} viewBox="0 0 2880 160" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`${base}-${index}`} x1="0" x2="1">
              <stop offset="0" stopColor="#14b8a6" />
              <stop offset=".33" stopColor="#6366f1" />
              <stop offset=".66" stopColor="#ec4899" />
              <stop offset="1" stopColor="#14b8a6" />
            </linearGradient>
          </defs>
          <path fill={`url(#${base}-${index})`} d={WAVE_D} />
        </svg>
      ))}
    </>
  );
}

/** Behind the "All modules" area. Card glow draws on the tiles instead, so it has no layer. */
export function ModulesFx({ effect }: { effect: HomeModulesEffect }) {
  if (effect === 'none' || effect === 'card-glow') return null;
  return (
    <div aria-hidden="true" className={styles.layer} data-effect={effect}>
      {effect === 'dot-grid' ? (
        <span className={styles.dotMask}>
          <span className={styles.dotGrid} />
        </span>
      ) : effect === 'blobs' ? (
        <>
          <span className={cn(styles.mblob, styles.mb1)} />
          <span className={cn(styles.mblob, styles.mb2)} />
          <span className={cn(styles.mblob, styles.mb3)} />
        </>
      ) : effect === 'spotlight' ? (
        <span className={styles.spot} />
      ) : (
        <WaveBands />
      )}
    </div>
  );
}

/**
 * The classes for the "All modules" area: a background effect gets a rounded panel of its own, as
 * in the mock-up; Card glow marks the area so its tiles (`data-fx-tile`) glow.
 */
export function modulesAreaClass(effect: HomeModulesEffect): string {
  if (effect === 'none') return '';
  if (effect === 'card-glow') return styles.cardGlow;
  return 'relative isolate overflow-hidden rounded-[22px] px-3 pb-[18px] pt-3.5';
}

/**
 * Pointer tracking for Cursor spotlight (`--mx`/`--my` on the area) and Card glow (`--x`/`--y` on
 * the tile under the mouse). Written straight to the element's style, once a frame at most — never
 * through React state, which would re-render thirty-odd tiles on every mouse move. Nothing is
 * attached for the other effects, or for touch, which has no hover to follow.
 */
export function useFxPointer<T extends HTMLElement>(effect: HomeModulesEffect) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const area = ref.current;
    if (!area || (effect !== 'spotlight' && effect !== 'card-glow')) return;
    let frame = 0;
    let latest: PointerEvent | null = null;

    const apply = () => {
      frame = 0;
      const event = latest;
      if (!event) return;
      if (effect === 'spotlight') {
        const box = area.getBoundingClientRect();
        area.style.setProperty('--mx', `${event.clientX - box.left}px`);
        area.style.setProperty('--my', `${event.clientY - box.top}px`);
        return;
      }
      const tile = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-fx-tile]') : null;
      if (!tile) return;
      const box = tile.getBoundingClientRect();
      tile.style.setProperty('--x', `${event.clientX - box.left}px`);
      tile.style.setProperty('--y', `${event.clientY - box.top}px`);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      latest = event;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    area.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      area.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
      area.style.removeProperty('--mx');
      area.style.removeProperty('--my');
    };
  }, [effect]);
  return ref;
}
