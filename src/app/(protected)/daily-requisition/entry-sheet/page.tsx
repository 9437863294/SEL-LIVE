
'use client';
export const dynamic = 'force-dynamic';

import React, { Fragment, Suspense } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Upload,
  Plus,
  ArrowUpDown,
  MoreHorizontal,
  Calendar as CalendarIcon,
  Loader2,
  Search,
  Eye,
  FileText,
  Edit,
  Trash2,
  ShieldAlert,
  Printer,
  File as FileIcon,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
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
import { db, storage } from '@/lib/firebase';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  runTransaction,
  Timestamp,
  query,
  where,
  orderBy,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { format, parseISO, isSameDay } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import ViewDailyRequisitionDialog from '@/components/ViewDailyRequisitionDialog';
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
import { logUserActivity } from '@/lib/activity-logger';
import { Separator } from '@/components/ui/separator';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const toDate = (v: any): Date | undefined =>
  v?.toDate?.() instanceof Date
    ? v.toDate()
    : v instanceof Date
    ? v
    : typeof v === 'string' || typeof v === 'number'
    ? new Date(v)
    : undefined;

const fmt = (d?: Date, f = 'dd MMM, yyyy') => (d ? format(d, f) : '');

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

type SortKey = keyof DailyRequisitionEntry | '';

function EntrySheetPageComponent() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [entries, setEntries] = React.useState<EnrichedDailyRequisitionEntry[]>([]);
  const [sortKey, setSortKey] = React.useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('desc');
  const [filterText, setFilterText] = React.useState('');
  const [dateFilter, setDateFilter] = React.useState<Date>();

  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
  const [editingEntry, setEditingEntry] = React.useState<EnrichedDailyRequisitionEntry | null>(null);

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
            originalDate: dateD ? dateD.toISOString() : '',
            createdAtText: fmt(crAtD, 'dd MMM, yyyy HH:mm'),
            dateText: fmt(dateD, 'dd MMM, yyyy'),
            receivedAtText: fmt(recAtD, 'PPpp') || undefined,
            verifiedAtText: fmt(verAtD, 'PPpp') || undefined,
            paidAtText: fmt(paidAtD, 'PPpp') || undefined,
            documentStatusUpdatedAtText: fmt(updAtD, 'PPpp') || undefined,
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
    const selectedExpenseRequest = expenseRequests.find((req) => req.requestNo === data.depNo);

    try {
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

      await logUserActivity({
        userId: user.id,
        action: 'Create Daily Requisition',
        details: {
          receptionNo: generatedReceptionNo,
          partyName: data.partyName,
          amount: data.netAmount,
        },
      });

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

  const handleUpdateEntry = async (data: z.infer<typeof formSchema>) => {
    if (!editingEntry) return;
    setIsSaving(true);
    try {
      const entryRef = doc(db, 'dailyRequisitions', editingEntry.id);
      const updatedData = {
        date: Timestamp.fromDate(data.date),
        projectId: data.projectId,
        departmentId: data.departmentId,
        description: data.description,
        partyName: data.partyName,
        grossAmount: parseFloat(data.grossAmount) || 0,
        netAmount: parseFloat(data.netAmount) || 0,
      };
      await updateDoc(entryRef, updatedData);
      toast({ title: 'Success', description: 'Entry updated successfully.' });
      setIsEditDialogOpen(false);
      setEditingEntry(null);
      fetchAllData();
    } catch (error) {
      console.error('Error updating entry:', error);
      toast({
        title: 'Update Failed',
        description: 'An error occurred while updating the entry.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEntry = async (entry: EnrichedDailyRequisitionEntry) => {
    try {
      const batch = writeBatch(db);

      if (entry.depNo) {
        const expenseQuery = query(collection(db, 'expenseRequests'), where('requestNo', '==', entry.depNo));
        const expenseSnap = await getDocs(expenseQuery);
        if (!expenseSnap.empty) {
          const expenseDocRef = expenseSnap.docs[0].ref;
          batch.update(expenseDocRef, {
            receptionNo: '',
            receptionDate: '',
          });
        }
      }

      const entryRef = doc(db, 'dailyRequisitions', entry.id);
      batch.delete(entryRef);

      await batch.commit();

      toast({ title: 'Success', description: 'Entry deleted and expense request updated.' });
      fetchAllData();
    } catch (error) {
      console.error('Error deleting entry:', error);
      toast({
        title: 'Delete Failed',
        description: 'An error occurred while deleting the entry.',
        variant: 'destructive',
      });
    }
  };

  const filteredEntries = React.useMemo(() => {
    let sortedEntries = [...entries];
    if (sortKey) {
      sortedEntries.sort((a, b) => {
        const valA = a[sortKey] as any;
        const valB = b[sortKey] as any;

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
    return sortedEntries.filter((entry) => {
      const originalDate = new Date(entry.originalDate);
      return (
        Object.values(entry).some((value) => String(value).toLowerCase().includes(filterText.toLowerCase())) &&
        (!dateFilter || isSameDay(originalDate, dateFilter))
      );
    });
  }, [entries, sortKey, sortDirection, filterText, dateFilter]);

  const paginatedEntries = React.useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredEntries.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredEntries, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredEntries.length / itemsPerPage);

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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

  const headers: { key: SortKey; label: string }[] = [
    { key: 'createdAt', label: 'Created At' },
    { key: 'receptionNo', label: 'Reception No.' },
    { key: 'date', label: 'Date' },
    { key: 'projectId', label: 'Project' },
    { key: 'departmentId', label: 'Department' },
    { key: 'partyName', label: 'Party Name' },
    { key: 'description', label: 'Description' },
    { key: 'grossAmount', label: 'Gross Amount' },
    { key: 'netAmount', label: 'Net Amount' },
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
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-10" />
            <Skeleton className="h-8 w-48" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-36" />
            <Skeleton className="h-10 w-36" />
          </div>
        </div>
        <Card>
          <CardContent>
            <Skeleton className="h-96 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/daily-requisition">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Entry Sheet</h1>
        </div>
        <Card>
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
      <div className="w-full px-4 sm:px-6 lg:px-8 no-print">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/daily-requisition">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Entry Sheet</h1>
          </div>
          <div className="flex items-center gap-2">
            {isSelectionMode ? (
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
                <Button onClick={() => setIsAddDialogOpen(true)} disabled={!canAdd}>
                  <Plus className="mr-2 h-4 w-4" /> Add Entry
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Total Entries: {filteredEntries.length}</h2>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={'outline'}
                  className={cn('w-[240px] justify-start text-left font-normal', !dateFilter && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateFilter ? format(dateFilter, 'PPP') : 'Filter by date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={dateFilter} onSelect={setDateFilter} initialFocus />
              </PopoverContent>
            </Popover>
            <Input
              placeholder="Filter entries..."
              className="w-64"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
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
                      <TableHead key={header.key} onClick={() => handleSort(header.key)}>
                        <div className="flex items-center cursor-pointer">
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
                    {paginatedEntries.map((entry) => (
                      <TableRow key={entry.id} data-state={selectedIds.has(entry.id) ? 'selected' : ''}>
                        {isSelectionMode && (
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(entry.id)}
                              onCheckedChange={(checked) => handleSelectRow(entry.id, !!checked)}
                            />
                          </TableCell>
                        )}
                        <TableCell>{entry.createdAtText}</TableCell>
                        <TableCell>{entry.receptionNo}</TableCell>
                        <TableCell>{entry.dateText}</TableCell>
                        <TableCell>{projects.find((p) => p.id === entry.projectId)?.projectName || entry.projectId}</TableCell>
                        <TableCell>
                          {departments.find((d) => d.id === entry.departmentId)?.name || entry.departmentId}
                        </TableCell>
                        <TableCell>{entry.partyName}</TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger>
                              <p className="truncate max-w-xs">{entry.description}</p>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-md">{entry.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>{formatCurrency(entry.grossAmount)}</TableCell>
                        <TableCell>{formatCurrency(entry.netAmount)}</TableCell>
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
                                    <Edit className="mr-2 h-4 w-4" /> Edit
                                  </DropdownMenuItem>
                                )}
                                {canDelete && (
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete the entry. This action cannot be undone.
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
                    ))}
                  </TooltipProvider>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between space-x-2 py-4">
          <p className="text-sm text-muted-foreground">
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
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
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
                   <FormField control={form.control} name="date" render={({ field }) => (<FormItem className="space-y-2 flex flex-col"><FormLabel>Reception Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={'outline'} className={cn('w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}</Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage /></FormItem>)}/>
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
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleUpdateEntry)}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
                 <FormField control={editForm.control} name="receptionNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Reception No.</FormLabel><FormControl><Input {...field} readOnly /></FormControl><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="depNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>DEP No.</FormLabel><FormControl><Input {...field} readOnly /></FormControl><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="date" render={({ field }) => (<FormItem className="space-y-2 flex flex-col"><FormLabel>Reception Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={'outline'} className={cn('w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}</Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="partyName" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Party Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="projectId" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Project Name</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="description" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Description</FormLabel><FormControl><Textarea {...field}/></FormControl><FormMessage/></FormItem>)}/>
                 <FormField control={editForm.control} name="departmentId" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Department</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{departments.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="grossAmount" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Gross Amount</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                 <FormField control={editForm.control} name="netAmount" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Net Amount</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)}/>
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
          expenseRequest={expenseRequests.find((req) => req.requestNo === selectedEntry.depNo)}
          onActionComplete={fetchAllData}
        />
      )}
    </>
  );
}

export default function EntrySheetPage() {
    return (
        <Suspense fallback={<div className="w-full px-4 sm:px-6 lg:px-8"><Skeleton className="h-[80vh] w-full"/></div>}>
            <EntrySheetPageComponent />
        </Suspense>
    )
}