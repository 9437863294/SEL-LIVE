'use client';

/**
 * GST & TDS verification of a Daily Requisition: how tax is split on the bill, what is deducted,
 * and what that leaves payable, worked out live (src/lib/statutory.ts verificationTotals) beside the
 * bill itself and a short list of checks.
 *
 * Two places open it:
 *   - The step that sends for payment ([step]/page.tsx), and whoever a requisition was handed to
 *     there (workflow-flow.tsx StageAssignedView), verify in place: the status becomes Verified — or
 *     Needs Review, with the net amount kept, when the figures do not come to it.
 *   - An approval step with Verify (GST & TDS) ticked (workflow-flow.tsx, `passOn`) records the
 *     figures as it passes the requisition on, and leaves the status and the net amount alone;
 *     figures that do not come to the net cannot go on.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
import { format } from 'date-fns';
import { Check, ClipboardCheck, ExternalLink, FileText, Info, Loader2, Minus, Percent, TriangleAlert, Undo2, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RegistrationSelect, useBillRegistration } from '@/components/expenses/bill-registration';
import { useToast } from '@/hooks/use-toast';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { diffFields } from '@/lib/activity-logger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { amountInWords } from '@/lib/daily-requisition-print';
import { db } from '@/lib/firebase';
import { registrationLabel } from '@/lib/gst-registrations';
import { isPaymentLocked } from '@/lib/requisition-progress';
import {
  checkGstin,
  COMPANY_GST_STATE_CODE,
  GST_RATES,
  normaliseTaxId,
  suggestGstType,
  TDS_SECTIONS,
  verificationTotals,
  type GstType,
} from '@/lib/statutory';
import type { DailyRequisitionEntry } from '@/lib/types';
import { cn } from '@/lib/utils';

interface GstTdsVerificationDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  entry: DailyRequisitionEntry | null;
  onSuccess: () => void;
  /**
   * At an approval step (src/components/daily-requisition/workflow-flow.tsx): the figures are
   * handed here to be written with the step's own pass-on, in its transaction, and the status is
   * left as it is — the requisition may not have reached Finance yet. Figures that do not agree
   * with the net amount cannot be passed on. Resolves true once it has gone on.
   */
  passOn?: { to: string; save: (figures: Record<string, unknown>) => Promise<boolean> };
  /** The step it is verified at, named in the header. */
  stepName?: string;
  /** Where it has been and goes next, for the header's steps: Received → Verify → Payment. */
  path?: { done: string; current: string; next: readonly string[] };
  /** The step's own way back, offered beside Verify. It closes this first. */
  sendBack?: { label: string; onClick: () => void };
}

/**
 * The statuses GST & TDS Verification owns. Verification rewrites the status and (when the figures
 * agree) the net amount, so it must only ever write to a requisition still sitting at this stage: a
 * requisition sent on for payment — or already part paid by a voucher — would otherwise be dragged
 * back to "Verified" with its payments still attached, reading as paid and still due at once.
 */
const VERIFIABLE_STATUSES = ['Received', 'Verified', 'Needs Review'] as const;

/** Thrown inside the save transaction when the stored requisition no longer allows verifying. */
const BLOCKED = 'VerificationBlocked';
const blocked = (message: string) => Object.assign(new Error(message), { name: BLOCKED });
const isBlocked = (error: unknown): error is Error => error instanceof Error && error.name === BLOCKED;

/** The GST rates offered as chips (no "0%": that is No GST). */
const RATE_CHIPS = GST_RATES.filter((rate) => rate > 0);
/** Retention, as a share of the taxable value; any other amount is typed. */
const RETENTION_CHIPS = [0, 5, 10] as const;

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);
/** A typed amount: blank or unreadable is null (worked out instead); never negative. */
const typedAmount = (text: string | null): number | null => {
  if (text === null || text.trim() === '') return null;
  const n = parseFloat(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.max(0, n) : null;
};
const asDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const withToDate = value as { toDate?: () => Date };
  if (typeof withToDate.toDate === 'function') return withToDate.toDate();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
/** "194C · 1%" — the section's code without its variant, and its standard rate. */
const sectionChipLabel = (code: string, rate: number) => (code === 'none' ? 'None' : `${code.split('-')[0]} · ${rate}%`);

/** What the form starts from: the entry's own figures, from its expense request or an earlier verification. */
function initialFigures(entry: DailyRequisitionEntry) {
  const gross = Number(entry.grossAmount) || 0;
  const storedGst = (entry.igstAmount || 0) + (entry.cgstAmount || 0) + (entry.sgstAmount || 0);
  const gstType: GstType = entry.gstType
    ? entry.gstType
    : (entry.igstAmount || 0) > 0
      ? 'igst'
      : (entry.cgstAmount || 0) > 0
        ? 'cgst-sgst'
        : 'none';
  // A request writes the taxable value as the gross, with the GST on top; a bill typed in with
  // nothing about GST usually carries its GST inside the gross.
  const gstInclusive = typeof entry.gstInclusive === 'boolean' ? entry.gstInclusive : storedGst <= 0;
  const gstRate =
    typeof entry.gstRate === 'number' && entry.gstRate > 0
      ? entry.gstRate
      : storedGst > 0 && gross > 0
        ? Math.round((storedGst / gross) * 10000) / 100
        : 18;
  const base = { gross, gstType, gstRate, gstInclusive, reverseCharge: Boolean(entry.reverseCharge) };
  const taxable = verificationTotals({ ...base, tdsRate: 0, tdsOverride: null, retentionRate: 0, retentionOverride: null, otherDeduction: 0 }).taxable;

  // TDS: the section it carries, at its rate; an amount that rate does not give was typed.
  const section = TDS_SECTIONS.find((s) => s.code === entry.tdsSection);
  const storedTds = Number(entry.tdsAmount) || 0;
  const tdsCode = section ? section.code : storedTds > 0 ? '' : 'none';
  const tdsRate = section ? (typeof entry.tdsRate === 'number' && entry.tdsRate > 0 ? entry.tdsRate : section.rate) : 0;
  const tdsText = storedTds > 0 && Math.abs(round2((taxable * tdsRate) / 100) - storedTds) > 0.01 ? String(storedTds) : null;

  // Retention: 5% or 10% when it is exactly that, else the amount as typed.
  const storedRetention = Number(entry.retentionAmount) || 0;
  const retentionRate = RETENTION_CHIPS.find((p) => p > 0 && Math.abs(round2((taxable * p) / 100) - storedRetention) <= 0.01) ?? 0;
  const retentionText = storedRetention > 0 && retentionRate === 0 ? String(storedRetention) : null;

  return {
    gstType,
    gstRate,
    gstInclusive,
    gstNo: entry.gstNo || '',
    gstRegistrationId: entry.gstRegistrationId || '',
    tdsCode,
    tdsRate,
    tdsText,
    retentionRate: retentionRate as number,
    retentionText,
    otherText: (Number(entry.otherDeduction) || 0) > 0 ? String(entry.otherDeduction) : '',
    otherReason: entry.otherDeductionReason || '',
    notes: entry.verificationNotes || '',
  };
}

/* ── the dialog ─────────────────────────────────────────────────────────── */

/**
 * For a dialog whose header is a coloured band (this one, and workflow-flow.tsx's Hand over): the
 * dialog's own window buttons and × sit on it in white.
 */
export const BANNER_DIALOG_CLASS =
  '[&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-90 [&_[data-slot=dialog-close]]:data-[state=open]:bg-transparent [&_[data-slot=dialog-close]]:data-[state=open]:text-white [&_[data-slot=dialog-window-controls]]:text-white';

export function GstTdsVerificationDialog(props: GstTdsVerificationDialogProps) {
  const { isOpen, onOpenChange, entry } = props;
  if (!entry) return null;
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        windowTitle={`Verify ${entry.receptionNo || 'entry'}`}
        className={cn('max-w-[98vw] gap-0 p-0 sm:max-w-[1080px]', BANNER_DIALOG_CLASS)}
        style={{ scrollbarGutter: 'auto' }}
      >
        {/* Keyed by the requisition, so each one opens on its own figures. */}
        <VerifyEntryForm key={entry.id} {...props} entry={entry} />
      </DialogContent>
    </Dialog>
  );
}

/* ── the form ───────────────────────────────────────────────────────────── */

function VerifyEntryForm({
  onOpenChange,
  entry,
  onSuccess,
  passOn,
  stepName,
  path,
  sendBack,
}: GstTdsVerificationDialogProps & { entry: DailyRequisitionEntry }) {
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const [start] = useState(() => initialFigures(entry));

  const [gstType, setGstType] = useState<GstType>(start.gstType);
  const [gstRate, setGstRate] = useState(start.gstRate);
  const [gstInclusive, setGstInclusive] = useState(start.gstInclusive);
  const [gstNo, setGstNo] = useState(start.gstNo);
  /** The company GST registration chosen on this bill; '' leaves it to the attribution chain. */
  const [gstRegistrationId, setGstRegistrationId] = useState(start.gstRegistrationId);
  /** The TDS section's code; '' when an amount is recorded with no section. */
  const [tdsCode, setTdsCode] = useState(start.tdsCode);
  const [tdsRate, setTdsRate] = useState(start.tdsRate);
  /** A typed TDS amount; null while it is worked out from the rate. */
  const [tdsText, setTdsText] = useState<string | null>(start.tdsText);
  const [retentionRate, setRetentionRate] = useState(start.retentionRate);
  const [retentionText, setRetentionText] = useState<string | null>(start.retentionText);
  /** Retention is an amount typed in (not 5% or 10% of the taxable value). */
  const [retentionCustom, setRetentionCustom] = useState(start.retentionText !== null);
  /** Retention is held back on this bill (switched on; then 5%, 10% or an amount). */
  const [retentionOn, setRetentionOn] = useState(start.retentionText !== null || start.retentionRate > 0);
  const [otherText, setOtherText] = useState(start.otherText);
  const [otherReason, setOtherReason] = useState(start.otherReason);
  /** The other deduction is being entered (opened with its button, or already carried). */
  const [otherOpen, setOtherOpen] = useState(Boolean(start.otherText || start.otherReason));
  const [notes, setNotes] = useState(start.notes);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Which of the company's registrations this bill belongs to: the choice made here, else the
   * project's state, else the department's, else the default (src/lib/gst-registrations.ts). It is
   * that registration's state — not one hardcoded state — that decides CGST + SGST versus IGST.
   */
  const bill = useBillRegistration({ gstRegistrationId, projectId: entry.projectId, departmentId: entry.departmentId });

  const gross = Number(entry.grossAmount) || 0;
  const originalNet = Number(entry.netAmount || entry.grossAmount) || 0;
  const reverseCharge = Boolean(entry.reverseCharge);
  const hasGst = gstType !== 'none';
  const canInclude = hasGst && !reverseCharge;
  const inclusive = canInclude && gstInclusive;
  const otherAmount = otherOpen ? (typedAmount(otherText) ?? 0) : 0;
  const hasTds = tdsCode !== 'none';
  const hasRetention = retentionOn && (retentionCustom || retentionRate > 0);

  const totals = useMemo(
    () =>
      verificationTotals({
        gross,
        gstType,
        gstRate,
        gstInclusive: inclusive,
        reverseCharge,
        tdsRate: tdsCode === 'none' || tdsCode === '' ? 0 : tdsRate,
        tdsOverride: tdsCode === 'none' ? null : typedAmount(tdsText),
        retentionRate: hasRetention ? retentionRate : 0,
        retentionOverride: hasRetention ? typedAmount(retentionText) : null,
        otherDeduction: otherAmount,
      }),
    [gross, gstType, gstRate, inclusive, reverseCharge, tdsCode, tdsRate, tdsText, hasRetention, retentionRate, retentionText, otherAmount],
  );
  const difference = round2(totals.net - originalNet);
  const amountMismatch = Math.abs(difference) > 0.01;

  /* ── the party's GSTIN ── */
  const gstin = normaliseTaxId(gstNo);
  const gstinCheck = gstin.length === 15 ? checkGstin(gstin) : null;
  const gstinValid = Boolean(gstinCheck?.valid);
  // Judged against the bill's registration; '' (attributed to none) leaves it unjudged.
  const companyState = bill.companyStateCode === undefined ? COMPANY_GST_STATE_CODE : bill.companyStateCode;
  const expectedType = gstinValid && companyState ? suggestGstType(gstinCheck?.stateCode, companyState) : null;
  const suggestType = expectedType && expectedType !== gstType ? expectedType : null;
  const gstinTone: HintTone = !gstin ? 'muted' : gstin.length < 15 ? 'warn' : gstinValid ? 'ok' : 'bad';
  const gstinText = !gstin
    ? "15 characters. Leave blank if the party isn't GST-registered."
    : gstin.length < 15
      ? `${gstin.length}/15 characters`
      : gstinValid
        ? `Valid · ${gstinCheck?.stateName} · PAN ${gstinCheck?.pan}`
        : (gstinCheck?.error ?? "Doesn't look like a valid GSTIN");

  /* ── before verifying ── */
  const needsGstin = hasGst && !reverseCharge;
  // Only the checks that apply to what is being recorded: nothing about GST on a bill without it.
  const checks = [
    ...(needsGstin ? [{ ok: gstinValid, label: 'Party GSTIN valid for a GST bill', blocking: true }] : []),
    ...(hasGst || tdsCode === '' ? [{ ok: tdsCode !== '' && tdsCode !== 'none', label: 'TDS section chosen', blocking: false }] : []),
    ...(otherOpen && totals.other > 0 ? [{ ok: otherReason.trim().length > 2, label: 'Reason given for other deduction', blocking: true }] : []),
    { ok: totals.net > 0, label: 'Net payable above zero', blocking: true },
    {
      ok: !amountMismatch,
      label: !amountMismatch
        ? "Net matches the requisition's"
        : passOn
          ? "Net must match the requisition's to go on"
          : "Net differs: it will be marked for review",
      blocking: Boolean(passOn),
    },
  ];
  const isBlockedNow = checks.some((c) => c.blocking && !c.ok);
  const primaryLabel = passOn ? `Verify & send to ${passOn.to}` : amountMismatch ? 'Mark for review' : 'Mark as verified';
  const summary = `${hasGst ? `${gstType === 'igst' ? 'IGST' : 'CGST + SGST'} ${gstRate}%` : 'no GST'} · TDS ${inr(totals.tds)} · net ${inr(totals.net)}`;

  const setType = (next: GstType) => {
    setGstType(next);
    if (next !== 'none' && !(gstRate > 0)) setGstRate(18);
  };

  /** Another registration can make the same bill inter-state, so the split is suggested afresh. */
  const onRegistrationChange = (next: string) => {
    setGstRegistrationId(next);
    const chosen = next ? (bill.options.find((registration) => registration.id === next) ?? null) : bill.automatic;
    if (hasGst && gstinValid && gstinCheck?.stateCode && chosen?.stateCode) setGstType(suggestGstType(gstinCheck.stateCode, chosen.stateCode));
  };

  /* ── saving ── */
  const handleVerify = async () => {
    if (isBlockedNow || isSaving) return;
    setIsSaving(true);
    const newStatus = amountMismatch ? 'Needs Review' : 'Verified';
    const figures: Record<string, unknown> = {
      verifiedAt: new Date(),
      igstAmount: totals.igst,
      cgstAmount: totals.cgst,
      sgstAmount: totals.sgst,
      tdsAmount: totals.tds,
      retentionAmount: totals.retention,
      otherDeduction: totals.other,
      otherDeductionReason: totals.other > 0 ? otherReason.trim() : '',
      verificationNotes: notes,
      gstNo: hasGst ? gstin : '',
      gstType,
      gstRate: hasGst ? gstRate : 0,
      gstInclusive: inclusive,
      taxableValue: totals.taxable,
      tdsSection: tdsCode,
      tdsRate: tdsCode === 'none' || tdsCode === '' ? 0 : tdsRate,
    };
    // Written only where there is something to choose and the choice has moved, so a one-state
    // company's verification diff reads exactly as it did before.
    if (bill.canChoose && (entry.gstRegistrationId || '') !== gstRegistrationId) figures.gstRegistrationId = gstRegistrationId;

    // Audit: what the verifier changed — the tax and amount fields this form owns.
    const { verifiedAt: _verifiedAt, ...taxAfter } = figures;
    const taxBefore: Record<string, unknown> = {};
    for (const key of Object.keys(taxAfter)) taxBefore[key] = (entry as unknown as Record<string, unknown>)[key] ?? null;
    const registration = bill.canChoose ? { gstRegistration: registrationLabel(bill.registration) } : {};

    try {
      // At an approval step: the figures go on with the step's pass-on; the status and the net stay.
      if (passOn) {
        const passed = await passOn.save(figures);
        if (!passed) return;
        void log(
          'Verify GST & TDS',
          {
            receptionNo: entry.receptionNo ?? null,
            partyName: entry.partyName ?? null,
            grossAmount: entry.grossAmount ?? 0,
            atApprovalStep: true,
            sentTo: passOn.to,
            ...registration,
            changes: diffFields(taxBefore, taxAfter),
          },
          { recordId: entry.id, recordRef: entry.receptionNo || undefined },
        );
        onSuccess();
        onOpenChange(false);
        return;
      }

      const update: Record<string, unknown> = { ...figures, status: newStatus };
      // Only a net the figures agree with is written; otherwise the old amount is kept for review.
      if (!amountMismatch) update.netAmount = totals.net;

      // Re-read inside a transaction: a voucher may have paid this requisition, or someone else may
      // have sent it on, while the form was open. Either way the verification is refused rather
      // than written over what has happened since.
      const requisitionRef = doc(db, 'dailyRequisitions', entry.id);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(requisitionRef);
        if (!snap.exists()) throw blocked(`${entry.receptionNo || 'This requisition'} no longer exists.`);
        const current = snap.data() as DailyRequisitionEntry;
        if (isPaymentLocked(current)) {
          throw blocked(
            `${entry.receptionNo || 'This requisition'} has payments against it, so its verification can no longer be changed. Reverse the voucher in the Bank Balance Cheque Register first.`,
          );
        }
        if (!VERIFIABLE_STATUSES.includes((current.status ?? '') as (typeof VERIFIABLE_STATUSES)[number])) {
          throw blocked(`${entry.receptionNo || 'This requisition'} is now "${current.status || 'Pending'}", so it was not verified. Refresh and try again.`);
        }
        tx.update(requisitionRef, update);
      });

      void log(
        newStatus === 'Verified' ? 'Verify GST & TDS' : 'Mark GST & TDS Needs Review',
        {
          receptionNo: entry.receptionNo ?? null,
          partyName: entry.partyName ?? null,
          grossAmount: entry.grossAmount ?? 0,
          from: entry.status ?? null,
          to: newStatus,
          ...registration,
          amountMismatch,
          ...(amountMismatch ? { calculatedNetAmount: totals.net, preservedNetAmount: originalNet } : {}),
          changes: diffFields(taxBefore, taxAfter),
        },
        { recordId: entry.id, recordRef: entry.receptionNo || undefined },
      );
      toast({
        title: amountMismatch ? 'Marked for review' : 'Verified',
        description: amountMismatch
          ? `${entry.receptionNo}: the figures come to ${inr(totals.net)}, not ${inr(originalNet)}. Its net amount was kept.`
          : `${entry.receptionNo} is verified.`,
      });
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      if (isBlocked(error)) {
        toast({ title: 'Not verified', description: error.message, variant: 'destructive' });
        // The queue is out of date: refresh it and close, so the row is reopened as it now stands.
        onSuccess();
        onOpenChange(false);
      } else {
        console.error('Error verifying entry: ', error);
        toast({ title: 'Error', description: 'Failed to save verification details.', variant: 'destructive' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  /* ── the page around it ── */
  const receivedAt = asDate(entry.receivedAt);
  const dated = receivedAt ?? asDate(entry.date);
  const projectName = (entry as { projectName?: string }).projectName || 'N/A';
  const steps = path ?? { done: 'Received', current: 'Verify', next: ['Payment'] };
  const attachments = (entry.attachments ?? []).filter((a) => a?.url);
  const invoiceFacts = [
    entry.invoiceNo ? `Invoice ${entry.invoiceNo}${entry.invoiceDate ? ` · ${entry.invoiceDate}` : ''}` : '',
    entry.panNo ? `PAN ${entry.panNo}` : '',
    entry.hsnSac ? `HSN / SAC ${entry.hsnSac}` : '',
  ].filter(Boolean);
  const breakdown: Array<{ label: string; value: number; colour: string; kind: 'base' | 'minus' | 'aside' }> = [
    { label: 'Gross amount', value: gross, colour: '#93c5fd', kind: 'base' },
    ...(hasGst && reverseCharge ? [{ label: 'GST (reverse charge, not paid to the party)', value: totals.gst, colour: '#c7d2fe', kind: 'aside' as const }] : []),
    ...(hasGst && !reverseCharge && !inclusive ? [{ label: '+ GST added', value: totals.gst, colour: '#a5b4fc', kind: 'base' as const }] : []),
    ...(hasGst && inclusive ? [{ label: 'incl. GST', value: totals.gst, colour: '#c7d2fe', kind: 'aside' as const }] : []),
    // Each deduction only once there is one: a bill with none reads gross, then net.
    ...(totals.tds > 0 ? [{ label: '− TDS', value: totals.tds, colour: '#fb7185', kind: 'minus' as const }] : []),
    ...(totals.retention > 0 ? [{ label: '− Retention', value: totals.retention, colour: '#fdba74', kind: 'minus' as const }] : []),
    ...(totals.other > 0 ? [{ label: '− Other', value: totals.other, colour: '#fcd34d', kind: 'minus' as const }] : []),
  ];
  const share = (n: number) => `${totals.invoice > 0 ? Math.max(0, Math.min(100, (n / totals.invoice) * 100)) : 0}%`;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          void handleVerify();
        }
      }}
    >
      {/* ── header ── */}
      <header className="keep-light relative flex shrink-0 items-center gap-3.5 overflow-hidden bg-gradient-to-r from-teal-700 via-blue-600 to-violet-600 py-4 pl-5 pr-24 text-white">
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(420px_200px_at_95%_0%,rgba(167,139,250,0.69),transparent_65%)]" aria-hidden />
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-white/20">
          <ClipboardCheck className="h-[22px] w-[22px]" />
        </span>
        <div className="relative min-w-0">
          <p className="truncate text-[11.5px] font-bold uppercase tracking-[0.08em] text-white/75">
            Daily Requisition · {stepName ?? 'GST & TDS Verification'}
          </p>
          <DialogTitle className="mt-0.5 flex flex-wrap items-center gap-2.5 text-[19px] font-extrabold leading-tight text-white">
            Verify entry
            <span className="rounded-lg bg-white/20 px-2 py-px font-mono text-[15px] font-bold">{entry.receptionNo}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Record the GST split and deductions on this bill; the net payable is worked out as you go.
          </DialogDescription>
        </div>
        <ol className="relative ml-auto hidden items-center gap-1.5 text-[11.5px] font-bold lg:flex" aria-label="Where it is">
          <StepDot state="done" label={steps.done} />
          <StepDot state="current" label={steps.current} number={2} />
          {steps.next.map((label, i) => (
            <StepDot key={label} state="next" label={label} number={3 + i} />
          ))}
        </ol>
      </header>

      {/* ── body ── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
        <div className="min-w-0 px-4 py-4 sm:px-5 lg:overflow-y-auto">
          <div className="mb-4 grid grid-cols-2 gap-2.5 rounded-2xl border bg-slate-50 px-3.5 py-3 sm:grid-cols-4">
            <Fact label="Project" value={projectName} />
            <Fact label="Party" value={entry.partyName || '—'} />
            <Fact label={receivedAt ? 'Received' : 'Dated'} value={dated ? format(dated, 'd MMM yyyy') : '—'} />
            <Fact label="Gross amount" value={inr(gross)} big />
            {(invoiceFacts.length > 0 || reverseCharge) && (
              <p className="col-span-2 border-t pt-2 text-xs text-muted-foreground sm:col-span-4">
                {invoiceFacts.join(' · ')}
                {reverseCharge && <span className="font-semibold text-amber-700">{invoiceFacts.length ? ' · ' : ''}Reverse charge</span>}
              </p>
            )}
          </div>

          {/* GST: its type first; the rest only once the bill has GST. */}
          <FormSection icon={Percent} from="from-blue-300" to="to-blue-700" title="GST" hint="How tax is split on this bill">
            <FieldTitle>GST type</FieldTitle>
            <Segmented
              value={gstType}
              onChange={(value) => setType(value as GstType)}
              options={[
                { value: 'igst', label: 'IGST', sub: 'Other state' },
                { value: 'cgst-sgst', label: 'CGST + SGST', sub: 'Same state' },
                { value: 'none', label: 'No GST', sub: 'Exempt / unregistered' },
              ]}
            />

            {hasGst ? (
              <>
                <div className="mt-3.5 grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_1fr]">
                  <div className="min-w-0">
                    <FieldTitle>Our GST registration</FieldTitle>
                    {bill.canChoose ? (
                      <RegistrationSelect id="verify-registration" value={gstRegistrationId} onValueChange={onRegistrationChange} bill={bill} className="rounded-[11px]" />
                    ) : (
                      <p className="truncate rounded-[11px] border bg-slate-50 px-3 py-2 text-sm">
                        {bill.registration ? `${registrationLabel(bill.registration)} · ${bill.registration.gstin}` : 'Not set'}
                      </p>
                    )}
                    <Hint>{bill.attribution.reason}</Hint>
                  </div>
                  <div className="min-w-0">
                    <FieldTitle htmlFor="verify-gstin">
                      Party&apos;s GSTIN <em className="font-semibold not-italic text-muted-foreground">(from the bill)</em>
                    </FieldTitle>
                    <Input
                      id="verify-gstin"
                      value={gstNo}
                      maxLength={15}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="e.g. 21ABCDE1234F1Z5"
                      onChange={(event) => setGstNo(event.target.value.toUpperCase())}
                      className={cn('rounded-[11px] font-mono uppercase', gstinTone === 'bad' && 'border-rose-300', gstinTone === 'ok' && 'border-green-300')}
                    />
                    <Hint tone={gstinTone}>
                      {gstinTone === 'ok' ? (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      ) : gstinTone === 'bad' || gstinTone === 'warn' ? (
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                      ) : null}
                      <span>
                        {gstinText}
                        {suggestType && (
                          <>
                            {' · '}
                            <button type="button" className="font-extrabold text-indigo-600 hover:underline" onClick={() => setType(suggestType)}>
                              {suggestType === 'cgst-sgst' ? 'Same state: use CGST + SGST' : 'Other state: use IGST'}
                            </button>
                          </>
                        )}
                      </span>
                    </Hint>
                  </div>
                </div>

                <div className="mt-3.5 flex flex-wrap items-end gap-x-4 gap-y-3">
                  <div>
                    <FieldTitle>Rate</FieldTitle>
                    <div className="flex flex-wrap gap-1.5">
                      {RATE_CHIPS.map((rate) => (
                        <Chip key={rate} on={gstRate === rate} onClick={() => setGstRate(rate)}>
                          {rate}%
                        </Chip>
                      ))}
                    </div>
                  </div>
                  {/* Under reverse charge the supplier charges none, so there is none inside the gross to ask about. */}
                  {canInclude && (
                    <div>
                      <FieldTitle>Gross includes GST?</FieldTitle>
                      <Segmented
                        value={inclusive ? 'yes' : 'no'}
                        onChange={(value) => setGstInclusive(value === 'yes')}
                        options={[
                          { value: 'yes', label: 'Yes' },
                          { value: 'no', label: 'No, add on top' },
                        ]}
                      />
                    </div>
                  )}
                </div>

                <div className="mt-3 grid gap-2">
                  <TaxLine label="Taxable value" value={totals.taxable} highlight />
                  {gstType === 'igst' ? (
                    <TaxLine label={`IGST · ${gstRate}%`} value={totals.igst} />
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <TaxLine label={`CGST · ${gstRate / 2}%`} value={totals.cgst} />
                      <TaxLine label={`SGST · ${gstRate / 2}%`} value={totals.sgst} />
                    </div>
                  )}
                  <Hint>
                    {reverseCharge
                      ? 'Reverse charge: the company pays this GST to the government, so it is not added to what the party is paid.'
                      : inclusive
                        ? `Worked out from the gross: ${inr(gross)} ÷ ${1 + gstRate / 100} = taxable value.`
                        : `Added on top of the gross, so the bill total is ${inr(totals.invoice)}.`}
                  </Hint>
                </div>
              </>
            ) : (
              <p className="mt-3 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-[12.5px] text-muted-foreground">
                <Info className="h-4 w-4 shrink-0" />
                No GST on this bill. The whole gross amount is the taxable value for TDS and retention.
              </p>
            )}
          </FormSection>

          {/* Deductions: each switched on first; its choices and amount only then. */}
          <FormSection icon={Minus} from="from-rose-300" to="to-rose-700" title="Deductions" hint="Taken off what we pay the party">
            <DeductionRow
              title="TDS"
              hint={
                !hasTds
                  ? 'Not deducted on this bill'
                  : tdsCode === ''
                    ? 'Choose the section it is deducted under'
                    : `Worked out on the taxable value at ${tdsRate}%; type over it if the bill differs`
              }
              on={hasTds}
              offLabel="No TDS"
              onLabel="Deduct TDS"
              onToggle={(on) => {
                setTdsCode(on ? '' : 'none');
                setTdsText(null);
              }}
              control={
                <div className="flex flex-wrap gap-1.5">
                  {TDS_SECTIONS.filter((section) => section.code !== 'none').map((section) => (
                    <Chip
                      key={section.code}
                      on={tdsCode === section.code}
                      title={section.label}
                      onClick={() => {
                        setTdsCode(section.code);
                        setTdsRate(section.rate);
                        setTdsText(null);
                      }}
                    >
                      {sectionChipLabel(section.code, section.rate)}
                    </Chip>
                  ))}
                </div>
              }
              amount={
                tdsCode !== '' || tdsText !== null ? (
                  <MoneyInput id="verify-tds" label="TDS amount" text={tdsText} worked={totals.tds} onText={setTdsText} />
                ) : null
              }
            />
            <DeductionRow
              title="Retention"
              hint={
                !retentionOn
                  ? 'Held back until the work is accepted'
                  : !hasRetention
                    ? 'Choose how much is held back'
                    : retentionCustom
                      ? 'The amount held back, as typed'
                      : `${retentionRate}% of the taxable value; type over it if it differs`
              }
              on={retentionOn}
              offLabel="No retention"
              onLabel="Hold back"
              onToggle={(on) => {
                setRetentionOn(on);
                setRetentionRate(0);
                setRetentionCustom(false);
                setRetentionText(null);
              }}
              control={
                <div className="flex flex-wrap gap-1.5">
                  {RETENTION_CHIPS.filter((rate) => rate > 0).map((rate) => (
                    <Chip
                      key={rate}
                      on={!retentionCustom && retentionRate === rate}
                      onClick={() => {
                        setRetentionRate(rate);
                        setRetentionCustom(false);
                        setRetentionText(null);
                      }}
                    >
                      {rate}%
                    </Chip>
                  ))}
                  <Chip
                    on={retentionCustom}
                    onClick={() => {
                      setRetentionRate(0);
                      setRetentionCustom(true);
                      setRetentionText('');
                    }}
                  >
                    Other amount
                  </Chip>
                </div>
              }
              amount={
                hasRetention ? (
                  <MoneyInput
                    id="verify-retention"
                    label="Retention amount"
                    text={retentionText}
                    worked={totals.retention}
                    plain={retentionCustom}
                    onText={(text) => setRetentionText(retentionCustom ? (text ?? '') : text)}
                  />
                ) : null
              }
            />
            <DeductionRow
              title="Other deduction"
              hint="Penalty, advance recovery, short supply…"
              on={otherOpen}
              offLabel="None"
              onLabel="Deduct"
              onToggle={(on) => {
                setOtherOpen(on);
                setOtherText('');
                setOtherReason('');
              }}
              control={
                <Input
                  value={otherReason}
                  onChange={(event) => setOtherReason(event.target.value)}
                  placeholder="What it is for"
                  aria-label="Reason for the other deduction"
                  className={cn('rounded-[11px]', totals.other > 0 && otherReason.trim().length <= 2 && 'border-amber-300')}
                />
              }
              amount={<MoneyInput id="verify-other" label="Amount" text={otherText} worked={0} plain onText={(text) => setOtherText(text ?? '')} />}
            />
          </FormSection>

          <FieldTitle htmlFor="verify-notes">
            {passOn ? `Note for ${passOn.to}` : 'Notes'} <em className="font-semibold not-italic text-muted-foreground">(optional)</em>
          </FieldTitle>
          <Textarea
            id="verify-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. TDS at 1% under 194C; party is an individual contractor"
            className="min-h-[58px] resize-y rounded-[11px]"
          />
        </div>

        {/* ── the side: what it comes to, the bill, the checks ── */}
        <aside className="flex min-w-0 flex-col gap-3.5 border-t bg-slate-50 p-4 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <SideBox title="Payable breakdown" aside="live">
            <div className="px-3.5 pb-2">
              {breakdown.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-2 py-1.5 text-[12.5px]">
                  <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <i className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: row.colour }} />
                    <span className="truncate">{row.label}</span>
                  </span>
                  <b
                    className={cn(
                      'shrink-0 tabular-nums',
                      row.kind === 'minus' && row.value > 0 && 'text-rose-700',
                      row.kind === 'aside' && 'font-semibold text-muted-foreground',
                    )}
                  >
                    {row.kind === 'minus' && row.value > 0 ? '−' : ''}
                    {inr(row.value)}
                  </b>
                </div>
              ))}
              <div className="mb-1 mt-1 flex h-3 overflow-hidden rounded-md bg-slate-200" aria-hidden>
                <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-700 transition-all" style={{ width: share(totals.net) }} />
                <div className="h-full bg-rose-400" style={{ width: share(totals.tds) }} />
                <div className="h-full bg-orange-300" style={{ width: share(totals.retention) }} />
                <div className="h-full bg-amber-300" style={{ width: share(totals.other) }} />
              </div>
            </div>
            <div className="mx-3.5 mb-3.5 rounded-[14px] border border-green-200 bg-gradient-to-r from-emerald-50 to-blue-50 px-3.5 py-3">
              <small className="block text-[11px] font-extrabold uppercase tracking-[0.06em] text-emerald-700">Net payable</small>
              <b className="block text-[26px] font-extrabold leading-tight tracking-tight tabular-nums">{inr(totals.net)}</b>
              <span className="block text-[11.5px] text-muted-foreground">{amountInWords(totals.net)}</span>
              <p className={cn('mt-1.5 text-xs font-bold', !amountMismatch ? 'text-muted-foreground' : difference < 0 ? 'text-rose-700' : 'text-amber-700')}>
                {!amountMismatch
                  ? "Same as the requisition's net amount"
                  : `${difference < 0 ? '▼' : '▲'} ${inr(Math.abs(difference))} vs the requisition's net ${inr(originalNet)}`}
              </p>
              {amountMismatch && (
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  {passOn
                    ? 'It cannot go on until they agree: correct the figures, or have the net amount corrected on the Entry Sheet.'
                    : 'Saving marks it for review and keeps the requisition’s net amount.'}
                </p>
              )}
            </div>
          </SideBox>

          <SideBox title="Bill attached" aside={attachments.length > 1 ? `${attachments.length} files` : undefined}>
            {attachments.length > 0 ? (
              <div className="flex items-center gap-2.5 px-3.5 pb-3">
                <span className="grid h-[66px] w-[54px] shrink-0 place-items-center rounded-lg border bg-gradient-to-b from-white to-slate-100">
                  <FileText className="h-5 w-5 text-blue-500" />
                </span>
                <div className="min-w-0">
                  <b className="block truncate text-[12.5px]" title={attachments[0].name}>
                    {attachments[0].name || 'Bill'}
                  </b>
                  {attachments.length > 1 && <small className="block text-[11.5px] text-muted-foreground">+ {attachments.length - 1} more</small>}
                  <button
                    type="button"
                    className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline"
                    // Its own window beside this one, so the bill can be read while the figures are typed.
                    onClick={() => window.open(attachments[0].url, 'sel-verify-bill', 'popup=yes,width=760,height=960,left=0,top=0')}
                  >
                    Open side by side <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ) : (
              <p className="px-3.5 pb-3 text-[12.5px] text-muted-foreground">No bill is attached to this requisition.</p>
            )}
          </SideBox>

          <SideBox title="Before you verify">
            <ul className="space-y-0.5 px-3.5 pb-3">
              {checks.map((check) => (
                <li key={check.label} className="flex items-center gap-2 py-0.5 text-[12.5px] font-semibold">
                  <span
                    className={cn(
                      'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full',
                      check.ok ? 'bg-green-100 text-green-700' : check.blocking ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700',
                    )}
                  >
                    {check.ok ? <Check className="h-[11px] w-[11px]" strokeWidth={3} /> : <span className="text-[11px] font-black leading-none">!</span>}
                  </span>
                  {check.label}
                </li>
              ))}
            </ul>
          </SideBox>
        </aside>
      </div>

      {/* ── footer ── */}
      <footer className="flex shrink-0 flex-wrap items-center gap-2.5 border-t bg-background px-4 py-3 sm:px-5">
        <p className="min-w-0 text-[12.5px] text-muted-foreground">
          Recording <b className="text-[15px] text-foreground">{summary}</b>
        </p>
        <span className="hidden flex-1 sm:block" />
        <DialogClose asChild>
          <Button variant="outline" disabled={isSaving}>
            Cancel
          </Button>
        </DialogClose>
        {sendBack && (
          <Button
            variant="outline"
            className="border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
            disabled={isSaving}
            onClick={() => {
              onOpenChange(false);
              sendBack.onClick();
            }}
          >
            <Undo2 className="mr-1.5 h-4 w-4" /> {sendBack.label}
          </Button>
        )}
        <Button
          className="border-0 bg-gradient-to-r from-teal-700 via-blue-600 to-violet-600 text-white shadow-[0_10px_22px_-12px_#4f46e5] hover:opacity-95"
          disabled={isBlockedNow || isSaving}
          onClick={() => void handleVerify()}
        >
          {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
          {primaryLabel}
          <kbd className="ml-1.5 hidden rounded border border-white/40 px-1 text-[10px] font-bold sm:inline">Ctrl ↵</kbd>
        </Button>
      </footer>
    </div>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

type HintTone = 'muted' | 'ok' | 'warn' | 'bad';

function Hint({ children, tone = 'muted' }: { children: ReactNode; tone?: HintTone }) {
  return (
    <p
      className={cn(
        'mt-1.5 flex items-start gap-1.5 text-[11.5px]',
        tone === 'muted' && 'text-muted-foreground',
        tone === 'ok' && 'text-green-700',
        tone === 'warn' && 'text-amber-700',
        tone === 'bad' && 'text-rose-700',
      )}
    >
      {children}
    </p>
  );
}

function FieldTitle({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[11.5px] font-bold text-muted-foreground">
      {children}
    </label>
  );
}

function Fact({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <small className="block text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">{label}</small>
      <b className={cn('block truncate tabular-nums', big ? 'text-[17px] font-extrabold' : 'text-[13.5px]')} title={value}>
        {value}
      </b>
    </div>
  );
}

function FormSection({
  icon: Icon,
  from,
  to,
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  from: string;
  to: string;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-4">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className={cn('grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white', from, to)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <b className="text-sm">{title}</b>
        <small className="text-xs text-muted-foreground">{hint}</small>
      </div>
      <div className="rounded-2xl border p-3.5">{children}</div>
    </section>
  );
}

function Segmented({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: Array<{ value: string; label: string; sub?: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-[11px] bg-slate-100 p-[3px]" role="radiogroup">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-left text-[12.5px] font-semibold text-muted-foreground transition disabled:cursor-not-allowed',
              on && 'bg-background text-foreground shadow-[0_2px_8px_-3px_rgba(15,23,42,0.27)]',
            )}
          >
            {option.label}
            {option.sub && <small className="block text-[10.5px] font-semibold text-muted-foreground">{option.sub}</small>}
          </button>
        );
      })}
    </div>
  );
}

function Chip({
  on,
  disabled,
  onClick,
  title,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'rounded-full border bg-background px-[11px] py-1 text-xs font-bold text-muted-foreground transition disabled:cursor-not-allowed disabled:opacity-40',
        on && 'border-violet-400 bg-violet-50 text-violet-700',
      )}
    >
      {children}
    </button>
  );
}

function TaxLine({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5 rounded-xl px-3 py-2', highlight ? 'bg-blue-50' : 'bg-slate-50')}>
      <span className="text-[12.5px] font-semibold text-muted-foreground">{label}</span>
      <b className="ml-auto text-sm tabular-nums">{inr(value)}</b>
    </div>
  );
}

/**
 * A deduction: what it is, and a switch for whether this bill has it. Only once it is switched on
 * do its choices (a TDS section, a retention rate, a reason) and its amount appear.
 */
function DeductionRow({
  title,
  hint,
  on,
  offLabel,
  onLabel,
  onToggle,
  control,
  amount,
}: {
  title: string;
  hint: string;
  on: boolean;
  offLabel: string;
  onLabel: string;
  onToggle: (on: boolean) => void;
  control: ReactNode;
  amount?: ReactNode;
}) {
  return (
    <div className="border-t border-dashed py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <b className="block text-[13px]">{title}</b>
          <small className="block text-[11.5px] text-muted-foreground">{hint}</small>
        </div>
        <Segmented
          value={on ? 'on' : 'off'}
          onChange={(value) => onToggle(value === 'on')}
          options={[
            { value: 'off', label: offLabel },
            { value: 'on', label: onLabel },
          ]}
        />
      </div>
      {on && (
        <div className={cn('mt-2.5 grid grid-cols-1 items-end gap-3', amount && 'md:grid-cols-[1.25fr_1fr]')}>
          <div className="min-w-0">{control}</div>
          {amount && <div className="min-w-0">{amount}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * An amount that is worked out until someone types one: it shows the worked figure (marked "auto")
 * and, once typed into, holds what was typed. Cleared, it goes back to the worked figure.
 */
function MoneyInput({
  id,
  label,
  text,
  worked,
  onText,
  disabled,
  plain,
}: {
  id: string;
  label: string;
  /** What was typed; null while the worked figure stands. */
  text: string | null;
  worked: number;
  onText: (text: string | null) => void;
  disabled?: boolean;
  /** Nothing is worked out: the field is only ever typed into. */
  plain?: boolean;
}) {
  const auto = !plain && text === null && worked > 0;
  return (
    <>
      <FieldTitle htmlFor={id}>{label}</FieldTitle>
      <div
        className={cn(
          'flex items-center rounded-[11px] border bg-background px-2.5 focus-within:border-violet-400',
          auto && 'border-violet-200 bg-violet-50',
          disabled && 'pointer-events-none opacity-40',
        )}
      >
        <span className="font-extrabold text-muted-foreground">₹</span>
        <input
          id={id}
          inputMode="decimal"
          disabled={disabled}
          value={text ?? (worked > 0 ? worked.toFixed(2) : '')}
          placeholder="0.00"
          onChange={(event) => onText(event.target.value)}
          onBlur={(event) => {
            if (!plain && event.target.value.trim() === '') onText(null);
          }}
          className="w-full bg-transparent py-2 pl-1.5 text-right font-extrabold tabular-nums outline-none"
        />
        {auto && <span className="ml-1.5 rounded-[5px] bg-violet-100 px-1.5 text-[10px] font-extrabold text-violet-700">auto</span>}
      </div>
    </>
  );
}

function SideBox({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-background">
      <header className="flex items-center justify-between px-3.5 pb-1.5 pt-3 text-[13px] font-extrabold">
        {title}
        {aside && <small className="font-semibold text-muted-foreground">{aside}</small>}
      </header>
      {children}
    </section>
  );
}

function StepDot({ state, label, number }: { state: 'done' | 'current' | 'next'; label: string; number?: number }) {
  return (
    <li className={cn('flex items-center gap-1.5', state === 'next' ? 'text-white/70' : 'text-white')}>
      {state !== 'done' && <span className="h-[1.5px] w-3.5 bg-white/40" aria-hidden />}
      <i
        className={cn(
          'grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] text-[10px] not-italic',
          state === 'done' && 'border-white bg-white text-teal-700',
          state === 'current' && 'border-yellow-300 bg-yellow-300 text-slate-900',
          state === 'next' && 'border-white/60',
        )}
      >
        {state === 'done' ? '✓' : number}
      </i>
      {label}
    </li>
  );
}
