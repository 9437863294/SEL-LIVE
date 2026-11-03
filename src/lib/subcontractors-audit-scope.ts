/**
 * Which Subcontractors Management audit rows belong to which project.
 *
 * The module's records are per project — work orders, JMC entries, bills, proforma and retention
 * bills all live under `projects/{id}/…` — so its audit trail is kept per project too: a project
 * entry carries `details.projectId` (and `projectName`), and a project's Audit Log page shows only
 * its own. Two things the module keeps are shared by every project — the subcontractor register
 * (`subcontractors`) and the billing workflow (`workflows/billing-workflow`) — so changes to those
 * are written without a project, marked `scope: 'All projects'`, and appear in every project's trail.
 *
 * Pure (no Firebase, no React) so the rule stays unit-testable.
 */

import { projectMatchesSlug } from './project-slug.ts';

/** The project an entry belongs to; `null` for a module-wide entry (subcontractor register, workflow). */
export interface SubcontractorAuditProject {
  id?: string | null;
  name?: string | null;
}

/** Marks an entry that applies to every project. */
export const MODULE_WIDE_SCOPE = 'All projects';

/**
 * The details an entry is written with: the project first (so it reads first in the log), then the
 * action's own context. `undefined` values are dropped — Firestore rejects them.
 */
export function subcontractorAuditDetails(
  project: SubcontractorAuditProject | null | undefined,
  details: Record<string, unknown> = {},
): Record<string, unknown> {
  const head: Record<string, unknown> =
    project?.id
      ? { projectId: project.id, projectName: project.name || undefined }
      : { scope: MODULE_WIDE_SCOPE };
  return Object.fromEntries(Object.entries({ ...head, ...details }).filter(([, v]) => v !== undefined));
}

/**
 * Whether a logged entry belongs in this project's trail.
 *
 * - An entry that names a project (`details.projectId`) belongs to that project only.
 * - Entries written before projects were recorded by id carried the URL slug as `details.project`;
 *   those match by slug.
 * - An entry with neither is module-wide and belongs to every project.
 */
export function belongsToProjectTrail(
  log: { details?: Record<string, unknown> | null },
  project: { id: string; projectName?: unknown },
): boolean {
  const details = log.details ?? {};
  const projectId = typeof details.projectId === 'string' ? details.projectId.trim() : '';
  if (projectId) return projectId === project.id;
  const slug = typeof details.project === 'string' ? details.project.trim() : '';
  if (slug) return projectMatchesSlug(project.projectName, slug);
  return true;
}

type Can = (action: string, resource: string, scope?: string) => boolean;

/**
 * Who may open the Audit Log, for one project (`projectId`) or every project (omitted).
 *
 * - Its own right, `Subcontractors Management.Audit Log` (scoped to the project, or unscoped).
 * - The module's settings administrators (Billing › View Settings), as in Recurring Payments, so the
 *   page is reachable before anyone has been granted the new right.
 * - Settings › Audit Logs, which already sees every module's trail.
 */
export function canViewSubcontractorAudit(can: Can, projectId?: string | null): boolean {
  return (
    can('View', 'Subcontractors Management.Audit Log', projectId || undefined) ||
    can('View Settings', 'Subcontractors Management.Billing') ||
    can('View', 'Settings.Audit Logs')
  );
}

/** Export to Excel: the right's Export, the module's settings editors, or a global auditor. */
export function canExportSubcontractorAudit(can: Can, projectId?: string | null): boolean {
  return (
    can('Export', 'Subcontractors Management.Audit Log', projectId || undefined) ||
    can('Edit Settings', 'Subcontractors Management.Billing') ||
    can('View', 'Settings.Audit Logs')
  );
}

/** A bank account number as it may appear in the log: only its last four digits. */
export function maskAccountNumber(value: unknown): string {
  const text = String(value ?? '').replace(/\s+/g, '');
  if (!text) return '';
  return text.length <= 4 ? text : `${'•'.repeat(Math.min(text.length - 4, 6))}${text.slice(-4)}`;
}

/** Contact people as one readable line, so an edit's before → after is legible rather than JSON. */
export function contactsSummary(
  contacts: ReadonlyArray<{ type?: string; name?: string; mobile?: string; email?: string }> | null | undefined,
): string {
  return (contacts ?? [])
    .map((c) => {
      const who = [c.name, c.mobile, c.email].map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
      return who ? `${c.type || 'Contact'}: ${who}` : '';
    })
    .filter(Boolean)
    .join('; ');
}

interface SubcontractorFields {
  status?: string;
  legalName?: string;
  dbaName?: string;
  registeredAddress?: string;
  operatingAddress?: string;
  gstNumber?: string;
  panNumber?: string;
  bankName?: string;
  bankBranch?: string;
  accountNumber?: string;
  ifscCode?: string;
  contacts?: ReadonlyArray<{ type?: string; name?: string; mobile?: string; email?: string }>;
}

/**
 * A subcontractor as the log compares it: the form's fields, the account number masked and the
 * contacts flattened — so a diff of two snapshots names what changed without exposing the account.
 */
export function subcontractorAuditSnapshot(s: SubcontractorFields | null | undefined): Record<string, unknown> {
  return {
    status: s?.status ?? '',
    legalName: s?.legalName ?? '',
    dbaName: s?.dbaName ?? '',
    registeredAddress: s?.registeredAddress ?? '',
    operatingAddress: s?.operatingAddress ?? '',
    gstNumber: s?.gstNumber ?? '',
    panNumber: s?.panNumber ?? '',
    bankName: s?.bankName ?? '',
    bankBranch: s?.bankBranch ?? '',
    accountNumber: maskAccountNumber(s?.accountNumber),
    ifscCode: s?.ifscCode ?? '',
    contacts: contactsSummary(s?.contacts),
  };
}

interface BillFields {
  billNo?: string;
  billDate?: string;
  subtotal?: number;
  gstType?: string;
  gstPercentage?: number | null;
  gstAmount?: number;
  grossAmount?: number;
  retentionType?: string;
  retentionPercentage?: number | null;
  retentionAmount?: number;
  otherDeduction?: number;
  advanceDeductions?: ReadonlyArray<{ amount?: number }>;
  totalDeductions?: number;
  netPayable?: number;
  items?: ReadonlyArray<{ boqSlNo?: string; billedQty?: number | string }>;
}

const round2 = (n: unknown): number => {
  const value = Number(n);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
};

/**
 * A bill as the log compares it: its figures and each line's billed quantity (keyed by BOQ SL No),
 * rather than the whole items array — an edit then reads "Billed qty · 1.2: 10 → 12".
 */
export function billAuditSnapshot(b: BillFields | null | undefined): Record<string, unknown> {
  const lines: Record<string, unknown> = {};
  (b?.items ?? []).forEach((item, index) => {
    lines[`Billed qty · ${item.boqSlNo || `line ${index + 1}`}`] = round2(item.billedQty);
  });
  return {
    billNo: b?.billNo ?? '',
    billDate: b?.billDate ?? '',
    lineCount: (b?.items ?? []).length,
    ...lines,
    subtotal: round2(b?.subtotal),
    gstType: b?.gstType ?? '',
    gstPercentage: b?.gstPercentage ?? null,
    gstAmount: round2(b?.gstAmount),
    grossAmount: round2(b?.grossAmount),
    retentionType: b?.retentionType ?? '',
    retentionPercentage: b?.retentionPercentage ?? null,
    retentionAmount: round2(b?.retentionAmount),
    otherDeduction: round2(b?.otherDeduction),
    advanceDeduction: round2((b?.advanceDeductions ?? []).reduce((sum, a) => sum + (Number(a.amount) || 0), 0)),
    totalDeductions: round2(b?.totalDeductions),
    netPayable: round2(b?.netPayable),
  };
}
