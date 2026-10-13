"use client";

import { auth } from "@/lib/firebase";
import type { PaymentObligation } from "@/lib/recurring-payments";

export interface BillCheckResponse {
  /** Another live obligation of the same vendor already carries this bill number. */
  duplicate: boolean;
  /** The same master's other live obligations, with only what the variance baseline reads. */
  history: Array<Pick<PaymentObligation, "id" | "masterId" | "dueDate" | "billAmount" | "status">>;
}

/**
 * "Submit Bill"'s comparisons with the rest of the register, made on the server for someone who
 * works the step but cannot read the register (see api/recurring-payments/bill-check).
 */
export async function fetchBillCheck(paymentId: string, billNumber: string): Promise<BillCheckResponse & { history: PaymentObligation[] }> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error("You must be signed in.");
  const idToken = await firebaseUser.getIdToken();
  const res = await fetch("/api/recurring-payments/bill-check", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ paymentId, billNumber }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `The bill could not be checked (${res.status}).`);
  const result = body as BillCheckResponse;
  // Shaped as obligations so the variance code reads them exactly as it reads the register's rows.
  return { duplicate: result.duplicate === true, history: (result.history || []) as PaymentObligation[] };
}
