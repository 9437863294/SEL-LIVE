
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
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project, Department } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';


const requisitions: any[] = [];

export default function AllRequisitionsTab() {
  const [isNewRequestOpen, setIsNewRequestOpen] = useState(false);
  const [timestamp, setTimestamp] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (isNewRequestOpen) {
      const now = new Date();
      setTimestamp(now.toLocaleString('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
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
  }, [toast]);

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
                            <Select>
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
                             <Select>
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
                            <Input id="amount" type="number" placeholder="Enter Amount" />
                        </div>
                         <div className="lg:col-span-3 space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea id="description" placeholder="Enter a brief description" />
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
                        <Button onClick={() => setIsNewRequestOpen(false)}>Create Request</Button>
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
              <TableHead>Deadline</TableHead>
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
                  <TableCell className="font-medium">{req.id}</TableCell>
                  <TableCell>
                    <div>{req.date}</div>
                    <div className="text-xs text-muted-foreground">{req.time}</div>
                  </TableCell>
                  <TableCell>
                    <div>{req.deadlineDate}</div>
                    {req.deadlineTime && <div className="text-xs text-muted-foreground">{req.deadlineTime}</div>}
                  </TableCell>
                  <TableCell>{req.project}</TableCell>
                  <TableCell>{req.department}</TableCell>
                  <TableCell>{req.raisedBy}</TableCell>
                  <TableCell>{req.description}</TableCell>
                  <TableCell>{req.amount}</TableCell>
                  <TableCell>{req.stage}</TableCell>
                  <TableCell>{req.status}</TableCell>
                  <TableCell>{req.attachments}</TableCell>
                  <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                      </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={12} className="text-center h-24">
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
