"use client";

/**
 * Daily Progress's BOQ register — this project's Civil and Erection BOQ lines with the sub-items
 * each is broken into, and theirs under those.
 *
 * Progress is planned and recorded on the lowest level only; a line with sub-items becomes a group
 * whose figures roll up from its leaves in its own unit (see project-management-dpr-breakdown.ts),
 * so a 1 LOT line whose parts are 40% done reads 0.4 LOT. The client's BOQ register (billing, JMC)
 * is never changed: the breakdown lives in this module only.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronsDownUp, ChevronsUpDown, ListTree, Search } from "lucide-react";
import { doc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { DPR_PERMISSION_RESOURCE, type DprScope } from "@/lib/project-management-dpr";
import { indexDprActuals, openPlanQty } from "@/lib/project-management-dpr-plan";
import { AddSubItemsDialog } from "@/components/project-management/dpr/boq-register-add-several";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DPR_MAX_BREAKDOWN_DEPTH,
  DPR_SUB_ITEM_COLLECTION,
  checkDprSubItemDelete,
  hasDprRecords,
  type DprBreakdownNode,
} from "@/lib/project-management-dpr-breakdown";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprAccessDenied,
  DprHeader,
  DprLoadingState,
  DprPageShell,
  DprProjectNotFound,
  DprScopeTabs,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";
import {
  BreakdownTree,
  type BreakdownTreeRow,
} from "@/components/project-management/dpr/breakdown-tree";
import {
  SubItemDialog,
  addBlockersFor,
  type SubItemDialogRequest,
} from "@/components/project-management/dpr/breakdown-dialogs";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SectionHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function DprBoqRegisterPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { user } = useAuth();
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);
  const canEdit = !isAuthLoading && can("Edit", DPR_PERMISSION_RESOURCE);
  const canDelete = !isAuthLoading && can("Delete", DPR_PERMISSION_RESOURCE);

  const data = useDprData(mappingId, canView);
  const { breakdown, entries, targets } = data;

  const linkedScope = searchParams?.get("scope");
  const [scope, setScope] = useState<DprScope>(linkedScope === "Erection" ? "Erection" : "Civil");
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<SubItemDialogRequest | null>(null);
  /** The line "Add several sub-items" is open for. */
  const [addingSeveral, setAddingSeveral] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ node: DprBreakdownNode; ids: string[] } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  /** Which BOQ lines to list: all of them, only those broken into sub-items, or only those not. */
  const [show, setShow] = useState<"all" | "broken" | "whole">("all");

  const actuals = useMemo(() => indexDprActuals(entries), [entries]);
  /** Submitted work rolled up to every node, in that node's own unit. */
  const done = useMemo(() => breakdown.rollUp((id) => actuals.total(id)), [breakdown, actuals]);
  /** What is still planned from today on — future days, and today until its sheet is in. */
  const openPlan = useMemo(() => {
    const today = todayIso();
    return breakdown.rollUp((id) => {
      const node = breakdown.nodes.get(id);
      return node ? openPlanQty(data.plan.daily(id), today, actuals.hasSheet(node.scope, today)) : 0;
    });
  }, [breakdown, data.plan, actuals]);

  const scopeNodes = useMemo(
    () =>
      breakdown.ordered.filter((node) => {
        if (node.scope !== scope) return false;
        if (show === "all") return true;
        const broken = breakdown.groupLineIds.has(node.boqItemId);
        return show === "broken" ? broken : !broken;
      }),
    [breakdown, scope, show],
  );

  /** The whole scope's figures, whatever the "Show" filter hides. */
  const counts = useMemo(() => {
    const all = breakdown.ordered.filter((node) => node.scope === scope);
    const lines = all.filter((node) => node.kind === "boq");
    return {
      lines: lines.length,
      groups: lines.filter((node) => !node.isLeaf).length,
      subItems: all.filter((node) => node.kind === "sub").length,
    };
  }, [breakdown, scope]);

  /**
   * The rows to show. Filtering shows every match with the lines above it, open, so a match deep in
   * a breakdown is never hidden by a closed group; otherwise a closed group hides its branch.
   */
  const rows = useMemo<BreakdownTreeRow[]>(() => {
    const needle = filter.trim().toLowerCase();
    let visible: DprBreakdownNode[];
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
      visible = scopeNodes.filter((node) => keep.has(node.id));
    } else {
      visible = scopeNodes.filter((node) => {
        let parentId = node.parentId;
        while (parentId) {
          if (collapsed.has(parentId)) return false;
          parentId = breakdown.nodes.get(parentId)?.parentId ?? null;
        }
        return true;
      });
    }
    return visible.map((node) => {
      const nodeDone = done.get(node.id) ?? 0;
      return {
        node,
        done: nodeDone,
        balance: Math.round((node.qty - nodeDone) * 1e6) / 1e6,
        openPlan: openPlan.get(node.id) ?? 0,
        addBlockedBy: canEdit ? addBlockersFor(node, data) : [],
        hasRecords: hasDprRecords(node.id, targets, entries),
      };
    });
  }, [filter, scopeNodes, breakdown, collapsed, done, openPlan, canEdit, data, targets, entries]);

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

  const askDelete = (node: DprBreakdownNode) => {
    const result = checkDprSubItemDelete({ id: node.id, breakdown, targets, entries });
    if (result.errors.length > 0) {
      toast({ title: "Cannot delete", description: result.errors[0], variant: "destructive" });
      return;
    }
    setDeleting({ node, ids: result.deleteIds });
  };

  const confirmDelete = async () => {
    if (!deleting || !data.globalProjectId || !user) return;
    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      for (const id of deleting.ids) {
        batch.delete(doc(db, "projects", data.globalProjectId, DPR_SUB_ITEM_COLLECTION, id));
      }
      await batch.commit();
      void logUserActivity({
        userId: user.id ?? "",
        userName: user.name ?? "",
        userEmail: user.email ?? "",
        module: "Project Management",
        action: "Delete DPR Sub-item",
        details: {
          project: data.projectName,
          slNo: deleting.node.slNo,
          description: deleting.node.description,
          removed: deleting.ids.length,
        },
      });
      toast({
        title: `Sub-item ${deleting.node.slNo} deleted`,
        description:
          deleting.ids.length > 1 ? `${deleting.ids.length - 1} sub-item(s) under it went with it.` : undefined,
      });
      setDeleting(null);
      await data.reload();
    } catch (error) {
      console.error("Failed to delete the sub-item:", error);
      toast({
        title: "Delete failed",
        description: "The sub-item could not be deleted.",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsDeleting(false);
    }
  };

  if (isAuthLoading || data.isResolving) return <DprLoadingState blocks={1} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (data.notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before opening the BOQ register."
        href="/project-management"
      />
    );
  }

  return (
    <DprPageShell>
      <DprHeader active="breakdown" mappingId={mappingId} projectName={data.projectName} />

      {data.loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{data.loadError}</CardContent>
        </Card>
      ) : null}

      {!canEdit ? (
        <Card className="border-amber-500/40">
          <CardContent className="p-4 text-sm text-muted-foreground">
            You can read the BOQ register but not add or change sub-items. Ask for the Edit action on
            Daily Progress.
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border/60">
        <CardContent className="space-y-3 p-4">
          <SectionHeader
            title="BOQ register"
            icon={ListTree}
            descriptionAs="info"
            description={`Every Civil and Erection BOQ line of this project, with the sub-items it is broken into — and theirs under those, up to ${DPR_MAX_BREAKDOWN_DEPTH} levels down. Progress is planned and recorded on the lowest level; a line with sub-items becomes a group whose figures roll up from them in its own unit, each sub-item counting for its share — a 1 LOT line whose parts are 40% done reads 0.4 LOT. Use "Add several sub-items" (the ⋯ menu) to break a line into all its parts at once, or paste them from Excel. Sub-items can only be added before anything is planned or recorded on a line, so nothing is counted twice. The client's BOQ (billing, JMC) is not changed.`}
            badge={
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {counts.lines} BOQ line{counts.lines === 1 ? "" : "s"} · {counts.groups} broken down ·{" "}
                {counts.subItems} sub-item{counts.subItems === 1 ? "" : "s"}
              </span>
            }
            className="mb-0"
          />
          {/* Every control on one line; it wraps only on a narrow screen. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <DprScopeTabs value={scope} onChange={(next) => next !== "All" && setScope(next)} asField />
            </div>
            <div className="min-w-[11rem] space-y-1.5">
              <Label htmlFor="boq-register-show">Show</Label>
              <Select value={show} onValueChange={(next) => setShow(next as typeof show)}>
                <SelectTrigger id="boq-register-show" className="text-left">
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
          {data.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-10 animate-pulse rounded bg-muted/50" />
              ))}
            </div>
          ) : counts.lines === 0 ? (
            <PmEmptyState
              icon={ListTree}
              title={`No ${scope} BOQ lines on this project`}
              description={`BOQ items are read as ${scope} when their Scope 2 column says so. Import or tag them first.`}
            />
          ) : rows.length === 0 ? (
            <PmEmptyState
              icon={Search}
              title={
                show === "broken" && !filter.trim()
                  ? `No ${scope} BOQ line is broken into sub-items yet`
                  : "Nothing matches the filter"
              }
            />
          ) : (
            <BreakdownTree
              rows={rows}
              collapsed={collapsed}
              onToggle={toggle}
              decimalsFor={data.decimalsFor}
              canEdit={canEdit}
              canDelete={canDelete}
              onAdd={(node) => setDialog({ mode: "add", parentId: node.id })}
              onAddSeveral={(node) => setAddingSeveral(node.id)}
              onEdit={(node) => setDialog({ mode: "edit", id: node.id })}
              onDelete={askDelete}
            />
          )}
        </CardContent>
      </Card>

      <SubItemDialog request={dialog} data={data} user={user} onClose={() => setDialog(null)} />
      <AddSubItemsDialog
        parentId={addingSeveral}
        data={data}
        user={user}
        onClose={() => setAddingSeveral(null)}
      />

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
    </DprPageShell>
  );
}
