"use client";

/**
 * Loads the registers behind `calculateProjectControlTower` and returns the computed summary.
 *
 * Lifted out of project-control-tower.tsx so the module landing page and the Reports tower read
 * the same fifteen registers through one implementation — two copies of this list would drift the
 * moment a gate is added, and the figures on the two screens would quietly disagree.
 *
 * It is a wide read (one getDocs per register), so callers should render their structure first and
 * let the figures arrive, rather than holding the whole page on a skeleton.
 */

import { useCallback, useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  calculateProjectControlTower,
  type ProjectControlTowerSummary,
} from "@/lib/project-management-dashboard";
import {
  JMC_ENTRY_COLLECTION,
  SUBCONTRACTOR_BILL_COLLECTION,
  WORK_ORDER_COLLECTION,
} from "@/lib/civil-execution";
import { WORK_PACKAGE_COLLECTION } from "@/lib/project-management-work-packages";
import { MDL_COLLECTION } from "@/lib/mdl";
import { PO_COLLECTION } from "@/lib/purchase-orders";
import { RFQ_COLLECTION } from "@/lib/rfq";
import {
  DI_COLLECTION,
  GRN_COLLECTION,
  INSPECTION_COLLECTION,
  MC_COLLECTION,
  MDCC_COLLECTION,
  MVAC_COLLECTION,
} from "@/lib/supply-gates";

export interface ControlTowerMapping {
  id: string;
  projectName: string;
  globalProjectId: string;
  endDate?: string;
}

export interface ControlTowerState {
  summary: ProjectControlTowerSummary | null;
  isLoading: boolean;
  error: string;
  reload: () => Promise<void>;
}

export function useControlTowerSummary(
  mapping: ControlTowerMapping | null,
  enabled = true,
): ControlTowerState {
  const [summary, setSummary] = useState<ProjectControlTowerSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const globalProjectId = mapping?.globalProjectId ?? "";
  const endDate = mapping?.endDate;

  const reload = useCallback(async () => {
    if (!globalProjectId) return;
    setIsLoading(true);
    setError("");
    try {
      const projectPath = ["projects", globalProjectId] as const;
      const [
        boqSnapshot,
        indentSnapshot,
        rfqSnapshot,
        poSnapshot,
        mdlSnapshot,
        mcSnapshot,
        inspectionSnapshot,
        mdccSnapshot,
        diSnapshot,
        grnSnapshot,
        mvacSnapshot,
        workOrderSnapshot,
        jmcEntrySnapshot,
        subBillSnapshot,
        workPackageSnapshot,
        settingsSnapshot,
      ] = await Promise.all([
        getDocs(collection(db, ...projectPath, "boqItems")),
        getDocs(collection(db, ...projectPath, "indents")),
        getDocs(collection(db, ...projectPath, RFQ_COLLECTION)),
        getDocs(collection(db, ...projectPath, PO_COLLECTION)),
        getDocs(collection(db, ...projectPath, MDL_COLLECTION)),
        getDocs(collection(db, ...projectPath, MC_COLLECTION)),
        getDocs(collection(db, ...projectPath, INSPECTION_COLLECTION)),
        getDocs(collection(db, ...projectPath, MDCC_COLLECTION)),
        getDocs(collection(db, ...projectPath, DI_COLLECTION)),
        getDocs(collection(db, ...projectPath, GRN_COLLECTION)),
        getDocs(collection(db, ...projectPath, MVAC_COLLECTION)),
        // The project's civil registers (Subcontractors Management work orders and bills, the
        // project JMC register) — read-only join. Billing Recon's MVAC entries are not read.
        getDocs(collection(db, ...projectPath, WORK_ORDER_COLLECTION)),
        getDocs(collection(db, ...projectPath, JMC_ENTRY_COLLECTION)),
        getDocs(collection(db, ...projectPath, SUBCONTRACTOR_BILL_COLLECTION)),
        // Erection has no other register to measure progress by.
        getDocs(collection(db, ...projectPath, WORK_PACKAGE_COLLECTION)),
        getDoc(doc(db, "projectManagementSettings", "general")),
      ]);

      const records = (snapshot: typeof boqSnapshot) =>
        snapshot.docs.map((record) => ({ id: record.id, ...record.data() }));
      const settings = settingsSnapshot.data();
      const numberSetting = (key: string) =>
        typeof settings?.[key] === "number" ? (settings[key] as number) : undefined;

      setSummary(
        calculateProjectControlTower({
          boqItems: records(boqSnapshot),
          indents: records(indentSnapshot),
          rfqs: records(rfqSnapshot),
          purchaseOrders: records(poSnapshot),
          mdlDrawings: records(mdlSnapshot),
          manufacturingClearances: records(mcSnapshot),
          inspections: records(inspectionSnapshot),
          mdccRecords: records(mdccSnapshot),
          dispatchInstructions: records(diSnapshot),
          grns: records(grnSnapshot),
          mvacRecords: records(mvacSnapshot),
          workOrders: records(workOrderSnapshot),
          jmcEntries: records(jmcEntrySnapshot),
          subcontractorBills: records(subBillSnapshot),
          workPackages: records(workPackageSnapshot),
          leadTimeDays: numberSetting("leadTimeDays"),
          tolerancePct: numberSetting("variationTolerancePct"),
          stallDays: numberSetting("stallDays"),
          projectEndDate: endDate,
        }),
      );
    } catch (loadError) {
      console.error("Failed to load the Project Management control tower:", loadError);
      setError(
        "The live project summary could not be loaded. Your underlying registers are unchanged.",
      );
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId, endDate]);

  useEffect(() => {
    if (!enabled || !globalProjectId) return;
    // The fetch sets its own loading flag as it starts; that is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [enabled, globalProjectId, reload]);

  return {
    summary,
    // Nothing is loading when there is no project to load for, or the caller has it switched off.
    isLoading: isLoading && enabled && Boolean(globalProjectId),
    error,
    reload,
  };
}
