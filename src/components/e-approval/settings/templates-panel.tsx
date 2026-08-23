'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Copy, Pencil, Sparkles, Trash2, Workflow } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
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
function ChainPreview({ steps }: { steps: EApprovalTemplateStep[] }) {
  if (!steps.length) {
    return <span className="text-[11px] text-amber-700">No stages — this workflow would approve nothing.</span>;
  }
  return (
    <ol className="flex flex-wrap items-center gap-1">
      {steps.map((step, index) => (
        <li key={step.id ?? index} className="flex items-center gap-1">
          {index > 0 && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden />}
          <span
            className={
              step.assignments?.length
                ? 'rounded bg-muted px-1.5 py-0.5 text-[11px]'
                : 'rounded border border-dashed border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800'
            }
          >
            {step.name}
            {step.assignments?.length ? (
              <span className="text-muted-foreground">
                {' · '}
                {step.assignments.map(describeEApprovalAssignment).join(step.groupMode === 'Any' ? ' or ' : ' & ')}
              </span>
            ) : (
              ' · unassigned'
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Workflow templates and the stage builder. */
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

  const seed = async () => {
    if (!serviceActor) return;
    setSeeding(true);
    try {
      const written = await seedEApprovalTemplates(serviceActor);
      toast({
        title: written ? `${written} sample workflow${written > 1 ? 's' : ''} added` : 'Samples already exist',
        description: written ? 'Their stages are role-based — assign real people before using them.' : undefined,
      });
      void load();
    } finally {
      setSeeding(false);
    }
  };

  const visible = rows.filter((row) => matchesSearch(search, row.name, row.description));
  const add = () => form.setDraft({ name: '', steps: [], active: true });
  const duplicate = (row: EApprovalTemplateRecord) =>
    form.setDraft({ ...row, id: undefined, name: `${row.name} (copy)`, steps: row.steps ?? [] });

  return (
    <div className="space-y-3">
      <SettingsToolbar
        count={rows.length}
        noun="workflow"
        search={search}
        onSearch={setSearch}
        action={
          canEdit && (
            <span className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void seed()} disabled={seeding}>
                <Sparkles className="h-3.5 w-3.5" /> Samples
              </Button>
              <SettingsAddButton label="New workflow" onClick={add} />
            </span>
          )
        }
      />

      <SettingsList
        isLoading={isLoading}
        isEmpty={!visible.length}
        empty={
          <SettingsEmpty
            icon={Workflow}
            title={rows.length ? 'Nothing matches that search' : 'No workflows configured'}
            description={
              rows.length
                ? undefined
                : 'A workflow is a named chain of stages. Add the samples to see the shape of one, then assign your own approvers.'
            }
            action={
              canEdit && !rows.length ? (
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
          const unassigned = steps.filter((step) => !step.assignments?.length).length;
          return (
            <SettingsRow
              key={row.id}
              muted={row.active === false}
              title={row.name}
              badges={
                <>
                  <Badge variant="outline" className="text-[10px]">
                    {steps.length} stage{steps.length === 1 ? '' : 's'}
                  </Badge>
                  {row.approvalTypeId && (
                    <Badge variant="secondary" className="text-[10px]">
                      {types.find((type) => type.id === row.approvalTypeId)?.name ?? 'type'}
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
              subtitle={row.description || undefined}
              detail={<ChainPreview steps={steps} />}
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
                      onClick={async () => {
                        if (!serviceActor) return;
                        await deleteEApprovalConfigRecord(E_APPROVAL_COLLECTIONS.templates, row.id, serviceActor);
                        void load();
                      }}
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
        title={form.draft?.id ? 'Edit workflow' : 'New workflow'}
        description="Stages run in order. A stage with more than one approver runs them in parallel."
        wide
        busy={form.busy}
        canSave={Boolean(form.draft?.name?.trim())}
        onSave={() => void save()}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" required className="sm:col-span-3">
            <Input
              value={form.draft?.name ?? ''}
              onChange={(event) => form.patch({ name: event.target.value })}
              placeholder="Purchase Approval"
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
          <Field label="Description">
            <Input
              value={form.draft?.description ?? ''}
              onChange={(event) => form.patch({ description: event.target.value })}
              className="h-9"
            />
          </Field>
        </div>

        <div className="border-t pt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stages</p>
          <WorkflowStepEditor
            steps={form.draft?.steps ?? []}
            onChange={(steps) => form.patch({ steps })}
            directory={directory}
            defaultSlaHours={defaultSlaHours}
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 border-t pt-3">
          <Checkbox
            checked={form.draft?.active !== false}
            onCheckedChange={(checked) => form.patch({ active: checked === true })}
          />
          <span className="text-xs font-medium">Active — offered on new requests and to the approval matrix</span>
        </label>
      </SettingsFormDialog>
    </div>
  );
}
