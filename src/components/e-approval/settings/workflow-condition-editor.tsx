'use client';

import { Building2, HardHat, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  E_APPROVAL_PRIORITIES,
  type EApprovalPriority,
  type EApprovalStepCondition,
} from '@/lib/e-approval';
import type { EApprovalDirectory } from '../hooks';

/**
 * The scope picker shared by stage conditions ("only apply this stage when…") and stage overrides
 * ("…but on these projects, somebody else signs").
 *
 * One control for both, because they are the same question asked for two purposes, and an
 * administrator who has learned "empty means always" once should not have to learn it twice. Every
 * list is multi-select and additive: choosing two projects means *either* project, and choosing a
 * project and a department means that project **and** that department, which is how the engine reads
 * it (`matchesEApprovalCondition`).
 */
export function WorkflowConditionEditor({
  value,
  onChange,
  directory,
  compact,
}: {
  value: EApprovalStepCondition;
  onChange: (next: EApprovalStepCondition) => void;
  directory: EApprovalDirectory;
  /** Hides priority and amount, for the places where only place matters. */
  compact?: boolean;
}) {
  const toggle = (key: 'projectIds' | 'departmentIds' | 'approvalTypeIds', id: string) => {
    const current = value[key] ?? [];
    onChange({
      ...value,
      [key]: current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    });
  };

  const togglePriority = (priority: EApprovalPriority) => {
    const current = value.priorities ?? [];
    onChange({
      ...value,
      priorities: current.includes(priority)
        ? current.filter((entry) => entry !== priority)
        : [...current, priority],
    });
  };

  const chips = (
    key: 'projectIds' | 'departmentIds' | 'approvalTypeIds',
    rows: Array<{ id: string; label: string }>,
    icon?: React.ReactNode,
  ) => (
    <div className="flex flex-wrap gap-1">
      {rows.map((row) => {
        const chosen = (value[key] ?? []).includes(row.id);
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => toggle(key, row.id)}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
              chosen
                ? 'border-sky-400 bg-sky-100 text-sky-900'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            {icon}
            <span className="max-w-[160px] truncate">{row.label}</span>
            {chosen && <X className="h-3 w-3" />}
          </button>
        );
      })}
      {!rows.length && <span className="text-[11px] text-muted-foreground">None configured</span>}
    </div>
  );

  const pinned =
    (value.projectIds?.length ?? 0) +
    (value.departmentIds?.length ?? 0) +
    (value.approvalTypeIds?.length ?? 0) +
    (value.priorities?.length ?? 0) +
    (value.minAmount != null || value.maxAmount != null ? 1 : 0);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Badge variant={pinned ? 'secondary' : 'outline'} className="text-[10px]">
          {pinned ? `${pinned} condition${pinned === 1 ? '' : 's'}` : 'Applies always'}
        </Badge>
        {pinned > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[11px]"
            onClick={() => onChange({})}
          >
            Clear
          </Button>
        )}
      </div>

      <div>
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Projects</Label>
        <div className="mt-1">
          {chips(
            'projectIds',
            directory.projects.map((project) => ({ id: project.id, label: project.projectName })),
            <HardHat className="h-3 w-3" />,
          )}
        </div>
      </div>

      <div>
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Departments</Label>
        <div className="mt-1">
          {chips(
            'departmentIds',
            directory.departments.map((department) => ({ id: department.id, label: department.name })),
            <Building2 className="h-3 w-3" />,
          )}
        </div>
      </div>

      {!compact && (
        <>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Approval types</Label>
            <div className="mt-1">
              {chips(
                'approvalTypeIds',
                directory.types.map((type) => ({ id: type.id, label: type.name })),
              )}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount from (₹)</Label>
              <Input
                type="number"
                min={0}
                value={value.minAmount ?? ''}
                onChange={(event) =>
                  onChange({ ...value, minAmount: event.target.value === '' ? null : Number(event.target.value) })
                }
                placeholder="Any"
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount to (₹)</Label>
              <Input
                type="number"
                min={0}
                value={value.maxAmount ?? ''}
                onChange={(event) =>
                  onChange({ ...value, maxAmount: event.target.value === '' ? null : Number(event.target.value) })
                }
                placeholder="Any"
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Priority</Label>
              <Select
                value={value.priorities?.length === 1 ? value.priorities[0] : 'ANY'}
                onValueChange={(next) =>
                  onChange({ ...value, priorities: next === 'ANY' ? [] : [next as EApprovalPriority] })
                }
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANY">Any priority</SelectItem>
                  {E_APPROVAL_PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {priority}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {(value.priorities?.length ?? 0) > 1 && (
            <div className="flex flex-wrap gap-1">
              {E_APPROVAL_PRIORITIES.map((priority) => (
                <button
                  key={priority}
                  type="button"
                  onClick={() => togglePriority(priority)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px]',
                    (value.priorities ?? []).includes(priority)
                      ? 'border-sky-400 bg-sky-100 text-sky-900'
                      : 'border-border bg-background text-muted-foreground',
                  )}
                >
                  {priority}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
