/**
 * What Settings › Company Profile tells the person before they save.
 *
 * Save sends the draft through `sanitizeCompanyProfile`, which quietly drops a value it cannot
 * accept (a mistyped PAN, a GSTIN with the wrong check character) and puts the default in place of
 * a blank required one. The checks below run that same sanitiser on the draft and report each
 * difference, so a warning can never disagree with what is stored, and nothing typed is lost
 * without the screen saying so first.
 *
 * Pure (company-profile and statutory only), so node runs it under the tests.
 */

import { LETTERHEAD_HTML_MAX_LENGTH, sanitizeCompanyProfile, type CompanyGstRegistration, type CompanyProfile } from './company-profile.ts';
import { COMPANY_GST_STATE_CODE, checkGstin, normaliseTaxId } from './statutory.ts';

/** The screen's tabs; every field belongs to one. */
export type ProfileArea = 'details' | 'gst' | 'letterhead' | 'print';

export interface ProfileIssue {
  area: ProfileArea;
  /** The field, as the screen names its inputs: `pan`, `gst.2`, `accentColor`. */
  field: string;
  /** The field's name on screen. */
  label: string;
  message: string;
  /** An error would lose or replace what was typed, so it holds Save back; a warning only informs. */
  severity: 'error' | 'warning';
}

/** The sanitiser's own clean-up: runs of whitespace collapsed, ends trimmed. */
const tidy = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

/** Blank, these save as the built-in default (another company's city, say), so they are required. */
const REQUIRED = [
  { field: 'legalName', label: 'Legal name' },
  { field: 'shortName', label: 'Short name' },
  { field: 'city', label: 'City' },
  { field: 'pincode', label: 'PIN code' },
  { field: 'state', label: 'State' },
  { field: 'country', label: 'Country' },
] as const;

/** Optional, but dropped on save when they do not pass the sanitiser's check. */
const CHECKED = [
  { field: 'cin', label: 'CIN', message: 'Not a CIN: 21 characters, like U31200OR1990PLC002345.' },
  { field: 'pan', label: 'PAN', message: 'Not a PAN: 5 letters, 4 digits and a letter, like AAACS1234F.' },
  { field: 'email', label: 'Email', message: 'Not an email address.' },
  { field: 'website', label: 'Website', message: 'Not a web address, like www.example.com.' },
  { field: 'logoUrl', label: 'Logo link', message: 'Use an https:// link to the image.' },
] as const;

/** The millimetre settings of a designed letterhead and the range the sanitiser keeps them in. */
const MILLIMETRES = [
  { field: 'headerHeightMm', label: 'Header height', min: 5, max: 120 },
  { field: 'footerHeightMm', label: 'Footer height', min: 5, max: 80 },
  { field: 'marginMm', label: 'Page margins', min: 0, max: 40 },
] as const;

const MAX_ADDRESS_LINES = 4;
const MAX_GST_REGISTRATIONS = 20;
const MAX_SIGNATURE_CAPTIONS = 6;

export type GstRowState = 'empty' | 'invalid' | 'duplicate' | 'valid';

export interface GstRowStatus {
  state: GstRowState;
  /** What is wrong, or for a valid row its state and the PAN inside it. */
  message: string;
  stateName?: string;
  pan?: string;
}

/** Each registration row as the sanitiser will see it: kept (valid) or dropped, and why. */
export function gstRowStatuses(rows: CompanyGstRegistration[]): GstRowStatus[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const gstin = normaliseTaxId(row.gstin);
    if (!gstin) return { state: 'empty', message: 'Enter the GSTIN, or remove this row.' };
    const check = checkGstin(gstin);
    if (!check.valid) return { state: 'invalid', message: check.error ?? 'Not a GSTIN.' };
    if (seen.has(gstin)) return { state: 'duplicate', message: 'Already in the list. Remove one of the two.' };
    seen.add(gstin);
    return { state: 'valid', message: `${check.stateName} · PAN ${check.pan}`, stateName: check.stateName, pan: check.pan };
  });
}

/** The PAN inside the primary registration's GSTIN (else the first valid one's); `null` with none. */
export function panFromGstins(rows: CompanyGstRegistration[]): string | null {
  const statuses = gstRowStatuses(rows);
  const valid = rows.map((row, index) => ({ row, status: statuses[index] })).filter(({ status }) => status.state === 'valid');
  const chosen = valid.find(({ row }) => row.primary) ?? valid[0];
  return chosen?.status.pan ?? null;
}

/** Everything Save would drop, replace or cut short, in the order the screen shows the fields. */
export function profileIssues(draft: CompanyProfile): ProfileIssue[] {
  const stored = sanitizeCompanyProfile(draft);
  const issues: ProfileIssue[] = [];

  for (const { field, label } of REQUIRED) {
    if (!tidy(draft[field])) issues.push({ area: 'details', field, label, message: 'Required.', severity: 'error' });
  }
  for (const { field, label, message } of CHECKED) {
    if (tidy(draft[field]) && !stored[field]) issues.push({ area: 'details', field, label, message, severity: 'error' });
  }
  const lines = draft.addressLines.map(tidy).filter(Boolean).length;
  if (lines > MAX_ADDRESS_LINES) {
    issues.push({ area: 'details', field: 'addressLines', label: 'Address lines', message: `Only the first four lines are kept; this has ${lines}.`, severity: 'warning' });
  }
  // A GSTIN's characters 3–12 are its holder's PAN, so a different PAN is most likely a typo.
  const gstPan = panFromGstins(draft.gstRegistrations);
  if (stored.pan && gstPan && stored.pan !== gstPan) {
    issues.push({ area: 'details', field: 'pan', label: 'PAN', message: `The primary GSTIN carries PAN ${gstPan}.`, severity: 'warning' });
  }

  const statuses = gstRowStatuses(draft.gstRegistrations);
  statuses.forEach((status, index) => {
    if (status.state !== 'valid') issues.push({ area: 'gst', field: `gst.${index}`, label: `GSTIN ${index + 1}`, message: status.message, severity: 'error' });
  });
  const kept = statuses.filter((status) => status.state === 'valid').length;
  if (kept > MAX_GST_REGISTRATIONS) {
    issues.push({ area: 'gst', field: `gst.${MAX_GST_REGISTRATIONS}`, label: 'GST registrations', message: `Only the first ${MAX_GST_REGISTRATIONS} are kept; this has ${kept}.`, severity: 'warning' });
  }

  // Each letterhead setting is checked only while its mode shows it, so a message never points at a
  // field the screen is not drawing. The other mode's values are stored as they are.
  const lh = draft.design.letterhead;
  if (lh.mode === 'standard' && tidy(lh.accentColor).toLowerCase() !== stored.design.letterhead.accentColor) {
    issues.push({ area: 'letterhead', field: 'accentColor', label: 'Accent colour', message: 'Use a six-digit colour code, like #1e293b.', severity: 'error' });
  }
  if (lh.mode === 'custom') {
    for (const [field, label] of [['headerHtml', 'Header'], ['footerHtml', 'Footer']] as const) {
      if (lh.custom[field].length > LETTERHEAD_HTML_MAX_LENGTH) {
        issues.push({ area: 'letterhead', field, label, message: 'Too large to store. Remove some content or images.', severity: 'error' });
      }
    }
    for (const { field, label, min, max } of MILLIMETRES) {
      const typed = lh.custom[field];
      const savedAs = stored.design.letterhead.custom[field];
      if (typed !== null && typed !== savedAs) {
        issues.push({ area: 'letterhead', field, label, message: `Saved as ${savedAs} mm: it must be ${min} to ${max} mm.`, severity: 'warning' });
      }
    }
  }

  const captions = draft.design.print.signatureLabels.map(tidy).filter(Boolean).length;
  if (captions > MAX_SIGNATURE_CAPTIONS) {
    issues.push({ area: 'print', field: 'signatureLabels', label: 'Signature captions', message: `Only the first six print; this has ${captions}.`, severity: 'warning' });
  }
  return issues;
}

/** One issue per field: an error wins over a warning about the same field. */
export function issuesByField(issues: ProfileIssue[]): Record<string, ProfileIssue> {
  const out: Record<string, ProfileIssue> = {};
  for (const issue of issues) {
    if (!out[issue.field] || (issue.severity === 'error' && out[issue.field].severity !== 'error')) out[issue.field] = issue;
  }
  return out;
}

const DETAIL_FIELDS = [
  'legalName', 'shortName', 'tagline', 'cin', 'pan', 'addressLines', 'city', 'state', 'pincode', 'country', 'phone', 'email', 'website', 'logoUrl',
] as const;

/** The tabs holding an unsaved change, in tab order. Nothing else on the profile is edited here. */
export function changedAreas(draft: CompanyProfile, saved: CompanyProfile): ProfileArea[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const areas: ProfileArea[] = [];
  if (DETAIL_FIELDS.some((field) => !same(draft[field], saved[field]))) areas.push('details');
  if (!same(draft.gstRegistrations, saved.gstRegistrations)) areas.push('gst');
  if (!same(draft.design.letterhead, saved.design.letterhead)) areas.push('letterhead');
  if (!same(draft.design.print, saved.design.print)) areas.push('print');
  return areas;
}

/** A registration from Expenses › GST registrations, as far as the profile needs it. */
export interface ImportableRegistration {
  gstin: string;
  stateName: string;
  label: string;
}

/** The registrations Expenses has that the profile does not list yet. */
export function registrationsNotListed(rows: CompanyGstRegistration[], importable: ImportableRegistration[]): ImportableRegistration[] {
  const listed = new Set(rows.map((row) => normaliseTaxId(row.gstin)));
  return importable.filter((registration) => !listed.has(normaliseTaxId(registration.gstin)));
}

/**
 * Expenses' registrations first, each keeping its primary flag here, then the profile's own others.
 * With no primary at all, the head-office state's registration becomes primary.
 */
export function mergeImportedRegistrations(rows: CompanyGstRegistration[], importable: ImportableRegistration[]): CompanyGstRegistration[] {
  const existing = new Map(rows.map((row) => [normaliseTaxId(row.gstin), row]));
  const imported = importable.map((registration) => {
    const gstin = normaliseTaxId(registration.gstin);
    return { gstin, state: registration.stateName, label: registration.label || registration.stateName, primary: existing.get(gstin)?.primary ?? false };
  });
  const importedIds = new Set(imported.map((registration) => registration.gstin));
  const merged = [...imported, ...rows.filter((row) => !importedIds.has(normaliseTaxId(row.gstin)))];
  if (!merged.some((registration) => registration.primary)) {
    const home = merged.findIndex((registration) => registration.gstin.startsWith(COMPANY_GST_STATE_CODE));
    if (home >= 0) merged[home] = { ...merged[home], primary: true };
  }
  return merged;
}
