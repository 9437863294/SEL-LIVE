'use client';

/**
 * The "Sidebar mode" appearance preference, as the module shells' card sidebars read it.
 *
 * `'labels'` is the sidebar as it has always been. `'icons'` narrows the desktop card to a rail of
 * icon chips, each named by a tooltip on hover and focus and by visually hidden text for screen
 * readers. It is desktop-only: the phone's slide-out sheet opens because somebody wants to read
 * the menu, so it always shows labels.
 *
 * Everything here is inert in labels mode — the tooltip wrapper hands its child back untouched —
 * so a shell can adopt it without changing what labels mode renders.
 */

import { createElement, type ReactElement, type ReactNode } from 'react';
import { TooltipPortal } from '@radix-ui/react-tooltip';
import { useAppearance } from '@/components/theme/ThemeProvider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** True when the signed-in user (or the company default) chose compact icon sidebars. */
export function useSidebarIconsOnly(): boolean {
  return useAppearance().effective.layout.sidebarMode === 'icons';
}

/** The desktop grid's sidebar column in icons mode: a 32px chip in the card's padding, centred. */
export const SIDEBAR_ICONS_GRID = 'lg:grid-cols-[76px_minmax(0,1fr)]';

/** A group heading's stand-in in icons mode — the grouping still reads, in a hairline. */
export const SIDEBAR_ICONS_DIVIDER = 'mx-auto my-1.5 h-px w-8 bg-slate-300/70';

/**
 * Names an icon-only sidebar link in a tooltip to its right. `children` must be a single element
 * that forwards its ref (a `Link`, a `button`). With `enabled` false it is returned as it is.
 *
 * Portalled because the sidebar cards are `overflow-hidden` and most carry a backdrop blur, which
 * makes the card the containing block for Radix's fixed positioning — unportalled, the tooltip
 * would be clipped at the card's edge.
 */
export function SidebarNavTooltip({
  label,
  enabled,
  children,
}: {
  label: ReactNode;
  enabled: boolean;
  children: ReactElement;
}): ReactElement {
  if (!enabled) return children;
  return createElement(
    Tooltip,
    null,
    createElement(TooltipTrigger, { asChild: true }, children),
    createElement(
      TooltipPortal,
      null,
      createElement(TooltipContent, { side: 'right', sideOffset: 8, className: 'text-xs font-medium' }, label),
    ),
  );
}
