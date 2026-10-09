'use client';

/**
 * Settings → Workflow: the bill's stages, and for each one whether it is used, who moves a bill into
 * it (anyone with the permission, named people, or the bill's collection owner) and whether those
 * people are told when a bill is waiting for them — plus the rule that payment waits for the client's
 * certification.
 *
 * The stages and their order are fixed (reports and the receipt rule read them); everything else is
 * the configuration here, applied by `workflow.ts` on the server and the bill page alike. Being named
 * on a stage is the authority to do it: no role permission or project grant is needed on top.
 */

import { useState } from 'react';
import { ArrowDown, Bell, ChevronDown, ShieldCheck, Undo2, Users, Workflow } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { CERTIFIABLE_TYPES } from '@/lib/bill-tracking/certification';
import { OPTIONAL_STEPS, STEP_PERMISSION, WORKFLOW_ACTION_RULES, normaliseWorkflowSteps } from '@/lib/bill-tracking/workflow';
import { TRANSACTION_TYPE_LABELS, type BillWorkflowStatus, type CertificationReceiptRule, type WorkflowAssignment, type WorkflowStepSetting } from '@/lib/bill-tracking/types';
import { cn } from '@/lib/utils';

import { FormField, FormSection, WorkflowStatusBadge } from './bt-ui';

interface UserOption {
  id: string;
  name: string;
  email?: string;
}

const MEANING: Record<BillWorkflowStatus, string> = {
  draft: 'Entered and still being prepared. Everything can be edited.',
  submitted: 'Handed over for checking.',
  under_verification: 'Finance is checking the figures and documents.',
  verified: 'Checked.',
  approved: 'Approved. From here amounts, GST and deductions change only with Edit After Approval and a reason.',
  raised: 'Sent to the client and waiting for their certification.',
  certified: 'The client has certified it. If the client certified less or deducted more, raise the credit note the bill page fills in.',
  payment_followup: 'Chasing payment: follow-ups, commitments and receipts.',
  reconciliation: 'Checking receipts and deductions against the client’s statement.',
  closed: 'Settled. The same people can reopen it.',
  returned: '',
};

/** What moves a bill into each stage. */
const REACHED_BY: Partial<Record<BillWorkflowStatus, string>> = {
  submitted: WORKFLOW_ACTION_RULES.submit.label,
  under_verification: WORKFLOW_ACTION_RULES.start_verification.label,
  verified: WORKFLOW_ACTION_RULES.verify.label,
  approved: WORKFLOW_ACTION_RULES.approve.label,
  raised: WORKFLOW_ACTION_RULES.raise.label,
  certified: 'Recording the client’s certification',
  payment_followup: WORKFLOW_ACTION_RULES.start_followup.label,
  reconciliation: WORKFLOW_ACTION_RULES.reconcile.label,
  closed: `${WORKFLOW_ACTION_RULES.close.label} — once fully received or adjusted`,
};

export function WorkflowSettings({
  rule,
  onRuleChange,
  steps,
  onStepsChange,
  users,
  disabled,
}: {
  rule: CertificationReceiptRule;
  onRuleChange: (rule: CertificationReceiptRule) => void;
  steps: WorkflowStepSetting[];
  onStepsChange: (steps: WorkflowStepSetting[]) => void;
  users: UserOption[];
  disabled?: boolean;
}) {
  const setRule = (patch: Partial<CertificationReceiptRule>) => onRuleChange({ ...rule, ...patch });
  const list = normaliseWorkflowSteps(steps);
  const setStep = (status: BillWorkflowStatus, patch: Partial<WorkflowStepSetting>) => onStepsChange(list.map((step) => (step.status === status ? { ...step, ...patch } : step)));
  const named = list.filter((step) => step.assignment !== 'permission' && step.userIds.length).length;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <FormSection
        icon={Workflow}
        title="Bill workflow"
        description="For each stage: whether it is used, who moves a bill into it, and whether they are told when a bill is waiting for them. Being named on a stage is the permission to do it — no role permission or project grant is needed on top."
        actions={named ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">{named} stage{named === 1 ? '' : 's'} with named people</span> : null}
      >
        <ol>
          <StageRow index={0} status="draft" last={false}>
            <p className="text-xs text-slate-500">Anyone who can add bills (Bills · Add) creates a draft; the preparer edits it until it moves on.</p>
          </StageRow>
          {list.map((step, index) => (
            <StageRow key={step.status} index={index + 1} status={step.status} last={index === list.length - 1} off={!step.enabled}>
              <StepControls step={step} users={users} disabled={disabled} onChange={(patch) => setStep(step.status, patch)} />
            </StageRow>
          ))}
        </ol>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
          <b>Skipping stages.</b> Switched-off stages are left out: their button is not offered and a returned bill steps back past them. <b>Mark bill raised</b> is available from Draft onwards, and recording the client’s certification moves a bill to Certified from any earlier stage.
        </div>
        <div className="flex gap-3 rounded-lg border border-rose-100 bg-rose-50/60 p-3 text-xs text-rose-900">
          <Undo2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="leading-relaxed">
            <b>Returned for correction.</b> Whoever would move a bill on from Submitted up to Approved can return it with a note. It goes back to its preparer, who corrects and resubmits it to the stage before the one that returned it.
          </div>
        </div>
        <p className="text-xs text-slate-500">
          The <b>Stages</b> tab is a separate free-form label (the legacy STAGES column) shown on the bill; it does not move the workflow.
        </p>
      </FormSection>

      <div className="space-y-4 xl:self-start">
        <FormSection icon={ShieldCheck} title="Payment needs client certification" description="Recording or verifying a receipt is refused until the bill’s client certification is recorded.">
          <label className="flex items-start gap-3">
            <Switch className="mt-0.5" disabled={disabled} checked={rule.enabled} onCheckedChange={(value) => setRule({ enabled: value })} aria-label="Only receive payment against certified bills" />
            <span className="text-sm">
              <span className="font-medium text-slate-800">Only receive payment against certified bills</span>
              <span className="mt-0.5 block text-xs text-slate-500">{rule.enabled ? 'On — a bill must be certified before money is recorded against it.' : 'Off — receipts can be recorded against any bill.'}</span>
            </span>
          </label>

          <div className={cn('space-y-4', !rule.enabled && 'pointer-events-none opacity-50')} aria-disabled={!rule.enabled}>
            <FormField label="Applies to" hint="Credit and debit notes are never certified, so they are never blocked.">
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

            <label className="flex items-start gap-3">
              <Switch className="mt-0.5" disabled={disabled} checked={rule.exemptImported} onCheckedChange={(value) => setRule({ exemptImported: value })} aria-label="Leave out bills imported from the workbook" />
              <span className="text-sm">
                <span className="font-medium text-slate-800">Leave out bills imported from the workbook</span>
                <span className="mt-0.5 block text-xs text-slate-500">Their certificates were issued before SEL LIVE, so receipts can still be recorded against them.</span>
              </span>
            </label>

            <FormField label="Applies to bills dated from" hint="Blank = every bill. Bills dated earlier can take receipts without a certification." width="date">
              <Input type="date" disabled={disabled} value={rule.fromDate ?? ''} onChange={(event) => setRule({ fromDate: event.target.value || undefined })} />
            </FormField>
          </div>
        </FormSection>
      </div>
    </div>
  );
}

function StageRow({ index, status, last, off, children }: { index: number; status: BillWorkflowStatus; last: boolean; off?: boolean; children: React.ReactNode }) {
  const optional = OPTIONAL_STEPS.includes(status);
  const client = status === 'raised' || status === 'certified';
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last ? <span className="absolute bottom-0 left-[13px] top-7 w-px bg-slate-200" aria-hidden="true" /> : null}
      <span
        className={cn(
          'relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
          off ? 'border-dashed border-slate-300 bg-slate-50 text-slate-300' : client ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : optional ? 'border-dashed border-slate-300 bg-white text-slate-500' : 'border-slate-200 bg-white text-slate-600',
        )}
      >
        {index + 1}
      </span>
      <div className={cn('min-w-0 flex-1 space-y-2 pt-0.5', off && 'opacity-70')}>
        <div className="flex flex-wrap items-center gap-2">
          <WorkflowStatusBadge status={status} />
          {status === 'certified' ? <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Client step</span> : null}
          {optional ? <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Optional</span> : null}
          {off ? <span className="text-xs font-medium text-slate-400">Skipped</span> : null}
        </div>
        <p className="text-sm text-slate-700">{MEANING[status]}</p>
        {REACHED_BY[status] ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <ArrowDown className="h-3.5 w-3.5 rotate-180 text-slate-400" aria-hidden="true" />
            Reached by <span className="font-medium text-slate-700">{REACHED_BY[status]}</span>
          </p>
        ) : null}
        {children}
      </div>
    </li>
  );
}

function StepControls({ step, users, disabled, onChange }: { step: WorkflowStepSetting; users: UserOption[]; disabled?: boolean; onChange: (patch: Partial<WorkflowStepSetting>) => void }) {
  const optional = OPTIONAL_STEPS.includes(step.status);
  const permission = STEP_PERMISSION[step.status];
  const naming = step.assignment !== 'permission';
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      {optional ? (
        <label className="flex items-center gap-2 text-sm">
          <Switch disabled={disabled} checked={step.enabled} onCheckedChange={(value) => onChange({ enabled: value })} aria-label={`Use this stage`} />
          <span className="font-medium text-slate-800">{step.enabled ? 'Used' : 'Skipped — bills move past this stage'}</span>
        </label>
      ) : null}

      {step.enabled ? (
        <>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <FormField label="Moved here by" width="medium">
              <Select disabled={disabled} value={step.assignment} onValueChange={(value) => onChange({ assignment: value as WorkflowAssignment })}>
                <SelectTrigger aria-label="Moved here by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="permission">Anyone with {permission}</SelectItem>
                  <SelectItem value="users">Named people</SelectItem>
                  <SelectItem value="collection_owner">The bill’s collection owner</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {naming ? (
              <FormField label={step.assignment === 'collection_owner' ? 'Backup people' : 'People'} width="wide">
                <UserPicker value={step.userIds} users={users} disabled={disabled} onChange={(userIds) => onChange({ userIds })} placeholder={step.assignment === 'collection_owner' ? 'Nobody else' : 'Choose people'} />
              </FormField>
            ) : null}
          </div>

          {naming ? (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Switch disabled={disabled} checked={step.onlyAssigned} onCheckedChange={(value) => onChange({ onlyAssigned: value })} aria-label="Only these people" />
                <span>
                  Only them <span className="text-xs text-slate-500">— {step.onlyAssigned ? `people with ${permission} cannot do it` : `people with ${permission} can still do it`}</span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch disabled={disabled} checked={step.notify} onCheckedChange={(value) => onChange({ notify: value })} aria-label="Notify when a bill is waiting" />
                <Bell className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>Notify when a bill is waiting</span>
              </label>
            </div>
          ) : null}

          {step.assignment === 'users' && !step.userIds.length ? (
            <p className="text-xs text-amber-700">Nobody is named yet, so anyone with {permission} keeps doing it.</p>
          ) : step.assignment === 'collection_owner' ? (
            <p className="text-xs text-slate-500">The bill’s collection owner{step.userIds.length ? ' and the backup people' : ''}{step.onlyAssigned ? ' only' : `, plus anyone with ${permission}`}. A bill without an owner falls back to {step.userIds.length ? 'the backup people' : `anyone with ${permission}`}.</p>
          ) : null}
        </>
      ) : null}
    </div>
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
