'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ViewRequisitionDialog from '@/components/ViewRequisitionDialog';

/* ---------------- helpers ---------------- */

function isFsTimestamp(v: unknown): v is Timestamp {
  return !!v && typeof v === 'object' && typeof (v as any).toDate === 'function';
}

function toDateSafe(v: unknown): Date | null {
  if (!v) return null;
  if (isFsTimestamp(v)) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v as any);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateSafe(v: unknown, fmt = 'dd MMM, yyyy HH:mm'): string {
  const d = toDateSafe(v);
  return d ? format(d, fmt) : '—';
}

type BadgeVariant = 'default' | 'secondary' | 'destructive';

function getDeadlineBadgeVariant(deadline: unknown): BadgeVariant {
  const d = toDateSafe(deadline);
  if (!d) return 'secondary';
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffMs < 0) return 'destructive';
  if (diffDays <= 2) return 'default';
  return 'secondary';
}

function inr(amount: number | string | null | undefined): string {
  const n = typeof amount === 'number' ? amount : Number(amount ?? 0);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n || 0);
}

/* ---------------- component ---------------- */

export default function MyPendingTasksTab() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [tasks, setTasks] = useState<Requisition[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedRequisition, setSelectedRequisition] = useState<Requisition | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const assigneeId = useMemo(
    () => (user as any)?.id ?? (user as any)?.uid ?? null,
    [user]
  );

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) {
      const maybeAny = p as any;
      const name: string = maybeAny.projectName ?? maybeAny.name ?? p.id;
      map.set(p.id as any, name);
    }
    return map;
  }, [projects]);

  const getProjectName = useCallback(
    (id: string) => projectNameById.get(id) ?? id,
    [projectNameById]
  );

  const fetchData = useCallback(async () => {
    if (!assigneeId) return;

    setIsLoading(true);

    try {
      const [projectsSnap, deptsSnap] = await Promise.all([
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'departments')),
      ]);

      if (!isMountedRef.current) return;

      // Avoid id overwrite by stripping any existing `id` from data
      const projectsData: Project[] = projectsSnap.docs.map((doc) => {
        const { id: _ignored, ...rest } = (doc.data() as any) ?? {};
        return { id: doc.id, ...(rest as Omit<Project, 'id'>) };
      });

      const departmentsData: Department[] = deptsSnap.docs.map((doc) => {
        const { id: _ignored, ...rest } = (doc.data() as any) ?? {};
        return { id: doc.id, ...(rest as Omit<Department, 'id'>) };
      });

      setProjects(projectsData);
      setDepartments(departmentsData);

      const qRef = query(
        collection(db, 'requisitions'),
        where('assignees', 'array-contains', assigneeId),
        where('status', 'in', ['Pending', 'In Progress', 'Needs Review'])
      );

      const reqSnap = await getDocs(qRef);
      if (!isMountedRef.current) return;

      // Strongly type the data to satisfy Requisition
      const tasksData: Requisition[] = reqSnap.docs.map((doc) => {
        const raw = doc.data() as unknown as Omit<Requisition, 'id'>;
        // If your Firestore schema might be missing some fields in practice,
        // you can add default fallbacks here before the spread.
        return { id: doc.id, ...raw };
      });

      setTasks(tasksData);
    } catch (error) {
      console.error('Error fetching pending tasks: ', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch your pending tasks.',
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [assigneeId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleViewDetails = (task: Requisition) => {
    setSelectedRequisition(task);
    setIsViewDialogOpen(true);
  };

  return (
    <>
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
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                  <TableCell className="text-center">
                    <Skeleton className="h-8 w-24 mx-auto" />
                  </TableCell>
                </TableRow>
              ))
            ) : tasks.length > 0 ? (
              tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="font-medium">
                    {(task as any).requisitionId ?? task.id}
                  </TableCell>

                  <TableCell>
                    {getProjectName(
                      (task as any).projectId ?? (task as any).project?.id ?? '—'
                    )}
                  </TableCell>

                  <TableCell>{inr((task as any).amount)}</TableCell>

                  <TableCell>
                    {(task as any).stage ?? (task as any).status ?? '—'}
                  </TableCell>

                  <TableCell>
                    {(task as any).deadline ? (
                      <Badge variant={getDeadlineBadgeVariant((task as any).deadline)}>
                        {formatDateSafe((task as any).deadline)}
                      </Badge>
                    ) : (
                      'N/A'
                    )}
                  </TableCell>

                  <TableCell className="text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewDetails(task)}
                    >
                      View Details
                    </Button>
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

      {selectedRequisition && (
        <ViewRequisitionDialog
          isOpen={isViewDialogOpen}
          onOpenChange={setIsViewDialogOpen}
          requisition={selectedRequisition}
          projects={projects}
          departments={departments}
          onRequisitionUpdate={fetchData}
        />
      )}
    </>
  );
}
