'use client';

import { useEffect, useMemo, useState } from 'react';
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
   * The module's primary destinations, in display order. Four fit alongside "More"; the bar
   * takes up to six, but past five the labels get cramped on a 360px phone.
   */
  tabs: ModuleNavTab[];
  /** Opens the module's full menu. Adds a "More" tab, which is also active on any page no tab covers. */
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
 * The floating bottom navigation wired to a module: tabs are links, the active one follows the
 * route (the most specific match wins, so `/insurance/project/history` does not light up
 * `/insurance/project` too), and "More" hands over to the module's existing menu sheet so the full
 * permission-filtered list lives in one place.
 */
export function ModuleBottomNav({
  tabs,
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
  useEffect(() => setSheetOpen(false), [pathname]);
  const hasSheet = !onMoreProp && Boolean(moreLinks?.length);
  const onMore = onMoreProp ?? (hasSheet ? () => setSheetOpen(true) : undefined);
  // Only whether there is a More tab matters to the memos below, not the handler's identity.
  const hasMore = Boolean(onMore);

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
