
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Eye, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, collectionGroup } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { WorkOrder, Project } from '@/lib/types';
import { useParams, useRouter } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export default function WorkOrderLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const router = useRouter();
  const projectSlug = params.project as string;
  const { can, isLoading: authLoading } = useAuthorization();
  
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const canViewPage = can('View', 'Subcontractors Management.Work Order');

  useEffect(() => {
    const fetchData = async () => {
      if (!projectSlug) return;
      setIsLoading(true);

      try {
        let woQuery;
        
        const projectsQuery = query(collection(db, 'projects'));
        const projectsSnapshot = await getDocs(projectsQuery);
        const allProjects = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));

        if (projectSlug === 'all') {
          woQuery = query(collectionGroup(db, 'workOrders'));
        } else {
          const project = allProjects.find(p => slugify(p.projectName) === projectSlug);

          if (!project) {
            console.error("Project not found");
            setIsLoading(false);
            return;
          }
          setCurrentProject(project);
          woQuery = query(collection(db, 'projects', project.id, 'workOrders'));
        }
        
        const querySnapshot = await getDocs(woQuery);
        const entries = querySnapshot.docs.map(doc => {
            const data = doc.data();
            const projectId = doc.ref.parent.parent?.id;
            const project = allProjects.find(p => p.id === projectId);

            return { 
                id: doc.id, 
                ...data,
                projectName: project?.projectName || 'Unknown',
                projectSlug: project ? slugify(project.projectName) : '',
            } as WorkOrder
        });

        // Client-side sorting for all views to avoid index errors
        entries.sort((a,b) => {
            const dateA = a.date ? new Date(a.date).getTime() : 0;
            const dateB = b.date ? new Date(b.date).getTime() : 0;
            return dateB - dateA;
        });
        
        setWorkOrders(entries);
        
      } catch (error: any) {
        console.error("Error fetching work orders: ", error);
        toast({ title: 'Error', description: 'Failed to fetch work orders.', variant: 'destructive' });
      }
      setIsLoading(false);
    };

    if (!authLoading && canViewPage) {
      fetchData();
    } else if (!authLoading) {
      setIsLoading(false);
    }
  }, [projectSlug, toast, authLoading, canViewPage]);

  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return format(d, 'dd MMM, yyyy');
  };
  
  const handleRowClick = (workOrder: WorkOrder) => {
    const slug = workOrder.projectSlug || projectSlug;
    router.push(`/subcontractors-management/${slug}/work-order/${workOrder.id}`);
  };

  if (authLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-96 mb-6" />
            <Skeleton className="h-[500px] w-full" />
        </div>
    );
  }

  if (!canViewPage) {
     return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href={`/subcontractors-management/${projectSlug}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                <h1 className="text-xl font-bold">Work Order Log</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view work orders.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
            </Card>
        </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/subcontractors-management/${projectSlug}`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Work Order Log</h1>
        </div>
        {projectSlug !== 'all' && (
            <Link href={`/subcontractors-management/${projectSlug}/work-order/create`}>
              <Button><Plus className="mr-2 h-4 w-4" /> Create Work Order</Button>
            </Link>
        )}
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>WO No.</TableHead>
                <TableHead>Date</TableHead>
                {projectSlug === 'all' && <TableHead>Project</TableHead>}
                <TableHead>Subcontractor</TableHead>
                <TableHead>Total Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={projectSlug === 'all' ? 6 : 5}><Skeleton className="h-5" /></TableCell>
                  </TableRow>
                ))
              ) : workOrders.length > 0 ? (
                workOrders.map((wo) => (
                  <TableRow key={wo.id} className="cursor-pointer" onClick={() => handleRowClick(wo)}>
                    <TableCell className="font-medium">{wo.workOrderNo}</TableCell>
                    <TableCell>{formatDate(wo.date)}</TableCell>
                    {projectSlug === 'all' && <TableCell>{wo.projectName}</TableCell>}
                    <TableCell>{wo.subcontractorName}</TableCell>
                    <TableCell>{formatCurrency(wo.totalAmount)}</TableCell>
                    <TableCell className="text-right">
                       <Button variant="ghost" size="icon">
                          <Eye className="h-4 w-4" />
                       </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={projectSlug === 'all' ? 6 : 5} className="text-center h-24">
                    No work orders found for this project.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
