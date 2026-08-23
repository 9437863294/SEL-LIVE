'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  IndianRupee,
  Loader2,
  Lock,
  Route,
  Save,
  Send,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
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
  listEApprovalRules,
  listEApprovalTemplates,
  resolveEApprovalRoutingForDraft,
  submitEApproval,
  updateEApprovalDraft,
  type EApprovalServiceActor,
  type ResolvedEApprovalRouting,
} from '@/lib/e-approval-service';
import { AssigneePicker } from './assignee-picker';
import { Field, FormSection } from './page-header';
import { useEApprovalDirectory, useEApprovalSettings, formatEApprovalAmount } from './hooks';

/**
 * The create/edit screen (spec section 15), laid out as what it actually is: a note-sheet on the
 * left, the decisions about it on the right.
 *
 * Two things make the difference between this and a wall of fields. First, **the document leads** —
 * subject and proposal get the width and the weight, because that text is the thing being approved.
 * Second, **progressive disclosure**: money appears only when the approval is about money, and the
 * configured-workflow machinery stays folded away, because the ordinary case is "send this to one
 * person or one department" and that should cost one click, not a choice between three routing
 * models.
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

  const [chain, setChain] = useState<EApprovalAssignment[]>(
    (existing?.adHocSteps ?? []).flatMap((step) => step.assignments ?? []),
  );
  const [templateId, setTemplateId] = useState(existing?.templateId ?? '');
  const [useConfigured, setUseConfigured] = useState(Boolean(existing?.templateId));
  const [configuredExists, setConfiguredExists] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; steps: EApprovalTemplateStep[] }>>([]);
  const [preview, setPreview] = useState<ResolvedEApprovalRouting | null>(null);

  const [showMoney, setShowMoney] = useState(
    Boolean(existing?.amount || existing?.vendorName || existing?.costCentre || existing?.budgetHead),
  );
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);

  const selectedType = directory.types.find((row) => row.id === approvalTypeId);

  /** An approval type that requires an amount opens the money block on its own. */
  useEffect(() => {
    if (selectedType?.requiresAmount) setShowMoney(true);
  }, [selectedType?.requiresAmount]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listEApprovalTemplates(serviceActor?.organizationId),
      listEApprovalRules(serviceActor?.organizationId),
    ]).then(([templateRows, ruleRows]) => {
      if (cancelled) return;
      const active = templateRows.filter((row) => row.active !== false);
      setTemplates(active.map((row) => ({ id: row.id, name: row.name, steps: row.steps ?? [] })));
      setConfiguredExists(active.length > 0 || ruleRows.some((row) => row.active !== false));
    });
    return () => {
      cancelled = true;
    };
  }, [serviceActor?.organizationId]);

  /** One step per named approver, in the order they were added. */
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
      amount: showMoney && amount ? Number(amount) : undefined,
      currency: 'INR',
      vendorName: showMoney ? vendorName || undefined : undefined,
      costCentre: showMoney ? costCentre || undefined : undefined,
      budgetHead: showMoney ? budgetHead || undefined : undefined,
      confidential: confidential || selectedType?.confidentialByDefault || false,
      ccUserIds: ccUsers.map((entry) => entry.userId).filter(Boolean) as string[],
      // Cleared with a falsy value rather than `undefined`: the service prunes undefined before
      // writing, so on an existing draft an undefined would leave the previous routing choice in
      // place — and ad-hoc steps resolve ahead of everything else, so a stale one would win.
      templateId: useConfigured ? templateId || '' : '',
      adHocSteps: useConfigured ? [] : adHocSteps,
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
      showMoney,
      amount,
      vendorName,
      costCentre,
      budgetHead,
      confidential,
      ccUsers,
      useConfigured,
      templateId,
      adHocSteps,
    ],
  );

  /** The resolved chain, refreshed whenever anything that decides it changes. */
  const routingKey = `${useConfigured}|${templateId}|${approvalTypeId}|${departmentId}|${projectId}|${amount}|${chain.length}`;
  useEffect(() => {
    let cancelled = false;
    void resolveEApprovalRoutingForDraft(draft, serviceActor?.organizationId)
      .then((resolved) => {
        if (!cancelled) setPreview(resolved);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the routing inputs rather than the whole draft — the proposal text
    // changing should not re-resolve the chain on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routingKey, serviceActor?.organizationId]);

  const valid = subject.trim().length > 0 && body.trim().length > 0;
  const amountMissing = Boolean(selectedType?.requiresAmount) && !amount;
  const hasRoute = (preview?.steps.length ?? 0) > 0;

  const save = useCallback(
    async (thenSubmit: boolean) => {
      if (!serviceActor) return;
      if (!valid) {
        toast({ variant: 'destructive', title: 'A subject and a proposal are required.' });
        return;
      }
      if (amountMissing) {
        toast({ variant: 'destructive', title: `${selectedType?.name} needs an amount.` });
        return;
      }
      if (thenSubmit && !hasRoute) {
        toast({
          variant: 'destructive',
          title: 'No approver chosen',
          description: 'Add someone under "Send to", or pick a configured workflow.',
        });
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
          toast({ title: 'Draft saved', description: 'You can add attachments now.' });
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
    },
    [serviceActor, valid, amountMissing, hasRoute, selectedType, existing, draft, onSaved, router, toast],
  );

  const moveChain = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= chain.length) return;
    const next = [...chain];
    [next[index], next[target]] = [next[target], next[index]];
    setChain(next);
  };

  return (
    <div className="space-y-3 pb-20">
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] lg:items-start">
        {/* ── The note-sheet ──────────────────────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-3">
          <FormSection
            title="The proposal"
            description="This is the text being approved. Editing it after an approval supersedes that approval."
          >
            <div className="space-y-3">
              <Field label="Subject" required>
                <Input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Approval for purchase of safety equipment"
                  className="h-11 text-base font-medium"
                  maxLength={180}
                />
              </Field>
              <Field
                label="Proposal"
                required
                hint={`${body.trim().length} characters. Say what is proposed, why, and what it costs.`}
              >
                <Textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={14}
                  placeholder={
                    'Approval is requested for the procurement of safety equipment for the Rayagada project.\n\n' +
                    '1. Requirement — 120 helmets, 120 safety harnesses and 40 pairs of safety shoes.\n' +
                    '2. Justification — current stock is exhausted; the site has 180 workers on two shifts.\n' +
                    '3. Rates — as per the approved rate contract dated 12 June 2026.\n' +
                    '4. Budget — provided under the project safety head.'
                  }
                  className="min-h-[280px] resize-y text-sm leading-relaxed"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="Financial details"
            description={
              showMoney
                ? 'The amount is what the approval matrix routes on.'
                : 'Add these if the approval involves money.'
            }
            aside={
              selectedType?.requiresAmount ? (
                <Badge variant="outline" className="text-[10px]">
                  Required for {selectedType.name}
                </Badge>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => setShowMoney((value) => !value)}
                >
                  <IndianRupee className="h-3.5 w-3.5" />
                  {showMoney ? 'Remove' : 'Add amount'}
                </Button>
              )
            }
          >
            {showMoney ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Amount" required={selectedType?.requiresAmount} hint={amount ? formatEApprovalAmount(Number(amount)) : undefined}>
                  <div className="relative">
                    <IndianRupee className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="number"
                      min={0}
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      className={cn('h-9 pl-7', amountMissing && 'border-rose-300 focus-visible:ring-rose-400')}
                      placeholder="250000"
                    />
                  </div>
                </Field>
                <Field label="Vendor or party">
                  <Input value={vendorName} onChange={(event) => setVendorName(event.target.value)} className="h-9" />
                </Field>
                <Field label="Cost centre">
                  <Input value={costCentre} onChange={(event) => setCostCentre(event.target.value)} className="h-9" />
                </Field>
                <Field label="Budget head">
                  <Input value={budgetHead} onChange={(event) => setBudgetHead(event.target.value)} className="h-9" />
                </Field>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Not a financial approval. The amount, vendor, cost centre and budget head are hidden.
              </p>
            )}
          </FormSection>
        </div>

        {/* ── The decisions ───────────────────────────────────────────────────────────────── */}
        <aside className="min-w-0 space-y-3 lg:sticky lg:top-20">
          <FormSection
            title="Send to"
            description="Name the first approver. Whoever receives it can verify, add approvers or forward it on."
          >
            <div className="space-y-2.5">
              {!useConfigured && (
                <>
                  <AssigneePicker
                    directory={directory}
                    value={chain}
                    onChange={setChain}
                    multiple
                    label=""
                    allowRequester={false}
                  />

                  {chain.length > 1 && (
                    <ol className="space-y-1">
                      {chain.map((assignment, index) => (
                        <li key={`${index}-${assignment.userId ?? assignment.departmentId ?? assignment.role}`}>
                          <div className="flex items-center gap-1.5 rounded-md border bg-muted/20 px-2 py-1.5">
                            <span className="w-4 text-center text-[11px] font-semibold text-muted-foreground">
                              {index + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                              {describeEApprovalAssignment(assignment)}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => moveChain(index, -1)}
                              disabled={index === 0}
                              aria-label="Move earlier"
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
                              aria-label="Move later"
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
                </>
              )}

              {configuredExists && (
                <Collapsible open={useConfigured} onOpenChange={setUseConfigured}>
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-full justify-start gap-1.5 px-1.5 text-[11px] text-sky-700"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      {useConfigured ? 'Choose the approvers myself instead' : 'Use a configured workflow instead'}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-1.5">
                    <Field label="Workflow" hint="Leave unset to let the approval matrix decide from type and amount.">
                      <Select value={templateId || 'MATRIX'} onValueChange={(next) => setTemplateId(next === 'MATRIX' ? '' : next)}>
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MATRIX">Decide from the approval matrix</SelectItem>
                          {templates.map((row) => (
                            <SelectItem key={row.id} value={row.id}>
                              {row.name} · {row.steps.length} stages
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </CollapsibleContent>
                </Collapsible>
              )}

              <Separator />

              {/* The resolved chain, always visible — a note-sheet whose route is a surprise gets
                  withdrawn and raised again. */}
              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Route className="h-3 w-3" /> It will go to
                  {preview?.source && preview.source !== 'None' && (
                    <Badge variant="outline" className="ml-auto gap-1 text-[9px] font-normal normal-case">
                      <Sparkles className="h-2.5 w-2.5" />
                      {preview.source}
                    </Badge>
                  )}
                </p>
                {!hasRoute ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                    Nobody yet. Pick a person or a department above — you can save a draft without one, but not submit.
                  </p>
                ) : (
                  <ol className="space-y-1">
                    {preview?.steps.map((step, index) => (
                      <li key={step.id ?? index} className="flex items-center gap-1.5 text-[11px]">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[9px] font-semibold text-sky-700">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {step.assignments.map(describeEApprovalAssignment).join(step.groupMode === 'Any' ? ' or ' : ' & ')}
                        </span>
                        {settings && (
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {eApprovalStepSla(step.slaHours, priority, settings)}h
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </FormSection>

          <FormSection title="Classification" description="How this is filed and how fast it should move.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Approval type" className="sm:col-span-2">
                <Select value={approvalTypeId || 'NONE'} onValueChange={(next) => setApprovalTypeId(next === 'NONE' ? '' : next)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Not specified" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Not specified</SelectItem>
                    {directory.types.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!directory.types.length && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    No approval types configured — this is optional.
                  </p>
                )}
              </Field>

              <Field label="Department">
                <Select value={departmentId || 'NONE'} onValueChange={(next) => setDepartmentId(next === 'NONE' ? '' : next)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Not specified</SelectItem>
                    {directory.departments.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Project or site">
                <Select value={projectId || 'NONE'} onValueChange={(next) => setProjectId(next === 'NONE' ? '' : next)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Not site-specific" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Not site-specific</SelectItem>
                    {directory.projects.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.projectName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Priority" hint={settings ? `${eApprovalStepSla(settings.defaultSlaHours, priority, settings)}h per stage` : undefined}>
                <Select value={priority} onValueChange={(next) => setPriority(next as EApprovalPriority)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {E_APPROVAL_PRIORITIES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Required by">
                <Input
                  type="date"
                  value={requiredBy ?? ''}
                  onChange={(event) => setRequiredBy(event.target.value)}
                  className="h-9 text-xs"
                />
              </Field>

              <Field label="Your reference" className="sm:col-span-2" hint="An indent, PO or letter number, if any.">
                <Input
                  value={externalRef}
                  onChange={(event) => setExternalRef(event.target.value)}
                  className="h-9 text-xs"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Visibility" description="Who else can see this, beyond the approvers.">
            <div className="space-y-2.5">
              <AssigneePicker
                directory={directory}
                value={ccUsers}
                onChange={setCcUsers}
                multiple
                allowDepartment={false}
                allowRole={false}
                label="CC — view and comment only"
              />
              <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-muted/20 px-2.5 py-2">
                <Checkbox
                  checked={confidential}
                  onCheckedChange={(checked) => setConfidential(checked === true)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-xs font-medium">
                    <Lock className="h-3 w-3" /> Confidential
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    Only participants and users holding confidential access can open it. Use for salary, disciplinary
                    and legal matters.
                  </span>
                </span>
              </label>
            </div>
          </FormSection>
        </aside>
      </div>

      {/* ── Action bar ──────────────────────────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-3 py-2.5 shadow-[0_-4px_16px_-8px_rgba(15,23,42,0.2)] backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-end gap-2">
          <p className="mr-auto min-w-0 text-[11px] text-muted-foreground">
            {!valid
              ? 'A subject and a proposal are required.'
              : !hasRoute
                ? 'Choose who it goes to before submitting.'
                : existing?.status === 'Returned'
                  ? 'Save, then resubmit from the approval screen.'
                  : 'Reference number is allotted on submission.'}
          </p>
          {existing?.id && (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => router.push(`${E_APPROVAL_BASE_PATH}/${existing.id}`)}
            >
              Discard
            </Button>
          )}
          <Button type="button" variant="outline" className="gap-1.5" onClick={() => void save(false)} disabled={busy !== null}>
            {busy === 'draft' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save draft
          </Button>
          <Button
            type="button"
            className="gap-1.5"
            onClick={() => void save(true)}
            disabled={busy !== null || !valid || !hasRoute}
          >
            {busy === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit for approval
          </Button>
        </div>
      </div>
    </div>
  );
}
