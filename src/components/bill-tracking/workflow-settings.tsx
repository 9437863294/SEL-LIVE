'use client';

/**
 * Settings → Workflow: the bill's stages from draft to closed, what moves each one on and who may,
 * and the rule that payment waits for the client's certification.
 *
 * The stages themselves are fixed (the server's ACTION_RULES in `server/bills.ts` enforce them); the
 * certification rule is configuration, saved with the other settings.
 */

import { ArrowDown, ShieldCheck, Undo2, Workflow } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { CERTIFIABLE_TYPES } from '@/lib/bill-tracking/certification';
import { TRANSACTION_TYPE_LABELS, type BillWorkflowStatus, type CertificationReceiptRule } from '@/lib/bill-tracking/types';
import { cn } from '@/lib/utils';

import { FormField, FormSection, WorkflowStatusBadge } from './bt-ui';

interface Step {
  status: BillWorkflowStatus;
  meaning: string;
  /** What moves the bill to the next stage. */
  next?: string;
  /** The permission that action needs. */
  who?: string;
  /** Moved on by something else happening, not a workflow button. */
  automatic?: boolean;
  /** Can be skipped entirely. */
  optional?: boolean;
}

function steps(rule: CertificationReceiptRule): Step[] {
  return [
    { status: 'draft', meaning: 'Entered and still being prepared. Everything can be edited.', next: 'Submit — or Mark bill raised straight away', who: 'Bills · Edit' },
    { status: 'submitted', meaning: 'Handed over for checking.', next: 'Start verification, Verify or Approve — or Mark bill raised', who: 'Verify / Approve / Edit' },
    { status: 'under_verification', meaning: 'Finance is checking the figures and documents.', next: 'Verify or Approve — or Mark bill raised', who: 'Verify / Approve / Edit', optional: true },
    { status: 'verified', meaning: 'Checked.', next: 'Approve — or Mark bill raised', who: 'Approve / Edit', optional: true },
    { status: 'approved', meaning: 'Approved by an approver.', next: 'Mark bill raised', who: 'Bills · Edit', optional: true },
    {
      status: 'raised',
      meaning: `Sent to the client and waiting for their certification.${rule.enabled ? ' No payment can be received yet.' : ''} From here (as from Approved) amounts, GST and deductions change only with Edit After Approval and a reason.`,
      next: 'Record client certification — moves the bill on by itself',
      who: 'Bills · Certify',
      automatic: true,
    },
    {
      status: 'certified',
      meaning: `The client has certified it.${rule.enabled ? ' Receipts can now be recorded.' : ''} If the client certified less or deducted more, raise the credit note the bill page fills in.`,
      next: 'Start payment follow-up',
      who: 'Bills · Edit',
    },
    { status: 'payment_followup', meaning: 'Chasing payment: follow-ups, commitments and receipts.', next: 'Send to reconciliation', who: 'Bills · Verify' },
    { status: 'reconciliation', meaning: 'Checking receipts and deductions against the client’s statement.', next: 'Close bill — only once fully received or adjusted', who: 'Bills · Approve' },
    { status: 'closed', meaning: 'Settled. It can be reopened if something comes back.', next: 'Reopen', who: 'Bills · Approve' },
  ];
}

export function WorkflowSettings({ rule, onChange, disabled }: { rule: CertificationReceiptRule; onChange: (rule: CertificationReceiptRule) => void; disabled?: boolean }) {
  const set = (patch: Partial<CertificationReceiptRule>) => onChange({ ...rule, ...patch });
  const list = steps(rule);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <FormSection icon={Workflow} title="Bill workflow" description="The stages every bill moves through, what moves it on and who may. Each move is recorded in the bill’s activity.">
        <ol className="space-y-0">
          {list.map((step, index) => {
            const isCertification = step.status === 'certified' || step.status === 'raised';
            return (
              <li key={step.status} className="relative flex gap-3 pb-5 last:pb-0">
                {index < list.length - 1 ? <span className="absolute bottom-0 left-[13px] top-7 w-px bg-slate-200" aria-hidden="true" /> : null}
                <span className={cn('relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold', isCertification ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : step.optional ? 'border-dashed border-slate-300 bg-white text-slate-400' : 'border-slate-200 bg-white text-slate-600')}>{index + 1}</span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <WorkflowStatusBadge status={step.status} />
                    {step.status === 'certified' ? <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Client step</span> : null}
                    {step.optional ? <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Optional</span> : null}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">{step.meaning}</div>
                  {step.next ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <ArrowDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      <span className={cn('font-medium', step.automatic ? 'text-emerald-700' : 'text-slate-700')}>{step.next}</span>
                      {step.who ? <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px">{step.who}</span> : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
          <b>Optional steps.</b> Under verification, Verified and Approved can be skipped — use them only where a bill needs checking or approval. <b>Mark bill raised</b> is offered from Draft onwards, and recording the client’s certification moves a bill to Certified from any earlier step.
        </div>
        <div className="flex gap-3 rounded-lg border border-rose-100 bg-rose-50/60 p-3 text-xs text-rose-900">
          <Undo2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <div className="font-semibold">Returned for correction</div>
            <div className="mt-0.5 leading-relaxed">
              From Submitted up to Approved, a verifier can <b>Return for correction</b> with a note (Bills · Verify). The preparer corrects it and <b>resubmits</b> (Bills · Edit); it goes back to the step before the one that returned it.
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500">The <b>Stages</b> tab is a separate free-form label (the legacy STAGES column) shown on the bill; it does not move the workflow.</p>
      </FormSection>

      <div className="space-y-4 xl:self-start">
        <FormSection icon={ShieldCheck} title="Payment needs client certification" description="Recording or verifying a receipt is refused until the bill’s client certification is recorded.">
          <label className="flex items-start gap-3">
            <Switch className="mt-0.5" disabled={disabled} checked={rule.enabled} onCheckedChange={(value) => set({ enabled: value })} aria-label="Only receive payment against certified bills" />
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
                      onCheckedChange={(value) => set({ transactionTypes: value ? [...new Set([...rule.transactionTypes, type])] : rule.transactionTypes.filter((entry) => entry !== type) })}
                    />
                    {TRANSACTION_TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
            </FormField>

            <label className="flex items-start gap-3">
              <Switch className="mt-0.5" disabled={disabled} checked={rule.exemptImported} onCheckedChange={(value) => set({ exemptImported: value })} aria-label="Leave out bills imported from the workbook" />
              <span className="text-sm">
                <span className="font-medium text-slate-800">Leave out bills imported from the workbook</span>
                <span className="mt-0.5 block text-xs text-slate-500">Their certificates were issued before SEL LIVE, so receipts can still be recorded against them.</span>
              </span>
            </label>

            <FormField label="Applies to bills dated from" hint="Blank = every bill. Bills dated earlier can take receipts without a certification.">
              <Input type="date" disabled={disabled} value={rule.fromDate ?? ''} onChange={(event) => set({ fromDate: event.target.value || undefined })} />
            </FormField>
          </div>
        </FormSection>
      </div>
    </div>
  );
}
