'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
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
import { EApprovalEmptyState } from '../shared';
import { formatEApprovalAmount, type EApprovalDirectory } from '../hooks';

type Draft = Partial<EApprovalRuleRecord>;

/**
 * The approval matrix of spec section 13 — amount bands and their chains.
 *
 * The tester at the bottom exists because an approval matrix is the one piece of configuration whose
 * mistakes are invisible until a real file takes the wrong route. Entering a type and an amount and
 * seeing which rule wins turns "I think this is right" into "this is what will happen".
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

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

  const save = async () => {
    if (!serviceActor || !draft) return;
    if (!draft.templateId) {
      toast({ variant: 'destructive', title: 'Choose the workflow this band routes to.' });
      return;
    }
    if (draft.minAmount != null && draft.maxAmount != null && draft.maxAmount < draft.minAmount) {
      toast({ variant: 'destructive', title: 'The upper bound cannot be below the lower bound.' });
      return;
    }
    setBusy(true);
    try {
      await saveEApprovalRule(draft, serviceActor);
      toast({ title: 'Rule saved' });
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

  const templateName = (templateId?: string) => templates.find((row) => row.id === templateId)?.name ?? '—';

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 px-3 py-2.5 sm:px-4">
        <div>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <GitBranch className="h-4 w-4" /> Approval Matrix
          </CardTitle>
          <CardDescription className="text-xs">
            Which chain a request takes, by type, department, project and amount. The most specific rule wins; between
            two equally specific rules, the narrower amount band does.
          </CardDescription>
        </div>
        {canEdit && (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setDraft({ active: true, minAmount: 0 })}>
            <Plus className="h-3.5 w-3.5" /> New rule
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 px-3 pb-3 sm:px-4">
        {draft && (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <Label className="text-xs">Rule name</Label>
                <Input
                  value={draft.name ?? ''}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Purchase above ₹5 lakh"
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
              <div>
                <Label className="text-xs">Project</Label>
                <Select
                  value={draft.projectId ?? 'ANY'}
                  onValueChange={(next) => setDraft({ ...draft, projectId: next === 'ANY' ? undefined : next })}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
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
              </div>
              <div>
                <Label className="text-xs">Amount from (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  value={draft.minAmount ?? ''}
                  onChange={(event) =>
                    setDraft({ ...draft, minAmount: event.target.value === '' ? null : Number(event.target.value) })
                  }
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Amount to (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  value={draft.maxAmount ?? ''}
                  onChange={(event) =>
                    setDraft({ ...draft, maxAmount: event.target.value === '' ? null : Number(event.target.value) })
                  }
                  placeholder="No upper limit"
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Route to workflow</Label>
                <Select
                  value={draft.templateId ?? ''}
                  onValueChange={(next) => setDraft({ ...draft, templateId: next })}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue placeholder="Select a workflow" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates
                      .filter((template) => template.active !== false)
                      .map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Priority (tie-break)</Label>
                <Input
                  type="number"
                  value={draft.priority ?? 0}
                  onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) || 0 })}
                  className="mt-1 h-8 text-sm"
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
            icon={GitBranch}
            title="No matrix rules"
            description="Without a rule, employees have to name their approvers on the form."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Rule</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">From</TableHead>
                  <TableHead className="text-right">To</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>State</TableHead>
                  {canEdit && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={winner?.id === row.id ? 'bg-emerald-50' : undefined}>
                    <TableCell className="text-xs font-medium">{row.name || '—'}</TableCell>
                    <TableCell className="text-xs">
                      {row.approvalTypeId ? types.find((type) => type.id === row.approvalTypeId)?.name ?? '—' : 'Any'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.departmentId ? directory.departmentById.get(row.departmentId)?.name ?? '—' : 'Any'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                      {row.minAmount == null ? '—' : formatEApprovalAmount(row.minAmount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                      {row.maxAmount == null ? 'No limit' : formatEApprovalAmount(row.maxAmount)}
                    </TableCell>
                    <TableCell className="text-xs">{templateName(row.templateId)}</TableCell>
                    <TableCell>
                      {row.active === false ? (
                        <Badge variant="outline" className="text-[10px]">
                          Inactive
                        </Badge>
                      ) : winner?.id === row.id ? (
                        <Badge className="bg-emerald-600 text-[10px] hover:bg-emerald-600">Matches the test</Badge>
                      ) : null}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDraft(row)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive"
                            onClick={async () => {
                              if (!serviceActor) return;
                              await deleteEApprovalConfigRecord(E_APPROVAL_COLLECTIONS.rules, row.id, serviceActor);
                              void load();
                            }}
                            aria-label="Delete rule"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="rounded-lg border bg-sky-50/50 p-2.5">
          <p className="text-xs font-semibold">Test the matrix</p>
          <div className="mt-1.5 flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Type</Label>
              <Select value={testType} onValueChange={setTestType}>
                <SelectTrigger className="mt-0.5 h-8 w-[160px] text-xs">
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
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Department</Label>
              <Select value={testDepartment} onValueChange={setTestDepartment}>
                <SelectTrigger className="mt-0.5 h-8 w-[160px] text-xs">
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
              <Label className="text-[10px] uppercase text-muted-foreground">Amount</Label>
              <Input
                type="number"
                value={testAmount}
                onChange={(event) => setTestAmount(event.target.value)}
                className="mt-0.5 h-8 w-32 text-xs"
              />
            </div>
            <p className="text-xs">
              {winner ? (
                <>
                  Routes to <span className="font-semibold">{templateName(winner.templateId)}</span>
                  {winner.name ? ` via “${winner.name}”` : ''}
                </>
              ) : (
                <span className="text-amber-700">No rule matches — the requester would have to name the approvers.</span>
              )}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
