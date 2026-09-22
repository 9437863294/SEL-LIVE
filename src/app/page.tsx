'use client';

/**
 * The home page: two tabs, "Your work" and "Modules".
 *
 * It used to be only the module launcher — a grid of cards, one per module the user could open.
 * That answered "where is everything?" and nothing else, so the first thing anybody did on signing
 * in was guess which of up to thirty-one modules might be holding work for them. The work board is
 * now the default tab and the launcher is the second, because the launcher is still the only entry
 * point to several modules (Project Management among them) and removing it would break that.
 *
 * ── Two decisions worth knowing ────────────────────────────────────────────────────────────────
 *
 * **Both panels are `forceMount`ed.** Radix unmounts an inactive tab panel by default, which would
 * make every switch back to "Your work" re-run the whole fan-out in `loadWorkItems` — thirty-one
 * queries, to redraw numbers that were already on screen a second earlier. With `forceMount` the
 * panel keeps its state and Radix hides it with the `hidden` attribute instead. The launcher is
 * mounted the same way, so its drag-to-reorder state survives a trip to the work board too.
 *
 * **The chosen tab is remembered.** Somebody who lives in the launcher should not have to click
 * past the work board every morning. It is restored in an effect rather than read during the first
 * render on purpose: `localStorage` does not exist on the server, and seeding state from it would
 * make the server and client markup disagree.
 */

import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/app/AppShell';
import ModuleDashboard from '@/components/module-hub/ModuleDashboard';
import WorkDashboard from '@/components/work-dashboard/work-dashboard';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { WorkSummary } from '@/lib/work-dashboard';

type HomeTab = 'work' | 'modules';

const TAB_STORAGE_KEY = 'home_tab';

const isHomeTab = (value: unknown): value is HomeTab => value === 'work' || value === 'modules';

export default function DashboardPage() {
  const [tab, setTab] = useState<HomeTab>('work');
  const [summary, setSummary] = useState<WorkSummary | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
      if (isHomeTab(stored)) setTab(stored);
    } catch {
      // Private browsing, or storage disabled by policy. The default tab is a fine answer.
    }
  }, []);

  const selectTab = useCallback((value: string) => {
    if (!isHomeTab(value)) return;
    setTab(value);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, value);
    } catch {
      // Not remembering the choice is better than failing to make it.
    }
  }, []);

  const pending = summary?.action ?? 0;
  const overdue = summary?.overdue ?? 0;

  return (
    <AppShell>
      <div className="px-3 pt-4 sm:px-4 md:px-6">
        <Tabs value={tab} onValueChange={selectTab}>
          <TabsList>
            <TabsTrigger value="work" className="gap-2">
              Your work
              {pending > 0 ? (
                <Badge
                  variant="outline"
                  className={cn(
                    'px-1.5 py-0 text-[11px] tabular-nums',
                    overdue > 0
                      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
                      : 'border-border bg-background text-foreground',
                  )}
                >
                  {pending > 99 ? '99+' : pending}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="modules">Modules</TabsTrigger>
          </TabsList>

          <TabsContent value="work" forceMount className="pb-8 data-[state=inactive]:hidden">
            <WorkDashboard showTitle={false} onSummaryChange={setSummary} />
          </TabsContent>

          <TabsContent value="modules" forceMount className="pb-8 data-[state=inactive]:hidden">
            {/* The launcher's own page padding is dropped: this panel is already inset. */}
            <ModuleDashboard className="flex flex-col gap-6" />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
