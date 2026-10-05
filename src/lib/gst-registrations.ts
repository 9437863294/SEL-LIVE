/**
 * The company's own GST registrations — one per state it works in — and how a bill is tied to one.
 *
 * A single payment window covers several states, so every bill has to be attributed to the
 * registration whose return it belongs in. Which is decided by a configurable chain
 * (`GstAttributionConfig`): an override keyed on the bill, else the project's registration, else the
 * department's, else the default. An admin turns each source on or off and orders them.
 *
 * Why this matters beyond reporting: the registration's state decides the tax treatment. A supplier
 * in the same state as the registration charges CGST + SGST; one in another state charges IGST. With
 * one hardcoded company state that is wrong six times out of seven.
 *
 * On the two sides of GST in a payment register:
 *   - a normal purchase bill carries **input tax credit (ITC)** — GST the supplier charged, which the
 *     company claims back;
 *   - a **reverse-charge** bill carries an **output liability** — the supplier charges nothing and the
 *     company pays that GST to the government itself (and may then claim it as ITC).
 * The two are never added together: they fall on opposite sides of the return.
 *
 * Pure (no imports but the equally pure statutory rules) so it runs under plain node for tests.
 */

import { GST_STATES, checkGstin, isValidPan, normaliseTaxId, type GstType } from './statutory.ts';

/* ── the registrations ──────────────────────────────────────────────────────────────────────── */

export interface GstRegistration {
  id: string;
  /** 15-character GSTIN. */
  gstin: string;
  /** First two characters of the GSTIN — kept so a bill can be matched without re-parsing. */
  stateCode: string;
  stateName: string;
  /** What to call it on screen, e.g. "Odisha — Bhubaneswar". Falls back to the state name. */
  label: string;
  /** TDS account number, when this state files its own TDS returns. */
  tan?: string;
  /** A registration surrendered or not yet live is kept for history but offered nowhere. */
  active: boolean;
}

export const EMPTY_REGISTRATION: Omit<GstRegistration, 'id'> = {
  gstin: '',
  stateCode: '',
  stateName: '',
  label: '',
  tan: '',
  active: true,
};

/** A TAN: 4 letters, 5 digits, 1 letter. */
const TAN_PATTERN = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
export const isValidTan = (value: string | undefined) => TAN_PATTERN.test(normaliseTaxId(value));

/** The state and name a GSTIN implies, so an admin types the number and nothing else. */
export function registrationFromGstin(gstin: string, label?: string): Partial<GstRegistration> {
  const check = checkGstin(gstin);
  if (!check.valid) return { gstin: normaliseTaxId(gstin) };
  return {
    gstin: normaliseTaxId(gstin),
    stateCode: check.stateCode ?? '',
    stateName: check.stateName ?? '',
    label: label?.trim() || check.stateName || '',
  };
}

export const registrationLabel = (registration: Pick<GstRegistration, 'label' | 'stateName' | 'gstin'> | null | undefined) =>
  registration ? registration.label?.trim() || registration.stateName || registration.gstin : 'Not attributed';

/** What is wrong with the registration list, keyed by registration id (`''` for list-wide problems). */
export function validateRegistrations(registrations: readonly GstRegistration[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const seen = new Map<string, string>();
  for (const registration of registrations) {
    const gstin = normaliseTaxId(registration.gstin);
    const check = checkGstin(gstin);
    if (!check.valid) {
      errors[registration.id] = check.error ?? 'Not a valid GSTIN.';
    } else if (seen.has(gstin)) {
      errors[registration.id] = 'This GSTIN is already in the list.';
    } else {
      // Recorded on the strength of the GSTIN alone: a bad TAN on the first of two copies of one
      // GSTIN must not stop the second being reported as the duplicate it is.
      seen.set(gstin, registration.id);
      if (registration.tan && !isValidTan(registration.tan)) {
        errors[registration.id] = 'Not a TAN: 4 letters, 5 digits and a letter.';
      }
    }
  }
  if (registrations.length > 0 && !registrations.some((registration) => registration.active)) {
    errors[''] = 'At least one registration has to be active.';
  }
  return errors;
}

/**
 * Two registrations in one state. Allowed under GST (separate business verticals), but far more often
 * a typo, so it is reported as something to look at rather than an error.
 */
export function duplicateStates(registrations: readonly GstRegistration[]): string[] {
  const counts = new Map<string, number>();
  for (const registration of registrations) {
    if (!registration.stateCode) continue;
    counts.set(registration.stateCode, (counts.get(registration.stateCode) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([code]) => GST_STATES[code] ?? code);
}

/* ── how a bill finds its registration ─────────────────────────────────────────────────────── */

export type AttributionSource = 'entry' | 'project' | 'department' | 'default';

export const ATTRIBUTION_SOURCES: readonly AttributionSource[] = ['entry', 'project', 'department', 'default'];

export const ATTRIBUTION_LABELS: Record<AttributionSource, { title: string; hint: string }> = {
  entry: { title: 'Chosen on the bill', hint: 'A registration picked on the expense request or at GST & TDS verification wins over everything else.' },
  project: { title: "Project's registration", hint: 'The state the site is in — the place of supply for a works contract.' },
  department: { title: "Department's registration", hint: 'For a company run as one branch per state.' },
  default: { title: 'Default registration', hint: 'The fallback when nothing above decides, so no bill is ever left out of a return.' },
};

export type TdsGrouping = 'company' | 'registration';

export interface GstAttributionConfig {
  /** The sources to try, in order. Anything left out is never tried. */
  order: AttributionSource[];
  enabled: Record<AttributionSource, boolean>;
  /** Used by the `default` source. */
  defaultRegistrationId: string;
  /** Whether TDS is totalled for the company as a whole or per registration's TAN. */
  tdsGrouping: TdsGrouping;
}

export const DEFAULT_ATTRIBUTION: GstAttributionConfig = {
  order: ['entry', 'project', 'department', 'default'],
  enabled: { entry: true, project: true, department: true, default: true },
  defaultRegistrationId: '',
  tdsGrouping: 'company',
};

/** projectId / departmentId → registration id. */
export interface GstAttributionMaps {
  byProject: Record<string, string>;
  byDepartment: Record<string, string>;
}

export const EMPTY_MAPS: GstAttributionMaps = { byProject: {}, byDepartment: {} };

export interface GstRegistrationsDoc {
  registrations: GstRegistration[];
  attribution: GstAttributionConfig;
  maps: GstAttributionMaps;
}

/** A stored document read back safely: unknown keys dropped, missing ones defaulted. */
export function resolveRegistrationsDoc(raw: unknown): GstRegistrationsDoc {
  const doc = (raw ?? {}) as Partial<GstRegistrationsDoc>;
  const registrations = Array.isArray(doc.registrations)
    ? doc.registrations
        .filter((registration): registration is GstRegistration => Boolean(registration && typeof registration.id === 'string'))
        .map((registration) => ({
          ...EMPTY_REGISTRATION,
          ...registration,
          gstin: normaliseTaxId(registration.gstin),
          tan: normaliseTaxId(registration.tan) || '',
          active: registration.active !== false,
        }))
    : [];

  const stored = (doc.attribution ?? {}) as Partial<GstAttributionConfig>;
  // Every source appears exactly once, in the stored order first, then any the document never knew.
  const order = [
    ...(Array.isArray(stored.order) ? stored.order.filter((source) => ATTRIBUTION_SOURCES.includes(source)) : []),
    ...ATTRIBUTION_SOURCES.filter((source) => !(stored.order ?? []).includes(source)),
  ].filter((source, index, all) => all.indexOf(source) === index);

  return {
    registrations,
    attribution: {
      order,
      enabled: { ...DEFAULT_ATTRIBUTION.enabled, ...(stored.enabled ?? {}) },
      defaultRegistrationId:
        typeof stored.defaultRegistrationId === 'string' && registrations.some((r) => r.id === stored.defaultRegistrationId)
          ? stored.defaultRegistrationId
          : registrations.find((r) => r.active)?.id ?? '',
      tdsGrouping: stored.tdsGrouping === 'registration' ? 'registration' : 'company',
    },
    maps: {
      byProject: { ...((doc.maps?.byProject ?? {}) as Record<string, string>) },
      byDepartment: { ...((doc.maps?.byDepartment ?? {}) as Record<string, string>) },
    },
  };
}

export interface AttributionInput {
  /** The registration keyed on the bill itself, when someone chose one. */
  gstRegistrationId?: string;
  projectId?: string;
  departmentId?: string;
}

export interface Attribution {
  /** `''` when no enabled source decided. */
  registrationId: string;
  source: AttributionSource | 'none';
  /** Why this registration, in words — shown beside the field and in the report. */
  reason: string;
}

export const UNATTRIBUTED = '';

/**
 * The registration a bill belongs to, by walking the configured chain. A source that is switched off,
 * or points at a registration no longer in the list, is skipped rather than trusted.
 */
export function resolveAttribution(
  input: AttributionInput,
  config: GstAttributionConfig,
  maps: GstAttributionMaps,
  registrations: readonly GstRegistration[],
): Attribution {
  const known = new Map(registrations.map((registration) => [registration.id, registration]));
  const usable = (id: string | undefined): string => (id && known.has(id) ? id : '');

  for (const source of config.order) {
    if (!config.enabled[source]) continue;
    switch (source) {
      case 'entry': {
        const id = usable(input.gstRegistrationId);
        if (id) return { registrationId: id, source, reason: 'Chosen on this bill' };
        break;
      }
      case 'project': {
        const id = usable(input.projectId ? maps.byProject[input.projectId] : '');
        if (id) return { registrationId: id, source, reason: "From the project's state" };
        break;
      }
      case 'department': {
        const id = usable(input.departmentId ? maps.byDepartment[input.departmentId] : '');
        if (id) return { registrationId: id, source, reason: "From the department's registration" };
        break;
      }
      case 'default': {
        const id = usable(config.defaultRegistrationId);
        if (id) return { registrationId: id, source, reason: 'The default registration' };
        break;
      }
    }
  }
  return { registrationId: UNATTRIBUTED, source: 'none', reason: 'No registration could be worked out' };
}

/* ── the tax treatment a registration implies ──────────────────────────────────────────────── */

/**
 * CGST + SGST within the registration's own state, IGST across state lines. With neither state known
 * it stays CGST + SGST, which is what a single-state company would expect.
 */
export function gstTypeFor(companyStateCode: string | undefined, supplierStateCode: string | undefined): GstType {
  if (!companyStateCode || !supplierStateCode) return 'cgst-sgst';
  return companyStateCode === supplierStateCode ? 'cgst-sgst' : 'igst';
}

/** Whether a bill's tax split matches the states involved, and what it should have been. */
export function checkTreatment(
  registration: Pick<GstRegistration, 'stateCode'> | null | undefined,
  supplierGstin: string | undefined,
  gstType: string | undefined,
): { ok: boolean; expected?: GstType; message?: string } {
  const supplier = checkGstin(supplierGstin);
  if (!registration?.stateCode || !supplier.valid || !supplier.stateCode) return { ok: true };
  if (gstType !== 'cgst-sgst' && gstType !== 'igst') return { ok: true };
  const expected = gstTypeFor(registration.stateCode, supplier.stateCode);
  if (expected === gstType) return { ok: true };
  return {
    ok: false,
    expected,
    message:
      expected === 'igst'
        ? `Supplier is in ${supplier.stateName ?? supplier.stateCode} but the bill is split as CGST + SGST — a different state means IGST.`
        : `Supplier is in the same state as this registration, so it should be CGST + SGST, not IGST.`,
  };
}

/* ── what each registration owes and can claim ─────────────────────────────────────────────── */

/** One bill, as the summary reads it. */
export interface GstBill {
  id: string;
  /** The requisition's reception number, for the drill-down. */
  ref: string;
  /** The expense request it came from. */
  depNo?: string;
  /** `YYYY-MM-DD`. */
  dateKey: string;
  partyName: string;
  /** The supplier's GSTIN, as verified. */
  supplierGstin: string;
  projectId?: string;
  departmentId?: string;
  gstRegistrationId?: string;
  gstType?: string;
  reverseCharge?: boolean;
  /** Value before GST. */
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tds: number;
  retention: number;
  other: number;
  /** What the supplier is actually paid. */
  net: number;
  invoiceNo?: string;
  invoiceDate?: string;
  panNo?: string;
  status?: string;
}

export interface GstTotals {
  bills: number;
  /** Value before GST, reverse-charge bills included. */
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** GST a supplier charged, claimable as input credit. Reverse-charge GST is not here. */
  itc: number;
  /** Value before GST of the reverse-charge bills. */
  rcmTaxable: number;
  /** GST the company itself owes the government on those bills — an output liability. */
  rcmOutput: number;
  tds: number;
  retention: number;
  other: number;
  net: number;
}

export const emptyGstTotals = (): GstTotals => ({
  bills: 0,
  taxable: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  itc: 0,
  rcmTaxable: 0,
  rcmOutput: 0,
  tds: 0,
  retention: 0,
  other: 0,
  net: 0,
});

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n: unknown) => Number(n) || 0;

export function addBill(totals: GstTotals, bill: GstBill): GstTotals {
  const gst = num(bill.cgst) + num(bill.sgst) + num(bill.igst);
  totals.bills += 1;
  totals.taxable = round2(totals.taxable + num(bill.taxable));
  totals.cgst = round2(totals.cgst + num(bill.cgst));
  totals.sgst = round2(totals.sgst + num(bill.sgst));
  totals.igst = round2(totals.igst + num(bill.igst));
  if (bill.reverseCharge) {
    totals.rcmTaxable = round2(totals.rcmTaxable + num(bill.taxable));
    totals.rcmOutput = round2(totals.rcmOutput + gst);
  } else {
    totals.itc = round2(totals.itc + gst);
  }
  totals.tds = round2(totals.tds + num(bill.tds));
  totals.retention = round2(totals.retention + num(bill.retention));
  totals.other = round2(totals.other + num(bill.other));
  totals.net = round2(totals.net + num(bill.net));
  return totals;
}

export interface GstFlags {
  /** GST charged but no supplier GSTIN recorded — the credit cannot be claimed as it stands. */
  missingSupplierGstin: number;
  /** No invoice number or date — also needed to claim. */
  missingInvoice: number;
  /** The CGST/SGST vs IGST split does not match the two states. */
  treatmentMismatch: number;
  /** TDS deducted without a valid PAN. */
  tdsWithoutPan: number;
}

const emptyFlags = (): GstFlags => ({ missingSupplierGstin: 0, missingInvoice: 0, treatmentMismatch: 0, tdsWithoutPan: 0 });

export const flagTotal = (flags: GstFlags) =>
  flags.missingSupplierGstin + flags.missingInvoice + flags.treatmentMismatch + flags.tdsWithoutPan;

export interface RegistrationSummary {
  registrationId: string;
  registration: GstRegistration | null;
  label: string;
  totals: GstTotals;
  flags: GstFlags;
  /** How the bills got here, so a lopsided mapping is visible. */
  bySource: Record<AttributionSource | 'none', number>;
}

export interface TanSummary {
  tan: string;
  /** The registrations filing under this TAN. */
  labels: string[];
  tds: number;
  bills: number;
}

export interface GstSummary {
  byRegistration: RegistrationSummary[];
  /** The company as a whole. */
  company: GstTotals;
  companyFlags: GstFlags;
  /** Only when TDS is grouped per registration; `tan` is `''` for registrations without one. */
  byTan: TanSummary[];
  /** Which registration (if any) each bill landed in — for the drill-down. */
  attributionOf: Map<string, Attribution>;
}

/**
 * Every bill attributed and totalled per registration. Registrations with no bills are still listed,
 * so an empty state reads as "nothing this period" rather than disappearing; the unattributed bucket
 * appears only when it has something in it.
 */
export function summariseGst(
  bills: readonly GstBill[],
  doc: GstRegistrationsDoc,
): GstSummary {
  const byId = new Map(doc.registrations.map((registration) => [registration.id, registration]));
  const buckets = new Map<string, RegistrationSummary>();
  const attributionOf = new Map<string, Attribution>();
  const company = emptyGstTotals();
  const companyFlags = emptyFlags();

  const bucketFor = (registrationId: string): RegistrationSummary => {
    const existing = buckets.get(registrationId);
    if (existing) return existing;
    const registration = byId.get(registrationId) ?? null;
    const created: RegistrationSummary = {
      registrationId,
      registration,
      label: registrationLabel(registration),
      totals: emptyGstTotals(),
      flags: emptyFlags(),
      bySource: { entry: 0, project: 0, department: 0, default: 0, none: 0 },
    };
    buckets.set(registrationId, created);
    return created;
  };

  // Listed in the order the registrations are held, so the report does not reshuffle between periods.
  for (const registration of doc.registrations) bucketFor(registration.id);

  for (const bill of bills) {
    const attribution = resolveAttribution(bill, doc.attribution, doc.maps, doc.registrations);
    attributionOf.set(bill.id, attribution);
    const bucket = bucketFor(attribution.registrationId);
    bucket.bySource[attribution.source] += 1;
    addBill(bucket.totals, bill);
    addBill(company, bill);

    const gst = num(bill.cgst) + num(bill.sgst) + num(bill.igst);
    const bump = (key: keyof GstFlags) => {
      bucket.flags[key] += 1;
      companyFlags[key] += 1;
    };
    if (gst > 0 && !checkGstin(bill.supplierGstin).valid) bump('missingSupplierGstin');
    if (gst > 0 && (!bill.invoiceNo?.trim() || !bill.invoiceDate?.trim())) bump('missingInvoice');
    if (!checkTreatment(bucket.registration, bill.supplierGstin, bill.gstType).ok) bump('treatmentMismatch');
    if (num(bill.tds) > 0 && !isValidPan(bill.panNo)) bump('tdsWithoutPan');
  }

  const byRegistration = [...buckets.values()].filter(
    (bucket) => bucket.registrationId !== UNATTRIBUTED || bucket.totals.bills > 0,
  );

  const byTan: TanSummary[] = [];
  if (doc.attribution.tdsGrouping === 'registration') {
    const tans = new Map<string, TanSummary>();
    for (const bucket of byRegistration) {
      const tan = normaliseTaxId(bucket.registration?.tan) || '';
      const summary = tans.get(tan) ?? { tan, labels: [], tds: 0, bills: 0 };
      summary.labels.push(bucket.label);
      summary.tds = round2(summary.tds + bucket.totals.tds);
      summary.bills += bucket.totals.bills;
      tans.set(tan, summary);
    }
    byTan.push(...[...tans.values()].sort((a, b) => b.tds - a.tds));
  }

  return { byRegistration, company, companyFlags, byTan, attributionOf };
}
