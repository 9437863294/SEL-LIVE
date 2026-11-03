'use client';

import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import {
  Save,
  Trash2,
  Plus,
  Loader2,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Eye,
  GitMerge,
  Info,
  ListOrdered,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { personOptionLabel } from '@/lib/people-directory';
import { withDesignations } from '@/lib/people-directory-client';
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
  ActionConfig,
} from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { BrAccessDenied, BrNotice, BrPage, BrPageSkeleton, BrSection, BR_TONE, TILE } from '@/components/billing-recon/page-kit';
// The MVAC workflow is Billing Recon's alone and the same for every project, separated or not.
import { BILLING_RECON_FIXED, WORKFLOWS_COLLECTION } from '@/lib/billing-recon/register';

/* ---------------- type guards ---------------- */
function isUserBased(step: WorkflowStep): step is WorkflowStepUser {
  return step.assignmentType === 'User-based';
}
function isMapped(step: WorkflowStep): step is WorkflowStepMapped {
  return step.assignmentType === 'Project-based' || step.assignmentType === 'Department-based';
}

/* ---------------- initial data ---------------- */
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

const allActions: (string | ActionConfig)[] = [
  'Approve',
  'Reject',
  'Needs Correction',
  'Complete',
  'Verified',
  'Update Certified Qty',
];

const UPLOAD_LABEL: Record<string, string> = {
  Required: 'Upload required',
  Optional: 'Upload optional',
  'Not Required': 'No upload',
};

/** A small heading inside a step card. */
function StepPart({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/* ---------------- page ---------------- */
export default function MvacWorkflowConfigurationPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const params = useParams();
  const projectSlug = params.project as string;

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  /* -------- permissions via safe 3-arg can() wrapper -------- */
  const canViewPage = useMemo(
    () => !isAuthLoading && safeCan3(can, 'View Settings', 'Billing Recon', 'MVAC'),
    [isAuthLoading, can],
  );
  const canEditPage = useMemo(
    () => !isAuthLoading && safeCan3(can, 'Edit Settings', 'Billing Recon', 'MVAC'),
    [isAuthLoading, can],
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

      setUsers(await withDesignations(usersSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as User))));
      setProjects(projectsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Project)));
      setDepartments(deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Department)));
      setRoles(rolesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Role)));

      const workflowRef = doc(db, WORKFLOWS_COLLECTION, BILLING_RECON_FIXED.mvacWorkflowId);
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

  /* ---------------- actions: add / delete / move ---------------- */
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
      if (prev.length <= 1) return prev; // keep at least one step
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
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return normalizeIds(copy);
    });
  }

  /* ---------------- step edits ---------------- */
  function handleStepChange<T extends keyof WorkflowStep>(id: string, field: T, value: WorkflowStep[T]) {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;

        // changing assignment type re-shapes assignedTo with correct structure
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
          }
          const next: WorkflowStepMapped = {
            ...s,
            assignmentType: at as 'Project-based' | 'Department-based',
            assignedTo: {} as Record<string, AssignedTo>,
          } as WorkflowStepMapped;
          (next as any).name = s.name;
          (next as any).tat = s.tat;
          (next as any).actions = s.actions;
          (next as any).upload = s.upload as UploadRequirement;
          return next;
        }

        // actions kept unique by name
        if (field === 'actions') {
          const list = (value as (string | ActionConfig)[]) ?? [];
          const dedupByName = dedupeActionsByName(list);
          return { ...s, actions: dedupByName };
        }

        // TAT normalized to positive int
        if (field === 'tat') {
          const tatNum = Number(value);
          return { ...s, tat: Number.isFinite(tatNum) && tatNum > 0 ? Math.floor(tatNum) : 1 };
        }

        return { ...s, [field]: value } as WorkflowStep;
      }),
    );
  }

  // For mapped steps: set per-project/department primary/alternative
  const handleAssignmentDetailChange = (
    stepId: string,
    detailKey: string,
    userType: 'primary' | 'alternative',
    userId: string,
  ) => {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== stepId || !isMapped(s)) return s;

        const currentMap: Record<string, AssignedTo> = (s.assignedTo as Record<string, AssignedTo>) || {};
        const current = currentMap[detailKey] ?? { primary: '', alternative: '' };
        const next: AssignedTo = { ...current, [userType]: userId === 'none' ? '' : userId };

        return {
          ...s,
          assignedTo: { ...currentMap, [detailKey]: next },
        };
      }),
    );
  };

  function handleActionToggle(stepId: string, action: string | ActionConfig, checked: boolean) {
    const actionName = typeof action === 'string' ? action : action.name;
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== stepId) return s;
        let newActions = [...s.actions];

        const hasAction = newActions.some((a) => (typeof a === 'string' ? a : a.name) === actionName);
        if (checked && !hasAction) newActions.push(action);
        if (!checked && hasAction) {
          newActions = newActions.filter((a) => (typeof a === 'string' ? a : a.name) !== actionName);
        }
        return { ...s, actions: dedupeActionsByName(newActions) };
      }),
    );
  }

  /* ---------------- validation & save ---------------- */
  function normalizeAndValidateSteps():
    | { ok: true; steps: WorkflowStep[] }
    | { ok: false; msg: string } {
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
        const map = (s.assignedTo ?? {}) as Record<string, AssignedTo>;
        const hasAnyMapping = Object.values(map).some(
          (m) => !!m && (!!m.primary || !!m.alternative),
        );
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
      const workflowRef = doc(db, WORKFLOWS_COLLECTION, BILLING_RECON_FIXED.mvacWorkflowId);
      await setDoc(workflowRef, payload, { merge: true });

      await logUserActivity({
        userId: (user as any).id ?? (user as any).uid ?? 'unknown',
        userName: (user as any).name ?? (user as any).displayName,
        userEmail: (user as any).email,
        module: 'Billing Recon',
        action: 'Update MVAC Workflow',
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  /* ---------------- render ---------------- */
  if (isAuthLoading || (isLoading && canViewPage)) return <BrPageSkeleton kpis={0} blocks={2} />;
  if (!canViewPage) return <BrAccessDenied message="You don't have permission to view the MVAC workflow settings." />;

  const tile = TILE[BR_TONE.mvac];
  const saveButton = (
    <Button onClick={handleSave} disabled={isSaving || !canEditPage || !!pageInvalidMsg}>
      {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
      Save Workflow
    </Button>
  );

  return (
    <BrPage tone={BR_TONE.mvac}>
      <PageHeader
        title="MVAC Workflow Configuration"
        description="The approval steps every MVAC goes through — who acts at each one, what they can do, the turnaround and what they must upload."
        icon={GitMerge}
        backHref={`/billing-recon/${projectSlug}/mvac/settings`}
        backLabel="Back to MVAC settings"
        actions={saveButton}
      />

      <BrNotice tone="info" icon={Info} title="One MVAC workflow for every project">
        The MVAC workflow is Billing Recon&apos;s own and the same for every project, separated or not —
        changes here apply to every project&apos;s MVACs. Project Management doesn&apos;t use it.
      </BrNotice>

      {!canEditPage && (
        <BrNotice tone="info" icon={Eye} title="View only">
          You can see this workflow but not change it.
        </BrNotice>
      )}

      {canEditPage && pageInvalidMsg && steps.length > 0 && (
        <BrNotice tone="danger" icon={AlertTriangle} title="Fix this before saving">
          {pageInvalidMsg}
        </BrNotice>
      )}

      <BrSection
        title="Workflow steps"
        description={`${steps.length} step${steps.length === 1 ? '' : 's'}, in order. An entry moves on when its step approves it; ids follow the order.`}
        icon={ListOrdered}
        tone={BR_TONE.mvac}
        actions={
          <Button variant="outline" onClick={handleAddStep} disabled={!canEditPage}>
            <Plus className="mr-2 h-4 w-4" /> Add Step
          </Button>
        }
      >
        {steps.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No workflow steps configured yet. Add the first step to start.
            </CardContent>
          </Card>
        ) : (
          <ol className="space-y-4">
            {steps.map((step, index) => {
              const actionCount = Array.isArray(step.actions) ? step.actions.length : 0;
              const editableType = isUserBased(step) || isMapped(step);
              return (
                <li key={step.id}>
                  <Card className="overflow-hidden">
                    <div className="flex flex-wrap items-center gap-3 border-b bg-muted/50 px-4 py-3 sm:px-5">
                      <span
                        aria-hidden
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm"
                        style={{ backgroundImage: `linear-gradient(135deg, ${tile.from}, ${tile.to})` }}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1 basis-[12rem]">
                        <p className="truncate text-[15px] font-semibold leading-tight text-foreground">
                          <span className="sr-only">Step {index + 1}: </span>
                          {step.name || 'Untitled step'}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <Badge variant="neutral">{Number(step.tat) || 1} h turnaround</Badge>
                          <Badge variant="neutral">{step.assignmentType}</Badge>
                          <Badge variant={actionCount ? 'neutral' : 'warning'}>
                            {actionCount} action{actionCount === 1 ? '' : 's'}
                          </Badge>
                          <Badge variant={step.upload === 'Required' ? 'info' : 'neutral'}>
                            {UPLOAD_LABEL[step.upload] ?? `Upload ${String(step.upload ?? '').toLowerCase()}`}
                          </Badge>
                        </div>
                      </div>

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

                    <CardContent className="space-y-6 p-4 sm:p-5">
                      {/* Step name + TAT */}
                      <StepPart title="Name & turnaround">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                              onFocus={(e) => e.target.select()}
                              onChange={(e) =>
                                handleStepChange(
                                  step.id,
                                  'tat',
                                  Math.max(1, parseInt(e.target.value || '1', 10)) as unknown as WorkflowStep['tat'],
                                )
                              }
                              disabled={!canEditPage}
                            />
                          </div>
                        </div>
                      </StepPart>

                      {/* Assignment type */}
                      <StepPart title="Who acts" hint="One person (with a stand-in), or a person per project or department.">
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

                        {!editableType && (
                          <p className="text-xs text-muted-foreground">
                            This step is assigned {String(step.assignmentType || 'another way').toLowerCase()}, which this page
                            doesn&apos;t edit. Pick a type above to change it.
                          </p>
                        )}

                        {/* User-based assignment */}
                        {isUserBased(step) && (
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="min-w-0 space-y-2">
                              <Label>Primary User</Label>
                              <Select
                                value={step.assignedTo[0] ?? ''}
                                onValueChange={(value) => {
                                  const next: WorkflowStepUser['assignedTo'] = [value, step.assignedTo[1] ?? ''];
                                  handleStepChange(step.id, 'assignedTo', next);
                                }}
                                disabled={!canEditPage}
                              >
                                <SelectTrigger className="text-left">
                                  <SelectValue placeholder="Select a user" />
                                </SelectTrigger>
                                <SelectContent>
                                  {users.map((u) => (
                                    <SelectItem key={u.id} value={u.id}>
                                      {personOptionLabel(u)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="min-w-0 space-y-2">
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
                                <SelectTrigger className="text-left">
                                  <SelectValue placeholder="Select a user (optional)" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">None</SelectItem>
                                  {users.map((u) => (
                                    <SelectItem key={u.id} value={u.id}>
                                      {personOptionLabel(u)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}

                        {/* Project/Department-based assignment */}
                        {isMapped(step) && (
                          <TableCard
                            scroll="natural"
                            title={step.assignmentType === 'Project-based' ? 'Assign per project' : 'Assign per department'}
                          >
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
                                  const map = (step.assignedTo ?? {}) as Record<string, AssignedTo>;
                                  const row = map[item.id] ?? { primary: '', alternative: '' };
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
                                          <SelectTrigger className="text-left">
                                            <SelectValue placeholder="Select primary user" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {users.map((u) => (
                                              <SelectItem key={u.id} value={u.id}>
                                                {personOptionLabel(u)}
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
                                          <SelectTrigger className="text-left">
                                            <SelectValue placeholder="Select alternative user" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="none">None</SelectItem>
                                            {users.map((u) => (
                                              <SelectItem key={u.id} value={u.id}>
                                                {personOptionLabel(u)}
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
                          </TableCard>
                        )}
                      </StepPart>

                      {/* Actions */}
                      <StepPart title="Actions" hint="What the assignee can do at this step.">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {[...allActions].map((action) => {
                            const actionName = typeof action === 'string' ? action : action.name;
                            const isChecked = step.actions.some(
                              (a) => (typeof a === 'string' ? a : a.name) === actionName,
                            );
                            const id = `${step.id}-action-${actionName}`;
                            return (
                              <div key={id} className="flex items-center space-x-2 rounded-lg border border-border px-3 py-2">
                                <Checkbox
                                  id={id}
                                  checked={isChecked}
                                  onCheckedChange={(checked) =>
                                    handleActionToggle(step.id, action, Boolean(checked))
                                  }
                                  disabled={!canEditPage}
                                />
                                <Label htmlFor={id} className="font-normal">
                                  {actionName}
                                </Label>
                              </div>
                            );
                          })}
                        </div>
                      </StepPart>

                      {/* Upload requirement */}
                      <StepPart title="Upload">
                        <RadioGroup
                          value={step.upload}
                          onValueChange={(v) => handleStepChange(step.id, 'upload', v as UploadRequirement)}
                          className="flex flex-wrap gap-4"
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
                      </StepPart>

                      {/* Step instructions */}
                      <StepPart title="Step Instructions" hint="Shown to the assignee when this step is active.">
                        <Textarea
                          id={`desc-${step.id}`}
                          aria-label={`Instructions for ${step.name}`}
                          value={step.description || ''}
                          onChange={(e) => handleStepChange(step.id, 'description', e.target.value)}
                          placeholder="e.g. Verify quantities against drawing, sign and stamp each page..."
                          disabled={!canEditPage}
                          className="resize-none"
                          rows={2}
                        />
                      </StepPart>

                      {/* Notifications & Escalation */}
                      <StepPart title="Notifications & escalation">
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                          <div className="min-w-0 space-y-2">
                            <Label>Notify on Step Entry</Label>
                            <p className="text-xs text-muted-foreground">Users notified when this step becomes active.</p>
                            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2.5">
                              {users.length === 0 ? (
                                <p className="py-2 text-center text-xs text-muted-foreground">No users available</p>
                              ) : (
                                users.map((u) => {
                                  const notifyIds = step.notifyUserIds ?? [];
                                  const checked = notifyIds.includes(u.id);
                                  return (
                                    <div key={u.id} className="flex items-center space-x-2">
                                      <Checkbox
                                        id={`notify-${step.id}-${u.id}`}
                                        checked={checked}
                                        onCheckedChange={(c) => {
                                          const current = step.notifyUserIds ?? [];
                                          const next = c ? [...current, u.id] : current.filter((id) => id !== u.id);
                                          handleStepChange(step.id, 'notifyUserIds', next);
                                        }}
                                        disabled={!canEditPage}
                                      />
                                      <Label htmlFor={`notify-${step.id}-${u.id}`} className="cursor-pointer text-sm font-normal">
                                        {personOptionLabel(u)}
                                      </Label>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                          <div className="min-w-0 space-y-2">
                            <Label>TAT Escalation</Label>
                            <p className="text-xs text-muted-foreground">Auto-escalate when TAT is running out.</p>
                            <Select
                              value={step.escalationUserId || 'none'}
                              onValueChange={(v) => handleStepChange(step.id, 'escalationUserId', v === 'none' ? '' : v)}
                              disabled={!canEditPage}
                            >
                              <SelectTrigger className="text-left">
                                <SelectValue placeholder="Select escalation user" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No escalation</SelectItem>
                                {users.map((u) => (
                                  <SelectItem key={u.id} value={u.id}>{personOptionLabel(u)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {step.escalationUserId && (
                              <div className="space-y-1 pt-1">
                                <Label className="text-xs text-muted-foreground">Escalate after % of TAT elapsed</Label>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Input
                                    type="number" min={10} max={100} step={10}
                                    value={step.escalationThreshold ?? 80}
                                    onChange={(e) => handleStepChange(step.id, 'escalationThreshold', Number(e.target.value))}
                                    disabled={!canEditPage}
                                    className="w-20"
                                  />
                                  <span className="text-sm text-muted-foreground">%</span>
                                  <span className="text-xs text-muted-foreground">
                                    = after {Math.round(((step.escalationThreshold ?? 80) * step.tat) / 100)}h of {step.tat}h
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </StepPart>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </BrSection>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={handleAddStep} disabled={!canEditPage}>
          <Plus className="mr-2 h-4 w-4" /> Add Step
        </Button>
        {saveButton}
      </div>
    </BrPage>
  );
}

/* ---------------- utils ---------------- */

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

function dedupeActionsByName(list: (string | ActionConfig)[]) {
  const seen = new Set<string>();
  const out: (string | ActionConfig)[] = [];
  for (const a of list) {
    const name = typeof a === 'string' ? a : a.name;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(a);
    }
  }
  return out;
}
