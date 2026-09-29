


'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, ShieldAlert, SlidersHorizontal,
  Calendar as CalendarIcon, Edit, Save, Loader2, Lock,
  Receipt, IndianRupee, FileText, TrendingUp, Upload, X, Building2, BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, runTransaction } from 'firebase/firestore';
import type { AccountHead, DailyRequisitionEntry, Department, ExpenseRequest, Project, SubAccountHead } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar, SearchInput } from '@/components/shared/filter-bar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { diffFields, logUserActivity } from '@/lib/activity-logger';
import { ExpenseImportDialog } from '@/components/expenses/import-dialog';
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
import { applyColumnSettings, resolveDatePreset } from '@/lib/expenses-settings';
import { formatInr } from '@/lib/bank-balance-ledger';
import { isPaymentLocked, requisitionsByRequestNo } from '@/lib/requisition-progress';
import { PageHeader } from '@/components/shared/page-header';

/* ── editing ─────────────────────────────────────────────────────────────── */

/**
 * What the edit dialog may change. Everything else on a request belongs to someone else — its
 * number, department and author to whoever raised it, the reception fields to Daily Requisition —
 * and writing it back from the copy taken when the dialog opened could undo their change: a request
 * received while the dialog was open would lose its Reception No and drop out of the link.
 */
type EditableField = 'projectId' | 'amount' | 'partyName' | 'headOfAccount' | 'subHeadOfAccount' | 'description' | 'remarks';
type EditableValues = Pick<ExpenseRequest, EditableField>;

const TEXT_FIELDS = ['projectId', 'partyName', 'headOfAccount', 'subHeadOfAccount', 'description', 'remarks'] as const;

/** Once money has gone out against the requisition, these belong to the payment record. */
const PAYMENT_LOCKED_FIELDS: readonly EditableField[] = ['amount', 'partyName', 'projectId'];

const FIELD_LABELS: Record<EditableField, string> = {
  projectId: 'project',
  amount: 'amount',
  partyName: 'party',
  headOfAccount: 'head of account',
  subHeadOfAccount: 'sub-head of account',
  description: 'description',
  remarks: 'remarks',
};

/** The dialog's inputs. Amount stays text while typing, so a cleared box reads as empty, not ₹0. */
type EditForm = Record<EditableField, string>;

const asText = (value: unknown) => (value === undefined || value === null ? '' : String(value));

const editFormFrom = (expense: ExpenseRequest): EditForm => ({
  projectId: asText(expense.projectId),
  amount: asText(expense.amount),
  partyName: asText(expense.partyName),
  headOfAccount: asText(expense.headOfAccount),
  subHeadOfAccount: asText(expense.subHeadOfAccount),
  description: asText(expense.description),
  remarks: asText(expense.remarks),
});

interface EditLock {
  /** Nothing may change: received, and the data rules keep received requests closed. */
  locked: boolean;
  /** Amount, party and project may not change: the requisition has been paid, in part or in full. */
  paymentLocked: boolean;
  /** Why, in the words the row's button and the dialog show. */
  reason: string;
  receptionNo: string;
}

function editLockOf(
  expense: ExpenseRequest,
  requisition: DailyRequisitionEntry | undefined,
  allowEditAfterReception: boolean,
): EditLock {
  const { receptionNo } = receptionOf(expense, requisition);
  const locked = !!receptionNo && !allowEditAfterReception;
  const paymentLocked = !!requisition && isPaymentLocked(requisition);
  const reason = locked
    ? `Locked — received in Daily Requisition as ${receptionNo}`
    : paymentLocked
      ? `Paid against ${requisition?.receptionNo || receptionNo || 'its requisition'} — the amount, party and project can no longer change`
      : '';
  return { locked, paymentLocked, reason, receptionNo };
}

/** A save the lock rules turned down: its message is shown as is, unlike an unexpected failure. */
const refusal = (message: string) => Object.assign(new Error(message), { name: 'EditRefused' });
const isRefusal = (error: unknown): error is Error => error instanceof Error && error.name === 'EditRefused';

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
  const [requisitions, setRequisitions] = useState<DailyRequisitionEntry[]>([]);
  // "Could not read Daily Requisition" — progress is unknown, which must not read as "Not received".
  const [requisitionsUnavailable, setRequisitionsUnavailable] = useState(false);
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [subAccountHeads, setSubAccountHeads] = useState<SubAccountHead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [detailsExpense, setDetailsExpense] = useState<ExpenseRequest | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseRequest | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
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
    stage: 'all' as StageFilter,
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

  const handleFilterChange = <K extends 'requestNo' | 'projectName' | 'partyName' | 'stage'>(
    field: K,
    value: (typeof filters)[K],
  ) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleDateRangeChange = (dateRange: DateRange | undefined) => {
    setHasTouchedDate(true);
    setFilters(prev => ({ ...prev, dateRange }));
  };

  /** Each request's requisition, by Request No = Dep No — the link every module uses. */
  const requisitionByRequestNo = useMemo(() => requisitionsByRequestNo(requisitions), [requisitions]);

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
        (filters.requestNo === '' || (exp.requestNo || '').toLowerCase().includes(filters.requestNo.toLowerCase())) &&
        (filters.partyName === '' || (exp.partyName || '').toLowerCase().includes(filters.partyName.toLowerCase())) &&
        (filters.projectName === 'all' || exp.projectId === filters.projectName) &&
        (requisitionsUnavailable || matchesStageFilter(filters.stage, requisitionOf(requisitionByRequestNo, exp)))
      );
    });
  }, [expenses, filters, requisitionByRequestNo, requisitionsUnavailable]);

  const activeFilterCount =
    (filters.requestNo !== '' ? 1 : 0) +
    (filters.partyName !== '' ? 1 : 0) +
    (filters.projectName !== 'all' ? 1 : 0) +
    (filters.stage !== 'all' ? 1 : 0) +
    (filters.dateRange?.from && filters.dateRange?.to ? 1 : 0);

  const clearFilters = () =>
    setFilters({ requestNo: '', projectName: 'all', partyName: '', stage: 'all', dateRange: undefined });

  const totalAmount = useMemo(() =>
    filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    [filteredExpenses]
  );

  /** `silent` refreshes in place (after a save or an import) instead of blanking the page. */
  const fetchData = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setIsLoading(true);
    try {
      const [deptDocSnap, projectsSnap, expensesSnap, headsSnap, subHeadsSnap, requisitionsSnap] = await Promise.all([
        getDoc(doc(db, 'departments', departmentId)),
        getDocs(collection(db, 'projects')),
        getDocs(query(collection(db, 'expenseRequests'), where('departmentId', '==', departmentId))),
        getDocs(collection(db, 'accountHeads')),
        getDocs(collection(db, 'subAccountHeads')),
        // Where each request has got to lives in Daily Requisition. Someone who cannot read it
        // still gets the register; only its progress goes blank.
        getDocs(collection(db, 'dailyRequisitions')).catch(error => {
          console.error('Could not read Daily Requisition:', error);
          return null;
        }),
      ]);

      if (deptDocSnap.exists()) {
        setDepartment({ id: deptDocSnap.id, ...deptDocSnap.data() } as Department);
      } else {
        toast({ title: 'Error', description: 'Department not found.', variant: 'destructive' });
      }

      setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
      setAccountHeads(headsSnap.docs.map(d => ({ id: d.id, ...d.data() } as AccountHead)));
      setSubAccountHeads(subHeadsSnap.docs.map(d => ({ id: d.id, ...d.data() } as SubAccountHead)));

      const fetchedExpenses = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseRequest));
      fetchedExpenses.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setExpenses(fetchedExpenses);

      setRequisitions(
        requisitionsSnap
          ? requisitionsSnap.docs.map(d => ({ ...(d.data() as DailyRequisitionEntry), id: d.id }))
          : [],
      );
      setRequisitionsUnavailable(!requisitionsSnap);
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
  }, [departmentId, toast]);

  useEffect(() => {
    if (!departmentId || isAuthLoading) return;
    if (!canViewPage) { setIsLoading(false); return; }
    fetchData();
  }, [departmentId, isAuthLoading, canViewPage, fetchData]);

  const getProjectName = (projectId: string) =>
    projects.find(p => p.id === projectId)?.projectName || 'Unknown Project';

  const visibleHeaders = useMemo(() => {
    const { order, visibility } = applyColumnSettings(settings.registers.department);
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

  const lockFor = (expense: ExpenseRequest) =>
    editLockOf(expense, requisitionOf(requisitionByRequestNo, expense), settings.data.allowEditAfterReception);

  const openEditDialog = (expense: ExpenseRequest) => {
    if (!canEdit) return;
    const lock = lockFor(expense);
    if (lock.locked) {
      toast({
        title: 'This request is locked',
        description: `${lock.reason}. An administrator can allow edits after reception in Expenses › Settings.`,
      });
      return;
    }
    setEditingExpense(expense);
    setEditForm(editFormFrom(expense));
    setIsEditDialogOpen(true);
  };

  /**
   * The requisition as it stands now rather than when the page loaded — it may have been received
   * or paid since. Falls back to the loaded copy when Daily Requisition cannot be read.
   */
  const currentRequisitionFor = async (expense: ExpenseRequest): Promise<DailyRequisitionEntry | undefined> => {
    const loaded = requisitionOf(requisitionByRequestNo, expense);
    const requestNo = (expense.requestNo || '').trim();
    if (!requestNo) return loaded;
    try {
      const snap = await getDocs(query(collection(db, 'dailyRequisitions'), where('depNo', '==', requestNo)));
      const fresh = requisitionsByRequestNo(snap.docs.map(d => ({ ...(d.data() as DailyRequisitionEntry), id: d.id })));
      return fresh.get(requestNo) ?? loaded;
    } catch (error) {
      console.error('Could not re-read Daily Requisition:', error);
      return loaded;
    }
  };

  const handleUpdateExpense = async () => {
    if (!editingExpense || !editForm || !user) return;
    if (!canEdit) {
      toast({ title: 'Not allowed', description: 'You cannot edit requests of this department.', variant: 'destructive' });
      return;
    }

    const before = editingExpense;
    const openedWith = editFormFrom(before);
    const shownLock = lockFor(before);

    // Checked whenever the amount is the user's to set. An untouched amount is compared as typed, so
    // rounding an old value does not count as changing it.
    const amountText = editForm.amount.trim();
    const amountTouched = amountText !== openedWith.amount.trim();
    const parsedAmount = Number(amountText);
    const amountValid = amountText !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0;
    if ((amountTouched || !shownLock.paymentLocked) && !amountValid) {
      toast({ title: 'Check the amount', description: 'Enter an amount above zero.', variant: 'destructive' });
      return;
    }

    // Only what the user changed — a field someone else edited meanwhile is not overwritten.
    const changes: Partial<EditableValues> = {};
    if (amountTouched) {
      const amount = Math.round(parsedAmount * 100) / 100;
      if (amount !== Number(before.amount)) changes.amount = amount;
    }
    for (const key of TEXT_FIELDS) {
      const next = editForm[key].trim();
      if (next !== openedWith[key].trim()) changes[key] = next;
    }
    const changed = Object.keys(changes) as EditableField[];
    if (!changed.length) {
      toast({ title: 'Nothing to save', description: 'No field was changed.' });
      setIsEditDialogOpen(false);
      return;
    }

    setIsSaving(true);
    try {
      const requisition = await currentRequisitionFor(before);
      const expenseRef = doc(db, 'expenseRequests', before.id);
      await runTransaction(db, async transaction => {
        const snap = await transaction.get(expenseRef);
        if (!snap.exists()) throw refusal('This request no longer exists.');
        // Judged on the request as it is now: it may have been received while the dialog was open.
        const live = { ...(snap.data() as ExpenseRequest), id: snap.id };
        const lock = editLockOf(live, requisition, settings.data.allowEditAfterReception);
        if (lock.locked) throw refusal(`${lock.reason}. Nothing was saved.`);
        const blocked = changed.filter(key => PAYMENT_LOCKED_FIELDS.includes(key));
        if (lock.paymentLocked && blocked.length) {
          throw refusal(
            `${lock.reason}. Undo the change to the ${blocked.map(key => FIELD_LABELS[key]).join(', ')} — the description and remarks can still be edited.`,
          );
        }
        transaction.update(expenseRef, changes);
      });
      await logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: 'Expenses',
        action: 'Update Expense Request',
        recordId: before.id,
        recordRef: before.requestNo || undefined,
        details: {
          requestNo: before.requestNo || '',
          department: department?.name || 'N/A',
          changes: diffFields(before, changes),
        },
      });
      toast({ title: 'Success', description: 'Expense request updated successfully.' });
      setIsEditDialogOpen(false);
      setEditingExpense(null);
      setEditForm(null);
      void fetchData({ silent: true });
    } catch (error) {
      if (isRefusal(error)) {
        toast({ title: 'Not saved', description: error.message, variant: 'destructive' });
        // Show the register as it is now, so the lock that refused the save is visible on the row.
        void fetchData({ silent: true });
      } else {
        console.error('Error updating expense:', error);
        toast({ title: 'Update Failed', description: 'An error occurred while updating the request.', variant: 'destructive' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubHeadChange = (subHeadName: string) => {
    if (!editForm) return;
    const selectedSubHead = subAccountHeads.find(sh => sh.name === subHeadName);
    const parentHead = accountHeads.find(h => h.id === selectedSubHead?.headId);
    setEditForm({
      ...editForm,
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
        <PageHeader icon={Building2} title="Department Expenses" backHref="/expenses" />
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

  const editLock = editingExpense ? lockFor(editingExpense) : null;
  const fieldsLocked = !!editLock?.paymentLocked;
  const amountInvalid = !!editForm && !fieldsLocked && !(Number(editForm.amount.trim()) > 0);

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          icon={Building2}
          title={department ? department.name : 'Department Expenses'}
          description="Expense requests raised by this department"
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

        {/* Stats ribbon — whole rupees here; the rows carry the paise. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              <span className="font-bold leading-tight text-sm tabular-nums break-words">
                {formatInr(totalAmount, 0)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 text-purple-600 dark:text-purple-400">
            <TrendingUp className="h-4 w-4 flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-xs text-muted-foreground block leading-tight">Avg per Request</span>
              <span className="font-bold leading-tight text-sm tabular-nums break-words">
                {filteredExpenses.length > 0
                  ? formatInr(totalAmount / filteredExpenses.length, 0)
                  : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Data Table */}
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
              onClear={clearFilters}
            >
              <SearchInput
                placeholder="Search Party Name..."
                value={filters.partyName}
                onChange={value => handleFilterChange('partyName', value)}
              />
              <Select value={filters.projectName} onValueChange={value => handleFilterChange('projectName', value)}>
                <SelectTrigger aria-label="Project">
                  <SelectValue placeholder="All Projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
              <StageFilterSelect
                value={filters.stage}
                onChange={value => handleFilterChange('stage', value)}
                disabled={requisitionsUnavailable}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn('w-full justify-start text-left font-normal', !filters.dateRange && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {filters.dateRange?.from
                      ? filters.dateRange.to
                        ? <>{format(filters.dateRange.from, 'dd MMM yyyy')} – {format(filters.dateRange.to, 'dd MMM yyyy')}</>
                        : format(filters.dateRange.from, 'dd MMM yyyy')
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
              <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Date range presets">
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
                  variant={btn.active ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={btn.fn}
                >
                  {btn.label}
                </Button>
              ))}
              </div>
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
                    {canEdit && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredExpenses.length > 0 ? (
                    filteredExpenses.map(expense => {
                      const requisition = requisitionOf(requisitionByRequestNo, expense);
                      const lock = editLockOf(expense, requisition, settings.data.allowEditAfterReception);
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
                          {canEdit && (
                            // Edit is a different intent from "show me this record", so the click
                            // stops here rather than also opening the details dialog behind it.
                            <TableCell className="text-right" onClick={event => event.stopPropagation()}>
                              {/* Always visible — a button that only appears on hover does not exist
                                  on a phone. A locked row keeps a live button (aria-disabled, not
                                  disabled) so a tap can say why it is locked. */}
                              <Button
                                variant="outline"
                                size="sm"
                                className={cn('h-7 gap-1 text-xs', lock.locked && 'text-muted-foreground')}
                                aria-disabled={lock.locked || undefined}
                                title={lock.reason || `Edit ${expense.requestNo || 'this request'}`}
                                onClick={() => openEditDialog(expense)}
                              >
                                {lock.locked ? <Lock className="h-3 w-3" /> : <Edit className="h-3 w-3" />}
                                {lock.locked ? 'Locked' : 'Edit'}
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={visibleHeaders.length + (canEdit ? 1 : 0)}>
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
        </TableCard>
      </div>

      <ExpenseDetailsDialog
        expense={detailsExpense}
        projectName={detailsExpense ? getProjectName(detailsExpense.projectId) : ''}
        requisition={detailsExpense ? requisitionOf(requisitionByRequestNo, detailsExpense) : undefined}
        requisitionsUnavailable={requisitionsUnavailable}
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
          onImported={() => { void fetchData({ silent: true }); }}
          duplicateDetection={settings.data.importDuplicateDetection}
          defaultRequestNoSource={settings.data.importRequestNoSource}
        />
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={open => { if (!isSaving) setIsEditDialogOpen(open); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Edit className="h-4 w-4 text-primary" />
              Edit Expense: <span className="text-primary">{editingExpense?.requestNo}</span>
            </DialogTitle>
            <DialogDescription>Update the details of this expense request.</DialogDescription>
          </DialogHeader>

          {editLock?.locked ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{editLock.reason}. Nothing here can be saved.</span>
            </div>
          ) : editLock?.paymentLocked ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{editLock.reason}. Reverse the payment in Bank Balance first to change them.</span>
            </div>
          ) : editLock?.receptionNo ? (
            <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Received in Daily Requisition as <span className="font-medium text-foreground">{editLock.receptionNo}</span>.
              Changes made here do not update the requisition — correct it in Daily Requisition as well.
            </div>
          ) : null}

          {editForm && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 py-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Project Name</Label>
                <Select
                  value={editForm.projectId}
                  onValueChange={value => setEditForm({ ...editForm, projectId: value })}
                  disabled={fieldsLocked}
                >
                  <SelectTrigger className="h-9" aria-label="Project Name"><SelectValue /></SelectTrigger>
                  <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-expense-amount" className="text-xs font-semibold">Amount</Label>
                <Input
                  id="edit-expense-amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  className="h-9"
                  value={editForm.amount}
                  disabled={fieldsLocked}
                  aria-invalid={amountInvalid || undefined}
                  onChange={e => setEditForm({ ...editForm, amount: e.target.value })}
                />
                {amountInvalid && <p className="text-xs text-destructive">Enter an amount above zero.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-expense-party" className="text-xs font-semibold">Name of the party</Label>
                <Input
                  id="edit-expense-party"
                  className="h-9"
                  value={editForm.partyName}
                  disabled={fieldsLocked}
                  onChange={e => setEditForm({ ...editForm, partyName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                {/* Derived from the sub-head. A Select with no items can never show its value, so
                    this is a read-only box. */}
                <Label htmlFor="edit-expense-head" className="text-xs font-semibold">Head of A/c</Label>
                <Input id="edit-expense-head" className="h-9" value={editForm.headOfAccount} readOnly disabled />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Sub-Head of A/c</Label>
                <Select value={editForm.subHeadOfAccount} onValueChange={handleSubHeadChange}>
                  <SelectTrigger className="h-9" aria-label="Sub-Head of A/c"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {subAccountHeads.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-1 md:col-span-2 lg:col-span-3">
                <Label htmlFor="edit-expense-description" className="text-xs font-semibold">Description</Label>
                <Textarea
                  id="edit-expense-description"
                  rows={2}
                  value={editForm.description}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 col-span-1 md:col-span-2 lg:col-span-3">
                <Label htmlFor="edit-expense-remarks" className="text-xs font-semibold">Remarks</Label>
                <Textarea
                  id="edit-expense-remarks"
                  rows={2}
                  value={editForm.remarks}
                  onChange={e => setEditForm({ ...editForm, remarks: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm" disabled={isSaving}>Cancel</Button></DialogClose>
            <Button
              size="sm"
              onClick={handleUpdateExpense}
              disabled={isSaving || !!editLock?.locked}
              className="gap-2 min-w-[120px]"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
