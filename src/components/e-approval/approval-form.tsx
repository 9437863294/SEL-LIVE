'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  Eye,
  Loader2,
  Route,
  Save,
  Send,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  describeEApprovalAssignment,
  E_APPROVAL_BASE_PATH,
  E_APPROVAL_PRIORITIES,
  eApprovalStepSla,
  type EApprovalAssignment,
  type EApprovalPriority,
  type EApprovalRequest,
  type EApprovalRequestDraft,
  type EApprovalTemplateStep,
} from '@/lib/e-approval';
import {
  createEApprovalDraft,
  listEApprovalTemplates,
  resolveEApprovalRoutingForDraft,
  submitEApproval,
  updateEApprovalDraft,
  type EApprovalServiceActor,
  type ResolvedEApprovalRouting,
} from '@/lib/e-approval-service';
import { AssigneePicker } from './assignee-picker';
import { useEApprovalDirectory, useEApprovalSettings, formatEApprovalAmount } from './hooks';

type RoutingMode = 'Auto' | 'Person' | 'Template';

/**
 * The create/edit form of spec section 15.
 *
 * Routing is the part worth reading. An employee can name the approver themselves ("Send To:
 * Director"), pick a template, or leave it to the approval matrix — and the form shows the resolved
 * chain *before* submission, because a note-sheet whose route is a surprise is a note-sheet that gets
 * withdrawn and raised again. Resolution happens against the amount currently on the form, so the
 * preview matches what submission will actually do.
 */
export function ApprovalForm({
  serviceActor,
  existing,
  onSaved,
}: {
  serviceActor: EApprovalServiceActor | null;
  existing?: EApprovalRequest;
  onSaved?: (approvalId: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { directory } = useEApprovalDirectory();
  const { settings } = useEApprovalSettings();

  const [subject, setSubject] = useState(existing?.subject ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [approvalTypeId, setApprovalTypeId] = useState(existing?.approvalTypeId ?? '');
  const [departmentId, setDepartmentId] = useState(existing?.departmentId ?? '');
  const [projectId, setProjectId] = useState(existing?.projectId ?? '');
  const [externalRef, setExternalRef] = useState(existing?.externalRef ?? '');
  const [priority, setPriority] = useState<EApprovalPriority>(existing?.priority ?? 'Normal');
  const [requiredBy, setRequiredBy] = useState(existing?.requiredBy ?? '');
  const [amount, setAmount] = useState(existing?.amount != null ? String(existing.amount) : '');
  const [vendorName, setVendorName] = useState(existing?.vendorName ?? '');
  const [costCentre, setCostCentre] = useState(existing?.costCentre ?? '');
  const [budgetHead, setBudgetHead] = useState(existing?.budgetHead ?? '');
  const [confidential, setConfidential] = useState(existing?.confidential ?? false);
  const [ccUsers, setCcUsers] = useState<EApprovalAssignment[]>(
    (existing?.ccUserIds ?? []).map((userId) => ({ kind: 'User' as const, userId })),
  );
  const [routingMode, setRoutingMode] = useState<RoutingMode>(existing?.templateId ? 'Template' : 'Auto');
  const [templateId, setTemplateId] = useState(existing?.templateId ?? '');
  const [chain, setChain] = useState<EApprovalAssignment[]>([]);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; steps: EApprovalTemplateStep[] }>>([]);
  const [preview, setPreview] = useState<ResolvedEApprovalRouting | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);

  const selectedType = directory.types.find((row) => row.id === approvalTypeId);

  useEffect(() => {
    void listEApprovalTemplates(serviceActor?.organizationId).then((rows) =>
      setTemplates(rows.filter((row) => row.active !== false).map((row) => ({ id: row.id, name: row.name, steps: row.steps ?? [] }))),
    );
  }, [serviceActor?.organizationId]);

  /** Ad-hoc chain: one step per named approver, in the order they were added. */
  const adHocSteps: EApprovalTemplateStep[] = useMemo(
    () =>
      chain.map((assignment, index) => ({
        id: `adhoc-${index + 1}`,
        name: describeEApprovalAssignment(assignment),
        assignments: [assignment],
        slaHours: settings?.defaultSlaHours,
      })),
    [chain, settings?.defaultSlaHours],
  );

  const draft: EApprovalRequestDraft = useMemo(
    () => ({
      subject,
      body,
      approvalTypeId: approvalTypeId || undefined,
      approvalTypeName: selectedType?.name,
      departmentId: departmentId || undefined,
      departmentName: directory.departmentById.get(departmentId)?.name,
      projectId: projectId || undefined,
      projectName: directory.projects.find((row) => row.id === projectId)?.projectName,
      externalRef: externalRef || undefined,
      priority,
      requiredBy: requiredBy || null,
      amount: amount ? Number(amount) : undefined,
      currency: 'INR',
      vendorName: vendorName || undefined,
      costCentre: costCentre || undefined,
      budgetHead: budgetHead || undefined,
      confidential: confidential || selectedType?.confidentialByDefault || false,
      ccUserIds: ccUsers.map((entry) => entry.userId).filter(Boolean) as string[],
      templateId: routingMode === 'Template' ? templateId || undefined : undefined,
      adHocSteps: routingMode === 'Person' ? adHocSteps : undefined,
    }),
    [
      subject,
      body,
      approvalTypeId,
      selectedType,
      departmentId,
      directory,
      projectId,
      externalRef,
      priority,
      requiredBy,
      amount,
      vendorName,
      costCentre,
      budgetHead,
      confidential,
      ccUsers,
      routingMode,
      templateId,
      adHocSteps,
    ],
  );

  const runPreview = useCallback(async () => {
    setPreviewing(true);
    try {
      setPreview(await resolveEApprovalRoutingForDraft(draft, serviceActor?.organizationId));
    } catch (error) {
      console.error('[e-approval] routing preview failed', error);
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [draft, serviceActor?.organizationId]);

  const valid = subject.trim().length > 0 && body.trim().length > 0;
  const amountRequired = selectedType?.requiresAmount && !amount;

  const save = async (thenSubmit: boolean) => {
    if (!serviceActor) return;
    if (!valid) {
      toast({ variant: 'destructive', title: 'Subject and proposal are required.' });
      return;
    }
    if (amountRequired) {
      toast({ variant: 'destructive', title: `${selectedType?.name} needs an amount.` });
      return;
    }
    setBusy(thenSubmit ? 'submit' : 'draft');
    try {
      let approvalId = existing?.id;
      if (approvalId) await updateEApprovalDraft(approvalId, draft, serviceActor);
      else approvalId = await createEApprovalDraft(draft, serviceActor);

      if (thenSubmit) {
        await submitEApproval(approvalId, serviceActor);
        toast({ title: 'Submitted for approval' });
      } else {
        toast({ title: 'Draft saved' });
      }
      onSaved?.(approvalId);
      router.push(`${E_APPROVAL_BASE_PATH}/${approvalId}`);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: thenSubmit ? 'Could not submit' : 'Could not save',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(null);
    }
  };

  const moveChain = (index: number, delta: number) => {
    const next = [...chain];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setChain(next);
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
          <CardTitle className="text-sm">Basic Information</CardTitle>
          <CardDescription className="text-xs">What is being proposed, and for whom.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 px-3 pb-3 sm:px-4 sm:pb-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label className="text-xs">
              Subject <span className="text-destructive">*</span>
            </Label>
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Approval for Purchase of Safety Equipment"
              className="mt-1 h-9"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">
              Proposal <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              placeholder="Approval requested for procurement of safety equipment for the Rayagada project…"
              className="mt-1 text-sm"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              This is the text being approved. Editing it after an approval supersedes that approval.
            </p>
          </div>

          <div>
            <Label className="text-xs">Approval type</Label>
            <Select value={approvalTypeId} onValueChange={setApprovalTypeId}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                {directory.types.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
                {!directory.types.length && (
                  <SelectItem value="" disabled>
                    No approval types configured
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Priority</Label>
            <Select value={priority} onValueChange={(next) => setPriority(next as EApprovalPriority)}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {E_APPROVAL_PRIORITIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                    {option !== 'Normal' && settings
                      ? ` — ${eApprovalStepSla(settings.defaultSlaHours, option, settings)}h per step`
                      : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="Select a department" />
              </SelectTrigger>
              <SelectContent>
                {directory.departments.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Project / Site</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="Not project-specific" />
              </SelectTrigger>
              <SelectContent>
                {directory.projects.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.projectName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Your reference</Label>
            <Input
              value={externalRef}
              onChange={(event) => setExternalRef(event.target.value)}
              placeholder="Indent / PO / letter number"
              className="mt-1 h-9"
            />
          </div>

          <div>
            <Label className="text-xs">Required by</Label>
            <Input
              type="date"
              value={requiredBy ?? ''}
              onChange={(event) => setRequiredBy(event.target.value)}
              className="mt-1 h-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
          <CardTitle className="text-sm">Financial Information</CardTitle>
          <CardDescription className="text-xs">
            Optional — but the amount is what the approval matrix routes on.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 px-3 pb-3 sm:px-4 sm:pb-4 md:grid-cols-4">
          <div>
            <Label className="text-xs">
              Amount (₹){selectedType?.requiresAmount && <span className="text-destructive"> *</span>}
            </Label>
            <Input
              type="number"
              min={0}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 h-9"
            />
            {amount && <p className="mt-1 text-[11px] text-muted-foreground">{formatEApprovalAmount(Number(amount))}</p>}
          </div>
          <div>
            <Label className="text-xs">Vendor / party</Label>
            <Input value={vendorName} onChange={(event) => setVendorName(event.target.value)} className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs">Cost centre</Label>
            <Input value={costCentre} onChange={(event) => setCostCentre(event.target.value)} className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs">Budget head</Label>
            <Input value={budgetHead} onChange={(event) => setBudgetHead(event.target.value)} className="mt-1 h-9" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Route className="h-4 w-4" /> Routing
          </CardTitle>
          <CardDescription className="text-xs">Who approves this, and in what order.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-3 pb-3 sm:px-4 sm:pb-4">
          <div className="flex flex-wrap gap-1.5">
            {(['Auto', 'Person', 'Template'] as RoutingMode[]).map((mode) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                variant={routingMode === mode ? 'default' : 'outline'}
                className="h-8 text-xs"
                onClick={() => setRoutingMode(mode)}
              >
                {mode === 'Auto' ? 'Approval matrix' : mode === 'Person' ? 'Name the approvers' : 'Use a template'}
              </Button>
            ))}
          </div>

          {routingMode === 'Auto' && (
            <p className="rounded-md border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
              The chain will be resolved from the approval matrix using the type, department, project and amount above.
              Preview it before submitting.
            </p>
          )}

          {routingMode === 'Template' && (
            <div>
              <Label className="text-xs">Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Select a workflow template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.name} ({row.steps.length} steps)
                    </SelectItem>
                  ))}
                  {!templates.length && (
                    <SelectItem value="" disabled>
                      No templates configured
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {routingMode === 'Person' && (
            <div className="space-y-2">
              <AssigneePicker
                directory={directory}
                value={[]}
                onChange={(next) => next[0] && setChain([...chain, next[0]])}
                label="Add approvers in order"
              />
              {chain.length > 0 && (
                <ol className="space-y-1">
                  {chain.map((assignment, index) => (
                    <li key={`${index}-${assignment.userId ?? assignment.departmentId ?? assignment.role}`}>
                      <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                        <span className="w-5 text-center text-xs font-semibold text-muted-foreground">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {describeEApprovalAssignment(assignment)}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => moveChain(index, -1)}
                          disabled={index === 0}
                          aria-label="Move up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => moveChain(index, 1)}
                          disabled={index === chain.length - 1}
                          aria-label="Move down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-destructive"
                          onClick={() => setChain(chain.filter((_, position) => position !== index))}
                          aria-label="Remove"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {index < chain.length - 1 && (
                        <ArrowDown className="mx-auto h-3 w-3 text-muted-foreground" aria-hidden />
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => void runPreview()}
              disabled={previewing}
            >
              {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Preview chain
            </Button>
            {preview && (
              <Badge variant="outline" className="text-[10px]">
                <Wand2 className="mr-1 h-3 w-3" />
                {preview.source}
                {preview.ruleName ? `: ${preview.ruleName}` : ''}
              </Badge>
            )}
          </div>

          {preview && (
            <div className="rounded-lg border bg-muted/20 p-2.5">
              {preview.steps.length === 0 ? (
                <p className="text-xs text-amber-700">
                  No approver could be determined. Name the approvers above, or ask an administrator to configure a
                  matrix rule for this type and amount.
                </p>
              ) : (
                <ol className="space-y-1">
                  {preview.steps.map((step, index) => (
                    <li key={step.id ?? index} className="flex items-center gap-2 text-xs">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-[10px] font-semibold text-sky-700">
                        {index + 1}
                      </span>
                      <span className="font-medium">{step.name}</span>
                      <span className="text-muted-foreground">
                        {step.assignments.map(describeEApprovalAssignment).join(
                          step.groupMode === 'Any' ? ' or ' : ' & ',
                        )}
                      </span>
                      {settings && (
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {eApprovalStepSla(step.slaHours, priority, settings)}h
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
          <CardTitle className="text-sm">Visibility</CardTitle>
          <CardDescription className="text-xs">Who else can see this approval.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-3 pb-3 sm:px-4 sm:pb-4">
          <AssigneePicker
            directory={directory}
            value={ccUsers}
            onChange={setCcUsers}
            multiple
            allowDepartment={false}
            allowRole={false}
            label="CC (view and comment only)"
          />
          <label className="flex items-start gap-2">
            <Checkbox
              checked={confidential}
              onCheckedChange={(checked) => setConfidential(checked === true)}
              className="mt-0.5"
            />
            <span>
              <span className="text-sm font-medium">Confidential</span>
              <span className="block text-[11px] text-muted-foreground">
                Only participants and users holding &quot;View Confidential Approval&quot; will be able to open it.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-background/95 p-2.5 shadow-lg backdrop-blur">
        {existing?.id && (
          <Button
            type="button"
            variant="ghost"
            className="mr-auto gap-1.5 text-destructive"
            onClick={() => router.push(`${E_APPROVAL_BASE_PATH}/${existing.id}`)}
          >
            <Trash2 className="h-4 w-4" /> Discard changes
          </Button>
        )}
        <Button type="button" variant="outline" className="gap-1.5" onClick={() => void save(false)} disabled={busy !== null}>
          {busy === 'draft' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save draft
        </Button>
        <Button type="button" className="gap-1.5" onClick={() => void save(true)} disabled={busy !== null || !valid}>
          {busy === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Submit for approval
        </Button>
      </div>
    </div>
  );
}
