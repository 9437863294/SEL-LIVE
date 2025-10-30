
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Save, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import type { Project } from '@/lib/types';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export default function BillingStatusPage() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Unified dialog state
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'enable' | 'edit'>('enable');
  const [pendingProject, setPendingProject] = useState<Project | null>(null);
  
  // Form state for the dialog
  const [woInput, setWoInput] = useState('');
  const [nameOfWork, setNameOfWork] = useState('');
  const [refRoNo, setRefRoNo] = useState('');
  const [nameOfSs, setNameOfSs] = useState('');
  const [subWork, setSubWork] = useState('');
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'projects'));
      const projectsData = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Project));
      setProjects(projectsData);
    } catch (error) {
      console.error('Error fetching projects: ', error);
      toast({ title: 'Error', description: 'Failed to fetch projects.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle handler
  const handleBillingToggle = async (project: Project, nextChecked: boolean) => {
    if (!nextChecked) { // Turning OFF
      setSavingId(project.id);
      try {
        const projectRef = doc(db, 'projects', project.id);
        await updateDoc(projectRef, { billingRequired: false });
        setProjects(prev => prev.map(p => (p.id === project.id ? { ...p, billingRequired: false } : p)));
        toast({ title: 'Updated', description: `${project.projectName} billing disabled.` });
      } catch (error) {
        toast({ title: 'Error', description: 'Failed to update billing status.', variant: 'destructive' });
      } finally {
        setSavingId(null);
      }
      return;
    }

    // Turning ON
    setDialogMode('enable');
    setPendingProject(project);
    setWoInput((project as any).woNo ?? '');
    setNameOfWork(project.projectName || '');
    setRefRoNo((project as any).refRoNo || '');
    setNameOfSs((project as any).nameOfSs || '');
    setSubWork((project as any).subWork || '');
    setIsDetailDialogOpen(true);
  };
  
  const openEditDialog = (project: Project) => {
    setDialogMode('edit');
    setPendingProject(project);
    setWoInput((project as any).woNo ?? '');
    setNameOfWork(project.projectName || '');
    setRefRoNo((project as any).refRoNo || '');
    setNameOfSs((project as any).nameOfSs || '');
    setSubWork((project as any).subWork || '');
    setIsDetailDialogOpen(true);
  };

  const saveProjectDetails = async () => {
    if (!pendingProject) return;
    const woNo = woInput.trim();
    if (!woNo) {
      toast({ title: 'WO No required', description: 'Please enter a valid Work Order No.', variant: 'destructive' });
      return;
    }

    setIsSavingDetails(true);
    try {
      const projectRef = doc(db, 'projects', pendingProject.id);
      const updateData: Partial<Project> = {
        woNo,
        projectName: nameOfWork,
        refRoNo,
        nameOfSs,
        subWork
      };
      
      // Only set billingRequired to true if we are enabling it for the first time
      if (dialogMode === 'enable') {
        updateData.billingRequired = true;
      }

      await updateDoc(projectRef, updateData);

      setProjects(prev =>
        prev.map(p => (p.id === pendingProject.id ? { ...p, ...updateData } : p))
      );

      toast({ title: 'Success', description: `Project details for ${nameOfWork} have been saved.` });
      setIsDetailDialogOpen(false);
      setPendingProject(null);
      setWoInput('');
    } catch (error) {
      console.error('Error saving project details:', error);
      toast({ title: 'Error', description: 'Failed to save project details.', variant: 'destructive' });
    } finally {
      setIsSavingDetails(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/billing-recon/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Billing Status</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project Billing Status</CardTitle>
          <CardDescription>Enable or disable billing requirements for each project.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project Name</TableHead>
                  <TableHead>WO No</TableHead>
                  <TableHead>Billing Required</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-12" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-20" /></TableCell>
                    </TableRow>
                  ))
                ) : (
                  projects.map(project => (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium">{project.projectName}</TableCell>
                      <TableCell>{(project as any).woNo ?? '—'}</TableCell>
                      <TableCell>
                        {savingId === project.id ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Switch
                            checked={!!project.billingRequired}
                            onCheckedChange={(checked) => handleBillingToggle(project, checked)}
                          />
                        )}
                      </TableCell>
                       <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => openEditDialog(project)}>
                            <Edit className="mr-2 h-4 w-4" /> Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDetailDialogOpen} onOpenChange={(open) => { if (!open) { setIsDetailDialogOpen(false); setPendingProject(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Enter Work Order Details</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
            <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="nameOfWork">Name of Work</Label>
                <Input id="nameOfWork" value={nameOfWork} onChange={(e) => setNameOfWork(e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="refRoNo">Ref. RO No</Label>
                <Input id="refRoNo" value={refRoNo} onChange={(e) => setRefRoNo(e.target.value)} />
            </div>
             <div className="space-y-2">
                <Label htmlFor="woNo">WO No</Label>
                <Input
                id="woNo"
                value={woInput}
                onChange={(e) => setWoInput(e.target.value)}
                placeholder="e.g., WO-2024-001"
                autoFocus
                />
            </div>
            <div className="space-y-2">
                <Label htmlFor="nameOfSs">Name of S/S</Label>
                <Input id="nameOfSs" value={nameOfSs} onChange={(e) => setNameOfSs(e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="subWork">Name of Work 2</Label>
                <Input id="subWork" value={subWork} onChange={(e) => setSubWork(e.target.value)} />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={saveProjectDetails} disabled={isSavingDetails}>
              {isSavingDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {dialogMode === 'enable' ? 'Save & Enable' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
