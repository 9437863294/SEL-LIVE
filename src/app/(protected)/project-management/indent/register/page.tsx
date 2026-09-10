"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  FilePlus2,
  ListChecks,
  Loader2,
  Plus,
  SendHorizontal,
  Settings,
  Trash2,
} from "lucide-react";
import { collection, deleteDoc, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { logUserActivity } from "@/lib/activity-logger";
import { exportWorkbook } from "@/lib/report-excel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuthorization } from "@/hooks/useAuthorization";
import { getAssigneeForStep, calculateDeadline } from "@/lib/workflow-utils";
import { submitIndentForApproval } from "@/lib/project-management-indent-entries";
import {
  DEFAULT_INDENT_STEPS,
  INDENT_PERMISSION_RESOURCE as PERMISSION_RESOURCE,
  INDENT_STATUSES,
  INDENT_WORKFLOW_DOC_ID,
  indentReservesQuantity,
  indentStatusStyles,
  isLegacyIndent,
  type IndentStatus,
  type IndentWorkflowFields,
} from "@/lib/project-management-indent-workflow";
import { useProjectManagementIndentContext } from "@/components/indent/use-indent-host-context";
import {
  INDENT_GRADIENT,
  IndentAccessDenied,
  IndentLoadingState,
  IndentProjectNotFound,
} from "@/components/indent/indent-page-shell";
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
import type { WorkflowStep } from "@/lib/types";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

type BoqItem = {
  id: string;
  "BOQ SL No"?: string | number;
  "ERP SL NO"?: string | number;
  Description?: string;
  Unit?: string;
  QTY?: string | number;
  "Budget Price"?: string | number;
  "Scope 1"?: string;
  "Scope 2"?: string;
  "Start Date"?: string;
  "End Date"?: string;
  [key: string]: unknown;
};

type IndentLineItem = {
  boqItemId: string;
  boqSlNo: string;
  description: string;
  unit: string;
  boqQty: number;
  requestedQty: number;
  budgetPrice: number;
  lineTotal: number;
};

type IndentRecord = IndentWorkflowFields & {
  id: string;
  indentNumber: string;
  indentDate: string;
  requiredDate?: string;
  remarks?: string;
  status: IndentStatus;
  items: IndentLineItem[];
  totalAmount: number;
  createdAt?: unknown;
  createdByName?: string;
};

const toNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatQuantity = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

const getTimestampMillis = (value: unknown) => {
  if (value && typeof value === "object" && "toMillis" in value) {
    const toMillis = (value as { toMillis?: () => number }).toMillis;
    return typeof toMillis === "function" ? toMillis.call(value) : 0;
  }
  return 0;
};

// Older indent documents were stored as a single flat item rather than an `items` array.
function normalizeIndentDoc(
  id: string,
  data: Record<string, any>,
  boqItemsById: Map<string, BoqItem>,
): IndentRecord {
  if (Array.isArray(data.items)) {
    const items = data.items as IndentLineItem[];
    return {
      id,
      indentNumber: data.indentNumber,
      indentDate: data.indentDate,
      requiredDate: data.requiredDate,
      remarks: data.remarks,
      status: data.status,
      items,
      totalAmount:
        typeof data.totalAmount === "number"
          ? data.totalAmount
          : items.reduce((total, item) => total + toNumber(item.lineTotal), 0),
      createdAt: data.createdAt,
      createdByName: data.createdByName,
      workflowEnrolled: data.workflowEnrolled,
      currentStepIndex: data.currentStepIndex,
      currentStepName: data.currentStepName,
      assignees: data.assignees,
      actionLogs: data.actionLogs,
    };
  }

  const boqItem = boqItemsById.get(data.boqItemId);
  const requestedQty = toNumber(data.requestedQty);
  const budgetPrice = toNumber(boqItem?.["Budget Price"]);
  const lineTotal = Math.round(budgetPrice * requestedQty * 100) / 100;
  const legacyItem: IndentLineItem = {
    boqItemId: data.boqItemId,
    boqSlNo: data.boqSlNo,
    description: data.description,
    unit: data.unit,
    boqQty: toNumber(data.boqQty),
    requestedQty,
    budgetPrice,
    lineTotal,
  };

  return {
    id,
    indentNumber: data.indentNumber,
    indentDate: data.indentDate,
    requiredDate: data.requiredDate,
    remarks: data.remarks,
    status: data.status,
    items: [legacyItem],
    totalAmount: lineTotal,
    createdAt: data.createdAt,
    createdByName: data.createdByName,
    workflowEnrolled: data.workflowEnrolled,
    currentStepIndex: data.currentStepIndex,
    currentStepName: data.currentStepName,
    assignees: data.assignees,
    actionLogs: data.actionLogs,
  };
}

/** One icon per indent status, so a status reads the same in the sidebar as in the table. */
const STATUS_ICONS: Partial<Record<IndentStatus, typeof ListChecks>> = {
  Draft: FilePlus2,
  Submitted: SendHorizontal,
  Approved: ClipboardList,
  Rejected: Trash2,
  Cancelled: Trash2,
};

export default function ProjectIndentRegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound } = useProjectManagementIndentContext(mappingId);

  const canView =
    can("View", PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canAdd =
    can("Add", PERMISSION_RESOURCE) || can("Import", "Project Management.BOQ");
  const canDelete =
    can("Delete", PERMISSION_RESOURCE) || can("Import", "Project Management.BOQ");

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [indents, setIndents] = useState<IndentRecord[]>([]);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");
  const [submittingId, setSubmittingId] = useState("");

  const loadData = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(
        doc(db, "projectManagementProjects", mappingId),
      );
      if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
      const mappingData = {
        id: mappingSnapshot.id,
        ...mappingSnapshot.data(),
      } as ProjectMapping;
      if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");

      const [projectSnapshot, boqSnapshot, indentSnapshot, workflowSnapshot] = await Promise.all([
        getDoc(doc(db, "projects", mappingData.globalProjectId)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "indents")),
        getDoc(doc(db, "workflows", INDENT_WORKFLOW_DOC_ID)),
      ]);
      // The parent projects/{id} document is not needed here — the indents and BOQ items this
      // screen reads live in subcollections, addressable by id alone. Requiring it killed the page
      // for a freshly mapped project whose parent document has not been written.

      const rawSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : DEFAULT_INDENT_STEPS;
      setSteps(
        (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) })),
      );

      const nextBoqItems = boqSnapshot.docs
        .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }) as BoqItem)
        .sort((left, right) =>
          String(left["BOQ SL No"] ?? left["ERP SL NO"] ?? "").localeCompare(
            String(right["BOQ SL No"] ?? right["ERP SL NO"] ?? ""),
            undefined,
            { numeric: true },
          ),
        );
      const boqItemsById = new Map(nextBoqItems.map((item) => [item.id, item]));
      const nextIndents = indentSnapshot.docs
        .map((indentDoc) => normalizeIndentDoc(indentDoc.id, indentDoc.data(), boqItemsById))
        .sort((left, right) => getTimestampMillis(right.createdAt) - getTimestampMillis(left.createdAt));

      setMapping(mappingData);
      setBoqItems(nextBoqItems);
      setIndents(nextIndents);
    } catch (error) {
      console.error("Failed to load project indents:", error);
      toast({
        title: "Unable to load Indent module",
        description: error instanceof Error ? error.message : "Project indent data could not be loaded.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, toast]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  /**
   * Status is this register's navigation.
   *
   * The screen had no filtering at all — every indent in one list, whatever its state, so "what is
   * waiting on me to approve" meant reading the Status column down the page. The statuses are the
   * natural views here, and each one carries its count, so the sidebar answers that question
   * without opening anything. Kept in `?view=` so a refresh or a shared link keeps the filter.
   */
  const activeTab = searchParams?.get("view") || "all";
  const setActiveTab = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "all") params.delete("view");
    else params.set("view", value);
    // Path from the same helper every other link here uses, so it cannot drift from the route.
    const path = context.indentHref("register").split("?")[0];
    const query = params.toString();
    router.replace(query ? `${path}?${query}` : path);
  };

  const countsByStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const indent of indents) {
      counts.set(indent.status, (counts.get(indent.status) ?? 0) + 1);
    }
    return counts;
  }, [indents]);

  const filteredIndents = useMemo(
    () => (activeTab === "all" ? indents : indents.filter((indent) => indent.status === activeTab)),
    [indents, activeTab],
  );

  // Figures follow the filter, so they describe what is actually on screen rather than the whole
  // register — a total that ignores the active filter is a total nobody can reconcile.
  const totalRequestedQty = useMemo(
    () =>
      filteredIndents.reduce(
        (total, indent) => total + indent.items.reduce((sum, item) => sum + toNumber(item.requestedQty), 0),
        0,
      ),
    [filteredIndents],
  );
  const totalIndentValue = useMemo(
    () => filteredIndents.reduce((total, indent) => total + toNumber(indent.totalAmount), 0),
    [filteredIndents],
  );

  const exportIndents = async () => {
    await exportWorkbook(`indents-${mapping?.projectName || "project"}.xlsx`, [
      {
        name: "Indents",
        columns: [
          { header: "Indent No.", key: "indentNumber", width: 20 },
          { header: "Indent Date", key: "indentDate", width: 14 },
          { header: "Required Date", key: "requiredDate", width: 14 },
          { header: "Status", key: "status", width: 14 },
          { header: "Items", key: "itemCount", width: 10 },
          { header: "Total Amount", key: "totalAmount", width: 16 },
          { header: "Remarks", key: "remarks", width: 30 },
        ],
        rows: indents.map((indent) => ({
          indentNumber: indent.indentNumber,
          indentDate: formatDate(indent.indentDate),
          requiredDate: formatDate(indent.requiredDate),
          status: indent.status,
          itemCount: indent.items?.length ?? 0,
          totalAmount: toNumber(indent.totalAmount),
          remarks: indent.remarks || "",
        })),
      },
    ]);
  };

  const handleDelete = async (indent: IndentRecord) => {
    if (!mapping || indent.status !== "Draft") return;
    setDeletingId(indent.id);
    try {
      await deleteDoc(doc(db, "projects", mapping.globalProjectId, "indents", indent.id));
      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: "Delete Draft Indent",
          details: { indentNumber: indent.indentNumber, project: mapping.projectName },
        });
      }
      toast({ title: "Draft indent deleted" });
      await loadData();
    } catch (error) {
      console.error("Failed to delete indent:", error);
      toast({ title: "Unable to delete indent", variant: "destructive" });
    } finally {
      setDeletingId("");
    }
  };

  const handleSubmitForApproval = async (indent: IndentRecord) => {
    if (!mapping || !user || indent.status !== "Draft") return;
    setSubmittingId(indent.id);
    try {
      const result = await submitIndentForApproval({
        projectId: mapping.globalProjectId,
        indentId: indent.id,
        steps,
        actor: { id: user.id, name: user.name },
        resolveAssignees: (step) =>
          getAssigneeForStep(step, {
            projectId: mapping.globalProjectId,
            departmentId: "",
            amount: toNumber(indent.totalAmount),
          }),
        resolveDeadline: async (step) => {
          try {
            return await calculateDeadline(new Date(), step.tat);
          } catch {
            // Working hours aren't configured — submit anyway, just without a deadline.
            return null;
          }
        },
      });

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Submit Indent",
        details: { indentNumber: indent.indentNumber, project: mapping.projectName },
      });

      toast({
        title: result.reserves ? "Indent approved" : "Indent submitted",
        description: result.reserves
          ? "No workflow is configured, so it was approved and now reserves BOQ quantity."
          : `Routed to ${steps[0]?.name ?? "review"}.`,
      });
      await loadData();
    } catch (error) {
      console.error("Failed to submit indent:", error);
      toast({
        title: "Unable to submit indent",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmittingId("");
    }
  };

  const toggleExpanded = (indentId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      next.has(indentId) ? next.delete(indentId) : next.add(indentId);
      return next;
    });
  };

  if (isAuthLoading || isResolving || isLoading) {
    return <IndentLoadingState />;
  }

  if (!canView) {
    return <IndentAccessDenied description="You do not have permission to view Project Management indents." />;
  }

  if (notFound || !mappingId || !mapping) {
    return (
      <IndentProjectNotFound
        description="Return to Project Management and choose a project before opening Indent."
        href="/project-management"
      />
    );
  }

  return (
    <PmShell
      sidebar={
        <PmSidebar
          title="Indent Register"
          subtitle={mapping.projectName}
          icon={ListChecks}
          gradient={INDENT_GRADIENT}
          activeValue={activeTab}
          onChange={setActiveTab}
          groups={[
            {
              label: "Status",
              views: [
                { value: "all", label: "All indents", icon: ListChecks, color: "text-slate-600", bg: "bg-slate-100", count: indents.length },
                ...INDENT_STATUSES.map((status, index) => {
                  const accent = pmAccent(index);
                  return {
                    value: status,
                    label: status,
                    icon: STATUS_ICONS[status] ?? ListChecks,
                    color: accent.color,
                    bg: accent.bg,
                    count: countsByStatus.get(status) ?? 0,
                  };
                }),
              ],
            },
          ]}
          // Neither is reachable from the topbar: the back button goes to the Indent hub, and the
          // primary action goes to the new-indent form.
          footerLinks={[
            {
              href: `/project-management/requirement-planner?project=${encodeURIComponent(mappingId)}`,
              label: "Requirement planner",
              icon: CalendarClock,
              color: "text-cyan-600",
              bg: "bg-cyan-100",
            },
            {
              href: context.indentHref("settings/workflow-configuration"),
              label: "Workflow configuration",
              icon: Settings,
              color: "text-slate-600",
              bg: "bg-slate-100",
            },
          ]}
        />
      }
    >
      <PmTopbar
        title="Indent Register"
        breadcrumbs={[
          { label: mapping.projectName, href: `/project-management?project=${encodeURIComponent(mappingId)}` },
          { label: "Indent", href: context.indentHref() },
        ]}
        backHref={context.indentHref()}
        backLabel="Back to Indent"
        actions={
          <>
            {indents.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportIndents}>
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            )}
            <Button size="sm" asChild disabled={!canAdd || !boqItems.length}>
              <Link href={context.indentHref("new")}>
                <Plus className="mr-2 h-4 w-4" /> New indent
              </Link>
            </Button>
          </>
        }
      />

      <PmContent>
        {!canAdd && (
          <p className="mb-3 text-xs text-destructive">
            You don&apos;t have permission to add indents. Ask an admin to grant &quot;Add&quot; under Project Management &rsaquo; Indent in Role Management.
          </p>
        )}
        {canAdd && !boqItems.length && (
          <p className="mb-3 text-xs text-muted-foreground">
            No BOQ items found for this project. Import the BOQ first.
          </p>
        )}

        {/* The four stat cards this replaces cost about ninety vertical pixels to say what fits on
            one line beside the heading. */}
        <PmSectionHead
          title={activeTab === "all" ? "Indents" : `${activeTab} indents`}
          stats={[
            { label: filteredIndents.length === 1 ? "indent" : "indents", value: String(filteredIndents.length) },
            { label: "requested qty", value: formatQuantity(totalRequestedQty) },
            { label: "indent value", value: formatCurrency(totalIndentValue) },
            { label: "BOQ items available", value: String(boqItems.length) },
          ]}
        />

      {/* The card's title said "Indents" directly under a heading that already says it. What was
          worth keeping is the rule about reservation, which is not obvious from the table. */}
      <p className="mb-3 max-w-4xl text-[13px] text-muted-foreground">
        Each indent can contain multiple BOQ items. Only approved indents reserve quantity from
        their linked BOQ items — submit a draft to send it for approval. Indents raised before the
        workflow existed are marked <span className="font-medium text-foreground">Legacy</span> and
        keep their reservation.
      </p>

      <Card className="overflow-hidden border-border/60">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className={PM_TABLE_CLASS}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Indent No.</TableHead>
                  <TableHead>Indent Date</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total Qty</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead>Required Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredIndents.length ? filteredIndents.map((indent) => {
                  const isExpanded = expandedIds.has(indent.id);
                  const totalQty = indent.items.reduce((sum, item) => sum + toNumber(item.requestedQty), 0);

                  return (
                    <Fragment key={indent.id}>
                      <TableRow className="cursor-pointer" onClick={() => toggleExpanded(indent.id)}>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <Button variant="ghost" size="icon" onClick={() => toggleExpanded(indent.id)} aria-label={isExpanded ? "Collapse" : "Expand"}>
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">{indent.indentNumber}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(indent.indentDate)}</TableCell>
                        <TableCell>{indent.items.length}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatQuantity(totalQty)}</TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{formatCurrency(indent.totalAmount)}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(indent.requiredDate)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={indentStatusStyles[indent.status] ?? ""}>
                            {indent.status}
                          </Badge>
                          <div className="mt-1 space-y-0.5">
                            {indent.status === "Submitted" && indent.currentStepName && (
                              <p className="text-xs text-muted-foreground">at {indent.currentStepName}</p>
                            )}
                            {isLegacyIndent(indent) && (
                              <p className="text-xs text-muted-foreground" title="Raised before the approval workflow existed — keeps its BOQ reservation.">
                                Legacy
                              </p>
                            )}
                            <p className={`text-xs ${indentReservesQuantity(indent) ? "text-emerald-700" : "text-muted-foreground"}`}>
                              {indentReservesQuantity(indent) ? "Reserves BOQ qty" : "No reservation"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                          {indent.status === "Draft" && canAdd && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mr-1"
                              disabled={submittingId === indent.id}
                              onClick={() => void handleSubmitForApproval(indent)}
                            >
                              {submittingId === indent.id ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <SendHorizontal className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Submit
                            </Button>
                          )}
                          {indent.status === "Draft" && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" disabled={!canDelete || deletingId === indent.id} aria-label={`Delete ${indent.indentNumber}`}>
                                  {deletingId === indent.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>Delete draft indent?</AlertDialogTitle><AlertDialogDescription>This releases all reserved BOQ quantities in this indent. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void handleDelete(indent)}>Delete Draft</AlertDialogAction></AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableCell colSpan={9} className="p-0">
                            <div className="p-3">
                              {indent.remarks && (
                                <p className="mb-2 px-1 text-sm text-muted-foreground">
                                  <span className="font-medium text-foreground">Remarks: </span>{indent.remarks}
                                </p>
                              )}
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>BOQ SL No</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Qty</TableHead>
                                    <TableHead>Budget Price</TableHead>
                                    <TableHead>Line Total</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {indent.items.map((item, index) => (
                                    <TableRow key={`${indent.id}-${item.boqItemId}-${index}`}>
                                      <TableCell>{item.boqSlNo || "—"}</TableCell>
                                      <TableCell className="max-w-sm truncate" title={item.description}>{item.description || "—"}</TableCell>
                                      <TableCell className="whitespace-nowrap">{formatQuantity(item.requestedQty)} {item.unit}</TableCell>
                                      <TableCell className="whitespace-nowrap">{formatCurrency(item.budgetPrice)}</TableCell>
                                      <TableCell className="whitespace-nowrap font-medium">{formatCurrency(item.lineTotal)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                }) : (
                  <TableRow>
                    <TableCell colSpan={9} className="h-36 text-center">
                      <ListChecks className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">
                        {indents.length ? `No ${activeTab} indents` : "No indents created"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {indents.length
                          ? "Pick another status in the sidebar to see the rest of the register."
                          : "Create the first indent against one or more BOQ items."}
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {filteredIndents.length > 0 && (
            <PmTableFoot
              left={<>Showing <b className="font-semibold tabular-nums text-foreground">{filteredIndents.length}</b> of <b className="font-semibold tabular-nums text-foreground">{indents.length}</b> indents</>}
              right={<>Indent value <b className="font-semibold tabular-nums text-foreground">{formatCurrency(totalIndentValue)}</b></>}
            />
          )}
        </CardContent>
      </Card>

      {!boqItems.length && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <CalendarDays className="h-9 w-9 text-muted-foreground" />
            <div><p className="font-medium">No BOQ items available</p><p className="text-sm text-muted-foreground">Import or configure the project BOQ before creating an indent.</p></div>
            <Button variant="outline" asChild><Link href={`/project-management/boq?project=${encodeURIComponent(mappingId)}`}>Open BOQ</Link></Button>
          </CardContent>
        </Card>
      )}
      </PmContent>
    </PmShell>
  );
}
