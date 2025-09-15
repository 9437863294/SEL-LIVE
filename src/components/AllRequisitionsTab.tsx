
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
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
import { MoreHorizontal, Calendar as CalendarIcon, Edit, Eye, Loader2, UploadCloud, File as FileIcon, X } from 'lucide-react';
import { Textarea } from './ui/textarea';
import { collection, getDocs, addDoc, doc, getDoc, runTransaction, Timestamp, updateDoc, query, where, orderBy } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { Project, Department, Requisition, SerialNumberConfig, WorkflowStep, ActionLog, Attachment } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from './auth/AuthProvider';
import { format, parseISO } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { cn } from '@/lib/utils';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import ViewRequisitionDialog from './ViewRequisitionDialog';
import { Switch } from '@/components/ui/switch';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ScrollArea } from './ui/scroll-area';


const formSchema = z.object({
  projectId: z.string().min(1, { message: 'Project is required.' }),
  departmentId: z.string().min(1, { message: 'Department is required.' }),
  amount: z.coerce.number().min(1, { message: 'Amount must be greater than 0.' }),
  description: z.string(),
  date: z.date({ required_error: "A date is required."}),
  attachments: z.custom<FileList>().optional(),
});

type FormValues = z.infer<typeof formSchema>;


export default function AllRequisitionsTab() {
  const [isNewRequestOpen, setIsNewRequestOpen] = useState(false);
  const [isEditRequestOpen, setIsEditRequestOpen] = useState(false);
  const [editingRequisition, setEditingRequisition] = useState<Requisition | null>(null);
  const [previewRequisitionId, setPreviewRequisitionId] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
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
  
  const canCreate = can('Create Requisition', 'Site Fund Requisition');
  const canViewAll = can('View All', 'Site Fund Requisition');

  useEffect(() => {
    // If user CANNOT view all, they MUST only see their requests.
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
      description: '',
      date: new Date(),
    },
  });

  const fetchRequisitions = async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'requisitions'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const requisitionsData = querySnapshot.docs.map(doc => {
        const data = doc.data();
        return { 
          id: doc.id, 
          ...data,
        } as Requisition;
      });
      setRequisitions(requisitionsData);
    } catch (error) {
      console.error("Error fetching requisitions: ", error);
      toast({ title: 'Error', description: 'Failed to fetch requisitions.', variant: 'destructive' });
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
        description: '',
        date: new Date(),
      });
      setSelectedFiles([]);
    }
  }, [isNewRequestOpen, form]);
  
  useEffect(() => {
    if (isEditRequestOpen && editingRequisition) {
      form.reset({
        projectId: editingRequisition.projectId,
        departmentId: editingRequisition.departmentId,
        amount: editingRequisition.amount,
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
        };

        const assignedToId = await getAssigneeForStep(firstStep, tempRequisition);
        if (!assignedToId) throw new Error(`Could not determine assignee for the first step: ${firstStep.name}`);
        
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
            assignedToId: assignedToId,
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
    <div className="flex flex-col h-full">
        <div className="flex justify-end items-center gap-4 mb-4">
            {canViewAll && (
              <div className="flex items-center space-x-2">
                  <Switch 
                      id="my-requests-switch" 
                      checked={showMyRequests}
                      onCheckedChange={setShowMyRequests}
                  />
                  <Label htmlFor="my-requests-switch">My Requests Only</Label>
              </div>
            )}
             <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
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
            <Dialog open={isNewRequestOpen} onOpenChange={setIsNewRequestOpen}>
                <DialogTrigger asChild>
                    <Button disabled={!canCreate}>New Request</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>New Site Fund Requisition</DialogTitle>
                        <DialogDescription>
                            Fill out the form to create a new fund request.
                        </DialogDescription>
                    </DialogHeader>
                    {renderNewForm()}
                </DialogContent>
            </Dialog>

            <Dialog open={isEditRequestOpen} onOpenChange={setIsEditRequestOpen}>
                <DialogContent className="sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Edit Site Fund Requisition</DialogTitle>
                        <DialogDescription>
                            Make changes to the fund request below.
                        </DialogDescription>
                    </DialogHeader>
                    {renderEditForm()}
                </DialogContent>
            </Dialog>
        </div>
        <div className="border rounded-lg flex-grow relative">
          <ScrollArea className="absolute inset-0">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>Request ID</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Entered By</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attachments</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedRequisitions.length > 0 ? (
                  displayedRequisitions.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">{req.requisitionId}</TableCell>
                      <TableCell>{format(new Date(req.date), 'dd MMM, yyyy')}</TableCell>
                      <TableCell>{getProjectName(req.projectId)}</TableCell>
                      <TableCell>{getDepartmentName(req.departmentId)}</TableCell>
                      <TableCell>{req.raisedBy}</TableCell>
                      <TableCell>{req.description}</TableCell>
                      <TableCell>{req.amount.toLocaleString()}</TableCell>
                      <TableCell>{req.stage}</TableCell>
                      <TableCell>{req.status}</TableCell>
                      <TableCell>{req.attachments?.length || 0}</TableCell>
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
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center h-24">
                      No requisitions found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
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
    </div>
  );
}
