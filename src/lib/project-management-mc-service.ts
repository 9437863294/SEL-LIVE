"use client";

/**
 * Reading and writing Manufacturing Clearance documents.
 *
 * The quantity rules all live in `project-management-mc-quantity.ts`, which is pure and tested.
 * This module is the Firestore half: it loads the PO lines and existing clearances a screen needs,
 * and performs the writes that move quantity between Available, Reserved and Approved.
 *
 * The one thing that cannot be done in the pure lib is the race. Two buyers looking at the same
 * 200 remaining will both raise 150, and a client-side balance check cannot stop them because the
 * client SDK cannot run a *query* inside a transaction. So every write that changes quantity
 * transacts on one guard document per PO line (`mcPoLineBalances`), which makes the check atomic.
 * The MC items stay the ledger of record; the guard is derived and rebuildable.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BoqItem } from "@/lib/types";
import { PO_COLLECTION, resolvePoLineId, toNumber, type PurchaseOrder } from "@/lib/purchase-orders";
import { MC_COLLECTION } from "@/lib/supply-gates";
import {
  MC_HEADER_COLLECTION,
  MC_ITEM_COLLECTION,
  MC_PO_LINE_BALANCE_COLLECTION,
  buildPoLineLedgers,
  checkBalanceForReservation,
  effectivePoQty,
  generateMcNumber,
  mcPoLineBalanceId,
  poLineKey,
  rebuildPoLineBalance,
  type McHeader,
  type McItem,
  type McPoLine,
  type McPoLineBalance,
  type PoLineLedger,
} from "@/lib/project-management-mc-quantity";

/** Thrown when the atomic re-check refuses a submission. Carries the user-facing message. */
export const MC_BALANCE_CONFLICT = "MC_BALANCE_CONFLICT";

export interface McActor {
  id: string;
  name: string;
}

/** Everything the MC screens read in one pass. */
export interface McWorkspace {
  poLines: McPoLine[];
  headers: McHeader[];
  items: McItem[];
  ledgers: Map<string, PoLineLedger>;
  /** Vendor of each PO, for the grouping check and the vendor picker. */
  vendorByPoId: Map<string, { vendorId: string; vendorName: string }>;
  /** BOQ serial numbers, for the gate-record projection which keys on the BOQ item. */
  boqSlNoByBoqItemId: Map<string, string>;
}

/**
 * Marks a `manufacturingClearances` record as owned by the MC-document projection rather than
 * typed in on the old per-item register.
 *
 * The projection may only downgrade what it created. A record cleared directly on the item gate
 * register has no counterpart in the quantity ledger, so recomputing from the ledger would read
 * it as "nothing approved" and silently reopen a gate somebody had closed.
 */
export const MC_GATE_SOURCE_DOCUMENT = "mcDocument";

const projectPath = (globalProjectId: string, name: string) =>
  collection(db, "projects", globalProjectId, name);

const getBoqSlNo = (item: BoqItem) => String(item["BOQ SL No"] ?? item["SL. No."] ?? "");

/**
 * Flattens every line of every clearable PO into `McPoLine`s.
 *
 * Only Issued and Received POs are clearable — a Draft PO is not an order yet, and clearing a
 * Cancelled one would authorise manufacturing nobody is going to pay for.
 */
export function buildMcPoLines(
  purchaseOrders: readonly PurchaseOrder[],
  boqSlNoByBoqItemId: ReadonlyMap<string, string> = new Map(),
): McPoLine[] {
  const lines: McPoLine[] = [];
  for (const po of purchaseOrders) {
    if (po.status !== "Issued" && po.status !== "Received") continue;
    (po.items ?? []).forEach((item, index) => {
      const orderedQty = toNumber(item.qty);
      if (orderedQty <= 0) return;
      lines.push({
        poId: po.id,
        poNumber: po.poNumber,
        poLineId: resolvePoLineId(item, index),
        boqItemId: item.boqItemId,
        itemDescription:
          item.description ||
          (item.boqItemId ? boqSlNoByBoqItemId.get(item.boqItemId) : "") ||
          "Unnamed item",
        unit: item.unit ?? "",
        orderedQty,
        cancelledQty: toNumber(item.cancelledQty),
      });
    });
  }
  return lines;
}

/** Loads the PO lines, the clearances raised so far, and the resulting per-line ledgers. */
export async function loadMcWorkspace(
  globalProjectId: string,
  options: { excludeMcId?: string } = {},
): Promise<McWorkspace> {
  const [poSnapshot, boqSnapshot, headerSnapshot, itemSnapshot] = await Promise.all([
    getDocs(projectPath(globalProjectId, PO_COLLECTION)),
    getDocs(projectPath(globalProjectId, "boqItems")),
    getDocs(projectPath(globalProjectId, MC_HEADER_COLLECTION)),
    getDocs(projectPath(globalProjectId, MC_ITEM_COLLECTION)),
  ]);

  const purchaseOrders = poSnapshot.docs.map(
    (entry) => ({ id: entry.id, ...entry.data() }) as PurchaseOrder,
  );
  const boqSlNoByBoqItemId = new Map(
    boqSnapshot.docs.map((entry) => [
      entry.id,
      getBoqSlNo({ id: entry.id, ...entry.data() } as BoqItem),
    ]),
  );

  const poLines = buildMcPoLines(purchaseOrders, boqSlNoByBoqItemId);
  const headers = headerSnapshot.docs.map(
    (entry) => ({ id: entry.id, ...entry.data() }) as McHeader,
  );
  const items = itemSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as McItem);

  return {
    poLines,
    headers,
    items,
    ledgers: buildPoLineLedgers(poLines, items, headers, options),
    vendorByPoId: new Map(
      purchaseOrders.map((po) => [
        po.id,
        { vendorId: po.vendorId ?? "", vendorName: po.vendorName ?? "" },
      ]),
    ),
    boqSlNoByBoqItemId,
  };
}

/**
 * Projects the quantity ledger onto the old per-BOQ-item gate records.
 *
 * Two MC models coexist: the quantity-driven documents in `mcClearances`, and the original
 * `manufacturingClearances` gate record — one document per BOQ item, status Pending or Cleared —
 * which `canRequestInspection`, `boq-traceability` and six screens still read. Without this
 * projection, approving a clearance would leave every one of them showing "Pending".
 *
 * The mapping is deliberately **permissive**: any approved quantity against any PO line for a
 * BOQ item marks that item Cleared. The old gate is a boolean and cannot express "40 of 100
 * cleared", and its only job is to let inspection be *requested* — the quantity limit is enforced
 * by the inspection ledger, which reads approved quantity directly rather than this status. A
 * stricter "fully cleared" mapping would block inspection of material that is genuinely ready.
 *
 * One-directional: records this projection created are downgraded when their quantity goes away,
 * records typed in on the old register are left alone. Idempotent, so it can be re-run to repair.
 */
export async function syncMcGateRecords(globalProjectId: string): Promise<number> {
  const { poLines, ledgers, boqSlNoByBoqItemId, vendorByPoId } =
    await loadMcWorkspace(globalProjectId);

  /** Approved quantity per BOQ item, summed across every PO line that references it. */
  const approvedByBoqItemId = new Map<
    string,
    { approvedQty: number; poId: string; poNumber: string; description: string; vendorName: string }
  >();

  for (const line of poLines) {
    if (!line.boqItemId) continue;
    const ledger = ledgers.get(poLineKey(line.poId, line.poLineId));
    if (!ledger) continue;
    const entry =
      approvedByBoqItemId.get(line.boqItemId) ??
      {
        approvedQty: 0,
        poId: line.poId,
        poNumber: line.poNumber,
        description: line.itemDescription,
        vendorName: vendorByPoId.get(line.poId)?.vendorName ?? "",
      };
    entry.approvedQty += ledger.approvedQty;
    approvedByBoqItemId.set(line.boqItemId, entry);
  }

  const existingSnapshot = await getDocs(projectPath(globalProjectId, MC_COLLECTION));
  const existingById = new Map(
    existingSnapshot.docs.map((entry) => [entry.id, entry.data() as Record<string, unknown>]),
  );

  const batch = writeBatch(db);
  let written = 0;

  for (const [boqItemId, entry] of approvedByBoqItemId) {
    const existing = existingById.get(boqItemId);
    const ref = doc(db, "projects", globalProjectId, MC_COLLECTION, boqItemId);

    if (entry.approvedQty > 0) {
      if (existing?.status === "Cleared") continue;
      batch.set(
        ref,
        {
          boqItemId,
          boqSlNo: boqSlNoByBoqItemId.get(boqItemId) ?? "",
          description: entry.description,
          poId: entry.poId,
          poNumber: entry.poNumber,
          vendorName: entry.vendorName,
          status: "Cleared",
          clearedDate: new Date().toISOString().slice(0, 10),
          source: MC_GATE_SOURCE_DOCUMENT,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      written += 1;
      continue;
    }

    // Quantity has gone (rejected, withdrawn or amended away). Only reopen a gate this
    // projection closed in the first place.
    if (existing?.status === "Cleared" && existing.source === MC_GATE_SOURCE_DOCUMENT) {
      batch.set(ref, { status: "Pending", updatedAt: serverTimestamp() }, { merge: true });
      written += 1;
    }
  }

  if (written > 0) await batch.commit();
  return written;
}

/** One line the user has asked to clear. */
export interface McDraftLine {
  poId: string;
  poNumber: string;
  poLineId: string;
  boqItemId?: string;
  itemDescription: string;
  unit: string;
  currentMcQty: number;
  remarks?: string;
}

export interface CreateMcParams {
  globalProjectId: string;
  vendorId: string;
  vendorName: string;
  mcDate: string;
  remarks?: string;
  lines: readonly McDraftLine[];
  /** Effective PO quantity per line, so the transaction can check without re-reading every PO. */
  effectiveQtyByLineKey: ReadonlyMap<string, number>;
  /** Draft holds no quantity; Submitted reserves it. */
  submit: boolean;
  actor: McActor;
}

/**
 * Creates an MC, reserving its quantity atomically when it is submitted.
 *
 * A Draft is written with a plain batch — it holds nothing, so there is nothing to race over.
 * A submission goes through a transaction that re-reads every affected guard document and
 * refuses the whole MC if any single line no longer fits. All-or-nothing is deliberate: a
 * partially-reserved MC would be a document the vendor cannot act on.
 */
export async function createMcDocument({
  globalProjectId,
  vendorId,
  vendorName,
  mcDate,
  remarks,
  lines,
  effectiveQtyByLineKey,
  submit,
  actor,
}: CreateMcParams): Promise<{ mcId: string; mcNumber: string }> {
  const headerRef = doc(projectPath(globalProjectId, MC_HEADER_COLLECTION));
  const mcNumber = generateMcNumber(mcDate, headerRef.id);

  const headerPayload: Record<string, unknown> = {
    mcNumber,
    globalProjectId,
    vendorId,
    vendorName,
    mcDate,
    status: submit ? "Submitted" : "Draft",
    revision: 0,
    createdAt: serverTimestamp(),
    createdBy: actor.id,
    createdByName: actor.name,
    updatedAt: serverTimestamp(),
    updatedBy: actor.id,
    updatedByName: actor.name,
  };
  // Never write undefined — a null reads back as a value and defeats the tolerant readers.
  if (remarks?.trim()) headerPayload.remarks = remarks.trim();
  if (submit) {
    headerPayload.submittedAt = serverTimestamp();
    headerPayload.submittedBy = actor.id;
    headerPayload.submittedByName = actor.name;
  }

  const itemRefs = lines.map(() => doc(projectPath(globalProjectId, MC_ITEM_COLLECTION)));
  const itemPayload = (line: McDraftLine): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      mcId: headerRef.id,
      poId: line.poId,
      poNumber: line.poNumber,
      poLineId: line.poLineId,
      itemDescription: line.itemDescription,
      unit: line.unit,
      currentMcQty: line.currentMcQty,
      status: "Pending",
      createdAt: serverTimestamp(),
    };
    if (line.boqItemId) payload.boqItemId = line.boqItemId;
    if (line.remarks?.trim()) payload.remarks = line.remarks.trim();
    return payload;
  };

  if (!submit) {
    const batch = writeBatch(db);
    batch.set(headerRef, headerPayload);
    lines.forEach((line, index) => batch.set(itemRefs[index], itemPayload(line)));
    await batch.commit();
    return { mcId: headerRef.id, mcNumber };
  }

  await runTransaction(db, async (transaction) => {
    const balanceRefs = lines.map((line) =>
      doc(
        db,
        "projects",
        globalProjectId,
        MC_PO_LINE_BALANCE_COLLECTION,
        mcPoLineBalanceId(line.poId, line.poLineId),
      ),
    );
    const balanceSnapshots = await Promise.all(balanceRefs.map((ref) => transaction.get(ref)));

    // Check every line before writing anything, so the refusal names the real problem rather
    // than whichever line happened to be reached first.
    lines.forEach((line, index) => {
      const snapshot = balanceSnapshots[index];
      const balance = snapshot.exists() ? (snapshot.data() as McPoLineBalance) : null;
      const effectiveQty = effectiveQtyByLineKey.get(poLineKey(line.poId, line.poLineId)) ?? 0;
      const check = checkBalanceForReservation(line.currentMcQty, effectiveQty, balance);
      if (!check.ok) {
        throw new Error(
          `${MC_BALANCE_CONFLICT}: ${line.poNumber} · ${line.itemDescription} — ${check.message}`,
        );
      }
    });

    transaction.set(headerRef, headerPayload);
    lines.forEach((line, index) => {
      transaction.set(itemRefs[index], itemPayload(line));

      const snapshot = balanceSnapshots[index];
      const existing = snapshot.exists() ? (snapshot.data() as McPoLineBalance) : null;
      const effectiveQty = effectiveQtyByLineKey.get(poLineKey(line.poId, line.poLineId)) ?? 0;
      transaction.set(
        balanceRefs[index],
        {
          poId: line.poId,
          poLineId: line.poLineId,
          poNumber: line.poNumber,
          effectiveQty,
          approvedQty: existing ? toNumber(existing.approvedQty) : 0,
          reservedQty: (existing ? toNumber(existing.reservedQty) : 0) + line.currentMcQty,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });
  });

  return { mcId: headerRef.id, mcNumber };
}

/**
 * Records a decision on a whole MC, moving its reserved quantity to approved or releasing it.
 *
 * Approval converts the reservation rather than adding to it, so approving does not consume
 * balance a second time. Rejection and cancellation release it.
 */
export async function decideMcDocument({
  globalProjectId,
  mcId,
  decision,
  remarks,
  actor,
}: {
  globalProjectId: string;
  mcId: string;
  decision: "Approved" | "Rejected" | "Cancelled";
  remarks?: string;
  actor: McActor;
}): Promise<void> {
  const headerRef = doc(db, "projects", globalProjectId, MC_HEADER_COLLECTION, mcId);
  const itemSnapshot = await getDocs(projectPath(globalProjectId, MC_ITEM_COLLECTION));
  const own = itemSnapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }) as McItem)
    .filter((item) => item.mcId === mcId && item.status !== "Cancelled");

  await runTransaction(db, async (transaction) => {
    const headerDoc = await transaction.get(headerRef);
    if (!headerDoc.exists()) throw new Error("This manufacturing clearance no longer exists.");
    const header = headerDoc.data() as McHeader;

    // A decision may only be taken once — otherwise a double-click approves the same reserved
    // quantity twice and the guard document drifts from the ledger.
    if (header.status !== "Submitted" && header.status !== "Partially Approved") {
      throw new Error(
        `This clearance is already ${header.status.toLowerCase()}. Refresh before deciding again.`,
      );
    }

    const balanceRefs = own.map((item) =>
      doc(
        db,
        "projects",
        globalProjectId,
        MC_PO_LINE_BALANCE_COLLECTION,
        mcPoLineBalanceId(item.poId, item.poLineId),
      ),
    );
    const balanceSnapshots = await Promise.all(balanceRefs.map((ref) => transaction.get(ref)));

    own.forEach((item, index) => {
      const snapshot = balanceSnapshots[index];
      if (!snapshot.exists()) return;
      const balance = snapshot.data() as McPoLineBalance;
      const qty = toNumber(item.currentMcQty);
      // Floored at zero: a guard that has drifted must not be driven negative by a decision.
      const reservedQty = Math.max(0, toNumber(balance.reservedQty) - qty);
      const approvedQty =
        decision === "Approved" ? toNumber(balance.approvedQty) + qty : toNumber(balance.approvedQty);
      transaction.set(
        balanceRefs[index],
        { reservedQty, approvedQty, updatedAt: serverTimestamp() },
        { merge: true },
      );

      transaction.set(
        doc(db, "projects", globalProjectId, MC_ITEM_COLLECTION, item.id),
        {
          status: decision === "Approved" ? "Approved" : decision === "Rejected" ? "Rejected" : "Cancelled",
        },
        { merge: true },
      );
    });

    const headerUpdate: Record<string, unknown> = {
      status: decision,
      updatedAt: serverTimestamp(),
      updatedBy: actor.id,
      updatedByName: actor.name,
      decidedAt: serverTimestamp(),
      decidedBy: actor.id,
      decidedByName: actor.name,
    };
    if (remarks?.trim()) headerUpdate.decisionRemarks = remarks.trim();
    transaction.set(headerRef, headerUpdate, { merge: true });
  });

  // Outside the transaction because it has to read the whole ledger, which a client transaction
  // cannot query. It is an idempotent projection, so a failure here leaves the decision intact
  // and is repaired by re-running it — which is what the register's Sync gates action does.
  await syncMcGateRecords(globalProjectId);
}

/** Deletes a draft MC and its lines. Drafts hold no quantity, so no guard document changes. */
export async function deleteMcDraft(globalProjectId: string, mcId: string): Promise<void> {
  const headerRef = doc(db, "projects", globalProjectId, MC_HEADER_COLLECTION, mcId);
  const headerDoc = await getDoc(headerRef);
  if (!headerDoc.exists()) return;
  if ((headerDoc.data() as McHeader).status !== "Draft") {
    throw new Error("Only a draft clearance can be deleted. Cancel it instead.");
  }

  const itemSnapshot = await getDocs(projectPath(globalProjectId, MC_ITEM_COLLECTION));
  const batch = writeBatch(db);
  itemSnapshot.docs
    .filter((entry) => (entry.data() as McItem).mcId === mcId)
    .forEach((entry) => batch.delete(entry.ref));
  batch.delete(headerRef);
  await batch.commit();
}

/**
 * Recomputes every guard document from the MC items.
 *
 * The guard is derived data, so it can always be rebuilt. Exposed because an interrupted
 * transaction or a hand-edited record would otherwise leave a line permanently under-available
 * with no way back.
 */
export async function rebuildMcPoLineBalances(globalProjectId: string): Promise<number> {
  const { poLines, ledgers } = await loadMcWorkspace(globalProjectId);
  const batch = writeBatch(db);
  let written = 0;

  for (const line of poLines) {
    const ledger = ledgers.get(poLineKey(line.poId, line.poLineId));
    if (!ledger) continue;
    batch.set(
      doc(
        db,
        "projects",
        globalProjectId,
        MC_PO_LINE_BALANCE_COLLECTION,
        mcPoLineBalanceId(line.poId, line.poLineId),
      ),
      { ...rebuildPoLineBalance(ledger), updatedAt: serverTimestamp() },
      { merge: true },
    );
    written += 1;
  }

  await batch.commit();
  return written;
}

/** `effectiveQty` per line key, as `createMcDocument` needs it. */
export const effectiveQtyByLineKey = (poLines: readonly McPoLine[]): Map<string, number> =>
  new Map(poLines.map((line) => [poLineKey(line.poId, line.poLineId), effectivePoQty(line)]));
