"use client";

/**
 * Reading and writing the downstream supply documents: MDCC, DI, GRN and MVAC.
 *
 * The quantity rules live in `project-management-supply-ledger.ts`, which is pure and tested.
 * This module is the Firestore half, and it does one thing the other services do not: it walks
 * the *whole chain* in a single pass.
 *
 * `loadSupplyChain` builds MC and Inspection first, then MDCC on top of Inspection, DI on top of
 * MDCC, GRN on top of DI and MVAC on top of GRN — each stage's ceiling being the previous stage's
 * accepted quantity. Loading a stage in isolation is not possible without that walk, and doing it
 * per stage would read the same purchase orders four times.
 *
 * Concurrency is guarded as elsewhere: one transacted document per PO line per stage, because the
 * client SDK cannot query inside a transaction. The ceiling is read inside the transaction too,
 * from the upstream stage's guard, so an upstream amendment cannot be outrun by a stale form.
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
import {
  DI_COLLECTION,
  GRN_COLLECTION,
  MDCC_COLLECTION,
  MVAC_COLLECTION,
  computeDiPath,
  computeGrnStatus,
  isInspectionRequired,
  type PunchItem,
} from "@/lib/supply-gates";
import { MC_PO_LINE_BALANCE_COLLECTION, mcPoLineBalanceId } from "@/lib/project-management-mc-quantity";
import { loadInspectionWorkspace } from "@/lib/project-management-inspection-service";
import { inspectionPoLineKey } from "@/lib/project-management-inspection-quantity";
import {
  SUPPLY_LEDGER_STAGES,
  buildSupplyLedgers,
  checkSupplyBalance,
  deriveSupplyDocStatus,
  generateSupplyDocNumber,
  resolveUpstreamQty,
  supplyItemStatusFor,
  supplyPoLineKey,
  supplyRejectedQtyOf,
  supplyStage,
  type SupplyDoc,
  type SupplyDocItem,
  type SupplyLedger,
  type SupplyLedgerStage,
  type SupplyPoLine,
  type SupplyPoLineBalance,
  type UpstreamSource,
} from "@/lib/project-management-supply-ledger";

export const SUPPLY_BALANCE_CONFLICT = "SUPPLY_BALANCE_CONFLICT";

/** Marks a gate record as owned by the document projection rather than the old per-item screen. */
export const SUPPLY_GATE_SOURCE_DOCUMENT = "supplyDocument";

export interface SupplyActor {
  id: string;
  name: string;
}

export interface SupplyStageState {
  poLines: SupplyPoLine[];
  docs: SupplyDoc[];
  items: SupplyDocItem[];
  ledgers: Map<string, SupplyLedger>;
}

export interface SupplyChain {
  /** Per stage, in chain order. */
  stages: Record<SupplyLedgerStage, SupplyStageState>;
  vendorByPoId: Map<string, { vendorId: string; vendorName: string }>;
  boqSlNoByBoqItemId: Map<string, string>;
  /** PO lines whose BOQ item is explicitly flagged as not requiring inspection. */
  directPathLineKeys: Set<string>;
}

const projectPath = (globalProjectId: string, name: string) =>
  collection(db, "projects", globalProjectId, name);

/** The old per-BOQ-item gate collection for each stage. */
const GATE_COLLECTION: Record<SupplyLedgerStage, string> = {
  mdcc: MDCC_COLLECTION,
  di: DI_COLLECTION,
  grn: GRN_COLLECTION,
  mvac: MVAC_COLLECTION,
};

/**
 * Loads every stage of the chain, each with its ceiling resolved from the stage above.
 *
 * `excludeDocId` applies only to `excludeStage`, so a form editing one MDCC still sees every
 * other stage whole.
 */
export async function loadSupplyChain(
  globalProjectId: string,
  options: { excludeStage?: SupplyLedgerStage; excludeDocId?: string } = {},
): Promise<SupplyChain> {
  const [inspection, ...stageSnapshots] = await Promise.all([
    loadInspectionWorkspace(globalProjectId),
    ...SUPPLY_LEDGER_STAGES.flatMap((stage) => [
      getDocs(projectPath(globalProjectId, supplyStage(stage).headerCollection)),
      getDocs(projectPath(globalProjectId, supplyStage(stage).itemCollection)),
    ]),
    getDocs(projectPath(globalProjectId, "boqItems")),
  ]);

  const boqSnapshot = stageSnapshots[stageSnapshots.length - 1];
  /** BOQ items explicitly flagged as not requiring inspection take the direct dispatch path. */
  const directBoqItemIds = new Set(
    boqSnapshot.docs
      .filter(
        (entry) =>
          !isInspectionRequired((entry.data() as Record<string, unknown>)["Inspection Required"]),
      )
      .map((entry) => entry.id),
  );

  const directPathLineKeys = new Set<string>();
  for (const line of inspection.poLines) {
    if (line.boqItemId && directBoqItemIds.has(line.boqItemId)) {
      directPathLineKeys.add(supplyPoLineKey(line.poId, line.poLineId));
    }
  }

  /** Accepted quantity so far per line key, growing as the walk moves downstream. */
  const acceptedByStage = new Map<string, Partial<Record<UpstreamSource, number>>>();
  for (const line of inspection.poLines) {
    const key = supplyPoLineKey(line.poId, line.poLineId);
    const inspectionLedger = inspection.ledgers.get(inspectionPoLineKey(line.poId, line.poLineId));
    acceptedByStage.set(key, {
      // MC's approved quantity is the direct path's ceiling, and Inspection's own ceiling.
      mc: inspectionLedger?.clearedQty ?? 0,
      inspection: inspectionLedger?.acceptedQty ?? 0,
    });
  }

  const stages = {} as Record<SupplyLedgerStage, SupplyStageState>;

  SUPPLY_LEDGER_STAGES.forEach((stage, index) => {
    const docSnapshot = stageSnapshots[index * 2];
    const itemSnapshot = stageSnapshots[index * 2 + 1];
    const docs = docSnapshot.docs.map(
      (entry) => ({ id: entry.id, stage, ...entry.data() }) as SupplyDoc,
    );
    const items = itemSnapshot.docs.map(
      (entry) => ({ id: entry.id, stage, ...entry.data() }) as SupplyDocItem,
    );

    const poLines: SupplyPoLine[] = inspection.poLines.map((line) => {
      const key = supplyPoLineKey(line.poId, line.poLineId);
      const directPath = directPathLineKeys.has(key);
      return {
        poId: line.poId,
        poNumber: line.poNumber,
        poLineId: line.poLineId,
        boqItemId: line.boqItemId,
        itemDescription: line.itemDescription,
        unit: line.unit,
        orderedQty: line.orderedQty,
        upstreamQty: resolveUpstreamQty(stage, acceptedByStage.get(key) ?? {}, { directPath }),
        directPath,
      };
    });

    const ledgers = buildSupplyLedgers(
      stage,
      poLines,
      items,
      docs,
      options.excludeStage === stage ? { excludeDocId: options.excludeDocId } : {},
    );

    // Feed this stage's accepted quantity forward, so the next stage's ceiling is this one's
    // output rather than the purchase order's.
    for (const [key, ledger] of ledgers) {
      acceptedByStage.set(key, { ...(acceptedByStage.get(key) ?? {}), [stage]: ledger.acceptedQty });
    }

    stages[stage] = { poLines, docs, items, ledgers };
  });

  return {
    stages,
    vendorByPoId: inspection.vendorByPoId,
    boqSlNoByBoqItemId: inspection.boqSlNoByBoqItemId,
    directPathLineKeys,
  };
}

export interface SupplyDraftLine {
  poId: string;
  poNumber: string;
  poLineId: string;
  boqItemId?: string;
  itemDescription: string;
  unit: string;
  presentedQty: number;
  remarks?: string;
}

/**
 * Raises a document, reserving its presented quantity atomically when it is submitted.
 *
 * The ceiling is re-read inside the transaction from the upstream stage's own guard document,
 * not taken from the form — an upstream amendment between opening the form and submitting it
 * would otherwise let a stale, too-high ceiling through. Both guards are keyed
 * `${poId}__${poLineId}`, which is what makes this a document read rather than a query.
 */
export async function createSupplyDoc({
  globalProjectId,
  stage,
  vendorId,
  vendorName,
  docDate,
  counterparty,
  meta,
  remarks,
  lines,
  upstreamQtyByLineKey,
  submit,
  actor,
}: {
  globalProjectId: string;
  stage: SupplyLedgerStage;
  vendorId?: string;
  vendorName?: string;
  docDate: string;
  counterparty?: string;
  meta?: Record<string, unknown>;
  remarks?: string;
  lines: readonly SupplyDraftLine[];
  upstreamQtyByLineKey: ReadonlyMap<string, number>;
  submit: boolean;
  actor: SupplyActor;
}): Promise<{ docId: string; docNumber: string }> {
  const definition = supplyStage(stage);
  const docRef = doc(projectPath(globalProjectId, definition.headerCollection));
  const docNumber = generateSupplyDocNumber(stage, docDate, docRef.id);

  const docPayload: Record<string, unknown> = {
    stage,
    docNumber,
    globalProjectId,
    docDate,
    status: submit ? "Open" : "Draft",
    revision: 0,
    createdAt: serverTimestamp(),
    createdBy: actor.id,
    createdByName: actor.name,
    updatedAt: serverTimestamp(),
    updatedBy: actor.id,
    updatedByName: actor.name,
  };
  // Never write undefined — a null reads back as a value and defeats the tolerant readers.
  if (vendorId) docPayload.vendorId = vendorId;
  if (vendorName) docPayload.vendorName = vendorName;
  if (counterparty?.trim()) docPayload.counterparty = counterparty.trim();
  if (meta && Object.keys(meta).length) docPayload.meta = meta;
  if (remarks?.trim()) docPayload.remarks = remarks.trim();

  const itemRefs = lines.map(() => doc(projectPath(globalProjectId, definition.itemCollection)));
  const itemPayload = (line: SupplyDraftLine): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      docId: docRef.id,
      stage,
      poId: line.poId,
      poNumber: line.poNumber,
      poLineId: line.poLineId,
      itemDescription: line.itemDescription,
      unit: line.unit,
      presentedQty: line.presentedQty,
      status: "Pending",
      createdAt: serverTimestamp(),
    };
    if (line.boqItemId) payload.boqItemId = line.boqItemId;
    if (line.remarks?.trim()) payload.remarks = line.remarks.trim();
    return payload;
  };

  if (!submit) {
    const batch = writeBatch(db);
    batch.set(docRef, docPayload);
    lines.forEach((line, index) => batch.set(itemRefs[index], itemPayload(line)));
    await batch.commit();
    return { docId: docRef.id, docNumber };
  }

  /** The upstream guard to read for a ceiling, where one exists as a document. */
  const upstreamBalanceCollection =
    definition.upstream === "mc"
      ? MC_PO_LINE_BALANCE_COLLECTION
      : definition.upstream === "inspection"
        ? "inspectionPoLineBalances"
        : supplyStage(definition.upstream as SupplyLedgerStage).balanceCollection;
  /** MC's guard stores its output as `approvedQty`; every other stage as `acceptedQty`. */
  const upstreamField = definition.upstream === "mc" ? "approvedQty" : "acceptedQty";

  await runTransaction(db, async (transaction) => {
    const balanceRefs = lines.map((line) =>
      doc(
        db,
        "projects",
        globalProjectId,
        definition.balanceCollection,
        mcPoLineBalanceId(line.poId, line.poLineId),
      ),
    );
    const upstreamRefs = lines.map((line) =>
      doc(
        db,
        "projects",
        globalProjectId,
        upstreamBalanceCollection,
        mcPoLineBalanceId(line.poId, line.poLineId),
      ),
    );
    const [balanceSnapshots, upstreamSnapshots] = await Promise.all([
      Promise.all(balanceRefs.map((ref) => transaction.get(ref))),
      Promise.all(upstreamRefs.map((ref) => transaction.get(ref))),
    ]);

    /** The binding ceiling at commit time: the lower of the form's figure and the guard's. */
    const ceilingAt = (index: number, line: SupplyDraftLine): number => {
      const atLoad = upstreamQtyByLineKey.get(supplyPoLineKey(line.poId, line.poLineId)) ?? 0;
      const snapshot = upstreamSnapshots[index];
      if (!snapshot.exists()) return atLoad;
      const stored = toNumber((snapshot.data() as Record<string, unknown>)[upstreamField]);
      return Math.min(atLoad, stored);
    };

    // Check every line before writing anything, so the refusal names the real problem rather
    // than whichever line happened to be reached first.
    lines.forEach((line, index) => {
      const snapshot = balanceSnapshots[index];
      const balance = snapshot.exists() ? (snapshot.data() as SupplyPoLineBalance) : null;
      const check = checkSupplyBalance(stage, line.presentedQty, ceilingAt(index, line), balance);
      if (!check.ok) {
        throw new Error(
          `${SUPPLY_BALANCE_CONFLICT}: ${line.poNumber} · ${line.itemDescription} — ${check.message}`,
        );
      }
    });

    transaction.set(docRef, docPayload);
    lines.forEach((line, index) => {
      transaction.set(itemRefs[index], itemPayload(line));
      const snapshot = balanceSnapshots[index];
      const existing = snapshot.exists() ? (snapshot.data() as SupplyPoLineBalance) : null;
      transaction.set(
        balanceRefs[index],
        {
          poId: line.poId,
          poLineId: line.poLineId,
          poNumber: line.poNumber,
          upstreamQty: ceilingAt(index, line),
          acceptedQty: existing ? toNumber(existing.acceptedQty) : 0,
          inFlightQty: (existing ? toNumber(existing.inFlightQty) : 0) + line.presentedQty,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });
  });

  await syncSupplyGateRecords(globalProjectId, stage);
  return { docId: docRef.id, docNumber };
}

export interface SupplyDecisionLine {
  itemId: string;
  acceptedQty: number;
  observations?: PunchItem[];
  serials?: string[];
  remarks?: string;
  /** GRN only: the discrepancy split, which `computeGrnStatus` turns into a status. */
  shortQty?: number;
  damagedQty?: number;
}

/**
 * Records the outcome for a whole document.
 *
 * The presented quantity stops being in flight and the accepted part becomes accepted; the
 * remainder returns to the ceiling, which is what lets rejected material be re-presented without
 * anyone adjusting a figure by hand. The item status is derived from the accepted quantity by
 * `supplyItemStatusFor`, never passed in, so "Accepted" with nothing accepted cannot be recorded.
 */
export async function recordSupplyDecision({
  globalProjectId,
  stage,
  docId,
  decidedDate,
  counterparty,
  decisions,
  actor,
}: {
  globalProjectId: string;
  stage: SupplyLedgerStage;
  docId: string;
  decidedDate: string;
  counterparty?: string;
  decisions: readonly SupplyDecisionLine[];
  actor: SupplyActor;
}): Promise<void> {
  const definition = supplyStage(stage);
  const docRef = doc(db, "projects", globalProjectId, definition.headerCollection, docId);
  const itemSnapshot = await getDocs(projectPath(globalProjectId, definition.itemCollection));
  const own = itemSnapshot.docs
    .map((entry) => ({ id: entry.id, stage, ...entry.data() }) as SupplyDocItem)
    .filter((item) => item.docId === docId && item.status !== "Cancelled");
  const decisionByItemId = new Map(decisions.map((entry) => [entry.itemId, entry]));

  await runTransaction(db, async (transaction) => {
    const headerDoc = await transaction.get(docRef);
    if (!headerDoc.exists()) throw new Error(`This ${definition.docNoun} no longer exists.`);
    const header = headerDoc.data() as SupplyDoc;

    if (header.status !== "Open" && header.status !== "Partially Completed") {
      throw new Error(
        `This ${definition.docNoun} is already ${header.status.toLowerCase()}. Refresh before recording again.`,
      );
    }

    const decided = own.filter(
      (item) => decisionByItemId.has(item.id) && item.status === "Pending",
    );
    const balanceRefs = decided.map((item) =>
      doc(
        db,
        "projects",
        globalProjectId,
        definition.balanceCollection,
        mcPoLineBalanceId(item.poId, item.poLineId),
      ),
    );
    const balanceSnapshots = await Promise.all(balanceRefs.map((ref) => transaction.get(ref)));

    decided.forEach((item, index) => {
      const decision = decisionByItemId.get(item.id)!;
      const presentedQty = toNumber(item.presentedQty);
      const acceptedQty = Math.min(toNumber(decision.acceptedQty), presentedQty);

      const itemUpdate: Record<string, unknown> = {
        acceptedQty,
        status: supplyItemStatusFor(acceptedQty),
        updatedAt: serverTimestamp(),
        updatedBy: actor.id,
        updatedByName: actor.name,
      };
      if (decision.observations?.length) itemUpdate.observations = decision.observations;
      if (decision.serials?.length) itemUpdate.serials = decision.serials;
      if (decision.remarks?.trim()) itemUpdate.remarks = decision.remarks.trim();
      if (decision.shortQty != null) itemUpdate.shortQty = toNumber(decision.shortQty);
      if (decision.damagedQty != null) itemUpdate.damagedQty = toNumber(decision.damagedQty);
      transaction.set(
        doc(db, "projects", globalProjectId, definition.itemCollection, item.id),
        itemUpdate,
        { merge: true },
      );

      const snapshot = balanceSnapshots[index];
      if (!snapshot.exists()) return;
      const balance = snapshot.data() as SupplyPoLineBalance;
      transaction.set(
        balanceRefs[index],
        {
          // Floored at zero: a guard that has drifted must not be driven negative.
          inFlightQty: Math.max(0, toNumber(balance.inFlightQty) - presentedQty),
          acceptedQty: toNumber(balance.acceptedQty) + acceptedQty,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });

    const decidedIds = new Set(decided.map((item) => item.id));
    const stillPending = own.filter(
      (item) => item.status === "Pending" && !decidedIds.has(item.id),
    ).length;

    const headerUpdate: Record<string, unknown> = {
      status: stillPending > 0 ? "Partially Completed" : "Completed",
      decidedDate,
      updatedAt: serverTimestamp(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    };
    if (counterparty?.trim()) headerUpdate.counterparty = counterparty.trim();
    transaction.set(docRef, headerUpdate, { merge: true });
  });

  await syncSupplyGateRecords(globalProjectId, stage);
}

/** Cancels a live document, releasing every in-flight quantity it was holding. */
export async function cancelSupplyDoc({
  globalProjectId,
  stage,
  docId,
  actor,
}: {
  globalProjectId: string;
  stage: SupplyLedgerStage;
  docId: string;
  actor: SupplyActor;
}): Promise<void> {
  const definition = supplyStage(stage);
  const docRef = doc(db, "projects", globalProjectId, definition.headerCollection, docId);
  const itemSnapshot = await getDocs(projectPath(globalProjectId, definition.itemCollection));
  const pending = itemSnapshot.docs
    .map((entry) => ({ id: entry.id, stage, ...entry.data() }) as SupplyDocItem)
    .filter((item) => item.docId === docId && item.status === "Pending");

  await runTransaction(db, async (transaction) => {
    const headerDoc = await transaction.get(docRef);
    if (!headerDoc.exists()) throw new Error(`This ${definition.docNoun} no longer exists.`);
    const header = headerDoc.data() as SupplyDoc;
    if (header.status === "Cancelled") throw new Error("This document is already cancelled.");
    if (header.status === "Completed") {
      throw new Error(
        `A completed ${definition.docNoun} cannot be cancelled. Raise a fresh one instead.`,
      );
    }

    const balanceRefs = pending.map((item) =>
      doc(
        db,
        "projects",
        globalProjectId,
        definition.balanceCollection,
        mcPoLineBalanceId(item.poId, item.poLineId),
      ),
    );
    const balanceSnapshots = await Promise.all(balanceRefs.map((ref) => transaction.get(ref)));

    pending.forEach((item, index) => {
      transaction.set(
        doc(db, "projects", globalProjectId, definition.itemCollection, item.id),
        { status: "Cancelled", updatedAt: serverTimestamp() },
        { merge: true },
      );
      const snapshot = balanceSnapshots[index];
      if (!snapshot.exists()) return;
      const balance = snapshot.data() as SupplyPoLineBalance;
      transaction.set(
        balanceRefs[index],
        {
          inFlightQty: Math.max(
            0,
            toNumber(balance.inFlightQty) - toNumber(item.presentedQty),
          ),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });

    transaction.set(
      docRef,
      {
        status: "Cancelled",
        updatedAt: serverTimestamp(),
        updatedBy: actor.id,
        updatedByName: actor.name,
      },
      { merge: true },
    );
  });

  await syncSupplyGateRecords(globalProjectId, stage);
}

/** Deletes a draft document and its lines. Drafts hold no quantity, so no guard changes. */
export async function deleteSupplyDraft(
  globalProjectId: string,
  stage: SupplyLedgerStage,
  docId: string,
): Promise<void> {
  const definition = supplyStage(stage);
  const docRef = doc(db, "projects", globalProjectId, definition.headerCollection, docId);
  const headerDoc = await getDoc(docRef);
  if (!headerDoc.exists()) return;
  if ((headerDoc.data() as SupplyDoc).status !== "Draft") {
    throw new Error(`Only a draft ${definition.docNoun} can be deleted. Cancel it instead.`);
  }

  const itemSnapshot = await getDocs(projectPath(globalProjectId, definition.itemCollection));
  const batch = writeBatch(db);
  itemSnapshot.docs
    .filter((entry) => (entry.data() as SupplyDocItem).docId === docId)
    .forEach((entry) => batch.delete(entry.ref));
  batch.delete(docRef);
  await batch.commit();
}

/**
 * Projects a stage's ledger onto its old per-BOQ-item gate record.
 *
 * Each of the four old records is a different shape, so the payload is built per stage rather
 * than generically — GRN's status is derived by `computeGrnStatus` from its discrepancy split,
 * DI records which precondition path it was issued under, and MVAC carries the observations that
 * gate billing release. A generic projection would have to flatten all of that away.
 *
 * One-directional and idempotent, as with the MC and Inspection projections: records tagged
 * `source: "supplyDocument"` are maintained here, anything else was typed in on the old screen
 * and is left alone.
 */
export async function syncSupplyGateRecords(
  globalProjectId: string,
  stage: SupplyLedgerStage,
): Promise<number> {
  const chain = await loadSupplyChain(globalProjectId);
  const state = chain.stages[stage];
  const boqItemIdByLineKey = new Map<string, string>();
  const metaByBoqItemId = new Map<
    string,
    { poId: string; poNumber: string; description: string; directPath: boolean }
  >();

  for (const line of state.poLines) {
    if (!line.boqItemId) continue;
    boqItemIdByLineKey.set(supplyPoLineKey(line.poId, line.poLineId), line.boqItemId);
    if (!metaByBoqItemId.has(line.boqItemId)) {
      metaByBoqItemId.set(line.boqItemId, {
        poId: line.poId,
        poNumber: line.poNumber,
        description: line.itemDescription,
        directPath: Boolean(line.directPath),
      });
    }
  }

  type Rolled = {
    presentedQty: number;
    acceptedQty: number;
    rejectedQty: number;
    shortQty: number;
    damagedQty: number;
    pendingCount: number;
    decidedCount: number;
    observations: PunchItem[];
    serials: string[];
    docNumber?: string;
    decidedDate?: string;
    counterparty?: string;
  };
  const byBoqItemId = new Map<string, Rolled>();
  const docsById = new Map(state.docs.map((entry) => [entry.id, entry]));

  for (const item of state.items) {
    const boqItemId = boqItemIdByLineKey.get(supplyPoLineKey(item.poId, item.poLineId));
    if (!boqItemId) continue;
    const owner = docsById.get(item.docId);
    if (!owner || owner.status === "Cancelled" || owner.status === "Draft") continue;
    if (item.status === "Cancelled") continue;

    const rolled =
      byBoqItemId.get(boqItemId) ??
      {
        presentedQty: 0,
        acceptedQty: 0,
        rejectedQty: 0,
        shortQty: 0,
        damagedQty: 0,
        pendingCount: 0,
        decidedCount: 0,
        observations: [] as PunchItem[],
        serials: [] as string[],
      };

    rolled.presentedQty += toNumber(item.presentedQty);
    rolled.acceptedQty += toNumber(item.acceptedQty);
    rolled.rejectedQty += supplyRejectedQtyOf(item);
    rolled.shortQty += toNumber(item.shortQty);
    rolled.damagedQty += toNumber(item.damagedQty);
    if (item.status === "Pending") rolled.pendingCount += 1;
    else rolled.decidedCount += 1;
    if (item.observations?.length) rolled.observations.push(...item.observations);
    if (item.serials?.length) rolled.serials.push(...item.serials);
    rolled.docNumber = owner.docNumber;
    if (owner.decidedDate) rolled.decidedDate = owner.decidedDate;
    if (owner.counterparty) rolled.counterparty = owner.counterparty;

    byBoqItemId.set(boqItemId, rolled);
  }

  const existingSnapshot = await getDocs(projectPath(globalProjectId, GATE_COLLECTION[stage]));
  const existingById = new Map(
    existingSnapshot.docs.map((entry) => [entry.id, entry.data() as Record<string, unknown>]),
  );

  const batch = writeBatch(db);
  let written = 0;

  for (const [boqItemId, rolled] of byBoqItemId) {
    const meta = metaByBoqItemId.get(boqItemId);
    if (!meta) continue;
    const existing = existingById.get(boqItemId);
    // Leave a record the old register owns alone — its status was typed in, not derived.
    if (existing && existing.source !== SUPPLY_GATE_SOURCE_DOCUMENT) continue;

    const base: Record<string, unknown> = {
      boqItemId,
      boqSlNo: chain.boqSlNoByBoqItemId.get(boqItemId) ?? "",
      description: meta.description,
      poId: meta.poId,
      poNumber: meta.poNumber,
      source: SUPPLY_GATE_SOURCE_DOCUMENT,
      updatedAt: serverTimestamp(),
    };
    const decided = rolled.decidedCount > 0 && rolled.pendingCount === 0;
    let payload: Record<string, unknown>;

    switch (stage) {
      case "mdcc":
        // "Issued" only once the client has actually cleared quantity; otherwise it is Requested.
        payload = {
          ...base,
          status: rolled.acceptedQty > 0 ? "Issued" : decided ? "Pending" : "Requested",
          ...(rolled.docNumber ? { mdccNumber: rolled.docNumber } : {}),
          ...(rolled.decidedDate ? { mdccDate: rolled.decidedDate } : {}),
        };
        break;
      case "di":
        payload = {
          ...base,
          status: rolled.acceptedQty > 0 ? "Dispatched" : "Issued",
          path: computeDiPath(!meta.directPath),
          dispatchQty: rolled.acceptedQty,
          ...(rolled.docNumber ? { diNumber: rolled.docNumber } : {}),
          ...(rolled.serials.length ? { dispatchSerials: rolled.serials } : {}),
          ...(rolled.decidedDate ? { dispatchedOn: rolled.decidedDate } : {}),
        };
        break;
      case "grn":
        payload = {
          ...base,
          // Derived, never chosen — see computeGrnStatus.
          status: computeGrnStatus(
            rolled.presentedQty,
            rolled.rejectedQty,
            rolled.shortQty,
            rolled.damagedQty,
          ),
          receivedQty: rolled.presentedQty,
          acceptedQty: rolled.acceptedQty,
          rejectedQty: rolled.rejectedQty,
          shortQty: rolled.shortQty,
          damagedQty: rolled.damagedQty,
          ...(rolled.docNumber ? { grnNumber: rolled.docNumber } : {}),
          ...(rolled.decidedDate ? { receivedDate: rolled.decidedDate } : {}),
          ...(rolled.serials.length ? { receivedSerials: rolled.serials } : {}),
        };
        break;
      default: {
        const openCritical = rolled.observations.some(
          (entry) => !entry.closed && entry.severity === "Critical",
        );
        payload = {
          ...base,
          // A Critical observation holds acceptance outright — canSignMvac's own rule.
          status: openCritical ? "Held" : rolled.acceptedQty > 0 ? "Signed" : "Requested",
          qtyAccepted: rolled.acceptedQty,
          qtyHeld: rolled.rejectedQty,
          outcome: openCritical
            ? "Held"
            : rolled.observations.length
              ? "Accepted with Observations"
              : "Accepted",
          ...(rolled.observations.length ? { observations: rolled.observations } : {}),
          ...(rolled.serials.length ? { verifiedSerials: rolled.serials } : {}),
          ...(rolled.counterparty ? { clientRepName: rolled.counterparty } : {}),
          ...(rolled.decidedDate ? { signedOn: rolled.decidedDate } : {}),
        };
        break;
      }
    }

    // Skip a write that would change nothing, so the count means something.
    if (
      existing &&
      existing.status === payload.status &&
      toNumber(existing.acceptedQty ?? existing.qtyAccepted ?? existing.dispatchQty) ===
        rolled.acceptedQty
    ) {
      continue;
    }

    batch.set(doc(db, "projects", globalProjectId, GATE_COLLECTION[stage], boqItemId), payload, {
      merge: true,
    });
    written += 1;
  }

  if (written > 0) await batch.commit();
  return written;
}

/** Recomputes a stage's guard documents from its items. Derived data, always rebuildable. */
export async function rebuildSupplyBalances(
  globalProjectId: string,
  stage: SupplyLedgerStage,
): Promise<number> {
  const chain = await loadSupplyChain(globalProjectId);
  const state = chain.stages[stage];
  const definition = supplyStage(stage);
  const batch = writeBatch(db);
  let written = 0;

  for (const line of state.poLines) {
    const ledger = state.ledgers.get(supplyPoLineKey(line.poId, line.poLineId));
    if (!ledger) continue;
    batch.set(
      doc(
        db,
        "projects",
        globalProjectId,
        definition.balanceCollection,
        mcPoLineBalanceId(line.poId, line.poLineId),
      ),
      {
        poId: ledger.poId,
        poLineId: ledger.poLineId,
        poNumber: ledger.poNumber,
        upstreamQty: ledger.upstreamQty,
        acceptedQty: ledger.acceptedQty,
        inFlightQty: ledger.inFlightQty,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    written += 1;
  }

  await batch.commit();
  return written;
}

/** `upstreamQty` per line key for a stage, as `createSupplyDoc` needs it. */
export const upstreamQtyByLineKey = (state: SupplyStageState): Map<string, number> =>
  new Map(
    state.poLines.map((line) => [
      supplyPoLineKey(line.poId, line.poLineId),
      Math.max(0, toNumber(line.upstreamQty)),
    ]),
  );
