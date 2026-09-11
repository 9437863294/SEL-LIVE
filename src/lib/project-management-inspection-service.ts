"use client";

/**
 * Reading and writing Inspection calls.
 *
 * The quantity rules live in `project-management-inspection-quantity.ts`, which is pure and
 * tested. This module is the Firestore half.
 *
 * The one thing worth reading before changing anything here: an inspection's ceiling is the
 * *cleared* quantity, so this loader composes with the MC ledger rather than reading the PO
 * directly. `loadInspectionWorkspace` builds the MC workspace first, takes `approvedQty` per PO
 * line from it, and only then builds the inspection ledgers on top. That is what makes "MC has
 * cleared 40 of the 100 ordered, so 40 is inspectable" fall out of the data instead of being a
 * rule someone has to remember.
 *
 * Concurrency is guarded the same way as MC — one transacted document per PO line — because the
 * client SDK cannot run a query inside a transaction and two people offering the same cleared
 * quantity would otherwise both pass a stale check.
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
import { toNumber } from "@/lib/purchase-orders";
import { INSPECTION_COLLECTION, type PunchItem } from "@/lib/supply-gates";
import {
  MC_PO_LINE_BALANCE_COLLECTION,
  mcPoLineBalanceId,
  poLineKey,
} from "@/lib/project-management-mc-quantity";
import { loadMcWorkspace } from "@/lib/project-management-mc-service";
import {
  INSPECTION_CALL_COLLECTION,
  INSPECTION_CALL_ITEM_COLLECTION,
  INSPECTION_PO_LINE_BALANCE_COLLECTION,
  buildInspectionLedgers,
  checkBalanceForOffer,
  generateInspectionCallNumber,
  inspectionPoLineBalanceId,
  inspectionPoLineKey,
  rebuildInspectionPoLineBalance,
  rejectedQtyOf,
  resultStatusFor,
  type InspectablePoLine,
  type InspectionCall,
  type InspectionCallItem,
  type InspectionLedger,
  type InspectionPoLineBalance,
} from "@/lib/project-management-inspection-quantity";

/** Thrown when the atomic re-check refuses an offer. Carries the user-facing message. */
export const INSPECTION_BALANCE_CONFLICT = "INSPECTION_BALANCE_CONFLICT";

export interface InspectionActor {
  id: string;
  name: string;
}

export interface InspectionWorkspace {
  poLines: InspectablePoLine[];
  calls: InspectionCall[];
  items: InspectionCallItem[];
  ledgers: Map<string, InspectionLedger>;
  vendorByPoId: Map<string, { vendorId: string; vendorName: string }>;
  /** BOQ serial numbers, for the gate-record projection which keys on the BOQ item. */
  boqSlNoByBoqItemId: Map<string, string>;
}

/**
 * Marks an `inspections` record as owned by the call projection rather than typed in on the old
 * per-item register.
 *
 * As with MC: the projection may only downgrade what it created. A result recorded directly on
 * the item gate register has no counterpart in the call ledger, so recomputing from the ledger
 * would read it as "never inspected" and silently reopen a gate somebody had closed.
 */
export const INSPECTION_GATE_SOURCE_CALL = "inspectionCall";

const projectPath = (globalProjectId: string, name: string) =>
  collection(db, "projects", globalProjectId, name);

/**
 * Loads the inspectable PO lines, the calls raised so far, and the resulting ledgers.
 *
 * A PO line appears here even when nothing has been cleared for it — with `mcApprovedQty: 0`, so
 * the screen can say "awaiting clearance" rather than silently omitting the line. Omitting it
 * would leave a buyer hunting for an item that is on the PO but not on this list.
 */
export async function loadInspectionWorkspace(
  globalProjectId: string,
  options: { excludeCallId?: string } = {},
): Promise<InspectionWorkspace> {
  const [mc, callSnapshot, itemSnapshot] = await Promise.all([
    loadMcWorkspace(globalProjectId),
    getDocs(projectPath(globalProjectId, INSPECTION_CALL_COLLECTION)),
    getDocs(projectPath(globalProjectId, INSPECTION_CALL_ITEM_COLLECTION)),
  ]);

  const poLines: InspectablePoLine[] = mc.poLines.map((line) => {
    const mcLedger = mc.ledgers.get(poLineKey(line.poId, line.poLineId));
    return {
      poId: line.poId,
      poNumber: line.poNumber,
      poLineId: line.poLineId,
      boqItemId: line.boqItemId,
      itemDescription: line.itemDescription,
      unit: line.unit,
      orderedQty: line.orderedQty,
      // The ceiling. Approved MC quantity only — a submitted-but-undecided clearance is not a
      // licence to manufacture, so it is not a licence to offer for inspection either.
      mcApprovedQty: mcLedger?.approvedQty ?? 0,
    };
  });

  const calls = callSnapshot.docs.map(
    (entry) => ({ id: entry.id, ...entry.data() }) as InspectionCall,
  );
  const items = itemSnapshot.docs.map(
    (entry) => ({ id: entry.id, ...entry.data() }) as InspectionCallItem,
  );

  return {
    poLines,
    calls,
    items,
    ledgers: buildInspectionLedgers(poLines, items, calls, options),
    vendorByPoId: mc.vendorByPoId,
    boqSlNoByBoqItemId: mc.boqSlNoByBoqItemId,
  };
}

/**
 * Projects the call ledger onto the old per-BOQ-item inspection gate records.
 *
 * The old `inspections` record is what `canIssueMdcc` reads, along with five screens and
 * `boq-traceability`. Without this, recording a result on a call would leave every one of them
 * showing "Not Requested" and MDCC permanently shut.
 *
 * This projection carries more than MC's, because the old record already has somewhere to put it:
 * `qtyOffered`, `qtyAccepted`, `qtyRejected` and `punchItems` all exist on `InspectionRecord`. The
 * punch items matter most — `canIssueMdcc` reads them directly to decide whether a conditional
 * pass may proceed, so a projection that dropped them would let blocked material through.
 *
 * Status mapping, summed across every PO line for the BOQ item:
 *   nothing raised            → leave alone (the register's own "Not Requested")
 *   only undecided offers     → Requested
 *   accepted, punch open      → Passed with Punch Items
 *   accepted, nothing open    → Passed
 *   decided with none accepted→ Failed
 *
 * One-directional and idempotent, as with `syncMcGateRecords`.
 */
export async function syncInspectionGateRecords(globalProjectId: string): Promise<number> {
  const { poLines, items, calls, boqSlNoByBoqItemId } = await loadInspectionWorkspace(
    globalProjectId,
  );

  /** PO identity per BOQ item, for the gate record's own fields. */
  const lineMeta = new Map<string, { poId: string; poNumber: string; description: string }>();
  const boqItemIdByPoLine = new Map<string, string>();
  for (const line of poLines) {
    if (!line.boqItemId) continue;
    if (!lineMeta.has(line.boqItemId)) {
      lineMeta.set(line.boqItemId, {
        poId: line.poId,
        poNumber: line.poNumber,
        description: line.itemDescription,
      });
    }
    boqItemIdByPoLine.set(inspectionPoLineKey(line.poId, line.poLineId), line.boqItemId);
  }

  const callsById = new Map(calls.map((call) => [call.id, call]));

  type Rolled = {
    offeredQty: number;
    acceptedQty: number;
    rejectedQty: number;
    pendingCount: number;
    decidedCount: number;
    punchItems: PunchItem[];
    inspectionDate?: string;
    inspectorName?: string;
  };
  const byBoqItemId = new Map<string, Rolled>();

  for (const item of items) {
    const boqItemId = boqItemIdByPoLine.get(inspectionPoLineKey(item.poId, item.poLineId));
    if (!boqItemId) continue;
    const call = callsById.get(item.callId);
    // A cancelled call, or a cancelled line, authorises nothing.
    if (!call || call.status === "Cancelled" || item.status === "Cancelled") continue;
    // A draft has not been offered to anyone yet.
    if (call.status === "Draft") continue;

    const rolled =
      byBoqItemId.get(boqItemId) ??
      {
        offeredQty: 0,
        acceptedQty: 0,
        rejectedQty: 0,
        pendingCount: 0,
        decidedCount: 0,
        punchItems: [] as PunchItem[],
      };

    rolled.offeredQty += toNumber(item.offeredQty);
    rolled.acceptedQty += toNumber(item.acceptedQty);
    rolled.rejectedQty += rejectedQtyOf(item);
    if (item.status === "Pending") rolled.pendingCount += 1;
    else rolled.decidedCount += 1;
    if (item.punchItems?.length) rolled.punchItems.push(...item.punchItems);
    if (call.inspectionDate) rolled.inspectionDate = call.inspectionDate;
    if (call.inspectorName) rolled.inspectorName = call.inspectorName;

    byBoqItemId.set(boqItemId, rolled);
  }

  const existingSnapshot = await getDocs(projectPath(globalProjectId, INSPECTION_COLLECTION));
  const existingById = new Map(
    existingSnapshot.docs.map((entry) => [entry.id, entry.data() as Record<string, unknown>]),
  );

  const batch = writeBatch(db);
  let written = 0;

  for (const [boqItemId, rolled] of byBoqItemId) {
    const meta = lineMeta.get(boqItemId);
    if (!meta) continue;

    const status =
      rolled.decidedCount === 0
        ? "Requested"
        : rolled.acceptedQty > 0
          ? rolled.punchItems.some((punch) => !punch.closed)
            ? "Passed with Punch Items"
            : "Passed"
          : "Failed";

    const existing = existingById.get(boqItemId);
    // Leave a record the old register owns alone — its status was typed in, not derived.
    if (existing && existing.source !== INSPECTION_GATE_SOURCE_CALL) continue;

    const payload: Record<string, unknown> = {
      boqItemId,
      boqSlNo: boqSlNoByBoqItemId.get(boqItemId) ?? "",
      description: meta.description,
      poId: meta.poId,
      poNumber: meta.poNumber,
      status,
      qtyOffered: rolled.offeredQty,
      qtyAccepted: rolled.acceptedQty,
      qtyRejected: rolled.rejectedQty,
      source: INSPECTION_GATE_SOURCE_CALL,
      updatedAt: serverTimestamp(),
    };
    // Never write undefined, and never write an empty punch array over a real one.
    if (rolled.punchItems.length) payload.punchItems = rolled.punchItems;
    if (rolled.inspectionDate) payload.inspectionDate = rolled.inspectionDate;
    if (rolled.inspectorName) payload.inspectorName = rolled.inspectorName;

    // Skip a write that would change nothing, so the count means something.
    if (
      existing &&
      existing.status === status &&
      toNumber(existing.qtyAccepted) === rolled.acceptedQty &&
      toNumber(existing.qtyOffered) === rolled.offeredQty
    ) {
      continue;
    }

    batch.set(doc(db, "projects", globalProjectId, INSPECTION_COLLECTION, boqItemId), payload, {
      merge: true,
    });
    written += 1;
  }

  if (written > 0) await batch.commit();
  return written;
}

export interface InspectionDraftLine {
  poId: string;
  poNumber: string;
  poLineId: string;
  boqItemId?: string;
  itemDescription: string;
  unit: string;
  offeredQty: number;
  remarks?: string;
}

export interface CreateInspectionCallParams {
  globalProjectId: string;
  vendorId: string;
  vendorName: string;
  callDate: string;
  inspectorName?: string;
  agency?: string;
  remarks?: string;
  lines: readonly InspectionDraftLine[];
  /** Cleared quantity per line key, so the transaction can check without re-reading the MC data. */
  clearedQtyByLineKey: ReadonlyMap<string, number>;
  /** Draft holds nothing; Called reserves the offered quantity. */
  submit: boolean;
  actor: InspectionActor;
}

/**
 * Raises an inspection call, reserving its offered quantity atomically when it is called.
 *
 * All-or-nothing on submit, as with MC: a partially-reserved call is a document the inspector
 * cannot work from.
 */
export async function createInspectionCall({
  globalProjectId,
  vendorId,
  vendorName,
  callDate,
  inspectorName,
  agency,
  remarks,
  lines,
  clearedQtyByLineKey,
  submit,
  actor,
}: CreateInspectionCallParams): Promise<{ callId: string; callNumber: string }> {
  const callRef = doc(projectPath(globalProjectId, INSPECTION_CALL_COLLECTION));
  const callNumber = generateInspectionCallNumber(callDate, callRef.id);

  const callPayload: Record<string, unknown> = {
    callNumber,
    globalProjectId,
    vendorId,
    vendorName,
    callDate,
    status: submit ? "Called" : "Draft",
    revision: 0,
    createdAt: serverTimestamp(),
    createdBy: actor.id,
    createdByName: actor.name,
    updatedAt: serverTimestamp(),
    updatedBy: actor.id,
    updatedByName: actor.name,
  };
  // Never write undefined — a null reads back as a value and defeats the tolerant readers.
  if (inspectorName?.trim()) callPayload.inspectorName = inspectorName.trim();
  if (agency?.trim()) callPayload.agency = agency.trim();
  if (remarks?.trim()) callPayload.remarks = remarks.trim();
  if (submit) {
    callPayload.calledAt = serverTimestamp();
    callPayload.calledBy = actor.id;
    callPayload.calledByName = actor.name;
  }

  const itemRefs = lines.map(() =>
    doc(projectPath(globalProjectId, INSPECTION_CALL_ITEM_COLLECTION)),
  );
  const itemPayload = (line: InspectionDraftLine): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      callId: callRef.id,
      poId: line.poId,
      poNumber: line.poNumber,
      poLineId: line.poLineId,
      itemDescription: line.itemDescription,
      unit: line.unit,
      offeredQty: line.offeredQty,
      status: "Pending",
      createdAt: serverTimestamp(),
    };
    if (line.boqItemId) payload.boqItemId = line.boqItemId;
    if (line.remarks?.trim()) payload.remarks = line.remarks.trim();
    return payload;
  };

  if (!submit) {
    const batch = writeBatch(db);
    batch.set(callRef, callPayload);
    lines.forEach((line, index) => batch.set(itemRefs[index], itemPayload(line)));
    await batch.commit();
    return { callId: callRef.id, callNumber };
  }

  await runTransaction(db, async (transaction) => {
    const balanceRefs = lines.map((line) =>
      doc(
        db,
        "projects",
        globalProjectId,
        INSPECTION_PO_LINE_BALANCE_COLLECTION,
        inspectionPoLineBalanceId(line.poId, line.poLineId),
      ),
    );
    /**
     * MC's own guard document, read here so the *ceiling* is atomic too and not just the
     * consumption.
     *
     * `clearedQtyByLineKey` was computed when the screen loaded. If an MC amendment reduced the
     * approved quantity in the meantime, that figure is stale and too high — so the smaller of
     * the two is used. Both guards are keyed `${poId}__${poLineId}`, which is what makes this a
     * document read rather than a query.
     */
    const mcBalanceRefs = lines.map((line) =>
      doc(
        db,
        "projects",
        globalProjectId,
        MC_PO_LINE_BALANCE_COLLECTION,
        mcPoLineBalanceId(line.poId, line.poLineId),
      ),
    );
    const [balanceSnapshots, mcBalanceSnapshots] = await Promise.all([
      Promise.all(balanceRefs.map((ref) => transaction.get(ref))),
      Promise.all(mcBalanceRefs.map((ref) => transaction.get(ref))),
    ]);

    /** The binding ceiling for a line, at commit time. */
    const clearedQtyAt = (index: number, line: InspectionDraftLine): number => {
      const atLoad = clearedQtyByLineKey.get(inspectionPoLineKey(line.poId, line.poLineId)) ?? 0;
      const mcSnapshot = mcBalanceSnapshots[index];
      if (!mcSnapshot.exists()) return atLoad;
      return Math.min(atLoad, toNumber((mcSnapshot.data() as { approvedQty?: unknown }).approvedQty));
    };

    // Check every line before writing anything, so the refusal names the real problem rather
    // than whichever line happened to be reached first.
    lines.forEach((line, index) => {
      const snapshot = balanceSnapshots[index];
      const balance = snapshot.exists() ? (snapshot.data() as InspectionPoLineBalance) : null;
      const check = checkBalanceForOffer(line.offeredQty, clearedQtyAt(index, line), balance);
      if (!check.ok) {
        throw new Error(
          `${INSPECTION_BALANCE_CONFLICT}: ${line.poNumber} · ${line.itemDescription} — ${check.message}`,
        );
      }
    });

    transaction.set(callRef, callPayload);
    lines.forEach((line, index) => {
      transaction.set(itemRefs[index], itemPayload(line));

      const snapshot = balanceSnapshots[index];
      const existing = snapshot.exists() ? (snapshot.data() as InspectionPoLineBalance) : null;
      const clearedQty = clearedQtyAt(index, line);
      transaction.set(
        balanceRefs[index],
        {
          poId: line.poId,
          poLineId: line.poLineId,
          poNumber: line.poNumber,
          clearedQty,
          acceptedQty: existing ? toNumber(existing.acceptedQty) : 0,
          offeredPendingQty:
            (existing ? toNumber(existing.offeredPendingQty) : 0) + line.offeredQty,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });
  });

  // Raising a call puts the item's gate into "Requested". Only on submit — a draft has been
  // offered to nobody.
  await syncInspectionGateRecords(globalProjectId);

  return { callId: callRef.id, callNumber };
}

/** One line's result, as the inspector records it. */
export interface InspectionResultLine {
  itemId: string;
  acceptedQty: number;
  punchItems?: PunchItem[];
  serials?: string[];
  remarks?: string;
}

/**
 * Records the inspection result for a whole call.
 *
 * The offered quantity stops being reserved and the accepted part becomes accepted; the rejected
 * remainder simply returns to the cleared balance, which is what lets reworked material be
 * re-offered without anyone adjusting a figure by hand.
 *
 * The item status is derived from the accepted quantity by `resultStatusFor`, never passed in, so
 * "Passed" with nothing accepted cannot be recorded.
 */
export async function recordInspectionResult({
  globalProjectId,
  callId,
  inspectionDate,
  inspectorName,
  results,
  actor,
}: {
  globalProjectId: string;
  callId: string;
  inspectionDate: string;
  inspectorName?: string;
  results: readonly InspectionResultLine[];
  actor: InspectionActor;
}): Promise<void> {
  const callRef = doc(db, "projects", globalProjectId, INSPECTION_CALL_COLLECTION, callId);
  const itemSnapshot = await getDocs(projectPath(globalProjectId, INSPECTION_CALL_ITEM_COLLECTION));
  const own = itemSnapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }) as InspectionCallItem)
    .filter((item) => item.callId === callId && item.status !== "Cancelled");
  const resultByItemId = new Map(results.map((result) => [result.itemId, result]));

  await runTransaction(db, async (transaction) => {
    const callDoc = await transaction.get(callRef);
    if (!callDoc.exists()) throw new Error("This inspection call no longer exists.");
    const call = callDoc.data() as InspectionCall;

    // A result may only be recorded while the call is live — otherwise a double submit consumes
    // the reserved quantity twice and the guard drifts from the ledger.
    if (call.status !== "Called" && call.status !== "Partially Inspected") {
      throw new Error(
        `This call is already ${call.status.toLowerCase()}. Refresh before recording a result again.`,
      );
    }

    const decided = own.filter((item) => resultByItemId.has(item.id) && item.status === "Pending");
    const balanceRefs = decided.map((item) =>
      doc(
        db,
        "projects",
        globalProjectId,
        INSPECTION_PO_LINE_BALANCE_COLLECTION,
        inspectionPoLineBalanceId(item.poId, item.poLineId),
      ),
    );
    const balanceSnapshots = await Promise.all(balanceRefs.map((ref) => transaction.get(ref)));

    decided.forEach((item, index) => {
      const result = resultByItemId.get(item.id)!;
      const offeredQty = toNumber(item.offeredQty);
      const acceptedQty = Math.min(toNumber(result.acceptedQty), offeredQty);
      const punchItems = result.punchItems ?? [];
      const status = resultStatusFor(acceptedQty, punchItems);

      const itemUpdate: Record<string, unknown> = {
        acceptedQty,
        status,
        inspectionDate,
        updatedAt: serverTimestamp(),
        updatedBy: actor.id,
        updatedByName: actor.name,
      };
      if (punchItems.length) itemUpdate.punchItems = punchItems;
      if (result.serials?.length) itemUpdate.serials = result.serials;
      if (result.remarks?.trim()) itemUpdate.remarks = result.remarks.trim();
      transaction.set(
        doc(db, "projects", globalProjectId, INSPECTION_CALL_ITEM_COLLECTION, item.id),
        itemUpdate,
        { merge: true },
      );

      const snapshot = balanceSnapshots[index];
      if (!snapshot.exists()) return;
      const balance = snapshot.data() as InspectionPoLineBalance;
      transaction.set(
        balanceRefs[index],
        {
          // Floored at zero: a guard that has drifted must not be driven negative by a result.
          offeredPendingQty: Math.max(0, toNumber(balance.offeredPendingQty) - offeredQty),
          acceptedQty: toNumber(balance.acceptedQty) + acceptedQty,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });

    // The call's own status follows its items: every line decided means Completed, some means
    // Partially Inspected. Computed here from what this write is about to produce.
    const decidedIds = new Set(decided.map((item) => item.id));
    const stillPending = own.filter(
      (item) => item.status === "Pending" && !decidedIds.has(item.id),
    ).length;

    const callUpdate: Record<string, unknown> = {
      status: stillPending > 0 ? "Partially Inspected" : "Completed",
      inspectionDate,
      updatedAt: serverTimestamp(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    };
    if (inspectorName?.trim()) callUpdate.inspectorName = inspectorName.trim();
    transaction.set(callRef, callUpdate, { merge: true });
  });

  // Outside the transaction because it reads the whole ledger, which a client transaction cannot
  // query. Idempotent, so a failure here leaves the result intact and is repaired by re-running
  // it — which is what the register's Sync gates action does.
  await syncInspectionGateRecords(globalProjectId);
}

/** Cancels a live call, releasing every offered quantity it was holding. */
export async function cancelInspectionCall({
  globalProjectId,
  callId,
  actor,
}: {
  globalProjectId: string;
  callId: string;
  actor: InspectionActor;
}): Promise<void> {
  const callRef = doc(db, "projects", globalProjectId, INSPECTION_CALL_COLLECTION, callId);
  const itemSnapshot = await getDocs(projectPath(globalProjectId, INSPECTION_CALL_ITEM_COLLECTION));
  const pending = itemSnapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }) as InspectionCallItem)
    .filter((item) => item.callId === callId && item.status === "Pending");

  await runTransaction(db, async (transaction) => {
    const callDoc = await transaction.get(callRef);
    if (!callDoc.exists()) throw new Error("This inspection call no longer exists.");
    const call = callDoc.data() as InspectionCall;
    if (call.status === "Cancelled") throw new Error("This call is already cancelled.");
    if (call.status === "Completed") {
      throw new Error("A completed inspection cannot be cancelled. Raise a fresh call instead.");
    }

    const balanceRefs = pending.map((item) =>
      doc(
        db,
        "projects",
        globalProjectId,
        INSPECTION_PO_LINE_BALANCE_COLLECTION,
        inspectionPoLineBalanceId(item.poId, item.poLineId),
      ),
    );
    const balanceSnapshots = await Promise.all(balanceRefs.map((ref) => transaction.get(ref)));

    pending.forEach((item, index) => {
      transaction.set(
        doc(db, "projects", globalProjectId, INSPECTION_CALL_ITEM_COLLECTION, item.id),
        { status: "Cancelled", updatedAt: serverTimestamp() },
        { merge: true },
      );
      const snapshot = balanceSnapshots[index];
      if (!snapshot.exists()) return;
      const balance = snapshot.data() as InspectionPoLineBalance;
      transaction.set(
        balanceRefs[index],
        {
          offeredPendingQty: Math.max(
            0,
            toNumber(balance.offeredPendingQty) - toNumber(item.offeredQty),
          ),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });

    transaction.set(
      callRef,
      {
        status: "Cancelled",
        updatedAt: serverTimestamp(),
        updatedBy: actor.id,
        updatedByName: actor.name,
      },
      { merge: true },
    );
  });

  // Cancelling withdraws the offer, so the gate has to fall back to whatever other calls say.
  await syncInspectionGateRecords(globalProjectId);
}

/** Deletes a draft call and its lines. Drafts hold no quantity, so no guard changes. */
export async function deleteInspectionDraft(
  globalProjectId: string,
  callId: string,
): Promise<void> {
  const callRef = doc(db, "projects", globalProjectId, INSPECTION_CALL_COLLECTION, callId);
  const callDoc = await getDoc(callRef);
  if (!callDoc.exists()) return;
  if ((callDoc.data() as InspectionCall).status !== "Draft") {
    throw new Error("Only a draft call can be deleted. Cancel it instead.");
  }

  const itemSnapshot = await getDocs(projectPath(globalProjectId, INSPECTION_CALL_ITEM_COLLECTION));
  const batch = writeBatch(db);
  itemSnapshot.docs
    .filter((entry) => (entry.data() as InspectionCallItem).callId === callId)
    .forEach((entry) => batch.delete(entry.ref));
  batch.delete(callRef);
  await batch.commit();
}

/**
 * Recomputes every guard document from the call items.
 *
 * The guard is derived data, so it can always be rebuilt. Exposed because an interrupted
 * transaction would otherwise leave a line permanently under-available with no way back — and
 * because a later MC clearance raises the ceiling, which the stored `clearedQty` only picks up
 * when it is rewritten.
 */
export async function rebuildInspectionPoLineBalances(globalProjectId: string): Promise<number> {
  const { poLines, ledgers } = await loadInspectionWorkspace(globalProjectId);
  const batch = writeBatch(db);
  let written = 0;

  for (const line of poLines) {
    const ledger = ledgers.get(inspectionPoLineKey(line.poId, line.poLineId));
    if (!ledger) continue;
    batch.set(
      doc(
        db,
        "projects",
        globalProjectId,
        INSPECTION_PO_LINE_BALANCE_COLLECTION,
        inspectionPoLineBalanceId(line.poId, line.poLineId),
      ),
      { ...rebuildInspectionPoLineBalance(ledger), updatedAt: serverTimestamp() },
      { merge: true },
    );
    written += 1;
  }

  await batch.commit();
  return written;
}

/** `clearedQty` per line key, as `createInspectionCall` needs it. */
export const clearedQtyByLineKey = (
  poLines: readonly InspectablePoLine[],
): Map<string, number> =>
  new Map(
    poLines.map((line) => [
      inspectionPoLineKey(line.poId, line.poLineId),
      Math.max(0, toNumber(line.mcApprovedQty)),
    ]),
  );

/** Total rejected quantity on a call, for the register and the rework view. */
export const callRejectedQty = (items: readonly InspectionCallItem[]): number =>
  Math.round(items.reduce((sum, item) => sum + rejectedQtyOf(item), 0) * 1000) / 1000;
