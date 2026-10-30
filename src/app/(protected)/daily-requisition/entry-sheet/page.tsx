
'use client';
export const dynamic = 'force-dynamic';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DailyRequisitionImportDialog } from '@/components/daily-requisition/import-dialog';
import { allocateReceptionNos, requisitionFingerprint } from '@/lib/daily-requisition-import';
import {
  Plus,
  MoreHorizontal,
  Calendar as CalendarIcon,
  Loader2,
  Eye,
  FileText,
  Edit,
  Trash2,
  ShieldAlert,
  Printer,
  Upload,
  File as FileIcon,
  Hash,
  Paperclip,
  X,
  Lock,
  FilePlus,
  Inbox,
  SlidersHorizontal,
  Columns,
  CheckCheck,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
// Bill Tracking's register parts, so this register reads exactly like the Bill Register.
import { BtTable, Pager, type BtColumn } from '@/components/bill-tracking/bt-table';
import { BtToolbar, DrawerInput, DrawerSelect, ToolbarSearch, ToolbarSelect } from '@/components/bill-tracking/bt-toolbar';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import type {
  DailyRequisitionEntry,
  Project,
  Department,
  SerialNumberConfig,
  ExpenseRequest,
  Attachment,
} from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle as DialogTitleShad,
  DialogDescription as DialogDescriptionShad,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  runTransaction,
  Timestamp,
  query,
  where,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { format, parseISO, isSameDay } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import ViewDailyRequisitionDialog from '@/components/daily-requisition/ViewDailyRequisitionDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  DailyStatStrip,
  dailyPageContainerClass,
  dailySurfaceCardClass,
} from '@/components/daily-requisition/module-shell';
import { formatINRCompact, sumBy } from '@/lib/bill-tracking/money';
import { diffFields } from '@/lib/activity-logger';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { StatusBadge } from '@/components/shared/status-badge';
import {
  balanceOf,
  isPaymentLocked,
  paidOf,
  REQUISITION_STAGES,
  requisitionProgress,
  voucherHref,
} from '@/lib/requisition-progress';
import { checklistPrintHref } from '@/lib/checklist-print-batch';
import { ReceiveMultiplePanel, carriedStatutory } from '@/components/daily-requisition/receive-multiple';
import { FORM_LABEL } from '@/components/expenses/statutory-section';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { PageHeader } from '@/components/shared/page-header';
import { useDailyRequisitionSettings } from '@/components/daily-requisition/use-daily-requisition-settings';
import {
  DR_DATE_PRESETS,
  DR_FIELD_KEYS,
  applyColumnSettings,
  dateKey,
  describeDateWindow,
  fieldLabel,
  isHighValue,
  receivedRuleBlock,
  resolveDatePreset,
  resolveDateWindow,
  resolveField,
  todayLocal,
  validateEntryValues,
  type DRDatePreset,
  type DRFieldKey,
  type ResolvedDRField,
} from '@/lib/daily-requisition-settings';

const toDate = (v: any): Date | undefined =>
  v?.toDate?.() instanceof Date
    ? v.toDate()
    : v instanceof Date
    ? v
    : typeof v === 'string' || typeof v === 'number'
    ? new Date(v)
    : undefined;

const fmt = (d?: Date, f = 'dd MMM yyyy') => (d && !Number.isNaN(d.getTime()) ? format(d, f) : '');

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const formatCurrency = (amount: unknown) => inr.format(Number(amount) || 0);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A register cell's text on one line: cut short with "…", the whole of it on hover. */
function CellText({ text, className }: { text?: string | null; className?: string }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      {/* A span, not the default button, so a click here opens the row too. */}
      <TooltipTrigger asChild>
        <span className={cn('block truncate whitespace-nowrap', className)}>{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm break-words text-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

/** An amount in a register cell, to the paisa on one line — or a dash, where nothing is better shown as nothing. */
function Money({ value, dashWhenZero = false }: { value: number; dashWhenZero?: boolean }) {
  if (dashWhenZero && !value) return <span className="text-muted-foreground">—</span>;
  return <span className="whitespace-nowrap tabular-nums">{formatCurrency(value)}</span>;
}

/** The register's empty state, as Bill Tracking draws its own. */
function RegisterEmpty({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <Inbox className="h-9 w-9 text-muted-foreground/60" />
      <p className="font-medium text-slate-700">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * A high-value row's tint, solid in both themes: the register's pinned first cell inherits its
 * row's fill and has to cover the columns scrolling under it, and dark-compat.css would turn a
 * pastel `bg-amber-50` see-through. So the amber is mixed into the card colour instead.
 */
const HIGH_VALUE_ROW =
  'bg-[color-mix(in_srgb,theme(colors.amber.500)_10%,hsl(var(--card)))] hover:bg-[color-mix(in_srgb,theme(colors.amber.500)_18%,hsl(var(--card)))]';

/** The status filter's choices: the stages `requisitionProgress` reads entries as. */
const STATUS_OPTIONS = REQUISITION_STAGES.map(({ stage, label }) => ({ value: stage, label }));

const HIDDEN_COLUMNS_KEY = 'daily-requisition:entry-sheet:hidden-columns';

/**
 * The columns this browser has hidden, remembered across visits — none on the server or in private
 * mode. Read once, at first render: the page shows its skeleton then, so nothing here can mismatch.
 */
function readHiddenColumns(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = window.localStorage.getItem(HIDDEN_COLUMNS_KEY);
    return new Set(stored ? (JSON.parse(stored) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Why a requisition with money paid against it cannot be deleted, or have its figures changed. */
function paymentLockReason(entry: Pick<DailyRequisitionEntry, 'payments'>): string {
  const vouchers = Array.from(new Set((entry.payments ?? []).map((p) => p.voucherNo).filter(Boolean)));
  return vouchers.length
    ? `Paid through Bank Balance (${vouchers.join(', ')}). Reverse the voucher in the Cheque Register before changing or deleting it.`
    : 'Recorded as paid, so its figures belong to the payment record and it cannot be deleted.';
}

const lockedError = (message: string) => Object.assign(new Error(message), { locked: true });
const isLockedError = (error: unknown) => Boolean((error as { locked?: boolean } | null)?.locked);
/** A Data Control rule refused the change (e.g. no edits once received). */
const ruleError = (message: string) => Object.assign(new Error(message), { rule: true });
const isRuleError = (error: unknown) => Boolean((error as { rule?: boolean } | null)?.rule);

/** The fields the edit form owns, in comparable form: the date as a day, amounts to the paisa. */
const editableFields = (source: {
  date?: unknown;
  projectId?: string;
  departmentId?: string;
  partyName?: string;
  description?: string;
  grossAmount?: unknown;
  netAmount?: unknown;
}) => ({
  date: fmt(toDate(source.date), 'yyyy-MM-dd'),
  projectId: source.projectId ?? '',
  departmentId: source.departmentId ?? '',
  partyName: source.partyName ?? '',
  description: source.description ?? '',
  grossAmount: round2(Number(source.grossAmount) || 0),
  netAmount: round2(Number(source.netAmount) || 0),
});
type EditableFields = ReturnType<typeof editableFields>;

/** Everything but the description is fixed once a payment is recorded. */
const LOCKED_FIELD_LABELS: Record<string, string> = {
  date: 'date',
  projectId: 'project',
  departmentId: 'department',
  partyName: 'party',
  grossAmount: 'gross amount',
  netAmount: 'net amount',
};

/**
 * The expense request(s) a requisition received: its DEP No *and* its reception number. Matching on
 * the request number alone could release a request since received under another entry.
 */
async function linkedExpenseRefs(entry: Pick<DailyRequisitionEntry, 'depNo' | 'receptionNo'>) {
  const receptionNo = String(entry.receptionNo ?? '').trim();
  if (!String(entry.depNo ?? '').trim() || !receptionNo) return [];
  const snap = await getDocs(query(collection(db, 'expenseRequests'), where('requestNo', '==', entry.depNo)));
  return snap.docs
    .filter((d) => String(d.data().receptionNo ?? '').trim() === receptionNo)
    .map((d) => d.ref);
}

function EntrySheetSkeleton() {
  return (
    <div className={dailyPageContainerClass}>
      <Skeleton className="mb-4 h-40 rounded-xl" />
      <Skeleton className="mb-4 h-9 w-full max-w-3xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

type EnrichedDailyRequisitionEntry = DailyRequisitionEntry & {
  id: string;
  originalDate: string;
  createdAtText: string;
  dateText: string;
  receivedAtText?: string;
  verifiedAtText?: string;
  paidAtText?: string;
  documentStatusUpdatedAtText?: string;
};

const formSchema = z.object({
  receptionNo: z.string(),
  depNo: z.string(),
  date: z.date(),
  description: z.string(),
  partyName: z.string(),
  projectId: z.string(),
  departmentId: z.string(),
  grossAmount: z.string(),
  netAmount: z.string(),
});

type SortKey = keyof DailyRequisitionEntry | 'paid' | 'balance' | '';

function EntrySheetPageComponent() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);

  // Other modules link here as `?q=<receptionNo>`: the sheet opens filtered to that requisition, and
  // a later link to another one (this page staying mounted) replaces the filter.
  const searchParams = useSearchParams();
  const queryParam = searchParams.get('q');

  const [entries, setEntries] = React.useState<EnrichedDailyRequisitionEntry[]>([]);
  const [sortKey, setSortKey] = React.useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('desc');
  const [filterText, setFilterText] = React.useState(() => queryParam ?? '');
  const [dateFilter, setDateFilter] = React.useState<Date>();
  // Ids (a project, a department) or a `requisitionProgress` stage; '' is "all".
  const [projectFilter, setProjectFilter] = React.useState('');
  const [departmentFilter, setDepartmentFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  /** On a phone the filter controls fold behind a "Filters" button. */
  const [isMoreFiltersOpen, setIsMoreFiltersOpen] = React.useState(false);
  /** Field Control decides which columns exist; this browser may hide some of the unlocked ones. */
  const [hiddenColumns, setHiddenColumns] = React.useState<Set<string>>(readHiddenColumns);

  // Field Control and Data Control, live. At their defaults nothing below behaves differently.
  const { settings: moduleSettings, isLoading: isSettingsLoading } = useDailyRequisitionSettings();
  const dataControl = moduleSettings.data;
  const [todayKey] = React.useState(todayLocal);
  const dateWindow = React.useMemo(() => resolveDateWindow(todayKey, moduleSettings), [todayKey, moduleSettings]);
  const dateWindowHint = describeDateWindow(dateWindow);
  const fields = React.useMemo(
    () => Object.fromEntries(DR_FIELD_KEYS.map((key) => [key, resolveField(moduleSettings, key)])) as Record<DRFieldKey, ResolvedDRField>,
    [moduleSettings],
  );
  const columns = React.useMemo(() => applyColumnSettings(moduleSettings.columns), [moduleSettings.columns]);

  // The register opens on Data Control's default period — once, so it never overrides the user's
  // own choice. A `?q=` link to one entry always opens on all dates, or it could hide that entry.
  const [rangePreset, setRangePreset] = React.useState<DRDatePreset>('all');
  const appliedDefaultRange = React.useRef(false);
  React.useEffect(() => {
    if (isSettingsLoading || appliedDefaultRange.current) return;
    appliedDefaultRange.current = true;
    if (!queryParam) setRangePreset(dataControl.defaultDateRange);
  }, [isSettingsLoading, dataControl.defaultDateRange, queryParam]);

  React.useEffect(() => {
    if (queryParam !== null) {
      setFilterText(queryParam);
      setRangePreset('all');
    }
  }, [queryParam]);

  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false);
  /** Add New Entry: one request with its own details and files, or several requests received together. */
  const [addMode, setAddMode] = React.useState<'single' | 'multiple'>('single');
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
  const [editingEntry, setEditingEntry] = React.useState<EnrichedDailyRequisitionEntry | null>(null);

  const [isImportOpen, setIsImportOpen] = React.useState(false);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [expenseRequests, setExpenseRequests] = React.useState<ExpenseRequest[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [selectedFiles, setSelectedFiles] = React.useState<File[]>([]);

  const [currentPage, setCurrentPage] = React.useState(1);
  const [itemsPerPage, setItemsPerPage] = React.useState(25);

  const [selectedEntry, setSelectedEntry] = React.useState<DailyRequisitionEntry | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = React.useState(false);
  
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = React.useState(false);

  const canViewPage = can('View', 'Daily Requisition.Entry Sheet');
  const canAdd = can('Add', 'Daily Requisition.Entry Sheet');
  const canEdit = can('Edit', 'Daily Requisition.Entry Sheet');
  const canDelete = can('Delete', 'Daily Requisition.Entry Sheet');
  const canViewChecklist = can('View Checklist', 'Daily Requisition.Entry Sheet');
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      receptionNo: '',
      depNo: '',
      date: new Date(),
      description: '',
      partyName: '',
      projectId: '',
      departmentId: '',
      grossAmount: '',
      netAmount: '',
    },
  });
  
  const editForm = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      receptionNo: '',
      depNo: '',
      date: new Date(),
      description: '',
      partyName: '',
      projectId: '',
      departmentId: '',
      grossAmount: '',
      netAmount: '',
    },
  });

  /** Attachments are not a form field, so their Field Control error is held here. */
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);

  /** The reception-date picker offers only the Data Control window's days. */
  const calendarDisabled = React.useMemo(() => {
    if (!dateWindow.enforced || !dateWindow.min || !dateWindow.max) return undefined;
    const local = (key: string) => {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y, m - 1, d);
    };
    return [{ before: local(dateWindow.min) }, { after: local(dateWindow.max) }];
  }, [dateWindow]);

  /**
   * Field Control's required fields and Data Control's entry rules, checked before a save. Zod keeps
   * the shapes; this decides what is mandatory, so a hidden field is never demanded.
   * Returns true when the submission may go ahead.
   */
  const passesEntryRules = (
    target: typeof form,
    data: z.infer<typeof formSchema>,
    options: Omit<Parameters<typeof validateEntryValues>[2], 'window'>,
  ): boolean => {
    const errors = validateEntryValues(
      {
        depNo: data.depNo,
        receptionDate: data.date instanceof Date && !Number.isNaN(data.date.getTime()) ? dateKey(data.date) : '',
        partyName: data.partyName,
        projectId: data.projectId,
        departmentId: data.departmentId,
        description: data.description,
        grossAmount: data.grossAmount,
        netAmount: data.netAmount,
      },
      moduleSettings,
      { ...options, window: dateWindow },
    );
    setAttachmentError(errors.attachments ?? null);
    const formName: Partial<Record<DRFieldKey, keyof z.infer<typeof formSchema>>> = {
      depNo: 'depNo',
      receptionDate: 'date',
      partyName: 'partyName',
      projectId: 'projectId',
      departmentId: 'departmentId',
      description: 'description',
      grossAmount: 'grossAmount',
      netAmount: 'netAmount',
    };
    const keys = Object.keys(errors) as DRFieldKey[];
    for (const key of keys) {
      const name = formName[key];
      if (name) target.setError(name, { type: 'manual', message: errors[key] });
    }
    return keys.length === 0;
  };

  /**
   * What the importer needs to recognise a re-import.
   *
   * Reception numbers are the real key; the fingerprints matter only when an import allocates fresh
   * numbers, where there is no key to compare and the whole of what was typed has to stand in.
   */
  const importExisting = React.useMemo(
    () => ({
      receptionNos: entries.map((entry) => entry.receptionNo).filter(Boolean),
      fingerprints: entries.map((entry) =>
        requisitionFingerprint({
          projectId: entry.projectId,
          departmentId: entry.departmentId,
          grossAmount: Number(entry.grossAmount) || 0,
          partyName: entry.partyName ?? '',
          description: entry.description ?? '',
          date: (toDate(entry.date) ?? new Date()).toISOString(),
        }),
      ),
    }),
    [entries],
  );

  const fetchAllData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [projectsSnap, deptsSnap, configSnap, expensesSnap, requisitionsSnap] = await Promise.all([
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'departments')),
        getDoc(doc(db, 'serialNumberConfigs', 'daily-requisition')),
        getDocs(query(collection(db, 'expenseRequests'))),
        getDocs(query(collection(db, 'dailyRequisitions'), orderBy('createdAt', 'desc'))),
      ]);

      setProjects(projectsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Project)));
      setDepartments(deptsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Department)));
      setExpenseRequests(expensesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ExpenseRequest)));

      setEntries(
        requisitionsSnap.docs.map((docSnap) => {
          const data = docSnap.data() as DailyRequisitionEntry & {
            receivedAt?: any;
            verifiedAt?: any;
            paidAt?: any;
            documentStatusUpdatedAt?: any;
          };

          const dateD = toDate((data as any).date);
          const crAtD = toDate((data as any).createdAt);
          const recAtD = toDate((data as any).receivedAt);
          const verAtD = toDate((data as any).verifiedAt);
          const paidAtD = toDate((data as any).paidAt);
          const updAtD = toDate((data as any).documentStatusUpdatedAt);

          return {
            ...(data as DailyRequisitionEntry),
            id: docSnap.id,
            originalDate: dateD && !Number.isNaN(dateD.getTime()) ? dateD.toISOString() : '',
            createdAtText: fmt(crAtD, 'dd MMM yyyy HH:mm'),
            dateText: fmt(dateD, 'dd MMM yyyy'),
            receivedAtText: fmt(recAtD, 'dd MMM yyyy HH:mm') || undefined,
            verifiedAtText: fmt(verAtD, 'dd MMM yyyy HH:mm') || undefined,
            paidAtText: fmt(paidAtD, 'dd MMM yyyy HH:mm') || undefined,
            documentStatusUpdatedAtText: fmt(updAtD, 'dd MMM yyyy HH:mm') || undefined,
          } as EnrichedDailyRequisitionEntry;
        }),
      );

      if (configSnap.exists()) {
        // The shared formatter, so this preview cannot disagree with what the save allocates — and
        // so a config document missing a field shows `0001` rather than `undefinedundefinedNaN`.
        const { receptionNos } = allocateReceptionNos(configSnap.data() as SerialNumberConfig, 1);
        form.setValue('receptionNo', receptionNos[0]);
      } else {
        // No series configured: the save says so plainly, so show nothing rather than a made-up
        // number that could never be allocated.
        form.setValue('receptionNo', '');
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({ title: 'Error', description: 'Failed to load necessary data.', variant: 'destructive' });
    }
    setIsLoading(false);
  }, [toast, form]);

  React.useEffect(() => {
    if (!isAuthLoading) {
      if (canViewPage) {
        fetchAllData();
      } else {
        setIsLoading(false);
      }
    }
  }, [isAuthLoading, canViewPage, fetchAllData]);

  const unassignedExpenseRequests = React.useMemo(() => {
    return expenseRequests.filter((req) => !req.receptionNo);
  }, [expenseRequests]);
  
  const handleDepNoSelect = (value: string) => {
    const selectedRequest = unassignedExpenseRequests.find((req) => req.requestNo === value);
    if (selectedRequest) {
      form.reset({
        ...form.getValues(),
        depNo: selectedRequest.requestNo,
        description: selectedRequest.description || '',
        partyName: selectedRequest.partyName || '',
        projectId: selectedRequest.projectId || '',
        departmentId: selectedRequest.departmentId || '',
        // With GST & TDS captured on the request, gross is its taxable value and net what is payable.
        grossAmount: String(selectedRequest.statutory?.taxableAmount ?? selectedRequest.amount ?? ''),
        netAmount: String(selectedRequest.statutory?.netPayable ?? selectedRequest.amount ?? ''),
      });
    } else {
      form.setValue('depNo', value);
    }
  };


  /**
   * Add New Entry, opened empty. Without this the form keeps whatever was typed the last time the
   * dialog was closed or a save failed, so the next entry starts as a copy of the one before it —
   * same party, project and amounts — which is exactly the duplicate no one notices.
   * The allocated Reception No is kept: `fetchAllData` is what sets it.
   */
  const openAddDialog = () => {
    form.reset({
      receptionNo: form.getValues('receptionNo'),
      depNo: '',
      date: new Date(),
      description: '',
      partyName: '',
      projectId: '',
      departmentId: '',
      grossAmount: '',
      netAmount: '',
    });
    setSelectedFiles([]);
    setAttachmentError(null);
    setAddMode('single');
    setIsAddDialogOpen(true);
  };

  // The dashboard's "New requisition" links here as `?new=1`: once the data — and with it the next
  // Reception No — has loaded, Add New Entry opens as if its button had been pressed. Once only.
  const newParam = searchParams.get('new');
  const openedNewFromLink = React.useRef(false);
  React.useEffect(() => {
    if (newParam !== '1' || openedNewFromLink.current || isLoading || !canAdd) return;
    openedNewFromLink.current = true;
    openAddDialog();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `openAddDialog` is rebuilt every render; this runs once.
  }, [newParam, isLoading, canAdd]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachmentError(null);
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleAddEntry = async (data: z.infer<typeof formSchema>) => {
    if (!user) {
      toast({ title: 'Authentication Error', description: 'User not found.', variant: 'destructive' });
      return;
    }
    if (!passesEntryRules(form, data, { mode: 'add', attachmentCount: selectedFiles.length })) return;
    setIsSaving(true);
    const configRef = doc(db, 'serialNumberConfigs', 'daily-requisition');
    // Only a request not yet received can be picked — never another copy of the number already linked.
    const selectedExpenseRequest = unassignedExpenseRequests.find((req) => req.requestNo === data.depNo);

    try {
      if (selectedExpenseRequest) {
        // Re-read before a number is allocated: someone may have received it since the page loaded.
        const fresh = await getDoc(doc(db, 'expenseRequests', selectedExpenseRequest.id));
        const receivedAs = fresh.exists() ? String(fresh.data().receptionNo ?? '').trim() : '';
        if (receivedAs) {
          toast({
            title: 'Already received',
            description: `${selectedExpenseRequest.requestNo} was received as ${receivedAs} while this form was open.`,
            variant: 'destructive',
          });
          fetchAllData();
          return;
        }
      }

      let generatedReceptionNo = '';

      await runTransaction(db, async (transaction) => {
        const configDoc = await transaction.get(configRef);
        if (!configDoc.exists()) {
          throw new Error('Daily Requisition has no serial number configuration. Set one under Settings first.');
        }
        // The same allocator the import and the multi-receive use: one definition of the format, and
        // a missing or non-numeric startingIndex falls back to 1 instead of writing NaN to the
        // counter — which would hand every entry after it a Reception No reading "…NaN".
        const { receptionNos, nextIndex } = allocateReceptionNos(configDoc.data() as SerialNumberConfig, 1);
        generatedReceptionNo = receptionNos[0];
        transaction.update(configRef, { startingIndex: nextIndex });
      });

      const attachmentUrls: Attachment[] = [];
      for (const file of selectedFiles) {
        const storagePath = `daily-requisitions/${generatedReceptionNo}/${file.name}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);
        attachmentUrls.push({ name: file.name, url: downloadURL });
      }

      const newEntryData = {
        receptionNo: generatedReceptionNo,
        depNo: data.depNo,
        date: Timestamp.fromDate(data.date),
        projectId: data.projectId,
        departmentId: data.departmentId,
        description: data.description,
        partyName: data.partyName,
        grossAmount: parseFloat(data.grossAmount) || 0,
        netAmount: parseFloat(data.netAmount) || 0,
        createdAt: Timestamp.now(),
        status: 'Pending' as const,
        attachments: attachmentUrls,
        // GST & TDS captured on the expense request travel with it, so verification starts filled in.
        // Gross and net stay as entered on this form (verification flags any mismatch).
        ...(selectedExpenseRequest ? carriedStatutory(selectedExpenseRequest) : {}),
      };

      const newEntryRef = doc(collection(db, 'dailyRequisitions'));
      const batch = writeBatch(db);
      batch.set(newEntryRef, newEntryData);

      if (selectedExpenseRequest) {
        const expenseRef = doc(db, 'expenseRequests', selectedExpenseRequest.id);
        batch.update(expenseRef, {
          receptionNo: generatedReceptionNo,
          receptionDate: format(data.date, 'yyyy-MM-dd'),
        });
      }

      await batch.commit();

      await log(
        'Create Daily Requisition',
        {
          receptionNo: generatedReceptionNo,
          depNo: data.depNo || null,
          partyName: data.partyName ?? '',
          amount: parseFloat(data.netAmount) || 0,
          attachments: selectedFiles.map((file) => file.name),
        },
        { recordId: newEntryRef.id, recordRef: generatedReceptionNo },
      );

      toast({ title: 'Success', description: 'New entry added to the database.' });
      setIsAddDialogOpen(false);
      form.reset();
      setSelectedFiles([]);
      fetchAllData();
    } catch (error: any) {
      console.error('Error in transaction:', error);
      toast({
        title: 'Save Failed',
        description: error.message || 'An error occurred while saving the entry.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenEditDialog = (entry: EnrichedDailyRequisitionEntry) => {
    setEditingEntry(entry);
    const entryDate = parseISO(entry.originalDate || '');
    editForm.reset({
      receptionNo: entry.receptionNo,
      depNo: entry.depNo,
      date: entryDate,
      description: entry.description,
      partyName: entry.partyName,
      projectId: entry.projectId,
      departmentId: entry.departmentId,
      grossAmount: String(entry.grossAmount),
      netAmount: String(entry.netAmount),
    });
    setIsEditDialogOpen(true);
  };

  const lockedFieldsMessage = (keys: string[]) =>
    `The ${keys.map((key) => LOCKED_FIELD_LABELS[key] ?? key).join(', ')} of a paid requisition cannot be changed — only its description.`;

  const handleUpdateEntry = async (data: z.infer<typeof formSchema>) => {
    if (!editingEntry) return;
    const entry = editingEntry;
    const statusBlock = receivedRuleBlock(entry.status, dataControl, 'edit');
    if (statusBlock) {
      toast({ title: 'Editing not allowed', description: statusBlock, variant: 'destructive' });
      return;
    }
    const paymentLocked = isPaymentLocked(entry);
    const entryDateKey = entry.originalDate ? dateKey(new Date(entry.originalDate)) : '';
    if (
      !passesEntryRules(editForm, data, {
        mode: 'edit',
        originalReceptionDate: entryDateKey,
        // A paid entry's figures are read-only on the form, so they can never be made to comply.
        lockedKeys: paymentLocked ? ['receptionDate', 'partyName', 'projectId', 'departmentId', 'grossAmount', 'netAmount'] : [],
      })
    ) {
      return;
    }
    const next = editableFields({
      ...data,
      grossAmount: parseFloat(data.grossAmount),
      netAmount: parseFloat(data.netAmount),
    });
    // What this form changed, against the entry as it was opened — not whatever else has moved since.
    const changes = diffFields(editableFields(entry), next);
    const changed = Object.keys(changes);
    if (!changed.length) {
      toast({ title: 'No changes', description: 'Nothing was changed on this entry.' });
      setIsEditDialogOpen(false);
      setEditingEntry(null);
      return;
    }
    const lockedChanges = changed.filter((key) => key !== 'description');
    if (isPaymentLocked(entry) && lockedChanges.length) {
      toast({ title: 'Payment recorded', description: lockedFieldsMessage(lockedChanges), variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const entryRef = doc(db, 'dailyRequisitions', entry.id);
      // The linked expense request carries the reception date, so a date change follows it there.
      const expenseRefs = changed.includes('date') ? await linkedExpenseRefs(entry) : [];
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(entryRef);
        if (!snap.exists()) throw new Error('This entry no longer exists.');
        // Re-checked here: a voucher may have paid it while the dialog was open.
        if (isPaymentLocked(snap.data() as DailyRequisitionEntry) && lockedChanges.length) {
          throw lockedError(lockedFieldsMessage(lockedChanges));
        }
        // And the status rule: it may have been received while the dialog was open.
        const nowBlocked = receivedRuleBlock((snap.data() as DailyRequisitionEntry).status, dataControl, 'edit');
        if (nowBlocked) throw ruleError(nowBlocked);
        const expenseSnaps = await Promise.all(expenseRefs.map((ref) => transaction.get(ref)));

        const update: Record<string, unknown> = {};
        for (const key of changed) {
          update[key] = key === 'date' ? Timestamp.fromDate(data.date) : next[key as keyof EditableFields];
        }
        transaction.update(entryRef, update);
        for (const expenseSnap of expenseSnaps) {
          if (!expenseSnap.exists()) continue;
          if (String(expenseSnap.data().receptionNo ?? '').trim() !== String(entry.receptionNo ?? '').trim()) continue;
          transaction.update(expenseSnap.ref, { receptionDate: next.date });
        }
      });

      await log(
        'Update Daily Requisition',
        { receptionNo: entry.receptionNo ?? '', changes },
        { recordId: entry.id, recordRef: entry.receptionNo ?? '' },
      );
      toast({ title: 'Success', description: 'Entry updated successfully.' });
      setIsEditDialogOpen(false);
      setEditingEntry(null);
      fetchAllData();
    } catch (error) {
      console.error('Error updating entry:', error);
      toast({
        title: isLockedError(error) ? 'Payment recorded' : isRuleError(error) ? 'Editing not allowed' : 'Update Failed',
        description: isLockedError(error) || isRuleError(error)
          ? (error as Error).message
          : 'An error occurred while updating the entry.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEntry = async (entry: EnrichedDailyRequisitionEntry) => {
    if (!canDelete) return;
    if (isPaymentLocked(entry)) {
      toast({ title: 'Cannot delete a paid requisition', description: paymentLockReason(entry), variant: 'destructive' });
      return;
    }
    const statusBlock = receivedRuleBlock(entry.status, dataControl, 'delete');
    if (statusBlock) {
      toast({ title: 'Deleting not allowed', description: statusBlock, variant: 'destructive' });
      return;
    }
    try {
      const expenseRefs = await linkedExpenseRefs(entry);
      const entryRef = doc(db, 'dailyRequisitions', entry.id);
      const receptionNo = String(entry.receptionNo ?? '').trim();

      const released = await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(entryRef);
        if (!snap.exists()) throw new Error('This entry has already been deleted.');
        const current = snap.data() as DailyRequisitionEntry;
        // Re-checked here: a voucher may have paid it since the list was loaded.
        if (isPaymentLocked(current)) throw lockedError(paymentLockReason(current));
        const nowBlocked = receivedRuleBlock(current.status, dataControl, 'delete');
        if (nowBlocked) throw ruleError(nowBlocked);

        const expenseSnaps = await Promise.all(expenseRefs.map((ref) => transaction.get(ref)));
        let count = 0;
        for (const expenseSnap of expenseSnaps) {
          if (!expenseSnap.exists()) continue;
          if (String(expenseSnap.data().receptionNo ?? '').trim() !== receptionNo) continue;
          transaction.update(expenseSnap.ref, { receptionNo: '', receptionDate: '' });
          count += 1;
        }
        transaction.delete(entryRef);
        return count;
      });

      await log(
        'Delete Daily Requisition',
        {
          receptionNo: entry.receptionNo ?? '',
          depNo: entry.depNo || null,
          partyName: entry.partyName ?? '',
          netAmount: Number(entry.netAmount) || 0,
          status: entry.status ?? '',
          releasedExpenseRequests: released,
        },
        { recordId: entry.id, recordRef: entry.receptionNo ?? '' },
      );
      toast({
        title: 'Entry deleted',
        description: released
          ? `${entry.receptionNo} was deleted, and expense request ${entry.depNo} can be received again.`
          : `${entry.receptionNo} was deleted.`,
      });
      fetchAllData();
    } catch (error) {
      console.error('Error deleting entry:', error);
      toast({
        title: isLockedError(error)
          ? 'Cannot delete a paid requisition'
          : isRuleError(error)
            ? 'Deleting not allowed'
            : 'Delete Failed',
        description: isLockedError(error)
          ? (error as Error).message
          : error instanceof Error && error.message
            ? error.message
            : 'An error occurred while deleting the entry.',
        variant: 'destructive',
      });
    }
  };

  const projectNameById = React.useMemo(
    () => new Map(projects.map((p) => [p.id, p.projectName ?? ''])),
    [projects],
  );
  const departmentNameById = React.useMemo(
    () => new Map(departments.map((d) => [d.id, d.name ?? ''])),
    [departments],
  );

  const filteredEntries = React.useMemo(() => {
    const valueOf = (entry: EnrichedDailyRequisitionEntry, key: SortKey): unknown => {
      switch (key) {
        case '':
          return undefined;
        case 'paid':
          return paidOf(entry);
        case 'balance':
          return balanceOf(entry);
        case 'status':
          return requisitionProgress(entry).label;
        case 'projectId':
          return projectNameById.get(entry.projectId) || entry.projectId;
        case 'departmentId':
          return departmentNameById.get(entry.departmentId) || entry.departmentId;
        default:
          return entry[key];
      }
    };
    const sortedEntries = [...entries];
    if (sortKey) {
      sortedEntries.sort((a, b) => {
        const valA = valueOf(a, sortKey) as any;
        const valB = valueOf(b, sortKey) as any;

        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;

        if (sortKey === 'createdAt' || sortKey === 'date') {
          const dateA =
            typeof valA?.toMillis === 'function'
              ? valA.toMillis()
              : typeof valA === 'string'
              ? Date.parse(valA)
              : Number.NaN;
          const dateB =
            typeof valB?.toMillis === 'function'
              ? valB.toMillis()
              : typeof valB === 'string'
              ? Date.parse(valB)
              : Number.NaN;

          if (!isNaN(dateA) && !isNaN(dateB)) {
            return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
          }
        }

        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDirection === 'asc' ? valA - valB : valB - valA;
        }

        if (String(valA) < String(valB)) return sortDirection === 'asc' ? -1 : 1;
        if (String(valA) > String(valB)) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    const range = resolveDatePreset(rangePreset);
    const inView = (entry: EnrichedDailyRequisitionEntry) => {
      if (projectFilter && entry.projectId !== projectFilter) return false;
      if (departmentFilter && entry.departmentId !== departmentFilter) return false;
      if (statusFilter && requisitionProgress(entry).stage !== statusFilter) return false;
      if (dateFilter && !isSameDay(new Date(entry.originalDate), dateFilter)) return false;
      if (!range) return true;
      const when = entry.originalDate ? new Date(entry.originalDate) : undefined;
      return Boolean(when) && (when as Date) >= range.from && (when as Date) <= range.to;
    };
    const needle = filterText.trim().toLowerCase();
    if (!needle) return sortedEntries.filter(inView);

    // A whole reception or DEP number — what another module's `?q=` link carries — picks out exactly
    // that entry, not every number it is the start of (SEL/2026-27/1 is not also /10 to /19).
    const exact = sortedEntries.filter(
      (entry) =>
        String(entry.receptionNo ?? '').trim().toLowerCase() === needle ||
        String(entry.depNo ?? '').trim().toLowerCase() === needle,
    );
    const matches = exact.length
      ? exact
      : sortedEntries.filter((entry) =>
          [
            ...Object.values(entry).filter((value) => typeof value === 'string' || typeof value === 'number'),
            projectNameById.get(entry.projectId) ?? '',
            departmentNameById.get(entry.departmentId) ?? '',
            requisitionProgress(entry).label,
          ].some((value) => String(value).toLowerCase().includes(needle)),
        );
    return matches.filter(inView);
  }, [
    entries,
    sortKey,
    sortDirection,
    filterText,
    dateFilter,
    rangePreset,
    projectFilter,
    departmentFilter,
    statusFilter,
    projectNameById,
    departmentNameById,
  ]);

  // A narrower filter, or a longer page, must not leave the table on a page that no longer exists.
  React.useEffect(() => {
    setCurrentPage(1);
  }, [filterText, dateFilter, rangePreset, projectFilter, departmentFilter, statusFilter, itemsPerPage]);

  const paginatedEntries = React.useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredEntries.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredEntries, currentPage, itemsPerPage]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / itemsPerPage));

  /** The header strip's figures: every entry the filters match, not only this page of them. */
  const totals = React.useMemo(() => {
    const progress = filteredEntries.map((entry) => requisitionProgress(entry));
    return {
      gross: sumBy(filteredEntries, (entry) => Number(entry.grossAmount) || 0),
      net: sumBy(progress, (entry) => entry.net),
      paid: sumBy(progress, (entry) => entry.paid),
      balance: sumBy(progress, (entry) => entry.balance),
      paidInFull: progress.filter((entry) => entry.stage === 'paid').length,
      stillToPay: progress.filter((entry) => entry.balance > 0).length,
    };
  }, [filteredEntries]);
  const rangeLabel = DR_DATE_PRESETS.find((preset) => preset.value === rangePreset)?.label ?? 'All time';
  /** Anything narrowing the period's entries. */
  const narrowed = Boolean(filterText.trim() || dateFilter || projectFilter || departmentFilter || statusFilter);
  // The search counts, so the toolbar's Clear shows for a search alone too.
  const activeFilterCount =
    [filterText.trim(), projectFilter, departmentFilter, statusFilter].filter(Boolean).length +
    (dateFilter ? 1 : 0) +
    (rangePreset !== 'all' ? 1 : 0);
  const clearFilters = () => {
    setFilterText('');
    setDateFilter(undefined);
    setRangePreset('all');
    setProjectFilter('');
    setDepartmentFilter('');
    setStatusFilter('');
  };

  const saveHiddenColumns = (next: Set<string>) => {
    setHiddenColumns(next);
    try {
      window.localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify([...next]));
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  };
  const toggleColumn = (key: string) => {
    const next = new Set(hiddenColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    saveHiddenColumns(next);
  };

  const projectOptions = React.useMemo(
    () =>
      projects
        .map((project) => ({ value: project.id, label: project.projectName || project.id }))
        .sort((a, b) => a.label.localeCompare(b.label, 'en-IN')),
    [projects],
  );
  const departmentOptions = React.useMemo(
    () =>
      departments
        .map((department) => ({ value: department.id, label: department.name || department.id }))
        .sort((a, b) => a.label.localeCompare(b.label, 'en-IN')),
    [departments],
  );

  const handleViewDetails = (entry: DailyRequisitionEntry) => {
    setSelectedEntry(entry);
    setIsViewDialogOpen(true);
  };

  /** A click on a row opens its details — or, while picking checklists to print, ticks it. */
  const handleRowClick = (entry: EnrichedDailyRequisitionEntry) => {
    if (!isSelectionMode) {
      handleViewDetails(entry);
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  };

  const handleViewChecklist = (entry: DailyRequisitionEntry) => {
    window.open(`/daily-requisition/entry-sheet/${entry.id}/print`, '_blank');
  };

  const handlePrintSelected = () => {
    window.open(checklistPrintHref(Array.from(selectedIds)), '_blank');
  };

  /** Ticks every entry the filters show, on every page, keeping any already ticked. */
  const handleSelectAll = () => {
    setSelectedIds((current) => new Set([...current, ...filteredEntries.map((entry) => entry.id)]));
  };

  if (isAuthLoading || isLoading || isSettingsLoading) {
    return <EntrySheetSkeleton />;
  }

  // Once money is paid against an entry its figures belong to the payment record (the save handler
  // enforces the same); the form shows those fields read-only and says which voucher holds them.
  const editLocked = editingEntry ? isPaymentLocked(editingEntry) : false;
  const lockedFieldClass = 'cursor-not-allowed bg-muted text-muted-foreground';
  const editVouchers = Array.from(
    new Map(
      (editingEntry?.payments ?? [])
        .filter((payment) => payment.bankPaymentId)
        .map((payment) => [payment.bankPaymentId, payment.voucherNo || 'the voucher'] as const),
    ),
    ([id, no]) => ({ id, no }),
  );

  if (!canViewPage) {
    return (
      <div className={dailyPageContainerClass}>
        <PageHeader backHref="/daily-requisition" eyebrow="Daily Requisition"
          title="Entry Sheet"
          description="Create, review, print, and manage daily requisition entries from one place."
        />
        <Card className={dailySurfaceCardClass}>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this page.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }
  
  /** A row's ⋯ menu: view, checklist, edit and delete — each disabled, with its reason, where a rule forbids it. */
  const renderActions = (entry: EnrichedDailyRequisitionEntry) => {
    const locked = isPaymentLocked(entry);
    const editBlock = receivedRuleBlock(entry.status, dataControl, 'edit');
    // The payment lock's reason wins over the status rule's.
    const deleteBlock = locked ? paymentLockReason(entry) : receivedRuleBlock(entry.status, dataControl, 'delete');
    return (
      <AlertDialog>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={`Actions for ${entry.receptionNo}`}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                handleViewDetails(entry);
              }}
            >
              <Eye className="mr-2 h-4 w-4" /> View Details
            </DropdownMenuItem>
            {canViewChecklist && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleViewChecklist(entry);
                }}
              >
                <FileText className="mr-2 h-4 w-4" /> View Checklist
              </DropdownMenuItem>
            )}
            {canEdit &&
              (editBlock ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block cursor-not-allowed">
                      <DropdownMenuItem disabled>
                        <Lock className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs text-xs">
                    {editBlock}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenEditDialog(entry);
                  }}
                >
                  <Edit className="mr-2 h-4 w-4" /> {locked ? 'Edit description' : 'Edit'}
                </DropdownMenuItem>
              ))}
            {canDelete &&
              (deleteBlock ? (
                // A disabled item takes no pointer events, so the wrapper carries the reason.
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block cursor-not-allowed">
                      <DropdownMenuItem disabled className="text-destructive">
                        <Lock className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs text-xs">
                    {deleteBlock}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </DropdownMenuItem>
                </AlertDialogTrigger>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {entry.receptionNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the entry.
              {entry.depNo
                ? ` Its expense request ${entry.depNo} is released, so it can be received again.`
                : ''}{' '}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleDeleteEntry(entry)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  /** The filters behind "More filters", as removable chips under the filter row. */
  const moreChips = [
    ...(departmentFilter
      ? [{ key: 'department', label: 'Department', value: departmentNameById.get(departmentFilter) || departmentFilter, onRemove: () => setDepartmentFilter('') }]
      : []),
    ...(dateFilter ? [{ key: 'date', label: 'Date', value: format(dateFilter, 'dd MMM yyyy'), onRemove: () => setDateFilter(undefined) }] : []),
  ];

  // Field Control's layout — which columns, in what order, under what names — drawn the way Bill
  // Tracking's register draws its own. Every column is `pinned` so the register offers no Columns
  // menu of its own, which would bring back the bar over the table: the filter row has this page's.
  // A locked column always shows, even if this browser hid it before it was locked.
  const hideableColumns = columns.filter((column) => !column.locked);
  const hiddenList = hideableColumns.filter((column) => hiddenColumns.has(column.key));
  const tableColumns = columns
    .filter((column) => column.locked || !hiddenColumns.has(column.key))
    .map((column): BtColumn<EnrichedDailyRequisitionEntry> => {
      const base = {
        key: column.key,
        header: column.label,
        label: column.label,
        pinned: true,
        align: column.numeric ? ('right' as const) : undefined,
        sortKey: column.key === 'actions' ? undefined : column.key,
      };
      switch (column.key) {
        case 'createdAt':
          return { ...base, mobile: 'omit', cell: (entry) => <span className="whitespace-nowrap">{entry.createdAtText}</span> };
        case 'receptionNo':
          return {
            ...base,
            mobile: 'title',
            cell: (entry) => (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <button type="button" onClick={() => handleViewDetails(entry)} className="font-medium text-emerald-700 hover:underline">
                  {entry.receptionNo || '—'}
                </button>
                {isHighValue(entry, dataControl.highValueThreshold) ? (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                    title={`High value — ${formatCurrency(dataControl.highValueThreshold)} or more`}
                  />
                ) : null}
              </span>
            ),
          };
        case 'status':
          return {
            ...base,
            cell: (entry) => {
              const progress = requisitionProgress(entry);
              return (
                <StatusBadge tone={progress.tone} title={entry.manualPaid ? 'Recorded as paid outside Bank Balance' : entry.status}>
                  {progress.label}
                </StatusBadge>
              );
            },
          };
        case 'date':
          return { ...base, cell: (entry) => <span className="whitespace-nowrap">{entry.dateText}</span> };
        case 'projectId':
          return { ...base, cell: (entry) => <CellText text={projectNameById.get(entry.projectId) || entry.projectId} className="max-w-[180px]" /> };
        case 'departmentId':
          return { ...base, cell: (entry) => <CellText text={departmentNameById.get(entry.departmentId) || entry.departmentId} className="max-w-[140px]" /> };
        case 'partyName':
          return { ...base, cell: (entry) => <CellText text={entry.partyName} className="max-w-[200px] font-medium text-slate-800" /> };
        case 'description':
          return { ...base, cell: (entry) => <CellText text={entry.description} className="max-w-[260px] text-slate-600" /> };
        case 'grossAmount':
          return { ...base, mobile: 'aside', cell: (entry) => <Money value={Number(entry.grossAmount) || 0} />, total: <Money value={totals.gross} /> };
        case 'netAmount':
          return { ...base, cell: (entry) => <Money value={Number(entry.netAmount) || 0} />, total: <Money value={totals.net} /> };
        case 'paid':
          return { ...base, cell: (entry) => <Money value={paidOf(entry)} dashWhenZero />, total: <Money value={totals.paid} /> };
        case 'balance':
          return { ...base, cell: (entry) => <Money value={balanceOf(entry)} dashWhenZero />, total: <Money value={totals.balance} /> };
        case 'actions':
          return { ...base, header: '', cell: renderActions };
        default:
          return { ...base, cell: () => null };
      }
    });

  return (
    <>
      <div className={`${dailyPageContainerClass} space-y-4 no-print`}>
        {/* One card: what the page is, its actions, and the totals of what the filters show. */}
        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {/* A `space-y-*` parent: globals.css then drops the header's own bottom margin. */}
          <div className="space-y-0 px-4 py-3 sm:px-5 sm:py-4">
            <PageHeader
              backHref="/daily-requisition"
              eyebrow="Daily Requisition"
              icon={FilePlus}
              title="Entry Sheet"
              badge={isSelectionMode ? <StatusBadge tone="info" dot>Selecting to print</StatusBadge> : undefined}
              actions={
                isSelectionMode ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setIsSelectionMode(false)}>
                      Cancel Selection
                    </Button>
                    <Button size="sm" className="gap-1.5" onClick={handlePrintSelected} disabled={selectedIds.size === 0}>
                      <Printer className="h-4 w-4" />
                      Confirm & Print ({selectedIds.size})
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setIsSelectionMode(true)} disabled={!canViewChecklist}>
                      <Printer className="h-4 w-4" /> Print Checklists
                    </Button>
                    {/* Gated on Add, the same grant as keying one by hand — importing a register is
                        creating entries, and there is no separate power to invent for it. */}
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setIsImportOpen(true)} disabled={!canAdd}>
                      <Upload className="h-4 w-4" /> Import
                    </Button>
                    <Button size="sm" className="gap-1.5" onClick={() => { openAddDialog(); }} disabled={!canAdd}>
                      <Plus className="h-4 w-4" /> Add Entry
                    </Button>
                  </>
                )
              }
            />
          </div>
          <DailyStatStrip
            flush
            items={[
              {
                label: 'Entries',
                value: filteredEntries.length.toLocaleString('en-IN'),
                hint: narrowed ? `${rangeLabel} · filtered` : rangeLabel,
              },
              {
                label: 'Gross amount',
                value: <span title={formatCurrency(totals.gross)}>{formatINRCompact(totals.gross)}</span>,
                hint: <span title={formatCurrency(totals.net)}>Net {formatINRCompact(totals.net)}</span>,
              },
              {
                label: 'Paid',
                value: <span title={formatCurrency(totals.paid)}>{formatINRCompact(totals.paid)}</span>,
                hint: `${totals.paidInFull.toLocaleString('en-IN')} paid in full`,
                tone: totals.paid > 0 ? 'text-emerald-700' : undefined,
              },
              {
                label: 'Balance due',
                value: <span title={formatCurrency(totals.balance)}>{formatINRCompact(totals.balance)}</span>,
                hint: `${totals.stillToPay.toLocaleString('en-IN')} still to pay`,
                tone: totals.balance > 0 ? 'text-amber-700' : undefined,
              },
              {
                label: 'DEP to receive',
                value: unassignedExpenseRequests.length.toLocaleString('en-IN'),
                hint: 'Expense requests not yet received',
                tone: unassignedExpenseRequests.length > 0 ? 'text-sky-700' : undefined,
              },
            ]}
          />
        </section>

        {/* Bill Tracking's filter toolbar, as on the Bill Register: search, period, project and
            status inline; department and date behind More filters, as chips once set. */}
        <BtToolbar
          search={
            <ToolbarSearch
              className="flex-1 sm:w-72 sm:flex-none"
              value={filterText}
              placeholder="Search reception no, party, amount…"
              onChange={setFilterText}
            />
          }
          controls={
            <>
              <ToolbarSelect
                label="Period"
                value={rangePreset === 'all' ? '' : rangePreset}
                onChange={(value) => setRangePreset((value || 'all') as DRDatePreset)}
                options={DR_DATE_PRESETS.filter((preset) => preset.value !== 'all')}
                allLabel="All time"
              />
              <ToolbarSelect label="Project" value={projectFilter} onChange={setProjectFilter} options={projectOptions} allLabel="All projects" />
              <ToolbarSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
            </>
          }
          chips={moreChips}
          activeCount={activeFilterCount}
          onClear={clearFilters}
          actions={
            <>
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setIsMoreFiltersOpen(true)}>
                <SlidersHorizontal className="h-4 w-4" /> More filters
                {moreChips.length ? (
                  <span className="rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold leading-4 text-white">{moreChips.length}</span>
                ) : null}
              </Button>
            {/* Desktop only, as in Bill Tracking: a phone shows the register as cards. */}
            {hideableColumns.length ? (
              <div className="hidden items-center gap-2 sm:flex">
                {/* Every column, ticked or not. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 bg-white shadow-sm">
                      <Columns className="h-4 w-4" /> Columns
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
                    <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {hideableColumns.map((column) => (
                      <DropdownMenuCheckboxItem
                        key={column.key}
                        checked={!hiddenColumns.has(column.key)}
                        onCheckedChange={() => toggleColumn(column.key)}
                        // Keep the menu open, so several columns can be switched in one go.
                        onSelect={(event) => event.preventDefault()}
                      >
                        {column.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* Only what is hidden, each one a click from coming back. */}
                {hiddenList.length ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 bg-white shadow-sm">
                        <EyeOff className="h-4 w-4" /> {hiddenList.length} hidden
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
                      <DropdownMenuLabel>Hidden columns</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {hiddenList.map((column) => (
                        <DropdownMenuItem
                          key={column.key}
                          // Keep the menu open, so several can be brought back in one go.
                          onSelect={(event) => {
                            event.preventDefault();
                            toggleColumn(column.key);
                          }}
                        >
                          <EyeOff className="mr-2 h-4 w-4 text-muted-foreground" />
                          {column.label}
                          <span className="ml-auto text-xs font-medium text-emerald-700">Show</span>
                        </DropdownMenuItem>
                      ))}
                      {hiddenList.length > 1 ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => saveHiddenColumns(new Set())}>Show all columns</DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ) : null}
            </>
          }
        />

        {/* More filters, as on the Bill Register: a drawer, its choices shown as chips once set. */}
        <Sheet open={isMoreFiltersOpen} onOpenChange={setIsMoreFiltersOpen}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
            <SheetHeader className="border-b border-slate-100 px-5 py-4">
              <SheetTitle>More filters</SheetTitle>
              <SheetDescription>Applied to the register, its totals and the checklists you print from it.</SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <fieldset className="space-y-3">
                <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Who</legend>
                <DrawerSelect
                  label="Department"
                  value={departmentFilter}
                  onChange={setDepartmentFilter}
                  options={departmentOptions}
                  placeholder="All departments"
                />
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Date</legend>
                <DrawerInput
                  label="Reception date"
                  type="date"
                  value={dateFilter ? format(dateFilter, 'yyyy-MM-dd') : ''}
                  onChange={(event) => setDateFilter(event.target.value ? new Date(`${event.target.value}T00:00`) : undefined)}
                />
              </fieldset>
            </div>
            <SheetFooter className="flex-row justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <Button variant="outline" onClick={clearFilters}>
                Reset all
              </Button>
              <Button onClick={() => setIsMoreFiltersOpen(false)}>Done</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <TooltipProvider>
          <BtTable
            rows={paginatedEntries}
            columns={tableColumns}
            sort={{ key: sortKey, dir: sortDirection }}
            onSort={(key, dir) => {
              setSortKey(key as SortKey);
              setSortDirection(dir);
            }}
            selectable={isSelectionMode}
            selected={selectedIds}
            onSelectedChange={setSelectedIds}
            onRowClick={handleRowClick}
            // A ticked row shows as ticked, high value or not.
            rowClassName={(entry) =>
              isHighValue(entry, dataControl.highValueThreshold) && !(isSelectionMode && selectedIds.has(entry.id)) ? HIGH_VALUE_ROW : undefined
            }
            showTotals
            dense
            // Only while picking checklists to print — the count is in the footer's "Showing 1–25 of N".
            caption={
              isSelectionMode ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">{selectedIds.size} selected</span>
                  {/* The header checkbox ticks this page; this ticks every page the filters show. */}
                  {filteredEntries.some((entry) => !selectedIds.has(entry.id)) ? (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleSelectAll}>
                      <CheckCheck className="h-4 w-4" />
                      Select all {filteredEntries.length.toLocaleString('en-IN')}
                    </Button>
                  ) : null}
                  {selectedIds.size > 0 ? (
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setSelectedIds(new Set())}>
                      Clear
                    </Button>
                  ) : null}
                  <span className="hidden text-xs font-normal text-slate-500 md:inline">Tick the entries to print, then Confirm & Print.</span>
                </div>
              ) : undefined
            }
            footer={
              filteredEntries.length > 0 ? (
                <Pager
                  page={currentPage}
                  pages={totalPages}
                  total={filteredEntries.length}
                  pageSize={itemsPerPage}
                  onPage={setCurrentPage}
                  onPageSize={setItemsPerPage}
                />
              ) : undefined
            }
            empty={
              activeFilterCount ? (
                <RegisterEmpty
                  title="No entries found for the selected filters."
                  description="Clear or change the filters to see more."
                  action={
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <RegisterEmpty
                  title="No entries yet."
                  description={canAdd ? 'Receive an expense request with Add Entry, or import a register.' : undefined}
                />
              )
            }
          />
        </TooltipProvider>
      </div>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className={cn('max-h-[92vh] overflow-y-auto', addMode === 'multiple' ? 'sm:max-w-5xl' : 'sm:max-w-3xl')}>
          <DialogHeader className="space-y-1 text-left">
            <DialogTitleShad>Add New Entry</DialogTitleShad>
            <DialogDescriptionShad>
              {addMode === 'single'
                ? 'Receive an expense request into Daily Requisition.'
                : 'Receive several expense requests at once — each becomes its own entry, numbered in DEP order.'}
            </DialogDescriptionShad>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div role="tablist" aria-label="How many entries" className="inline-flex rounded-lg border bg-slate-50 p-0.5 text-sm">
                {(
                  [
                    ['single', 'Single entry'],
                    ['multiple', 'Multiple from expense requests'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={addMode === mode}
                    onClick={() => setAddMode(mode)}
                    className={cn(
                      'rounded-md px-3 py-1 font-medium transition-colors',
                      addMode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {addMode === 'single' && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Hash className="h-3.5 w-3.5 text-slate-400" />
                  Reception No
                  <span className="font-mono font-medium text-slate-800">{form.watch('receptionNo') || '—'}</span>
                </div>
              )}
            </div>
          </DialogHeader>
          {addMode === 'multiple' ? (
            <ReceiveMultiplePanel
              requests={unassignedExpenseRequests}
              projects={projects}
              departments={departments}
              settings={moduleSettings}
              dateWindow={dateWindow}
              calendarDisabled={calendarDisabled}
              onCancel={() => setIsAddDialogOpen(false)}
              onDone={(refreshOnly) => {
                if (!refreshOnly) setIsAddDialogOpen(false);
                fetchAllData();
              }}
            />
          ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleAddEntry)}>
              {/* 4 columns: the request and when it came in · who and where · how much and what for · files */}
              <div className={cn(ENTRY_GRID, 'border-t pt-4')}>
                  {fields.depNo.visible && (
                  <div className="min-w-0 space-y-1.5 sm:col-span-2">
                    <label htmlFor="dep-no" className={FORM_LABEL}>
                      {dataControl.requireExpenseRequest ? `${fields.depNo.label} *` : fields.depNo.label}
                    </label>
                    <Select
                      value={form.getValues('depNo')}
                      onValueChange={(value) => {
                        form.clearErrors('depNo');
                        handleDepNoSelect(value);
                      }}
                    >
                      <SelectTrigger id="dep-no" aria-invalid={Boolean(form.formState.errors.depNo)}>
                        <SelectValue placeholder="Select an expense request" />
                      </SelectTrigger>
                      <SelectContent>
                        {unassignedExpenseRequests.map((req) => (
                          <SelectItem key={req.id} value={req.requestNo}>
                            {req.requestNo}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.formState.errors.depNo?.message ? (
                      <p className="text-[11px] font-medium text-destructive">{form.formState.errors.depNo.message}</p>
                    ) : null}
                  </div>
                  )}
                  <FormField control={form.control} name="date" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FORM_LABEL}>{fields.receptionDate.label}</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={'outline'} className={cn('h-9 w-full justify-start px-3 text-left font-normal', !field.value && 'text-muted-foreground')}><CalendarIcon className="mr-2 h-4 w-4 text-slate-400" />{field.value ? format(field.value, 'dd MMM yyyy') : <span>Pick a date</span>}</Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={calendarDisabled} defaultMonth={field.value} initialFocus /></PopoverContent></Popover>{dateWindowHint ? <p className="text-[11px] text-muted-foreground">{dateWindowHint}</p> : null}<FormMessage className="text-[11px]" /></FormItem>)}/>
                  {fields.departmentId.visible && (<FormField control={form.control} name="departmentId" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FORM_LABEL}>{fieldLabel(fields.departmentId)}</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select department"/></SelectTrigger></FormControl><SelectContent>{departments.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}</SelectContent></Select><FormMessage className="text-[11px]" /></FormItem>)}/>)}
                  {(() => {
                    const picked = unassignedExpenseRequests.find((req) => req.requestNo === form.getValues('depNo'));
                    const st = picked?.statutory;
                    if (!st) return null;
                    return (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 sm:col-span-2 md:col-span-4">
                        GST &amp; TDS from the request come with it
                        {st.invoiceNo ? ` · invoice ${st.invoiceNo}` : ''}
                        {st.gstNo ? ` · GSTIN ${st.gstNo}` : ''}
                        {st.gstAmount ? ` · GST ${formatCurrency(st.gstAmount)}` : ''}
                        {st.tdsAmount ? ` · TDS ${formatCurrency(st.tdsAmount)}` : ''} · net payable {formatCurrency(st.netPayable)}.
                      </div>
                    );
                  })()}
                  {fields.partyName.visible && (<FormField control={form.control} name="partyName" render={({ field }) => (<FormItem className="space-y-1.5 sm:col-span-2"><FormLabel className={FORM_LABEL}>{fieldLabel(fields.partyName)}</FormLabel><FormControl><Input {...field} placeholder="Who is being paid" /></FormControl><FormMessage className="text-[11px]" /></FormItem>)}/>)}
                  {fields.projectId.visible && (<FormField control={form.control} name="projectId" render={({ field }) => (<FormItem className="space-y-1.5 sm:col-span-2"><FormLabel className={FORM_LABEL}>{fieldLabel(fields.projectId)}</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select project"/></SelectTrigger></FormControl><SelectContent>{projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>))}</SelectContent></Select><FormMessage className="text-[11px]" /></FormItem>)}/>)}
                  {fields.grossAmount.visible && (<FormField control={form.control} name="grossAmount" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FORM_LABEL}>{fieldLabel(fields.grossAmount)}</FormLabel><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span><FormControl><Input type="number" inputMode="decimal" placeholder="0.00" {...field} className="pl-7 text-right tabular-nums" /></FormControl></div><FormMessage className="text-[11px]" /></FormItem>)}/>)}
                  {fields.netAmount.visible && (<FormField control={form.control} name="netAmount" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FORM_LABEL}>{fieldLabel(fields.netAmount)}</FormLabel><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span><FormControl><Input type="number" inputMode="decimal" placeholder="0.00" {...field} className="pl-7 text-right font-semibold tabular-nums" /></FormControl></div><FormMessage className="text-[11px]" /></FormItem>)}/>)}
                  {fields.description.visible && (<FormField control={form.control} name="description" render={({ field }) => (<FormItem className="space-y-1.5 sm:col-span-2"><FormLabel className={FORM_LABEL}>{fieldLabel(fields.description)}</FormLabel><FormControl><Input {...field} placeholder="What the payment is for" /></FormControl><FormMessage className="text-[11px]"/></FormItem>)}/>)}
                  {fields.attachments.visible && (
                  <div className="min-w-0 space-y-1.5 sm:col-span-2 md:col-span-4">
                    <p className={FORM_LABEL}>{fieldLabel(fields.attachments)}</p>
                    <div className={cn('flex min-h-9 flex-wrap items-center gap-2 rounded-md border border-dashed px-2 py-1.5', attachmentError && 'border-destructive')}>
                      <label
                        htmlFor="attachments"
                        className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Paperclip className="h-3.5 w-3.5" /> Choose files
                      </label>
                      <input id="attachments" type="file" multiple className="sr-only" onChange={handleFileChange} />
                      {selectedFiles.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          Bill, invoice or approval — {fields.attachments.required ? 'at least one file' : 'optional'}
                        </span>
                      ) : (
                        selectedFiles.map((file, i) => (
                          <span key={i} className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-md bg-slate-100 py-1 pl-2 pr-1 text-xs text-slate-700">
                            <FileIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                            <span className="truncate">{file.name}</span>
                            <button
                              type="button"
                              aria-label={`Remove ${file.name}`}
                              className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                              onClick={() => setSelectedFiles(selectedFiles.filter((_, index) => index !== i))}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    {attachmentError ? <p className="text-[11px] font-medium text-destructive">{attachmentError}</p> : null}
                  </div>
                  )}
              </div>
              <DialogFooter className="mt-4 gap-2 border-t pt-4">
                <DialogClose asChild>
                  <Button type="button" variant="outline" onClick={() => { setSelectedFiles([]); }}>Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add Entry
                </Button>
              </DialogFooter>
            </form>
          </Form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitleShad>Edit Entry</DialogTitleShad>
            <DialogDescriptionShad>Update the details of the requisition entry.</DialogDescriptionShad>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-slate-400" />
                Reception No <span className="font-mono font-medium text-slate-800">{editingEntry?.receptionNo || '—'}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                DEP No <span className="font-mono font-medium text-slate-800">{editingEntry?.depNo || '—'}</span>
              </span>
            </div>
          </DialogHeader>
          {editLocked && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold">Payment recorded — only the description can be changed.</p>
                <p>
                  The amounts, party, project, department and date belong to the payment record.
                  {editVouchers.length > 0 ? (
                    <>
                      {' '}Reverse{' '}
                      {editVouchers.map((voucher, index) => (
                        <React.Fragment key={voucher.id}>
                          {index > 0 && ', '}
                          <Link href={voucherHref(voucher.id)} className="font-medium underline underline-offset-2">
                            {voucher.no}
                          </Link>
                        </React.Fragment>
                      ))}{' '}
                      in the Cheque Register to change them.
                    </>
                  ) : (
                    ' It was recorded as paid outside Bank Balance.'
                  )}
                </p>
              </div>
            </div>
          )}
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleUpdateEntry)}>
              {/* 4 columns: who and where · when, which department, how much · what for */}
              <div className={cn(ENTRY_GRID, 'border-t pt-4')}>
                 {fields.partyName.visible && (<FormField control={editForm.control} name="partyName" render={({ field }) => (<FormItem className="space-y-1.5 sm:col-span-2"><FormLabel className={FORM_LABEL}>{fieldLabel(fields.partyName)}</FormLabel><FormControl><Input {...field} readOnly={editLocked} className={cn(editLocked && lockedFieldClass)} /></FormControl><FormMessage className="text-[11px]" /></FormItem>)}/>)}
                 {fields.projectId.visible && (<FormField control={editForm.control} name="projectId" render={({ field }) => (<FormItem className="space-y-1.5 sm:col-span-2"><FormLabel className={FORM_LABEL}>{fieldLabel(fields.projectId)}</FormLabel><Select onValueChange={field.onChange} value={field.value} disabled={editLocked}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>))}</SelectContent></Select><FormMessage className="text-[11px]" /></FormItem>)}/>)}
                 <FormField control={editForm.control} name="date" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FORM_LABEL}>{fields.receptionDate.label}</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={'outline'} disabled={editLocked} className={cn('h-9 w-full justify-start px-3 text-left font-normal', !field.value && 'text-muted-foreground')}><CalendarIcon className="mr-2 h-4 w-4 text-slate-400" />{field.value ? format(field.value, 'dd MMM yyyy') : <span>Pick a date</span>}</Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={calendarDisabled} defaultMonth={field.value} initialFocus /></PopoverContent></Popover>{dateWindowHint ? <p className="text-[11px] text-muted-foreground">{dateWindowHint}</p> : null}<FormMessage className="text-[11px]" /></FormItem>)}/>
                 {fields.departmentId.visible && (<FormField control={editForm.control} name="departmentId" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FORM_LABEL}>{fieldLabel(fields.departmentId)}</FormLabel><Select onValueChange={field.onChange} value={field.value} disabled={editLocked}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{departments.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}</SelectContent></Select><FormMessage className="text-[11px]" /></FormItem>)}/>)}
                 {fields.grossAmount.visible && (<FormField control={editForm.control} name="grossAmount" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FORM_LABEL}>{fieldLabel(fields.grossAmount)}</FormLabel><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span><FormControl><Input type="number" inputMode="decimal" placeholder="0.00" {...field} readOnly={editLocked} className={cn('pl-7 text-right tabular-nums', editLocked && lockedFieldClass)} /></FormControl></div><FormMessage className="text-[11px]" /></FormItem>)}/>)}
                 {fields.netAmount.visible && (<FormField control={editForm.control} name="netAmount" render={({ field }) => (<FormItem className="space-y-1.5"><FormLabel className={FORM_LABEL}>{fieldLabel(fields.netAmount)}</FormLabel><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span><FormControl><Input type="number" inputMode="decimal" placeholder="0.00" {...field} readOnly={editLocked} className={cn('pl-7 text-right font-semibold tabular-nums', editLocked && lockedFieldClass)} /></FormControl></div><FormMessage className="text-[11px]" /></FormItem>)}/>)}
                 {fields.description.visible && (<FormField control={editForm.control} name="description" render={({ field }) => (<FormItem className="space-y-1.5 sm:col-span-2 md:col-span-4"><FormLabel className={FORM_LABEL}>{fieldLabel(fields.description)}</FormLabel><FormControl><Input {...field} placeholder="What the payment is for" /></FormControl><FormMessage className="text-[11px]"/></FormItem>)}/>)}
              </div>
              <DialogFooter className="mt-4 gap-2 border-t pt-4">
                <DialogClose asChild>
                  <Button type="button" variant="outline">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {selectedEntry && (
        <ViewDailyRequisitionDialog
          isOpen={isViewDialogOpen}
          onOpenChange={setIsViewDialogOpen}
          entry={selectedEntry}
          projects={projects}
          departments={departments}
          expenseRequest={
            // The request this entry received, before any other copy of the same number.
            expenseRequests.find(
              (req) => req.requestNo === selectedEntry.depNo && req.receptionNo === selectedEntry.receptionNo,
            ) ?? expenseRequests.find((req) => req.requestNo === selectedEntry.depNo)
          }
          onActionComplete={fetchAllData}
        />
      )}

      <DailyRequisitionImportDialog
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        projects={projects}
        departments={departments}
        existing={importExisting}
        expenseRequests={expenseRequests}
        onImported={fetchAllData}
      />
    </>
  );
}

/** The Add / Edit entry dialogs' grid: 1 column on a phone, 2 on a tablet, 4 from md up, 36px controls. */
const ENTRY_GRID = 'grid grid-cols-1 gap-x-4 gap-y-3.5 [--control-h:2.25rem] sm:grid-cols-2 md:grid-cols-4';

export default function EntrySheetPage() {
    return (
        // useSearchParams (the `?q=` filter) needs this boundary for the route to prerender.
        <Suspense fallback={<EntrySheetSkeleton />}>
            <EntrySheetPageComponent />
        </Suspense>
    )
}