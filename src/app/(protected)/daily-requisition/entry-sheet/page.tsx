
'use client';
export const dynamic = 'force-dynamic';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DailyRequisitionImportDialog } from '@/components/daily-requisition/import-dialog';
import { requisitionFingerprint } from '@/lib/daily-requisition-import';
import {
  Plus,
  ArrowUpDown,
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
  X,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FilterBar } from '@/components/shared/filter-bar';
import { TableCard } from '@/components/shared/table-card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  DailyMetricCard,
  dailyPageContainerClass,
  dailySurfaceCardClass,
} from '@/components/daily-requisition/module-shell';
import { diffFields } from '@/lib/activity-logger';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { StatusBadge } from '@/components/shared/status-badge';
import {
  balanceOf,
  isPaymentLocked,
  paidOf,
  requisitionProgress,
  voucherHref,
} from '@/lib/requisition-progress';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { PageHeader } from '@/components/shared/page-header';

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

/** Why a requisition with money paid against it cannot be deleted, or have its figures changed. */
function paymentLockReason(entry: Pick<DailyRequisitionEntry, 'payments'>): string {
  const vouchers = Array.from(new Set((entry.payments ?? []).map((p) => p.voucherNo).filter(Boolean)));
  return vouchers.length
    ? `Paid through Bank Balance (${vouchers.join(', ')}). Reverse the voucher in the Cheque Register before changing or deleting it.`
    : 'Recorded as paid, so its figures belong to the payment record and it cannot be deleted.';
}

const lockedError = (message: string) => Object.assign(new Error(message), { locked: true });
const isLockedError = (error: unknown) => Boolean((error as { locked?: boolean } | null)?.locked);

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
      <Skeleton className="mb-4 h-10 w-72 max-w-full" />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
      </div>
      <Skeleton className="h-96 w-full rounded-2xl" />
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

  React.useEffect(() => {
    if (queryParam !== null) setFilterText(queryParam);
  }, [queryParam]);

  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false);
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
  const [itemsPerPage] = React.useState(25);

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
        const config = configSnap.data() as SerialNumberConfig;
        const formattedIndex = String(config.startingIndex).padStart(4, '0');
        const receptionNo = `${config.prefix}${config.format}${formattedIndex}${config.suffix}`;
        form.setValue('receptionNo', receptionNo);
      } else {
        form.setValue('receptionNo', 'SEL\\REC\\2025-26\\7340'); // Fallback
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
        grossAmount: String(selectedRequest.amount || ''),
        netAmount: String(selectedRequest.amount || ''),
      });
    } else {
      form.setValue('depNo', value);
    }
  };


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleAddEntry = async (data: z.infer<typeof formSchema>) => {
    if (!user) {
      toast({ title: 'Authentication Error', description: 'User not found.', variant: 'destructive' });
      return;
    }
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
        if (!configDoc.exists()) throw new Error('Serial number configuration not found!');
        const configData = configDoc.data() as SerialNumberConfig;
        const newIndex = configData.startingIndex;
        const formattedIndex = String(newIndex).padStart(4, '0');
        generatedReceptionNo = `${configData.prefix}${configData.format}${formattedIndex}${configData.suffix}`;
        transaction.update(configRef, { startingIndex: newIndex + 1 });
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
        title: isLockedError(error) ? 'Payment recorded' : 'Update Failed',
        description: isLockedError(error)
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
        title: isLockedError(error) ? 'Cannot delete a paid requisition' : 'Delete Failed',
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
    const onDay = (entry: EnrichedDailyRequisitionEntry) =>
      !dateFilter || isSameDay(new Date(entry.originalDate), dateFilter);
    const needle = filterText.trim().toLowerCase();
    if (!needle) return sortedEntries.filter(onDay);

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
    return matches.filter(onDay);
  }, [entries, sortKey, sortDirection, filterText, dateFilter, projectNameById, departmentNameById]);

  // A narrower filter must not leave the table on a page that no longer exists.
  React.useEffect(() => {
    setCurrentPage(1);
  }, [filterText, dateFilter]);

  const paginatedEntries = React.useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredEntries.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredEntries, currentPage, itemsPerPage]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / itemsPerPage));

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const handleViewDetails = (entry: DailyRequisitionEntry) => {
    setSelectedEntry(entry);
    setIsViewDialogOpen(true);
  };
  
  const handleViewChecklist = (entry: DailyRequisitionEntry) => {
    window.open(`/daily-requisition/entry-sheet/${entry.id}/print`, '_blank');
  };

  const handlePrintSelected = () => {
    const idsToPrint = Array.from(selectedIds).join(',');
    window.open(`/daily-requisition/entry-sheet/print?ids=${idsToPrint}`, '_blank');
  };

  const headers: { key: SortKey; label: string; numeric?: boolean }[] = [
    { key: 'createdAt', label: 'Created At' },
    { key: 'receptionNo', label: 'Reception No.' },
    { key: 'status', label: 'Status' },
    { key: 'date', label: 'Date' },
    { key: 'projectId', label: 'Project' },
    { key: 'departmentId', label: 'Department' },
    { key: 'partyName', label: 'Party Name' },
    { key: 'description', label: 'Description' },
    { key: 'grossAmount', label: 'Gross Amount', numeric: true },
    { key: 'netAmount', label: 'Net Amount', numeric: true },
    { key: 'paid', label: 'Paid', numeric: true },
    { key: 'balance', label: 'Balance', numeric: true },
  ];

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked) {
      setSelectedIds(new Set(paginatedEntries.map((e) => e.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    const newSelectedIds = new Set(selectedIds);
    if (checked) {
      newSelectedIds.add(id);
    } else {
      newSelectedIds.delete(id);
    }
    setSelectedIds(newSelectedIds);
  };

  if (isAuthLoading || isLoading) {
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
  
  return (
    <>
      <div className={`${dailyPageContainerClass} no-print`}>
        <PageHeader backHref="/daily-requisition" eyebrow="Daily Requisition"
          title="Entry Sheet"
          description="Create new entries, bulk-print checklists, and keep the front door of the workflow organized."
          meta={
            <>
              <Badge variant="neutral">Entry</Badge>
              <Badge variant="neutral">
                {filteredEntries.length} visible entries
              </Badge>
            </>
          }
          actions={
            isSelectionMode ? (
              <>
                <Button variant="outline" onClick={() => setIsSelectionMode(false)}>
                  Cancel Selection
                </Button>
                <Button onClick={handlePrintSelected} disabled={selectedIds.size === 0}>
                  <Printer className="mr-2 h-4 w-4" />
                  Confirm & Print ({selectedIds.size})
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setIsSelectionMode(true)} disabled={!canViewChecklist}>
                  <Printer className="mr-2 h-4 w-4" /> Print Checklists
                </Button>
                {/* Gated on Add, the same grant as keying one by hand — importing a register is
                    creating entries, and there is no separate power to invent for it. */}
                <Button variant="outline" onClick={() => setIsImportOpen(true)} disabled={!canAdd}>
                  <Upload className="mr-2 h-4 w-4" /> Import
                </Button>
                <Button onClick={() => setIsAddDialogOpen(true)} disabled={!canAdd}>
                  <Plus className="mr-2 h-4 w-4" /> Add Entry
                </Button>
              </>
            )
          }
        />

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <DailyMetricCard label="Visible Entries" value={filteredEntries.length} hint="Filtered result set" />
          <DailyMetricCard label="Selected" value={selectedIds.size} hint={isSelectionMode ? 'Checklist print mode' : 'No bulk action active'} />
          <DailyMetricCard label="Unassigned DEP" value={unassignedExpenseRequests.length} hint="Expense requests available to link" />
        </div>

        <TableCard
          title="Entries workspace"
          count={filteredEntries.length}
          toolbar={
            <FilterBar
              search={{ value: filterText, onChange: setFilterText, placeholder: 'Filter entries...' }}
              activeCount={dateFilter ? 1 : 0}
              onClear={() => { setFilterText(''); setDateFilter(undefined); }}
            >
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={'outline'}
                    className={cn('justify-start text-left font-normal', !dateFilter && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFilter ? format(dateFilter, 'dd MMM yyyy') : 'Filter by date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateFilter} onSelect={setDateFilter} initialFocus />
                </PopoverContent>
              </Popover>
            </FilterBar>
          }
          footer={
            <div className="flex items-center justify-between gap-2">
              <p>
                Page {currentPage} of {totalPages}
              </p>
              <div className="space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          }
        >
              <Table>
                <TableHeader>
                  <TableRow>
                    {isSelectionMode && (
                      <TableHead>
                        <Checkbox
                          checked={selectedIds.size > 0 && selectedIds.size === paginatedEntries.length}
                          onCheckedChange={handleSelectAll}
                          aria-label="Select all"
                        />
                      </TableHead>
                    )}
                    {headers.map((header) => (
                      <TableHead
                        key={header.key}
                        onClick={() => handleSort(header.key)}
                        className={cn('whitespace-nowrap', header.numeric && 'text-right')}
                      >
                        <div className={cn('flex cursor-pointer items-center', header.numeric && 'justify-end')}>
                          {header.label}
                          {sortKey === header.key && <ArrowUpDown className="ml-2 h-4 w-4" />}
                        </div>
                      </TableHead>
                    ))}
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TooltipProvider>
                    {paginatedEntries.map((entry) => {
                      const progress = requisitionProgress(entry);
                      const locked = isPaymentLocked(entry);
                      return (
                        <TableRow key={entry.id} data-state={selectedIds.has(entry.id) ? 'selected' : ''}>
                          {isSelectionMode && (
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(entry.id)}
                                onCheckedChange={(checked) => handleSelectRow(entry.id, !!checked)}
                              />
                            </TableCell>
                          )}
                          <TableCell className="whitespace-nowrap">{entry.createdAtText}</TableCell>
                          <TableCell className="whitespace-nowrap font-medium">{entry.receptionNo}</TableCell>
                          <TableCell>
                            <StatusBadge
                              tone={progress.tone}
                              title={entry.manualPaid ? 'Recorded as paid outside Bank Balance' : entry.status}
                            >
                              {progress.label}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{entry.dateText}</TableCell>
                          <TableCell>{projectNameById.get(entry.projectId) || entry.projectId}</TableCell>
                          <TableCell>{departmentNameById.get(entry.departmentId) || entry.departmentId}</TableCell>
                          <TableCell>{entry.partyName}</TableCell>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger>
                                <span className="block max-w-xs truncate">{entry.description}</span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-md">{entry.description}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {formatCurrency(entry.grossAmount)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {formatCurrency(entry.netAmount)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {progress.paid > 0 ? formatCurrency(progress.paid) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {progress.balance > 0 ? (
                              formatCurrency(progress.balance)
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <AlertDialog>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
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
                                  {canEdit && (
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenEditDialog(entry);
                                      }}
                                    >
                                      <Edit className="mr-2 h-4 w-4" /> {locked ? 'Edit description' : 'Edit'}
                                    </DropdownMenuItem>
                                  )}
                                  {canDelete &&
                                    (locked ? (
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
                                          {paymentLockReason(entry)}
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
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TooltipProvider>
                </TableBody>
              </Table>
        </TableCard>
      </div>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitleShad>Add New Entry</DialogTitleShad>
            <DialogDescriptionShad>Fill in the details for the new requisition entry.</DialogDescriptionShad>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleAddEntry)}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
                  <FormField control={form.control} name="receptionNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Reception No.</FormLabel><FormControl><Input {...field} readOnly /></FormControl><FormMessage /></FormItem>)}/>
                  <div className="space-y-2">
                    <Label htmlFor="dep-no">DEP No. (Expense Request)</Label>
                    <Select value={form.getValues('depNo')} onValueChange={handleDepNoSelect}>
                      <SelectTrigger>
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
                  </div>
                   <FormField control={form.control} name="date" render={({ field }) => (<FormItem className="space-y-2 flex flex-col"><FormLabel>Reception Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={'outline'} className={cn('w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, 'dd MMM yyyy') : <span>Pick a date</span>}</Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage /></FormItem>)}/>
                   <FormField control={form.control} name="partyName" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Party Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                   <FormField control={form.control} name="projectId" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Project Name</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select Project"/></SelectTrigger></FormControl><SelectContent>{projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)}/>
                   <FormField control={form.control} name="description" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Description</FormLabel><FormControl><Textarea {...field}/></FormControl><FormMessage/></FormItem>)}/>
                   <FormField control={form.control} name="departmentId" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Department</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select Department"/></SelectTrigger></FormControl><SelectContent>{departments.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)}/>
                   <FormField control={form.control} name="grossAmount" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Gross Amount</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                   <FormField control={form.control} name="netAmount" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Net Amount</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                  <div className="md:col-span-3 space-y-2">
                    <Label htmlFor="attachments">Attachments</Label>
                    <FormControl>
                        <Input id="attachments" type="file" multiple onChange={handleFileChange} />
                    </FormControl>
                     {selectedFiles.length > 0 && (
                          <div className="mt-2 space-y-2">
                              {selectedFiles.map((file, i) => (
                                  <div key={i} className="flex items-center justify-between p-2 bg-muted rounded-md">
                                      <div className="flex items-center gap-2">
                                          <FileIcon className="w-4 h-4" />
                                          <span className="text-sm">{file.name}</span>
                                      </div>
                                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedFiles(selectedFiles.filter((_, index) => index !== i))}>
                                          <X className="w-4 h-4" />
                                      </Button>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              </div>
              <DialogFooter>
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
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitleShad>Edit Entry: {editingEntry?.receptionNo}</DialogTitleShad>
            <DialogDescriptionShad>Update the details of the requisition entry.</DialogDescriptionShad>
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
                 <FormField control={editForm.control} name="receptionNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Reception No.</FormLabel><FormControl><Input {...field} readOnly /></FormControl><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="depNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>DEP No.</FormLabel><FormControl><Input {...field} readOnly /></FormControl><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="date" render={({ field }) => (<FormItem className="space-y-2 flex flex-col"><FormLabel>Reception Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={'outline'} disabled={editLocked} className={cn('w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, 'dd MMM yyyy') : <span>Pick a date</span>}</Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="partyName" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Party Name</FormLabel><FormControl><Input {...field} readOnly={editLocked} className={cn(editLocked && lockedFieldClass)} /></FormControl><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="projectId" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Project Name</FormLabel><Select onValueChange={field.onChange} value={field.value} disabled={editLocked}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="description" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Description</FormLabel><FormControl><Textarea {...field}/></FormControl><FormMessage/></FormItem>)}/>
                 <FormField control={editForm.control} name="departmentId" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Department</FormLabel><Select onValueChange={field.onChange} value={field.value} disabled={editLocked}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{departments.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="grossAmount" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Gross Amount</FormLabel><FormControl><Input type="number" {...field} readOnly={editLocked} className={cn(editLocked && lockedFieldClass)} /></FormControl><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="netAmount" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Net Amount</FormLabel><FormControl><Input type="number" {...field} readOnly={editLocked} className={cn(editLocked && lockedFieldClass)} /></FormControl><FormMessage /></FormItem>)}/>
              </div>
              <DialogFooter>
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

export default function EntrySheetPage() {
    return (
        // useSearchParams (the `?q=` filter) needs this boundary for the route to prerender.
        <Suspense fallback={<EntrySheetSkeleton />}>
            <EntrySheetPageComponent />
        </Suspense>
    )
}