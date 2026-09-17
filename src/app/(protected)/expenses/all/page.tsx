


'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, ShieldAlert, SlidersHorizontal,
  Search, FileText, IndianRupee, Building2, TrendingUp, Filter,
  Receipt, Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { Department, ExpenseRequest, Project } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  ExpenseDetailsDialog,
  RemarksCell,
  RequestNoCell,
  formatExpenseTimestamp,
  formatReceptionDate,
} from '@/components/expenses/expense-details-dialog';
import { ExpensesPageHeader } from '@/components/expenses/page-header';
import { useExpensesSettings } from '@/components/expenses/use-expenses-settings';
import { applyColumnSettings } from '@/lib/expenses-settings';


const baseTableHeaders = [
  'Request No',
  'Timestamp',
  'Department',
  'Project Name',
  'Amount',
  'Head of A/c',
  'Sub-Head of A/c',
  'Remarks',
  'Description',
  'Name of the party',
  'Reception No',
  'Reception Date',
];

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
  const [isLoading, setIsLoading] = useState(true);
  const [detailsExpense, setDetailsExpense] = useState<ExpenseRequest | null>(null);

  const [filters, setFilters] = useState({
    requestNo: '',
    projectName: 'all',
    departmentName: 'all',
    partyName: '',
  });

  const canViewPage = can('View All', 'Expenses.Expense Requests');

  const handleFilterChange = (field: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const filteredExpenses = useMemo(() => {
    return expenses.filter(exp => {
      const project = projects.find(p => p.id === exp.projectId);
      return (
        (filters.requestNo === '' || exp.requestNo.toLowerCase().includes(filters.requestNo.toLowerCase())) &&
        (filters.partyName === '' || exp.partyName.toLowerCase().includes(filters.partyName.toLowerCase())) &&
        (filters.projectName === 'all' || project?.projectName === filters.projectName) &&
        (filters.departmentName === 'all' || exp.generatedByDepartment === filters.departmentName)
      );
    });
  }, [expenses, filters, projects]);

  const totalAmount = useMemo(() =>
    filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0),
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
        const [projectsSnap, expensesSnap, deptsSnap] = await Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'expenseRequests')),
          getDocs(collection(db, 'departments')),
        ]);
        setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
        const fetchedExpenses = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseRequest));
        fetchedExpenses.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setExpenses(fetchedExpenses);
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

  const { order, visibility } = useMemo(
    () => applyColumnSettings(settings.registers.all),
    [settings],
  );
  const visibleHeaders = order.filter(header => visibility[header]);

  const getCellContent = (header: string, expense: ExpenseRequest) => {
    const formatCurrency = (amount: number) =>
      new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(amount);

    switch (header) {
      case 'Request No': return <RequestNoCell expense={expense} onOpen={setDetailsExpense} />;
      case 'Timestamp': return formatExpenseTimestamp(expense.createdAt);
      case 'Department': return expense.generatedByDepartment;
      case 'Project Name': return getProjectName(expense.projectId);
      case 'Amount':
        return (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(expense.amount || 0)}
          </span>
        );
      case 'Head of A/c': return expense.headOfAccount;
      case 'Sub-Head of A/c': return expense.subHeadOfAccount;
      case 'Remarks': return <RemarksCell remarks={expense.remarks} />;
      case 'Description':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <p className="truncate max-w-[200px]">{expense.description}</p>
              </TooltipTrigger>
              <TooltipContent><p className="max-w-md">{expense.description}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case 'Name of the party': return expense.partyName;
      case 'Reception No': return expense.receptionNo || 'N/A';
      case 'Reception Date': return formatReceptionDate(expense.receptionDate);
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
        <div className="mb-6 flex items-center gap-2">
          <Link href="/expenses"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <h1 className="text-xl font-bold">Consolidated Expenses</h1>
        </div>
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
      <ExpensesPageHeader
        icon={Layers}
        title="Consolidated Expenses"
        description="All departments combined view"
        accent="violet"
        backHref="/expenses"
        actions={
          can('View', 'Expenses.Settings') ? (
            <Link href="/expenses/settings/table-and-fields">
              <Button variant="outline" size="sm" className="gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Columns
              </Button>
            </Link>
          ) : undefined
        }
      />

      {/* Stats ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 text-blue-600 dark:text-blue-400">
          <FileText className="h-4 w-4 flex-shrink-0" />
          <div>
            <span className="text-xs text-muted-foreground block leading-tight">Total Requests</span>
            <span className="font-bold leading-tight">{filteredExpenses.length}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400">
          <IndianRupee className="h-4 w-4 flex-shrink-0" />
          <div>
            <span className="text-xs text-muted-foreground block leading-tight">Total Amount</span>
            <span className="font-bold leading-tight text-sm">₹{totalAmount.toLocaleString('en-IN')}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 text-purple-600 dark:text-purple-400">
          <Building2 className="h-4 w-4 flex-shrink-0" />
          <div>
            <span className="text-xs text-muted-foreground block leading-tight">Departments</span>
            <span className="font-bold leading-tight">{uniqueDepts}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400">
          <TrendingUp className="h-4 w-4 flex-shrink-0" />
          <div>
            <span className="text-xs text-muted-foreground block leading-tight">Avg per Request</span>
            <span className="font-bold leading-tight text-sm">
              {filteredExpenses.length > 0 ? `₹${Math.round(totalAmount / filteredExpenses.length).toLocaleString('en-IN')}` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Filter Panel */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filters</span>
          </div>
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search Request No..."
                className="pl-8 h-9 text-sm"
                value={filters.requestNo}
                onChange={e => handleFilterChange('requestNo', e.target.value)}
              />
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search Party Name..."
                className="pl-8 h-9 text-sm"
                value={filters.partyName}
                onChange={e => handleFilterChange('partyName', e.target.value)}
              />
            </div>
            <Select value={filters.projectName} onValueChange={value => handleFilterChange('projectName', value)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Projects" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.projectName}>{p.projectName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.departmentName} onValueChange={value => handleFilterChange('departmentName', value)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map(d => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Data Table.
          One native scroll container — the Table's own wrapper — rather than a Radix ScrollArea.
          The ScrollArea here never scrolled: its viewport wraps children in a display:table box
          that sizes to content, so the 12 nowrap columns stretched it (and every ancestor) to
          2000px instead of clipping, and the horizontal <ScrollBar> was passed as a *child*, which
          this wrapper renders inside the viewport as content — so it was never a scrollbar at all.
          Native overflow also means a visible scrollbar to drag and a thead that sticks to the
          right box. max-h, not h, so a short register does not leave dead space under the card. */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden">
        <CardContent className="p-0">
          <Table containerClassName="max-h-[calc(100vh-24rem)] overflow-auto">
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {visibleHeaders.map(header => (
                  <TableHead key={header} className="whitespace-nowrap px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {visibleHeaders.map(header => (
                      <TableCell key={header}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredExpenses.length > 0 ? (
                filteredExpenses.map(expense => (
                  // The whole row opens the details. Keyboard access is the Request No button
                  // inside it, so the row keeps its table semantics.
                  <TableRow
                    key={expense.id}
                    onClick={() => setDetailsExpense(expense)}
                    className="cursor-pointer hover:bg-primary/5 transition-colors duration-150"
                  >
                    {visibleHeaders.map(header => (
                      <TableCell key={header} className="whitespace-nowrap text-sm px-4">
                        {getCellContent(header, expense)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
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
        </CardContent>
      </Card>

      <ExpenseDetailsDialog
        expense={detailsExpense}
        projectName={detailsExpense ? getProjectName(detailsExpense.projectId) : ''}
        open={!!detailsExpense}
        onOpenChange={open => { if (!open) setDetailsExpense(null); }}
      />
    </div>
  );
}
