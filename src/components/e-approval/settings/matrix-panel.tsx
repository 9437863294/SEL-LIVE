'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, FlaskConical, GitBranch, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  E_APPROVAL_COLLECTIONS,
  resolveEApprovalRouting,
  type EApprovalRuleRecord,
  type EApprovalTemplateRecord,
  type EApprovalType,
} from '@/lib/e-approval';
import {
  deleteEApprovalConfigRecord,
  listEApprovalRules,
  listEApprovalTemplates,
  listEApprovalTypes,
  saveEApprovalRule,
  type EApprovalServiceActor,
} from '@/lib/e-approval-service';
import { Field } from '../page-header';
import { formatEApprovalAmount, type EApprovalDirectory } from '../hooks';
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

type Draft = Partial<EApprovalRuleRecord>;

const band = (row: EApprovalRuleRecord) => {
  const from = row.minAmount == null ? null : formatEApprovalAmount(row.minAmount);
  const to = row.maxAmount == null ? null : formatEApprovalAmount(row.maxAmount);
  if (from == null && to == null) return 'Any amount';
  if (to == null) return `${from} and above`;
  if (from == null) return `Up to ${to}`;
  return `${from} – ${to}`;
};

/**
 * The approval matrix (spec section 13).
 *
 * The tester is not a nicety. An approval matrix is the one piece of configuration whose mistakes are
 * invisible until a real note-sheet takes the wrong route, and by then it has been seen by the wrong
 * people. Entering a type and an amount and watching which rule wins turns "I think this is right"
 * into "this is what will happen".
 */
export function ApprovalMatrixPanel({
  serviceActor,
  directory,
  canEdit,
}: {
  serviceActor: EApprovalServiceActor | null;
  directory: EApprovalDirectory;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<EApprovalRuleRecord[]>([]);
  const [templates, setTemplates] = useState<EApprovalTemplateRecord[]>([]);
  const [types, setTypes] = useState<EApprovalType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const form = useSettingsDraft<Draft>();

  const [testType, setTestType] = useState('ANY');
  const [testDepartment, setTestDepartment] = useState('ANY');
  const [testAmount, setTestAmount] = useState('250000');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [ruleRows, templateRows, typeRows] = await Promise.all([
        listEApprovalRules(serviceActor?.organizationId),
        listEApprovalTemplates(serviceActor?.organizationId),
        listEApprovalTypes(serviceActor?.organizationId),
      ]);
      setRows(
        ruleRows.sort(
          (a, b) =>
            String(a.approvalTypeId ?? '').localeCompare(String(b.approvalTypeId ?? '')) ||
            (a.minAmount ?? 0) - (b.minAmount ?? 0),
        ),
      );
      setTemplates(templateRows);
      setTypes(typeRows);
    } finally {
      setIsLoading(false);
    }
  }, [serviceActor?.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const winner = useMemo(
    () =>
      resolveEApprovalRouting(rows, {
        approvalTypeId: testType === 'ANY' ? undefined : testType,
        departmentId: testDepartment === 'ANY' ? undefined : testDepartment,
        amount: Number(testAmount) || 0,
      }),
    [rows, testType, testDepartment, testAmount],
  );

  const templateName = (templateId?: string) => templates.find((row) => row.id === templateId)?.name ?? '—';

  const save = async () => {
    if (!serviceActor || !form.draft) return;
    if (!form.draft.templateId) {
      toast({ variant: 'destructive', title: 'Choose the workflow this rule routes to.' });
      return;
    }
    if (form.draft.minAmount != null && form.draft.maxAmount != null && form.draft.maxAmount < form.draft.minAmount) {
      toast({ variant: 'destructive', title: 'The upper bound cannot be below the lower bound.' });
      return;
    }
    form.setBusy(true);
    try {
      await saveEApprovalRule(form.draft, serviceActor);
      toast({ title: 'Rule saved' });
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

  const visible = rows.filter((row) =>
    matchesSearch(search, row.name, types.find((type) => type.id === row.approvalTypeId)?.name, templateName(row.templateId)),
  );
  const add = () => form.setDraft({ active: true, minAmount: 0 });

  return (
    <div className="space-y-3">
      <SettingsToolbar
        count={rows.length}
        noun="rule"
        search={search}
        onSearch={setSearch}
        action={canEdit ? <SettingsAddButton label="New rule" onClick={add} /> : undefined}
      />

      <SettingsList
        isLoading={isLoading}
        isEmpty={!visible.length}
        empty={
          <SettingsEmpty
            icon={GitBranch}
            title={rows.length ? 'Nothing matches that search' : 'No matrix rules'}
            description={
              rows.length
                ? undefined
                : 'Without a rule, an employee has to name their approvers on the form every time. Add a band per amount range and point each at a workflow.'
            }
            action={canEdit && !rows.length ? <SettingsAddButton label="Add the first rule" onClick={add} /> : undefined}
          />
        }
      >
        {visible.map((row) => (
          <SettingsRow
            key={row.id}
            muted={row.active === false}
            className={winner?.id === row.id ? 'bg-emerald-50/70 hover:bg-emerald-50' : undefined}
            title={row.name || band(row)}
            badges={
              <>
                <Badge variant="outline" className="text-[10px]">
                  {band(row)}
                </Badge>
                {row.approvalTypeId && (
                  <Badge variant="secondary" className="text-[10px]">
                    {types.find((type) => type.id === row.approvalTypeId)?.name ?? 'type'}
                  </Badge>
                )}
                {row.departmentId && (
                  <Badge variant="secondary" className="text-[10px]">
                    {directory.departmentById.get(row.departmentId)?.name ?? 'department'}
                  </Badge>
                )}
                {(row.priority ?? 0) !== 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    priority {row.priority}
                  </Badge>
                )}
                {row.active === false && (
                  <Badge variant="outline" className="text-[10px]">
                    Inactive
                  </Badge>
                )}
                {winner?.id === row.id && (
                  <Badge className="bg-emerald-600 text-[10px] hover:bg-emerald-600">Matches the test</Badge>
                )}
              </>
            }
            subtitle={
              <span className="flex items-center gap-1">
                routes to <ArrowRight className="h-3 w-3" />
                <span className="font-medium text-slate-700">{templateName(row.templateId)}</span>
              </span>
            }
            actions={
              canEdit && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => form.setDraft(row)}
                    aria-label="Edit rule"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-destructive"
                    onClick={async () => {
                      if (!serviceActor) return;
                      await deleteEApprovalConfigRecord(E_APPROVAL_COLLECTIONS.rules, row.id, serviceActor);
                      void load();
                    }}
                    aria-label="Delete rule"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )
            }
          />
        ))}
      </SettingsList>

      <Card className="border-sky-200 bg-sky-50/50">
        <CardContent className="px-3 py-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <FlaskConical className="h-4 w-4 text-sky-600" /> Test the matrix
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            The matching rule is highlighted in the list above.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Field label="Type">
              <Select value={testType} onValueChange={setTestType}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANY">Unspecified</SelectItem>
                  {types.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Department">
              <Select value={testDepartment} onValueChange={setTestDepartment}>
                <SelectTrigger className="h-8 text-xs">
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
            </Field>
            <Field label="Amount">
              <Input
                type="number"
                value={testAmount}
                onChange={(event) => setTestAmount(event.target.value)}
                className="h-8 text-xs"
              />
            </Field>
          </div>
          <p className={cn('mt-2 rounded-md border px-2.5 py-2 text-xs', winner ? 'bg-white' : 'border-amber-200 bg-amber-50 text-amber-900')}>
            {winner ? (
              <>
                Routes to <span className="font-semibold">{templateName(winner.templateId)}</span>
                {winner.name ? ` via “${winner.name}”` : ''}.
              </>
            ) : (
              'No rule matches — the requester would have to name the approvers themselves.'
            )}
          </p>
        </CardContent>
      </Card>

      <SettingsFormDialog
        open={form.open}
        onOpenChange={(next) => !next && form.close()}
        title={form.draft?.id ? 'Edit rule' : 'New matrix rule'}
        description="Unset criteria match everything. The most specific rule wins; between two equally specific ones, the narrower amount band does."
        busy={form.busy}
        canSave={Boolean(form.draft?.templateId)}
        onSave={() => void save()}
      >
        <Field label="Rule name" hint="Shown in the list and in the routing preview on the create form.">
          <Input
            value={form.draft?.name ?? ''}
            onChange={(event) => form.patch({ name: event.target.value })}
            placeholder="Purchase above ₹5 lakh"
            className="h-9"
          />
        </Field>

        <Field label="Routes to workflow" required>
          <Select value={form.draft?.templateId ?? ''} onValueChange={(next) => form.patch({ templateId: next })}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select a workflow" />
            </SelectTrigger>
            <SelectContent>
              {templates
                .filter((template) => template.active !== false)
                .map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name} · {(template.steps ?? []).length} stages
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount from (₹)">
            <Input
              type="number"
              min={0}
              value={form.draft?.minAmount ?? ''}
              onChange={(event) => form.patch({ minAmount: event.target.value === '' ? null : Number(event.target.value) })}
              className="h-9"
            />
          </Field>
          <Field label="Amount to (₹)" hint="Blank means no upper limit.">
            <Input
              type="number"
              min={0}
              value={form.draft?.maxAmount ?? ''}
              onChange={(event) => form.patch({ maxAmount: event.target.value === '' ? null : Number(event.target.value) })}
              className="h-9"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Approval type">
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
          <Field label="Project">
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
          <Field label="Priority" hint="Breaks a tie between equally specific rules; higher wins.">
            <Input
              type="number"
              value={form.draft?.priority ?? 0}
              onChange={(event) => form.patch({ priority: Number(event.target.value) || 0 })}
              className="h-9"
            />
          </Field>
        </div>

        <label className="flex cursor-pointer items-center gap-2 border-t pt-3">
          <Checkbox
            checked={form.draft?.active !== false}
            onCheckedChange={(checked) => form.patch({ active: checked === true })}
          />
          <span className="text-xs font-medium">Active — an inactive rule never matches</span>
        </label>
      </SettingsFormDialog>
    </div>
  );
}
