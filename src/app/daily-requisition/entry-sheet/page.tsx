
'use client';

import React, { Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, Plus, ArrowUpDown, MoreHorizontal, Calendar as CalendarIcon, Loader2, Search, Eye, FileText, Edit, Trash2, ShieldAlert, Printer, File as FileIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import type { DailyRequisitionEntry, Project, Department, SerialNumberConfig, ExpenseRequest, User, Attachment } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle as DialogTitleShad, DialogDescription as DialogDescriptionShad, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, runTransaction, Timestamp, query, where, orderBy, deleteDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { format, parseISO, isSameDay } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import ViewDailyRequisitionDialog from '@/components/ViewDailyRequisitionDialog';
import { ChecklistDialog } from '@/components/ChecklistDialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { Separator } from '@/components/ui/separator';


interface EnrichedDailyRequisitionEntry extends DailyRequisitionEntry {
  originalDate: string;
}

const initialFormState = {
  receptionNo: '',
  depNo: '',
  date: new Date(),
  description: '',
  partyName: '',
  projectId: '',
  departmentId: '',
  grossAmount: '',
  netAmount: '',
};

type SortKey = keyof DailyRequisitionEntry | '';

const PrintableChecklists = React.forwardRef<HTMLDivElement, { entries: EnrichedDailyRequisitionEntry[], projects: Project[], expenses: ExpenseRequest[], user: User | null }>((props, ref) => {
    const { entries, projects, expenses, user } = props;
    if (!entries || entries.length === 0) return null;
    
    return (
        <div ref={ref} className="printable-area">
            {entries.map((entry, index) => {
                const project = projects.find(p => p.id === entry.projectId);
                const expenseRequest = expenses.find(e => e.requestNo === entry.depNo);
                const entryDate = entry.date && (entry.date as any).toDate 
                    ? format((entry.date as any).toDate(), 'MMMM do, yyyy')
                    : String(entry.date);
                return (
                    <div key={entry.id} className="p-6 border rounded-lg break-after-page bg-white text-black" style={{ pageBreakAfter: index < entries.length - 1 ? 'always' : 'auto' }}>
                        <div className="text-center mb-4">
                            <h2 className="text-xl font-bold">SIDDHARTHA ENGINEERING LIMITED</h2>
                            <p className="text-sm font-medium">Nayapalli, Bhubaneswar</p>
                        </div>
                        <h3 className="text-lg font-semibold text-center mb-4 underline">Check List for Payment</h3>
                        
                        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm mb-4">
                            <div className="flex">
                                <span className="font-medium w-32 shrink-0">Reception No:</span>
                                <span>{entry.receptionNo}</span>
                            </div>
                             <div className="flex">
                                <span className="font-medium w-32 shrink-0">Reception Date:</span>
                                <span>{entryDate}</span>
                            </div>
                            <div className="flex">
                                <span className="font-medium w-32 shrink-0">DEP No:</span>
                                <span>{entry.depNo}</span>
                            </div>
                            <div className="flex">
                                <span className="font-medium w-32 shrink-0">Project Name:</span>
                                <span>{project?.projectName || 'N/A'}</span>
                            </div>
                        </div>

                        <Separator className="my-4 bg-gray-400" />

                        <div className="grid grid-cols-2 gap-x-8 text-sm mb-2">
                            <div className="flex">
                                <span className="font-medium w-32 shrink-0">Name of the party:</span>
                                <span className="font-semibold">{entry.partyName}</span>
                            </div>
                             <div className="flex gap-x-4">
                                <div className="flex"><span className="font-medium w-24 shrink-0">Gross Amount:</span><span>{entry.grossAmount.toLocaleString()}</span></div>
                                <div className="flex"><span className="font-medium w-24 shrink-0">Net Amount:</span><span>{entry.netAmount.toLocaleString()}</span></div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-x-8 text-sm mb-4">
                            <div className="flex">
                                <span className="font-medium w-32 shrink-0">Head of A/c:</span>
                                <span>{expenseRequest?.headOfAccount || 'N/A'}</span>
                            </div>
                             <div className="flex">
                                <span className="font-medium w-32 shrink-0">Sub-Head of A/c:</span>
                                <span>{expenseRequest?.subHeadOfAccount || 'N/A'}</span>
                            </div>
                        </div>

                        <div className="space-y-2 text-sm mb-8">
                            <p className="font-medium">Description:</p>
                            <p className="pl-4 min-h-[50px]">{entry.description}</p>
                        </div>
                        
                        <div className="mt-24 grid grid-cols-2 gap-x-24 gap-y-16 text-sm">
                            <div className="border-t border-black pt-1">Prepared by</div>
                            <div className="border-t border-black pt-1">Authorised by</div>
                            <div className="border-t border-black pt-1">Checked by</div>
                            <div className="border-t border-black pt-1">Approved by</div>
                            <div className="border-t border-black pt-1">Verified by</div>
                            <div className="border-t border-black pt-1">A/c Dept</div>
                        </div>

                        <div className="mt-24 flex justify-between text-xs text-gray-500">
                            <div>
                                <span className="font-medium">Printed By:</span>
                                <span> {user?.name || 'N/A'}</span>
                            </div>
                             <div>
                                <span className="font-medium">Timestamp:</span>
                                <span> {format(new Date(), 'dd-MMM-yyyy HH:mm:ss')}</span>
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
});
PrintableChecklists.displayName = 'PrintableChecklists';


export default function EntrySheetPage() {
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
  
  const [formState, setFormState] = React.useState(initialFormState);
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
  
  const [isChecklistOpen, setIsChecklistOpen] = React.useState(false);
  const [checklistData, setChecklistData] = React.useState<{entry: DailyRequisitionEntry, project?: Project, expenseRequest?: ExpenseRequest} | null>(null);
  
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = React.useState(false);
  const printComponentRef = React.useRef<HTMLDivElement>(null);
  
  const canViewPage = can('View', 'Daily Requisition.Entry Sheet');
  const canAdd = can('Add', 'Daily Requisition.Entry Sheet');
  const canEdit = can('Edit', 'Daily Requisition.Entry Sheet');
  const canDelete = can('Delete', 'Daily Requisition.Entry Sheet');
  const canViewChecklist = can('View Checklist', 'Daily Requisition.Entry Sheet');


  const fetchAllData = React.useCallback(async () => {
      setIsLoading(true);
      try {
        const [projectsSnap, deptsSnap, configSnap, expensesSnap, requisitionsSnap] = await Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'departments')),
          getDoc(doc(db, 'serialNumberConfigs', 'daily-requisition')),
          getDocs(query(collection(db, 'expenseRequests'))),
          getDocs(query(collection(db, 'dailyRequisitions'), orderBy('createdAt', 'desc')))
        ]);

        setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
        setExpenseRequests(expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseRequest)));
        setEntries(requisitionsSnap.docs.map(doc => {
            const data = doc.data();
            const dateObject = data.date.toDate();
            return {
                id: doc.id,
                ...data,
                date: format(dateObject, 'MMMM do, yyyy'),
                originalDate: dateObject.toISOString(), // Store original date
                createdAt: format(data.createdAt.toDate(), 'dd MMM, yyyy HH:mm'),
            } as EnrichedDailyRequisitionEntry
        }));

        if (configSnap.exists()) {
          const config = configSnap.data() as SerialNumberConfig;
          const formattedIndex = String(config.startingIndex).padStart(4, '0');
          const receptionNo = `${config.prefix}${config.format}${formattedIndex}${config.suffix}`;
          setFormState(prev => ({ ...prev, receptionNo }));
        } else {
          setFormState(prev => ({ ...prev, receptionNo: 'SEL\\REC\\2025-26\\7340' })); // Fallback
        }

      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: 'Error', description: 'Failed to load necessary data.', variant: 'destructive' });
      }
      setIsLoading(false);
  }, [toast]);

  React.useEffect(() => {
    if (!isAuthLoading) {
        if(canViewPage) {
            fetchAllData();
        } else {
            setIsLoading(false);
        }
    }
  }, [isAuthLoading, canViewPage, fetchAllData]);
  
  const unassignedExpenseRequests = React.useMemo(() => {
    return expenseRequests.filter(req => !req.receptionNo);
  }, [expenseRequests]);


  const handleFormChange = (field: keyof typeof formState, value: any) => {
    setFormState(prev => ({ ...prev, [field]: value }));
  };

  const handleDepNoSelect = (value: string) => {
    const selectedRequest = unassignedExpenseRequests.find(req => req.requestNo === value);
    if (selectedRequest) {
        setFormState(prev => ({
            ...prev,
            depNo: selectedRequest.requestNo,
            description: selectedRequest.description || '',
            partyName: selectedRequest.partyName || '',
            projectId: selectedRequest.projectId || '',
            departmentId: selectedRequest.departmentId || '',
            grossAmount: String(selectedRequest.amount || ''),
            netAmount: String(selectedRequest.amount || ''), 
        }));
    } else {
        setFormState(prev => ({
            ...prev,
            depNo: value,
        }));
    }
  };
  
   const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        setSelectedFiles(Array.from(e.target.files));
      }
  };

  const handleAddEntry = async () => {
    if (!user) {
        toast({ title: 'Authentication Error', description: 'User not found.', variant: 'destructive'});
        return;
    }
    setIsSaving(true);
    const configRef = doc(db, 'serialNumberConfigs', 'daily-requisition');
    const selectedExpenseRequest = expenseRequests.find(req => req.requestNo === formState.depNo);

    try {
        let generatedReceptionNo = '';

        await runTransaction(db, async (transaction) => {
            const configDoc = await transaction.get(configRef);
            if (!configDoc.exists()) throw new Error("Serial number configuration not found!");
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
            depNo: formState.depNo,
            date: Timestamp.fromDate(formState.date),
            projectId: formState.projectId,
            departmentId: formState.departmentId,
            description: formState.description,
            partyName: formState.partyName,
            grossAmount: parseFloat(formState.grossAmount) || 0,
            netAmount: parseFloat(formState.netAmount) || 0,
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
                receptionDate: format(formState.date, 'yyyy-MM-dd'),
            });
        }
        
        await batch.commit();

        await logUserActivity({
            userId: user.id,
            action: 'Create Daily Requisition',
            details: {
                receptionNo: generatedReceptionNo,
                partyName: formState.partyName,
                amount: formState.netAmount,
            },
        });

        toast({ title: 'Success', description: 'New entry added to the database.' });
        setIsAddDialogOpen(false);
        
        setFormState(initialFormState);
        setSelectedFiles([]);
        fetchAllData();

    } catch (error: any) {
        console.error("Error in transaction:", error);
        toast({ title: 'Save Failed', description: error.message || 'An error occurred while saving the entry.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };

  const handleOpenEditDialog = (entry: EnrichedDailyRequisitionEntry) => {
    setEditingEntry(entry);
    setFormState({
        receptionNo: entry.receptionNo,
        depNo: entry.depNo,
        date: parseISO(entry.originalDate),
        description: entry.description,
        partyName: entry.partyName,
        projectId: entry.projectId,
        departmentId: entry.departmentId,
        grossAmount: String(entry.grossAmount),
        netAmount: String(entry.netAmount),
    });
    setIsEditDialogOpen(true);
  };
  
  const handleUpdateEntry = async () => {
    if (!editingEntry) return;
    setIsSaving(true);
    try {
        const entryRef = doc(db, 'dailyRequisitions', editingEntry.id);
        const updatedData = {
            date: Timestamp.fromDate(formState.date),
            projectId: formState.projectId,
            departmentId: formState.departmentId,
            description: formState.description,
            partyName: formState.partyName,
            grossAmount: parseFloat(formState.grossAmount) || 0,
            netAmount: parseFloat(formState.netAmount) || 0,
        };
        await updateDoc(entryRef, updatedData);
        toast({ title: 'Success', description: 'Entry updated successfully.' });
        setIsEditDialogOpen(false);
        setEditingEntry(null);
        fetchAllData();
    } catch(error) {
        console.error("Error updating entry:", error);
        toast({ title: 'Update Failed', description: 'An error occurred while updating the entry.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  }

  const handleDeleteEntry = async (entry: EnrichedDailyRequisitionEntry) => {
      try {
          const batch = writeBatch(db);

          // Find and update the associated expense request
          if (entry.depNo) {
            const expenseQuery = query(collection(db, 'expenseRequests'), where('requestNo', '==', entry.depNo));
            const expenseSnap = await getDocs(expenseQuery);
            if (!expenseSnap.empty) {
                const expenseDocRef = expenseSnap.docs[0].ref;
                batch.update(expenseDocRef, {
                    receptionNo: '',
                    receptionDate: ''
                });
            }
          }

          // Delete the daily requisition entry
          const entryRef = doc(db, 'dailyRequisitions', entry.id);
          batch.delete(entryRef);
          
          await batch.commit();

          toast({ title: 'Success', description: 'Entry deleted and expense request updated.' });
          fetchAllData();
      } catch (error) {
          console.error("Error deleting entry:", error);
          toast({ title: 'Delete Failed', description: 'An error occurred while deleting the entry.', variant: 'destructive' });
      }
  }
  
  const filteredEntries = React.useMemo(() => {
    let sortedEntries = [...entries];
    if (sortKey) {
      sortedEntries.sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDirection === 'asc' ? valA - valB : valB - a;
        }
        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortedEntries.filter(entry => 
      Object.values(entry).some(value => 
        String(value).toLowerCase().includes(filterText.toLowerCase())
      ) &&
      (!dateFilter || isSameDay(new Date(entry.originalDate), dateFilter))
    );

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
      setChecklistData({
          entry: entry,
          project: projects.find(p => p.id === entry.projectId),
          expenseRequest: expenseRequests.find(req => req.requestNo === entry.depNo),
      });
      setIsChecklistOpen(true);
  }
  
  const handlePrintSelected = () => {
    if (printComponentRef.current) {
        const printWindow = window.open(`/daily-requisition/entry-sheet/${selectedIds.values().next().value}/print`, '_blank');
        printWindow?.addEventListener('load', () => {
            printWindow?.print();
        });
    }
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }

  const selectedEntriesToPrint = React.useMemo(() => {
    return entries.filter(entry => selectedIds.has(entry.id));
  }, [entries, selectedIds]);

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
        setSelectedIds(new Set(paginatedEntries.map(e => e.id)));
    } else {
        setSelectedIds(new Set());
    }
  };
  
  const handleSelectRow = (id: string, checked: boolean) => {
    const newSelectedIds = new Set(selectedIds);
    if(checked) {
        newSelectedIds.add(id);
    } else {
        newSelectedIds.delete(id);
    }
    setSelectedIds(newSelectedIds);
  };

  const renderFormFields = (isEdit = false) => (
      <>
        <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="partyName">Party Name</Label>
            <Input id="partyName" placeholder="Enter party name..." value={formState.partyName} onChange={(e) => handleFormChange('partyName', e.target.value)} />
          </div>
          <div className="space-y-2">
              <Label htmlFor="project">Project Name</Label>
              <Select value={formState.projectId} onValueChange={(value) => handleFormChange('projectId', value)} disabled={!!formState.depNo && !isEdit}>
                  <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
                  <SelectContent>
                      {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                  </SelectContent>
              </Select>
          </div>
        </div>
        <div className="col-span-1 md:col-span-3 space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" placeholder="Short description" value={formState.description} onChange={(e) => handleFormChange('description', e.target.value)} />
        </div>
        <div className="space-y-2">
            <Label htmlFor="department">Department</Label>
            <Select value={formState.departmentId} onValueChange={(value) => handleFormChange('departmentId', value)} disabled={!!formState.depNo && !isEdit}>
                <SelectTrigger><SelectValue placeholder="Select a department" /></SelectTrigger>
                <SelectContent>
                    {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
        <div className="space-y-2">
            <Label htmlFor="grossAmount">Gross Amount</Label>
            <Input id="grossAmount" type="number" value={formState.grossAmount} onChange={(e) => handleFormChange('grossAmount', e.target.value)} />
        </div>
        <div className="space-y-2">
            <Label htmlFor="netAmount">Net Amount</Label>
            <Input id="netAmount" type="number" value={formState.netAmount} onChange={(e) => handleFormChange('netAmount', e.target.value)} />
        </div>
         {!isEdit && (
          <div className="md:col-span-3 space-y-2">
            <Label htmlFor="attachments">Attachments</Label>
            <Input id="attachments" type="file" multiple onChange={handleFileChange} />
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
        )}
      </>
  );

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
        <Card><CardContent><Skeleton className="h-96 w-full" /></CardContent></Card>
      </div>
    );
  }

  if (!canViewPage) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href="/daily-requisition"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
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
                    <Button variant="outline" onClick={() => setIsSelectionMode(false)}>Cancel Selection</Button>
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
                      variant={"outline"}
                      className={cn(
                      "w-[240px] justify-start text-left font-normal",
                      !dateFilter && "text-muted-foreground"
                      )}
                  >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateFilter ? format(dateFilter, "PPP") : "Filter by date"}
                  </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                      mode="single"
                      selected={dateFilter}
                      onSelect={setDateFilter}
                      initialFocus
                  />
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
                    {headers.map(header => (
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
                    <TableRow key={entry.id} data-state={selectedIds.has(entry.id) ? "selected" : ""}>
                      {isSelectionMode && (
                        <TableCell>
                          <Checkbox
                              checked={selectedIds.has(entry.id)}
                              onCheckedChange={(checked) => handleSelectRow(entry.id, !!checked)}
                          />
                        </TableCell>
                      )}
                      <TableCell>{entry.createdAt}</TableCell>
                      <TableCell>{entry.receptionNo}</TableCell>
                      <TableCell>{entry.date}</TableCell>
                      <TableCell>{projects.find(p => p.id === entry.projectId)?.projectName || entry.projectId}</TableCell>
                      <TableCell>{departments.find(d => d.id === entry.departmentId)?.name || entry.departmentId}</TableCell>
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
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                                  <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleViewDetails(entry); }}>
                                  <Eye className="mr-2 h-4 w-4" /> View Details
                              </DropdownMenuItem>
                              {canViewChecklist && (
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleViewChecklist(entry); }}>
                                    <FileText className="mr-2 h-4 w-4" /> View Checklist
                                </DropdownMenuItem>
                              )}
                              {canEdit && (
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleOpenEditDialog(entry); }}>
                                  <Edit className="mr-2 h-4 w-4" /> Edit
                                </DropdownMenuItem>
                              )}
                              {canDelete && (
                                <AlertDialogTrigger asChild>
                                    <DropdownMenuItem className="text-destructive" onClick={(e) => e.stopPropagation()}>
                                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                                    </DropdownMenuItem>
                                </AlertDialogTrigger>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                           <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>This will permanently delete the entry. This action cannot be undone.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDeleteEntry(entry)}>Delete</AlertDialogAction>
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
          <p className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</p>
          <div className="space-x-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage === 1}>Previous</Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage === totalPages}>Next</Button>
          </div>
        </div>
      </div>
      
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitleShad>Add New Entry</DialogTitleShad>
            <DialogDescriptionShad>Fill in the details for the new requisition entry.</DialogDescriptionShad>
          </DialogHeader>
          {isLoading ? <Loader2 className="mx-auto my-12 h-8 w-8 animate-spin" /> : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
                  <div className="space-y-2">
                      <Label htmlFor="reception-no">Reception No.</Label>
                      <Input id="reception-no" value={formState.receptionNo} readOnly />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="dep-no">DEP No. (Expense Request)</Label>
                      <Select value={formState.depNo} onValueChange={handleDepNoSelect}>
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
                  <div className="space-y-2">
                      <Label htmlFor="date">Reception Date</Label>
                       <Popover>
                          <PopoverTrigger asChild>
                          <Button
                              variant={"outline"}
                              className={cn("w-full justify-start text-left font-normal", !formState.date && "text-muted-foreground")}
                          >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {formState.date ? format(formState.date, "PPP") : <span>Pick a date</span>}
                          </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start" onPointerDownOutside={(e) => e.preventDefault()}>
                          <Calendar
                              mode="single"
                              selected={formState.date}
                              onSelect={(date) => date && handleFormChange('date', date)}
                              initialFocus
                          />
                          </PopoverContent>
                      </Popover>
                  </div>
                   {renderFormFields()}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" onClick={() => { setSelectedFiles([]); }}>Cancel</Button>
                </DialogClose>
                <Button onClick={handleAddEntry} disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add Entry
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitleShad>Edit Entry: {editingEntry?.receptionNo}</DialogTitleShad>
            <DialogDescriptionShad>Update the details of the requisition entry.</DialogDescriptionShad>
          </DialogHeader>
           {isLoading ? <Loader2 className="mx-auto my-12 h-8 w-8 animate-spin" /> : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
                  <div className="space-y-2">
                      <Label>Reception No.</Label>
                      <Input value={formState.receptionNo} readOnly />
                  </div>
                  <div className="space-y-2">
                      <Label>DEP No.</Label>
                      <Input value={formState.depNo} readOnly />
                  </div>
                  <div className="space-y-2">
                      <Label>Reception Date</Label>
                       <Popover>
                          <PopoverTrigger asChild>
                          <Button
                              variant={"outline"}
                              className={cn("w-full justify-start text-left font-normal", !formState.date && "text-muted-foreground")}
                          >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {formState.date ? format(formState.date, "PPP") : <span>Pick a date</span>}
                          </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start" onPointerDownOutside={(e) => e.preventDefault()}>
                          <Calendar
                              mode="single"
                              selected={formState.date}
                              onSelect={(date) => date && handleFormChange('date', date)}
                              initialFocus
                          />
                          </PopoverContent>
                      </Popover>
                  </div>
                   {renderFormFields(true)}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={handleUpdateEntry} disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      
      {selectedEntry && (
        <ViewDailyRequisitionDialog
            isOpen={isViewDialogOpen}
            onOpenChange={setIsViewDialogOpen}
            entry={selectedEntry}
            project={projects.find(p => p.id === selectedEntry.projectId)}
            department={departments.find(d => d.id === selectedEntry.departmentId)}
            expenseRequest={expenseRequests.find(req => req.requestNo === selectedEntry.depNo)}
            onActionComplete={fetchAllData}
        />
      )}

      {checklistData && (
        <ChecklistDialog
            isOpen={isChecklistOpen}
            onOpenChange={setIsChecklistOpen}
            entry={checklistData.entry}
            project={checklistData.project}
            expenseRequest={checklistData.expenseRequest}
        />
      )}
    </>
  );
}
