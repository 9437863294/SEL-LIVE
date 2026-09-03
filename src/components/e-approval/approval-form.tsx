'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  IndianRupee,
  Loader2,
  Lock,
  Plus,
  Route,
  Save,
  Send,
  Settings2,
  Sparkles,
  Upload,
  X,
  type LucideIcon,
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
  uploadEApprovalAttachment,
  type EApprovalServiceActor,
  type ResolvedEApprovalRouting,
} from '@/lib/e-approval-service';
import { AssigneePicker } from './assignee-picker';
import { Field, FormSection } from './page-header';
import { useEApprovalDirectory, useEApprovalSettings, formatEApprovalAmount } from './hooks';

/**
 * The create/edit screen (spec section 15), as a form that asks one thing at a time.
 *
 * **Only what is needed is on screen.** Raising an approval genuinely requires three things: a
 * subject, a proposal, and somebody to send it to. Those are the numbered steps, and each one
 * appears once the step before it has been answered — so a blank form is a single field, not a wall
 * of fifteen. Everything else (documents, money, filing details, visibility) is optional and stays
 * hidden until asked for, because an optional field on screen still reads as work to do.
 *
 * **The form reacts to the answers.** The approval type decides whether money is required at all;
 * when it is, the amount becomes a numbered step rather than an optional extra, and the "add
 * financial details" option disappears because it is no longer a choice.
 *
 * Revising an existing request opts out of the whole progression — someone correcting one line
 * should not have to walk the ladder again, so every step is unlocked and any section holding data
 * is already open.
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

  // Revising an existing request skips the progression entirely — see the component doc.
  const revising = Boolean(existing);

  const [moneyOptIn, setMoneyOptIn] = useState(
    Boolean(existing?.amount || existing?.vendorName || existing?.costCentre || existing?.budgetHead),
  );
  const [showDocuments, setShowDocuments] = useState(revising);
  const [showFiling, setShowFiling] = useState(
    Boolean(
      existing?.departmentId ||
        existing?.projectId ||
        existing?.requiredBy ||
        existing?.externalRef ||
        (existing?.priority && existing.priority !== 'Normal'),
    ),
  );
  const [showVisibility, setShowVisibility] = useState(
    Boolean(existing?.ccUserIds?.length || existing?.confidential),
  );
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  /** Files chosen before the request exists. Uploaded on save, once there is an id to file them under. */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState(0);
  const [dragging, setDragging] = useState(false);

  const selectedType = directory.types.find((row) => row.id === approvalTypeId);

  // An approval type that requires an amount turns money into a step of its own, so it isn't
  // something the requester opts into — derived rather than pushed into state by an effect, or the
  // block would stay open after switching back to a type that doesn't need it.
  const moneyRequired = Boolean(selectedType?.requiresAmount);
  const showMoney = moneyRequired || moneyOptIn;

  // Each step appears once the one before it has been answered. A step already carrying data stays
  // put, so clearing an earlier field never yanks away something being edited.
  const subjectFilled = subject.trim().length > 0;
  const proposalFilled = body.trim().length > 0;
  const showProposalStep = revising || subjectFilled || proposalFilled;
  // Only worth asking when types are actually configured; otherwise it's a select with one option.
  const showTypeStep = directory.types.length > 0 && (revising || proposalFilled || Boolean(approvalTypeId));
  const showRouteStep = revising || proposalFilled || chain.length > 0 || Boolean(templateId);

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

        // Uploaded *before* submitting, never after. `submitEApproval` fingerprints the material
        // fields — the attachment set included — and that fingerprint is what a later resubmission is
        // compared against. Uploading after submission would bake in a fingerprint that omits these
        // files, so the very next resubmit would report a material change nobody made and supersede
        // approvals for no reason.
        const staged = pendingFiles.length;
        if (staged) {
          setUploaded(0);
          // Each file leaves the queue as it lands, so a failure half way through leaves only the
          // files that did *not* upload staged. Clearing the whole queue at the end instead would
          // make a retry re-upload everything that already succeeded, and attachments are never
          // replaced — you would be looking at duplicates on the approval.
          for (const file of [...pendingFiles]) {
            await uploadEApprovalAttachment(approvalId, file, serviceActor, {
              description: 'Attached when the request was raised',
            });
            setUploaded((count) => count + 1);
            setPendingFiles((current) => current.filter((queued) => queued !== file));
          }
        }

        if (thenSubmit) {
          await submitEApproval(approvalId, serviceActor);
          toast({ title: 'Submitted for approval' });
        } else {
          toast({
            title: 'Draft saved',
            description: staged ? `${staged} document${staged > 1 ? 's' : ''} attached.` : undefined,
          });
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
    [serviceActor, valid, amountMissing, hasRoute, selectedType, existing, draft, pendingFiles, onSaved, router, toast],
  );

  const moveChain = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= chain.length) return;
    const next = [...chain];
    [next[index], next[target]] = [next[target], next[index]];
    setChain(next);
  };

  // Numbered from what is actually on screen, so hiding the type step doesn't leave a gap in the
  // sequence the requester is reading.
  const visibleSteps = [
    'subject',
    ...(showProposalStep ? ['proposal'] : []),
    ...(showTypeStep ? ['type'] : []),
    ...(moneyRequired ? ['amount'] : []),
    ...(showRouteStep ? ['route'] : []),
  ];
  const stepNo = (key: string) => visibleSteps.indexOf(key) + 1;
  const isLastStep = (key: string) => visibleSteps[visibleSteps.length - 1] === key;
  /** Which steps have an answer — drives the ticks, the rail's end state and the checklist. */
  const stepDone: Record<string, boolean> = {
    subject: subjectFilled,
    proposal: proposalFilled,
    type: Boolean(approvalTypeId),
    amount: amount.trim().length > 0,
    route: hasRoute,
  };

  /**
   * The whole journey, not only the part revealed so far.
   *
   * Progress has to count against this rather than `visibleSteps`, which grows as you answer: with a
   * blank form that read "Step 1 of 1" — technically true of what was on screen, and a plain lie
   * about how much was left to do.
   */
  const plannedSteps: Array<{ key: string; label: string }> = [
    { key: 'subject', label: 'Subject' },
    { key: 'proposal', label: 'The proposal' },
    ...(directory.types.length > 0 ? [{ key: 'type', label: 'Kind of approval' }] : []),
    ...(moneyRequired ? [{ key: 'amount', label: 'Financial details' }] : []),
    { key: 'route', label: 'Who approves it' },
  ];
  const doneCount = plannedSteps.filter((entry) => stepDone[entry.key]).length;

  // Money renders either as a numbered step (type demands an amount) or as an optional add-on, so
  // the fields themselves live in one place.
  /**
   * The resolved chain — who this actually reaches, in order.
   *
   * Defined once and rendered in two places: the summary panel on wide screens, and inside the
   * "Who approves it" step below `lg`, where there is no panel to hold it. It answers the question a
   * requester most wants answered before submitting, and a note-sheet whose route is a surprise is
   * one that gets withdrawn and raised again.
   *
   * A div wrapper, not a paragraph: Badge renders a block element, and a block inside a paragraph is
   * invalid HTML the browser silently re-nests — a hydration mismatch.
   */
  const routePreview = (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Route className="h-3.5 w-3.5 text-sky-700" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">It will go to</span>
        {preview?.source && preview.source !== 'None' && (
          <Badge variant="outline" className="ml-auto gap-1 text-[10px] font-normal">
            <Sparkles className="h-2.5 w-2.5" />
            {preview.source}
          </Badge>
        )}
      </div>
      {!hasRoute ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-snug text-amber-900">
          Nobody yet. Pick a person or a department — you can save a draft without one, but not submit.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {preview?.steps.map((step, index) => (
            <li
              key={step.id ?? index}
              className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold text-white">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">
                {step.assignments.map(describeEApprovalAssignment).join(step.groupMode === 'Any' ? ' or ' : ' & ')}
              </span>
              {settings && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {eApprovalStepSla(step.slaHours, priority, settings)}h
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  const moneyFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label="Amount"
        required={moneyRequired}
        hint={amount ? formatEApprovalAmount(Number(amount)) : undefined}
      >
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
  );

  const documentFields = (
    <div className="space-y-2">
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = Array.from(event.dataTransfer.files ?? []);
          if (dropped.length) setPendingFiles((current) => [...current, ...dropped]);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
          dragging ? 'border-sky-400 bg-sky-50' : 'border-muted-foreground/25 hover:border-sky-300 hover:bg-muted/30',
        )}
      >
        <Upload className="h-5 w-5 text-muted-foreground" />
        <span className="text-xs font-medium">Drop files here, or tap to choose</span>
        <span className="text-[11px] text-muted-foreground">
          {existing?.id
            ? 'Uploaded when you save.'
            : 'Uploaded when you save the draft or submit — the request needs an id first.'}
        </span>
        <input
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            if (chosen.length) setPendingFiles((current) => [...current, ...chosen]);
            event.target.value = '';
          }}
        />
      </label>

      {pendingFiles.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {pendingFiles.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-2 px-2.5 py-2">
              <FileText className="h-4 w-4 shrink-0 text-sky-600" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{file.name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {file.size < 1024 * 1024
                    ? `${Math.max(1, Math.round(file.size / 1024))} KB`
                    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                  {busy && index < uploaded ? ' · uploaded' : ''}
                </span>
              </span>
              {busy && index === uploaded ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 p-0 text-destructive"
                  onClick={() => setPendingFiles(pendingFiles.filter((_, position) => position !== index))}
                  disabled={busy !== null}
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {existing?.id && (
        <p className="text-[11px] text-muted-foreground">
          Files already on this request are listed further down, and are never replaced — a revision is added
          alongside the original.
        </p>
      )}
    </div>
  );

  return (
    // No width cap and no auto-margins here: the *page* owns the measure, so the header, the steps
    // and the action bar all share one column edge. When the form capped itself the page had three
    // different widths stacked on top of each other, which is what made it look accidental.
    /*
     * Two columns on a wide screen: the steps, and a panel that says what is being raised so far.
     *
     * Not simply a wider form — a proposal textarea stretched across 1300px is a worse writing
     * surface, not a better one. The second column is what genuinely earns the width, and it fills
     * the emptiness a progressive form necessarily has early on, when only one field has appeared.
     */
    <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3">
        {/*
          Progress, for viewports too narrow for the summary panel. The panel owns it everywhere
          else — showing both at once would be the same information twice on one screen.
        */}
        {!revising && (
          <div className="rounded-xl border bg-background px-3 py-2.5 sm:px-4 lg:hidden">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Step {Math.min(doneCount + 1, plannedSteps.length)} of {plannedSteps.length}
              </p>
              <p className="text-xs text-muted-foreground">
                {doneCount === plannedSteps.length && hasRoute
                  ? 'Ready to submit'
                  : `${doneCount} of ${plannedSteps.length} answered`}
              </p>
            </div>
            <div className="mt-1.5 flex gap-1" role="presentation">
              {plannedSteps.map((entry) => (
                <span
                  key={entry.key}
                  className={cn(
                    'h-1.5 flex-1 rounded-full transition-colors',
                    stepDone[entry.key] ? 'bg-emerald-500' : 'bg-muted',
                  )}
                />
              ))}
            </div>
          </div>
        )}

      {/* ── Step 1 · Subject ────────────────────────────────────────────────────────────── */}
      <StepCard
        step={stepNo('subject')}
        title="Subject"
        description="One line naming what is being approved."
        done={stepDone.subject}
        isLast={isLastStep('subject')}
      >
        <Input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Approval for purchase of safety equipment"
          className="h-11 text-base font-medium"
          maxLength={180}
          autoFocus={!revising}
        />
        {!showProposalStep && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Type a subject and the next step appears.
          </p>
        )}
      </StepCard>

      {/* ── Step 2 · Proposal ───────────────────────────────────────────────────────────── */}
      {showProposalStep && (
        <StepCard
          step={stepNo('proposal')}
          title="The proposal"
          description="This is the text being approved. Editing it after an approval supersedes that approval."
          done={stepDone.proposal}
          isLast={isLastStep('proposal')}
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
            className="min-h-[240px] resize-y text-sm leading-relaxed"
          />
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {body.trim().length} characters. Say what is proposed, why, and what it costs.
          </p>
        </StepCard>
      )}

      {/* ── Step 3 · Approval type — the answer that decides what else gets asked ───────── */}
      {showTypeStep && (
        <StepCard
          step={stepNo('type')}
          title="Kind of approval"
          description="Decides how it routes, and whether an amount is required."
          done={stepDone.type}
          isLast={isLastStep('type')}
          aside={
            <Badge variant="outline" className="text-[10px] font-normal">
              Optional
            </Badge>
          }
        >
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
        </StepCard>
      )}

      {/* ── Amount, promoted to a step of its own when the type demands one ─────────────── */}
      {moneyRequired && (
        <StepCard
          step={stepNo('amount')}
          title="Financial details"
          description={`${selectedType?.name ?? 'This type'} needs an amount. It is what the approval matrix routes on.`}
          done={stepDone.amount}
          isLast={isLastStep('amount')}
        >
          {moneyFields}
        </StepCard>
      )}

      {/* ── Send to ─────────────────────────────────────────────────────────────────────── */}
      {showRouteStep && (
        <StepCard
          step={stepNo('route')}
          title="Who approves it"
          description="Name the first approver. Whoever receives it can verify, add approvers or forward it on."
          done={stepDone.route}
          isLast={isLastStep('route')}
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

            {/*
              The route itself lives in the summary panel on the right — it is a *result* of the
              picker above, not another thing to fill in, and repeating it under the field that
              produces it said the same thing twice on one screen. Below `lg` the panel is not there
              to hold it, so it falls back to here.
            */}
            <div className="lg:hidden">
              <Separator className="mb-2.5" />
              {routePreview}
            </div>
          </div>
        </StepCard>
      )}

      {/* ── Optional extras, off screen until asked for ─────────────────────────────────── */}
      {showRouteStep && (
        <div className="space-y-3">
          {/* Outside the numbered rail on purpose: these are not steps, and numbering them would
              make an optional field read as something still owed. */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed bg-muted/20 px-3 py-3 sm:px-4">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Add if needed
            </span>
            <AddOnChip
              label="Documents"
              icon={Upload}
              active={showDocuments}
              onClick={() => setShowDocuments((value) => !value)}
            />
            {/* Absent when the type already demands an amount — it is a step by then, not a choice. */}
            {!moneyRequired && (
              <AddOnChip
                label="Financial details"
                icon={IndianRupee}
                active={moneyOptIn}
                onClick={() => setMoneyOptIn((value) => !value)}
              />
            )}
            <AddOnChip
              label="Filing details"
              icon={Settings2}
              active={showFiling}
              onClick={() => setShowFiling((value) => !value)}
            />
            <AddOnChip
              label="Visibility"
              icon={Lock}
              active={showVisibility}
              onClick={() => setShowVisibility((value) => !value)}
            />
          </div>

          {showDocuments && (
            <FormSection
              title="Supporting documents"
              description="Quotations, comparative statements, drawings, sanction letters — whatever the approver needs to decide."
              className="animate-in fade-in slide-in-from-top-1 duration-300"
              aside={
                pendingFiles.length > 0 ? (
                  <Badge variant="outline" className="text-[10px]">
                    {pendingFiles.length} to upload
                  </Badge>
                ) : undefined
              }
            >
              {documentFields}
            </FormSection>
          )}

          {!moneyRequired && moneyOptIn && (
            <FormSection
              title="Financial details"
              description="The amount is what the approval matrix routes on."
              className="animate-in fade-in slide-in-from-top-1 duration-300"
            >
              {moneyFields}
            </FormSection>
          )}

          {showFiling && (
            <FormSection
              title="Filing details"
              description="How this is filed and how fast it should move. All optional."
              className="animate-in fade-in slide-in-from-top-1 duration-300"
            >
              <div className="grid gap-3 sm:grid-cols-2">
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

                <Field
                  label="Priority"
                  hint={settings ? `${eApprovalStepSla(settings.defaultSlaHours, priority, settings)}h per stage` : undefined}
                >
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
          )}

          {showVisibility && (
            <FormSection
              title="Visibility"
              description="Who else can see this, beyond the approvers."
              className="animate-in fade-in slide-in-from-top-1 duration-300"
            >
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
          )}
        </div>
      )}

      {/* ── Action bar ──────────────────────────────────────────────────────────────────────── */}
      {/* Sticky within the column, not fixed to the viewport. Fixed made it span underneath the
          module sidebar and align to a different width than the form, so Submit sat nowhere near the
          thing it submits — and it overlaid whatever a page put after the form. */}
      <div className="sticky bottom-0 z-20 rounded-xl border bg-background/95 px-3 py-2.5 shadow-[0_-4px_16px_-8px_rgba(15,23,42,0.2)] backdrop-blur sm:px-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Says what is still missing, in the same place the buttons are — a disabled Submit with
              its reason somewhere further up the page is a dead end the reader has to hunt for. */}
          <p
            className={cn(
              'mr-auto min-w-0 text-xs',
              !valid || !hasRoute ? 'font-medium text-amber-700' : 'text-muted-foreground',
            )}
          >
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

      {/* ── Summary panel ──────────────────────────────────────────────────────────────────── */}
      <aside className="hidden lg:sticky lg:top-4 lg:block">
        <div className="space-y-3">
          {!revising && (
            <div className="rounded-xl border bg-background p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Step {Math.min(doneCount + 1, plannedSteps.length)} of {plannedSteps.length}
              </p>
              <ol className="mt-2.5 space-y-1.5">
                {plannedSteps.map((entry) => {
                  const isDone = stepDone[entry.key];
                  return (
                    <li key={entry.key} className="flex items-center gap-2">
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                          isDone ? 'bg-emerald-100 text-emerald-700' : 'border border-dashed border-muted-foreground/40',
                        )}
                        aria-hidden
                      >
                        {isDone && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                      </span>
                      <span className={cn('text-xs', isDone ? 'text-slate-800' : 'text-muted-foreground')}>
                        {entry.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {/* What is actually being raised, as it stands. The blank state is deliberately encouraging
              rather than a list of dashes — an empty panel on an empty form says nothing worth saying. */}
          <div className="rounded-xl border bg-background p-3.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</p>
            {!subjectFilled ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Start with a subject. As you answer each step this panel fills in, so you can see the whole
                note-sheet without scrolling back up.
              </p>
            ) : (
              <dl className="mt-2.5 space-y-2.5">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Subject</dt>
                  <dd className="mt-0.5 line-clamp-3 text-sm font-medium leading-snug text-slate-900">{subject}</dd>
                </div>
                {selectedType && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Type</dt>
                    <dd className="min-w-0 truncate text-xs font-medium text-slate-800">{selectedType.name}</dd>
                  </div>
                )}
                {amount.trim() && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Amount</dt>
                    <dd className="text-xs font-semibold tabular-nums text-slate-900">
                      {formatEApprovalAmount(Number(amount) || 0)}
                    </dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Priority</dt>
                  <dd className="text-xs font-medium text-slate-800">{priority}</dd>
                </div>
                {pendingFiles.length > 0 && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Documents</dt>
                    <dd className="text-xs font-medium text-slate-800">{pendingFiles.length}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>

          {/* The route, in full — moved out of the step that produces it so the picker stays a
              picker and the answer sits with the rest of the summary. */}
          <div className="rounded-xl border bg-background p-3.5">{routePreview}</div>
        </div>
      </aside>
    </div>
  );
}

/**
 * One numbered step in the sequence.
 *
 * The marker sits on a continuous rail rather than inside the card, which is the whole point: five
 * identical bordered rectangles stacked up read as an arbitrary pile of forms, whereas the same five
 * threaded onto a line read as one thing with an order and an end. The rail is drawn per card and
 * deliberately overshoots into the gap below (`-bottom-3`, matching the parent's `space-y-3`) so it
 * joins up across the gaps; the last step suppresses it, or the line would dangle past the sequence.
 *
 * `done` turns the number into a tick and drops the card's emphasis, so at a glance the eye lands on
 * the step still wanting an answer instead of weighing all five equally.
 */
function StepCard({
  step,
  title,
  description,
  aside,
  done = false,
  isLast = false,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  aside?: ReactNode;
  /** Answered — shows a tick and steps back visually. */
  done?: boolean;
  /** Suppresses the rail below, so the sequence ends cleanly. */
  isLast?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="relative pl-9 animate-in fade-in slide-in-from-top-1 duration-300 motion-reduce:animate-none sm:pl-11">
      {!isLast && (
        <span
          className="absolute bottom-[-0.75rem] left-[13px] top-8 w-px bg-gradient-to-b from-border to-border/40 sm:left-[15px]"
          aria-hidden
        />
      )}
      <span
        className={cn(
          'absolute left-0 top-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-4 ring-background transition-colors sm:h-8 sm:w-8',
          done ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-600 text-white shadow-sm',
        )}
        aria-hidden
      >
        {done ? <Check className="h-4 w-4" strokeWidth={3} /> : step}
      </span>

      <div
        className={cn(
          'overflow-hidden rounded-xl border bg-background transition-shadow',
          done ? 'shadow-none' : 'shadow-sm',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2 border-b bg-muted/20 px-3 py-2.5 sm:px-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-tight tracking-tight text-slate-900">{title}</h2>
            {description && <p className="mt-1 text-xs leading-snug text-muted-foreground">{description}</p>}
          </div>
          {aside}
        </div>
        <div className="px-3 py-3.5 sm:px-4">{children}</div>
      </div>
    </section>
  );
}

/** A toggle for one optional section — pressed means the section is open below. */
function AddOnChip({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        active
          ? 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100'
          : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {active ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
