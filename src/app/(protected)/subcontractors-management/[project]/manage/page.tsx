
'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2, ShieldAlert, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, deleteDoc, query, where } from 'firebase/firestore';
import type { Subcontractor, Project, ContactPerson, WorkOrder } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useParams } from 'next/navigation';
import { format } from 'date-fns';

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export default function ManageSubcontractorsPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const { can, isLoading: authLoading } = useAuthorization();

  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const canViewPage = can('View', 'Subcontractors Management.Manage Subcontractors');
  const canAdd = can('Add', 'Subcontractors Management.Manage Subcontractors');
  const canEdit = can('Edit', 'Subcontractors Management.Manage Subcontractors');
  const canDelete = can('Delete', 'Subcontractors Management.Manage Subcontractors');

  const fetchData = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const project = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

      if (!project) {
        toast({ title: "Project not found", variant: "destructive" });
        return;
      }
      setCurrentProject(project);

      const [subsSnap, woSnap] = await Promise.all([
        getDocs(collection(db, 'projects', project.id, 'subcontractors')),
        getDocs(collection(db, 'projects', project.id, 'workOrders'))
      ]);

      const subsData = subsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subcontractor));
      setSubcontractors(subsData);

      const woData = woSnap.docs.map(d => ({ id: d.id, ...d.data() } as WorkOrder));
      setWorkOrders(woData);

    } catch (error) {
      toast({ title: 'Error', description: 'Failed to fetch data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };
  
  useEffect(() => {
    if (!authLoading && canViewPage) {
      fetchData();
    } else if (!authLoading) {
      setIsLoading(false);
    }
  }, [projectSlug, authLoading, canViewPage, toast]);


  const handleDelete = async (id: string) => {
    if (!currentProject) return;
    try {
      await deleteDoc(doc(db, 'projects', currentProject.id, 'subcontractors', id));
      toast({ title: 'Success', description: 'Subcontractor deleted.'});
      fetchData();
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to delete subcontractor.', variant: 'destructive'});
    }
  };
  
  const getPrimaryContact = (sub: Subcontractor) => {
      const projContact = sub.contacts?.find(c => c.type === 'Project');
      return projContact || sub.contacts?.[0] || { name: 'N/A', mobile: 'N/A' };
  }
  
  const toggleRowExpansion = (subcontractorId: string) => {
    setExpandedRows(prev => {
        const newSet = new Set(prev);
        if (newSet.has(subcontractorId)) {
            newSet.delete(subcontractorId);
        } else {
            newSet.add(subcontractorId);
        }
        return newSet;
    });
  };

  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  const formatDate = (date: any) => date ? format(new Date(date), 'dd MMM, yyyy') : 'N/A';

  if (authLoading || (isLoading && canViewPage)) {
    return <div className="w-full px-4 sm:px-6 lg:px-8"><Skeleton className="h-96" /></div>;
  }

  if (!canViewPage) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center gap-2">
              <Link href={`/subcontractors-management/${projectSlug}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
              <h1 className="text-xl font-bold">Manage Subcontractors</h1>
          </div>
          <Card>
              <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
              <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
          </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
            <h1 className="text-2xl font-bold">Manage Subcontractors</h1>
        </div>
        <Link href={`/subcontractors-management/${projectSlug}/manage/add`}>
            <Button disabled={!canAdd}><Plus className="mr-2 h-4 w-4"/> Add Subcontractor</Button>
        </Link>
      </div>
      
       <Card>
          <CardContent className="p-0">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>Legal Name</TableHead>
                        <TableHead>DBA Name</TableHead>
                        <TableHead>Primary Contact</TableHead>
                        <TableHead>GST No.</TableHead>
                        <TableHead>PAN No.</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-8" /></TableCell></TableRow>
                        ))
                    ) : subcontractors.length > 0 ? (
                        subcontractors.map(sub => {
                            const primaryContact = getPrimaryContact(sub);
                            const isExpanded = expandedRows.has(sub.id);
                            const subcontractorWorkOrders = workOrders.filter(wo => wo.subcontractorId === sub.id);
                            return (
                                <Fragment key={sub.id}>
                                <TableRow>
                                    <TableCell>
                                        {subcontractorWorkOrders.length > 0 && (
                                            <Button size="icon" variant="ghost" onClick={() => toggleRowExpansion(sub.id)}>
                                                {isExpanded ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
                                            </Button>
                                        )}
                                    </TableCell>
                                    <TableCell className="font-medium">{sub.legalName}</TableCell>
                                    <TableCell>{sub.dbaName || 'N/A'}</TableCell>
                                    <TableCell>{primaryContact.name} ({primaryContact.mobile})</TableCell>
                                    <TableCell>{sub.gstNumber || 'N/A'}</TableCell>
                                    <TableCell>{sub.panNumber || 'N/A'}</TableCell>
                                    <TableCell><Badge variant={sub.status === 'Active' ? 'default' : 'secondary'}>{sub.status}</Badge></TableCell>
                                    <TableCell className="text-right space-x-2">
                                        <Link href={`/subcontractors-management/${projectSlug}/manage/edit/${sub.id}`}>
                                            <Button variant="outline" size="sm" disabled={!canEdit}>
                                                <Edit className="mr-2 h-4 w-4" />Edit
                                            </Button>
                                        </Link>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="destructive" size="sm" disabled={!canDelete}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete "{sub.legalName}".</AlertDialogDescription></AlertDialogHeader>
                                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(sub.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </TableCell>
                                </TableRow>
                                {isExpanded && (
                                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                                        <TableCell colSpan={8} className="p-0">
                                            <div className="p-4">
                                                <h4 className="font-semibold mb-2 ml-2">Work Orders</h4>
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>WO No.</TableHead>
                                                            <TableHead>Date</TableHead>
                                                            <TableHead>Total Amount</TableHead>
                                                            <TableHead>Status</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {subcontractorWorkOrders.map(wo => (
                                                            <TableRow key={wo.id}>
                                                                <TableCell>{wo.workOrderNo}</TableCell>
                                                                <TableCell>{formatDate(wo.date)}</TableCell>
                                                                <TableCell>{formatCurrency(wo.totalAmount)}</TableCell>
                                                                <TableCell>{wo.status || 'Active'}</TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                                </Fragment>
                            )
                        })
                    ) : (
                        <TableRow>
                            <TableCell colSpan={8} className="text-center h-24">
                                No subcontractors found for this project.
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
