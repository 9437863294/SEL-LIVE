'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A card whose border glows toward the cursor — the "spotlight card" idiom (React Bits' version of
 * it, reimplemented in plain Tailwind so it doesn't add a dependency).
 *
 * The glow position is written straight onto the DOM node as a CSS custom property inside the
 * `mousemove` handler, not through `useState`. A card that re-rendered React on every pixel of
 * pointer movement would fight the very thing this component exists to make feel smooth.
 */
export function SpotlightCard({
  children,
  className,
  style,
  spotlightColor = 'rgba(99, 102, 241, 0.18)',
  size = 420,
}: {
  children: React.ReactNode;
  className?: string;
  /** Passed straight through to the root node — for an entrance `animation-delay`, mainly. */
  style?: React.CSSProperties;
  /** The glow's colour, as an rgba() string — pick one that matches whatever tone the card carries. */
  spotlightColor?: string;
  /** Diameter of the glow, in pixels. */
  size?: number;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const node = rootRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty('--spotlight-x', `${event.clientX - rect.left}px`);
    node.style.setProperty('--spotlight-y', `${event.clientY - rect.top}px`);
  };

  return (
    <div
      ref={rootRef}
      onMouseMove={handleMouseMove}
      style={style}
      className={cn('group/spotlight relative isolate overflow-hidden', className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-500 group-hover/spotlight:opacity-100"
        style={{
          background: `radial-gradient(${size}px circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%), ${spotlightColor}, transparent 70%)`,
        }}
      />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
