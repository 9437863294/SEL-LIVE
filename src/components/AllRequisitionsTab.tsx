
'use client';

import { useState, useEffect } from 'react';
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
import { MoreHorizontal, Calendar as CalendarIcon } from 'lucide-react';
import { Textarea } from './ui/textarea';
import { collection, getDocs, addDoc, serverTimestamp, query, orderBy, doc, getDoc, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project, Department, Requisition, SerialNumberConfig } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from './auth/AuthProvider';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { cn } from '@/lib/utils';


const formSchema = z.object({
  projectId: z.string().min(1, { message: 'Project is required.' }),
  departmentId: z.string().min(1, { message: 'Department is required.' }),
  amount: z.coerce.number().min(1, { message: 'Amount must be greater than 0.' }),
  description: z.string(),
  date: z.date(),
});


export default function AllRequisitionsTab() {
  const [isNewRequestOpen, setIsNewRequestOpen] = useState(false);
  const [previewRequisitionId, setPreviewRequisitionId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();
  
  const form = useForm<z.infer<typeof formSchema>>({
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
          createdAt: data.createdAt ? format(data.createdAt.toDate(), 'PPpp') : 'N/A',
        } as Requisition;
      });
      setRequisitions(requisitionsData);
    } catch (error) {
      console.error("Error fetching requisitions: ", error);
      toast({ title: 'Error', description: 'Failed to fetch requisitions.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  const generatePreviewId = async () => {
    try {
        const configRef = doc(db, 'serialNumberConfigs', 'site-fund-requisition');
        const configDoc = await getDoc(configRef);
        if (configDoc.exists()) {
            const configData = configDoc.data() as SerialNumberConfig;
            const newIndex = configData.startingIndex;
            const formattedIndex = newIndex.toString().padStart(4, '0');
            const requisitionId = `${configData.prefix}${configData.format}${formattedIndex}${configData.suffix}`;
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
      form.reset({
        projectId: '',
        departmentId: '',
        amount: 0,
        description: '',
        date: new Date(),
      });
    }
  }, [isNewRequestOpen, form]);

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

  const handleCreateRequest = async (values: z.infer<typeof formSchema>) => {
    try {
        const configRef = doc(db, 'serialNumberConfigs', 'site-fund-requisition');
        
        const newRequisitionId = await runTransaction(db, async (transaction) => {
            const configDoc = await transaction.get(configRef);
            if (!configDoc.exists()) {
                throw new Error("Serial number configuration not found!");
            }

            const configData = configDoc.data() as SerialNumberConfig;
            const newIndex = configData.startingIndex;
            
            const formattedIndex = newIndex.toString().padStart(4, '0');
            const requisitionId = `${configData.prefix}${configData.format}${formattedIndex}${configData.suffix}`;

            transaction.update(configRef, { startingIndex: newIndex + 1 });
            
            return requisitionId;
        });
        
        const { date, ...restOfRequest } = values;

        await addDoc(collection(db, 'requisitions'), {
            ...restOfRequest,
            date: format(date, 'yyyy-MM-dd'),
            requisitionId: newRequisitionId,
            raisedBy: user?.name || 'Unknown User',
            raisedById: user?.id,
            status: 'Pending',
            stage: 'HOD Approval',
            createdAt: serverTimestamp(),
        });
        
        toast({ title: 'Success', description: 'New fund requisition created.' });
        setIsNewRequestOpen(false);
        fetchRequisitions();
    } catch (error) {
        console.error('Error creating requisition:', error);
        toast({ title: 'Error', description: 'Failed to create requisition.', variant: 'destructive' });
    }
  }

  const getProjectName = (id: string) => projects.find(p => p.id === id)?.projectName || id;
  const getDepartmentName = (id: string) => departments.find(d => d.id === id)?.name || id;

  return (
    <div className="w-full">
        <div className="flex justify-end items-center gap-4 mb-4">
             <Select>
                <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
            </Select>
            <Dialog open={isNewRequestOpen} onOpenChange={setIsNewRequestOpen}>
                <DialogTrigger asChild>
                    <Button>New Request</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>New Site Fund Requisition</DialogTitle>
                        <DialogDescription>
                            Fill out the form to create a new fund request.
                        </DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleCreateRequest)} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 py-4">
                                <div className="space-y-2">
                                    <Label htmlFor="requisitionId">Request ID</Label>
                                    <Input id="requisitionId" type="text" value={previewRequisitionId} readOnly />
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
                                                <Input type="number" placeholder="Enter Amount" {...field} onChange={e => field.onChange(e.target.valueAsNumber)} />
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
                                <FormLabel htmlFor="attachments">Attachments</FormLabel>
                                <Input id="attachments" type="file" multiple />
                                </div>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button type="button" variant="outline">Cancel</Button>
                                </DialogClose>
                                <Button type="submit">Create Request</Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
        </div>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Request ID</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Raised By</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attachments</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requisitions.length > 0 ? (
              requisitions.map((req) => (
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
                  <TableCell>N/A</TableCell>
                  <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                      </Button>
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
      </div>
    </div>
  );
}

    