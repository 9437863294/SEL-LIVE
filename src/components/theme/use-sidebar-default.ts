'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppearance } from '@/components/theme/ThemeProvider';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Initial expanded state for a collapsible rail: the user's preference once known; the user's own
 * toggles win afterwards.
 *
 * Starts at `fallbackExpanded` — the rail's own historical default — because the server has no
 * preferences and the first client render must match its markup. When the appearance preferences
 * arrive it moves to them exactly once, and only if nothing has called the setter yet: a click, or
 * a rail restoring its own remembered toggle from storage, is a choice the user made and outranks
 * an account-wide default. After that it is plain `useState`.
 *
 * A layout effect rather than a passive one, so a rail mounted after preferences are already known
 * (every client-side navigation) opens in its preferred state without painting the fallback first.
 */
export function useSidebarDefault(
  fallbackExpanded: boolean,
): [boolean, (next: boolean | ((v: boolean) => boolean)) => void] {
  const { effective, ready } = useAppearance();
  const preference = effective.layout.sidebarDefault;
  const [expanded, setExpandedState] = useState(fallbackExpanded);
  // Set once the preference has been applied or the user has chosen; from then on only the user moves the rail.
  const settled = useRef(false);

  useIsoLayoutEffect(() => {
    if (!ready || settled.current) return;
    // `auto` — nobody chose — keeps the rail's own default.
    if (preference === 'auto') return;
    settled.current = true;
    setExpandedState(preference === 'expanded');
  }, [ready, preference]);

  const setExpanded = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    settled.current = true;
    setExpandedState(next);
  }, []);

  return [expanded, setExpanded];
}
