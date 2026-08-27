'use client';

/**
 * Pick a greytHR employee to create a platform login for.
 *
 * The point of this control is that an administrator creating an account for a new site engineer
 * should not retype what greytHR already knows — and, more importantly, should not be able to typo
 * the email address that is the join between the two systems. Picking from the list establishes an
 * *explicit* link (the employee id is stored on the user record), so the sync no longer has to infer
 * the relationship from an email that might change.
 *
 * ── Two things this deliberately does ───────────────────────────────────────────────────────────
 *
 *   1. **Uses greytHR CURRENT membership with mirrored details.** The list checks greytHR's current
 *      roster so historical separation rows cannot hide active employees, then uses the mirror for
 *      their department/project details. The chosen employee is refetched live once more.
 *
 *   2. **Says how stale the details are.** The mirror is only as current as the last sync, and this
 *      integration inherited a mirror where every employee was marked inactive. A picker that
 *      presented that as fact would send administrators looking for people who are not in the list.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Building2,
  BadgeCheck,
  CheckCircle2,
  FolderKanban,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  UserSearch,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HrEmptyState } from '@/components/hr/hr-ui';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { employeeSearchText } from '@/lib/greythr';
import {
  fetchEmployeeDetail,
  fetchLinkableEmployees,
  type LinkableEmployeeList,
  type LinkableEmployeeRow,
} from '@/lib/greythr-sync-client';

/** How many rows render at once. The rest are reachable by narrowing the search. */
const WINDOW = 80;

export interface EmployeePickerProps {
  /** The currently chosen employee, if any. */
  value: LinkableEmployeeRow | null;
  /**
   * Called with the live-refreshed employee, plus every greytHR category they hold — including ones
   * this app does not name explicitly, so the caller can show them without this component deciding
   * which matter.
   */
  onSelect: (employee: LinkableEmployeeRow | null, allCategories: Record<string, string>) => void;
  disabled?: boolean;
}

export function EmployeePicker({ value, onSelect, disabled }: EmployeePickerProps) {
  const { toast } = useToast();
  const [list, setList] = useState<LinkableEmployeeList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchLinkableEmployees();
      setList(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the employee list.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const rows = list?.employees ?? [];
    const query = term.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((employee) => employeeSearchText(employee).includes(query));
  }, [list, term]);

  const windowed = filtered.slice(0, WINDOW);

  const choose = async (employee: LinkableEmployeeRow) => {
    setResolvingId(employee.employeeId);
    try {
      // Live refresh: the list row is from the mirror, and for a new joiner that can be a day stale.
      const detail = await fetchEmployeeDetail(employee.employeeId);
      if (detail.employee.linkedUserId) {
        toast({
          title: 'Already has a login',
          description: `${detail.employee.name} is already linked to ${detail.linkedUserName ?? 'an existing user'}.`,
          variant: 'destructive',
        });
        await load();
        return;
      }
      onSelect(detail.employee, detail.allCategories);
    } catch (err) {
      // Falling back to the mirror row rather than blocking: an administrator with greytHR down can
      // still create the account from the last known details and correct them later.
      toast({
        title: 'Could not refresh from greytHR',
        description: `${err instanceof Error ? err.message : 'Unknown error'} — using the last synced details instead.`,
        variant: 'destructive',
      });
      onSelect(employee, {});
    } finally {
      setResolvingId(null);
    }
  };

  /* ── Chosen state ── */

  if (value) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-emerald-900">
              <CheckCircle2 className="h-4 w-4" />
              {value.name || value.employeeNo}
              <Badge variant="outline" className="border-emerald-300 bg-white/70 text-[10px] text-emerald-800">
                {value.employeeNo || value.employeeId}
              </Badge>
            </p>
            <p className="mt-0.5 text-xs text-emerald-800">
              Linked to greytHR employee {value.employeeId}. Fields below are prefilled from greytHR and
              can still be edited.
            </p>
          </div>
          {!disabled && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 bg-white/80 text-xs"
              onClick={() => onSelect(null, {})}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Change
            </Button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.designation && (
            <Badge variant="outline" className="gap-1 border-indigo-200 bg-white/80 text-[10px] text-indigo-700">
              <BadgeCheck className="h-3 w-3" />
              {value.designation}
            </Badge>
          )}
          {value.department && (
            <Badge variant="outline" className="gap-1 border-cyan-200 bg-white/80 text-[10px] text-cyan-700">
              <Building2 className="h-3 w-3" />
              {value.department}
            </Badge>
          )}
          {value.projectName && (
            <Badge variant="outline" className="gap-1 border-emerald-300 bg-white/80 text-[10px] text-emerald-700">
              <FolderKanban className="h-3 w-3" />
              {value.projectName}
            </Badge>
          )}
          {value.location && (
            <Badge variant="outline" className="gap-1 border-slate-200 bg-white/80 text-[10px] text-slate-600">
              <MapPin className="h-3 w-3" />
              {value.location}
            </Badge>
          )}
          {value.employmentType && (
            <Badge variant="outline" className="border-slate-200 bg-white/80 text-[10px] text-slate-600">
              {value.employmentType}
            </Badge>
          )}
        </div>
      </div>
    );
  }

  /* ── Picker ── */

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search by name, employee no., email, department, designation or project…"
            className="pl-9"
            disabled={disabled}
          />
          {term && (
            <button
              type="button"
              onClick={() => setTerm('')}
              aria-label="Clear search"
              className="absolute right-2 top-2 rounded-full p-1 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || disabled}>
          {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          Reload
        </Button>
      </div>

      {list && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
            {filtered.length} selectable
          </Badge>
          <span>of {list.totalEmployees} active employees</span>
          {Object.entries(list.excluded).map(([reason, count]) => (
            <span key={reason}>
              · {count} excluded ({reason.toLowerCase()})
            </span>
          ))}
        </div>
      )}

      {/*
        A mirror built only by incremental runs is *worse* than an empty one, because it looks
        populated. The employees an incremental run returns are the ones whose records changed —
        leavers and people on notice — so the list fills with exactly the people you cannot pick and
        the active majority is simply absent. Nothing above distinguishes that from "this employee
        genuinely isn't in greytHR", so it has to be said outright.
      */}
      {list?.mirrorRefreshRequired && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            <strong>This list needs a full rebuild.</strong> {list.mirrorRefreshReason} Run{' '}
            <Link href="/employee/sync" className="underline">
              Full resync
            </Link>{' '}
            to fetch everybody.
          </p>
        </div>
      )}

      {list && list.activeEmployeesMissingFromMirror > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {list.activeEmployeesMissingFromMirror} active employee
            {list.activeEmployeesMissingFromMirror === 1 ? ' is' : 's are'} in greytHR but not yet in
            the local mirror. Run{' '}
            <Link href="/employee/sync" className="underline">Full resync</Link> to add them.
          </p>
        </div>
      )}

      {/* Only claim the list has never been synced when we actually received one. If the request
          failed, `error` below says so — asserting "never synced" as well would be a second,
          wrong explanation for the same problem. */}
      {list?.mirrorSyncedAt ? (
        <p className="text-[11px] text-muted-foreground">
          Employee list last refreshed from greytHR on{' '}
          {new Date(list.mirrorSyncedAt).toLocaleString()}. The person you pick is refetched live.
        </p>
      ) : list ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            This employee list has never been synced from greytHR, so it may be empty or out of date.
            Run a sync from{' '}
            <Link href="/employee/sync" className="underline">
              greytHR Sync
            </Link>{' '}
            first.
          </p>
        </div>
      ) : null}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <ScrollArea className="h-64 rounded-xl border border-white/70 bg-white/60 sm:h-80">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading employees…
          </div>
        ) : windowed.length === 0 ? (
          <div className="py-10">
            <HrEmptyState
              icon={UserSearch}
              title={term ? `No employee matches “${term}”` : 'No selectable employees'}
              description={
                term
                  ? 'Try a different search, or create the user manually.'
                  : 'Every active employee already has a login, or the employee list has not been synced yet.'
              }
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {windowed.map((employee) => (
              <button
                key={employee.employeeId}
                type="button"
                disabled={disabled || resolvingId !== null}
                onClick={() => void choose(employee)}
                className="flex w-full items-start gap-2.5 px-2.5 py-2.5 text-left transition-colors hover:bg-indigo-50/60 disabled:opacity-60"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {(employee.name || '?')
                    .split(' ')
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-slate-800">
                      {employee.name || '(no name in greytHR)'}
                    </span>
                    {employee.employeeNo && (
                      <Badge variant="outline" className="text-[10px] text-slate-500">{employee.employeeNo}</Badge>
                    )}
                    {employee.employmentState === 'Notice Period' && (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                        Notice period
                      </Badge>
                    )}
                    {!employee.email && (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                        No email in greytHR
                      </Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {[employee.email, employee.designation, employee.department, employee.projectName]
                      .filter(Boolean)
                      .join(' · ') || 'No further details in greytHR'}
                  </span>
                </span>
                {resolvingId === employee.employeeId && (
                  <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-indigo-600" />
                )}
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {filtered.length > windowed.length && (
        <p className="text-[11px] text-muted-foreground">
          Showing the first {windowed.length} of {filtered.length}. Narrow the search to see the rest.
        </p>
      )}
    </div>
  );
}

/** Small labelled readout of a greytHR category, for the "what we found" panel. */
export function CategoryChips({
  categories,
  className,
}: {
  categories: Record<string, string>;
  className?: string;
}) {
  const entries = Object.entries(categories).filter(([, value]) => value);
  if (!entries.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {entries.map(([category, value]) => (
        <Badge key={category} variant="outline" className="text-[10px] text-slate-600">
          <span className="text-slate-400">{category}:</span>&nbsp;{value}
        </Badge>
      ))}
    </div>
  );
}
