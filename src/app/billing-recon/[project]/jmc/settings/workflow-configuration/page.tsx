
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
import type { WorkflowStep, Role, User, Project, Department, AmountBasedCondition, AssignedTo, ActionConfig } from '@/lib/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { cn } from '@/lib/utils';


const initialSteps: WorkflowStep[] = [
    { 
        id: '1', 
        name: 'Verification', 
        tat: 24, // 1 day
        assignmentType: 'User-based',
        assignedTo: [],
        actions: ['Approve', 'Reject', 'Needs Correction'],
        upload: 'Required',
    },
    { 
        id: '2', 
        name: 'Certification', 
        tat: 16,
        assignmentType: 'User-based',
        assignedTo: [],
        actions: ['Approve', 'Reject'],
        upload: 'Optional',
    },
];

const allActions = ['Approve', 'Reject', 'Needs Correction', 'Verify', 'Update Approved Amount', 'Create Expense Request'];

export default function JmcWorkflowConfigurationPage() {
    const { toast } = useToast();
    const { user } = useAuth();
    const { can, isLoading: isAuthLoading } = useAuthorization();
    
    const [steps, setSteps] = useState<WorkflowStep[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [roles, setRoles] = useState<Role[]>([]);
    
    const canViewPage = can('View Settings', 'Billing Recon.JMC');
    const canEditPage = can('Edit Settings', 'Billing Recon.JMC');

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
            const [rolesSnap, usersSnap, projectsSnap, deptsSnap] = await Promise.all([
                getDocs(collection(db, 'roles')),
                getDocs(collection(db, 'users')),
                getDocs(collection(db, 'projects')),
                getDocs(collection(db, 'departments'))
            ]);
            setRoles(rolesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Role)));
            setUsers(usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as User)));
            setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
            setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
            
            const workflowRef = doc(db, 'workflows', 'jmc-workflow');
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
                const updatedStep = { ...step, [field]: value };
                if (field === 'assignmentType') {
                    if (value === 'Amount-based') {
                        updatedStep.assignedTo = [{id: crypto.randomUUID(), type: 'Below', amount1: 0, userId: '' }];
                    } else if (value === 'User-based') {
                        updatedStep.assignedTo = [];
                    } else {
                        updatedStep.assignedTo = {};
                    }
                }
                return updatedStep;
            }
            return step;
        }));
    };
    
    const handleAssignmentDetailChange = (stepId: string, detailKey: string, userType: 'primary' | 'alternative', userId: string) => {
        setSteps(steps.map(step => {
            if (step.id === stepId) {
                const currentAssignments = (step.assignedTo as Record<string, { primary: string, alternative?: string }>) || {};
                const newAssignedTo = {
                    ...currentAssignments,
                    [detailKey]: {
                        ...currentAssignments[detailKey],
                        [userType]: userId === 'none' ? '' : userId,
                    }
                };
                return { ...step, assignedTo: newAssignedTo };
            }
            return step;
        }));
    };

    const handleActionChange = (stepId: string, actionName: string, checked: boolean) => {
        setSteps(steps.map(step => {
            if (step.id === stepId) {
                let newActions: (string | ActionConfig)[] = [];
                const existingAction = step.actions.find(a => (typeof a === 'string' ? a : a.name) === actionName);

                if (checked) {
                    if (!existingAction) {
                        if (actionName === 'Create Expense Request') {
                            newActions = [...step.actions, { name: actionName, departmentId: '' }];
                        } else {
                            newActions = [...step.actions, actionName];
                        }
                    } else {
                        newActions = step.actions; // Already exists
                    }
                } else {
                    newActions = step.actions.filter(a => (typeof a === 'string' ? a : a.name) !== actionName);
                }
                return { ...step, actions: newActions };
            }
            return step;
        }));
    };
    
    const handleActionConfigChange = (stepId: string, actionName: string, configKey: 'departmentId', value: string) => {
        setSteps(steps.map(step => {
            if (step.id === stepId) {
                const newActions = step.actions.map(action => {
                    if (typeof action !== 'string' && action.name === actionName) {
                        return { ...action, [configKey]: value };
                    }
                    return action;
                });
                return { ...step, actions: newActions };
            }
            return step;
        }));
    };

    const handleAmountConditionChange = (stepId: string, conditionId: string, field: keyof AmountBasedCondition, value: any) => {
        setSteps(steps.map(step => {
            if (step.id === stepId) {
                const updatedAssignedTo = (step.assignedTo as AmountBasedCondition[]).map(cond => {
                    if (cond.id === conditionId) {
                        return { ...cond, [field]: value };
                    }
                    return cond;
                });
                return { ...step, assignedTo: updatedAssignedTo };
            }
            return step;
        }));
    };

    const handleAddAmountCondition = (stepId: string) => {
        setSteps(steps.map(step => {
            if (step.id === stepId) {
                const newCondition: AmountBasedCondition = {
                    id: crypto.randomUUID(),
                    type: 'Between',
                    amount1: 0,
                    amount2: 10000,
                    userId: ''
                };
                return { ...step, assignedTo: [...(step.assignedTo as AmountBasedCondition[]), newCondition] };
            }
            return step;
        }));
    };

    const handleDeleteAmountCondition = (stepId: string, conditionId: string) => {
        setSteps(steps.map(step => {
            if (step.id === stepId) {
                const newAssignedTo = (step.assignedTo as AmountBasedCondition[]).filter(cond => cond.id !== conditionId);
                return { ...step, assignedTo: newAssignedTo };
            }
            return step;
        }));
    };

    const handleSave = async () => {
        if (!user) return;
        setIsSaving(true);
        try {
            const workflowRef = doc(db, 'workflows', 'jmc-workflow');
            await setDoc(workflowRef, { steps: steps });
            await logUserActivity({
                userId: user.id,
                action: 'Update JMC Workflow',
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
                        <Link href={`/billing-recon/${'project'}/jmc/settings`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                        <h1 className="text-xl font-bold">JMC Workflow Configuration</h1>
                    </div>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>You do not have permission to view or edit this page.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="w-full max-w-4xl mx-auto pr-14">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href={`/billing-recon/${'project'}/jmc/settings`}>
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <h1 className="text-xl font-bold">JMC Workflow Configuration</h1>
                </div>
                <Button onClick={handleSave} disabled={isSaving || !canEditPage}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                    Save Workflow
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
                                        <Button variant="ghost" size="icon" onClick={() => handleDeleteStep(step.id)} disabled={!canEditPage}>
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
                                                        disabled={!canEditPage}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor={`tat-${step.id}`}>TAT (in hours)</Label>
                                                    <Input 
                                                        id={`tat-${step.id}`}
                                                        type="number"
                                                        value={step.tat} 
                                                        onChange={(e) => handleStepChange(step.id, 'tat', parseInt(e.target.value) || 0)}
                                                        disabled={!canEditPage}
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-4">
                                                <Label>Assignment Type</Label>
                                                <RadioGroup
                                                    value={step.assignmentType}
                                                    onValueChange={(value) => handleStepChange(step.id, 'assignmentType', value)}
                                                    className="flex flex-wrap gap-4"
                                                    disabled={!canEditPage}
                                                >
                                                    {['User-based', 'Project-based', 'Department-based', 'Amount-based'].map(type => (
                                                        <div key={type} className="flex items-center space-x-2">
                                                            <RadioGroupItem value={type} id={`${step.id}-${type}`} />
                                                            <Label htmlFor={`${step.id}-${type}`} className="font-normal">{type}</Label>
                                                        </div>
                                                    ))}
                                                </RadioGroup>
                                            </div>

                                            {step.assignmentType === 'User-based' && (
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="space-y-2">
                                                        <Label>Primary User</Label>
                                                        <Select
                                                            value={(Array.isArray(step.assignedTo) ? step.assignedTo[0] : '') || ''}
                                                            onValueChange={(value) => {
                                                                const newAssignedTo = [...(Array.isArray(step.assignedTo) ? step.assignedTo : ['', ''])];
                                                                newAssignedTo[0] = value;
                                                                handleStepChange(step.id, 'assignedTo', newAssignedTo);
                                                            }}
                                                            disabled={!canEditPage}
                                                        >
                                                            <SelectTrigger><SelectValue placeholder="Select a user" /></SelectTrigger>
                                                            <SelectContent>
                                                                {users.map(user => (<SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                     <div className="space-y-2">
                                                        <Label>Alternative User</Label>
                                                        <Select
                                                            value={(Array.isArray(step.assignedTo) ? (step.assignedTo as string[])[1] : '') || 'none'}
                                                            onValueChange={(value) => {
                                                                const newAssignedTo = [...(Array.isArray(step.assignedTo) ? step.assignedTo : ['', ''])];
                                                                newAssignedTo[1] = value === 'none' ? '' : value;
                                                                handleStepChange(step.id, 'assignedTo', newAssignedTo);
                                                            }}
                                                             disabled={!canEditPage}
                                                        >
                                                            <SelectTrigger><SelectValue placeholder="Select a user (optional)" /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="none">None</SelectItem>
                                                                {users.map(user => (<SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                            )}

                                            {(step.assignmentType === 'Project-based' || step.assignmentType === 'Department-based') && (
                                                <div className="space-y-2">
                                                    <Label>Assign Users</Label>
                                                    <Card className="mt-2">
                                                        <Table>
                                                            <TableHeader>
                                                                <TableRow>
                                                                    <TableHead>{step.assignmentType === 'Project-based' ? 'Project' : 'Department'}</TableHead>
                                                                    <TableHead>Primary User</TableHead>
                                                                    <TableHead>Alternative User</TableHead>
                                                                </TableRow>
                                                            </TableHeader>
                                                            <TableBody>
                                                                {(step.assignmentType === 'Project-based' ? projects : departments).map(item => (
                                                                    <TableRow key={item.id}>
                                                                        <TableCell>{'projectName' in item ? item.projectName : item.name}</TableCell>
                                                                        <TableCell>
                                                                             <Select
                                                                                value={(step.assignedTo as Record<string, { primary: string }>)[item.id]?.primary || ''}
                                                                                onValueChange={(value) => handleAssignmentDetailChange(step.id, item.id, 'primary', value)}
                                                                                disabled={!canEditPage}
                                                                            >
                                                                                <SelectTrigger><SelectValue placeholder="Select primary user" /></SelectTrigger>
                                                                                <SelectContent>
                                                                                    {users.map(user => (<SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>))}
                                                                                </SelectContent>
                                                                            </Select>
                                                                        </TableCell>
                                                                         <TableCell>
                                                                             <Select
                                                                                value={(step.assignedTo as Record<string, { alternative?: string }>)[item.id]?.alternative || 'none'}
                                                                                onValueChange={(value) => handleAssignmentDetailChange(step.id, item.id, 'alternative', value)}
                                                                                disabled={!canEditPage}
                                                                            >
                                                                                <SelectTrigger><SelectValue placeholder="Select alternative user" /></SelectTrigger>
                                                                                <SelectContent>
                                                                                    <SelectItem value="none">None</SelectItem>
                                                                                    {users.map(user => (<SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>))}
                                                                                </SelectContent>
                                                                            </Select>
                                                                        </TableCell>
                                                                    </TableRow>
                                                                ))}
                                                            </TableBody>
                                                        </Table>
                                                    </Card>
                                                </div>
                                            )}

                                            {step.assignmentType === 'Amount-based' && Array.isArray(step.assignedTo) && (
                                                <div className="space-y-2">
                                                    <Label>Assign Users per Amount Condition</Label>
                                                    <Card className="p-4 mt-2 space-y-4">
                                                        {(step.assignedTo as AmountBasedCondition[]).map(condition => (
                                                            <div key={condition.id} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                                                                <Select
                                                                    value={condition.type}
                                                                    onValueChange={(value) => handleAmountConditionChange(step.id, condition.id, 'type', value)}
                                                                    disabled={!canEditPage}
                                                                >
                                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="Below">Below</SelectItem>
                                                                        <SelectItem value="Between">Between</SelectItem>
                                                                        <SelectItem value="Above">Above</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                                <div className={cn("flex gap-2 items-center", condition.type === 'Between' ? 'col-span-1' : 'col-span-1')}>
                                                                    <Input type="number" value={condition.amount1} onChange={(e) => handleAmountConditionChange(step.id, condition.id, 'amount1', e.target.valueAsNumber || 0)} disabled={!canEditPage} />
                                                                    {condition.type === 'Between' && <><span>&</span><Input type="number" value={condition.amount2} onChange={(e) => handleAmountConditionChange(step.id, condition.id, 'amount2', e.target.valueAsNumber || 0)} disabled={!canEditPage} /></>}
                                                                </div>
                                                                <div className="col-span-2 flex gap-2">
                                                                    <Select value={condition.userId} onValueChange={(value) => handleAmountConditionChange(step.id, condition.id, 'userId', value)} disabled={!canEditPage}><SelectTrigger><SelectValue placeholder="Primary" /></SelectTrigger><SelectContent>{users.map(user => (<SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>))}</SelectContent></Select>
                                                                    <Select value={condition.alternativeUserId || 'none'} onValueChange={(value) => handleAmountConditionChange(step.id, condition.id, 'alternativeUserId', value === 'none' ? '' : value)} disabled={!canEditPage}><SelectTrigger><SelectValue placeholder="Alternative" /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{users.map(user => (<SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>))}</SelectContent></Select>
                                                                    <Button variant="ghost" size="icon" onClick={() => handleDeleteAmountCondition(step.id, condition.id)} disabled={!canEditPage}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        <Button variant="outline" size="sm" onClick={() => handleAddAmountCondition(step.id)} disabled={!canEditPage}>
                                                            <Plus className="mr-2 h-4 w-4" /> Add Condition
                                                        </Button>
                                                    </Card>
                                                </div>
                                            )}

                                            <div className="space-y-4">
                                                <Label>Actions</Label>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                    {allActions.map(actionName => {
                                                      const actionConfig = step.actions.find(a => (typeof a === 'string' ? a : a.name) === actionName);
                                                      const isChecked = !!actionConfig;

                                                      return (
                                                          <div key={actionName} className="space-y-2">
                                                              <div className="flex items-center space-x-2">
                                                                  <Checkbox
                                                                      id={`${step.id}-action-${actionName}`}
                                                                      checked={isChecked}
                                                                      onCheckedChange={(checked) => handleActionChange(step.id, actionName, !!checked)}
                                                                      disabled={!canEditPage}
                                                                  />
                                                                  <Label htmlFor={`${step.id}-action-${actionName}`} className="font-normal">{actionName}</Label>
                                                              </div>
                                                              {actionName === 'Create Expense Request' && isChecked && (
                                                                  <Select
                                                                      value={(actionConfig as ActionConfig)?.departmentId || ''}
                                                                      onValueChange={(value) => handleActionConfigChange(step.id, actionName, 'departmentId', value)}
                                                                      disabled={!canEditPage}
                                                                  >
                                                                      <SelectTrigger className="h-8 text-xs">
                                                                          <SelectValue placeholder="Select Dept..." />
                                                                      </SelectTrigger>
                                                                      <SelectContent>
                                                                          {departments.map(dept => (
                                                                              <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                                                                          ))}
                                                                      </SelectContent>
                                                                  </Select>
                                                              )}
                                                          </div>
                                                      );
                                                    })}
                                                </div>
                                            </div>
                                            
                                            <div className="space-y-2">
                                                <Label>Upload</Label>
                                                 <RadioGroup
                                                    value={step.upload}
                                                    onValueChange={(value) => handleStepChange(step.id, 'upload', value)}
                                                    className="flex gap-4"
                                                    disabled={!canEditPage}
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

                    <Button variant="outline" onClick={handleAddStep} disabled={!canEditPage}>
                        <Plus className="mr-2 h-4 w-4" /> Add Step
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
