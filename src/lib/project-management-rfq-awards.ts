"use client";

/**
 * Turning RFQ awards into purchase orders.
 *
 * This was inline in the RFQ detail screen's "Confirm Awards" handler. It now has two callers —
 * that screen (for RFQs that predate the award approval workflow) and the award approval stage
 * screen (once the final stage approves) — so it lives here. One implementation means the awarded
 * rates, PO shape and the double-award protection are identical whichever path a PO arrives by.
 *
 * The double-award protection is the important part: markRfqItemsAwarded re-reads the RFQ inside a
 * transaction and refuses any item that already carries a `poId`. Awarding is therefore safe
 * against a concurrent award from the PO builder's "From RFQ Quotes" tab, and against an approval
 * being actioned twice.
 */

import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  PO_COLLECTION,
  generatePoNumber,
  type PurchaseOrderItem,
} from "@/lib/purchase-orders";
import { markRfqItemsAwarded, type RfqAwardEntry } from "@/lib/rfq";

/**
 * One vendor's slice of an award, with rates already resolved.
 *
 * Rates are carried here rather than re-read from the quote at PO time so that what a reviewer
 * approved is what gets ordered — a vendor revising their quote after submission can't silently
 * change the price on an approved award.
 */
export interface AwardGroup {
  vendorId: string;
  vendorName: string;
  items: Array<{
    rfqItemId: string;
    description: string;
    unit: string;
    qty: number;
    rate: number;
    amount: number;
    sourceIndentId: string;
    sourceIndentNumber: string;
    boqItemId: string;
  }>;
}

export interface CreatePurchaseOrdersParams {
  globalProjectId: string;
  /** `projectManagementProjects` document id. */
  projectMappingId: string;
  projectManagementProjectName: string;
  globalProjectName: string;
  rfq: { id: string; rfqNumber: string; rfqDate: string };
  groups: AwardGroup[];
}

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
};

/**
 * Creates one draft purchase order per vendor group and marks the RFQ items awarded.
 *
 * Groups are processed one at a time, not in parallel: each award is verified transactionally, and
 * a failure on one vendor must not leave the others half-written under a shared batch.
 */
export async function createPurchaseOrdersForAwards({
  globalProjectId,
  projectMappingId,
  projectManagementProjectName,
  globalProjectName,
  rfq,
  groups,
}: CreatePurchaseOrdersParams): Promise<{ poCount: number; itemCount: number }> {
  let poCount = 0;
  let itemCount = 0;

  for (const group of groups) {
    if (!group.items.length) continue;

    const poItems: PurchaseOrderItem[] = group.items.map((item) => ({
      description: item.description,
      unit: item.unit,
      qty: item.qty,
      rate: item.rate,
      amount: item.amount,
      rfqItemId: item.rfqItemId,
      sourceRfqId: rfq.id,
      sourceRfqNumber: rfq.rfqNumber,
      sourceIndentId: item.sourceIndentId,
      sourceIndentNumber: item.sourceIndentNumber,
      boqItemId: item.boqItemId,
      indentQty: item.qty,
    }));
    const totalAmount = poItems.reduce((sum, item) => sum + item.amount, 0);

    const poRef = doc(collection(db, "projects", globalProjectId, PO_COLLECTION));
    await setDoc(poRef, {
      poNumber: generatePoNumber(rfq.rfqDate, poRef.id),
      poDate: today(),
      vendorId: group.vendorId,
      vendorName: group.vendorName,
      projectMappingId,
      projectManagementProjectName,
      projectId: globalProjectId,
      projectName: globalProjectName,
      items: poItems,
      totalAmount,
      status: "Draft",
      sourceRfqIds: [rfq.id],
      sourceRfqNumbers: [rfq.rfqNumber],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const awards: RfqAwardEntry[] = group.items.map((item) => ({
      rfqItemId: item.rfqItemId,
      awardedVendorId: group.vendorId,
      awardedVendorName: group.vendorName,
      awardedRate: item.rate,
      awardedAmount: item.amount,
    }));
    await markRfqItemsAwarded(db, globalProjectId, rfq.id, poRef.id, awards);

    poCount += 1;
    itemCount += group.items.length;
  }

  return { poCount, itemCount };
}
