
'use client';

import { useState, useEffect } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MoreHorizontal } from 'lucide-react';
import { Textarea } from './ui/textarea';
import { collection, getDocs, addDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project, Department, Requisition } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from './auth/AuthProvider';
import { format } from 'date-fns';

const initialNewRequestState = {
  projectId: '',
  departmentId: '',
  amount: '',
  description: '',
};

export default function AllRequisitionsTab() {
  const [isNewRequestOpen, setIsNewRequestOpen] = useState(false);
  const [timestamp, setTimestamp] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newRequest, setNewRequest] = useState(initialNewRequestState);
  const { toast } = useToast();
  const { user } = useAuth();

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
          // Convert Firestore Timestamp to a readable string
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
  
  useEffect(() => {
    if (isNewRequestOpen) {
      const now = new Date();
      setTimestamp(now.toLocaleString('en-GB', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }));
    }
  }, [isNewRequestOpen]);

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

  const handleInputChange = (field: keyof typeof newRequest, value: string) => {
    setNewRequest(prev => ({ ...prev, [field]: value }));
  };

  const handleCreateRequest = async () => {
    if (!newRequest.projectId || !newRequest.departmentId || !newRequest.amount) {
        toast({ title: 'Validation Error', description: 'Project, Department and Amount are required.', variant: 'destructive' });
        return;
    }

    try {
        const docRef = await addDoc(collection(db, 'requisitions'), {
            ...newRequest,
            amount: parseFloat(newRequest.amount),
            raisedBy: user?.name || 'Unknown User',
            raisedById: user?.id,
            status: 'Pending',
            stage: 'HOD Approval',
            createdAt: serverTimestamp(),
            // attachments can be handled here later
        });
        
        toast({ title: 'Success', description: 'New fund requisition created.' });
        setIsNewRequestOpen(false);
        setNewRequest(initialNewRequestState);
        fetchRequisitions(); // Refresh data
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
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="timestamp">Timestamp</Label>
                            <Input id="timestamp" type="text" value={timestamp} readOnly />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="project">Project</Label>
                            <Select value={newRequest.projectId} onValueChange={(value) => handleInputChange('projectId', value)}>
                                <SelectTrigger id="project">
                                    <SelectValue placeholder="Select Project" />
                                </SelectTrigger>
                                <SelectContent>
                                     {projects.map(project => (
                                        <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor="department">Department</Label>
                             <Select value={newRequest.departmentId} onValueChange={(value) => handleInputChange('departmentId', value)}>
                                <SelectTrigger id="department">
                                    <SelectValue placeholder="Select Department" />
                                </SelectTrigger>
                                <SelectContent>
                                    {departments.map(department => (
                                        <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="amount">Amount</Label>
                            <Input id="amount" type="number" placeholder="Enter Amount" value={newRequest.amount} onChange={(e) => handleInputChange('amount', e.target.value)} />
                        </div>
                         <div className="lg:col-span-3 space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea id="description" placeholder="Enter a brief description" value={newRequest.description} onChange={(e) => handleInputChange('description', e.target.value)} />
                        </div>
                        <div className="space-y-2">
                           <Label htmlFor="attachments">Attachments</Label>
                           <Input id="attachments" type="file" multiple />
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button onClick={handleCreateRequest}>Create Request</Button>
                    </DialogFooter>
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
                  <TableCell className="font-medium">{req.id.substring(0, 8)}...</TableCell>
                  <TableCell>{req.createdAt.toString()}</TableCell>
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
