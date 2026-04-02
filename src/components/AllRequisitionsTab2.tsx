
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
import { MoreHorizontal, Calendar as CalendarIcon, Edit, Eye, Loader2, UploadCloud, File as FileIcon, X, View, Shuffle, Check, ChevronsUpDown } from 'lucide-react';
import { Textarea } from './ui/textarea';
import { collection, getDocs, addDoc, doc, getDoc, runTransaction, Timestamp, updateDoc, query, where, orderBy, setDoc } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { Project, Department, Requisition, SerialNumberConfig, WorkflowStep, ActionLog, Attachment, UserSettings, ExpenseRequest } from '@/lib/types';
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


const formSchema = z.object({
  projectId: z.string().min(1, { message: 'Project is required.' }),
  departmentId: z.string().min(1, { message: 'Department is required.' }),
  amount: z.coerce.number().min(1, { message: 'Amount must be greater than 0.' }),
  partyName: z.string().min(1, { message: 'Party name is required.' }),
  description: z.string(),
  date: z.date({ required_error: "A date is required."}),
  attachments: z.custom<FileList>().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const baseTableHeaders = [
    'Request ID', 'Date', 'Project', 'Department', 'Entered By', 'Party Name',
    'Description', 'Amount', 'Stage', 'Status', 'Attachments', 'Expense Request No',
    'Reception No', 'Reception Date'
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
  const [isSequenceDialogOpen, setIsSequenceDialogOpen] = useState(false);
  
  const settingsKey = 'requisitions_all';
  const isInitialMount = useRef(true);

  const [columnOrder, setColumnOrder] = useState<string[]>(baseTableHeaders);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    baseTableHeaders.reduce((acc, h) => ({ ...acc, [h]: true }), {})
  );

  const [partyPopoverOpen, setPartyPopoverOpen] = useState(false);
  const [partySearch, setPartySearch] = useState("");

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
            setColumnVisibility(pageSettings.visibility);
            setColumnOrder(pageSettings.order);
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
        const settingsSnap = await getDoc(settingsRef);
        const currentSettings = settingsSnap.exists() ? settingsSnap.data() : { columnPreferences: {} };

        const newPreferences = {
            ...currentSettings.columnPreferences,
            [settingsKey]: { order, visibility }
        };
        await setDoc(settingsRef, { ...currentSettings, columnPreferences: newPreferences }, { merge: true });
    } catch(e) {
        console.error("Failed to save settings", e);
        toast({ title: 'Error', description: 'Could not save column preferences.', variant: 'destructive'});
    }
  };
  
  useEffect(() => {
      if (isInitialMount.current) {
          isInitialMount.current = false;
          return;
      }
      if (user) {
          saveColumnSettings(columnOrder, columnVisibility);
      }
  }, [columnOrder, columnVisibility, user]);

  
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
    return filtered;
  }, [requisitions, showMyRequests, statusFilter, user]);
  
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

  const visibleHeaders = columnOrder.filter(header => columnVisibility[header]);
  
  const moveColumn = (index: number, direction: 'up' | 'down') => {
      const newOrder = [...columnOrder];
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      
      if (newIndex >= 0 && newIndex < newOrder.length) {
          [newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]];
          setColumnOrder(newOrder);
      }
  };

  const renderNewForm = () => (
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
    <div className="flex h-full flex-col gap-4">
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
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
            <Dialog open={isNewRequestOpen} onOpenChange={setIsNewRequestOpen}>
                <DialogTrigger asChild>
                    <Button
                      disabled={!canCreate}
                      className="bg-slate-900 text-white shadow hover:bg-slate-900/90"
                    >
                      New Request
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-4xl overflow-hidden rounded-3xl border border-white/70 bg-white/80 p-0 shadow-[0_30px_120px_-80px_rgba(2,6,23,0.8)] backdrop-blur">
                    <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-80" />
                    <div className="p-6">
                    <DialogHeader>
                        <DialogTitle>New Site Fund Requisition</DialogTitle>
                        <DialogDescription>
                            Fill out the form to create a new fund request.
                        </DialogDescription>
                    </DialogHeader>
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
                            checked={columnVisibility[header]}
                            onCheckedChange={(value) =>
                                setColumnVisibility(prev => ({...prev, [header]: !!value}))
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

        <div className="relative flex-grow overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
          <ScrollArea className="absolute inset-0" showHorizontalScrollbar>
            <TooltipProvider>
            <div className="min-w-full w-max">
              <Table className="min-w-[1200px]">
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
                                switch(header) {
                                    case 'Request ID': content = req.requisitionId; break;
                                    case 'Date': content = format(new Date(req.date), 'dd MMM, yyyy'); break;
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
            </div>
            </TooltipProvider>
          </ScrollArea>
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
