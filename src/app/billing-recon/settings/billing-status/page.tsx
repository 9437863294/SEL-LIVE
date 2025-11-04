
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Save, Edit, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import type { Project, Signature } from '@/lib/types';
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
import { Textarea } from '@/components/ui/textarea';

/** Extra fields present in Firestore but not declared on core Project type */
type ProjectWithExtras = Project & {
  woNo?: string;
  refRoNo?: string;
  nameOfSs?: string;
  subWork?: string;
  billingRequired?: boolean;
  projectName?: string; // already on your Project in many setups, but keep as optional fallback
  siteInCharge?: string;
  projectDivision?: string;
  projectSite?: string;
  signatures?: Signature[];
  projectDescription?: string;
};

type ProjectWithExtras = Project & ProjectExtras;

export default function BillingStatusPage() {
  const { toast } = useToast();

  const [projects, setProjects] = useState<ProjectWithExtras[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Unified dialog state
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'enable' | 'edit'>('enable');
  const [pendingProject, setPendingProject] = useState<ProjectWithExtras | null>(null);

  // Form state for the dialog
  const [woInput, setWoInput] = useState('');
  const [nameOfWork, setNameOfWork] = useState('');
  const [refRoNo, setRefRoNo] = useState('');
  const [nameOfSs, setNameOfSs] = useState('');
  const [subWork, setSubWork] = useState('');
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [projectDescription, setProjectDescription] = useState('');
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  const resetForm = () => {
    setPendingProject(null);
    setWoInput('');
    setNameOfWork('');
    setRefRoNo('');
    setNameOfSs('');
    setSubWork('');
    setSignatures([]);
    setProjectDescription('');
  };

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'projects'));
      const projectsData = querySnapshot.docs.map((d) => {
        // Remove any 'id' coming from Firestore data to avoid duplicate key
        const raw = d.data() as (ProjectWithExtras & { id?: string }) | undefined;
        const { id: _ignored, ...rest } = raw ?? {};
        return { id: d.id, ...rest } as ProjectWithExtras;
      });
      setProjects(projectsData);
    } catch (error) {
      console.error('Error fetching projects: ', error);
      toast({ title: 'Error', description: 'Failed to fetch projects.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);
  

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleSignatureChange = (id: string, field: 'designation' | 'name', value: string) => {
    setSignatures(prev => prev.map(sig => sig.id === id ? { ...sig, [field]: value } : sig));
  };
  
  const handleAddSignature = () => {
    setSignatures(prev => [...prev, { id: crypto.randomUUID(), designation: '', name: '' }]);
  };

  const handleRemoveSignature = (id: string) => {
    setSignatures(prev => prev.filter(sig => sig.id !== id));
  };

  // Toggle handler
  const handleBillingToggle = async (project: ProjectWithExtras, nextChecked: boolean) => {
    if (!project.id) return;

    if (!nextChecked) {
      // Turning OFF immediately (no extra details required)
      setSavingId(project.id);
      try {
        const projectRef = doc(db, 'projects', project.id);
        await updateDoc(projectRef, { billingRequired: false });
        setProjects((prev) =>
          prev.map((p) => (p.id === project.id ? { ...p, billingRequired: false } : p))
        );
        toast({ title: 'Updated', description: `${project.projectName ?? 'Project'} billing disabled.` });
      } catch (error) {
        toast({ title: 'Error', description: 'Failed to update billing status.', variant: 'destructive' });
      } finally {
        setSavingId(null);
      }
      return;
    }

    // Turning ON → show dialog to collect details first
    setDialogMode('enable');
    setPendingProject(project);
    setWoInput(project.woNo ?? '');
    setNameOfWork(project.projectName ?? '');
    setRefRoNo(project.refRoNo ?? '');
    setNameOfSs(project.nameOfSs ?? '');
    setSubWork(project.subWork ?? '');
    setSignatures(project.signatures?.map(s => ({...s, id: crypto.randomUUID()})) || [{ id: crypto.randomUUID(), designation: 'Site In charge', name: ''}]);
    setProjectDescription(project.projectDescription ?? '');
    setIsDetailDialogOpen(true);
  };

  const openEditDialog = (project: ProjectWithExtras) => {
    setDialogMode('edit');
    setPendingProject(project);
    setWoInput(project.woNo ?? '');
    setNameOfWork(project.projectName ?? '');
    setRefRoNo(project.refRoNo ?? '');
    setNameOfSs(project.nameOfSs ?? '');
    setSubWork(project.subWork ?? '');
    setSignatures(project.signatures?.map(s => ({...s, id: crypto.randomUUID()})) || [{ id: crypto.randomUUID(), designation: 'Site In charge', name: ''}]);
    setProjectDescription(project.projectDescription ?? '');
    setIsDetailDialogOpen(true);
  };

  const saveProjectDetails = async () => {
    if (!pendingProject?.id) return;

    const woNo = woInput.trim();
    if (!woNo) {
      toast({ title: 'WO No required', description: 'Please enter a valid Work Order No.', variant: 'destructive' });
      return;
    }

    setIsSavingDetails(true);
    try {
      const projectRef = doc(db, 'projects', pendingProject.id);

      const updateData: Partial<ProjectWithExtras> = {
        woNo,
        projectName: nameOfWork,
        refRoNo,
        nameOfSs,
        subWork,
        signatures: signatures.map(({ id, ...rest }) => rest), // remove temporary client-side ID
        projectDescription: projectDescription,
      };

      if (dialogMode === 'enable') {
        updateData.billingRequired = true;
      }

      await updateDoc(projectRef, updateData);

      // Optimistic local update
      setProjects((prev) =>
        prev.map((p) => (p.id === pendingProject.id ? { ...p, ...updateData } : p))
      );

      toast({
        title: 'Success',
        description: `Project details for ${nameOfWork || pendingProject.projectName || 'project'} have been saved.`,
      });
      setIsDetailDialogOpen(false);
      resetForm();
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
                      <TableCell>
                        <Skeleton className="h-5 w-48" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-32" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-12" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Skeleton className="h-8 w-20" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : projects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                      No projects found.
                    </TableCell>
                  </TableRow>
                ) : (
                  projects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium">{project.projectName}</TableCell>
                      <TableCell>{project.woNo ?? '—'}</TableCell>
                      <TableCell>
                        {savingId === project.id ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Switch
                            checked={!!project.billingRequired}
                            onCheckedChange={(checked) => handleBillingToggle(project, checked)}
                            disabled={Boolean(isDetailDialogOpen && pendingProject?.id === project.id)}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(project)}
                          disabled={savingId === project.id}
                        >
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

      <Dialog
        open={isDetailDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsDetailDialogOpen(false);
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'enable' ? 'Enter Work Order Details' : 'Edit Work Order Details'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="nameOfWork">Name of Work</Label>
                  <Input
                    id="nameOfWork"
                    value={nameOfWork}
                    onChange={(e) => setNameOfWork(e.target.value)}
                    placeholder="e.g., 33kV Bay Extension at XYZ"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="refRoNo">Ref. RO No</Label>
                  <Input
                    id="refRoNo"
                    value={refRoNo}
                    onChange={(e) => setRefRoNo(e.target.value)}
                    placeholder="e.g., RO/2025/123"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="woNo">WO No</Label>
                  <Input
                    id="woNo"
                    value={woInput}
                    onChange={(e) => setWoInput(e.target.value)}
                    placeholder="e.g., WO-2025-001"
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nameOfSs">Name of S/S</Label>
                  <Input
                    id="nameOfSs"
                    value={nameOfSs}
                    onChange={(e) => setNameOfSs(e.target.value)}
                    placeholder="e.g., Berhampur 132/33kV"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subWork">Name of Work 2</Label>
                  <Input
                    id="subWork"
                    value={subWork}
                    onChange={(e) => setSubWork(e.target.value)}
                    placeholder="e.g., Stringing + Bay Works"
                  />
                </div>
                 <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="projectDescription">Project Description</Label>
                    <Textarea
                        id="projectDescription"
                        value={projectDescription}
                        onChange={(e) => setProjectDescription(e.target.value)}
                        placeholder="Detailed description of the project scope..."
                    />
                </div>
            </div>
            
            <div className="space-y-4 border-t pt-4 mt-2">
                <h3 className="font-medium">Signatories for Print</h3>
                {signatures.map((sig, index) => (
                    <div key={sig.id} className="flex items-center gap-2">
                        <Input 
                            placeholder="Designation (e.g., Site In charge)" 
                            value={sig.designation} 
                            onChange={(e) => handleSignatureChange(sig.id, 'designation', e.target.value)}
                            className="flex-1"
                        />
                        <Input 
                            placeholder="Name / Department" 
                            value={sig.name} 
                            onChange={(e) => handleSignatureChange(sig.id, 'name', e.target.value)}
                             className="flex-1"
                        />
                        <Button variant="ghost" size="icon" onClick={() => handleRemoveSignature(sig.id)} disabled={signatures.length <= 1}>
                            <Trash2 className="h-4 w-4 text-destructive"/>
                        </Button>
                    </div>
                ))}
                <Button variant="outline" size="sm" onClick={handleAddSignature}>
                    <Plus className="mr-2 h-4 w-4"/> Add Signatory
                </Button>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline" disabled={isSavingDetails}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={saveProjectDetails} disabled={isSavingDetails}>
              {isSavingDetails ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {dialogMode === 'enable' ? 'Save & Enable' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

