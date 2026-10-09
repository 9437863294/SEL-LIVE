import 'server-only';

/**
 * Recording the client's certification of a bill.
 *
 * The certification sits beside the raised figures on the bill document and never changes them:
 * the receivable stays the invoice as issued until a credit (or debit) note against it is raised —
 * which is how the books settle a lower certificate. Amounts are recomputed here from the submitted
 * source values (taxable, GST components, deduction lines) with the same formulas as a bill, so the
 * comparison is never fed a client-side total.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { WORKFLOW_PATH, grossAmount, netReceivable, totalDeduction } from '../calculations.ts';
import { canBeCertified } from '../certification.ts';
import { roundMoney } from '../money.ts';
import type { CertificationInput } from '../schemas';
import type { Bill, BillCertification, BillWorkflowStatus } from '../types';
import { certificationBlocked } from '../workflow.ts';
import { composeGst, notifyWaiting, resolveDeductions, workflowActor } from './bills';
import { BtError, db, type BtContext } from './context';
import { BT_COLLECTIONS, clean, loadConfig, logActivityTx, nowIso } from './store';

type StoredBill = Bill & { organizationId: string };

const PRE_CERTIFIED: readonly BillWorkflowStatus[] = WORKFLOW_PATH.slice(0, WORKFLOW_PATH.indexOf('certified'));

const headline = (certification: Pick<BillCertification, 'taxableAmount' | 'gstAmount' | 'totalDeduction' | 'netAmount'>) => ({
  taxableAmount: certification.taxableAmount,
  gstAmount: certification.gstAmount,
  totalDeduction: certification.totalDeduction,
  netAmount: certification.netAmount,
});

export async function recordCertification(context: BtContext, billId: string, input: CertificationInput): Promise<{ revision: number }> {
  const config = await loadConfig(context.organizationId);
  const ref = db().collection(BT_COLLECTIONS.bills).doc(billId);
  let revision = 0;
  let advanced: StoredBill | undefined;
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BtError('Bill not found.', 404);
    const bill = { ...(snapshot.data() as StoredBill), id: snapshot.id };
    if (bill.organizationId !== context.organizationId) throw new BtError('Bill not found.', 404);
    if (bill.isDeleted) throw new BtError('A deleted bill cannot be certified.', 410);
    const blocked = certificationBlocked(bill, config.settings, workflowActor(context));
    if (blocked) throw new BtError(blocked, 403);
    if (!canBeCertified(bill)) throw new BtError('Credit and debit notes are not certified by the client — certify the invoice they adjust.');
    const previous = bill.certification;
    if (input.expectedRevision !== undefined && input.expectedRevision !== (previous?.revision ?? 0)) {
      throw new BtError('Someone else changed this certification while you were editing it. Reload to see their changes, then edit again.', 409);
    }

    // GST type as certified, else the raised bill's; with neither, one GST figure (an imported bill).
    const gst = composeGst({
      gstType: input.gstType ?? bill.gstType,
      gstPercent: input.gstPercent ?? bill.gstPercent,
      taxableAmount: input.taxableAmount,
      gstAmount: input.gstAmount,
      cgstAmount: input.cgstAmount,
      sgstAmount: input.sgstAmount,
      igstAmount: input.igstAmount,
    });
    // A deduction type retired since stays valid if the bill or the earlier certification used it.
    const deductions = resolveDeductions(input.deductions, config, { taxable: input.taxableAmount, gross: roundMoney(input.taxableAmount + gst.gstAmount), gstType: gst.gstType }, [...(previous?.deductions ?? []), ...(bill.deductions ?? [])]);
    const gross = grossAmount(input.taxableAmount, gst.gstAmount);
    const deducted = totalDeduction(deductions);
    revision = (previous?.revision ?? 0) + 1;
    const now = nowIso();
    const certification: BillCertification = clean({
      certifiedDate: input.certifiedDate,
      reference: input.reference,
      certifiedBy: input.certifiedBy,
      taxableAmount: roundMoney(input.taxableAmount),
      ...gst,
      grossAmount: gross,
      deductions,
      totalDeduction: deducted,
      netAmount: netReceivable(gross, deducted, config.settings.roundNetToRupee),
      remarks: input.remarks,
      revision,
      recordedBy: previous?.recordedBy ?? context.userId,
      recordedByName: previous?.recordedByName ?? context.userName,
      recordedAt: previous?.recordedAt ?? now,
      updatedBy: previous ? context.userId : undefined,
      updatedByName: previous ? context.userName : undefined,
      updatedAt: previous ? now : undefined,
    });

    // A bill at any step before Certified moves there (the client has evidently received it); one
    // further along (follow-up, reconciliation, closed) or returned for correction keeps its stage.
    const advance = !previous && PRE_CERTIFIED.includes(bill.workflowStatus);
    if (advance) advanced = { ...bill, workflowStatus: 'certified' };
    transaction.update(ref, { certification, ...(advance ? { workflowStatus: 'certified' } : {}), version: (bill.version ?? 1) + 1, updatedAt: now, updatedBy: context.userId, updatedByName: context.userName });
    const reference = certification.reference ? ` ${certification.reference}` : '';
    if (advance) {
      logActivityTx(transaction, context, {
        entityType: 'bill',
        entityId: billId,
        billId,
        projectId: bill.projectId,
        action: 'workflow_certified',
        summary: `Bill ${bill.billSerialNumber ?? ''}: ${bill.workflowStatus.replace(/_/g, ' ')} → certified (client certification recorded)`,
        previous: { workflowStatus: bill.workflowStatus },
        next: { workflowStatus: 'certified' },
      });
    }
    logActivityTx(transaction, context, {
      entityType: 'bill',
      entityId: billId,
      billId,
      projectId: bill.projectId,
      action: previous ? 'certification_changed' : 'certification_recorded',
      summary: previous
        ? `Client certification${reference} changed — certified net ${certification.netAmount} (was ${previous.netAmount}), raised net ${bill.netReceivable}`
        : `Client certification${reference} of ${certification.certifiedDate} recorded — certified net ${certification.netAmount} against raised net ${bill.netReceivable}`,
      previous: previous ? headline(previous) : undefined,
      next: headline(certification),
    });
  });
  // The bill now waits for its next stage (payment follow-up): tell those people.
  if (advanced) await notifyWaiting(context, advanced, config.settings, 'certified');
  return { revision };
}

export async function removeCertification(context: BtContext, billId: string, reason: string): Promise<void> {
  const { settings } = await loadConfig(context.organizationId);
  const ref = db().collection(BT_COLLECTIONS.bills).doc(billId);
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BtError('Bill not found.', 404);
    const bill = { ...(snapshot.data() as StoredBill), id: snapshot.id };
    if (bill.organizationId !== context.organizationId) throw new BtError('Bill not found.', 404);
    const blocked = certificationBlocked(bill, settings, workflowActor(context));
    if (blocked) throw new BtError(blocked, 403);
    const previous = bill.certification;
    if (!previous) throw new BtError('This bill has no client certification to remove.', 409);
    const now = nowIso();
    // A bill still at Certified goes back to Bill raised; one already further along keeps its stage.
    const revert = bill.workflowStatus === 'certified';
    transaction.update(ref, { certification: FieldValue.delete(), ...(revert ? { workflowStatus: 'raised' } : {}), version: (bill.version ?? 1) + 1, updatedAt: now, updatedBy: context.userId, updatedByName: context.userName });
    logActivityTx(transaction, context, {
      entityType: 'bill',
      entityId: billId,
      billId,
      projectId: bill.projectId,
      action: 'certification_removed',
      summary: `Client certification${previous.reference ? ` ${previous.reference}` : ''} removed`,
      previous: headline(previous),
      reason,
    });
  });
}
