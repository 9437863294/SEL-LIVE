"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Download,
  HardHat,
  Loader2,
  Pencil,
  Plus,
  RadioTower,
  RefreshCw,
  Ruler,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { projectBoqValue } from "@/lib/project-management-dashboard";
import {
  JMC_ENTRY_COLLECTION,
  MVAC_ENTRY_COLLECTION,
  SUBCONTRACTOR_BILL_COLLECTION,
  WORK_ORDER_COLLECTION,
  aggregateMeasurementsByBoqKey,
  aggregateSubcontractorBillsByBoqItem,
  aggregateWorkOrdersByBoqItem,
  civilBoqKeyOfBoqItem,
  readBoqSlNo,
  type MeasurementEntryLike,
  type SubcontractorBillLike,
  type WorkOrderLike,
} from "@/lib/civil-execution";
import {
  reconcileBoqQuantities,
  quantityExceptionStyles,
} from "@/lib/boq-quantity-control";
import { DEFAULT_VARIATION_TOLERANCE_PCT } from "@/lib/project-management-variations";
import { isBoqSectionHeader } from "@/lib/project-management-boq-columns";
// Single source of truth for where the JMC screens live, so this link cannot drift from the routes.
import { PM_JMC_BASE_PATH } from "@/lib/jmc-module";
import {
  TOWER_PROGRESS_PERMISSION_RESOURCE,
  towerProgressHref,
} from "@/lib/project-management-tower-progress";
import {
  WORK_PACKAGE_COLLECTION,
  WORK_PACKAGE_PRIORITIES,
  WORK_PACKAGE_STATUSES,
  calculateWorkPackageSummary,
  isWorkPackageOverdue,
  validateWorkPackage,
  type ProjectWorkPackage,
  type ProjectWorkPackageDraft,
  type WorkPackagePriority,
  type WorkPackageScope,
  type WorkPackageStatus,
} from "@/lib/project-management-work-packages";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Progress } from "@/components/ui/progress";
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
import { cn } from "@/lib/utils";

type ScopeExecutionWorkspaceProps = {
  mappingId: string;
  scope: WorkPackageScope;
};

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

const emptyDraft = (scope: WorkPackageScope): ProjectWorkPackageDraft => ({
  scope,
  title: "",
  description: "",
  location: "",
  ownerName: "",
  contractor: "",
  priority: "Medium",
  status: "Not Started",
  plannedStartDate: "",
  plannedEndDate: "",
  actualStartDate: "",
  actualEndDate: "",
  progressPct: 0,
  blocker: "",
  nextAction: "",
});

const statusStyles: Record<WorkPackageStatus, string> = {
  "Not Started": "bg-slate-100 text-slate-700",
  "In Progress": "bg-blue-100 text-blue-700",
  Blocked: "bg-red-100 text-red-700",
  "On Hold": "bg-amber-100 text-amber-700",
  Completed: "bg-emerald-100 text-emerald-700",
};

const priorityStyles: Record<WorkPackagePriority, string> = {
  Low: "border-slate-200 text-slate-600",
  Medium: "border-blue-200 text-blue-700",
  High: "border-orange-200 text-orange-700",
  Critical: "border-red-200 text-red-700",
};

const scopeTheme = {
  Civil: {
    gradient: "from-stone-500 to-stone-700",
    description: "Civil work packages, ownership, progress, dates, and site blockers",
  },
  Erection: {
    gradient: "from-orange-500 to-red-600",
    description: "Erection work packages, ownership, progress, dates, and site blockers",
  },
} as const;

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const escapeCsvCell = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const CONCURRENT_UPDATE_ERROR = "WORK_PACKAGE_CONCURRENT_UPDATE";

const revisionOf = (value: unknown): string => {
  if (!value || typeof value !== "object") return "";
  const timestamp = value as { seconds?: unknown; nanoseconds?: unknown; toMillis?: () => number };
  if (typeof timestamp.toMillis === "function") return String(timestamp.toMillis());
  return `${String(timestamp.seconds ?? "")}:${String(timestamp.nanoseconds ?? "")}`;
};

export default function ScopeExecutionWorkspace({ mappingId, scope }: ScopeExecutionWorkspaceProps) {
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();
  const resource = `Project Management.${scope}`;
  const canView = can("View", resource) || can("View", "Project Management.BOQ");
  const canAdd = can("Add", resource);
  const canEdit = can("Edit", resource);
  const canDelete = can("Delete", resource);
  const canExport = can("Export", resource) || can("Export", "Project Management.BOQ");
  // JMC is hosted by both modules against the same registers, so either module's view right opens it.
  const canViewJmc = can("View", "Project Management.JMC") || can("View", "Billing Recon.JMC");
  // Tower Progress has its own resource, but an existing Erection view right also opens it — the
  // feature would otherwise be invisible to the site engineers who already hold Erection rights
  // until every role had been edited.
  const canViewTowerProgress = can("View", TOWER_PROGRESS_PERMISSION_RESOURCE) || canView;

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [packages, setPackages] = useState<ProjectWorkPackage[]>([]);
  const [boqStats, setBoqStats] = useState({ itemCount: 0, value: 0 });
  const [scopeBoqItems, setScopeBoqItems] = useState<Array<Record<string, unknown> & { id: string }>>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderLike[]>([]);
  const [measurementEntries, setMeasurementEntries] = useState<MeasurementEntryLike[]>([]);
  const [subcontractorBills, setSubcontractorBills] = useState<SubcontractorBillLike[]>([]);
  const [tolerancePct, setTolerancePct] = useState(DEFAULT_VARIATION_TOLERANCE_PCT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkPackageStatus | "All">("All");
  const [priorityFilter, setPriorityFilter] = useState<WorkPackagePriority | "All">("All");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<ProjectWorkPackage | null>(null);
  const [draft, setDraft] = useState<ProjectWorkPackageDraft>(() => emptyDraft(scope));
  const [deleteTarget, setDeleteTarget] = useState<ProjectWorkPackage | null>(null);

  const loadData = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) {
        setMapping(null);
        setPackages([]);
        return;
      }
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      setMapping(mappingData);
      const [
        boqSnapshot,
        packageSnapshot,
        workOrderSnapshot,
        jmcEntrySnapshot,
        mvacEntrySnapshot,
        subBillSnapshot,
        settingsSnapshot,
      ] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, WORK_PACKAGE_COLLECTION)),
        // Civil registers owned by Billing Recon / Subcontractors Management — read-only join
        // (see src/lib/civil-execution.ts).
        getDocs(collection(db, "projects", mappingData.globalProjectId, WORK_ORDER_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, JMC_ENTRY_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, MVAC_ENTRY_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, SUBCONTRACTOR_BILL_COLLECTION)),
        getDoc(doc(db, "projectManagementSettings", "general")),
      ]);

      const scopeBoq = boqSnapshot.docs
        .map(
          (boqDoc) =>
            ({ id: boqDoc.id, ...boqDoc.data() }) as Record<string, unknown> & { id: string },
        )
        .filter(
          (item) => String(item["Scope 2"] ?? "").trim().toLowerCase() === scope.toLowerCase(),
        );
      setBoqStats({
        itemCount: scopeBoq.length,
        value: scopeBoq.reduce((sum, item) => sum + projectBoqValue(item), 0),
      });
      setScopeBoqItems(scopeBoq);
      setWorkOrders(
        workOrderSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkOrderLike),
      );
      setMeasurementEntries([
        ...jmcEntrySnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as MeasurementEntryLike),
        ...mvacEntrySnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as MeasurementEntryLike),
      ]);
      setSubcontractorBills(
        subBillSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as SubcontractorBillLike),
      );
      const storedTolerance = settingsSnapshot.data()?.variationTolerancePct;
      setTolerancePct(
        typeof storedTolerance === "number" ? storedTolerance : DEFAULT_VARIATION_TOLERANCE_PCT,
      );
      setPackages(
        packageSnapshot.docs
          .map((packageDoc) => ({ id: packageDoc.id, ...packageDoc.data() }) as ProjectWorkPackage)
          .filter((workPackage) => workPackage.scope === scope)
          .sort((a, b) => a.plannedEndDate.localeCompare(b.plannedEndDate)),
      );
    } catch (error) {
      console.error(`Failed to load ${scope} execution data:`, error);
      setLoadError(`The ${scope} execution register could not be loaded.`);
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, scope]);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  const summary = useMemo(() => calculateWorkPackageSummary(packages), [packages]);

  /** Per-BOQ-line coverage: subcontract commitment, joint measurement, and subcontractor billing
   * joined onto each line of this scope's BOQ, with its quantity ladder reconciled. */
  const coverageRows = useMemo(() => {
    const workOrderAgg = aggregateWorkOrdersByBoqItem(workOrders);
    const measurementAgg = aggregateMeasurementsByBoqKey(measurementEntries);
    const billAgg = aggregateSubcontractorBillsByBoqItem(subcontractorBills);
    return scopeBoqItems
      .filter((item) => !isBoqSectionHeader(item as { Unit?: unknown; QTY?: unknown }))
      .map((item) => {
        const workOrder = workOrderAgg.get(item.id);
        const measurement = measurementAgg.get(civilBoqKeyOfBoqItem(item));
        const bill = billAgg.get(item.id);
        const boqQty = Number(String(item.QTY ?? "").replace(/,/g, "").trim()) || 0;
        const surveyedQty = typeof item.surveyedQty === "number" ? item.surveyedQty : undefined;
        const ledger = reconcileBoqQuantities({
          lane: "civil",
          boqQty,
          surveyedQty,
          woOrderedQty: workOrder?.orderedQty,
          executedQty: measurement?.executedQty,
          jmcQty: measurement?.certifiedQty,
          subcontractorBilledQty: bill?.billedQty,
          approvedVariationQty:
            typeof item.variationApprovedQty === "number" ? item.variationApprovedQty : 0,
          tolerancePct,
        });
        return { item, workOrder, measurement, bill, boqQty, surveyedQty, ledger };
      });
  }, [scopeBoqItems, workOrders, measurementEntries, subcontractorBills, tolerancePct]);

  const coverageHasData = useMemo(
    () => coverageRows.some((row) => row.workOrder || row.measurement || row.bill),
    [coverageRows],
  );

  const filteredPackages = useMemo(() => {
    const term = search.trim().toLowerCase();
    return packages.filter((workPackage) => {
      if (statusFilter !== "All" && workPackage.status !== statusFilter) return false;
      if (priorityFilter !== "All" && workPackage.priority !== priorityFilter) return false;
      if (!term) return true;
      return [
        workPackage.title,
        workPackage.description,
        workPackage.location,
        workPackage.ownerName,
        workPackage.contractor,
        workPackage.blocker,
        workPackage.nextAction,
      ].some((value) => String(value ?? "").toLowerCase().includes(term));
    });
  }, [packages, priorityFilter, search, statusFilter]);

  const openCreate = () => {
    setEditingPackage(null);
    setDraft(emptyDraft(scope));
    setIsDialogOpen(true);
  };

  const openEdit = (workPackage: ProjectWorkPackage) => {
    setEditingPackage(workPackage);
    setDraft({
      scope,
      title: workPackage.title,
      description: workPackage.description ?? "",
      location: workPackage.location ?? "",
      ownerName: workPackage.ownerName,
      contractor: workPackage.contractor ?? "",
      priority: workPackage.priority,
      status: workPackage.status,
      plannedStartDate: workPackage.plannedStartDate,
      plannedEndDate: workPackage.plannedEndDate,
      actualStartDate: workPackage.actualStartDate ?? "",
      actualEndDate: workPackage.actualEndDate ?? "",
      progressPct: workPackage.progressPct,
      blocker: workPackage.blocker ?? "",
      nextAction: workPackage.nextAction ?? "",
    });
    setIsDialogOpen(true);
  };

  const updateDraft = <K extends keyof ProjectWorkPackageDraft>(
    key: K,
    value: ProjectWorkPackageDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const handleStatusChange = (status: WorkPackageStatus) => {
    setDraft((current) => ({
      ...current,
      status,
      progressPct: status === "Completed" ? 100 : status === "Not Started" ? 0 : current.progressPct,
      actualEndDate:
        status === "Completed" && !current.actualEndDate
          ? new Date().toISOString().slice(0, 10)
          : current.actualEndDate,
    }));
  };

  const handleSave = async () => {
    if (!mapping || !user) return;
    const normalized: ProjectWorkPackageDraft = {
      ...draft,
      title: draft.title.trim(),
      description: draft.description?.trim() ?? "",
      location: draft.location?.trim() ?? "",
      ownerName: draft.ownerName.trim(),
      contractor: draft.contractor?.trim() ?? "",
      blocker: draft.blocker?.trim() ?? "",
      nextAction: draft.nextAction?.trim() ?? "",
      progressPct: Number(draft.progressPct),
    };
    const errors = validateWorkPackage(normalized);
    if (errors.length) {
      toast({
        title: "Complete the work package",
        description: errors[0].message,
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const packageRef = editingPackage
        ? doc(db, "projects", mapping.globalProjectId, WORK_PACKAGE_COLLECTION, editingPackage.id)
        : doc(collection(db, "projects", mapping.globalProjectId, WORK_PACKAGE_COLLECTION));
      const payload = {
        ...normalized,
        updatedAt: serverTimestamp(),
        updatedBy: user.id,
        updatedByName: user.name,
        ...(!editingPackage
          ? {
              createdAt: serverTimestamp(),
              createdBy: user.id,
              createdByName: user.name,
            }
          : {}),
      };
      if (editingPackage) {
        await runTransaction(db, async (transaction) => {
          const currentSnapshot = await transaction.get(packageRef);
          if (!currentSnapshot.exists()) throw new Error(CONCURRENT_UPDATE_ERROR);
          if (revisionOf(currentSnapshot.data().updatedAt) !== revisionOf(editingPackage.updatedAt)) {
            throw new Error(CONCURRENT_UPDATE_ERROR);
          }
          transaction.set(packageRef, payload, { merge: true });
        });
      } else {
        await setDoc(packageRef, payload, { merge: true });
      }
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: `${editingPackage ? "Update" : "Create"} ${scope} Work Package`,
        details: {
          project: mapping.projectName,
          workPackageId: packageRef.id,
          title: normalized.title,
          status: normalized.status,
          progressPct: normalized.progressPct,
        },
      });
      toast({ title: `Work package ${editingPackage ? "updated" : "created"}` });
      setIsDialogOpen(false);
      setEditingPackage(null);
      await loadData();
    } catch (error) {
      console.error(`Failed to save ${scope} work package:`, error);
      const concurrent = error instanceof Error && error.message === CONCURRENT_UPDATE_ERROR;
      toast({
        title: concurrent ? "This work package changed" : "Unable to save work package",
        description: concurrent
          ? "Another user updated or removed it. Refresh the register before editing again."
          : undefined,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!mapping || !user || !deleteTarget) return;
    setIsSaving(true);
    try {
      const packageRef = doc(
        db,
        "projects",
        mapping.globalProjectId,
        WORK_PACKAGE_COLLECTION,
        deleteTarget.id,
      );
      await runTransaction(db, async (transaction) => {
        const currentSnapshot = await transaction.get(packageRef);
        if (!currentSnapshot.exists()) return;
        if (revisionOf(currentSnapshot.data().updatedAt) !== revisionOf(deleteTarget.updatedAt)) {
          throw new Error(CONCURRENT_UPDATE_ERROR);
        }
        transaction.delete(packageRef);
      });
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: `Delete ${scope} Work Package`,
        details: {
          project: mapping.projectName,
          workPackageId: deleteTarget.id,
          title: deleteTarget.title,
        },
      });
      toast({ title: "Work package deleted" });
      setDeleteTarget(null);
      await loadData();
    } catch (error) {
      console.error(`Failed to delete ${scope} work package:`, error);
      const concurrent = error instanceof Error && error.message === CONCURRENT_UPDATE_ERROR;
      toast({
        title: concurrent ? "This work package changed" : "Unable to delete work package",
        description: concurrent
          ? "Another user updated it. Refresh before deciding whether to delete it."
          : undefined,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleExport = () => {
    const headers = [
      "Title",
      "Location",
      "Owner",
      "Contractor",
      "Priority",
      "Status",
      "Progress %",
      "Planned Start",
      "Planned End",
      "Actual Start",
      "Actual End",
      "Blocker",
      "Next Action",
      "Description",
    ];
    const rows = filteredPackages.map((workPackage) => [
      workPackage.title,
      workPackage.location,
      workPackage.ownerName,
      workPackage.contractor,
      workPackage.priority,
      workPackage.status,
      workPackage.progressPct,
      workPackage.plannedStartDate,
      workPackage.plannedEndDate,
      workPackage.actualStartDate,
      workPackage.actualEndDate,
      workPackage.blocker,
      workPackage.nextAction,
      workPackage.description,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${mapping?.projectName ?? "project"}-${scope.toLowerCase()}-work-packages.csv`
      .replace(/[^a-z0-9.-]+/gi, "-")
      .toLowerCase();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view {scope} execution.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!mappingId || !mapping) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Select a project first</CardTitle>
            <CardDescription>Return to Project Management and choose a valid project.</CardDescription>
          </CardHeader>
          <CardContent><Button asChild><Link href="/project-management">Select Project</Link></Button></CardContent>
        </Card>
      </main>
    );
  }

  const theme = scopeTheme[scope];

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/project-management?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Project Management">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm", theme.gradient)}>
            <HardHat className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{scope} Execution</h1>
            <p className="text-sm text-muted-foreground">{theme.description} for {mapping.projectName}.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Tower Progress is the erection lane's tower-wise execution register — the seven
              construction activities per tower with their photographic evidence, and the reporting
              engine over them (see src/lib/project-management-tower-progress.ts). Erection only:
              a civil scope has no tower schedule to run it against. */}
          {scope === "Erection" && canViewTowerProgress && (
            <Button variant="outline" asChild>
              <Link href={towerProgressHref(mappingId)}>
                <RadioTower className="mr-2 h-4 w-4" />Tower Progress
              </Link>
            </Button>
          )}
          {/* JMC is the civil lane's measurement register — the same screens Billing Recon hosts,
              rendered here against this project (see src/lib/jmc-module.ts). */}
          {canViewJmc && (
            <Button variant="outline" asChild>
              <Link href={`${PM_JMC_BASE_PATH}?project=${encodeURIComponent(mappingId)}`}>
                <Ruler className="mr-2 h-4 w-4" />JMC
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => void loadData()}>
            <RefreshCw className="mr-2 h-4 w-4" />Refresh
          </Button>
          {canExport && packages.length > 0 && (
            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />Export
            </Button>
          )}
          {canAdd && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />Add Work Package
            </Button>
          )}
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Execution register unavailable</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Average progress", value: `${summary.averageProgressPct}%`, detail: `${summary.total} work packages` },
          { label: "Completed", value: summary.completed, detail: "Closed packages" },
          { label: "Blocked", value: summary.blocked, detail: "Need intervention", danger: summary.blocked > 0 },
          { label: "Overdue", value: summary.overdue, detail: "Past planned end", danger: summary.overdue > 0 },
          { label: `${scope} BOQ`, value: formatCurrency(boqStats.value), detail: `${boqStats.itemCount} BOQ lines` },
        ].map((metric) => (
          <Card key={metric.label} className={cn(metric.danger && "border-red-200 bg-red-50/50")}>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
              <p className="mt-1 text-xl font-bold">{metric.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {summary.total > 0 && <Progress value={summary.averageProgressPct} className="h-2" />}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base">Work-package register</CardTitle>
              <CardDescription>Progress is controlled against package owners and planned dates.</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative sm:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search packages..." className="pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as WorkPackageStatus | "All")}>
                <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All statuses</SelectItem>
                  {WORK_PACKAGE_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={priorityFilter} onValueChange={(value) => setPriorityFilter(value as WorkPackagePriority | "All")}>
                <SelectTrigger className="sm:w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All priorities</SelectItem>
                  {WORK_PACKAGE_PRIORITIES.map((priority) => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredPackages.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Work package</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="min-w-40">Progress</TableHead>
                    <TableHead>Planned finish</TableHead>
                    <TableHead>Next action / blocker</TableHead>
                    {(canEdit || canDelete) && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPackages.map((workPackage) => {
                    const overdue = isWorkPackageOverdue(workPackage);
                    return (
                      <TableRow key={workPackage.id} className={cn(overdue && "bg-red-50/40")}>
                        <TableCell>
                          <p className="font-medium">{workPackage.title}</p>
                          <p className="max-w-72 truncate text-xs text-muted-foreground">
                            {[workPackage.location, workPackage.contractor].filter(Boolean).join(" · ") || workPackage.description || "No additional detail"}
                          </p>
                        </TableCell>
                        <TableCell>{workPackage.ownerName}</TableCell>
                        <TableCell><Badge variant="outline" className={priorityStyles[workPackage.priority]}>{workPackage.priority}</Badge></TableCell>
                        <TableCell><Badge className={statusStyles[workPackage.status]}>{workPackage.status}</Badge></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={workPackage.progressPct} className="h-2" />
                            <span className="w-10 text-right text-xs font-medium">{workPackage.progressPct}%</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={cn("flex items-center gap-1.5 text-sm", overdue && "font-medium text-red-700")}>
                            <CalendarClock className="h-3.5 w-3.5" />
                            {formatDate(workPackage.plannedEndDate)}
                          </div>
                          {overdue && <span className="text-xs text-red-600">Overdue</span>}
                        </TableCell>
                        <TableCell>
                          <p className={cn("max-w-64 truncate text-sm", workPackage.blocker && "text-red-700")}>
                            {workPackage.blocker || workPackage.nextAction || "—"}
                          </p>
                        </TableCell>
                        {(canEdit || canDelete) && (
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              {canEdit && <Button variant="ghost" size="icon" onClick={() => openEdit(workPackage)} aria-label={`Edit ${workPackage.title}`}><Pencil className="h-4 w-4" /></Button>}
                              {canDelete && <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(workPackage)} aria-label={`Delete ${workPackage.title}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <CheckCircle2 className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-medium">{packages.length ? "No work packages match the filters" : `No ${scope.toLowerCase()} work packages yet`}</p>
                <p className="text-sm text-muted-foreground">Create packages to establish accountable owners, dates, progress, and blockers.</p>
              </div>
              {canAdd && !packages.length && <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add first work package</Button>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Subcontract & measurement coverage — the civil registers Billing Recon and
             Subcontractors Management own, joined per BOQ line ─────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Subcontract &amp; measurement coverage</CardTitle>
          <CardDescription>
            Work orders, JMC/MVAC measurement, and subcontractor billing joined onto each {scope.toLowerCase()} BOQ
            line, with every quantity checked down the ladder.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {coverageHasData ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SL No</TableHead>
                    <TableHead className="min-w-64">Description</TableHead>
                    <TableHead className="text-right">BOQ Qty</TableHead>
                    <TableHead className="text-right">Surveyed</TableHead>
                    <TableHead className="text-right">WO Qty</TableHead>
                    <TableHead>Subcontractor</TableHead>
                    <TableHead className="text-right">Executed</TableHead>
                    <TableHead className="text-right">Certified</TableHead>
                    <TableHead className="text-right">Sub-billed</TableHead>
                    <TableHead>Ladder</TableHead>
                    <TableHead className="w-20 text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {coverageRows.map(({ item, workOrder, measurement, bill, boqQty, surveyedQty, ledger }) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap text-xs">{readBoqSlNo(item) || "—"}</TableCell>
                      <TableCell className="max-w-xs">
                        <p className="truncate text-xs" title={String(item.Description ?? "")}>
                          {String(item.Description ?? "") || "—"}
                        </p>
                      </TableCell>
                      <TableCell className="text-right text-xs">{boqQty}</TableCell>
                      <TableCell className="text-right text-xs">{surveyedQty ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs">{workOrder ? workOrder.orderedQty : "—"}</TableCell>
                      <TableCell className="max-w-40 truncate text-xs" title={workOrder?.subcontractorNames.join(", ")}>
                        {workOrder?.subcontractorNames.join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs">{measurement ? measurement.executedQty : "—"}</TableCell>
                      <TableCell className="text-right text-xs">{measurement ? measurement.certifiedQty : "—"}</TableCell>
                      <TableCell className="text-right text-xs">{bill ? bill.billedQty : "—"}</TableCell>
                      <TableCell>
                        {ledger.worstSeverity ? (
                          <Badge
                            variant="outline"
                            className={quantityExceptionStyles[ledger.worstSeverity]}
                            title={ledger.exceptions.map((exception) => exception.message).join("\n")}
                          >
                            {ledger.worstSeverity}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-emerald-100 text-emerald-700">clean</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild aria-label="Open BOQ item lifecycle">
                          <Link href={`/project-management/boq/item/${encodeURIComponent(item.id)}?project=${encodeURIComponent(mappingId)}`}>
                            360°
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No work orders, measurement entries, or subcontractor bills reference this scope&apos;s BOQ lines yet.
              They are created in Subcontractors Management and Billing Recon and appear here automatically.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingPackage ? "Edit" : "Add"} {scope} work package</DialogTitle>
            <DialogDescription>Define one accountable execution package with measurable progress and dates.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="work-package-title">Title *</Label><Input id="work-package-title" value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} maxLength={160} /></div>
            <div className="space-y-2"><Label htmlFor="work-package-owner">Owner *</Label><Input id="work-package-owner" value={draft.ownerName} onChange={(event) => updateDraft("ownerName", event.target.value)} maxLength={100} /></div>
            <div className="space-y-2"><Label htmlFor="work-package-contractor">Contractor</Label><Input id="work-package-contractor" value={draft.contractor} onChange={(event) => updateDraft("contractor", event.target.value)} maxLength={120} /></div>
            <div className="space-y-2"><Label htmlFor="work-package-location">Location / chainage</Label><Input id="work-package-location" value={draft.location} onChange={(event) => updateDraft("location", event.target.value)} maxLength={120} /></div>
            <div className="space-y-2"><Label>Priority</Label><Select value={draft.priority} onValueChange={(value) => updateDraft("priority", value as WorkPackagePriority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{WORK_PACKAGE_PRIORITIES.map((priority) => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="work-package-planned-start">Planned start *</Label><Input id="work-package-planned-start" type="date" value={draft.plannedStartDate} onChange={(event) => updateDraft("plannedStartDate", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="work-package-planned-end">Planned end *</Label><Input id="work-package-planned-end" type="date" value={draft.plannedEndDate} onChange={(event) => updateDraft("plannedEndDate", event.target.value)} /></div>
            <div className="space-y-2"><Label>Status</Label><Select value={draft.status} onValueChange={(value) => handleStatusChange(value as WorkPackageStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{WORK_PACKAGE_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="work-package-progress">Progress %</Label><Input id="work-package-progress" type="number" min={0} max={100} step={1} value={draft.progressPct} onChange={(event) => updateDraft("progressPct", Number(event.target.value))} /></div>
            <div className="space-y-2"><Label htmlFor="work-package-actual-start">Actual start</Label><Input id="work-package-actual-start" type="date" value={draft.actualStartDate} onChange={(event) => updateDraft("actualStartDate", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="work-package-actual-end">Actual end</Label><Input id="work-package-actual-end" type="date" value={draft.actualEndDate} onChange={(event) => updateDraft("actualEndDate", event.target.value)} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="work-package-blocker">Current blocker {draft.status === "Blocked" ? "*" : ""}</Label><Textarea id="work-package-blocker" value={draft.blocker} onChange={(event) => updateDraft("blocker", event.target.value)} maxLength={500} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="work-package-next-action">Next action</Label><Textarea id="work-package-next-action" value={draft.nextAction} onChange={(event) => updateDraft("nextAction", event.target.value)} maxLength={500} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="work-package-description">Description</Label><Textarea id="work-package-description" value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} maxLength={1000} /></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={isSaving}>Cancel</Button></DialogClose>
            <Button onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingPackage ? "Save changes" : "Create package"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete work package?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title}” will be permanently removed from the execution register. Its audit-log entry will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void handleDelete(); }} disabled={isSaving} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
