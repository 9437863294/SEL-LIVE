'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Copy, Layers, Pencil, Sparkles, Trash2, Workflow } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  describeEApprovalAssignment,
  E_APPROVAL_COLLECTIONS,
  type EApprovalTemplateRecord,
  type EApprovalTemplateStep,
  type EApprovalType,
} from '@/lib/e-approval';
import {
  deleteEApprovalConfigRecord,
  listEApprovalTemplates,
  listEApprovalTypes,
  saveEApprovalTemplate,
  seedEApprovalTemplates,
  type EApprovalServiceActor,
} from '@/lib/e-approval-service';
import { Field } from '../page-header';
import type { EApprovalDirectory } from '../hooks';
import { WorkflowStepEditor } from './workflow-step-editor';
import {
  matchesSearch,
  SettingsAddButton,
  SettingsEmpty,
  SettingsFormDialog,
  SettingsList,
  SettingsRow,
  SettingsToolbar,
  useSettingsDraft,
} from './settings-ui';

type Draft = Partial<EApprovalTemplateRecord> & { steps: EApprovalTemplateStep[] };

/** The chain as a single readable line — the thing you actually scan a workflow list for. */
function ChainPreview({
  steps,
  templatesById,
}: {
  steps: EApprovalTemplateStep[];
  templatesById: Map<string, EApprovalTemplateRecord>;
}) {
  if (!steps.length) {
    return <span className="text-[11px] text-amber-700">No stages — this workflow would approve nothing.</span>;
  }
  return (
    <ol className="flex flex-wrap items-center gap-1">
      {steps.map((step, index) => {
        const isSubWorkflow = step.nodeType === 'SubWorkflow' || Boolean(step.subWorkflowId);
        const target = step.subWorkflowId ? templatesById.get(step.subWorkflowId) : undefined;
        const unassigned = !isSubWorkflow && !step.assignments?.length && !step.overrides?.some((o) => o.assignments?.length);
        return (
          <li key={step.id ?? index} className="flex items-center gap-1">
            {index > 0 && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden />}
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[11px]',
                isSubWorkflow
                  ? 'border border-violet-300 bg-violet-100 text-violet-900'
                  : unassigned
                    ? 'border border-dashed border-amber-300 bg-amber-50 text-amber-800'
                    : 'bg-muted',
              )}
            >
              {isSubWorkflow && <Layers className="mr-0.5 inline h-3 w-3 align-[-2px]" />}
              {step.name}
              {isSubWorkflow ? (
                <span className="text-muted-foreground">
                  {' · '}
                  {target ? `${(target.steps ?? []).length} stages from ${target.name}` : 'not linked'}
                </span>
              ) : step.assignments?.length ? (
                <span className="text-muted-foreground">
                  {' · '}
                  {step.assignments.map(describeEApprovalAssignment).join(step.groupMode === 'Any' ? ' or ' : ' & ')}
                </span>
              ) : (
                ' · unassigned'
              )}
              {(step.overrides?.length ?? 0) > 0 && (
                <span className="text-sky-700">{` · +${step.overrides?.length} variation${step.overrides?.length === 1 ? '' : 's'}`}</span>
              )}
              {step.condition && <span className="text-slate-500"> · conditional</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Workflow templates, sub-workflows and the stage builder. */
export function WorkflowTemplatesPanel({
  serviceActor,
  directory,
  canEdit,
  defaultSlaHours,
}: {
  serviceActor: EApprovalServiceActor | null;
  directory: EApprovalDirectory;
  canEdit: boolean;
  defaultSlaHours: number;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<EApprovalTemplateRecord[]>([]);
  const [types, setTypes] = useState<EApprovalType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'workflows' | 'subWorkflows'>('workflows');
  const [seeding, setSeeding] = useState(false);
  const form = useSettingsDraft<Draft>();

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [templateRows, typeRows] = await Promise.all([
        listEApprovalTemplates(serviceActor?.organizationId),
        listEApprovalTypes(serviceActor?.organizationId),
      ]);
      setRows(templateRows.sort((a, b) => a.name.localeCompare(b.name)));
      setTypes(typeRows);
    } finally {
      setIsLoading(false);
    }
  }, [serviceActor?.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const templatesById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  /** Which workflows call which — so deleting one can say what it would break. */
  const callersOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of rows) {
      for (const step of row.steps ?? []) {
        if (!step.subWorkflowId) continue;
        map.set(step.subWorkflowId, [...(map.get(step.subWorkflowId) ?? []), row.name]);
      }
    }
    return map;
  }, [rows]);

  const save = async () => {
    if (!serviceActor || !form.draft?.name?.trim()) {
      toast({ variant: 'destructive', title: 'A name is required.' });
      return;
    }
    form.setBusy(true);
    try {
      await saveEApprovalTemplate({ ...form.draft, name: form.draft.name.trim() }, serviceActor);
      toast({ title: 'Workflow saved' });
      form.close();
      void load();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Not saved',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      form.setBusy(false);
    }
  };

  const remove = async (row: EApprovalTemplateRecord) => {
    if (!serviceActor) return;
    const callers = callersOf.get(row.id) ?? [];
    if (callers.length) {
      toast({
        variant: 'destructive',
        title: 'Still in use',
        description: `${row.name} is called by ${callers.join(', ')}. Remove those sub-workflow nodes first.`,
      });
      return;
    }
    await deleteEApprovalConfigRecord(E_APPROVAL_COLLECTIONS.templates, row.id, serviceActor);
    void load();
  };

  const seed = async () => {
    if (!serviceActor) return;
    setSeeding(true);
    try {
      const written = await seedEApprovalTemplates(serviceActor);
      toast({
        title: written ? `${written} sample workflow${written > 1 ? 's' : ''} added` : 'Samples already exist',
        description: written
          ? 'They show the shapes worth copying — a shared sub-workflow, and stages bound to the request’s own project and department.'
          : undefined,
      });
      void load();
    } finally {
      setSeeding(false);
    }
  };

  const inTab = rows.filter((row) => (tab === 'subWorkflows' ? row.isSubWorkflow === true : row.isSubWorkflow !== true));
  const visible = inTab.filter((row) => matchesSearch(search, row.name, row.description));
  const add = (isSubWorkflow: boolean) =>
    form.setDraft({ name: '', steps: [], active: true, isSubWorkflow });
  const duplicate = (row: EApprovalTemplateRecord) =>
    form.setDraft({ ...row, id: undefined, name: `${row.name} (copy)`, steps: row.steps ?? [] });

  return (
    <div className="space-y-3">
      {/* Two tabs rather than one list, because the two are used at different moments: you write a
          sub-workflow once and then forget it, and scroll the workflow list every week. */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
        {(
          [
            ['workflows', 'Workflows', rows.filter((row) => row.isSubWorkflow !== true).length],
            ['subWorkflows', 'Sub-workflows', rows.filter((row) => row.isSubWorkflow === true).length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label} <span className="text-muted-foreground">({count})</span>
          </button>
        ))}
      </div>

      {/* Both tabs get a standing explainer naming the exact click path. What a sub-workflow *is* was
          only ever explained on the tab you had to already know about to reach. */}
      {tab === 'subWorkflows' ? (
        <p className="rounded-md border border-violet-200 bg-violet-50/60 px-2.5 py-2 text-[11px] leading-relaxed text-violet-900">
          A sub-workflow is a run of stages written once and called from other workflows — &ldquo;Finance
          Clearance&rdquo;, &ldquo;Safety Sign-off&rdquo;. Build one here with <strong>New sub-workflow</strong>, then
          open any workflow on the Workflows tab and use <strong>Add sub-workflow</strong> to drop it into the chain.
          Edit it once and every chain that calls it changes with it. Sub-workflows are never offered as a route of
          their own on the request form.
        </p>
      ) : (
        <p className="rounded-md border bg-muted/30 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
          Open a workflow to edit its chain. Inside, <strong className="text-violet-700">Add sub-workflow</strong> runs
          another whole workflow at that point, <strong className="text-foreground">Different people here</strong> on
          any stage gives that stage other approvers on a chosen project or department, and{' '}
          <strong className="text-foreground">When it runs</strong> keeps a stage out unless it applies.
        </p>
      )}

      <SettingsToolbar
        count={inTab.length}
        noun={tab === 'subWorkflows' ? 'sub-workflow' : 'workflow'}
        search={search}
        onSearch={setSearch}
        action={
          canEdit && (
            <span className="flex gap-1.5">
              {tab === 'workflows' && (
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void seed()} disabled={seeding}>
                  <Sparkles className="h-3.5 w-3.5" /> Samples
                </Button>
              )}
              <SettingsAddButton
                label={tab === 'subWorkflows' ? 'New sub-workflow' : 'New workflow'}
                onClick={() => add(tab === 'subWorkflows')}
              />
            </span>
          )
        }
      />

      <SettingsList
        isLoading={isLoading}
        isEmpty={!visible.length}
        empty={
          <SettingsEmpty
            icon={tab === 'subWorkflows' ? Layers : Workflow}
            title={
              inTab.length
                ? 'Nothing matches that search'
                : tab === 'subWorkflows'
                  ? 'No sub-workflows yet'
                  : 'No workflows configured'
            }
            description={
              inTab.length
                ? undefined
                : tab === 'subWorkflows'
                  ? 'Pull the stages that repeat across several chains — finance clearance, safety sign-off — into one block here, and call it from each.'
                  : 'A workflow is a named chain of stages. Add the samples to see the shape of one, then assign your own approvers.'
            }
            action={
              canEdit && !inTab.length && tab === 'workflows' ? (
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void seed()}>
                  <Sparkles className="h-3.5 w-3.5" /> Add sample workflows
                </Button>
              ) : undefined
            }
          />
        }
      >
        {visible.map((row) => {
          const steps = row.steps ?? [];
          const stages = steps.filter((step) => step.nodeType !== 'SubWorkflow' && !step.subWorkflowId);
          const calls = steps.filter((step) => step.nodeType === 'SubWorkflow' || step.subWorkflowId);
          const unassigned = stages.filter(
            (step) => !step.assignments?.length && !step.overrides?.some((entry) => entry.assignments?.length),
          ).length;
          const variations = stages.reduce((total, step) => total + (step.overrides?.length ?? 0), 0);
          const callers = callersOf.get(row.id) ?? [];

          return (
            <SettingsRow
              key={row.id}
              muted={row.active === false}
              title={row.name}
              badges={
                <>
                  <Badge variant="outline" className="text-[10px]">
                    {stages.length} stage{stages.length === 1 ? '' : 's'}
                  </Badge>
                  {calls.length > 0 && (
                    <Badge className="bg-violet-600 text-[10px] hover:bg-violet-600">
                      {calls.length} sub-workflow{calls.length === 1 ? '' : 's'}
                    </Badge>
                  )}
                  {variations > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {variations} project variation{variations === 1 ? '' : 's'}
                    </Badge>
                  )}
                  {row.approvalTypeId && (
                    <Badge variant="secondary" className="text-[10px]">
                      {types.find((type) => type.id === row.approvalTypeId)?.name ?? 'type'}
                    </Badge>
                  )}
                  {row.projectId && (
                    <Badge variant="secondary" className="text-[10px]">
                      {directory.projectById.get(row.projectId)?.projectName ?? 'project'}
                    </Badge>
                  )}
                  {unassigned > 0 && (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-800">
                      {unassigned} unassigned
                    </Badge>
                  )}
                  {row.active === false && (
                    <Badge variant="outline" className="text-[10px]">
                      Inactive
                    </Badge>
                  )}
                </>
              }
              subtitle={
                callers.length ? (
                  <>
                    {row.description ? `${row.description} · ` : ''}
                    Called by {callers.join(', ')}
                  </>
                ) : (
                  row.description || undefined
                )
              }
              detail={<ChainPreview steps={steps} templatesById={templatesById} />}
              actions={
                canEdit && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => duplicate(row)}
                      aria-label={`Duplicate ${row.name}`}
                      title="Duplicate"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => form.setDraft({ ...row, steps })}
                      aria-label={`Edit ${row.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive"
                      onClick={() => void remove(row)}
                      aria-label={`Delete ${row.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )
              }
            />
          );
        })}
      </SettingsList>

      {/* Wide, because the stage builder needs the room — a chain squeezed into 512px is unreadable. */}
      <SettingsFormDialog
        open={form.open}
        onOpenChange={(next) => !next && form.close()}
        title={
          form.draft?.id
            ? `Edit ${form.draft.isSubWorkflow ? 'sub-workflow' : 'workflow'}`
            : `New ${form.draft?.isSubWorkflow ? 'sub-workflow' : 'workflow'}`
        }
        description="Stages run in order. A stage with more than one approver runs them in parallel; a sub-workflow node runs another workflow in place."
        wide
        busy={form.busy}
        canSave={Boolean(form.draft?.name?.trim())}
        dirty={form.isDirty}
        onSave={() => void save()}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" required className="sm:col-span-3">
            <Input
              value={form.draft?.name ?? ''}
              onChange={(event) => form.patch({ name: event.target.value })}
              placeholder={form.draft?.isSubWorkflow ? 'Finance Clearance' : 'Purchase Approval'}
              className="h-9"
            />
          </Field>
          <Field label="Approval type" hint="Restricts where this workflow is offered.">
            <Select
              value={form.draft?.approvalTypeId ?? 'ANY'}
              onValueChange={(next) => form.patch({ approvalTypeId: next === 'ANY' ? undefined : next })}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Any type</SelectItem>
                {types.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Department">
            <Select
              value={form.draft?.departmentId ?? 'ANY'}
              onValueChange={(next) => form.patch({ departmentId: next === 'ANY' ? undefined : next })}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Any department</SelectItem>
                {directory.departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Project"
            hint="Leave as Any and vary the approvers per stage instead — one chain, not one per site."
          >
            <Select
              value={form.draft?.projectId ?? 'ANY'}
              onValueChange={(next) => form.patch({ projectId: next === 'ANY' ? undefined : next })}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Any project</SelectItem>
                {directory.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.projectName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Description" className="sm:col-span-3">
            <Input
              value={form.draft?.description ?? ''}
              onChange={(event) => form.patch({ description: event.target.value })}
              className="h-9"
            />
          </Field>
        </div>

        <div className="border-t pt-3">
          <WorkflowStepEditor
            steps={form.draft?.steps ?? []}
            onChange={(steps) => form.patch({ steps })}
            directory={directory}
            defaultSlaHours={defaultSlaHours}
            subWorkflows={rows}
            currentTemplateId={form.draft?.id}
          />
        </div>

        <div className="space-y-2 border-t pt-3">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={form.draft?.active !== false}
              onCheckedChange={(checked) => form.patch({ active: checked === true })}
            />
            <span className="text-xs font-medium">Active — offered on new requests and to the approval matrix</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox
              checked={form.draft?.isSubWorkflow === true}
              onCheckedChange={(checked) => form.patch({ isSubWorkflow: checked === true })}
              className="mt-0.5"
            />
            <span className="text-xs">
              <span className="font-medium">A building block, not a route of its own</span>
              <span className="block text-[11px] text-muted-foreground">
                Called from other workflows and hidden from the request form and the approval matrix.
              </span>
            </span>
          </label>
        </div>
      </SettingsFormDialog>
    </div>
  );
}
