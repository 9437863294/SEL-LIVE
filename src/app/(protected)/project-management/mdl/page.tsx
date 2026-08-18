"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpDown,
  CalendarDays,
  FileBarChart2,
  FileStack,
  GanttChart,
  ListPlus,
  ListTodo,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Table2,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db } from "@/lib/firebase";
import { storage } from "@/lib/firebase-storage";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CheckedState } from "@radix-ui/react-checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  MDL_COLLECTION,
  MDL_OVERALL_STATUSES,
  MDL_PERMISSION_RESOURCE,
  MDL_REVISION_ROUNDS,
  MDL_REVISION_STATUSES,
  computeMdlCycleAgeDays,
  countVisibleRevisions,
  earliestSubmissionDate,
  emptyRevisions,
  formatMdlDate,
  getLatestRevision,
  isMdlOverdue,
  isRevisionRejected,
  mdlOverallStatusStyles,
  mdlRevisionStatusStyles,
  type MdlDrawing,
  type MdlOverallStatus,
  type MdlRevision,
  type MdlRevisionRound,
  type MdlRevisionStatus,
  type MdlRow,
} from "@/lib/mdl";
import { PO_COLLECTION, type PurchaseOrder } from "@/lib/purchase-orders";
import MdlWorkplanCalendar from "@/components/project-management/mdl-calendar";
import MdlReports from "@/components/project-management/mdl-reports";
import MdlGanttChart from "@/components/project-management/mdl-gantt";
import MdlPendingTasks, { MDL_APPROVED_STATUSES, type PoPlacement } from "@/components/project-management/mdl-pending-tasks";
import SidebarTabsList from "@/components/project-management/sidebar-tabs-list";

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
  "Scope 1"?: string;
  MDL?: string;
  [key: string]: unknown;
};

type EditForm = {
  docNo: string;
  drawingNo: string;
  plannedStartDate: string;
  plannedEndDate: string;
  revisions: MdlRevision[];
  approveDate: string;
  status: MdlOverallStatus;
  remark: string;
};

const emptyForm = (): EditForm => ({
  docNo: "",
  drawingNo: "",
  plannedStartDate: "",
  plannedEndDate: "",
  revisions: emptyRevisions(),
  approveDate: "",
  status: "Pending",
  remark: "",
});

export default function MdlPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", MDL_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canEdit = can("Edit", MDL_PERMISSION_RESOURCE);

  // The active view is kept in the URL (`?view=`) so refreshing, sharing a link, or navigating
  // back doesn't silently reset you to "Pending Tasks".
  const activeTab = searchParams?.get("view") || "pending";
  const setActiveTab = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "pending") params.delete("view");
    else params.set("view", value);
    router.replace(`/project-management/mdl?${params.toString()}`);
  };

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [allBoqItems, setAllBoqItems] = useState<BoqItem[]>([]);
  const [drawings, setDrawings] = useState<Record<string, MdlDrawing>>({});
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingBoqItem, setEditingBoqItem] = useState<BoqItem | null>(null);
  const [form, setForm] = useState<EditForm>(emptyForm());
  const [pendingFiles, setPendingFiles] = useState<Partial<Record<MdlRevisionRound, File>>>({});
  const [visibleRounds, setVisibleRounds] = useState(1);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [isAddingToMdl, setIsAddingToMdl] = useState(false);
  const [addFilters, setAddFilters] = useState<{ "Scope 1": string; "Scope 2": string; "Category 1": string }>({
    "Scope 1": "all",
    "Scope 2": "all",
    "Category 1": "all",
  });
  const [addSortKey, setAddSortKey] = useState<"boqSlNo" | "erpSlNo" | "description" | null>(null);
  const [addSortDirection, setAddSortDirection] = useState<"asc" | "desc">("asc");

  const loadData = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");

      const [boqSnapshot, drawingSnapshot, poSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, MDL_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION)),
      ]);

      setMapping(mappingData);
      setAllBoqItems(boqSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as BoqItem));
      setDrawings(
        Object.fromEntries(drawingSnapshot.docs.map((d) => [d.id, { id: d.id, ...d.data() } as MdlDrawing])),
      );
      setPurchaseOrders(poSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as PurchaseOrder));
    } catch (error) {
      console.error("Failed to load MDL drawings:", error);
      toast({
        title: "Unable to load MDL register",
        description: error instanceof Error ? error.message : "Please try again.",
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

  const sortByBoqSlNo = (a: BoqItem, b: BoqItem) =>
    String(a["BOQ SL No"] ?? "").localeCompare(String(b["BOQ SL No"] ?? ""), undefined, { numeric: true });

  const boqItems = useMemo(
    () => allBoqItems.filter((item) => String(item.MDL ?? "").trim().toLowerCase() === "yes").sort(sortByBoqSlNo),
    [allBoqItems],
  );

  const availableBoqItems = useMemo(
    () => allBoqItems.filter((item) => String(item.MDL ?? "").trim().toLowerCase() !== "yes").sort(sortByBoqSlNo),
    [allBoqItems],
  );

  const addFilterOptions = useMemo(() => {
    let base = [...availableBoqItems];
    const scope1Options = [...new Set(base.map((i) => String(i["Scope 1"] ?? "")).filter(Boolean))];
    if (addFilters["Scope 1"] !== "all") base = base.filter((i) => String(i["Scope 1"] ?? "") === addFilters["Scope 1"]);
    const scope2Options = [...new Set(base.map((i) => String(i["Scope 2"] ?? "")).filter(Boolean))];
    if (addFilters["Scope 2"] !== "all") base = base.filter((i) => String(i["Scope 2"] ?? "") === addFilters["Scope 2"]);
    const category1Options = [...new Set(base.map((i) => String(i["Category 1"] ?? "")).filter(Boolean))];
    return { "Scope 1": scope1Options, "Scope 2": scope2Options, "Category 1": category1Options };
  }, [availableBoqItems, addFilters]);

  const handleAddFilterChange = (key: keyof typeof addFilters, value: string) => {
    setAddFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === "Scope 1") {
        next["Scope 2"] = "all";
        next["Category 1"] = "all";
      }
      if (key === "Scope 2") next["Category 1"] = "all";
      return next;
    });
    setSelectedToAdd(new Set());
  };

  const filteredAvailableBoqItems = useMemo(() => {
    const query = addSearch.trim().toLowerCase();
    let items = availableBoqItems.filter((item) => {
      const scope1Match = addFilters["Scope 1"] === "all" || String(item["Scope 1"] ?? "") === addFilters["Scope 1"];
      const scope2Match = addFilters["Scope 2"] === "all" || String(item["Scope 2"] ?? "") === addFilters["Scope 2"];
      const category1Match = addFilters["Category 1"] === "all" || String(item["Category 1"] ?? "") === addFilters["Category 1"];
      if (!(scope1Match && scope2Match && category1Match)) return false;
      if (!query) return true;
      return [item["BOQ SL No"], item["ERP SL NO"], item.Description, item["Scope 1"]].some((value) =>
        String(value ?? "").toLowerCase().includes(query),
      );
    });

    if (addSortKey) {
      const dir = addSortDirection === "asc" ? 1 : -1;
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
      const valueFor = (item: BoqItem) => {
        if (addSortKey === "boqSlNo") return item["BOQ SL No"];
        if (addSortKey === "erpSlNo") return item["ERP SL NO"];
        return item.Description;
      };
      items = [...items].sort((a, b) => collator.compare(String(valueFor(a) ?? ""), String(valueFor(b) ?? "")) * dir);
    }

    return items;
  }, [availableBoqItems, addSearch, addFilters, addSortKey, addSortDirection]);

  const addAllVisibleSelected = filteredAvailableBoqItems.length > 0 && filteredAvailableBoqItems.every((item) => selectedToAdd.has(item.id));
  const addNoneVisibleSelected = filteredAvailableBoqItems.every((item) => !selectedToAdd.has(item.id));
  const addSelectAllState: CheckedState = addAllVisibleSelected ? true : addNoneVisibleSelected ? false : "indeterminate";

  const handleSelectAllToAdd = (checked: CheckedState) => {
    setSelectedToAdd((current) => {
      const next = new Set(current);
      if (checked) filteredAvailableBoqItems.forEach((item) => next.add(item.id));
      else filteredAvailableBoqItems.forEach((item) => next.delete(item.id));
      return next;
    });
  };

  const toggleAddSort = (key: "erpSlNo" | "boqSlNo" | "description") => {
    if (addSortKey === key) {
      setAddSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setAddSortKey(key);
      setAddSortDirection("asc");
    }
  };

  const groups = useMemo(() => {
    const map = new Map<string, BoqItem[]>();
    for (const item of boqItems) {
      const scope = String(item["Scope 1"] ?? "").trim() || "Ungrouped";
      map.set(scope, [...(map.get(scope) ?? []), item]);
    }
    return Array.from(map.entries());
  }, [boqItems]);

  const mdlRows = useMemo<MdlRow[]>(
    () => boqItems.map((item) => ({ item, drawing: drawings[item.id] })),
    [boqItems, drawings],
  );

  // Which BOQ items have an active (non-cancelled) purchase order placed against them —
  // that's the trigger for a drawing becoming a "pending task".
  const poInfoByBoqItemId = useMemo(() => {
    const map = new Map<string, PoPlacement>();
    for (const po of purchaseOrders) {
      if (po.status === "Cancelled") continue;
      for (const item of po.items ?? []) {
        if (!item.boqItemId) continue;
        const entry = map.get(item.boqItemId) ?? { poNumbers: [], vendorNames: [], latestPoDate: "" };
        if (!entry.poNumbers.includes(po.poNumber)) entry.poNumbers.push(po.poNumber);
        if (po.vendorName && !entry.vendorNames.includes(po.vendorName)) entry.vendorNames.push(po.vendorName);
        if (po.poDate > entry.latestPoDate) entry.latestPoDate = po.poDate;
        map.set(item.boqItemId, entry);
      }
    }
    return map;
  }, [purchaseOrders]);

  // Same definition of "pending" as MdlPendingTasks itself uses, so the sidebar badge always
  // agrees with what that tab actually shows.
  const pendingTaskCount = useMemo(
    () =>
      mdlRows.filter(
        (row) => poInfoByBoqItemId.has(row.item.id) && !MDL_APPROVED_STATUSES.includes(row.drawing?.status ?? "Pending"),
      ).length,
    [mdlRows, poInfoByBoqItemId],
  );

  const openEditDialog = (item: BoqItem) => {
    const existing = drawings[item.id];
    const revisions =
      existing?.revisions?.length === MDL_REVISION_ROUNDS.length ? existing.revisions : emptyRevisions();
    setForm(
      existing
        ? {
            docNo: existing.docNo ?? "",
            drawingNo: existing.drawingNo ?? "",
            plannedStartDate: existing.plannedStartDate ?? "",
            plannedEndDate: existing.plannedEndDate ?? "",
            revisions,
            approveDate: existing.approveDate ?? "",
            status: existing.status ?? "Pending",
            remark: existing.remark ?? "",
          }
        : emptyForm(),
    );
    setVisibleRounds(countVisibleRevisions(revisions));
    setPendingFiles({});
    setEditingBoqItem(item);
  };

  const handleSelectMdlItem = (boqItemId: string) => {
    const item = allBoqItems.find((candidate) => candidate.id === boqItemId);
    if (item) openEditDialog(item);
  };

  const toggleSelectedToAdd = (itemId: string, checked: boolean) => {
    setSelectedToAdd((current) => {
      const next = new Set(current);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };

  const handleMarkSelectedAsMdl = async () => {
    if (!mapping || !selectedToAdd.size) return;
    setIsAddingToMdl(true);
    try {
      await Promise.all(
        Array.from(selectedToAdd).map((itemId) =>
          updateDoc(doc(db, "projects", mapping.globalProjectId, "boqItems", itemId), { MDL: "Yes" }),
        ),
      );
      toast({ title: `Marked ${selectedToAdd.size} item${selectedToAdd.size === 1 ? "" : "s"} as MDL required` });
      setSelectedToAdd(new Set());
      setAddSearch("");
      setIsAddDialogOpen(false);
      await loadData();
    } catch (error) {
      console.error("Failed to mark BOQ items for MDL:", error);
      toast({ title: "Unable to update items", variant: "destructive" });
    } finally {
      setIsAddingToMdl(false);
    }
  };

  const updateRevision = (round: MdlRevisionRound, changes: Partial<MdlRevision>) => {
    setForm((current) => ({
      ...current,
      revisions: current.revisions.map((rev) => (rev.round === round ? { ...rev, ...changes } : rev)),
    }));
  };

  const handleSave = async () => {
    if (!mapping || !user || !editingBoqItem) return;

    if (!form.plannedStartDate || !form.plannedEndDate) {
      toast({
        title: "Planned dates are required",
        description: "Set both the planned start and end date before saving.",
        variant: "destructive",
      });
      return;
    }
    if (form.plannedEndDate < form.plannedStartDate) {
      toast({
        title: "Check the planned dates",
        description: "Planned end date cannot be before the planned start date.",
        variant: "destructive",
      });
      return;
    }

    const missingUpload = form.revisions
      .slice(0, visibleRounds)
      .find((rev) => (rev.submissionDate || rev.status) && !rev.fileUrl && !pendingFiles[rev.round]);
    if (missingUpload) {
      toast({
        title: `Upload the drawing for ${missingUpload.round}`,
        description: "Every submission requires the drawing file to be attached.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const revisions = await Promise.all(
        form.revisions.map(async (rev) => {
          const file = pendingFiles[rev.round];
          if (!file) return rev;
          const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
          const path = `project-management/mdl/${mapping.globalProjectId}/${editingBoqItem.id}/${rev.round}-${Date.now()}-${safeName}`;
          const target = storageRef(storage, path);
          await uploadBytes(target, file);
          const fileUrl = await getDownloadURL(target);
          return { ...rev, fileUrl, fileName: file.name, filePath: path };
        }),
      );

      // Set once, from the earliest submission across all revisions, and never moved afterward —
      // see computeMdlCycleAgeDays in mdl.ts for why this must never reset on a later revision.
      const existingFirstSubmittedOn = drawings[editingBoqItem.id]?.firstSubmittedOn;
      const firstSubmittedOn = existingFirstSubmittedOn ?? earliestSubmissionDate(revisions);

      await setDoc(doc(db, "projects", mapping.globalProjectId, MDL_COLLECTION, editingBoqItem.id), {
        boqItemId: editingBoqItem.id,
        boqSlNo: String(editingBoqItem["BOQ SL No"] ?? ""),
        docNo: form.docNo.trim(),
        drawingNo: form.drawingNo.trim(),
        plannedStartDate: form.plannedStartDate,
        plannedEndDate: form.plannedEndDate,
        revisions,
        approveDate: form.approveDate,
        status: form.status,
        remark: form.remark.trim(),
        ...(firstSubmittedOn ? { firstSubmittedOn } : {}),
        createdAt: drawings[editingBoqItem.id]?.createdAt ?? serverTimestamp(),
        createdBy: drawings[editingBoqItem.id]?.createdBy ?? user.id,
        createdByName: drawings[editingBoqItem.id]?.createdByName ?? user.name ?? "",
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Drawing record saved" });
      setEditingBoqItem(null);
      setPendingFiles({});
      await loadData();
    } catch (error) {
      console.error("Failed to save MDL drawing record:", error);
      toast({ title: "Unable to save drawing record", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isLoading) {
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
            <CardDescription>You do not have permission to view the MDL register.</CardDescription>
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
            <CardDescription>Return to Project Management and choose a project before opening the MDL register.</CardDescription>
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/project-management?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Project Management">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-sm">
            <FileStack className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Design &amp; Engineering</h1>
            <p className="text-sm text-muted-foreground">
              Tracks drawing submission &amp; approval for every BOQ item marked MDL = Yes in {mapping.projectName}.
            </p>
          </div>
        </div>
        {canEdit && (
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <ListPlus className="mr-2 h-4 w-4" /> Add BOQ Item
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <SidebarTabsList
          items={[
            { value: "pending", label: "Pending Tasks", icon: ListTodo, color: "text-rose-600", bg: "bg-rose-100", count: pendingTaskCount },
            { value: "register", label: "Register", icon: Table2, color: "text-sky-600", bg: "bg-sky-100" },
            { value: "calendar", label: "Workplan Calendar", icon: CalendarDays, color: "text-violet-600", bg: "bg-violet-100" },
            { value: "gantt", label: "Gantt Chart", icon: GanttChart, color: "text-orange-600", bg: "bg-orange-100" },
            { value: "reports", label: "Reports", icon: FileBarChart2, color: "text-blue-600", bg: "bg-blue-100" },
          ]}
          activeValue={activeTab}
          onChange={setActiveTab}
          title="MDL Views"
          description="Pending tasks, register, calendar, Gantt & reports"
          icon={FileStack}
          gradient="from-sky-500 to-blue-600"
          tint="from-sky-500/10 to-blue-500/5"
        />

        <div className="min-w-0 flex-1 space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsContent value="pending" className="mt-0">
          <MdlPendingTasks rows={mdlRows} poInfoByBoqItemId={poInfoByBoqItemId} onSelectItem={handleSelectMdlItem} />
        </TabsContent>

        <TabsContent value="register" className="mt-0 space-y-5">
          {groups.length ? (
            groups.map(([scope, items]) => (
              <Card key={scope} className="overflow-hidden border-border/60">
                <div className="h-1 w-full bg-gradient-to-r from-sky-500 to-blue-600" />
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{scope}</CardTitle>
                  <CardDescription>{items.length} drawing{items.length === 1 ? "" : "s"}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">SL NO</TableHead>
                          <TableHead>BOQ SL No</TableHead>
                          <TableHead>Item Description</TableHead>
                          <TableHead>Doc No.</TableHead>
                          <TableHead>Drawing No.</TableHead>
                          <TableHead>Planned Start</TableHead>
                          <TableHead>Planned End</TableHead>
                          <TableHead>Current Stage</TableHead>
                          <TableHead>Cycle Age</TableHead>
                          <TableHead>Approve Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Remark</TableHead>
                          <TableHead className="w-12" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item, index) => {
                          const drawing = drawings[item.id];
                          const latest = drawing ? getLatestRevision(drawing.revisions ?? []) : null;
                          const overdue = isMdlOverdue(drawing);
                          const cycleAgeDays = computeMdlCycleAgeDays(drawing);
                          return (
                            <TableRow key={item.id}>
                              <TableCell>{index + 1}</TableCell>
                              <TableCell className="whitespace-nowrap">{String(item["BOQ SL No"] ?? "—")}</TableCell>
                              <TableCell className="max-w-xs truncate" title={String(item.Description ?? "")}>
                                {String(item.Description ?? "—")}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{drawing?.docNo || "—"}</TableCell>
                              <TableCell className="max-w-xs truncate" title={drawing?.drawingNo}>{drawing?.drawingNo || "—"}</TableCell>
                              <TableCell className="whitespace-nowrap">{formatMdlDate(drawing?.plannedStartDate)}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <span className={overdue ? "font-medium text-red-600" : ""}>
                                  {formatMdlDate(drawing?.plannedEndDate)}
                                </span>
                                {overdue && (
                                  <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                    Overdue
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {latest ? (
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${latest.status ? mdlRevisionStatusStyles[latest.status] : "bg-muted text-muted-foreground"}`}>
                                    {latest.round}{latest.status ? ` · ${latest.status}` : ""}
                                  </span>
                                ) : "—"}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {cycleAgeDays != null ? (
                                  <span className={cycleAgeDays > 30 ? "font-medium text-amber-600" : ""}>
                                    {cycleAgeDays}d
                                  </span>
                                ) : "—"}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{formatMdlDate(drawing?.approveDate)}</TableCell>
                              <TableCell>
                                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${mdlOverallStatusStyles[drawing?.status ?? "Pending"]}`}>
                                  {drawing?.status ?? "Pending"}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-xs truncate" title={drawing?.remark}>{drawing?.remark || "—"}</TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" onClick={() => openEditDialog(item)} disabled={!canEdit} aria-label={`Edit ${item.Description}`}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                <FileStack className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">No MDL items yet</p>
                  <p className="text-sm text-muted-foreground">
                    Mark a BOQ item&apos;s MDL field as &quot;Yes&quot; and it will appear here automatically.
                  </p>
                </div>
                <Button variant="outline" asChild>
                  <Link href={`/project-management/boq/costing?project=${encodeURIComponent(mappingId)}`}>Open BOQ</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="calendar" className="mt-0">
          {mdlRows.length ? (
            <MdlWorkplanCalendar rows={mdlRows} onSelectItem={handleSelectMdlItem} />
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                <CalendarDays className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Add drawings to the register to see them on the workplan calendar.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="gantt" className="mt-0">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Drawing Gantt Chart</CardTitle>
              <CardDescription>Each row is a drawing; the bar spans its planned start to end date.</CardDescription>
            </CardHeader>
            <CardContent>
              <MdlGanttChart rows={mdlRows} onSelectItem={handleSelectMdlItem} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="mt-0">
          <MdlReports rows={mdlRows} onSelectItem={handleSelectMdlItem} />
        </TabsContent>
        </Tabs>
        </div>
      </div>

      <Dialog open={!!editingBoqItem} onOpenChange={(open) => !open && setEditingBoqItem(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Drawing Details</DialogTitle>
            <DialogDescription>
              {editingBoqItem?.["BOQ SL No"] ? `BOQ SL No ${editingBoqItem["BOQ SL No"]} · ` : ""}
              {editingBoqItem?.Description}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="doc-no">Doc No.</Label>
                <Input id="doc-no" value={form.docNo} onChange={(e) => setForm((c) => ({ ...c, docNo: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="drawing-no">Drawing No.</Label>
                <Input id="drawing-no" value={form.drawingNo} onChange={(e) => setForm((c) => ({ ...c, drawingNo: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="planned-start-date">Planned Start Date <span className="text-destructive">*</span></Label>
                <Input
                  id="planned-start-date"
                  type="date"
                  required
                  value={form.plannedStartDate}
                  onChange={(e) => setForm((c) => ({ ...c, plannedStartDate: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="planned-end-date">Planned End Date <span className="text-destructive">*</span></Label>
                <Input
                  id="planned-end-date"
                  type="date"
                  required
                  min={form.plannedStartDate || undefined}
                  value={form.plannedEndDate}
                  onChange={(e) => setForm((c) => ({ ...c, plannedEndDate: e.target.value }))}
                />
              </div>
            </div>

            <div className="h-px bg-border" />

            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Revision Submissions</p>
                <p className="text-xs text-muted-foreground">Each submission needs its drawing attached.</p>
              </div>
              {form.revisions.slice(0, visibleRounds).map((revision) => {
                const pendingFile = pendingFiles[revision.round];
                return (
                  <div key={revision.round} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{revision.round}</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Submission Date</Label>
                        <Input
                          type="date"
                          value={revision.submissionDate ?? ""}
                          onChange={(e) => updateRevision(revision.round, { submissionDate: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Status</Label>
                        <Select
                          value={revision.status ?? ""}
                          onValueChange={(status: MdlRevisionStatus) => updateRevision(revision.round, { status })}
                        >
                          <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                          <SelectContent>
                            {MDL_REVISION_STATUSES.map((status) => (
                              <SelectItem key={status} value={status}>{status}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Comments Date</Label>
                        <Input
                          type="date"
                          value={revision.commentsDate ?? ""}
                          onChange={(e) => updateRevision(revision.round, { commentsDate: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Drawing File</Label>
                        <Input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                          onChange={(e) =>
                            setPendingFiles((current) => ({ ...current, [revision.round]: e.target.files?.[0] ?? undefined }))
                          }
                        />
                        {(pendingFile || revision.fileUrl) && (
                          <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                            <Paperclip className="h-3 w-3 shrink-0" />
                            {pendingFile ? (
                              pendingFile.name
                            ) : (
                              <a href={revision.fileUrl} target="_blank" rel="noreferrer" className="truncate underline underline-offset-2">
                                {revision.fileName || "View drawing"}
                              </a>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5 sm:col-span-4">
                        <Label className="text-xs">Comments</Label>
                        <Input
                          value={revision.comments ?? ""}
                          onChange={(e) => updateRevision(revision.round, { comments: e.target.value })}
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              {visibleRounds < MDL_REVISION_ROUNDS.length && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isRevisionRejected(form.revisions[visibleRounds - 1])}
                  onClick={() => setVisibleRounds((count) => Math.min(count + 1, MDL_REVISION_ROUNDS.length))}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Revision ({MDL_REVISION_ROUNDS[visibleRounds]})
                </Button>
              )}
              {visibleRounds < MDL_REVISION_ROUNDS.length && !isRevisionRejected(form.revisions[visibleRounds - 1]) && (
                <p className="text-xs text-muted-foreground">
                  Mark {form.revisions[visibleRounds - 1]?.round} as Rejected or Resubmission Required to add the next revision.
                </p>
              )}
            </div>

            <div className="h-px bg-border" />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="approve-date">Approve Date</Label>
                <Input id="approve-date" type="date" value={form.approveDate} onChange={(e) => setForm((c) => ({ ...c, approveDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="overall-status">Overall Status</Label>
                <Select value={form.status} onValueChange={(status: MdlOverallStatus) => setForm((c) => ({ ...c, status }))}>
                  <SelectTrigger id="overall-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MDL_OVERALL_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>{status}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="remark">Remark</Label>
              <Textarea id="remark" value={form.remark} onChange={(e) => setForm((c) => ({ ...c, remark: e.target.value }))} placeholder="Optional" />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAddDialogOpen}
        onOpenChange={(open) => {
          setIsAddDialogOpen(open);
          if (!open) {
            setSelectedToAdd(new Set());
            setAddSearch("");
            setAddFilters({ "Scope 1": "all", "Scope 2": "all", "Category 1": "all" });
            setAddSortKey(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Add BOQ Item to MDL</DialogTitle>
            <DialogDescription>
              Select BOQ items to mark as MDL required. This only flips the MDL flag — no other item data is changed.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="mb-4 flex flex-col items-center gap-2 sm:flex-row">
              <div className="relative w-full flex-grow">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by BOQ SL No, ERP SL No, or description..."
                  aria-label="Search BOQ items"
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  className="pl-8"
                />
              </div>

              {(["Scope 1", "Scope 2", "Category 1"] as const).map((key) => {
                const options = addFilterOptions[key];
                if (!options.length) return null;
                return (
                  <Select key={key} value={addFilters[key]} onValueChange={(value) => handleAddFilterChange(key, value)}>
                    <SelectTrigger className="w-full sm:w-[160px]">
                      <SelectValue placeholder={`Filter by ${key}`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All {key}s</SelectItem>
                      {options.map((opt) => (
                        <SelectItem key={`${key}-${opt}`} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })}
            </div>

            <ScrollArea className="h-96 rounded-md border">
              <div className="p-1">
                <div className="grid grid-cols-[auto_1fr_1fr_2fr] items-center bg-muted px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  <div className="flex w-[50px] justify-center">
                    <Checkbox aria-label="Select all" checked={addSelectAllState} onCheckedChange={handleSelectAllToAdd} />
                  </div>
                  <button type="button" className="flex cursor-pointer items-center text-left" onClick={() => toggleAddSort("erpSlNo")}>
                    ERP Sl.No.{addSortKey === "erpSlNo" && <ArrowUpDown className="ml-1 h-3 w-3" />}
                  </button>
                  <button type="button" className="flex cursor-pointer items-center text-left" onClick={() => toggleAddSort("boqSlNo")}>
                    BOQ Sl.No.{addSortKey === "boqSlNo" && <ArrowUpDown className="ml-1 h-3 w-3" />}
                  </button>
                  <button type="button" className="flex cursor-pointer items-center text-left" onClick={() => toggleAddSort("description")}>
                    Description{addSortKey === "description" && <ArrowUpDown className="ml-1 h-3 w-3" />}
                  </button>
                </div>

                {filteredAvailableBoqItems.length ? (
                  filteredAvailableBoqItems.map((item) => {
                    const rowChecked = selectedToAdd.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "grid grid-cols-[auto_1fr_1fr_2fr] items-center border-b p-2 last:border-b-0",
                          rowChecked ? "bg-muted" : "hover:bg-muted/50",
                        )}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleSelectedToAdd(item.id, !rowChecked)}
                        onKeyDown={(e) => {
                          if (e.key === " " || e.key === "Enter") {
                            e.preventDefault();
                            toggleSelectedToAdd(item.id, !rowChecked);
                          }
                        }}
                      >
                        <div className="flex w-[50px] justify-center">
                          <Checkbox
                            aria-label={`Select ${String(item.Description ?? item["BOQ SL No"] ?? "item")}`}
                            checked={rowChecked}
                            onCheckedChange={(state) => toggleSelectedToAdd(item.id, state === true)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="truncate pr-2">{String(item["ERP SL NO"] ?? "—")}</div>
                        <div className="truncate pr-2">{String(item["BOQ SL No"] ?? "—")}</div>
                        <div className="truncate pr-2">{String(item.Description ?? "Untitled item")}</div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-muted-foreground">
                    {availableBoqItems.length ? "No matching BOQ items." : "Every BOQ item is already marked MDL required."}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => void handleMarkSelectedAsMdl()} disabled={!selectedToAdd.size || isAddingToMdl}>
              {isAddingToMdl ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ListPlus className="mr-2 h-4 w-4" />}
              Mark {selectedToAdd.size} Selected Item{selectedToAdd.size === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
