'use client';

/**
 * Settings → Workflow: the bill's steps, one card a step, laid out as Recurring Payments' workflow
 * is — the step's number, name and meaning across the top, how it is run on the left and who runs it
 * on the right — plus which debit notes the client certifies and the rule that payment waits for
 * the client's certification.
 *
 * The steps are configuration (see `workflow.ts`): review steps can be added, renamed, removed and
 * moved anywhere between Draft and Closed; the role steps — Bill raised, Certified by client,
 * Payment follow-up, Reconciliation, Closed — can be renamed and moved among the review steps but
 * not removed, and keep their order among themselves. The server applies the same checks on save,
 * and refuses to remove a step bills are still on. Being named on a step is the authority to do it:
 * no role permission or project grant is needed on top.
 */

import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, Bell, ChevronDown, ClipboardCheck, KeyRound, Lock, Plus, ShieldCheck, Trash2, Undo2, UserCheck, Users, Workflow } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CERTIFIABLE_TYPES } from '@/lib/bill-tracking/certification';
import { completeWorkflowStep, defaultWorkflowStep, isOptionalStep, isRoleStep, normaliseWorkflowSteps, permissionText, workflowProblem } from '@/lib/bill-tracking/workflow';
import {
  DEBIT_NOTE_CERTIFICATION,
  DEBIT_NOTE_CERTIFICATION_LABELS,
  TRANSACTION_TYPE_LABELS,
  WORKFLOW_STEP_PERMISSIONS,
  type BillWorkflowStatus,
  type CertificationReceiptRule,
  type DebitNoteCertification,
  type WorkflowAssignment,
  type WorkflowStepPermission,
  type WorkflowStepSetting,
} from '@/lib/bill-tracking/types';
import { cn } from '@/lib/utils';

import { FormField, FormSection, InfoTip } from './bt-ui';

interface UserOption {
  id: string;
  name: string;
  email?: string;
}

const DEBIT_NOTE_HINTS: Record<DebitNoteCertification, string> = {
  none: 'Debit notes are SEL’s own adjustments; they never ask for certification.',
  note_rule: 'Only a debit note billing the balance under a note rule (SUPPLY-60% / 70%) asks for certification.',
  all: 'Every debit note asks for certification, like an invoice — except a note settling another debit note’s certification.',
};

/** A fresh id for a step added here — the shape `workflow.ts` accepts, unlikely to repeat. */
const newStepId = (taken: readonly string[]) => {
  let id = '';
  do id = `step_${Math.random().toString(36).slice(2, 8)}`;
  while (taken.includes(id));
  return id;
};

export function WorkflowSettings({
  rule,
  onRuleChange,
  debitNotes,
  onDebitNotesChange,
  steps,
  onStepsChange,
  users,
  disabled,
}: {
  rule: CertificationReceiptRule;
  onRuleChange: (rule: CertificationReceiptRule) => void;
  debitNotes: DebitNoteCertification;
  onDebitNotesChange: (value: DebitNoteCertification) => void;
  steps: WorkflowStepSetting[];
  onStepsChange: (steps: WorkflowStepSetting[]) => void;
  users: UserOption[];
  disabled?: boolean;
}) {
  const setRule = (patch: Partial<CertificationReceiptRule>) => onRuleChange({ ...rule, ...patch });
  // Edited as typed once it is a full list of named steps (a name being retyped may be blank for a
  // moment — the problem line says so, and the server refuses it); repaired only when it arrives in
  // the older shape, or empty.
  const list = steps.length && steps.every((step) => typeof step.label === 'string') ? steps.map(completeWorkflowStep) : normaliseWorkflowSteps(steps);
  const setStep = (status: BillWorkflowStatus, patch: Partial<WorkflowStepSetting>) => onStepsChange(list.map((step) => (step.status === status ? { ...step, ...patch } : step)));
  const named = list.filter((step) => step.assignment !== 'permission' && step.userIds.length).length;
  const problem = workflowProblem(list);

  /** Can the step at `index` swap with its neighbour? Not past another role step, and Closed stays last. */
  const canMove = (index: number, direction: -1 | 1) => {
    const other = list[index + direction];
    if (!other) return false;
    if (list[index].status === 'closed' || other.status === 'closed') return false;
    return !(isRoleStep(list[index].status) && isRoleStep(other.status));
  };
  const move = (index: number, direction: -1 | 1) => {
    if (!canMove(index, direction)) return;
    const next = [...list];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onStepsChange(next);
  };
  /** A new review step, just before Bill raised — where review steps usually go — to move from there. */
  const addStep = () => {
    const ids = list.map((step) => step.status);
    const number = list.filter((step) => !isRoleStep(step.status)).length + 1;
    const step = defaultWorkflowStep(newStepId(ids), `New step ${number}`);
    const at = list.findIndex((entry) => entry.status === 'raised');
    const next = [...list];
    next.splice(at < 0 ? next.length - 1 : at, 0, step);
    onStepsChange(next);
  };
  // Steps removed since the page opened, with where they stood, so one can be put back before saving —
  // the server refuses to remove a step bills are on only once Save is pressed.
  const [removed, setRemoved] = useState<{ step: WorkflowStepSetting; at: number }[]>([]);
  const removeStep = (status: BillWorkflowStatus) => {
    const at = list.findIndex((step) => step.status === status);
    if (at < 0) return;
    setRemoved((current) => [...current.filter((entry) => entry.step.status !== status), { step: list[at], at }]);
    onStepsChange(list.filter((step) => step.status !== status));
  };
  /** Back where it was (or just before Closed, if the list has since grown shorter). */
  const restoreStep = (status: BillWorkflowStatus) => {
    const entry = removed.find((item) => item.step.status === status);
    if (!entry) return;
    setRemoved((current) => current.filter((item) => item.step.status !== status));
    if (list.some((step) => step.status === status)) return;
    const next = [...list];
    const closed = next.findIndex((step) => step.status === 'closed');
    next.splice(Math.min(entry.at, closed < 0 ? next.length : closed), 0, entry.step);
    onStepsChange(next);
  };
  const restorable = removed.filter((entry) => !list.some((step) => step.status === entry.step.status));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700" aria-hidden="true">
              <Workflow className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">Bill workflow</h3>
              <p className="max-w-3xl text-xs leading-relaxed text-slate-500">
                Add, rename, remove and reorder the steps a bill goes through. For each: who moves a bill into it, whether they are told when one is waiting, and whether it locks the amounts. Being named on a step is the permission to do it.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {named ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">{named} step{named === 1 ? '' : 's'} with named people</span> : null}
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled} onClick={addStep}>
              <Plus className="h-4 w-4" /> Add step
            </Button>
          </div>
        </div>

        {problem ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{problem}</p> : null}

        {restorable.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="font-medium">Removed steps — not saved yet:</span>
            {restorable.map(({ step }) => (
              <Button key={step.status} type="button" variant="outline" size="sm" className="h-7 gap-1 bg-white px-2 text-xs" disabled={disabled} onClick={() => restoreStep(step.status)}>
                <Undo2 className="h-3.5 w-3.5" /> Restore {step.label || 'step'}
              </Button>
            ))}
          </div>
        ) : null}

        <StageCard index={0} status="draft" label="Draft" description="Entered and still being prepared. Everything can be edited." enteredBy={null}>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            Anyone who can add bills (Bills · Add) creates a draft; the preparer edits it until it moves on.
          </div>
        </StageCard>
        {list.map((step, index) => (
          <StageCard
            key={step.status}
            index={index + 1}
            status={step.status}
            label={step.label}
            description={step.description}
            enteredBy={step.status === 'certified' ? 'Recording the client’s certification' : step.status === 'closed' ? `${step.actionLabel} — once fully received or adjusted` : step.actionLabel}
            locks={step.locksAmounts && !isRoleStep(step.status)}
            off={!step.enabled}
            tools={
              <>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={disabled || !canMove(index, -1)} onClick={() => move(index, -1)} aria-label={`Move ${step.label} up`} title="Move up">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={disabled || !canMove(index, 1)} onClick={() => move(index, 1)} aria-label={`Move ${step.label} down`} title="Move down">
                  <ArrowDown className="h-4 w-4" />
                </Button>
                {isOptionalStep(step.status) ? (
                  <label className="ml-1 flex items-center gap-2 text-xs font-medium text-slate-600">
                    <Switch disabled={disabled} checked={step.enabled} onCheckedChange={(value) => setStep(step.status, { enabled: value })} aria-label={`Use ${step.label}`} />
                    Use
                  </label>
                ) : null}
                {!isRoleStep(step.status) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-rose-700 hover:bg-rose-50"
                    disabled={disabled}
                    onClick={() => removeStep(step.status)}
                    aria-label={`Remove ${step.label}`}
                    title="Remove step — refused on save while bills are on it"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </>
            }
          >
            <StepControls step={step} users={users} disabled={disabled} onChange={(patch) => setStep(step.status, patch)} />
          </StageCard>
        ))}

        <div className="flex justify-center">
          <Button type="button" variant="outline" className="gap-1.5" disabled={disabled} onClick={addStep}>
            <Plus className="h-4 w-4" /> Add step
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
            <b>Steps in order.</b> Up to {list.find((step) => step.status === 'raised')?.label ?? 'Bill Raised'} a bill moves only into the next step in use — it cannot be raised without passing every step before it — and a step switched off is passed over. The client’s certification can be recorded once the bill is raised. Built-in steps can be renamed but not removed.
          </div>
          <div className="flex gap-3 rounded-lg border border-rose-100 bg-rose-50/60 p-3 text-xs text-rose-900">
            <Undo2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="leading-relaxed">
              <b>Returned for correction.</b> A bill at a step marked “Can be returned” can go back to its preparer with a note; it is corrected and resubmitted to the step before the one that returned it.
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          The <b>Stages</b> tab is a separate free-form label (the legacy STAGES column) shown on the bill; it does not move the workflow.
        </p>
      </div>

      <div className="space-y-4 xl:self-start">
        <FormSection icon={ClipboardCheck} title="Debit notes the client certifies" description="Invoices, retention bills, advances and adjustments are always certified; credit notes never are.">
          <FormField label="Certified by the client" hint={DEBIT_NOTE_HINTS[debitNotes]}>
            <Select value={debitNotes} onValueChange={(value) => onDebitNotesChange(value as DebitNoteCertification)} disabled={disabled}>
              <SelectTrigger aria-label="Debit notes the client certifies" className="text-left">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEBIT_NOTE_CERTIFICATION.map((value) => (
                  <SelectItem key={value} value={value}>
                    {DEBIT_NOTE_CERTIFICATION_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <p className="text-xs leading-relaxed text-slate-600">
            When the client certifies a debit note for a different taxable or GST, the note that settles it is raised against the same invoice and names the debit note. It is compared with that debit note only, never with the invoice.
          </p>
        </FormSection>

        <FormSection icon={ShieldCheck} title="Payment needs client certification" description="Recording or verifying a receipt is refused until the bill’s client certification is recorded.">
          <ToggleRow
            label="Only receive payment against certified bills"
            hint={rule.enabled ? 'On — a bill must be certified before money is recorded against it.' : 'Off — receipts can be recorded against any bill.'}
            disabled={disabled}
            checked={rule.enabled}
            onChange={(value) => setRule({ enabled: value })}
          />

          <div className={cn('space-y-4', !rule.enabled && 'pointer-events-none opacity-50')} aria-disabled={!rule.enabled}>
            <FormField label="Applies to" hint="Credit notes are never certified, so they are never blocked; a debit note only when the client certifies it (above).">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                {CERTIFIABLE_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
                    <Checkbox
                      disabled={disabled}
                      checked={rule.transactionTypes.includes(type)}
                      onCheckedChange={(value) => setRule({ transactionTypes: value ? [...new Set([...rule.transactionTypes, type])] : rule.transactionTypes.filter((entry) => entry !== type) })}
                    />
                    {TRANSACTION_TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
            </FormField>

            <ToggleRow
              label="Leave out bills imported from the workbook"
              hint="Their certificates were issued before SEL LIVE, so receipts can still be recorded against them."
              disabled={disabled}
              checked={rule.exemptImported}
              onChange={(value) => setRule({ exemptImported: value })}
            />

            <FormField label="Applies to bills dated from" hint="Blank = every bill. Bills dated earlier can take receipts without a certification." width="date">
              <Input type="date" disabled={disabled} value={rule.fromDate ?? ''} onChange={(event) => setRule({ fromDate: event.target.value || undefined })} />
            </FormField>
          </div>
        </FormSection>
      </div>
    </div>
  );
}

/** One step as a card: number, name and meaning across the top with its tools; its settings beneath, or "Skipped". */
function StageCard({
  index,
  status,
  label,
  description,
  enteredBy,
  locks,
  off,
  tools,
  children,
}: {
  index: number;
  status: BillWorkflowStatus;
  label: string;
  description: string;
  enteredBy: string | null;
  locks?: boolean;
  off?: boolean;
  tools?: React.ReactNode;
  children: React.ReactNode;
}) {
  const role = isRoleStep(status);
  const client = status === 'raised' || status === 'certified';
  return (
    <section className={cn('overflow-hidden rounded-xl border bg-white shadow-sm', off ? 'border-dashed border-slate-300' : client ? 'border-emerald-200' : 'border-slate-200')}>
      <header className={cn('flex flex-wrap items-start gap-3 px-4 py-3.5 sm:px-5', !off && 'border-b border-slate-100')}>
        <span
          className={cn(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
            off ? 'bg-slate-100 text-slate-400' : client ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700',
          )}
          aria-hidden="true"
        >
          {index + 1}
        </span>
        <div className={cn('min-w-0 flex-1', off && 'opacity-70')}>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[15px] font-semibold text-slate-900">
              Step {index + 1}: {label}
            </h4>
            {status === 'certified' ? <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Client step</span> : null}
            {role && status !== 'certified' ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Built-in</span> : null}
            {locks ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                <Lock className="h-3 w-3" aria-hidden="true" /> Locks amounts
              </span>
            ) : null}
          </div>
          {description ? <p className="mt-0.5 text-sm text-slate-600">{description}</p> : null}
          {enteredBy ? (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <ArrowDown className="h-3.5 w-3.5 rotate-180 text-slate-400" aria-hidden="true" />
              Entered by <span className="font-medium text-slate-700">{enteredBy}</span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Where every bill starts.</p>
          )}
        </div>
        {tools ? <div className="flex shrink-0 items-center gap-0.5 pt-0.5">{tools}</div> : null}
      </header>
      {off ? <p className="px-4 pb-3.5 text-sm text-slate-500 sm:px-5 sm:pl-[4.25rem]">Skipped — bills move past this step.</p> : <div className="p-4 sm:p-5">{children}</div>}
    </section>
  );
}

/** The three ways a step can be done — the "Moved here by" dropdown. */
const ASSIGNMENT_CHOICES: { value: WorkflowAssignment; label: string; hint: string; icon: typeof Users }[] = [
  { value: 'permission', label: 'Permission holders', hint: 'Anyone holding the permission below', icon: KeyRound },
  { value: 'users', label: 'Named people', hint: 'The people you choose', icon: Users },
  { value: 'collection_owner', label: 'Collection owner', hint: 'The bill’s owner, plus backups', icon: UserCheck },
];

/**
 * A step's settings in three parts: what the step is (name, button, meaning), who moves bills into
 * it — one choice, then the one place its permission is named, in full as Access Management names
 * it — and, for review steps, its rules. Switches that do not apply are left out, not greyed.
 */
function StepControls({ step, users, disabled, onChange }: { step: WorkflowStepSetting; users: UserOption[]; disabled?: boolean; onChange: (patch: Partial<WorkflowStepSetting>) => void }) {
  const certify = step.status === 'certified';
  const permission = `Bill Tracking · ${permissionText(step.permissions)}`;
  const fresh = step.permissions.filter((entry) => entry === 'Submit' || entry === 'Raise');
  const naming = step.assignment !== 'permission';
  const review = !isRoleStep(step.status);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <fieldset className="min-w-0 space-y-3">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Step details</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Step name *" htmlFor={`step-name-${step.status}`}>
              <Input id={`step-name-${step.status}`} disabled={disabled} maxLength={40} value={step.label} onChange={(event) => onChange({ label: event.target.value })} />
            </FormField>
            <FormField label="Button text" htmlFor={`step-action-${step.status}`} hint={certify ? 'Reached by recording the certification.' : undefined}>
              <Input id={`step-action-${step.status}`} disabled={disabled || certify} maxLength={40} value={step.actionLabel} onChange={(event) => onChange({ actionLabel: event.target.value })} />
            </FormField>
          </div>
          <FormField label="What it means" htmlFor={`step-description-${step.status}`}>
            <Textarea id={`step-description-${step.status}`} rows={2} className="min-h-[4rem] resize-y" disabled={disabled} maxLength={300} value={step.description} onChange={(event) => onChange({ description: event.target.value })} placeholder="Shown on this card and on the bill." />
          </FormField>
        </fieldset>

        <fieldset className="min-w-0 space-y-3">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Who moves bills here</legend>
          {/* A dropdown, each choice with its icon and what it means, open and closed alike. */}
          <FormField label="Moved here by">
            <Select disabled={disabled} value={step.assignment} onValueChange={(value) => onChange({ assignment: value as WorkflowAssignment })}>
              <SelectTrigger aria-label="Who moves bills here" className="h-auto min-h-10 py-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNMENT_CHOICES.map((choice) => {
                  const Icon = choice.icon;
                  return (
                    <SelectItem key={choice.value} value={choice.value}>
                      <span className="flex items-start gap-2 text-left">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-800">{choice.label}</span>
                          <span className="block text-[11px] leading-snug text-slate-500">{choice.hint}</span>
                        </span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </FormField>

          {naming ? (
            <FormField label={step.assignment === 'collection_owner' ? 'Backup people' : 'People'} hint={step.assignment === 'collection_owner' ? 'Used when the bill has no collection owner, and alongside the owner.' : undefined}>
              <UserPicker value={step.userIds} users={users} disabled={disabled} onChange={(userIds) => onChange({ userIds })} placeholder={step.assignment === 'collection_owner' ? 'Nobody else' : 'Choose people'} />
            </FormField>
          ) : null}

          <FormField label={naming ? 'Permissions that can also do it' : 'Permissions needed'} hint={naming ? (step.onlyAssigned ? 'Not used while “Only these people” is on.' : 'Holders of any of them can do the step too, unless “Only these people” is on.') : 'Holding any one of them is enough. Granted in Settings → Access Management.'}>
            <PermissionPicker value={step.permissions} disabled={disabled || (naming && step.onlyAssigned)} onChange={(permissions) => onChange({ permissions })} />
          </FormField>
          {fresh.length && !(naming && step.onlyAssigned) ? (
            // Added to the registry with the configurable workflow, so no role holds them yet.
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {permissionText(fresh)} {fresh.length === 1 ? 'is a new permission' : 'are new permissions'}. Grant {fresh.length === 1 ? 'it' : 'them'} to the right roles in Settings → Access Management before saving
              {fresh.length === step.permissions.length && !naming ? ', or nobody can do this step' : ''}.
            </p>
          ) : null}

          {naming ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ToggleRow label="Only these people" hint={step.onlyAssigned ? 'Permission holders cannot do it.' : 'Permission holders can still do it.'} disabled={disabled} checked={step.onlyAssigned} onChange={(value) => onChange({ onlyAssigned: value })} />
              <ToggleRow label="Notify them" icon={<Bell className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />} hint="Told when a bill is waiting." disabled={disabled} checked={step.notify} onChange={(value) => onChange({ notify: value })} />
            </div>
          ) : null}
          {step.assignment === 'users' && !step.userIds.length ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Nobody is chosen yet, so holders of {permission} keep doing it.</p>
          ) : null}
        </fieldset>
      </div>

      {review ? (
        <fieldset className="space-y-2 border-t border-slate-100 pt-4">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Rules</legend>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <ToggleRow
              label="Locks the amounts"
              icon={<Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />}
              hint="From here, amounts, GST and deductions change only with Edit After Approval and a reason."
              disabled={disabled}
              checked={step.locksAmounts}
              onChange={(value) => onChange({ locksAmounts: value })}
            />
            <ToggleRow
              label="Can be returned for correction"
              icon={<Undo2 className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />}
              hint="A bill here can go back to its preparer with a note."
              disabled={disabled}
              checked={step.canReturn}
              onChange={(value) => onChange({ canReturn: value })}
            />
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

/** A setting that is on or off, in a bordered row: its name and (i), the switch on the right. */
function ToggleRow({ label, hint, icon, checked, onChange, disabled }: { label: string; hint: string; icon?: React.ReactNode; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const id = useId();
  // The name and its switch; what it means is behind the (i), not open under it.
  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-lg border p-3', disabled && 'opacity-60')}>
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-slate-800">
        {icon}
        <label htmlFor={id} className="cursor-pointer">
          {label}
        </label>
        <InfoTip label={`About “${label}”`}>{hint}</InfoTip>
      </span>
      <Switch id={id} disabled={disabled} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** What each Bills permission is for, beside its name in the picker. */
const PERMISSION_HINTS: Record<WorkflowStepPermission, string> = {
  Add: 'Creates bills',
  Submit: 'Submits bills for checking (new)',
  Edit: 'Edits bills',
  Verify: 'Checks figures and documents',
  Approve: 'Approves bills',
  Raise: 'Sends bills to the client (new)',
  Certify: 'Records the client’s certification',
  'Edit After Approval': 'Changes locked amounts',
  'Override Status': 'Overrides payment status',
};

/**
 * Pick the permissions that may do a step — any one is enough — by ticking them; the button lists
 * those chosen. At least one stays ticked, so a step can never be left to nobody.
 */
function PermissionPicker({ value, onChange, disabled }: { value: WorkflowStepPermission[]; onChange: (permissions: WorkflowStepPermission[]) => void; disabled?: boolean }) {
  const toggle = (entry: WorkflowStepPermission) => {
    if (value.includes(entry)) {
      if (value.length > 1) onChange(value.filter((item) => item !== entry));
    } else onChange(WORKFLOW_STEP_PERMISSIONS.filter((item) => item === entry || value.includes(item)));
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="h-auto min-h-10 w-full justify-between gap-2 py-1.5 font-normal">
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            <KeyRound className="mr-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            {value.map((entry) => (
              <span key={entry} className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
                {entry}
              </span>
            ))}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Bill Tracking · Bills — any one is enough</p>
        <ul>
          {WORKFLOW_STEP_PERMISSIONS.map((entry) => {
            const checked = value.includes(entry);
            return (
              <li key={entry}>
                <label className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50', checked && value.length === 1 && 'cursor-default')}>
                  <Checkbox checked={checked} disabled={checked && value.length === 1} onCheckedChange={() => toggle(entry)} />
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-800">{entry}</span>
                    <span className="block text-[11px] text-slate-500">{PERMISSION_HINTS[entry]}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Pick people from the active users: search, tick, and the chosen ones listed on the button. */
function UserPicker({ value, users, onChange, disabled, placeholder }: { value: string[]; users: UserOption[]; onChange: (userIds: string[]) => void; disabled?: boolean; placeholder: string }) {
  const [query, setQuery] = useState('');
  const nameOf = (id: string) => users.find((user) => user.id === id)?.name ?? 'Inactive user';
  const chosen = value.map(nameOf);
  const label = chosen.length === 0 ? placeholder : chosen.length <= 2 ? chosen.join(', ') : `${chosen.slice(0, 2).join(', ')} +${chosen.length - 2}`;
  const needle = query.trim().toLowerCase();
  const shown = users.filter((user) => !needle || user.name.toLowerCase().includes(needle) || user.email?.toLowerCase().includes(needle));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((entry) => entry !== id) : [...value, id]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className={cn('h-10 w-full justify-between gap-2 font-normal', !chosen.length && 'text-muted-foreground')}>
          <span className="flex min-w-0 items-center gap-2">
            <Users className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Input className="h-8" placeholder="Find a person" value={query} onChange={(event) => setQuery(event.target.value)} />
        <ul className="mt-2 max-h-64 overflow-y-auto">
          {shown.map((user) => (
            <li key={user.id}>
              <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                <Checkbox checked={value.includes(user.id)} onCheckedChange={() => toggle(user.id)} />
                <span className="min-w-0">
                  <span className="block truncate">{user.name}</span>
                  {user.email ? <span className="block truncate text-[11px] text-slate-400">{user.email}</span> : null}
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 ? <li className="px-2 py-3 text-center text-xs text-slate-500">No one matches.</li> : null}
        </ul>
        {value.length ? (
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 px-2 pt-2 text-xs text-slate-500">
            <span>{value.length} chosen</span>
            <button type="button" className="font-medium text-rose-700 hover:underline" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
