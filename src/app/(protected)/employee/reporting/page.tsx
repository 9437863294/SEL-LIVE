'use client';

/**
 * The reporting structure — who reports to whom, as greytHR records it.
 *
 * The sync has written `reportingManagerEmployeeId` onto every employee for as long as the
 * "Reporting structure" detail group has been on, and until now two things read it: the profile
 * page, one person at a time, and the trip-claims module, which walks one step up to find an
 * approver. Nobody could see the shape of the organisation, and nothing reported the gaps in it —
 * which is what this is for. A manager who has left, a manager the mirror does not hold, somebody
 * recorded as their own manager, two people managing each other: each is invisible on a profile
 * and obvious across the whole set, and each one breaks an approval route.
 *
 * ── Why a filter never changes the tree ─────────────────────────────────────────────────────────
 *
 * The structure is derived over *everyone*, always, and the filter decides only which rows are
 * drawn. Deriving it over the filtered set instead would mean hiding departed staff promoted their
 * reportees to the top of the organisation — a hierarchy the screen invented.
 *
 * Read-only. greytHR owns the org tree. Fleet & Travel's claim workflow follows these same links
 * (Settings › Workflow shows whose claims go where), so a broken link here is a claim with no
 * manager to approve it there.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  Download,
  Network,
  RefreshCw,
  Search,
  Users,
  UserX,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/shared/status-badge';
import { PageHeader } from '@/components/shared/page-header';
import { HrAccessDenied, HrEmptyState, HrLoader } from '@/components/hr/hr-ui';
import {
  EmployeeErrorBanner,
  EmployeeKpiCard,
  EmployeeListFooter,
  EmployeePageShell,
  EmployeeSubNav,
  EMP_CARD_CLASS,
} from '@/components/employee/employee-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';
import { exportRowsToExcel } from '@/lib/report-excel';
import { fetchReportingStructure } from '@/lib/greythr-sync-client';
import {
  buildReportingStructure,
  flattenReportingTree,
  primaryIssue,
  REPORTING_ISSUE_LABELS,
  type ReportingIssue,
  type ReportingNode,
  type ReportingPerson,
} from '@/lib/reporting-structure';

/** Same lesson as the other registers: ~1,300 rows in the DOM at once freezes the page. */
const PAGE_SIZE = 300;

const ISSUE_TONE: Record<ReportingIssue, string> = {
  cycle: 'border-rose-200 bg-rose-50 text-rose-700',
  'self-manager': 'border-rose-200 bg-rose-50 text-rose-700',
  'manager-missing': 'border-amber-200 bg-amber-50 text-amber-800',
  'manager-departed': 'border-amber-200 bg-amber-50 text-amber-800',
  'no-manager': 'border-slate-200 bg-slate-50 text-slate-600',
};

type StatusFilter = 'working' | 'all' | 'departed';
type IssueFilter = 'any' | 'problems' | ReportingIssue;

export default function ReportingStructurePage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Settings.Employee Management');

  const [people, setPeople] = useState<ReportingPerson[] | null>(null);
  const [meta, setMeta] = useState<{ groupEnabled: boolean; syncedAt: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<'table' | 'tree'>('table');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('working');
  const [issue, setIssue] = useState<IssueFilter>('any');
  const [department, setDepartment] = useState('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetchReportingStructure();
      setPeople(response.people);
      setMeta({ groupEnabled: response.groupEnabled, syncedAt: response.syncedAt });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the reporting structure.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !canView) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load();
  }, [authLoading, canView, load]);

  // Over everyone, always — see the note at the top of the file.
  const structure = useMemo(() => buildReportingStructure(people ?? []), [people]);
  const byId = useMemo(
    () => new Map(structure.nodes.map((node) => [node.employeeId, node])),
    [structure],
  );

  const departments = useMemo(
    () => [...new Set(structure.nodes.map((node) => node.department).filter(Boolean))].sort(),
    [structure],
  );

  /** The display filter. It narrows rows; it never re-derives the hierarchy. */
  const matches = useCallback(
    (node: ReportingNode): boolean => {
      if (status === 'working' && !node.working) return false;
      if (status === 'departed' && node.working) return false;
      if (department !== 'all' && node.department !== department) return false;
      if (issue === 'problems' && primaryIssue(node) === null) return false;
      // "No manager" alone is not a problem — somebody has to be at the top.
      if (issue === 'problems' && node.issues.length === 1 && node.issues[0] === 'no-manager') return false;
      if (issue !== 'any' && issue !== 'problems' && !node.issues.includes(issue)) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const manager = node.resolvedManagerId ? byId.get(node.resolvedManagerId)?.name : node.managerName;
        const haystack = [node.name, node.employeeNo, node.department, node.designation, manager]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    },
    [status, department, issue, search, byId],
  );

  const tableRows = useMemo(() => structure.nodes.filter(matches), [structure, matches]);

  const treeRows = useMemo(() => {
    const rows = flattenReportingTree(structure, expanded);
    // A parent stays visible when a filter hides it but keeps a visible descendant, or the tree
    // would show children hanging from nothing.
    return rows.filter((row) => matches(row.node) || row.node.children.some((id) => {
      const child = byId.get(id);
      return child ? matches(child) : false;
    }));
  }, [structure, expanded, matches, byId]);

  const shown = view === 'table' ? tableRows.slice(0, limit) : treeRows.slice(0, limit);
  const totalRows = view === 'table' ? tableRows.length : treeRows.length;

  const toggle = (employeeId: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });

  const expandAll = () => setExpanded(new Set(structure.nodes.map((node) => node.employeeId)));
  const collapseAll = () => setExpanded(new Set());

  const managerNameOf = (node: ReportingNode): string => {
    if (node.resolvedManagerId) return byId.get(node.resolvedManagerId)?.name || node.resolvedManagerId;
    /*
      Only a genuinely missing manager has a name worth printing.

      A self-manager also has no resolved manager and a `managerName` — their own — and showing it
      read as "reports to Manager E10, not in the mirror", which is wrong twice: that person is in
      the mirror, and they are this row. The badge already says "Own manager"; the cell says nothing.
    */
    if (node.issues.includes('manager-missing') && node.managerName) return node.managerName;
    return '';
  };

  const handleExport = async () => {
    await exportRowsToExcel(
      'Reporting structure',
      tableRows.map((node) => ({
        'Employee No': node.employeeNo,
        Name: node.name,
        Department: node.department,
        Designation: node.designation,
        State: node.employmentState,
        Manager: managerNameOf(node),
        'Manager source': node.resolvedManagerId ? 'greytHR' : node.managerName ? 'Named, not in mirror' : '',
        Depth: node.depth ?? '',
        'Direct reportees': node.directReportees,
        'Total reportees': node.totalReportees,
        Issue: primaryIssue(node) ? REPORTING_ISSUE_LABELS[primaryIssue(node)!] : '',
      })),
      { filename: 'reporting-structure.xlsx', sheetName: 'Reporting' },
    );
  };

  if (authLoading || loading) {
    return (
      <EmployeePageShell>
        <HrLoader label="Loading the reporting structure…" />
      </EmployeePageShell>
    );
  }

  if (!canView) {
    return (
      <EmployeePageShell>
        <HrAccessDenied what="the reporting structure" />
      </EmployeePageShell>
    );
  }

  const problems =
    structure.counts.missingManagers +
    structure.counts.departedManagers +
    structure.counts.selfManaged +
    structure.counts.inCycles;

  return (
    <EmployeePageShell>
      <PageHeader
        icon={Network}
        eyebrow="Employee management"
        title="Reporting structure"
        backHref="/employee"
        backLabel="Back to Employee Management"
        badge={<StatusBadge status="Read-only" />}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="bg-white/80"
              onClick={() => void handleExport()}
              disabled={tableRows.length === 0}
            >
              <Download className="mr-1.5 h-4 w-4" />
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-white/80"
              onClick={() => void load(true)}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? 'mr-1.5 h-4 w-4 animate-spin' : 'mr-1.5 h-4 w-4'} />
              Refresh
            </Button>
          </>
        }
      />

      <EmployeeSubNav current="reporting" />

      {error && <EmployeeErrorBanner onRetry={() => void load(true)}>{error}</EmployeeErrorBanner>}

      {/*
        Two very different situations that look identical on screen — every row saying "no manager"
        because nobody fills the field in greytHR, or because the sync was never asked to fetch it.
      */}
      {meta && !meta.groupEnabled && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-xs text-amber-900">
          The <span className="font-medium">Reporting structure</span> detail group is switched off,
          so no org tree has been fetched. Turn it on under{' '}
          <span className="font-medium">Sync → Automatic refresh → Standard detail</span> and run it.
        </div>
      )}

      <p className="mb-3 text-xs text-muted-foreground">
        Fleet &amp; Travel sends trip claims up this line when its workflow follows the reporting authority —{' '}
        <Link href="/driver-management/settings/workflow" className="font-medium text-slate-700 underline underline-offset-2">
          see whose claims go where
        </Link>
        .
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <EmployeeKpiCard label="Employees" value={structure.counts.total} icon={Users} tone="indigo" index={0} />
        <EmployeeKpiCard
          label="With a manager"
          value={structure.counts.withManager}
          icon={Network}
          tone="emerald"
          index={1}
        />
        <EmployeeKpiCard
          label="Top of a chain"
          value={structure.counts.roots}
          hint="nobody above them"
          icon={Users}
          tone="cyan"
          index={2}
        />
        <EmployeeKpiCard
          label="Deepest chain"
          value={structure.counts.maxDepth}
          hint="levels"
          icon={ChevronRight}
          tone="violet"
          index={3}
        />
        <EmployeeKpiCard
          label="Broken links"
          value={problems}
          hint="missing, departed, looping"
          icon={AlertTriangle}
          tone={problems > 0 ? 'amber' : 'slate'}
          index={4}
        />
      </div>

      <div className={cn('mb-3 rounded-2xl p-2.5', EMP_CARD_CLASS)}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(['table', 'tree'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                  view === option ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                {option === 'table' ? 'Table' : 'Hierarchy'}
              </button>
            ))}
          </div>

          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, number, department or manager"
              className="h-8 pl-8 text-xs"
            />
          </div>

          <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
            <SelectTrigger className="h-8 w-[9rem] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="working">Working</SelectItem>
              <SelectItem value="departed">Departed</SelectItem>
              <SelectItem value="all">Everyone</SelectItem>
            </SelectContent>
          </Select>

          <Select value={issue} onValueChange={(value) => setIssue(value as IssueFilter)}>
            <SelectTrigger className="h-8 w-[12rem] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any link</SelectItem>
              <SelectItem value="problems">Broken links only</SelectItem>
              {(Object.keys(REPORTING_ISSUE_LABELS) as ReportingIssue[]).map((key) => (
                <SelectItem key={key} value={key}>{REPORTING_ISSUE_LABELS[key]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="h-8 w-[11rem] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {view === 'tree' && (
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={expandAll}>Expand all</Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={collapseAll}>Collapse</Button>
            </div>
          )}
        </div>
      </div>

      {totalRows === 0 ? (
        <HrEmptyState
          icon={Network}
          title="Nothing matches"
          description={
            structure.counts.total === 0
              ? 'No employees have been synced yet. Run a greytHR sync to populate this.'
              : 'Try a different search, status or department.'
          }
        />
      ) : (
        <div className={cn('overflow-hidden rounded-2xl', EMP_CARD_CLASS)}>
          {/* Native overflow, not ScrollArea — that wrapper swallows the horizontal scrollbar. */}
          <div className="min-w-0 overflow-auto">
            <table className="w-full min-w-[56rem] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
                <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-2 py-2 font-semibold">Employee</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Department</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Reports to</th>
                  <th scope="col" className="px-2 py-2 font-semibold">State</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Direct</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">All below</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Level</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((entry) => {
                  const node = 'node' in entry ? entry.node : entry;
                  const indent = 'indent' in entry ? entry.indent : 0;
                  const hasChildren = 'hasChildren' in entry ? entry.hasChildren : false;
                  const isLast = 'isLast' in entry ? entry.isLast : true;
                  const ancestorIsLast = 'ancestorIsLast' in entry ? entry.ancestorIsLast : [];
                  const issueKey = primaryIssue(node);
                  const managerName = managerNameOf(node);

                  return (
                    <tr key={node.employeeId} className="align-top hover:bg-slate-50/70">
                      {/*
                        `py-0` with the inner row padding instead: the guide columns are
                        `self-stretch`, and a vertical line has to reach the cell edges to meet
                        the one in the row above and below. Padding on the cell would break it
                        into dashes.
                      */}
                      <td className={cn('max-w-[22rem] px-2', view === 'tree' ? 'py-0' : 'py-2')}>
                        <div className={cn('flex items-stretch gap-1', view === 'tree' && 'min-h-[3.25rem]')}>
                          {view === 'tree' &&
                            ancestorIsLast.map((finished, column) => (
                              // One column per ancestor. A finished branch leaves it blank; an
                              // unfinished one keeps the line running past this row to the
                              // sibling further down.
                              <span key={column} className="relative w-4 shrink-0 self-stretch" aria-hidden>
                                {!finished && <span className="absolute left-1/2 top-0 h-full w-px bg-slate-300" />}
                              </span>
                            ))}

                          {view === 'tree' && indent > 0 && (
                            // The elbow. Its vertical half stops at the middle for a last child
                            // (└) and runs the full height for any other (├).
                            <span className="relative w-4 shrink-0 self-stretch" aria-hidden>
                              <span className={cn('absolute left-1/2 top-0 w-px bg-slate-300', isLast ? 'h-1/2' : 'h-full')} />
                              <span className="absolute left-1/2 top-1/2 h-px w-[calc(50%+0.25rem)] bg-slate-300" />
                            </span>
                          )}

                          {view === 'tree' && (
                            <button
                              type="button"
                              onClick={() => hasChildren && toggle(node.employeeId)}
                              aria-label={hasChildren ? (expanded.has(node.employeeId) ? 'Collapse' : 'Expand') : undefined}
                              aria-expanded={hasChildren ? expanded.has(node.employeeId) : undefined}
                              disabled={!hasChildren}
                              className={cn(
                                // Self-centred rather than top-aligned so the caret sits on the
                                // elbow it belongs to.
                                'my-auto flex h-6 w-6 shrink-0 items-center justify-center rounded',
                                hasChildren ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-700' : 'invisible',
                              )}
                            >
                              <ChevronRight
                                className={cn(
                                  'h-3.5 w-3.5 transition-transform',
                                  expanded.has(node.employeeId) && 'rotate-90',
                                )}
                              />
                            </button>
                          )}
                          <div className={cn('min-w-0', view === 'tree' ? 'my-auto py-1.5' : '')}>
                            <p className="truncate font-medium text-slate-800">{node.name || node.employeeNo}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {[node.employeeNo, node.designation].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="max-w-[10rem] px-2 py-2">
                        <p className="truncate text-slate-600">{node.department || '—'}</p>
                      </td>

                      <td className="max-w-[14rem] px-2 py-2">
                        {managerName ? (
                          <p className="truncate text-slate-700" title={managerName}>{managerName}</p>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                        {node.issues.includes('manager-missing') && (
                          <p className="truncate text-[11px] text-amber-700">not in the mirror</p>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-2 py-2">
                        {node.working ? (
                          <StatusBadge status={node.employmentState} tone="success" />
                        ) : (
                          <StatusBadge status={node.employmentState} tone="danger" />
                        )}
                      </td>

                      <td className={cn('px-2 py-2 text-right tabular-nums', node.directReportees ? 'text-slate-700' : 'text-slate-300')}>
                        {node.directReportees}
                      </td>
                      <td className={cn('px-2 py-2 text-right tabular-nums', node.totalReportees ? 'text-slate-700' : 'text-slate-300')}>
                        {node.totalReportees}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {node.depth ?? '—'}
                      </td>

                      <td className="whitespace-nowrap px-2 py-2">
                        {issueKey && issueKey !== 'no-manager' ? (
                          <Badge variant="outline" className={cn('gap-1 text-[10px]', ISSUE_TONE[issueKey])}>
                            <UserX className="h-3 w-3" />
                            {REPORTING_ISSUE_LABELS[issueKey]}
                          </Badge>
                        ) : issueKey === 'no-manager' ? (
                          <span className="text-[11px] text-muted-foreground">Top of chain</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <EmployeeListFooter
            shown={shown.length}
            total={totalRows}
            noun={view === 'tree' ? 'person' : 'row'}
            pageSize={PAGE_SIZE}
            onMore={() => setLimit((value) => value + PAGE_SIZE)}
          />
        </div>
      )}
    </EmployeePageShell>
  );
}
