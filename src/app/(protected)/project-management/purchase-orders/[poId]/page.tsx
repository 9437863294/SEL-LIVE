"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  FileUp,
  GitPullRequestArrow,
  Loader2,
  Paperclip,
  PackageCheck,
  Pencil,
  Printer,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  Truck,
} from "lucide-react";
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db } from "@/lib/firebase";
import { storage } from "@/lib/firebase-storage";
import { cn } from "@/lib/utils";
import { MDL_COLLECTION, mdlOverallStatusStyles, type MdlDrawing, type MdlOverallStatus } from "@/lib/mdl";
import {
  DI_COLLECTION,
  GRN_COLLECTION,
  INSPECTION_COLLECTION,
  MC_COLLECTION,
  MDCC_COLLECTION,
  MVAC_COLLECTION,
  diStatusStyles,
  grnStatusStyles,
  inspectionStatusStyles,
  mcStatusStyles,
  mdccStatusStyles,
  mvacStatusStyles,
  type DiRecord,
  type DiStatus,
  type GrnRecord,
  type GrnStatus,
  type InspectionRecord,
  type InspectionStatus,
  type ManufacturingClearance,
  type McStatus,
  type MdccRecord,
  type MdccStatus,
  type MvacRecord,
  type MvacStatus,
} from "@/lib/supply-gates";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useAuth } from "@/components/auth/AuthProvider";
import { logUserActivity } from "@/lib/activity-logger";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PM_DIALOG, PmDataList, PmEmptyState, type PmListColumn } from "@/components/project-management/pm-shell";
import {
  PO_COLLECTION,
  PO_PERMISSION_RESOURCE,
  computeFlowDownCheck,
  formatCurrency,
  formatQuantity,
  isCommitmentOverBoq,
  isPoOverdue,
  poStatusStyles,
  toNumber,
  type FlowDownObligation,
  type PurchaseOrder,
  type PurchaseOrderItem,
} from "@/lib/purchase-orders";
import type { WorkflowStep } from "@/lib/types";
import { getAssigneeForStep, calculateDeadline } from "@/lib/workflow-utils";
import { requestPoIssueApproval } from "@/lib/project-management-po-entries";
import {
  DEFAULT_PO_ISSUE_STEPS,
  PO_ISSUE_APPROVAL_COLLECTION,
  PO_ISSUE_WORKFLOW_DOC_ID,
  openIssueRequestForPo,
  poIssueRequiresApproval,
  poIssueStatusStyles,
  type PoIssueApproval,
  type PoIssueException,
  type PoLike,
} from "@/lib/project-management-po-workflow";
import { DEFAULT_VARIATION_TOLERANCE_PCT } from "@/lib/project-management-variations";
import type { Client } from "@/lib/types";
import { Textarea } from "@/components/ui/textarea";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/**
 * A section Card whose body is a list: framed on a desktop, only its heading on a phone — the list
 * brings its own cards there, and a card inside a card is just a thicker border.
 */
const LIST_CARD_CLASS = "max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none";
const LIST_CARD_HEADER_CLASS = "max-sm:px-0";
/** The Card frames the list on a desktop, so the list drops its own. */
const LIST_IN_CARD_CLASS = "sm:rounded-none sm:border-0 sm:shadow-none";

/** One supply gate's status on a line item, as a pill. */
type GateStatus = { gate: string; status: string; style: string };

type PoLineRow = {
  id: string;
  item: PurchaseOrderItem;
  boqSlNo?: string;
  budgetPrice: number;
  mdlStatus?: MdlOverallStatus;
  /** Manufacturing Clearance → MVAC, in chain order. */
  gates: GateStatus[];
};

type FlowDownRow = FlowDownObligation & { id: string };

type CommitmentExceptionRow = {
  id: string;
  boqItemId: string;
  boqSlNo: string;
  description: string;
  boqValue: number;
  committedValue: number;
};

export default function ProjectPurchaseOrderDetailPage() {
  const { poId } = useParams() as { poId: string };
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const router = useRouter();
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();

  const canView = can("View", PO_PERMISSION_RESOURCE) || can("View", "Project Management.RFQ");
  const canIssue = can("Issue", PO_PERMISSION_RESOURCE);
  const canReceive = can("Receive", PO_PERMISSION_RESOURCE);
  const canCancel = can("Cancel", PO_PERMISSION_RESOURCE);
  const canDelete = can("Delete", PO_PERMISSION_RESOURCE);
  const canEditDates = can("Edit", PO_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [budgetPriceByBoqItemId, setBudgetPriceByBoqItemId] = useState<Map<string, number>>(new Map());
  const [boqQtyByBoqItemId, setBoqQtyByBoqItemId] = useState<Map<string, number>>(new Map());
  const [boqSlNoByBoqItemId, setBoqSlNoByBoqItemId] = useState<Map<string, string>>(new Map());
  const [mdlStatusByBoqItemId, setMdlStatusByBoqItemId] = useState<Map<string, MdlOverallStatus>>(new Map());
  const [mcStatusByBoqItemId, setMcStatusByBoqItemId] = useState<Map<string, McStatus>>(new Map());
  const [inspectionStatusByBoqItemId, setInspectionStatusByBoqItemId] = useState<Map<string, InspectionStatus>>(new Map());
  const [mdccStatusByBoqItemId, setMdccStatusByBoqItemId] = useState<Map<string, MdccStatus>>(new Map());
  const [diStatusByBoqItemId, setDiStatusByBoqItemId] = useState<Map<string, DiStatus>>(new Map());
  const [grnStatusByBoqItemId, setGrnStatusByBoqItemId] = useState<Map<string, GrnStatus>>(new Map());
  const [mvacStatusByBoqItemId, setMvacStatusByBoqItemId] = useState<Map<string, MvacStatus>>(new Map());
  const [committedValueByBoqItemId, setCommittedValueByBoqItemId] = useState<Map<string, number>>(new Map());
  const [client, setClient] = useState<Client | null>(null);
  const [tolerancePct, setTolerancePct] = useState(DEFAULT_VARIATION_TOLERANCE_PCT);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDatesDialogOpen, setIsDatesDialogOpen] = useState(false);
  const [datesForm, setDatesForm] = useState({ startDate: "", endDate: "" });
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [isIssueReviewOpen, setIsIssueReviewOpen] = useState(false);
  /** Issue approval stages, if this project has configured any. */
  const [issueSteps, setIssueSteps] = useState<WorkflowStep[]>([]);
  const [issueApprovals, setIssueApprovals] = useState<PoIssueApproval[]>([]);
  const [issueOverrideReason, setIssueOverrideReason] = useState("");

  const loadPo = useCallback(async () => {
    if (!mappingId || !poId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");
      setMapping(mappingData);

      const [snapshot, boqSnapshot, mdlSnapshot, mcSnapshot, inspectionSnapshot, mdccSnapshot, diSnapshot, grnSnapshot, mvacSnapshot, projectSnapshot, allPoSnapshot, settingsSnapshot, workflowSnapshot, approvalSnapshot] =
        await Promise.all([
          getDoc(doc(db, "projects", mappingData.globalProjectId, PO_COLLECTION, poId)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
          getDocs(collection(db, "projects", mappingData.globalProjectId, MDL_COLLECTION)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, MC_COLLECTION)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, INSPECTION_COLLECTION)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, MDCC_COLLECTION)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, DI_COLLECTION)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, GRN_COLLECTION)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, MVAC_COLLECTION)),
          getDoc(doc(db, "projects", mappingData.globalProjectId)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION)),
          getDoc(doc(db, "projectManagementSettings", "general")),
          getDoc(doc(db, "workflows", PO_ISSUE_WORKFLOW_DOC_ID)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, PO_ISSUE_APPROVAL_COLLECTION)),
        ]);

      const rawIssueSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : DEFAULT_PO_ISSUE_STEPS;
      setIssueSteps(
        (Array.isArray(rawIssueSteps) ? rawIssueSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) })),
      );
      setIssueApprovals(
        approvalSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as PoIssueApproval),
      );
      setBudgetPriceByBoqItemId(
        new Map(
          boqSnapshot.docs.map((d) => [d.id, toNumber((d.data() as Record<string, unknown>)["Budget Price"])]),
        ),
      );
      setBoqQtyByBoqItemId(
        new Map(boqSnapshot.docs.map((d) => [d.id, toNumber((d.data() as Record<string, unknown>)["QTY"])])),
      );
      setBoqSlNoByBoqItemId(
        new Map(
          boqSnapshot.docs.map((d) => [d.id, String((d.data() as Record<string, unknown>)["BOQ SL No"] ?? "")]),
        ),
      );

      // Commitment accounting (§3) — total value committed across every live PO for this project,
      // per BOQ line, so a single PO can be judged against what's already been committed elsewhere.
      const committed = new Map<string, number>();
      allPoSnapshot.docs.forEach((poDoc) => {
        const data = poDoc.data() as PurchaseOrder;
        if (data.status === "Cancelled") return;
        (data.items ?? []).forEach((item) => {
          if (!item.boqItemId) return;
          committed.set(item.boqItemId, (committed.get(item.boqItemId) ?? 0) + toNumber(item.amount));
        });
      });
      setCommittedValueByBoqItemId(committed);

      const storedTolerance = settingsSnapshot.data()?.variationTolerancePct;
      setTolerancePct(typeof storedTolerance === "number" ? storedTolerance : DEFAULT_VARIATION_TOLERANCE_PCT);

      // Flow-down check (§2) — the client's contract terms this project's POs must at least match.
      const clientId = projectSnapshot.data()?.clientId as string | undefined;
      if (clientId) {
        const clientSnapshot = await getDoc(doc(db, "clients", clientId));
        setClient(clientSnapshot.exists() ? ({ id: clientSnapshot.id, ...clientSnapshot.data() } as Client) : null);
      } else {
        setClient(null);
      }
      const mdlRequiredBoqItemIds = new Set(
        boqSnapshot.docs
          .filter((d) => String((d.data() as Record<string, unknown>).MDL ?? "").trim().toLowerCase() === "yes")
          .map((d) => d.id),
      );
      const drawingsByBoqItemId = new Map(
        mdlSnapshot.docs.map((d) => [d.id, { id: d.id, ...d.data() } as MdlDrawing]),
      );
      setMdlStatusByBoqItemId(
        new Map(
          Array.from(mdlRequiredBoqItemIds).map((boqItemId) => [
            boqItemId,
            drawingsByBoqItemId.get(boqItemId)?.status ?? "Pending",
          ]),
        ),
      );
      // Downstream supply gates — Manufacturing Clearance -> Inspection -> MDCC -> DI -> GRN -> MVAC
      // — each keyed by boqItemId, same as MDL, so this line-item table can show the whole chain.
      setMcStatusByBoqItemId(
        new Map(
          mcSnapshot.docs.map((d) => [d.id, (d.data() as ManufacturingClearance).status ?? "Pending"]),
        ),
      );
      setInspectionStatusByBoqItemId(
        new Map(
          inspectionSnapshot.docs.map((d) => [d.id, (d.data() as InspectionRecord).status ?? "Not Requested"]),
        ),
      );
      setMdccStatusByBoqItemId(
        new Map(mdccSnapshot.docs.map((d) => [d.id, (d.data() as MdccRecord).status ?? "Pending"])),
      );
      setDiStatusByBoqItemId(
        new Map(diSnapshot.docs.map((d) => [d.id, (d.data() as DiRecord).status ?? "Pending"])),
      );
      setGrnStatusByBoqItemId(
        new Map(grnSnapshot.docs.map((d) => [d.id, (d.data() as GrnRecord).status ?? "Not Received"])),
      );
      setMvacStatusByBoqItemId(
        new Map(mvacSnapshot.docs.map((d) => [d.id, (d.data() as MvacRecord).status ?? "Pending"])),
      );
      if (!snapshot.exists()) {
        setPo(null);
        return;
      }
      setPo({ id: snapshot.id, ...snapshot.data() } as PurchaseOrder);
    } catch (error) {
      console.error("Failed to load purchase order:", error);
      toast({ title: "Unable to load purchase order", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, poId, toast]);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadPo();
  }, [canView, isAuthLoading, loadPo]);

  const flowDownObligations: FlowDownObligation[] = po ? computeFlowDownCheck(client, po) : [];
  const flowDownGaps = flowDownObligations.filter((item) => item.status === "gap");

  // BOQ lines where total committed value (this PO plus every other live PO) exceeds the BOQ
  // value beyond tolerance — the exception list called out in §4.9, computed on the fly rather
  // than as its own screen.
  const commitmentExceptions = (po?.items ?? []).reduce((rows, item) => {
    const boqItemId = item.boqItemId;
    if (!boqItemId || rows.some((row) => row.boqItemId === boqItemId)) return rows;
    const boqQty = boqQtyByBoqItemId.get(boqItemId) ?? 0;
    const budgetPrice = budgetPriceByBoqItemId.get(boqItemId) ?? 0;
    const boqValue = boqQty * budgetPrice;
    const committedValue = committedValueByBoqItemId.get(boqItemId) ?? 0;
    if (!boqValue || !isCommitmentOverBoq(boqValue, 0, committedValue, tolerancePct)) return rows;
    rows.push({
      boqItemId,
      boqSlNo: boqSlNoByBoqItemId.get(boqItemId) || "—",
      description: item.description,
      boqValue,
      committedValue,
    });
    return rows;
  }, [] as Array<{ boqItemId: string; boqSlNo: string; description: string; boqValue: number; committedValue: number }>);

  const hasUnresolvedGaps = flowDownGaps.length > 0 || commitmentExceptions.length > 0;
  const needsIssueOverrideReason = hasUnresolvedGaps && !po?.commitmentOverrideReason && !po?.flowDownOverrideReason;

  const requiresIssueApproval = poIssueRequiresApproval((po as PoLike | null) ?? {}, issueSteps);
  /** An open request means the PO is already in someone's queue — don't offer Issue again. */
  const openIssueRequest = po ? openIssueRequestForPo(issueApprovals, po.id) : null;

  const handleRequestIssue = () => {
    setIssueOverrideReason("");
    // The exception review dialog is shown whenever there are gaps, whether the PO then goes
    // straight to Issued or into the approval workflow — the buyer states their reason either way.
    if (hasUnresolvedGaps) {
      setIsIssueReviewOpen(true);
    } else {
      void handleConfirmIssue();
    }
  };

  /**
   * Either issues the PO directly, or opens an approval request for it.
   *
   * The exceptions and the buyer's stated reason travel onto the request rather than being written
   * straight onto the PO, so whoever accepts them is recorded as the approver, not the buyer.
   */
  const handleConfirmIssue = async () => {
    if (!mapping || !po) return;
    if (needsIssueOverrideReason && !issueOverrideReason.trim()) {
      toast({ title: "A reason is required to issue with unresolved gaps", variant: "destructive" });
      return;
    }
    if (!user) {
      toast({ title: "You must be signed in to issue a purchase order", variant: "destructive" });
      return;
    }
    setIsUpdating(true);
    try {
      const exceptions: PoIssueException[] = [
        ...flowDownGaps.map((gap) => ({ kind: "flow-down" as const, label: gap.label })),
        ...commitmentExceptions.map((exception) => ({
          kind: "commitment" as const,
          label: `${exception.boqSlNo} — ${exception.description}`,
          detail: `Committed ${formatCurrency(exception.committedValue)} against a BOQ value of ${formatCurrency(exception.boqValue)}`,
        })),
      ];

      const result = await requestPoIssueApproval({
        globalProjectId: mapping.globalProjectId,
        mappingId,
        po: {
          id: po.id,
          poNumber: po.poNumber,
          poDate: po.poDate,
          vendorId: po.vendorId,
          vendorName: po.vendorName,
          totalAmount: po.totalAmount,
          itemCount: po.items?.length ?? 0,
        },
        exceptions,
        overrideReason: issueOverrideReason.trim() || undefined,
        steps: issueSteps,
        requestedBy: { id: user.id, name: user.name },
        resolveAssignees: (step) =>
          getAssigneeForStep(step, {
            projectId: mapping.globalProjectId,
            departmentId: "",
            amount: po.totalAmount,
          }),
        resolveDeadline: async (step) => {
          try {
            return await calculateDeadline(new Date(), step.tat);
          } catch {
            return null;
          }
        },
      });

      if (!result.issued) {
        toast({
          title: "Sent for issue approval",
          description: `Routed to ${issueSteps[0]?.name ?? "review"}. The PO is issued once approved.`,
        });
        if (user) {
          void logUserActivity({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            module: "Project Management",
            action: "Submit PO for Issue Approval",
            details: {
              poNumber: po.poNumber,
              project: mapping.projectName,
              exceptions: exceptions.map((exception) => exception.label),
            },
          });
        }
        setIsIssueReviewOpen(false);
        await loadPo();
        return;
      }
      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: "Mark PO as Issued",
          details: {
            poNumber: po.poNumber,
            project: mapping.projectName,
            flowDownGaps: flowDownGaps.map((g) => g.label),
            commitmentExceptions: commitmentExceptions.map((c) => c.boqSlNo),
          },
        });
      }
      toast({ title: "Purchase order issued" });
      setIsIssueReviewOpen(false);
      await loadPo();
    } catch (error) {
      console.error("Failed to issue purchase order:", error);
      toast({ title: "Unable to issue purchase order", variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  const openDatesDialog = () => {
    if (!po) return;
    setDatesForm({ startDate: po.startDate ?? "", endDate: po.endDate ?? "" });
    setIsDatesDialogOpen(true);
  };

  const handleSaveDates = async () => {
    if (!mapping || !po) return;
    if (!datesForm.startDate || !datesForm.endDate) {
      toast({ title: "Both dates are required", variant: "destructive" });
      return;
    }
    if (datesForm.endDate < datesForm.startDate) {
      toast({ title: "End date cannot be before the start date", variant: "destructive" });
      return;
    }
    setIsUpdating(true);
    try {
      await updateDoc(doc(db, "projects", mapping.globalProjectId, PO_COLLECTION, po.id), {
        startDate: datesForm.startDate,
        endDate: datesForm.endDate,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Dates updated" });
      setIsDatesDialogOpen(false);
      await loadPo();
    } catch (error) {
      console.error("Failed to update purchase order dates:", error);
      toast({ title: "Unable to update dates", variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  const handlePrint = () => {
    if (!mapping) return;
    window.open(`/project-management/purchase-orders/${poId}/print?project=${encodeURIComponent(mapping.id)}`, "_blank");
  };

  const handleUploadApprovedDocument = async (file: File | null) => {
    if (!file || !mapping || !po) return;
    setIsUploadingDocument(true);
    try {
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const path = `project-management/purchase-orders/${mapping.globalProjectId}/${po.id}/approved-${Date.now()}-${safeName}`;
      const target = storageRef(storage, path);
      await uploadBytes(target, file);
      const approvedDocumentUrl = await getDownloadURL(target);
      await updateDoc(doc(db, "projects", mapping.globalProjectId, PO_COLLECTION, po.id), {
        approvedDocumentUrl,
        approvedDocumentName: file.name,
        approvedDocumentPath: path,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Approved document uploaded" });
      await loadPo();
    } catch (error) {
      console.error("Failed to upload approved document:", error);
      toast({ title: "Unable to upload document", variant: "destructive" });
    } finally {
      setIsUploadingDocument(false);
    }
  };

  const updateStatus = async (status: PurchaseOrder["status"]) => {
    if (!mapping || !po) return;
    setIsUpdating(true);
    try {
      await updateDoc(doc(db, "projects", mapping.globalProjectId, PO_COLLECTION, po.id), {
        status,
        updatedAt: serverTimestamp(),
      });
      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: `Mark PO as ${status}`,
          details: { poNumber: po.poNumber, project: mapping.projectName },
        });
      }
      toast({ title: `Purchase order marked as ${status}` });
      await loadPo();
    } catch (error) {
      console.error("Failed to update purchase order status:", error);
      toast({ title: "Unable to update purchase order", variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!mapping || !po) return;
    setIsUpdating(true);
    try {
      await deleteDoc(doc(db, "projects", mapping.globalProjectId, PO_COLLECTION, po.id));
      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: "Delete Draft PO",
          details: { poNumber: po.poNumber, project: mapping.projectName },
        });
      }
      toast({ title: "Draft purchase order deleted" });
      router.push(`/project-management/purchase-orders?project=${encodeURIComponent(mappingId)}`);
    } catch (error) {
      console.error("Failed to delete purchase order:", error);
      toast({ title: "Unable to delete purchase order", variant: "destructive" });
      setIsUpdating(false);
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view purchase orders.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!po || !mapping) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Purchase order not found</CardTitle>
            <CardDescription>This purchase order may have been deleted, or the project link is invalid.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href={`/project-management/purchase-orders?project=${encodeURIComponent(mappingId)}`}>Back to Purchase Orders</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const lineRows: PoLineRow[] = (po.items ?? []).map((item, index) => {
    const mcStatus = item.boqItemId ? mcStatusByBoqItemId.get(item.boqItemId) : undefined;
    const inspectionStatus = item.boqItemId ? inspectionStatusByBoqItemId.get(item.boqItemId) : undefined;
    const mdccStatus = item.boqItemId ? mdccStatusByBoqItemId.get(item.boqItemId) : undefined;
    const diStatus = item.boqItemId ? diStatusByBoqItemId.get(item.boqItemId) : undefined;
    const grnStatus = item.boqItemId ? grnStatusByBoqItemId.get(item.boqItemId) : undefined;
    const mvacStatus = item.boqItemId ? mvacStatusByBoqItemId.get(item.boqItemId) : undefined;
    return {
      id: String(index),
      item,
      boqSlNo: item.boqItemId ? boqSlNoByBoqItemId.get(item.boqItemId) : "",
      budgetPrice: item.boqItemId ? budgetPriceByBoqItemId.get(item.boqItemId) ?? 0 : 0,
      mdlStatus: item.boqItemId ? mdlStatusByBoqItemId.get(item.boqItemId) : undefined,
      gates: [
        { gate: "MC", status: mcStatus ?? "Pending", style: mcStatusStyles[mcStatus ?? "Pending"] },
        {
          gate: "Inspection",
          status: inspectionStatus ?? "Not Requested",
          style: inspectionStatusStyles[inspectionStatus ?? "Not Requested"],
        },
        { gate: "MDCC", status: mdccStatus ?? "Pending", style: mdccStatusStyles[mdccStatus ?? "Pending"] },
        { gate: "DI", status: diStatus ?? "Pending", style: diStatusStyles[diStatus ?? "Pending"] },
        { gate: "GRN", status: grnStatus ?? "Not Received", style: grnStatusStyles[grnStatus ?? "Not Received"] },
        { gate: "MVAC", status: mvacStatus ?? "Pending", style: mvacStatusStyles[mvacStatus ?? "Pending"] },
      ],
    };
  });

  const gatePill = (gate: GateStatus) => (
    <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", gate.style)}>{gate.status}</span>
  );

  const lineColumns: PmListColumn<PoLineRow>[] = [
    { header: "BOQ SL No", className: "whitespace-nowrap text-muted-foreground", cell: (row) => row.boqSlNo || "—" },
    { header: "Description", className: "max-w-md", mobile: "title", cell: (row) => row.item.description },
    { header: "Unit", cell: (row) => row.item.unit || "—" },
    {
      header: "BOQ Qty",
      className: "text-muted-foreground",
      cell: (row) => (typeof row.item.boqQty === "number" ? formatQuantity(row.item.boqQty) : "—"),
    },
    {
      header: "Indent Qty",
      className: "text-muted-foreground",
      cell: (row) => (typeof row.item.indentQty === "number" ? formatQuantity(row.item.indentQty) : "—"),
    },
    { header: "PO Qty", cell: (row) => formatQuantity(row.item.qty) },
    { header: "Rate", cell: (row) => formatCurrency(row.item.rate) },
    { header: "Budget Price", className: "text-muted-foreground", cell: (row) => formatCurrency(row.budgetPrice) },
    {
      header: "Total Budget Price",
      className: "text-muted-foreground",
      cell: (row) => formatCurrency(row.budgetPrice * row.item.qty),
    },
    {
      header: "Amount",
      mobile: "aside",
      cell: (row) => <span className="font-medium">{formatCurrency(row.item.amount)}</span>,
    },
    { header: "Source RFQ", className: "text-xs text-muted-foreground", cell: (row) => row.item.sourceRfqNumber || "—" },
    {
      header: "MDL Status",
      mobile: "omit",
      cell: (row) =>
        row.mdlStatus ? (
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", mdlOverallStatusStyles[row.mdlStatus])}>
            {row.mdlStatus}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { header: "MC Status", mobile: "omit", cell: (row) => gatePill(row.gates[0]) },
    { header: "Inspection", mobile: "omit", cell: (row) => gatePill(row.gates[1]) },
    { header: "MDCC", mobile: "omit", cell: (row) => gatePill(row.gates[2]) },
    { header: "DI", mobile: "omit", cell: (row) => gatePill(row.gates[3]) },
    { header: "GRN", mobile: "omit", cell: (row) => gatePill(row.gates[4]) },
    { header: "MVAC", mobile: "omit", cell: (row) => gatePill(row.gates[5]) },
    {
      // Phone only — `hidden` on the desktop table, which has a column per gate. Seven more
      // label/value pairs would double the card's height, so on a phone the chain wraps as one
      // strip of pills along the card's foot instead.
      header: "Supply chain",
      className: "hidden",
      mobile: "footer",
      cell: (row) => (
        <div className="flex flex-wrap gap-1.5">
          {row.mdlStatus && (
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", mdlOverallStatusStyles[row.mdlStatus])}>
              MDL · {row.mdlStatus}
            </span>
          )}
          {row.gates.map((gate) => (
            <span key={gate.gate} className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", gate.style)}>
              {gate.gate} · {gate.status}
            </span>
          ))}
        </div>
      ),
    },
  ];

  const flowDownColumns: PmListColumn<FlowDownRow>[] = [
    { header: "Obligation", className: "font-medium", mobile: "title", cell: (item) => item.label },
    { header: "Client Requires", cell: (item) => item.clientValue },
    { header: "This PO", cell: (item) => item.poValue },
    {
      header: "Status",
      mobile: "aside",
      cell: (item) =>
        item.status === "gap" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            <AlertTriangle className="h-3 w-3" /> Gap
          </span>
        ) : item.status === "ok" ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Covered</span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Confirm manually</span>
        ),
    },
  ];

  const commitmentColumns: PmListColumn<CommitmentExceptionRow>[] = [
    { header: "BOQ SL No", className: "whitespace-nowrap", mobile: "title", cell: (row) => row.boqSlNo },
    {
      header: "Description",
      className: "max-w-sm truncate",
      mobile: "title",
      cell: (row) => <span title={row.description}>{row.description}</span>,
    },
    { header: "BOQ Value", align: "right", cell: (row) => formatCurrency(row.boqValue) },
    {
      header: "Committed (all POs)",
      align: "right",
      cell: (row) => <span className="font-semibold text-red-600">{formatCurrency(row.committedValue)}</span>,
    },
  ];

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-4 p-4 max-sm:[--card-pad:1rem] sm:space-y-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-2 sm:gap-3">
          <Button variant="ghost" size="icon" className="shrink-0" asChild>
            <Link href={`/project-management/purchase-orders?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Purchase Orders">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm sm:flex">
            <ShoppingCart className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold sm:text-2xl">{po.poNumber}</h1>
            <p className="break-words text-sm text-muted-foreground">
              {po.vendorName}{po.sourceRfqNumbers?.length ? ` · from ${po.sourceRfqNumbers.join(", ")}` : ""}
            </p>
          </div>
          <span className={`ml-auto shrink-0 rounded-full px-3 py-1 text-xs font-medium sm:ml-2 ${poStatusStyles[po.status]}`}>
            {po.status}
          </span>
        </div>

        {/* On a phone the actions take a row of their own and share it; Print, the secondary
            action, drops to its icon there. */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          <Button variant="outline" onClick={handlePrint} aria-label="Print for Approval">
            <Printer className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Print for Approval</span>
          </Button>
          {po.status === "Draft" && openIssueRequest ? (
            <span
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${poIssueStatusStyles[openIssueRequest.status]}`}
              title="An issue approval request is already open for this purchase order."
            >
              {openIssueRequest.status}
              {openIssueRequest.currentStepName ? ` · ${openIssueRequest.currentStepName}` : ""}
            </span>
          ) : po.status === "Draft" && canIssue ? (
            <Button onClick={handleRequestIssue} disabled={isUpdating} className="max-sm:flex-1">
              <Truck className="mr-2 h-4 w-4" />
              {requiresIssueApproval ? "Submit for Issue Approval" : "Mark as Issued"}
            </Button>
          ) : null}
          {po.status === "Issued" && canReceive && (
            <Button onClick={() => void updateStatus("Received")} disabled={isUpdating} className="max-sm:flex-1">
              <PackageCheck className="mr-2 h-4 w-4" /> Mark as Received
            </Button>
          )}
          {(po.status === "Draft" || po.status === "Issued") && canCancel && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={isUpdating} className="max-sm:flex-1">
                  <Ban className="mr-2 h-4 w-4" /> Cancel PO
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this purchase order?</AlertDialogTitle>
                  <AlertDialogDescription>This marks the PO as cancelled. This action cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Back</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void updateStatus("Cancelled")}>Cancel PO</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {po.status === "Draft" && canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isUpdating} className="max-sm:flex-1">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this draft purchase order?</AlertDialogTitle>
                  <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleDelete()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>


      {/* Two a row on a phone, the total across the full width beneath; one row of five on a
          desktop. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Card><CardContent className="p-3 sm:p-4"><p className="text-xs text-muted-foreground">PO Date</p><p className="font-semibold">{formatDate(po.poDate)}</p></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><p className="text-xs text-muted-foreground">Start Date</p><p className="font-semibold">{formatDate(po.startDate)}</p></CardContent></Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">End Date</p>
              {canEditDates && (
                // A thumb-sized target on a phone; the negative margins keep it from making the
                // label row taller than its neighbours'.
                <Button
                  variant="ghost"
                  size="icon"
                  className="-my-2 -mr-2 h-9 w-9 sm:my-0 sm:mr-0 sm:h-5 sm:w-5"
                  onClick={openDatesDialog}
                  aria-label="Edit dates"
                >
                  <Pencil className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                </Button>
              )}
            </div>
            <p className={`font-semibold ${isPoOverdue(po) ? "text-red-600" : ""}`}>
              {formatDate(po.endDate)}
              {isPoOverdue(po) && <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Overdue</span>}
            </p>
          </CardContent>
        </Card>
        <Card><CardContent className="p-3 sm:p-4"><p className="text-xs text-muted-foreground">Items</p><p className="font-semibold">{po.items?.length ?? 0}</p></CardContent></Card>
        <Card className="col-span-2 lg:col-span-1"><CardContent className="p-3 sm:p-4"><p className="text-xs text-muted-foreground">Total Amount</p><p className="font-semibold">{formatCurrency(po.totalAmount)}</p></CardContent></Card>
      </div>

      {po.terms && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Terms / Remarks</CardTitle></CardHeader>
          <CardContent className="break-words pt-0 text-sm text-muted-foreground">{po.terms}</CardContent>
        </Card>
      )}

      <Card className={LIST_CARD_CLASS}>
        <CardHeader className={LIST_CARD_HEADER_CLASS}>
          <CardTitle>Items</CardTitle>
          <CardDescription>Line items included in this purchase order.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <PmDataList
            rows={lineRows}
            columns={lineColumns}
            className={LIST_IN_CARD_CLASS}
            empty={<PmEmptyState title="No line items on this purchase order." />}
          />
        </CardContent>
      </Card>

      {(flowDownObligations.length > 0 || commitmentExceptions.length > 0) && (
        <Card className={LIST_CARD_CLASS}>
          <CardHeader className={cn("pb-2", LIST_CARD_HEADER_CLASS)}>
            <CardTitle className="text-sm">Commitment & Flow-Down Check</CardTitle>
            <CardDescription>
              Whether this project&apos;s POs impose on the vendor what the client&apos;s contract imposes on SEL,
              and whether committed value has run ahead of BOQ value.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0 max-sm:px-0">
            {flowDownObligations.length > 0 && (
              <PmDataList
                rows={flowDownObligations.map((item): FlowDownRow => ({ ...item, id: item.key }))}
                columns={flowDownColumns}
              />
            )}
            {commitmentExceptions.length > 0 && (
              <PmDataList
                rows={commitmentExceptions.map((row): CommitmentExceptionRow => ({ ...row, id: row.boqItemId }))}
                columns={commitmentColumns}
              />
            )}
            {po.commitmentOverrideReason || po.flowDownOverrideReason ? (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <GitPullRequestArrow className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Accepted by {po.issueOverrideByName || "—"}: {po.flowDownOverrideReason || po.commitmentOverrideReason}
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      {po.status === "Received" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> This purchase order has been fully received.
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Approved Document</CardTitle>
          <CardDescription>
            Print this PO for approval, get it signed, then upload the signed copy here for the record.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 pt-0">
          {po.approvedDocumentUrl && (
            <a
              href={po.approvedDocumentUrl}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              <Paperclip className="h-4 w-4 shrink-0" />
              <span className="truncate">{po.approvedDocumentName || "View uploaded document"}</span>
            </a>
          )}
          <Button variant="outline" size="sm" asChild disabled={isUploadingDocument}>
            <label className="cursor-pointer">
              {isUploadingDocument ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
              {po.approvedDocumentUrl ? "Replace Document" : "Upload Approved Document"}
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                className="sr-only"
                disabled={isUploadingDocument}
                onChange={(e) => void handleUploadApprovedDocument(e.target.files?.[0] ?? null)}
              />
            </label>
          </Button>
        </CardContent>
      </Card>

      <Dialog open={isDatesDialogOpen} onOpenChange={setIsDatesDialogOpen}>
        <DialogContent className={PM_DIALOG.content}>
          <DialogHeader className={PM_DIALOG.header}>
            <DialogTitle>Delivery Window</DialogTitle>
          </DialogHeader>
          <div className={cn(PM_DIALOG.bodyGrid, "gap-4 py-2")}>
            <div className="space-y-2">
              <Label htmlFor="po-start-date">Start Date</Label>
              <Input
                id="po-start-date"
                type="date"
                value={datesForm.startDate}
                onChange={(e) => setDatesForm((c) => ({ ...c, startDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="po-end-date">End Date</Label>
              <Input
                id="po-end-date"
                type="date"
                min={datesForm.startDate || undefined}
                value={datesForm.endDate}
                onChange={(e) => setDatesForm((c) => ({ ...c, endDate: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className={PM_DIALOG.footer}>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => void handleSaveDates()} disabled={isUpdating}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isIssueReviewOpen} onOpenChange={setIsIssueReviewOpen}>
        <DialogContent className={PM_DIALOG.content}>
          <DialogHeader className={PM_DIALOG.header}>
            <DialogTitle>Review Before Issue</DialogTitle>
          </DialogHeader>
          {/* The exception lists can run long, so on a desktop the body scrolls inside the capped
              dialog rather than pushing the footer off it. */}
          <div className={cn(PM_DIALOG.body, "py-2 text-sm sm:min-h-0 sm:flex-1 sm:overflow-y-auto")}>
            {flowDownGaps.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <p className="font-medium text-red-800">Flow-down gaps</p>
                <ul className="mt-1 list-disc break-words pl-4 text-red-700">
                  {flowDownGaps.map((gap) => (
                    <li key={gap.key}>
                      {gap.label}: client requires {gap.clientValue}, this PO offers {gap.poValue}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {commitmentExceptions.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <p className="font-medium text-red-800">Committed above BOQ value</p>
                <ul className="mt-1 list-disc break-words pl-4 text-red-700">
                  {commitmentExceptions.map((row) => (
                    <li key={row.boqItemId}>
                      {row.boqSlNo}: committed {formatCurrency(row.committedValue)} vs BOQ value {formatCurrency(row.boqValue)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="issue-override-reason">
                {needsIssueOverrideReason ? "Reason for accepting this exposure (required)" : "Notes (optional)"}
              </Label>
              <Textarea
                id="issue-override-reason"
                placeholder="Why is it acceptable to issue with this gap?"
                value={issueOverrideReason}
                onChange={(e) => setIssueOverrideReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className={PM_DIALOG.footer}>
            <DialogClose asChild><Button variant="outline">Back</Button></DialogClose>
            <Button onClick={() => void handleConfirmIssue()} disabled={isUpdating}>
              {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
              Confirm & Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
