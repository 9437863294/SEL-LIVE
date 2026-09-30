'use client';

import Link from 'next/link';
import React, { Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  MoreHorizontal,
  ShieldAlert,
  RotateCcw,
  XCircle,
  Check,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/shared/filter-bar';
import { TableCard } from '@/components/shared/table-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, runTransaction, Timestamp, query, where, type DocumentReference } from 'firebase/firestore';
import type { DailyRequisitionEntry, Project, User, WorkflowStep } from '@/lib/types';
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
  dailySurfaceCardClass,
  dailyTabsListClass,
} from '@/components/daily-requisition/module-shell';
import { PageHeader } from '@/components/shared/page-header';

/* ──────────────────── helpers ──────────────────── */

/** Convert a step name to a URL-safe slug. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

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
    <div className={dailyPageContainerClass}>
      <Skeleton className="mb-4 h-10 w-80" />
      <div className="flex flex-col gap-3 lg:flex-row lg:justify-between">
        <Skeleton className="h-10 w-full rounded-xl lg:w-96" />
        <Skeleton className="h-10 w-full rounded-xl lg:w-96" />
      </div>
      <Skeleton className="mt-3 h-96 w-full rounded-2xl" />
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
  };
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
        bulkAction: { tabKey: 'pending', label: 'Mark as Received', newStatus: 'Received' },
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
        bulkAction: { tabKey: 'verified', label: 'Send for Payment', newStatus: 'Received for Payment' },
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
        bulkAction: { tabKey: 'pending', label: 'Mark as Paid', newStatus: 'Paid' },
        description: 'Manage verified entries that are waiting for final payment and keep paid items visible for traceability.',
        metricHints: ['Awaiting final confirmation', 'Completed disbursements'],
      };
    default:
      return {
        queryStatuses: ['Pending'],
        tabs: [{ key: 'all', label: 'All Entries', statuses: ['Pending'] }],
        description: 'View and manage entries at this workflow stage.',
        metricHints: ['Total entries'],
      };
  }
}

/* ──────────────────── enriched entry type ──────────────────── */

type EnrichedEntry = DailyRequisitionEntry & {
  id: string;
  projectName: string;
  receivedByName?: string;
  dateText: string;
  receivedAtText?: string;
  verifiedAtText?: string;
  paidAtText?: string;
};

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
  const [entries, setEntries] = useState<EnrichedEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isUpdating, setIsUpdating] = useState(false);
  const [isMarkPaidOpen, setIsMarkPaidOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('');

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

  /* ──────────── 2 ─ fetch entries ──────────── */
  const fetchData = useCallback(async () => {
    if (!stepConfig) return;
    setIsLoading(true);
    try {
      const queryStatuses = stepConfig.queryStatuses;

      const [reqsSnap, projectsSnap, usersSnap] = await Promise.all([
        queryStatuses.length <= 10
          ? getDocs(query(collection(db, 'dailyRequisitions'), where('status', 'in', queryStatuses)))
          : getDocs(collection(db, 'dailyRequisitions')),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'users')),
      ]);

      const projectsMap = new Map(projectsSnap.docs.map((d) => [d.id, (d.data() as Project).projectName]));
      const usersMap = new Map(
        usersSnap.docs.map((d) => {
          const u = d.data() as User;
          return [d.id, u.name || u.email || d.id];
        })
      );

      const data: EnrichedEntry[] = reqsSnap.docs
        .filter((d) => queryStatuses.includes((d.data() as any).status))
        .map((d) => {
          const raw = d.data() as DailyRequisitionEntry & {
            receivedById?: string;
            receivedAt?: any;
            date?: any;
            createdAt?: any;
            verifiedAt?: any;
            paidAt?: any;
          };

          const dateTs =
            raw.date?.toDate instanceof Function
              ? raw.date.toDate()
              : typeof raw.date === 'string' || typeof raw.date === 'number'
                ? new Date(raw.date as any)
                : raw.createdAt?.toDate instanceof Function
                  ? raw.createdAt.toDate()
                  : undefined;

          const receivedAtTs = raw.receivedAt?.toDate instanceof Function ? raw.receivedAt.toDate() : undefined;
          const verifiedAtTs = raw.verifiedAt?.toDate instanceof Function ? raw.verifiedAt.toDate() : undefined;
          const paidAtTs = raw.paidAt?.toDate instanceof Function ? raw.paidAt.toDate() : undefined;

          return {
            ...(raw as DailyRequisitionEntry),
            id: d.id,
            projectName: projectsMap.get(raw.projectId) || 'N/A',
            receivedByName: raw.receivedById ? usersMap.get(raw.receivedById) : undefined,
            dateText: dateTs ? format(dateTs, 'dd MMM, yyyy') : raw.date ? String(raw.date) : '',
            receivedAtText: receivedAtTs ? format(receivedAtTs, 'PPpp') : undefined,
            verifiedAtText: verifiedAtTs ? format(verifiedAtTs, 'PPpp') : undefined,
            paidAtText: paidAtTs ? format(paidAtTs, 'dd MMM, yyyy HH:mm') : undefined,
          };
        });

      // Sort by most recent timestamp
      data.sort((a, b) => {
        const aMs =
          (a as any).paidAt?.toDate?.()?.getTime?.() ||
          (a as any).verifiedAt?.toDate?.()?.getTime?.() ||
          (a as any).receivedAt?.toDate?.()?.getTime?.() ||
          (a as any).createdAt?.toDate?.()?.getTime?.() ||
          0;
        const bMs =
          (b as any).paidAt?.toDate?.()?.getTime?.() ||
          (b as any).verifiedAt?.toDate?.()?.getTime?.() ||
          (b as any).receivedAt?.toDate?.()?.getTime?.() ||
          (b as any).createdAt?.toDate?.()?.getTime?.() ||
          0;
        return bMs - aMs;
      });

      setEntries(data);
    } catch (error: any) {
      console.error('Error fetching entries:', error);
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
    }
    setIsLoading(false);
  }, [stepConfig, toast]);

  useEffect(() => {
    if (!workflowLoading && !isAuthLoading && canViewPage && stepConfig) {
      fetchData();
    } else if (!workflowLoading && !isAuthLoading) {
      setIsLoading(false);
    }
  }, [workflowLoading, isAuthLoading, canViewPage, stepConfig, fetchData]);

  /* ──────────── 3 ─ action handlers ──────────── */

  const selectedEntries = useMemo(() => entries.filter((entry) => selectedIds.has(entry.id)), [entries, selectedIds]);
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
    fetchData();
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

  /* ──────────── 4 ─ permission helpers ──────────── */

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

  /* ──────────── 5 ─ filtered entry sets per tab ──────────── */

  const tabEntries = useMemo(() => {
    if (!stepConfig) return {};
    const map: Record<string, EnrichedEntry[]> = {};
    const t = searchTerm.trim().toLowerCase();

    stepConfig.tabs.forEach((tab) => {
      map[tab.key] = entries.filter(
        (entry) =>
          tab.statuses.includes(entry.status) &&
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
  }, [entries, stepConfig, searchTerm]);

  /* ──────────── 6 ─ table render ──────────── */

  const renderTable = (tabKey: string, tab: TabDef) => {
    const data = tabEntries[tabKey] || [];
    const isBulkTab = stepConfig?.bulkAction?.tabKey === tabKey;
    const isVerificationStep = dynamicIndex === 1;
    const isPaymentStep = dynamicIndex === 2;

    // For the "received" and "cancelled" tabs in step 0 (Receiving at Finance), show actions
    const showRowActions =
      (dynamicIndex === 0 && (tabKey === 'received' || tabKey === 'cancelled')) ||
      (dynamicIndex === 1);

    const handleSelectAll = (checked: boolean | 'indeterminate') => {
      if (checked === true) setSelectedIds(new Set(data.map((item) => item.id)));
      else setSelectedIds(new Set());
    };

    const showBulkHeader = Boolean(isBulkTab && stepConfig?.bulkAction);
    // On the payment step a selection can hold part-paid rows. Pay via voucher takes them, but
    // Mark as Paid doesn't.
    const selectedHere = selectedEntries.filter((entry) => tab.statuses.includes(entry.status));
    const voucherIds = isPaymentStep ? selectedHere.filter((entry) => balanceOf(entry) > 0).map((entry) => entry.id) : [];
    const voucherOnly = isPaymentStep ? selectedHere.filter((entry) => !isManuallyPayable(entry)).length : 0;
    const selectionText =
      selectedIds.size > 0
        ? `${selectedIds.size} selected${voucherOnly > 0 ? ` · ${voucherOnly} part paid, voucher only` : ''}`
        : 'Select entries for bulk action';
    const actionIcon = isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />;

    return (
      <TableCard
        // No title: the active tab above already names the list. The strip shows only when there
        // is something to act on — the selection hint beside the bulk actions.
        description={showBulkHeader ? selectionText : undefined}
        actions={
          showBulkHeader && stepConfig?.bulkAction ? (
            isPaymentStep ? (
              <>
                {/* Paid outside Bank Balance. No bank entry is made, so it is confirmed first. */}
                <Button
                  variant="outline"
                  onClick={() => setIsMarkPaidOpen(true)}
                  disabled={markPaidTargets.length === 0 || !canMarkAsPaid || isUpdating}
                >
                  {actionIcon}
                  Mark as Paid ({markPaidTargets.length})
                </Button>
                {/* Pay through a Bank Balance voucher (cheque / e-cheque / RTGS), in full or in part */}
                {canPayViaVoucher && (
                  <Button asChild>
                    <Link href={payRequisitionsHref(voucherIds)}>
                      {voucherIds.length > 0 ? `Pay selected via voucher (${voucherIds.length})` : 'Pay via voucher'}
                    </Link>
                  </Button>
                )}
              </>
            ) : (
              <Button onClick={handleBulkAction} disabled={selectedIds.size === 0 || !canBulkAction || isUpdating}>
                {actionIcon}
                {stepConfig.bulkAction.label} ({selectedIds.size})
              </Button>
            )
          ) : undefined
        }
      >
          <Table>
            <TableHeader>
              <TableRow>
                {/* Checkbox column */}
                {(isBulkTab || (isVerificationStep && tabKey === 'verified')) && (
                  <TableHead className="w-[50px]">
                    <Checkbox
                      disabled={!canBulkAction}
                      checked={data.length > 0 && selectedIds.size === data.length}
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
                {isPaymentStep && tabKey === 'paid' && <TableHead>Paid via</TableHead>}
                <TableHead>Project</TableHead>
                <TableHead>Party Name</TableHead>
                {/* Show "Received By" for GST step and non-pending tabs of step 0 */}
                {(isVerificationStep || (dynamicIndex === 0 && tabKey !== 'pending')) && (
                  <TableHead>Received By</TableHead>
                )}
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
                    <TableCell colSpan={8}>
                      <Skeleton className="h-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data.length > 0 ? (
                data.map((entry) => (
                  <TableRow
                    key={entry.id}
                    data-state={selectedIds.has(entry.id) ? 'selected' : undefined}
                  >
                    {/* Checkbox cell */}
                    {(isBulkTab || (isVerificationStep && tabKey === 'verified')) && (
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
                    {isPaymentStep && tabKey === 'paid' && (
                      <TableCell className="whitespace-nowrap">
                        <PaidVia entry={entry} />
                      </TableCell>
                    )}
                    <TableCell>{entry.projectName}</TableCell>
                    <TableCell>{entry.partyName}</TableCell>
                    {(isVerificationStep || (dynamicIndex === 0 && tabKey !== 'pending')) && (
                      <TableCell>{entry.receivedByName || 'N/A'}</TableCell>
                    )}
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(entry.netAmount)}</TableCell>
                    {isPaymentStep && (() => {
                      // Paid through Bank Balance vouchers (paidAmount), or marked Paid here in full.
                      const paid = paidOf(entry);
                      const balance = balanceOf(entry);
                      return (
                        <>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{paid ? formatCurrency(paid) : '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {formatCurrency(balance)}
                            {entry.status === 'Partially Paid' && <span className="block text-[11px] text-sky-700">Part paid</span>}
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
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    No entries found.
                  </TableCell>
                </TableRow>
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
          <Button size="sm" onClick={() => handleOpenVerifyDialog(entry)} disabled={!canVerify}>
            {tabKey === 'pending' ? 'Verify' : 'Review & Verify'}
          </Button>
        );
      }
      // Verified tab: re-verify and return dropdown
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
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
              <Button variant="ghost" size="icon" className="h-8 w-8">
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

  // Total workflow stages (Entry Sheet is separate and not counted here)
  const totalSteps = workflowSteps.length;
  const stageNumber = dynamicIndex + 1;

  // What each tab holds in rupees. On the payment step's Pending tab that is what is still due,
  // since part-paid requisitions sit there too.
  const tabAmount = (tabKey: string) =>
    (tabEntries[tabKey] || []).reduce((sum, entry) => {
      if (dynamicIndex === 2 && tabKey === 'pending') return sum + balanceOf(entry);
      return sum + (entry.netAmount || 0);
    }, 0);

  // Kept across the refresh after an action, which re-mounts the tabs behind the loading skeleton.
  const tabValue = stepConfig.tabs.some((tab) => tab.key === activeTab) ? activeTab : stepConfig.tabs[0]?.key;
  const markPaidTotal = markPaidTargets.reduce((sum, entry) => sum + (entry.netAmount || 0), 0);
  const markPaidLeftOut = selectedEntries.filter(
    (entry) => entry.status === 'Partially Paid' || (entry.status === 'Received for Payment' && !isManuallyPayable(entry)),
  ).length;

  return (
    <>
      <div className={`${dailyPageContainerClass} space-y-4`}>
        {/* One compact header: title, stage and a one-line purpose. The counts live on the tabs. */}
        <PageHeader
          backHref="/daily-requisition"
          eyebrow="Daily Requisition"
          title={currentStep.name}
          badge={
            <Badge variant="neutral">
              Stage {stageNumber} of {totalSteps}
            </Badge>
          }
          description={stepConfig.description}
        />

        <Tabs
          value={tabValue}
          onValueChange={(value) => {
            setActiveTab(value);
            setSelectedIds(new Set());
          }}
        >
          {/* Tabs (with count and amount) and search share one row */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className={`${dailyTabsListClass} flex w-full overflow-x-auto lg:inline-flex lg:w-auto`}>
              {stepConfig.tabs.map((tab, i) => (
                <TabsTrigger key={tab.key} value={tab.key} className="flex-1 whitespace-nowrap px-4 py-1.5 lg:flex-none" title={stepConfig.metricHints[i] || undefined}>
                  <span>{tab.label}</span>
                  <span className="ml-1.5 rounded-full bg-black/5 px-1.5 text-xs font-semibold tabular-nums">{(tabEntries[tab.key] || []).length}</span>
                  <span className="ml-1.5 hidden text-xs font-normal tabular-nums opacity-80 sm:inline">{formatCurrency(tabAmount(tab.key))}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            <SearchInput
              className="w-full lg:w-96"
              placeholder="Search reception or request no., project, party…"
              value={searchTerm}
              onChange={setSearchTerm}
            />
          </div>

          {stepConfig.tabs.map((tab) => (
            <TabsContent key={tab.key} value={tab.key} className="mt-3">
              {renderTable(tab.key, tab)}
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
          onSuccess={fetchData}
        />
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
        {entry.paidByName && <span className="block text-[11px] text-muted-foreground">by {entry.paidByName}</span>}
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
