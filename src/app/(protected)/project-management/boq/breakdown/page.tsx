"use client";

/**
 * Work Breakdown — the BOQ register with the sub-items each line is broken into.
 *
 * A client's BOQ line is what you are paid for; a sub-item is what you actually buy and build.
 * Breaking "Earthing system, 1 LOT" into pits, strip and testing lets procurement indent and order
 * the parts, while the client's JMC and RA bill stay on the LOT and read the parts rolled up.
 *
 * Two rules this screen exists to enforce:
 *
 *  - **A line with work against it cannot be broken down.** Its indents, orders and measurements
 *    point at the line; children would mean the line's records and its children's were both
 *    counted. The ⋯ menu says which register is holding it.
 *  - **The parts always add back to the line.** A sub-item takes a *share*, never its own typed
 *    rate, so the contract total cannot drift because somebody subdivided a line.
 *
 * This is not Daily Progress's breakdown. DPR splits a line for how work is sequenced day to day;
 * this splits it for what is bought and sub-contracted, and the two are separate records that
 * share only their arithmetic (`boq-breakdown.ts`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ListTree,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { PM_PROJECT_COLLECTION } from "@/lib/project-management-projects";
import { isBoqSectionHeader } from "@/lib/project-management-boq-columns";
import { civilBoqKey, readBoqSlNo, readErpSlNo, readLooseScope } from "@/lib/civil-execution";
import {
  BOQ_SUB_ITEM_COLLECTION,
  boqLineValues,
  boqNodeValues,
  buildBoqBreakdown,
  checkBoqSubItem,
  checkBoqSubItemDelete,
  nextSubItemSlNo,
  type BoqBreakdownNode,
  type BoqSubItem,
  type BoqSubItemDraft,
} from "@/lib/project-management-boq-subitems";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const MODULE_NAME = "Project Management";

const money = (value: number): string =>
  value === 0
    ? "—"
    : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(value));

const qtyText = (value: number): string =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

interface BoqLineRow {
  id: string;
  boqSlNo: string;
  erpSlNo: string;
  description: string;
  unit: string;
  boqQty: number;
  rate: number;
  scope: string;
  raw: Record<string, unknown>;
}

const readText = (item: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = item[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
};

const emptyDraft = (parentId: string, boqItemId: string, slNo: string): BoqSubItemDraft => ({
  boqItemId,
  parentId,
  slNo,
  description: "",
  unit: "",
  qty: 0,
  weightPct: null,
  order: 0,
  remarks: "",
});

export default function BoqBreakdownPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { user } = useAuth();
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", `${MODULE_NAME}.BOQ`);
  const canBreakDown = !isAuthLoading && can("Break Down", `${MODULE_NAME}.BOQ`);

  const [globalProjectId, setGlobalProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [resolvedFor, setResolvedFor] = useState("");
  const [lines, setLines] = useState<BoqLineRow[]>([]);
  const [subItems, setSubItems] = useState<BoqSubItem[]>([]);
  /** BOQ lines and sub-items that already carry work, so they can no longer be subdivided. */
  const [recordedIds, setRecordedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [scope, setScope] = useState("All");
  const [show, setShow] = useState<"all" | "broken" | "whole">("all");
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const [dialog, setDialog] = useState<
    { mode: "add"; parent: BoqBreakdownNode } | { mode: "edit"; node: BoqBreakdownNode } | null
  >(null);
  const [draft, setDraft] = useState<BoqSubItemDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleting, setDeleting] = useState<{ node: BoqBreakdownNode; ids: string[] } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  /* ── Loading ──────────────────────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!mappingId || mappingId === resolvedFor) return;
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await getDoc(doc(db, PM_PROJECT_COLLECTION, mappingId));
        if (cancelled) return;
        const data = snapshot.exists()
          ? (snapshot.data() as { globalProjectId?: unknown; projectName?: unknown })
          : null;
        setGlobalProjectId(String(data?.globalProjectId ?? ""));
        setProjectName(String(data?.projectName ?? ""));
      } catch (error) {
        console.error("Failed to resolve the project mapping:", error);
        if (!cancelled) setGlobalProjectId("");
      } finally {
        if (!cancelled) setResolvedFor(mappingId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mappingId, resolvedFor]);

  const reload = useCallback(async () => {
    if (!globalProjectId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      const project = (name: string) => collection(db, "projects", globalProjectId, name);
      const [boqSnap, subSnap, indentSnap, poSnap, woSnap, jmcSnap] = await Promise.all([
        getDocs(project("boqItems")),
        getDocs(project(BOQ_SUB_ITEM_COLLECTION)),
        getDocs(project("indents")),
        getDocs(project("purchaseOrders")),
        getDocs(project("workOrders")),
        getDocs(project("jmcEntries")),
      ]);

      const rows: BoqLineRow[] = [];
      for (const boqDoc of boqSnap.docs) {
        const raw = { id: boqDoc.id, ...boqDoc.data() } as Record<string, unknown> & { id: string };
        // A caption row groups the lines below it but is not itself orderable, so it cannot be
        // broken down either.
        if (isBoqSectionHeader(raw as { Unit?: unknown; QTY?: unknown })) continue;
        rows.push({
          id: raw.id,
          boqSlNo: readBoqSlNo(raw),
          erpSlNo: readErpSlNo(raw),
          description: readText(raw, ["Description", "DESCRIPTION OF ITEMS", "description"]),
          unit: readText(raw, ["Unit", "UNIT", "Units"]),
          boqQty: Number(String(raw.QTY ?? raw.Quantity ?? raw.quantity ?? 0).replace(/,/g, "")) || 0,
          rate: boqLineValues(raw).contract,
          scope: readLooseScope(raw, 2) || "Unscoped",
          raw,
        });
      }

      /*
       * What already holds a line. Indents, purchase orders and work orders store `boqItemId` on
       * their lines; a JMC measurement stores no id at all, so it is matched by the composite
       * scope + SL No key the civil lane uses everywhere.
       */
      const recorded = new Set<string>();
      const noteIds = (docs: typeof indentSnap.docs) => {
        for (const entry of docs) {
          const data = entry.data() as { items?: Array<{ boqItemId?: unknown }> };
          for (const item of data.items ?? []) {
            const id = String(item?.boqItemId ?? "").trim();
            if (id) recorded.add(id);
          }
        }
      };
      noteIds(indentSnap.docs);
      noteIds(poSnap.docs);
      noteIds(woSnap.docs);

      const lineByKey = new Map<string, string>();
      for (const row of rows) {
        lineByKey.set(
          civilBoqKey(readLooseScope(row.raw, 1), readLooseScope(row.raw, 2), row.boqSlNo),
          row.id,
        );
      }
      for (const entry of jmcSnap.docs) {
        const data = entry.data() as {
          items?: Array<{ scope1?: unknown; scope2?: unknown; boqSlNo?: unknown }>;
        };
        for (const item of data.items ?? []) {
          const id = lineByKey.get(
            civilBoqKey(String(item?.scope1 ?? ""), String(item?.scope2 ?? ""), String(item?.boqSlNo ?? "")),
          );
          if (id) recorded.add(id);
        }
      }

      setLines(rows);
      setSubItems(
        subSnap.docs.map((subDoc) => ({ id: subDoc.id, ...subDoc.data() }) as BoqSubItem),
      );
      setRecordedIds(recorded);
    } catch (error) {
      console.error("Failed to load the BOQ breakdown:", error);
      setLoadError("The BOQ breakdown could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId]);

  const isResolving = Boolean(mappingId) && mappingId !== resolvedFor;

  useEffect(() => {
    if (isResolving || !canView || !globalProjectId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [canView, globalProjectId, isResolving, reload]);

  /* ── The tree ─────────────────────────────────────────────────────────────────────────────── */

  const breakdown = useMemo(() => buildBoqBreakdown(lines, subItems), [lines, subItems]);

  const values = useMemo(() => {
    const byId = new Map(lines.map((line) => [line.id, line.raw]));
    return boqNodeValues(breakdown, (lineId) => boqLineValues(byId.get(lineId)));
  }, [breakdown, lines]);

  const scopes = useMemo(
    () => ["All", ...[...new Set(lines.map((line) => line.scope))].sort()],
    [lines],
  );

  const scopeNodes = useMemo(
    () =>
      breakdown.ordered.filter((node) => {
        if (scope !== "All" && node.scope !== scope) return false;
        if (show === "all") return true;
        const broken = breakdown.groupLineIds.has(node.boqItemId);
        return show === "broken" ? broken : !broken;
      }),
    [breakdown, scope, show],
  );

  const counts = useMemo(() => {
    const all = breakdown.ordered.filter((node) => scope === "All" || node.scope === scope);
    const boqLines = all.filter((node) => node.kind === "boq");
    return {
      lines: boqLines.length,
      groups: boqLines.filter((node) => !node.isLeaf).length,
      subItems: all.filter((node) => node.kind === "sub").length,
    };
  }, [breakdown, scope]);

  /**
   * Filtering shows every match with the lines above it, open, so a match deep in a breakdown is
   * never hidden by a closed group; otherwise a closed group hides its branch.
   */
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle) {
      const keep = new Set<string>();
      for (const node of scopeNodes) {
        if (!`${node.slNo} ${node.description} ${node.unit}`.toLowerCase().includes(needle)) continue;
        keep.add(node.id);
        let parentId = node.parentId;
        while (parentId) {
          keep.add(parentId);
          parentId = breakdown.nodes.get(parentId)?.parentId ?? null;
        }
      }
      return scopeNodes.filter((node) => keep.has(node.id));
    }
    return scopeNodes.filter((node) => {
      let parentId = node.parentId;
      while (parentId) {
        if (collapsed.has(parentId)) return false;
        parentId = breakdown.nodes.get(parentId)?.parentId ?? null;
      }
      return true;
    });
  }, [filter, scopeNodes, breakdown, collapsed]);

  const groupIds = useMemo(
    () => scopeNodes.filter((node) => !node.isLeaf).map((node) => node.id),
    [scopeNodes],
  );

  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Why this node cannot take a sub-item; empty when it can. */
  const addBlockedBy = useCallback(
    (node: BoqBreakdownNode): string => {
      if (node.depth + 1 > 5) return "It is already five levels deep.";
      if (node.isLeaf && recordedIds.has(node.id)) {
        return "Work is already recorded against it — an indent, an order or a measurement.";
      }
      return "";
    },
    [recordedIds],
  );

  /* ── Writing ──────────────────────────────────────────────────────────────────────────────── */

  const openAdd = (parent: BoqBreakdownNode) => {
    const siblings = breakdown.childrenOf(parent.id);
    setDialog({ mode: "add", parent });
    setDraft({
      ...emptyDraft(parent.id, parent.boqItemId, nextSubItemSlNo(parent.slNo, siblings)),
      unit: parent.unit,
      order: siblings.length,
    });
  };

  const openEdit = (node: BoqBreakdownNode) => {
    const stored = subItems.find((item) => item.id === node.id);
    if (!stored) return;
    setDialog({ mode: "edit", node });
    setDraft({
      boqItemId: stored.boqItemId,
      parentId: stored.parentId,
      slNo: stored.slNo,
      description: stored.description,
      unit: stored.unit,
      qty: stored.qty,
      weightPct: stored.weightPct ?? null,
      order: stored.order,
      remarks: stored.remarks ?? "",
    });
  };

  const check = useMemo(
    () =>
      draft
        ? checkBoqSubItem({
            draft,
            editingId: dialog?.mode === "edit" ? dialog.node.id : undefined,
            breakdown,
            recordedIds,
          })
        : { errors: [], warnings: [] },
    [draft, dialog, breakdown, recordedIds],
  );

  const handleSave = async () => {
    if (!draft || !globalProjectId || !user) return;
    if (check.errors.length > 0) {
      toast({ title: "Check the sub-item", description: check.errors[0], variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const editingId = dialog?.mode === "edit" ? dialog.node.id : "";
      const ref = editingId
        ? doc(db, "projects", globalProjectId, BOQ_SUB_ITEM_COLLECTION, editingId)
        : doc(collection(db, "projects", globalProjectId, BOQ_SUB_ITEM_COLLECTION));
      const audit = editingId
        ? { updatedAt: serverTimestamp(), updatedBy: user.id, updatedByName: user.name ?? "" }
        : {
            createdAt: serverTimestamp(),
            createdBy: user.id,
            createdByName: user.name ?? "",
            updatedAt: serverTimestamp(),
            updatedBy: user.id,
            updatedByName: user.name ?? "",
          };
      await setDoc(ref, { ...draft, ...audit }, { merge: true });

      void logUserActivity({
        userId: user.id ?? "",
        userName: user.name ?? "",
        userEmail: user.email ?? "",
        module: MODULE_NAME,
        action: `${editingId ? "Update" : "Add"} BOQ Sub-item`,
        details: {
          project: projectName,
          slNo: draft.slNo,
          description: draft.description,
          qty: draft.qty,
          unit: draft.unit,
        },
      });

      toast({ title: editingId ? `Sub-item ${draft.slNo} updated` : `Sub-item ${draft.slNo} added` });
      setDialog(null);
      setDraft(null);
      await reload();
    } catch (error) {
      console.error("Failed to save the sub-item:", error);
      toast({ title: "Save failed", description: "The sub-item could not be saved.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const askDelete = (node: BoqBreakdownNode) => {
    const result = checkBoqSubItemDelete({ id: node.id, breakdown, recordedIds });
    if (result.errors.length > 0) {
      toast({ title: "Cannot delete", description: result.errors[0], variant: "destructive" });
      return;
    }
    setDeleting({ node, ids: result.deleteIds });
  };

  const confirmDelete = async () => {
    if (!deleting || !globalProjectId || !user) return;
    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      for (const id of deleting.ids) {
        batch.delete(doc(db, "projects", globalProjectId, BOQ_SUB_ITEM_COLLECTION, id));
      }
      await batch.commit();
      void logUserActivity({
        userId: user.id ?? "",
        userName: user.name ?? "",
        userEmail: user.email ?? "",
        module: MODULE_NAME,
        action: "Delete BOQ Sub-item",
        details: { project: projectName, slNo: deleting.node.slNo, removed: deleting.ids.length },
      });
      toast({
        title: `Sub-item ${deleting.node.slNo} deleted`,
        description:
          deleting.ids.length > 1
            ? `${deleting.ids.length - 1} sub-item(s) under it went with it.`
            : undefined,
      });
      setDeleting(null);
      await reload();
    } catch (error) {
      console.error("Failed to delete the sub-item:", error);
      toast({ title: "Delete failed", variant: "destructive" });
      throw error;
    } finally {
      setIsDeleting(false);
    }
  };

  /* ── Render ───────────────────────────────────────────────────────────────────────────────── */

  const withProject = (path: string) =>
    `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(mappingId)}`;

  if (isAuthLoading || isResolving) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-4 p-4 sm:p-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title="Work Breakdown" icon={ListTree} />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            You do not have permission to view the BOQ.
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!mappingId || !globalProjectId) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title="Work Breakdown" icon={ListTree} />
        <Card className="max-w-xl">
          <CardContent className="space-y-3 p-6">
            <p className="text-sm text-muted-foreground">
              Choose a project before opening its work breakdown.
            </p>
            <Button asChild>
              <a href="/project-management">Select project</a>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-4 p-4 sm:p-6">
      <PageHeader
        title="Work Breakdown"
        description="The parts each BOQ line is broken into, for buying and sub-contracting."
        icon={ListTree}
        backHref={withProject("/project-management/boq")}
        backLabel="Back to BOQ"
      />

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{loadError}</CardContent>
        </Card>
      ) : null}

      {!canBreakDown ? (
        <Card className="border-amber-500/40">
          <CardContent className="p-4 text-sm text-muted-foreground">
            You can read the breakdown but not change it. Ask for the Break Down action on{" "}
            {MODULE_NAME}.BOQ — subdividing a line changes what everybody downstream can order
            against.
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border/60">
        <CardContent className="space-y-3 p-4">
          <SectionHeader
            title="BOQ register"
            icon={ListTree}
            description="Work is bought and measured on the lowest level. A line with sub-items becomes a group: its figures roll up from its parts, in its own unit, and each part takes a share of the line's value so the contract total never drifts. Sub-items can only be added before anything is indented, ordered or measured on a line, so nothing is counted twice. The client's BOQ — JMC and billing — is not changed."
            badge={
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {counts.lines} line{counts.lines === 1 ? "" : "s"} · {counts.groups} broken down ·{" "}
                {counts.subItems} sub-item{counts.subItems === 1 ? "" : "s"}
              </span>
            }
            className="mb-0"
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem] space-y-1.5">
              <Label htmlFor="breakdown-scope">Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger id="breakdown-scope" className="text-left">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scopes.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "All" ? "All scopes" : option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[11rem] space-y-1.5">
              <Label htmlFor="breakdown-show">Show</Label>
              <Select value={show} onValueChange={(next) => setShow(next as typeof show)}>
                <SelectTrigger id="breakdown-show" className="text-left">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All lines</SelectItem>
                  <SelectItem value="broken">Broken down</SelectItem>
                  <SelectItem value="whole">Not broken down</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[14rem] flex-1 space-y-1.5">
              <Label htmlFor="breakdown-filter">Find</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="breakdown-filter"
                  className="pl-9"
                  placeholder="SL No, description or unit…"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => setCollapsed(new Set())}
                disabled={collapsed.size === 0 || Boolean(filter.trim())}
              >
                <ChevronsUpDown className="mr-1.5 h-4 w-4" /> Expand all
              </Button>
              <Button
                variant="outline"
                onClick={() => setCollapsed(new Set(groupIds))}
                disabled={groupIds.length === 0 || Boolean(filter.trim())}
              >
                <ChevronsDownUp className="mr-1.5 h-4 w-4" /> Collapse all
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-10 animate-pulse rounded bg-muted/50" />
              ))}
            </div>
          ) : counts.lines === 0 ? (
            <PmEmptyState
              icon={ListTree}
              title="No BOQ lines on this project"
              description="Import or add the BOQ before breaking its lines down."
            />
          ) : rows.length === 0 ? (
            <PmEmptyState
              icon={Search}
              title={
                show === "broken" && !filter.trim()
                  ? "No BOQ line is broken into sub-items yet"
                  : "Nothing matches the filter"
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/60">
              <TooltipProvider delayDuration={150}>
                <Table
                  stickyHeader
                  containerClassName="max-h-[65vh] overflow-auto"
                  className="min-w-[1050px]"
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[150px]">SL No</TableHead>
                      <TableHead className="min-w-[260px]">Description</TableHead>
                      <TableHead className="w-[80px]">Unit</TableHead>
                      <TableHead className="w-[110px] text-right">Quantity</TableHead>
                      <TableHead className="w-[90px] text-right">Share</TableHead>
                      <TableHead className="w-[130px] text-right">Contract ₹</TableHead>
                      <TableHead className="w-[130px] text-right">Budget ₹</TableHead>
                      <TableHead className="w-[120px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((node) => {
                      const value = values.get(node.id);
                      const isGroup = !node.isLeaf;
                      const blocked = addBlockedBy(node);
                      const locked = node.isLeaf && recordedIds.has(node.id);
                      return (
                        <TableRow
                          key={node.id}
                          className={cn(node.kind === "boq" && "bg-muted/30 font-medium")}
                        >
                          <TableCell className="whitespace-nowrap">
                            <span
                              className="flex items-center gap-1"
                              style={{ paddingLeft: `${node.depth * 16}px` }}
                            >
                              {isGroup ? (
                                <button
                                  type="button"
                                  onClick={() => toggle(node.id)}
                                  className="rounded p-0.5 hover:bg-muted"
                                  aria-label={collapsed.has(node.id) ? "Expand" : "Collapse"}
                                >
                                  {collapsed.has(node.id) ? (
                                    <ChevronRight className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                </button>
                              ) : (
                                <span className="inline-block w-5" />
                              )}
                              <span className="tabular-nums">{node.slNo || "—"}</span>
                              {locked ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Work is recorded against this — it can no longer be subdivided.
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                            </span>
                          </TableCell>
                          <TableCell className="min-w-[260px]">
                            <span className="block truncate">{node.description || "—"}</span>
                            {isGroup ? (
                              <span className="block text-[11px] text-muted-foreground">
                                {breakdown.childrenOf(node.id).length} part
                                {breakdown.childrenOf(node.id).length === 1 ? "" : "s"} · figures
                                roll up
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {node.unit || "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {qtyText(node.qty)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {node.kind === "boq"
                              ? "—"
                              : `${Math.round(node.weight * 1000) / 10}%`}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(value?.contractValue ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {money(value?.budgetValue ?? 0)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {blocked ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>
                                      <Button size="icon" variant="ghost" disabled aria-label="Add sub-item">
                                        <Plus className="h-4 w-4" />
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">{blocked}</TooltipContent>
                                </Tooltip>
                              ) : (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label="Add sub-item"
                                  disabled={!canBreakDown}
                                  onClick={() => openAdd(node)}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              )}
                              {node.kind === "sub" ? (
                                <>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label="Edit sub-item"
                                    disabled={!canBreakDown}
                                    onClick={() => openEdit(node)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label="Delete sub-item"
                                    disabled={!canBreakDown}
                                    onClick={() => askDelete(node)}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add or edit a sub-item ────────────────────────────────────────────────────────── */}
      <Dialog
        open={Boolean(dialog)}
        onOpenChange={(open) => {
          if (!open && !isSaving) {
            setDialog(null);
            setDraft(null);
          }
        }}
      >
        <DialogContent className="gap-4 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "edit" ? "Edit sub-item" : "Add a sub-item"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.mode === "add"
                ? `A part of ${dialog.parent.slNo || "this line"} — ${dialog.parent.description || "BOQ line"}.`
                : "The unit cannot change once something is ordered or recorded against it."}
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sub-slno">SL No</Label>
                <Input
                  id="sub-slno"
                  value={draft.slNo}
                  onChange={(event) =>
                    setDraft((previous) => previous && { ...previous, slNo: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-unit">Unit</Label>
                <Input
                  id="sub-unit"
                  value={draft.unit}
                  placeholder="Nos / Rmt / Cum"
                  onChange={(event) =>
                    setDraft((previous) => previous && { ...previous, unit: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="sub-description">Description</Label>
                <Input
                  id="sub-description"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft(
                      (previous) => previous && { ...previous, description: event.target.value },
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-qty">Quantity</Label>
                <Input
                  id="sub-qty"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  className="text-right"
                  value={draft.qty || ""}
                  onChange={(event) =>
                    setDraft(
                      (previous) =>
                        previous && { ...previous, qty: Number(event.target.value) || 0 },
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-share">Share of the parent (%)</Label>
                <Input
                  id="sub-share"
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  inputMode="decimal"
                  className="text-right"
                  placeholder="Leave blank to split the rest"
                  value={draft.weightPct ?? ""}
                  onChange={(event) =>
                    setDraft(
                      (previous) =>
                        previous && {
                          ...previous,
                          weightPct: event.target.value === "" ? null : Number(event.target.value),
                        },
                    )
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="sub-remarks">Remarks</Label>
                <Textarea
                  id="sub-remarks"
                  rows={2}
                  value={draft.remarks ?? ""}
                  onChange={(event) =>
                    setDraft((previous) => previous && { ...previous, remarks: event.target.value })
                  }
                />
              </div>
            </div>
          ) : null}

          {check.errors.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {check.errors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          ) : check.warnings.length > 0 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
              {check.warnings.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialog(null);
                setDraft(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!canBreakDown || isSaving || check.errors.length > 0}
              onClick={() => void handleSave()}
            >
              {dialog?.mode === "edit" ? "Save sub-item" : "Add sub-item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => (!open && !isDeleting ? setDeleting(null) : undefined)}
        destructive
        loading={isDeleting}
        title={deleting ? `Delete sub-item ${deleting.node.slNo}?` : undefined}
        description={
          deleting
            ? deleting.ids.length > 1
              ? `${deleting.node.description} and the ${deleting.ids.length - 1} sub-item(s) under it will be deleted. Nothing is recorded against any of them.`
              : `${deleting.node.description} will be deleted. Nothing is recorded against it.`
            : undefined
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />
    </main>
  );
}
