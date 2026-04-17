'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, notFound } from 'next/navigation';
import {
  Search,
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
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, writeBatch, Timestamp, query, where, updateDoc } from 'firebase/firestore';
import type { DailyRequisitionEntry, Project, User, WorkflowStep } from '@/lib/types';
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
import { GstTdsVerificationDialog } from '@/components/GstTdsVerificationDialog';
import {
  DailyMetricCard,
  DailyPageHeader,
  dailyPageContainerClass,
  dailySurfaceCardClass,
  dailyTableHeaderClass,
  dailyTabsListClass,
} from '@/components/daily-requisition/module-shell';

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
        queryStatuses: ['Received for Payment', 'Paid'],
        tabs: [
          { key: 'pending', label: 'Pending', statuses: ['Received for Payment'], showBulkCheckbox: true },
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

export default function DynamicWorkflowStepPage() {
  const params = useParams();
  const stepSlug = (params?.step as string) ?? '';
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  /* ── workflow state ── */
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [currentStep, setCurrentStep] = useState<WorkflowStep | null>(null);
  const [dynamicIndex, setDynamicIndex] = useState<number>(-1);
  const [workflowLoading, setWorkflowLoading] = useState(true);
  const [workflowNotFound, setWorkflowNotFound] = useState(false);

  /* ── entries state ── */
  const [entries, setEntries] = useState<EnrichedEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  /** Generic batch status update */
  const handleBatchStatusUpdate = async (ids: string[], newStatus: string, extraFields?: Record<string, any>) => {
    if (ids.length === 0) return;
    try {
      const batch = writeBatch(db);
      ids.forEach((id) => {
        const docRef = doc(db, 'dailyRequisitions', id);
        const updateData: Record<string, any> = { status: newStatus, ...extraFields };

        // Auto-populate timestamp fields based on status
        if (newStatus === 'Received') {
          updateData.receivedAt = Timestamp.now();
          updateData.receivedById = user?.id;
        } else if (newStatus === 'Paid') {
          updateData.paidAt = Timestamp.now();
        } else if (newStatus === 'Pending') {
          updateData.receivedAt = null;
          updateData.receivedById = null;
        }

        batch.update(docRef, updateData);
      });
      await batch.commit();
      toast({ title: 'Success', description: `${ids.length} entries updated to "${newStatus}".` });
      setSelectedIds(new Set());
      fetchData();
    } catch (error) {
      console.error('Error updating entries:', error);
      toast({ title: 'Error', description: `Failed to update entries.`, variant: 'destructive' });
    }
  };

  /** Return to previous step status (step-position aware) */
  const handleReturnToPending = async (entry: EnrichedEntry) => {
    try {
      const updateData: Record<string, any> =
        dynamicIndex === 0
          ? { status: 'Pending', receivedAt: null, receivedById: null }
          : dynamicIndex === 1
            ? {
                status: 'Received',
                verifiedAt: null,
                igstAmount: 0,
                tdsAmount: 0,
                cgstAmount: 0,
                sgstAmount: 0,
                retentionAmount: 0,
                otherDeduction: 0,
                verificationNotes: '',
                gstNo: '',
              }
            : { status: 'Pending' };

      await updateDoc(doc(db, 'dailyRequisitions', entry.id), updateData);
      toast({ title: 'Success', description: `${entry.receptionNo} returned to previous stage.` });
      fetchData();
    } catch (error) {
      console.error('Error returning entry:', error);
      toast({ title: 'Error', description: 'Failed to return the entry.', variant: 'destructive' });
    }
  };

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

  /** Whether the user can perform the current step's bulk action */
  const canBulkAction = useMemo(() => {
    if (!stepConfig?.bulkAction) return false;
    switch (dynamicIndex) {
      case 0: return canMarkAsReceived;
      case 1: return canSendForPayment;
      case 2: return canMarkAsPaid;
      default: return true;
    }
  }, [dynamicIndex, canMarkAsReceived, canSendForPayment, canMarkAsPaid, stepConfig]);

  /* ──────────── 5 ─ filtered entry sets per tab ──────────── */

  const tabEntries = useMemo(() => {
    if (!stepConfig) return {};
    const map: Record<string, EnrichedEntry[]> = {};
    const t = searchTerm.toLowerCase();

    stepConfig.tabs.forEach((tab) => {
      map[tab.key] = entries.filter(
        (entry) =>
          tab.statuses.includes(entry.status) &&
          (entry.receptionNo.toLowerCase().includes(t) ||
            entry.projectName.toLowerCase().includes(t) ||
            (entry.partyName || '').toLowerCase().includes(t) ||
            (entry.receivedByName || '').toLowerCase().includes(t))
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

    return (
      <Card className={dailySurfaceCardClass}>
        <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-70" />

        {/* Bulk action header for applicable tabs */}
        {isBulkTab && stepConfig?.bulkAction && (
          <div className="flex items-center justify-between border-b border-white/60 px-4 py-4 sm:px-5">
            <p className="text-sm text-slate-500">
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select entries for bulk action'}
            </p>
            <Button
              onClick={() =>
                handleBatchStatusUpdate(Array.from(selectedIds), stepConfig.bulkAction!.newStatus)
              }
              disabled={selectedIds.size === 0 || !canBulkAction}
            >
              <Check className="mr-2 h-4 w-4" />
              {stepConfig.bulkAction.label} ({selectedIds.size})
            </Button>
          </div>
        )}

        {/* Verified tab header for GST step - Send for Payment */}
        {isVerificationStep && tabKey === 'verified' && (
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Verified Entries</CardTitle>
                <CardDescription>Entries successfully verified and ready to be sent for payment.</CardDescription>
              </div>
              <Button
                onClick={() =>
                  handleBatchStatusUpdate(Array.from(selectedIds), 'Received for Payment')
                }
                disabled={selectedIds.size === 0 || !canSendForPayment}
              >
                Send for Payment ({selectedIds.size})
              </Button>
            </div>
          </CardHeader>
        )}

        <CardContent className="p-0">
          <Table>
            <TableHeader className={dailyTableHeaderClass}>
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
                <TableHead>Project</TableHead>
                <TableHead>Party Name</TableHead>
                {/* Show "Received By" for GST step and non-pending tabs of step 0 */}
                {(isVerificationStep || (dynamicIndex === 0 && tabKey !== 'pending')) && (
                  <TableHead>Received By</TableHead>
                )}
                <TableHead className="text-right">Net Amount</TableHead>
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
                    className="hover:bg-slate-50/70"
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
                    <TableCell className="font-medium">{entry.receptionNo}</TableCell>
                    <TableCell>
                      {isPaymentStep && tabKey === 'paid'
                        ? entry.paidAtText || 'N/A'
                        : tabKey === 'pending' && dynamicIndex === 0
                          ? entry.dateText
                          : entry.receivedAtText ?? '—'}
                    </TableCell>
                    <TableCell>{entry.projectName}</TableCell>
                    <TableCell>{entry.partyName}</TableCell>
                    {(isVerificationStep || (dynamicIndex === 0 && tabKey !== 'pending')) && (
                      <TableCell>{entry.receivedByName || 'N/A'}</TableCell>
                    )}
                    <TableCell className="text-right">{formatCurrency(entry.netAmount)}</TableCell>

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
        </CardContent>
      </Card>
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
                  onSelect={() => handleBatchStatusUpdate([entry.id], 'Pending')}
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
                This will mark the entry as <b>Cancelled</b>. You can move it back to Pending later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Close</AlertDialogCancel>
              <AlertDialogAction onClick={() => handleBatchStatusUpdate([entry.id], 'Cancelled')}>
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
    return (
      <div className={dailyPageContainerClass}>
        <Skeleton className="mb-6 h-10 w-80" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
      </div>
    );
  }

  // Workflow step not found
  if (workflowNotFound || !currentStep || !stepConfig) {
    return (
      <div className={dailyPageContainerClass}>
        <DailyPageHeader
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
        <DailyPageHeader title={currentStep.name} description={stepConfig.description} />
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

  return (
    <>
      <div className={dailyPageContainerClass}>
        <DailyPageHeader
          title={currentStep.name}
          description={stepConfig.description}
          meta={
            <>
              <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-slate-600 backdrop-blur">
                Stage {stageNumber} of {totalSteps}
              </span>
              {stepConfig.tabs.length > 1 && (
                <span className="rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                  {(tabEntries[stepConfig.tabs[1]?.key] || []).length} {stepConfig.tabs[1]?.label.toLowerCase()}
                </span>
              )}
            </>
          }
        />

        {/* Metric cards */}
        <div className={`mb-6 grid gap-4 md:grid-cols-${Math.min(stepConfig.tabs.length, 4)}`}>
          {stepConfig.tabs.map((tab, i) => (
            <DailyMetricCard
              key={tab.key}
              label={tab.label}
              value={(tabEntries[tab.key] || []).length}
              hint={stepConfig.metricHints[i] || ''}
            />
          ))}
        </div>

        {/* Search */}
        <Card className="mb-6 rounded-2xl border border-white/70 bg-white/70 shadow-sm backdrop-blur">
          <CardContent className="p-4 sm:p-5">
            <div className="relative">
              <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by Reception No, Project, or Party Name..."
                className="h-11 border-white/70 bg-white/80 pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Tabbed view */}
        <Tabs defaultValue={stepConfig.tabs[0]?.key} onValueChange={() => setSelectedIds(new Set())}>
          <TabsList className={`${dailyTabsListClass} grid-cols-${stepConfig.tabs.length}`}>
            {stepConfig.tabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {tab.label} ({(tabEntries[tab.key] || []).length})
              </TabsTrigger>
            ))}
          </TabsList>

          {stepConfig.tabs.map((tab) => (
            <TabsContent key={tab.key} value={tab.key} className="mt-4">
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
    </>
  );
}
