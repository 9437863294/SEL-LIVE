'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { FloatingBottomNav, type FloatingBottomNavProps } from './FloatingBottomNav';
import type { FloatingNavIcon, FloatingNavItem } from './NavItem';
import type { FloatingNavTheme } from './themes';
import { useFloatingNavTheme } from './use-floating-nav-theme';

const MORE_KEY = '__more__';

export interface ModuleNavTab {
  href: string;
  label: string;
  icon: FloatingNavIcon;
  badge?: number | boolean;
  /** Drawn permanently in its own filled disc — the module's Create action. Put it in the middle. */
  emphasized?: boolean;
  /** Match this path only, not the pages under it. Use for a module's dashboard. */
  exact?: boolean;
  /** Custom active test, for tabs whose pages do not all sit under their `href`. */
  match?: (pathname: string) => boolean;
  ariaLabel?: string;
}

/** A page listed in the built-in "More" sheet, for modules without a menu of their own. */
export interface ModuleMoreLink {
  href: string;
  label: string;
  icon: FloatingNavIcon;
  /** Section heading in the sheet; links are shown in the order given, grouped by first appearance. */
  group?: string;
  exact?: boolean;
}

export interface ModuleBottomNavProps {
  /**
   * The module's primary destinations, first in the bar, in display order — with the short labels
   * a bar needs ("Vehicles", not "Vehicle Master"). Six show at a time; the rest scroll.
   */
  tabs: ModuleNavTab[];
  /**
   * Every page the person can open in this module — normally the sidebar's permission-filtered
   * list. Those no tab already covers follow the tabs, so every page is on the bar, a swipe away.
   * Defaults to `moreLinks`.
   */
  pages?: ModuleMoreLink[];
  /**
   * Opens the module's full menu. Adds a "More" tab, pinned at the end of the bar while the tabs
   * scroll, which is also active on any page no tab covers.
   */
  onMore?: () => void;
  /**
   * For a module with no menu sheet to hand over to: the pages "More" should list. The bar then
   * opens its own bottom sheet of them. Ignored when `onMore` is given.
   */
  moreLinks?: ModuleMoreLink[];
  moreLabel?: string;
  /** The module's name, for the landmark ("HR & Recruitment navigation"). */
  moduleName: string;
  /** Match the breakpoint where the module's own sidebar appears. */
  hideAbove?: FloatingBottomNavProps['hideAbove'];
  showLabels?: boolean;
  /** Overrides the user's Appearance choice. */
  theme?: FloatingNavTheme;
}

/** The path part of an href: tabs may carry a query (`?project=…`) that the pathname never has. */
function hrefPath(href: string) {
  return href.split(/[?#]/)[0];
}

function matchesHref(pathname: string, href: string, exact?: boolean) {
  const path = hrefPath(href);
  if (pathname === path) return true;
  return !exact && pathname.startsWith(`${path}/`);
}

/**
 * A menu name trimmed for a ~50px slot: "Trip Management" → "Trip", "Renewals Hub" → "Renewals",
 * "Tasks & follow-ups" → "Tasks". The full name stays the tab's accessible name.
 */
function barLabel(label: string) {
  const short = label
    .replace(/\s+&\s+.*$/, '')
    .replace(/\s+(Management|Hub)$/i, '')
    .trim();
  return short || label;
}

/**
 * The floating bottom navigation wired to a module: tabs are links — the module's picks first,
 * then every other page it can open — the active one follows the route (the most specific match
 * wins, so `/insurance/project/history` does not light up `/insurance/project` too), and a pinned
 * "More" hands over to the module's existing menu sheet, where the full grouped list lives.
 */
export function ModuleBottomNav({
  tabs: primaryTabs,
  pages: pagesProp,
  onMore: onMoreProp,
  moreLinks,
  moreLabel = 'More',
  moduleName,
  hideAbove = 'lg',
  showLabels = true,
  theme,
}: ModuleBottomNavProps) {
  const pathname = usePathname() ?? '';
  const preferredTheme = useFloatingNavTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Moving to another page closes the sheet — dropped during render, not in an effect.
  const [sheetPath, setSheetPath] = useState(pathname);
  if (sheetPath !== pathname) {
    setSheetPath(pathname);
    setSheetOpen(false);
  }
  const hasSheet = !onMoreProp && Boolean(moreLinks?.length);
  const onMore = onMoreProp ?? (hasSheet ? () => setSheetOpen(true) : undefined);
  // Only whether there is a More tab matters to the memos below, not the handler's identity.
  const hasMore = Boolean(onMore);

  const pages = pagesProp ?? moreLinks;
  const tabs = useMemo<ModuleNavTab[]>(() => {
    if (!pages?.length) return primaryTabs;
    const covered = new Set(primaryTabs.map((tab) => hrefPath(tab.href)));
    const list = [...primaryTabs];
    for (const page of pages) {
      const path = hrefPath(page.href);
      if (covered.has(path)) continue;
      covered.add(path);
      const label = barLabel(page.label);
      list.push({ href: page.href, label, icon: page.icon, exact: page.exact, ariaLabel: label === page.label ? undefined : page.label });
    }
    return list;
  }, [primaryTabs, pages]);

  const items = useMemo<FloatingNavItem[]>(() => {
    const list: FloatingNavItem[] = tabs.map((tab) => ({
      key: tab.href,
      href: tab.href,
      label: tab.label,
      icon: tab.icon,
      badge: tab.badge,
      emphasized: tab.emphasized,
      ariaLabel: tab.ariaLabel,
    }));
    if (hasMore) {
      list.push({
        key: MORE_KEY,
        label: moreLabel,
        icon: LayoutGrid,
        opensMenu: true,
        pinned: true,
        ariaLabel: `${moreLabel}: all ${moduleName} pages`,
      });
    }
    return list;
  }, [tabs, hasMore, moreLabel, moduleName]);

  const activeItem = useMemo(() => {
    let best: ModuleNavTab | null = null;
    for (const tab of tabs) {
      const hit = tab.match ? tab.match(pathname) : matchesHref(pathname, tab.href, tab.exact);
      if (hit && (!best || hrefPath(tab.href).length > hrefPath(best.href).length)) best = tab;
    }
    if (best) return best.href;
    return hasMore ? MORE_KEY : null;
  }, [tabs, pathname, hasMore]);

  // A print route is a document, not a screen.
  if (pathname.includes('/print') || tabs.length === 0) return null;

  return (
    <>
      <FloatingBottomNav
        items={items}
        activeItem={activeItem}
        onChange={(key) => {
          if (key === MORE_KEY) onMore?.();
        }}
        theme={theme ?? preferredTheme}
        showLabels={showLabels}
        hideAbove={hideAbove}
        ariaLabel={`${moduleName} navigation`}
      />
      {hasSheet && moreLinks && (
        <ModuleMoreSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          links={moreLinks}
          moduleName={moduleName}
          pathname={pathname}
        />
      )}
    </>
  );
}

function ModuleMoreSheet({
  open,
  onOpenChange,
  links,
  moduleName,
  pathname,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: ModuleMoreLink[];
  moduleName: string;
  pathname: string;
}) {
  const groups: Array<[string, ModuleMoreLink[]]> = [];
  for (const link of links) {
    const name = link.group ?? '';
    const existing = groups.find(([group]) => group === name);
    if (existing) existing[1].push(link);
    else groups.push([name, [link]]);
  }
  let current: ModuleMoreLink | null = null;
  for (const link of links) {
    if (matchesHref(pathname, link.href, link.exact) && (!current || hrefPath(link.href).length > hrefPath(current.href).length)) current = link;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[82dvh] overflow-y-auto rounded-t-[1.75rem] px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted" aria-hidden="true" />
        <SheetHeader className="text-left">
          <SheetTitle className="text-base">{moduleName}</SheetTitle>
          <SheetDescription className="text-xs">Every page in this module</SheetDescription>
        </SheetHeader>
        {groups.map(([group, items]) => (
          <section key={group || 'pages'} className="mt-4">
            {group && (
              <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{group}</p>
            )}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((link) => {
                const Icon = link.icon;
                const active = current?.href === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => onOpenChange(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-[5.25rem] flex-col items-center justify-center gap-2 rounded-2xl border p-2 text-center text-[11px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border/60 bg-muted/30 text-foreground/80 hover:bg-muted/60',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-xl',
                        active ? 'bg-primary text-primary-foreground' : 'bg-background shadow-sm',
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="line-clamp-2">{link.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </SheetContent>
    </Sheet>
  );
}

export default ModuleBottomNav;
