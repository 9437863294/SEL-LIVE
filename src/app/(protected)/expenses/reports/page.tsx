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
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
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
import {
  EXPENSE_REPORTS,
  EXPENSE_REPORT_GROUPS,
  enrichExpenses,
  expenseReportById,
  filterExpensesForReport,
  formatReportCell,
  type EnrichedExpense,
} from '@/lib/expenses-reports';
import { useExpensesSettings } from '@/components/expenses/use-expenses-settings';
import { PivotReport } from '@/components/expenses/pivot-report';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
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

function ReportCentre() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  // Which report is showing comes from the URL, because the catalogue lives in the module sidebar
  // now — that also makes a report linkable and survives a refresh or a back button.
  const reportId = searchParams?.get('report') || EXPENSE_REPORTS[0].id;
  const canViewPage = can('View', 'Expenses.Reports');

  const [isLoading, setIsLoading] = useState(true);
  const [expenses, setExpenses] = useState<EnrichedExpense[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [departmentId, setDepartmentId] = useState('all');
  const [projectId, setProjectId] = useState('all');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  // Seeded from the module data rules; still adjustable per viewing.
  const { settings } = useExpensesSettings();
  const [highValueThreshold, setHighValueThreshold] = useState<number | null>(null);
  const threshold = highValueThreshold ?? settings.data.highValueThreshold;

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
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [expensesSnap, projectsSnap, deptsSnap] = await Promise.all([
          getDocs(collection(db, 'expenseRequests')),
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'departments')),
        ]);
        const projectList = projectsSnap.docs.map(entry => ({ id: entry.id, ...entry.data() }) as Project);
        const departmentList = deptsSnap.docs.map(entry => ({ id: entry.id, ...entry.data() }) as Department);
        setProjects(projectList);
        setDepartments(departmentList);
        setExpenses(
          enrichExpenses(
            expensesSnap.docs.map(entry => ({ id: entry.id, ...entry.data() }) as ExpenseRequest),
            { projects: projectList, departments: departmentList },
          ),
        );
      } catch (error) {
        console.error('Error loading report data:', error);
        toast({ title: 'Error', description: 'Failed to load expense data.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    void fetchData();
  }, [isAuthLoading, canViewPage, toast]);

  const scoped = useMemo(
    () =>
      filterExpensesForReport(expenses, {
        from: dateRange?.from,
        to: dateRange?.to,
        departmentId,
        projectId,
        search,
      }),
    [expenses, dateRange, departmentId, projectId, search],
  );

  const definition = reportId === PIVOT_ID ? undefined : expenseReportById(reportId);
  const result = useMemo(
    () => (definition ? definition.build({ expenses: scoped, highValueThreshold: threshold }) : null),
    [definition, scoped, threshold],
  );

  const scopeLabel = useMemo(() => {
    const parts: string[] = [
      departmentId === 'all'
        ? 'All departments'
        : departments.find(entry => entry.id === departmentId)?.name ?? 'Department',
    ];
    if (projectId !== 'all') parts.push(projects.find(entry => entry.id === projectId)?.projectName ?? 'Project');
    parts.push(
      dateRange?.from && dateRange?.to
        ? `${format(dateRange.from, 'dd MMM yyyy')} – ${format(dateRange.to, 'dd MMM yyyy')}`
        : 'All time',
    );
    return parts.join(' · ');
  }, [departmentId, projectId, dateRange, departments, projects]);

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
    const rows = result.rows.map(row => {
      const record: Record<string, string> = {};
      result.columns.forEach(column => {
        record[column.label] = formatReportCell(row[column.key], column.type);
      });
      return record;
    });
    if (result.total) {
      const totalRow: Record<string, string> = {};
      result.columns.forEach(column => {
        totalRow[column.label] = formatReportCell(result.total?.[column.key] ?? null, column.type);
      });
      rows.push(totalRow);
    }
    await exportRowsToExcel(definition.title, rows, {
      filename: `${definition.id}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: definition.title,
    });
  };

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
        summary={`${scoped.length.toLocaleString('en-IN')} of ${expenses.length.toLocaleString('en-IN')} requests in scope`}
      >
        <Select value={departmentId} onValueChange={setDepartmentId}>
          <SelectTrigger aria-label="Department"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map(entry => (
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
                ? `${format(dateRange.from, 'dd MMM')} – ${format(dateRange.to, 'dd MMM yy')}`
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
              toolbar={
                definition.id === 'high-value' ? (
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
                ) : undefined
              }
            >
                {isLoading ? (
                  <div className="space-y-2 p-6">
                    {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-6 w-full" />)}
                  </div>
                ) : result.rows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <TableIcon className="mb-3 h-10 w-10 opacity-30" />
                    <p className="font-medium">{result.emptyMessage}</p>
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
                            className={cn(
                              'whitespace-nowrap',
                              column.type && column.type !== 'text' && column.type !== 'date' && 'text-right',
                            )}
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
                                column.type && column.type !== 'text' && column.type !== 'date' && 'text-right tabular-nums',
                              )}
                            >
                              <span className="block max-w-[320px] truncate" title={String(row[column.key] ?? '')}>
                                {formatReportCell(row[column.key], column.type)}
                              </span>
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
                                column.type && column.type !== 'text' && column.type !== 'date' && 'text-right tabular-nums',
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
