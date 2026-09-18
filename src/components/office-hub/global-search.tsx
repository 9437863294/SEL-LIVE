'use client';

/**
 * The command palette (§37's global search, §66's Ctrl+K and quick create).
 *
 * ── Why it lives in the module shell and not the app header ─────────────────────────────────────
 *
 * §66 asks for a global "+" and a Ctrl+K search. The application's own header is shared by twenty
 * modules and already carries its own search and notification bell; adding an Office Hub palette to
 * it would put this module's vocabulary in front of people using Expenses. So the palette is
 * mounted by the Office Hub layout and bound while you are inside `/office-hub` — which is also
 * when its results are what you want.
 *
 * ── Why the candidate set is fetched once and searched in memory ────────────────────────────────
 *
 * Firestore has no substring search. The palette fetches a bounded, permission-scoped candidate set
 * the first time it is opened (not on page load — most visits never open it), and `searchOfficeHub`
 * ranks in memory. See the header of `office-hub-search.ts` for why that is the right trade at this
 * scale, and `loadSearchCorpus` for what the bound actually is.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarDays,
  CalendarPlus,
  CheckSquare,
  Gavel,
  ListTodo,
  Loader2,
  Paperclip,
  Plus,
  Search,
  UserRound,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_MIN_SEARCH_LENGTH,
  searchOfficeHub,
  type SearchCorpus,
  type SearchResultKind,
} from '@/lib/office-hub';
import { loadSearchCorpus } from '@/lib/office-hub-service';
import { useDebouncedValue, useOfficeHub } from './hooks';
import { QuickCreateTaskDialog } from './task-form';

const KIND_ICON: Record<SearchResultKind, React.ElementType> = {
  meeting: CalendarDays,
  task: ListTodo,
  decision: Gavel,
  'action-item': CheckSquare,
  team: Users,
  employee: UserRound,
  document: Paperclip,
};

export function OfficeHubCommandPalette() {
  const router = useRouter();
  const { viewer, capabilities, meetingScope, taskScope } = useOfficeHub();

  const [open, setOpen] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term, 180);
  const [corpus, setCorpus] = useState<SearchCorpus | null>(null);
  const [loading, setLoading] = useState(false);

  /** Ctrl/⌘+K opens it; the browser's own find is left on Ctrl+F where people expect it. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /** Loaded on first open, then kept for the session. */
  useEffect(() => {
    if (!open || corpus || loading) return;
    setLoading(true);
    void loadSearchCorpus(
      viewer,
      {
        meetings: meetingScope === 'organized' ? 'mine' : meetingScope,
        tasks: taskScope,
      },
      { limit: 150 },
    )
      .then(setCorpus)
      .catch((error: unknown) => {
        console.error('[office-hub] Search could not be loaded', error);
        // An empty corpus is a working palette with no results, which is better than a broken one.
        setCorpus({ meetings: [], tasks: [], decisions: [], actionItems: [], teams: [], people: [] });
      })
      .finally(() => setLoading(false));
  }, [open, corpus, loading, viewer, meetingScope, taskScope]);

  const results = useMemo(
    () => (corpus ? searchOfficeHub(debounced, corpus, { limitPerGroup: 5 }) : null),
    [corpus, debounced],
  );

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setTerm('');
      router.push(href);
    },
    [router],
  );

  return (
    <>
      {/* The trigger pair §66 asks for: search and a global "+". */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="h-8 gap-2 bg-white/90 pl-2 pr-1.5 text-xs font-normal text-muted-foreground"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search Office Hub</span>
          <kbd className="ml-1 hidden rounded border bg-slate-50 px-1 font-mono text-[10px] text-slate-500 sm:inline">
            Ctrl K
          </kbd>
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Create something"
          className="h-8 w-8 bg-white/90"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          value={term}
          onValueChange={setTerm}
          placeholder="Search meetings, tasks, decisions, people — or type to create"
        />
        <CommandList>
          {/*
            `shouldFilter` is left on, so cmdk also fuzzy-filters the quick-create rows by their
            own text. The *result* rows are already ranked by `searchOfficeHub`, and their `value`
            includes the title, so cmdk's filter agrees with the ranking rather than fighting it.
          */}
          {term.length < OFFICE_HUB_MIN_SEARCH_LENGTH && (
            <CommandGroup heading="Create">
              {capabilities.canCreateMeeting && (
                <CommandItem value="new meeting schedule" onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/meetings/new`)}>
                  <CalendarPlus className="mr-2 h-4 w-4 text-indigo-600" />
                  Meeting
                </CommandItem>
              )}
              {capabilities.canCreateTask && (
                <CommandItem
                  value="new task"
                  onSelect={() => {
                    setOpen(false);
                    setCreatingTask(true);
                  }}
                >
                  <ListTodo className="mr-2 h-4 w-4 text-emerald-600" />
                  Task
                </CommandItem>
              )}
              {capabilities.canCreateDecision && (
                <CommandItem value="new decision" onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/decisions?new=1`)}>
                  <Gavel className="mr-2 h-4 w-4 text-amber-600" />
                  Decision
                </CommandItem>
              )}
              {capabilities.canCreateTeam && (
                <CommandItem value="new team" onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/teams?new=1`)}>
                  <Users className="mr-2 h-4 w-4 text-violet-600" />
                  Team
                </CommandItem>
              )}
              {capabilities.canImportEmployees && (
                <CommandItem value="import employees" onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/import`)}>
                  <UserRound className="mr-2 h-4 w-4 text-cyan-600" />
                  Import employees
                </CommandItem>
              )}
            </CommandGroup>
          )}

          {term.length < OFFICE_HUB_MIN_SEARCH_LENGTH && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Go to">
                <CommandItem value="dashboard" onSelect={() => go(OFFICE_HUB_BASE_PATH)}>
                  Dashboard
                </CommandItem>
                <CommandItem value="calendar" onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/calendar`)}>
                  Calendar
                </CommandItem>
                <CommandItem value="meetings register" onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/meetings`)}>
                  Meetings
                </CommandItem>
                <CommandItem value="tasks" onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/tasks`)}>
                  Tasks
                </CommandItem>
                <CommandItem value="decisions register" onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/decisions`)}>
                  Decision register
                </CommandItem>
                <CommandItem value="action items" onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/action-items`)}>
                  Action items
                </CommandItem>
                <CommandItem value="teams" onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/teams`)}>
                  Teams
                </CommandItem>
                {capabilities.canViewReports && (
                  <CommandItem value="reports" onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/reports`)}>
                    Reports
                  </CommandItem>
                )}
                {capabilities.canViewSettings && (
                  <CommandItem value="settings" onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/settings`)}>
                    Settings
                  </CommandItem>
                )}
              </CommandGroup>
            </>
          )}

          {term.length >= OFFICE_HUB_MIN_SEARCH_LENGTH && (
            <>
              {loading && (
                <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading what you can see…
                </div>
              )}

              {!loading && results && results.total === 0 && (
                <CommandEmpty>
                  Nothing matches &ldquo;{term}&rdquo;.
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Search covers the meetings, tasks and decisions you are entitled to see.
                  </span>
                </CommandEmpty>
              )}

              {!loading &&
                results?.groups.map((group) => {
                  const Icon = KIND_ICON[group.kind];
                  return (
                    <CommandGroup key={group.kind} heading={group.label}>
                      {group.results.map((result) => (
                        <CommandItem
                          key={`${result.kind}-${result.id}`}
                          value={`${result.title} ${result.subtitle} ${result.matchedOn}`}
                          onSelect={() => go(result.link)}
                        >
                          <Icon className="mr-2 h-4 w-4 shrink-0 text-slate-400" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm">{result.title}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {result.subtitle}
                            </span>
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  );
                })}

              {!loading && results && results.total > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      value="see all results"
                      onSelect={() => go(`${OFFICE_HUB_BASE_PATH}/search?q=${encodeURIComponent(term)}`)}
                    >
                      <Search className="mr-2 h-4 w-4" />
                      See all results for &ldquo;{term}&rdquo;
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </>
          )}
        </CommandList>
      </CommandDialog>

      <QuickCreateTaskDialog
        open={creatingTask}
        onOpenChange={setCreatingTask}
        onCreated={(taskId) => router.push(`${OFFICE_HUB_BASE_PATH}/tasks/${taskId}`)}
      />
    </>
  );
}
