'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Landmark } from 'lucide-react';
import { SIDEBAR_ICONS_DIVIDER, SIDEBAR_ICONS_GRID, SidebarNavTooltip, useSidebarIconsOnly } from '@/components/navigation/use-sidebar-mode';
import { Card, CardContent } from '@/components/ui/card';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { activeBankBalanceHref, useBankBalanceNav } from './nav';

/**
 * Bank Balance's desktop sidebar: every page of the module, grouped, including each report and
 * the module settings (previously a gear on the dashboard header).
 *
 * Desktop only — phones keep the bottom bar, whose "More" sheet reads the same list. The pages
 * pad themselves (`px-4 sm:px-6 lg:px-8`), so the shell adds none on the content side: below `lg`
 * it renders the page exactly as before, and from `lg` the page's own left padding is the gutter
 * between the sidebar and the content.
 *
 * Access is still each page's call. Without module access, or while it is being resolved, the
 * sidebar is simply not drawn and the page shows its own skeleton or Access Denied card.
 */
export default function BankBalanceLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '';
  const iconsOnly = useSidebarIconsOnly();
  const { items, isLoading, canViewModule } = useBankBalanceNav();

  if (isLoading || !canViewModule || items.length === 0) return <>{children}</>;

  const activeHref = activeBankBalanceHref(pathname, items);

  const links = items.map((item, index) => {
    const active = item.href === activeHref;
    const showGroup = index === 0 || items[index - 1].group !== item.group;
    const Icon = item.icon;

    return (
      <div key={item.href}>
        {showGroup &&
          (iconsOnly ? (
            <>
              {index > 0 && <div className={SIDEBAR_ICONS_DIVIDER} aria-hidden />}
              <p className="sr-only">{item.group}</p>
            </>
          ) : (
            <p className="px-2.5 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 first:pt-1">
              {item.group}
            </p>
          ))}
        <SidebarNavTooltip label={item.label} enabled={iconsOnly}>
          <Link
            href={item.href}
            aria-current={active ? 'page' : undefined}
            title={iconsOnly ? item.label : undefined}
            className={cn(
              'group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all',
              active
                ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-600 hover:bg-white/80 hover:text-slate-950',
              iconsOnly && 'justify-center'
            )}
          >
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', active ? 'bg-white/20' : item.bg)}>
              <Icon className={cn('h-3.5 w-3.5', active ? 'text-white' : item.color)} />
            </span>
            <span className={iconsOnly ? 'sr-only' : 'truncate'}>{item.label}</span>
          </Link>
        </SidebarNavTooltip>
      </div>
    );
  });

  return (
    <div className={cn('w-full lg:grid lg:items-start lg:pl-6', iconsOnly ? SIDEBAR_ICONS_GRID : 'lg:grid-cols-[232px_minmax(0,1fr)]')}>
      <TooltipProvider delayDuration={150}>
        <aside className="hidden lg:sticky lg:top-[calc(var(--app-header-offset,4rem)+1rem)] lg:mt-4 lg:block">
          <Card className="flex max-h-[calc(100dvh-var(--app-header-offset,4rem)-2rem)] flex-col overflow-hidden border-white/80 bg-white/90 shadow-sm">
            <div
              className={cn('shrink-0 border-b bg-gradient-to-r from-violet-500/10 to-indigo-500/5 px-4 py-3', iconsOnly && 'px-2')}
              title={iconsOnly ? 'Bank Balance' : undefined}
            >
              <div className={cn('flex items-center gap-2.5', iconsOnly && 'justify-center')}>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-700">
                  <Landmark className="h-4 w-4 text-white" />
                </div>
                <div className={iconsOnly ? 'sr-only' : undefined}>
                  <p className="text-sm font-semibold text-slate-800">Bank Balance</p>
                  <p className="text-[11px] text-muted-foreground">Treasury &amp; Cash Credit</p>
                </div>
              </div>
            </div>
            <CardContent className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">{links}</CardContent>
          </Card>
        </aside>
      </TooltipProvider>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
