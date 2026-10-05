'use client';

/**
 * The GST & TDS part of an expense request, shown only as far as the bill needs it.
 *
 * Three toggles say what kind of bill it is — a GST bill, TDS to deduct, retention / other
 * deductions — and only the switched-on groups appear. A plain bill shows one line and nothing else.
 * Every group sits on the same 6-column grid as the request fields above it (FORM_GRID), so the
 * page reads as one aligned form. Every rule lives in src/lib/statutory.ts.
 *
 * The GST group opens with the company GST registration the bill belongs to, when there is more
 * than one to choose from: it is that registration's state that decides CGST + SGST versus IGST
 * (src/lib/gst-registrations.ts). With one registration, or none configured, the field is not shown
 * and the treatment follows whatever the chain resolves to.
 */

import { useState, type ReactNode } from 'react';
import { AlertCircle, BadgePercent, Check, CheckCircle2, MinusCircle, Receipt } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RegistrationSelect, treatmentWarning, useBillRegistration } from '@/components/expenses/bill-registration';
import {
  GST_RATES,
  TDS_SECTIONS,
  checkGstin,
  computeStatutory,
  isValidPan,
  normaliseTaxId,
  statutoryErrors,
  suggestGstType,
  tdsSection,
  type GstType,
  type StatutoryInput,
} from '@/lib/statutory';
import { cn } from '@/lib/utils';

/** The expense request form's grid: 1 column on a phone, 2 on a tablet, 4 on a laptop, 6 on a wide screen. */
export const FORM_GRID = 'grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6';
/** A block label with a fixed line box, so labels line up whatever element carries them. */
export const FORM_LABEL = 'block h-4 truncate text-xs font-medium leading-4 text-slate-600';
/** A value the form works out itself, shown in place of an input. */
export const FORM_READ_ONLY = 'flex h-9 min-w-0 items-center rounded-md border border-dashed bg-slate-50 px-3 text-sm';

/**
 * What the page stores for this section. The GST registration chosen on the bill rides along with
 * the statutory inputs, so the page can save it on the request without any state of its own here;
 * `''` means "let the attribution chain decide" (src/lib/gst-registrations.ts).
 */
export interface StatutoryValue extends StatutoryInput {
  gstRegistrationId?: string;
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => inr.format(Number(n) || 0);
const numberOrZero = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const CONTROL = 'h-9 text-sm';
const AMOUNT = 'text-right tabular-nums';

/**
 * A number box that keeps what is being typed.
 *
 * Rendering `String(parsedNumber)` on every keystroke loses the half-typed figures a decimal has to
 * pass through: "0." parses to 0, so the box snapped back to "0" and 0.1% (194Q) or ₹0.50 could not
 * be entered at all — "0.1" came out as 1. The draft is what the user typed, and it is kept only
 * while it still parses to the value the caller holds, so a value changed from outside (choosing
 * another TDS section, resetting the form) replaces it without an effect.
 */
function DecimalInput({
  id,
  value,
  text,
  onChange,
  disabled,
  className,
  placeholder,
}: {
  id: string;
  /** The number the caller holds — what a draft has to still parse to for it to be kept. */
  value: number;
  /** What the box reads once nothing is being typed. Each caller's own formatting, unchanged. */
  text: string;
  onChange: (next: number) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft !== null && numberOrZero(draft) === (Number(value) || 0) ? draft : text;
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      min={0}
      step="0.01"
      className={className}
      disabled={disabled}
      placeholder={placeholder}
      value={shown}
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(numberOrZero(event.target.value));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function Field({
  label,
  required,
  htmlFor,
  children,
  error,
  hint,
  className,
}: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  error?: string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <label htmlFor={htmlFor} className={FORM_LABEL}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {error ? <p className="text-[11px] font-medium leading-tight text-destructive">{error}</p> : hint}
    </div>
  );
}

const TONES = {
  indigo: { bar: 'bg-indigo-500', text: 'text-indigo-700', pill: 'border-indigo-300 bg-indigo-50 text-indigo-800' },
  amber: { bar: 'bg-amber-500', text: 'text-amber-700', pill: 'border-amber-300 bg-amber-50 text-amber-800' },
  slate: { bar: 'bg-slate-400', text: 'text-slate-700', pill: 'border-slate-400 bg-slate-100 text-slate-800' },
} as const;
type Tone = keyof typeof TONES;

/** One group of fields — a white box with a coloured edge, its title, and anything that belongs beside the title. */
function Group({ title, tone, aside, children }: { title: string; tone: Tone; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-lg border bg-white">
      <span className={cn('absolute inset-y-0 left-0 w-1', TONES[tone].bar)} aria-hidden />
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-slate-100 py-1.5 pl-5 pr-3">
        <h3 className={cn('text-xs font-semibold uppercase tracking-wide', TONES[tone].text)}>{title}</h3>
        {aside}
      </div>
      <div className={cn(FORM_GRID, 'py-3 pl-5 pr-4')}>{children}</div>
    </section>
  );
}

/** A "what kind of bill" toggle, as a compact pill. */
function BillTypeToggle({ on, onToggle, icon: Icon, label, tone }: { on: boolean; onToggle: () => void; icon: typeof Receipt; label: string; tone: Tone }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-slate-400/40',
        on ? TONES[tone].pill : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
      )}
    >
      {on ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5 opacity-60" />}
      {label}
    </button>
  );
}

export function StatutorySection({
  amount,
  value,
  onChange,
  showErrors,
  projectId,
  departmentId,
}: {
  /** The request amount — the taxable value, before GST. */
  amount: number;
  value: StatutoryValue;
  onChange: (next: StatutoryValue) => void;
  /** Mark problems only after a save attempt. */
  showErrors: boolean;
  /** What the form holds now, so the registration can be worked out from the project / department. */
  projectId?: string;
  departmentId?: string;
}) {
  const set = (patch: Partial<StatutoryValue>) => onChange({ ...value, ...patch });
  const gstOn = value.gstType !== 'none';
  const tdsOn = value.tdsSection !== 'none';
  // Deductions have no field of their own that means "on", so the toggle is remembered here.
  const [deductionsSwitch, setDeductionsSwitch] = useState(false);
  const deductionsOn = deductionsSwitch || value.retentionAmount > 0 || value.otherDeduction > 0;

  // The registration the bill belongs to — its state, not one hardcoded state, settles the split.
  const bill = useBillRegistration({ gstRegistrationId: value.gstRegistrationId, projectId, departmentId });

  const totals = computeStatutory(amount, value);
  const errors = showErrors ? statutoryErrors(amount, value, bill.companyStateCode) : {};
  const gstin = normaliseTaxId(value.gstNo);
  const gstinCheck = gstin ? checkGstin(gstin) : null;
  const mismatch = gstOn ? treatmentWarning(bill, value.gstNo, value.gstType) : null;
  const invalid = (key: keyof typeof errors) => (errors[key] ? 'border-destructive focus-visible:ring-destructive' : undefined);

  const toggleGst = () =>
    gstOn
      ? set({ gstType: 'none', gstRate: 0, gstNo: '', reverseCharge: false, hsnSac: '', gstRegistrationId: '' })
      : set({ gstType: 'cgst-sgst', gstRate: value.gstRate || 18 });
  const toggleTds = () =>
    tdsOn ? set({ tdsSection: 'none', tdsRate: 0, tdsOverride: null }) : set({ tdsSection: '', tdsRate: 0, tdsOverride: null });
  const toggleDeductions = () => {
    if (deductionsOn) {
      setDeductionsSwitch(false);
      set({ retentionAmount: 0, otherDeduction: 0, otherDeductionReason: '' });
    } else setDeductionsSwitch(true);
  };

  const onGstinChange = (raw: string) => {
    const next = normaliseTaxId(raw);
    const check = checkGstin(next);
    const patch: Partial<StatutoryValue> = { gstNo: next };
    if (check.valid) {
      // A valid GSTIN settles the treatment — same state as the buying registration → CGST + SGST,
      // any other state → IGST — and gives the PAN.
      patch.gstType = suggestGstType(check.stateCode, bill.companyStateCode);
      if (!normaliseTaxId(value.panNo) && check.pan) patch.panNo = check.pan;
    }
    set(patch);
  };

  /** Another registration can turn an intra-state bill inter-state, so the split is re-suggested. */
  const onRegistrationChange = (next: string) => {
    const patch: Partial<StatutoryValue> = { gstRegistrationId: next };
    const chosen = next
      ? bill.options.find((registration) => registration.id === next) ?? null
      : bill.automatic;
    if (gstinCheck?.valid && chosen?.stateCode) patch.gstType = suggestGstType(gstinCheck.stateCode, chosen.stateCode);
    set(patch);
  };

  const plain = !gstOn && !tdsOn && !deductionsOn;

  const invoiceFields = (
    <>
      <Field label="Invoice / bill no." required={gstOn} htmlFor="st-invoice-no" error={errors.invoiceNo}>
        <Input id="st-invoice-no" className={cn(CONTROL, invalid('invoiceNo'))} placeholder="As printed on the bill" value={value.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} />
      </Field>
      <Field label="Invoice date" required={gstOn} htmlFor="st-invoice-date" error={errors.invoiceDate}>
        <Input id="st-invoice-date" type="date" className={cn(CONTROL, invalid('invoiceDate'))} value={value.invoiceDate} onChange={(e) => set({ invoiceDate: e.target.value })} />
      </Field>
    </>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="mr-2 min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">GST, TDS &amp; deductions</h2>
          <p className="text-xs text-muted-foreground">Tick what this bill has — it pre-fills GST &amp; TDS verification in Daily Requisition.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <BillTypeToggle on={gstOn} onToggle={toggleGst} icon={Receipt} tone="indigo" label="GST bill" />
          <BillTypeToggle on={tdsOn} onToggle={toggleTds} icon={BadgePercent} tone="amber" label="TDS" />
          <BillTypeToggle on={deductionsOn} onToggle={toggleDeductions} icon={MinusCircle} tone="slate" label="Retention / deductions" />
        </div>
      </div>

      {plain ? (
        <p className="rounded-lg border border-dashed bg-white px-4 py-2.5 text-xs text-muted-foreground">
          A plain bill — no GST, TDS or deductions. The amount above is what gets paid.
        </p>
      ) : (
        <>
          {gstOn && (
            <Group
              title="GST invoice"
              tone="indigo"
              aside={
                <label className="flex items-center gap-2 text-xs text-slate-600" title="The company pays this GST to the government; the supplier gets the taxable value only.">
                  <Switch checked={value.reverseCharge} onCheckedChange={(checked) => set({ reverseCharge: checked })} className="scale-90" />
                  Reverse charge (RCM)
                </label>
              }
            >
              {bill.canChoose && (
                <Field
                  label="GST registration"
                  htmlFor="st-gst-registration"
                  className="sm:col-span-2"
                  hint={
                    <p className="truncate text-[11px] leading-tight text-muted-foreground" title={bill.attribution.reason}>
                      {bill.registration ? (
                        <>
                          <span className="font-mono">{bill.registration.gstin}</span> · {bill.attribution.reason}
                        </>
                      ) : (
                        bill.attribution.reason
                      )}
                    </p>
                  }
                >
                  <RegistrationSelect
                    id="st-gst-registration"
                    value={value.gstRegistrationId ?? ''}
                    onValueChange={onRegistrationChange}
                    bill={bill}
                    className={CONTROL}
                  />
                </Field>
              )}
              {invoiceFields}
              <Field
                label="Supplier GSTIN"
                required
                htmlFor="st-gstin"
                error={!gstinCheck ? errors.gstNo : undefined}
                hint={
                  gstinCheck?.valid ? (
                    <p className="flex items-center gap-1 text-[11px] leading-tight text-emerald-700">
                      <CheckCircle2 className="h-3 w-3 shrink-0" /> {gstinCheck.stateName}
                    </p>
                  ) : gstinCheck ? (
                    <p className="flex items-start gap-1 text-[11px] leading-tight text-amber-700">
                      <AlertCircle className="mt-px h-3 w-3 shrink-0" /> {gstinCheck.error}
                    </p>
                  ) : null
                }
              >
                <Input
                  id="st-gstin"
                  className={cn(CONTROL, 'font-mono uppercase tracking-wide placeholder:font-sans placeholder:normal-case placeholder:tracking-normal', invalid('gstNo'))}
                  placeholder="15-character GSTIN"
                  maxLength={15}
                  value={value.gstNo}
                  onChange={(e) => onGstinChange(e.target.value)}
                />
              </Field>
              <Field
                label="Tax type"
                error={errors.gstType}
                hint={
                  mismatch ? (
                    <p className="flex items-start gap-1 text-[11px] leading-tight text-amber-700">
                      <AlertCircle className="mt-px h-3 w-3 shrink-0" />
                      <span>
                        {mismatch.message}{' '}
                        <button
                          type="button"
                          className="font-medium underline hover:no-underline"
                          onClick={() => set({ gstType: mismatch.expected as GstType })}
                        >
                          Use {mismatch.expected === 'igst' ? 'IGST' : 'CGST + SGST'}
                        </button>
                      </span>
                    </p>
                  ) : null
                }
              >
                <Select value={value.gstType} onValueChange={(v) => set({ gstType: v as GstType })}>
                  <SelectTrigger className={cn(CONTROL, mismatch && 'border-amber-400', invalid('gstType'))}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cgst-sgst">CGST + SGST</SelectItem>
                    <SelectItem value="igst">IGST</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="GST rate" required error={errors.gstRate}>
                <Select value={String(value.gstRate)} onValueChange={(v) => set({ gstRate: Number(v) })}>
                  <SelectTrigger className={cn(CONTROL, invalid('gstRate'))}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GST_RATES.filter((rate) => rate > 0).map((rate) => (
                      <SelectItem key={rate} value={String(rate)}>
                        {rate}%{value.gstType === 'cgst-sgst' ? ` (${rate / 2} + ${rate / 2})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="HSN / SAC" htmlFor="st-hsn">
                <Input id="st-hsn" className={cn(CONTROL, 'font-mono placeholder:font-sans')} placeholder="Optional" maxLength={8} value={value.hsnSac} onChange={(e) => set({ hsnSac: e.target.value })} />
              </Field>
            </Group>
          )}

          {!gstOn && tdsOn && (
            <Group title="Invoice" tone="slate">
              {invoiceFields}
            </Group>
          )}

          {tdsOn && (
            <Group title="TDS" tone="amber">
              <Field label="TDS section" required error={errors.tdsSection} className="sm:col-span-2">
                <Select value={value.tdsSection} onValueChange={(code) => set({ tdsSection: code, tdsRate: tdsSection(code).rate, tdsOverride: null })}>
                  <SelectTrigger className={cn(CONTROL, invalid('tdsSection'))}>
                    <SelectValue placeholder="Choose the section" />
                  </SelectTrigger>
                  <SelectContent>
                    {TDS_SECTIONS.filter((s) => s.code !== 'none').map((section) => (
                      <SelectItem key={section.code} value={section.code}>
                        {section.label} — {section.rate}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Rate %" htmlFor="st-tds-rate" error={errors.tdsRate}>
                <DecimalInput
                  id="st-tds-rate"
                  className={cn(CONTROL, AMOUNT, invalid('tdsRate'))}
                  disabled={!value.tdsSection}
                  placeholder="—"
                  value={value.tdsRate}
                  text={value.tdsSection ? String(value.tdsRate) : ''}
                  onChange={(rate) => set({ tdsRate: rate, tdsOverride: null })}
                />
              </Field>
              <Field
                label="TDS amount"
                htmlFor="st-tds-amount"
                hint={
                  value.tdsOverride !== null ? (
                    <button type="button" className="text-[11px] leading-tight text-sky-700 hover:underline" onClick={() => set({ tdsOverride: null })}>
                      Use {value.tdsRate}% instead
                    </button>
                  ) : (
                    <p className="text-[11px] leading-tight text-muted-foreground">On the value before GST</p>
                  )
                }
              >
                <DecimalInput
                  id="st-tds-amount"
                  className={cn(CONTROL, AMOUNT)}
                  disabled={!value.tdsSection}
                  placeholder="—"
                  value={value.tdsOverride ?? totals.tds}
                  text={value.tdsSection ? String(value.tdsOverride ?? totals.tds) : ''}
                  // A typed amount of ₹0 is a typed amount. "Use the rate instead" is the link
                  // under the box, not an empty box — which is a figure half-typed as often as not.
                  onChange={(amount) => set({ tdsOverride: amount })}
                />
              </Field>
              <Field
                label="Supplier PAN"
                required={value.tdsSection !== '206AA'}
                htmlFor="st-pan"
                error={errors.panNo}
                hint={
                  value.panNo && isValidPan(value.panNo) ? (
                    <p className="flex items-center gap-1 text-[11px] leading-tight text-emerald-700">
                      <CheckCircle2 className="h-3 w-3 shrink-0" /> {gstinCheck?.pan === value.panNo ? 'Taken from the GSTIN' : 'Valid PAN'}
                    </p>
                  ) : null
                }
              >
                <Input
                  id="st-pan"
                  className={cn(CONTROL, 'font-mono uppercase tracking-wide placeholder:font-sans placeholder:normal-case placeholder:tracking-normal', invalid('panNo'))}
                  placeholder="10-character PAN"
                  maxLength={10}
                  value={value.panNo}
                  onChange={(e) => set({ panNo: normaliseTaxId(e.target.value) })}
                />
              </Field>
            </Group>
          )}

          {deductionsOn && (
            <Group title="Retention & other deductions" tone="slate">
              <Field label="Retention" htmlFor="st-retention">
                <MoneyInput id="st-retention" value={value.retentionAmount} onChange={(n) => set({ retentionAmount: n })} />
              </Field>
              <Field label="Other deduction" htmlFor="st-other">
                <MoneyInput id="st-other" value={value.otherDeduction} onChange={(n) => set({ otherDeduction: n })} />
              </Field>
              <Field label="Reason for other deduction" required={value.otherDeduction > 0} htmlFor="st-other-reason" error={errors.otherDeductionReason} className="sm:col-span-2">
                <Input
                  id="st-other-reason"
                  className={cn(CONTROL, invalid('otherDeductionReason'))}
                  placeholder="e.g. Advance adjusted"
                  value={value.otherDeductionReason}
                  onChange={(e) => set({ otherDeductionReason: e.target.value })}
                />
              </Field>
            </Group>
          )}

          {/* The working, on one line */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 text-sm">
            <Step label="Taxable value" value={totals.taxable} />
            {gstOn && <Step op={value.reverseCharge ? '' : '+'} label={value.reverseCharge ? 'GST (RCM, not paid to supplier)' : value.gstType === 'igst' ? 'IGST' : 'CGST + SGST'} value={totals.gst} muted={value.reverseCharge} />}
            {tdsOn && <Step op="−" label="TDS" value={totals.tds} />}
            {totals.retention > 0 && <Step op="−" label="Retention" value={totals.retention} />}
            {totals.other > 0 && <Step op="−" label="Other" value={totals.other} />}
            <span className="ml-auto flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-emerald-800">= Net payable</span>
              <span className={cn('text-base font-bold tabular-nums', totals.net < 0 ? 'text-destructive' : 'text-emerald-800')}>{money(totals.net)}</span>
            </span>
            {errors.net && <p className="w-full text-[11px] font-medium text-destructive">{errors.net}</p>}
          </div>
        </>
      )}
    </div>
  );
}

function MoneyInput({ id, value, onChange }: { id: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
      <DecimalInput
        id={id}
        className={cn(CONTROL, AMOUNT, 'pl-7')}
        placeholder="0.00"
        value={value}
        text={value ? String(value) : ''}
        onChange={onChange}
      />
    </div>
  );
}

function Step({ op, label, value, muted }: { op?: string; label: string; value: number; muted?: boolean }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5', muted && 'opacity-60')}>
      {op && <span className="font-medium text-slate-400">{op}</span>}
      <span className="text-xs text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums text-slate-800">{money(value)}</span>
    </span>
  );
}
