'use client';

/**
 * Record or change the client's certification of a bill (`/bill-tracking/bills/[id]/certify`).
 *
 * A first certification starts from every figure of the raised bill — taxable, GST and each
 * deduction — so the user changes only what the client changed: a lower taxable, an extra penalty, a
 * different TDS. The GST type stays the raised bill's (the issuing registration decides it, not the
 * certificate) unless changed; a bill imported with one GST figure starts split by the suggested
 * type. The panel on the right compares raised and certified as the figures are typed, and
 * says what note will be needed; the server recomputes everything on save.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, Plus, RotateCcw, Save, Scale } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import { useToast } from '@/hooks/use-toast';
import { grossAmount, netReceivable, totalDeduction } from '@/lib/bill-tracking/calculations';
import { deductionsByType, type CertificationComparison } from '@/lib/bill-tracking/certification';
import { computeDeductions, splitGst, suggestGst, totalFromComponents } from '@/lib/bill-tracking/gst';
import { formatINR, subtractMoney, sumMoney, toPaise } from '@/lib/bill-tracking/money';
import { GST_RATES } from '@/lib/statutory';
import { GST_TYPE_LABELS, type Bill, type BillTrackingConfig, type GstType } from '@/lib/bill-tracking/types';
import { cn } from '@/lib/utils';

import { btFetch, useBt, useBtQuery, useLookups } from './bt-client';
import { Amount, BtError, BtLoading, FormField, FormSection, Notice, Term, dateText, FIELD_ROW } from './bt-ui';
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
  const { can } = useBt();
  const router = useRouter();
  const { toast } = useToast();
  const existing = bill.certification;
  // The same suggestion the bill form makes: the SEL registration against the client's GSTIN state.
  const clientGstin = bill.clientGstin ?? lookups.clients.find((entry) => entry.id === bill.clientId)?.gstin;
  const suggestion = suggestGst(lookups.gstSetup, { projectId: bill.projectId, chosenRegistrationId: bill.gstRegistrationId, clientGstin });
  const [form, setForm] = useState<FormState>(() => (existing ? fromCertification(bill, config) : fromRaised(bill, config, lookups.today, suggestion.gstType)));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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
  const lines = useMemo(
    () => computeDeductions(inputs, config.deductionTypes, { taxable, gross, roundToRupee: config.settings.roundDeductionsToRupee, gstType: deductionGstType }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(inputs), taxable, gross, deductionGstType, config.deductionTypes, config.settings.roundDeductionsToRupee],
  );
  const deducted = totalDeduction(lines);
  const net = netReceivable(gross, deducted, config.settings.roundNetToRupee);
  const raisedByType = useMemo(() => new Map([...deductionsByType(bill.deductions ?? []).entries()].map(([id, entry]) => [id, entry.amount])), [bill.deductions]);
  const setRows = (update: (rows: DeductionRow[]) => DeductionRow[]) => setForm((current) => ({ ...current, deductions: update(current.deductions) }));

  /* ── comparison ───────────────────────────────────────────────────────── */
  const notesNet = detail.certification?.summary.notesNet ?? 0;
  const notesCount = detail.certification?.summary.notesCount ?? 0;
  const pendingNet = subtractMoney(net, sumMoney([bill.netReceivable, notesNet]));
  const needsNote = Math.abs(pendingNet) > config.settings.tolerance;

  const canCertify = can('Bills', 'Certify');
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
      toast({ title: existing ? 'Certification updated' : 'Certification recorded', description: needsNote ? `A ${pendingNet < 0 ? 'credit' : 'debit'} note of ${formatINR(Math.abs(pendingNet))} will match it.` : 'The raised bill already matches it.' });
      router.push(`/bill-tracking/bills/${bill.id}?tab=certification`);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : 'Could not save the certification.');
      setSaving(false);
    }
  };

  const reference = bill.gstInvoiceNumber || bill.billSerialNumber || bill.id.slice(0, 8);
  const gstRateIsCustom = form.gstRateCustom || !(GST_RATES as readonly number[]).map(String).includes(form.gstRate);

  return (
    <form onSubmit={submit} className="space-y-4">
      <PageHeader
        icon={ClipboardCheck}
        title={existing ? `Edit client certification · ${reference}` : `Record client certification · ${reference}`}
        backHref={`/bill-tracking/bills/${bill.id}?tab=certification`}
        backLabel="Bill"
        description={`${bill.projectNameSnapshot} · raised ${dateText(bill.billDate)} · net ${formatINR(bill.netReceivable)}. Enter what the client approved and deducts — the raised bill is not changed.`}
      />

      {!canCertify ? <Notice tone="blue">You can look at the certification; recording it needs Bill Tracking · Bills · Certify.</Notice> : null}
      {!existing ? (
        <Notice tone="emerald" title="Starting from the raised bill">
          Every amount and deduction below is copied from the bill as raised. Change only what the client changed, and add any extra deduction they made.
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <FormSection step={1} title="Client’s certificate" description="The certificate, measurement-book or RA reference and who certified it.">
            <div className={FIELD_ROW}>
              <FormField label="Certified date *" htmlFor="certified-date" width="date">
                <Input id="certified-date" type="date" required value={form.certifiedDate} onChange={(event) => set('certifiedDate', event.target.value)} />
              </FormField>
              <FormField label="Certificate / MB reference" htmlFor="certificate-ref" width="medium">
                <Input id="certificate-ref" value={form.reference} onChange={(event) => set('reference', event.target.value)} placeholder="e.g. MB-14 / RA-4" />
              </FormField>
              <FormField label="Certified by" htmlFor="certified-by" width="wide">
                <Input id="certified-by" value={form.certifiedBy} onChange={(event) => set('certifiedBy', event.target.value)} placeholder="Client’s engineer / officer" />
              </FormField>
            </div>
            <FormField label="Remarks" htmlFor="certification-remarks">
              <Textarea id="certification-remarks" rows={2} value={form.remarks} onChange={(event) => set('remarks', event.target.value)} placeholder="Why the client’s figures differ, if they do" />
            </FormField>
          </FormSection>

          <FormSection step={2} title="Certified amount & GST" description="The registration and client GSTIN decide CGST + SGST or IGST; type over a component to match the certificate.">
            <div className={FIELD_ROW}>
              <FormField label={<Term tip="Pre-GST value the client certified.">Certified taxable (₹) *</Term>} htmlFor="certified-taxable" width="amount" hint={<RaisedHint raised={bill.taxableAmount} value={taxable} />}>
                <Input id="certified-taxable" inputMode="decimal" required className="tabular-nums" value={form.taxableAmount} onChange={(event) => setForm((current) => ({ ...current, taxableAmount: event.target.value, gstManual: false }))} />
              </FormField>
              <FormField label="SEL GST registration" hint="As on the raised bill." width="wide">
                <div className="flex h-10 items-center truncate rounded-md border bg-slate-50 px-3 text-sm text-slate-600" title={registrationLabel}>
                  {registrationLabel}
                </div>
              </FormField>
              <FormField label="GST type" width="medium">
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
                  width="short"
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
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{gstReason}</p>

            {gstChoice === 'legacy' ? (
              <div className={FIELD_ROW}>
                <FormField label="GST (total, not split)" width="amount" hint={<RaisedHint raised={bill.gstAmount} value={gstTotal} />}>
                  <Input inputMode="decimal" className="tabular-nums" value={form.legacyGstAmount} onChange={(event) => set('legacyGstAmount', event.target.value)} />
                </FormField>
              </div>
            ) : gstChoice === 'none' ? null : (
              <div className={FIELD_ROW}>
                {gstChoice === 'cgst-sgst' ? (
                  <>
                    <FormField label={`CGST @ ${computedGst.cgstRate}%`} width="amount" hint={bill.gstType === 'cgst-sgst' ? <RaisedHint raised={bill.cgstAmount ?? 0} value={components.cgstAmount} /> : undefined}>
                      <Input inputMode="decimal" aria-label="Certified CGST" className="tabular-nums" value={form.gstManual ? form.cgstAmount : String(components.cgstAmount)} onChange={(event) => editComponent('cgstAmount', event.target.value)} />
                    </FormField>
                    <FormField label={`SGST @ ${computedGst.sgstRate}%`} width="amount" hint={bill.gstType === 'cgst-sgst' ? <RaisedHint raised={bill.sgstAmount ?? 0} value={components.sgstAmount} /> : undefined}>
                      <Input inputMode="decimal" aria-label="Certified SGST" className="tabular-nums" value={form.gstManual ? form.sgstAmount : String(components.sgstAmount)} onChange={(event) => editComponent('sgstAmount', event.target.value)} />
                    </FormField>
                  </>
                ) : (
                  <FormField label={`IGST @ ${computedGst.igstRate}%`} width="amount" hint={bill.gstType === 'igst' ? <RaisedHint raised={bill.igstAmount ?? 0} value={components.igstAmount} /> : undefined}>
                    <Input inputMode="decimal" aria-label="Certified IGST" className="tabular-nums" value={form.gstManual ? form.igstAmount : String(components.igstAmount)} onChange={(event) => editComponent('igstAmount', event.target.value)} />
                  </FormField>
                )}
                <FormField
                  label="Total GST"
                  width="amount"
                  hint={
                    <>
                      <RaisedHint raised={bill.gstAmount} value={gstTotal} /> · {form.gstManual ? 'typed from the certificate' : 'calculated from the certified taxable'}
                    </>
                  }
                >
                  <div className="flex h-10 items-center justify-between rounded-md border bg-slate-50 px-3 text-sm font-semibold">
                    <Amount value={gstTotal} signed />
                    {form.gstManual ? (
                      <button type="button" className="text-xs font-normal text-emerald-700 hover:underline" onClick={() => set('gstManual', false)}>
                        Recalculate
                      </button>
                    ) : null}
                  </div>
                </FormField>
              </div>
            )}
          </FormSection>

          <FormSection
            step={3}
            title="Certified deductions"
            description="What the client deducts. Change an amount, remove a line, or add the extra deductions the client made (penalty, LD, extra retention…)."
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
            />
          </FormSection>
        </div>

        <div className="space-y-3 xl:sticky xl:top-[calc(var(--app-header-offset,4rem)+1rem)] xl:self-start">
          <FormSection icon={Scale} title="Raised vs certified" description="Certified figure on the right; the raised one and the change beneath it." className="border-emerald-200" bodyClassName="px-4 pb-4 pt-1 text-sm">
            <div className="divide-y divide-slate-100">
              <CompareRow label="Taxable" raised={bill.taxableAmount} certified={taxable} />
              <CompareRow label="GST" raised={bill.gstAmount} certified={gstTotal} />
              <CompareRow label="Gross" raised={bill.grossAmount} certified={gross} strong />
              {/* More deducted means less to receive, so an increase here reads red. */}
              <CompareRow label="Deductions" raised={bill.totalDeduction} certified={deducted} inverse />
              <CompareRow label="Net receivable" raised={bill.netReceivable} certified={net} strong />
            </div>
            {notesCount ? (
              <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-dashed border-slate-200 pt-2 text-xs">
                <span className="text-slate-500">
                  {notesCount} note{notesCount === 1 ? '' : 's'} already raised against it
                </span>
                <Amount value={notesNet} signed className="font-medium" />
              </div>
            ) : null}
            <div className={cn('mt-3 rounded-lg border p-3 text-xs leading-relaxed', needsNote ? 'border-violet-200 bg-violet-50 text-violet-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900')}>
              {needsNote ? (
                <>
                  <div className="font-semibold">
                    {pendingNet < 0 ? 'Credit' : 'Debit'} note of {formatINR(Math.abs(pendingNet))} needed
                  </div>
                  <div className="mt-0.5">After saving, raise it against this bill from the bill page — it is filled in for you.</div>
                </>
              ) : toPaise(subtractMoney(net, bill.netReceivable)) !== 0 ? (
                <>
                  <div className="font-semibold">No note needed</div>
                  <div className="mt-0.5">The notes already raised cover the difference.</div>
                </>
              ) : (
                <>
                  <div className="font-semibold">No note needed</div>
                  <div className="mt-0.5">The certified figures are the same as the raised bill.</div>
                </>
              )}
            </div>
          </FormSection>
          <BtError message={saveError} />
          <div className="flex gap-2">
            <Button asChild variant="outline" className="flex-1">
              <Link href={`/bill-tracking/bills/${bill.id}?tab=certification`}>Cancel</Link>
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

/** "Raised ₹10,00,000" under a field, amber once the certified figure differs. */
function RaisedHint({ raised, value }: { raised: number; value: number }) {
  const differs = Math.round(raised * 100) !== Math.round(value * 100);
  return (
    <span className={differs ? 'font-medium text-amber-700' : undefined}>
      Raised {formatINR(raised)}
      {differs ? ` · ${value - raised > 0 ? '+' : '−'}${formatINR(Math.abs(subtractMoney(value, raised)))}` : ''}
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
          <span className={cn('rounded px-1.5 py-px font-semibold tabular-nums', good ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
            {change > 0 ? '+' : '−'}
            {formatINR(Math.abs(change))}
          </span>
        )}
      </div>
    </div>
  );
}
