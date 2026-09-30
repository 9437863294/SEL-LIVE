


'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  ShieldAlert, SlidersHorizontal,
  FileText, IndianRupee, Building2, TrendingUp,
  Receipt, Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { DailyRequisitionEntry, Department, ExpenseRequest, Project } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar, SearchInput } from '@/components/shared/filter-bar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ExpenseDetailsDialog,
  PaidBalanceCell,
  RemarksCell,
  RequestNoCell,
  StageCell,
  StageFilterSelect,
  formatExpenseTimestamp,
  formatReceptionDate,
  matchesStageFilter,
  receptionOf,
  requisitionOf,
  withProgressColumns,
  type StageFilter,
} from '@/components/expenses/expense-details-dialog';
import { useExpensesSettings } from '@/components/expenses/use-expenses-settings';
import { applyColumnSettings } from '@/lib/expenses-settings';
import { formatInr } from '@/lib/bank-balance-ledger';
import { requisitionsByRequestNo } from '@/lib/requisition-progress';
import { PageHeader } from '@/components/shared/page-header';

const EMPTY_FILTERS = {
  requestNo: '',
  projectName: 'all',
  departmentName: 'all',
  partyName: '',
  stage: 'all' as StageFilter,
};

export default function AllExpensesPage() {
  const { toast } = useToast();
  const { loading: isAuthLoading } = useAuth();
  const { can } = useAuthorization();

  // Column order and visibility are module configuration now, not a per-user toolbar toggle —
  // see Expenses › Settings › Table & Field Configuration.
  const { settings } = useExpensesSettings();

  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRequest[]>([]);
  const [requisitions, setRequisitions] = useState<DailyRequisitionEntry[]>([]);
  // "Could not read Daily Requisition" — progress is unknown, which must not read as "Not received".
  const [requisitionsUnavailable, setRequisitionsUnavailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [detailsExpense, setDetailsExpense] = useState<ExpenseRequest | null>(null);

  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const canViewPage = can('View All', 'Expenses.Expense Requests');

  const handleFilterChange = <K extends keyof typeof filters>(field: K, value: (typeof filters)[K]) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const activeFilterCount =
    (filters.requestNo ? 1 : 0) +
    (filters.partyName ? 1 : 0) +
    (filters.projectName !== 'all' ? 1 : 0) +
    (filters.departmentName !== 'all' ? 1 : 0) +
    (filters.stage !== 'all' ? 1 : 0);

  /** Each request's requisition, by Request No = Dep No — the link every module uses. */
  const requisitionByRequestNo = useMemo(() => requisitionsByRequestNo(requisitions), [requisitions]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(exp => {
      const project = projects.find(p => p.id === exp.projectId);
      return (
        (filters.requestNo === '' || (exp.requestNo || '').toLowerCase().includes(filters.requestNo.toLowerCase())) &&
        (filters.partyName === '' || (exp.partyName || '').toLowerCase().includes(filters.partyName.toLowerCase())) &&
        (filters.projectName === 'all' || project?.projectName === filters.projectName) &&
        (filters.departmentName === 'all' || exp.generatedByDepartment === filters.departmentName) &&
        (requisitionsUnavailable || matchesStageFilter(filters.stage, requisitionOf(requisitionByRequestNo, exp)))
      );
    });
  }, [expenses, filters, projects, requisitionByRequestNo, requisitionsUnavailable]);

  const totalAmount = useMemo(() =>
    filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    [filteredExpenses]
  );

  const uniqueDepts = useMemo(() =>
    new Set(filteredExpenses.map(e => e.departmentId)).size,
    [filteredExpenses]
  );

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canViewPage) { setIsLoading(false); return; }

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [projectsSnap, expensesSnap, deptsSnap, requisitionsSnap] = await Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'expenseRequests')),
          getDocs(collection(db, 'departments')),
          // Where each request has got to lives in Daily Requisition. Someone who cannot read it
          // still gets the register; only its progress goes blank.
          getDocs(collection(db, 'dailyRequisitions')).catch(error => {
            console.error('Could not read Daily Requisition:', error);
            return null;
          }),
        ]);
        setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
        const fetchedExpenses = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseRequest));
        fetchedExpenses.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setExpenses(fetchedExpenses);
        setRequisitions(
          requisitionsSnap
            ? requisitionsSnap.docs.map(doc => ({ ...(doc.data() as DailyRequisitionEntry), id: doc.id }))
            : [],
        );
        setRequisitionsUnavailable(!requisitionsSnap);
      } catch (error: any) {
        console.error('Error fetching data:', error);
        toast({ title: 'Error', description: 'Failed to fetch consolidated expenses.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchData();
  }, [toast, isAuthLoading, canViewPage]);

  const getProjectName = (projectId: string) =>
    projects.find(p => p.id === projectId)?.projectName || 'Unknown Project';

  const visibleHeaders = useMemo(() => {
    const { order, visibility } = applyColumnSettings(settings.registers.all);
    return withProgressColumns(order, visibility);
  }, [settings]);

  const getCellContent = (header: string, expense: ExpenseRequest, requisition: DailyRequisitionEntry | undefined) => {
    switch (header) {
      case 'Request No': return <RequestNoCell expense={expense} onOpen={setDetailsExpense} />;
      case 'Timestamp': return formatExpenseTimestamp(expense.createdAt);
      case 'Department': return expense.generatedByDepartment;
      case 'Project Name': return getProjectName(expense.projectId);
      case 'Amount': return <span className="tabular-nums">{formatInr(expense.amount)}</span>;
      case 'Head of A/c': return expense.headOfAccount;
      case 'Sub-Head of A/c': return expense.subHeadOfAccount;
      case 'Remarks': return <RemarksCell remarks={expense.remarks} />;
      case 'Description':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <span className="block truncate max-w-[200px]">{expense.description}</span>
              </TooltipTrigger>
              <TooltipContent><p className="max-w-md">{expense.description}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case 'Name of the party': return expense.partyName;
      case 'Reception No': return receptionOf(expense, requisition).receptionNo || '—';
      case 'Reception Date': return formatReceptionDate(receptionOf(expense, requisition).receptionDate);
      case 'Stage': return <StageCell requisition={requisition} unavailable={requisitionsUnavailable} />;
      case 'Paid / Balance': return <PaidBalanceCell requisition={requisition} unavailable={requisitionsUnavailable} />;
      default: return '';
    }
  };

  if (isLoading || isAuthLoading) {
    return (
      <div className="w-full space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Skeleton className="h-9 w-9" /><Skeleton className="h-8 w-56" /></div>
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="flex gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 flex-1 rounded-lg" />)}
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full">
        <PageHeader icon={Layers} title="Consolidated Expenses" backHref="/expenses" />
        <Card className="border-destructive/30">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this page.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader
        icon={Layers}
        title="Consolidated Expenses"
        description="All departments combined view"
        backHref="/expenses"
        actions={
          can('View', 'Expenses.Settings') ? (
            <Link href="/expenses/settings/field-control">
              <Button variant="outline" size="sm" className="gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Columns
              </Button>
            </Link>
          ) : undefined
        }
      />

      {/* Stats ribbon — whole rupees here; the rows carry the paise. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 text-blue-600 dark:text-blue-400">
          <FileText className="h-4 w-4 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-xs text-muted-foreground block leading-tight">Total Requests</span>
            <span className="font-bold leading-tight">{filteredExpenses.length}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400">
          <IndianRupee className="h-4 w-4 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-xs text-muted-foreground block leading-tight">Total Amount</span>
            <span className="font-bold leading-tight text-sm tabular-nums break-words">{formatInr(totalAmount, 0)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 text-purple-600 dark:text-purple-400">
          <Building2 className="h-4 w-4 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-xs text-muted-foreground block leading-tight">Departments</span>
            <span className="font-bold leading-tight">{uniqueDepts}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400">
          <TrendingUp className="h-4 w-4 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-xs text-muted-foreground block leading-tight">Avg per Request</span>
            <span className="font-bold leading-tight text-sm tabular-nums break-words">
              {filteredExpenses.length > 0 ? formatInr(totalAmount / filteredExpenses.length, 0) : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Data Table — TableCard owns the scroll container and the pinned header. */}
      <TableCard
        title="Expense requests"
        description={
          requisitionsUnavailable
            ? 'Stage and payments could not be loaded from Daily Requisition.'
            : undefined
        }
        count={filteredExpenses.length}
        total={expenses.length}
        noun="request"
        toolbar={
          <FilterBar
            search={{ value: filters.requestNo, onChange: value => handleFilterChange('requestNo', value), placeholder: 'Search Request No...' }}
            activeCount={activeFilterCount}
            onClear={() => setFilters(EMPTY_FILTERS)}
          >
            <SearchInput
              placeholder="Search Party Name..."
              value={filters.partyName}
              onChange={value => handleFilterChange('partyName', value)}
            />
            <Select value={filters.projectName} onValueChange={value => handleFilterChange('projectName', value)}>
              <SelectTrigger aria-label="Project"><SelectValue placeholder="All Projects" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.projectName}>{p.projectName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.departmentName} onValueChange={value => handleFilterChange('departmentName', value)}>
              <SelectTrigger aria-label="Department"><SelectValue placeholder="All Departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map(d => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <StageFilterSelect
              value={filters.stage}
              onChange={value => handleFilterChange('stage', value)}
              disabled={requisitionsUnavailable}
            />
          </FilterBar>
        }
      >
          <Table>
            <TableHeader>
              <TableRow>
                {visibleHeaders.map(header => (
                  <TableHead key={header} className="whitespace-nowrap">
                    {header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredExpenses.length > 0 ? (
                filteredExpenses.map(expense => {
                  const requisition = requisitionOf(requisitionByRequestNo, expense);
                  return (
                    // The whole row opens the details. Keyboard access is the Request No button
                    // inside it, so the row keeps its table semantics.
                    <TableRow
                      key={expense.id}
                      onClick={() => setDetailsExpense(expense)}
                      className="cursor-pointer"
                    >
                      {visibleHeaders.map(header => (
                        <TableCell key={header} className="whitespace-nowrap">
                          {getCellContent(header, expense, requisition)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={visibleHeaders.length}>
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Receipt className="h-10 w-10 mb-3 opacity-30" />
                      <p className="font-medium">No expense requests found</p>
                      <p className="text-sm mt-1">Try adjusting your filters</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
      </TableCard>

      <ExpenseDetailsDialog
        expense={detailsExpense}
        projectName={detailsExpense ? getProjectName(detailsExpense.projectId) : ''}
        requisition={detailsExpense ? requisitionOf(requisitionByRequestNo, detailsExpense) : undefined}
        requisitionsUnavailable={requisitionsUnavailable}
        open={!!detailsExpense}
        onOpenChange={open => { if (!open) setDetailsExpense(null); }}
      />
    </div>
  );
}
