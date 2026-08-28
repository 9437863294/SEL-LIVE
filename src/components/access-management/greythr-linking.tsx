'use client';

/**
 * The user ↔ greytHR employee linking console.
 *
 * One table of every platform login, reconciled against the employee mirror, worst rows first. The
 * ordering is the design: an administrator opening this screen wants the conflicts and the unmatched
 * accounts, not the 800 rows that are already fine.
 *
 * ── What this screen does not do ────────────────────────────────────────────────────────────────
 *
 * It does not create logins, and it does not change roles or permissions. Linking attaches an HR
 * record to an existing account; the two remain separate decisions, so fixing a bad link is never
 * destructive to somebody's access. Creating a login for an employee who has none is the Add User
 * flow's job, and this screen links to it rather than duplicating it.
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  HrAccessDenied,
  HrDataList,
  HrEmptyState,
  HrLoader,
  HrPageHeader,
  hrDialog,
  type HrListColumn,
} from '@/components/hr/hr-ui';
import { AccessKpiCard, AccessPageShell } from './access-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  LINK_STATUS_LABELS,
  linkMethodLabel,
  linkRowSearchText,
  sortLinkRows,
  type LinkCandidate,
  type LinkRow,
  type LinkRowStatus,
} from '@/lib/greythr-linking';
import {
  bulkLinkUsers,
  fetchLinkReport,
  linkUserToEmployee,
  unlinkUserFromEmployee,
  type LinkReportResponse,
} from '@/lib/greythr-sync-client';

const STATUS_TONE: Record<LinkRowStatus, string> = {
  linked: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  suggested: 'border-blue-200 bg-blue-50 text-blue-700',
  review: 'border-amber-200 bg-amber-50 text-amber-800',
  conflict: 'border-rose-200 bg-rose-50 text-rose-700',
  unlinked: 'border-slate-200 bg-slate-100 text-slate-600',
};

const FILTERS: Array<{ value: 'all' | LinkRowStatus; label: string }> = [
  { value: 'all', label: 'All users' },
  { value: 'conflict', label: 'Conflicts' },
  { value: 'review', label: 'Needs review' },
  { value: 'suggested', label: 'Ready to link' },
  { value: 'unlinked', label: 'Not in greytHR' },
  { value: 'linked', label: 'Linked' },
];

export function GreytHRLinkingWorkspace() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const canView = can('View', 'Settings.User Management');
  // Either the narrow new action or the broad existing one — see the API route's header.
  const canLink =
    can('Link greytHR', 'Settings.User Management') || can('Edit', 'Settings.User Management');

  const [report, setReport] = useState<LinkReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | LinkRowStatus>('all');

  const [choosing, setChoosing] = useState<LinkRow | null>(null);
  const [chosenEmployee, setChosenEmployee] = useState<string>('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [unlinking, setUnlinking] = useState<LinkRow | null>(null);
  const [unlinkReason, setUnlinkReason] = useState('');
  const [confirmBulk, setConfirmBulk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchLinkReport());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the linking report.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !canView) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load();
  }, [authLoading, canView, load]);

  const rows = useMemo(() => {
    if (!report) return [];
    const term = search.trim().toLowerCase();
    return sortLinkRows(
      report.rows.filter((row) => {
        if (filter !== 'all' && row.status !== filter) return false;
        if (!term) return true;
        return linkRowSearchText(row).includes(term);
      }),
    ).map((row) => ({ ...row, id: row.user.id }));
  }, [report, search, filter]);

  /**
   * Employees available to link, for the picker.
   *
   * Already-claimed employees are excluded upstream, so this list is exactly what can legitimately
   * be chosen — the picker cannot offer a link the API would then reject.
   */
  const availableEmployees = useMemo(() => {
    if (!report) return [];
    const term = employeeSearch.trim().toLowerCase();
    const pool = choosing?.candidates.length ? choosing.candidates : report.unlinkedEmployees;
    if (!term) return pool.slice(0, 100);
    return pool
      .filter((employee) =>
        `${employee.employeeNo} ${employee.name} ${employee.department} ${employee.designation}`
          .toLowerCase()
          .includes(term),
      )
      .slice(0, 100);
  }, [report, employeeSearch, choosing]);

  /* ── Actions ── */

  const handleLink = async (userId: string, employeeId: string) => {
    setBusy(userId);
    try {
      await linkUserToEmployee(userId, employeeId);
      toast({ title: 'Linked', description: 'HR data will follow this employee record from now on.' });
      setChoosing(null);
      setChosenEmployee('');
      await load();
    } catch (err) {
      // Kept open with the reason on screen. The most common failure — somebody else already claims
      // this employee — is one the administrator can act on immediately, and closing the dialog
      // would lose the context they need to.
      toast({
        title: 'Not linked',
        description: err instanceof Error ? err.message : 'The link could not be saved.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleUnlink = async () => {
    if (!unlinking) return;
    setBusy(unlinking.user.id);
    try {
      await unlinkUserFromEmployee(unlinking.user.id, unlinkReason);
      toast({
        title: 'Unlinked',
        description: 'Roles and permissions are unchanged — only the HR data source was removed.',
      });
      setUnlinking(null);
      setUnlinkReason('');
      await load();
    } catch (err) {
      toast({
        title: 'Not unlinked',
        description: err instanceof Error ? err.message : 'Nothing was changed.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleBulk = async () => {
    setBusy('bulk');
    try {
      const result = await bulkLinkUsers();
      toast({
        title: `${result.linked} account(s) linked`,
        description: result.failed.length
          ? `${result.failed.length} could not be linked: ${result.failed
              .slice(0, 3)
              .map((entry) => entry.userName)
              .join(', ')}${result.failed.length > 3 ? '…' : ''}`
          : `${result.plan.skip.length} left for review.`,
        variant: result.failed.length ? 'destructive' : undefined,
      });
      setConfirmBulk(false);
      await load();
    } catch (err) {
      toast({
        title: 'Bulk linking failed',
        description: err instanceof Error ? err.message : 'Nothing was linked.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  /* ── Render ── */

  if (authLoading || loading) return <HrLoader label="Reconciling users against greytHR…" />;
  if (!canView) return <HrAccessDenied what="greytHR linking" />;

  const counts = report?.counts;
  const needsWork = (counts?.conflict ?? 0) + (counts?.review ?? 0);

  const columns: Array<HrListColumn<LinkRow & { id: string }>> = [
    {
      header: 'User',
      mobile: 'title',
      cell: (row) => (
        <div className="min-w-0">
          <Link
            href={`/settings/access-management/users/${row.user.id}`}
            className="font-medium text-slate-800 hover:underline"
          >
            {row.user.name || row.user.email || row.user.id}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {row.user.email || 'No email'}
            {row.user.employeeNo ? ` · ${row.user.employeeNo}` : ''}
          </p>
        </div>
      ),
    },
    {
      header: 'Status',
      mobile: 'aside',
      cell: (row) => (
        <Badge variant="outline" className={cn('font-normal', STATUS_TONE[row.status])}>
          {LINK_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      header: 'greytHR employee',
      // A second title line on the phone card; the two-column detail grid truncated
      // "E1401 · Priyanka Venkataraman" to a handful of characters.
      mobile: 'title',
      cell: (row) =>
        row.employee ? (
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800">
              {row.employee.employeeNo} · {row.employee.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[row.employee.designation, row.employee.department].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
        ) : row.candidates.length ? (
          <span className="text-xs text-amber-700">
            {row.candidates.length} candidate{row.candidates.length === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      header: 'Why',
      className: 'hidden lg:table-cell',
      // The reason is the point of this console; it reads as the card's subtitle rather than as a
      // truncated half-width detail cell.
      mobile: 'title',
      cell: (row) => <span className="text-xs text-muted-foreground">{row.reason}</span>,
    },
    {
      header: 'Account',
      className: 'hidden md:table-cell',
      cell: (row) => (
        <Badge
          variant="outline"
          className={cn(
            'font-normal',
            row.user.status === 'Active'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-slate-100 text-slate-600',
          )}
        >
          {row.user.status}
        </Badge>
      ),
    },
    {
      header: 'Actions',
      align: 'right',
      mobile: 'footer',
      cell: (row) => (
        <div className="flex justify-end gap-2">
          {row.status === 'suggested' && row.employee && (
            <Button
              size="sm"
              disabled={!canLink || busy === row.user.id}
              onClick={() => handleLink(row.user.id, row.employee!.employeeId)}
            >
              {busy === row.user.id ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Link
            </Button>
          )}
          {(row.status === 'review' || row.status === 'unlinked' || row.status === 'conflict') && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canLink}
              onClick={() => {
                setChoosing(row);
                setChosenEmployee(row.candidates[0]?.employeeId ?? '');
                setEmployeeSearch('');
              }}
            >
              <Search className="mr-1.5 h-3.5 w-3.5" />
              Choose
            </Button>
          )}
          {(row.status === 'linked' || row.status === 'conflict') && row.user.employeeId && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!canLink}
              onClick={() => {
                setUnlinking(row);
                setUnlinkReason('');
              }}
            >
              <Link2Off className="mr-1.5 h-3.5 w-3.5" />
              Unlink
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <AccessPageShell width="wide" backHref="/settings/user-management" backLabel="Back to User Management">
      <HrPageHeader
        title="greytHR linking"
        description="Match every platform login to its greytHR employee record. HR data flows in; roles and permissions stay here."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={!!busy}>
              <RefreshCw className={cn('mr-1.5 h-4 w-4', busy === 'bulk' && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              size="sm"
              disabled={!canLink || !report?.plan.apply.length || !!busy}
              onClick={() => setConfirmBulk(true)}
            >
              <Users className="mr-1.5 h-4 w-4" />
              Link {report?.plan.apply.length ?? 0}
              <span className="hidden sm:inline">
                &nbsp;confident match{report?.plan.apply.length === 1 ? '' : 'es'}
              </span>
            </Button>
          </>
        }
      />

      {error && (
        <Card className="mb-4 border-rose-200 bg-rose-50/80">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-rose-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}

      {/* Only shown when the report actually says the mirror is empty — an unreachable server
          leaves `report` null, which is a different problem and gets the error card above. */}
      {report && !report.rows.length && (
        <Card className="mb-4 border-amber-200 bg-amber-50/80">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>No platform users were found. Nothing can be linked yet.</span>
          </CardContent>
        </Card>
      )}

      {/* AccessKpiCard rather than HrKpiCard — this console is part of the access module's surface,
          and its landing screen should not look plainer than the Overview one click away. */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
        <AccessKpiCard index={0} label="Linked" value={counts?.linked ?? 0} icon={CheckCircle2} tone="emerald" />
        <AccessKpiCard
          index={1}
          label="Ready to link"
          value={counts?.suggested ?? 0}
          icon={Link2}
          tone="blue"
          hint="Matched on ID, number or email"
        />
        <AccessKpiCard
          index={2}
          label="Needs review"
          value={needsWork}
          icon={AlertTriangle}
          tone={needsWork ? 'amber' : 'slate'}
          hint="Ambiguous or conflicting"
        />
        <AccessKpiCard
          index={3}
          label="Not in greytHR"
          value={counts?.unlinked ?? 0}
          icon={Link2Off}
          tone="slate"
          hint="No matching employee"
        />
        <AccessKpiCard
          index={4}
          label="Employees without a login"
          value={counts?.unlinkedEmployees ?? 0}
          icon={UserPlus}
          tone="indigo"
          hint="Most never need one"
        />
      </div>

      {report?.mirrorSyncedAt && (
        <p className="mb-3 text-xs text-muted-foreground">
          Employee mirror last synced {new Date(report.mirrorSyncedAt).toLocaleString('en-IN')}.{' '}
          <Link href="/employee/sync" className="underline">
            Run a sync
          </Link>{' '}
          if it looks out of date.
        </p>
      )}

      {/* Duplicate join keys, surfaced because they are why some rows cannot be matched
          automatically — and because they are worth fixing at the source in greytHR. */}
      {report && (report.ambiguous.employeeNos.length > 0 || report.ambiguous.emails.length > 0) && (
        <Card className="mb-4 border-amber-200 bg-amber-50/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-900">Duplicate values in greytHR</CardTitle>
            <CardDescription className="text-amber-800">
              These appear on more than one employee, so they cannot be used to match automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 pt-0 text-xs text-amber-900">
            {report.ambiguous.employeeNos.length > 0 && (
              <p>Employee numbers: {report.ambiguous.employeeNos.slice(0, 10).join(', ')}</p>
            )}
            {report.ambiguous.emails.length > 0 && (
              <p>Emails: {report.ambiguous.emails.slice(0, 10).join(', ')}</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, email or employee number…"
            className="pl-8"
          />
        </div>
        <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
          <SelectTrigger className="sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <HrDataList
        rows={rows}
        columns={columns}
        empty={
          <HrEmptyState
            title="Nothing to show"
            description="No user matches this filter."
            icon={Users}
          />
        }
      />

      {/* ── Choose an employee ── */}

      <Dialog open={!!choosing} onOpenChange={(open) => !open && setChoosing(null)}>
        <DialogContent className={hrDialog.contentWide}>
          <DialogHeader className={hrDialog.header}>
            <DialogTitle>Link {choosing?.user.name || 'this user'}</DialogTitle>
            <DialogDescription>
              {choosing?.candidates.length
                ? 'These employees matched. Pick the right one.'
                : 'Search every employee who does not already have a login.'}
            </DialogDescription>
          </DialogHeader>

          <div className={hrDialog.body}>
            {!choosing?.candidates.length && (
              <Input
                value={employeeSearch}
                onChange={(event) => setEmployeeSearch(event.target.value)}
                placeholder="Employee number, name, department…"
              />
            )}

            <ScrollArea className="h-auto rounded-md border sm:h-72">
              <div className="divide-y">
                {availableEmployees.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">
                    No employees match. They may already be linked to another account.
                  </p>
                )}
                {availableEmployees.map((employee: LinkCandidate) => (
                  <button
                    key={employee.employeeId}
                    type="button"
                    onClick={() => setChosenEmployee(employee.employeeId)}
                    className={cn(
                      'flex w-full items-start justify-between gap-3 p-3 text-left transition-colors hover:bg-slate-50',
                      chosenEmployee === employee.employeeId && 'bg-indigo-50',
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {employee.employeeNo} · {employee.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[employee.designation, employee.department].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant="outline" className="font-normal">
                        {employee.employmentState}
                      </Badge>
                      {choosing?.candidates.length ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {linkMethodLabel(employee.method)}
                        </p>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>

            <p className="text-xs text-muted-foreground">
              Linking changes where HR data comes from. It does not grant, remove or alter any role
              or permission.
            </p>
          </div>

          <DialogFooter className={hrDialog.footer}>
            <Button variant="outline" onClick={() => setChoosing(null)}>
              Cancel
            </Button>
            <Button
              disabled={!chosenEmployee || !!busy}
              onClick={() => choosing && handleLink(choosing.user.id, chosenEmployee)}
            >
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}
              Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Unlink ── */}

      <Dialog open={!!unlinking} onOpenChange={(open) => !open && setUnlinking(null)}>
        <DialogContent className={hrDialog.content}>
          <DialogHeader className={hrDialog.header}>
            <DialogTitle>Unlink {unlinking?.user.name || 'this user'}?</DialogTitle>
            <DialogDescription>
              Their greytHR HR data will stop appearing, and a resignation in greytHR will no longer
              deactivate this account. Roles and permissions are untouched.
            </DialogDescription>
          </DialogHeader>
          <div className={hrDialog.body}>
            <Label htmlFor="unlink-reason">Reason</Label>
            <Textarea
              id="unlink-reason"
              value={unlinkReason}
              onChange={(event) => setUnlinkReason(event.target.value)}
              placeholder="Linked to the wrong employee record."
              rows={3}
            />
          </div>
          <DialogFooter className={hrDialog.footer}>
            <Button variant="outline" onClick={() => setUnlinking(null)}>
              Keep the link
            </Button>
            <Button variant="destructive" disabled={!!busy} onClick={() => void handleUnlink()}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Unlink
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk confirmation ── */}

      <Dialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <DialogContent className={hrDialog.content}>
          <DialogHeader className={hrDialog.header}>
            <DialogTitle>Link {report?.plan.apply.length ?? 0} accounts?</DialogTitle>
            <DialogDescription>
              Only matches on greytHR employee ID, employee number or official email are included.
              Name and mobile matches are never applied automatically.
            </DialogDescription>
          </DialogHeader>
          <div className={hrDialog.body}>
            <ScrollArea className="h-auto rounded-md border sm:h-56">
              <div className="divide-y text-sm">
                {report?.plan.apply.slice(0, 200).map((entry) => (
                  <div
                    key={entry.userId}
                    className="flex flex-col items-start gap-0.5 p-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                  >
                    <span className="min-w-0 max-w-full truncate">{entry.userName}</span>
                    <span className="text-xs text-muted-foreground sm:shrink-0">
                      {entry.employeeNo} · {linkMethodLabel(entry.method)}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              {report?.plan.skip.length ?? 0} account(s) are left for review. Every link is recorded
              and can be removed individually.
            </p>
          </div>
          <DialogFooter className={hrDialog.footer}>
            <Button variant="outline" onClick={() => setConfirmBulk(false)}>
              Cancel
            </Button>
            <Button disabled={!!busy} onClick={() => void handleBulk()}>
              {busy === 'bulk' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Link them
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AccessPageShell>
  );
}
