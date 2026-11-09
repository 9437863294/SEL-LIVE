'use client';

/**
 * The GST & TDS part of an expense request, shown only as far as the bill needs it.
 *
 * Three toggles say what kind of bill it is — a GST bill, TDS to deduct, retention / other
 * deductions — and only the switched-on groups appear, each a tinted box in its toggle's colour with
 * what it adds or holds back on the right. A plain bill shows one line and nothing else. Under the
 * boxes, the working as chips: taxable, + GST, − TDS, − deductions, = net payable, and the net in
 * words. Every rule lives in src/lib/statutory.ts; the look is expense-form.module.css.
 *
 * The GST group opens with the company GST registration the bill belongs to, when there is more
 * than one to choose from: it is that registration's state that decides CGST + SGST versus IGST
 * (src/lib/gst-registrations.ts). With one registration, or none configured, the field is not shown
 * and the treatment follows whatever the chain resolves to.
 */

import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, BadgePercent, Check, CheckCircle2, FileText, MinusCircle, Receipt } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RegistrationSelect, treatmentWarning, useBillRegistration } from '@/components/expenses/bill-registration';
import { accentStyle, money, xr, type Accent } from '@/components/expenses/expense-form-ui';
import { amountInWords } from '@/lib/daily-requisition-print';
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

/*
 * The plain form classes Daily Requisition's entry sheet and Receive Multiple still lay out with.
 * The expense request itself is drawn with expense-form.module.css.
 */
/** A form grid: 1 column on a phone, 2 on a tablet, 4 on a laptop, 6 on a wide screen. */
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

const numberOrZero = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

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
  invalid,
  placeholder,
}: {
  id: string;
  /** The number the caller holds — what a draft has to still parse to for it to be kept. */
  value: number;
  /** What the box reads once nothing is being typed. Each caller's own formatting, unchanged. */
  text: string;
  onChange: (next: number) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft !== null && numberOrZero(draft) === (Number(value) || 0) ? draft : text;
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      min={0}
      step="0.01"
      className={cn(xr.control, xr.figure, value > 0 && xr.set)}
      disabled={disabled}
      aria-invalid={invalid || undefined}
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

function MoneyInput({ id, value, onChange }: { id: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className={xr.money}>
      <span className={xr.moneySign} aria-hidden="true">₹</span>
      <DecimalInput id={id} placeholder="0.00" value={value} text={value ? String(value) : ''} onChange={onChange} />
    </div>
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
    <div className={cn(xr.field, className)}>
      <label htmlFor={htmlFor} className={xr.lbl}>
        {label}
        {required && <i className={xr.req}> *</i>}
      </label>
      {children}
      {/* Always there, so a row of fields keeps one baseline whichever of them has a hint. */}
      {error ? <p className={cn(xr.sub, xr.subError)}>{error}</p> : <div className={xr.hint}>{hint}</div>}
    </div>
  );
}

/** One group of fields — a box tinted in its toggle's colour, its title, what it adds or takes away. */
function Box({
  title,
  icon: Icon,
  accent,
  aside,
  result,
  children,
}: {
  title: string;
  icon: LucideIcon;
  accent: Accent;
  aside?: ReactNode;
  result?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={xr.box} style={accentStyle(accent)}>
      <div className={xr.boxHead}>
        <h3 className={xr.boxTitle}>
          <Icon aria-hidden="true" />
          {title}
        </h3>
        {aside && <div className={xr.boxAside}>{aside}</div>}
        {result && <div className={xr.boxResult}>{result}</div>}
      </div>
      <div className={xr.boxGrid}>{children}</div>
    </section>
  );
}

/** A "what kind of bill" toggle: a pill that fills with its colour when on. */
function BillTypeToggle({ on, onToggle, icon: Icon, label, accent }: { on: boolean; onToggle: () => void; icon: LucideIcon; label: string; accent: Accent }) {
  return (
    <button type="button" aria-pressed={on} onClick={onToggle} className={xr.toggle} style={accentStyle(accent)}>
      <span className={xr.toggleDot} aria-hidden="true">
        {on ? <Check /> : <Icon />}
      </span>
      {label}
    </button>
  );
}

function Chip({ accent, children }: { accent: Accent; children: ReactNode }) {
  return (
    <span className={xr.chip} style={accentStyle(accent)}>
      {children}
    </span>
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
  const invalid = (key: keyof typeof errors) => (errors[key] ? true : undefined);
  /** "194C", for the chip — the section's code without its description. */
  const sectionCode = tdsOn && value.tdsSection ? tdsSection(value.tdsSection).label.split(' · ')[0] : '';

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
        <input
          id="st-invoice-no"
          className={cn(xr.control, value.invoiceNo && xr.set)}
          aria-invalid={invalid('invoiceNo')}
          placeholder="As printed on the bill"
          value={value.invoiceNo}
          onChange={(e) => set({ invoiceNo: e.target.value })}
        />
      </Field>
      <Field label="Invoice date" required={gstOn} htmlFor="st-invoice-date" error={errors.invoiceDate}>
        <input
          id="st-invoice-date"
          type="date"
          className={cn(xr.control, value.invoiceDate && xr.set)}
          aria-invalid={invalid('invoiceDate')}
          value={value.invoiceDate}
          onChange={(e) => set({ invoiceDate: e.target.value })}
        />
      </Field>
    </>
  );

  return (
    <div className={xr.scope}>
      <div className={xr.taxHead}>
        <div className="min-w-0">
          <h2 className={xr.taxTitle}>GST, TDS &amp; deductions</h2>
          <p className={xr.taxNote}>Tick what this bill has — it pre-fills GST &amp; TDS verification in Daily Requisition.</p>
        </div>
        <div className={xr.toggles}>
          <BillTypeToggle on={gstOn} onToggle={toggleGst} icon={Receipt} accent="cyan" label="GST bill" />
          <BillTypeToggle on={tdsOn} onToggle={toggleTds} icon={BadgePercent} accent="rose" label="TDS" />
          <BillTypeToggle on={deductionsOn} onToggle={toggleDeductions} icon={MinusCircle} accent="amber" label="Retention / deductions" />
        </div>
      </div>

      {plain ? (
        <p className={xr.plain}>
          <CheckCircle2 aria-hidden="true" />
          A plain bill — no GST, TDS or deductions. The amount above is what gets paid.
        </p>
      ) : (
        <>
          {gstOn && (
            <Box
              title="GST bill"
              icon={Receipt}
              accent="cyan"
              aside={
                <label className="flex cursor-pointer items-center gap-2" title="The company pays this GST to the government; the supplier gets the taxable value only.">
                  <Switch checked={value.reverseCharge} onCheckedChange={(checked) => set({ reverseCharge: checked })} className="scale-90" />
                  Reverse charge (RCM)
                </label>
              }
              result={
                <>
                  {value.reverseCharge ? money(totals.gst) : `+ ${money(totals.gst)}`}
                  <small>
                    {value.reverseCharge
                      ? 'Paid by us under RCM, not to the supplier'
                      : value.gstType === 'igst'
                        ? `IGST ${value.gstRate}% · inter-state`
                        : `CGST ${money(totals.cgst)} + SGST ${money(totals.sgst)}`}
                  </small>
                </>
              }
            >
              {bill.canChoose && (
                <Field
                  label="GST registration"
                  htmlFor="st-gst-registration"
                  className={xr.span2}
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
                    className={cn(xr.control, value.gstRegistrationId && xr.set)}
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
                    <p className="flex items-center gap-1 text-[11px] leading-tight text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3 shrink-0" /> {gstinCheck.stateName}
                    </p>
                  ) : gstinCheck ? (
                    <p className="flex items-start gap-1 text-[11px] leading-tight text-amber-700 dark:text-amber-400">
                      <AlertCircle className="mt-px h-3 w-3 shrink-0" /> {gstinCheck.error}
                    </p>
                  ) : null
                }
              >
                <input
                  id="st-gstin"
                  className={cn(xr.control, xr.mono, gstinCheck?.valid && xr.set)}
                  aria-invalid={invalid('gstNo')}
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
                    <p className="flex items-start gap-1 text-[11px] leading-tight text-amber-700 dark:text-amber-400">
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
                  <SelectTrigger className={cn(xr.control, xr.set)} data-warn={mismatch ? '' : undefined} aria-invalid={invalid('gstType')}>
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
                  <SelectTrigger className={cn(xr.control, value.gstRate > 0 && xr.set)} aria-invalid={invalid('gstRate')}>
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
                <input
                  id="st-hsn"
                  className={cn(xr.control, xr.mono, value.hsnSac && xr.set)}
                  placeholder="Optional"
                  maxLength={8}
                  value={value.hsnSac}
                  onChange={(e) => set({ hsnSac: e.target.value })}
                />
              </Field>
            </Box>
          )}

          {!gstOn && tdsOn && (
            <Box title="Invoice" icon={FileText} accent="slate">
              {invoiceFields}
            </Box>
          )}

          {tdsOn && (
            <Box
              title="TDS"
              icon={BadgePercent}
              accent="rose"
              result={
                <>
                  − {money(totals.tds)}
                  <small>held back from the party</small>
                </>
              }
            >
              <Field label="TDS section" required error={errors.tdsSection} className={xr.span2}>
                <Select value={value.tdsSection} onValueChange={(code) => set({ tdsSection: code, tdsRate: tdsSection(code).rate, tdsOverride: null })}>
                  <SelectTrigger className={cn(xr.control, value.tdsSection && xr.set)} aria-invalid={invalid('tdsSection')}>
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
                  disabled={!value.tdsSection}
                  invalid={!!errors.tdsRate}
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
                    <button type="button" className="text-[11px] leading-tight text-sky-700 hover:underline dark:text-sky-400" onClick={() => set({ tdsOverride: null })}>
                      Use {value.tdsRate}% instead
                    </button>
                  ) : (
                    <p className="truncate text-[11px] leading-tight text-muted-foreground">
                      {value.tdsSection ? `${value.tdsRate}% of ${money(totals.taxable)}, before GST` : 'On the value before GST'}
                    </p>
                  )
                }
              >
                <DecimalInput
                  id="st-tds-amount"
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
                    <p className="flex items-center gap-1 text-[11px] leading-tight text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3 shrink-0" /> {gstinCheck?.pan === value.panNo ? 'Taken from the GSTIN' : 'Valid PAN'}
                    </p>
                  ) : null
                }
              >
                <input
                  id="st-pan"
                  className={cn(xr.control, xr.mono, value.panNo && isValidPan(value.panNo) && xr.set)}
                  aria-invalid={invalid('panNo')}
                  placeholder="10-character PAN"
                  maxLength={10}
                  value={value.panNo}
                  onChange={(e) => set({ panNo: normaliseTaxId(e.target.value) })}
                />
              </Field>
            </Box>
          )}

          {deductionsOn && (
            <Box
              title="Retention & other deductions"
              icon={MinusCircle}
              accent="amber"
              result={
                <>
                  − {money(totals.retention + totals.other)}
                  <small>retention &amp; other</small>
                </>
              }
            >
              <Field label="Retention" htmlFor="st-retention">
                <MoneyInput id="st-retention" value={value.retentionAmount} onChange={(n) => set({ retentionAmount: n })} />
              </Field>
              <Field label="Other deduction" htmlFor="st-other">
                <MoneyInput id="st-other" value={value.otherDeduction} onChange={(n) => set({ otherDeduction: n })} />
              </Field>
              <Field label="Reason for other deduction" required={value.otherDeduction > 0} htmlFor="st-other-reason" error={errors.otherDeductionReason} className={xr.span2}>
                <input
                  id="st-other-reason"
                  className={cn(xr.control, value.otherDeductionReason && xr.set)}
                  aria-invalid={invalid('otherDeductionReason')}
                  placeholder="e.g. Advance adjusted"
                  value={value.otherDeductionReason}
                  onChange={(e) => set({ otherDeductionReason: e.target.value })}
                />
              </Field>
            </Box>
          )}

          {/* The working, as chips */}
          <div className={xr.strip}>
            <Chip accent="slate">Taxable {money(totals.taxable)}</Chip>
            {gstOn &&
              (value.reverseCharge ? (
                <Chip accent="slate">GST under RCM {money(totals.gst)} · not paid to the supplier</Chip>
              ) : (
                <Chip accent="cyan">
                  {value.gstType === 'igst' ? 'IGST' : 'CGST + SGST'} + {money(totals.gst)}
                </Chip>
              ))}
            {tdsOn && (
              <Chip accent="rose">
                TDS{sectionCode && ` ${sectionCode}`} − {money(totals.tds)}
              </Chip>
            )}
            {totals.retention > 0 && <Chip accent="amber">Retention − {money(totals.retention)}</Chip>}
            {totals.other > 0 && <Chip accent="amber">Other − {money(totals.other)}</Chip>}
            <Chip accent={totals.net < 0 ? 'rose' : 'green'}>= Net payable {money(totals.net)}</Chip>
            {totals.net > 0 && <Chip accent="violet">{amountInWords(totals.net)}</Chip>}
            {errors.net && <p className={xr.stripError}>{errors.net}</p>}
          </div>
        </>
      )}
    </div>
  );
}
