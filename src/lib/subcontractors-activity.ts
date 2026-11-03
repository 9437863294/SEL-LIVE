'use client';

/**
 * Subcontractors Management's rows in the app-wide audit trail (`userLogs`) — what Settings › Audit
 * Logs lists under "Subcontractors Management", and what each project's own Audit Log page reads.
 *
 * Every write in the module calls this once it has committed. Rows are written under the module's
 * own name only (never Project Management's or Billing Recon's, though the module sits on their
 * project registers), and each project entry carries its project — see subcontractors-audit-scope.ts
 * for how a project's trail is told apart from another's and from module-wide changes.
 *
 * Fire-and-forget: a failed log write is reported to the console and never fails the action.
 */

import { logUserActivity } from '@/lib/activity-logger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { subcontractorAuditDetails, type SubcontractorAuditProject } from '@/lib/subcontractors-audit-scope';

export interface SubcontractorActivityActor {
  id?: string | null;
  uid?: string | null;
  name?: string | null;
  displayName?: string | null;
  email?: string | null;
}

export interface SubcontractorActivityTarget {
  /** Firestore id of the record the action touched. */
  recordId?: string | null;
  /** Its human reference — bill no, work order no, subcontractor name. */
  recordRef?: string | null;
}

/**
 * @param project the project the action belongs to, or `null` for a module-wide change (the shared
 *   subcontractor register, the billing workflow).
 */
export function logSubcontractorActivity(
  actor: SubcontractorActivityActor | null | undefined,
  project: SubcontractorAuditProject | null,
  action: string,
  details: Record<string, unknown> = {},
  target: SubcontractorActivityTarget = {},
): void {
  const userId = actor?.id || actor?.uid;
  if (!userId) return;
  // The screens are also mounted inside Billing Recon; the row is still Subcontractors
  // Management's (it is that module's record), and says where it was done.
  let openedIn: string | undefined;
  try {
    openedIn = typeof window !== 'undefined' && window.location.pathname.startsWith('/billing-recon/') ? 'Billing Recon' : undefined;
  } catch {
    openedIn = undefined;
  }
  let sessionId: string | undefined;
  try {
    sessionId = typeof window !== 'undefined' ? (localStorage.getItem('sessionId') ?? undefined) : undefined;
  } catch {
    sessionId = undefined;
  }
  void logUserActivity({
    userId,
    userName: actor?.name || actor?.displayName || undefined,
    userEmail: actor?.email || undefined,
    module: ACTIVITY_MODULES.SUBCONTRACTORS,
    action,
    details: subcontractorAuditDetails(project, { ...details, openedIn }),
    recordId: target.recordId || undefined,
    recordRef: target.recordRef || undefined,
    sessionId,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  });
}

/** The parts of a bill (regular, retention or proforma) a workflow log names. */
export interface WorkflowBill {
  id: string;
  projectId?: string | null;
  projectName?: string | null;
  billNo?: string | null;
  proformaNo?: string | null;
  subcontractorName?: string | null;
  isRetentionBill?: boolean | null;
  netPayable?: number | null;
  payableAmount?: number | null;
}

/** Where a workflow action left the bill: the step it was acted at and where it went. */
export interface WorkflowMove {
  step: string;
  movedTo: string;
  status: string;
}

/**
 * One approval-workflow action on a bill ("Workflow: Approve", "Workflow: Reject"…), from the
 * Billing Log's view dialog or a stage's task list — the two places a bill is moved on.
 */
export function logBillWorkflowAction(
  actor: SubcontractorActivityActor | null | undefined,
  bill: WorkflowBill,
  action: string,
  comment: string,
  move: WorkflowMove | null,
  projectName?: string | null,
): void {
  const isProforma = !!bill.proformaNo;
  logSubcontractorActivity(
    actor,
    { id: bill.projectId, name: projectName || bill.projectName },
    `Workflow: ${action}`,
    {
      billType: isProforma ? 'Proforma' : bill.isRetentionBill ? 'Retention' : 'Regular',
      step: move?.step || undefined,
      movedTo: move?.movedTo || undefined,
      status: move?.status || undefined,
      comment: comment.trim() || undefined,
      subcontractor: bill.subcontractorName || undefined,
      amount: (isProforma ? bill.payableAmount : bill.netPayable) ?? undefined,
    },
    { recordId: bill.id, recordRef: (isProforma ? bill.proformaNo : bill.billNo) || bill.id },
  );
}
