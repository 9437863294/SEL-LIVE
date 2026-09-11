"use client";

/**
 * The per-BOQ-item inspection gate register.
 *
 * Distinct from Inspection Calls, which is the quantity-driven record: a call offers a quantity
 * against a PO *line*, while this register answers the boolean question the downstream chain asks
 * — has this BOQ item passed, so MDCC may be issued? `canIssueMdcc` in supply-gates.ts reads
 * exactly that, along with its punch items.
 *
 * The two are kept in step by `syncInspectionGateRecords`, which projects accepted quantity and
 * punch items onto this status. So the quantity columns here come from the same ledger the calls
 * screen uses; if they disagree with the status, the projection has drifted and Sync gates
 * repairs it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  ClipboardList,
  FolderOpen,
  Hourglass,
  Layers,
  Loader2,
  Paperclip,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
  Wrench,
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
import { requestInspectionResult } from "@/lib/project-management-inspection-entries";
import {
  DEFAULT_INSPECTION_RESULT_STEPS,
  INSPECTION_RESULT_APPROVAL_COLLECTION,
  INSPECTION_RESULT_WORKFLOW_DOC_ID,
  inspectionApprovalStatusStyles,
  inspectionResultRequiresApproval,
  openInspectionRequestForBoqItem,
  type InspectionResultApproval,
} from "@/lib/project-management-inspection-workflow";
import { useProjectManagementInspectionContext } from "@/components/inspection/use-inspection-host-context";
import {
  InspectionAccessDenied,
  InspectionLoadingState,
  InspectionProjectNotFound,
} from "@/components/inspection/inspection-page-shell";
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
import { inspectionPoLineKey } from "@/lib/project-management-inspection-quantity";
import {
  loadInspectionWorkspace,
  syncInspectionGateRecords,
  type InspectionWorkspace,
} from "@/lib/project-management-inspection-service";
import { uploadProjectManagementDocument } from "@/lib/project-management-documents";
import { PO_COLLECTION, formatQuantity, type PurchaseOrder } from "@/lib/purchase-orders";
import { MDL_COLLECTION, isMdlApproved, type MdlOverallStatus } from "@/lib/mdl";
import { formatSerialList, parseSerialList } from "@/lib/serial-tracking";
import {
  INSPECTION_COLLECTION,
  INSPECTION_PERMISSION_RESOURCE,
  MC_COLLECTION,
  PUNCH_SEVERITIES,
  buildPoPlacedItems,
  canRequestInspection,
  checkInspectionReadiness,
  formatGateDate,
  inspectionStatusStyles,
  type InspectionRecord,
  type InspectionStatus,
  type ManufacturingClearance,
  type PoPlacedItem,
  type PunchItem,
  type PunchSeverity,
} from "@/lib/supply-gates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

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
  { key: "ready", label: "Ready to request", icon: CircleDashed },
  { key: "requested", label: "Awaiting result", icon: Hourglass },
  { key: "passed", label: "Passed", icon: CheckCircle2 },
  { key: "punch", label: "Punch open", icon: Wrench },
  { key: "failed", label: "Failed", icon: Ban },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const emptyPunchRow = (): PunchItem => ({
  punchId: Math.random().toString(36).slice(2),
  description: "",
  severity: "Minor",
  targetDate: "",
  closed: false,
});

export default function InspectionRegisterPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mappingId = searchParams?.get("project") ?? "";
  const view = (searchParams?.get("view") ?? "all") as ViewKey;
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", INSPECTION_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const { context, isResolving, notFound } = useProjectManagementInspectionContext(mappingId);

  const canRequest = can("Request", INSPECTION_PERMISSION_RESOURCE);
  const canRecord = can("Record Result", INSPECTION_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [placedItems, setPlacedItems] = useState<Map<string, PoPlacedItem>>(new Map());
  const [clearances, setClearances] = useState<Map<string, ManufacturingClearance>>(new Map());
  const [inspections, setInspections] = useState<Map<string, InspectionRecord>>(new Map());
  const [mdlRequiredBoqItemIds, setMdlRequiredBoqItemIds] = useState<Set<string>>(new Set());
  const [mdlStatusByBoqItemId, setMdlStatusByBoqItemId] = useState<Map<string, MdlOverallStatus>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  /** The call ledger, so the gate status can be shown against the quantity behind it. */
  const [workspace, setWorkspace] = useState<InspectionWorkspace | null>(null);
  /** Result approval stages, if this project has configured any. */
  const [resultSteps, setResultSteps] = useState<WorkflowStep[]>([]);
  const [resultApprovals, setResultApprovals] = useState<InspectionResultApproval[]>([]);

  const [requestItem, setRequestItem] = useState<PoPlacedItem | null>(null);
  const [requestedDate, setRequestedDate] = useState(today());
  const [qtyOffered, setQtyOffered] = useState("");

  const [resultItem, setResultItem] = useState<PoPlacedItem | null>(null);
  const [resultStatus, setResultStatus] = useState<InspectionStatus>("Passed");
  const [inspectionDate, setInspectionDate] = useState(today());
  const [inspectorName, setInspectorName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [qtyAccepted, setQtyAccepted] = useState("");
  const [qtyRejected, setQtyRejected] = useState("");
  const [punchRows, setPunchRows] = useState<PunchItem[]>([]);
  const [serialsText, setSerialsText] = useState("");

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

      const [poSnapshot, boqSnapshot, mcSnapshot, inspectionSnapshot, mdlSnapshot, workflowSnapshot, approvalSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, MC_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, INSPECTION_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, MDL_COLLECTION)),
        getDoc(doc(db, "workflows", INSPECTION_RESULT_WORKFLOW_DOC_ID)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, INSPECTION_RESULT_APPROVAL_COLLECTION)),
      ]);

      const rawSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : DEFAULT_INSPECTION_RESULT_STEPS;
      setResultSteps(
        (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) })),
      );
      setResultApprovals(
        approvalSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as InspectionResultApproval),
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
        new Map(mcSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as ManufacturingClearance])),
      );
      setInspections(
        new Map(
          inspectionSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as InspectionRecord]),
        ),
      );

      // Readiness (§3) needs to know whether this item's drawing is still approved — see
      // checkInspectionReadiness in supply-gates.ts.
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

      // Loaded last so a failure here degrades to the register working without its quantity
      // columns, rather than the whole screen failing.
      setWorkspace(await loadInspectionWorkspace(mappingData.globalProjectId));
    } catch (error) {
      console.error("Failed to load inspection data:", error);
      toast({ title: "Unable to load inspection data", variant: "destructive" });
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
   * Cleared, accepted and available quantity per BOQ item, summed across its PO lines.
   *
   * Null until the ledger loads — the table renders those cells blank rather than as zero,
   * because "not loaded" and "nothing inspected" mean opposite things.
   */
  const qtyByBoqItemId = useMemo(() => {
    if (!workspace) return null;
    const map = new Map<
      string,
      { clearedQty: number; acceptedQty: number; rejectedQty: number; availableQty: number }
    >();
    for (const line of workspace.poLines) {
      if (!line.boqItemId) continue;
      const ledger = workspace.ledgers.get(inspectionPoLineKey(line.poId, line.poLineId));
      if (!ledger) continue;
      const entry =
        map.get(line.boqItemId) ??
        { clearedQty: 0, acceptedQty: 0, rejectedQty: 0, availableQty: 0 };
      entry.clearedQty += ledger.clearedQty;
      entry.acceptedQty += ledger.acceptedQty;
      entry.rejectedQty += ledger.rejectedQty;
      entry.availableQty += ledger.availableQty;
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
      const mcStatus = clearances.get(item.boqItemId)?.status ?? "Pending";
      const inspection = inspections.get(item.boqItemId);
      const status = inspection?.status ?? "Not Requested";
      const openPunch = (inspection?.punchItems ?? []).filter((punch) => !punch.closed).length;

      if (key === "punch") return openPunch > 0;
      if (key === "requested") return status === "Requested";
      if (key === "passed") return status === "Passed" || status === "Passed with Punch Items";
      if (key === "failed") return status === "Failed";
      // Ready to request: MC has opened the gate and no inspection is in flight yet.
      return canRequestInspection(mcStatus) && (status === "Not Requested" || status === "Failed");
    },
    [clearances, inspections],
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
    const path = context.inspectionHref("register").split("?")[0];
    const query = params.toString();
    router.replace(query ? `${path}?${query}` : path);
  };

  const handleSyncGates = async () => {
    if (!mapping) return;
    setIsSyncing(true);
    try {
      const written = await syncInspectionGateRecords(mapping.globalProjectId);
      toast({
        title: written ? "Gates brought in line" : "Gates already in line",
        description: written
          ? `${written} item gate${written === 1 ? "" : "s"} updated from the recorded call results.`
          : "Every item gate already matches the recorded call results.",
      });
      await loadData();
    } catch (error) {
      console.error("Failed to sync the inspection gates:", error);
      toast({ title: "Unable to sync item gates", variant: "destructive" });
    } finally {
      setIsSyncing(false);
    }
  };

  const openRequest = (item: PoPlacedItem) => {
    setRequestItem(item);
    setRequestedDate(today());
    setQtyOffered(String(item.qty));
  };

  const requestReadiness = useMemo(() => {
    if (!requestItem) return [];
    const mc = clearances.get(requestItem.boqItemId);
    const mdlRequired = mdlRequiredBoqItemIds.has(requestItem.boqItemId);
    const mdlStatus = mdlStatusByBoqItemId.get(requestItem.boqItemId) ?? "Pending";
    return checkInspectionReadiness({
      mcStatus: mc?.status,
      mdlRequired,
      mdlApproved: isMdlApproved(mdlStatus),
      qtyOffered: Number(qtyOffered) || 0,
      poQty: requestItem.qty,
    });
  }, [requestItem, clearances, mdlRequiredBoqItemIds, mdlStatusByBoqItemId, qtyOffered]);

  const requestHasGap = requestReadiness.some((check) => check.status === "gap");

  const handleRequest = async () => {
    if (!mapping || !user || !requestItem) return;
    if (requestHasGap) {
      toast({
        title: "Not ready for inspection",
        description: "Resolve the readiness gaps below before requesting.",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, "projects", mapping.globalProjectId, INSPECTION_COLLECTION, requestItem.boqItemId),
        {
          boqItemId: requestItem.boqItemId,
          boqSlNo: requestItem.boqSlNo,
          description: requestItem.description,
          poId: requestItem.poId,
          poNumber: requestItem.poNumber,
          status: "Requested" satisfies InspectionStatus,
          requestedDate,
          qtyOffered: Number(qtyOffered) || 0,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Request Inspection",
        details: { project: mapping.projectName, boqSlNo: requestItem.boqSlNo, poNumber: requestItem.poNumber },
      });
      toast({ title: "Inspection requested" });
      setRequestItem(null);
      await loadData();
    } catch (error) {
      console.error("Failed to request inspection:", error);
      toast({ title: "Unable to request inspection", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const openResult = (item: PoPlacedItem, status: InspectionStatus) => {
    setResultItem(item);
    setResultStatus(status);
    setInspectionDate(today());
    setInspectorName("");
    setRemarks("");
    setReportFile(null);
    const existing = inspections.get(item.boqItemId);
    const offered = existing?.qtyOffered ?? item.qty;
    if (status === "Failed") {
      setQtyAccepted("0");
      setQtyRejected(String(offered));
    } else {
      setQtyAccepted(String(existing?.qtyAccepted ?? offered));
      setQtyRejected(String(existing?.qtyRejected ?? 0));
    }
    setPunchRows(
      status === "Passed with Punch Items"
        ? existing?.punchItems?.length
          ? existing.punchItems
          : [emptyPunchRow()]
        : [],
    );
    setSerialsText(formatSerialList(existing?.serials));
  };

  const parsedSerials = useMemo(() => parseSerialList(serialsText), [serialsText]);

  const addPunchRow = () => setPunchRows((current) => [...current, emptyPunchRow()]);
  const removePunchRow = (punchId: string) =>
    setPunchRows((current) => (current.length > 1 ? current.filter((row) => row.punchId !== punchId) : current));
  const updatePunchRow = (punchId: string, patch: Partial<PunchItem>) =>
    setPunchRows((current) => current.map((row) => (row.punchId === punchId ? { ...row, ...patch } : row)));
  const toggleClosePunchRow = (punchId: string, closed: boolean) =>
    updatePunchRow(punchId, {
      closed,
      closedDate: closed ? today() : undefined,
      closedBy: closed ? user?.id : undefined,
      closedByName: closed ? user?.name : undefined,
    });

  const handleSaveResult = async () => {
    if (!mapping || !user || !resultItem) return;

    const offered = inspections.get(resultItem.boqItemId)?.qtyOffered ?? resultItem.qty;
    const accepted = Number(qtyAccepted) || 0;
    const rejected = Number(qtyRejected) || 0;
    if (accepted + rejected !== offered) {
      toast({
        title: "Accepted + rejected must equal quantity offered",
        description: `${accepted} + ${rejected} ≠ ${offered}`,
        variant: "destructive",
      });
      return;
    }
    if (resultStatus === "Passed with Punch Items" && punchRows.some((row) => !row.description.trim())) {
      toast({ title: "Every punch item needs a description", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      let reportDocumentId: string | undefined;
      let reportFileName: string | undefined;
      let reportFileUrl: string | undefined;
      if (reportFile) {
        const uploaded = await uploadProjectManagementDocument({
          projectMappingId: mapping.id,
          projectManagementProjectName: mapping.projectName,
          globalProjectId: mapping.globalProjectId,
          globalProjectName: mapping.globalProjectName,
          category: "Inspection Report",
          linkedType: "BOQ Item",
          linkedId: resultItem.boqItemId,
          linkedLabel: `${resultItem.boqSlNo} — ${resultItem.description}`,
          file: reportFile,
          remarks: remarks.trim(),
          uploadedBy: user.id,
          uploadedByName: user.name,
        });
        reportDocumentId = uploaded.id;
        reportFileName = uploaded.fileName;
        reportFileUrl = uploaded.fileUrl;
      }

      const punchItems =
        resultStatus === "Passed with Punch Items" ? punchRows.map((row) => ({ ...row, description: row.description.trim() })) : [];

      // A passing result opens the MDCC gate, so it routes through approval when one is configured.
      // "Failed" does not: a failure holds the gate shut and lets nothing proceed, and keeping it
      // immediate preserves the Failed → re-request loop.
      if (inspectionResultRequiresApproval(resultStatus, resultSteps)) {
        const result = await requestInspectionResult({
          globalProjectId: mapping.globalProjectId,
          mappingId,
          item: {
            boqItemId: resultItem.boqItemId,
            boqSlNo: resultItem.boqSlNo,
            description: resultItem.description,
            poId: resultItem.poId,
            poNumber: resultItem.poNumber,
          },
          result: resultStatus,
          inspectionDate,
          inspectorName: inspectorName.trim(),
          remarks: remarks.trim(),
          qtyOffered: offered,
          qtyAccepted: accepted,
          qtyRejected: rejected,
          punchItems,
          serials: parsedSerials,
          ...(reportDocumentId ? { reportDocumentId, reportFileName, reportFileUrl } : {}),
          steps: resultSteps,
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
          action: result.recorded
            ? `Record Inspection Result: ${resultStatus}`
            : `Submit Inspection Result for Approval: ${resultStatus}`,
          details: { project: mapping.projectName, boqSlNo: resultItem.boqSlNo, poNumber: resultItem.poNumber },
        });
        toast({
          title: result.recorded
            ? `Inspection recorded as ${resultStatus.toLowerCase()}`
            : "Sent for result approval",
          description: result.recorded
            ? undefined
            : `Routed to ${resultSteps[0]?.name ?? "review"}. The result is recorded once approved.`,
        });
        setResultItem(null);
        await loadData();
        return;
      }

      await setDoc(
        doc(db, "projects", mapping.globalProjectId, INSPECTION_COLLECTION, resultItem.boqItemId),
        {
          boqItemId: resultItem.boqItemId,
          boqSlNo: resultItem.boqSlNo,
          description: resultItem.description,
          poId: resultItem.poId,
          poNumber: resultItem.poNumber,
          status: resultStatus,
          inspectionDate,
          inspectorName: inspectorName.trim(),
          remarks: remarks.trim(),
          qtyAccepted: accepted,
          qtyRejected: rejected,
          punchItems,
          serials: parsedSerials,
          ...(reportDocumentId ? { reportDocumentId, reportFileName, reportFileUrl } : {}),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: `Record Inspection Result: ${resultStatus}`,
        details: { project: mapping.projectName, boqSlNo: resultItem.boqSlNo, poNumber: resultItem.poNumber },
      });
      toast({ title: `Inspection recorded as ${resultStatus.toLowerCase()}` });
      setResultItem(null);
      await loadData();
    } catch (error) {
      console.error("Failed to record inspection result:", error);
      toast({ title: "Unable to record inspection result", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isResolving || (isLoading && canView)) {
    return <InspectionLoadingState />;
  }

  if (!canView) {
    return <InspectionAccessDenied description="You do not have permission to view inspections." />;
  }

  if (notFound || !mappingId || !mapping) {
    return (
      <InspectionProjectNotFound
        description="Return to Project Management and choose a project before opening inspections."
        href="/project-management"
      />
    );
  }

  return (
    <PmShell
      sidebar={
        <PmSidebar
          title="Inspection Register"
          subtitle={mapping.projectName}
          icon={ClipboardCheck}
          gradient="from-blue-500 to-indigo-600"
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
                  href: context.inspectionHref("calls"),
                  label: "Inspection Calls",
                  icon: ClipboardList,
                  color: "text-sky-600",
                  bg: "bg-sky-100",
                },
                {
                  href: `/project-management/documents?project=${encodeURIComponent(mappingId)}&category=${encodeURIComponent("Inspection Report")}`,
                  label: "Inspection reports",
                  icon: FolderOpen,
                  color: "text-violet-600",
                  bg: "bg-violet-100",
                },
              ],
            },
          ]}
          footerLinks={[
            {
              href: context.inspectionHref("settings"),
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
        title="Inspection Register"
        breadcrumbs={[
          { label: mapping.projectName },
          { label: "Inspections", href: context.inspectionHref() },
        ]}
        backHref={context.inspectionHref()}
        backLabel="Back to Inspections"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={isSyncing || !canRecord}
            onClick={() => void handleSyncGates()}
            title="Recompute each item's gate from the recorded inspection call results."
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
            { label: "passed", value: String(countFor("passed")) },
            ...(countFor("punch")
              ? [{ label: "punch open", value: String(countFor("punch")), tone: "flag" as const }]
              : []),
            ...(countFor("failed")
              ? [{ label: "failed", value: String(countFor("failed")), tone: "flag" as const }]
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
                  <TableHead>MC</TableHead>
                  <TableHead className="text-right">Cleared</TableHead>
                  <TableHead className="text-right">Accepted</TableHead>
                  <TableHead className="text-right">Rejected</TableHead>
                  <TableHead className="text-right">To offer</TableHead>
                  <TableHead>Inspected</TableHead>
                  <TableHead>Report</TableHead>
                  <TableHead>Gate</TableHead>
                  <TableHead className="w-44 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((item) => {
                    const qty = qtyByBoqItemId?.get(item.boqItemId);
                    const mc = clearances.get(item.boqItemId);
                    const mcStatus = mc?.status ?? "Pending";
                    const inspection = inspections.get(item.boqItemId);
                    const status = inspection?.status ?? "Not Requested";
                    const canRequestThis =
                      canRequest && canRequestInspection(mcStatus) && (status === "Not Requested" || status === "Failed");
                    const canRecordThis = canRecord && status === "Requested";
                    const openPunchCount = (inspection?.punchItems ?? []).filter((p) => !p.closed).length;
                    // Named to avoid colliding with the openRequest() dialog opener above.
                    const openResultRequest = openInspectionRequestForBoqItem(resultApprovals, item.boqItemId);
                    return (
                      <TableRow key={item.boqItemId}>
                        <TableCell className="whitespace-nowrap">{item.boqSlNo || "—"}</TableCell>
                        <TableCell>
                          <span className="block max-w-[18rem] truncate" title={item.description}>
                            {item.description}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{item.poNumber}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              mcStatus === "Cleared"
                                ? "bg-emerald-100 text-emerald-700"
                                : mcStatus === "Rejected"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-muted text-muted-foreground"
                            }
                          >
                            {mcStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {qty ? formatQuantity(qty.clearedQty) : ""}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-emerald-700">
                          {qty ? (qty.acceptedQty ? formatQuantity(qty.acceptedQty) : "—") : ""}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-red-700">
                          {qty ? (qty.rejectedQty ? formatQuantity(qty.rejectedQty) : "—") : ""}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {qty ? formatQuantity(qty.availableQty) : ""}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatGateDate(inspection?.inspectionDate)}</TableCell>
                        <TableCell>
                          {inspection?.reportFileUrl ? (
                            <a
                              href={inspection.reportFileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
                            >
                              <Paperclip className="h-3 w-3" /> {inspection.reportFileName || "Report"}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={inspectionStatusStyles[status]}>
                            {status}
                          </Badge>
                          {status === "Passed with Punch Items" && openPunchCount > 0 && (
                            <span className="ml-1 text-xs text-amber-700">
                              {openPunchCount} open
                            </span>
                          )}
                          {/* Gate says passed but no call quantity backs it — either recorded on
                              this register directly, or the projection has drifted. */}
                          {(status === "Passed" || status === "Passed with Punch Items") &&
                            qty &&
                            qty.acceptedQty <= 0 && (
                              <span
                                className="ml-1 text-xs text-amber-700"
                                title="No accepted inspection call quantity backs this gate."
                              >
                                no qty
                              </span>
                            )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {openResultRequest ? (
                              <span
                                className={`rounded px-1.5 py-0.5 text-xs font-medium ${inspectionApprovalStatusStyles[openResultRequest.status]}`}
                                title="A result approval request is already open for this item."
                              >
                                {openResultRequest.status}
                                {openResultRequest.currentStepName ? ` · ${openResultRequest.currentStepName}` : ""}
                              </span>
                            ) : null}
                            {!openResultRequest && canRequestThis && (
                              <Button variant="outline" size="sm" onClick={() => openRequest(item)}>
                                {status === "Failed" ? "Re-request" : "Request"}
                              </Button>
                            )}
                            {!openResultRequest && canRecordThis && (
                              <>
                                <Button variant="ghost" size="icon" title="Passed" onClick={() => openResult(item, "Passed")}>
                                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Passed with Punch Items"
                                  onClick={() => openResult(item, "Passed with Punch Items")}
                                >
                                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                                </Button>
                                <Button variant="ghost" size="icon" title="Failed" onClick={() => openResult(item, "Failed")}>
                                  <XCircle className="h-4 w-4 text-destructive" />
                                </Button>
                              </>
                            )}
                            {!canRequestThis && !canRecordThis && status === "Not Requested" && mcStatus !== "Cleared" && (
                              <span className="text-xs text-muted-foreground">Awaiting MC</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={12} className="h-32 text-center">
                      <ClipboardCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">
                        {allRows.length === 0
                          ? "Nothing to inspect yet"
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
                <span>Quantity columns come from the inspection call ledger</span>
              ) : (
                <span>Loading quantities…</span>
              )
            }
          />
        </Card>
      </PmContent>

      <Dialog open={Boolean(requestItem)} onOpenChange={(open) => !open && setRequestItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Inspection</DialogTitle>
            <DialogDescription>{requestItem ? `${requestItem.boqSlNo} — ${requestItem.description}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="inspection-requested-date">Requested Date</Label>
                <Input
                  id="inspection-requested-date"
                  type="date"
                  value={requestedDate}
                  onChange={(e) => setRequestedDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qty-offered">Quantity Offered</Label>
                <Input
                  id="qty-offered"
                  type="number"
                  min="0"
                  step="0.001"
                  value={qtyOffered}
                  onChange={(e) => setQtyOffered(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Readiness Check</p>
              {requestReadiness.map((check) => (
                <div key={check.key} className="flex items-center justify-between text-xs">
                  <span>{check.label}</span>
                  <span
                    className={
                      check.status === "ok"
                        ? "rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700"
                        : "rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700"
                    }
                  >
                    {check.detail}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleRequest} disabled={isSaving || requestHasGap}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resultItem)} onOpenChange={(open) => !open && setResultItem(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record Inspection Result — {resultStatus}</DialogTitle>
            <DialogDescription>{resultItem ? `${resultItem.boqSlNo} — ${resultItem.description}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="inspection-date">Inspection Date</Label>
              <Input id="inspection-date" type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inspector-name">Inspector Name</Label>
              <Input id="inspector-name" value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qty-accepted">Quantity Accepted</Label>
              <Input id="qty-accepted" type="number" min="0" step="0.001" value={qtyAccepted} onChange={(e) => setQtyAccepted(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qty-rejected">Quantity Rejected</Label>
              <Input id="qty-rejected" type="number" min="0" step="0.001" value={qtyRejected} onChange={(e) => setQtyRejected(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="inspection-report">Inspection Report (optional)</Label>
              <Input
                id="inspection-report"
                type="file"
                onChange={(e) => setReportFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="inspection-serials">
                Serials (optional, one per line or comma-separated)
              </Label>
              <Textarea
                id="inspection-serials"
                placeholder="Not every item is serial-tracked — leave blank if not applicable"
                value={serialsText}
                onChange={(e) => setSerialsText(e.target.value)}
                rows={3}
              />
              {parsedSerials.length > 0 && parsedSerials.length !== Number(qtyAccepted) && (
                <p className="text-xs text-amber-600">
                  {parsedSerials.length} serial{parsedSerials.length === 1 ? "" : "s"} entered vs {qtyAccepted || 0} accepted —
                  fine if only some units are serial-tracked, otherwise check the count.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                DI, GRN, and MVAC each validate their own serials as a subset of this list, once entered.
              </p>
            </div>

            {resultStatus === "Passed with Punch Items" && (
              <div className="space-y-2 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label>Punch Items</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addPunchRow}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {punchRows.map((row) => (
                    <div key={row.punchId} className="grid grid-cols-1 gap-2 rounded-lg border p-2 sm:grid-cols-[2fr_1fr_1fr_auto_auto]">
                      <Input
                        placeholder="Description"
                        value={row.description}
                        onChange={(e) => updatePunchRow(row.punchId, { description: e.target.value })}
                      />
                      <Select
                        value={row.severity}
                        onValueChange={(value: PunchSeverity) => updatePunchRow(row.punchId, { severity: value })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PUNCH_SEVERITIES.map((severity) => (
                            <SelectItem key={severity} value={severity}>{severity}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="date"
                        value={row.targetDate ?? ""}
                        onChange={(e) => updatePunchRow(row.punchId, { targetDate: e.target.value })}
                      />
                      <label className="flex items-center gap-1.5 whitespace-nowrap px-2 text-xs">
                        <Checkbox
                          checked={row.closed}
                          onCheckedChange={(value) => toggleClosePunchRow(row.punchId, value === true)}
                        />
                        Closed
                      </label>
                      <Button variant="ghost" size="icon" onClick={() => removePunchRow(row.punchId)} aria-label="Remove punch item">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Critical and Major items block MDCC until closed. Minor items may be carried forward to site.
                </p>
              </div>
            )}

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="inspection-remarks">Remarks</Label>
              <Textarea
                id="inspection-remarks"
                placeholder="Optional notes..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
            {inspectionResultRequiresApproval(resultStatus, resultSteps) ? (
              <p className="text-xs text-muted-foreground">
                A passing result opens the MDCC gate, so this will be sent to{" "}
                {resultSteps[0]?.name} for approval. The inspection stays Requested until the final
                stage approves.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleSaveResult} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {inspectionResultRequiresApproval(resultStatus, resultSteps) ? "Submit for approval" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PmShell>
  );
}
