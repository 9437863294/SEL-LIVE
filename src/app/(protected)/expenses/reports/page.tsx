'use client';

/**
 * The Expenses report centre.
 *
 * One page, one set of filters, every report. The catalogue lives in `@/lib/expenses-reports` and
 * this renders whatever it lists, so a new report is a new entry there rather than another route
 * with its own table and its own idea of how to format a rupee.
 *
 * Scope is a filter, not a fork: the same reports serve one department and the whole organisation,
 * which is what lets a department head and the finance office argue about a number rather than
 * about whose definition of it is right. `?departmentId=` pre-scopes the page, so the Reports
 * button on a department register lands here already narrowed to that department.
 *
 * What a person may see is decided before any of that. Without `View All` on Expense Requests,
 * only the departments they may open reach the page — fetched by department, so the other
 * departments' requests never reach the browser at all, and filtered again by the same `can`
 * check the department registers make, so every report, the pivot and every export read only
 * those. The Payments reports read Daily Requisition too, scoped the same way.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { collection, getDocs, query, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import {
  BarChart3,
  Download,
  Printer,
  ShieldAlert,
  Calendar as CalendarIcon,
  Table as TableIcon,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { exportRowsToExcel } from '@/lib/report-excel';
import type { Department, ExpenseRequest, Project } from '@/lib/types';
import { requisitionsByRequestNo, type ProgressRequisition } from '@/lib/requisition-progress';
import {
  EXPENSE_REPORTS,
  PAYMENT_STAGE_FILTERS,
  PAYMENT_SUMMARY_GROUPINGS,
  enrichExpenses,
  expenseReportById,
  filterExpensesForReport,
  formatReportCell,
  isNumericReportColumn,
  type EnrichedExpense,
  type ExpenseReportColumn,
  type ExpenseReportRow,
  type PaymentStageFilter,
  type PaymentSummaryGrouping,
} from '@/lib/expenses-reports';
import { useExpensesSettings } from '@/components/expenses/use-expenses-settings';
import { PivotReport } from '@/components/expenses/pivot-report';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';

/** The custom pivot sits in the list alongside the fixed reports, under its own id. */
const PIVOT_ID = 'custom-pivot';

/**
 * A department id no grant can name. `can('View', 'Expenses.Departments', …)` passes it only for a
 * grant that covers every department (module-wide `View All`, or `View` on all departments) —
 * never for a grant on particular departments — which is how the page tells the two apart.
 */
const ANY_DEPARTMENT_PROBE = '__any_department__';

/** Firestore's cap on the values of one `in` filter. */
const IN_QUERY_LIMIT = 30;

/** Every document whose `field` is one of `values`, in as many `in` queries as that takes. */
async function getDocsWhereIn(
  collectionName: string,
  field: string,
  values: readonly string[],
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const unique = Array.from(new Set(values.filter(Boolean)));
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += IN_QUERY_LIMIT) chunks.push(unique.slice(index, index + IN_QUERY_LIMIT));
  const snapshots = await Promise.all(
    chunks.map(chunk => getDocs(query(collection(db, collectionName), where(field, 'in', chunk)))),
  );
  return snapshots.flatMap(snapshot => snapshot.docs);
}

/** Column headings as an export keys its cells: a repeated heading would overwrite the first. */
function exportHeadings(columns: readonly ExpenseReportColumn[]): string[] {
  const seen = new Map<string, number>();
  return columns.map(column => {
    const count = (seen.get(column.label) ?? 0) + 1;
    seen.set(column.label, count);
    return count === 1 ? column.label : `${column.label} (${count})`;
  });
}

/** One body cell: text, a link across to the module that holds the record, or a stage badge. */
function ReportCell({ column, row }: { column: ExpenseReportColumn; row: ExpenseReportRow }) {
  const text = formatReportCell(row[column.key], column.type);
  const tone = column.toneKey ? row[column.toneKey] : null;
  // Badge renders a <div>, so it sits in the cell directly rather than inside the truncating span.
  if (tone && text) return <StatusBadge tone={tone as StatusTone}>{text}</StatusBadge>;
  const href = column.linkKey ? row[column.linkKey] : null;
  return (
    <span className="block max-w-[320px] truncate" title={text}>
      {typeof href === 'string' && href ? (
        <Link href={href} className="font-medium text-primary hover:underline print:text-foreground print:no-underline">
          {text}
        </Link>
      ) : (
        text
      )}
    </span>
  );
}

function ReportCentre() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  // Which report is showing comes from the URL, because the catalogue lives in the module sidebar
  // now — that also makes a report linkable and survives a refresh or a back button.
  const reportId = searchParams?.get('report') || EXPENSE_REPORTS[0].id;
  const canViewPage = can('View', 'Expenses.Reports');

  // The same test the department registers make: `View All` on Expense Requests sees everything;
  // anyone else sees the departments they may open.
  const canViewAll = can('View All', 'Expenses.Expense Requests');
  const seesEveryDepartment = canViewAll || can('View', 'Expenses.Departments', ANY_DEPARTMENT_PROBE);
  const canViewDepartment = useCallback(
    (departmentId: string) => canViewAll || can('View', 'Expenses.Departments', departmentId),
    [canViewAll, can],
  );

  const [isLoading, setIsLoading] = useState(true);
  const [expenses, setExpenses] = useState<EnrichedExpense[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  /** Each request's requisition, by request no. `undefined` when Daily Requisition could not be read. */
  const [requisitions, setRequisitions] = useState<ReadonlyMap<string, ProgressRequisition> | undefined>(undefined);

  const [departmentId, setDepartmentId] = useState('all');
  const [projectId, setProjectId] = useState('all');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  // Seeded from the module data rules; still adjustable per viewing.
  const { settings } = useExpensesSettings();
  const [highValueThreshold, setHighValueThreshold] = useState<number | null>(null);
  const threshold = highValueThreshold ?? settings.data.highValueThreshold;
  const [paymentStage, setPaymentStage] = useState<PaymentStageFilter>('all');
  const [paymentGroupBy, setPaymentGroupBy] = useState<PaymentSummaryGrouping>('department');

  // A department register links here with ?departmentId=, so the page opens already scoped.
  const scopedDepartmentId = searchParams?.get('departmentId') ?? null;
  useEffect(() => {
    if (scopedDepartmentId) setDepartmentId(scopedDepartmentId);
  }, [scopedDepartmentId]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canViewPage) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const mastersPromise = Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'departments')),
        ]);
        // A department-limited person's requests are fetched by department, so nobody else's are
        // ever downloaded — hiding them after the fact would still leave them in the browser.
        const permittedIds = seesEveryDepartment
          ? []
          : (await mastersPromise)[1].docs.map(entry => entry.id).filter(id => canViewDepartment(id));

        // Daily Requisition is read alongside, and on its own terms: a failure there costs the
        // Payments reports, not every report on the page.
        const requisitionsPromise = (
          seesEveryDepartment
            ? getDocs(collection(db, 'dailyRequisitions')).then(snapshot => snapshot.docs)
            : getDocsWhereIn('dailyRequisitions', 'departmentId', permittedIds)
        ).then(
          docs => docs,
          error => {
            console.warn('Daily Requisition could not be read for the Payments reports:', error);
            return null;
          },
        );

        const [[projectsSnap, deptsSnap], expenseDocs] = await Promise.all([
          mastersPromise,
          seesEveryDepartment
            ? getDocs(collection(db, 'expenseRequests')).then(snapshot => snapshot.docs)
            : getDocsWhereIn('expenseRequests', 'departmentId', permittedIds),
        ]);
        const expenseRows = expenseDocs.map(entry => ({ id: entry.id, ...entry.data() }) as ExpenseRequest);

        let requisitionDocs = await requisitionsPromise;
        if (requisitionDocs && !seesEveryDepartment) {
          // Daily Requisition can move a requisition to another department; those are still found
          // by the request no they carry.
          const found = new Set(requisitionDocs.map(entry => String(entry.data().depNo ?? '').trim()));
          const missing = expenseRows.map(row => (row.requestNo ?? '').trim()).filter(no => no && !found.has(no));
          try {
            requisitionDocs = [...requisitionDocs, ...(await getDocsWhereIn('dailyRequisitions', 'depNo', missing))];
          } catch (error) {
            console.warn('Daily Requisition could not be read for the Payments reports:', error);
            requisitionDocs = null;
          }
        }
        if (cancelled) return;

        const projectList = projectsSnap.docs.map(entry => ({ id: entry.id, ...entry.data() }) as Project);
        const departmentList = deptsSnap.docs.map(entry => ({ id: entry.id, ...entry.data() }) as Department);
        setProjects(projectList);
        setDepartments(departmentList);
        setExpenses(enrichExpenses(expenseRows, { projects: projectList, departments: departmentList }));
        if (requisitionDocs) {
          const byId = new Map(requisitionDocs.map(entry => [entry.id, { id: entry.id, ...entry.data() } as ProgressRequisition]));
          setRequisitions(requisitionsByRequestNo(Array.from(byId.values())));
        } else {
          setRequisitions(undefined);
        }
      } catch (error) {
        console.error('Error loading report data:', error);
        if (!cancelled) toast({ title: 'Error', description: 'Failed to load expense data.', variant: 'destructive' });
      }
      if (!cancelled) setIsLoading(false);
    };
    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [isAuthLoading, canViewPage, seesEveryDepartment, canViewDepartment, toast]);

  /**
   * The only requests any report, the pivot or an export ever sees. The fetch is already scoped;
   * this is the same test again on what came back, so the page never relies on the query alone.
   */
  const permittedExpenses = useMemo(
    () => (canViewAll ? expenses : expenses.filter(row => canViewDepartment(row.departmentId))),
    [expenses, canViewAll, canViewDepartment],
  );
  const visibleDepartments = useMemo(
    () => departments.filter(entry => canViewDepartment(entry.id)),
    [departments, canViewDepartment],
  );
  const allDepartmentsLabel = seesEveryDepartment ? 'All departments' : 'All your departments';

  const scoped = useMemo(
    () =>
      filterExpensesForReport(permittedExpenses, {
        from: dateRange?.from,
        to: dateRange?.to,
        departmentId,
        projectId,
        search,
      }),
    [permittedExpenses, dateRange, departmentId, projectId, search],
  );

  const definition = reportId === PIVOT_ID ? undefined : expenseReportById(reportId);
  const result = useMemo(
    () =>
      definition
        ? definition.build({
            expenses: scoped,
            highValueThreshold: threshold,
            requisitions,
            paymentStage,
            paymentGroupBy,
          })
        : null,
    [definition, scoped, threshold, requisitions, paymentStage, paymentGroupBy],
  );

  const scopeLabel = useMemo(() => {
    const parts: string[] = [
      departmentId === 'all'
        ? allDepartmentsLabel
        : departments.find(entry => entry.id === departmentId)?.name ?? 'Department',
    ];
    if (projectId !== 'all') parts.push(projects.find(entry => entry.id === projectId)?.projectName ?? 'Project');
    parts.push(
      dateRange?.from && dateRange?.to
        ? `${format(dateRange.from, 'dd MMM yyyy')} – ${format(dateRange.to, 'dd MMM yyyy')}`
        : 'All time',
    );
    return parts.join(' · ');
  }, [departmentId, projectId, dateRange, departments, projects, allDepartmentsLabel]);

  const activeFilterCount =
    (departmentId !== 'all' ? 1 : 0) + (projectId !== 'all' ? 1 : 0) + (search ? 1 : 0) + (dateRange?.from ? 1 : 0);
  const hasFilters = activeFilterCount > 0;
  const clearFilters = () => {
    setDepartmentId('all');
    setProjectId('all');
    setSearch('');
    setDateRange(undefined);
  };

  const handleExport = async () => {
    if (!definition || !result?.rows.length) return;
    // Exported with the same formatter the screen uses, so a figure in the workbook reads exactly
    // as it did in the report it came from.
    const headings = exportHeadings(result.columns);
    const toRecord = (row: ExpenseReportRow) => {
      const record: Record<string, string> = {};
      result.columns.forEach((column, index) => {
        record[headings[index]] = formatReportCell(row[column.key] ?? null, column.type);
      });
      return record;
    };
    const rows = result.rows.map(toRecord);
    if (result.total) rows.push(toRecord(result.total));
    await exportRowsToExcel(definition.title, rows, {
      filename: `${definition.id}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: definition.title,
    });
  };

  // Settings a report takes beyond the shared filters, in the card's toolbar row.
  const reportToolbar =
    definition?.id === 'high-value' ? (
      <div className="flex items-center gap-2">
        <Label htmlFor="expense-report-threshold">Threshold ₹</Label>
        <Input
          id="expense-report-threshold"
          type="number"
          className="max-w-[10rem]"
          value={threshold}
          onChange={event => setHighValueThreshold(Number(event.target.value) || 0)}
        />
      </div>
    ) : definition?.id === 'payment-status' ? (
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="expense-report-stage">Stage</Label>
        <Select value={paymentStage} onValueChange={value => setPaymentStage(value as PaymentStageFilter)}>
          <SelectTrigger id="expense-report-stage" className="w-full sm:w-[14rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_STAGE_FILTERS.map(option => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    ) : definition?.id === 'payment-summary' ? (
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="expense-report-grouping">Rows</Label>
        <Select value={paymentGroupBy} onValueChange={value => setPaymentGroupBy(value as PaymentSummaryGrouping)}>
          <SelectTrigger id="expense-report-grouping" className="w-full sm:w-[14rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_SUMMARY_GROUPINGS.map(option => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    ) : undefined;

  if (isAuthLoading) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full space-y-4">
        <PageHeader icon={BarChart3} title="Expense Reports" backHref="/expenses" />
        <Card className="border-destructive/30">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view reports.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader
        icon={BarChart3}
        title="Expense Reports"
        description={scopeLabel}
        backHref="/expenses"
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-2 print:hidden" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
            <Button
              size="sm"
              className="gap-2 print:hidden"
              onClick={() => void handleExport()}
              disabled={!definition || !result?.rows.length}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </>
        }
      />

      {/* Filters — one set, applied to whichever report is showing. */}
      <FilterBar
        className="print:hidden"
        search={{ value: search, onChange: setSearch, placeholder: 'Request no, party, description…' }}
        activeCount={activeFilterCount}
        onClear={clearFilters}
        summary={`${scoped.length.toLocaleString('en-IN')} of ${permittedExpenses.length.toLocaleString('en-IN')} requests in scope`}
      >
        <Select value={departmentId} onValueChange={setDepartmentId}>
          <SelectTrigger aria-label="Department"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{allDepartmentsLabel}</SelectItem>
            {visibleDepartments.map(entry => (
              <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger aria-label="Project"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map(entry => (
              <SelectItem key={entry.id} value={entry.id}>{entry.projectName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              aria-label="Period"
              className={cn('w-full justify-start text-left font-normal', !dateRange && 'text-muted-foreground')}
            >
              <CalendarIcon className="mr-2 h-3.5 w-3.5" />
              {dateRange?.from && dateRange?.to
                ? `${format(dateRange.from, 'dd MMM yyyy')} – ${format(dateRange.to, 'dd MMM yyyy')}`
                : 'All time'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
            />
            <div className="border-t p-2">
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setDateRange(undefined)}>
                All time
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </FilterBar>

      {/* The selected report. The catalogue that used to sit beside it is now nested under
          Reports in the module sidebar, so the page gets its full width. */}
      <div className="min-w-0 space-y-4">
        {reportId === PIVOT_ID ? (
          <PivotReport expenses={scoped} isLoading={isLoading} />
        ) : definition && result ? (
          <>
            <TableCard
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {definition.title}
                  <Badge variant="neutral">{definition.group}</Badge>
                </span>
              }
              description={
                <>
                  {definition.description}
                  {/* In the heading rather than the toolbar, so the figures still print. */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.stats.map(stat => (
                      <div key={stat.label} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{stat.label}</p>
                        <p className="text-sm font-bold text-foreground">{stat.value}</p>
                      </div>
                    ))}
                  </div>
                </>
              }
              count={isLoading ? undefined : result.rows.length}
              noun="row"
              toolbar={reportToolbar}
            >
                {isLoading ? (
                  <div className="space-y-2 p-6">
                    {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-6 w-full" />)}
                  </div>
                ) : result.rows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                    <TableIcon className="mb-3 h-10 w-10 opacity-30" />
                    <p className="max-w-md px-4 font-medium">{result.emptyMessage}</p>
                    {hasFilters && (
                      <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    )}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {result.columns.map(column => (
                          <TableHead
                            key={column.key}
                            className={cn('whitespace-nowrap', isNumericReportColumn(column.type) && 'text-right')}
                          >
                            {column.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.rows.map((row, index) => (
                        <TableRow key={index}>
                          {result.columns.map(column => (
                            <TableCell
                              key={column.key}
                              className={cn(
                                'whitespace-nowrap',
                                isNumericReportColumn(column.type) && 'text-right tabular-nums',
                              )}
                            >
                              <ReportCell column={column} row={row} />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                    {result.total && (
                      <TableFooter>
                        <TableRow>
                          {result.columns.map(column => (
                            <TableCell
                              key={column.key}
                              className={cn(
                                'whitespace-nowrap',
                                isNumericReportColumn(column.type) && 'text-right tabular-nums',
                              )}
                            >
                              {result.total?.[column.key] === undefined
                                ? ''
                                : formatReportCell(result.total[column.key], column.type)}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableFooter>
                    )}
                  </Table>
                )}
            </TableCard>
          </>
        ) : null}
        </div>
    </div>
  );
}

export default function ExpenseReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full space-y-4">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      }
    >
      <ReportCentre />
    </Suspense>
  );
}
