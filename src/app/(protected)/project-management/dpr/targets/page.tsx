"use client";

/**
 * Projections — the planned side of the DPR.
 *
 * A projection is a quantity for a BOQ line over a period, set at whatever granularity suits the
 * plan: a month for the broad programme, a week for a look-ahead, a day for a catch-up push. The
 * period is stored as explicit dates, so the reports can pro-rate any of them onto any window.
 *
 * Overlapping projections on the same line are allowed and add up — a month's plan with a
 * catch-up week on top is a real thing to want — so the dialog says so before the figure doubles.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Info, Loader2, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { collection, deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import {
  DPR_BASE_PATH,
  DPR_PERIOD_TYPES,
  DPR_PERMISSION_RESOURCE,
  DPR_SCOPES,
  DPR_TARGET_COLLECTION,
  daysInRange,
  dprNumber,
  overlappingTargets,
  periodRangeFor,
  validateDprTarget,
  type DprPeriodType,
  type DprScope,
  type DprTarget,
  type DprTargetDraft,
} from "@/lib/project-management-dpr";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprAccessDenied,
  DprLoadingState,
  DprPageShell,
  DprProjectNotFound,
  DprScopeTabs,
  formatDisplayDate,
  formatQty,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { PmEmptyState } from "@/components/project-management/pm-shell";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const emptyDraft = (scope: DprScope): DprTargetDraft => {
  const range = periodRangeFor("Week", todayIso());
  return {
    scope,
    boqItemId: "",
    boqSlNo: "",
    description: "",
    unit: "",
    periodType: "Week",
    startDate: range.startDate,
    endDate: range.endDate,
    plannedQty: 0,
    remarks: "",
  };
};

export default function DprTargetsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);
  const canEdit = !isAuthLoading && can("Edit", DPR_PERMISSION_RESOURCE);
  const canDelete = !isAuthLoading && can("Delete", DPR_PERMISSION_RESOURCE);

  const { globalProjectId, projectName, isResolving, notFound, boqItems, targets, isLoading, reload } =
    useDprData(mappingId, canView);

  const [scope, setScope] = useState<DprScope | "All">("Civil");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DprTarget | null>(null);
  const [draft, setDraft] = useState<DprTargetDraft>(() => emptyDraft("Civil"));
  const [isSaving, setIsSaving] = useState(false);

  const scopeBoqItems = useMemo(
    () => boqItems.filter((item) => item.scope === draft.scope),
    [boqItems, draft.scope],
  );

  const visible = useMemo(() => {
    const rows = scope === "All" ? targets : targets.filter((target) => target.scope === scope);
    return [...rows].sort(
      (a, b) => b.startDate.localeCompare(a.startDate) || a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true }),
    );
  }, [targets, scope]);

  const clashes = useMemo(
    () => overlappingTargets(draft, targets, editing?.id),
    [draft, targets, editing?.id],
  );

  const openCreate = useCallback(() => {
    setEditing(null);
    setDraft(emptyDraft(scope === "All" ? "Civil" : scope));
    setIsDialogOpen(true);
  }, [scope]);

  const openEdit = useCallback((target: DprTarget) => {
    setEditing(target);
    const { id, createdAt, createdBy, createdByName, updatedAt, updatedBy, updatedByName, ...rest } =
      target;
    void id;
    void createdAt;
    void createdBy;
    void createdByName;
    void updatedAt;
    void updatedBy;
    void updatedByName;
    setDraft(rest);
    setIsDialogOpen(true);
  }, []);

  /** Changing the granularity snaps the period to that whole day, week or month. */
  const changePeriodType = (periodType: DprPeriodType) => {
    const range = periodRangeFor(periodType, draft.startDate || todayIso());
    setDraft((previous) => ({ ...previous, periodType, ...range }));
  };

  const changeStartDate = (startDate: string) => {
    // A day or month is fully determined by any date inside it; a week snaps to its Monday.
    if (draft.periodType === "Day" || draft.periodType === "Month" || draft.periodType === "Week") {
      setDraft((previous) => ({ ...previous, ...periodRangeFor(previous.periodType, startDate) }));
      return;
    }
    setDraft((previous) => ({ ...previous, startDate }));
  };

  const chooseBoqItem = (boqItemId: string) => {
    const item = boqItems.find((candidate) => candidate.id === boqItemId);
    if (!item) return;
    setDraft((previous) => ({
      ...previous,
      boqItemId,
      boqSlNo: item.boqSlNo,
      description: item.description,
      unit: item.unit,
    }));
  };

  const handleSave = async () => {
    if (!globalProjectId || !user) return;
    const errors = validateDprTarget(draft);
    if (errors.length > 0) {
      toast({ title: "Check the projection", description: errors[0]!.message, variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const targetRef = editing
        ? doc(db, "projects", globalProjectId, DPR_TARGET_COLLECTION, editing.id)
        : doc(collection(db, "projects", globalProjectId, DPR_TARGET_COLLECTION));
      const audit = editing
        ? { updatedAt: serverTimestamp(), updatedBy: user.id, updatedByName: user.name ?? "" }
        : {
            createdAt: serverTimestamp(),
            createdBy: user.id,
            createdByName: user.name ?? "",
            updatedAt: serverTimestamp(),
            updatedBy: user.id,
            updatedByName: user.name ?? "",
          };
      await setDoc(
        targetRef,
        { ...draft, plannedQty: dprNumber(draft.plannedQty), ...audit },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: `${editing ? "Update" : "Create"} DPR Projection`,
        details: {
          project: projectName,
          scope: draft.scope,
          boqSlNo: draft.boqSlNo,
          periodType: draft.periodType,
          startDate: draft.startDate,
          endDate: draft.endDate,
          plannedQty: dprNumber(draft.plannedQty),
        },
      });
      toast({ title: `Projection ${editing ? "updated" : "added"}` });
      setIsDialogOpen(false);
      await reload();
    } catch (error) {
      console.error("Failed to save the projection:", error);
      toast({
        title: "Save failed",
        description: "The projection could not be saved.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (target: DprTarget) => {
    if (!globalProjectId || !user) return;
    try {
      await deleteDoc(doc(db, "projects", globalProjectId, DPR_TARGET_COLLECTION, target.id));
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Delete DPR Projection",
        details: {
          project: projectName,
          scope: target.scope,
          boqSlNo: target.boqSlNo,
          startDate: target.startDate,
          endDate: target.endDate,
        },
      });
      toast({ title: "Projection removed" });
      await reload();
    } catch (error) {
      console.error("Failed to delete the projection:", error);
      toast({
        title: "Delete failed",
        description: "The projection could not be removed.",
        variant: "destructive",
      });
    }
  };

  const withProject = (path: string) =>
    `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(mappingId)}`;

  if (isAuthLoading || isResolving) return <DprLoadingState blocks={1} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before setting projections."
        href="/project-management"
      />
    );
  }

  const periodDays = daysInRange(draft.startDate, draft.endDate);
  const perDay = periodDays > 0 ? dprNumber(draft.plannedQty) / periodDays : 0;

  return (
    <DprPageShell>
      <PageHeader
        title="Projections"
        description="What each BOQ line is planned to achieve, per day, week or month."
        icon={Target}
        breadcrumbs={[
          { label: "Project Management", href: "/project-management" },
          { label: "Daily Progress", href: withProject(DPR_BASE_PATH) },
          { label: projectName || "Project" },
        ]}
        backHref={withProject(DPR_BASE_PATH)}
        backLabel="Daily Progress"
        actions={
          <Button disabled={!canEdit} onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Add projection
          </Button>
        }
      />

      <Card className="border-border/60">
        <CardContent className="p-4">
          <DprScopeTabs value={scope} onChange={setScope} includeAll />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded bg-muted/50" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <PmEmptyState
              icon={Target}
              title="No projections yet"
              description="Add what a BOQ line is planned to achieve over a day, a week or a month. Daily sheets then open pre-filled with the day's share."
              action={
                canEdit ? (
                  <Button onClick={openCreate}>
                    <Plus className="mr-2 h-4 w-4" /> Add projection
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="min-w-[220px]">BOQ line</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Projected</TableHead>
                  <TableHead className="text-right">Per day</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((target) => {
                  const span = daysInRange(target.startDate, target.endDate);
                  return (
                    <TableRow key={target.id}>
                      <TableCell className="whitespace-nowrap">
                        <div className="text-sm font-medium">{target.periodType}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDisplayDate(target.startDate)}
                          {span > 1 ? ` – ${formatDisplayDate(target.endDate)}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={target.scope}
                          tone={target.scope === "Civil" ? "info" : "progress"}
                        />
                      </TableCell>
                      <TableCell className="min-w-[220px]">
                        <div className="truncate text-sm font-medium" title={target.description}>
                          {target.boqSlNo ? `${target.boqSlNo} · ` : ""}
                          {target.description || "BOQ line"}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{target.unit || "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatQty(dprNumber(target.plannedQty))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {span > 0 ? formatQty(dprNumber(target.plannedQty) / span) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Edit projection"
                            disabled={!canEdit}
                            onClick={() => openEdit(target)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Delete projection"
                            disabled={!canDelete}
                            onClick={() => void handleDelete(target)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit projection" : "Add projection"}</DialogTitle>
            <DialogDescription>
              Set the quantity planned over a period. Reports pro-rate it onto whatever window they
              are read at.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="target-scope">Scope</Label>
              <Select
                value={draft.scope}
                onValueChange={(next) =>
                  setDraft((previous) => ({
                    ...previous,
                    scope: next as DprScope,
                    // The BOQ list is scope-filtered, so a stale selection must not survive.
                    boqItemId: "",
                    boqSlNo: "",
                    description: "",
                    unit: "",
                  }))
                }
              >
                <SelectTrigger id="target-scope" className="text-left">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DPR_SCOPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="target-period-type">Granularity</Label>
              <Select
                value={draft.periodType}
                onValueChange={(next) => changePeriodType(next as DprPeriodType)}
              >
                <SelectTrigger id="target-period-type" className="text-left">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DPR_PERIOD_TYPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "Day" ? "Daily" : option === "Week" ? "Weekly" : "Monthly"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="target-boq">BOQ line</Label>
              <Select value={draft.boqItemId} onValueChange={chooseBoqItem}>
                <SelectTrigger id="target-boq" className="text-left">
                  <SelectValue placeholder="Choose a BOQ item" />
                </SelectTrigger>
                <SelectContent>
                  {scopeBoqItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.boqSlNo ? `${item.boqSlNo} · ` : ""}
                      {item.description || "BOQ line"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {scopeBoqItems.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No {draft.scope} BOQ lines on this project yet.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="target-start">
                {draft.periodType === "Day" ? "Date" : `Any date in the ${draft.periodType.toLowerCase()}`}
              </Label>
              <Input
                id="target-start"
                type="date"
                value={draft.startDate}
                onChange={(event) => changeStartDate(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Covers</Label>
              <div className="flex h-10 items-center rounded-md border border-border/60 bg-muted/40 px-3 text-sm">
                {formatDisplayDate(draft.startDate)}
                {periodDays > 1 ? ` – ${formatDisplayDate(draft.endDate)}` : ""}
                {periodDays > 0 ? ` (${periodDays}d)` : ""}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="target-qty">Projected quantity{draft.unit ? ` (${draft.unit})` : ""}</Label>
              <Input
                id="target-qty"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={draft.plannedQty || ""}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, plannedQty: dprNumber(event.target.value) }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Works out at</Label>
              <div className="flex h-10 items-center rounded-md border border-border/60 bg-muted/40 px-3 text-sm">
                {perDay > 0 ? `${formatQty(perDay)} ${draft.unit || ""}/day` : "—"}
              </div>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="target-remarks">Remarks</Label>
              <Textarea
                id="target-remarks"
                rows={2}
                value={draft.remarks ?? ""}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, remarks: event.target.value }))
                }
              />
            </div>
          </div>

          {clashes.length > 0 ? (
            <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium">
                  {clashes.length} existing projection{clashes.length === 1 ? "" : "s"} overlap this
                  period.
                </p>
                <p className="text-muted-foreground">
                  They add up rather than replace, so the target for the overlapping days will be the
                  sum. Edit the existing one instead if that is not what you mean.
                </p>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!canEdit || isSaving} onClick={() => void handleSave()}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editing ? "Save changes" : "Add projection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DprPageShell>
  );
}
