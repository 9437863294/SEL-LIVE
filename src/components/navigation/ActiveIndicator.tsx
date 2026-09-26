import type { Ref } from 'react';
import type { NavShape } from './geometry';

/**
 * What marks the active tab, per shape. Positioned every frame by `FloatingBottomNav` through the
 * ref — it never re-renders to move.
 *
 * - `notch`: the floating disc sitting in the bar's notch. `glowKey` remounts the glow so its
 *   bloom replays each time the disc lands on a new tab.
 * - `bump`: a soft wash inside the bar under the active tab; the glowing rim itself is part of the
 *   bar's SVG.
 */
export function ActiveIndicator({
  shape,
  glowKey,
  indicatorRef,
}: {
  shape: NavShape;
  glowKey: string;
  indicatorRef: Ref<HTMLSpanElement>;
}) {
  if (shape === 'bump') return <span ref={indicatorRef} className="fbn-spot" aria-hidden="true" />;
  return (
    <span ref={indicatorRef} className="fbn-indicator" aria-hidden="true">
      <span key={glowKey} className="fbn-indicator-glow" />
      <span className="fbn-indicator-disc" />
    </span>
  );
}
