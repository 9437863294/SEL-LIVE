"use client";

/**
 * Daily Progress's BOQ register, after the user's mock-up (`sel-dpr-register-log-settings`): the
 * cyan headline band, four figures, the filters on one line, and the register as a tree table
 * grouped into foldable sections. Everything it needs comes in as props, so it renders the same
 * from the page (`dpr/boq/page.tsx`, which loads the data and checks access) as from fabricated
 * data.
 *
 * Progress is planned and recorded on the lowest level only; a line with sub-items becomes a group
 * whose figures roll up from its leaves in its own unit (see project-management-dpr-breakdown.ts),
 * so a 1 LOT line whose parts are 40% done reads 0.4 LOT. The client's BOQ register (billing, JMC)
 * is never changed: the breakdown lives in this module only.
 */

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronsDownUp, ChevronsUpDown, GitFork, Indent, ListTree, Search } from "lucide-react";
import { doc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { DPR_BASE_PATH, type DprScope } from "@/lib/project-management-dpr";
import { indexDprActuals, openPlanQty } from "@/lib/project-management-dpr-plan";
import {
  DPR_MAX_BREAKDOWN_DEPTH,
  DPR_SUB_ITEM_COLLECTION,
  checkDprSubItemDelete,
  hasDprRecords,
  type DprBreakdownNode,
} from "@/lib/project-management-dpr-breakdown";
import {
  dprFurthestAlong,
  dprRegisterShows,
  type DprRegisterShow,
} from "@/lib/project-management-dpr-register";
import type { DprDataState } from "@/components/project-management/dpr/use-dpr-data";
import {
  DPR_TABS,
  DprFieldLabel,
  DprPageShell,
  DprScopeTabs,
  dprHref,
  formatPct,
  formatQtyAt,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";
import { DprReportsHero } from "@/components/project-management/dpr/reports-hero";
import {
  DprFigureRow,
  DprFigureTile,
  DprReportCallout,
  DprReportCard,
  DprReportZero,
} from "@/components/project-management/dpr/reports-parts";
import {
  BreakdownTree,
  breakdownSectionOf,
  type BreakdownTreeRow,
} from "@/components/project-management/dpr/breakdown-tree";
import {
  SubItemDialog,
  addBlockersFor,
  type BreakdownUser,
  type SubItemDialogRequest,
} from "@/components/project-management/dpr/breakdown-dialogs";
import { AddSubItemsDialog } from "@/components/project-management/dpr/boq-register-add-several";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { InfoTip } from "@/components/shared/info-tip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const REGISTER_TAB = DPR_TABS.find((tab) => tab.key === "breakdown")!;

const SHOW_OPTIONS: ReadonlyArray<{ value: DprRegisterShow; label: string }> = [
  { value: "all", label: "All lines" },
  { value: "progress", label: "With progress" },
  { value: "notStarted", label: "Not started" },
  { value: "broken", label: "Broken down" },
  { value: "whole", label: "Not broken down" },
];

export function DprBoqRegisterView({
  data,
  mappingId,
  user,
  canAdd,
  canEdit,
  canDelete,
  initialScope = "Civil",
  today: todayProp,
}: {
  data: DprDataState;
  mappingId: string;
  user: BreakdownUser | null;
  /** May record progress (DPR Add) — offers "Record progress" on a line. */
  canAdd: boolean;
  /** May add and change sub-items (DPR Edit). */
  canEdit: boolean;
  /** May delete sub-items (DPR Delete). */
  canDelete: boolean;
  /** The scope opened first, e.g. from `?scope=`. */
  initialScope?: DprScope;
  /** "Today" for what is still planned; defaults to the real date. */
  today?: string;
}) {
  const { toast } = useToast();
  const { breakdown, entries, targets } = data;

  const [scope, setScope] = useState<DprScope>(initialScope);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<SubItemDialogRequest | null>(null);
  /** The line "Add several sub-items" is open for. */
  const [addingSeveral, setAddingSeveral] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ node: DprBreakdownNode; ids: string[] } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  /** Which BOQ lines to list, decided on the line at the top of each branch. */
  const [show, setShow] = useState<DprRegisterShow>("all");

  const actuals = useMemo(() => indexDprActuals(entries), [entries]);
  /** Submitted work rolled up to every node, in that node's own unit. */
  const done = useMemo(() => breakdown.rollUp((id) => actuals.total(id)), [breakdown, actuals]);
  /** What is still planned from today on — future days, and today until its sheet is in. */
  const openPlan = useMemo(() => {
    const today = todayProp ?? todayIso();
    return breakdown.rollUp((id) => {
      const node = breakdown.nodes.get(id);
      return node ? openPlanQty(data.plan.daily(id), today, actuals.hasSheet(node.scope, today)) : 0;
    });
  }, [breakdown, data.plan, actuals, todayProp]);

  const scopeNodes = useMemo(
    () =>
      breakdown.ordered.filter(
        (node) =>
          node.scope === scope &&
          dprRegisterShows(show, {
            broken: breakdown.groupLineIds.has(node.boqItemId),
            done: done.get(node.boqItemId) ?? 0,
          }),
      ),
    [breakdown, scope, show, done],
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

  /** The leaf with the largest share of its own quantity done, in this scope. */
  const furthest = useMemo(
    () =>
      dprFurthestAlong(
        breakdown.leaves
          .filter((node) => node.scope === scope)
          .map((node) => ({ node, qty: node.qty, done: done.get(node.id) ?? 0 })),
      ),
    [breakdown, scope, done],
  );

  /**
   * The rows to show. Filtering shows every match with the lines above it, open, so a match deep in
   * a breakdown is never hidden by a closed group; otherwise a closed group hides its branch.
   */
  const searching = Boolean(filter.trim());
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

  const groupIds = useMemo(() => scopeNodes.filter((node) => !node.isLeaf).map((node) => node.id), [scopeNodes]);
  const sectionKeys = useMemo(() => [...new Set(scopeNodes.map(breakdownSectionOf))], [scopeNodes]);

  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSection = (key: string) =>
    setCollapsedSections((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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

  const nothingFolded = collapsed.size === 0 && collapsedSections.size === 0;
  const furthestDecimals = furthest ? data.decimalsFor(furthest.node.unit) : 0;

  return (
    <DprPageShell>
      <DprReportsHero
        band="cyan"
        mappingId={mappingId}
        projectName={data.projectName}
        title={REGISTER_TAB.label}
        description={REGISTER_TAB.description}
        icon={REGISTER_TAB.icon}
      />

      {data.loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{data.loadError}</CardContent>
        </Card>
      ) : null}

      {!canEdit ? (
        <DprReportCallout tone="info" title="You can read the BOQ register but not change it">
          Ask for the Edit action on Daily Progress to add or change sub-items.
        </DprReportCallout>
      ) : null}

      <DprFigureRow>
        <DprFigureTile
          icon={ListTree}
          colours={["#67e8f9", "#0891b2"]}
          label="BOQ lines"
          value={String(counts.lines)}
          detail={`${scope} lines in the register`}
        />
        <DprFigureTile
          icon={GitFork}
          colours={["#c4b5fd", "#7c3aed"]}
          label="Broken down"
          value={String(counts.groups)}
          detail={`line${counts.groups === 1 ? "" : "s"} split into sub-items`}
        />
        <DprFigureTile
          icon={Indent}
          colours={["#f9a8d4", "#db2777"]}
          label="Sub-items"
          value={String(counts.subItems)}
          detail="created so far"
        />
        <DprFigureTile
          icon={CheckCircle2}
          colours={["#6ee7b7", "#059669"]}
          label="Furthest along"
          value={furthest ? formatPct(furthest.pct) : "—"}
          valueClassName={furthest ? "text-emerald-600" : undefined}
          detail={
            furthest
              ? `${furthest.node.slNo || "A line"} · ${formatQtyAt(furthest.done, furthestDecimals)} of ${formatQtyAt(
                  furthest.qty,
                  furthestDecimals,
                )} ${furthest.node.unit} done`.trim()
              : "nothing recorded yet"
          }
        />
      </DprFigureRow>

      <DprReportCard
        icon={ListTree}
        colours={["#67e8f9", "#0891b2"]}
        title="BOQ register"
        subtitle={`${counts.lines} BOQ line${counts.lines === 1 ? "" : "s"} · ${counts.groups} broken down · ${counts.subItems} sub-item${
          counts.subItems === 1 ? "" : "s"
        }`}
        aside={
          <InfoTip label="About the BOQ register">
            Every Civil and Erection BOQ line of this project, with the sub-items it is broken into —
            and theirs under those, up to {DPR_MAX_BREAKDOWN_DEPTH} levels down. Progress is planned
            and recorded on the lowest level; a line with sub-items becomes a group whose figures
            roll up from them in its own unit, each sub-item counting for its share — a 1 LOT line
            whose parts are 40% done reads 0.4 LOT. Use &quot;Add several sub-items&quot; (the ⋯
            menu) to break a line into all its parts at once, or paste them from Excel. Sub-items
            can only be added before anything is planned or recorded on a line, so nothing is
            counted twice. Lines are grouped into sections by the first number of their SL No; click
            a section to fold it. The client&apos;s BOQ (billing, JMC) is not changed.
          </InfoTip>
        }
      >
        {/* Every control on one line, at one height; it wraps only on a narrow screen. */}
        <div className="flex flex-wrap items-end gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5">
          <div className="space-y-1.5">
            <DprFieldLabel>Scope</DprFieldLabel>
            <DprScopeTabs value={scope} onChange={(next) => next !== "All" && setScope(next)} asField />
          </div>
          <div className="min-w-[11rem] space-y-1.5">
            <DprFieldLabel htmlFor="boq-register-show">Show</DprFieldLabel>
            <Select value={show} onValueChange={(next) => setShow(next as DprRegisterShow)}>
              <SelectTrigger
                id="boq-register-show"
                className="text-left"
                style={{ borderLeftWidth: 3, borderLeftColor: "#0891b2" }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHOW_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[14rem] flex-1 space-y-1.5">
            <DprFieldLabel htmlFor="breakdown-filter">Find</DprFieldLabel>
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
              onClick={() => {
                setCollapsed(new Set());
                setCollapsedSections(new Set());
              }}
              disabled={nothingFolded || searching}
            >
              <ChevronsUpDown className="mr-1.5 h-4 w-4" /> Expand all
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setCollapsed(new Set(groupIds));
                setCollapsedSections(new Set(sectionKeys));
              }}
              disabled={sectionKeys.length === 0 || searching}
            >
              <ChevronsDownUp className="mr-1.5 h-4 w-4" /> Collapse all
            </Button>
          </div>
        </div>

        {data.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-10 animate-pulse rounded bg-muted/50" />
            ))}
          </div>
        ) : counts.lines === 0 ? (
          <DprReportZero
            icon={ListTree}
            colours={["#67e8f9", "#0891b2"]}
            glow={["rgba(103, 232, 249, 0.55)", "rgba(196, 181, 253, 0.55)"]}
            title={`No ${scope} BOQ lines on this project`}
            text={`BOQ items are read as ${scope} when their Scope 2 column says so. Import or tag them first.`}
          />
        ) : rows.length === 0 ? (
          <DprReportZero
            icon={Search}
            colours={["#67e8f9", "#0891b2"]}
            glow={["rgba(103, 232, 249, 0.45)", "rgba(196, 181, 253, 0.45)"]}
            title={
              show === "broken" && !searching
                ? `No ${scope} BOQ line is broken into sub-items yet`
                : "Nothing matches the filter"
            }
          />
        ) : (
          <BreakdownTree
            rows={rows}
            collapsed={collapsed}
            onToggle={toggle}
            collapsedSections={collapsedSections}
            onToggleSection={toggleSection}
            forceOpen={searching}
            decimalsFor={data.decimalsFor}
            canEdit={canEdit}
            canDelete={canDelete}
            canRecord={canAdd}
            planHref={dprHref(`${DPR_BASE_PATH}/targets`, mappingId, { view: "plan" })}
            recordHref={(node) => dprHref(`${DPR_BASE_PATH}/entry`, mappingId, { scope: node.scope })}
            onAdd={(node) => setDialog({ mode: "add", parentId: node.id })}
            onAddSeveral={(node) => setAddingSeveral(node.id)}
            onEdit={(node) => setDialog({ mode: "edit", id: node.id })}
            onDelete={askDelete}
          />
        )}
      </DprReportCard>

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
