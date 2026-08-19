"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FolderOpen,
  Inbox,
  Loader2,
  Paperclip,
  PenTool,
  Search,
  ShieldAlert,
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
  isCollectedFromVendor,
  mdlDrawingStageStyles,
  mdlOutlineNo,
  type MdlDrawing,
  type MdlSubDrawing,
} from "@/lib/mdl";
import { PO_COLLECTION, type PurchaseOrder } from "@/lib/purchase-orders";
import SidebarTabsList from "@/components/project-management/sidebar-tabs-list";

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

  const pendingRows = useMemo(
    () =>
      filteredRows
        .filter((row) => !isCollectedFromVendor(row.sub))
        // Oldest purchase order first: the vendor has owed those the longest.
        .sort((a, b) => (a.latestPoDate || "").localeCompare(b.latestPoDate || "")),
    [filteredRows],
  );

  const collectedRows = useMemo(
    () =>
      filteredRows
        .filter((row) => isCollectedFromVendor(row.sub))
        .sort((a, b) => (b.sub.collection?.receivedOn || "").localeCompare(a.sub.collection?.receivedOn || "")),
    [filteredRows],
  );

  // A purchase order is placed but nobody has listed what the vendor owes yet, so there is
  // nothing on this page to collect. Without calling it out the item would just go quiet.
  const itemsMissingDrawingList = useMemo(
    () => boqItems.filter((item) => poInfoByBoqItemId.has(item.id) && !getMdlSubDrawings(drawings[item.id]).length),
    [boqItems, drawings, poInfoByBoqItemId],
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
    const alreadyHasFile = Boolean(collecting.sub.collection?.fileUrl);
    if (!pendingFile && !alreadyHasFile) {
      toast({
        title: "Attach the vendor's drawing",
        description: "Collecting a drawing means recording the file the vendor handed over.",
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

      const nextSubs = getMdlSubDrawings(drawings[item.id]).map((candidate) =>
        candidate.id === sub.id
          ? {
              ...candidate,
              collection: {
                receivedOn: form.receivedOn,
                ...(form.vendorName.trim() ? { vendorName: form.vendorName.trim() } : {}),
                ...(form.remark.trim() ? { remark: form.remark.trim() } : {}),
                ...(file.fileUrl ? file : {}),
                receivedBy: user.id,
                receivedByName: user.name ?? "",
              },
              // Collecting from the vendor is real movement on the drawing, so an untouched
              // sub-drawing stops reading as Pending. Anything further along is left alone.
              status: candidate.status === "Pending" ? ("In Progress" as const) : candidate.status,
              // ISO string, not serverTimestamp() — Firestore rejects sentinels inside arrays.
              updatedAt: new Date().toISOString(),
              updatedBy: user.id,
              updatedByName: user.name ?? "",
            }
          : candidate,
      );

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

  const renderTable = (rows: CollectionRow[], mode: "pending" | "collected") => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">SL NO</TableHead>
            <TableHead>BOQ SL No</TableHead>
            <TableHead className="min-w-[240px]">Item / Drawing</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>PO Number</TableHead>
            <TableHead>PO Date</TableHead>
            <TableHead>{mode === "pending" ? "Planned End" : "Received On"}</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const { item, sub } = row;
            const stage = computeMdlDrawingStage(sub, true);
            // Being the drawing's assignee is itself the authority to collect it, the same rule
            // the MDL register uses for editing it.
            const canCollectThis = canEditMdlSubDrawing(sub, user?.id, canCollect);
            return (
              <TableRow key={`${item.id}-${sub.id}`}>
                <TableCell className="font-medium">{mdlOutlineNo(index)}.</TableCell>
                <TableCell className="whitespace-nowrap">{String(item["BOQ SL No"] ?? "—")}</TableCell>
                <TableCell className="max-w-xs">
                  <p className="truncate text-sm font-medium" title={sub.title}>{sub.title || "Untitled drawing"}</p>
                  <p className="truncate text-[11px] text-muted-foreground" title={String(item.Description ?? "")}>
                    {String(item.Description ?? "—")}
                    {sub.assignedToName ? ` · ${sub.assignedToName}` : ""}
                  </p>
                </TableCell>
                <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground" title={row.vendorNames.join(", ")}>
                  {sub.collection?.vendorName || row.vendorNames.join(", ") || "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{row.poNumbers.join(", ")}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">{formatMdlDate(row.latestPoDate)}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {mode === "pending" ? formatMdlDate(sub.plannedEndDate) : formatMdlDate(sub.collection?.receivedOn)}
                </TableCell>
                <TableCell>
                  <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", mdlDrawingStageStyles[stage])}>
                    {stage}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    {sub.collection?.fileUrl && (
                      <Button variant="ghost" size="icon" asChild title="Open vendor drawing">
                        <a href={sub.collection.fileUrl} target="_blank" rel="noreferrer" aria-label={`Open vendor drawing for ${sub.title}`}>
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    <Button
                      variant={mode === "pending" ? "default" : "outline"}
                      size="sm"
                      onClick={() => openCollectDialog(row)}
                      disabled={!canCollectThis}
                    >
                      {mode === "pending" ? "Collect" : "Update"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/project-management/supply?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Supply">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 shadow-sm">
            <PenTool className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Drawing</h1>
            <p className="text-sm text-muted-foreground">
              Collect vendor drawings for every MDL item under purchase order in {mapping.projectName}.
            </p>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/project-management/documents?project=${encodeURIComponent(mappingId)}&category=Drawing`}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Document Library
          </Link>
        </Button>
      </div>

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
          tint="from-slate-500/10 to-slate-600/5"
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
            <Card className="border-border/60">
              <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-600" />
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-4 w-4" /> Collected from Vendor
                </CardTitle>
                <CardDescription>
                  Drawings the vendor has handed over. Review and submit them to the client on the MDL register.
                </CardDescription>
              </CardHeader>
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
            <Card className="border-border/60">
              <div className="h-1 w-full bg-gradient-to-r from-orange-500 to-amber-600" />
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Truck className="h-4 w-4" /> To Collect from Vendor
                </CardTitle>
                <CardDescription>
                  A purchase order has been placed for these items, so the vendor owes us these drawings.
                </CardDescription>
              </CardHeader>
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
              {collecting && isCollectedFromVendor(collecting.sub) ? "Update Collection" : "Collect Drawing from Vendor"}
            </DialogTitle>
            <DialogDescription>
              {collecting?.sub.title || "Untitled drawing"} · {String(collecting?.item.Description ?? "")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
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
                Vendor Drawing {!collecting?.sub.collection?.fileUrl && <span className="text-destructive">*</span>}
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
