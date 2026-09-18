'use client';

/**
 * The full search results page (§37).
 *
 * The command palette shows the top five per group; this shows all of them, grouped, with the
 * matched text so a reader can see *why* something matched. The palette's "See all results" lands
 * here with the term in the query string, so a search can also be linked to and shared.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarDays,
  CheckSquare,
  Gavel,
  ListTodo,
  Paperclip,
  Search as SearchIcon,
  UserRound,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_MIN_SEARCH_LENGTH,
  searchOfficeHub,
  type SearchCorpus,
  type SearchResultKind,
} from '@/lib/office-hub';
import { loadSearchCorpus } from '@/lib/office-hub-service';
import { useDebouncedValue, useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubEmptyState,
  OfficeHubPageHeader,
  PriorityBadge,
} from '@/components/office-hub/ui';

const KIND_ICON: Record<SearchResultKind, React.ElementType> = {
  meeting: CalendarDays,
  task: ListTodo,
  decision: Gavel,
  'action-item': CheckSquare,
  team: Users,
  employee: UserRound,
  document: Paperclip,
};

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { viewer, meetingScope, taskScope, isLoading } = useOfficeHub();

  const [term, setTerm] = useState(searchParams?.get('q') ?? '');
  const debounced = useDebouncedValue(term, 250);
  const [kinds, setKinds] = useState<SearchResultKind[]>([]);

  /** The term lives in the URL, so a result set can be linked to. */
  useEffect(() => {
    const current = searchParams?.get('q') ?? '';
    if (debounced === current) return;
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (debounced) params.set('q', debounced);
    else params.delete('q');
    router.replace(`${OFFICE_HUB_BASE_PATH}/search${params.toString() ? `?${params.toString()}` : ''}`, {
      scroll: false,
    });
    // `searchParams` is intentionally not a dependency: it changes as a *result* of this effect,
    // and including it would make the two chase each other.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, router]);

  const corpusQuery = useOfficeHubQuery(
    () =>
      loadSearchCorpus(
        viewer,
        { meetings: meetingScope === 'organized' ? 'mine' : meetingScope, tasks: taskScope },
        { limit: 250 },
      ),
    [viewer.userId, meetingScope, taskScope],
    { enabled: Boolean(viewer.userId) },
  );

  const results = useMemo(() => {
    const corpus: SearchCorpus | null = corpusQuery.data ?? null;
    if (!corpus) return null;
    return searchOfficeHub(debounced, corpus, { limitPerGroup: 25 });
  }, [corpusQuery.data, debounced]);

  const visibleGroups = useMemo(
    () => (results?.groups ?? []).filter((group) => (kinds.length ? kinds.includes(group.kind) : true)),
    [results, kinds],
  );

  const toggleKind = (kind: SearchResultKind) =>
    setKinds((current) => (current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind]));

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Search"
        description="Across the meetings, tasks, decisions, action items, teams, people and documents you can see."
      />

      <Card>
        <CardContent className="p-3">
          <Label className="mb-1 block text-xs">Search term</Label>
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder='e.g. "Finance Review", "Project Manager", "TSK-2627-0041"'
              className="bg-white pl-8"
              autoFocus
              aria-label="Search term"
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            An exact reference wins over a title match, so pasting a task or decision number takes
            you straight to it. Press <kbd className="rounded border bg-slate-50 px-1 font-mono">Ctrl K</kbd>{' '}
            anywhere in Office Hub for the quick version.
          </p>
        </CardContent>
      </Card>

      {results && results.total > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Show</span>
          {results.groups.map((group) => {
            const active = kinds.length === 0 || kinds.includes(group.kind);
            return (
              <button
                key={group.kind}
                type="button"
                aria-pressed={kinds.includes(group.kind)}
                onClick={() => toggleKind(group.kind)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  active && kinds.includes(group.kind)
                    ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {group.label} ({group.results.length})
              </button>
            );
          })}
          {kinds.length > 0 && (
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setKinds([])}>
              Show all
            </Button>
          )}
        </div>
      )}

      {corpusQuery.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : term.length < OFFICE_HUB_MIN_SEARCH_LENGTH ? (
        <OfficeHubEmptyState
          icon={SearchIcon}
          title="Type at least two characters."
          description="Search covers titles, references, people, locations and the text of meeting notes."
        />
      ) : !results || results.total === 0 ? (
        <OfficeHubEmptyState
          icon={SearchIcon}
          title={`Nothing matches "${term}".`}
          description="Search only looks at records you are entitled to see, so a meeting you were not invited to will not appear here."
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {results.total} result{results.total === 1 ? '' : 's'} for &ldquo;{results.term}&rdquo;
          </p>

          {visibleGroups.map((group) => {
            const Icon = KIND_ICON[group.kind];
            return (
              <Card key={group.kind}>
                <CardContent className="p-0">
                  <div className="flex items-center gap-2 border-b bg-slate-50/70 px-4 py-2">
                    <Icon className="h-4 w-4 text-slate-500" />
                    <p className="text-sm font-semibold text-slate-800">{group.label}</p>
                    <Badge variant="outline" className="border-slate-200 bg-white text-[11px] tabular-nums">
                      {group.results.length}
                    </Badge>
                  </div>
                  <ul className="divide-y">
                    {group.results.map((result) => (
                      <li key={`${result.kind}-${result.id}`}>
                        <Link
                          href={result.link}
                          className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-slate-50"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-800">{result.title}</p>
                            <p className="truncate text-xs text-muted-foreground">{result.subtitle}</p>
                            {/* Why it matched, when the match was not on the title itself. */}
                            {result.matchedOn && result.matchedOn !== result.title && (
                              <p className="mt-0.5 truncate text-[11px] italic text-muted-foreground">
                                matched: {result.matchedOn}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {result.priority && <PriorityBadge priority={result.priority} />}
                            {result.status && (
                              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
                                {result.status}
                              </Badge>
                            )}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
