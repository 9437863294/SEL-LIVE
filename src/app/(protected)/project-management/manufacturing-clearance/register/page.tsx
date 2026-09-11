"use client";

"use client";

/**
 * The per-BOQ-item manufacturing clearance gate register.
 *
 * Distinct from MC Documents, which is the quantity-driven record: an MC document clears a
 * quantity against a PO *line*, while this register answers the boolean question the downstream
 * chain asks — is this BOQ item's gate open, so inspection may be requested? `canRequestInspection`
 * in supply-gates.ts, `boq-traceability` and five other screens read exactly that.
 *
 * The two are kept in step by `syncMcGateRecords`, which projects approved quantity onto this
 * status. So the Cleared quantity columns here are read from the same ledger the documents screen
 * uses; if they ever disagree with the status, the projection has drifted and Sync gates repairs
 * it. Showing the quantity alongside the status is what makes that visible instead of mysterious.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Factory,
  FileStack,
  Layers,
  Loader2,
  PenLine,
  RotateCcw,
  Settings,
  XCircle,
} from "lucide-react";
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BoqItem } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import type { WorkflowStep } from "@/lib/types";
import { getAssigneeForStep, calculateDeadline } from "@/lib/workflow-utils";
import { requestMcClearance } from "@/lib/project-management-mc-entries";
import {
  DEFAULT_MC_CLEARANCE_STEPS,
  MC_CLEARANCE_APPROVAL_COLLECTION,
  MC_CLEARANCE_WORKFLOW_DOC_ID,
  mcApprovalStatusStyles,
  mcClearanceRequiresApproval,
  openMcRequestForBoqItem,
  type McClearanceApproval,
} from "@/lib/project-management-mc-workflow";
import { useProjectManagementMcContext } from "@/components/mc/use-mc-host-context";
import {
  McAccessDenied,
  McLoadingState,
  McProjectNotFound,
} from "@/components/mc/mc-page-shell";
import {
  PM_TABLE_CLASS,
  PmContent,
  PmSectionHead,
  PmShell,
  PmSidebar,
  PmTableFoot,
  PmTopbar,
  pmAccent,
} from "@/components/project-management/pm-shell";
import { poLineKey } from "@/lib/project-management-mc-quantity";
import {
  loadMcWorkspace,
  syncMcGateRecords,
  type McWorkspace,
} from "@/lib/project-management-mc-service";
import { PO_COLLECTION, formatQuantity, type PurchaseOrder } from "@/lib/purchase-orders";
import { MDL_COLLECTION, isMdlApproved, mdlOverallStatusStyles, type MdlOverallStatus } from "@/lib/mdl";
import {
  MC_COLLECTION,
  MC_PERMISSION_RESOURCE,
  buildPoPlacedItems,
  formatGateDate,
  mcStatusStyles,
  type ManufacturingClearance,
  type McStatus,
  type PoPlacedItem,
} from "@/lib/supply-gates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

const getBoqSlNo = (item: BoqItem) => String(item["BOQ SL No"] ?? item["SL. No."] ?? "");

/** Register views. Each is a queue somebody actually works from. */
const VIEWS = [
  { key: "all", label: "All items", icon: Layers },
  { key: "pending", label: "Gate closed", icon: CircleDashed },
  { key: "awaiting-drawing", label: "Awaiting drawing", icon: PenLine },
  { key: "cleared", label: "Gate open", icon: CheckCircle2 },
  { key: "rejected", label: "Rejected", icon: Ban },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export default function ManufacturingClearanceRegisterPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mappingId = searchParams?.get("project") ?? "";
  const view = (searchParams?.get("view") ?? "all") as ViewKey;
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound } = useProjectManagementMcContext(mappingId);

  const canView = can("View", MC_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canClear = can("Clear", MC_PERMISSION_RESOURCE);
  const canReject = can("Reject", MC_PERMISSION_RESOURCE);
  const canAct = canClear || canReject;

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [placedItems, setPlacedItems] = useState<Map<string, PoPlacedItem>>(new Map());
  const [clearances, setClearances] = useState<Map<string, ManufacturingClearance>>(new Map());
  const [mdlRequiredBoqItemIds, setMdlRequiredBoqItemIds] = useState<Set<string>>(new Set());
  const [mdlStatusByBoqItemId, setMdlStatusByBoqItemId] = useState<Map<string, MdlOverallStatus>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  /** The quantity ledger, so the gate status can be shown against the quantity behind it. */
  const [workspace, setWorkspace] = useState<McWorkspace | null>(null);
  /** Clearance approval stages, if this project has configured any. */
  const [clearanceSteps, setClearanceSteps] = useState<WorkflowStep[]>([]);
  const [clearanceApprovals, setClearanceApprovals] = useState<McClearanceApproval[]>([]);

  const requiresClearanceApproval = mcClearanceRequiresApproval(clearanceSteps);

  const [activeItem, setActiveItem] = useState<PoPlacedItem | null>(null);
  const [decisionStatus, setDecisionStatus] = useState<McStatus>("Cleared");
  const [decisionDate, setDecisionDate] = useState(today());
  const [decisionRemarks, setDecisionRemarks] = useState("");

  const loadData = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) {
        setMapping(null);
        return;
      }
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      setMapping(mappingData);

      const [poSnapshot, boqSnapshot, mcSnapshot, mdlSnapshot, workflowSnapshot, approvalSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, MC_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, MDL_COLLECTION)),
        getDoc(doc(db, "workflows", MC_CLEARANCE_WORKFLOW_DOC_ID)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, MC_CLEARANCE_APPROVAL_COLLECTION)),
      ]);

      const rawSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : DEFAULT_MC_CLEARANCE_STEPS;
      setClearanceSteps(
        (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) })),
      );
      setClearanceApprovals(
        approvalSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as McClearanceApproval),
      );

      const purchaseOrders = poSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as PurchaseOrder);
      const placed = buildPoPlacedItems(purchaseOrders);
      const boqSlNoByBoqItemId = new Map(
        boqSnapshot.docs.map((item) => [item.id, getBoqSlNo({ id: item.id, ...item.data() } as BoqItem)]),
      );
      placed.forEach((item, boqItemId) => {
        item.boqSlNo = boqSlNoByBoqItemId.get(boqItemId) ?? "";
      });
      setPlacedItems(placed);

      setClearances(
        new Map(
          mcSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as ManufacturingClearance]),
        ),
      );

      // Manufacturing can only be cleared once the item's drawing (if MDL-tracked) has actually
      // been approved — see mdl.ts's isMdlApproved. Previously this status was purely display-only.
      setMdlRequiredBoqItemIds(
        new Set(
          boqSnapshot.docs
            .filter((item) => String((item.data() as Record<string, unknown>).MDL ?? "").trim().toLowerCase() === "yes")
            .map((item) => item.id),
        ),
      );
      setMdlStatusByBoqItemId(
        new Map(mdlSnapshot.docs.map((item) => [item.id, (item.data() as { status?: MdlOverallStatus }).status ?? "Pending"])),
      );

      // Loaded after the gate data so a failure here degrades to the register working without
      // its quantity columns, rather than the whole screen failing.
      setWorkspace(await loadMcWorkspace(mappingData.globalProjectId));
    } catch (error) {
      console.error("Failed to load manufacturing clearance data:", error);
      toast({ title: "Unable to load manufacturing clearance data", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, toast]);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  /**
   * Approved and available MC quantity per BOQ item, summed across its PO lines.
   *
   * A BOQ item can sit on more than one PO line, and this register is keyed on the item, so the
   * lines are summed. Returns undefined when the ledger has not loaded — which the table renders
   * blank rather than as zero, because "not loaded" and "nothing cleared" mean opposite things.
   */
  const qtyByBoqItemId = useMemo(() => {
    if (!workspace) return null;
    const map = new Map<string, { approvedQty: number; availableQty: number; orderedQty: number }>();
    for (const line of workspace.poLines) {
      if (!line.boqItemId) continue;
      const ledger = workspace.ledgers.get(poLineKey(line.poId, line.poLineId));
      if (!ledger) continue;
      const entry = map.get(line.boqItemId) ?? { approvedQty: 0, availableQty: 0, orderedQty: 0 };
      entry.approvedQty += ledger.approvedQty;
      entry.availableQty += ledger.availableQty;
      entry.orderedQty += ledger.effectiveQty;
      map.set(line.boqItemId, entry);
    }
    return map;
  }, [workspace]);

  const allRows = useMemo(
    () =>
      Array.from(placedItems.values()).sort((a, b) => a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true })),
    [placedItems],
  );

  const matchesView = useCallback(
    (item: PoPlacedItem, key: ViewKey) => {
      if (key === "all") return true;
      const status = clearances.get(item.boqItemId)?.status ?? "Pending";
      const mdlRequired = mdlRequiredBoqItemIds.has(item.boqItemId);
      const mdlStatus = mdlStatusByBoqItemId.get(item.boqItemId) ?? "Pending";
      const mdlBlocking = mdlRequired && !isMdlApproved(mdlStatus);

      if (key === "awaiting-drawing") return mdlBlocking && status !== "Cleared";
      if (key === "cleared") return status === "Cleared";
      if (key === "rejected") return status === "Rejected";
      // Gate closed: not cleared, not rejected, and not held up by a drawing — i.e. actionable.
      return status === "Pending" && !mdlBlocking;
    },
    [clearances, mdlRequiredBoqItemIds, mdlStatusByBoqItemId],
  );

  const rows = useMemo(() => allRows.filter((item) => matchesView(item, view)), [allRows, matchesView, view]);
  const countFor = useCallback(
    (key: ViewKey) => allRows.filter((item) => matchesView(item, key)).length,
    [allRows, matchesView],
  );

  const setView = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "all") params.delete("view");
    else params.set("view", value);
    const path = context.mcHref("register").split("?")[0];
    const query = params.toString();
    router.replace(query ? `${path}?${query}` : path);
  };

  const handleSyncGates = async () => {
    if (!mapping) return;
    setIsSyncing(true);
    try {
      const written = await syncMcGateRecords(mapping.globalProjectId);
      toast({
        title: written ? "Gates brought in line" : "Gates already in line",
        description: written
          ? `${written} item gate${written === 1 ? "" : "s"} updated from the approved MC quantity.`
          : "Every item gate already matches the approved MC quantity.",
      });
      await loadData();
    } catch (error) {
      console.error("Failed to sync the manufacturing clearance gates:", error);
      toast({ title: "Unable to sync item gates", variant: "destructive" });
    } finally {
      setIsSyncing(false);
    }
  };

  const openDecision = (item: PoPlacedItem, status: McStatus) => {
    setActiveItem(item);
    setDecisionStatus(status);
    const existing = clearances.get(item.boqItemId);
    setDecisionDate(existing?.clearedDate || today());
    setDecisionRemarks(existing?.remarks ?? "");
  };

  const handleSaveDecision = async () => {
    if (!mapping || !user || !activeItem) return;
    if (decisionStatus === "Cleared") {
      const mdlRequired = mdlRequiredBoqItemIds.has(activeItem.boqItemId);
      const mdlStatus = mdlStatusByBoqItemId.get(activeItem.boqItemId) ?? "Pending";
      if (mdlRequired && !isMdlApproved(mdlStatus)) {
        toast({
          title: "Drawing not yet approved",
          description: "This item's MDL drawing must be Approved (or Approved with Comments) before manufacturing can be cleared.",
          variant: "destructive",
        });
        return;
      }
    }
    setIsSaving(true);
    try {
      // Clearing opens the gate, so it routes through approval when one is configured. Rejecting
      // does not: it holds the gate shut and lets nothing proceed, so requiring sign-off to say
      // "no" would add friction without adding control.
      if (decisionStatus === "Cleared") {
        const result = await requestMcClearance({
          globalProjectId: mapping.globalProjectId,
          mappingId,
          item: {
            boqItemId: activeItem.boqItemId,
            boqSlNo: activeItem.boqSlNo,
            description: activeItem.description,
            poId: activeItem.poId,
            poNumber: activeItem.poNumber,
            vendorName: activeItem.vendorName,
          },
          clearedDate: decisionDate,
          remarks: decisionRemarks.trim(),
          steps: clearanceSteps,
          requestedBy: { id: user.id, name: user.name },
          resolveAssignees: (step) =>
            getAssigneeForStep(step, {
              projectId: mapping.globalProjectId,
              departmentId: "",
              amount: 0,
            }),
          resolveDeadline: async (step) => {
            try {
              return await calculateDeadline(new Date(), step.tat);
            } catch {
              return null;
            }
          },
        });

        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: result.cleared
            ? "Mark Manufacturing Clearance as Cleared"
            : "Submit Manufacturing Clearance for Approval",
          details: { project: mapping.projectName, boqSlNo: activeItem.boqSlNo, poNumber: activeItem.poNumber },
        });
        toast({
          title: result.cleared ? "Manufacturing clearance cleared" : "Sent for clearance approval",
          description: result.cleared
            ? undefined
            : `Routed to ${clearanceSteps[0]?.name ?? "review"}. The gate opens once approved.`,
        });
        setActiveItem(null);
        await loadData();
        return;
      }

      await setDoc(
        doc(db, "projects", mapping.globalProjectId, MC_COLLECTION, activeItem.boqItemId),
        {
          boqItemId: activeItem.boqItemId,
          boqSlNo: activeItem.boqSlNo,
          description: activeItem.description,
          poId: activeItem.poId,
          poNumber: activeItem.poNumber,
          vendorName: activeItem.vendorName,
          status: decisionStatus,
          clearedDate: decisionDate,
          remarks: decisionRemarks.trim(),
          clearedBy: user.id,
          clearedByName: user.name,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: `Mark Manufacturing Clearance as ${decisionStatus}`,
        details: { project: mapping.projectName, boqSlNo: activeItem.boqSlNo, poNumber: activeItem.poNumber },
      });
      toast({ title: `Manufacturing clearance marked ${decisionStatus.toLowerCase()}` });
      setActiveItem(null);
      await loadData();
    } catch (error) {
      console.error("Failed to save manufacturing clearance:", error);
      toast({ title: "Unable to save manufacturing clearance", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isResolving || (isLoading && canView)) {
    return <McLoadingState />;
  }

  if (!canView) {
    return <McAccessDenied description="You do not have permission to view manufacturing clearances." />;
  }

  if (notFound || !mappingId || !mapping) {
    return (
      <McProjectNotFound
        description="Return to Project Management and choose a project before opening manufacturing clearance."
        href="/project-management"
      />
    );
  }

  return (
    <PmShell
      sidebar={
        <PmSidebar
          title="MC Register"
          subtitle={mapping.projectName}
          icon={Factory}
          gradient="from-lime-500 to-green-600"
          activeValue={view}
          onChange={setView}
          groups={[
            {
              label: "Views",
              views: VIEWS.map((entry, index) => ({
                value: entry.key,
                label: entry.label,
                icon: entry.icon,
                color: pmAccent(index).color,
                bg: pmAccent(index).bg,
                count: countFor(entry.key),
              })),
            },
            {
              label: "Elsewhere",
              links: [
                {
                  href: context.mcHref("documents"),
                  label: "MC Documents",
                  icon: FileStack,
                  color: "text-sky-600",
                  bg: "bg-sky-100",
                },
              ],
            },
          ]}
          footerLinks={[
            {
              href: context.mcHref("settings"),
              label: "Settings",
              icon: Settings,
              color: "text-slate-600",
              bg: "bg-slate-100",
            },
          ]}
        />
      }
    >
      <PmTopbar
        title="MC Register"
        breadcrumbs={[
          { label: mapping.projectName },
          { label: "Manufacturing Clearance", href: context.mcHref() },
        ]}
        backHref={context.mcHref()}
        backLabel="Back to Manufacturing Clearance"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={isSyncing || !canClear}
            onClick={() => void handleSyncGates()}
            title="Recompute each item's gate from the approved MC document quantity."
          >
            {isSyncing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-1.5 h-4 w-4" />
            )}
            Sync gates
          </Button>
        }
      />

      <PmContent>
        <PmSectionHead
          title={VIEWS.find((entry) => entry.key === view)?.label ?? "All items"}
          stats={[
            { label: "items", value: String(rows.length) },
            { label: "gate open", value: String(countFor("cleared")) },
            ...(countFor("awaiting-drawing")
              ? [
                  {
                    label: "awaiting drawing",
                    value: String(countFor("awaiting-drawing")),
                    tone: "flag" as const,
                  },
                ]
              : []),
          ]}
        />

        <Card className="overflow-hidden border-border/60">
          <div className="overflow-x-auto">
            <Table className={PM_TABLE_CLASS}>
              <TableHeader>
                <TableRow>
                  <TableHead>SL No</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">MC cleared</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead>Drawing</TableHead>
                  <TableHead>Cleared on</TableHead>
                  <TableHead>Gate</TableHead>
                  <TableHead className="w-36 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((item) => {
                    const qty = qtyByBoqItemId?.get(item.boqItemId);
                    const clearance = clearances.get(item.boqItemId);
                    const status = clearance?.status ?? "Pending";
                    const mdlRequired = mdlRequiredBoqItemIds.has(item.boqItemId);
                    const mdlStatus = mdlStatusByBoqItemId.get(item.boqItemId) ?? "Pending";
                    const mdlBlocking = mdlRequired && !isMdlApproved(mdlStatus);
                    const canClearThis = canClear && !mdlBlocking;
                    const openRequest = openMcRequestForBoqItem(clearanceApprovals, item.boqItemId);
                    return (
                      <TableRow key={item.boqItemId}>
                        <TableCell className="whitespace-nowrap">{item.boqSlNo || "—"}</TableCell>
                        <TableCell>
                          <span className="block max-w-[20rem] truncate">{item.description}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{item.poNumber}</TableCell>
                        <TableCell className="whitespace-nowrap">{item.vendorName}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {qty ? formatQuantity(qty.orderedQty) : ""}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {qty ? (qty.approvedQty ? formatQuantity(qty.approvedQty) : "—") : ""}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {qty ? formatQuantity(qty.availableQty) : ""}
                        </TableCell>
                        <TableCell>
                          {mdlRequired ? (
                            <Badge variant="outline" className={mdlOverallStatusStyles[mdlStatus]}>
                              {mdlStatus}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not required</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatGateDate(clearance?.clearedDate)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={mcStatusStyles[status]}>
                            {status}
                          </Badge>
                          {/* The gate says open but no MC document backs it — either it was
                              cleared on this register directly, or the projection has drifted. */}
                          {status === "Cleared" && qty && qty.approvedQty <= 0 && (
                            <span
                              className="ml-1 text-xs text-amber-700"
                              title="No approved MC document quantity backs this gate. Inspections will show the line as awaiting clearance."
                            >
                              no qty
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {openRequest ? (
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${mcApprovalStatusStyles[openRequest.status]}`}
                              title="A clearance approval request is already open for this item."
                            >
                              {openRequest.status}
                              {openRequest.currentStepName ? ` · ${openRequest.currentStepName}` : ""}
                            </span>
                          ) : canAct ? (
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex justify-end gap-1">
                                {canClear && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title={
                                      mdlBlocking
                                        ? "Drawing not yet approved"
                                        : requiresClearanceApproval
                                          ? "Submit for clearance approval"
                                          : "Clear"
                                    }
                                    disabled={!canClearThis}
                                    onClick={() => openDecision(item, "Cleared")}
                                  >
                                    <CheckCircle2 className={mdlBlocking ? "h-4 w-4 text-muted-foreground" : "h-4 w-4 text-emerald-600"} />
                                  </Button>
                                )}
                                {canReject && (
                                  <Button variant="ghost" size="icon" title="Reject" onClick={() => openDecision(item, "Rejected")}>
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  </Button>
                                )}
                              </div>
                              {mdlBlocking && (
                                <Link
                                  href={`/project-management/mdl?project=${encodeURIComponent(mappingId)}`}
                                  className="text-[10px] text-amber-600 underline-offset-2 hover:underline"
                                >
                                  Awaiting drawing approval
                                </Link>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">{clearance?.clearedByName || "—"}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={11} className="h-32 text-center">
                      <Factory className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">
                        {allRows.length === 0
                          ? "Nothing to clear yet"
                          : `No items ${(VIEWS.find((entry) => entry.key === view)?.label ?? "").toLowerCase()}`}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Items appear here once a purchase order for them has been issued.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <PmTableFoot
            left={
              <>
                {rows.length} item{rows.length === 1 ? "" : "s"} of {allRows.length} on issued
                purchase orders
              </>
            }
            right={
              qtyByBoqItemId ? (
                <span>Quantity columns come from the MC document ledger</span>
              ) : (
                <span>Loading quantities…</span>
              )
            }
          />
        </Card>
      </PmContent>

      <Dialog open={Boolean(activeItem)} onOpenChange={(open) => !open && setActiveItem(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {decisionStatus === "Cleared" && requiresClearanceApproval ? "Submit clearance for approval" : `Mark as ${decisionStatus}`}
            </DialogTitle>
            <DialogDescription>
              {activeItem ? `${activeItem.boqSlNo} — ${activeItem.description}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="mc-date">Date</Label>
              <Input id="mc-date" type="date" value={decisionDate} onChange={(e) => setDecisionDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mc-remarks">Remarks</Label>
              <Textarea
                id="mc-remarks"
                placeholder="Optional notes..."
                value={decisionRemarks}
                onChange={(e) => setDecisionRemarks(e.target.value)}
              />
            </div>
            {decisionStatus === "Cleared" && requiresClearanceApproval ? (
              <p className="text-xs text-muted-foreground">
                This will be sent to {clearanceSteps[0]?.name} for approval. The gate opens — and
                inspection becomes available — only once the final stage approves.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleSaveDecision} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {decisionStatus === "Cleared" && requiresClearanceApproval ? "Submit for approval" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PmShell>
  );
}
