'use client';

import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  Filter,
  FlaskConical,
  Layers,
  Plus,
  SplitSquareVertical,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  DEFAULT_E_APPROVAL_CAPABILITIES,
  describeEApprovalAssignment,
  describeEApprovalCondition,
  E_APPROVAL_PRIORITIES,
  E_APPROVAL_STEP_TYPES,
  eApprovalConditionSpecificity,
  expandEApprovalWorkflow,
  type EApprovalGroupMode,
  type EApprovalPriority,
  type EApprovalStepCapabilities,
  type EApprovalStepCondition,
  type EApprovalStepOverride,
  type EApprovalStepType,
  type EApprovalTemplateRecord,
  type EApprovalTemplateStep,
  type EApprovalWorkflowContext,
  type EApprovalWorkflowNote,
} from '@/lib/e-approval';
import { AssigneePicker } from '../assignee-picker';
import type { EApprovalDirectory } from '../hooks';
import { WorkflowConditionEditor } from './workflow-condition-editor';

const capabilityLabels: Array<{ key: keyof EApprovalStepCapabilities; label: string; hint: string }> = [
  { key: 'canVerify', label: 'Can send for verification', hint: 'Raise a verification that returns to this step' },
  { key: 'canRequestClarification', label: 'Can request clarification', hint: 'Ask a question and get it back' },
  { key: 'canReturn', label: 'Can return', hint: 'Send the file back to an earlier step' },
  { key: 'canForward', label: 'Can forward', hint: 'Transfer this approval to somebody else' },
  { key: 'canDelegate', label: 'Can delegate', hint: 'Let somebody act in their place' },
  { key: 'canAddApprover', label: 'Can add an approver', hint: 'Insert a step after this one' },
  { key: 'canEscalate', label: 'Can escalate', hint: 'Hand the step to a senior authority' },
  { key: 'canReject', label: 'Can reject', hint: 'Close the request outright' },
  { key: 'canHold', label: 'Can hold', hint: 'Stop the SLA clock' },
  { key: 'canFinalise', label: 'Can approve & complete', hint: 'End the workflow early, skipping later steps' },
];

/** A collapsible sub-panel inside a stage card — conditions, overrides, powers. */
function StageDrawer({
  icon: Icon,
  label,
  summary,
  tone,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  summary: string;
  tone?: 'default' | 'active';
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('rounded-md border', tone === 'active' ? 'border-sky-300 bg-sky-50/50' : 'bg-background')}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <Icon className={cn('h-3.5 w-3.5 shrink-0', tone === 'active' ? 'text-sky-600' : 'text-muted-foreground')} />
        <span className="text-[11px] font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{summary}</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && <div className="border-t px-2 py-2">{children}</div>}
    </div>
  );
}

/**
 * What one authoring node actually produces for the previewed project, department, type and amount.
 *
 * Rendered on the node itself rather than in a panel elsewhere, because the two facts only mean
 * anything side by side: "addressed to the post Project Manager" and "so, on Ranchi Metro, that is
 * Rahul Kumar" answer each other, and separating them makes the reader hold one in their head while
 * they go and find the other.
 */
function StageOutcome({
  produced,
  warnings,
  skipped,
  override,
  pending,
  isSubWorkflow,
}: {
  produced: EApprovalTemplateStep[];
  warnings: EApprovalWorkflowNote[];
  skipped?: EApprovalWorkflowNote;
  override?: EApprovalWorkflowNote;
  pending: boolean;
  isSubWorkflow: boolean;
}) {
  if (skipped) {
    return (
      <div className="mt-2 rounded-md border border-dashed bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
        <span className="font-medium">Left out here.</span> {skipped.message}
      </div>
    );
  }

  if (pending) {
    return (
      <div className="mt-2 rounded-md border border-dashed border-sky-200 bg-sky-50/60 px-2 py-1.5 text-[11px] text-sky-800">
        Resolves per the request — pick a project or department in the bar above to see who this reaches.
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      {produced.length > 0 && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-2 py-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
            {isSubWorkflow ? `Expands to ${produced.length} stage${produced.length === 1 ? '' : 's'}` : 'Resolves to'}
          </p>
          <ol className="mt-0.5 space-y-0.5">
            {produced.map((step) => {
              const who = step.assignments.length
                ? step.assignments
                    .map(describeEApprovalAssignment)
                    .join(step.groupMode === 'Any' ? ' or ' : ' & ')
                : 'nobody';
              const via = step.assignments
                .map((assignment) => assignment.resolvedFrom)
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={step.id} className="text-[11px] leading-snug">
                  {isSubWorkflow && <span className="text-emerald-700">{step.name} — </span>}
                  <span className="font-medium text-emerald-900">{who}</span>
                  {via && <span className="block text-[10px] text-emerald-700/80">{via}</span>}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {override && (
        <p className="rounded-md border border-sky-200 bg-sky-50/70 px-2 py-1 text-[11px] text-sky-900">
          {override.message}
        </p>
      )}

      {warnings.map((note, position) => (
        <p
          key={`${note.kind}-${position}`}
          className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900"
        >
          {note.message}
        </p>
      ))}
    </div>
  );
}

/**
 * The stage overrides of one step — "the same stage, a different person on this project".
 *
 * This panel is the reason the whole feature exists. Without it the only way to route a five-stage
 * chain differently on two sites is two copies of the chain, and the second copy stops matching the
 * first the first time anybody edits one. Here the *stage* varies and the chain stays single.
 */
function StageOverridesEditor({
  step,
  onChange,
  directory,
  defaultSlaHours,
}: {
  step: EApprovalTemplateStep;
  onChange: (next: EApprovalStepOverride[]) => void;
  directory: EApprovalDirectory;
  defaultSlaHours: number;
}) {
  const overrides = step.overrides ?? [];

  const update = (index: number, patch: Partial<EApprovalStepOverride>) =>
    onChange(overrides.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)));

  const add = () =>
    onChange([
      ...overrides,
      {
        id: `ovr-${Date.now()}`,
        label: '',
        projectIds: [],
        assignments: [],
        active: true,
      },
    ]);

  const projectName = (id: string) => directory.projectById.get(id)?.projectName;
  const departmentName = (id: string) => directory.departmentById.get(id)?.name;
  const typeName = (id: string) => directory.types.find((type) => type.id === id)?.name;

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The stage runs as configured above unless one of these matches the request. Where two match, the more
        specific one wins — a rule naming a project beats one naming that project&rsquo;s department.
      </p>

      {overrides.map((override, index) => {
        const scope = describeEApprovalCondition(override, {
          project: projectName,
          department: departmentName,
          approvalType: typeName,
        });
        return (
          <div key={override.id} className="rounded-md border bg-muted/20 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={override.label ?? ''}
                onChange={(event) => update(index, { label: event.target.value })}
                placeholder="Ranchi Metro site"
                className="h-7 max-w-[200px] text-xs"
              />
              <Badge variant="outline" className="text-[10px]">
                {scope}
              </Badge>
              {eApprovalConditionSpecificity(override) === 0 && (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-800">
                  Matches everything — it would replace the stage on every request
                </Badge>
              )}
              <label className="flex items-center gap-1.5 text-[11px]">
                <Checkbox
                  checked={override.skip === true}
                  onCheckedChange={(checked) => update(index, { skip: checked === true })}
                />
                Skip the stage here
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto h-7 w-7 p-0 text-destructive"
                onClick={() => onChange(overrides.filter((_, position) => position !== index))}
                aria-label="Remove override"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              <div className="rounded-md border bg-background p-2">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  When it applies
                </Label>
                <div className="mt-1.5">
                  <WorkflowConditionEditor
                    value={override}
                    onChange={(next) => update(index, next)}
                    directory={directory}
                  />
                </div>
              </div>

              {!override.skip && (
                <div className="space-y-2 rounded-md border bg-background p-2">
                  <AssigneePicker
                    directory={directory}
                    value={override.assignments ?? []}
                    onChange={(next) => update(index, { assignments: next })}
                    multiple
                    label="Approvers here instead"
                  />
                  <div className="flex items-center gap-1.5">
                    <Label className="text-[10px] uppercase text-muted-foreground">SLA</Label>
                    <Input
                      type="number"
                      min={1}
                      value={override.slaHours ?? ''}
                      onChange={(event) =>
                        update(index, { slaHours: Number(event.target.value) || undefined })
                      }
                      placeholder={String(step.slaHours ?? defaultSlaHours)}
                      className="h-7 w-16 text-xs"
                    />
                    <span className="text-[10px] text-muted-foreground">h — blank keeps the stage&rsquo;s own</span>
                  </div>
                  {!(override.assignments ?? []).length && (
                    <p className="text-[11px] text-muted-foreground">
                      No approvers set — the stage keeps the ones configured above.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add a project or department variation
      </Button>
    </div>
  );
}

/**
 * The step configuration of spec section 27, used by both the template editor and the matrix rules.
 *
 * A node is either a **stage** — one or more approvers, its own SLA and its own powers — or a
 * **sub-workflow**, which expands another workflow in place when the chain is built. Sub-workflows
 * are a reference rather than a copy, which is the whole point: "Finance Clearance" is edited once
 * and every chain that calls it changes with it.
 *
 * A stage with more than one assignee becomes a parallel group, and the group mode decides how it is
 * satisfied (spec section 28) — which is why the mode selector only appears once a second assignee
 * has been added: "all must approve" is meaningless for one person, and offering it invites the
 * misconfiguration where a single-approver step is set to "2 of 3" and can never be satisfied.
 */
export function WorkflowStepEditor({
  steps,
  onChange,
  directory,
  defaultSlaHours = 24,
  subWorkflows = [],
  /** The workflow being edited, so it cannot be made to call itself. */
  currentTemplateId,
}: {
  steps: EApprovalTemplateStep[];
  onChange: (next: EApprovalTemplateStep[]) => void;
  directory: EApprovalDirectory;
  defaultSlaHours?: number;
  subWorkflows?: EApprovalTemplateRecord[];
  currentTemplateId?: string;
}) {
  const update = (index: number, patch: Partial<EApprovalTemplateStep>) =>
    onChange(steps.map((step, position) => (position === index ? { ...step, ...patch } : step)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const add = (nodeType: 'Stage' | 'SubWorkflow') =>
    onChange([
      ...steps,
      {
        id: `step-${Date.now()}`,
        name: nodeType === 'SubWorkflow' ? 'Sub-workflow' : `Stage ${steps.length + 1}`,
        nodeType,
        type: 'APPROVAL',
        assignments: [],
        slaHours: nodeType === 'SubWorkflow' ? undefined : defaultSlaHours,
        mandatory: true,
      },
    ]);

  const projectName = (id: string) => directory.projectById.get(id)?.projectName;
  const departmentName = (id: string) => directory.departmentById.get(id)?.name;
  const typeName = (id: string) => directory.types.find((type) => type.id === id)?.name;

  const conditionSummary = (condition: EApprovalStepCondition | undefined) =>
    describeEApprovalCondition(condition, {
      project: projectName,
      department: departmentName,
      approvalType: typeName,
    });

  /** Sub-workflows this node may call: every one but the workflow being edited. */
  const callable = subWorkflows.filter((template) => template.id !== currentTemplateId);

  /* ── The preview context ──────────────────────────────────────────────────────────────────────
   *
   * One bar at the top of the builder rather than a tester card at the bottom of the dialog. With
   * sub-workflows and per-project approvers, what a stage *does* is no longer visible from what it
   * *says* — so the answer belongs on the stage itself, next to the configuration that produced it,
   * not in a separate panel the eye has to travel to and correlate by name.
   * ------------------------------------------------------------------------------------------- */

  const [previewProjectId, setPreviewProjectId] = useState('ANY');
  const [previewDepartmentId, setPreviewDepartmentId] = useState('ANY');
  const [previewTypeId, setPreviewTypeId] = useState('ANY');
  const [previewPriority, setPreviewPriority] = useState<EApprovalPriority>('Normal');
  const [previewAmount, setPreviewAmount] = useState('250000');

  const expanded = useMemo(() => {
    const context: EApprovalWorkflowContext = {
      projectId: previewProjectId === 'ANY' ? undefined : previewProjectId,
      projectName:
        previewProjectId === 'ANY' ? undefined : directory.projectById.get(previewProjectId)?.projectName,
      departmentId: previewDepartmentId === 'ANY' ? undefined : previewDepartmentId,
      departmentName:
        previewDepartmentId === 'ANY' ? undefined : directory.departmentById.get(previewDepartmentId)?.name,
      approvalTypeId: previewTypeId === 'ANY' ? undefined : previewTypeId,
      priority: previewPriority,
      amount: Number(previewAmount) || 0,
    };
    return expandEApprovalWorkflow(steps, context, {
      templates: callable,
      projectRouting: directory.projectRouting,
    });
    // `callable` is derived from `subWorkflows` on every render; keying on the source array keeps
    // this from re-expanding on every keystroke in an unrelated field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    steps,
    subWorkflows,
    currentTemplateId,
    directory,
    previewProjectId,
    previewDepartmentId,
    previewTypeId,
    previewPriority,
    previewAmount,
  ]);

  const producedBy = useMemo(() => {
    const map = new Map<string, EApprovalTemplateStep[]>();
    for (const step of expanded.steps) {
      const key = step.sourceStepId ?? step.id;
      map.set(key, [...(map.get(key) ?? []), step]);
    }
    return map;
  }, [expanded]);

  const notesBy = useMemo(() => {
    const map = new Map<string, EApprovalWorkflowNote[]>();
    for (const note of expanded.notes) {
      if (!note.sourceStepId) continue;
      map.set(note.sourceStepId, [...(map.get(note.sourceStepId) ?? []), note]);
    }
    return map;
  }, [expanded]);

  const previewingProject = previewProjectId !== 'ANY';
  const previewingDepartment = previewDepartmentId !== 'ANY';

  /**
   * What one authoring node resolves to, as the line rendered on its own card.
   *
   * A stage that binds to the request's project shows a neutral prompt rather than a warning while no
   * project is selected above: nothing is misconfigured, the question simply has not been asked yet.
   * Warning amber has to mean "fix this", or it stops meaning anything.
   */
  const outcomeFor = (node: EApprovalTemplateStep) => {
    const produced = producedBy.get(node.id) ?? [];
    const nodeNotes = notesBy.get(node.id) ?? [];
    const warnings = nodeNotes.filter((note) => note.severity === 'warning');
    const skipped = nodeNotes.find(
      (note) => note.kind === 'StageSkippedByCondition' || note.kind === 'StageSkippedByOverride',
    );
    const override = nodeNotes.find((note) => note.kind === 'OverrideApplied');
    const needsProject = node.assignments?.some(
      (assignment) => assignment.kind === 'Project' && !assignment.projectId,
    );
    const needsDepartment = node.assignments?.some(
      (assignment) => assignment.kind === 'Department' && !assignment.departmentId,
    );
    const pending =
      (needsProject && !previewingProject) || (needsDepartment && !previewingDepartment);
    return { produced, warnings: pending ? [] : warnings, skipped, override, pending };
  };

  /**
   * The two ways to add a node.
   *
   * Rendered above the list as well as below it. A workflow with six stages puts the bottom pair
   * below the fold of the dialog, and an action you have to scroll to find is an action most people
   * conclude does not exist — which is exactly what happened with "Add sub-workflow".
   */
  const addButtons = (
    <div className="flex flex-wrap gap-1.5">
      <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => add('Stage')}>
        <Plus className="h-3.5 w-3.5" /> Add stage
      </Button>
      {/* Never disabled. With nothing to call, the node still adds and its own dropdown explains what
          is missing — a greyed-out button whose only explanation is a hover tooltip is a dead end. */}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 border-violet-300 bg-violet-50/60 text-violet-700 hover:bg-violet-100"
        onClick={() => add('SubWorkflow')}
      >
        <Layers className="h-3.5 w-3.5" /> Add sub-workflow
      </Button>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Stages &amp; sub-workflows
          </p>
          <p className="text-[11px] text-muted-foreground">
            They run in order. <span className="text-violet-700">Add sub-workflow</span> runs another whole workflow
            at that point in the chain.
          </p>
        </div>
        {addButtons}
      </div>

      {/* The preview context. Sticky, because the answer it drives is rendered on every stage below —
          scrolling a ten-stage chain must not scroll away the question those answers are answering. */}
      <div className="sticky top-0 z-10 rounded-lg border border-sky-200 bg-sky-50/95 p-2 backdrop-blur">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <FlaskConical className="h-3.5 w-3.5 shrink-0 text-sky-600" />
          <span className="text-[11px] font-semibold text-sky-900">Previewing this chain for</span>
          <Badge variant="outline" className="border-sky-300 bg-white text-[10px]">
            {expanded.steps.length} stage{expanded.steps.length === 1 ? '' : 's'} produced
          </Badge>
          {expanded.notes.some((note) => note.severity === 'warning') && (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-800">
              needs attention
            </Badge>
          )}
        </div>
        <div className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Project</Label>
            <Select value={previewProjectId} onValueChange={setPreviewProjectId}>
              <SelectTrigger className="mt-0.5 h-7 bg-white text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Unspecified</SelectItem>
                {directory.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.projectName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Department</Label>
            <Select value={previewDepartmentId} onValueChange={setPreviewDepartmentId}>
              <SelectTrigger className="mt-0.5 h-7 bg-white text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Unspecified</SelectItem>
                {directory.departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Type</Label>
            <Select value={previewTypeId} onValueChange={setPreviewTypeId}>
              <SelectTrigger className="mt-0.5 h-7 bg-white text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Unspecified</SelectItem>
                {directory.types.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Priority</Label>
            <Select value={previewPriority} onValueChange={(next) => setPreviewPriority(next as EApprovalPriority)}>
              <SelectTrigger className="mt-0.5 h-7 bg-white text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {E_APPROVAL_PRIORITIES.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {entry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount (₹)</Label>
            <Input
              type="number"
              value={previewAmount}
              onChange={(event) => setPreviewAmount(event.target.value)}
              className="mt-0.5 h-7 bg-white text-xs"
            />
          </div>
        </div>
      </div>

      {steps.map((step, index) => {
        const isSubWorkflow = step.nodeType === 'SubWorkflow' || Boolean(step.subWorkflowId);
        const parallel = step.assignments.length > 1;
        const mode: EApprovalGroupMode = step.groupMode ?? (parallel ? 'All' : 'Single');
        const overrides = step.overrides ?? [];
        const target = callable.find((template) => template.id === step.subWorkflowId);
        const outcome = outcomeFor(step);

        return (
          <div
            key={step.id}
            className={cn(
              'rounded-lg border p-2.5',
              isSubWorkflow ? 'border-violet-300 bg-violet-50/40' : 'bg-background',
              // A stage left out for the previewed combination is dimmed rather than hidden: it is
              // still part of the workflow being edited, just not part of *this* run of it.
              outcome.skipped && 'opacity-60',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                  isSubWorkflow ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700',
                )}
              >
                {isSubWorkflow ? <Layers className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <Input
                value={step.name}
                onChange={(event) => update(index, { name: event.target.value })}
                placeholder={isSubWorkflow ? 'Sub-workflow label' : 'Stage name'}
                className="h-8 max-w-[220px] text-sm"
              />

              {isSubWorkflow ? (
                <Select
                  value={step.subWorkflowId ?? ''}
                  onValueChange={(next) => update(index, { subWorkflowId: next })}
                >
                  <SelectTrigger className="h-8 w-[240px] text-xs">
                    <SelectValue placeholder="Choose a workflow to run here" />
                  </SelectTrigger>
                  <SelectContent>
                    {callable.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name} · {(template.steps ?? []).length} stages
                        {template.isSubWorkflow ? '' : ' (full workflow)'}
                      </SelectItem>
                    ))}
                    {!callable.length && (
                      <SelectItem value="__none" disabled>
                        Nothing to call yet — save this, then build one on the Sub-workflows tab
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <>
                  <Select
                    value={step.type ?? 'APPROVAL'}
                    onValueChange={(next) => update(index, { type: next as EApprovalStepType })}
                  >
                    <SelectTrigger className="h-8 w-[150px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {E_APPROVAL_STEP_TYPES.filter((type) => type !== 'CLARIFICATION').map((type) => (
                        <SelectItem key={type} value={type}>
                          {type === 'APPROVAL' ? 'Approval' : type === 'REVIEW' ? 'Review / verification' : 'Verification'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">SLA</Label>
                    <Input
                      type="number"
                      min={1}
                      value={step.slaHours ?? ''}
                      onChange={(event) => update(index, { slaHours: Number(event.target.value) || undefined })}
                      placeholder={String(defaultSlaHours)}
                      className="h-8 w-16 text-xs"
                    />
                    <span className="text-[10px] text-muted-foreground">h</span>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={step.mandatory !== false}
                      onCheckedChange={(checked) => update(index, { mandatory: checked === true })}
                    />
                    Mandatory
                  </label>
                </>
              )}

              <div className="ml-auto flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="Move up"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => move(index, 1)}
                  disabled={index === steps.length - 1}
                  aria-label="Move down"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-destructive"
                  onClick={() => onChange(steps.filter((_, position) => position !== index))}
                  aria-label="Remove step"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {isSubWorkflow ? (
              <div className="mt-2 space-y-2">
                {target ? (
                  !target.isSubWorkflow && (
                    <p className="flex items-start gap-1.5 rounded-md border bg-background px-2 py-1.5 text-[11px] text-amber-700">
                      <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" />
                      {target.name} is a full workflow, not a building block. It still expands here, but it is also
                      offered on the request form as a route of its own.
                    </p>
                  )
                ) : (
                  <p className="text-[11px] text-amber-700">
                    No workflow chosen — this node contributes nothing to the chain.
                  </p>
                )}

                <StageOutcome {...outcome} isSubWorkflow />

                <label className="flex cursor-pointer items-center gap-2 text-[11px]">
                  <Checkbox
                    checked={step.prefixSubWorkflowNames !== false}
                    onCheckedChange={(checked) => update(index, { prefixSubWorkflowNames: checked === true })}
                  />
                  Prefix its stage names with &ldquo;{step.name || 'this node'}&rdquo; in the timeline
                </label>

                <StageDrawer
                  icon={Filter}
                  label="When it runs"
                  summary={conditionSummary(step.condition)}
                  tone={step.condition ? 'active' : 'default'}
                >
                  <WorkflowConditionEditor
                    value={step.condition ?? {}}
                    onChange={(next) => update(index, { condition: next })}
                    directory={directory}
                  />
                </StageDrawer>
              </div>
            ) : (
              <>
                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <AssigneePicker
                    directory={directory}
                    value={step.assignments}
                    onChange={(next) => update(index, { assignments: next })}
                    multiple
                    label="Approvers at this stage"
                  />

                  <div className="space-y-2">
                    {parallel && (
                      <div>
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          This stage runs in parallel — how is it satisfied?
                        </Label>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Select
                            value={mode}
                            onValueChange={(next) => update(index, { groupMode: next as EApprovalGroupMode })}
                          >
                            <SelectTrigger className="h-8 w-[190px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="All">All must approve</SelectItem>
                              <SelectItem value="Any">Any one can approve</SelectItem>
                              <SelectItem value="NofM">A set number must approve</SelectItem>
                            </SelectContent>
                          </Select>
                          {mode === 'NofM' && (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={1}
                                max={step.assignments.length}
                                value={step.groupRequiredCount ?? step.assignments.length}
                                onChange={(event) =>
                                  update(index, { groupRequiredCount: Number(event.target.value) || 1 })
                                }
                                className="h-8 w-14 text-xs"
                              />
                              <span className="text-[11px] text-muted-foreground">of {step.assignments.length}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div>
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Instructions shown to the approver
                      </Label>
                      <Input
                        value={step.description ?? ''}
                        onChange={(event) => update(index, { description: event.target.value })}
                        placeholder="Check the quantities against the approved BOQ."
                        className="mt-1 h-8 text-xs"
                      />
                    </div>

                    <details>
                      <summary className="cursor-pointer text-[11px] font-medium text-sky-700 hover:underline">
                        What this approver may do ({capabilityLabels.filter((capability) =>
                          (step.capabilities?.[capability.key] ?? DEFAULT_E_APPROVAL_CAPABILITIES[capability.key]) === true,
                        ).length}{' '}
                        of {capabilityLabels.length})
                      </summary>
                      <div className="mt-1 grid gap-1 sm:grid-cols-2">
                        {capabilityLabels.map((capability) => {
                          const enabled =
                            step.capabilities?.[capability.key] ?? DEFAULT_E_APPROVAL_CAPABILITIES[capability.key];
                          return (
                            <label key={capability.key} className="flex items-start gap-1.5" title={capability.hint}>
                              <Checkbox
                                checked={enabled === true}
                                onCheckedChange={(checked) =>
                                  update(index, {
                                    capabilities: { ...(step.capabilities ?? {}), [capability.key]: checked === true },
                                  })
                                }
                                className="mt-0.5"
                              />
                              <span className="text-[11px] leading-tight">{capability.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                </div>

                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  <StageDrawer
                    icon={Filter}
                    label="When it runs"
                    summary={conditionSummary(step.condition)}
                    tone={step.condition ? 'active' : 'default'}
                  >
                    <WorkflowConditionEditor
                      value={step.condition ?? {}}
                      onChange={(next) => update(index, { condition: next })}
                      directory={directory}
                    />
                  </StageDrawer>

                  <StageDrawer
                    icon={SplitSquareVertical}
                    label="Different people here"
                    summary={
                      overrides.length
                        ? `${overrides.length} variation${overrides.length === 1 ? '' : 's'}`
                        : 'Same approvers everywhere'
                    }
                    tone={overrides.length ? 'active' : 'default'}
                  >
                    <StageOverridesEditor
                      step={step}
                      onChange={(next) => update(index, { overrides: next })}
                      directory={directory}
                      defaultSlaHours={defaultSlaHours}
                    />
                  </StageDrawer>
                </div>

                {step.assignments.length === 0 && !overrides.some((entry) => entry.assignments?.length) && (
                  <p className="mt-1.5 text-[11px] text-amber-700">
                    No approver set — this stage will reach nobody and a submission against it is refused.
                  </p>
                )}

                <StageOutcome {...outcome} isSubWorkflow={false} />
              </>
            )}
          </div>
        );
      })}

      {steps.length > 2 && addButtons}

      {steps.length === 0 && (
        <Badge variant="outline" className="ml-2 text-[10px] text-amber-700">
          A workflow with no stages approves nothing
        </Badge>
      )}
    </div>
  );
}
