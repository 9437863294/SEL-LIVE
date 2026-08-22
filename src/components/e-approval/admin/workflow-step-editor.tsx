'use client';

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DEFAULT_E_APPROVAL_CAPABILITIES,
  describeEApprovalAssignment,
  E_APPROVAL_STEP_TYPES,
  type EApprovalGroupMode,
  type EApprovalStepCapabilities,
  type EApprovalStepType,
  type EApprovalTemplateStep,
} from '@/lib/e-approval';
import { AssigneePicker } from '../assignee-picker';
import type { EApprovalDirectory } from '../hooks';

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

/**
 * The step configuration of spec section 27, used by both the template editor and the matrix rules.
 *
 * A step with more than one assignee becomes a parallel group, and the group mode decides how it is
 * satisfied (spec section 28) — which is why the mode selector only appears once a second assignee
 * has been added: "all must approve" is meaningless for one person, and offering it invites the
 * misconfiguration where a single-approver step is set to "2 of 3" and can never be satisfied.
 */
export function WorkflowStepEditor({
  steps,
  onChange,
  directory,
  defaultSlaHours = 24,
}: {
  steps: EApprovalTemplateStep[];
  onChange: (next: EApprovalTemplateStep[]) => void;
  directory: EApprovalDirectory;
  defaultSlaHours?: number;
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

  const add = () =>
    onChange([
      ...steps,
      {
        id: `step-${Date.now()}`,
        name: `Stage ${steps.length + 1}`,
        type: 'APPROVAL',
        assignments: [],
        slaHours: defaultSlaHours,
        mandatory: true,
      },
    ]);

  return (
    <div className="space-y-2">
      {steps.map((step, index) => {
        const parallel = step.assignments.length > 1;
        const mode: EApprovalGroupMode = step.groupMode ?? (parallel ? 'All' : 'Single');
        return (
          <div key={step.id} className="rounded-lg border bg-background p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-700">
                {index + 1}
              </span>
              <Input
                value={step.name}
                onChange={(event) => update(index, { name: event.target.value })}
                placeholder="Stage name"
                className="h-8 max-w-[220px] text-sm"
              />
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

            {step.assignments.length === 0 && (
              <p className="mt-1.5 text-[11px] text-amber-700">
                No approver set — this stage will be skipped at build time and the chain will be short one signature.
              </p>
            )}
            {step.assignments.length > 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {step.assignments.map(describeEApprovalAssignment).join(mode === 'Any' ? ' or ' : ' & ')}
              </p>
            )}
          </div>
        );
      })}

      <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add stage
      </Button>

      {steps.length === 0 && (
        <Badge variant="outline" className="ml-2 text-[10px] text-amber-700">
          A workflow with no stages approves nothing
        </Badge>
      )}
    </div>
  );
}
