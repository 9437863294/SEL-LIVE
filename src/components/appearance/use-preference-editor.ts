'use client';

import { useCallback } from 'react';
import { useAppearance } from '@/components/theme/ThemeProvider';
import type { LayoutPreferences, UserAppearancePreferences } from '@/lib/appearance/model';

type TopLevelKey = Exclude<keyof UserAppearancePreferences, 'layout'>;

/**
 * Set or clear one preference at a time. Clearing is how a single setting goes back to following
 * the company default; `layout` fields are merged, never replaced wholesale.
 */
export function usePreferenceEditor() {
  const appearance = useAppearance();
  const { preferences, updatePreferences } = appearance;

  const set = useCallback(
    <K extends TopLevelKey>(key: K, value: UserAppearancePreferences[K]) => updatePreferences((p) => ({ ...p, [key]: value })),
    [updatePreferences],
  );
  const clear = useCallback(
    (key: TopLevelKey) =>
      updatePreferences((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      }),
    [updatePreferences],
  );
  const setLayout = useCallback(
    <K extends keyof LayoutPreferences>(key: K, value: LayoutPreferences[K]) =>
      updatePreferences((p) => ({ ...p, layout: { ...p.layout, [key]: value } })),
    [updatePreferences],
  );
  const clearLayout = useCallback(
    (key: keyof LayoutPreferences) =>
      updatePreferences((p) => {
        const layout = { ...p.layout };
        delete layout[key];
        return { ...p, layout };
      }),
    [updatePreferences],
  );

  return {
    ...appearance,
    defaults: appearance.company.defaults,
    set,
    clear,
    setLayout,
    clearLayout,
    inherited: (key: TopLevelKey) => preferences[key] === undefined,
    layoutInherited: (key: keyof LayoutPreferences) => preferences.layout?.[key] === undefined,
  };
}
