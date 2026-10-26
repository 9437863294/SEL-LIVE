import 'server-only';

/**
 * Receipts (collections) on the server.
 *
 * One bank receipt can be split across several bills (a client paying three invoices with one
 * RTGS). The receipt document holds the allocation; each bill holds a mirror of its own share in
 * `collections`, which is what its totals derive from. Both are written in one transaction that
 * first re-reads every affected bill, so two finance users recording receipts against the same bill
 * at the same moment both land, and the outstanding is computed from both — never from a total
 * either browser was showing.
 *
 * Only verified receipts reduce the outstanding. A receipt can be recorded as a draft by one person
 * and verified by another (the default), or verified on entry by someone holding Verify.
 *
 * Receipts against a retention bill are retention coming back, so verifying one also writes a
 * release to the retention ledger (and cancelling the receipt cancels that release).
 *
 * A receipt that names a Bank Balance account is also real money in that account, so verifying one
 * posts a single Credit to `bankExpenses` and cancelling it removes that Credit again. See
 * `../bank-posting.ts` for the document and `postBankCredit` below for the transaction side.
 */

import { FieldValue, Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';

import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { dispatchNotificationServer } from '@/lib/notifications-server';

import { bankCreditForCollection } from '../bank-posting.ts';
import { deriveBillTotals, financialYearOf, isoWeekOf } from '../calculations.ts';
import { subtractMoney, sumMoney, toPaise } from '../money.ts';
import type { CollectionInput } from '../schemas';
import type { Bill, BillCollection, BillCollectionRef, BillTrackingConfig, CollectionStatus, RetentionRelease } from '../types';
import { receiptBlockReason } from '../certification.ts';
import { assertMonthOpen, calculationOptions } from './bills';
import { BtError, db, type BtContext } from './context';
import { BT_COLLECTIONS, clean, loadConfig, logActivityTx, nowIso } from './store';

type StoredBill = Bill & { organizationId: string };
type StoredCollection = BillCollection & { organizationId: string };

/** Bank Balance's ledger of bank entries — a Credit here is money in the account. */
const BANK_EXPENSES = 'bankExpenses';

/**
 * Writes the Bank Balance Credit for a verified receipt and returns its id, or `undefined` when
 * the receipt does not post one (no account chosen, or one is already posted — see
 * `bankCreditForCollection`). The caller stores the id as `bankExpenseId` on the receipt **in the
 * same transaction**, which is what makes a second verify a no-op instead of a second credit.
 *
 * Write-only: nothing is read here, so it may be called after the transaction's reads.
 */
function postBankCredit(transaction: Transaction, collection: StoredCollection): string | undefined {
  const draft = bankCreditForCollection(collection);
  if (!draft) return undefined;
  const ref = db().collection(BANK_EXPENSES).doc();
  // `clean` is applied to the draft only: a Timestamp is an object clean() would flatten.
  transaction.set(ref, { ...clean(draft), date: Timestamp.fromDate(draft.date), createdAt: Timestamp.now() });
  return ref.id;
}

/**
 * Removes the Credit a cancelled receipt had posted, if any, and returns the update that clears
 * the pointer.
 *
 * The bank row is **deleted**, not flagged — unlike a retention release, which is marked
 * cancelled. The Bank Balance ledger sums every `bankExpenses` row and has no status column, so a
 * flagged row would still be counted and the balance would stay overstated.
 */
function reverseBankCredit(transaction: Transaction, collection: StoredCollection): Record<string, unknown> {
  if (!collection.bankExpenseId) return {};
  transaction.delete(db().collection(BANK_EXPENSES).doc(collection.bankExpenseId));
  return { bankExpenseId: FieldValue.delete() };
}

/** Recomputes a bill after its receipt list changed, and returns the update to write. */
function billUpdateFor(bill: StoredBill, collections: BillCollectionRef[], config: BillTrackingConfig): Record<string, unknown> {
  const totals = deriveBillTotals({ ...bill, collections }, calculationOptions(config));
  const update: Record<string, unknown> = {
    collections,
    totalReceived: totals.totalReceived,
    outstandingAmount: totals.outstandingAmount,
    shortfallSurplus: totals.shortfallSurplus,
    paymentStatus: totals.paymentStatus,
    lastReceiptDate: totals.lastReceiptDate ?? FieldValue.delete(),
    version: (bill.version ?? 1) + 1,
    updatedAt: nowIso(),
  };
  // RECEIVED WEEK: the week the bill became fully paid, as the legacy sheet recorded it.
  if (totals.paymentStatus === 'received' && bill.paymentStatus !== 'received' && totals.lastReceiptDate) update.receivedWeek = isoWeekOf(totals.lastReceiptDate);
  if (totals.paymentStatus !== 'received' && bill.paymentStatus === 'received') update.receivedWeek = FieldValue.delete();
  return update;
}

async function readBills(transaction: Transaction, context: BtContext, billIds: string[]): Promise<Map<string, { ref: DocumentReference; bill: StoredBill }>> {
  const refs = billIds.map((id) => db().collection(BT_COLLECTIONS.bills).doc(id));
  const snapshots = await transaction.getAll(...refs);
  const bills = new Map<string, { ref: DocumentReference; bill: StoredBill }>();
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) throw new BtError(`Bill ${billIds[index]} not found.`, 404);
    const bill = { ...(snapshot.data() as StoredBill), id: snapshot.id };
    if (bill.organizationId !== context.organizationId) throw new BtError(`Bill ${billIds[index]} not found.`, 404);
    if (bill.isDeleted) throw new BtError(`Bill ${bill.billSerialNumber ?? bill.id} has been deleted.`, 410);
    bills.set(snapshot.id, { ref: refs[index], bill });
  });
  return bills;
}

function retentionReleaseFor(context: BtContext, collection: StoredCollection, bill: StoredBill, amount: number): Omit<RetentionRelease, 'id'> & { organizationId: string } {
  return clean({
    organizationId: context.organizationId,
    projectId: bill.projectId,
    projectNameSnapshot: bill.projectNameSnapshot,
    retentionBillId: bill.id,
    collectionId: collection.id,
    kind: 'retention_invoice',
    releaseDate: collection.receiptDate,
    amount,
    remarks: `Receipt against retention bill ${bill.gstInvoiceNumber || bill.billSerialNumber || bill.id}`,
    status: 'active',
    createdBy: context.userId,
    createdByName: context.userName,
    createdAt: nowIso(),
  });
}

export async function createCollection(context: BtContext, input: CollectionInput): Promise<{ id: string; unallocated: number }> {
  const config = await loadConfig(context.organizationId);
  assertMonthOpen(context, config, [input.receiptDate], 'Recording a receipt dated in it');
  const billIds = input.allocations.map((entry) => entry.billId);
  if (new Set(billIds).size !== billIds.length) throw new BtError('Each bill can appear only once in an allocation.');
  const allocated = sumMoney(input.allocations.map((entry) => entry.amount));
  const unallocated = subtractMoney(input.amount, allocated);
  const sameSign = input.allocations.every((entry) => Math.sign(entry.amount) === Math.sign(input.amount));
  if (!sameSign) throw new BtError('Allocations must have the same sign as the receipt.');
  if (Math.abs(toPaise(allocated)) > Math.abs(toPaise(input.amount))) throw new BtError(`Allocations (₹${allocated}) exceed the receipt amount (₹${input.amount}).`);
  if (toPaise(unallocated) !== 0) {
    if (!input.allowUnallocated) throw new BtError(`Allocations total ₹${allocated} but the receipt is ₹${input.amount}. Allocate the full amount or hold the difference as unallocated.`);
    if (!context.can('Collections', 'Hold Unallocated')) throw new BtError('Holding part of a receipt unallocated needs Collections · Hold Unallocated.', 403);
  }
  const verify = Boolean(input.verifyNow);
  const status: CollectionStatus = verify ? 'verified' : 'draft';

  const firestore = db();
  const ref = firestore.collection(BT_COLLECTIONS.collections).doc();
  const notify: StoredBill[] = [];
  await firestore.runTransaction(async (transaction) => {
    const bills = await readBills(transaction, context, billIds);
    for (const { bill } of bills.values()) {
      context.require('Collections', 'Add', bill.projectId);
      if (verify) context.require('Collections', 'Verify', bill.projectId);
      const blocked = receiptBlockReason(bill, config.settings.certificationBeforeReceipt);
      if (blocked) throw new BtError(blocked, 409, { billId: bill.id, needs: 'certification' });
    }
    const first = bills.get(billIds[0])?.bill as StoredBill;
    const collection: StoredCollection = clean({
      id: ref.id,
      organizationId: context.organizationId,
      financialYear: financialYearOf(input.receiptDate),
      receiptDate: input.receiptDate,
      amount: input.amount,
      allocatedAmount: allocated,
      unallocatedAmount: unallocated,
      allocations: input.allocations.map((entry) => {
        const bill = bills.get(entry.billId)?.bill as StoredBill;
        return clean({ billId: bill.id, billSerialNumber: bill.billSerialNumber, gstInvoiceNumber: bill.gstInvoiceNumber, projectId: bill.projectId, projectNameSnapshot: bill.projectNameSnapshot, amount: entry.amount });
      }),
      billIds,
      projectIds: [...new Set([...bills.values()].map(({ bill }) => bill.projectId))],
      clientId: first.clientId,
      clientNameSnapshot: first.clientNameSnapshot,
      paymentMode: input.paymentMode,
      bankReference: input.bankReference,
      utrNumber: input.utrNumber,
      bankAccountId: input.bankAccountId,
      bankAccountName: input.bankAccountName,
      remarks: input.remarks,
      status,
      source: 'manual',
      createdBy: context.userId,
      createdByName: context.userName,
      createdAt: nowIso(),
      verifiedBy: verify ? context.userId : undefined,
      verifiedByName: verify ? context.userName : undefined,
      verifiedAt: verify ? nowIso() : undefined,
      updatedAt: nowIso(),
    });
    // Bank Balance: one Credit for the whole receipt, and only once it is verified — a draft is
    // not yet money in the bank. Nothing is written when no account was chosen.
    const bankExpenseId = verify ? postBankCredit(transaction, collection) : undefined;
    transaction.set(ref, bankExpenseId ? { ...collection, bankExpenseId } : collection);

    for (const entry of input.allocations) {
      const { ref: billRef, bill } = bills.get(entry.billId) as { ref: DocumentReference; bill: StoredBill };
      const mirror: BillCollectionRef = clean({ collectionId: ref.id, receiptDate: input.receiptDate, amount: entry.amount, status, utrNumber: input.utrNumber, paymentMode: input.paymentMode });
      transaction.update(billRef, billUpdateFor(bill, [...(bill.collections ?? []), mirror], config));
      if (verify && bill.isRetentionBill) transaction.set(firestore.collection(BT_COLLECTIONS.retention).doc(), retentionReleaseFor(context, collection, bill, entry.amount));
      logActivityTx(transaction, context, {
        entityType: 'collection',
        entityId: ref.id,
        billId: bill.id,
        projectId: bill.projectId,
        action: 'receipt_added',
        summary: `₹${entry.amount.toLocaleString('en-IN')} receipt ${verify ? 'recorded and verified' : 'recorded (draft)'} against ${bill.gstInvoiceNumber || bill.billSerialNumber || 'bill'}${input.utrNumber ? ` · UTR ${input.utrNumber}` : ''}`,
        previous: { totalReceived: bill.totalReceived, outstandingAmount: bill.outstandingAmount },
        next: { receiptAmount: entry.amount, receiptDate: input.receiptDate, status },
      });
      notify.push(bill);
    }
  });

  await notifyReceipt(context, notify, input.amount, verify);
  return { id: ref.id, unallocated };
}

async function notifyReceipt(context: BtContext, bills: StoredBill[], amount: number, verified: boolean): Promise<void> {
  try {
    const userIds = [...new Set(bills.map((bill) => bill.collectionOwnerId).filter((id): id is string => Boolean(id) && id !== context.userId))];
    if (!userIds.length) return;
    const first = bills[0];
    await dispatchNotificationServer(
      { userIds },
      {
        type: 'record_assigned',
        module: ACTIVITY_MODULES.BILL_TRACKING,
        title: verified ? 'Receipt recorded' : 'Receipt awaiting verification',
        body: `₹${amount.toLocaleString('en-IN')} against ${bills.length > 1 ? `${bills.length} bills` : first.gstInvoiceNumber || first.billSerialNumber || 'a bill'} · ${first.projectNameSnapshot}`,
        itemId: first.id,
        itemRef: first.gstInvoiceNumber || first.billSerialNumber,
        link: `/bill-tracking/bills/${first.id}`,
        organizationId: context.organizationId,
      },
    );
  } catch {
    // Best-effort.
  }
}

/** Verify or cancel a receipt; every allocated bill is recomputed in the same transaction. */
export async function changeCollectionStatus(context: BtContext, collectionId: string, action: 'verify' | 'cancel', reason?: string): Promise<void> {
  const config = await loadConfig(context.organizationId);
  const firestore = db();
  const ref = firestore.collection(BT_COLLECTIONS.collections).doc(collectionId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BtError('Receipt not found.', 404);
    const collection = { ...(snapshot.data() as StoredCollection), id: snapshot.id };
    if (collection.organizationId !== context.organizationId) throw new BtError('Receipt not found.', 404);
    if (collection.status === 'cancelled') throw new BtError('This receipt is already cancelled.', 409);
    if (action === 'verify' && collection.status === 'verified') throw new BtError('This receipt is already verified.', 409);
    if (action === 'cancel' && !reason) throw new BtError('Give a reason for cancelling a receipt.');
    assertMonthOpen(context, config, [collection.receiptDate], action === 'cancel' ? 'Cancelling a receipt dated in it' : 'Verifying a receipt dated in it');

    // Releases written for this receipt (retention bills) must be read before any write.
    const releases = action === 'cancel' ? await transaction.get(firestore.collection(BT_COLLECTIONS.retention).where('collectionId', '==', collectionId)) : null;
    const bills = await readBills(transaction, context, collection.billIds);
    for (const { bill } of bills.values()) context.require('Collections', action === 'verify' ? 'Verify' : 'Cancel', bill.projectId);
    // A receipt drafted before the client certified still waits for the certification to count.
    if (action === 'verify') {
      for (const { bill } of bills.values()) {
        const blocked = receiptBlockReason(bill, config.settings.certificationBeforeReceipt);
        if (blocked) throw new BtError(blocked, 409, { billId: bill.id, needs: 'certification' });
      }
    }

    const status: CollectionStatus = action === 'verify' ? 'verified' : 'cancelled';
    // Bank Balance: verifying posts the Credit (once — a `bankExpenseId` already on the receipt
    // means it is posted), cancelling deletes it and clears the pointer, so the receipt never
    // names a row that is gone. Kept outside `clean`: the cancel patch carries a FieldValue.
    let bankPatch: Record<string, unknown> = {};
    if (action === 'verify') {
      const bankExpenseId = postBankCredit(transaction, collection);
      if (bankExpenseId) bankPatch = { bankExpenseId };
    } else {
      bankPatch = reverseBankCredit(transaction, collection);
    }
    transaction.update(ref, {
      ...clean({
        status,
        updatedAt: nowIso(),
        ...(action === 'verify'
          ? { verifiedBy: context.userId, verifiedByName: context.userName, verifiedAt: nowIso() }
          : { cancelledBy: context.userId, cancelledAt: nowIso(), cancelReason: reason }),
      }),
      ...bankPatch,
    });

    for (const allocation of collection.allocations) {
      const entry = bills.get(allocation.billId);
      if (!entry) continue;
      const { ref: billRef, bill } = entry;
      const collections = (bill.collections ?? []).map((mirror) => (mirror.collectionId === collectionId ? { ...mirror, status } : mirror));
      transaction.update(billRef, billUpdateFor(bill, collections, config));
      if (action === 'verify' && bill.isRetentionBill) transaction.set(firestore.collection(BT_COLLECTIONS.retention).doc(), retentionReleaseFor(context, collection, bill, allocation.amount));
      logActivityTx(transaction, context, {
        entityType: 'collection',
        entityId: collectionId,
        billId: bill.id,
        projectId: bill.projectId,
        action: action === 'verify' ? 'receipt_verified' : 'receipt_cancelled',
        summary: `₹${allocation.amount.toLocaleString('en-IN')} receipt ${action === 'verify' ? 'verified' : 'cancelled'} on ${bill.gstInvoiceNumber || bill.billSerialNumber || 'bill'}`,
        previous: { status: collection.status, outstandingAmount: bill.outstandingAmount },
        next: { status },
        reason,
      });
    }
    releases?.docs.forEach((doc) => {
      if (doc.data().status === 'active') transaction.update(doc.ref, { status: 'cancelled', cancelledBy: context.userId, cancelledAt: nowIso(), cancelReason: `Receipt cancelled: ${reason}` });
    });
  });
}

/** Reference details of a receipt (UTR, mode, bank, remarks). Amounts change only by cancel and re-enter. */
export async function updateCollectionDetails(
  context: BtContext,
  collectionId: string,
  patch: Pick<CollectionInput, 'paymentMode' | 'bankReference' | 'utrNumber' | 'bankAccountName' | 'remarks'>,
): Promise<void> {
  const firestore = db();
  const ref = firestore.collection(BT_COLLECTIONS.collections).doc(collectionId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BtError('Receipt not found.', 404);
    const collection = { ...(snapshot.data() as StoredCollection), id: snapshot.id };
    if (collection.organizationId !== context.organizationId) throw new BtError('Receipt not found.', 404);
    for (const projectId of collection.projectIds) context.require('Collections', 'Edit', projectId);
    if (collection.status === 'cancelled') throw new BtError('A cancelled receipt cannot be edited.', 409);
    const bills = await readBills(transaction, context, collection.billIds);
    transaction.update(ref, clean({ ...patch, updatedAt: nowIso() }));
    for (const { ref: billRef, bill } of bills.values()) {
      const collections = (bill.collections ?? []).map((mirror) => (mirror.collectionId === collectionId ? clean({ ...mirror, utrNumber: patch.utrNumber, paymentMode: patch.paymentMode }) : mirror));
      transaction.update(billRef, { collections, updatedAt: nowIso() });
    }
    logActivityTx(transaction, context, {
      entityType: 'collection',
      entityId: collectionId,
      action: 'receipt_details_edited',
      summary: 'Receipt reference details edited',
      previous: { utrNumber: collection.utrNumber ?? null, paymentMode: collection.paymentMode ?? null, bankReference: collection.bankReference ?? null },
      next: { utrNumber: patch.utrNumber ?? null, paymentMode: patch.paymentMode ?? null, bankReference: patch.bankReference ?? null },
    });
  });
}
