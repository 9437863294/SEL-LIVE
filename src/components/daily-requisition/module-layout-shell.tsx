'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { SIDEBAR_ICONS_DIVIDER, SIDEBAR_ICONS_GRID, SidebarNavTooltip, useSidebarIconsOnly } from '@/components/navigation/use-sidebar-mode';
import { Card } from '@/components/ui/card';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  activeDailyRequisitionHref,
  groupDailyRequisitionNav,
  isDailyRequisitionPrintRoute,
  useDailyRequisitionNav,
} from './nav';

/**
 * Daily Requisition's desktop sidebar: the dashboard, the entry sheet, every configured workflow
 * stage, documents, each report and each settings page, grouped.
 *
 * Desktop only: phones keep the bottom bar, whose "More" sheet reads the same list. The pages pad
 * themselves (`dailyPageContainerClass`), so the shell adds no padding on the content side: below
 * `lg` it renders the page exactly as before, and from `lg` the page's own left padding is the
 * gutter between the sidebar and the content.
 *
 * The wrapper and `<main>` are always rendered, and the sidebar only slots in beside them, so the
 * page never remounts when permissions resolve or change. Print routes get the page alone.
 */
export default function DailyRequisitionLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '';
  const iconsOnly = useSidebarIconsOnly();
  const { items, isLoading } = useDailyRequisitionNav();

  if (isDailyRequisitionPrintRoute(pathname)) return <>{children}</>;

  // Only the dashboard (no Daily Requisition access at all), or not known yet: no sidebar.
  const showSidebar = !isLoading && items.length > 1;
  const activeHref = activeDailyRequisitionHref(pathname, items);
  const groups = groupDailyRequisitionNav(items);

  return (
    <div
      className={cn(
        'w-full',
        showSidebar && 'lg:grid lg:items-start lg:pl-6',
        showSidebar && (iconsOnly ? SIDEBAR_ICONS_GRID : 'lg:grid-cols-[232px_minmax(0,1fr)]'),
      )}
    >
      {showSidebar ? (
        <TooltipProvider delayDuration={150}>
          <aside
            aria-label="Daily Requisition"
            className="hidden lg:sticky lg:top-[calc(var(--app-header-offset,4rem)+1rem)] lg:mt-4 lg:block print:hidden"
          >
            <Card className="flex max-h-[calc(100dvh-var(--app-header-offset,4rem)-2rem)] flex-col overflow-hidden border-white/80 bg-white/90 shadow-sm">
              <div
                className={cn('shrink-0 border-b bg-gradient-to-r from-cyan-500/10 to-fuchsia-500/5 px-4 py-3', iconsOnly && 'px-2')}
                title={iconsOnly ? 'Daily Requisition' : undefined}
              >
                <div className={cn('flex items-center gap-2.5', iconsOnly && 'justify-center')}>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-sky-700">
                    <ClipboardCheck className="h-4 w-4 text-white" aria-hidden="true" />
                  </div>
                  <div className={iconsOnly ? 'sr-only' : 'min-w-0'}>
                    <p className="truncate text-sm font-semibold text-slate-800">Daily Requisition</p>
                    <p className="truncate text-[11px] text-muted-foreground">Receiving to payment</p>
                  </div>
                </div>
              </div>

              <nav aria-label="Daily Requisition pages" className="min-h-0 flex-1 overflow-y-auto p-2">
                {groups.map((group, groupIndex) => (
                  <div key={group.name} role="group" aria-label={group.name}>
                    {iconsOnly ? (
                      groupIndex > 0 && <div className={SIDEBAR_ICONS_DIVIDER} aria-hidden="true" />
                    ) : (
                      <p
                        aria-hidden="true"
                        className={cn(
                          'px-2.5 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400',
                          groupIndex === 0 ? 'pt-1' : 'pt-3',
                        )}
                      >
                        {group.name}
                      </p>
                    )}
                    <ul className="space-y-0.5">
                      {group.items.map((item) => {
                        const active = item.href === activeHref;
                        const Icon = item.icon;
                        return (
                          <li key={item.href}>
                            <SidebarNavTooltip label={item.label} enabled={iconsOnly}>
                              <Link
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                title={iconsOnly ? undefined : item.label}
                                className={cn(
                                  'group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                  active
                                    ? 'bg-gradient-to-r from-cyan-600 to-sky-700 text-white shadow-md'
                                    : 'text-slate-600 hover:bg-white/80 hover:text-slate-950',
                                  iconsOnly && 'justify-center',
                                )}
                              >
                                <span
                                  className={cn(
                                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                                    active ? 'bg-white/20' : item.bg,
                                  )}
                                >
                                  <Icon className={cn('h-3.5 w-3.5', active ? 'text-white' : item.color)} aria-hidden="true" />
                                </span>
                                <span className={iconsOnly ? 'sr-only' : 'min-w-0 truncate'}>{item.label}</span>
                              </Link>
                            </SidebarNavTooltip>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </nav>
            </Card>
          </aside>
        </TooltipProvider>
      ) : null}

      {/* min-w-0: a grid item defaults to min-width:auto, so a wide register would otherwise widen
          the column and push the page sideways. */}
      <main className="min-w-0">{children}</main>
    </div>
  );
}
