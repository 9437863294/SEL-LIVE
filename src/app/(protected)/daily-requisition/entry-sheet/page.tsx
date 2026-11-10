
'use client';
export const dynamic = 'force-dynamic';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DailyRequisitionImportDialog } from '@/components/daily-requisition/import-dialog';
import { allocateReceptionNos, requisitionFingerprint } from '@/lib/daily-requisition-import';
import {
  Plus,
  Calendar as CalendarIcon,
  Loader2,
  Eye,
  Pencil,
  Trash2,
  ShieldAlert,
  Printer,
  Upload,
  Download,
  Hash,
  X,
  Lock,
  FilePlus,
  Inbox,
  Search,
  SlidersHorizontal,
  Columns3,
  CheckCheck,
  ListChecks,
  IndianRupee,
  CheckCircle2,
  Clock,
  Check,
  Info,
  Receipt,
} from 'lucide-react';
import {
  DepPicker,
  FileDrop,
  KeyHint,
  LabelText,
  ModeSwitch,
  ReceptionPill,
  Section,
  ef,
  type DepOption,
} from '@/components/daily-requisition/entry-form-ui';
import { amountInWords } from '@/lib/daily-requisition-print';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DrawerInput } from '@/components/bill-tracking/bt-toolbar';
import {
  BulkBar,
  BulkButton,
  DensityToggle,
  FilterChips,
  FilterSelect,
  Kpi,
  NumberedPager,
  Register,
  RegisterEmpty,
  RowAction,
  SearchBox,
  StageTabs,
  ToolbarButton,
  TwoLineDate,
  es,
  type Density,
  type FilterChip,
  type RegisterColumn,
} from '@/components/daily-requisition/entry-sheet-ui';
import { exportWorkbook, type ExcelColumn } from '@/lib/report-excel';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
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
import { readDailyRequisitionWorkflowSteps } from '@/components/daily-requisition/nav';
import { holdForCreate } from '@/lib/daily-requisition-flow';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/AuthProvider';
import { dailyPageContainerClass, dailySurfaceCardClass } from '@/components/daily-requisition/module-shell';
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

/**
 * An amount in a register cell, to the paisa on one line — or a dash, where nothing is better shown
 * as nothing. `tone="due"` marks a balance still owed.
 */
function Money({ value, dashWhenZero = false, tone }: { value: number; dashWhenZero?: boolean; tone?: 'due' }) {
  if (dashWhenZero && !value) return <span className={es.zero}>—</span>;
  return <span className={cn('whitespace-nowrap', tone === 'due' && value > 0 ? es.due : es.amt)}>{formatCurrency(value)}</span>;
}

/** The stage tabs, in workflow order: the stages `requisitionProgress` reads entries as. */
const STAGES = REQUISITION_STAGES;
const stageLabel = (stage: string) => STAGES.find((entry) => entry.stage === stage)?.label ?? stage;

/** More filters › Payment. */
type PaymentFilter = '' | 'due' | 'paid';
const PAYMENT_LABELS: Record<Exclude<PaymentFilter, ''>, string> = {
  due: 'Has a balance due',
  paid: 'Paid in full',
};

/** A date for an Excel cell at the wall-clock time the app shows (exceljs writes a Date's UTC fields). */
const toExcelDate = (value: unknown): Date | null => {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
};

/** "FY 2026-27" for a `yyyy-MM-dd` day: the Indian financial year runs April to March. */
const financialYear = (dayKey: string) => {
  const [year, month] = dayKey.split('-').map(Number);
  const start = month >= 4 ? year : year - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/** Figures for a set of entries: every one the filters match, not only a page of them. */
function totalsOf(list: DailyRequisitionEntry[]) {
  const progress = list.map((entry) => requisitionProgress(entry));
  return {
    gross: sumBy(list, (entry) => Number(entry.grossAmount) || 0),
    net: sumBy(progress, (entry) => entry.net),
    paid: sumBy(progress, (entry) => entry.paid),
    balance: sumBy(progress, (entry) => entry.balance),
    paidInFull: progress.filter((entry) => entry.stage === 'paid').length,
    stillToPay: progress.filter((entry) => entry.balance > 0).length,
  };
}

const HIDDEN_COLUMNS_KEY = 'daily-requisition:entry-sheet:hidden-columns';
const DENSITY_KEY = 'daily-requisition:entry-sheet:density';

/** The row height this browser last chose; comfortable until it chooses. Read once, at first render. */
function readDensity(): Density {
  if (typeof window === 'undefined') return 'comfortable';
  try {
    return window.localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

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
  /** More filters: the net amount between these (either may be blank), and whether anything is still owed. */
  const [amountMin, setAmountMin] = React.useState('');
  const [amountMax, setAmountMax] = React.useState('');
  const [paymentFilter, setPaymentFilter] = React.useState<PaymentFilter>('');
  const [isMoreFiltersOpen, setIsMoreFiltersOpen] = React.useState(false);
  /** Row height, remembered in this browser. */
  const [density, setDensity] = React.useState<Density>(readDensity);
  const searchRef = React.useRef<HTMLInputElement>(null);
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
  
  /** Ticked rows, across pages — what Print checklists and Export act on. */
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  /** The entry whose Delete was pressed, waiting on the confirmation. */
  const [deleteTarget, setDeleteTarget] = React.useState<EnrichedDailyRequisitionEntry | null>(null);
  /** Print checklists pressed with nothing ticked, on a long register: confirm before opening hundreds of pages. */
  const [confirmPrintAll, setConfirmPrintAll] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);

  const canViewPage = can('View', 'Daily Requisition.Entry Sheet');
  const canAdd = can('Add', 'Daily Requisition.Entry Sheet');
  const canEdit = can('Edit', 'Daily Requisition.Entry Sheet');
  const canDelete = can('Delete', 'Daily Requisition.Entry Sheet');
  const canViewChecklist = can('View Checklist', 'Daily Requisition.Entry Sheet');
  const canExport = can('Export', 'Daily Requisition.Entry Sheet');
  /** Rows can be ticked when there is something to do with them. */
  const canSelect = canViewChecklist || canExport;
  
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
  /** Add New Entry's fields still holding what the chosen expense request filled in — marked AUTO. */
  const [autoFilled, setAutoFilled] = React.useState<ReadonlySet<string>>(() => new Set());
  const unmarkAuto = (key: string) =>
    setAutoFilled((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  /** Multiple: the reception numbers the ticked requests will take, for the bar under the header. */
  const [multiPreview, setMultiPreview] = React.useState<string | null>(null);

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

  /**
   * Reloads everything. `quiet` (exactly `true`) keeps the page on screen while it does — after an
   * Add, so the dialog stays put for "Save & add another" instead of giving way to the skeleton.
   * Typed `unknown` because it is also handed straight to callbacks that pass arguments of their own.
   */
  const fetchAllData = React.useCallback(async (quiet?: unknown) => {
    if (quiet !== true) setIsLoading(true);
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
  
  /** Picking a request fills in its details (marked AUTO until changed); clearing it only unlinks it. */
  const handleDepNoSelect = (value: string) => {
    const selectedRequest = unassignedExpenseRequests.find((req) => req.requestNo === value);
    if (selectedRequest) {
      const filled = {
        description: selectedRequest.description || '',
        partyName: selectedRequest.partyName || '',
        projectId: selectedRequest.projectId || '',
        departmentId: selectedRequest.departmentId || '',
        // With GST & TDS captured on the request, gross is its taxable value and net what is payable.
        grossAmount: String(selectedRequest.statutory?.taxableAmount ?? selectedRequest.amount ?? ''),
        netAmount: String(selectedRequest.statutory?.netPayable ?? selectedRequest.amount ?? ''),
      };
      form.reset({ ...form.getValues(), depNo: selectedRequest.requestNo, ...filled });
      setAutoFilled(new Set(Object.entries(filled).filter(([, text]) => text.trim() !== '').map(([key]) => key)));
    } else {
      form.setValue('depNo', value);
      setAutoFilled(new Set());
    }
  };

  /**
   * Gross typed by hand carries the net along with it while the two are the same (or net is blank) —
   * the common bill with nothing deducted. A net that differs, typed or from the request, is left alone.
   */
  const handleGrossChange = (value: string) => {
    const previousGross = form.getValues('grossAmount');
    const net = form.getValues('netAmount');
    form.setValue('grossAmount', value, { shouldDirty: true });
    form.clearErrors('grossAmount');
    unmarkAuto('grossAmount');
    if (fields.netAmount.visible && (!String(net).trim() || Number(net) === Number(previousGross))) {
      form.setValue('netAmount', value, { shouldDirty: true });
      form.clearErrors('netAmount');
      unmarkAuto('netAmount');
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
    setAutoFilled(new Set());
    setMultiPreview(null);
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

  /** Files chosen or dropped are added to those already there; the same file twice is kept once. */
  const addFiles = (files: File[]) => {
    setAttachmentError(null);
    setSelectedFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}|${file.size}|${file.lastModified}`));
      return [...current, ...files.filter((file) => !seen.has(`${file.name}|${file.size}|${file.lastModified}`))];
    });
  };

  /** Saves the entry; `keepOpen` ("Save & add another") leaves the dialog open on a fresh form, same date. */
  const handleAddEntry = async (data: z.infer<typeof formSchema>, keepOpen = false) => {
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
        const { receptionNos, update } = allocateReceptionNos(configDoc.data() as SerialNumberConfig, 1);
        generatedReceptionNo = receptionNos[0];
        transaction.update(configRef, update);
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
      // Verification steps before Finance: it starts at the first that names someone for it.
      Object.assign(newEntryData, holdForCreate(await readDailyRequisitionWorkflowSteps(), newEntryData, Timestamp.now()));

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

      toast({
        title: 'Entry added',
        description: `${generatedReceptionNo}${data.partyName ? ` · ${data.partyName}` : ''} · ${formatCurrency(data.netAmount || data.grossAmount)}`,
      });
      if (!keepOpen) setIsAddDialogOpen(false);
      // The next one starts empty — on the same reception date when adding several in a row. The
      // Reception No is blank until the quiet reload below brings the next one.
      form.reset({
        receptionNo: '',
        depNo: '',
        date: keepOpen ? data.date : new Date(),
        description: '',
        partyName: '',
        projectId: '',
        departmentId: '',
        grossAmount: '',
        netAmount: '',
      });
      setSelectedFiles([]);
      setAutoFilled(new Set());
      setAttachmentError(null);
      void fetchAllData(true);
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

  /**
   * The entries every filter but the stage tab lets through, sorted — what the KPI cards and the
   * tabs' counts are worked out from, so the tabs break the scope down rather than narrowing it.
   */
  const scopedEntries = React.useMemo(() => {
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
    const bound = (text: string) => {
      const value = text.trim() === '' ? Number.NaN : Number(text);
      return Number.isFinite(value) ? value : null;
    };
    const min = bound(amountMin);
    const max = bound(amountMax);
    const inView = (entry: EnrichedDailyRequisitionEntry) => {
      if (projectFilter && entry.projectId !== projectFilter) return false;
      if (departmentFilter && entry.departmentId !== departmentFilter) return false;
      if (dateFilter && !isSameDay(new Date(entry.originalDate), dateFilter)) return false;
      if (min !== null || max !== null) {
        const net = Number(entry.netAmount) || 0;
        if (min !== null && net < min) return false;
        if (max !== null && net > max) return false;
      }
      if (paymentFilter === 'due' && !(balanceOf(entry) > 0)) return false;
      if (paymentFilter === 'paid' && !(paidOf(entry) > 0 && balanceOf(entry) === 0)) return false;
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
    amountMin,
    amountMax,
    paymentFilter,
    projectNameById,
    departmentNameById,
  ]);

  /** What the register lists: the scope, at the stage tab's stage. */
  const filteredEntries = React.useMemo(
    () => (statusFilter ? scopedEntries.filter((entry) => requisitionProgress(entry).stage === statusFilter) : scopedEntries),
    [scopedEntries, statusFilter],
  );

  /** How many of the scope are at each stage — the tabs' counts. */
  const stageCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of scopedEntries) {
      const { stage } = requisitionProgress(entry);
      counts.set(stage, (counts.get(stage) ?? 0) + 1);
    }
    return counts;
  }, [scopedEntries]);

  // A narrower filter, or a longer page, must not leave the table on a page that no longer exists.
  React.useEffect(() => {
    setCurrentPage(1);
  }, [filterText, dateFilter, rangePreset, projectFilter, departmentFilter, statusFilter, amountMin, amountMax, paymentFilter, itemsPerPage]);

  const paginatedEntries = React.useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredEntries.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredEntries, currentPage, itemsPerPage]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / itemsPerPage));

  /** The KPI cards: the scope, whichever stage tab is open. */
  const scopeTotals = React.useMemo(() => totalsOf(scopedEntries), [scopedEntries]);
  /** The register's totals row: what it lists. */
  const totals = React.useMemo(() => totalsOf(filteredEntries), [filteredEntries]);

  /** Entries created in the last seven days, today included — the Entries card's "+N this week". */
  const createdThisWeek = React.useMemo(() => {
    const [year, month, day] = todayKey.split('-').map(Number);
    const since = new Date(year, month - 1, day - 6).getTime();
    return entries.filter((entry) => (toDate(entry.createdAt)?.getTime() ?? 0) >= since).length;
  }, [entries, todayKey]);

  const rangeLabel = DR_DATE_PRESETS.find((preset) => preset.value === rangePreset)?.label ?? 'All time';
  const amountFilterOn = Boolean(amountMin.trim() || amountMax.trim());
  /** The filters behind More filters that are set — the count on its button. */
  const moreFilterCount = [dateFilter, amountFilterOn, paymentFilter].filter(Boolean).length;
  // The search counts, so the toolbar's Clear shows for a search alone too.
  const activeFilterCount =
    [filterText.trim(), projectFilter, departmentFilter, statusFilter].filter(Boolean).length +
    (rangePreset !== 'all' ? 1 : 0) +
    moreFilterCount;
  const clearFilters = () => {
    setFilterText('');
    setDateFilter(undefined);
    setRangePreset('all');
    setProjectFilter('');
    setDepartmentFilter('');
    setStatusFilter('');
    setAmountMin('');
    setAmountMax('');
    setPaymentFilter('');
  };
  const changeDensity = (next: Density) => {
    setDensity(next);
    try {
      window.localStorage.setItem(DENSITY_KEY, next);
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
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

  const handleViewChecklist = (entry: DailyRequisitionEntry) => {
    window.open(`/daily-requisition/entry-sheet/${entry.id}/print`, '_blank');
  };

  /** The ticked entries, newest first — whichever page they are on. */
  const selectedEntries = React.useMemo(() => entries.filter((entry) => selectedIds.has(entry.id)), [entries, selectedIds]);

  /** Opens the checklists of these entries, in this order, in a new tab. */
  const printChecklists = (list: Array<{ id: string }>) => {
    if (list.length) window.open(checklistPrintHref(list.map((entry) => entry.id)), '_blank');
  };

  /** Above this many, printing everything the filters show asks first. */
  const PRINT_ALL_CONFIRM = 50;
  /** The header's Print checklists: the ticked entries, or — with none ticked — every one the filters show. */
  const handlePrintChecklists = () => {
    if (selectedEntries.length) return printChecklists(selectedEntries);
    if (filteredEntries.length > PRINT_ALL_CONFIRM) return setConfirmPrintAll(true);
    printChecklists(filteredEntries);
  };

  /** Ticks every entry the filters show, on every page, keeping any already ticked. */
  const handleSelectAll = () => {
    setSelectedIds((current) => new Set([...current, ...filteredEntries.map((entry) => entry.id)]));
  };

  /**
   * These entries as an Excel workbook, in the register's columns (Field Control's order and names,
   * the DEP No beside the Reception No) with real dates and amounts.
   */
  const exportEntries = async (list: EnrichedDailyRequisitionEntry[], which: 'filtered' | 'selected') => {
    if (!canExport || !list.length) return;
    const MONEY = '#,##0.00';
    type ExportColumn = { width: number; numFmt?: string; value: (entry: EnrichedDailyRequisitionEntry) => unknown };
    const spec: Partial<Record<string, ExportColumn>> = {
      createdAt: { width: 18, numFmt: 'dd-mmm-yyyy hh:mm', value: (entry) => toExcelDate(entry.createdAt) },
      receptionNo: { width: 24, value: (entry) => entry.receptionNo ?? '' },
      status: { width: 18, value: (entry) => requisitionProgress(entry).label },
      date: { width: 14, numFmt: 'dd-mmm-yyyy', value: (entry) => toExcelDate(entry.originalDate) },
      projectId: { width: 30, value: (entry) => projectNameById.get(entry.projectId) || entry.projectId || '' },
      departmentId: { width: 20, value: (entry) => departmentNameById.get(entry.departmentId) || entry.departmentId || '' },
      partyName: { width: 30, value: (entry) => entry.partyName ?? '' },
      description: { width: 44, value: (entry) => entry.description ?? '' },
      grossAmount: { width: 16, numFmt: MONEY, value: (entry) => Number(entry.grossAmount) || 0 },
      netAmount: { width: 16, numFmt: MONEY, value: (entry) => Number(entry.netAmount) || 0 },
      paid: { width: 16, numFmt: MONEY, value: (entry) => paidOf(entry) },
      balance: { width: 16, numFmt: MONEY, value: (entry) => balanceOf(entry) },
    };
    const picked = columns.flatMap((column): Array<ExportColumn & { key: string; header: string }> => {
      const def = spec[column.key];
      if (!def) return [];
      const own = { key: column.key, header: column.label, ...def };
      return column.key === 'receptionNo'
        ? [own, { key: 'depNo', header: fields.depNo.label || 'DEP No', width: 24, value: (entry) => entry.depNo ?? '' }]
        : [own];
    });
    const excelColumns: ExcelColumn[] = picked.map(({ key, header, width, numFmt }) => ({ key, header, width, ...(numFmt ? { numFmt } : {}) }));
    setIsExporting(true);
    try {
      await exportWorkbook(`daily-requisition-${which === 'selected' ? 'selected' : 'entries'}-${todayKey}.xlsx`, [
        {
          name: 'Entries',
          columns: excelColumns,
          rows: list.map((entry) => Object.fromEntries(picked.map(({ key, value }) => [key, value(entry)]))),
        },
      ]);
      toast({
        title: 'Exported',
        description: `${list.length.toLocaleString('en-IN')} ${list.length === 1 ? 'entry' : 'entries'} saved as an Excel workbook.`,
      });
    } catch (error) {
      console.error('Error exporting entries:', error);
      toast({ title: 'Export failed', description: 'The workbook could not be created.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  // "/" jumps to the search and "n" starts a new entry — never while something is being typed or a
  // dialog is open. The ref keeps the listener on the current render's `openAddDialog`.
  const openAddRef = React.useRef(openAddDialog);
  React.useEffect(() => {
    openAddRef.current = openAddDialog;
  });
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]')) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if ((event.key === 'n' || event.key === 'N') && canAdd) {
        event.preventDefault();
        openAddRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canAdd]);

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
  
  /** A row's quick actions: details, checklist, edit and delete — a blocked one disabled, saying why. */
  const renderActions = (entry: EnrichedDailyRequisitionEntry) => {
    const locked = isPaymentLocked(entry);
    const editBlock = receivedRuleBlock(entry.status, dataControl, 'edit');
    // The payment lock's reason wins over the status rule's.
    const deleteBlock = locked ? paymentLockReason(entry) : receivedRuleBlock(entry.status, dataControl, 'delete');
    return (
      <div className={es.actions}>
        <RowAction icon={Eye} label="View details" onClick={() => handleViewDetails(entry)} />
        {canViewChecklist ? <RowAction icon={Printer} label="Print checklist" onClick={() => handleViewChecklist(entry)} /> : null}
        {canEdit ? (
          <RowAction icon={Pencil} label={locked ? 'Edit description' : 'Edit'} reason={editBlock} onClick={() => handleOpenEditDialog(entry)} />
        ) : null}
        {canDelete ? <RowAction icon={Trash2} label="Delete" danger reason={deleteBlock} onClick={() => setDeleteTarget(entry)} /> : null}
      </div>
    );
  };

  /** Every filter in force, as a chip that removes it. */
  const chips: FilterChip[] = [];
  if (filterText.trim()) chips.push({ key: 'q', label: `Search: “${filterText.trim()}”`, onRemove: () => setFilterText('') });
  if (statusFilter) chips.push({ key: 'stage', label: `Stage: ${stageLabel(statusFilter)}`, onRemove: () => setStatusFilter('') });
  if (rangePreset !== 'all') chips.push({ key: 'period', label: `Period: ${rangeLabel}`, onRemove: () => setRangePreset('all') });
  if (projectFilter) {
    chips.push({ key: 'project', label: `Project: ${projectNameById.get(projectFilter) || projectFilter}`, onRemove: () => setProjectFilter('') });
  }
  if (departmentFilter) {
    chips.push({
      key: 'department',
      label: `Department: ${departmentNameById.get(departmentFilter) || departmentFilter}`,
      onRemove: () => setDepartmentFilter(''),
    });
  }
  if (dateFilter) chips.push({ key: 'date', label: `Date: ${format(dateFilter, 'dd MMM yyyy')}`, onRemove: () => setDateFilter(undefined) });
  if (amountFilterOn) {
    chips.push({
      key: 'amount',
      label: `Net: ${amountMin.trim() ? formatCurrency(amountMin) : '₹0'} – ${amountMax.trim() ? formatCurrency(amountMax) : 'any'}`,
      onRemove: () => {
        setAmountMin('');
        setAmountMax('');
      },
    });
  }
  if (paymentFilter) chips.push({ key: 'payment', label: PAYMENT_LABELS[paymentFilter], onRemove: () => setPaymentFilter('') });

  /** Numbers and dates sort largest / newest first on the first click; words A to Z. */
  const DESC_FIRST = new Set(['createdAt', 'date', 'grossAmount', 'netAmount', 'paid', 'balance']);
  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key as SortKey);
    setSortDirection(DESC_FIRST.has(key) ? 'desc' : 'asc');
  };

  const highValue = (entry: EnrichedDailyRequisitionEntry) => isHighValue(entry, dataControl.highValueThreshold);
  const projectOf = (entry: EnrichedDailyRequisitionEntry) => projectNameById.get(entry.projectId) || entry.projectId;
  const departmentOf = (entry: EnrichedDailyRequisitionEntry) => departmentNameById.get(entry.departmentId) || entry.departmentId;

  // Field Control's layout — which columns, in what order, under what names. A locked column always
  // shows, even if this browser hid it before it was locked.
  const hideableColumns = columns.filter((column) => !column.locked);
  const hiddenCount = hideableColumns.filter((column) => hiddenColumns.has(column.key)).length;
  const tableColumns = columns
    .filter((column) => column.locked || !hiddenColumns.has(column.key))
    .map((column): RegisterColumn<EnrichedDailyRequisitionEntry> => {
      const base = {
        key: column.key,
        header: column.label,
        align: column.numeric ? ('right' as const) : undefined,
        sortKey: column.key === 'actions' ? undefined : column.key,
      };
      switch (column.key) {
        case 'createdAt':
          return {
            ...base,
            cell: (entry) => {
              const created = toDate(entry.createdAt);
              return <TwoLineDate date={fmt(created)} time={fmt(created, 'h:mm a')} />;
            },
          };
        case 'receptionNo':
          return {
            ...base,
            pin: true,
            cell: (entry) => (
              <span className="inline-flex items-center">
                <button type="button" onClick={() => handleViewDetails(entry)} className={es.rec}>
                  {entry.receptionNo || '—'}
                </button>
                {highValue(entry) ? (
                  <span className={es.highDot} title={`High value — ${formatCurrency(dataControl.highValueThreshold)} or more`} />
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
                <StatusBadge tone={progress.tone} dot title={entry.manualPaid ? 'Recorded as paid outside Bank Balance' : entry.status}>
                  {progress.label}
                </StatusBadge>
              );
            },
          };
        case 'date':
          return { ...base, cell: (entry) => <span className="whitespace-nowrap">{entry.dateText || '—'}</span> };
        case 'projectId':
          return { ...base, cell: (entry) => <CellText text={projectOf(entry)} className={cn(es.strong, 'max-w-[180px]')} /> };
        case 'departmentId':
          return {
            ...base,
            cell: (entry) => {
              const name = departmentOf(entry);
              return name ? (
                <span className={es.dept} title={name}>
                  {name}
                </span>
              ) : (
                <span className={es.zero}>—</span>
              );
            },
          };
        case 'partyName':
          return {
            ...base,
            cell: (entry) => <CellText text={entry.partyName} className={cn(es.strong, 'max-w-[200px]')} />,
          };
        case 'description':
          return { ...base, cell: (entry) => <CellText text={entry.description} className="max-w-[260px]" /> };
        case 'grossAmount':
          return { ...base, cell: (entry) => <Money value={Number(entry.grossAmount) || 0} />, total: <Money value={totals.gross} /> };
        case 'netAmount':
          return { ...base, cell: (entry) => <Money value={Number(entry.netAmount) || 0} />, total: <Money value={totals.net} /> };
        case 'paid':
          return { ...base, cell: (entry) => <Money value={paidOf(entry)} dashWhenZero />, total: <Money value={totals.paid} /> };
        case 'balance':
          return {
            ...base,
            cell: (entry) => <Money value={balanceOf(entry)} dashWhenZero tone="due" />,
            total: <Money value={totals.balance} tone="due" />,
          };
        case 'actions':
          return { ...base, header: <span className="sr-only">Actions</span>, cell: renderActions };
        default:
          return { ...base, cell: () => null };
      }
    });

  /** A phone card: the reception number and stage, the party and what for, then where and how much. */
  const renderCard = (entry: EnrichedDailyRequisitionEntry, select: React.ReactNode) => {
    const progress = requisitionProgress(entry);
    return (
      <>
        <div className={es.cardTop}>
          {select}
          <button type="button" onClick={() => handleViewDetails(entry)} className={es.rec}>
            {entry.receptionNo || '—'}
          </button>
          <StatusBadge tone={progress.tone} dot>
            {progress.label}
          </StatusBadge>
        </div>
        <div className={es.cardParty}>{entry.partyName || '—'}</div>
        {entry.description ? <div className={es.cardDesc}>{entry.description}</div> : null}
        <dl className={es.cardGrid}>
          <div>
            <dt>Project</dt>
            <dd>{projectOf(entry) || '—'}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{departmentOf(entry) || '—'}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{entry.dateText || '—'}</dd>
          </div>
          <div>
            <dt>Net</dt>
            <dd>
              <Money value={progress.net} />
              {progress.balance > 0 ? (
                <>
                  {' · '}
                  <span className={es.due}>{formatCurrency(progress.balance)} due</span>
                </>
              ) : null}
            </dd>
          </div>
        </dl>
      </>
    );
  };

  const paidPercent = scopeTotals.net > 0 ? Math.min(100, Math.round((scopeTotals.paid / scopeTotals.net) * 100)) : 0;
  const toReceive = unassignedExpenseRequests.length;
  const selectedNet = sumBy(selectedEntries, (entry) => Number(entry.netAmount) || 0);
  const entriesWord = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'entry' : 'entries'}`;

  return (
    <>
      <div className={cn(dailyPageContainerClass, es.root, density === 'compact' && es.compact, 'space-y-4 no-print')}>
        <PageHeader
          backHref="/daily-requisition"
          eyebrow="Daily Requisition"
          icon={FilePlus}
          title="Entry Sheet"
          badge={<span className={es.fy}>{financialYear(todayKey)}</span>}
          actions={
            <>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={handlePrintChecklists}
                disabled={!canViewChecklist || filteredEntries.length === 0}
                title={
                  selectedEntries.length
                    ? `Print the ${entriesWord(selectedEntries.length)} ticked`
                    : `Print every entry the filters show (${entriesWord(filteredEntries.length)}) — or tick some first`
                }
              >
                <Printer className="h-4 w-4" /> Print checklists
              </Button>
              {/* Gated on Add, the same grant as keying one by hand — importing a register is
                  creating entries, and there is no separate power to invent for it. */}
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setIsImportOpen(true)} disabled={!canAdd}>
                <Upload className="h-4 w-4" /> Import
              </Button>
              {canExport ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => void exportEntries(filteredEntries, 'filtered')}
                  disabled={isExporting || filteredEntries.length === 0}
                  title={`Every entry the filters show (${entriesWord(filteredEntries.length)}), as an Excel workbook`}
                >
                  {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export
                </Button>
              ) : null}
              <Button size="sm" className="gap-1.5" onClick={openAddDialog} disabled={!canAdd} title="Add entry (N)">
                <Plus className="h-4 w-4" /> Add entry
              </Button>
            </>
          }
        />

        {/* The scope the filters set, whichever stage tab is open. */}
        <section className={es.kpis} aria-label="Totals">
          <Kpi
            tone="primary"
            icon={ListChecks}
            label="Entries"
            value={scopedEntries.length.toLocaleString('en-IN')}
            sub={
              createdThisWeek ? (
                <>
                  <span className={es.up}>+{createdThisWeek.toLocaleString('en-IN')}</span>
                  <span>added this week</span>
                </>
              ) : (
                <span>None added this week</span>
              )
            }
          />
          <Kpi
            tone="blue"
            icon={IndianRupee}
            label="Gross amount"
            value={formatINRCompact(scopeTotals.gross)}
            valueTitle={formatCurrency(scopeTotals.gross)}
            sub={<span title={formatCurrency(scopeTotals.net)}>Net {formatINRCompact(scopeTotals.net)}</span>}
          />
          <Kpi
            tone="green"
            icon={CheckCircle2}
            label="Paid"
            value={formatINRCompact(scopeTotals.paid)}
            valueTitle={formatCurrency(scopeTotals.paid)}
            sub={
              <span>
                {scopeTotals.paidInFull.toLocaleString('en-IN')} paid in full · {paidPercent}%
              </span>
            }
            progress={paidPercent}
          />
          <Kpi
            tone="orange"
            icon={Clock}
            label="Balance due"
            value={formatINRCompact(scopeTotals.balance)}
            valueTitle={formatCurrency(scopeTotals.balance)}
            colourValue={scopeTotals.balance > 0}
            sub={<span>{scopeTotals.stillToPay.toLocaleString('en-IN')} still to pay</span>}
            progress={scopeTotals.net > 0 ? 100 - paidPercent : 0}
          />
          <Kpi
            tone="violet"
            icon={Inbox}
            label="DEP to receive"
            value={toReceive.toLocaleString('en-IN')}
            sub={<span title="Expense requests not yet received into Daily Requisition">Not yet received</span>}
            onClick={
              canAdd && toReceive
                ? () => {
                    openAddDialog();
                    setAddMode('multiple');
                  }
                : undefined
            }
            action={canAdd && toReceive ? 'Receive →' : undefined}
          />
        </section>

        <section className={es.panel} aria-label="Entries">
          <StageTabs
            value={statusFilter}
            onChange={setStatusFilter}
            total={scopedEntries.length}
            stages={STAGES.map(({ stage, label, tone }) => ({ value: stage, label, tone, count: stageCounts.get(stage) ?? 0 }))}
          />

          <div className={es.toolbar}>
            <SearchBox inputRef={searchRef} value={filterText} onChange={setFilterText} placeholder="Search reception no, party, project, amount…" />
            <FilterSelect
              label="Period"
              value={rangePreset === 'all' ? '' : rangePreset}
              onChange={(value) => setRangePreset((value || 'all') as DRDatePreset)}
              options={DR_DATE_PRESETS.filter((preset) => preset.value !== 'all')}
              allLabel="All time"
            />
            <FilterSelect label="Project" value={projectFilter} onChange={setProjectFilter} options={projectOptions} allLabel="All projects" />
            <FilterSelect label="Department" value={departmentFilter} onChange={setDepartmentFilter} options={departmentOptions} allLabel="All departments" />
            <ToolbarButton icon={SlidersHorizontal} count={moreFilterCount} onClick={() => setIsMoreFiltersOpen(true)}>
              More filters
            </ToolbarButton>
            <span className={es.toolbarSpacer} />
            <DensityToggle value={density} onChange={changeDensity} />
            {hideableColumns.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <ToolbarButton
                    icon={Columns3}
                    count={hiddenCount}
                    className={es.desktopOnly}
                    title={hiddenCount ? `${hiddenCount} hidden` : 'Show or hide columns'}
                  >
                    Columns
                  </ToolbarButton>
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
                  {hiddenCount ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => saveHiddenColumns(new Set())}>Show all columns</DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          <FilterChips chips={chips} onClearAll={clearFilters} />

          {selectedEntries.length ? (
            <BulkBar count={selectedEntries.length} amount={`${formatCurrency(selectedNet)} net`}>
              {/* The header tick box ticks this page; this ticks every page the filters show. */}
              {filteredEntries.some((entry) => !selectedIds.has(entry.id)) ? (
                <BulkButton icon={CheckCheck} onClick={handleSelectAll}>
                  Select all {filteredEntries.length.toLocaleString('en-IN')}
                </BulkButton>
              ) : null}
              {canViewChecklist ? (
                <BulkButton icon={Printer} onClick={() => printChecklists(selectedEntries)}>
                  Print checklists
                </BulkButton>
              ) : null}
              {canExport ? (
                <BulkButton icon={Download} onClick={() => void exportEntries(selectedEntries, 'selected')} disabled={isExporting}>
                  Export
                </BulkButton>
              ) : null}
              <BulkButton icon={X} onClick={() => setSelectedIds(new Set())}>
                Clear
              </BulkButton>
            </BulkBar>
          ) : null}

          <TooltipProvider>
            <Register
              rows={paginatedEntries}
              columns={tableColumns}
              sort={{ key: sortKey, dir: sortDirection }}
              onSort={handleSort}
              selectable={canSelect}
              selected={selectedIds}
              onSelectedChange={setSelectedIds}
              onRowClick={handleViewDetails}
              rowTone={(entry) => (highValue(entry) ? 'high' : undefined)}
              totalLabel={
                <>
                  Total <span className={es.totalNote}>· {entriesWord(filteredEntries.length)}</span>
                </>
              }
              card={renderCard}
              empty={
                activeFilterCount ? (
                  <RegisterEmpty
                    icon={Search}
                    title="No entries match your filters"
                    action={
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        Clear all filters
                      </Button>
                    }
                  >
                    Try a different search, or clear the filters.
                  </RegisterEmpty>
                ) : (
                  <RegisterEmpty icon={Inbox} title="No entries yet">
                    {canAdd ? 'Receive an expense request with Add entry, or import a register.' : null}
                  </RegisterEmpty>
                )
              }
            />
          </TooltipProvider>

          <NumberedPager
            page={currentPage}
            pages={totalPages}
            total={filteredEntries.length}
            pageSize={itemsPerPage}
            onPage={setCurrentPage}
            onPageSize={setItemsPerPage}
          />
        </section>

        {/* More filters: a drawer, its choices shown as chips once set. */}
        <Sheet open={isMoreFiltersOpen} onOpenChange={setIsMoreFiltersOpen}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
            <SheetHeader className="border-b border-slate-100 px-5 py-4">
              <SheetTitle>More filters</SheetTitle>
              <SheetDescription>Applied to the register, its totals and the checklists you print from it.</SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <fieldset className="space-y-3">
                <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Date</legend>
                <DrawerInput
                  label="Reception date"
                  type="date"
                  value={dateFilter ? format(dateFilter, 'yyyy-MM-dd') : ''}
                  onChange={(event) => setDateFilter(event.target.value ? new Date(`${event.target.value}T00:00`) : undefined)}
                />
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Net amount (₹)</legend>
                <div className="grid grid-cols-2 gap-3">
                  <DrawerInput
                    label="From"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder="0"
                    value={amountMin}
                    onChange={(event) => setAmountMin(event.target.value)}
                  />
                  <DrawerInput
                    label="To"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder="Any"
                    value={amountMax}
                    onChange={(event) => setAmountMax(event.target.value)}
                  />
                </div>
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Payment</legend>
                <RadioGroup
                  value={paymentFilter || 'any'}
                  onValueChange={(value) => setPaymentFilter(value === 'any' ? '' : (value as PaymentFilter))}
                  className="gap-2.5"
                >
                  {(
                    [
                      ['any', 'Any'],
                      ['due', PAYMENT_LABELS.due],
                      ['paid', PAYMENT_LABELS.paid],
                    ] as const
                  ).map(([value, label]) => (
                    <div key={value} className="flex items-center gap-2">
                      <RadioGroupItem value={value} id={`payment-${value}`} />
                      <Label htmlFor={`payment-${value}`} className="font-normal">
                        {label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>
            </div>
            <SheetFooter className="flex-row justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <Button
                variant="outline"
                onClick={() => {
                  setDateFilter(undefined);
                  setAmountMin('');
                  setAmountMax('');
                  setPaymentFilter('');
                }}
              >
                Reset
              </Button>
              <Button onClick={() => setIsMoreFiltersOpen(false)}>Done</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.receptionNo || 'this entry'}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the entry.
              {deleteTarget?.depNo ? ` Its expense request ${deleteTarget.depNo} is released, so it can be received again.` : ''}{' '}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (target) void handleDeleteEntry(target);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmPrintAll} onOpenChange={setConfirmPrintAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Print {entriesWord(filteredEntries.length)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing is ticked, so this prints a checklist for every entry the filters show. To print only some, tick them in
              the register first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => printChecklists(filteredEntries)}>Print all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className={cn(ef.dlg, 'max-h-[92vh] bg-card p-0', addMode === 'multiple' ? 'sm:max-w-5xl' : 'sm:max-w-3xl')}>
          <div className={ef.head}>
            <span className={ef.headIcon} aria-hidden="true">
              <FilePlus />
            </span>
            <div className="min-w-0">
              <DialogTitleShad className={ef.title}>Add New Entry</DialogTitleShad>
              <DialogDescriptionShad className={ef.subtitle}>
                {addMode === 'single'
                  ? 'Receive an expense request into Daily Requisition.'
                  : 'Receive several expense requests at once — each becomes its own entry, numbered in DEP order.'}
              </DialogDescriptionShad>
            </div>
          </div>
          <div className={ef.bar}>
            <ModeSwitch value={addMode} onChange={setAddMode} pending={unassignedExpenseRequests.length} />
            <ReceptionPill value={(addMode === 'multiple' && multiPreview) || form.watch('receptionNo')} />
          </div>
          {addMode === 'multiple' ? (
            <ReceiveMultiplePanel
              requests={unassignedExpenseRequests}
              projects={projects}
              departments={departments}
              settings={moduleSettings}
              dateWindow={dateWindow}
              calendarDisabled={calendarDisabled}
              onPreview={setMultiPreview}
              onCancel={() => setIsAddDialogOpen(false)}
              onDone={(refreshOnly) => {
                if (!refreshOnly) setIsAddDialogOpen(false);
                fetchAllData();
              }}
            />
          ) : (
            (() => {
              // Sections number themselves, so one Field Control has emptied leaves no gap.
              let section = 0;
              const grossNow = Number(form.watch('grossAmount')) || 0;
              const netNow = Number(form.watch('netAmount')) || 0;
              const inWords = fields.netAmount.visible ? netNow : grossNow;
              const picked = unassignedExpenseRequests.find((req) => req.requestNo === form.watch('depNo'));
              const carried = picked?.statutory;
              const depOptions: DepOption[] = unassignedExpenseRequests.map((req) => ({
                id: req.id,
                requestNo: req.requestNo,
                party: req.partyName ?? '',
                project: projectNameById.get(req.projectId) ?? '',
                department: departmentNameById.get(req.departmentId) ?? '',
                description: req.description ?? '',
                amount: Number(req.statutory?.netPayable ?? req.amount) || 0,
              }));
              const save = (keepOpen: boolean) => form.handleSubmit((data) => handleAddEntry(data, keepOpen));
              const item = cn(ef.field, 'space-y-0');
              return (
                <Form {...form}>
                  <form
                    className={ef.pane}
                    noValidate
                    onSubmit={save(false)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        if (!isSaving) void save(false)();
                      }
                    }}
                  >
                    <div className={ef.body}>
                      <Section n={++section} title="Expense request">
                        <div className={cn(ef.grid, fields.depNo.visible ? ef.g3 : ef.g2)}>
                          {fields.depNo.visible && (
                            <FormField
                              control={form.control}
                              name="depNo"
                              render={({ field, fieldState }) => (
                                <FormItem className={item}>
                                  <FormLabel className={ef.label}>
                                    <LabelText required={dataControl.requireExpenseRequest || fields.depNo.required}>{fields.depNo.label}</LabelText>
                                  </FormLabel>
                                  <FormControl>
                                    <DepPicker
                                      options={depOptions}
                                      value={field.value}
                                      onChange={(value) => {
                                        form.clearErrors('depNo');
                                        handleDepNoSelect(value);
                                      }}
                                      placeholder="Select an expense request"
                                      formatAmount={formatCurrency}
                                    />
                                  </FormControl>
                                  {fieldState.error ? (
                                    <FormMessage className={ef.err} />
                                  ) : (
                                    <p className={ef.help}>{fields.depNo.helpText || 'Choosing a request fills in the details below'}</p>
                                  )}
                                </FormItem>
                              )}
                            />
                          )}
                          <FormField
                            control={form.control}
                            name="date"
                            render={({ field, fieldState }) => (
                              <FormItem className={item}>
                                <FormLabel className={ef.label}>
                                  <LabelText required={fields.receptionDate.required}>{fields.receptionDate.label}</LabelText>
                                </FormLabel>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <FormControl>
                                      <button type="button" className={ef.ctl} data-placeholder={field.value ? undefined : ''}>
                                        <CalendarIcon className={ef.ctlIcon} aria-hidden="true" />
                                        <span>{field.value ? format(field.value, 'dd MMM yyyy') : 'Pick a date'}</span>
                                      </button>
                                    </FormControl>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={calendarDisabled} defaultMonth={field.value} initialFocus />
                                  </PopoverContent>
                                </Popover>
                                {fieldState.error ? (
                                  <FormMessage className={ef.err} />
                                ) : dateWindowHint || fields.receptionDate.helpText ? (
                                  <p className={ef.help}>{fields.receptionDate.helpText || dateWindowHint}</p>
                                ) : null}
                              </FormItem>
                            )}
                          />
                          {fields.departmentId.visible && (
                            <FormField
                              control={form.control}
                              name="departmentId"
                              render={({ field, fieldState }) => (
                                <FormItem className={item}>
                                  <FormLabel className={ef.label}>
                                    <LabelText required={fields.departmentId.required} auto={autoFilled.has('departmentId')}>
                                      {fields.departmentId.label}
                                    </LabelText>
                                  </FormLabel>
                                  <Select
                                    value={field.value}
                                    onValueChange={(value) => {
                                      field.onChange(value);
                                      unmarkAuto('departmentId');
                                    }}
                                  >
                                    <FormControl>
                                      <SelectTrigger className={ef.ctl}>
                                        <SelectValue placeholder="Select department" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {departments.map((d) => (
                                        <SelectItem key={d.id} value={d.id}>
                                          {d.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {fieldState.error ? (
                                    <FormMessage className={ef.err} />
                                  ) : fields.departmentId.helpText ? (
                                    <p className={ef.help}>{fields.departmentId.helpText}</p>
                                  ) : null}
                                </FormItem>
                              )}
                            />
                          )}
                        </div>
                      </Section>

                      {(fields.partyName.visible || fields.projectId.visible) && (
                        <Section n={++section} title="Payee & project">
                          <div className={cn(ef.grid, ef.g2)}>
                            {fields.partyName.visible && (
                              <FormField
                                control={form.control}
                                name="partyName"
                                render={({ field, fieldState }) => (
                                  <FormItem className={item}>
                                    <FormLabel className={ef.label}>
                                      <LabelText required={fields.partyName.required} auto={autoFilled.has('partyName')}>
                                        {fields.partyName.label}
                                      </LabelText>
                                    </FormLabel>
                                    <FormControl>
                                      <input
                                        {...field}
                                        className={ef.ctl}
                                        placeholder="Who is being paid"
                                        autoComplete="off"
                                        onChange={(event) => {
                                          field.onChange(event);
                                          unmarkAuto('partyName');
                                        }}
                                      />
                                    </FormControl>
                                    {fieldState.error ? (
                                      <FormMessage className={ef.err} />
                                    ) : fields.partyName.helpText ? (
                                      <p className={ef.help}>{fields.partyName.helpText}</p>
                                    ) : null}
                                  </FormItem>
                                )}
                              />
                            )}
                            {fields.projectId.visible && (
                              <FormField
                                control={form.control}
                                name="projectId"
                                render={({ field, fieldState }) => (
                                  <FormItem className={item}>
                                    <FormLabel className={ef.label}>
                                      <LabelText required={fields.projectId.required} auto={autoFilled.has('projectId')}>
                                        {fields.projectId.label}
                                      </LabelText>
                                    </FormLabel>
                                    <Select
                                      value={field.value}
                                      onValueChange={(value) => {
                                        field.onChange(value);
                                        unmarkAuto('projectId');
                                      }}
                                    >
                                      <FormControl>
                                        <SelectTrigger className={ef.ctl}>
                                          <SelectValue placeholder="Select project" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {projects.map((p) => (
                                          <SelectItem key={p.id} value={p.id}>
                                            {p.projectName}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {fieldState.error ? (
                                      <FormMessage className={ef.err} />
                                    ) : fields.projectId.helpText ? (
                                      <p className={ef.help}>{fields.projectId.helpText}</p>
                                    ) : null}
                                  </FormItem>
                                )}
                              />
                            )}
                          </div>
                        </Section>
                      )}

                      {(fields.grossAmount.visible || fields.netAmount.visible || fields.description.visible) && (
                        <Section n={++section} title="Amount & purpose">
                          <div className={cn(ef.grid, ef.g2)}>
                            {fields.grossAmount.visible && (
                              <FormField
                                control={form.control}
                                name="grossAmount"
                                render={({ field, fieldState }) => (
                                  <FormItem className={item}>
                                    <FormLabel className={ef.label}>
                                      <LabelText required={fields.grossAmount.required} auto={autoFilled.has('grossAmount')}>
                                        {fields.grossAmount.label}
                                      </LabelText>
                                    </FormLabel>
                                    <div className={ef.money}>
                                      <span className={ef.moneySign} aria-hidden="true">
                                        ₹
                                      </span>
                                      <FormControl>
                                        <input
                                          ref={field.ref}
                                          name={field.name}
                                          value={field.value}
                                          onBlur={field.onBlur}
                                          onChange={(event) => handleGrossChange(event.target.value)}
                                          type="number"
                                          inputMode="decimal"
                                          min={0}
                                          step="0.01"
                                          placeholder="0.00"
                                          className={ef.ctl}
                                        />
                                      </FormControl>
                                    </div>
                                    {fieldState.error ? (
                                      <FormMessage className={ef.err} />
                                    ) : (
                                      <p className={ef.help}>{fields.grossAmount.helpText || 'The bill amount, before deductions'}</p>
                                    )}
                                  </FormItem>
                                )}
                              />
                            )}
                            {fields.netAmount.visible && (
                              <FormField
                                control={form.control}
                                name="netAmount"
                                render={({ field, fieldState }) => (
                                  <FormItem className={item}>
                                    <FormLabel className={ef.label}>
                                      <LabelText required={fields.netAmount.required} auto={autoFilled.has('netAmount')}>
                                        {fields.netAmount.label}
                                      </LabelText>
                                    </FormLabel>
                                    <div className={ef.money}>
                                      <span className={ef.moneySign} aria-hidden="true">
                                        ₹
                                      </span>
                                      <FormControl>
                                        <input
                                          {...field}
                                          onChange={(event) => {
                                            field.onChange(event);
                                            unmarkAuto('netAmount');
                                          }}
                                          type="number"
                                          inputMode="decimal"
                                          min={0}
                                          step="0.01"
                                          placeholder="0.00"
                                          className={ef.ctl}
                                        />
                                      </FormControl>
                                    </div>
                                    {fieldState.error ? (
                                      <FormMessage className={ef.err} />
                                    ) : (
                                      <p className={ef.help}>
                                        {!grossNow || !netNow || !fields.grossAmount.visible ? (
                                          fields.netAmount.helpText || 'What the bank pays the party'
                                        ) : netNow < grossNow ? (
                                          <span className={ef.helpAmber}>{formatCurrency(grossNow - netNow)} less than gross</span>
                                        ) : netNow > grossNow ? (
                                          <span className={ef.helpBlue}>{formatCurrency(netNow - grossNow)} more than gross</span>
                                        ) : (
                                          'Same as gross — nothing deducted'
                                        )}
                                      </p>
                                    )}
                                  </FormItem>
                                )}
                              />
                            )}
                            {fields.grossAmount.visible || fields.netAmount.visible ? (
                              <div className={cn(ef.note, ef.full)}>
                                <Info aria-hidden="true" />
                                <span>
                                  {fields.netAmount.visible ? 'Net' : 'Gross'} in words: <b>{inWords > 0 ? amountInWords(inWords) : '—'}</b>
                                </span>
                              </div>
                            ) : null}
                            {carried ? (
                              <div className={cn(ef.note, ef.noteGreen, ef.full)}>
                                <Receipt aria-hidden="true" />
                                <span>
                                  GST &amp; TDS from the request come with it
                                  {carried.invoiceNo ? ` · invoice ${carried.invoiceNo}` : ''}
                                  {carried.gstNo ? ` · GSTIN ${carried.gstNo}` : ''}
                                  {carried.gstAmount ? ` · GST ${formatCurrency(carried.gstAmount)}` : ''}
                                  {carried.tdsAmount ? ` · TDS ${formatCurrency(carried.tdsAmount)}` : ''} · net payable{' '}
                                  <b>{formatCurrency(carried.netPayable)}</b>
                                </span>
                              </div>
                            ) : null}
                            {fields.description.visible && (
                              <FormField
                                control={form.control}
                                name="description"
                                render={({ field, fieldState }) => (
                                  <FormItem className={cn(item, ef.full)}>
                                    <FormLabel className={ef.label}>
                                      <LabelText required={fields.description.required} auto={autoFilled.has('description')}>
                                        {fields.description.label}
                                      </LabelText>
                                    </FormLabel>
                                    <FormControl>
                                      <textarea
                                        {...field}
                                        rows={2}
                                        className={ef.ctl}
                                        placeholder="What the payment is for"
                                        onChange={(event) => {
                                          field.onChange(event);
                                          unmarkAuto('description');
                                        }}
                                      />
                                    </FormControl>
                                    {fieldState.error ? (
                                      <FormMessage className={ef.err} />
                                    ) : fields.description.helpText ? (
                                      <p className={ef.help}>{fields.description.helpText}</p>
                                    ) : null}
                                  </FormItem>
                                )}
                              />
                            )}
                          </div>
                        </Section>
                      )}

                      {fields.attachments.visible && (
                        <Section n={++section} title={fields.attachments.label} note={fields.attachments.required ? undefined : 'optional'}>
                          <FileDrop
                            id="attachments"
                            files={selectedFiles}
                            onAdd={addFiles}
                            onRemove={(index) => setSelectedFiles((current) => current.filter((_, i) => i !== index))}
                            invalid={Boolean(attachmentError)}
                            hint={
                              fields.attachments.helpText ||
                              `Bill, invoice or approval — drag and drop here${fields.attachments.required ? '. At least one file is needed.' : ''}`
                            }
                          />
                          {attachmentError ? <p className={cn(ef.err, 'mt-2')}>{attachmentError}</p> : null}
                        </Section>
                      )}
                    </div>

                    <div className={ef.foot}>
                      <KeyHint />
                      <span className={ef.footSpacer} />
                      <DialogClose asChild>
                        <button type="button" className={ef.btn}>
                          Cancel
                        </button>
                      </DialogClose>
                      <button type="button" className={ef.btn} disabled={isSaving} onClick={() => void save(true)()}>
                        Save &amp; add another
                      </button>
                      <button type="submit" className={cn(ef.btn, ef.btnPrimary)} disabled={isSaving}>
                        {isSaving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                        Add entry
                      </button>
                    </div>
                  </form>
                </Form>
              );
            })()
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