"use client";

/**
 * Raising an MVAC.
 *
 * MVAC no longer shares the create form of MDCC, DI and GRN. Those three present a vendor's order
 * book for clearance, dispatch or receipt; MVAC is the joint acceptance of what is already lying
 * at site, which crosses vendors — so the form is Create JMC's shape, and the item picker offers
 * what a GRN has accepted rather than a vendor's purchase-order lines.
 *
 * This file owns the data, the permission, the validation and the save; `MvacCreateView` is the
 * screen.
 *
 * Raising a certificate also starts the configured workflow, the way JMC does — first step, its
 * assignees, its deadline. Where no workflow is configured the certificate simply opens on the
 * register, which is how MVAC has always worked and must keep working.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Timestamp } from "firebase/firestore";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { calculateDeadline, getAssigneeForStep } from "@/lib/workflow-utils";
import { useSupplyProject } from "@/components/project-management/supply-document-screens";
import { useMvacRegister } from "@/components/mvac/mvac-shell";
import { MvacCreateView, type MvacFormRow } from "@/components/mvac/mvac-create-view";
import { PM_MVAC_PERMISSION_RESOURCE, mvacTabHref } from "@/lib/project-management-mvac-module";
import {
  supplyPoLineKey,
  supplyStage,
  validatePresentedQty,
  type SupplyLedger,
} from "@/lib/project-management-supply-ledger";
import {
  SUPPLY_BALANCE_CONFLICT,
  createSupplyDoc,
  loadSupplyChain,
  upstreamQtyByLineKey,
  type SupplyChain,
  type SupplyDraftLine,
} from "@/lib/project-management-supply-service";
import {
  buildMvacCandidates,
  mvacGrnSourcesByLine,
  type MvacCandidateLine,
} from "@/lib/project-management-mvac-dashboard";
import type { ActionLog } from "@/lib/types";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const blankRow = (id: string): MvacFormRow => ({ id, lineKey: "", qty: "" });

export default function NewMvacPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { globalProjectId, projectName } = useSupplyProject(mappingId);
  const { workflow, steps, reload } = useMvacRegister();
  const back = useBackNavigation(mvacTabHref("documents", mappingId), {
    fallbackLabel: "Back to the MVAC register",
  });

  const definition = supplyStage("mvac");
  const canView = !isAuthLoading && can("View", PM_MVAC_PERMISSION_RESOURCE);
  const canRaise = !isAuthLoading && can(definition.raiseAction, PM_MVAC_PERMISSION_RESOURCE);

  const [chain, setChain] = useState<SupplyChain | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [docDate, setDocDate] = useState(today());
  const [counterparty, setCounterparty] = useState("");
  const [remarks, setRemarks] = useState("");

  /* The register starts with one empty row, as Create JMC does: a form with no rows reads as a
     screen that has not finished loading. */
  const nextRowId = useRef(1);
  const makeRowId = () => `row-${nextRowId.current++}`;
  const [rows, setRows] = useState<MvacFormRow[]>([blankRow("row-0")]);

  const loadData = useCallback(async () => {
    if (!globalProjectId || !canView) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      setChain(await loadSupplyChain(globalProjectId));
    } catch (error) {
      console.error("Failed to load what is available for joint acceptance:", error);
      setLoadError("What is available for joint acceptance could not be read. Reload to try again.");
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId, canView]);

  useEffect(() => {
    if (isAuthLoading) return;
    // Reading the chain once the project resolves is what an effect is for — synchronising React
    // with an external system; `loadData` owns its own loading flag, including turning it off
    // when there is nothing to read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [isAuthLoading, loadData]);

  const state = chain?.stages.mvac ?? null;

  /** Every received line with balance left, with the GRNs behind it. */
  const candidates: MvacCandidateLine[] = useMemo(() => {
    if (!chain || !state) return [];
    const grnSources = mvacGrnSourcesByLine(chain.stages.grn.items, chain.stages.grn.docs);
    const boqItemIdByLineKey = new Map<string, string | undefined>(
      state.poLines.map((line) => [supplyPoLineKey(line.poId, line.poLineId), line.boqItemId]),
    );
    return buildMvacCandidates({
      ledgers: [...state.ledgers.values()],
      grnSources,
      vendorByPoId: chain.vendorByPoId,
      boqItemIdByLineKey,
    });
  }, [chain, state]);

  const ledgerByKey = useMemo(
    () => new Map<string, SupplyLedger>(state ? [...state.ledgers.entries()] : []),
    [state],
  );

  /**
   * Why each typed quantity is refused — the ledger's own rule, not a second one.
   *
   * A line can only be on the form once (both pickers leave out what is already taken), so each
   * row is checked on its own and two rows cannot quietly add up past the balance.
   */
  const errorByRowId = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (!row.lineKey || row.qty === "") continue;
      const qty = Number(row.qty);
      if (!Number.isFinite(qty)) {
        out[row.id] = "That is not a quantity.";
        continue;
      }
      const ledger = ledgerByKey.get(row.lineKey);
      if (!ledger) continue;
      const check = validatePresentedQty("mvac", qty, ledger);
      if (!check.ok) out[row.id] = check.message ?? "This quantity cannot be presented.";
    }
    return out;
  }, [rows, ledgerByKey]);

  /* ── The form's own handlers ──────────────────────────────────────────────────────────────── */

  const handleAddRow = () => setRows((current) => [...current, blankRow(makeRowId())]);

  const handleRemoveRow = (rowId: string) =>
    setRows((current) => {
      const next = current.filter((row) => row.id !== rowId);
      // Never leave the register with no rows at all: an empty table reads as a broken screen.
      return next.length > 0 ? next : [blankRow(makeRowId())];
    });

  /** Picking an item fills the row's quantity with what is available — full acceptance is the
   *  common case, and it is the figure the person is agreeing to or cutting down. */
  const handlePickItem = (rowId: string, line: MvacCandidateLine | null) =>
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              lineKey: line?.key ?? "",
              qty: line ? String(line.availableQty) : "",
            }
          : row,
      ),
    );

  const handleQtyChange = (rowId: string, value: string) =>
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, qty: value } : row)));

  const handleAddMany = (lines: readonly MvacCandidateLine[]) =>
    setRows((current) => {
      const added = lines.map((line) => ({
        id: makeRowId(),
        lineKey: line.key,
        qty: String(line.availableQty),
      }));
      // The blank starter row is replaced rather than left above the items just added.
      const kept = current.filter((row) => row.lineKey !== "");
      return [...kept, ...added];
    });

  /* ── Saving ───────────────────────────────────────────────────────────────────────────────── */

  const handleSave = async (submit: boolean) => {
    if (!globalProjectId || !user || !state) return;

    const byKey = new Map(candidates.map((line) => [line.key, line]));
    const chosen = rows
      .map((row) => ({ row, line: row.lineKey ? byKey.get(row.lineKey) : undefined }))
      .filter((entry): entry is { row: MvacFormRow; line: MvacCandidateLine } =>
        Boolean(entry.line && entry.row.qty !== "" && Number(entry.row.qty) > 0),
      );

    if (!chosen.length) {
      toast({
        title: "Nothing on the certificate yet",
        description: "Add an item from GRN and say how much is accepted.",
        variant: "destructive",
      });
      return;
    }
    if (Object.keys(errorByRowId).length) {
      toast({
        title: "Fix the highlighted quantities first",
        description: Object.values(errorByRowId)[0],
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const lines: SupplyDraftLine[] = chosen.map(({ row, line }) => ({
        poId: line.poId,
        poNumber: line.poNumber,
        poLineId: line.poLineId,
        boqItemId: line.boqItemId,
        itemDescription: line.itemDescription,
        unit: line.unit,
        presentedQty: Number(row.qty),
      }));
      const totalQty = lines.reduce((sum, line) => sum + line.presentedQty, 0);

      /*
       * One certificate can now cover several vendors, so the header names the vendor only when
       * there is genuinely one. Where there are more, the register says so and the vendors are
       * recorded on the document rather than silently dropped.
       */
      const vendorNames = [...new Set(chosen.map(({ line }) => line.vendorName))].sort();
      const singleVendorPoId = vendorNames.length === 1 ? chosen[0].line.poId : "";
      const meta = vendorNames.length > 1 ? { vendors: vendorNames.join(", ") } : undefined;

      /* The configured run, where there is one: raised already sitting at its first desk. */
      let docFields: Record<string, unknown> | undefined;
      if (submit && workflow.length > 0) {
        const firstStep = workflow[0];
        const assignees = await getAssigneeForStep(firstStep, {
          projectId: globalProjectId,
          amount: totalQty,
        } as never);
        if (!assignees || assignees.length === 0) {
          throw new Error(
            `No one is assigned to ${firstStep.name}. Set its assignees in Settings › Workflow Configuration.`,
          );
        }
        const deadline = await calculateDeadline(new Date(), firstStep.tat);
        const created: ActionLog = {
          action: "Created",
          comment: remarks.trim() || "MVAC raised for joint acceptance.",
          userId: user.id,
          userName: user.name,
          timestamp: Timestamp.now(),
          stepName: "Creation",
        };
        docFields = {
          workflowStepId: firstStep.id,
          workflowStage: firstStep.name,
          workflowStatus: "In Progress",
          assignees,
          deadline: Timestamp.fromDate(deadline),
          history: [created],
        };
      }

      const { docNumber } = await createSupplyDoc({
        globalProjectId,
        stage: "mvac",
        vendorId: singleVendorPoId
          ? (chain?.vendorByPoId.get(singleVendorPoId)?.vendorId ?? undefined)
          : undefined,
        vendorName: vendorNames.length === 1 ? vendorNames[0] : "Several vendors",
        docDate,
        counterparty,
        meta,
        remarks,
        lines,
        upstreamQtyByLineKey: upstreamQtyByLineKey(state),
        submit,
        actor: { id: user.id, name: user.name },
        docFields,
      });

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: submit ? "Raise MVAC" : "Create MVAC Draft",
        details: {
          project: projectName,
          docNumber,
          lines: lines.length,
          presentedQty: totalQty,
          vendors: vendorNames,
          purchaseOrders: [...new Set(lines.map((line) => line.poNumber))],
        },
        recordRef: docNumber,
      });

      toast({
        title: submit ? `${docNumber} raised` : `${docNumber} saved as draft`,
        description: submit
          ? `${totalQty} on ${lines.length} line${lines.length === 1 ? "" : "s"}${
              docFields ? `, now with ${String(docFields.workflowStage)}.` : "."
            }`
          : "A draft holds no quantity until it is raised.",
      });
      void reload();
      router.push(mvacTabHref("documents", mappingId));
    } catch (error) {
      console.error("Failed to raise the joint acceptance:", error);
      const message = error instanceof Error ? error.message : "Please try again.";
      toast({
        title: message.includes(SUPPLY_BALANCE_CONFLICT)
          ? "Available balance changed"
          : "Unable to raise the certificate",
        description: message.replace(`${SUPPLY_BALANCE_CONFLICT}: `, ""),
        variant: "destructive",
      });
      if (message.includes(SUPPLY_BALANCE_CONFLICT)) void loadData();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <MvacCreateView
      back={back}
      crumbs={[{ label: "MVAC", href: mvacTabHref("", mappingId) }, { label: "New" }]}
      projectName={projectName}
      steps={steps}
      candidates={candidates}
      rows={rows}
      onAddRow={handleAddRow}
      onRemoveRow={handleRemoveRow}
      onPickItem={handlePickItem}
      onQtyChange={handleQtyChange}
      onAddMany={handleAddMany}
      errorByRowId={errorByRowId}
      docDate={docDate}
      onDocDateChange={setDocDate}
      counterparty={counterparty}
      onCounterpartyChange={setCounterparty}
      remarks={remarks}
      onRemarksChange={setRemarks}
      canRaise={canRaise}
      isLoading={isLoading || isAuthLoading}
      isSaving={isSaving}
      onSave={(submit) => void handleSave(submit)}
      loadError={loadError}
    />
  );
}
