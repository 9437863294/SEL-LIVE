'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Search } from 'lucide-react';
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
   * Only for a module whose menu cannot be listed as pages. Whenever there are `pages` or
   * `moreLinks`, "More" opens the bar's own pop-up of them instead — the same one in every module.
   */
  onMore?: () => void;
  /**
   * The pages "More" lists, when they should differ from `pages` (their order, or grouping). The
   * pop-up groups them under `group`, in the order given. Defaults to `pages`.
   */
  moreLinks?: ModuleMoreLink[];
  /** Headings for the pop-up's groups, keyed by each link's `group` ("core" → "Command Center"). */
  groupLabels?: Record<string, string>;
  /**
   * Anything the module's menu offered that is not a page — a Compose button, the mailbox list —
   * shown at the top of the pop-up, above the pages.
   */
  moreContent?: ReactNode;
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
  groupLabels,
  moreContent,
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
  // One pop-up for every module: whatever the module lists, "More" opens the bar's own sheet.
  const sheetLinks = moreLinks ?? pagesProp;
  const hasSheet = Boolean(sheetLinks?.length) || Boolean(moreContent);
  const onMore = hasSheet ? () => setSheetOpen(true) : onMoreProp;
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
      {hasSheet && (
        <ModuleMoreSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          links={sheetLinks ?? []}
          groupLabels={groupLabels}
          extra={moreContent}
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
  groupLabels,
  extra,
  moduleName,
  pathname,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: ModuleMoreLink[];
  groupLabels?: Record<string, string>;
  extra?: ReactNode;
  moduleName: string;
  pathname: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  // Each opening starts from the full list — cleared during render, not in an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setQuery('');
  }
  // A long menu gets a filter; a short one is quicker to scan than to search.
  const searchable = links.length > 9;
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? links.filter((link) => `${link.label} ${link.group ? (groupLabels?.[link.group] ?? link.group) : ''}`.toLowerCase().includes(needle))
    : links;

  const groups: Array<[string, ModuleMoreLink[]]> = [];
  for (const link of shown) {
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
        ref={contentRef}
        side="bottom"
        // Focus the sheet, not its search box: on a phone a focused input throws the keyboard up
        // over the very tiles the person opened the sheet to tap.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
        // Any link followed from the pop-up closes it, including one in `moreContent` that changes
        // only the query (another mailbox, another report), which the pathname check above misses.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a[href]')) onOpenChange(false);
        }}
        className="max-h-[82dvh] overflow-y-auto rounded-t-[1.75rem] px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3 focus:outline-none"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted" aria-hidden="true" />
        <SheetHeader className="text-left">
          <SheetTitle className="text-base">{moduleName}</SheetTitle>
          <SheetDescription className="text-xs">Every page in this module</SheetDescription>
        </SheetHeader>
        {searchable && (
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${links.length} pages`}
              aria-label={`Search ${moduleName} pages`}
              className="h-10 w-full rounded-xl border border-border/70 bg-muted/40 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}
        {extra && !needle && <div className="mt-4">{extra}</div>}
        {needle && groups.length === 0 && (
          <p className="mt-6 text-center text-sm text-muted-foreground">No page matches “{query.trim()}”.</p>
        )}
        {/* Sections share one grid: a section of one or two pages takes only that many columns, so
            a run of small sections ("Overview", "Settings") sits side by side instead of each
            leaving a row mostly empty. Larger sections take the full width. Order is kept. */}
        <div className="mt-4 grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4">
          {groups.map(([group, items]) => (
            <section
              key={group || 'pages'}
              className={cn('min-w-0', items.length >= 3 ? 'col-span-full' : items.length === 2 ? 'col-span-2' : 'col-span-1')}
            >
              {group && (
                <p className="mb-2 truncate px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  {groupLabels?.[group] ?? group}
                </p>
              )}
              <div
                className={cn(
                  'grid gap-2',
                  items.length >= 3 ? 'grid-cols-3 sm:grid-cols-4' : items.length === 2 ? 'grid-cols-2' : 'grid-cols-1',
                )}
              >
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
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default ModuleBottomNav;
