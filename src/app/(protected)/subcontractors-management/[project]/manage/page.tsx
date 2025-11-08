
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, deleteDoc, query, where } from 'firebase/firestore';
import type { Subcontractor, Project, ContactPerson } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useParams } from 'next/navigation';

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
  const [isLoading, setIsLoading] = useState(true);

  const canViewPage = can('View', 'Subcontractors Management.Manage Subcontractors');
  const canAdd = can('Add', 'Subcontractors Management.Manage Subcontractors');
  const canEdit = can('Edit', 'Subcontractors Management.Manage Subcontractors');
  const canDelete = can('Delete', 'Subcontractors Management.Manage Subcontractors');

  const fetchData = useCallback(async () => {
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

      const subsSnap = await getDocs(collection(db, 'projects', project.id, 'subcontractors'));
      const data = subsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subcontractor));
      setSubcontractors(data);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to fetch data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, toast]);

  useEffect(() => {
    if (!authLoading && canViewPage) {
      fetchData();
    } else if (!authLoading) {
      setIsLoading(false);
    }
  }, [authLoading, canViewPage, fetchData]);


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
                            <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-8" /></TableCell></TableRow>
                        ))
                    ) : subcontractors.length > 0 ? (
                        subcontractors.map(sub => {
                            const primaryContact = getPrimaryContact(sub);
                            return (
                                <TableRow key={sub.id}>
                                    <TableCell className="font-medium">{sub.legalName}</TableCell>
                                    <TableCell>{sub.dbaName || 'N/A'}</TableCell>
                                    <TableCell>{primaryContact.name} ({primaryContact.mobile})</TableCell>
                                    <TableCell>{sub.gstNumber || 'N/A'}</TableCell>
                                    <TableCell>{sub.panNumber || 'N/A'}</TableCell>
                                    <TableCell><Badge variant={sub.status === 'Active' ? 'default' : 'secondary'}>{sub.status}</Badge></TableCell>
                                    <TableCell className="text-right">
                                        <Link href={`/subcontractors-management/${projectSlug}/manage/edit/${sub.id}`}>
                                            <Button variant="outline" size="sm" disabled={!canEdit}>
                                                <Edit className="mr-2 h-4 w-4" />Edit
                                            </Button>
                                        </Link>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="destructive" size="sm" className="ml-2" disabled={!canDelete}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete "{sub.legalName}".</AlertDialogDescription></AlertDialogHeader>
                                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(sub.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </TableCell>
                                </TableRow>
                            )
                        })
                    ) : (
                        <TableRow>
                            <TableCell colSpan={7} className="text-center h-24">No subcontractors found for this project.</TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
          </CardContent>
       </Card>
    </div>
  );
}
