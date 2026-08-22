'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Sparkles, Trash2, Workflow } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
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
import { EApprovalEmptyState } from '../shared';
import type { EApprovalDirectory } from '../hooks';
import { WorkflowStepEditor } from './workflow-step-editor';

type Draft = Partial<EApprovalTemplateRecord> & { steps: EApprovalTemplateStep[] };

/** Workflow templates and the visual builder of spec sections 12 and 27. */
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

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
    if (!serviceActor || !draft?.name?.trim()) {
      toast({ variant: 'destructive', title: 'A name is required.' });
      return;
    }
    setBusy(true);
    try {
      await saveEApprovalTemplate({ ...draft, name: draft.name.trim() }, serviceActor);
      toast({ title: 'Workflow saved' });
      setDraft(null);
      void load();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Not saved',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    if (!serviceActor) return;
    setBusy(true);
    try {
      const written = await seedEApprovalTemplates(serviceActor);
      toast({
        title: written ? `${written} sample workflow${written > 1 ? 's' : ''} added` : 'Sample workflows already exist',
        description: written ? 'Assign real people to the stages before using them.' : undefined,
      });
      void load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 px-3 py-2.5 sm:px-4">
        <div>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Workflow className="h-4 w-4" /> Workflow Templates
          </CardTitle>
          <CardDescription className="text-xs">
            A named chain of stages. Templates are what the approval matrix points at, and what an employee can pick
            directly on the form.
          </CardDescription>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void seed()} disabled={busy}>
              <Sparkles className="h-3.5 w-3.5" /> Add samples
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setDraft({ name: '', steps: [], active: true })}
            >
              <Plus className="h-3.5 w-3.5" /> New workflow
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3 sm:px-4">
        {draft && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-2.5">
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input
                  value={draft.name ?? ''}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Purchase Approval"
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Approval type</Label>
                <Select
                  value={draft.approvalTypeId ?? 'ANY'}
                  onValueChange={(next) => setDraft({ ...draft, approvalTypeId: next === 'ANY' ? undefined : next })}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
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
              </div>
              <div>
                <Label className="text-xs">Department</Label>
                <Select
                  value={draft.departmentId ?? 'ANY'}
                  onValueChange={(next) => setDraft({ ...draft, departmentId: next === 'ANY' ? undefined : next })}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
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
              </div>
              <div className="sm:col-span-3">
                <Label className="text-xs">Description</Label>
                <Input
                  value={draft.description ?? ''}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  className="mt-1 h-8 text-sm"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stages</Label>
              <div className="mt-1">
                <WorkflowStepEditor
                  steps={draft.steps}
                  onChange={(steps) => setDraft({ ...draft, steps })}
                  directory={directory}
                  defaultSlaHours={defaultSlaHours}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={draft.active !== false}
                  onCheckedChange={(checked) => setDraft({ ...draft, active: checked === true })}
                />
                Active
              </label>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="h-8" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button size="sm" className="h-8 gap-1.5" onClick={() => void save()} disabled={busy}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                </Button>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <EApprovalEmptyState
            icon={Workflow}
            title="No workflows configured"
            description="Add the samples to see the shape of one, then assign your own approvers."
          />
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="rounded-lg border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{row.name}</p>
                  {row.active === false && (
                    <Badge variant="outline" className="text-[10px]">
                      Inactive
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {(row.steps ?? []).length} stages
                  </Badge>
                  {row.approvalTypeId && (
                    <Badge variant="secondary" className="text-[10px]">
                      {types.find((type) => type.id === row.approvalTypeId)?.name ?? 'type'}
                    </Badge>
                  )}
                  {canEdit && (
                    <div className="ml-auto flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setDraft({ ...row, steps: row.steps ?? [] })}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={async () => {
                          if (!serviceActor) return;
                          await deleteEApprovalConfigRecord(E_APPROVAL_COLLECTIONS.templates, row.id, serviceActor);
                          void load();
                        }}
                        aria-label={`Delete ${row.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                <ol className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  {(row.steps ?? []).map((step, index) => (
                    <li key={step.id ?? index} className="flex items-center gap-1">
                      {index > 0 && <span aria-hidden>→</span>}
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        {step.name}
                        {step.assignments?.length
                          ? ` (${step.assignments.map(describeEApprovalAssignment).join(', ')})`
                          : ' (unassigned)'}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
