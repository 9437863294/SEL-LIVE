
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  Trash2,
  Plus,
  GripVertical,
  ShieldAlert,
  Loader2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
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
  ActionConfig,
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
    actions: ['Approve', 'Reject', 'Needs Correction'],
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
];

/* ---------------- page ---------------- */
export default function BillingWorkflowConfigurationPage() {
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
    () => !isAuthLoading && safeCan3(can, 'View', 'Subcontractors Management.Billing'),
    [isAuthLoading, can],
  );
  const canEditPage = useMemo(
    () => !isAuthLoading && safeCan3(can, 'Edit Settings', 'Subcontractors Management.Billing'),
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

      setUsers(usersSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as User)));
      setProjects(projectsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Project)));
      setDepartments(deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Department)));
      setRoles(rolesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Role)));

      const workflowRef = doc(db, 'workflows', 'billing-workflow');
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

        const hasAction = newActions.some(
          (a) => (typeof a === 'string' ? a : a.name) === actionName,
        );
        if (checked && !hasAction) newActions.push(action);
        if (!checked && hasAction) {
          newActions = newActions.filter(
            (a) => (typeof a === 'string' ? a : a.name) !== actionName,
          );
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
      const workflowRef = doc(db, 'workflows', 'billing-workflow');
      await setDoc(workflowRef, payload, { merge: true });

      await logUserActivity({
        userId: user.id,
        action: 'Update Billing Workflow',
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
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-96 mb-6" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href={`/subcontractors-management/${projectSlug}/billing/settings`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Billing Workflow Configuration</h1>
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
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/subcontractors-management/${projectSlug}/billing/settings`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Billing Workflow Configuration</h1>
        </div>
        <div className="flex items-center gap-3">
          {pageInvalidMsg && (
            <Badge variant="destructive" className="whitespace-nowrap">
              {pageInvalidMsg}
            </Badge>
          )}
          <Button onClick={handleSave} disabled={isSaving || !canEditPage || !!pageInvalidMsg}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Workflow
          </Button>
        </div>
      </div>
       <Card>
        <CardHeader>
          <CardTitle>Workflow Steps</CardTitle>
          <CardDescription>
            Define the approval process, assignees, and turnaround time for each step.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">This workflow page is a placeholder. Logic will be implemented in a future update.</p>
        </CardContent>
      </Card>
    </div>
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
