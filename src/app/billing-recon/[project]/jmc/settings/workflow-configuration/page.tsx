'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Trash2, Plus, GripVertical, ShieldAlert, Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import type {
  WorkflowStep,
  WorkflowStepUser,
  WorkflowStepMapped,
  Role,
  User,
  Project,
  Department,
  AssignedTo,
  UploadRequirement,
} from '@/lib/types';
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
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';

// Type guards
function isUserBased(step: WorkflowStep): step is WorkflowStepUser {
  return step.assignmentType === 'User-based';
}
function isMapped(step: WorkflowStep): step is WorkflowStepMapped {
  return step.assignmentType === 'Project-based' || step.assignmentType === 'Department-based';
}

// Initial steps
const initialSteps: WorkflowStep[] = [
  {
    id: '1',
    name: 'Verification',
    tat: 24,
    assignmentType: 'User-based',
    assignedTo: [],
    actions: ['Approve', 'Reject', 'Needs Correction', 'Update Certified Qty'],
    upload: 'Required',
  },
  {
    id: '2',
    name: 'Certification',
    tat: 16,
    assignmentType: 'User-based',
    assignedTo: [],
    actions: ['Verified', 'Reject'],
    upload: 'Optional',
  },
];

/** Suggested actions */
const allActions = ['Approve', 'Reject', 'Needs Correction', 'Complete', 'Verified', 'Update Certified Qty'] as const;

export default function JmcWorkflowConfigurationPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { project: projectSlug } = useParams() as { project: string };

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // ✅ Use the 3-argument can(action, module, scope?)
  const canViewPage = useMemo(
    () => !isAuthLoading && safeCan3(can, 'View Settings', 'Billing Recon', 'JMC'),
    [isAuthLoading, can]
  );
  const canEditPage = useMemo(
    () => !isAuthLoading && safeCan3(can, 'Edit Settings', 'Billing Recon', 'JMC'),
    [isAuthLoading, can]
  );

  useEffect(() => {
    if (isAuthLoading) return;
    if (canViewPage) void fetchData();
    else setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading, canViewPage]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [usersSnap, projectsSnap, deptsSnap, rolesSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'departments')),
        getDocs(collection(db, 'roles')),
      ]);

      setUsers(usersSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as User)));
      setProjects(projectsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Project)));
      setDepartments(deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Department)));
      setRoles(rolesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Role)));

      const workflowRef = doc(db, 'workflows', 'jmc-workflow');
      const workflowSnap = await getDoc(workflowRef);

      if (workflowSnap.exists()) {
        const s = (workflowSnap.data().steps || []) as WorkflowStep[];
        setSteps(Array.isArray(s) && s.length > 0 ? normalizeIds(s) : initialSteps);
      } else {
        setSteps(initialSteps);
      }
    } catch (error) {
      console.error('Error fetching data: ', error);
      toast({ title: 'Error', description: 'Failed to fetch configuration data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  function handleAddStep() {
    const newIndex = steps.length + 1;
    const newStep: WorkflowStep = {
      id: String(newIndex),
      name: `New Step ${newIndex}`,
      tat: 8,
      assignmentType: 'User-based',
      assignedTo: [],
      actions: [],
      upload: 'Optional',
    };
    setSteps((prev) => [...prev, newStep]);
  }

  function handleDeleteStep(id: string) {
    setSteps((prev) => {
      if (prev.length <= 1) return prev; // guard: keep at least one step
      const next = prev.filter((s) => s.id !== id);
      return normalizeIds(next);
    });
  }

  function moveStep(id: string, dir: 'up' | 'down') {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const target = dir === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const tmp = copy[idx];
      copy[idx] = copy[target];
      copy[target] = tmp;
      return normalizeIds(copy);
    });
  }

  function handleStepChange<T extends keyof WorkflowStep>(id: string, field: T, value: WorkflowStep[T]) {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;

        if (field === 'assignmentType') {
          const at = value as WorkflowStep['assignmentType'];
          if (at === 'User-based') {
            const next: WorkflowStepUser = {
              ...s,
              assignmentType: 'User-based',
              assignedTo: [],
            } as WorkflowStepUser;
            (next as any).name = s.name;
            (next as any).tat = s.tat;
            (next as any).actions = s.actions;
            (next as any).upload = s.upload as UploadRequirement;
            return next;
          } else {
            const next: WorkflowStepMapped = {
              ...s,
              assignmentType: at as 'Project-based' | 'Department-based',
              assignedTo: {},
            } as WorkflowStepMapped;
            (next as any).name = s.name;
            (next as any).tat = s.tat;
            (next as any).actions = s.actions;
            (next as any).upload = s.upload as UploadRequirement;
            return next;
          }
        }

        // Keep actions unique
        if (field === 'actions') {
          const uniq = Array.from(new Set((value as string[]) ?? [])).sort();
          return { ...s, actions: uniq };
        }

        if (field === 'tat') {
          const tatNum = Number(value);
          return { ...s, tat: Number.isFinite(tatNum) && tatNum > 0 ? tatNum : 1 };
        }

        return { ...s, [field]: value } as WorkflowStep;
      })
    );
  }

  const handleAssignmentDetailChange = (
    stepId: string,
    detailKey: string,
    userType: 'primary' | 'alternative',
    userId: string
  ) => {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== stepId || !isMapped(s)) return s;

        const current = s.assignedTo[detailKey] ?? { primary: '', alternative: '' };
        const next: AssignedTo = { ...current, [userType]: userId === 'none' ? '' : userId };

        return {
          ...s,
          assignedTo: { ...s.assignedTo, [detailKey]: next },
        };
      })
    );
  };

  function handleActionToggle(stepId: string, action: string, checked: boolean) {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== stepId) return s;
        const set = new Set(s.actions);
        if (checked) set.add(action);
        else set.delete(action);
        return { ...s, actions: Array.from(set).sort() };
      })
    );
  }

  function normalizeAndValidateSteps(): { ok: true; steps: WorkflowStep[] } | { ok: false; msg: string } {
    const normalized = normalizeIds(steps);

    for (const s of normalized) {
      if (!s.name || !s.name.trim()) {
        return { ok: false, msg: `Step ${s.id}: name is required.` };
      }
      const tatNum = Number(s.tat);
      if (!Number.isFinite(tatNum) || tatNum <= 0) {
        return { ok: false, msg: `Step ${s.id} (“${s.name}”): TAT must be a positive number.` };
      }
      if (isUserBased(s)) {
        const primary = s.assignedTo?.[0];
        if (!primary) {
          return { ok: false, msg: `Step ${s.id} (“${s.name}”): select a primary user.` };
        }
      }
      if (isMapped(s)) {
        const hasAnyMapping = Object.values(s.assignedTo || {}).some((m) => m && (m.primary || m.alternative));
        if (!hasAnyMapping) {
          return {
            ok: false,
            msg: `Step ${s.id} (“${s.name}”): add at least one ${
              s.assignmentType === 'Project-based' ? 'project' : 'department'
            } mapping.`,
          };
        }
      }
    }

    return { ok: true, steps: normalized };
  }

  async function handleSave() {
    if (!user) {
      toast({ title: 'Not signed in', description: 'Please sign in to save changes.', variant: 'destructive' });
      return;
    }
    if (!canEditPage) {
      toast({ title: 'No permission', description: 'You are not allowed to edit this workflow.', variant: 'destructive' });
      return;
    }

    const validation = normalizeAndValidateSteps();
    if (!validation.ok) {
      toast({ title: 'Fix required', description: validation.msg, variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const payload = { steps: validation.steps };
      const workflowRef = doc(db, 'workflows', 'jmc-workflow');
      await setDoc(workflowRef, payload, { merge: true });

      await logUserActivity({
        userId: (user as any).id ?? (user as any).uid ?? 'unknown',
        action: 'Update JMC Workflow',
        details: { stepCount: validation.steps.length },
      });

      toast({ title: 'Success', description: 'Workflow configuration saved.' });
    } catch (error) {
      console.error('Error saving workflow: ', error);
      toast({ title: 'Error', description: 'Failed to save configuration.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }

  const pageInvalidMsg = useMemo(() => {
    const v = normalizeAndValidateSteps();
    return v.ok ? '' : v.msg;
  }, [steps]);

  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
      <div className="w-full max-w-4xl mx-auto pr-14">
        <Skeleton className="h-10 w-96 mb-6" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full max-w-4xl mx-auto pr-14">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href={`/billing-recon/${projectSlug}/jmc/settings`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">JMC Workflow Configuration</h1>
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
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto pr-14">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/billing-recon/${projectSlug}/jmc/settings`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">JMC Workflow Configuration</h1>
        </div>
        <div className="flex items-center gap-3">
          {pageInvalidMsg && <Badge variant="destructive" className="whitespace-nowrap">{pageInvalidMsg}</Badge>}
          <Button onClick={handleSave} disabled={isSaving || !canEditPage || !!pageInvalidMsg}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Workflow
          </Button>
        </div>
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
            <Accordion type="multiple" className="w-full" defaultValue={steps.map((s) => s.id)}>
              {steps.map((step, index) => (
                <AccordionItem value={step.id} key={step.id} className="border rounded-md px-4 mb-2 bg-background">
                  <div className="flex items-center gap-2 py-2">
                    <GripVertical className="h-5 w-5 text-muted-foreground" />
                    <AccordionTrigger className="flex-1 text-base hover:no-underline">
                      {index + 1}. {step.name}
                    </AccordionTrigger>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => moveStep(step.id, 'up')}
                        disabled={!canEditPage || index === 0}
                        aria-label="Move up"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => moveStep(step.id, 'down')}
                        disabled={!canEditPage || index === steps.length - 1}
                        aria-label="Move down"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteStep(step.id)}
                        disabled={!canEditPage || steps.length <= 1}
                        aria-label={`Delete step ${step.name}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  <AccordionContent>
                    <div className="space-y-6 p-4 border-t">
                      {/* Step name + TAT */}
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
                          <Label htmlFor={`tat-${step.id}`}>TAT (hours)</Label>
                          <Input
                            id={`tat-${step.id}`}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            value={Number(step.tat) || 1}
                            onChange={(e) =>
                              handleStepChange(step.id, 'tat', Math.max(1, parseInt(e.target.value || '1', 10)))
                            }
                            disabled={!canEditPage}
                          />
                        </div>
                      </div>

                      {/* Assignment type */}
                      <div className="space-y-4">
                        <Label>Assignment Type</Label>
                        <RadioGroup
                          value={step.assignmentType}
                          onValueChange={(v) =>
                            handleStepChange(step.id, 'assignmentType', v as WorkflowStep['assignmentType'])
                          }
                          className="flex flex-wrap gap-4"
                        >
                          {(['User-based', 'Project-based', 'Department-based'] as const).map((type) => (
                            <div key={type} className="flex items-center space-x-2">
                              <RadioGroupItem value={type} id={`${step.id}-${type}`} disabled={!canEditPage} />
                              <Label htmlFor={`${step.id}-${type}`} className="font-normal">
                                {type}
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>

                      {/* User-based assignment */}
                      {isUserBased(step) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Primary User</Label>
                            <Select
                              value={step.assignedTo[0] ?? ''}
                              onValueChange={(value) => {
                                const next: WorkflowStepUser['assignedTo'] = [value, step.assignedTo[1] ?? ''];
                                handleStepChange(step.id, 'assignedTo', next);
                              }}
                              disabled={!canEditPage}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select a user" />
                              </SelectTrigger>
                              <SelectContent>
                                {users.map((u) => (
                                  <SelectItem key={u.id} value={u.id}>
                                    {u.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Alternative User</Label>
                            <Select
                              value={step.assignedTo[1] || 'none'}
                              onValueChange={(value) => {
                                const alt = value === 'none' ? '' : value;
                                const next: WorkflowStepUser['assignedTo'] = [step.assignedTo[0] ?? '', alt];
                                handleStepChange(step.id, 'assignedTo', next);
                              }}
                              disabled={!canEditPage}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select a user (optional)" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {users.map((u) => (
                                  <SelectItem key={u.id} value={u.id}>
                                    {u.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}

                      {/* Project/Department-based assignment */}
                      {isMapped(step) && (
                        <div className="space-y-2">
                          <Label>Assign Users</Label>
                          <Card className="mt-2">
                            <div className="overflow-x-auto">
                              <Table className="min-w-[720px]">
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="whitespace-nowrap">
                                      {step.assignmentType === 'Project-based' ? 'Project' : 'Department'}
                                    </TableHead>
                                    <TableHead className="whitespace-nowrap">Primary User</TableHead>
                                    <TableHead className="whitespace-nowrap">Alternative User</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {(step.assignmentType === 'Project-based' ? projects : departments).map((item) => {
                                    const row = (step.assignedTo as any)[item.id] ?? { primary: '', alternative: '' };
                                    return (
                                      <TableRow key={item.id}>
                                        <TableCell className="whitespace-nowrap">
                                          {'projectName' in item ? item.projectName : item.name}
                                        </TableCell>
                                        <TableCell>
                                          <Select
                                            value={row.primary || ''}
                                            onValueChange={(value) =>
                                              handleAssignmentDetailChange(step.id, item.id, 'primary', value)
                                            }
                                            disabled={!canEditPage}
                                          >
                                            <SelectTrigger>
                                              <SelectValue placeholder="Select primary user" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {users.map((u) => (
                                                <SelectItem key={u.id} value={u.id}>
                                                  {u.name}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </TableCell>
                                        <TableCell>
                                          <Select
                                            value={row.alternative || 'none'}
                                            onValueChange={(value) =>
                                              handleAssignmentDetailChange(step.id, item.id, 'alternative', value)
                                            }
                                            disabled={!canEditPage}
                                          >
                                            <SelectTrigger>
                                              <SelectValue placeholder="Select alternative user" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="none">None</SelectItem>
                                              {users.map((u) => (
                                                <SelectItem key={u.id} value={u.id}>
                                                  {u.name}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          </Card>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="space-y-4">
                        <Label>Actions</Label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {[...allActions].map((actionName) => {
                            const isChecked = step.actions.includes(actionName);
                            const id = `${step.id}-action-${actionName}`;
                            return (
                              <div key={id} className="space-y-2">
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id={id}
                                    checked={isChecked}
                                    onCheckedChange={(checked) =>
                                      handleActionToggle(step.id, actionName, Boolean(checked))
                                    }
                                    disabled={!canEditPage}
                                  />
                                  <Label htmlFor={id} className="font-normal">
                                    {actionName}
                                  </Label>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Upload requirement */}
                      <div className="space-y-2">
                        <Label>Upload</Label>
                        <RadioGroup
                          value={step.upload}
                          onValueChange={(v) => handleStepChange(step.id, 'upload', v as UploadRequirement)}
                          className="flex gap-4"
                        >
                          {(['Required', 'Not Required', 'Optional'] as const).map((opt) => (
                            <div key={opt} className="flex items-center space-x-2">
                              <RadioGroupItem value={opt} id={`${step.id}-upload-${opt}`} disabled={!canEditPage} />
                              <Label htmlFor={`${step.id}-upload-${opt}`} className="font-normal">
                                {opt}
                              </Label>
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

/* ---------- utils ---------- */

// 3-arg safe wrapper for your can(action, module, scope?) fn
type CanFn3 = (action: string, module: string, scope?: string) => boolean;
function safeCan3(canFn: CanFn3, action: string, module: string, scope?: string): boolean {
  try {
    return canFn(action, module, scope);
  } catch {
    return false;
  }
}

function normalizeIds(arr: WorkflowStep[]): WorkflowStep[] {
  return arr.map((s, i) => ({ ...s, id: String(i + 1) }));
}
