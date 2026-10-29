'use client';

import Link from 'next/link';
import React, { Suspense, useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  MoreHorizontal,
  ShieldAlert,
  RotateCcw,
  XCircle,
  Check,
  Loader2,
  AlertTriangle,
  Download,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableCard } from '@/components/shared/table-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
// Bill Tracking's filter toolbar, so this list filters exactly like the Bill Register.
import { BtToolbar, DrawerInput, DrawerSelect, ToolbarSelect } from '@/components/bill-tracking/bt-toolbar';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  Timestamp,
  query,
  where,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { DailyRequisitionEntry, Department, Project, User, WorkflowStep } from '@/lib/types';
import { formatINRCompact } from '@/lib/bill-tracking/money';
import { cn } from '@/lib/utils';
import { balanceOf, isPaymentLocked, paidOf, payRequisitionsHref, voucherHref } from '@/lib/requisition-progress';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { diffFields, type FieldChange } from '@/lib/activity-logger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { format } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { GstTdsVerificationDialog } from '@/components/daily-requisition/GstTdsVerificationDialog';
import {
  dailyPageContainerClass,
  dailyQueueStatClass,
  dailyQueueTabClass,
  dailyQueueTabListClass,
  dailySurfaceCardClass,
} from '@/components/daily-requisition/module-shell';
import { PageHeader } from '@/components/shared/page-header';
import { dailyStepSlug } from '@/lib/daily-requisition-settings';

/* ──────────────────── helpers ──────────────────── */

/**
 * The slug a stage is reached at. One definition (src/lib/daily-requisition-settings.ts), shared
 * with the menus and Workflow Configuration — a second copy here is one stage rename away from a
 * page the menu links to but this function cannot resolve.
 */
const toSlug = dailyStepSlug;

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

// A stage list's rows: striped like Bill Tracking's registers, a ticked row tinted green instead of
// striped. Plain and hover: classes, so the dark theme's compat layer remaps them.
const STRIPED_ROW = 'border-slate-100 even:bg-slate-50 hover:bg-emerald-50';
const SELECTED_ROW = 'border-slate-100 bg-emerald-50';


const DAY_MS = 24 * 60 * 60 * 1000;
/** A requisition waiting longer than this at a stage is overdue. */
const OVERDUE_DAYS = 30;
/** The Age filter's choices: waiting more than this many days. */
const AGE_OPTIONS = [7, 15, 30, 60, 90];

/** The selection bar's tint, mixed into the card colour so it stays solid in the dark theme too. */
const SELECTION_BAR = 'bg-[color-mix(in_srgb,theme(colors.emerald.500)_8%,hsl(var(--card)))]';
/** A keyboard shortcut's key, on a button or in the search box. */
const KBD = 'rounded border px-1.5 font-mono text-[11px] leading-4';

/** The Indian financial year (April–March) a day falls in, by the year it starts. */
const fyStartOf = (date: Date) => (date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1);
/** "FY 26-27". */
const fyLabel = (start: number) => `FY ${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const asDate = (value: unknown): Date | undefined => {
  const maybe = value as { toDate?: () => Date } | null | undefined;
  if (maybe && typeof maybe.toDate === 'function') return maybe.toDate();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
};

/**
 * How long a stage's queue has waited, as a ring: up to a week in green, then amber to a month,
 * overdue in red. Saturated colours, legible on either theme; the figures are also given in text.
 */
function WaitRing({ fresh, aging, overdue }: { fresh: number; aging: number; overdue: number }) {
  const total = fresh + aging + overdue;
  // r = 100 / 2π: the circumference is 100, so a share is its own dash length.
  const r = 15.9155;
  let offset = 25; // start at the top
  const arcs = [
    { value: fresh, color: '#14b8a6' },
    { value: aging, color: '#f59e0b' },
    { value: overdue, color: '#ef4444' },
  ]
    .filter((arc) => arc.value > 0)
    .map((arc) => {
      const share = total ? (arc.value / total) * 100 : 0;
      const out = { ...arc, share, offset };
      offset -= share;
      return out;
    });
  return (
    <svg viewBox="0 0 36 36" className="h-11 w-11 shrink-0" aria-hidden="true">
      <circle cx="18" cy="18" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="4.5" />
      {arcs.map((arc) => (
        <circle
          key={arc.color}
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke={arc.color}
          strokeWidth="4.5"
          strokeDasharray={`${arc.share} ${100 - arc.share}`}
          strokeDashoffset={arc.offset}
        />
      ))}
    </svg>
  );
}

/** Whether the list is in step with the database right now. */
function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        live ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600',
      )}
      title={live ? 'Changes made by anyone show here as they happen.' : 'Not connected — the list may be out of date.'}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'animate-pulse bg-emerald-500' : 'bg-slate-400')} aria-hidden="true" />
      {live ? 'Live' : 'Offline'}
    </span>
  );
}

/**
 * Only a requisition awaiting payment with nothing paid on it yet can be marked Paid by hand. Once a
 * voucher has paid part of it, the rest has to be paid by voucher too.
 */
const isManuallyPayable = (entry: Pick<DailyRequisitionEntry, 'status' | 'paidAmount' | 'payments'>) =>
  entry.status === 'Received for Payment' && !isPaymentLocked(entry);

/** Requisitions per transaction. Each can write itself and its expense request, within the limit of 500. */
const MOVE_CHUNK = 200;

/** Reception Nos for an activity log's record reference: the first few, then how many more. */
const REF_CAP = 10;
const refList = (receptionNos: string[]) =>
  receptionNos.length > REF_CAP
    ? `${receptionNos.slice(0, REF_CAP).join(', ')} +${receptionNos.length - REF_CAP} more`
    : receptionNos.join(', ');

/** An expense request's `receptionDate` (`yyyy-MM-dd`) for a requisition, as the entry sheet writes it. */
function receptionDateOf(entry: { date?: unknown; createdAt?: unknown }): string {
  const asDate = (value: any): Date | null =>
    value?.toDate instanceof Function
      ? value.toDate()
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null;
  const date = asDate(entry.date) ?? asDate(entry.createdAt);
  return format(date && !Number.isNaN(date.getTime()) ? date : new Date(), 'yyyy-MM-dd');
}

interface MoveOptions {
  /** Extra fields, worked out from the requisition as it stands when the write happens. */
  fields?: (current: DailyRequisitionEntry) => Record<string, unknown>;
  /** Leave alone any requisition with money paid against it. Used when sending back or cancelling. */
  refusePaid?: boolean;
  /** Cancelling frees the linked expense request. Returning a cancelled requisition takes it back. */
  expenseLink?: 'release' | 'restore';
  /** Added to the activity log's details. */
  logDetails?: Record<string, string | number | boolean>;
}

/** What a move did to one requisition, for its own audit log row. */
interface MovedRecord {
  entry: EnrichedEntry;
  /** Its status as the transaction read it. */
  from: string;
  /** Fields besides status the move rewrote (e.g. a cleared verification), as from/to. */
  changes: Record<string, FieldChange>;
  requestsReleased: number;
  requestsRelinked: number;
}

interface MoveSkips {
  /** Money has been paid against it. */
  paid: number;
  /** Its status changed after this page loaded, or it is gone. */
  changed: number;
  /** A cancelled entry whose expense request has since been received as another requisition. */
  reReceived: number;
  /** For the toast: the last such request, and the Reception No it is linked to now. */
  reReceivedAs?: { depNo: string; receptionNo: string };
}

/** The toast after a move: what moved, and how many were skipped and why. */
function moveToast(
  targets: Array<{ receptionNo: string }>,
  movedCount: number,
  to: string,
  skipped: MoveSkips,
  failed: boolean,
): { title: string; description: string; variant?: 'destructive' } {
  const skippedCount = skipped.paid + skipped.changed + skipped.reReceived;

  // A single row that was refused: name it and say why.
  if (targets.length === 1 && skippedCount === 1) {
    const no = targets[0].receptionNo;
    const description = skipped.paid
      ? `${no} has payments against it, so it was left as it is. Reverse its voucher in the Bank Balance Cheque Register first.`
      : skipped.reReceived
        ? skipped.reReceivedAs
          ? `DEP ${skipped.reReceivedAs.depNo} was received again as ${skipped.reReceivedAs.receptionNo} — cannot restore ${no}.`
          : `${no} can't be reopened: its expense request has been received again as another requisition.`
        : `${no} was left as it is: it changed after this page loaded.`;
    return { title: 'Not updated', description, variant: 'destructive' };
  }

  const reasons = [
    skipped.paid ? `${skipped.paid} with payments against ${skipped.paid === 1 ? 'it' : 'them'} (reverse the voucher in the Cheque Register first)` : '',
    skipped.changed ? `${skipped.changed} changed after this page loaded` : '',
    skipped.reReceived ? `${skipped.reReceived} whose expense request has been received again` : '',
  ].filter(Boolean);
  const skippedText = skippedCount > 0 ? `Skipped ${skippedCount}: ${reasons.join('; ')}.` : '';
  const movedText =
    movedCount === 0
      ? ''
      : targets.length === 1
        ? `${targets[0].receptionNo} updated to "${to}".`
        : `${movedCount} ${movedCount === 1 ? 'entry' : 'entries'} updated to "${to}".`;
  const sentence = (...parts: string[]) => parts.filter(Boolean).join(' ');

  if (failed) {
    return {
      title: 'Error',
      description: sentence('Failed to update entries.', movedCount > 0 ? `${movedCount} were updated before the error.` : '', skippedText),
      variant: 'destructive',
    };
  }
  if (movedCount === 0) return { title: 'Nothing updated', description: skippedText, variant: 'destructive' };
  return { title: skippedCount > 0 ? 'Partly updated' : 'Success', description: sentence(movedText, skippedText) };
}

function StepPageSkeleton() {
  return (
    <div className={`${dailyPageContainerClass} space-y-3`}>
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-9 w-full sm:w-96" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

/* ──────────────────── tab / status config per step position ──────────────────── */

interface TabDef {
  key: string;
  label: string;
  statuses: string[];
  showBulkCheckbox?: boolean;
}

interface StepConfig {
  queryStatuses: string[];
  tabs: TabDef[];
  bulkAction?: {
    tabKey: string;
    label: string;
    newStatus: string;
    extraFields?: Record<string, any>;
    /** The key that runs it on the selection (lower case). */
    shortcut: string;
  };
  /** What "done today" means at this stage, beside the tabs. */
  doneTodayLabel: string;
  /** Step descriptions shown in the page header */
  description: string;
  /** Metric hints per tab index */
  metricHints: string[];
}

/**
 * Returns the status config for a dynamic step position.
 * `dynamicIndex` is 0-based starting from the **first dynamic step** (Entry Sheet is excluded).
 */
function getStepConfig(dynamicIndex: number): StepConfig {
  switch (dynamicIndex) {
    case 0: // e.g., "Receiving at Finance"
      return {
        queryStatuses: ['Pending', 'Received', 'Cancelled'],
        tabs: [
          { key: 'pending', label: 'Pending', statuses: ['Pending'], showBulkCheckbox: true },
          { key: 'received', label: 'Received', statuses: ['Received'] },
          { key: 'cancelled', label: 'Cancelled', statuses: ['Cancelled'] },
        ],
        bulkAction: { tabKey: 'pending', label: 'Mark as Received', newStatus: 'Received', shortcut: 'r' },
        doneTodayLabel: 'Received today',
        description: 'Receive incoming entries, keep exceptions visible, and pass the right set forward to verification.',
        metricHints: ['Waiting to be received', 'Ready for verification', 'Requires follow-up'],
      };
    case 1: // e.g., "GST & TDS Verification"
      return {
        queryStatuses: ['Received', 'Verified', 'Needs Review'],
        tabs: [
          { key: 'pending', label: 'Pending Verification', statuses: ['Received'] },
          { key: 'verified', label: 'Verified', statuses: ['Verified'], showBulkCheckbox: true },
          { key: 'needs-review', label: 'Needs Review', statuses: ['Needs Review'] },
        ],
        bulkAction: { tabKey: 'verified', label: 'Send for Payment', newStatus: 'Received for Payment', shortcut: 's' },
        doneTodayLabel: 'Verified today',
        description: 'Validate deductions, rework mismatches, and hand verified entries to the payment stage.',
        metricHints: ['Awaiting verification', 'Ready for payment', 'Mismatch or follow-up required'],
      };
    case 2: // e.g., "Processed for Payment"
      return {
        queryStatuses: ['Received for Payment', 'Partially Paid', 'Paid'],
        tabs: [
          // 'Partially Paid' is set by Bank Balance payment vouchers; the rest is still due, so it stays pending.
          { key: 'pending', label: 'Pending', statuses: ['Received for Payment', 'Partially Paid'], showBulkCheckbox: true },
          { key: 'paid', label: 'Paid', statuses: ['Paid'] },
        ],
        bulkAction: { tabKey: 'pending', label: 'Mark as Paid', newStatus: 'Paid', shortcut: 'p' },
        doneTodayLabel: 'Paid today',
        description: 'Manage verified entries that are waiting for final payment and keep paid items visible for traceability.',
        metricHints: ['Awaiting final confirmation', 'Completed disbursements'],
      };
    default:
      return {
        queryStatuses: ['Pending'],
        tabs: [{ key: 'all', label: 'All Entries', statuses: ['Pending'] }],
        doneTodayLabel: 'Done today',
        description: 'View and manage entries at this workflow stage.',
        metricHints: ['Total entries'],
      };
  }
}

/* ──────────────────── enriched entry type ──────────────────── */

type EnrichedEntry = DailyRequisitionEntry & {
  id: string;
  projectName: string;
  departmentName: string;
  receivedByName?: string;
  dateText: string;
  /** Its date as a local yyyy-MM-dd, for the date filter; '' without one. */
  dateKey: string;
  receivedAtText?: string;
  verifiedAtText?: string;
  paidAtText?: string;
  /** Whole days it has waited at this stage — since its date, receipt or verification — or null. */
  ageDays: number | null;
  /** The financial year its date falls in, by the year it starts; null without a date. */
  fyStart: number | null;
  /** When this stage's own step was done today (received, verified, paid). */
  doneToday: boolean;
};

/** Names for the ids a requisition carries. */
interface Lookups {
  projects: Map<string, string>;
  departments: Map<string, string>;
  users: Map<string, string>;
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */

function DynamicWorkflowStepContent() {
  const params = useParams();
  const stepSlug = (params?.step as string) ?? '';
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);

  /* ── workflow state ── */
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [currentStep, setCurrentStep] = useState<WorkflowStep | null>(null);
  const [dynamicIndex, setDynamicIndex] = useState<number>(-1);
  const [workflowLoading, setWorkflowLoading] = useState(true);
  const [workflowNotFound, setWorkflowNotFound] = useState(false);

  /* ── entries state ── */
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [requisitionDocs, setRequisitionDocs] = useState<QueryDocumentSnapshot[] | null>(null);
  /** In step with the database right now (not from the offline cache) — the Live badge. */
  const [isLive, setIsLive] = useState(false);
  const [today] = useState(() => startOfDay(new Date()));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isUpdating, setIsUpdating] = useState(false);
  const [isMarkPaidOpen, setIsMarkPaidOpen] = useState(false);
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState('');

  /* ── filters ── */
  const [fyFilter, setFyFilter] = useState('all');
  const [ageFilter, setAgeFilter] = useState<number | null>(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  // Behind "More filters": the requisition's date range and its net amount.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [isMoreFiltersOpen, setIsMoreFiltersOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // A `?q=` in the URL, from a link in another module, fills the search. A later link to this page
  // with a different `?q=` replaces it. This is adjusted during render, not in an effect.
  const urlQuery = searchParams?.get('q') ?? '';
  const [searchTerm, setSearchTerm] = useState(urlQuery);
  const [appliedUrlQuery, setAppliedUrlQuery] = useState(urlQuery);
  if (appliedUrlQuery !== urlQuery) {
    setAppliedUrlQuery(urlQuery);
    setSearchTerm(urlQuery);
  }

  /* ── GST dialog state ── */
  const [isVerifyDialogOpen, setIsVerifyDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<EnrichedEntry | null>(null);

  const stepConfig = useMemo(() => (dynamicIndex >= 0 ? getStepConfig(dynamicIndex) : null), [dynamicIndex]);

  /* ── permission scope ── */
  const permissionScope = currentStep ? `Daily Requisition.${currentStep.name}` : '';
  const canViewPage = permissionScope ? can('View', permissionScope) : false;

  /* ──────────── 1 ─ fetch workflow config ──────────── */
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'workflows', 'daily-requisition-workflow'));
        if (snap.exists()) {
          const data = snap.data();
          const steps: WorkflowStep[] = data.steps || [];
          setWorkflowSteps(steps);

          // Find the matching step by slug — all config steps are dynamic stages
          const idx = steps.findIndex((s) => toSlug(s.name) === stepSlug);
          if (idx >= 0) {
            setCurrentStep(steps[idx]);
            setDynamicIndex(idx); // 0-based dynamic index
          } else {
            setWorkflowNotFound(true);
          }
        } else {
          setWorkflowNotFound(true);
        }
      } catch (err) {
        console.error('Error loading workflow config:', err);
        setWorkflowNotFound(true);
      }
      setWorkflowLoading(false);
    })();
  }, [stepSlug]);

  /* ──────────── 2 ─ entries, live ──────────── */

  const canLoad = !workflowLoading && !isAuthLoading && canViewPage && Boolean(stepConfig);

  // Names for projects, departments and users, read once.
  useEffect(() => {
    if (!canLoad) return;
    let active = true;
    (async () => {
      try {
        const [projectsSnap, departmentsSnap, usersSnap] = await Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'departments')),
          getDocs(collection(db, 'users')),
        ]);
        if (!active) return;
        setLookups({
          projects: new Map(projectsSnap.docs.map((d) => [d.id, (d.data() as Project).projectName])),
          departments: new Map(departmentsSnap.docs.map((d) => [d.id, (d.data() as Department).name])),
          users: new Map(
            usersSnap.docs.map((d) => {
              const u = d.data() as User;
              return [d.id, u.name || u.email || d.id];
            }),
          ),
        });
      } catch (error) {
        console.error('Error loading names:', error);
        // The list still shows, with ids where names would be.
        if (active) setLookups({ projects: new Map(), departments: new Map(), users: new Map() });
      }
    })();
    return () => {
      active = false;
    };
  }, [canLoad]);

  // The stage's requisitions, live: a change anyone makes — here, on the Entry Sheet, or a voucher
  // in Bank Balance — shows without a reload. Metadata changes too, so the badge knows when the
  // list is only the offline cache.
  useEffect(() => {
    if (!canLoad || !stepConfig) return;
    const statuses = stepConfig.queryStatuses;
    const source =
      statuses.length <= 10
        ? query(collection(db, 'dailyRequisitions'), where('status', 'in', statuses))
        : collection(db, 'dailyRequisitions');
    return onSnapshot(
      source,
      { includeMetadataChanges: true },
      (snap) => {
        setRequisitionDocs(snap.docs);
        setIsLive(!snap.metadata.fromCache);
      },
      (error) => {
        console.error('Error fetching entries:', error);
        setIsLive(false);
        setRequisitionDocs((current) => current ?? []);
        if (error.code === 'failed-precondition') {
          toast({
            title: 'Database Index Required',
            description: 'This query requires a composite index. Check your Firebase console.',
            variant: 'destructive',
            duration: 10000,
          });
        } else {
          toast({ title: 'Error', description: 'Failed to fetch entries.', variant: 'destructive' });
        }
      },
    );
  }, [canLoad, stepConfig, toast]);

  const isLoading = canLoad && (!requisitionDocs || !lookups);

  const entries = useMemo<EnrichedEntry[]>(() => {
    if (!requisitionDocs || !lookups || !stepConfig) return [];
    const queryStatuses = stepConfig.queryStatuses;
    const todayMs = today.getTime();
    const isToday = (date: Date | undefined) => Boolean(date) && startOfDay(date as Date).getTime() === todayMs;

    const data: EnrichedEntry[] = requisitionDocs
      .filter((d) => queryStatuses.includes((d.data() as any).status))
      .map((d) => {
        const raw = d.data() as DailyRequisitionEntry;
        const dateTs = asDate(raw.date) ?? asDate(raw.createdAt);
        const receivedAtTs = asDate(raw.receivedAt);
        const verifiedAtTs = asDate(raw.verifiedAt);
        const paidAtTs = asDate(raw.paidAt) ?? asDate(raw.lastPaidAt);

        // How long it has waited at this stage: since its date at Receiving, since it was received at
        // Verification, since it was verified at Payment.
        const since = dynamicIndex === 0 ? dateTs : dynamicIndex === 1 ? receivedAtTs ?? dateTs : verifiedAtTs ?? receivedAtTs ?? dateTs;
        const doneAt = dynamicIndex === 0 ? receivedAtTs : dynamicIndex === 1 ? verifiedAtTs : paidAtTs;

        return {
          ...raw,
          id: d.id,
          projectName: lookups.projects.get(raw.projectId) || 'N/A',
          departmentName: lookups.departments.get(raw.departmentId) || raw.departmentId || '(No department)',
          receivedByName: raw.receivedById ? lookups.users.get(raw.receivedById) : undefined,
          dateText: dateTs ? format(dateTs, 'dd MMM, yyyy') : raw.date ? String(raw.date) : '',
          dateKey: dateTs ? format(dateTs, 'yyyy-MM-dd') : '',
          receivedAtText: receivedAtTs ? format(receivedAtTs, 'PPpp') : undefined,
          verifiedAtText: verifiedAtTs ? format(verifiedAtTs, 'PPpp') : undefined,
          paidAtText: asDate(raw.paidAt) ? format(asDate(raw.paidAt) as Date, 'dd MMM, yyyy HH:mm') : undefined,
          ageDays: since ? Math.max(0, Math.round((todayMs - startOfDay(since).getTime()) / DAY_MS)) : null,
          fyStart: dateTs ? fyStartOf(dateTs) : null,
          doneToday: isToday(doneAt),
        };
      });

    // Most recent first: paid, verified, received or created, whichever is latest to have happened.
    const latest = (entry: EnrichedEntry) =>
      (asDate(entry.paidAt) ?? asDate(entry.verifiedAt) ?? asDate(entry.receivedAt) ?? asDate(entry.createdAt))?.getTime() ?? 0;
    data.sort((a, b) => latest(b) - latest(a));
    return data;
  }, [requisitionDocs, lookups, stepConfig, dynamicIndex, today]);

  /* ──────────── 3 ─ what each tab shows ──────────── */

  // The FY picker scopes the whole page: the tabs, their figures and the header's.
  const scoped = useMemo(
    () => (fyFilter === 'all' ? entries : entries.filter((entry) => String(entry.fyStart) === fyFilter)),
    [entries, fyFilter],
  );
  const fyOptions = useMemo(
    () => [...new Set(entries.map((entry) => entry.fyStart).filter((fy): fy is number => fy !== null))].sort((a, b) => b - a),
    [entries],
  );
  // The projects and departments the stage holds, for Add filter.
  const projectOptions = useMemo(
    () =>
      [...new Map(scoped.map((entry) => [entry.projectId, entry.projectName])).entries()]
        .filter(([id]) => Boolean(id))
        .sort((a, b) => a[1].localeCompare(b[1])),
    [scoped],
  );
  const departmentOptions = useMemo(
    () =>
      [...new Map(scoped.map((entry) => [entry.departmentId, entry.departmentName])).entries()]
        .filter(([id]) => Boolean(id))
        .sort((a, b) => a[1].localeCompare(b[1])),
    [scoped],
  );

  const tabEntries = useMemo(() => {
    if (!stepConfig) return {};
    const map: Record<string, EnrichedEntry[]> = {};
    const t = searchTerm.trim().toLowerCase();
    const min = minAmount === '' ? null : Number(minAmount);
    const max = maxAmount === '' ? null : Number(maxAmount);
    const passesFilters = (entry: EnrichedEntry) =>
      (ageFilter === null || (entry.ageDays ?? 0) > ageFilter) &&
      (!projectFilter || entry.projectId === projectFilter) &&
      (!departmentFilter || entry.departmentId === departmentFilter) &&
      // An undated requisition only shows while no date range is set.
      (!dateFrom || (Boolean(entry.dateKey) && entry.dateKey >= dateFrom)) &&
      (!dateTo || (Boolean(entry.dateKey) && entry.dateKey <= dateTo)) &&
      (min === null || Number.isNaN(min) || (Number(entry.netAmount) || 0) >= min) &&
      (max === null || Number.isNaN(max) || (Number(entry.netAmount) || 0) <= max);

    stepConfig.tabs.forEach((tab) => {
      map[tab.key] = scoped.filter(
        (entry) =>
          tab.statuses.includes(entry.status) &&
          passesFilters(entry) &&
          ((entry.receptionNo || '').toLowerCase().includes(t) ||
            // The Expenses request no., so a link from a request finds its requisition.
            (entry.depNo || '').toLowerCase().includes(t) ||
            entry.projectName.toLowerCase().includes(t) ||
            (entry.partyName || '').toLowerCase().includes(t) ||
            (entry.receivedByName || '').toLowerCase().includes(t) ||
            (entry.payments ?? []).some((payment) => (payment.voucherNo || '').toLowerCase().includes(t)))
      );
    });
    return map;
  }, [scoped, stepConfig, searchTerm, ageFilter, projectFilter, departmentFilter, dateFrom, dateTo, minAmount, maxAmount]);

  // The open tab: the first until one is chosen.
  const tabValue = stepConfig?.tabs.some((tab) => tab.key === activeTab) ? activeTab : (stepConfig?.tabs[0]?.key ?? '');
  const openTab = stepConfig?.tabs.find((tab) => tab.key === tabValue);
  const visibleEntries = useMemo(() => tabEntries[tabValue] ?? [], [tabEntries, tabValue]);

  /* ──────────── 4 ─ action handlers ──────────── */

  /** The ticked rows the list shows. A bulk action takes only these — never a row a filter hides. */
  const selectedEntries = useMemo(() => visibleEntries.filter((entry) => selectedIds.has(entry.id)), [visibleEntries, selectedIds]);
  /** The selected rows Mark as Paid would take. Part-paid ones stay selectable for Pay via voucher. */
  const markPaidTargets = useMemo(() => selectedEntries.filter(isManuallyPayable), [selectedEntries]);

  /** Fields a move to `status` always stamps. */
  const stampFor = (status: string): Record<string, unknown> => {
    if (status === 'Received') return { receivedAt: Timestamp.now(), receivedById: user?.id ?? null };
    if (status === 'Paid') return { paidAt: Timestamp.now() };
    if (status === 'Pending') return { receivedAt: null, receivedById: null };
    return {};
  };

  /** The expense requests these requisitions were raised from (`requestNo` = `depNo`), by depNo. */
  const expenseRequestsFor = async (targets: EnrichedEntry[]) => {
    const depNos = [...new Set(targets.map((entry) => entry.depNo).filter((depNo) => Boolean(depNo?.trim())))];
    const snaps = await Promise.all(
      depNos.map((depNo) => getDocs(query(collection(db, 'expenseRequests'), where('requestNo', '==', depNo)))),
    );
    return new Map<string, DocumentReference[]>(depNos.map((depNo, i) => [depNo, snaps[i].docs.map((d) => d.ref)]));
  };

  /**
   * Every status change on this page goes through here. Each requisition is re-read inside a
   * transaction, so an out-of-date page can't overwrite what has happened since it loaded. A
   * requisition whose status has changed is left alone. With `refusePaid`, so is one with money paid
   * against it, since a voucher may have paid it in the meantime. The toast says how many were
   * skipped and why, and the move is written to the activity log.
   */
  const moveRequisitions = async (targets: EnrichedEntry[], to: string, options: MoveOptions = {}) => {
    if (targets.length === 0 || isUpdating) return;
    setIsUpdating(true);
    const moved: EnrichedEntry[] = [];
    const movedRecords: MovedRecord[] = [];
    const skipped: MoveSkips = { paid: 0, changed: 0, reReceived: 0 };
    const requests = { released: 0, relinked: 0 };
    let failed = false;
    try {
      const requestsByDepNo = options.expenseLink
        ? await expenseRequestsFor(targets)
        : new Map<string, DocumentReference[]>();

      for (let start = 0; start < targets.length; start += MOVE_CHUNK) {
        const chunk = targets.slice(start, start + MOVE_CHUNK);
        const result = await runTransaction(db, async (tx) => {
          const out = {
            moved: [] as EnrichedEntry[],
            records: [] as MovedRecord[],
            paid: 0,
            changed: 0,
            reReceived: 0,
            reReceivedAs: undefined as MoveSkips['reReceivedAs'],
            released: 0,
            relinked: 0,
          };

          // Every read comes before any write, as a transaction requires.
          const requisitionSnaps = await Promise.all(chunk.map((entry) => tx.get(doc(db, 'dailyRequisitions', entry.id))));
          const requestRefs = new Map<string, DocumentReference>();
          chunk.forEach((entry) => (requestsByDepNo.get(entry.depNo) ?? []).forEach((ref) => requestRefs.set(ref.path, ref)));
          const requestSnaps = await Promise.all([...requestRefs.values()].map((ref) => tx.get(ref)));
          // Each expense request's Reception No, as this transaction leaves it.
          const linkOf = new Map<string, string>();
          requestSnaps.forEach((snap) => {
            if (snap.exists()) linkOf.set(snap.ref.path, String(snap.data().receptionNo ?? '').trim());
          });

          chunk.forEach((entry, i) => {
            const snap = requisitionSnaps[i];
            const current = snap.exists() ? (snap.data() as DailyRequisitionEntry) : null;
            if (!current || current.status !== entry.status) {
              out.changed += 1;
              return;
            }
            if (options.refusePaid && isPaymentLocked(current)) {
              out.paid += 1;
              return;
            }

            const receptionNo = (current.receptionNo || '').trim();
            const linkedRequests = (requestsByDepNo.get(entry.depNo) ?? []).filter((ref) => linkOf.has(ref.path));
            const requestUpdates: Array<[DocumentReference, { receptionNo: string; receptionDate: string }]> = [];
            if (options.expenseLink === 'release') {
              linkedRequests
                .filter((ref) => linkOf.get(ref.path) === receptionNo)
                .forEach((ref) => requestUpdates.push([ref, { receptionNo: '', receptionDate: '' }]));
            } else if (options.expenseLink === 'restore' && linkedRequests.length > 0) {
              const links = linkedRequests.map((ref) => linkOf.get(ref.path) ?? '');
              if (!links.includes(receptionNo)) {
                // Received again as another requisition since this one was cancelled. Reopening
                // this one would give the request two live requisitions.
                if (links.some(Boolean)) {
                  out.reReceived += 1;
                  out.reReceivedAs = { depNo: entry.depNo, receptionNo: links.find(Boolean) ?? '' };
                  return;
                }
                requestUpdates.push([linkedRequests[0], { receptionNo, receptionDate: receptionDateOf(current) }]);
              }
            }

            const extraFields = options.fields?.(current) ?? {};
            const update: Record<string, any> = { status: to, ...stampFor(to), ...extraFields };
            tx.update(snap.ref, update);
            let released = 0;
            let relinked = 0;
            requestUpdates.forEach(([ref, data]) => {
              tx.update(ref, data);
              linkOf.set(ref.path, data.receptionNo);
              if (data.receptionNo) relinked += 1;
              else released += 1;
            });
            out.released += released;
            out.relinked += relinked;
            out.moved.push(entry);
            out.records.push({
              entry,
              from: current.status ?? '',
              changes: diffFields(current as Record<string, any>, extraFields as Record<string, any>),
              requestsReleased: released,
              requestsRelinked: relinked,
            });
          });
          return out;
        });

        moved.push(...result.moved);
        movedRecords.push(...result.records);
        skipped.paid += result.paid;
        skipped.changed += result.changed;
        skipped.reReceived += result.reReceived;
        if (result.reReceivedAs) skipped.reReceivedAs = result.reReceivedAs;
        requests.released += result.released;
        requests.relinked += result.relinked;
      }
    } catch (error) {
      console.error('Error updating entries:', error);
      failed = true;
    }

    const skippedCount = skipped.paid + skipped.changed + skipped.reReceived;
    // One row per requisition, so each record's history shows its own move; a multi-entry move
    // also gets one summary row (no recordId) saying what the bulk action was.
    movedRecords.forEach((record) => {
      void log(
        'Update Requisition Status',
        {
          step: currentStep?.name ?? '',
          receptionNo: record.entry.receptionNo ?? null,
          partyName: record.entry.partyName ?? null,
          from: record.from,
          to,
          ...(movedRecords.length > 1 ? { bulk: true, batchCount: movedRecords.length } : {}),
          ...(Object.keys(record.changes).length > 0 ? { changes: record.changes } : {}),
          ...(record.requestsReleased > 0 ? { expenseRequestsReleased: record.requestsReleased } : {}),
          ...(record.requestsRelinked > 0 ? { expenseRequestsRelinked: record.requestsRelinked } : {}),
          ...(options.logDetails ?? {}),
        },
        { recordId: record.entry.id, recordRef: record.entry.receptionNo || undefined },
      );
    });
    if (moved.length > 1) {
      void log(
        'Bulk Update Requisition Status',
        {
          step: currentStep?.name ?? '',
          from: [...new Set(movedRecords.map((record) => record.from))].join(' / '),
          to,
          count: moved.length,
          receptionNos: moved.map((entry) => entry.receptionNo || entry.id),
          ...(skippedCount > 0 ? { skipped: skippedCount } : {}),
          ...(requests.released > 0 ? { expenseRequestsReleased: requests.released } : {}),
          ...(requests.relinked > 0 ? { expenseRequestsRelinked: requests.relinked } : {}),
          ...(options.logDetails ?? {}),
        },
        { recordRef: refList(moved.map((entry) => entry.receptionNo)) },
      );
    }

    toast(moveToast(targets, moved.length, to, skipped, failed));
    setSelectedIds(new Set());
    setIsUpdating(false);
    // No reload: the live list already shows the move.
  };

  /** The step's bulk action (Mark as Received, Send for Payment) on the selected rows of its tab. */
  const handleBulkAction = () => {
    const bulk = stepConfig?.bulkAction;
    if (!bulk) return;
    const tab = stepConfig.tabs.find((t) => t.key === bulk.tabKey);
    void moveRequisitions(selectedEntries.filter((entry) => tab?.statuses.includes(entry.status)), bulk.newStatus);
  };

  /** Manual Mark as Paid, once confirmed: paid outside Bank Balance, so no bank entry is made. */
  const handleMarkPaid = () =>
    void moveRequisitions(markPaidTargets, 'Paid', {
      refusePaid: true,
      fields: (current) => ({
        paidAmount: Number(current.netAmount) || 0,
        manualPaid: true,
        paidById: user?.id ?? null,
        paidByName: user?.name ?? null,
      }),
      logDetails: { manualPaid: true },
    });

  /** Receiving at Finance: return a received or cancelled entry to Pending. */
  const handleReturnToFinance = (entry: EnrichedEntry) =>
    void moveRequisitions([entry], 'Pending', {
      refusePaid: true,
      // Cancelling freed its expense request, so reopening takes the request back.
      expenseLink: entry.status === 'Cancelled' ? 'restore' : undefined,
    });

  /** Receiving at Finance: cancel a received entry and free its expense request to be received again. */
  const handleCancel = (entry: EnrichedEntry) =>
    void moveRequisitions([entry], 'Cancelled', { refusePaid: true, expenseLink: 'release' });

  /** Receiving at Finance: cancel the selected pending entries, once confirmed, freeing their requests. */
  const handleCancelSelected = () =>
    void moveRequisitions(selectedEntries, 'Cancelled', { refusePaid: true, expenseLink: 'release' });

  /** Return to the previous stage. On GST & TDS Verification that also clears the verification. */
  const handleReturnToPending = (entry: EnrichedEntry) =>
    void (dynamicIndex === 1
      ? moveRequisitions([entry], 'Received', {
          refusePaid: true,
          fields: () => ({
            verifiedAt: null,
            igstAmount: 0,
            tdsAmount: 0,
            cgstAmount: 0,
            sgstAmount: 0,
            retentionAmount: 0,
            otherDeduction: 0,
            verificationNotes: '',
            gstNo: '',
          }),
        })
      : moveRequisitions([entry], 'Pending', { refusePaid: true }));

  /** Open GST/TDS verification dialog */
  const handleOpenVerifyDialog = (entry: EnrichedEntry) => {
    setSelectedEntry(entry);
    setIsVerifyDialogOpen(true);
  };

  /* ──────────── 5 ─ permission helpers ──────────── */

  const stepActions = useMemo(() => new Set(currentStep?.actions || []), [currentStep]);

  const canMarkAsReceived = stepActions.has('Mark as Received') && can('Mark as Received', permissionScope);
  const canReturnToPending = stepActions.has('Return to Pending') && can('Return to Pending', permissionScope);
  const canCancel = stepActions.has('Cancel') && can('Reject', permissionScope);
  const canVerify = stepActions.has('Verify') && can('Verify', permissionScope);
  const canReverify = stepActions.has('Re-verify') && can('Re-verify', permissionScope);
  const canSendForPayment =
    stepActions.has('Send for Payment') && can('Mark as Received for Payment', 'Daily Requisition.Processed for Payment');
  const canMarkAsPaid =
    stepActions.has('Mark as Received for Payment') && can('Mark as Received for Payment', permissionScope);
  const canPayViaVoucher = can('Add', 'Bank Balance.Expenses');

  /** Whether the user can select rows for the current step's bulk action */
  const canBulkAction = useMemo(() => {
    if (!stepConfig?.bulkAction) return false;
    switch (dynamicIndex) {
      case 0: return canMarkAsReceived;
      case 1: return canSendForPayment;
      // The payment step's selection feeds both Mark as Paid and Pay via voucher.
      case 2: return canMarkAsPaid || canPayViaVoucher;
      default: return true;
    }
  }, [dynamicIndex, canMarkAsReceived, canSendForPayment, canMarkAsPaid, canPayViaVoucher, stepConfig]);

  const isBulkTab = Boolean(stepConfig?.bulkAction && openTab && stepConfig.bulkAction.tabKey === openTab.key);
  const canCancelSelected = dynamicIndex === 0 && isBulkTab && canCancel;

  // Keyboard: `/` to search; on the bulk tab, with rows ticked, the stage's own key (R, S or P) for
  // its action and C to cancel. Never while typing, in a menu or in a dialog. Re-bound each render,
  // so it always acts on what is ticked now.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const busy = target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
      if (busy) return;
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const bulk = stepConfig?.bulkAction;
      if (!bulk || !isBulkTab || isUpdating || selectedEntries.length === 0) return;
      const key = event.key.toLowerCase();
      if (key === 'c' && canCancelSelected) {
        event.preventDefault();
        setIsCancelOpen(true);
      } else if (key === bulk.shortcut) {
        event.preventDefault();
        if (dynamicIndex === 2) {
          if (markPaidTargets.length > 0 && canMarkAsPaid) setIsMarkPaidOpen(true);
        } else if (canBulkAction) {
          handleBulkAction();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ──────────── 6 ─ table render ──────────── */

  /**
   * The bar under the filters on the bulk tab: what is ticked out of what the list shows, and its
   * amount; then the stage's actions, each with its key.
   */
  const renderSelectionBar = () => {
    const bulk = stepConfig?.bulkAction;
    if (!bulk || !isBulkTab) return null;
    const isPaymentStep = dynamicIndex === 2;
    // On the payment step a selection can hold part-paid rows. Pay via voucher takes them, but
    // Mark as Paid doesn't.
    const voucherIds = isPaymentStep ? selectedEntries.filter((entry) => balanceOf(entry) > 0).map((entry) => entry.id) : [];
    const voucherOnly = isPaymentStep ? selectedEntries.filter((entry) => !isManuallyPayable(entry)).length : 0;
    const amount = selectedEntries.reduce((sum, entry) => sum + (isPaymentStep ? balanceOf(entry) : Number(entry.netAmount) || 0), 0);
    const allTicked = visibleEntries.length > 0 && selectedEntries.length === visibleEntries.length;
    const actionIcon = isUpdating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />;
    const shortcutKey = bulk.shortcut.toUpperCase();

    return (
      <div className={cn('flex flex-col gap-2 border-t px-4 py-2 print:hidden sm:flex-row sm:flex-wrap sm:items-center sm:px-5', SELECTION_BAR)}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Checkbox
            aria-label={allTicked ? 'Untick every row shown' : 'Tick every row shown'}
            disabled={!canBulkAction || visibleEntries.length === 0}
            checked={allTicked ? true : selectedEntries.length > 0 ? 'indeterminate' : false}
            onCheckedChange={(checked) => setSelectedIds(checked === true ? new Set(visibleEntries.map((entry) => entry.id)) : new Set())}
          />
          <span>
            <span className="font-semibold tabular-nums">{selectedEntries.length.toLocaleString('en-IN')}</span>
            <span className="text-muted-foreground"> of {visibleEntries.length.toLocaleString('en-IN')} selected · </span>
            <span className="font-mono font-semibold tabular-nums">{formatCurrency(amount)}</span>
          </span>
          {!allTicked && visibleEntries.length > 0 && canBulkAction ? (
            <button
              type="button"
              className="font-medium text-emerald-700 hover:underline"
              onClick={() => setSelectedIds(new Set(visibleEntries.map((entry) => entry.id)))}
            >
              Select all {visibleEntries.length.toLocaleString('en-IN')}
            </button>
          ) : null}
          {selectedEntries.length > 0 ? (
            <>
              <span className="h-4 w-px bg-border" aria-hidden="true" />
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSelectedIds(new Set())}>
                Clear
              </button>
            </>
          ) : null}
          {voucherOnly > 0 && <span className="text-xs text-muted-foreground">{voucherOnly} part paid, voucher only</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {canCancelSelected ? (
            <Button
              size="sm"
              variant="outline"
              className="bg-card"
              onClick={() => setIsCancelOpen(true)}
              disabled={selectedEntries.length === 0 || isUpdating}
            >
              Cancel…
              <kbd className={cn(KBD, 'ml-2 border-border text-muted-foreground')}>C</kbd>
            </Button>
          ) : null}
          {isPaymentStep ? (
            <>
              {/* Paid outside Bank Balance. No bank entry is made, so it is confirmed first. */}
              <Button
                size="sm"
                variant="outline"
                className="bg-card"
                onClick={() => setIsMarkPaidOpen(true)}
                disabled={markPaidTargets.length === 0 || !canMarkAsPaid || isUpdating}
              >
                {actionIcon}
                Mark as Paid ({markPaidTargets.length})
                <kbd className={cn(KBD, 'ml-2 border-border text-muted-foreground')}>{shortcutKey}</kbd>
              </Button>
              {/* Pay through a Bank Balance voucher (cheque / e-cheque / RTGS), in full or in part */}
              {canPayViaVoucher && (
                <Button size="sm" asChild>
                  <Link href={payRequisitionsHref(voucherIds)}>
                    {voucherIds.length > 0 ? `Pay selected via voucher (${voucherIds.length})` : 'Pay via voucher'}
                  </Link>
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" onClick={handleBulkAction} disabled={selectedEntries.length === 0 || !canBulkAction || isUpdating}>
              {actionIcon}
              {bulk.label}
              {selectedEntries.length > 0 ? ` (${selectedEntries.length})` : ''}
              <kbd className={cn(KBD, 'ml-2 border-white/40 text-white/90')}>{shortcutKey}</kbd>
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderTable = (tabKey: string) => {
    const data = tabEntries[tabKey] || [];
    const isVerificationStep = dynamicIndex === 1;
    const isPaymentStep = dynamicIndex === 2;
    const showCheckbox = stepConfig?.bulkAction?.tabKey === tabKey || (isVerificationStep && tabKey === 'verified');
    // The stage's own queue says how long each has waited there.
    const showAge = tabKey === stepConfig?.tabs[0]?.key;
    const showPaidVia = isPaymentStep && tabKey === 'paid';
    // "Received By" for the GST step and the non-pending tabs of step 0
    const showReceivedBy = isVerificationStep || (dynamicIndex === 0 && tabKey !== 'pending');

    // For the "received" and "cancelled" tabs in step 0 (Receiving at Finance), show actions
    const showRowActions =
      (dynamicIndex === 0 && (tabKey === 'received' || tabKey === 'cancelled')) ||
      (dynamicIndex === 1);

    const columnCount =
      (showCheckbox ? 1 : 0) + 2 + (showAge ? 1 : 0) + (showPaidVia ? 1 : 0) + 2 + (showReceivedBy ? 1 : 0) + 1 + (isPaymentStep ? 2 : 0) + (showRowActions ? 1 : 0);

    const handleSelectAll = (checked: boolean | 'indeterminate') => {
      if (checked === true) setSelectedIds(new Set(data.map((item) => item.id)));
      else setSelectedIds(new Set());
    };

    // Only the rows this tab is showing, so the header checkbox cannot read as ticked because rows
    // on another tab (the selection is shared) happen to add up to the same count.
    const allHereSelected = data.length > 0 && data.every((item) => selectedIds.has(item.id));
    const someHereSelected = data.some((item) => selectedIds.has(item.id));

    return (
      // No title or strip of its own: the card above names the list and holds its filters and actions.
      <TableCard>
          {/* Tight rows, one line each: the app's compact table density, whatever the Table rows setting. */}
          <Table className="[--table-cell-py:0.375rem] [--table-head-h:2.25rem]">
            <TableHeader>
              <TableRow>
                {/* Checkbox column */}
                {showCheckbox && (
                  <TableHead className="w-[50px]">
                    <Checkbox
                      disabled={!canBulkAction}
                      checked={allHereSelected ? true : someHereSelected ? 'indeterminate' : false}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                )}
                <TableHead>Reception No.</TableHead>
                <TableHead>
                  {isPaymentStep && tabKey === 'paid'
                    ? 'Paid At'
                    : tabKey === 'pending' && dynamicIndex === 0
                      ? 'Date'
                      : 'Received At'}
                </TableHead>
                {showAge && <TableHead>Waiting</TableHead>}
                {showPaidVia && <TableHead>Paid via</TableHead>}
                <TableHead>Project</TableHead>
                <TableHead>Party Name</TableHead>
                {showReceivedBy && <TableHead>Received By</TableHead>}
                <TableHead className="text-right">Net Amount</TableHead>
                {isPaymentStep && (
                  <>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </>
                )}
                {showRowActions && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={columnCount}>
                      <Skeleton className="h-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data.length > 0 ? (
                data.map((entry) => (
                  <TableRow key={entry.id} className={selectedIds.has(entry.id) ? SELECTED_ROW : STRIPED_ROW}>
                    {/* Checkbox cell */}
                    {showCheckbox && (
                      <TableCell>
                        <Checkbox
                          disabled={!canBulkAction}
                          checked={selectedIds.has(entry.id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedIds);
                            if (checked === true) next.add(entry.id);
                            else next.delete(entry.id);
                            setSelectedIds(next);
                          }}
                        />
                      </TableCell>
                    )}
                    <TableCell className="whitespace-nowrap font-medium">{entry.receptionNo}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {isPaymentStep && tabKey === 'paid'
                        ? entry.paidAtText || 'N/A'
                        : tabKey === 'pending' && dynamicIndex === 0
                          ? entry.dateText
                          : entry.receivedAtText ?? '—'}
                    </TableCell>
                    {showAge && (
                      <TableCell
                        className={cn('whitespace-nowrap tabular-nums', (entry.ageDays ?? 0) > OVERDUE_DAYS && 'font-medium text-red-600')}
                      >
                        {entry.ageDays === null ? '—' : `${entry.ageDays} d`}
                      </TableCell>
                    )}
                    {showPaidVia && (
                      <TableCell className="whitespace-nowrap">
                        <PaidVia entry={entry} />
                      </TableCell>
                    )}
                    <TableCell>
                      <span className="block max-w-[220px] truncate" title={entry.projectName}>
                        {entry.projectName}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-[240px] truncate" title={entry.partyName}>
                        {entry.partyName}
                      </span>
                    </TableCell>
                    {showReceivedBy && <TableCell className="whitespace-nowrap">{entry.receivedByName || 'N/A'}</TableCell>}
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(entry.netAmount)}</TableCell>
                    {isPaymentStep && (() => {
                      // Paid through Bank Balance vouchers (paidAmount), or marked Paid here in full.
                      const paid = paidOf(entry);
                      const balance = balanceOf(entry);
                      return (
                        <>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{paid ? formatCurrency(paid) : '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {entry.status === 'Partially Paid' && <span className="mr-1.5 text-[11px] text-sky-700">Part paid</span>}
                            {formatCurrency(balance)}
                          </TableCell>
                        </>
                      );
                    })()}

                    {/* Row-level actions */}
                    {showRowActions && (
                      <TableCell className="text-right">
                        {renderRowActions(entry, tabKey)}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ) : (
                <TableEmpty colSpan={columnCount}>No entries found.</TableEmpty>
              )}
            </TableBody>
          </Table>
      </TableCard>
    );
  };

  /* ──────────── 7 ─ row actions renderer ──────────── */

  const renderRowActions = (entry: EnrichedEntry, tabKey: string) => {
    // GST & TDS Verification step
    if (dynamicIndex === 1) {
      if (tabKey === 'pending' || tabKey === 'needs-review') {
        return (
          <Button size="sm" className="h-7" onClick={() => handleOpenVerifyDialog(entry)} disabled={!canVerify}>
            {tabKey === 'pending' ? 'Verify' : 'Review & Verify'}
          </Button>
        );
      }
      // Verified tab: re-verify and return dropdown
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canReverify && (
              <DropdownMenuItem onSelect={() => handleOpenVerifyDialog(entry)}>Re-verify</DropdownMenuItem>
            )}
            {canReturnToPending && (
              <DropdownMenuItem onSelect={() => handleReturnToPending(entry)} className="text-destructive">
                <RotateCcw className="mr-2 h-4 w-4" /> Return to Pending
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    // Receiving at Finance step (received + cancelled tabs)
    if (dynamicIndex === 0) {
      return (
        <AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canReturnToPending && (
                <DropdownMenuItem
                  onSelect={() => handleReturnToFinance(entry)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Return
                </DropdownMenuItem>
              )}
              {tabKey === 'received' && canCancel && (
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem className="text-destructive">
                    <XCircle className="mr-2 h-4 w-4" /> Cancel
                  </DropdownMenuItem>
                </AlertDialogTrigger>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will mark the entry as <b>Cancelled</b> and release its expense request so it can be
                received again. You can move it back to Pending later, unless that request has been
                received again by then.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Close</AlertDialogCancel>
              <AlertDialogAction onClick={() => handleCancel(entry)}>
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    }

    return null;
  };

  /* ══════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════ */

  // Loading skeleton
  if (workflowLoading || isAuthLoading || (isLoading && canViewPage && stepConfig)) {
    return <StepPageSkeleton />;
  }

  // Workflow step not found
  if (workflowNotFound || !currentStep || !stepConfig) {
    return (
      <div className={dailyPageContainerClass}>
        <PageHeader backHref="/daily-requisition" eyebrow="Daily Requisition"
          title="Step Not Found"
          description="This workflow step does not exist or the workflow has not been configured yet."
        />
        <Card className={dailySurfaceCardClass}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> No Workflow Step
            </CardTitle>
            <CardDescription>
              {`The URL slug "${stepSlug}" doesn't match any step in the Daily Requisition workflow. `}
              Please configure your workflow in Settings → Workflow Configuration.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Access denied
  if (!canViewPage) {
    return (
      <div className={dailyPageContainerClass}>
        <PageHeader backHref="/daily-requisition" eyebrow="Daily Requisition" title={currentStep.name} description={stepConfig.description} />
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

  // What each tab holds in rupees. On the payment step's Pending tab that is what is still due,
  // since part-paid requisitions sit there too.
  const tabAmount = (tabKey: string) =>
    (tabEntries[tabKey] || []).reduce((sum, entry) => {
      if (dynamicIndex === 2 && tabKey === 'pending') return sum + balanceOf(entry);
      return sum + (entry.netAmount || 0);
    }, 0);

  const markPaidTotal = markPaidTargets.reduce((sum, entry) => sum + (entry.netAmount || 0), 0);
  const markPaidLeftOut = selectedEntries.filter(
    (entry) => entry.status === 'Partially Paid' || (entry.status === 'Received for Payment' && !isManuallyPayable(entry)),
  ).length;
  const cancelAmount = selectedEntries.reduce((sum, entry) => sum + (Number(entry.netAmount) || 0), 0);

  // The header's figures read the stage's own queue — its first tab — in the chosen FY, whatever
  // the search and filters show.
  const queueTab = stepConfig.tabs[0];
  const queue = scoped.filter((entry) => queueTab?.statuses.includes(entry.status));
  const waits = queue.map((entry) => entry.ageDays).filter((days): days is number => days !== null);
  const overdueCount = waits.filter((days) => days > OVERDUE_DAYS).length;
  const agingCount = waits.filter((days) => days > 7 && days <= OVERDUE_DAYS).length;
  const freshCount = waits.length - overdueCount - agingCount;
  const overduePct = queue.length ? Math.round((overdueCount / queue.length) * 100) : 0;
  const avgWait = waits.length ? Math.round(waits.reduce((sum, days) => sum + days, 0) / waits.length) : null;
  const largestWaiting = queue.reduce((max, entry) => Math.max(max, dynamicIndex === 2 ? balanceOf(entry) : Number(entry.netAmount) || 0), 0);
  const doneTodayCount = scoped.filter((entry) => entry.doneToday).length;

  // What "More filters" holds, as removable chips under the toolbar, so nothing filters the list unseen.
  const moreChips = [
    ...(departmentFilter
      ? [{ key: 'department', label: 'Department', value: lookups?.departments.get(departmentFilter) || departmentFilter, onRemove: () => setDepartmentFilter('') }]
      : []),
    ...(dateFrom ? [{ key: 'from', label: 'Date from', value: format(new Date(`${dateFrom}T00:00`), 'dd MMM yyyy'), onRemove: () => setDateFrom('') }] : []),
    ...(dateTo ? [{ key: 'to', label: 'Date to', value: format(new Date(`${dateTo}T00:00`), 'dd MMM yyyy'), onRemove: () => setDateTo('') }] : []),
    ...(minAmount ? [{ key: 'min', label: 'Net ≥', value: formatCurrency(Number(minAmount) || 0), onRemove: () => setMinAmount('') }] : []),
    ...(maxAmount ? [{ key: 'max', label: 'Net ≤', value: formatCurrency(Number(maxAmount) || 0), onRemove: () => setMaxAmount('') }] : []),
  ];
  const activeFilterCount =
    [fyFilter !== 'all', projectFilter, ageFilter !== null, searchTerm.trim()].filter(Boolean).length + moreChips.length;
  const clearFilters = () => {
    setSearchTerm('');
    setFyFilter('all');
    setProjectFilter('');
    setAgeFilter(null);
    setDepartmentFilter('');
    setDateFrom('');
    setDateTo('');
    setMinAmount('');
    setMaxAmount('');
  };

  /** The open tab's list, as shown — search and filters applied — to Excel. */
  const exportList = async () => {
    if (isExporting || !openTab) return;
    setIsExporting(true);
    try {
      // Loaded on demand: most visits never export.
      const ExcelJS = (await import('exceljs')).default;
      const isPaymentStep = dynamicIndex === 2;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(openTab.label.slice(0, 31));
      ws.columns = [
        { header: 'Reception No', key: 'receptionNo', width: 16 },
        { header: 'Request No', key: 'depNo', width: 16 },
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Waiting (days)', key: 'age', width: 14 },
        { header: 'Project', key: 'project', width: 30 },
        { header: 'Department', key: 'department', width: 22 },
        { header: 'Party', key: 'party', width: 30 },
        { header: 'Status', key: 'status', width: 20 },
        { header: 'Net (INR)', key: 'net', width: 16 },
        ...(isPaymentStep
          ? [
              { header: 'Paid (INR)', key: 'paid', width: 16 },
              { header: 'Balance (INR)', key: 'balance', width: 16 },
            ]
          : []),
      ];
      visibleEntries.forEach((entry) =>
        ws.addRow({
          receptionNo: entry.receptionNo || '',
          depNo: entry.depNo || '',
          date: entry.dateText,
          age: entry.ageDays ?? '',
          project: entry.projectName,
          department: entry.departmentName,
          party: entry.partyName || '',
          status: entry.status,
          net: Number(entry.netAmount) || 0,
          paid: paidOf(entry),
          balance: balanceOf(entry),
        }),
      );
      const buffer = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stepSlug}-${openTab.key}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      toast({ title: 'Export failed', description: 'The list could not be exported.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <div className={dailyPageContainerClass}>
        <Tabs
          value={tabValue}
          onValueChange={(value) => {
            setActiveTab(value);
            setSelectedIds(new Set());
          }}
          className="space-y-3"
        >
          {/* One card: the stage and how long its queue has waited; its tabs and today's figures;
              search and filters; then, on the bulk tab, the selection and its actions. */}
          <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
            {/* A `space-y-*` parent: globals.css then drops the header's own bottom margin. */}
            <div className="space-y-0 px-4 pb-1 pt-3 sm:px-5 sm:pt-4">
              <PageHeader
                backHref="/daily-requisition"
                breadcrumbs={[{ label: 'Daily Requisition', href: '/daily-requisition' }, { label: currentStep.name }]}
                title={currentStep.name}
                badge={<LiveBadge live={isLive} />}
                actions={
                  <>
                    {/* A row of its own on a phone, where the header's actions otherwise share one. */}
                    <div
                      className="flex min-w-0 items-center gap-3 rounded-xl border bg-card px-3 py-1.5 shadow-sm max-sm:!min-w-full"
                      title={`Waiting in ${queueTab?.label ?? 'the queue'}: ${freshCount} up to 7 days · ${agingCount} for 8–${OVERDUE_DAYS} days · ${overdueCount} for more than ${OVERDUE_DAYS} days`}
                    >
                      <WaitRing fresh={freshCount} aging={agingCount} overdue={overdueCount} />
                      <div className="min-w-0 leading-tight">
                        {queue.length ? (
                          <>
                            <p className="text-sm font-semibold text-foreground">{overduePct}% overdue</p>
                            <p className="mt-0.5 whitespace-nowrap text-xs text-muted-foreground">
                              <span className="font-semibold text-red-600">{overdueCount.toLocaleString('en-IN')}</span>{' '}
                              {overdueCount === 1 ? 'entry' : 'entries'} waiting &gt;{OVERDUE_DAYS} days
                            </p>
                          </>
                        ) : (
                          <p className="text-sm font-semibold text-foreground">Nothing waiting</p>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 gap-1.5 bg-white shadow-sm"
                      onClick={() => void exportList()}
                      disabled={isExporting || visibleEntries.length === 0}
                      title="The list shown, to Excel"
                    >
                      {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Export
                    </Button>
                  </>
                }
              />
            </div>

            {/* The tabs and today's figures, as one row of cells across the card: the tabs a little
                wider, for their amounts. On narrower screens the figures take a row of their own. */}
            <div className="grid gap-px border-y bg-border lg:grid-cols-[3fr_2fr]">
              <TabsList
                indicator={false}
                className={dailyQueueTabListClass}
                style={{ gridTemplateColumns: `repeat(${stepConfig.tabs.length}, minmax(0, 1fr))` }}
              >
                {stepConfig.tabs.map((tab, i) => {
                  const amount = tabAmount(tab.key);
                  return (
                    <TabsTrigger key={tab.key} value={tab.key} className={dailyQueueTabClass} title={stepConfig.metricHints[i] || undefined}>
                      <span className="flex max-w-full items-center gap-2">
                        <span className="truncate text-sm font-medium text-muted-foreground group-data-[state=active]/tab:text-primary">{tab.label}</span>
                        <span className="shrink-0 rounded-full bg-muted px-2 text-xs font-semibold leading-5 tabular-nums text-foreground group-data-[state=active]/tab:bg-[image:var(--sel-tab-gradient)] group-data-[state=active]/tab:text-[color:var(--sel-tab-on)]">
                          {(tabEntries[tab.key] || []).length.toLocaleString('en-IN')}
                        </span>
                      </span>
                      {/* To the paisa from `sm`; shortened on a phone, where a third of the width can't hold it. */}
                      <span
                        className="max-w-full truncate font-mono text-base font-semibold leading-tight tabular-nums text-muted-foreground group-data-[state=active]/tab:text-foreground"
                        title={formatCurrency(amount)}
                      >
                        <span className="sm:hidden">{formatINRCompact(amount)}</span>
                        <span className="hidden sm:inline">{formatCurrency(amount)}</span>
                      </span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              <dl className="grid grid-cols-3 gap-px">
                {[
                  { label: stepConfig.doneTodayLabel, value: doneTodayCount.toLocaleString('en-IN') },
                  { label: 'Avg. wait', value: avgWait === null ? '—' : `${avgWait} d` },
                  {
                    label: dynamicIndex === 2 ? 'Largest due' : 'Largest pending',
                    value: queue.length ? <span title={formatCurrency(largestWaiting)}>{formatINRCompact(largestWaiting)}</span> : '—',
                  },
                ].map((stat) => (
                  <div key={stat.label} className={dailyQueueStatClass}>
                    <dt className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{stat.label}</dt>
                    <dd className="mt-1 truncate font-mono text-base font-semibold leading-tight tabular-nums text-foreground">{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Bill Tracking's filter toolbar, as on the Bill Register: search, FY, project and age
                inline; department, dates and amount behind More filters, as chips once set. On a
                phone the dropdowns fold behind "Filters". */}
            <div className="bg-muted/40 px-4 py-2.5 sm:px-5">
              <BtToolbar
                framed={false}
                search={
              <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search reception, request no., project, party"
                  aria-label="Search reception, request no., project, party"
                  aria-keyshortcuts="/"
                  className="h-9 w-full rounded-md border border-input bg-white pl-8 pr-9 text-sm shadow-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20 [&::-webkit-search-cancel-button]:hidden"
                />
                {searchTerm ? (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    aria-label="Clear search"
                    className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <kbd className={cn(KBD, 'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 border-border bg-card text-muted-foreground')} aria-hidden="true">
                    /
                  </kbd>
                )}
              </div>
                }
                controls={
                  <>
                    <ToolbarSelect
                      label="FY"
                      value={fyFilter === 'all' ? '' : fyFilter}
                      onChange={(value) => setFyFilter(value || 'all')}
                      options={fyOptions.map((fy) => ({ value: String(fy), label: fyLabel(fy) }))}
                      allLabel="All years"
                    />
                    <ToolbarSelect
                      label="Project"
                      value={projectFilter}
                      onChange={setProjectFilter}
                      options={projectOptions.map(([value, label]) => ({ value, label }))}
                      allLabel="All projects"
                    />
                    <ToolbarSelect
                      label="Age"
                      value={ageFilter === null ? '' : String(ageFilter)}
                      onChange={(value) => setAgeFilter(value ? Number(value) : null)}
                      options={AGE_OPTIONS.map((days) => ({ value: String(days), label: `More than ${days} days` }))}
                      allLabel="Any age"
                    />
                  </>
                }
                chips={moreChips}
                activeCount={activeFilterCount}
                onClear={clearFilters}
                actions={
                  <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-white shadow-sm" onClick={() => setIsMoreFiltersOpen(true)}>
                    <SlidersHorizontal className="h-4 w-4" /> More filters
                    {moreChips.length ? (
                      <span className="rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold leading-4 text-white">{moreChips.length}</span>
                    ) : null}
                  </Button>
                }
              />
            </div>

            {renderSelectionBar()}
          </section>

          {stepConfig.tabs.map((tab) => (
            <TabsContent key={tab.key} value={tab.key} className="mt-0">
              {renderTable(tab.key)}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* GST/TDS Verification Dialog (only shown for verification step) */}
      {dynamicIndex === 1 && (
        <GstTdsVerificationDialog
          isOpen={isVerifyDialogOpen}
          onOpenChange={setIsVerifyDialogOpen}
          entry={selectedEntry}
          // Nothing to reload: the live list shows the verification as soon as it is saved.
          onSuccess={() => undefined}
        />
      )}

      {/* More filters, as on the Bill Register: a drawer, its choices shown as chips once set. */}
      <Sheet open={isMoreFiltersOpen} onOpenChange={setIsMoreFiltersOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-slate-100 px-5 py-4">
            <SheetTitle>More filters</SheetTitle>
            <SheetDescription>Applied to the list, the tab figures, the selection and any export.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <fieldset className="space-y-3">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Who</legend>
              <DrawerSelect
                label="Department"
                value={departmentFilter}
                onChange={setDepartmentFilter}
                options={departmentOptions.map(([value, label]) => ({ value, label }))}
                placeholder="All departments"
              />
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Requisition date</legend>
              <div className="grid grid-cols-2 gap-3">
                <DrawerInput label="Date from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} />
                <DrawerInput label="Date to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} />
              </div>
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Net amount</legend>
              <div className="grid grid-cols-2 gap-3">
                <DrawerInput label="At least (₹)" type="number" inputMode="decimal" min={0} value={minAmount} onChange={(event) => setMinAmount(event.target.value)} />
                <DrawerInput label="At most (₹)" type="number" inputMode="decimal" min={0} value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} />
              </div>
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

      {/* Cancel the selected pending entries (Receiving at Finance): confirmed first, since it frees their requests */}
      {dynamicIndex === 0 && (
        <AlertDialog open={isCancelOpen} onOpenChange={setIsCancelOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Cancel {selectedEntries.length} {selectedEntries.length === 1 ? 'requisition' : 'requisitions'} ({formatCurrency(cancelAmount)})?
              </AlertDialogTitle>
              <AlertDialogDescription>
                They are marked <b>Cancelled</b> and their expense requests are released, so they can be received again.
                You can return them to Pending later from the Cancelled tab, unless a request has been received again by
                then.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep them</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleCancelSelected}
                disabled={selectedEntries.length === 0 || isUpdating}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Cancel {selectedEntries.length}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Manual Mark as Paid (payment step): no bank entry is made, so it is confirmed first */}
      {dynamicIndex === 2 && (
        <AlertDialog open={isMarkPaidOpen} onOpenChange={setIsMarkPaidOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Mark {markPaidTargets.length} {markPaidTargets.length === 1 ? 'requisition' : 'requisitions'} as paid (
                {formatCurrency(markPaidTotal)})?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Marked paid outside Bank Balance — no bank entry is made. Use Pay via voucher to pay from a bank account.
              </AlertDialogDescription>
              {markPaidLeftOut > 0 && (
                <p className="text-sm text-muted-foreground">
                  {markPaidLeftOut} selected {markPaidLeftOut === 1 ? 'requisition has' : 'requisitions have'} already been
                  part paid by voucher and {markPaidLeftOut === 1 ? 'is' : 'are'} left out. The rest can only be paid by
                  voucher.
                </p>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleMarkPaid} disabled={markPaidTargets.length === 0 || isUpdating}>
                Mark as Paid ({markPaidTargets.length})
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

/** How a paid requisition was paid: by voucher (the first linked, then how many more), or marked paid by hand. */
function PaidVia({ entry }: { entry: Pick<DailyRequisitionEntry, 'payments' | 'manualPaid' | 'paidByName'> }) {
  // One voucher can pay a requisition over several lines. Count vouchers, not lines.
  const vouchers = [...new Map((entry.payments ?? []).map((payment) => [payment.bankPaymentId, payment])).values()];
  if (vouchers.length > 0) {
    const [first, ...more] = vouchers;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-muted-foreground">Voucher</span>
        <Link href={voucherHref(first.bankPaymentId)} className="font-medium text-primary underline-offset-4 hover:underline">
          {first.voucherNo || 'View'}
        </Link>
        {more.length > 0 && (
          <span className="text-xs text-muted-foreground" title={more.map((payment) => payment.voucherNo).filter(Boolean).join(', ')}>
            +{more.length}
          </span>
        )}
      </span>
    );
  }
  if (entry.manualPaid) {
    return (
      <span>
        Marked paid
        {entry.paidByName && <span className="ml-1 text-[11px] text-muted-foreground">by {entry.paidByName}</span>}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground" title="No voucher on record">
      —
    </span>
  );
}

/** `useSearchParams` (for the `?q=` search) needs a Suspense boundary above it. */
export default function DynamicWorkflowStepPage() {
  return (
    <Suspense fallback={<StepPageSkeleton />}>
      <DynamicWorkflowStepContent />
    </Suspense>
  );
}
