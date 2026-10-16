/**
 * Retention: held on a bill, claimed back by retention bills, received.
 *
 * A supply bill (say SUPPLY-100%) has retention deducted under one or more heads — 10% against the
 * CPBG, 30% against the invoice, and so on. Later SEL raises a *retention bill* to claim that money
 * back, often for several bills at once. Each retention bill therefore carries claims: which bill,
 * which head, how much. That one link answers both questions finance asks:
 *
 *   - raising a retention bill: which bills still have retention to claim, and how much (`pendingToRaise`);
 *   - for every bill: has its retention been raised, and has it come in?
 *
 * Per bill and head:
 *
 *   held             retention deducted on the bill (plus any credit / debit note adjusting it)
 *   claimed          claimed by live retention bills
 *   received         released: receipts on those retention bills (credited back claim by claim)
 *                    and releases recorded directly against the bill
 *   pendingToRaise   held − claimed − released directly   (still to put on a retention bill)
 *   awaitingPayment  claimed − received through the claims (raised, not yet paid)
 *
 * Pure: the API, the screens and the tests share it.
 */

import { isRetentionKind } from './calculations.ts';
import { isNoteType } from './certification.ts';
import { subtractMoney, sumBy, sumMoney, toPaise } from './money.ts';
import type { Bill, DeductionKind, RetentionClaim, RetentionRelease } from './types';

export const RETENTION_STATES = ['none', 'not_raised', 'partly_raised', 'raised', 'received'] as const;
export type RetentionState = (typeof RETENTION_STATES)[number];

export const RETENTION_STATE_LABELS: Record<RetentionState, string> = {
  none: 'No retention',
  not_raised: 'Retention not raised',
  partly_raised: 'Retention partly raised',
  raised: 'Retention raised · awaiting payment',
  received: 'Retention received',
};

/** A retention bill — the kind of bill that claims retention back. */
export const isRetentionClaimBill = (bill: Pick<Bill, 'isRetentionBill' | 'transactionType'>): boolean => bill.isRetentionBill || bill.transactionType === 'retention_bill';

/** A bill whose retention can be claimed: live, not a note, not itself a retention bill. */
export const canHoldRetention = (bill: Pick<Bill, 'isDeleted' | 'transactionType' | 'isRetentionBill'>): boolean =>
  !bill.isDeleted && !isNoteType(bill.transactionType) && !isRetentionClaimBill(bill);

export interface RetentionClaimRef {
  retentionBillId: string;
  reference: string;
  billDate: string;
  deductionTypeId: string;
  amount: number;
}

export interface RetentionHead {
  deductionTypeId: string;
  name: string;
  kind: DeductionKind;
  held: number;
  claimed: number;
  receivedViaClaims: number;
  receivedDirect: number;
  received: number;
  pendingToRaise: number;
  awaitingPayment: number;
}

export interface BillRetention {
  state: RetentionState;
  held: number;
  claimed: number;
  received: number;
  pendingToRaise: number;
  awaitingPayment: number;
  heads: RetentionHead[];
  /** The retention bills claiming this bill's retention. */
  claims: RetentionClaimRef[];
}

/** What a set of bills and releases says about retention, keyed by the bill the retention was held on. */
export interface RetentionIndex {
  claims: Map<string, RetentionClaimRef[]>;
  notes: Map<string, Bill[]>;
  releases: Map<string, RetentionRelease[]>;
}

/**
 * Builds the lookups `billRetention` needs from every bill and release in reach. `excludeRetentionBillId`
 * leaves one retention bill's claims out — the one being edited, whose claims are on the form.
 */
export function retentionIndex(bills: readonly Bill[], releases: readonly RetentionRelease[], options: { excludeRetentionBillId?: string } = {}): RetentionIndex {
  const claims = new Map<string, RetentionClaimRef[]>();
  const notes = new Map<string, Bill[]>();
  for (const bill of bills) {
    if (bill.isDeleted) continue;
    if (bill.againstBillId && isNoteType(bill.transactionType)) notes.set(bill.againstBillId, [...(notes.get(bill.againstBillId) ?? []), bill]);
    if (!bill.retentionClaims?.length || bill.id === options.excludeRetentionBillId) continue;
    for (const claim of bill.retentionClaims) {
      const ref: RetentionClaimRef = { retentionBillId: bill.id, reference: bill.gstInvoiceNumber || bill.billSerialNumber || bill.id, billDate: bill.billDate, deductionTypeId: claim.deductionTypeId, amount: claim.amount };
      claims.set(claim.billId, [...(claims.get(claim.billId) ?? []), ref]);
    }
  }
  const byBill = new Map<string, RetentionRelease[]>();
  for (const release of releases) {
    if (release.status !== 'active' || !release.againstBillId) continue;
    byBill.set(release.againstBillId, [...(byBill.get(release.againstBillId) ?? []), release]);
  }
  return { claims, notes, releases: byBill };
}

/** Retention held per head: the bill's retention lines plus any note adjusting them. */
function heldByHead(bill: Bill, notes: readonly Bill[]): Map<string, { name: string; kind: DeductionKind; amount: number }> {
  const heads = new Map<string, { name: string; kind: DeductionKind; amount: number }>();
  for (const line of [...(bill.deductions ?? []), ...notes.filter((note) => !note.isDeleted).flatMap((note) => note.deductions ?? [])]) {
    if (!isRetentionKind(line.kind)) continue;
    const head = heads.get(line.deductionTypeId) ?? { name: line.deductionTypeName, kind: line.kind, amount: 0 };
    head.amount = sumMoney([head.amount, line.amount]);
    heads.set(line.deductionTypeId, head);
  }
  return heads;
}

const positive = (amount: number) => (toPaise(amount) > 0 ? amount : 0);

/** One bill's retention position, head by head. */
export function billRetention(bill: Bill, index: RetentionIndex, tolerance: number): BillRetention {
  const held = heldByHead(bill, index.notes.get(bill.id) ?? []);
  const claims = index.claims.get(bill.id) ?? [];
  const releases = index.releases.get(bill.id) ?? [];
  const ids = [...new Set([...held.keys(), ...claims.map((claim) => claim.deductionTypeId)])];
  // A release recorded by hand may carry only a kind: it goes to the first head of that kind.
  const headForRelease = (release: RetentionRelease) => release.deductionTypeId ?? ids.find((id) => held.get(id)?.kind === release.kind) ?? ids[0];

  const heads: RetentionHead[] = ids.map((id) => {
    const mine = releases.filter((release) => headForRelease(release) === id);
    const claimed = sumBy(claims.filter((claim) => claim.deductionTypeId === id), (claim) => claim.amount);
    const receivedViaClaims = sumBy(mine.filter((release) => release.retentionBillId), (release) => release.amount);
    const receivedDirect = sumBy(mine.filter((release) => !release.retentionBillId), (release) => release.amount);
    const amount = held.get(id)?.amount ?? 0;
    return {
      deductionTypeId: id,
      name: held.get(id)?.name ?? id,
      kind: held.get(id)?.kind ?? 'retention_other',
      held: amount,
      claimed,
      receivedViaClaims,
      receivedDirect,
      received: sumMoney([receivedViaClaims, receivedDirect]),
      pendingToRaise: positive(subtractMoney(amount, sumMoney([claimed, receivedDirect]))),
      awaitingPayment: positive(subtractMoney(claimed, receivedViaClaims)),
    };
  });

  const total = (pick: (head: RetentionHead) => number) => sumBy(heads, pick);
  const summary = { held: total((head) => head.held), claimed: total((head) => head.claimed), received: total((head) => head.received), pendingToRaise: total((head) => head.pendingToRaise), awaitingPayment: total((head) => head.awaitingPayment) };
  const within = (amount: number) => Math.abs(toPaise(amount)) <= toPaise(Math.abs(tolerance));
  const state: RetentionState =
    within(summary.held) ? 'none'
    : toPaise(summary.received) >= toPaise(summary.held) - toPaise(Math.abs(tolerance)) ? 'received'
    : within(summary.pendingToRaise) ? 'raised'
    : toPaise(sumMoney([summary.claimed, total((head) => head.receivedDirect)])) > toPaise(Math.abs(tolerance)) ? 'partly_raised'
    : 'not_raised';
  return { state, ...summary, heads, claims };
}

/**
 * A receipt on a retention bill, credited back to the bills it claimed: in proportion to the claims,
 * to the paisa, the last claim taking the rounding. Anything beyond the claims is returned with no
 * claim (released against the project only, as before claims existed).
 */
export function allocateToClaims(claims: readonly RetentionClaim[], amount: number): { claim: RetentionClaim | null; amount: number }[] {
  const total = toPaise(sumBy(claims, (claim) => claim.amount));
  const paise = toPaise(amount);
  if (!claims.length || total <= 0) return [{ claim: null, amount }];
  const applied = Math.min(paise, total);
  let left = applied;
  const parts = claims.map((claim, index) => {
    const share = index === claims.length - 1 ? left : Math.floor((applied * toPaise(claim.amount)) / total);
    left -= share;
    return { claim, amount: share / 100 };
  });
  const result: { claim: RetentionClaim | null; amount: number }[] = parts.filter((part) => toPaise(part.amount) !== 0);
  if (paise > total) result.push({ claim: null, amount: (paise - total) / 100 });
  return result;
}

export interface ClaimInput {
  billId: string;
  deductionTypeId: string;
  amount: number;
}

/**
 * Checks a retention bill's claims against what is still to raise and returns them with their
 * snapshots (bill reference, date, head name, kind) — or the first problem, in words.
 * `bills` must hold the project's bills (any year); `releases` the project's releases.
 */
export function resolveRetentionClaims(
  inputs: readonly ClaimInput[],
  retentionBill: { id?: string; projectId: string },
  bills: readonly Bill[],
  releases: readonly RetentionRelease[],
  tolerance: number,
): { claims: RetentionClaim[] } | { error: string } {
  const index = retentionIndex(bills, releases, { excludeRetentionBillId: retentionBill.id });
  const seen = new Set<string>();
  const claims: RetentionClaim[] = [];
  for (const input of inputs) {
    if (toPaise(input.amount) <= 0) return { error: 'Each retention claimed must be more than zero.' };
    const key = `${input.billId}|${input.deductionTypeId}`;
    if (seen.has(key)) return { error: 'The same bill and retention head are claimed twice — combine them into one line.' };
    seen.add(key);
    const bill = bills.find((entry) => entry.id === input.billId);
    if (!bill || bill.isDeleted) return { error: 'A bill being claimed was not found or has been deleted.' };
    const reference = bill.gstInvoiceNumber || bill.billSerialNumber || bill.id;
    if (bill.projectId !== retentionBill.projectId) return { error: `Bill ${reference} belongs to another project — a retention bill claims retention of its own project.` };
    if (!canHoldRetention(bill)) return { error: `Bill ${reference} is a note or a retention bill; its retention cannot be claimed.` };
    const head = billRetention(bill, index, tolerance).heads.find((entry) => entry.deductionTypeId === input.deductionTypeId);
    if (!head || toPaise(head.held) <= 0) return { error: `No retention under that head was deducted on bill ${reference}.` };
    if (toPaise(input.amount) > toPaise(head.pendingToRaise) + toPaise(Math.abs(tolerance))) {
      return { error: `Bill ${reference}: ₹${input.amount.toLocaleString('en-IN')} is more than the ₹${head.pendingToRaise.toLocaleString('en-IN')} of ${head.name} still to raise.` };
    }
    claims.push({ billId: bill.id, billRef: reference, billDate: bill.billDate, deductionTypeId: head.deductionTypeId, deductionTypeName: head.name, kind: head.kind, amount: input.amount });
  }
  return { claims };
}

export interface RetentionTotals {
  bills: number;
  held: number;
  claimed: number;
  received: number;
  pendingToRaise: number;
  awaitingPayment: number;
  byState: Record<RetentionState, number>;
}

export function retentionTotals(rows: readonly BillRetention[]): RetentionTotals {
  const byState = Object.fromEntries(RETENTION_STATES.map((state) => [state, 0])) as Record<RetentionState, number>;
  for (const row of rows) byState[row.state] += 1;
  return {
    bills: rows.length,
    held: sumBy(rows, (row) => row.held),
    claimed: sumBy(rows, (row) => row.claimed),
    received: sumBy(rows, (row) => row.received),
    pendingToRaise: sumBy(rows, (row) => row.pendingToRaise),
    awaitingPayment: sumBy(rows, (row) => row.awaitingPayment),
    byState,
  };
}
