
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Trash2, Plus, GripVertical, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import type { WorkflowStep, Role } from '@/lib/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const initialSteps: WorkflowStep[] = [
    { id: '1', name: 'Request Receiving', roles: [], tat: 1 },
    { id: '2', name: 'Verification', roles: [], tat: 2 },
    { id: '3', name: 'Approval of Payment', roles: [], tat: 1 },
];

export default function WorkflowConfigurationPage() {
    const { toast } = useToast();
    const [steps, setSteps] = useState<WorkflowStep[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const fetchWorkflowAndRoles = async () => {
            setIsLoading(true);
            try {
                // Fetch roles
                const rolesSnapshot = await getDocs(collection(db, 'roles'));
                const rolesData = rolesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Role));
                setRoles(rolesData);
                
                // Fetch workflow
                const docRef = doc(db, 'workflows', 'site-fund-requisition');
                const docSnap = await getDoc(docRef);

                if (docSnap.exists() && docSnap.data().steps.length > 0) {
                    setSteps(docSnap.data().steps);
                } else {
                    setSteps(initialSteps);
                }
            } catch (error) {
                console.error("Error fetching data: ", error);
                toast({ title: 'Error', description: 'Failed to fetch workflow configuration.', variant: 'destructive' });
            }
            setIsLoading(false);
        };
        fetchWorkflowAndRoles();
    }, [toast]);
    
    const handleAddStep = () => {
        const newStep: WorkflowStep = {
            id: (steps.length + 1).toString(),
            name: `New Step ${steps.length + 1}`,
            roles: [],
            tat: 1,
        };
        setSteps([...steps, newStep]);
    };
    
    const handleDeleteStep = (id: string) => {
        setSteps(steps.filter(step => step.id !== id).map((step, index) => ({...step, id: (index + 1).toString()})));
    };
    
    const handleStepChange = (id: string, field: keyof WorkflowStep, value: any) => {
        setSteps(steps.map(step => step.id === id ? { ...step, [field]: value } : step));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const workflowRef = doc(db, 'workflows', 'site-fund-requisition');
            await setDoc(workflowRef, { steps: steps });
            toast({ title: 'Success', description: 'Workflow configuration saved.' });
        } catch (error) {
            console.error("Error saving workflow: ", error);
            toast({ title: 'Error', description: 'Failed to save configuration.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="w-full max-w-4xl mx-auto">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/site-fund-requisition/settings">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <h1 className="text-2xl font-bold">Configure Workflow</h1>
                </div>
                <Button onClick={handleSave} disabled={isSaving}>
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? 'Saving...' : 'Save'}
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
                           <Skeleton className="h-12 w-full" />
                           <Skeleton className="h-12 w-full" />
                           <Skeleton className="h-12 w-full" />
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
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 border-t">
                                            <div className="space-y-2">
                                                <Label htmlFor={`step-name-${step.id}`}>Step Name</Label>
                                                <Input 
                                                    id={`step-name-${step.id}`}
                                                    value={step.name} 
                                                    onChange={(e) => handleStepChange(step.id, 'name', e.target.value)}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor={`tat-${step.id}`}>TAT (in days)</Label>
                                                <Input 
                                                    id={`tat-${step.id}`}
                                                    type="number"
                                                    value={step.tat} 
                                                    onChange={(e) => handleStepChange(step.id, 'tat', parseInt(e.target.value) || 0)}
                                                />
                                            </div>
                                            <div className="md:col-span-2 space-y-2">
                                                <Label>Assign To Roles</Label>
                                                 <Select
                                                    value={step.roles.join(',')}
                                                    onValueChange={(value) => handleStepChange(step.id, 'roles', value.split(','))}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select roles" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {roles.map(role => (
                                                            <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <p className="text-xs text-muted-foreground">Multiple roles coming soon.</p>

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
