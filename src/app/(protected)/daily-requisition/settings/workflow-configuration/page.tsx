'use client';

/**
 * Daily Requisition › Settings › Workflow: the approval workflow, one step at a time.
 *
 * Three columns: the steps in order on the left (pick one to edit, add more), the chosen step's
 * editor in the middle — turnaround time, who acts (any number of people, by person or per project
 * or department), its buttons, hand-over and taking early, attachment and instructions,
 * notifications and escalation — and on the right a preview of what the assignee sees, the step's
 * summary and its checks. Nothing is written until Save; the bar at the bottom says when there is
 * something to save.
 *
 * Verification steps, hand-over and taking early are src/lib/daily-requisition-flow.ts.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Banknote,
  BellRing,
  Building2,
  ClipboardCheck,
  Clock3,
  Copy,
  FastForward,
  FileText,
  FolderKanban,
  Loader2,
  MousePointerClick,
  Plus,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  Workflow,
} from 'lucide-react';
import { collection, doc, getCountFromServer, getDoc, getDocs, setDoc } from 'firebase/firestore';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/shared/page-header';
import {
  ActionPicker,
  AssigneePreview,
  CheckList,
  EditorSection,
  FieldLabel,
  FORWARD_ACTIONS,
  HAND_OVER_ACTION,
  Hint,
  PeoplePicker,
  Segmented,
  SideBox,
  SummaryRows,
  personParts,
} from '@/components/daily-requisition/workflow-editor-parts';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { diffFields, type FieldChange } from '@/lib/activity-logger';
import { dailyStepNameProblem, dailyStepSlug } from '@/lib/daily-requisition-settings';
import {
  allowsHandOver,
  APPROVAL_BUTTONS,
  approvalActionsOf,
  assignedPeople,
  canTakeInto,
  PAYMENT_PAGE_NAME,
  peopleToAssignment,
  placeSteps,
  renumberSteps,
  ROLE_PERMISSION_PAGE,
  stageWorkProblems,
  STEP_ACTIONS,
  stepAfterVerify,
  stepWorkLabel,
  upgradeWorkflowSteps,
  verificationPlacementProblem,
  waitingStatusesAt,
  withDerivedKind,
  withStepKeys,
  workflowAccessLists,
} from '@/lib/daily-requisition-flow';
import { db } from '@/lib/firebase';
import { withDesignations } from '@/lib/people-directory-client';
import type {
  ActionConfig,
  AssignedTo,
  Department,
  Project,
  Role,
  UploadRequirement,
  User,
  WorkflowStep,
  WorkflowStepMapped,
  WorkflowStepUser,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const WORKFLOW_DOC = 'daily-requisition-workflow';

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
    name: 'Receiving at Finance',
    tat: 8,
    assignmentType: 'User-based',
    assignedTo: [],
    actions: ['Mark as Received', 'Return to Pending', 'Cancel'],
    upload: 'Optional',
  },
  {
    id: '2',
    name: 'GST & TDS Verification',
    tat: 16,
    assignmentType: 'User-based',
    assignedTo: [],
    actions: ['Verify', 'Re-verify', 'Return to Pending', 'Send for Payment'],
    upload: 'Optional',
  },
  // Processed for Payment is the fixed page after the last step, not a step.
];

/** Turnaround presets, in working hours (a working day is 8). */
const TAT_PRESETS = [4, 8, 16, 24];
const tatLabel = (hours: number) => (hours < 8 ? `${hours} h` : hours === 8 ? '1 day' : `${hours / 8} days`);

const INSTRUCTIONS_MAX = 300;

type AssignBy = 'User-based' | 'Project-based' | 'Department-based';

/* ---------------- page ---------------- */
export default function DailyRequisitionWorkflowConfigurationPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  // The workflow as stored (empty when the document does not exist yet) — the audit log's "before".
  const [savedSteps, setSavedSteps] = useState<WorkflowStep[]>([]);
  // The same, as the editor holds it: what Discard returns to and what "unsaved" is measured against.
  const [baseline, setBaseline] = useState<WorkflowStep[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [usage, setUsage] = useState<number | null>(null);
  /** Steps the one list of actions read differently from how they were saved (upgradeWorkflowSteps), until saved. */
  const [upgradedNames, setUpgradedNames] = useState<string[]>([]);
  const [rowFilter, setRowFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  /* -------- permissions via safe 3-arg can() wrapper -------- */
  const canViewPage = useMemo(
    () => !isAuthLoading && safeCan3(can, 'View Workflow', 'Daily Requisition.Settings'),
    [isAuthLoading, can],
  );
  const canEditPage = useMemo(
    () => !isAuthLoading && safeCan3(can, 'Edit Workflow', 'Daily Requisition.Settings'),
    [isAuthLoading, can],
  );

  // Loads once, on opening: `isLoading` starts true, so nothing is set before the reads come back.
  useEffect(() => {
    if (isAuthLoading || !canViewPage) return;
    let active = true;
    (async () => {
      try {
        const [usersSnap, projectsSnap, deptsSnap, rolesSnap, workflowSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'departments')),
          getDocs(collection(db, 'roles')),
          getDoc(doc(db, 'workflows', WORKFLOW_DOC)),
        ]);
        const people = await withDesignations(usersSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as User)));
        if (!active) return;
        setUsers(people);
        setProjects(projectsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Project)));
        setDepartments(deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Department)));
        setRoles(rolesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Role)));

        const stored = workflowSnap.exists() ? ((workflowSnap.data().steps || []) as WorkflowStep[]) : [];
        const asSaved = normalizeIds(Array.isArray(stored) && stored.length > 0 ? stored : initialSteps);
        // Read as one list of actions decides it: what that changes shows as unsaved, to review and save.
        const editable = normalizeIds(upgradeWorkflowSteps(asSaved));
        setSteps(editable);
        setBaseline(asSaved);
        setUpgradedNames(editable.filter((s, i) => JSON.stringify(s) !== JSON.stringify(asSaved[i])).map((s) => s.name));
        setSavedSteps(Array.isArray(stored) ? stored : []);
        setSelectedKey((current) => (editable.some((s) => s.key === current) ? current : (editable[0]?.key ?? '')));
      } catch (error) {
        console.error('Error fetching data: ', error);
        if (active) toast({ title: 'Error', description: 'Failed to fetch configuration data.', variant: 'destructive' });
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    // How many requisitions the workflow is running, for the header. Not everyone here may read them.
    getCountFromServer(collection(db, 'dailyRequisitions'))
      .then((snap) => active && setUsage(snap.data().count))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isAuthLoading, canViewPage, toast]);

  /* ---------------- derived ---------------- */
  const placed = useMemo(() => placeSteps(steps), [steps]);
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const nameOf = useCallback((id: string) => personParts(userById.get(id), id).name, [userById]);
  const problems = useMemo(() => stepProblems(steps), [steps]);
  /** The first thing stopping the save, and the step it is on (the bar at the bottom offers to show it). */
  const firstInvalid = useMemo(() => {
    const step = normalizeIds(steps).find((s) => (problems.get(s.key ?? '')?.length ?? 0) > 0);
    const key = step?.key ?? '';
    return step ? { key, message: `Step ${step.id} ("${step.name || 'unnamed'}"): ${problems.get(key)?.[0] ?? ''}` } : null;
  }, [steps, problems]);
  const pageInvalidMsg = firstInvalid?.message ?? '';
  /** How many steps have something stopping the save. */
  const invalidCount = problems.size;
  // Compared as they would be saved, so an emptied list that was absent before is not a change.
  const isDirty = useMemo(() => JSON.stringify(normalizeIds(steps)) !== JSON.stringify(baseline), [steps, baseline]);
  const totalTat = steps.reduce((sum, s) => sum + (Number(s.tat) || 0), 0);

  const selIndex = Math.max(0, steps.findIndex((s) => s.key === selectedKey));
  const sel = steps[selIndex];

  /* ---------------- editing ---------------- */
  const updateStep = (id: string, fn: (s: WorkflowStep) => WorkflowStep) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
  const patchStep = (id: string, fields: Partial<WorkflowStep>) =>
    updateStep(id, (s) => ({ ...s, ...fields }) as WorkflowStep);

  /** Everything but the assignment carries over when the way of assigning changes. */
  const setAssignBy = (id: string, by: AssignBy) =>
    updateStep(id, (s) => {
      if (s.assignmentType === by) return s;
      const { assignmentType: _type, assignedTo: _assigned, ...base } = s;
      return (by === 'User-based' ? { ...base, assignmentType: by, assignedTo: [] } : { ...base, assignmentType: by, assignedTo: {} }) as WorkflowStep;
    });

  const setPeople = (id: string, ids: string[]) => updateStep(id, (s) => ({ ...s, assignedTo: ids }) as WorkflowStep);

  const setRowPeople = (id: string, rowId: string, ids: string[]) =>
    updateStep(id, (s) => {
      const map = { ...((s.assignedTo ?? {}) as Record<string, AssignedTo>) };
      if (ids.length) map[rowId] = peopleToAssignment(ids);
      else delete map[rowId];
      return { ...s, assignedTo: map } as WorkflowStep;
    });

  /**
   * One list of actions for every step; what is ticked decides the step (withDerivedKind): ticking
   * Receiving or GST & TDS work makes it a finance step, ticking none an approval step. Hand over is
   * the step's switch, not a stored button.
   */
  const toggleAction = (id: string, action: string) =>
    updateStep(id, (s) => {
      if (action === HAND_OVER_ACTION) return { ...s, allowHandOver: !allowsHandOver(s) };
      const has = s.actions.some((a) => (typeof a === 'string' ? a : a.name) === action);
      const next = has ? s.actions.filter((a) => (typeof a === 'string' ? a : a.name) !== action) : [...s.actions, action];
      return withDerivedKind({ ...s, actions: dedupeActionsByName(next) });
    });

  const uniqueName = (base: string, list: WorkflowStep[]) => {
    const taken = new Set(list.map((s) => dailyStepSlug(s.name)));
    let name = base;
    for (let n = 2; taken.has(dailyStepSlug(name)); n++) name = `${base} ${n}`;
    return name;
  };

  /**
   * A new step goes in after the chosen one, approving (Approve ticked) until finance actions are
   * ticked on it. Move it to approve before Finance receives, or between Finance's steps.
   */
  function handleAddStep() {
    const key = newStepKey();
    setSteps((prev) => {
      const newStep: WorkflowStep = {
        id: '0',
        key,
        kind: 'verification',
        name: uniqueName('Approval', prev),
        tat: 8,
        assignmentType: 'User-based',
        assignedTo: [],
        actions: ['Approve', 'Send Back', 'Reject'],
        upload: 'Not Required',
      };
      const at = Math.min(prev.findIndex((s) => s.key === selectedKey) + 1 || prev.length, prev.length);
      return normalizeIds([...prev.slice(0, at), newStep, ...prev.slice(at)]);
    });
    setSelectedKey(key);
  }

  function handleDuplicate(step: WorkflowStep) {
    const key = newStepKey();
    setSteps((prev) => {
      const at = prev.findIndex((s) => s.id === step.id) + 1;
      const copy = { ...step, key, name: uniqueName(`${step.name} copy`, prev) } as WorkflowStep;
      return normalizeIds([...prev.slice(0, at), copy, ...prev.slice(at)]);
    });
    setSelectedKey(key);
  }

  function handleDeleteStep(step: WorkflowStep) {
    if (steps.length <= 1) return;
    const at = steps.findIndex((s) => s.id === step.id);
    const next = normalizeIds(steps.filter((s) => s.id !== step.id));
    setSteps(next);
    setSelectedKey(next[Math.min(at, next.length - 1)]?.key ?? '');
  }

  function moveStep(id: string, dir: 'up' | 'down') {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const target = dir === 'up' ? idx - 1 : idx + 1;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return normalizeIds(copy);
    });
  }

  /* ---------------- save ---------------- */
  async function handleSave() {
    if (!user || pageInvalidMsg) return;
    setIsSaving(true);
    try {
      const toSave = normalizeIds(steps);
      // Who the steps name, beside them, for the Firestore rules: everyone named may read the
      // register their pages list, and a stage's people may do its work (workflowAccessLists).
      await setDoc(doc(db, 'workflows', WORKFLOW_DOC), { steps: toSave, ...workflowAccessLists(toSave) });
      const diff = diffWorkflowSteps(savedSteps, toSave, {
        users: new Map(users.map((u) => [u.id, u.name || u.id])),
        projects: new Map(projects.map((p) => [p.id, p.projectName || p.id])),
        departments: new Map(departments.map((d) => [d.id, d.name || d.id])),
        roles: new Map(roles.map((r) => [r.id, r.name || r.id])),
        steps: new Map([...savedSteps, ...toSave].filter((s) => s.key).map((s) => [s.key as string, s.name])),
      });
      void log(
        'Update Daily Requisition Workflow',
        {
          workflowDoc: `workflows/${WORKFLOW_DOC}`,
          stepCount: { from: savedSteps.length, to: toSave.length },
          ...diff,
        },
        { recordRef: 'Workflow' },
      );
      setSteps(toSave);
      setSavedSteps(toSave);
      setBaseline(toSave);
      setUpgradedNames([]);
      toast({ title: 'Workflow saved', description: 'Applies to requisitions from their next move.' });
    } catch (error) {
      console.error('Error saving workflow: ', error);
      toast({ title: 'Error', description: 'Failed to save configuration.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }

  // Back to what is saved, as one list of actions reads it.
  const handleDiscard = () => {
    const back = normalizeIds(upgradeWorkflowSteps(baseline));
    setSteps(back);
    if (!back.some((s) => s.key === selectedKey)) setSelectedKey(back[0]?.key ?? '');
  };

  /* ---------------- render ---------------- */
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
      <div className="w-full px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
        <Skeleton className="mb-6 h-10 w-96" />
        <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_320px]">
          <Skeleton className="h-80 rounded-[20px]" />
          <Skeleton className="h-[600px] rounded-[20px]" />
          <Skeleton className="hidden h-96 rounded-[20px] xl:block" />
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
        <PageHeader title="Approval workflow" eyebrow="Daily Requisition" backHref="/daily-requisition/settings" backLabel="Back to settings" />
        <Card className="overflow-hidden rounded-2xl border bg-card shadow-sm">
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

  /* ---- the chosen step ---- */
  const role = placed[selIndex]?.role;
  const selRoles = placed[selIndex]?.roles ?? [];
  /** The permissions a finance step is opened and worked by: those of the works it does, whatever it is named. */
  const stagePermissions = selRoles.map((r) => ROLE_PERMISSION_PAGE[r]).join(' and ') || null;
  const isVerification = sel?.kind === 'verification';
  const isFirst = selIndex === 0;
  const selActions = new Set((sel?.actions ?? []).map((a) => (typeof a === 'string' ? a : a.name)));
  const hasForward = FORWARD_ACTIONS.some((a) => selActions.has(a));
  const people = sel && isUserBased(sel) ? (sel.assignedTo ?? []).filter(Boolean) : [];
  const mappedRows = sel && isMapped(sel) ? (sel.assignmentType === 'Project-based' ? projects : departments) : [];
  const mappedCount = sel && isMapped(sel) ? Object.values((sel.assignedTo ?? {}) as Record<string, AssignedTo>).filter((m) => assignedPeople(m).length > 0).length : 0;
  const handOverOn = sel ? allowsHandOver(sel) : false;
  const takeSources = sel && canTakeInto(placed, selIndex) ? placed.slice(0, selIndex).filter((q) => waitingStatusesAt(placed, q.index).length > 0) : [];
  const takeChosen = new Set(sel?.takeFrom ?? []);
  const nextName = isVerification ? (stepAfterVerify(steps, selIndex) ?? 'the next step') : (steps[selIndex + 1]?.name ?? 'the end of the workflow');
  const approval = approvalActionsOf(sel);
  /** The first Verification step before Finance: nothing comes before it to send a requisition back to. */
  const sendBackNowhere =
    isVerification &&
    placed[selIndex]?.segment === 0 &&
    !placed.slice(0, selIndex).some((q) => q.role === 'verification' && q.segment === 0);
  /** Ticked actions that do nothing on this step, with why: shown marked in the picker. */
  const idleActions = new Map<string, string>();
  if (sel && isVerification) {
    // At an approval step one action of each kind shows; the others ticked beside it do the same.
    const chosen = [approval.forward, approval.sendBack, approval.reject];
    for (const group of Object.values(APPROVAL_BUTTONS) as ReadonlyArray<readonly string[]>) {
      const shown = chosen.find((name) => name && group.includes(name));
      for (const name of group) {
        if (shown && name !== shown && selActions.has(name)) idleActions.set(name, `does the same as ${shown} at an approval step; the page shows ${shown}.`);
      }
    }
    if (approval.sendBack && sendBackNowhere) {
      idleActions.set(approval.sendBack, 'this is the first step before Finance, so there is nothing to send it back to; it will not show.');
    }
    if (selActions.has('Re-verify')) {
      idleActions.set('Re-verify', 're-checks figures on the step that sends for payment. Here Verify (GST & TDS) records them.');
    }
  } else if (sel) {
    if (selActions.has('Approve')) {
      idleActions.set('Approve', 'passes requisitions on at an approval step. Here Mark as Received and Send for Payment move them on.');
    }
    if (!selRoles.includes('gst')) {
      for (const name of ['Verify', 'Re-verify']) {
        if (selActions.has(name)) {
          idleActions.set(name, 'checks GST & TDS on the step that sends for payment, or on an approval step. This step only receives.');
        }
      }
    } else if (selActions.has('Re-verify') && !selActions.has('Verify')) {
      idleActions.set('Re-verify', 're-checks what was verified here; without Verify ticked, this step sends received ones straight for payment.');
    }
  }
  const pickerSelected = new Set([...selActions, ...(handOverOn ? [HAND_OVER_ACTION] : [])]);
  const previewButtons: string[] = sel
    ? [
        ...(isVerification
          ? [
              ...(approval.gstVerify ? ['Verify (GST & TDS)'] : []),
              ...(approval.forward ? [approval.forward] : []),
              ...(approval.sendBack && !sendBackNowhere ? [approval.sendBack] : []),
              ...(approval.reject ? [approval.reject] : []),
            ]
          : STEP_ACTIONS.filter((a) => selActions.has(a) && !idleActions.has(a))),
        ...(handOverOn ? [HAND_OVER_ACTION] : []),
      ]
    : [];
  const selProblems = problems.get(sel?.key ?? '') ?? [];
  const disabled = !canEditPage;

  const whoSummary = (step: WorkflowStep) => {
    if (isUserBased(step)) {
      const ids = (step.assignedTo ?? []).filter(Boolean);
      if (ids.length === 0) return 'No one yet';
      return ids.length === 1 ? nameOf(ids[0]) : `${nameOf(ids[0])} +${ids.length - 1}`;
    }
    const count = Object.values((step.assignedTo ?? {}) as Record<string, AssignedTo>).filter((m) => assignedPeople(m).length > 0).length;
    return `${step.assignmentType === 'Project-based' ? 'By project' : 'By department'} · ${count} set`;
  };

  return (
    <div className="w-full px-3 pb-28 pt-4 sm:px-4 lg:px-6 xl:px-8">
      <PageHeader
        backHref="/daily-requisition/settings"
        backLabel="Back to settings"
        eyebrow="Daily Requisition · Settings · Workflow"
        title="Approval workflow"
        description="The steps a requisition goes through, who acts at each, and how long they have."
        badge={
          usage !== null ? (
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[11.5px] font-bold text-green-800">
              Live · used by {usage.toLocaleString('en-IN')} requisitions
            </span>
          ) : undefined
        }
        actions={
          <Button
            onClick={handleSave}
            disabled={isSaving || !canEditPage || !isDirty || !!pageInvalidMsg}
            className="bg-gradient-to-r from-violet-700 via-violet-600 to-pink-600 text-white shadow-[0_10px_22px_-12px_#7c3aed] hover:opacity-95"
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save workflow
          </Button>
        }
      />

      {upgradedNames.length > 0 && isDirty && (
        <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 p-3.5 text-[13px] text-sky-900">
          <p className="flex items-start gap-2 font-semibold">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Every step now has one list of actions. Check these steps and save to apply:</span>
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-10">
            {upgradedNames.map((name) => (
              <li key={name}>
                <b>{name}</b>
                {steps.find((s) => s.name === name)?.kind === 'verification'
                  ? ' — an approval step: its people approve each requisition in turn, with Approve.'
                  : ' — a finance step, by the actions ticked on it.'}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 pl-6">
            {PAYMENT_PAGE_NAME} is no longer a step: it is a fixed page, always after the last step.
          </p>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_320px]">
        {/* ── the steps ── */}
        <aside className="rounded-[20px] border bg-card p-3.5 lg:sticky lg:top-4">
          <h4 className="mb-2.5 flex justify-between text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
            <span>Steps</span>
            <span>{totalTat} h total</span>
          </h4>
          <div className="flex items-center gap-2.5 px-2.5 pb-1 text-muted-foreground">
            <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border border-dashed">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="text-[12px]">
              <b className="block text-[12.5px] text-foreground/80">Entry Sheet</b>
              Requisition recorded
            </span>
          </div>
          <div className="ml-[22px] h-2.5 w-0.5 bg-border" aria-hidden />
          <ol className="space-y-0">
            {steps.map((step, index) => {
              const on = step.key === sel?.key;
              const bad = (problems.get(step.key ?? '')?.length ?? 0) > 0;
              return (
                <li key={step.key}>
                  {index > 0 && <div className="ml-[22px] h-2 w-0.5 bg-border" aria-hidden />}
                  <button
                    type="button"
                    onClick={() => setSelectedKey(step.key ?? '')}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-[14px] border border-transparent px-2.5 py-2 text-left transition hover:bg-muted',
                      on && 'border-violet-200 bg-gradient-to-r from-violet-50 to-pink-50 hover:bg-violet-50',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-muted text-xs font-extrabold text-muted-foreground',
                        on && 'bg-gradient-to-br from-violet-600 to-pink-600 text-white',
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="flex items-center gap-1 text-[13px] leading-tight">
                        <span className="truncate">{step.name || 'Unnamed step'}</span>
                        {step.kind === 'verification' ? (
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-label="Approval step" />
                        ) : (
                          <Workflow className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Finance step" />
                        )}
                      </b>
                      <small className="block truncate text-[11.5px] text-muted-foreground">
                        {whoSummary(step)} · {Number(step.tat) || 0} h
                      </small>
                    </span>
                    {bad && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Needs attention" />}
                  </button>
                </li>
              );
            })}
          </ol>
          {/* Payment: the fixed page after the last step, not a step. */}
          <div className="ml-[22px] h-2.5 w-0.5 bg-border" aria-hidden />
          <div className="flex items-center gap-2.5 px-2.5 pt-1 text-muted-foreground">
            <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border border-dashed">
              <Banknote className="h-3.5 w-3.5" />
            </span>
            <span className="text-[12px]">
              <b className="block text-[12.5px] text-foreground/80">{PAYMENT_PAGE_NAME}</b>
              Fixed page, after the last step
            </span>
          </div>
          {canEditPage && (
            <div className="mt-2.5 space-y-1.5">
              <button
                type="button"
                onClick={handleAddStep}
                className="flex w-full items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-slate-300 p-2.5 text-[13px] font-bold text-muted-foreground transition hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700"
              >
                <Plus className="h-4 w-4" /> Add a step
              </button>
            </div>
          )}
        </aside>

        {/* ── the chosen step ── */}
        {sel && (
          <section className="overflow-hidden rounded-[20px] border bg-card">
            <div className="flex flex-wrap items-center gap-2.5 border-b bg-gradient-to-r from-violet-50 via-card to-card px-4 py-3.5 sm:px-5">
              <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px] bg-gradient-to-br from-violet-600 to-pink-600 font-extrabold text-white">
                {selIndex + 1}
              </span>
              <input
                aria-label="Step name"
                value={sel.name}
                onChange={(e) => patchStep(sel.id, { name: e.target.value })}
                disabled={disabled}
                className="min-w-[160px] flex-1 rounded-lg bg-transparent px-1 py-0.5 text-lg font-extrabold outline-none focus:bg-card focus:ring-2 focus:ring-violet-200"
              />
              <Badge variant="secondary" className="gap-1">
                {isVerification ? <ShieldCheck className="h-3.5 w-3.5" /> : <Workflow className="h-3.5 w-3.5" />}
                {isVerification ? 'Approval step' : `Finance · ${selRoles.map((r) => stepWorkLabel(sel, r)).join(' + ') || 'no work'}`}
              </Badge>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" title="Move up" onClick={() => moveStep(sel.id, 'up')} disabled={disabled || isFirst}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" title="Move down" onClick={() => moveStep(sel.id, 'down')} disabled={disabled || selIndex === steps.length - 1}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" title="Duplicate" onClick={() => handleDuplicate(sel)} disabled={disabled}>
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                  title="Delete step"
                  onClick={() => handleDeleteStep(sel)}
                  disabled={disabled || steps.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* What stops this step from being saved, where it is being edited. */}
            {selProblems.length > 0 && (
              <div className="mx-4 mt-3.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-900 sm:mx-5">
                <p className="flex items-center gap-1.5 font-bold">
                  <ShieldAlert className="h-4 w-4 shrink-0" /> Fix before saving
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-6">
                  {selProblems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Turnaround */}
            <EditorSection icon={Clock3} from="#fcd34d" to="#d97706" title="Turnaround time" description="How long this step may take before it counts as overdue">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center overflow-hidden rounded-[11px] border">
                  <button type="button" className="h-9 w-8 bg-muted/50 font-extrabold text-muted-foreground disabled:opacity-50" disabled={disabled} onClick={() => patchStep(sel.id, { tat: Math.max(1, (Number(sel.tat) || 1) - 1) })}>
                    −
                  </button>
                  <input
                    aria-label="Turnaround in working hours"
                    inputMode="numeric"
                    value={Number(sel.tat) || 1}
                    disabled={disabled}
                    onChange={(e) => patchStep(sel.id, { tat: Math.max(1, parseInt(e.target.value || '1', 10) || 1) })}
                    className="h-9 w-14 bg-transparent text-center font-extrabold outline-none"
                  />
                  <button type="button" className="h-9 w-8 bg-muted/50 font-extrabold text-muted-foreground disabled:opacity-50" disabled={disabled} onClick={() => patchStep(sel.id, { tat: (Number(sel.tat) || 0) + 1 })}>
                    +
                  </button>
                </div>
                <span className="font-bold text-muted-foreground">working hours</span>
                <div className="flex flex-wrap gap-1.5 sm:ml-2">
                  {TAT_PRESETS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      disabled={disabled}
                      onClick={() => patchStep(sel.id, { tat: h })}
                      className={cn(
                        'rounded-full border bg-card px-2.5 py-1 text-xs font-bold text-muted-foreground',
                        Number(sel.tat) === h && 'border-violet-400 bg-violet-50 text-violet-700',
                      )}
                    >
                      {tatLabel(h)}
                    </button>
                  ))}
                </div>
              </div>
              <Hint>
                ≈ {((Number(sel.tat) || 0) / 8).toFixed((Number(sel.tat) || 0) % 8 ? 1 : 0)} working day{(Number(sel.tat) || 0) > 8 ? 's' : ''}. Counted in working hours, so nights,
                Sundays and holidays don&apos;t count.
              </Hint>
            </EditorSection>

            {/* Who */}
            <EditorSection
              icon={UsersRound}
              from="#93c5fd"
              to="#1d4ed8"
              title={isVerification ? 'Who approves' : 'Who acts on this step'}
              description="Everyone you add can act on it — add as many people as you need"
            >
              <FieldLabel>Assign by</FieldLabel>
              <Segmented<AssignBy>
                value={sel.assignmentType as AssignBy}
                disabled={disabled}
                onChange={(by) => setAssignBy(sel.id, by)}
                options={[
                  { value: 'User-based', label: 'Specific people', icon: UserRound },
                  { value: 'Project-based', label: 'By project', icon: FolderKanban },
                  { value: 'Department-based', label: 'By department', icon: Building2 },
                ]}
              />
              <Hint>
                {sel.assignmentType === 'User-based'
                  ? 'The same people, whichever project or department raised the requisition.'
                  : sel.assignmentType === 'Project-based'
                    ? "The people set for the requisition's project. A project with nobody set skips a Verification step."
                    : "The people set for the department that raised the requisition. A department with nobody set skips a Verification step."}
              </Hint>

              {isUserBased(sel) && (
                <div className="mt-3">
                  <FieldLabel>People</FieldLabel>
                  <PeoplePicker users={users} value={people} onChange={(ids) => setPeople(sel.id, ids)} disabled={disabled} placeholder="Choose people…" firstLabel="Primary" />
                  {people.length === 0 ? (
                    <Hint tone="warn">Add at least one person.</Hint>
                  ) : people.length === 1 ? (
                    <Hint tone="warn">Only one person: requisitions wait here whenever they&apos;re away. Add someone else to cover.</Hint>
                  ) : (
                    <Hint>{people.length} people can act. The first is shown as primary.</Hint>
                  )}
                </div>
              )}

              {isMapped(sel) && (
                <div className="mt-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <FieldLabel>
                      People per {sel.assignmentType === 'Project-based' ? 'project' : 'department'} · {mappedCount} of {mappedRows.length} set
                    </FieldLabel>
                    <div className="relative w-full sm:w-56">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={rowFilter}
                        onChange={(e) => setRowFilter(e.target.value)}
                        placeholder={`Find a ${sel.assignmentType === 'Project-based' ? 'project' : 'department'}…`}
                        className="h-8 w-full rounded-lg border bg-card pl-8 pr-2 text-sm outline-none focus:border-violet-500"
                      />
                    </div>
                  </div>
                  <div className="max-h-[420px] divide-y overflow-y-auto rounded-xl border">
                    {mappedRows
                      .map((item) => ({ id: item.id, label: 'projectName' in item ? item.projectName : (item as Department).name }))
                      .filter((row) => !rowFilter.trim() || (row.label || '').toLowerCase().includes(rowFilter.trim().toLowerCase()))
                      .map((row) => {
                        const ids = assignedPeople(((sel.assignedTo ?? {}) as Record<string, AssignedTo>)[row.id]);
                        return (
                          <div key={row.id} className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
                            <span className="truncate text-[13px] font-semibold" title={row.label}>
                              {row.label || row.id}
                            </span>
                            <PeoplePicker users={users} value={ids} onChange={(next) => setRowPeople(sel.id, row.id, next)} disabled={disabled} placeholder="Nobody set" compact firstLabel="Primary" />
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {!isVerification && stagePermissions && (
                <Hint>
                  Who may open this step and do its work follows the <b>{stagePermissions}</b> permissions (User Management →
                  Roles), whatever the step is named; the people here may too.
                </Hint>
              )}
            </EditorSection>

            {/* Actions: one list for every step; what is ticked decides the step. */}
            <EditorSection
              icon={MousePointerClick}
              from="#86efac"
              to="#15803d"
              title="Actions"
              description="Tick what the assignee can do at this step"
              aside={
                <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11.5px] font-bold text-violet-700">
                  {previewButtons.length} on the page
                </span>
              }
            >
              <p className="mb-3 text-[12.5px] text-muted-foreground">
                {isVerification ? (
                  <>
                    An <b>approval step</b>: its people check each requisition in turn, and <b>Approve</b> — or{' '}
                    <b>Verify (GST &amp; TDS)</b>, which records the GST &amp; TDS figures first — passes it on to {nextName}. Tick{' '}
                    <b>Mark as Received</b> or <b>Send for Payment</b> and it becomes a finance step.
                  </>
                ) : (
                  <>
                    A <b>finance step</b>: it {selRoles.includes('receiving') ? 'receives requisitions' : ''}
                    {selRoles.length > 1 ? ' and ' : ''}
                    {selRoles.includes('gst') ? (selActions.has('Verify') ? 'verifies GST & TDS, then sends them for payment' : 'sends them for payment') : ''}
                    {selRoles.length === 0 ? 'does nothing another step does not already do' : ''}. Untick Mark as Received and Send for
                    Payment and it becomes an approval step.
                  </>
                )}
              </p>
              <ActionPicker
                actions={[...STEP_ACTIONS.slice(0, 3), HAND_OVER_ACTION, ...STEP_ACTIONS.slice(3)]}
                selected={pickerSelected}
                onToggle={(a) => toggleAction(sel.id, a)}
                disabled={disabled}
                idle={idleActions}
              />
              {!isVerification && !hasForward && <Hint tone="warn">No action moves the requisition forward. Tick at least one that does.</Hint>}
              <Hint>
                The step&apos;s page shows exactly the actions ticked here — {PAYMENT_PAGE_NAME}, after the last step, pays what was
                sent for payment.
              </Hint>
            </EditorSection>

            {/* Passing work on */}
            {(role !== 'other' || takeSources.length > 0) && (
              <EditorSection icon={ArrowRightLeft} from="#a5b4fc" to="#4338ca" title="Passing work on" description="Handing a requisition to someone else, and taking one before it arrives">
                {/* Hand over: the same setting as its tick under Actions, switched from either. */}
                {role !== 'other' && (
                  <div className="rounded-xl border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <FieldLabel htmlFor="handover-on">Allow hand over to someone else</FieldLabel>
                        <p className="-mt-1 text-xs text-muted-foreground">
                          {isVerification
                            ? 'The assignee can approve, or hand it to someone else, whose decision then counts.'
                            : "A requisition here can be handed to a person, who then does this step's work on it — even without its permissions."}
                        </p>
                      </div>
                      <Switch id="handover-on" checked={handOverOn} onCheckedChange={() => toggleAction(sel.id, HAND_OVER_ACTION)} disabled={disabled} />
                    </div>
                    {handOverOn && (
                      <div className="mt-3">
                        <FieldLabel>Who it can be handed to</FieldLabel>
                        <PeoplePicker
                          users={users}
                          value={sel.handOverUserIds ?? []}
                          onChange={(ids) => patchStep(sel.id, { handOverUserIds: ids })}
                          disabled={disabled}
                          placeholder="Anyone — or pick people to limit it"
                        />
                        {!isVerification && (
                          <Hint>
                            The people named on this step can hand over; so can anyone with the &quot;Hand Over&quot; permission on it, and the person a
                            requisition was handed to.
                          </Hint>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {takeSources.length > 0 && (
                  <div className={cn('rounded-xl border p-3', role !== 'other' && 'mt-3')}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <FieldLabel htmlFor="take-on">
                          <span className="inline-flex items-center gap-1.5">
                            <FastForward className="h-3.5 w-3.5" /> Take requests early
                          </span>
                        </FieldLabel>
                        <p className="-mt-1 text-xs text-muted-foreground">
                          Take a requisition before it arrives — from the step just before, or the earlier steps you tick. The steps in between are skipped.
                        </p>
                      </div>
                      <Switch
                        id="take-on"
                        checked={takeChosen.size > 0}
                        onCheckedChange={(on) => patchStep(sel.id, { takeFrom: on ? [takeSources[takeSources.length - 1].key] : [] })}
                        disabled={disabled}
                      />
                    </div>
                    {takeChosen.size > 0 && (
                      <>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {takeSources.map((q) => {
                            const on = takeChosen.has(q.key);
                            return (
                              <button
                                key={q.key}
                                type="button"
                                disabled={disabled}
                                aria-pressed={on}
                                onClick={() =>
                                  patchStep(sel.id, {
                                    takeFrom: takeSources.filter((s) => (s.key === q.key ? !on : takeChosen.has(s.key))).map((s) => s.key),
                                  })
                                }
                                className={cn(
                                  'rounded-[11px] border bg-card px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground',
                                  on && 'border-indigo-500 bg-indigo-50 text-indigo-800',
                                )}
                              >
                                From {q.index + 1}. {q.step.name}
                                {q.index === selIndex - 1 ? <span className="font-normal"> (just before)</span> : null}
                              </button>
                            );
                          })}
                        </div>
                        <Hint>
                          {isVerification ? "This step's people can take them." : 'People also need the "Take Early" permission on this stage.'}
                        </Hint>
                      </>
                    )}
                  </div>
                )}
              </EditorSection>
            )}

            {/* Attachment & instructions */}
            <EditorSection
              icon={ClipboardCheck}
              from="#c4b5fd"
              to="#6d28d9"
              title={isVerification ? 'Instructions' : 'Attachment & instructions'}
              description={isVerification ? 'The note the assignee sees' : 'What the assignee must upload, and the note they see'}
            >
              {!isVerification && (
                <div className="mb-3.5">
                  <FieldLabel>Attachment at this step</FieldLabel>
                  <Segmented<UploadRequirement>
                    value={sel.upload}
                    disabled={disabled}
                    onChange={(upload) => patchStep(sel.id, { upload })}
                    options={[
                      { value: 'Required', label: 'Required' },
                      { value: 'Not Required', label: 'Not needed' },
                      { value: 'Optional', label: 'Optional' },
                    ]}
                  />
                </div>
              )}
              <FieldLabel htmlFor="step-instructions">Instructions for the assignee</FieldLabel>
              <textarea
                id="step-instructions"
                maxLength={INSTRUCTIONS_MAX}
                value={sel.description || ''}
                disabled={disabled}
                onChange={(e) => patchStep(sel.id, { description: e.target.value })}
                placeholder="e.g. Review the attached invoice, check GST and TDS, then verify."
                className="min-h-[84px] w-full resize-y rounded-xl border bg-card px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15"
              />
              <p className="mt-0.5 text-right text-[11px] text-muted-foreground">
                {(sel.description || '').length} / {INSTRUCTIONS_MAX}
              </p>
            </EditorSection>

            {/* Notifications & escalation */}
            <EditorSection icon={BellRing} from="#f9a8d4" to="#be185d" title="Notifications & escalation" description="Who hears about it, and what happens if it runs late">
              <FieldLabel>Notify when this step starts</FieldLabel>
              <PeoplePicker
                users={users}
                value={sel.notifyUserIds ?? []}
                onChange={(ids) => patchStep(sel.id, { notifyUserIds: ids })}
                disabled={disabled}
                placeholder="Search people to notify…"
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
                <div>
                  <FieldLabel>Escalate to</FieldLabel>
                  <Select value={sel.escalationUserId || 'none'} onValueChange={(v) => patchStep(sel.id, { escalationUserId: v === 'none' ? '' : v })} disabled={disabled}>
                    <SelectTrigger className="rounded-[11px]">
                      <SelectValue placeholder="No escalation" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No escalation</SelectItem>
                      {users.map((u) => {
                        const { name, subtitle } = personParts(u, u.id);
                        return (
                          <SelectItem key={u.id} value={u.id}>
                            {subtitle ? `${name} — ${subtitle}` : name}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className={cn(!sel.escalationUserId && 'opacity-50')}>
                  <FieldLabel htmlFor="esc-threshold">
                    When <b>{sel.escalationThreshold ?? 80}%</b> of TAT is used
                  </FieldLabel>
                  <input
                    id="esc-threshold"
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={sel.escalationThreshold ?? 80}
                    disabled={disabled || !sel.escalationUserId}
                    onChange={(e) => patchStep(sel.id, { escalationThreshold: Number(e.target.value) })}
                    className="w-full accent-violet-600"
                  />
                </div>
              </div>
              <Hint>
                {sel.escalationUserId
                  ? `${nameOf(sel.escalationUserId)} is alerted after ${(((Number(sel.tat) || 0) * (sel.escalationThreshold ?? 80)) / 100).toFixed(1).replace('.0', '')} h if nobody has acted.`
                  : 'Without escalation, an overdue requisition only shows as late on the stage page.'}
              </Hint>
            </EditorSection>
          </section>
        )}

        {/* ── preview, summary, checks ── */}
        {sel && (
          <aside className="flex flex-col gap-3.5 lg:col-span-2 lg:grid lg:grid-cols-2 xl:sticky xl:top-4 xl:col-span-1 xl:flex">
            <SideBox title="What the assignee sees" aside="live preview">
              <AssigneePreview
                stepLabel={`Step ${selIndex + 1} · ${sel.name || 'Unnamed step'}`}
                tat={Number(sel.tat) || 0}
                instructions={sel.description || ''}
                upload={isVerification ? 'Not Required' : sel.upload}
                buttons={previewButtons}
              />
            </SideBox>
            <div className="flex flex-col gap-3.5">
              <SideBox title="Step summary">
                <SummaryRows
                  rows={[
                    ['Type', isVerification ? 'Approval step' : `Finance step · ${selRoles.map((r) => stepWorkLabel(sel, r)).join(' + ') || 'no work'}`],
                    [
                      'Lands with',
                      isUserBased(sel)
                        ? people.length
                          ? people.map(nameOf).join(', ')
                          : <span className="text-amber-700">No one</span>
                        : `${mappedCount} ${sel.assignmentType === 'Project-based' ? 'projects' : 'departments'} set`,
                    ],
                    ['Overdue after', `${Number(sel.tat) || 0} working hours`],
                    ['Actions', previewButtons.join(', ') || '—'],
                    ...(!isVerification ? [['Attachment', { Required: 'Required', 'Not Required': 'Not needed', Optional: 'Optional' }[sel.upload] ?? sel.upload] as [string, string]] : []),
                    ['Hand over', handOverOn ? ((sel.handOverUserIds?.length ?? 0) ? `To ${sel.handOverUserIds!.length} people` : 'To anyone') : 'Off'],
                    ['Takes early from', takeChosen.size ? placed.filter((q) => takeChosen.has(q.key)).map((q) => q.step.name).join(', ') : '—'],
                    ['Notifies', `${(sel.notifyUserIds ?? []).length} people`],
                    ['Escalates to', sel.escalationUserId ? `${nameOf(sel.escalationUserId)} at ${sel.escalationThreshold ?? 80}%` : '—'],
                  ]}
                />
              </SideBox>
              <SideBox title="Checks">
                <CheckList
                  items={[
                    { ok: Boolean(sel.name.trim()), label: 'Step has a name' },
                    ...selProblems.filter((p) => p !== NAME_REQUIRED).map((p) => ({ ok: false, label: p })),
                    ...(!isVerification ? [{ ok: hasForward, label: 'An action moves it forward' }] : []),
                    {
                      ok: isUserBased(sel) ? people.length > 1 : mappedCount > 0,
                      label: isUserBased(sel) ? 'Someone covers when a person is away' : 'People are set for at least one row',
                    },
                    { ok: Boolean(sel.escalationUserId), label: 'Escalation set' },
                    { ok: (sel.description || '').trim().length > 10, label: 'Instructions written' },
                  ]}
                />
              </SideBox>
            </div>
          </aside>
        )}
      </div>

      {/* Unsaved changes */}
      <div
        className={cn(
          'fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-2xl bg-slate-900 py-2 pl-4 pr-2 text-sm text-white shadow-[0_20px_50px_-10px_rgba(15,23,42,0.53)] transition-all duration-200',
          isDirty && canEditPage ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-[150%] opacity-0',
        )}
        role="status"
      >
        <span className="min-w-0 max-w-[620px]">
          Unsaved changes to <b className="text-violet-300">the workflow</b>
          {firstInvalid ? (
            <span className="mt-0.5 block whitespace-normal break-words text-xs leading-snug text-rose-300">
              {invalidCount > 1 ? `${invalidCount} steps need attention before saving. ` : 'Fix this before saving: '}
              {firstInvalid.message}
            </span>
          ) : null}
        </span>
        {firstInvalid && firstInvalid.key !== selectedKey && (
          <Button
            variant="outline"
            size="sm"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            onClick={() => setSelectedKey(firstInvalid.key)}
          >
            Show step
          </Button>
        )}
        <Button variant="outline" size="sm" className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={handleDiscard} disabled={isSaving}>
          Discard
        </Button>
        <Button size="sm" className="bg-white text-slate-900 hover:bg-white/90" onClick={handleSave} disabled={isSaving || !!pageInvalidMsg}>
          {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          Save workflow
        </Button>
      </div>
    </div>
  );
}

/* ---------------- validation ---------------- */

const NAME_REQUIRED = 'Give it a name.';

/**
 * What stops each step from being saved, keyed by step key. Each stage is reached at
 * /daily-requisition/<slug of its name>, so two stages whose names slug alike would share one page.
 */
function stepProblems(steps: WorkflowStep[]): Map<string, string[]> {
  const normalized = normalizeIds(steps);
  const out = new Map<string, string[]>();
  const slugOwner = new Map<string, string>();
  // Each finance work on one stage, in order: received, then GST & TDS, then paid.
  const workProblems = stageWorkProblems(normalized);
  normalized.forEach((s, index) => {
    const list: string[] = [];
    if (!s.name || !s.name.trim()) {
      list.push(NAME_REQUIRED);
    } else {
      const nameProblem = dailyStepNameProblem(s.name);
      if (nameProblem) list.push(`This name ${nameProblem}`);
      const slug = dailyStepSlug(s.name);
      const owner = slugOwner.get(slug);
      if (owner) list.push(`It would open the same page as "${owner}" (/daily-requisition/${slug}). Make the names differ by more than punctuation.`);
      else slugOwner.set(slug, s.name);
    }
    const placementProblem = verificationPlacementProblem(normalized, index);
    if (placementProblem) list.push(`This approval step ${placementProblem}`);
    for (const text of workProblems.get(index) ?? []) list.push(text.startsWith('"') ? text : `This step ${text}`);
    const tatNum = Number(s.tat);
    if (!Number.isFinite(tatNum) || tatNum <= 0) list.push('Turnaround must be a positive number of hours.');
    if (isUserBased(s) && (s.assignedTo ?? []).filter(Boolean).length === 0) list.push('Add at least one person.');
    if (isMapped(s)) {
      const map = (s.assignedTo ?? {}) as Record<string, AssignedTo>;
      if (!Object.values(map).some((m) => assignedPeople(m).length > 0)) {
        list.push(`Set people for at least one ${s.assignmentType === 'Project-based' ? 'project' : 'department'}.`);
      }
    }
    if (list.length) out.set(s.key ?? s.id, list);
  });
  return out;
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

/* ---------------- audit diff ---------------- */
interface WorkflowLookups {
  users: Map<string, string>;
  projects: Map<string, string>;
  departments: Map<string, string>;
  roles: Map<string, string>;
  /** Step names by key, for the take-early lists. */
  steps: Map<string, string>;
}

type AmountBasedConditionLike = {
  type: string;
  amount1?: number;
  amount2?: number;
  userId: string;
  alternativeUserId?: string;
};

/** One step as readable, flat text — names instead of ids — so a log reviewer can read the diff. */
function summarizeStep(step: WorkflowStep, lk: WorkflowLookups): Record<string, string | number | null> {
  const userName = (id?: string | null) => (id ? lk.users.get(id) ?? id : '');
  let assignees = '';
  if (step.assignmentType === 'User-based') {
    assignees = ((step.assignedTo as string[]) ?? []).filter(Boolean).map((id) => userName(id)).join(', ');
  } else if (step.assignmentType === 'Amount-based') {
    assignees = ((step.assignedTo as AmountBasedConditionLike[]) ?? [])
      .map((c) => {
        const range =
          c.type === 'Between' ? `Between ${c.amount1 ?? 0} and ${c.amount2 ?? 0}` : `${c.type} ${c.amount1 ?? 0}`;
        const alt = c.alternativeUserId ? ` / ${userName(c.alternativeUserId)}` : '';
        return `${range}: ${userName(c.userId)}${alt}`;
      })
      .join('; ');
  } else {
    const names =
      step.assignmentType === 'Project-based'
        ? lk.projects
        : step.assignmentType === 'Department-based'
          ? lk.departments
          : lk.roles;
    const map = (step.assignedTo ?? {}) as Record<string, AssignedTo>;
    assignees = Object.entries(map)
      .filter(([, m]) => assignedPeople(m).length > 0)
      .map(([key, m]) => `${names.get(key) ?? key}: ${assignedPeople(m).map((id) => userName(id)).join(' / ')}`)
      .sort()
      .join('; ');
  }

  const actions = (step.actions ?? [])
    .map((a) => {
      if (typeof a === 'string') return a;
      const flags = [
        a.requiresComment && 'comment required',
        a.requiresAttachment && 'attachment required',
        a.nextStatus && `next: ${a.nextStatus}`,
        a.departmentId && `dept: ${lk.departments.get(a.departmentId) ?? a.departmentId}`,
      ].filter(Boolean);
      return flags.length ? `${a.name} (${flags.join(', ')})` : a.name;
    })
    .join(', ');

  return {
    tat: Number(step.tat) || 0,
    assignmentType: step.assignmentType ?? null,
    assignees,
    actions,
    upload: step.upload ?? null,
    description: step.description ?? '',
    notify: (step.notifyUserIds ?? []).map((id) => userName(id)).join(', '),
    escalationUser: userName(step.escalationUserId),
    escalationThreshold: step.escalationThreshold ?? null,
    kind: step.kind === 'verification' ? 'Approval step' : 'Finance step',
    handOver: allowsHandOver(step) ? 'Allowed' : 'Off',
    handOverTo: (step.handOverUserIds ?? []).map((id) => userName(id)).join(', '),
    takeEarlyFrom: (step.takeFrom ?? []).map((key) => lk.steps.get(key) ?? key).join(', '),
  };
}

/**
 * What a workflow save changed, per step name. Steps are matched by name first (ids are
 * renumbered on every move/delete); a leftover old and new step in the same position is a rename.
 * `changes` uses the usual {field: {from, to}} shape, keyed "<Step> › <field>".
 */
function diffWorkflowSteps(before: WorkflowStep[], after: WorkflowStep[], lk: WorkflowLookups) {
  const changes: Record<string, FieldChange> = {};
  const added: string[] = [];
  const removed: string[] = [];
  const renamed: { from: string; to: string }[] = [];

  const beforeByName = new Map(before.map((st) => [st.name, st]));
  const afterNames = new Set(after.map((st) => st.name));
  const unmatchedBefore = new Map<number, WorkflowStep>();
  before.forEach((st, i) => {
    if (!afterNames.has(st.name)) unmatchedBefore.set(i, st);
  });

  const compare = (label: string, a: WorkflowStep, b: WorkflowStep) => {
    const d = diffFields(summarizeStep(a, lk), summarizeStep(b, lk));
    for (const [field, change] of Object.entries(d)) changes[`${label} › ${field}`] = change;
  };

  after.forEach((st, i) => {
    const match = beforeByName.get(st.name);
    if (match) {
      compare(st.name, match, st);
      return;
    }
    const old = unmatchedBefore.get(i);
    if (old) {
      unmatchedBefore.delete(i);
      renamed.push({ from: old.name, to: st.name });
      changes[`${st.name} › name`] = { from: old.name, to: st.name };
      compare(st.name, old, st);
      return;
    }
    added.push(st.name);
    changes[`${st.name} › step`] = { from: null, to: 'Added' };
  });
  for (const old of unmatchedBefore.values()) {
    removed.push(old.name);
    changes[`${old.name} › step`] = { from: 'Removed', to: null };
  }

  const beforeOrder = before.map((st) => st.name).join(' → ');
  const afterOrder = after.map((st) => st.name).join(' → ');
  const orderChanged = beforeOrder !== afterOrder;
  if (orderChanged) changes['Step order'] = { from: beforeOrder || null, to: afterOrder || null };

  return {
    added,
    removed,
    renamed,
    orderChanged,
    changedCount: Object.keys(changes).length,
    changes,
  };
}

/** A fresh step key: a reference that survives renaming and reordering (src/lib/daily-requisition-flow.ts). */
function newStepKey(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

/**
 * Ids renumbered to positions, every step keyed, and each step's take-early list kept to steps
 * that still come before it — run after every add, move and delete, and before saving.
 */
function normalizeIds(arr: WorkflowStep[]): WorkflowStep[] {
  return renumberSteps(withStepKeys(arr, newStepKey));
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
