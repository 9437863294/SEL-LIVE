/**
 * Bill Tracking receipts → Bank Balance.
 *
 * A verified receipt is money that actually landed in a bank account, so it is also a Credit in
 * the Bank Balance ledger (`bankExpenses`). This module holds the pure part of that bridge: what
 * the bank document looks like for a given receipt, and whether one should be written at all. The
 * Firestore side (transaction, `Timestamp`, ids) lives in `server/collections.ts`.
 *
 * One receipt writes exactly **one** bank credit, never one per bill allocation — the bank saw a
 * single credit, however many invoices it settled.
 */

import type { BillCollection } from './types';

/** Enough of a receipt to build its bank credit from. */
export type BankPostable = Pick<BillCollection, 'id' | 'amount' | 'receiptDate'> &
  Partial<Pick<BillCollection, 'bankAccountId' | 'bankExpenseId' | 'clientNameSnapshot' | 'remarks'>> & {
    allocations?: Array<{ billSerialNumber?: string; gstInvoiceNumber?: string }>;
  };

/**
 * A `bankExpenses` document, minus the Firestore wrapping: `date` is a plain `Date` the caller
 * turns into a `Timestamp`. Field-for-field the shape Bank Balance's own receipt form writes.
 */
export interface BankCreditDraft {
  date: Date;
  accountId: string;
  description: string;
  amount: number;
  type: 'Credit';
  isContra: false;
  /** Back-pointer to the Bill Tracking receipt, so the two can be reconciled (and reversed).  */
  billCollectionId: string;
}

/** Bank descriptions sit in narrow table cells and statements; keep them short. */
const MAX_DESCRIPTION = 180;

/** How many invoice numbers are spelled out before the rest become "+n more". */
const NAMED_BILLS = 3;

/**
 * `receiptDate` is a `yyyy-MM-dd` day, but Bank Balance stores an instant and reads the day back
 * out of it with `dayKey` (local time). Midnight slips to the day before for any negative shift at
 * all, so the instant is **local noon** instead: it stays on its own day across every shift inside
 * ±11 hours, which covers the pairing that actually happens here (a UTC server writing it, an IST
 * browser reading it, and the reverse).
 */
export function receiptInstant(receiptDate: string): Date {
  return new Date(`${receiptDate}T12:00:00`);
}

/** "INV-1, INV-2 +3 more" — the invoice numbers this receipt settled. */
export function receiptBillsText(collection: BankPostable): string {
  const numbers = (collection.allocations ?? [])
    .map((allocation) => (allocation.gstInvoiceNumber || allocation.billSerialNumber || '').trim())
    .filter((value) => value.length > 0);
  if (!numbers.length) return '';
  const extra = numbers.length - NAMED_BILLS;
  return `${numbers.slice(0, NAMED_BILLS).join(', ')}${extra > 0 ? ` +${extra} more` : ''}`;
}

/** What the bank statement line says: who paid and against which bills. */
export function bankCreditDescription(collection: BankPostable): string {
  const client = (collection.clientNameSnapshot ?? '').trim();
  const bills = receiptBillsText(collection);
  let text = '';
  if (client && bills) text = `Receipt from ${client} · ${bills}`;
  else if (client) text = `Receipt from ${client}`;
  else if (bills) text = `Receipt · ${bills}`;
  else text = (collection.remarks ?? '').trim();
  if (!text) text = 'Bill Tracking receipt';
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : text;
}

/**
 * The bank credit for a receipt, or `null` when none should be written.
 *
 * `null` means: no bank account was chosen (receipts recorded before this link existed, and
 * anyone who leaves the account blank), or one was already posted. That second check is the
 * idempotency guarantee — whatever verifies a receipt twice, the second pass writes nothing,
 * because the id of the first credit is stored on the receipt in the same transaction that
 * wrote it.
 */
export function bankCreditForCollection(collection: BankPostable): BankCreditDraft | null {
  const accountId = (collection.bankAccountId ?? '').trim();
  if (!accountId) return null;
  if (collection.bankExpenseId) return null;
  return {
    date: receiptInstant(collection.receiptDate),
    accountId,
    description: bankCreditDescription(collection),
    amount: collection.amount,
    type: 'Credit',
    isContra: false,
    billCollectionId: collection.id,
  };
}
