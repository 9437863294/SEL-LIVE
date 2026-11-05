/**
 * Builds one `SupplyChainLine` per committed purchase-order line, with every gate's accepted,
 * in-flight and rejected quantity joined onto it.
 *
 * Lifted out of the Supply reports page so the Supply hub reads the same pipeline through the same
 * code — two copies of this join would drift the moment a gate changed, and the hub's funnel would
 * quietly stop agreeing with the reports it links to.
 *
 * It reads only through the workspaces the working screens already use (`loadSupplyChain`,
 * `loadMcWorkspace`, `loadInspectionWorkspace`) plus the purchase orders themselves, so it never
 * touches a collection the module does not already own.
 */

import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  PO_COLLECTION,
  resolvePoLineId,
  toNumber,
  type PurchaseOrder,
} from "@/lib/purchase-orders";
import { supplyPoLineKey } from "@/lib/project-management-supply-ledger";
import { loadSupplyChain } from "@/lib/project-management-supply-service";
import { loadMcWorkspace } from "@/lib/project-management-mc-service";
import { loadInspectionWorkspace } from "@/lib/project-management-inspection-service";
import {
  SUPPLY_CHAIN_GATES,
  type SupplyChainGate,
  type SupplyChainLine,
} from "@/lib/project-management-supply-analytics";

export async function loadSupplyChainLines(globalProjectId: string): Promise<SupplyChainLine[]> {
  const [poSnapshot, chain, mc, inspection] = await Promise.all([
    getDocs(collection(db, "projects", globalProjectId, PO_COLLECTION)),
    loadSupplyChain(globalProjectId),
    loadMcWorkspace(globalProjectId),
    loadInspectionWorkspace(globalProjectId),
  ]);

  const purchaseOrders = poSnapshot.docs.map(
    (entry) => ({ id: entry.id, ...entry.data() }) as PurchaseOrder,
  );

  /* ---- index the gate registers by PO line ---- */

  // MC and Inspection each keep their own ledger keyed the same way as the supply ledger.
  const mcLedgers = mc.ledgers;
  const inspectionLedgers = inspection.ledgers;

  // Earliest accepted date and oldest open date per line, per gate, read from the documents
  // themselves — the ledgers carry quantities but not when they happened.
  const firstAccepted = new Map<string, Partial<Record<SupplyChainGate, string>>>();
  const oldestOpen = new Map<string, Partial<Record<SupplyChainGate, string>>>();

  const noteAccepted = (key: string, gate: SupplyChainGate, date?: string) => {
    if (!date) return;
    const entry = firstAccepted.get(key) ?? {};
    if (!entry[gate] || date < entry[gate]!) entry[gate] = date;
    firstAccepted.set(key, entry);
  };
  const noteOpen = (key: string, gate: SupplyChainGate, date?: string) => {
    if (!date) return;
    const entry = oldestOpen.get(key) ?? {};
    if (!entry[gate] || date < entry[gate]!) entry[gate] = date;
    oldestOpen.set(key, entry);
  };

  // MC documents.
  const mcHeaderById = new Map(mc.headers.map((header) => [header.id, header]));
  for (const item of mc.items) {
    const header = mcHeaderById.get(item.mcId);
    if (!header || header.status === "Cancelled") continue;
    const key = supplyPoLineKey(item.poId, item.poLineId);
    if (item.status === "Approved") noteAccepted(key, "mc", header.mcDate);
    else if (header.status === "Submitted" || header.status === "Partially Approved") {
      noteOpen(key, "mc", header.mcDate);
    }
  }

  // Inspection calls.
  const callById = new Map(inspection.calls.map((call) => [call.id, call]));
  for (const item of inspection.items) {
    const call = callById.get(item.callId);
    if (!call || call.status === "Cancelled") continue;
    const key = supplyPoLineKey(item.poId, item.poLineId);
    if (item.status === "Passed" || item.status === "Passed with Punch Items") {
      noteAccepted(key, "inspection", call.inspectionDate ?? call.callDate);
    } else if (item.status === "Pending") {
      noteOpen(key, "inspection", call.callDate);
    }
  }

  // The four ledger stages.
  const blockingByLine = new Map<string, number>();
  const shortByLine = new Map<string, number>();
  const damagedByLine = new Map<string, number>();
  for (const stage of SUPPLY_CHAIN_GATES) {
    if (stage === "ordered" || stage === "mc" || stage === "inspection") continue;
    const state = chain.stages[stage];
    if (!state) continue;
    const docById = new Map(state.docs.map((entry) => [entry.id, entry]));
    for (const item of state.items) {
      const parent = docById.get(item.docId);
      if (!parent || parent.status === "Cancelled") continue;
      const key = supplyPoLineKey(item.poId, item.poLineId);
      if (item.status === "Accepted") {
        noteAccepted(key, stage, parent.decidedDate ?? parent.docDate);
      } else if (item.status === "Pending" && parent.status !== "Draft") {
        noteOpen(key, stage, parent.docDate);
      }
      if (stage === "grn") {
        shortByLine.set(key, (shortByLine.get(key) ?? 0) + toNumber(item.shortQty));
        damagedByLine.set(key, (damagedByLine.get(key) ?? 0) + toNumber(item.damagedQty));
      }
      const open = (item.observations ?? []).filter(
        (observation) =>
          !observation.closed &&
          (observation.severity === "Critical" || observation.severity === "Major"),
      ).length;
      if (open) blockingByLine.set(key, (blockingByLine.get(key) ?? 0) + open);
    }
  }

  /* ---- one row per PO line ---- */

  const built: SupplyChainLine[] = [];
  for (const po of purchaseOrders) {
    // Only committed POs represent real supply; drafts and cancellations are not a pipeline.
    if (!["Issued", "Received"].includes(String(po.status ?? ""))) continue;
    (po.items ?? []).forEach((item, index) => {
      const poLineId = resolvePoLineId(item, index);
      const key = supplyPoLineKey(po.id, poLineId);
      const mcLedger = mcLedgers.get(key);
      const inspectionLedger = inspectionLedgers.get(key);

      const acceptedQtyByGate: Partial<Record<SupplyChainGate, number>> = {};
      const inFlightQtyByGate: Partial<Record<SupplyChainGate, number>> = {};
      const rejectedQtyByGate: Partial<Record<SupplyChainGate, number>> = {};

      if (mcLedger) {
        acceptedQtyByGate.mc = mcLedger.approvedQty;
        inFlightQtyByGate.mc = mcLedger.reservedQty;
      }
      if (inspectionLedger) {
        acceptedQtyByGate.inspection = inspectionLedger.acceptedQty;
        inFlightQtyByGate.inspection = inspectionLedger.offeredPendingQty;
        rejectedQtyByGate.inspection = inspectionLedger.rejectedQty;
      }
      for (const stage of ["mdcc", "di", "grn", "mvac"] as const) {
        const ledger = chain.stages[stage]?.ledgers.get(key);
        if (!ledger) continue;
        acceptedQtyByGate[stage] = ledger.acceptedQty;
        inFlightQtyByGate[stage] = ledger.inFlightQty;
        rejectedQtyByGate[stage] = ledger.rejectedQty;
      }

      built.push({
        poId: po.id,
        poNumber: po.poNumber,
        poLineId,
        boqItemId: item.boqItemId,
        boqSlNo: item.boqItemId ? chain.boqSlNoByBoqItemId.get(item.boqItemId) : undefined,
        itemDescription: item.description,
        unit: item.unit,
        vendorId: po.vendorId,
        vendorName: po.vendorName,
        rate: toNumber(item.rate),
        orderedQty: toNumber(item.qty),
        cancelledQty: toNumber(item.cancelledQty),
        acceptedQtyByGate,
        inFlightQtyByGate,
        rejectedQtyByGate,
        firstAcceptedDateByGate: firstAccepted.get(key),
        oldestOpenDateByGate: oldestOpen.get(key),
        poDate: po.poDate,
        poEndDate: po.endDate,
        blockingObservationCount: blockingByLine.get(key) ?? 0,
        shortQty: shortByLine.get(key) ?? 0,
        damagedQty: damagedByLine.get(key) ?? 0,
      });
    });
  }

  return built;
}
