
'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import type { Requisition, Project, Department } from '@/lib/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

export default function MyPendingTasksTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Requisition[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      setIsLoading(true);

      try {
        // Fetch projects and departments for mapping names
        const projectsSnap = await getDocs(collection(db, 'projects'));
        setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));

        const deptsSnap = await getDocs(collection(db, 'departments'));
        setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));

        // Fetch requisitions assigned to the current user
        const q = query(
          collection(db, 'requisitions'),
          where('assignedToId', '==', user.id),
          where('status', 'in', ['Pending', 'In Progress'])
        );

        const querySnapshot = await getDocs(q);
        const tasksData = querySnapshot.docs.map(doc => {
          const data = doc.data();
          const deadline = data.deadline ? data.deadline.toDate() : null;

          return {
            id: doc.id,
            ...data,
            date: format(new Date(data.date), 'dd MMM, yyyy'),
            deadline: deadline ? format(deadline, 'dd MMM, yyyy HH:mm') : 'N/A',
          } as Requisition;
        });
        setTasks(tasksData.sort((a, b) => {
            if (!a.deadline || a.deadline === 'N/A') return 1;
            if (!b.deadline || b.deadline === 'N/A') return -1;
            return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
        }));

      } catch (error) {
        console.error("Error fetching pending tasks: ", error);
        toast({
          title: 'Error',
          description: 'Failed to fetch your pending tasks.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [user, toast]);

  const getProjectName = (id: string) => projects.find(p => p.id === id)?.projectName || id;
  
  const getDeadlineBadgeVariant = (deadline: string | undefined): "default" | "secondary" | "destructive" => {
    if (!deadline || deadline === 'N/A') return "secondary";
    const deadlineDate = new Date(deadline);
    const now = new Date();
    const diff = deadlineDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diff / (1000 * 60 * 60 * 24));

    if (diff < 0) return "destructive";
    if (diffDays <= 2) return "default"; // Use primary color for urgency
    return "secondary";
  };


  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>Request ID</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Current Stage</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead className="text-center">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                <TableCell><Skeleton className="h-5 w-36" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-8 w-20 mx-auto" /></TableCell>
              </TableRow>
            ))
          ) : tasks.length > 0 ? (
            tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell className="font-medium">{task.requisitionId}</TableCell>
                <TableCell>{getProjectName(task.projectId)}</TableCell>
                <TableCell>{task.amount.toLocaleString()}</TableCell>
                <TableCell>{task.stage}</TableCell>
                <TableCell>
                  <Badge variant={getDeadlineBadgeVariant(task.deadline as string)}>{task.deadline}</Badge>
                </TableCell>
                <TableCell className="text-center">
                  <Button variant="outline" size="sm">View Details</Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={6} className="text-center h-24">
                You have no pending tasks.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
