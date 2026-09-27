"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ClipboardList,
  ListChecks,
  Search,
  ShieldAlert,
} from "lucide-react";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BoqItem } from "@/lib/types";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { computeNetRequirement } from "@/lib/project-management-variations";
import {
  DEFAULT_LEAD_TIME_DAYS,
  REQUIREMENT_PLANNER_PERMISSION_RESOURCE,
  REQUIREMENT_STATUSES,
  classifyRequirementStatus,
  computeIndentByDate,
  requirementStatusStyles,
  type RequirementStatus,
} from "@/lib/project-management-requirement-planner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PmDataList,
  PmEmptyState,
  PmToolbar,
  type PmListColumn,
} from "@/components/project-management/pm-shell";
import { PageHeader } from "@/components/shared/page-header";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

type PlannerRow = {
  boqItem: BoqItem;
  boqSlNo: string;
  description: string;
  unit: string;
  boqQty: number;
  budgetPrice: number;
  surveyedQty: number | null;
  indentedQty: number;
  netRequirement: number;
  requiredAtSiteDate: string;
};

/** A planner row with its schedule, as the list renders it — `PmDataList` needs an `id`. */
type PlannerListRow = {
  id: string;
  row: PlannerRow;
  indentByDate: string | null;
  status: RequirementStatus;
  slippageDays: number;
};

const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatQuantity = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

const getBoqSlNo = (item: BoqItem) => String(item["BOQ SL No"] ?? item["SL. No."] ?? "");

const isSupplyLane = (item: BoqItem) => String(item["Scope 2"] ?? "").trim().toLowerCase() === "supply";

export default function RequirementPlannerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView =
    can("View", REQUIREMENT_PLANNER_PERMISSION_RESOURCE) ||
    can("View", "Project Management.Indent") ||
    can("View", "Project Management.BOQ");
  const canEditSchedule = can("Edit Schedule", REQUIREMENT_PLANNER_PERMISSION_RESOURCE);
  const canCreateIndent = can("Add", "Project Management.Indent") || can("Import", "Project Management.BOQ");

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [rows, setRows] = useState<PlannerRow[]>([]);
  const [leadTimeDays, setLeadTimeDays] = useState(DEFAULT_LEAD_TIME_DAYS);
  const [isLoading, setIsLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RequirementStatus | "All">("All");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

      const [boqSnapshot, indentSnapshot, settingsSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "indents")),
        getDoc(doc(db, "projectManagementSettings", "general")),
      ]);

      const storedLeadTime = settingsSnapshot.data()?.leadTimeDays;
      setLeadTimeDays(typeof storedLeadTime === "number" ? storedLeadTime : DEFAULT_LEAD_TIME_DAYS);

      const indentedQtyByBoqItem = new Map<string, number>();
      indentSnapshot.docs.forEach((indentDoc) => {
        const data = indentDoc.data() as { status?: string; items?: Array<{ boqItemId?: string; requestedQty?: unknown }> };
        if (["Rejected", "Cancelled"].includes(data.status ?? "")) return;
        (Array.isArray(data.items) ? data.items : []).forEach((item) => {
          const id = String(item.boqItemId ?? "");
          if (!id) return;
          indentedQtyByBoqItem.set(id, (indentedQtyByBoqItem.get(id) ?? 0) + toNumber(item.requestedQty));
        });
      });

      const nextRows: PlannerRow[] = boqSnapshot.docs
        .map((boqDoc) => ({ id: boqDoc.id, ...boqDoc.data() }) as BoqItem)
        .filter(isSupplyLane)
        .map((boqItem) => {
          const boqQty = toNumber(boqItem["QTY"]);
          const surveyedQty = typeof boqItem.surveyedQty === "number" ? boqItem.surveyedQty : null;
          const baseQty = surveyedQty ?? boqQty;
          const approvedVariationQty = toNumber(boqItem.variationApprovedQty);
          const indentedQty = indentedQtyByBoqItem.get(boqItem.id) ?? 0;
          return {
            boqItem,
            boqSlNo: getBoqSlNo(boqItem),
            description: String(boqItem["Description"] ?? ""),
            unit: String(boqItem["Unit"] ?? ""),
            boqQty,
            budgetPrice: toNumber(boqItem["Budget Price"]),
            surveyedQty,
            indentedQty,
            netRequirement: computeNetRequirement(baseQty, approvedVariationQty, indentedQty),
            requiredAtSiteDate: String(boqItem.requiredAtSiteDate ?? ""),
          };
        });
      setRows(nextRows.sort((a, b) => a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true })));
    } catch (error) {
      console.error("Failed to load requirement planner data:", error);
      toast({ title: "Unable to load requirement planner data", variant: "destructive" });
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

  const rowsWithSchedule = useMemo(
    () =>
      rows.map((row) => {
        const indentByDate = computeIndentByDate(row.requiredAtSiteDate, leadTimeDays);
        const { status, slippageDays } = classifyRequirementStatus(row.netRequirement, indentByDate);
        return { row, indentByDate, status, slippageDays };
      }),
    [rows, leadTimeDays],
  );

  const lateSummary = useMemo(() => {
    const late = rowsWithSchedule.filter((item) => item.status === "Late");
    const valueAtRisk = late.reduce((sum, item) => sum + item.row.netRequirement * item.row.budgetPrice, 0);
    return { count: late.length, valueAtRisk };
  }, [rowsWithSchedule]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rowsWithSchedule.filter(({ row, status }) => {
      if (statusFilter !== "All" && status !== statusFilter) return false;
      if (term && !row.boqSlNo.toLowerCase().includes(term) && !row.description.toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [rowsWithSchedule, search, statusFilter]);

  const handleRequiredDateChange = async (boqItemId: string, value: string) => {
    if (!mapping) return;
    setRows((current) =>
      current.map((row) => (row.boqItem.id === boqItemId ? { ...row, requiredAtSiteDate: value } : row)),
    );
    try {
      await updateDoc(doc(db, "projects", mapping.globalProjectId, "boqItems", boqItemId), {
        requiredAtSiteDate: value,
      });
    } catch (error) {
      console.error("Failed to save required-at-site date:", error);
      toast({ title: "Unable to save date", variant: "destructive" });
    }
  };

  const toggleSelected = (boqItemId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(boqItemId)) next.delete(boqItemId);
      else next.add(boqItemId);
      return next;
    });
  };

  const handleCreateIndentFromSelection = () => {
    if (!selectedIds.size) return;
    const params = new URLSearchParams({ project: mappingId, boqItemIds: Array.from(selectedIds).join(",") });
    router.push(`/project-management/indent/new?${params.toString()}`);
  };

  const columns: PmListColumn<PlannerListRow>[] = [
    {
      header: "",
      className: "w-10",
      mobile: "aside",
      cell: ({ row }) => (
        // A 16px box is a poor thumb target; on a phone the label pads it out to one without
        // moving it. The label forwards its click to the checkbox button inside.
        <label className="-m-2 inline-flex p-2 sm:m-0 sm:p-0">
          <Checkbox
            checked={selectedIds.has(row.boqItem.id)}
            disabled={row.netRequirement <= 0}
            onCheckedChange={() => toggleSelected(row.boqItem.id)}
          />
        </label>
      ),
    },
    { header: "BOQ SL No", className: "whitespace-nowrap", mobile: "title", cell: ({ row }) => row.boqSlNo || "—" },
    {
      header: "Description",
      className: "max-w-xs truncate",
      mobile: "title",
      cell: ({ row }) => <span title={row.description}>{row.description}</span>,
    },
    {
      header: "Approved Qty",
      align: "right",
      cell: ({ row }) => (
        <>
          {formatQuantity(row.surveyedQty ?? row.boqQty)}
          {row.surveyedQty != null && row.surveyedQty !== row.boqQty && (
            <div className="text-xs text-muted-foreground">BOQ: {formatQuantity(row.boqQty)}</div>
          )}
        </>
      ),
    },
    {
      header: "Surveyed",
      align: "right",
      cell: ({ row }) => (row.surveyedQty != null ? formatQuantity(row.surveyedQty) : "—"),
    },
    { header: "Indented", align: "right", cell: ({ row }) => formatQuantity(row.indentedQty) },
    {
      header: "Net Requirement",
      align: "right",
      cell: ({ row }) => <span className="font-medium">{formatQuantity(row.netRequirement)}</span>,
    },
    {
      header: "Required At Site",
      cell: ({ row }) => (
        <Input
          type="date"
          className="h-9 w-full sm:h-8 sm:w-36"
          value={row.requiredAtSiteDate}
          disabled={!canEditSchedule}
          onChange={(event) => void handleRequiredDateChange(row.boqItem.id, event.target.value)}
        />
      ),
    },
    {
      header: "Indent By",
      className: "whitespace-nowrap",
      cell: ({ indentByDate, status, slippageDays }) =>
        indentByDate ? (
          <span className={status === "Late" ? "font-medium text-red-600" : ""}>
            {indentByDate}
            {status === "Late" && ` (${slippageDays}d late)`}
          </span>
        ) : (
          "—"
        ),
    },
    {
      header: "Status",
      mobile: "aside",
      cell: ({ status }) => (
        <Badge variant="outline" className={requirementStatusStyles[status]}>
          {status}
        </Badge>
      ),
    },
  ];

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this module.</CardDescription>
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
            <CardDescription>Return to Project Management and choose a project before opening the Requirement Planner.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      {/* Sticky: rows are ticked while scrolling the register, and the action that uses the
          selection has to stay in reach. `sm:` margins match this page's `sm:p-6`. */}
      <PageHeader
        sticky
        title="Requirement Planner"
        description={`${rows.length} supply-lane BOQ line${rows.length === 1 ? "" : "s"} for ${mapping.projectName}`}
        icon={ClipboardList}
        backHref={`/project-management/supply?project=${encodeURIComponent(mappingId)}`}
        backLabel="Back to Supply"
        className="sm:-mx-6 sm:px-6"
        actions={
          canCreateIndent ? (
            <Button className="ml-auto w-full sm:w-auto" disabled={!selectedIds.size} onClick={handleCreateIndentFromSelection}>
              <ListChecks className="mr-2 h-4 w-4" />
              <span className="sm:hidden">Create indent ({selectedIds.size})</span>
              <span className="hidden sm:inline">Create Indent from Selection ({selectedIds.size})</span>
            </Button>
          ) : undefined
        }
      />

      {lateSummary.count > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{lateSummary.count}</strong> BOQ line{lateSummary.count === 1 ? " is" : "s are"} past its indent-by
            date — {formatCurrency(lateSummary.valueAtRisk)} at risk.
          </span>
        </div>
      )}

      <PmToolbar>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search BOQ SL No or description..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(value: RequirementStatus | "All") => setStatusFilter(value)}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All statuses</SelectItem>
            {REQUIREMENT_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PmToolbar>

      <PmDataList
        rows={filteredRows.map((item) => ({ ...item, id: item.row.boqItem.id }))}
        columns={columns}
        empty={
          <PmEmptyState
            icon={ClipboardList}
            title="No supply-lane BOQ items match"
            description="Try a different search or status filter."
          />
        }
      />
    </main>
  );
}
