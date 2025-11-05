
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Trash2, Plus, GripVertical, ShieldAlert, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import type { WorkflowStep, User } from '@/lib/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { useParams } from 'next/navigation';

const initialSteps: WorkflowStep[] = [
  {
    id: '1',
    name: 'Verification',
    tat: 24,
    assignmentType: 'User-based',
    assignedTo: [],
    actions: ['Approve', 'Reject', 'Needs Correction'],
    upload: 'Required',
  },
];

const allActions = ['Approve', 'Reject', 'Needs Correction'];

export default function MvacWorkflowConfigurationPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const params = useParams();
  const projectSlug = params.project as string;

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  const canViewPage = can('View Settings', 'Billing Recon.MVAC');
  const canEditPage = can('Edit Settings', 'Billing Recon.MVAC');

  useEffect(() => {
    if (isAuthLoading) return;
    if (canViewPage) {
      fetchData();
    } else {
      setIsLoading(false);
    }
  }, [isAuthLoading, canViewPage]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      setUsers(usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as User)));
      
      const workflowRef = doc(db, 'workflows', 'mvac-workflow');
      const workflowSnap = await getDoc(workflowRef);

      if (workflowSnap.exists() && workflowSnap.data().steps?.length > 0) {
        setSteps(workflowSnap.data().steps);
      } else {
        setSteps(initialSteps);
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to fetch configuration data.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const handleAddStep = () => {
    const newStep: WorkflowStep = {
      id: String(steps.length + 1),
      name: `New Step ${steps.length + 1}`,
      tat: 8,
      assignmentType: 'User-based',
      assignedTo: [],
      actions: [],
      upload: 'Optional',
    };
    setSteps([...steps, newStep]);
  };
  
  const handleDeleteStep = (id: string) => {
    setSteps(steps.filter(step => step.id !== id).map((step, index) => ({ ...step, id: (index + 1).toString() })));
  };

  const handleStepChange = (id: string, field: keyof WorkflowStep, value: any) => {
    setSteps(steps.map(step => (step.id === id ? { ...step, [field]: value } : step)));
  };

  const handleActionChange = (stepId: string, action: string, checked: boolean) => {
    setSteps(steps.map(step => {
      if (step.id === stepId) {
        const newActions = checked ? [...step.actions, action] : step.actions.filter(a => a !== action);
        return { ...step, actions: newActions };
      }
      return step;
    }));
  };

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const workflowRef = doc(db, 'workflows', 'mvac-workflow');
      await setDoc(workflowRef, { steps });
      await logUserActivity({
        userId: user.id,
        action: 'Update MVAC Workflow',
        details: { stepCount: steps.length }
      });
      toast({ title: 'Success', description: 'Workflow configuration saved.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save configuration.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if(isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full max-w-4xl mx-auto"><Skeleton className="h-96 w-full" /></div>
    );
  }

  if(!canViewPage) {
    return (
        <div className="w-full max-w-4xl mx-auto">
            <div className="mb-6 flex items-center gap-2">
                <Link href={`/billing-recon/${projectSlug}/mvac/settings`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                <h1 className="text-xl font-bold">MVAC Workflow Configuration</h1>
            </div>
            <Card>
                <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view or edit this page.</CardDescription></CardHeader>
                <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
            </Card>
        </div>
    );
  }
  
  return (
    <div className="w-full max-w-4xl mx-auto pr-4">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/billing-recon/${projectSlug}/mvac/settings`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-xl font-bold">MVAC Workflow Configuration</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving || !canEditPage}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Workflow
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workflow Steps</CardTitle>
          <CardDescription>Define the approval process for MVAC entries.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Accordion type="multiple" className="w-full" defaultValue={steps.map(s => s.id)}>
            {steps.map((step, index) => (
              <AccordionItem value={step.id} key={step.id} className="border rounded-md px-4 mb-2 bg-background">
                <div className="flex items-center">
                  <GripVertical className="h-5 w-5 text-muted-foreground" />
                  <AccordionTrigger className="flex-1 text-base hover:no-underline">{index + 1}. {step.name}</AccordionTrigger>
                  <Button variant="ghost" size="icon" onClick={() => handleDeleteStep(step.id)} disabled={!canEditPage}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
                <AccordionContent>
                  <div className="space-y-6 p-4 border-t">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label>Step Name</Label>
                        <Input value={step.name} onChange={(e) => handleStepChange(step.id, 'name', e.target.value)} disabled={!canEditPage} />
                      </div>
                      <div className="space-y-2">
                        <Label>TAT (in hours)</Label>
                        <Input type="number" value={step.tat} onChange={(e) => handleStepChange(step.id, 'tat', parseInt(e.target.value) || 0)} disabled={!canEditPage} />
                      </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Assignee</Label>
                        <Select
                            value={Array.isArray(step.assignedTo) && step.assignedTo.length > 0 ? step.assignedTo[0] : ''}
                            onValueChange={(value) => handleStepChange(step.id, 'assignedTo', [value])}
                            disabled={!canEditPage}
                        >
                            <SelectTrigger><SelectValue placeholder="Select a user" /></SelectTrigger>
                            <SelectContent>
                                {users.map(user => (<SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>))}
                            </SelectContent>
                        </Select>
                    </div>
                     <div className="space-y-4">
                      <Label>Actions</Label>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {allActions.map(action => (
                          <div key={action} className="flex items-center space-x-2">
                            <Checkbox id={`${step.id}-${action}`} checked={(step.actions as string[]).includes(action)} onCheckedChange={(checked) => handleActionChange(step.id, action, !!checked)} disabled={!canEditPage} />
                            <Label htmlFor={`${step.id}-${action}`} className="font-normal">{action}</Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <Button variant="outline" onClick={handleAddStep} disabled={!canEditPage}><Plus className="mr-2 h-4 w-4" /> Add Step</Button>
        </CardContent>
      </Card>
    </div>
  );
}
