
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
import type { WorkflowStep, Role, User } from '@/lib/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';

const initialSteps: WorkflowStep[] = [
    { 
        id: '1', 
        name: 'Document Verification', 
        tat: 24, // 1 day
        assignmentType: 'User-based',
        assignedTo: [],
        actions: ['Approve', 'Reject', 'Needs Correction'],
        upload: 'Required',
    },
    { 
        id: '2', 
        name: 'Payment Approval', 
        tat: 16,
        assignmentType: 'User-based',
        assignedTo: [],
        actions: ['Approve', 'Reject'],
        upload: 'Optional',
    },
    { 
        id: '3', 
        name: 'Policy Issued', 
        tat: 48,
        assignmentType: 'User-based',
        assignedTo: [],
        actions: ['Complete'],
        upload: 'Required',
    },
];

const allActions = ['Approve', 'Reject', 'Needs Correction', 'Complete', 'Verify'];

export default function InsuranceWorkflowConfigurationPage() {
    const { toast } = useToast();
    const { user } = useAuth();
    const { can, isLoading: isAuthLoading } = useAuthorization();
    
    const [steps, setSteps] = useState<WorkflowStep[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    
    const canViewPage = can('View', 'Insurance.Settings');

    useEffect(() => {
        if (!isAuthLoading) {
            if(canViewPage) {
                fetchData();
            } else {
                setIsLoading(false);
            }
        }
    }, [isAuthLoading, canViewPage]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const usersSnap = await getDocs(collection(db, 'users'));
            setUsers(usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as User)));
            
            const workflowRef = doc(db, 'workflows', 'insurance-workflow');
            const workflowSnap = await getDoc(workflowRef);

            if (workflowSnap.exists() && workflowSnap.data().steps.length > 0) {
                setSteps(workflowSnap.data().steps);
            } else {
                setSteps(initialSteps);
            }
        } catch (error) {
            console.error("Error fetching data: ", error);
            toast({ title: 'Error', description: 'Failed to fetch configuration data.', variant: 'destructive' });
        }
        setIsLoading(false);
    };
    
    const handleAddStep = () => {
        const newStep: WorkflowStep = {
            id: (steps.length + 1).toString(),
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
        setSteps(steps.filter(step => step.id !== id).map((step, index) => ({...step, id: (index + 1).toString()})));
    };
    
    const handleStepChange = (id: string, field: keyof WorkflowStep, value: any) => {
        setSteps(steps.map(step => {
            if (step.id === id) {
                return { ...step, [field]: value };
            }
            return step;
        }));
    };
    
    const handleActionChange = (stepId: string, action: string, checked: boolean) => {
        setSteps(steps.map(step => {
            if (step.id === stepId) {
                const newActions = checked 
                    ? [...step.actions, action]
                    : step.actions.filter(a => a !== action);
                return { ...step, actions: newActions };
            }
            return step;
        }));
    };

    const handleSave = async () => {
        if (!user) return;
        setIsSaving(true);
        try {
            const workflowRef = doc(db, 'workflows', 'insurance-workflow');
            await setDoc(workflowRef, { steps: steps });
            await logUserActivity({
                userId: user.id,
                action: 'Update Insurance Workflow',
                details: { stepCount: steps.length }
            });
            toast({ title: 'Success', description: 'Workflow configuration saved.' });
        } catch (error) {
            console.error("Error saving workflow: ", error);
            toast({ title: 'Error', description: 'Failed to save configuration.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };
    
    if(isAuthLoading || (isLoading && canViewPage)) {
        return (
            <div className="w-full max-w-4xl mx-auto pr-14">
                <Skeleton className="h-10 w-96 mb-6" />
                <Skeleton className="h-96 w-full" />
            </div>
        )
    }

    if(!canViewPage) {
        return (
             <div className="w-full max-w-4xl mx-auto pr-14">
                <div className="mb-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/insurance/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                        <h1 className="text-xl font-bold">Configure Workflow</h1>
                    </div>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>You do not have permission to view or edit this page.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center p-8">
                        <ShieldAlert className="h-16 w-16 text-destructive" />
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="w-full max-w-4xl mx-auto pr-14">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/insurance/settings">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <h1 className="text-xl font-bold">Configure Workflow</h1>
                </div>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                    Save
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Workflow Steps</CardTitle>
                    <CardDescription>Define the approval process, assignees, and turnaround time for each step.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                     {isLoading ? (
                        <div className="space-y-2">
                           <Skeleton className="h-24 w-full" />
                           <Skeleton className="h-24 w-full" />
                           <Skeleton className="h-24 w-full" />
                        </div>
                     ) : (
                        <Accordion type="multiple" className="w-full" defaultValue={steps.map(s => s.id)}>
                            {steps.map((step, index) => (
                                <AccordionItem value={step.id} key={step.id} className="border rounded-md px-4 mb-2 bg-background">
                                    <div className="flex items-center">
                                        <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab" />
                                        <AccordionTrigger className="flex-1 text-base hover:no-underline">
                                            {index + 1}. {step.name}
                                        </AccordionTrigger>
                                        <Button variant="ghost" size="icon" onClick={() => handleDeleteStep(step.id)}>
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </div>
                                    <AccordionContent>
                                        <div className="space-y-6 p-4 border-t">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <Label htmlFor={`step-name-${step.id}`}>Step Name</Label>
                                                    <Input 
                                                        id={`step-name-${step.id}`}
                                                        value={step.name} 
                                                        onChange={(e) => handleStepChange(step.id, 'name', e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor={`tat-${step.id}`}>TAT (in hours)</Label>
                                                    <Input 
                                                        id={`tat-${step.id}`}
                                                        type="number"
                                                        value={step.tat} 
                                                        onChange={(e) => handleStepChange(step.id, 'tat', parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <Label>Assigned User</Label>
                                                <Select
                                                    value={Array.isArray(step.assignedTo) ? (step.assignedTo as string[])[0] || '' : ''}
                                                    onValueChange={(value) => handleStepChange(step.id, 'assignedTo', [value])}
                                                >
                                                    <SelectTrigger id={`assigned-user-${step.id}`}>
                                                        <SelectValue placeholder="Select a user" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {users.map(user => (
                                                            <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            
                                            <div className="space-y-4">
                                                <Label>Actions</Label>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                    {allActions.map(action => (
                                                        <div key={action} className="flex items-center space-x-2">
                                                            <Checkbox
                                                                id={`${step.id}-action-${action}`}
                                                                checked={step.actions.includes(action)}
                                                                onCheckedChange={(checked) => handleActionChange(step.id, action, !!checked)}
                                                            />
                                                            <Label htmlFor={`${step.id}-action-${action}`} className="font-normal">{action}</Label>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            
                                            <div className="space-y-2">
                                                <Label>Upload</Label>
                                                 <RadioGroup
                                                    value={step.upload}
                                                    onValueChange={(value) => handleStepChange(step.id, 'upload', value)}
                                                    className="flex gap-4"
                                                >
                                                    {['Required', 'Not Required', 'Optional'].map(type => (
                                                        <div key={type} className="flex items-center space-x-2">
                                                            <RadioGroupItem value={type} id={`${step.id}-upload-${type}`} />
                                                            <Label htmlFor={`${step.id}-upload-${type}`} className="font-normal">{type}</Label>
                                                        </div>
                                                    ))}
                                                </RadioGroup>
                                            </div>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                     )}

                    <Button variant="outline" onClick={handleAddStep}>
                        <Plus className="mr-2 h-4 w-4" /> Add Step
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
