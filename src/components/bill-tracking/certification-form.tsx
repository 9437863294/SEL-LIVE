'use client';

/**
 * Record or change the client's certification of a bill (`/bill-tracking/bills/[id]/certify`).
 *
 * A first certification starts from every figure of the raised bill — taxable, GST and each
 * deduction — so the user changes only what the client changed: a lower taxable, an extra penalty, a
 * different TDS. The GST type stays the raised bill's (the issuing registration decides it, not the
 * certificate) unless changed; a bill imported with one GST figure starts split by the suggested
 * type. The panel on the right compares raised and certified as the figures are typed.
 *
 * Saved, the certified deductions apply to the bill directly — its net and outstanding follow them,
 * no document needed. Only a taxable or GST that differs from the raised bill plus its notes needs a
 * credit / debit note, so that is all the panel asks for. The server recomputes everything on save.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ClipboardCheck, FileText, Plus, RotateCcw, Save, Scale, UserCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { markNextNavigationAsReplace } from '@/lib/navigation-history';
import { grossAmount, netReceivable, totalDeduction } from '@/lib/bill-tracking/calculations';
import { deductionsByType, raisedFigures, type CertificationComparison } from '@/lib/bill-tracking/certification';
import { computeDeductions, splitGst, suggestGst, totalFromComponents } from '@/lib/bill-tracking/gst';
import { formatINR, subtractMoney, sumMoney, toPaise } from '@/lib/bill-tracking/money';
import { GST_RATES } from '@/lib/statutory';
import { GST_TYPE_LABELS, type Bill, type BillTrackingConfig, type GstType } from '@/lib/bill-tracking/types';
import { cn } from '@/lib/utils';

import { btFetch, useBtQuery, useLookups, useWorkflowActor } from './bt-client';
import { certificationBlocked, certificationNotDue } from '@/lib/bill-tracking/workflow';
import { Amount, BtError, BtLoading, FormField, FormSection, Notice, RupeeInput, Term, WorkflowStatusBadge, dateText, FIELD_ROW } from './bt-ui';
import { DeductionEditor, deductionInputs, emptyDeductionRow, num, rowsFromDeductions, str, type DeductionRow } from './deduction-editor';

interface Detail {
  bill: Bill;
  certification: CertificationComparison | null;
}

interface FormState {
  certifiedDate: string;
  reference: string;
  certifiedBy: string;
  remarks: string;
  taxableAmount: string;
  gstRate: string;
  gstRateCustom: boolean;
  /** Component amounts typed from the certificate instead of computed from the rate. */
  gstManual: boolean;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  /** `legacy` keeps one GST figure, as an imported bill has it. */
  gstType: GstChoice;
  legacyGstAmount: string;
  deductions: DeductionRow[];
}

type GstChoice = GstType | 'legacy';

const isStandardRate = (rate: number | undefined) => rate === undefined || (GST_RATES as readonly number[]).includes(rate);

/** The rate an unsplit GST figure works out to — snapped to a standard rate when it is one. */
function impliedRate(taxable: number, gst: number): number | undefined {
  if (!taxable || !gst) return undefined;
  const rate = (gst / taxable) * 100;
  const standard = (GST_RATES as readonly number[]).find((entry) => Math.abs(entry - rate) < 0.05);
  return standard ?? Math.round(rate * 100) / 100;
}

/** One GST total divided into the parts of a type: CGST and SGST halves (odd paisa to SGST), or all IGST. */
function splitTotal(total: number, type: GstChoice) {
  if (type === 'cgst-sgst') {
    const cgstAmount = Math.round((total / 2) * 100) / 100;
    return { cgstAmount, sgstAmount: Math.round((total - cgstAmount) * 100) / 100, igstAmount: 0 };
  }
  return { cgstAmount: 0, sgstAmount: 0, igstAmount: type === 'igst' ? total : 0 };
}

/**
 * The amounts of the raised bill, as a starting point. A bill imported with one GST figure starts
 * split by the suggested type, its total divided between the parts so nothing changes until typed.
 */
function fromRaised(bill: Bill, config: BillTrackingConfig, today: string, suggestedType: GstType): FormState {
  const legacy = !bill.gstType;
  const gstType: GstChoice = bill.gstType ?? (bill.gstAmount ? suggestedType : 'none');
  const rate = bill.gstPercent ?? impliedRate(bill.taxableAmount, bill.gstAmount) ?? config.settings.defaultGstRate;
  const parts = legacy ? splitTotal(bill.gstAmount, gstType) : { cgstAmount: bill.cgstAmount ?? 0, sgstAmount: bill.sgstAmount ?? 0, igstAmount: bill.igstAmount ?? 0 };
  return {
    certifiedDate: today,
    reference: '',
    certifiedBy: '',
    remarks: '',
    taxableAmount: String(bill.taxableAmount),
    gstType,
    gstRate: str(rate),
    gstRateCustom: !isStandardRate(rate),
    // The raised components are kept as typed, so the certification equals the bill until changed.
    gstManual: gstType !== 'none',
    cgstAmount: str(parts.cgstAmount),
    sgstAmount: str(parts.sgstAmount),
    igstAmount: str(parts.igstAmount),
    legacyGstAmount: String(bill.gstAmount),
    // Same row ids as the bill's lines, so a deduction type retired since the bill was raised is
    // still accepted on the certification (the server allows a retired type on a line it knows).
    deductions: rowsFromDeductions(bill.deductions ?? [], config.deductionTypes),
  };
}

function fromCertification(bill: Bill, config: BillTrackingConfig): FormState {
  const certification = bill.certification as NonNullable<Bill['certification']>;
  const rate = certification.gstPercent ?? bill.gstPercent ?? impliedRate(certification.taxableAmount, certification.gstAmount) ?? config.settings.defaultGstRate;
  return {
    certifiedDate: certification.certifiedDate,
    reference: certification.reference ?? '',
    certifiedBy: certification.certifiedBy ?? '',
    remarks: certification.remarks ?? '',
    taxableAmount: String(certification.taxableAmount),
    gstType: certification.gstType ?? bill.gstType ?? 'legacy',
    gstRate: str(rate),
    gstRateCustom: !isStandardRate(rate),
    gstManual: Boolean(certification.gstType),
    cgstAmount: str(certification.cgstAmount),
    sgstAmount: str(certification.sgstAmount),
    igstAmount: str(certification.igstAmount),
    legacyGstAmount: String(certification.gstAmount),
    deductions: rowsFromDeductions(certification.deductions ?? [], config.deductionTypes),
  };
}

export default function CertificationForm({ billId }: { billId: string }) {
  const { data, loading, error } = useBtQuery<Detail>(`bills/${billId}`);
  if (loading && !data) return <BtLoading label="Loading bill…" />;
  if (error || !data) return <BtError message={error ?? 'Bill not found.'} />;
  return <CertificationFormInner key={`${data.bill.id}-${data.bill.certification?.revision ?? 0}`} detail={data} />;
}

function CertificationFormInner({ detail }: { detail: Detail }) {
  const { bill } = detail;
  const lookups = useLookups();
  const { config } = lookups;
  const actor = useWorkflowActor();
  const router = useRouter();
  const { toast } = useToast();
  const existing = bill.certification;
  // The same suggestion the bill form makes: the SEL registration against the client's GSTIN state.
  const clientGstin = bill.clientGstin ?? lookups.clients.find((entry) => entry.id === bill.clientId)?.gstin;
  const suggestion = suggestGst(lookups.gstSetup, { projectId: bill.projectId, chosenRegistrationId: bill.gstRegistrationId, clientGstin });
  const [form, setForm] = useState<FormState>(() => (existing ? fromCertification(bill, config) : fromRaised(bill, config, lookups.today, suggestion.gstType)));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // A form: the arrow and Cancel go back where it was opened from (the bill, a register), and leave
  // it out of the history, so the browser's Back never reopens it.
  const back = useBackNavigation(`/bill-tracking/bills/${bill.id}?tab=certification`, { replace: true, fallbackLabel: 'Back to the bill' });
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const usedTypeIds = new Set([...(bill.deductions ?? []), ...(existing?.deductions ?? [])].map((line) => line.deductionTypeId));
  const activeTypes = config.deductionTypes.filter((type) => type.active || usedTypeIds.has(type.id));

  /* ── GST: type, rate and components, as on the bill form ─────────────── */
  const gstChoice = form.gstType;
  const taxable = num(form.taxableAmount);
  const rate = gstChoice === 'none' || gstChoice === 'legacy' ? 0 : num(form.gstRate);
  const computedGst = splitGst(taxable, gstChoice === 'legacy' ? 'none' : gstChoice, rate);
  const components =
    gstChoice === 'legacy'
      ? { cgstAmount: 0, sgstAmount: 0, igstAmount: 0 }
      : form.gstManual
        ? { cgstAmount: num(form.cgstAmount), sgstAmount: num(form.sgstAmount), igstAmount: num(form.igstAmount) }
        : { cgstAmount: computedGst.cgstAmount, sgstAmount: computedGst.sgstAmount, igstAmount: computedGst.igstAmount };
  const gstTotal = gstChoice === 'legacy' ? num(form.legacyGstAmount) : totalFromComponents(gstChoice, components);
  const editComponent = (key: 'cgstAmount' | 'sgstAmount' | 'igstAmount', value: string) =>
    setForm((current) => ({
      ...current,
      gstManual: true,
      // Typing one component starts from the computed figures for the others.
      cgstAmount: current.gstManual ? current.cgstAmount : str(computedGst.cgstAmount),
      sgstAmount: current.gstManual ? current.sgstAmount : str(computedGst.sgstAmount),
      igstAmount: current.gstManual ? current.igstAmount : str(computedGst.igstAmount),
      [key]: value,
    }));
  const registrationLabel = bill.gstRegistrationLabel
    ? `${bill.gstRegistrationLabel}${bill.gstRegistrationGstin ? ` · ${bill.gstRegistrationGstin}` : ''}`
    : suggestion.registration
      ? `Automatic (${suggestion.registration.label || suggestion.registration.stateName})`
      : 'Not set up';
  const gstReason = !bill.gstType
    ? `${suggestion.reason} The raised bill carries one GST figure (${formatINR(bill.gstAmount)}); it is split here — change the type if the certificate splits it differently.`
    : gstChoice === bill.gstType
      ? `As raised: ${GST_TYPE_LABELS[bill.gstType]}${bill.gstPercent ? ` @ ${bill.gstPercent}%` : ''}. Change it only if the client certified a different GST.`
      : `Raised as ${GST_TYPE_LABELS[bill.gstType]}; certified as ${gstChoice === 'legacy' ? 'one GST figure' : GST_TYPE_LABELS[gstChoice]}.`;

  /* ── deductions ───────────────────────────────────────────────────────── */
  const gross = grossAmount(taxable, gstTotal);
  const deductionGstType: GstType = gstChoice === 'igst' ? 'igst' : 'cgst-sgst';
  const inputs = deductionInputs(form.deductions);
  const lines = computeDeductions(inputs, config.deductionTypes, { taxable, gross, roundToRupee: config.settings.roundDeductionsToRupee, gstType: deductionGstType });
  const deducted = totalDeduction(lines);
  const net = netReceivable(gross, deducted, config.settings.roundNetToRupee);
  const raisedByType = useMemo(() => new Map([...deductionsByType(bill.deductions ?? []).entries()].map(([id, entry]) => [id, entry.amount])), [bill.deductions]);
  const setRows = (update: (rows: DeductionRow[]) => DeductionRow[]) => setForm((current) => ({ ...current, deductions: update(current.deductions) }));

  /* ── comparison ───────────────────────────────────────────────────────── */
  // The raised figures, not the stored totals: once certified, a bill's total deduction and net are
  // the certified ones.
  const raised = raisedFigures(bill);
  const notesCount = detail.certification?.summary.notesCount ?? 0;
  /** What the notes already raised against the bill add up to on one line of the comparison. */
  const notesOn = (key: 'taxable' | 'gst' | 'gross') => detail.certification?.lines.find((line) => line.key === key)?.notes ?? 0;
  // Only the invoice value is settled by a note — the certified deductions apply to the bill itself —
  // so the note needed is the taxable and GST still to adjust, as `certification.ts` works it out.
  const pendingTaxable = subtractMoney(taxable, sumMoney([raised.taxableAmount, notesOn('taxable')]));
  const pendingGst = subtractMoney(gstTotal, sumMoney([raised.gstAmount, notesOn('gst')]));
  const pendingGross = subtractMoney(gross, sumMoney([raised.grossAmount, notesOn('gross')]));
  const beyondTolerance = (amount: number) => Math.abs(toPaise(amount)) > toPaise(Math.abs(config.settings.tolerance));
  const needsNote = beyondTolerance(pendingTaxable) || beyondTolerance(pendingGst);
  // A note lowers the invoice value or raises it; one that nets to nothing follows the taxable.
  const noteWord = (toPaise(pendingGross) !== 0 ? pendingGross < 0 : pendingTaxable < 0) ? 'credit' : 'debit';
  const invoiceAsRaised = toPaise(subtractMoney(taxable, raised.taxableAmount)) === 0 && toPaise(subtractMoney(gstTotal, raised.gstAmount)) === 0;
  const deductionChange = subtractMoney(deducted, raised.totalDeduction);
  const deductionsChanged = toPaise(deductionChange) !== 0;

  const canCertify = certificationBlocked(bill, config.settings, actor) === null;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await btFetch(`bills/${bill.id}/certification`, {
        method: 'PUT',
        body: {
          certifiedDate: form.certifiedDate,
          reference: form.reference,
          certifiedBy: form.certifiedBy,
          remarks: form.remarks,
          taxableAmount: taxable,
          gstType: gstChoice === 'legacy' ? undefined : gstChoice,
          gstPercent: gstChoice === 'legacy' || gstChoice === 'none' ? undefined : rate,
          gstAmount: gstTotal,
          cgstAmount: gstChoice === 'cgst-sgst' ? components.cgstAmount : undefined,
          sgstAmount: gstChoice === 'cgst-sgst' ? components.sgstAmount : undefined,
          igstAmount: gstChoice === 'igst' ? components.igstAmount : undefined,
          deductions: inputs,
          expectedRevision: existing?.revision ?? 0,
        },
      });
      toast({
        title: existing ? 'Certification updated' : 'Certification recorded',
        description: needsNote
          ? `A ${noteWord} note of ${formatINR(Math.abs(pendingGross))} for the taxable and GST will match it.`
          : deductionsChanged
            ? 'Its deductions now apply to the bill — no note needed.'
            : 'No note needed.',
      });
      markNextNavigationAsReplace();
      router.replace(`/bill-tracking/bills/${bill.id}?tab=certification`);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : 'Could not save the certification.');
      setSaving(false);
    }
  };

  const reference = bill.gstInvoiceNumber || bill.billSerialNumber || bill.id.slice(0, 8);
  const gstRateIsCustom = form.gstRateCustom || !(GST_RATES as readonly number[]).map(String).includes(form.gstRate);

  return (
    <form onSubmit={submit} className="space-y-4">
      {/*
        The same card as the bill's own header: back, a short title with the project beside it, then the
        facts of the bill being certified in a row of their own under a rule — and, where it
        applies, one quiet line on where the figures start from, rather than a banner of its own.
      */}
      <header className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start gap-4 p-4 sm:p-6">
          <Button asChild variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-lg print:hidden">
            <Link href={back.href} onClick={back.onClick} aria-label={back.label} title={back.label}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            {/* The title and the project on one row, as on the bill's header: the project after a rule,
                as a link to its bills, wrapping only where the screen is too narrow for both. */}
            <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="flex min-w-0 items-center gap-2 text-xl font-bold leading-tight tracking-tight text-slate-900 sm:text-2xl">
                <ClipboardCheck className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
                {existing ? 'Edit client certification' : 'Record client certification'}
              </h1>
              <span className="mx-0.5 hidden h-5 w-px bg-slate-200 sm:block" aria-hidden="true" />
              <Link href={`/bill-tracking/bills?project=${bill.projectId}&fy=all`} className="min-w-0 max-w-full truncate text-xs font-semibold uppercase tracking-wide text-emerald-700 hover:underline" title={`All bills of ${bill.projectNameSnapshot}`}>
                {bill.projectNameSnapshot}
              </Link>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-slate-200 sm:grid-cols-4">
          {(
            [
              ['Invoice', <span key="ref" className="break-all">{reference}</span>],
              ['Bill date', dateText(bill.billDate)],
              ['Raised net', <Amount key="net" value={raised.net} signed />],
              ['Stage', <WorkflowStatusBadge key="stage" status={bill.workflowStatus} />],
            ] as [string, React.ReactNode][]
          ).map(([label, value], index) => (
            <div key={label} className={cn('min-w-0 px-4 py-3 sm:px-6', index % 2 === 1 && 'border-l border-slate-200', index >= 2 && 'border-t border-slate-200 sm:border-t-0', index === 2 && 'sm:border-l')}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
        {canCertify && !existing ? (
          <p className="flex items-center gap-2 border-t border-slate-200 bg-emerald-50/50 px-4 py-2.5 text-xs text-emerald-800 sm:px-6">
            <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Every amount and deduction below starts from the bill as raised — change only what the client changed, and add any extra deduction they made.
          </p>
        ) : null}
      </header>

      {!canCertify ? (
        <Notice tone={certificationNotDue(bill, config.settings) ? 'amber' : 'blue'} title={certificationNotDue(bill, config.settings) ? 'Not ready for certification' : 'You cannot record this certification'}>
          {certificationBlocked(bill, config.settings, actor)}{' '}
          <Link href={back.href} onClick={back.onClick} className="font-medium underline underline-offset-2">
            {back.label}
          </Link>
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {/* The three facts of the certificate fill the row — the date at its own width, the
              reference and the signatory sharing the rest — instead of three fixed widths and a gap;
              the remarks, optional, beneath them. Each field says what goes in it. */}
          <FormSection step={1} title="Client’s certificate" description="Which certificate, when, and who signed it.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)]">
              <FormField label="Certified date *" htmlFor="certified-date" hint="As dated on the certificate.">
                <Input id="certified-date" type="date" required value={form.certifiedDate} onChange={(event) => set('certifiedDate', event.target.value)} />
              </FormField>
              <FormField label="Certificate / MB reference" htmlFor="certificate-ref" hint="Certificate, measurement-book or RA bill number.">
                <div className="relative">
                  <FileText className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <Input id="certificate-ref" className="pl-9" value={form.reference} onChange={(event) => set('reference', event.target.value)} placeholder="e.g. MB-14 / RA-4" />
                </div>
              </FormField>
              <FormField label="Certified by" htmlFor="certified-by" hint="The client’s engineer or officer." className="sm:col-span-2 lg:col-span-1">
                <div className="relative">
                  <UserCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <Input id="certified-by" className="pl-9" value={form.certifiedBy} onChange={(event) => set('certifiedBy', event.target.value)} placeholder="Name and designation" />
                </div>
              </FormField>
            </div>
            <FormField label={<>Remarks <span className="font-normal text-slate-400">(optional)</span></>} htmlFor="certification-remarks" hint="Shown with the certification on the bill.">
              <Textarea id="certification-remarks" rows={2} className="min-h-[4.5rem] resize-y" value={form.remarks} onChange={(event) => set('remarks', event.target.value)} placeholder="Why the client’s figures differ from the raised bill, if they do" />
            </FormField>
          </FormSection>

          {/*
            Two rows that fill the width. First how GST is charged — the registration, type and rate,
            nearly always as raised — with why beneath it. Then the amounts as an invoice reads them,
            left to right: taxable, each GST component, total GST and the gross they make, each a
            right-aligned rupee figure with the raised one under it.
          */}
          <FormSection step={2} title="Certified amount & GST" description="Type over any figure to match the certificate. A taxable or GST that differs from the raised bill needs a credit / debit note.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.7fr)]">
              <FormField label="SEL GST registration" hint="As on the raised bill.">
                <div className="flex h-10 items-center truncate rounded-md border bg-slate-50 px-3 text-sm text-slate-600" title={registrationLabel}>
                  {registrationLabel}
                </div>
              </FormField>
              <FormField label="GST type">
                <Select value={gstChoice} onValueChange={(value) => setForm((current) => ({ ...current, gstType: value as GstChoice, gstManual: false }))}>
                  <SelectTrigger aria-label="GST type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['cgst-sgst', 'igst', 'none'] as GstType[]).map((type) => (
                      <SelectItem key={type} value={type}>
                        {GST_TYPE_LABELS[type]}
                        {bill.gstType === type ? ' (as raised)' : !bill.gstType && suggestion.gstType === type ? ' (suggested)' : ''}
                      </SelectItem>
                    ))}
                    {!bill.gstType && bill.gstAmount ? <SelectItem value="legacy">Not split (as imported)</SelectItem> : null}
                  </SelectContent>
                </Select>
              </FormField>
              {gstChoice !== 'none' && gstChoice !== 'legacy' ? (
                <FormField
                  label="GST rate %"
                  hint={
                    gstRateIsCustom ? (
                      <Input className="mt-1 h-8" inputMode="decimal" aria-label="GST rate (other)" placeholder="Type the rate %" value={form.gstRate} onChange={(event) => setForm((current) => ({ ...current, gstRate: event.target.value, gstManual: false }))} />
                    ) : undefined
                  }
                >
                  <Select value={gstRateIsCustom ? 'custom' : form.gstRate} onValueChange={(value) => setForm((current) => (value === 'custom' ? { ...current, gstRateCustom: true } : { ...current, gstRate: value, gstRateCustom: false, gstManual: false }))}>
                    <SelectTrigger aria-label="GST rate">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GST_RATES.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option}%
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Other rate…</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              ) : null}
            </div>
            <p className="-mt-1 text-xs text-slate-500">{gstReason}</p>

            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 sm:p-4">
              <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', gstChoice === 'cgst-sgst' ? 'lg:grid-cols-5' : gstChoice === 'none' ? 'lg:grid-cols-2' : 'lg:grid-cols-4')}>
                <FormField label={<Term tip="Pre-GST value the client certified.">Certified taxable *</Term>} htmlFor="certified-taxable" hint={<RaisedHint raised={bill.taxableAmount} value={taxable} />}>
                  <RupeeInput id="certified-taxable" required value={form.taxableAmount} onChange={(value) => setForm((current) => ({ ...current, taxableAmount: value, gstManual: false }))} />
                </FormField>
                {gstChoice === 'legacy' ? (
                  <FormField label="GST (total, not split)" hint={<RaisedHint raised={bill.gstAmount} value={gstTotal} />}>
                    <RupeeInput aria-label="Certified GST" value={form.legacyGstAmount} onChange={(value) => set('legacyGstAmount', value)} />
                  </FormField>
                ) : gstChoice === 'cgst-sgst' ? (
                  <>
                    <FormField label={`CGST @ ${computedGst.cgstRate}%`} hint={bill.gstType === 'cgst-sgst' ? <RaisedHint raised={bill.cgstAmount ?? 0} value={components.cgstAmount} /> : undefined}>
                      <RupeeInput aria-label="Certified CGST" value={form.gstManual ? form.cgstAmount : String(components.cgstAmount)} onChange={(value) => editComponent('cgstAmount', value)} />
                    </FormField>
                    <FormField label={`SGST @ ${computedGst.sgstRate}%`} hint={bill.gstType === 'cgst-sgst' ? <RaisedHint raised={bill.sgstAmount ?? 0} value={components.sgstAmount} /> : undefined}>
                      <RupeeInput aria-label="Certified SGST" value={form.gstManual ? form.sgstAmount : String(components.sgstAmount)} onChange={(value) => editComponent('sgstAmount', value)} />
                    </FormField>
                  </>
                ) : gstChoice === 'igst' ? (
                  <FormField label={`IGST @ ${computedGst.igstRate}%`} hint={bill.gstType === 'igst' ? <RaisedHint raised={bill.igstAmount ?? 0} value={components.igstAmount} /> : undefined}>
                    <RupeeInput aria-label="Certified IGST" value={form.gstManual ? form.igstAmount : String(components.igstAmount)} onChange={(value) => editComponent('igstAmount', value)} />
                  </FormField>
                ) : null}
                {gstChoice === 'cgst-sgst' || gstChoice === 'igst' ? (
                  <FormField
                    label="Total GST"
                    hint={
                      <>
                        <RaisedHint raised={bill.gstAmount} value={gstTotal} />
                        <span className="block">{form.gstManual ? 'Typed from the certificate.' : 'Worked out from the taxable.'}</span>
                      </>
                    }
                  >
                    <div className="flex h-10 items-center justify-between gap-2 rounded-md border bg-white px-3 text-sm font-semibold tabular-nums">
                      {form.gstManual ? (
                        <button type="button" className="text-xs font-normal text-emerald-700 hover:underline" onClick={() => set('gstManual', false)}>
                          Recalculate
                        </button>
                      ) : (
                        <span />
                      )}
                      <Amount value={gstTotal} signed />
                    </div>
                  </FormField>
                ) : null}
                <FormField label="Certified gross" hint={<RaisedHint raised={raised.grossAmount} value={gross} />}>
                  <div className="flex h-10 items-center justify-end rounded-md border border-emerald-200 bg-emerald-50/50 px-3 text-sm font-bold tabular-nums text-slate-900">
                    <Amount value={gross} signed />
                  </div>
                </FormField>
              </div>
            </div>
          </FormSection>

          <FormSection
            step={3}
            title="Certified deductions"
            description="What the client deducts. These replace the raised deductions in the bill’s net and outstanding — no note needed. Change, remove, or add what the client changed (penalty, LD, extra retention…)."
            actions={
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setRows((rows) => [...rows, emptyDeductionRow()])}>
                <Plus className="h-4 w-4" /> Add deduction
              </Button>
            }
            bodyClassName="space-y-3 p-3 sm:p-4"
          >
            <DeductionEditor
              rows={form.deductions}
              setRows={setRows}
              lines={lines}
              activeTypes={activeTypes}
              deductionTypes={config.deductionTypes}
              gstType={deductionGstType}
              totalDeduction={deducted}
              defaultGstRate={config.settings.defaultGstRate}
              emptyText="The client deducts nothing."
              reference={{ label: 'Raised', byType: raisedByType }}
              // Once certified, these are the retention lines the rate slabs hold, read against the certified figures.
              bases={{ taxable, gross }}
            />
          </FormSection>
        </div>

        <div className="space-y-3 xl:sticky xl:top-[calc(var(--app-header-offset,4rem)+1rem)] xl:self-start">
          <FormSection icon={Scale} title="Raised vs certified" description="Certified figure on the right; the raised one and the change beneath it." className="border-emerald-200" bodyClassName="px-4 pb-4 pt-1 text-sm">
            <div className="divide-y divide-slate-100">
              <CompareRow label="Taxable" raised={raised.taxableAmount} certified={taxable} />
              <CompareRow label="GST" raised={raised.gstAmount} certified={gstTotal} />
              <CompareRow label="Gross" raised={raised.grossAmount} certified={gross} strong />
              {/* More deducted means less to receive, so an increase here reads red. */}
              <CompareRow label="Deductions" raised={raised.totalDeduction} certified={deducted} inverse />
              <CompareRow label="Net receivable" raised={raised.net} certified={net} strong />
            </div>
            {notesCount ? (
              <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-dashed border-slate-200 pt-2 text-xs">
                <span className="text-slate-500">
                  {notesCount} note{notesCount === 1 ? '' : 's'} already raised · taxable + GST
                </span>
                <Amount value={notesOn('gross')} signed className="font-medium" />
              </div>
            ) : null}
            <div className={cn('mt-3 rounded-lg border p-3 text-xs leading-relaxed', needsNote ? 'border-violet-200 bg-violet-50 text-violet-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900')}>
              {needsNote ? (
                <>
                  <div className="font-semibold">
                    {noteWord === 'credit' ? 'Credit' : 'Debit'} note of {formatINR(Math.abs(pendingGross))} needed
                  </div>
                  <div className="mt-0.5">
                    {[toPaise(pendingTaxable) !== 0 ? `Taxable ${changeText(pendingTaxable)}` : null, toPaise(pendingGst) !== 0 ? `GST ${changeText(pendingGst)}` : null].filter(Boolean).join(' · ')}. After saving, raise it against this bill from the bill page — it is filled in for you.
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold">No note needed</div>
                  <div className="mt-0.5">
                    {invoiceAsRaised ? 'The certified taxable and GST are the same as the raised bill.' : notesCount ? 'The notes already raised cover the taxable and GST difference.' : 'The taxable and GST are within the amount tolerance of the raised bill.'}
                  </div>
                </>
              )}
              {deductionsChanged ? (
                <div className={cn('mt-2 border-t border-dashed pt-2', needsNote ? 'border-violet-200' : 'border-emerald-200')}>
                  Deductions {changeText(deductionChange)} — applied by the certification itself: the bill’s net and outstanding follow them, no note needed.
                </div>
              ) : null}
            </div>
          </FormSection>
          <BtError message={saveError} />
          {/* Below `xl` the panel comes after the whole form, so Save rides along at the bottom of
              the screen instead of waiting there; beside the form it sits under the panel. */}
          <div className="sticky bottom-0 z-10 -mx-1 flex gap-2 border-t border-slate-200 bg-white/95 px-1 py-3 backdrop-blur-sm hr-sticky-actions xl:static xl:mx-0 xl:border-0 xl:bg-transparent xl:p-0 xl:backdrop-blur-none">
            <Button asChild variant="outline" className="flex-1">
              <Link href={back.href} onClick={back.onClick}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Cancel
              </Link>
            </Button>
            <Button type="submit" className="flex-1 gap-1.5" disabled={saving || !canCertify || !form.certifiedDate}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Record'}
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" className="w-full gap-1.5 text-slate-600" onClick={() => setForm((current) => ({ ...fromRaised(bill, config, lookups.today, suggestion.gstType), certifiedDate: current.certifiedDate, reference: current.reference, certifiedBy: current.certifiedBy, remarks: current.remarks }))}>
            <RotateCcw className="h-4 w-4" /> Start the amounts again from the raised bill
          </Button>
        </div>
      </div>
    </form>
  );
}

/** A change with its sign: "+₹5,000" / "−₹1,00,000". */
const changeText = (change: number) => `${change > 0 ? '+' : '−'}${formatINR(Math.abs(change))}`;

/** "Raised ₹10,00,000" under a field, amber once the certified figure differs. */
function RaisedHint({ raised, value }: { raised: number; value: number }) {
  const differs = Math.round(raised * 100) !== Math.round(value * 100);
  return (
    <span className={differs ? 'font-medium text-amber-700' : undefined}>
      Raised {formatINR(raised)}
      {differs ? ` · ${changeText(subtractMoney(value, raised))}` : ''}
    </span>
  );
}

/**
 * One line of the comparison panel: label and certified figure on top, the raised figure and the
 * change underneath — two figures stacked rather than side by side, which a narrow panel can't fit.
 * `inverse` for deductions, where an increase is bad news.
 */
function CompareRow({ label, raised, certified, strong, inverse }: { label: string; raised: number; certified: number; strong?: boolean; inverse?: boolean }) {
  const change = subtractMoney(certified, raised);
  const good = inverse ? change < 0 : change > 0;
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={strong ? 'font-semibold text-slate-900' : 'text-slate-600'}>{label}</span>
        <Amount value={certified} signed className={strong ? 'text-[15px] font-semibold text-slate-900' : 'font-medium text-slate-800'} />
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[11px]">
        <span className="text-slate-400">
          Raised <Amount value={raised} signed className="text-slate-500" />
        </span>
        {toPaise(change) === 0 ? (
          <span className="text-slate-400">No change</span>
        ) : (
          <span className={cn('rounded px-1.5 py-px font-semibold tabular-nums', good ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{changeText(change)}</span>
        )}
      </div>
    </div>
  );
}
