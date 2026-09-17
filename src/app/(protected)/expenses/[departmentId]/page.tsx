


'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Plus, ShieldAlert, SlidersHorizontal,
  Search, Calendar as CalendarIcon, Edit, Save, Loader2,
  Receipt, IndianRupee, FileText, TrendingUp, Filter, Upload, X, Building2, BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, updateDoc } from 'firebase/firestore';
import type { Department, ExpenseRequest, Project, AccountHead, SubAccountHead } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, startOfToday, endOfToday } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { logUserActivity } from '@/lib/activity-logger';
import { ExpenseImportDialog } from '@/components/expenses/import-dialog';
import {
  ExpenseDetailsDialog,
  RemarksCell,
  RequestNoCell,
  formatExpenseTimestamp,
  formatReceptionDate,
} from '@/components/expenses/expense-details-dialog';
import { ExpensesPageHeader } from '@/components/expenses/page-header';
import { useExpensesSettings } from '@/components/expenses/use-expenses-settings';
import { applyColumnSettings, resolveDatePreset } from '@/lib/expenses-settings';


export default function DepartmentExpensesPage() {
  const { departmentId } = useParams() as { departmentId: string };
  const { toast } = useToast();
  const { user, loading: isAuthLoading } = useAuth();
  const { can } = useAuthorization();

  // Columns, form fields and data rules are module configuration now — see
  // Expenses › Settings › Table & Field Configuration.
  const { settings } = useExpensesSettings();

  const [department, setDepartment] = useState<Department | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRequest[]>([]);
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [subAccountHeads, setSubAccountHeads] = useState<SubAccountHead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [detailsExpense, setDetailsExpense] = useState<ExpenseRequest | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseRequest | null>(null);
  const [editFormData, setEditFormData] = useState<ExpenseRequest | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * The opening period is configured, not hard-coded.
   *
   * This page used to open on the current month regardless, so a department whose last request
   * was raised earlier showed an empty register reading "No expense requests found". The shipped
   * default is now All time, and an administrator who wants it narrower sets that once under
   * Settings › Table & Field Configuration rather than every user discovering the date picker.
   */
  const [filters, setFilters] = useState({
    requestNo: '',
    projectName: 'all',
    partyName: '',
    dateRange: undefined as DateRange | undefined,
  });
  const [hasTouchedDate, setHasTouchedDate] = useState(false);

  useEffect(() => {
    // Only until the user touches the picker — reapplying the configured period after that would
    // undo their choice every time the settings snapshot fires.
    if (hasTouchedDate) return;
    const preset = resolveDatePreset(settings.data.defaultDateRange);
    setFilters(previous => ({ ...previous, dateRange: preset ? { from: preset.from, to: preset.to } : undefined }));
  }, [settings.data.defaultDateRange, hasTouchedDate]);

  // 'View All' lives on Expenses.Expense Requests, not on the module node — asking the module for it
  // was a clause that could never be true, so anyone holding the consolidated-view grant was sent to
  // Access Denied by the very department cards the overview page had just listed for them.
  const canViewPage =
    can('View', 'Expenses.Departments', departmentId) || can('View All', 'Expenses.Expense Requests');
  const canCreate = can('Create', 'Expenses.Departments', departmentId);
  const canEdit = can('Edit', 'Expenses.Departments', departmentId);

  const handleFilterChange = (field: keyof Omit<typeof filters, 'dateRange'>, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleDateRangeChange = (dateRange: DateRange | undefined) => {
    setHasTouchedDate(true);
    setFilters(prev => ({ ...prev, dateRange }));
  };

  const filteredExpenses = useMemo(() => {
    const from = filters.dateRange?.from ? startOfDay(filters.dateRange.from) : null;
    // The calendar hands back midnight for the end of a range, so without widening it to the end of
    // that day a request raised at 09:20 on the last day of the range fell outside its own range.
    const to = filters.dateRange?.to ? endOfDay(filters.dateRange.to) : null;

    return expenses.filter(exp => {
      let isDateMatch = true;
      if (from && to) {
        const expDate = new Date(exp.createdAt);
        isDateMatch = !Number.isNaN(expDate.getTime()) && expDate >= from && expDate <= to;
      }
      return (
        isDateMatch &&
        (filters.requestNo === '' || exp.requestNo.toLowerCase().includes(filters.requestNo.toLowerCase())) &&
        (filters.partyName === '' || exp.partyName.toLowerCase().includes(filters.partyName.toLowerCase())) &&
        (filters.projectName === 'all' || exp.projectId === filters.projectName)
      );
    });
  }, [expenses, filters]);

  const hasActiveFilters =
    filters.requestNo !== '' ||
    filters.partyName !== '' ||
    filters.projectName !== 'all' ||
    Boolean(filters.dateRange?.from && filters.dateRange?.to);

  const clearFilters = () =>
    setFilters({ requestNo: '', projectName: 'all', partyName: '', dateRange: undefined });

  const totalAmount = useMemo(() =>
    filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0),
    [filteredExpenses]
  );

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const deptDocRef = doc(db, 'departments', departmentId);
      const projectsSnap = await getDocs(collection(db, 'projects'));
      const expensesQuery = query(collection(db, 'expenseRequests'), where('departmentId', '==', departmentId));
      const headsSnap = await getDocs(collection(db, 'accountHeads'));
      const subHeadsSnap = await getDocs(collection(db, 'subAccountHeads'));

      const [deptDocSnap, expensesSnap, headsData, subHeadsData] = await Promise.all([
        getDoc(deptDocRef),
        getDocs(expensesQuery),
        headsSnap,
        subHeadsSnap,
      ]);

      if (deptDocSnap.exists()) {
        setDepartment({ id: deptDocSnap.id, ...deptDocSnap.data() } as Department);
      } else {
        toast({ title: 'Error', description: 'Department not found.', variant: 'destructive' });
      }

      setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
      setAccountHeads(headsData.docs.map(d => ({ id: d.id, ...d.data() } as AccountHead)));
      setSubAccountHeads(subHeadsData.docs.map(d => ({ id: d.id, ...d.data() } as SubAccountHead)));

      const fetchedExpenses = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseRequest));
      fetchedExpenses.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setExpenses(fetchedExpenses);

    } catch (error: any) {
      console.error('Error fetching data:', error);
      if (error.code === 'failed-precondition') {
        toast({
          title: 'Database Index Required',
          description: 'This query requires a custom index. Please check your Firebase console.',
          variant: 'destructive',
          duration: 10000,
        });
      } else {
        toast({ title: 'Error', description: 'Failed to fetch department details.', variant: 'destructive' });
      }
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (!departmentId || isAuthLoading) return;
    if (!canViewPage) { setIsLoading(false); return; }
    fetchData();
  }, [departmentId, toast, isAuthLoading, canViewPage]);

  const getProjectName = (projectId: string) =>
    projects.find(p => p.id === projectId)?.projectName || 'Unknown Project';

  const { order, visibility } = useMemo(
    () => applyColumnSettings(settings.registers.department),
    [settings],
  );
  const visibleHeaders = order.filter(header => visibility[header]);

  const getCellContent = (header: string, expense: ExpenseRequest) => {
    switch (header) {
      case 'Request No': return <RequestNoCell expense={expense} onOpen={setDetailsExpense} />;
      case 'Timestamp': return formatExpenseTimestamp(expense.createdAt);
      case 'Department': return expense.generatedByDepartment;
      case 'Project Name': return getProjectName(expense.projectId);
      case 'Amount':
        return (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            ₹{(expense.amount || 0).toLocaleString('en-IN')}
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

  const openEditDialog = (expense: ExpenseRequest) => {
    setEditingExpense(expense);
    setEditFormData(expense);
    setIsEditDialogOpen(true);
  };

  const handleUpdateExpense = async () => {
    if (!editFormData || !user) return;
    setIsSaving(true);
    try {
      const expenseRef = doc(db, 'expenseRequests', editFormData.id);
      const { id, ...dataToUpdate } = editFormData;
      await updateDoc(expenseRef, dataToUpdate);
      await logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: 'Expenses',
        action: 'Update Expense Request',
        details: { requestNo: editFormData.requestNo, department: department?.name || 'N/A' },
      });
      toast({ title: 'Success', description: 'Expense request updated successfully.' });
      setIsEditDialogOpen(false);
      setEditingExpense(null);
      setEditFormData(null);
      fetchData();
    } catch (error) {
      console.error('Error updating expense:', error);
      toast({ title: 'Update Failed', description: 'An error occurred while updating the request.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubHeadChange = (subHeadName: string) => {
    if (!editFormData) return;
    const selectedSubHead = subAccountHeads.find(sh => sh.name === subHeadName);
    const parentHead = accountHeads.find(h => h.id === selectedSubHead?.headId);
    setEditFormData({
      ...editFormData,
      subHeadOfAccount: subHeadName,
      headOfAccount: parentHead ? parentHead.name : '',
    });
  };

  if (isLoading || isAuthLoading) {
    return (
      <div className="w-full space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Skeleton className="h-9 w-9" /><Skeleton className="h-8 w-72" /></div>
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="flex gap-3"><Skeleton className="h-16 flex-1 rounded-lg" /><Skeleton className="h-16 flex-1 rounded-lg" /><Skeleton className="h-16 flex-1 rounded-lg" /></div>
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
          <h1 className="text-2xl font-bold">Department Expenses</h1>
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
    <>
      <div className="w-full space-y-4">
        <ExpensesPageHeader
          icon={Building2}
          title={department ? department.name : 'Department Expenses'}
          description="Expense requests raised by this department"
          accent="blue"
          backHref="/expenses"
          actions={
            <>
            {/* Column order and visibility are configured for the whole module, not per user. */}
            {can('View', 'Expenses.Settings') && (
              <Link href="/expenses/settings/table-and-fields">
                <Button variant="outline" size="sm" className="gap-2">
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Columns
                </Button>
              </Link>
            )}

            {/* The report centre serves one department as readily as all of them, so this is the
                same page pre-scoped rather than a second set of department-only reports. */}
            {can('View', 'Expenses.Reports') && (
              <Link href={`/expenses/reports?departmentId=${departmentId}`}>
                <Button variant="outline" size="sm" className="gap-2">
                  <BarChart3 className="h-3.5 w-3.5" /> Reports
                </Button>
              </Link>
            )}

            {/* Importing creates expense requests, so the authority to create is the authority to
                bulk-create — gating it on a separate permission nobody has been granted yet would
                only ship a button that is disabled for everybody. */}
            {canCreate && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsImportDialogOpen(true)}>
                <Upload className="h-3.5 w-3.5" /> Import
              </Button>
            )}

            {canCreate && (
              <Link href={`/expenses/new-request?departmentId=${departmentId}`}>
                <Button size="sm" className="gap-2">
                  <Plus className="h-3.5 w-3.5" /> New Request
                </Button>
              </Link>
            )}
            </>
          }
        />

        {/* Stats ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
              <span className="font-bold leading-tight text-sm">
                ₹{totalAmount.toLocaleString('en-IN')}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 text-purple-600 dark:text-purple-400 col-span-2 sm:col-span-1">
            <TrendingUp className="h-4 w-4 flex-shrink-0" />
            <div>
              <span className="text-xs text-muted-foreground block leading-tight">Avg per Request</span>
              <span className="font-bold leading-tight text-sm">
                {filteredExpenses.length > 0
                  ? `₹${Math.round(totalAmount / filteredExpenses.length).toLocaleString('en-IN')}`
                  : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Filter Panel */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
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
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All Projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn('h-9 w-full justify-start text-left font-normal text-sm', !filters.dateRange && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {filters.dateRange?.from
                      ? filters.dateRange.to
                        ? <>{format(filters.dateRange.from, 'LLL dd, y')} – {format(filters.dateRange.to, 'LLL dd, y')}</>
                        : format(filters.dateRange.from, 'LLL dd, y')
                      : <span>Pick a date range</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start" onPointerDownOutside={e => e.preventDefault()}>
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={filters.dateRange?.from}
                    selected={filters.dateRange}
                    onSelect={handleDateRangeChange}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {[
                // "All time" first, and it is the default — whoever narrows the range needs a way
                // back that does not depend on working out how to unpick a date picker.
                { label: 'All time', fn: () => handleDateRangeChange(undefined), active: !filters.dateRange?.from },
                { label: 'Today', fn: () => handleDateRangeChange({ from: startOfToday(), to: endOfToday() }) },
                { label: 'This Week', fn: () => handleDateRangeChange({ from: startOfWeek(new Date()), to: endOfWeek(new Date()) }) },
                { label: 'This Month', fn: () => handleDateRangeChange({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }) },
                { label: 'Last Month', fn: () => handleDateRangeChange({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
              ].map(btn => (
                <Button
                  key={btn.label}
                  variant="ghost"
                  size="sm"
                  className={cn('h-7 text-xs px-2.5', btn.active && 'bg-primary/10 text-primary')}
                  onClick={btn.fn}
                >
                  {btn.label}
                </Button>
              ))}
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="h-7 text-xs px-2.5 text-muted-foreground" onClick={clearFilters}>
                  <X className="mr-1 h-3 w-3" /> Clear filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Data Table */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {visibleHeaders.map(header => (
                      <TableHead key={header} className="whitespace-nowrap px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {header}
                      </TableHead>
                    ))}
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {visibleHeaders.map(header => (
                          <TableCell key={header}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                        <TableCell><Skeleton className="h-7 w-16" /></TableCell>
                      </TableRow>
                    ))
                  ) : filteredExpenses.length > 0 ? (
                    filteredExpenses.map(expense => (
                      // The whole row opens the details. Keyboard access is the Request No button
                      // inside it, so the row keeps its table semantics.
                      <TableRow
                        key={expense.id}
                        onClick={() => setDetailsExpense(expense)}
                        className="cursor-pointer hover:bg-primary/5 transition-colors duration-150 group"
                      >
                        {visibleHeaders.map(header => (
                          <TableCell key={header} className="whitespace-nowrap text-sm px-4">
                            {getCellContent(header, expense)}
                          </TableCell>
                        ))}
                        {/* Edit is a different intent from "show me this record", so the click
                            stops here rather than also opening the details dialog behind it. */}
                        <TableCell className="text-right" onClick={event => event.stopPropagation()}>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                            onClick={() => openEditDialog(expense)}
                            // A received request is normally closed to edits; the data rules can
                            // reopen it for organisations that correct after the fact.
                            disabled={
                              !canEdit ||
                              (!!expense.receptionNo && !settings.data.allowEditAfterReception)
                            }
                          >
                            <Edit className="h-3 w-3" /> Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={visibleHeaders.length + 1}>
                        {/* "Nothing here" and "nothing here *because of a filter you set*" are very
                            different messages, and conflating them is how a full register reads as
                            an empty one. */}
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                          <Receipt className="h-10 w-10 mb-3 opacity-30" />
                          {expenses.length > 0 ? (
                            <>
                              <p className="font-medium text-foreground">
                                All {expenses.length} request{expenses.length === 1 ? ' is' : 's are'} hidden by the current filters
                              </p>
                              <p className="text-sm mt-1">This department has requests — none of them match what you have filtered on.</p>
                              <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={clearFilters}>
                                <X className="h-3.5 w-3.5" /> Clear filters
                              </Button>
                            </>
                          ) : (
                            <>
                              <p className="font-medium">No expense requests yet</p>
                              <p className="text-sm mt-1">Nothing has been raised for this department.</p>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <ExpenseDetailsDialog
        expense={detailsExpense}
        projectName={detailsExpense ? getProjectName(detailsExpense.projectId) : ''}
        open={!!detailsExpense}
        onOpenChange={open => { if (!open) setDetailsExpense(null); }}
      />

      {/* Import Dialog — mounted only while open so exceljs is not pulled in on a normal page view */}
      {isImportDialogOpen && (
        <ExpenseImportDialog
          open={isImportDialogOpen}
          onOpenChange={setIsImportDialogOpen}
          department={department}
          projects={projects}
          accountHeads={accountHeads}
          subAccountHeads={subAccountHeads}
          existingExpenses={expenses}
          onImported={fetchData}
          duplicateDetection={settings.data.importDuplicateDetection}
          defaultRequestNoSource={settings.data.importRequestNoSource}
        />
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-4 w-4 text-primary" />
              Edit Expense: <span className="text-primary">{editingExpense?.requestNo}</span>
            </DialogTitle>
            <DialogDescription>Update the details of this expense request.</DialogDescription>
          </DialogHeader>
          {editFormData && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 py-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Project Name</Label>
                <Select value={editFormData.projectId} onValueChange={value => setEditFormData({ ...editFormData, projectId: value })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Amount</Label>
                <Input
                  type="number"
                  className="h-9"
                  value={editFormData.amount}
                  onChange={e => setEditFormData({ ...editFormData, amount: e.target.valueAsNumber || 0 })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Name of the party</Label>
                <Input
                  className="h-9"
                  value={editFormData.partyName}
                  onChange={e => setEditFormData({ ...editFormData, partyName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Head of A/c</Label>
                <Select value={editFormData.headOfAccount} disabled>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Sub-Head of A/c</Label>
                <Select value={editFormData.subHeadOfAccount} onValueChange={handleSubHeadChange}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {subAccountHeads.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-1 md:col-span-2 lg:col-span-3">
                <Label className="text-xs font-semibold">Description</Label>
                <Textarea
                  rows={2}
                  value={editFormData.description}
                  onChange={e => setEditFormData({ ...editFormData, description: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 col-span-1 md:col-span-2 lg:col-span-3">
                <Label className="text-xs font-semibold">Remarks</Label>
                <Textarea
                  rows={2}
                  value={editFormData.remarks}
                  onChange={e => setEditFormData({ ...editFormData, remarks: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm">Cancel</Button></DialogClose>
            <Button size="sm" onClick={handleUpdateExpense} disabled={isSaving} className="gap-2 min-w-[120px]">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
