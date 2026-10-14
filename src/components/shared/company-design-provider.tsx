'use client';

import { useEffect, type ReactNode } from 'react';
import { useCompanyDesign } from '@/hooks/use-company-profile';

/**
 * Publishes the company's sidebar, table and dialog design (Settings › Company Profile) as attributes on
 * `<html>`, for the shared table/dialog styles to key off:
 *
 *   data-table-density   compact | standard | comfortable — untouched when 'auto' (Appearance's per-user Table rows)
 *   data-table-striped   true | false
 *   data-table-bordered  true | false
 *   data-table-header    muted | accent | plain
 *   data-table-sticky    true | false
 *   data-dialog-footer   end | between | stretch
 *   data-dialog-size     sm | md | lg | xl — removed when 'auto' (each dialog keeps its own size)
 *   data-sidebar-style   solid | soft | minimal
 *   data-sidebar-width   narrow | standard | wide
 *   data-sidebar-icons, data-sidebar-groups, data-sidebar-collapsible   true | false
 *   data-sidebar-active  bar | pill | background
 *   --letterhead-accent  the letterhead's accent colour
 *
 * Mounted once in the signed-in app shell. Renders its children untouched (or nothing).
 */
/** What Appearance had put in data-table-density before the company setting replaced it. */
let appearanceDensity: string | null | undefined;

export function CompanyDesignProvider({ children }: { children?: ReactNode }) {
  const design = useCompanyDesign();

  useEffect(() => {
    const root = document.documentElement;
    const { tables, dialogs, sidebar, letterhead } = design;
    const attributes: Record<string, string> = {
      'data-table-striped': String(tables.striped),
      'data-table-bordered': String(tables.bordered),
      'data-table-header': tables.headerStyle,
      'data-table-sticky': String(tables.stickyHeader),
      'data-dialog-footer': dialogs.footerAlign,
      'data-sidebar-style': sidebar.style,
      'data-sidebar-width': sidebar.width,
      'data-sidebar-icons': String(sidebar.showIcons),
      'data-sidebar-groups': String(sidebar.showGroupLabels),
      'data-sidebar-collapsible': String(sidebar.collapsible),
      'data-sidebar-active': sidebar.activeIndicator,
    };
    for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value);
    // Table rows: Appearance already sets this per user. 'auto' leaves it to them (restoring their
    // value if a company setting had replaced it); anything else overrides it company-wide.
    if (tables.density === 'auto') {
      if (appearanceDensity !== undefined) {
        if (appearanceDensity === null) root.removeAttribute('data-table-density');
        else root.setAttribute('data-table-density', appearanceDensity);
        appearanceDensity = undefined;
      }
    } else {
      if (appearanceDensity === undefined) appearanceDensity = root.getAttribute('data-table-density');
      root.setAttribute('data-table-density', tables.density);
    }
    if (dialogs.defaultSize === 'auto') root.removeAttribute('data-dialog-size');
    else root.setAttribute('data-dialog-size', dialogs.defaultSize);
    root.style.setProperty('--letterhead-accent', letterhead.accentColor);
  }, [design]);

  return <>{children}</>;
}
