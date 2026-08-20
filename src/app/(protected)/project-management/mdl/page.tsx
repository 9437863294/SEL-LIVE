"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpDown,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileBarChart2,
  FileStack,
  GanttChart,
  Layers,
  ListPlus,
  ListTodo,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  ShoppingCart,
  Table2,
  Trash2,
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
  canEditMdlSubDrawing,
  computeMdlCycleAgeDays,
  computeMdlDrawingStage,
  countVisibleRevisions,
  earliestSubmissionDate,
  emptyRevisions,
  emptySubDrawing,
  formatMdlDate,
  getLatestRevision,
  getLatestRevisionAcrossItem,
  getMdlRollup,
  getMdlSubDrawings,
  groupMdlRowsByPo,
  isMdlApproved,
  isMdlOverdue,
  isMdlPendingTask,
  isRevisionRejected,
  mdlDrawingStageStyles,
  mdlOutlineNo,
  mdlOverallStatusStyles,
  mdlRevisionStatusStyles,
  summariseMdlRows,
  type MdlDrawing,
  type MdlOverallStatus,
  type MdlRevision,
  type MdlRevisionRound,
  type MdlRevisionStatus,
  type MdlRow,
  type MdlSubDrawing,
} from "@/lib/mdl";
import { PO_COLLECTION, type PurchaseOrder } from "@/lib/purchase-orders";
import MdlWorkplanCalendar from "@/components/project-management/mdl-calendar";
import MdlReports from "@/components/project-management/mdl-reports";
import MdlGanttChart from "@/components/project-management/mdl-gantt";
import MdlPendingTasks from "@/components/project-management/mdl-pending-tasks";
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
  // Used only when the dialog is editing a sub-drawing, ignored for the parent item's own record.
  title: string;
  assignedToId: string;
  // Whether the client's rejection needs a fresh drawing from the vendor rather than a
  // resubmission of the copy we already hold.
  recollectFromVendor: boolean;
  recollectReason: string;
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
  title: "",
  assignedToId: "",
  recollectFromVendor: false,
  recollectReason: "",
  docNo: "",
  drawingNo: "",
  plannedStartDate: "",
  plannedEndDate: "",
  revisions: emptyRevisions(),
  approveDate: "",
  status: "Pending",
  remark: "",
});

// The dialog edits either a BOQ item's own drawing (sub === null) or one of its sub-drawings.
// A brand-new sub-drawing is carried here too, with an id minted up front so its uploads can
// be filed under it before it has ever been saved. `isNew` keeps the add form down to just
// naming the drawing — the vendor collection, client submission and verdict all come later.
type EditTarget = { item: BoqItem; sub: MdlSubDrawing | null; isNew: boolean };

// A specific sub-drawing on a specific item, for the delete confirmation.
type SubDrawingRef = { item: BoqItem; sub: MdlSubDrawing };

// MdlRow with this page's own concrete BOQ item shape, so grouping and the shared table renderer
// keep access to fields like "BOQ SL No" that MdlBoqItem only exposes as unknown.
type MdlItemRow = { item: BoqItem; drawing?: MdlDrawing };

// Purchase orders placed against a BOQ item, flattened. The views group by individual PO, but a
// plain "is this item under any live PO?" lookup is still what decides a drawing's stage.
type PoPlacement = { poNumbers: string[]; vendorNames: string[]; latestPoDate: string };

// Sentinel for "nobody assigned" — Radix Select cannot hold an empty string value.
const UNASSIGNED = "none";

export default function MdlPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user, users } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", MDL_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canEdit = can("Edit", MDL_PERMISSION_RESOURCE);

  const assignableUsers = useMemo(
    () => users.filter((candidate) => candidate.status === "Active").sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

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
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [form, setForm] = useState<EditForm>(emptyForm());
  const [pendingFiles, setPendingFiles] = useState<Partial<Record<MdlRevisionRound, File>>>({});
  const [visibleRounds, setVisibleRounds] = useState(1);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [subToDelete, setSubToDelete] = useState<SubDrawingRef | null>(null);
  const [isDeletingSub, setIsDeletingSub] = useState(false);
  const [itemToRemove, setItemToRemove] = useState<BoqItem | null>(null);
  const [isRemovingItem, setIsRemovingItem] = useState(false);
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

  const mdlRows = useMemo<MdlItemRow[]>(
    () => boqItems.map((item) => ({ item, drawing: drawings[item.id] })),
    [boqItems, drawings],
  );

  // Purchase order → BOQ item → sub-drawing. Items not on any live PO fall back to the Scope 1
  // grouping the register has always used, so nothing marked MDL = Yes disappears from view.
  const { groups: poGroups, ungrouped: unorderedRows } = useMemo(
    () => groupMdlRowsByPo(mdlRows, purchaseOrders),
    [mdlRows, purchaseOrders],
  );

  const scopeGroups = useMemo(() => {
    const map = new Map<string, MdlRow[]>();
    for (const row of unorderedRows) {
      const scope = String(row.item["Scope 1"] ?? "").trim() || "Ungrouped";
      map.set(scope, [...(map.get(scope) ?? []), row]);
    }
    return Array.from(map.entries());
  }, [unorderedRows]);

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

  // Shares isMdlPendingTask with the Pending Tasks tab, so the badge always matches the list.
  const pendingTaskCount = useMemo(
    () => mdlRows.filter((row) => isMdlPendingTask(row.drawing, poInfoByBoqItemId.has(row.item.id))).length,
    [mdlRows, poInfoByBoqItemId],
  );

  const toggleExpanded = (itemId: string) => {
    setExpandedItems((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  // Opens the shared drawing dialog on either a BOQ item's own record (sub === null) or one of
  // its sub-drawings, seeding the form from whichever of the two is being edited.
  const openDrawingDialog = (item: BoqItem, sub: MdlSubDrawing | null, isNew = false) => {
    const source = sub ?? drawings[item.id];
    const revisions =
      source?.revisions?.length === MDL_REVISION_ROUNDS.length ? source.revisions : emptyRevisions();
    setForm(
      source
        ? {
            title: sub?.title ?? "",
            assignedToId: sub?.assignedToId ?? "",
            recollectFromVendor: Boolean(sub?.recollectionRequested),
            recollectReason: sub?.recollectionRequested?.reason ?? "",
            docNo: source.docNo ?? "",
            drawingNo: source.drawingNo ?? "",
            plannedStartDate: source.plannedStartDate ?? "",
            plannedEndDate: source.plannedEndDate ?? "",
            revisions,
            approveDate: source.approveDate ?? "",
            status: source.status ?? "Pending",
            remark: source.remark ?? "",
          }
        : emptyForm(),
    );
    setVisibleRounds(countVisibleRevisions(revisions));
    setPendingFiles({});
    setEditTarget({ item, sub, isNew });
  };

  // Only active users can be picked, but a sub-drawing assigned before someone was deactivated
  // keeps them in the list — dropping them would silently unassign the drawing the next time
  // anyone saved an unrelated field on it.
  const assigneeOptions = useMemo(() => {
    const options = assignableUsers.map((candidate) => ({ id: candidate.id, name: candidate.name }));
    const assigned = editTarget?.sub;
    if (assigned?.assignedToId && !options.some((option) => option.id === assigned.assignedToId)) {
      options.unshift({ id: assigned.assignedToId, name: `${assigned.assignedToName || "Unknown user"} (inactive)` });
    }
    return options;
  }, [assignableUsers, editTarget]);

  const openNewSubDrawing = (item: BoqItem) => {
    setExpandedItems((current) => new Set(current).add(item.id));
    openDrawingDialog(item, emptySubDrawing(crypto.randomUUID()), true);
  };

  const handleSelectMdlItem = (boqItemId: string, subDrawingId?: string) => {
    const item = allBoqItems.find((candidate) => candidate.id === boqItemId);
    if (!item) return;
    if (!subDrawingId) {
      openDrawingDialog(item, null);
      return;
    }
    const sub = getMdlSubDrawings(drawings[boqItemId]).find((candidate) => candidate.id === subDrawingId);
    if (sub) openDrawingDialog(item, sub);
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
    if (!mapping || !user || !editTarget) return;
    const { item: editingBoqItem, sub: editingSub } = editTarget;

    if (editingSub && !form.title.trim()) {
      toast({
        title: "Name the sub-drawing",
        description: "Give it a title such as “GA Drawing” or “Foundation Drawing” before saving.",
        variant: "destructive",
      });
      return;
    }

    // Sub-drawings are planned as a checklist first: a name is enough to create one, and the
    // dates, the vendor's drawing and the client submission all follow later. Only the item's
    // own record still insists on a planned window up front.
    if (!editingSub && (!form.plannedStartDate || !form.plannedEndDate)) {
      toast({
        title: "Planned dates are required",
        description: "Set both the planned start and end date before saving.",
        variant: "destructive",
      });
      return;
    }
    if (form.plannedStartDate && form.plannedEndDate && form.plannedEndDate < form.plannedStartDate) {
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
      const parentRef = doc(db, "projects", mapping.globalProjectId, MDL_COLLECTION, editingBoqItem.id);
      const existingParent = drawings[editingBoqItem.id];
      const existingSubs = getMdlSubDrawings(existingParent);
      // Sub-drawing uploads are filed under their own id so two sub-drawings on the same item
      // can each hold an R0 without colliding.
      const uploadPrefix = `project-management/mdl/${mapping.globalProjectId}/${editingBoqItem.id}${editingSub ? `/${editingSub.id}` : ""}`;

      const revisions = await Promise.all(
        form.revisions.map(async (rev) => {
          const file = pendingFiles[rev.round];
          if (!file) return rev;
          const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
          const path = `${uploadPrefix}/${rev.round}-${Date.now()}-${safeName}`;
          const target = storageRef(storage, path);
          await uploadBytes(target, file);
          const fileUrl = await getDownloadURL(target);
          return { ...rev, fileUrl, fileName: file.name, filePath: path };
        }),
      );

      if (editingSub) {
        const previous = existingSubs.find((candidate) => candidate.id === editingSub.id);
        // Same never-reset rule as the parent record — see computeMdlCycleAgeDays in mdl.ts.
        const firstSubmittedOn = previous?.firstSubmittedOn ?? earliestSubmissionDate(revisions);
        // Resolved from the full directory, not just the active users, and falling back to the
        // stored name so a deactivated assignee is preserved rather than blanked.
        const assignee = form.assignedToId
          ? {
              assignedToId: form.assignedToId,
              assignedToName:
                users.find((candidate) => candidate.id === form.assignedToId)?.name ?? previous?.assignedToName ?? "",
            }
          : null;
        // Sentinel timestamps are illegal inside array elements, so these are plain ISO strings.
        const nowIso = new Date().toISOString();

        // Approving the drawing settles the vendor's obligation for good, so it always clears any
        // outstanding request for a replacement — an approved drawing must never reappear in the
        // Drawing page's collection queue.
        const wantsRecollection = form.recollectFromVendor && !isMdlApproved(form.status);
        const recollectionRequested = wantsRecollection
          ? {
              // Preserved across edits so the age of the request doesn't reset every save.
              requestedOn: previous?.recollectionRequested?.requestedOn ?? nowIso.slice(0, 10),
              ...(form.recollectReason.trim() ? { reason: form.recollectReason.trim() } : {}),
              ...(getLatestRevision(revisions)?.round ? { afterRound: getLatestRevision(revisions)!.round } : {}),
              requestedBy: previous?.recollectionRequested?.requestedBy ?? user.id,
              requestedByName: previous?.recollectionRequested?.requestedByName ?? user.name ?? "",
            }
          : null;
        const nextSub: MdlSubDrawing = {
          id: editingSub.id,
          title: form.title.trim(),
          docNo: form.docNo.trim(),
          drawingNo: form.drawingNo.trim(),
          plannedStartDate: form.plannedStartDate,
          plannedEndDate: form.plannedEndDate,
          revisions,
          approveDate: form.approveDate,
          status: form.status,
          remark: form.remark.trim(),
          ...(firstSubmittedOn ? { firstSubmittedOn } : {}),
          ...(assignee ?? {}),
          // Carried through explicitly: this rebuilds the sub-drawing from scratch, so anything
          // the Drawing page owns has to be copied over or saving here would wipe it.
          ...(previous?.collection ? { collection: previous.collection } : {}),
          ...(previous?.previousCollections?.length ? { previousCollections: previous.previousCollections } : {}),
          ...(recollectionRequested ? { recollectionRequested } : {}),
          createdAt: previous?.createdAt ?? nowIso,
          createdBy: previous?.createdBy ?? user.id,
          createdByName: previous?.createdByName ?? user.name ?? "",
          updatedAt: nowIso,
          updatedBy: user.id,
          updatedByName: user.name ?? "",
        };
        const nextSubs = previous
          ? existingSubs.map((candidate) => (candidate.id === nextSub.id ? nextSub : candidate))
          : [...existingSubs, nextSub];

        if (existingParent) {
          await updateDoc(parentRef, { subDrawings: nextSubs, updatedAt: serverTimestamp() });
        } else {
          // First sub-drawing on an item that has no record of its own yet — create the parent
          // as a container. Its dates and status stay empty and get rolled up from its children.
          await setDoc(parentRef, {
            boqItemId: editingBoqItem.id,
            boqSlNo: String(editingBoqItem["BOQ SL No"] ?? ""),
            docNo: "",
            drawingNo: "",
            plannedStartDate: "",
            plannedEndDate: "",
            revisions: emptyRevisions(),
            approveDate: "",
            status: "Pending" satisfies MdlOverallStatus,
            remark: "",
            subDrawings: nextSubs,
            createdAt: serverTimestamp(),
            createdBy: user.id,
            createdByName: user.name ?? "",
            updatedAt: serverTimestamp(),
          });
        }
        toast({ title: previous ? "Sub-drawing updated" : "Sub-drawing added" });
      } else {
        // Set once, from the earliest submission across all revisions, and never moved afterward —
        // see computeMdlCycleAgeDays in mdl.ts for why this must never reset on a later revision.
        const firstSubmittedOn = existingParent?.firstSubmittedOn ?? earliestSubmissionDate(revisions);

        await setDoc(parentRef, {
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
          // This is a full overwrite, so the item's sub-drawings have to be carried through
          // explicitly or saving the parent would silently delete every one of them.
          subDrawings: existingSubs,
          ...(firstSubmittedOn ? { firstSubmittedOn } : {}),
          createdAt: existingParent?.createdAt ?? serverTimestamp(),
          createdBy: existingParent?.createdBy ?? user.id,
          createdByName: existingParent?.createdByName ?? user.name ?? "",
          updatedAt: serverTimestamp(),
        });
        toast({ title: "Drawing record saved" });
      }

      setEditTarget(null);
      setPendingFiles({});
      await loadData();
    } catch (error) {
      console.error("Failed to save MDL drawing record:", error);
      toast({ title: "Unable to save drawing record", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSubDrawing = async () => {
    if (!mapping || !subToDelete?.sub) return;
    const { item, sub } = subToDelete;
    setIsDeletingSub(true);
    try {
      const remaining = getMdlSubDrawings(drawings[item.id]).filter((candidate) => candidate.id !== sub.id);
      await updateDoc(doc(db, "projects", mapping.globalProjectId, MDL_COLLECTION, item.id), {
        subDrawings: remaining,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Sub-drawing removed" });
      setSubToDelete(null);
      await loadData();
    } catch (error) {
      console.error("Failed to delete MDL sub-drawing:", error);
      toast({ title: "Unable to remove sub-drawing", variant: "destructive" });
    } finally {
      setIsDeletingSub(false);
    }
  };

  // The reverse of "Add BOQ Item": clears the MDL flag so the item leaves this register and
  // becomes available to add again. The mdlDrawings record is deliberately left in place — every
  // downstream consumer (Manufacturing Clearance, supply gates, BOQ traceability) checks the
  // MDL flag before it looks at the drawing, so a lingering record changes nothing, and keeping
  // it means re-adding an item restores its drawings instead of losing the history.
  const handleRemoveFromRegister = async () => {
    if (!mapping || !itemToRemove) return;
    setIsRemovingItem(true);
    try {
      await updateDoc(doc(db, "projects", mapping.globalProjectId, "boqItems", itemToRemove.id), { MDL: "No" });
      toast({ title: "Item removed from the MDL register" });
      setItemToRemove(null);
      await loadData();
    } catch (error) {
      console.error("Failed to remove BOQ item from MDL:", error);
      toast({ title: "Unable to remove item", variant: "destructive" });
    } finally {
      setIsRemovingItem(false);
    }
  };

  // Shared by the purchase-order groups and the Scope 1 groups beneath them: the rows are
  // identical, only the outline numbering differs. `prefix` carries the enclosing group’s index
  // so a PO’s items read 1.1, 1.2 and their sub-drawings 1.1.1, 1.1.2.
  const registerTable = (rows: MdlItemRow[], prefix: number[]) => (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-20">SL NO</TableHead>
                          <TableHead>BOQ SL No</TableHead>
                          <TableHead className="min-w-[240px]">Item Description</TableHead>
                          <TableHead>Doc No.</TableHead>
                          <TableHead>Drawing No.</TableHead>
                          <TableHead>Planned Start</TableHead>
                          <TableHead>Planned End</TableHead>
                          <TableHead>Current Stage</TableHead>
                          <TableHead>Cycle Age</TableHead>
                          <TableHead>Approve Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Remark</TableHead>
                          <TableHead className="w-32" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map(({ item, drawing }, index) => {
                          // Everything on the parent row reads from the roll-up, so an item with
                          // sub-drawings summarises them instead of showing an empty container.
                          const rollup = getMdlRollup(drawing);
                          const latest = getLatestRevisionAcrossItem(drawing);
                          const overdue = rollup.overdue;
                          const cycleAgeDays = computeMdlCycleAgeDays(rollup);
                          const subDrawings = getMdlSubDrawings(drawing);
                          const isExpanded = expandedItems.has(item.id);
                          const approvedPct = rollup.subTotal
                            ? Math.round((rollup.subApproved / rollup.subTotal) * 100)
                            : 0;
                          const collectedPct = rollup.subTotal
                            ? Math.round((rollup.subCollected / rollup.subTotal) * 100)
                            : 0;
                          return [
                            <TableRow
                              key={item.id}
                              className={cn(
                                subDrawings.length && "cursor-pointer",
                                subDrawings.length && isExpanded && "border-b-0 bg-muted/30",
                              )}
                              // Clicking anywhere on an item with sub-drawings opens its list; the
                              // action buttons stop propagation so they still do their own thing.
                              onClick={subDrawings.length ? () => toggleExpanded(item.id) : undefined}
                            >
                              <TableCell className="font-medium">{mdlOutlineNo(...prefix, index)}.</TableCell>
                              <TableCell className="whitespace-nowrap">{String(item["BOQ SL No"] ?? "—")}</TableCell>
                              <TableCell className="max-w-xs">
                                <div className="flex items-center gap-1">
                                  {subDrawings.length ? (
                                    <ChevronRight
                                      aria-hidden
                                      className={cn("h-4 w-4 shrink-0 transition-transform", isExpanded && "rotate-90")}
                                    />
                                  ) : (
                                    <span className="w-4 shrink-0" />
                                  )}
                                  <span className="truncate" title={String(item.Description ?? "")}>
                                    {String(item.Description ?? "—")}
                                  </span>
                                </div>
                                {subDrawings.length > 0 && (
                                  <div className="mt-1 flex items-center gap-2 pl-5">
                                    <div
                                      className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted"
                                      role="img"
                                      aria-label={`${rollup.subApproved} of ${rollup.subTotal} drawings approved, ${rollup.subCollected} collected`}
                                    >
                                      {/* Collected sits behind approved, so the bar reads as
                                          progress along the vendor → client chain. */}
                                      <div className="relative h-full w-full">
                                        <div className="absolute inset-y-0 left-0 bg-sky-300" style={{ width: `${collectedPct}%` }} />
                                        <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${approvedPct}%` }} />
                                      </div>
                                    </div>
                                    <span className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-muted-foreground">
                                      <Layers className="h-2.5 w-2.5" />
                                      {rollup.subApproved}/{rollup.subTotal} approved
                                      {rollup.subCollected > rollup.subApproved && ` · ${rollup.subCollected} collected`}
                                    </span>
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{drawing?.docNo || "—"}</TableCell>
                              <TableCell className="max-w-xs truncate" title={drawing?.drawingNo}>{drawing?.drawingNo || "—"}</TableCell>
                              <TableCell className="whitespace-nowrap">{formatMdlDate(rollup.plannedStartDate)}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <span className={overdue ? "font-medium text-red-600" : ""}>
                                  {formatMdlDate(rollup.plannedEndDate)}
                                </span>
                                {overdue && (
                                  <span
                                    className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
                                    title={
                                      rollup.subTotal
                                        ? "This item has a drawing past its planned end date — expand to see which"
                                        : undefined
                                    }
                                  >
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
                              <TableCell className="whitespace-nowrap">{formatMdlDate(rollup.approveDate)}</TableCell>
                              <TableCell>
                                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${mdlOverallStatusStyles[rollup.status]}`}>
                                  {rollup.status}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-xs truncate" title={drawing?.remark}>{drawing?.remark || "—"}</TableCell>
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center">
                                  <Button variant="ghost" size="icon" onClick={() => openDrawingDialog(item, null)} disabled={!canEdit} aria-label={`Edit ${item.Description}`}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  {canEdit && (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => openNewSubDrawing(item)}
                                        aria-label={`Add a sub-drawing to ${item.Description}`}
                                        title="Add sub-drawing"
                                      >
                                        <Plus className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setItemToRemove(item)}
                                        aria-label={`Remove ${item.Description} from the MDL register`}
                                        title="Remove from MDL register"
                                      >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>,
                            ...(isExpanded
                              ? subDrawings.map((sub, subIndex) => {
                                  const subLatest = getLatestRevision(sub.revisions ?? []);
                                  const subOverdue = isMdlOverdue(sub);
                                  const subCycleAgeDays = computeMdlCycleAgeDays(sub);
                                  const subStage = computeMdlDrawingStage(sub, poInfoByBoqItemId.has(item.id));
                                  // Being the assignee is itself the authority to edit this
                                  // drawing, whether or not the role carries Edit on the register.
                                  const canEditThisSub = canEditMdlSubDrawing(sub, user?.id, canEdit);
                                  return (
                                    <TableRow key={`${item.id}-${sub.id}`} className="border-b-0 last:border-b">
                                      <TableCell className="pl-6 text-xs tabular-nums text-muted-foreground">
                                        {mdlOutlineNo(...prefix, index, subIndex)}.
                                      </TableCell>
                                      <TableCell />
                                      <TableCell className="max-w-xs">
                                        <div className="flex items-center gap-1.5 border-l-2 border-muted pl-4">
                                          {isMdlApproved(sub.status) && (
                                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                          )}
                                          <span className="truncate text-sm" title={sub.title}>
                                            {sub.title || "Untitled drawing"}
                                          </span>
                                          <span
                                            className={cn(
                                              "shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                              mdlDrawingStageStyles[subStage],
                                            )}
                                          >
                                            {subStage}
                                          </span>
                                        </div>
                                        <p className="truncate pl-4 text-[11px] text-muted-foreground">
                                          {sub.assignedToName ? `Assigned to ${sub.assignedToName}` : "Unassigned"}
                                          {sub.collection?.fileUrl && (
                                            <>
                                              {" · "}
                                              <a
                                                href={sub.collection.fileUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="text-primary underline underline-offset-2"
                                              >
                                                Vendor drawing
                                              </a>
                                            </>
                                          )}
                                        </p>
                                      </TableCell>
                                      <TableCell className="whitespace-nowrap text-sm">{sub.docNo || "—"}</TableCell>
                                      <TableCell className="max-w-xs truncate text-sm" title={sub.drawingNo}>{sub.drawingNo || "—"}</TableCell>
                                      <TableCell className="whitespace-nowrap text-sm">{formatMdlDate(sub.plannedStartDate)}</TableCell>
                                      <TableCell className="whitespace-nowrap text-sm">
                                        <span className={subOverdue ? "font-medium text-red-600" : ""}>
                                          {formatMdlDate(sub.plannedEndDate)}
                                        </span>
                                        {subOverdue && (
                                          <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                            Overdue
                                          </span>
                                        )}
                                      </TableCell>
                                      <TableCell className="whitespace-nowrap">
                                        {subLatest ? (
                                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${subLatest.status ? mdlRevisionStatusStyles[subLatest.status] : "bg-muted text-muted-foreground"}`}>
                                            {subLatest.round}{subLatest.status ? ` · ${subLatest.status}` : ""}
                                          </span>
                                        ) : "—"}
                                      </TableCell>
                                      <TableCell className="whitespace-nowrap text-sm">
                                        {subCycleAgeDays != null ? (
                                          <span className={subCycleAgeDays > 30 ? "font-medium text-amber-600" : ""}>
                                            {subCycleAgeDays}d
                                          </span>
                                        ) : "—"}
                                      </TableCell>
                                      <TableCell className="whitespace-nowrap text-sm">{formatMdlDate(sub.approveDate)}</TableCell>
                                      <TableCell>
                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${mdlOverallStatusStyles[sub.status]}`}>
                                          {sub.status}
                                        </span>
                                      </TableCell>
                                      <TableCell className="max-w-xs truncate text-sm" title={sub.remark}>{sub.remark || "—"}</TableCell>
                                      <TableCell>
                                        <div className="flex items-center">
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => openDrawingDialog(item, sub)}
                                            disabled={!canEditThisSub}
                                            aria-label={`Edit sub-drawing ${sub.title || "untitled"}`}
                                          >
                                            <Pencil className="h-3.5 w-3.5" />
                                          </Button>
                                          {canEdit && (
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              onClick={() => setSubToDelete({ item, sub })}
                                              aria-label={`Remove sub-drawing ${sub.title || "untitled"}`}
                                              title="Remove sub-drawing"
                                            >
                                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                            </Button>
                                          )}
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })
                              : []),
                          ];
                        })}
                      </TableBody>
                    </Table>
                  </div>
  );

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
          <MdlPendingTasks
            rows={mdlRows}
            purchaseOrders={purchaseOrders}
            mappingId={mappingId}
            onSelectItem={handleSelectMdlItem}
          />
        </TabsContent>

        <TabsContent value="register" className="mt-0 space-y-5">
          {poGroups.length || scopeGroups.length ? (
            <>
              {poGroups.map((group, groupIndex) => {
                const summary = summariseMdlRows(group.rows);
                return (
                  <Card key={group.po.poId} className="overflow-hidden border-border/60">
                    <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-600" />
                    <CardHeader className="pb-3">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        <span className="text-muted-foreground">{mdlOutlineNo(groupIndex)}.</span>
                        <ShoppingCart className="h-4 w-4 text-emerald-600" />
                        <Link
                          href={`/project-management/purchase-orders/${group.po.poId}?project=${encodeURIComponent(mappingId)}`}
                          className="hover:underline"
                        >
                          {group.po.poNumber}
                        </Link>
                        {group.po.vendorName && (
                          <span className="text-sm font-normal text-muted-foreground">{group.po.vendorName}</span>
                        )}
                      </CardTitle>
                      <CardDescription>
                        Ordered {formatMdlDate(group.po.poDate)} · {group.rows.length} item
                        {group.rows.length === 1 ? "" : "s"} · {summary.approved}/{summary.drawings} drawing
                        {summary.drawings === 1 ? "" : "s"} approved
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">{registerTable(group.rows, [groupIndex])}</CardContent>
                  </Card>
                );
              })}

              {scopeGroups.map(([scope, rows]) => (
                <Card key={scope} className="overflow-hidden border-border/60">
                  <div className="h-1 w-full bg-gradient-to-r from-sky-500 to-blue-600" />
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{scope}</CardTitle>
                    <CardDescription>
                      Not on a purchase order yet · {rows.length} item{rows.length === 1 ? "" : "s"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">{registerTable(rows, [])}</CardContent>
                </Card>
              ))}
            </>
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

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editTarget?.isNew ? "Add Sub-drawing" : editTarget?.sub ? "Sub-drawing Details" : "Drawing Details"}
            </DialogTitle>
            <DialogDescription>
              {editTarget?.item["BOQ SL No"] ? `BOQ SL No ${editTarget.item["BOQ SL No"]} · ` : ""}
              {editTarget?.item.Description}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {editTarget?.sub && (
              <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sub-title">
                    Sub-drawing Title <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="sub-title"
                    value={form.title}
                    onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))}
                    placeholder="e.g. GA Drawing, Foundation Drawing"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sub-assignee">Assigned To</Label>
                  <Select
                    value={form.assignedToId || UNASSIGNED}
                    onValueChange={(value) =>
                      setForm((c) => ({ ...c, assignedToId: value === UNASSIGNED ? "" : value }))
                    }
                  >
                    <SelectTrigger id="sub-assignee"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {assigneeOptions.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    The assignee can update this sub-drawing even without Edit rights on the register.
                  </p>
                </div>
              </div>
            )}

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
                <Label htmlFor="planned-start-date">
                  Planned Start Date {editTarget?.sub ? <span className="text-muted-foreground">(optional)</span> : <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="planned-start-date"
                  type="date"
                  required={!editTarget?.sub}
                  value={form.plannedStartDate}
                  onChange={(e) => setForm((c) => ({ ...c, plannedStartDate: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="planned-end-date">
                  Planned End Date {editTarget?.sub ? <span className="text-muted-foreground">(optional)</span> : <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="planned-end-date"
                  type="date"
                  required={!editTarget?.sub}
                  min={form.plannedStartDate || undefined}
                  value={form.plannedEndDate}
                  onChange={(e) => setForm((c) => ({ ...c, plannedEndDate: e.target.value }))}
                />
              </div>
            </div>

            {editTarget?.sub && !editTarget.isNew && (
              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Collected from Vendor</p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      mdlDrawingStageStyles[
                        computeMdlDrawingStage(editTarget.sub, poInfoByBoqItemId.has(editTarget.item.id))
                      ],
                    )}
                  >
                    {computeMdlDrawingStage(editTarget.sub, poInfoByBoqItemId.has(editTarget.item.id))}
                  </span>
                </div>
                {editTarget.sub.collection?.receivedOn ? (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      Received {formatMdlDate(editTarget.sub.collection.receivedOn)}
                      {editTarget.sub.collection.vendorName ? ` from ${editTarget.sub.collection.vendorName}` : ""}
                      {editTarget.sub.collection.receivedByName ? ` · recorded by ${editTarget.sub.collection.receivedByName}` : ""}
                    </p>
                    {editTarget.sub.collection.remark && <p>{editTarget.sub.collection.remark}</p>}
                    {editTarget.sub.collection.fileUrl && (
                      <a
                        href={editTarget.sub.collection.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
                      >
                        <Paperclip className="h-3 w-3" />
                        {editTarget.sub.collection.fileName || "Open vendor drawing"}
                      </a>
                    )}
                    <p className="pt-1">Review it, then record the client submission below.</p>

                    {isMdlApproved(form.status) ? (
                      <p className="mt-2 rounded-md bg-emerald-50 p-2 text-emerald-800">
                        Approved — the vendor has nothing further to supply for this drawing. It stays approved for any
                        later purchase order on this item, so it will not be asked for again.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-2 rounded-md border border-rose-200 bg-rose-50 p-2">
                        <label className="flex items-start gap-2 text-rose-900">
                          <Checkbox
                            className="mt-0.5"
                            checked={form.recollectFromVendor}
                            onCheckedChange={(state) =>
                              setForm((c) => ({ ...c, recollectFromVendor: state === true }))
                            }
                          />
                          <span>
                            <span className="font-medium">Needs a fresh drawing from the vendor</span>
                            <span className="block text-[11px]">
                              Tick this when the rejection can&apos;t be answered with the copy we already hold. It puts
                              the drawing back on the Drawing page to collect again.
                            </span>
                          </span>
                        </label>
                        {form.recollectFromVendor && (
                          <Input
                            value={form.recollectReason}
                            onChange={(e) => setForm((c) => ({ ...c, recollectReason: e.target.value }))}
                            placeholder="What the vendor needs to correct (optional)"
                            className="h-8 bg-white text-xs"
                          />
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Not collected yet. Vendor drawings are received on the{" "}
                    <Link
                      href={`/project-management/drawing?project=${encodeURIComponent(mappingId)}`}
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      Drawing page
                    </Link>
                    , then reviewed and submitted to the client here.
                  </p>
                )}
              </div>
            )}

            {editTarget?.isNew ? (
              // Adding a sub-drawing is pure planning: name it and move on. The vendor collection,
              // the client submission rounds and the verdict all get filled in later, from the
              // Drawing page and from this same dialog once the drawing exists.
              <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                Just name the drawing for now. Once a purchase order is placed for this item it appears on the{" "}
                <Link
                  href={`/project-management/drawing?project=${encodeURIComponent(mappingId)}`}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Drawing page
                </Link>{" "}
                to collect from the vendor — then come back here to review it, submit it to the client and set its
                status.
              </p>
            ) : (
              <>
            <div className="h-px bg-border" />

            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Submission to Client</p>
                <p className="text-xs text-muted-foreground">
                  Optional while planning. Once you submit a round to the client, attach the drawing that went with it.
                </p>
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
              </>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : editTarget?.isNew ? (
                <Plus className="mr-2 h-4 w-4" />
              ) : (
                <Pencil className="mr-2 h-4 w-4" />
              )}
              {editTarget?.isNew ? "Add Sub-drawing" : "Save"}
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

      <AlertDialog open={!!subToDelete} onOpenChange={(open) => !open && setSubToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this sub-drawing?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{subToDelete?.sub?.title || "Untitled drawing"}&rdquo; will be removed from{" "}
              {String(subToDelete?.item.Description ?? "this item")}, along with its revision history. Uploaded files
              stay in storage but will no longer be linked. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingSub}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteSubDrawing();
              }}
              disabled={isDeletingSub}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingSub ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!itemToRemove} onOpenChange={(open) => !open && setItemToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this item from the MDL register?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {String(itemToRemove?.Description ?? "This item")} will no longer be tracked for drawing submission,
                  and will stop requiring drawing approval before Manufacturing Clearance.
                </p>
                {itemToRemove && drawings[itemToRemove.id] && (
                  <p className="rounded-md bg-muted p-2 text-xs">
                    Its drawing record
                    {getMdlSubDrawings(drawings[itemToRemove.id]).length
                      ? ` and ${getMdlSubDrawings(drawings[itemToRemove.id]).length} sub-drawing${
                          getMdlSubDrawings(drawings[itemToRemove.id]).length === 1 ? "" : "s"
                        }`
                      : ""}{" "}
                    is kept, so adding the item back later restores everything as it is now.
                  </p>
                )}
                <p className="text-xs">You can add it again at any time with “Add BOQ Item”.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemovingItem}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleRemoveFromRegister();
              }}
              disabled={isRemovingItem}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRemovingItem ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Remove from Register
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
