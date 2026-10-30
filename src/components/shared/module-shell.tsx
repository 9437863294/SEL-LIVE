'use client';

/**
 * The one module shell: the desktop sidebar, the phone's header card and floating bottom bar, the
 * access gate and the content column — shared by every module, so each module's
 * `module-layout-shell.tsx` is only its nav config and its gate computation.
 *
 * Its look lives in `src/styles/module-shell.css`, keyed off the company's sidebar design that
 * `CompanyDesignProvider` publishes on <html> (`data-sidebar-style`, `-width`, `-icons`, `-groups`,
 * `-collapsible`, `-active`). With none of them set it draws the card sidebar the modules always
 * had. The markup carries stable `data-slot` hooks for that stylesheet; the active item's slot is
 * `"module-nav-item module-nav-item-active"`, so select with `[data-slot~="…"]`.
 *
 * Rules the modules share and this enforces by shape:
 *   - the first item is the module's dashboard (it matches its own path only, unless told otherwise);
 *   - one "Settings" item per module — its hub's cards get no entries of their own;
 *   - items with `visible: false` are dropped, and so is a group left with none.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Loader2, PanelLeftClose, PanelLeftOpen, ShieldAlert, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { ModuleBottomNav, type ModuleMoreLink, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import { SidebarNavTooltip, useSidebarIconsOnly } from '@/components/navigation/use-sidebar-mode';
import { ModuleMobileHeader } from '@/components/shared/page-header';
import { useSidebarDefault } from '@/components/theme/use-sidebar-default';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';

export type { ModuleNavTab } from '@/components/navigation/ModuleBottomNav';

/** The icon-tile colours an item can carry. Without one it takes the user's accent. */
export type ModuleNavTone =
  | 'slate' | 'gray' | 'zinc' | 'stone' | 'red' | 'orange' | 'amber' | 'yellow' | 'lime' | 'green'
  | 'emerald' | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo' | 'violet' | 'purple' | 'fuchsia' | 'pink' | 'rose';

export interface ModuleNavItem {
  id: string;
  label: string;
  href: string;
  icon?: LucideIcon;
  /**
   * When the item is the current page. `'prefix'` (the default) is its path and every page under
   * it; `'exact'` its path only (the default for the module's first item, the dashboard); a function
   * for an item whose pages do not all sit under its `href`. The most specific match wins.
   */
  match?: 'exact' | 'prefix' | ((pathname: string) => boolean);
  /** `false` hides the item — the permission check's answer. */
  visible?: boolean;
  /** A count or short tag after the label; `null`, `undefined`, `0` and `''` show nothing. */
  badge?: number | string | null;
  /** Sub-pages, listed under the item while it (or one of them) is the current page. */
  children?: ModuleNavItem[];
  /** The icon tile's colour. */
  tone?: ModuleNavTone;
}

export interface ModuleNavGroup {
  id: string;
  /** Heading above the group (and in the phone's "More" pop-up). Without one, a hairline divides. */
  label?: string;
  items: ModuleNavItem[];
}

export interface ModuleShellGate {
  /** Permissions (or membership) still loading: a spinner instead of the module. */
  loading: boolean;
  /** May the person open this module at all. */
  allowed: boolean;
  deniedMessage?: string;
  /**
   * May they open the current page. `false` keeps the module's navigation and replaces only the
   * content, so they can move on to a page they may see. Defaults to true.
   */
  pageAllowed?: boolean;
  pageDeniedMessage?: string;
}

export interface ModuleShellProps {
  /** The module's name: sidebar header, phone header, the navigation landmarks. */
  title: string;
  /** The one-line purpose under the title ("Treasury Control"). */
  subtitle?: string;
  icon?: LucideIcon;
  groups: ModuleNavGroup[];
  children: ReactNode;
  gate?: ModuleShellGate;
  /** Compact actions: under the title in the sidebar, on the right of the phone header. */
  headerActions?: ReactNode;
  /** The bottom of the sidebar card (a version line, a help link). Hidden while collapsed. */
  footer?: ReactNode;
  /**
   * The phone bar's leading tabs, with the short names a bar needs. Every other visible page
   * follows them on the bar anyway. Defaults to the first item as "Home".
   */
  mobileTabs?: ModuleNavTab[];
  /** Anything that is not a page, at the top of the phone's "More" pop-up (a Compose button). */
  mobileMoreContent?: ReactNode;
  /** Render the page alone, without chrome. Defaults to true on print routes (a `print` path segment). */
  bare?: boolean;
}

// ─── Active matching ───────────────────────────────────────────────────────────────────────────

/** The path part of an href: an item may carry a query (`?tab=…`) the pathname never has. */
const hrefPath = (href: string) => href.split(/[?#]/)[0] || href;

/** Groups with hidden items (and then empty groups) removed. Children are filtered the same way. */
export function visibleModuleNav(groups: ModuleNavGroup[]): ModuleNavGroup[] {
  const keep = (items: ModuleNavItem[]): ModuleNavItem[] =>
    items
      .filter((item) => item.visible !== false)
      .map((item) => (item.children ? { ...item, children: keep(item.children) } : item));
  return groups
    .map((group) => ({ ...group, items: keep(group.items) }))
    .filter((group) => group.items.length > 0);
}

function itemMatches(item: ModuleNavItem, pathname: string, isFirst: boolean): boolean {
  const match = item.match ?? (isFirst ? 'exact' : 'prefix');
  if (typeof match === 'function') return match(pathname);
  const path = hrefPath(item.href);
  if (pathname === path) return true;
  return match === 'prefix' && pathname.startsWith(path.endsWith('/') ? path : `${path}/`);
}

/**
 * Which item is the current page, of the *visible* items in `groups`: the most specific match
 * (the longest path; a child over its parent on a tie). `activeIds` holds it and its ancestors.
 */
export function useModuleNavActive(groups: ModuleNavGroup[]): { activeId: string | null; activeIds: Set<string> } {
  const pathname = usePathname() ?? '';
  return useMemo(() => {
    let best: { score: number; chain: string[] } | null = null;
    let first = true;
    const walk = (items: ModuleNavItem[], parents: string[]) => {
      for (const item of items) {
        const isFirst = first;
        first = false;
        const chain = [...parents, item.id];
        if (itemMatches(item, pathname, isFirst)) {
          const path = hrefPath(item.href);
          const score = (pathname === path ? 100_000 : 0) + path.length * 10 + chain.length;
          if (!best || score > best.score) best = { score, chain };
        }
        if (item.children?.length) walk(item.children, chain);
      }
    };
    for (const group of visibleModuleNav(groups)) walk(group.items, []);
    const found = best as { score: number; chain: string[] } | null;
    return { activeId: found ? found.chain[found.chain.length - 1]! : null, activeIds: new Set(found?.chain ?? []) };
  }, [groups, pathname]);
}

// ─── The company's sidebar design, read off <html> ─────────────────────────────────────────────

function subscribeHtmlAttributes(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-sidebar-collapsible'] });
  return () => observer.disconnect();
}

/** False only when the company switched collapsing off (`data-sidebar-collapsible="false"`). */
function useSidebarCollapsible(): boolean {
  return useSyncExternalStore(
    subscribeHtmlAttributes,
    () => document.documentElement.getAttribute('data-sidebar-collapsible') !== 'false',
    () => true,
  );
}

const COLLAPSED_KEY = 'sel.moduleShell.collapsed';

// ─── Pieces ────────────────────────────────────────────────────────────────────────────────────

/** The module-wide "you may not open this" card. */
export function ModuleAccessDenied({ title, message }: { title: string; message?: string }) {
  return (
    <div className="w-full p-6">
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>{message ?? `You do not have permission to access ${title}.`}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <ShieldAlert className="h-14 w-14 text-destructive" aria-hidden />
        </CardContent>
      </Card>
    </div>
  );
}

/** One page's "you may not open this" card, inside the module's frame. */
export function PageAccessDenied({ message }: { message?: string }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-16 text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-destructive" aria-hidden />
        <div>
          <p className="font-semibold text-foreground">Access Denied</p>
          <p className="mt-1 text-sm text-muted-foreground">{message ?? 'You don’t have permission to view this page.'}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Contact your administrator to request access.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function hasBadge(badge: ModuleNavItem['badge']): badge is number | string {
  return badge !== null && badge !== undefined && badge !== 0 && badge !== '';
}

function NavLink({ item, active, collapsed }: { item: ModuleNavItem; active: boolean; collapsed: boolean }) {
  const Icon = item.icon;
  const badge = hasBadge(item.badge) ? item.badge : null;
  return (
    <SidebarNavTooltip label={badge === null ? item.label : `${item.label} (${badge})`} enabled={collapsed}>
      <Link
        href={item.href}
        data-slot={active ? 'module-nav-item module-nav-item-active' : 'module-nav-item'}
        data-tone={item.tone}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
      >
        {Icon && (
          <span data-slot="module-nav-icon" aria-hidden>
            <Icon />
          </span>
        )}
        <span data-slot="module-nav-label">{item.label}</span>
        {badge !== null && <span data-slot="module-nav-badge">{badge}</span>}
      </Link>
    </SidebarNavTooltip>
  );
}

function ChildLinks({ items, activeIds }: { items: ModuleNavItem[]; activeIds: Set<string> }) {
  return (
    <div data-slot="module-nav-children">
      {items.map((child) => {
        const active = activeIds.has(child.id);
        const badge = hasBadge(child.badge) ? child.badge : null;
        return (
          <div key={child.id}>
            <Link
              href={child.href}
              data-slot={active ? 'module-nav-child module-nav-child-active' : 'module-nav-child'}
              aria-current={active ? 'page' : undefined}
            >
              <span data-slot="module-nav-label">{child.label}</span>
              {badge !== null && <span data-slot="module-nav-badge">{badge}</span>}
            </Link>
            {active && child.children?.length ? <ChildLinks items={child.children} activeIds={activeIds} /> : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── The shell ─────────────────────────────────────────────────────────────────────────────────

export function ModuleShell({
  title,
  subtitle,
  icon: ModuleIcon,
  groups,
  children,
  gate,
  headerActions,
  footer,
  mobileTabs,
  mobileMoreContent,
  bare,
}: ModuleShellProps) {
  const pathname = usePathname() ?? '';
  const { user } = useAuth();
  const visibleGroups = useMemo(() => visibleModuleNav(groups), [groups]);
  const { activeIds } = useModuleNavActive(groups);

  // Collapsed is the Appearance "icons" sidebar mode, or the person's own toggle (when the company
  // allows collapsing). The toggle is restored in an effect — reading storage while rendering
  // would make the client's first markup differ from the server's.
  const iconsOnly = useSidebarIconsOnly();
  const collapsible = useSidebarCollapsible();
  const [expanded, setExpanded] = useSidebarDefault(true);
  const storageKey = `${COLLAPSED_KEY}:${user?.id ?? 'anonymous'}`;
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved !== null) setExpanded(saved !== '1');
    } catch {
      // Private browsing or storage blocked: the appearance default stands.
    }
  }, [storageKey, setExpanded]);
  const collapsed = iconsOnly || (collapsible && !expanded);
  const toggleCollapsed = useCallback(() => {
    const nextCollapsed = !collapsed;
    setExpanded(!nextCollapsed);
    try {
      window.localStorage.setItem(storageKey, nextCollapsed ? '1' : '0');
    } catch {
      // Not remembering the toggle is not worth an error.
    }
  }, [collapsed, setExpanded, storageKey]);

  // The phone: every visible page (children included) for the bar and its "More" pop-up.
  const groupLabels = useMemo(
    () => Object.fromEntries(visibleGroups.filter((g) => g.label).map((g) => [g.id, g.label!])),
    [visibleGroups],
  );
  const pages = useMemo<ModuleMoreLink[]>(() => {
    const list: ModuleMoreLink[] = [];
    let first = true;
    const add = (items: ModuleNavItem[], group: string | undefined, inheritedIcon?: LucideIcon) => {
      for (const item of items) {
        const icon = item.icon ?? inheritedIcon;
        if (icon) list.push({ href: item.href, label: item.label, icon, group, exact: first || item.match === 'exact' });
        first = false;
        if (item.children?.length) add(item.children, group, icon);
      }
    };
    // An unlabelled group gets no heading in the pop-up (the sheet would otherwise print its id).
    for (const group of visibleGroups) add(group.items, group.label ? group.id : undefined);
    return list;
  }, [visibleGroups]);
  const tabs = useMemo<ModuleNavTab[]>(() => {
    if (mobileTabs) return mobileTabs;
    const home = visibleGroups[0]?.items[0];
    if (!home?.icon) return [];
    const match = typeof home.match === 'function' ? home.match : undefined;
    return [{ href: home.href, label: 'Home', icon: home.icon, exact: home.match !== 'prefix', match, ariaLabel: home.label }];
  }, [mobileTabs, visibleGroups]);

  // AppShell already drops the app header on a print route; this drops the module's chrome too
  // (print lays out below `lg`, so the phone bar would otherwise print).
  // A whole `print` path segment: `/settings/printing` is an ordinary page, not a print view.
  const isBare = bare ?? pathname.split('/').includes('print');
  // Permissions still loading: the module's frame and name straight away, its menu and page as
  // placeholders — not a lone spinner on an empty page until sign-in and permissions are in (a
  // phone on a slow network watched that for seconds). A print view keeps the spinner.
  const loading = Boolean(gate?.loading);
  if (loading && isBare) {
    return (
      <div data-slot="module-shell-loading" className="flex w-full items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }
  if (!loading && gate && !gate.allowed) return <ModuleAccessDenied title={title} message={gate.deniedMessage} />;
  if (isBare) return <>{children}</>;

  const content = loading ? <ModuleContentSkeleton /> : gate?.pageAllowed === false ? <PageAccessDenied message={gate.pageDeniedMessage} /> : children;
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div data-slot="module-shell" data-collapsed={collapsed ? 'true' : 'false'} className="relative w-full px-3 py-4 sm:px-6 sm:py-5 lg:px-8">
      <div data-slot="module-shell-backdrop" aria-hidden />

      {ModuleIcon && (
        <div className="print:hidden">
          <ModuleMobileHeader icon={ModuleIcon} title={title} subtitle={subtitle} actions={headerActions} hideFrom="lg" />
        </div>
      )}

      <div data-slot="module-shell-grid" className="grid grid-cols-1 gap-4">
        <TooltipProvider delayDuration={150}>
          <aside data-slot="module-sidebar" aria-label={`${title} menu`}>
            <div data-slot="module-header" title={collapsed ? title : undefined}>
              <div data-slot="module-header-brand">
                {ModuleIcon && (
                  <span data-slot="module-header-icon" aria-hidden>
                    <ModuleIcon />
                  </span>
                )}
                <div data-slot="module-header-text">
                  <p data-slot="module-header-title">{title}</p>
                  {subtitle && <p data-slot="module-header-subtitle">{subtitle}</p>}
                </div>
                {collapsible && !iconsOnly && (
                  <button
                    type="button"
                    data-slot="module-sidebar-toggle"
                    onClick={toggleCollapsed}
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
                    title={collapsed ? 'Expand menu' : 'Collapse menu'}
                  >
                    <ToggleIcon aria-hidden />
                  </button>
                )}
              </div>
              {headerActions && !collapsed && <div data-slot="module-header-actions">{headerActions}</div>}
            </div>

            <nav data-slot="module-nav" aria-label={`${title} pages`}>
              {loading && <ModuleNavSkeleton collapsed={collapsed} />}
              {!loading && visibleGroups.map((group) => (
                <div key={group.id} data-slot="module-nav-group" data-labelled={group.label ? 'true' : 'false'}>
                  {group.label && <p data-slot="module-nav-group-label">{group.label}</p>}
                  {group.items.map((item) => {
                    const branchActive = activeIds.has(item.id);
                    return (
                      <div key={item.id}>
                        <NavLink item={item} active={branchActive} collapsed={collapsed} />
                        {branchActive && !collapsed && item.children?.length ? (
                          <ChildLinks items={item.children} activeIds={activeIds} />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </nav>

            {footer && !collapsed && <div data-slot="module-sidebar-footer">{footer}</div>}
          </aside>
        </TooltipProvider>

        <main data-slot="module-content" className="min-w-0" aria-busy={loading || undefined}>
          {content}
        </main>
      </div>

      {!loading && <ModuleBottomNav tabs={tabs} pages={pages} groupLabels={groupLabels} moreContent={mobileMoreContent} moduleName={title} />}
    </div>
  );
}

/** The menu's place while permissions load: rows the height of its links. */
function ModuleNavSkeleton({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="space-y-2 px-1 py-1" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div key={row} className="flex items-center gap-2.5 py-1">
          <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
          {!collapsed && <Skeleton className="h-3.5 rounded" style={{ width: `${[68, 54, 60, 48, 64, 42][row]}%` }} />}
        </div>
      ))}
    </div>
  );
}

/** A page's place while permissions load: a title, a row of figures and a card. */
function ModuleContentSkeleton() {
  return (
    <div className="space-y-4">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-6 w-48 rounded-md" />
        <Skeleton className="h-4 w-72 max-w-full rounded-md" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((tile) => (
          <Skeleton key={tile} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" aria-hidden />
    </div>
  );
}

export default ModuleShell;
