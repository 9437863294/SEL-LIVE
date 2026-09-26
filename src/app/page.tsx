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
 * **The opening tab is the person's choice.** Somebody who lives in the launcher should not have to
 * click past the work board every morning. "Default dashboard view" (Settings → Appearance) decides:
 * `work` or `modules` always opens that tab; `last`, the out-of-the-box default, reopens whichever
 * tab was used last. The remembered tab is read through `useSyncExternalStore` rather than seeded
 * into state on the first render on purpose: `localStorage` does not exist on the server, and
 * seeding state from it would make the server and client markup disagree.
 */

import { useCallback, useState, useSyncExternalStore } from 'react';
import AppShell from '@/components/app/AppShell';
import ModuleDashboard from '@/components/module-hub/ModuleDashboard';
import { useAppearance } from '@/components/theme/ThemeProvider';
import WorkDashboard from '@/components/work-dashboard/work-dashboard';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { WorkSummary } from '@/lib/work-dashboard';

type HomeTab = 'work' | 'modules';

const TAB_STORAGE_KEY = 'home_tab';

const isHomeTab = (value: unknown): value is HomeTab => value === 'work' || value === 'modules';

function readStoredTab(): HomeTab | null {
  try {
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    return isHomeTab(stored) ? stored : null;
  } catch {
    // Private browsing, or storage disabled by policy. The default tab is a fine answer.
    return null;
  }
}

// Nothing to listen to: the remembered tab only changes when this page writes it, and by then the
// person's own pick is showing.
const subscribeToNothing = () => () => {};

export default function DashboardPage() {
  const { effective, ready } = useAppearance();
  const dashboardView = effective.dashboardView;
  const [summary, setSummary] = useState<WorkSummary | null>(null);

  // The remembered tab. `useSyncExternalStore` hands the server render and the hydrating client
  // render the server snapshot (`undefined`, "not read yet"), so both draw "Your work" and the
  // markup agrees; React re-renders with the real value straight after hydrating, and a client-side
  // visit to this page reads it on the first render. A lazy `useState` read would disagree with the
  // server markup, and copying it into state from an effect is the cascading render we avoid.
  const storedTab = useSyncExternalStore<HomeTab | null | undefined>(subscribeToNothing, readStoredTab, () => undefined);
  // What the preference asks for right now. Until `ready` that is this device's cached copy of the
  // preference, which is almost always the final answer too; the server's copy settles it.
  const preferred: HomeTab =
    storedTab === undefined ? 'work' : dashboardView === 'last' ? (storedTab ?? 'work') : dashboardView;
  // The opening tab, frozen on the first render with final preferences so a late answer never yanks
  // the page sideways. Set during render (React's "adjust state when a prop changes"), not in an effect.
  const [settled, setSettled] = useState<HomeTab | null>(null);
  if (settled === null && ready && storedTab !== undefined) setSettled(preferred);
  // Once the person picks a tab, only their own clicks move it.
  const [picked, setPicked] = useState<HomeTab | null>(null);
  const tab = picked ?? settled ?? preferred;

  const selectTab = useCallback((value: string) => {
    if (!isHomeTab(value)) return;
    setPicked(value);
    // Remembered whatever the preference says, so switching to "last" later carries on from here.
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
      {/* Full width with minimal gutters — the page is a working surface, not an article. */}
      <div className="w-full px-2 pt-3 sm:px-3 md:px-4">
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
