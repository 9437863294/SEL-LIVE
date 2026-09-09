"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Download,
  FolderOpen,
  Inbox,
  Loader2,
  Paperclip,
  PenTool,
  RotateCcw,
  Search,
  ShieldAlert,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { collection, doc, getDoc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db } from "@/lib/firebase";
import { storage } from "@/lib/firebase-storage";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  MDL_COLLECTION,
  MDL_PERMISSION_RESOURCE,
  canEditMdlSubDrawing,
  computeMdlDrawingStage,
  formatMdlDate,
  getMdlSubDrawings,
  isAwaitingVendorCollection,
  isCollectedFromVendor,
  mdlDrawingStageStyles,
  mdlOutlineNo,
  type MdlDrawing,
  type MdlPoRef,
  type MdlSubDrawing,
} from "@/lib/mdl";
import { PO_COLLECTION, type PurchaseOrder } from "@/lib/purchase-orders";
import SidebarTabsList from "@/components/project-management/sidebar-tabs-list";
import {
  JMC_MAIN_CLASS,
  JmcPageHeader as PmPageHeader,
} from "@/components/jmc/jmc-page-shell";

const PERMISSION_RESOURCE = "Project Management.Drawing";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

type BoqItem = {
  id: string;
  "BOQ SL No"?: string | number;
  Description?: string;
  "Scope 1"?: string;
  MDL?: string;
  [key: string]: unknown;
};

// One drawing the vendor owes us (or has already handed over), flattened out of the MDL register
// so this page can list and act on them without the caller walking the item → sub-drawing tree.
type CollectionRow = {
  item: BoqItem;
  sub: MdlSubDrawing;
  poNumbers: string[];
  vendorNames: string[];
  latestPoDate: string;
};

type CollectForm = {
  receivedOn: string;
  vendorName: string;
  remark: string;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function DrawingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  // Whoever maintains the MDL register is exactly who receives vendor drawings, so Edit on MDL
  // carries collection rights too — otherwise "Collect" being a new permission would leave the
  // page read-only for everyone until roles are re-granted.
  const canCollect = can("Collect", PERMISSION_RESOURCE) || can("Edit", MDL_PERMISSION_RESOURCE);

  // Kept in the URL (`?view=`) so refreshing or sharing a link doesn't reset the view.
  const activeTab = searchParams?.get("view") || "pending";
  const setActiveTab = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "pending") params.delete("view");
    else params.set("view", value);
    router.replace(`/project-management/drawing?${params.toString()}`);
  };

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [drawings, setDrawings] = useState<Record<string, MdlDrawing>>({});
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [collecting, setCollecting] = useState<CollectionRow | null>(null);
  const [form, setForm] = useState<CollectForm>({ receivedOn: todayIso(), vendorName: "", remark: "" });
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
      setBoqItems(
        boqSnapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as BoqItem)
          .filter((item) => String(item.MDL ?? "").trim().toLowerCase() === "yes")
          .sort((a, b) =>
            String(a["BOQ SL No"] ?? "").localeCompare(String(b["BOQ SL No"] ?? ""), undefined, { numeric: true }),
          ),
      );
      setDrawings(
        Object.fromEntries(drawingSnapshot.docs.map((d) => [d.id, { id: d.id, ...d.data() } as MdlDrawing])),
      );
      setPurchaseOrders(poSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as PurchaseOrder));
    } catch (error) {
      console.error("Failed to load drawing collection list:", error);
      toast({
        title: "Unable to load drawings",
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

  // Which BOQ items have an active purchase order placed against them — placing the PO is what
  // makes the vendor owe us the drawings, so it's the trigger for everything on this page.
  const poInfoByBoqItemId = useMemo(() => {
    const map = new Map<string, { poNumbers: string[]; vendorNames: string[]; latestPoDate: string }>();
    for (const po of purchaseOrders) {
      if (po.status === "Cancelled") continue;
      for (const line of po.items ?? []) {
        if (!line.boqItemId) continue;
        const entry = map.get(line.boqItemId) ?? { poNumbers: [], vendorNames: [], latestPoDate: "" };
        if (!entry.poNumbers.includes(po.poNumber)) entry.poNumbers.push(po.poNumber);
        if (po.vendorName && !entry.vendorNames.includes(po.vendorName)) entry.vendorNames.push(po.vendorName);
        if (po.poDate > entry.latestPoDate) entry.latestPoDate = po.poDate;
        map.set(line.boqItemId, entry);
      }
    }
    return map;
  }, [purchaseOrders]);

  // Every sub-drawing on an item that now has a purchase order. Sub-drawings on items without a
  // PO are still just plans in the MDL register, so nothing is owed for them yet.
  const allRows = useMemo<CollectionRow[]>(() => {
    const rows: CollectionRow[] = [];
    for (const item of boqItems) {
      const po = poInfoByBoqItemId.get(item.id);
      if (!po) continue;
      for (const sub of getMdlSubDrawings(drawings[item.id])) {
        rows.push({ item, sub, ...po });
      }
    }
    return rows;
  }, [boqItems, drawings, poInfoByBoqItemId]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return allRows;
    return allRows.filter((row) =>
      [row.item["BOQ SL No"], row.item.Description, row.sub.title, row.sub.assignedToName, ...row.poNumbers, ...row.vendorNames].some(
        (value) => String(value ?? "").toLowerCase().includes(query),
      ),
    );
  }, [allRows, search]);

  // Every row here already has a purchase order, so the only question left is whether the vendor
  // still owes the drawing — approved drawings are settled and never come back.
  const pendingRows = useMemo(
    () =>
      filteredRows
        .filter((row) => isAwaitingVendorCollection(row.sub, true))
        // Replacements the client is waiting on come first, then the oldest purchase orders,
        // since the vendor has owed those the longest.
        .sort((a, b) => {
          const aRedo = Boolean(a.sub.recollectionRequested);
          const bRedo = Boolean(b.sub.recollectionRequested);
          if (aRedo !== bRedo) return aRedo ? -1 : 1;
          return (a.latestPoDate || "").localeCompare(b.latestPoDate || "");
        }),
    [filteredRows],
  );

  const collectedRows = useMemo(
    () =>
      filteredRows
        // A drawing waiting on a replacement is listed as outstanding, not as collected, even
        // though we still hold the copy the vendor sent the first time.
        .filter((row) => isCollectedFromVendor(row.sub) && !isAwaitingVendorCollection(row.sub, true))
        .sort((a, b) => (b.sub.collection?.receivedOn || "").localeCompare(a.sub.collection?.receivedOn || "")),
    [filteredRows],
  );

  // A purchase order is placed but nobody has listed what the vendor owes yet, so there is
  // nothing on this page to collect. Without calling it out the item would just go quiet.
  const itemsMissingDrawingList = useMemo(
    () => boqItems.filter((item) => poInfoByBoqItemId.has(item.id) && !getMdlSubDrawings(drawings[item.id]).length),
    [boqItems, drawings, poInfoByBoqItemId],
  );

  // Purchase-order groups start closed, so each tab opens as a list of orders rather than every
  // drawing at once. Keyed on the PO alone, not on the tab, so a PO opened under Outstanding is
  // still open under Collected — it is the same order either way.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /**
   * PO-wise grouping for collection rows.
   *
   * Deliberately not `groupMdlRowsByPo`: that assumes one row per BOQ item (a register line),
   * whereas a row here is one *sub-drawing*, so a single item contributes several. Every other
   * rule is kept identical to the shared grouper on purpose — cancelled POs skipped, newest PO
   * first, and an item appearing on two live POs listed under both, because a drawing owed under
   * two orders is genuinely owed under both.
   */
  const groupRowsByPo = useCallback(
    (rows: CollectionRow[]) => {
      const rowsByItemId = new Map<string, CollectionRow[]>();
      for (const row of rows) {
        const list = rowsByItemId.get(row.item.id) ?? [];
        list.push(row);
        rowsByItemId.set(row.item.id, list);
      }

      const groupedItemIds = new Set<string>();
      const groups: { po: MdlPoRef; rows: CollectionRow[] }[] = [];

      for (const po of purchaseOrders) {
        if (po.status === "Cancelled") continue;
        const seen = new Set<string>();
        const poRows: CollectionRow[] = [];
        for (const line of po.items ?? []) {
          const itemId = line.boqItemId;
          // A PO can list the same BOQ item on several lines; its drawings are still one set.
          if (!itemId || seen.has(itemId)) continue;
          const itemRows = rowsByItemId.get(itemId);
          if (!itemRows) continue;
          seen.add(itemId);
          poRows.push(...itemRows);
          groupedItemIds.add(itemId);
        }
        if (!poRows.length) continue;
        groups.push({
          po: {
            poId: po.id,
            poNumber: po.poNumber,
            poDate: po.poDate,
            vendorName: po.vendorName ?? "",
          },
          rows: poRows,
        });
      }

      groups.sort(
        (a, b) =>
          (b.po.poDate || "").localeCompare(a.po.poDate || "") ||
          a.po.poNumber.localeCompare(b.po.poNumber),
      );

      // Every row on this page already has a live PO, so this should stay empty. It is rendered
      // anyway if it ever fills, because a row silently vanishing is worse than an odd group.
      return { groups, ungrouped: rows.filter((row) => !groupedItemIds.has(row.item.id)) };
    },
    [purchaseOrders],
  );

  // Collected but not yet sent to the client — the handover back to the MDL register.
  const awaitingReviewCount = useMemo(
    () =>
      collectedRows.filter(
        (row) => computeMdlDrawingStage(row.sub, true) === "Ready for Review",
      ).length,
    [collectedRows],
  );

  const openCollectDialog = (row: CollectionRow) => {
    setForm({
      receivedOn: row.sub.collection?.receivedOn || todayIso(),
      vendorName: row.sub.collection?.vendorName || row.vendorNames[0] || "",
      remark: row.sub.collection?.remark || "",
    });
    setPendingFile(null);
    setCollecting(row);
  };

  const handleSaveCollection = async () => {
    if (!mapping || !user || !collecting) return;
    if (!form.receivedOn) {
      toast({ title: "Received date is required", variant: "destructive" });
      return;
    }
    // A replacement always needs the new file — the whole point of the request was that the copy
    // we already hold isn't acceptable.
    const needsFreshFile = Boolean(collecting.sub.recollectionRequested) || !collecting.sub.collection?.fileUrl;
    if (!pendingFile && needsFreshFile) {
      toast({
        title: "Attach the vendor's drawing",
        description: collecting.sub.recollectionRequested
          ? "Attach the replacement the vendor sent — the rejected copy stays on the record separately."
          : "Collecting a drawing means recording the file the vendor handed over.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const { item, sub } = collecting;
      let file: Pick<NonNullable<MdlSubDrawing["collection"]>, "fileUrl" | "fileName" | "filePath"> = {
        fileUrl: sub.collection?.fileUrl,
        fileName: sub.collection?.fileName,
        filePath: sub.collection?.filePath,
      };
      if (pendingFile) {
        const safeName = pendingFile.name.replace(/[^A-Za-z0-9._-]/g, "_");
        const path = `project-management/mdl/${mapping.globalProjectId}/${item.id}/${sub.id}/vendor-${Date.now()}-${safeName}`;
        const target = storageRef(storage, path);
        await uploadBytes(target, pendingFile);
        file = { fileUrl: await getDownloadURL(target), fileName: pendingFile.name, filePath: path };
      }

      // Replacing a rejected drawing: keep the copy the vendor sent last time on the record
      // rather than overwriting it away.
      const isReplacement = Boolean(sub.recollectionRequested) && Boolean(sub.collection);
      const history = [
        ...(sub.previousCollections ?? []),
        ...(isReplacement && sub.collection ? [sub.collection] : []),
      ];

      const nextSubs = getMdlSubDrawings(drawings[item.id]).map((candidate) => {
        if (candidate.id !== sub.id) return candidate;
        // Rebuilt rather than spread-and-patched so recollectionRequested is dropped: collecting
        // the replacement is what settles the request.
        const { recollectionRequested: _cleared, ...rest } = candidate;
        return {
          ...rest,
          collection: {
            receivedOn: form.receivedOn,
            ...(form.vendorName.trim() ? { vendorName: form.vendorName.trim() } : {}),
            ...(form.remark.trim() ? { remark: form.remark.trim() } : {}),
            ...(file.fileUrl ? file : {}),
            receivedBy: user.id,
            receivedByName: user.name ?? "",
          },
          ...(history.length ? { previousCollections: history } : {}),
          // Collecting from the vendor is real movement on the drawing, so an untouched
          // sub-drawing stops reading as Pending. Anything further along is left alone.
          status: candidate.status === "Pending" ? ("In Progress" as const) : candidate.status,
          // ISO string, not serverTimestamp() — Firestore rejects sentinels inside arrays.
          updatedAt: new Date().toISOString(),
          updatedBy: user.id,
          updatedByName: user.name ?? "",
        };
      });

      await updateDoc(doc(db, "projects", mapping.globalProjectId, MDL_COLLECTION, item.id), {
        subDrawings: nextSubs,
        updatedAt: serverTimestamp(),
      });
      toast({
        title: "Drawing collected",
        description: "Review it on the MDL register, then submit it to the client.",
      });
      setCollecting(null);
      setPendingFile(null);
      await loadData();
    } catch (error) {
      console.error("Failed to record drawing collection:", error);
      toast({ title: "Unable to record collection", variant: "destructive" });
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
            <CardDescription>Return to Project Management and choose a project before opening Drawing.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  // Vendor, PO number and PO date used to be columns on every row; grouping by purchase order
  // states them once on the group row instead. What is left is one line per drawing, with the
  // item description, assignee and replacement notice — previously stacked three deep inside the
  // description cell — each in a column of its own.
  const DRAWING_COLUMN_COUNT = 10;

  // Compacted here rather than in components/ui/table.tsx, which every other table in the app
  // shares. `[&_td]` beats a cell's own `py-*`, so cells no longer set vertical padding at all.
  const DRAWING_TABLE_DENSITY =
    "[&_th]:h-8 [&_th]:whitespace-nowrap [&_th]:px-2 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1";

  const drawingRows = (rows: CollectionRow[], prefix: number[], mode: "pending" | "collected") =>
    rows.map((row, index) => {
      const { item, sub } = row;
      const stage = computeMdlDrawingStage(sub, true);
      // Being the drawing's assignee is itself the authority to collect it, the same rule
      // the MDL register uses for editing it.
      const canCollectThis = canEditMdlSubDrawing(sub, user?.id, canCollect);
      const redo = sub.recollectionRequested;
      const redoDetail = redo
        ? `Requested ${formatMdlDate(redo.requestedOn)}${
            redo.afterRound ? ` after ${redo.afterRound}` : ""
          }${redo.reason ? ` — ${redo.reason}` : ""}`
        : "";
      return (
        <TableRow key={`${item.id}-${sub.id}`}>
          <TableCell className="whitespace-nowrap font-medium">
            {mdlOutlineNo(...prefix, index)}.
          </TableCell>
          <TableCell className="whitespace-nowrap">{String(item["BOQ SL No"] ?? "—")}</TableCell>
          <TableCell className="max-w-[200px] truncate text-sm font-medium" title={sub.title}>
            {sub.title || "Untitled drawing"}
          </TableCell>
          <TableCell
            className="max-w-[200px] truncate text-xs text-muted-foreground"
            title={String(item.Description ?? "")}
          >
            {String(item.Description ?? "—")}
          </TableCell>
          <TableCell className="max-w-[140px] truncate text-xs" title={sub.assignedToName}>
            {sub.assignedToName || <span className="text-muted-foreground">Unassigned</span>}
          </TableCell>
          <TableCell className="max-w-[180px] whitespace-nowrap">
            {redo ? (
              <span
                className="flex items-center gap-1 truncate text-[11px] text-rose-700"
                title={redoDetail}
              >
                <RotateCcw className="h-3 w-3 shrink-0" />
                <span className="truncate">{redoDetail}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
          <TableCell className="whitespace-nowrap text-sm">
            {mode === "pending"
              ? formatMdlDate(sub.plannedEndDate)
              : formatMdlDate(sub.collection?.receivedOn)}
          </TableCell>
          {/* The PO's vendor is on the group row; this is who actually sent the drawing, which is
              not always the same party and is only known once it has been collected. */}
          <TableCell
            className="max-w-[140px] truncate text-xs text-muted-foreground"
            title={sub.collection?.vendorName}
          >
            {sub.collection?.vendorName || "—"}
          </TableCell>
          <TableCell>
            <span
              className={cn(
                "whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
                mdlDrawingStageStyles[stage],
              )}
            >
              {stage}
            </span>
          </TableCell>
          <TableCell>
            <div className="flex items-center justify-end gap-1">
              {sub.collection?.fileUrl && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  asChild
                  title="Open vendor drawing"
                >
                  <a
                    href={sub.collection.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open vendor drawing for ${sub.title}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
              <Button
                variant={mode === "pending" ? "default" : "outline"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => openCollectDialog(row)}
                disabled={!canCollectThis}
              >
                {mode === "collected" ? "Update" : sub.recollectionRequested ? "Re-collect" : "Collect"}
              </Button>
            </div>
          </TableCell>
        </TableRow>
      );
    });

  /** One collapsible purchase-order row, plus its drawings when open. */
  const drawingGroupRow = (
    key: string,
    outlineIndex: number,
    rows: CollectionRow[],
    mode: "pending" | "collected",
    po?: MdlPoRef,
  ) => {
    const isOpen = expandedGroups.has(key);
    const awaitingRedo = rows.filter((row) => row.sub.recollectionRequested).length;
    return [
      <TableRow
        key={key}
        className={cn("cursor-pointer bg-muted/40 hover:bg-muted/70", isOpen && "border-b-0")}
        onClick={() => toggleGroup(key)}
      >
        <TableCell colSpan={DRAWING_COLUMN_COUNT}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ChevronRight
              aria-hidden
              className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-90")}
            />
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {mdlOutlineNo(outlineIndex)}.
            </span>
            {po ? (
              <>
                <ShoppingCart className="h-4 w-4 shrink-0 text-emerald-600" />
                {/* The PO number is a link, so it must not also toggle the row. */}
                <Link
                  href={`/project-management/purchase-orders/${po.poId}?project=${encodeURIComponent(mappingId)}`}
                  className="font-semibold hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {po.poNumber}
                </Link>
                {po.vendorName && (
                  <span className="text-sm text-muted-foreground">{po.vendorName}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  Ordered {formatMdlDate(po.poDate)}
                </span>
              </>
            ) : (
              <>
                <FolderOpen className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="font-semibold">Other drawings</span>
              </>
            )}
            <div className="ml-auto flex items-center gap-2">
              {awaitingRedo > 0 && (
                <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                  <RotateCcw className="h-3 w-3" />
                  {awaitingRedo} replacement{awaitingRedo === 1 ? "" : "s"}
                </span>
              )}
              <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                {rows.length} drawing{rows.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </TableCell>
      </TableRow>,
      ...(isOpen ? drawingRows(rows, [outlineIndex], mode) : []),
    ];
  };

  const renderTable = (rows: CollectionRow[], mode: "pending" | "collected") => {
    const { groups, ungrouped } = groupRowsByPo(rows);
    const groupKeys = [
      ...groups.map((group) => `po:${group.po.poId}`),
      ...(ungrouped.length ? ["other"] : []),
    ];
    return (
      <>
        {/* This bar carries the table's own title as well as its controls. The card used to add a
            CardHeader above it repeating what the sidebar already says, so the screen titled the
            same table three times over — page header, sidebar, card — before any data. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 px-4 py-2.5">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {mode === "pending" ? (
              <Truck className="h-3.5 w-3.5 shrink-0 text-orange-600" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            )}
            <span className="font-medium text-foreground">
              {mode === "pending" ? "To collect from vendor" : "Collected from vendor"}
            </span>
            · {rows.length} drawing{rows.length === 1 ? "" : "s"} across {groups.length} purchase
            order{groups.length === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setExpandedGroups(new Set(groupKeys))}
              // Checked per key, not by size: the two tabs share this state, so a size match
              // could be satisfied by groups belonging to the other tab.
              disabled={groupKeys.every((key) => expandedGroups.has(key))}
            >
              Expand all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setExpandedGroups(new Set())}
              disabled={expandedGroups.size === 0}
            >
              Collapse all
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table className={DRAWING_TABLE_DENSITY}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">SL NO</TableHead>
                <TableHead>BOQ SL No</TableHead>
                <TableHead className="min-w-[180px]">Drawing</TableHead>
                <TableHead className="min-w-[160px]">Item Description</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Replacement</TableHead>
                <TableHead>{mode === "pending" ? "Planned End" : "Received On"}</TableHead>
                <TableHead>Collected From</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group, groupIndex) =>
                drawingGroupRow(`po:${group.po.poId}`, groupIndex, group.rows, mode, group.po),
              )}
              {ungrouped.length > 0 &&
                drawingGroupRow("other", groups.length, ungrouped, mode)}
            </TableBody>
          </Table>
        </div>
      </>
    );
  };

  return (
    <main className={JMC_MAIN_CLASS}>
      <PmPageHeader
        title="Drawing"
        subtitle={`Collect vendor drawings for every MDL item under purchase order in ${mapping.projectName}.`}
        icon={PenTool}
        backHref={`/project-management/supply?project=${encodeURIComponent(mappingId)}`}
        backLabel="Back to Supply"
        gradient="from-slate-500 to-slate-700"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/project-management/documents?project=${encodeURIComponent(mappingId)}&category=Drawing`}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Document Library
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <SidebarTabsList
          items={[
            { value: "pending", label: "To Collect", icon: Truck, color: "text-orange-600", bg: "bg-orange-100", count: pendingRows.length },
            { value: "collected", label: "Collected", icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100", count: collectedRows.length },
          ]}
          activeValue={activeTab}
          onChange={setActiveTab}
          title="Drawing Collection"
          description="Vendor handover, then review on MDL"
          icon={PenTool}
          gradient="from-slate-500 to-slate-700"
        />

        <div className="min-w-0 flex-1 space-y-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by drawing, item, BOQ SL No, vendor or PO number..."
              aria-label="Search drawings"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {itemsMissingDrawingList.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/60">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-amber-900">
                  <span className="font-semibold">{itemsMissingDrawingList.length}</span> item
                  {itemsMissingDrawingList.length === 1 ? " is" : "s are"} under purchase order with no drawings planned
                  yet — list what the vendor owes before it can be collected.
                </p>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/project-management/mdl?project=${encodeURIComponent(mappingId)}&view=register`}>
                    Plan Drawings on MDL
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {awaitingReviewCount > 0 && (
            <Card className="border-violet-200 bg-violet-50/60">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-violet-900">
                  <span className="font-semibold">{awaitingReviewCount}</span> collected drawing
                  {awaitingReviewCount === 1 ? " is" : "s are"} waiting to be reviewed and submitted to the client.
                </p>
                <Button size="sm" asChild>
                  <Link href={`/project-management/mdl?project=${encodeURIComponent(mappingId)}&view=register`}>
                    Review on MDL Register
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {activeTab === "collected" ? (
            <Card className="overflow-hidden border-border/60">
              <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-600" />
              <CardContent className="p-0">
                {collectedRows.length ? (
                  renderTable(collectedRows, "collected")
                ) : (
                  <div className="flex flex-col items-center gap-3 p-8 text-center">
                    <Inbox className="h-10 w-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {search.trim() ? "No collected drawings match your search." : "No vendor drawings collected yet."}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden border-border/60">
              <div className="h-1 w-full bg-gradient-to-r from-orange-500 to-amber-600" />
              <CardContent className="p-0">
                {pendingRows.length ? (
                  renderTable(pendingRows, "pending")
                ) : (
                  <div className="flex flex-col items-center gap-3 p-8 text-center">
                    <ClipboardCheck className="h-10 w-10 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {search.trim()
                          ? "No outstanding drawings match your search."
                          : allRows.length
                            ? "Every drawing under purchase order has been collected."
                            : "Nothing to collect yet."}
                      </p>
                      {!search.trim() && !allRows.length && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Drawings appear here once a purchase order is placed for an MDL item that has sub-drawings
                          planned against it.
                        </p>
                      )}
                    </div>
                    {!allRows.length && (
                      <Button variant="outline" asChild>
                        <Link href={`/project-management/mdl?project=${encodeURIComponent(mappingId)}&view=register`}>
                          Open MDL Register
                        </Link>
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={!!collecting} onOpenChange={(open) => !open && setCollecting(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {collecting?.sub.recollectionRequested
                ? "Re-collect Drawing from Vendor"
                : collecting && isCollectedFromVendor(collecting.sub)
                  ? "Update Collection"
                  : "Collect Drawing from Vendor"}
            </DialogTitle>
            <DialogDescription>
              {collecting?.sub.title || "Untitled drawing"} · {String(collecting?.item.Description ?? "")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {collecting?.sub.recollectionRequested && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900">
                <p className="font-medium">
                  A replacement was requested on {formatMdlDate(collecting.sub.recollectionRequested.requestedOn)}
                  {collecting.sub.recollectionRequested.afterRound
                    ? ` after ${collecting.sub.recollectionRequested.afterRound} was rejected`
                    : ""}
                  {collecting.sub.recollectionRequested.requestedByName
                    ? ` by ${collecting.sub.recollectionRequested.requestedByName}`
                    : ""}
                  .
                </p>
                {collecting.sub.recollectionRequested.reason && (
                  <p className="mt-0.5">{collecting.sub.recollectionRequested.reason}</p>
                )}
                <p className="mt-1">
                  Recording the new drawing clears the request. The copy you already hold is kept on the record.
                </p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="received-on">
                  Received On <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="received-on"
                  type="date"
                  value={form.receivedOn}
                  onChange={(e) => setForm((c) => ({ ...c, receivedOn: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor-name">Vendor</Label>
                {collecting && collecting.vendorNames.length > 1 ? (
                  <Select value={form.vendorName} onValueChange={(value) => setForm((c) => ({ ...c, vendorName: value }))}>
                    <SelectTrigger id="vendor-name"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                    <SelectContent>
                      {collecting.vendorNames.map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="vendor-name"
                    value={form.vendorName}
                    onChange={(e) => setForm((c) => ({ ...c, vendorName: e.target.value }))}
                    placeholder="Vendor name"
                  />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor-drawing">
                {collecting?.sub.recollectionRequested ? "Replacement Drawing" : "Vendor Drawing"}{" "}
                {(collecting?.sub.recollectionRequested || !collecting?.sub.collection?.fileUrl) && (
                  <span className="text-destructive">*</span>
                )}
              </Label>
              <Input
                id="vendor-drawing"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf,.zip"
                onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
              />
              {(pendingFile || collecting?.sub.collection?.fileUrl) && (
                <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                  <Paperclip className="h-3 w-3 shrink-0" />
                  {pendingFile ? (
                    pendingFile.name
                  ) : (
                    <a
                      href={collecting?.sub.collection?.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate underline underline-offset-2"
                    >
                      {collecting?.sub.collection?.fileName || "Current vendor drawing"}
                    </a>
                  )}
                  {collecting?.sub.collection?.fileUrl && pendingFile && " (replaces the current file)"}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="collection-remark">Remark</Label>
              <Textarea
                id="collection-remark"
                value={form.remark}
                onChange={(e) => setForm((c) => ({ ...c, remark: e.target.value }))}
                placeholder="Optional — e.g. partial set, awaiting revised sheet 3"
              />
            </div>

            <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              Recording the collection moves this drawing to <span className="font-medium">Ready for Review</span>. Review
              it on the MDL register, then submit it to the client from there.
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => void handleSaveCollection()} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
              Save Collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
