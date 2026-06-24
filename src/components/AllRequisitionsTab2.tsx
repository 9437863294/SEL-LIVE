
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useForm, useFieldArray, type FieldArrayWithId } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MoreHorizontal, Calendar as CalendarIcon, Edit, Eye, Loader2, UploadCloud, File as FileIcon, X, View, Shuffle, Check, ChevronsUpDown, Download, AlertCircle, Paperclip, ArrowUpDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Textarea } from './ui/textarea';
import { collection, getDocs, addDoc, doc, getDoc, runTransaction, Timestamp, updateDoc, query, where, orderBy, setDoc } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { Project, Department, Requisition, SerialNumberConfig, WorkflowStep, ActionLog, Attachment, UserSettings, ColumnPref, ExpenseRequest } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from './auth/AuthProvider';
import { format, parseISO } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { cn } from '@/lib/utils';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import ViewRequisitionDialog from './ViewRequisitionDialog2';
import { Switch } from './ui/switch';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';


const formSchema = z.object({
  projectId: z.string().min(1, { message: 'Project is required.' }),
  departmentId: z.string().min(1, { message: 'Department is required.' }),
  amount: z.coerce.number().min(1, { message: 'Amount must be greater than 0.' }),
  partyName: z.string().min(1, { message: 'Party name is required.' }),
  description: z.string(),
  date: z.date({ required_error: "A date is required." }),
  attachments: z.custom<FileList>().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const baseTableHeaders = [
  'Request ID', 'Date', 'Project', 'Department', 'Entered By', 'Party Name',
  'Description', 'Amount', 'Stage', 'Status', 'Attachments', 'Expense Request No',
  'Reception No', 'Reception Date'
];

function normalizeColumnPrefs(
  input: Partial<Pick<ColumnPref, 'order' | 'visibility'>> | undefined
) {
  const incomingOrder = Array.isArray(input?.order) ? input!.order! : [];
  const incomingVisibility =
    input?.visibility && typeof input.visibility === 'object' ? input.visibility : {};

  const seen = new Set<string>();
  const normalizedOrder: string[] = [];

  for (const h of incomingOrder) {
    if (!baseTableHeaders.includes(h)) continue;
    if (seen.has(h)) continue;
    seen.add(h);
    normalizedOrder.push(h);
  }
  for (const h of baseTableHeaders) {
    if (seen.has(h)) continue;
    seen.add(h);
    normalizedOrder.push(h);
  }

  const normalizedVisibility: Record<string, boolean> = {};
  for (const h of baseTableHeaders) {
    const v = (incomingVisibility as Record<string, unknown>)[h];
    normalizedVisibility[h] = typeof v === 'boolean' ? v : true;
  }

  return { order: normalizedOrder, visibility: normalizedVisibility };
}

function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate && typeof value.toDate === 'function') {
    try {
      return value.toDate();
    } catch {
      // ignore
    }
  }
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
  return null;
}

function fyLabelForDate(d: Date) {
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-based
  const startYear = month >= 3 ? year : year - 1; // FY starts Apr (3)
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

function currentFyLabel(now = new Date()) {
  return fyLabelForDate(now);
}

const FY_MONTHS = [
  { value: '4', label: 'Apr' },
  { value: '5', label: 'May' },
  { value: '6', label: 'Jun' },
  { value: '7', label: 'Jul' },
  { value: '8', label: 'Aug' },
  { value: '9', label: 'Sep' },
  { value: '10', label: 'Oct' },
  { value: '11', label: 'Nov' },
  { value: '12', label: 'Dec' },
  { value: '1', label: 'Jan' },
  { value: '2', label: 'Feb' },
  { value: '3', label: 'Mar' },
];

function statusBadgeClass(status?: string) {
  switch (status) {
    case 'Completed':
      return 'border-emerald-200/80 bg-emerald-50 text-emerald-700';
    case 'Rejected':
      return 'border-rose-200/80 bg-rose-50 text-rose-700';
    case 'In Progress':
      return 'border-sky-200/80 bg-sky-50 text-sky-700';
    case 'Pending':
      return 'border-amber-200/80 bg-amber-50 text-amber-700';
    default:
      return 'border-slate-200/80 bg-slate-50 text-slate-700';
  }
}

export default function AllRequisitionsTab() {
  const [isNewRequestOpen, setIsNewRequestOpen] = useState(false);
  const [isEditRequestOpen, setIsEditRequestOpen] = useState(false);
  const [editingRequisition, setEditingRequisition] = useState<Requisition | null>(null);
  const [previewRequisitionId, setPreviewRequisitionId] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [expenseRequests, setExpenseRequests] = useState<ExpenseRequest[]>([]);
  const [partyNames, setPartyNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const { can } = useAuthorization();
  const [selectedRequisition, setSelectedRequisition] = useState<Requisition | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [showMyRequests, setShowMyRequests] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [fyFilter, setFyFilter] = useState<string>(() => currentFyLabel());
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [isSequenceDialogOpen, setIsSequenceDialogOpen] = useState(false);

  const settingsKey = 'requisitions_all';
  const isInitialMount = useRef(true);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedPrefsRef = useRef<string>('');
  const loadedPrefRef = useRef<Partial<ColumnPref> | null>(null);
  const latestPrefsRef = useRef<{ order: string[]; visibility: Record<string, boolean> } | null>(null);

  const [columnOrder, setColumnOrder] = useState<string[]>(baseTableHeaders);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    baseTableHeaders.reduce((acc, h) => ({ ...acc, [h]: true }), {})
  );

  const [partyPopoverOpen, setPartyPopoverOpen] = useState(false);
  const [partySearch, setPartySearch] = useState("");

  // Bulk / Excel import state
  type ExcelRow = {
    date: string;
    projectId: string;
    departmentId: string;
    amount: number;
    partyName: string;
    description: string;
    _rowNum: number;
    _error?: string;
  };
  type BulkRow = {
    id: number;
    date: string;
    project: string;
    department: string;
    amount: string;
    partyName: string;
    description: string;
    files: File[];
  };
  const mkEmptyBulkRow = (id: number): BulkRow => ({ id, date: '', project: '', department: '', amount: '', partyName: '', description: '', files: [] });

  const [newRequestMode, setNewRequestMode] = useState<'manual' | 'bulk' | 'excel'>('manual');
  const [excelRows, setExcelRows] = useState<ExcelRow[]>([]);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([mkEmptyBulkRow(1), mkEmptyBulkRow(2), mkEmptyBulkRow(3)]);
  const [isImporting, setIsImporting] = useState(false);
  const [bulkIdOrder, setBulkIdOrder] = useState<'asc' | 'desc'>('asc');
  const excelInputRef = useRef<HTMLInputElement>(null);
  const bulkTableRef = useRef<HTMLDivElement>(null);
  const [dialogSize, setDialogSize] = useState<'md' | 'lg' | 'xl' | 'full'>('lg');
  const dialogWidths = { md: '680px', lg: '900px', xl: '1100px', full: '96vw' } as const;

  const canCreate = can('Create Requisition', 'Site Fund Requisition');
  const canViewAll = can('View All', 'Site Fund Requisition');

  useEffect(() => {
    if (!user) return;
    const fetchSettings = async () => {
      const settingsRef = doc(db, 'userSettings', user.id);
      try {
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          const settings = settingsSnap.data() as UserSettings;
          const pageSettings = settings.columnPreferences?.[settingsKey];
          if (pageSettings) {
            loadedPrefRef.current = pageSettings;
            const normalized = normalizeColumnPrefs(pageSettings);
            // Seed the "last saved" cache so we don't immediately write back on load.
            lastSavedPrefsRef.current = JSON.stringify(normalized);
            setColumnVisibility(normalized.visibility);
            setColumnOrder(normalized.order);
          }
        }
      } catch (e) {
        console.error("Failed to load user settings", e);
      }
    };
    fetchSettings();
  }, [user, settingsKey]);

  const saveColumnSettings = async (order: string[], visibility: Record<string, boolean>) => {
    if (!user) return;
    const settingsRef = doc(db, 'userSettings', user.id);
    try {
      // Debounced caller ensures this doesn't fire too frequently.
      // Also preserve any extra fields previously stored for this page key (names/sort/etc).
      const existing = loadedPrefRef.current ?? {};
      const payload = { ...existing, order, visibility };

      await setDoc(
        settingsRef,
        { columnPreferences: { [settingsKey]: payload } },
        // Only update this page key without overwriting other columnPreferences entries.
        { mergeFields: [`columnPreferences.${settingsKey}`] }
      );
    } catch (e) {
      console.error("Failed to save settings", e);
      toast({ title: 'Error', description: 'Could not save column preferences.', variant: 'destructive' });
    }
  };

  useEffect(() => {
    latestPrefsRef.current = { order: columnOrder, visibility: columnVisibility };
  }, [columnOrder, columnVisibility]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (!user) return;

    // Debounce writes to avoid Firestore queued-writes exhaustion in dev/slow networks.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const prefs = { order: columnOrder, visibility: columnVisibility };
      const key = JSON.stringify(prefs);
      saveTimerRef.current = null;
      if (key === lastSavedPrefsRef.current) return;
      lastSavedPrefsRef.current = key;
      void saveColumnSettings(columnOrder, columnVisibility);
    }, 700);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [columnOrder, columnVisibility, user]);

  useEffect(() => {
    // If the user navigates away before the debounce fires, flush the last pending change.
    return () => {
      if (!user) return;
      if (!saveTimerRef.current) return;

      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;

      const prefs = latestPrefsRef.current;
      if (!prefs) return;

      const key = JSON.stringify(prefs);
      if (key === lastSavedPrefsRef.current) return;
      lastSavedPrefsRef.current = key;
      void saveColumnSettings(prefs.order, prefs.visibility);
    };
  }, [user]);


  useEffect(() => {
    if (!canViewAll) {
      setShowMyRequests(true);
    }
  }, [canViewAll]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectId: '',
      departmentId: '',
      amount: 0,
      partyName: '',
      description: '',
      date: new Date(),
    },
  });

  const fetchRequisitions = async () => {
    setIsLoading(true);
    try {
      const reqQuery = query(collection(db, 'requisitions'), orderBy('createdAt', 'desc'));
      const expReqQuery = query(collection(db, 'expenseRequests'));

      const [reqSnapshot, expReqSnapshot] = await Promise.all([
        getDocs(reqQuery),
        getDocs(expReqQuery)
      ]);

      const requisitionsData = reqSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
        } as Requisition;
      });
      setRequisitions(requisitionsData);

      const expenseRequestsData = expReqSnapshot.docs.map(doc => doc.data() as ExpenseRequest);
      setExpenseRequests(expenseRequestsData);

      const existingParties = new Set(requisitionsData.map(r => r.partyName));
      setPartyNames(Array.from(existingParties).sort());

    } catch (error) {
      console.error("Error fetching data: ", error);
      toast({ title: 'Error', description: 'Failed to fetch data.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const displayedRequisitions = useMemo(() => {
    let filtered = requisitions;
    if (showMyRequests) {
      filtered = filtered.filter(req => req.raisedById === user?.id);
    }
    if (statusFilter !== 'all') {
      filtered = filtered.filter(req => req.status === statusFilter);
    }
    if (fyFilter !== 'all') {
      filtered = filtered.filter((req) => {
        const d = toDateSafe(req.date);
        return d ? fyLabelForDate(d) === fyFilter : false;
      });
    }
    if (monthFilter !== 'all') {
      const m = Number(monthFilter);
      filtered = filtered.filter((req) => {
        const d = toDateSafe(req.date);
        return d ? d.getMonth() + 1 === m : false;
      });
    }
    if (fromDate || toDate) {
      const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
      const to = toDate ? new Date(`${toDate}T23:59:59`) : null;
      filtered = filtered.filter((req) => {
        const d = toDateSafe(req.date);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return filtered;
  }, [requisitions, showMyRequests, statusFilter, fyFilter, monthFilter, fromDate, toDate, user]);

  const fyOptions = useMemo(() => {
    // Dynamic based on other filters (so FY list stays relevant).
    let base = requisitions;
    if (showMyRequests) base = base.filter((r) => r.raisedById === user?.id);
    if (statusFilter !== 'all') base = base.filter((r) => r.status === statusFilter);
    if (monthFilter !== 'all') {
      const m = Number(monthFilter);
      base = base.filter((r) => {
        const d = toDateSafe(r.date);
        return d ? d.getMonth() + 1 === m : false;
      });
    }
    if (fromDate || toDate) {
      const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
      const to = toDate ? new Date(`${toDate}T23:59:59`) : null;
      base = base.filter((r) => {
        const d = toDateSafe(r.date);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }

    const set = new Set<string>();
    for (const r of base) {
      const d = toDateSafe(r.date);
      if (d) set.add(fyLabelForDate(d));
    }
    set.add(currentFyLabel());
    return Array.from(set).sort().reverse();
  }, [requisitions, showMyRequests, statusFilter, monthFilter, fromDate, toDate, user]);

  const availableMonths = useMemo(() => {
    // Months present after applying "other" filters (my requests, status, FY, date range)
    let base = requisitions;
    if (showMyRequests) base = base.filter((r) => r.raisedById === user?.id);
    if (statusFilter !== 'all') base = base.filter((r) => r.status === statusFilter);
    if (fyFilter !== 'all') {
      base = base.filter((r) => {
        const d = toDateSafe(r.date);
        return d ? fyLabelForDate(d) === fyFilter : false;
      });
    }
    if (fromDate || toDate) {
      const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
      const to = toDate ? new Date(`${toDate}T23:59:59`) : null;
      base = base.filter((r) => {
        const d = toDateSafe(r.date);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    const months = new Set<number>();
    for (const r of base) {
      const d = toDateSafe(r.date);
      if (d) months.add(d.getMonth() + 1);
    }
    return months;
  }, [requisitions, showMyRequests, statusFilter, fyFilter, fromDate, toDate, user]);

  const generatePreviewId = async () => {
    try {
      const configRef = doc(db, 'serialNumberConfigs', 'site-fund-requisition');
      const configDoc = await getDoc(configRef);
      if (configDoc.exists()) {
        const configData = configDoc.data() as SerialNumberConfig;
        const newIndex = configData.startingIndex;
        const formattedIndex = newIndex.toString().padStart(4, '0');
        const requisitionId = `${configData.prefix || ''}${configData.format || ''}${formattedIndex}`;
        setPreviewRequisitionId(requisitionId);
      } else {
        setPreviewRequisitionId('Configuration not found');
      }
    } catch (error) {
      console.error("Error generating preview ID: ", error);
      setPreviewRequisitionId('Error generating ID');
      toast({ title: 'Error', description: 'Could not generate requisition ID preview.', variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (isNewRequestOpen) {
      generatePreviewId();
      setTimestamp(format(new Date(), 'PPpp'));
      form.reset({
        projectId: '',
        departmentId: '',
        amount: 0,
        partyName: '',
        description: '',
        date: new Date(),
      });
      setPartySearch('');
      setSelectedFiles([]);
    }
  }, [isNewRequestOpen, form]);

  useEffect(() => {
    if (isEditRequestOpen && editingRequisition) {
      form.reset({
        projectId: editingRequisition.projectId,
        departmentId: editingRequisition.departmentId,
        amount: editingRequisition.amount,
        partyName: editingRequisition.partyName,
        description: editingRequisition.description,
        date: parseISO(editingRequisition.date),
      });
    }
  }, [isEditRequestOpen, editingRequisition, form]);

  useEffect(() => {
    const fetchProjectsAndDepartments = async () => {
      try {
        const projectsSnapshot = await getDocs(collection(db, 'projects'));
        const projectsData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
        setProjects(projectsData);

        const departmentsSnapshot = await getDocs(collection(db, 'departments'));
        const departmentsData = departmentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
        setDepartments(departmentsData);

      } catch (error) {
        console.error("Error fetching projects or departments: ", error);
        toast({
          title: 'Error',
          description: 'Failed to load projects or departments.',
          variant: 'destructive',
        });
      }
    };
    fetchProjectsAndDepartments();
    fetchRequisitions();
  }, [toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleCreateRequest = async (values: FormValues) => {
    if (!user) {
      toast({ title: 'Error', description: 'You must be logged in to create a request.', variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);
    try {
      const workflowRef = doc(db, 'workflows', 'site-fund-requisition');
      const workflowSnap = await getDoc(workflowRef);
      if (!workflowSnap.exists()) throw new Error("Workflow not configured for Site Fund Requisition.");

      const steps = workflowSnap.data().steps as WorkflowStep[];
      if (!steps || steps.length === 0) throw new Error("Workflow has no steps.");

      const firstStep = steps[0];

      const tempRequisition = {
        ...values,
        date: format(values.date, 'yyyy-MM-dd'),
        raisedBy: user.name,
        raisedById: user.id,
        status: 'Pending' as const,
        stage: firstStep.name,
        requisitionId: 'temp',
        partyName: values.partyName,
      };

      const assignees = await getAssigneeForStep(firstStep, tempRequisition);
      if (assignees.length === 0) throw new Error(`Could not determine assignee for the first step: ${firstStep.name}`);

      const deadline = await calculateDeadline(new Date(), firstStep.tat);

      const configRef = doc(db, 'serialNumberConfigs', 'site-fund-requisition');
      const newRequisitionId = await runTransaction(db, async (transaction) => {
        const configDoc = await transaction.get(configRef);
        if (!configDoc.exists()) throw new Error("Serial number configuration not found!");

        const configData = configDoc.data() as SerialNumberConfig;
        const newIndex = configData.startingIndex;
        const formattedIndex = newIndex.toString().padStart(4, '0');
        const requisitionId = `${configData.prefix || ''}${configData.format || ''}${formattedIndex}`;

        transaction.update(configRef, { startingIndex: newIndex + 1 });
        return requisitionId;
      });

      const attachmentUrls: Attachment[] = [];
      if (selectedFiles.length > 0) {
        for (const file of selectedFiles) {
          const storageRef = ref(storage, `requisitions/${newRequisitionId}/${file.name}`);
          await uploadBytes(storageRef, file);
          const downloadURL = await getDownloadURL(storageRef);
          attachmentUrls.push({ name: file.name, url: downloadURL });
        }
      }

      const initialLog: ActionLog = {
        action: 'Created',
        comment: 'Requisition created.',
        userId: user.id,
        userName: user.name,
        timestamp: Timestamp.now(),
        stepName: 'Creation',
      };

      const finalRequisitionData = {
        ...tempRequisition,
        requisitionId: newRequisitionId,
        createdAt: Timestamp.now(),
        currentStepId: firstStep.id,
        assignees: assignees,
        deadline: Timestamp.fromDate(deadline),
        history: [initialLog],
        attachments: attachmentUrls,
      };

      await addDoc(collection(db, 'requisitions'), finalRequisitionData);

      toast({ title: 'Success', description: 'New fund requisition created.' });
      setIsNewRequestOpen(false);
      fetchRequisitions();
    } catch (error: any) {
      console.error('Error creating requisition:', error);
      toast({ title: 'Error', description: error.message || 'Failed to create requisition.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  }

  const downloadExcelTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Date (YYYY-MM-DD)', 'Project', 'Department', 'Amount', 'Party Name', 'Description'],
      ['2024-06-01', 'Project Alpha', 'Civil', '50000', 'ABC Contractors', 'Site work'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'site_fund_requisition_template.xlsx');
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

        const parsed = rows.map((row, i) => {
          const dateRaw = row['Date (YYYY-MM-DD)'] || row['Date'] || '';
          let dateStr = '';
          if (dateRaw instanceof Date) {
            dateStr = format(dateRaw, 'yyyy-MM-dd');
          } else if (typeof dateRaw === 'string' && dateRaw.trim()) {
            dateStr = dateRaw.trim();
          } else if (typeof dateRaw === 'number') {
            const d = XLSX.SSF.parse_date_code(dateRaw);
            dateStr = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
          }

          const projectName = String(row['Project'] || '').trim();
          const deptName = String(row['Department'] || '').trim();
          const matchedProject = projects.find(p => p.projectName.toLowerCase() === projectName.toLowerCase());
          const matchedDept = departments.find(d => d.name.toLowerCase() === deptName.toLowerCase());

          const errors: string[] = [];
          if (!dateStr) errors.push('Missing date');
          if (!matchedProject) errors.push(`Project "${projectName}" not found`);
          if (!matchedDept) errors.push(`Department "${deptName}" not found`);
          const amount = Number(row['Amount']);
          if (!amount || amount <= 0) errors.push('Invalid amount');
          const partyName = String(row['Party Name'] || '').trim();
          if (!partyName) errors.push('Missing party name');

          return {
            date: dateStr,
            projectId: matchedProject?.id || '',
            departmentId: matchedDept?.id || '',
            amount,
            partyName,
            description: String(row['Description'] || '').trim(),
            _rowNum: i + 2,
            _error: errors.length ? errors.join('; ') : undefined,
            _projectName: projectName,
            _deptName: deptName,
          } as ExcelRow & { _projectName: string; _deptName: string };
        });
        setExcelRows(parsed as ExcelRow[]);
      } catch {
        toast({ title: 'Error', description: 'Failed to parse Excel file. Please use the template.', variant: 'destructive' });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleBulkImport = async () => {
    if (!user) return;
    const validRows = (excelRows as any[]).filter((r: any) => !r._error);
    if (validRows.length === 0) {
      toast({ title: 'Nothing to import', description: 'Fix all errors before importing.', variant: 'destructive' });
      return;
    }
    setIsImporting(true);
    try {
      const workflowRef = doc(db, 'workflows', 'site-fund-requisition');
      const workflowSnap = await getDoc(workflowRef);
      if (!workflowSnap.exists()) throw new Error("Workflow not configured.");
      const steps = workflowSnap.data().steps as WorkflowStep[];
      const firstStep = steps[0];

      for (const row of validRows) {
        const tempRequisition = {
          projectId: row.projectId,
          departmentId: row.departmentId,
          amount: row.amount,
          partyName: row.partyName,
          description: row.description,
          date: row.date,
          raisedBy: user.name,
          raisedById: user.id,
          status: 'Pending' as const,
          stage: firstStep.name,
          requisitionId: 'temp',
        };
        const assignees = await getAssigneeForStep(firstStep, tempRequisition);
        if (assignees.length === 0) throw new Error(`No assignee for step: ${firstStep.name}`);
        const deadline = await calculateDeadline(new Date(), firstStep.tat);

        const configRef = doc(db, 'serialNumberConfigs', 'site-fund-requisition');
        const newRequisitionId = await runTransaction(db, async (transaction) => {
          const configDoc = await transaction.get(configRef);
          if (!configDoc.exists()) throw new Error("Serial number config not found!");
          const configData = configDoc.data() as SerialNumberConfig;
          const newIndex = configData.startingIndex;
          const requisitionId = `${configData.prefix || ''}${configData.format || ''}${newIndex.toString().padStart(4, '0')}`;
          transaction.update(configRef, { startingIndex: newIndex + 1 });
          return requisitionId;
        });

        const initialLog: ActionLog = {
          action: 'Created',
          comment: 'Requisition created via Excel import.',
          userId: user.id,
          userName: user.name,
          timestamp: Timestamp.now(),
          stepName: 'Creation',
        };

        await addDoc(collection(db, 'requisitions'), {
          ...tempRequisition,
          requisitionId: newRequisitionId,
          createdAt: Timestamp.now(),
          currentStepId: firstStep.id,
          assignees,
          deadline: Timestamp.fromDate(deadline),
          history: [initialLog],
          attachments: [],
        });
      }

      toast({ title: 'Success', description: `${validRows.length} requisition(s) imported.` });
      setIsNewRequestOpen(false);
      setExcelRows([]);
      fetchRequisitions();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Import failed.', variant: 'destructive' });
    } finally {
      setIsImporting(false);
    }
  };

  // Parse a paste event (TSV from Excel copy) into bulk rows starting at rowIndex
  // Normalize a date string pasted from Excel into yyyy-MM-dd for <input type="date">
  const normalizePastedDate = (raw: string): string => {
    const s = raw.trim();
    if (!s) return '';
    // Already ISO: 2024-06-23
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const MON: Record<string, string> = {
      jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
      jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
    };
    // dd-MMM-yyyy or dd/MMM/yyyy  e.g. 23-Jun-2026
    const m1 = s.match(/^(\d{1,2})[-\/]([a-zA-Z]{3})[-\/](\d{4})$/);
    if (m1) {
      const mo = MON[m1[2].toLowerCase()];
      if (mo) return `${m1[3]}-${mo}-${m1[1].padStart(2,'0')}`;
    }
    // dd/MM/yyyy or dd-MM-yyyy  e.g. 23/06/2026 or 23-06-2026
    const m2 = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (m2) return `${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
    // MM/dd/yyyy  e.g. 06/23/2026 (US format) — try JS Date as fallback
    const d = new Date(s);
    if (!isNaN(d.getTime())) return format(d, 'yyyy-MM-dd');
    return s;
  };

  const handleBulkPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim() !== '');
    const COLS: (keyof BulkRow)[] = ['date', 'project', 'department', 'amount', 'partyName', 'description'];
    setBulkRows(prev => {
      const next = [...prev];
      lines.forEach((line, li) => {
        const cells = line.split('\t');
        if (li >= next.length) next.push(mkEmptyBulkRow(Date.now() + li));
        const row = { ...next[li] };
        cells.forEach((cell, ci) => {
          if (ci >= COLS.length) return;
          const col = COLS[ci];
          let val = cell.trim();
          if (col === 'date') val = normalizePastedDate(val);
          // strip currency symbols and thousand separators from amount
          if (col === 'amount') val = val.replace(/[₹$£€,\s]/g, '');
          (row as any)[col] = val;
        });
        next[li] = row;
      });
      return next;
    });
  };

  const handleBulkManualSubmit = async () => {
    if (!user) return;
    const filled = bulkRows.filter(r => r.date || r.project || r.department || r.amount || r.partyName);
    if (filled.length === 0) {
      toast({ title: 'Nothing to submit', description: 'Add at least one row.', variant: 'destructive' });
      return;
    }

    const errors: string[] = [];
    const resolved = filled.map((row, i) => {
      const rowErrors: string[] = [];
      const matchedProject = projects.find(p => p.projectName.toLowerCase() === row.project.trim().toLowerCase());
      const matchedDept = departments.find(d => d.name.toLowerCase() === row.department.trim().toLowerCase());
      const amount = Number(row.amount);
      if (!row.date.trim()) rowErrors.push('Missing date');
      if (!matchedProject) rowErrors.push(`Row ${i + 1}: Project "${row.project}" not found`);
      if (!matchedDept) rowErrors.push(`Row ${i + 1}: Department "${row.department}" not found`);
      if (!amount || amount <= 0) rowErrors.push(`Row ${i + 1}: Invalid amount`);
      if (!row.partyName.trim()) rowErrors.push(`Row ${i + 1}: Missing party name`);
      errors.push(...rowErrors);
      return { ...row, projectId: matchedProject?.id || '', departmentId: matchedDept?.id || '', amount };
    });

    if (errors.length > 0) {
      toast({ title: 'Validation errors', description: errors.slice(0, 3).join(' | ') + (errors.length > 3 ? ` …and ${errors.length - 3} more` : ''), variant: 'destructive' });
      return;
    }

    // Apply ID order: desc means bottom row gets the lowest serial number → reverse before processing
    const orderedRows = bulkIdOrder === 'desc' ? [...resolved].reverse() : resolved;

    setIsImporting(true);
    try {
      const workflowRef = doc(db, 'workflows', 'site-fund-requisition');
      const workflowSnap = await getDoc(workflowRef);
      if (!workflowSnap.exists()) throw new Error("Workflow not configured.");
      const steps = workflowSnap.data().steps as WorkflowStep[];
      const firstStep = steps[0];

      for (const row of orderedRows) {
        const tempRequisition = {
          projectId: row.projectId,
          departmentId: row.departmentId,
          amount: row.amount,
          partyName: row.partyName,
          description: row.description,
          date: row.date,
          raisedBy: user.name,
          raisedById: user.id,
          status: 'Pending' as const,
          stage: firstStep.name,
          requisitionId: 'temp',
        };
        const assignees = await getAssigneeForStep(firstStep, tempRequisition);
        if (assignees.length === 0) throw new Error(`No assignee for step: ${firstStep.name}`);
        const deadline = await calculateDeadline(new Date(), firstStep.tat);

        const configRef = doc(db, 'serialNumberConfigs', 'site-fund-requisition');
        const newRequisitionId = await runTransaction(db, async (transaction) => {
          const configDoc = await transaction.get(configRef);
          if (!configDoc.exists()) throw new Error("Serial number config not found!");
          const configData = configDoc.data() as SerialNumberConfig;
          const newIndex = configData.startingIndex;
          const requisitionId = `${configData.prefix || ''}${configData.format || ''}${newIndex.toString().padStart(4, '0')}`;
          transaction.update(configRef, { startingIndex: newIndex + 1 });
          return requisitionId;
        });

        // Upload attachments for this row
        const attachmentUrls: Attachment[] = [];
        if (row.files && row.files.length > 0) {
          for (const file of row.files) {
            const storageRef = ref(storage, `requisitions/${newRequisitionId}/${file.name}`);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);
            attachmentUrls.push({ name: file.name, url: downloadURL });
          }
        }

        const initialLog: ActionLog = {
          action: 'Created',
          comment: 'Requisition created via bulk manual entry.',
          userId: user.id,
          userName: user.name,
          timestamp: Timestamp.now(),
          stepName: 'Creation',
        };

        await addDoc(collection(db, 'requisitions'), {
          ...tempRequisition,
          requisitionId: newRequisitionId,
          createdAt: Timestamp.now(),
          currentStepId: firstStep.id,
          assignees,
          deadline: Timestamp.fromDate(deadline),
          history: [initialLog],
          attachments: attachmentUrls,
        });
      }

      toast({ title: 'Success', description: `${resolved.length} requisition(s) created.` });
      setIsNewRequestOpen(false);
      setBulkRows([mkEmptyBulkRow(1), mkEmptyBulkRow(2), mkEmptyBulkRow(3)]);
      setBulkIdOrder('asc');
      fetchRequisitions();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Bulk submit failed.', variant: 'destructive' });
    } finally {
      setIsImporting(false);
    }
  };

  const handleEditRequest = async (values: FormValues) => {
    if (!editingRequisition) return;

    try {
      const requisitionRef = doc(db, 'requisitions', editingRequisition.id);
      await updateDoc(requisitionRef, {
        ...values,
        date: format(values.date, 'yyyy-MM-dd'),
      });
      toast({ title: 'Success', description: 'Requisition updated.' });
      setIsEditRequestOpen(false);
      setEditingRequisition(null);
      fetchRequisitions();
    } catch (error: any) {
      console.error('Error updating requisition:', error);
      toast({ title: 'Error', description: 'Failed to update requisition.', variant: 'destructive' });
    }
  }

  const getProjectName = (id: string) => projects.find(p => p.id === id)?.projectName || id;
  const getDepartmentName = (id: string) => departments.find(d => d.id === id)?.name || id;

  const openEditDialog = (req: Requisition) => {
    setEditingRequisition(req);
    setIsEditRequestOpen(true);
  };

  const openViewDialog = (req: Requisition) => {
    setSelectedRequisition(req);
    setIsViewDialogOpen(true);
  };

  const visibleHeaders = useMemo(
    () => columnOrder.filter((header) => columnVisibility[header] !== false),
    [columnOrder, columnVisibility]
  );

  const moveColumn = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...columnOrder];
    const newIndex = direction === 'up' ? index - 1 : index + 1;

    if (newIndex >= 0 && newIndex < newOrder.length) {
      [newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]];
      setColumnOrder(newOrder);
    }
  };

  const renderNewForm = () => (
    <Tabs value={newRequestMode} onValueChange={(v) => { setNewRequestMode(v as 'manual' | 'bulk' | 'excel'); setExcelRows([]); }}>
      <TabsList className="mb-4 w-full grid grid-cols-3">
        <TabsTrigger value="manual">Single Entry</TabsTrigger>
        <TabsTrigger value="bulk">Multiple Entries</TabsTrigger>
        <TabsTrigger value="excel">Import from Excel</TabsTrigger>
      </TabsList>

      <TabsContent value="manual">
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleCreateRequest)} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="requisitionId">Request ID</Label>
            <Input id="requisitionId" type="text" value={previewRequisitionId} readOnly />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timestamp">Timestamp</Label>
            <Input id="timestamp" type="text" value={timestamp} readOnly />
          </div>
          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem className="space-y-2 flex flex-col">
                <FormLabel>Date</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="projectId"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel>Project</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger id="project">
                      <SelectValue placeholder="Select Project" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {projects.map(project => (
                      <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="departmentId"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel>Department</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger id="department">
                      <SelectValue placeholder="Select Department" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {departments.map(department => (
                      <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel>Amount</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="Enter Amount" {...field} onChange={e => field.onChange(e.target.valueAsNumber || 0)} value={field.value || ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="partyName"
            render={({ field }) => (
              <FormItem className="lg:col-span-3 space-y-2">
                <FormLabel>Party Name</FormLabel>
                <Popover open={partyPopoverOpen} onOpenChange={setPartyPopoverOpen}>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn("w-full justify-between font-normal", !field.value && "text-muted-foreground")}
                      >
                        {field.value ? partyNames.find(p => p === field.value) || field.value : "Select or type party name..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                    <Command>
                      <CommandInput
                        placeholder="Search party name..."
                        value={partySearch}
                        onValueChange={setPartySearch}
                      />
                      <CommandList>
                        <CommandEmpty>No party found.</CommandEmpty>
                        <CommandGroup>
                          {partyNames.filter(p => p.toLowerCase().includes(partySearch.toLowerCase())).map((name) => (
                            <CommandItem
                              value={name}
                              key={name}
                              onSelect={() => {
                                form.setValue("partyName", name);
                                setPartySearch(name);
                                setPartyPopoverOpen(false);
                              }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", name === field.value ? "opacity-100" : "opacity-0")} />
                              {name}
                            </CommandItem>
                          ))}
                          {partySearch && !partyNames.some(name => name.toLowerCase() === partySearch.toLowerCase()) && (
                            <CommandItem
                              value={partySearch}
                              onSelect={() => {
                                form.setValue("partyName", partySearch);
                                setPartyNames(prev => [...prev, partySearch].sort());
                                setPartyPopoverOpen(false);
                              }}
                            >
                              <Check className="mr-2 h-4 w-4 opacity-0" />
                              Create "{partySearch}"
                            </CommandItem>
                          )}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem className="lg:col-span-3 space-y-2">
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea id="description" placeholder="Enter a brief description" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="lg:col-span-3 space-y-2">
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
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Request
          </Button>
        </DialogFooter>
      </form>
    </Form>
    </TabsContent>

      <TabsContent value="bulk" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Fill rows manually <strong>or</strong> paste (<kbd className="rounded border px-1 font-mono text-xs">Ctrl+V</kbd>) cells copied from Excel.
            <span className="ml-1 font-mono text-xs">Date · Project · Department · Amount · Party Name · Description</span>
          </p>

          {/* Request ID order selector */}
          <div className="flex items-center gap-1.5 rounded-lg border bg-white/60 px-3 py-1.5 text-xs shrink-0">
            <ArrowUpDown className="h-3.5 w-3.5 text-slate-500" />
            <span className="font-medium text-slate-600">Request ID:</span>
            <button
              type="button"
              onClick={() => setBulkIdOrder('asc')}
              className={cn(
                'rounded px-2 py-0.5 font-medium transition-colors',
                bulkIdOrder === 'asc'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              Row 1 → first ID
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => setBulkIdOrder('desc')}
              className={cn(
                'rounded px-2 py-0.5 font-medium transition-colors',
                bulkIdOrder === 'desc'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              Last row → first ID
            </button>
          </div>
        </div>

        {/* native overflow so table rows always scroll — Radix ScrollArea doesn't reliably scroll <Table> */}
        <div
          ref={bulkTableRef}
          onPaste={handleBulkPaste}
          className="rounded-md border focus-within:ring-2 focus-within:ring-ring outline-none overflow-y-auto"
          style={{ maxHeight: 'calc(60vh - 180px)', minHeight: '160px' }}
        >
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm">
              <TableRow>
                <TableHead className="w-8 text-center text-muted-foreground">#</TableHead>
                <TableHead className="min-w-[120px]">Date</TableHead>
                <TableHead className="min-w-[130px]">Project</TableHead>
                <TableHead className="min-w-[130px]">Department</TableHead>
                <TableHead className="min-w-[100px]">Amount</TableHead>
                <TableHead className="min-w-[150px]">Party Name</TableHead>
                <TableHead className="min-w-[160px]">Description</TableHead>
                <TableHead className="w-20 text-center">Docs</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bulkRows.map((row, idx) => (
                <TableRow key={row.id}>
                  <TableCell className="text-center text-xs text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="p-1">
                    <Input
                      type="date"
                      value={row.date}
                      onChange={e => setBulkRows(prev => prev.map(r => r.id === row.id ? { ...r, date: e.target.value } : r))}
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Select
                      value={row.project}
                      onValueChange={val => setBulkRows(prev => prev.map(r => r.id === row.id ? { ...r, project: val } : r))}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map(p => (
                          <SelectItem key={p.id} value={p.projectName}>{p.projectName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="p-1">
                    <Select
                      value={row.department}
                      onValueChange={val => setBulkRows(prev => prev.map(r => r.id === row.id ? { ...r, department: val } : r))}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select dept" />
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map(d => (
                          <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      type="number"
                      placeholder="0"
                      value={row.amount}
                      onChange={e => setBulkRows(prev => prev.map(r => r.id === row.id ? { ...r, amount: e.target.value } : r))}
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      placeholder="Party name"
                      value={row.partyName}
                      onChange={e => setBulkRows(prev => prev.map(r => r.id === row.id ? { ...r, partyName: e.target.value } : r))}
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      placeholder="Description"
                      value={row.description}
                      onChange={e => setBulkRows(prev => prev.map(r => r.id === row.id ? { ...r, description: e.target.value } : r))}
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  {/* Attachments */}
                  <TableCell className="p-1 text-center">
                    <label className="cursor-pointer inline-flex flex-col items-center gap-0.5">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs border transition-colors',
                        row.files.length > 0
                          ? 'border-sky-300 bg-sky-50 text-sky-700'
                          : 'border-slate-200 bg-white/60 text-slate-500 hover:border-slate-400'
                      )}>
                        <Paperclip className="h-3 w-3" />
                        {row.files.length > 0 ? row.files.length : '+'}
                      </span>
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={e => {
                          const newFiles = e.target.files ? Array.from(e.target.files) : [];
                          setBulkRows(prev => prev.map(r => r.id === row.id ? { ...r, files: [...r.files, ...newFiles] } : r));
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </TableCell>
                  <TableCell className="p-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-rose-500"
                      onClick={() => setBulkRows(prev => prev.filter(r => r.id !== row.id))}
                      disabled={bulkRows.length === 1}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setBulkRows(prev => [...prev, mkEmptyBulkRow(Date.now())])}
          >
            + Add Row
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setBulkRows([mkEmptyBulkRow(1), mkEmptyBulkRow(2), mkEmptyBulkRow(3)])}
          >
            Clear All
          </Button>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" disabled={isImporting} onClick={handleBulkManualSubmit}>
            {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit {bulkRows.filter(r => r.date || r.project || r.amount || r.partyName).length > 0
              ? `${bulkRows.filter(r => r.date || r.project || r.amount || r.partyName).length} Record(s)`
              : 'Records'}
          </Button>
        </DialogFooter>
      </TabsContent>

      <TabsContent value="excel" className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Upload an Excel file. Non-editable fields (Request ID, Timestamp) are generated automatically.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={downloadExcelTemplate}>
            <Download className="mr-2 h-4 w-4" />
            Download Template
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleExcelUpload}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => excelInputRef.current?.click()}
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            Choose Excel File
          </Button>
          {excelRows.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {excelRows.length} row(s) loaded &mdash; {(excelRows as any[]).filter((r: any) => !r._error).length} valid,{' '}
              {(excelRows as any[]).filter((r: any) => r._error).length} with errors
            </span>
          )}
        </div>

        {excelRows.length > 0 && (
          <div className="overflow-y-auto rounded-md border" style={{ maxHeight: '288px' }}>
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm">
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Party Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(excelRows as any[]).map((row: any) => (
                  <TableRow key={row._rowNum} className={row._error ? 'bg-rose-50' : ''}>
                    <TableCell className="text-muted-foreground">{row._rowNum}</TableCell>
                    <TableCell>{row.date}</TableCell>
                    <TableCell>{row._projectName ?? projects.find(p => p.id === row.projectId)?.projectName ?? row.projectId}</TableCell>
                    <TableCell>{row._deptName ?? departments.find(d => d.id === row.departmentId)?.name ?? row.departmentId}</TableCell>
                    <TableCell>{row.amount}</TableCell>
                    <TableCell>{row.partyName}</TableCell>
                    <TableCell className="max-w-[150px] truncate">{row.description}</TableCell>
                    <TableCell>
                      {row._error ? (
                        <span className="flex items-center gap-1 text-rose-600 text-xs">
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          {row._error}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-emerald-600 text-xs">
                          <Check className="h-3 w-3" />
                          OK
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={isImporting || (excelRows as any[]).filter((r: any) => !r._error).length === 0}
            onClick={handleBulkImport}
          >
            {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import {(excelRows as any[]).filter((r: any) => !r._error).length > 0
              ? `${(excelRows as any[]).filter((r: any) => !r._error).length} Record(s)`
              : 'Records'}
          </Button>
        </DialogFooter>
      </TabsContent>
    </Tabs>
  );

  const renderEditForm = () => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleEditRequest)} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="requisitionId">Request ID</Label>
            <Input id="requisitionId" type="text" value={editingRequisition?.requisitionId} readOnly />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timestamp">Timestamp</Label>
            <Input id="timestamp" type="text" value={editingRequisition?.createdAt ? format(editingRequisition.createdAt.toDate(), 'PPpp') : ''} readOnly />
          </div>
          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem className="space-y-2 flex flex-col">
                <FormLabel>Date</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="projectId"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel>Project</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger id="project">
                      <SelectValue placeholder="Select Project" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {projects.map(project => (
                      <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="departmentId"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel>Department</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger id="department">
                      <SelectValue placeholder="Select Department" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {departments.map(department => (
                      <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel>Amount</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="Enter Amount" {...field} onChange={e => field.onChange(e.target.valueAsNumber || 0)} value={field.value || ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="partyName"
            render={({ field }) => (
              <FormItem className="lg:col-span-3 space-y-2">
                <FormLabel>Party Name</FormLabel>
                <FormControl>
                  <Input placeholder="Enter the name of the party" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem className="lg:col-span-3 space-y-2">
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea id="description" placeholder="Enter a brief description" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="space-y-2">
            <Label htmlFor="attachments">Attachments</Label>
            <Input id="attachments" type="file" multiple />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit">Save Changes</Button>
        </DialogFooter>
      </form>
    </Form>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="rounded-2xl border border-white/70 bg-white/70 p-4 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="mb-3 h-1.5 w-full rounded-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-70" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            {canViewAll && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="my-requests-switch"
                  checked={showMyRequests}
                  onCheckedChange={setShowMyRequests}
                />
                <Label htmlFor="my-requests-switch" className="text-sm text-slate-700">My Requests Only</Label>
              </div>
            )}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px] bg-white/80 border-white/70">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
                <SelectItem value="Rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={fyFilter}
              onValueChange={(v) => {
                setFyFilter(v);
                setMonthFilter('all');
                setFromDate('');
                setToDate('');
              }}
            >
              <SelectTrigger className="w-[140px] bg-white/80 border-white/70">
                <SelectValue placeholder="FY" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All FY</SelectItem>
                {fyOptions.map((fy) => (
                  <SelectItem key={fy} value={fy}>
                    FY {fy}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="w-[120px] bg-white/80 border-white/70">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {FY_MONTHS.filter((m) => availableMonths.size === 0 || availableMonths.has(Number(m.value))).map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-slate-600">From</p>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-9 w-[150px] bg-white/80 border-white/70"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-slate-600">To</p>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-9 w-[150px] bg-white/80 border-white/70"
                />
              </div>
              <Button
                variant="outline"
                className="mt-5 h-9 bg-white/70 border-white/70"
                onClick={() => {
                  setFyFilter(currentFyLabel());
                  setMonthFilter('all');
                  setFromDate('');
                  setToDate('');
                }}
                type="button"
              >
                Reset
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Dialog open={isNewRequestOpen} onOpenChange={(open) => { setIsNewRequestOpen(open); if (!open) { setNewRequestMode('manual'); setExcelRows([]); setBulkRows([mkEmptyBulkRow(1), mkEmptyBulkRow(2), mkEmptyBulkRow(3)]); setBulkIdOrder('asc'); } }}>
              <DialogTrigger asChild>
                <Button
                  disabled={!canCreate}
                  className="bg-slate-900 text-white shadow hover:bg-slate-900/90"
                >
                  New Request
                </Button>
              </DialogTrigger>
              <DialogContent
                style={{ maxWidth: dialogWidths[dialogSize] }}
                className="overflow-hidden rounded-3xl border border-white/70 bg-white/80 p-0 shadow-[0_30px_120px_-80px_rgba(2,6,23,0.8)] backdrop-blur max-h-[92vh] flex flex-col w-[96vw]"
              >
                {/* gradient accent */}
                <div className="h-1.5 w-full shrink-0 bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-80" />

                {/* fixed header row */}
                <div className="flex items-start justify-between px-6 pt-5 pb-2 shrink-0">
                  <DialogHeader>
                    <DialogTitle>New Site Fund Requisition</DialogTitle>
                    <DialogDescription>
                      Fill out the form to create a new fund request.
                    </DialogDescription>
                  </DialogHeader>
                  {/* resize toggle */}
                  <div className="flex items-center gap-1 ml-4 mt-0.5 shrink-0">
                    {(['md', 'lg', 'xl', 'full'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setDialogSize(s)}
                        title={{ md: 'Medium', lg: 'Large', xl: 'Extra Large', full: 'Full Width' }[s]}
                        className={cn(
                          'rounded px-2 py-0.5 text-[11px] font-medium border transition-colors',
                          dialogSize === s
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white/60 text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700'
                        )}
                      >
                        {{ md: 'M', lg: 'L', xl: 'XL', full: '⤢' }[s]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* scrollable form body */}
                <div className="flex-1 overflow-y-auto px-6 pb-6">
                  {renderNewForm()}
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={isSequenceDialogOpen} onOpenChange={setIsSequenceDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Shuffle className="mr-2 h-4 w-4" /> Sequence
                </Button>
              </DialogTrigger>
              <DialogContent className="overflow-hidden rounded-3xl border border-white/70 bg-white/80 shadow-[0_30px_120px_-80px_rgba(2,6,23,0.8)] backdrop-blur">
                <DialogHeader>
                  <DialogTitle>Edit Column Sequence</DialogTitle>
                  <DialogDescription>Use the arrows to reorder the columns. Your changes will be saved automatically.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-2">
                  {columnOrder.map((header, index) => (
                    <div key={header} className="flex items-center justify-between rounded-xl border border-white/70 bg-white/70 p-2">
                      <span className="font-medium">{header}</span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => moveColumn(index, 'up')}
                          disabled={index === 0}
                          aria-label={`Move ${header} up`}
                        >
                          <ChevronsUpDown className="h-4 w-4 rotate-180 text-slate-600" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => moveColumn(index, 'down')}
                          disabled={index === columnOrder.length - 1}
                          aria-label={`Move ${header} down`}
                        >
                          <ChevronsUpDown className="h-4 w-4 text-slate-600" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <View className="mr-2 h-4 w-4" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {baseTableHeaders.map((header) => (
                  <DropdownMenuCheckboxItem
                    key={header}
                    className="capitalize"
                    checked={columnVisibility[header] !== false}
                    onCheckedChange={(value) =>
                      setColumnVisibility(prev => ({ ...prev, [header]: !!value }))
                    }
                  >
                    {header}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="min-w-0 overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <TooltipProvider>
          <ScrollArea className="h-[calc(100vh-22rem)]" showHorizontalScrollbar>
            <Table
              containerClassName="w-max overflow-visible"
              className="w-max min-w-[1200px]"
            >
              <TableHeader className="sticky top-0 z-10 bg-gradient-to-r from-white/90 via-white/80 to-white/90 backdrop-blur border-b border-white/70">
                <TableRow>
                  {visibleHeaders.map(header => (
                    <TableHead key={header} className="whitespace-nowrap text-slate-700">{header}</TableHead>
                  ))}
                  <TableHead className="text-center text-slate-700">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedRequisitions.length > 0 ? (
                  displayedRequisitions.map((req) => {
                    const expenseRequest = expenseRequests.find(exp => exp.requestNo === req.expenseRequestNo);
                    return (
                      <TableRow key={req.id} className="hover:bg-slate-50/70">
                        {visibleHeaders.map(header => {
                          let content: React.ReactNode = 'N/A';
                          switch (header) {
                            case 'Request ID': content = req.requisitionId; break;
                            case 'Date': {
                              const d = toDateSafe(req.date);
                              content = d ? format(d, 'dd MMM, yyyy') : '—';
                              break;
                            }
                            case 'Project': content = getProjectName(req.projectId); break;
                            case 'Department': content = getDepartmentName(req.departmentId); break;
                            case 'Entered By': content = req.raisedBy; break;
                            case 'Party Name': content = req.partyName; break;
                            case 'Description':
                              content = (
                                <Tooltip>
                                  <TooltipTrigger><p className="truncate max-w-[150px]">{req.description}</p></TooltipTrigger>
                                  <TooltipContent><p className="max-w-sm">{req.description}</p></TooltipContent>
                                </Tooltip>
                              );
                              break;
                            case 'Amount': content = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(req.amount); break;
                            case 'Stage': content = req.stage; break;
                            case 'Status':
                              content = (
                                <Badge variant="outline" className={cn("whitespace-nowrap", statusBadgeClass(req.status))}>
                                  {req.status || '—'}
                                </Badge>
                              );
                              break;
                            case 'Attachments':
                              content = (
                                <Badge variant="outline" className="border-slate-200/80 bg-white/70 text-slate-700">
                                  {req.attachments?.length || 0}
                                </Badge>
                              );
                              break;
                            case 'Expense Request No': content = req.expenseRequestNo || 'N/A'; break;
                            case 'Reception No': content = expenseRequest?.receptionNo || 'N/A'; break;
                            case 'Reception Date': content = expenseRequest?.receptionDate ? format(new Date(expenseRequest.receptionDate), 'dd MMM, yyyy') : 'N/A'; break;
                          }
                          return <TableCell key={header}>{content}</TableCell>
                        })}
                        <TableCell className="text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openViewDialog(req)}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </DropdownMenuItem>
                              {req.stage === 'Request Receiving' && (
                                <DropdownMenuItem onClick={() => openEditDialog(req)}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={visibleHeaders.length + 1} className="text-center h-24">
                      No requisitions found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </TooltipProvider>
      </div>
      {selectedRequisition && (
        <ViewRequisitionDialog
          isOpen={isViewDialogOpen}
          onOpenChange={setIsViewDialogOpen}
          requisition={selectedRequisition}
          projects={projects}
          departments={departments}
          onRequisitionUpdate={fetchRequisitions}
        />
      )}
      <Dialog open={isEditRequestOpen} onOpenChange={setIsEditRequestOpen}>
        <DialogContent className="sm:max-w-4xl overflow-hidden rounded-3xl border border-white/70 bg-white/80 p-0 shadow-[0_30px_120px_-80px_rgba(2,6,23,0.8)] backdrop-blur">
          <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-80" />
          <div className="p-6">
            <DialogHeader>
              <DialogTitle>Edit Site Fund Requisition</DialogTitle>
              <DialogDescription>
                Make changes to the fund request below.
              </DialogDescription>
            </DialogHeader>
            {renderEditForm()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
