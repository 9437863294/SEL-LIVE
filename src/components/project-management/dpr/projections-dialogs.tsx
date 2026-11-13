"use client";

/**
 * The Projections dialogs: revising a projection (rule P7 — a reason is required and the
 * baseline is kept), planning one week from the look-ahead, and pasting quantities from Excel.
 */

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import {
  DPR_TARGET_COLLECTION,
  dprNumber,
  type DprDistribution,
  type DprProjectionRevision,
  type DprTarget,
} from "@/lib/project-management-dpr";
import {
  DPR_DISTRIBUTIONS,
  DPR_DISTRIBUTION_LABELS,
  DPR_PERIOD_LABELS,
  checkDprProjection,
  dprCalendar,
  type DprLookAheadWeek,
} from "@/lib/project-management-dpr-plan";
import type { DprBoqItem } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprMessages,
  formatDisplayDate,
  formatQtyAt,
} from "@/components/project-management/dpr/dpr-shell";
import {
  candidateFor,
  createProjections,
  readQtyText,
  worksOutAt,
  type ProjectionsContext,
} from "@/components/project-management/dpr/projections-shared";
import { Button } from "@/components/ui/button";
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

/* ── Revise ─────────────────────────────────────────────────────────────────────────────────── */

export function ReviseProjectionDialog({
  target,
  context,
  onClose,
  onSaved,
}: {
  target: DprTarget | null;
  context: ProjectionsContext;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      {target ? (
        <ReviseBody key={target.id} target={target} context={context} onClose={onClose} onSaved={onSaved} />
      ) : null}
    </Dialog>
  );
}

function ReviseBody({
  target,
  context,
  onClose,
  onSaved,
}: {
  target: DprTarget;
  context: ProjectionsContext;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const { data, actuals, today, user } = context;
  const item = data.boqItems.find((candidate) => candidate.id === target.boqItemId);
  const unit = item?.unit || target.unit;
  const decimals = data.decimalsFor(unit);
  const currentQty = dprNumber(target.plannedQty);
  const baseline = target.baselineQty ?? currentQty;

  const [qtyText, setQtyText] = useState(String(currentQty));
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const qty = readQtyText(qtyText);
  const check = useMemo(() => {
    const result = checkDprProjection({
      candidate: {
        scope: target.scope,
        boqItemId: target.boqItemId,
        periodType: target.periodType,
        startDate: target.startDate,
        endDate: target.endDate,
        plannedQty: qty !== null && Number.isFinite(qty) ? qty : 0,
        distribution: target.distribution ?? "even",
      },
      item: { unit, boqQty: item?.boqQty ?? 0 },
      targets: data.targets,
      actuals,
      settings: data.settings,
      projectDates: data.projectDates,
      today,
      overlapPolicy: "finer",
      revising: target,
    });
    const errors = [...result.errors];
    if (qty !== null && Number.isFinite(qty) && qty > 0 && Math.abs(qty - currentQty) < 1e-9) {
      errors.push("The quantity has not changed.");
    }
    if (!reason.trim()) errors.push("Give a reason. The baseline is kept and the change is logged.");
    return { errors, warnings: result.warnings };
  }, [target, qty, unit, item?.boqQty, data, actuals, today, currentQty, reason]);

  const workingDays = dprCalendar(data.settings).workingDays(target.startDate, target.endDate).length;

  const handleSave = async () => {
    setAttempted(true);
    if (check.errors.length > 0 || qty === null || !data.globalProjectId || !user) return;
    setIsSaving(true);
    try {
      const revisionNo = (target.revisionNo ?? 0) + 1;
      const revision: DprProjectionRevision = {
        revisionNo,
        fromQty: currentQty,
        toQty: qty,
        reason: reason.trim(),
        changedAt: new Date().toISOString(),
        changedBy: user.id ?? "",
        changedByName: user.name ?? "",
      };
      await updateDoc(doc(db, "projects", data.globalProjectId, DPR_TARGET_COLLECTION, target.id), {
        plannedQty: qty,
        revisionNo,
        baselineQty: baseline,
        revisions: [...(target.revisions ?? []), revision],
        updatedAt: serverTimestamp(),
        updatedBy: user.id ?? "",
        updatedByName: user.name ?? "",
      });
      void logUserActivity({
        userId: user.id ?? "",
        userName: user.name ?? "",
        userEmail: user.email ?? "",
        module: "Project Management",
        action: "Revise DPR Projection",
        details: {
          project: data.projectName,
          boqSlNo: target.boqSlNo,
          startDate: target.startDate,
          endDate: target.endDate,
          revisionNo,
          fromQty: currentQty,
          toQty: qty,
          reason: reason.trim(),
        },
      });
      toast({ title: `Revision R${revisionNo} saved` });
      onClose();
      await onSaved();
    } catch (error) {
      console.error("Failed to revise the projection:", error);
      toast({
        title: "Save failed",
        description: "The revision could not be saved.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogContent size="md" className="gap-4 overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Revise projection</DialogTitle>
        <DialogDescription>
          {target.boqSlNo ? `${target.boqSlNo} · ` : ""}
          {DPR_PERIOD_LABELS[target.periodType] ?? "Custom"} {formatDisplayDate(target.startDate)} –{" "}
          {formatDisplayDate(target.endDate)} · baseline {formatQtyAt(baseline, decimals)} {unit}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="revise-qty">New quantity{unit ? ` (${unit})` : ""}</Label>
          <Input
            id="revise-qty"
            type="number"
            min={0}
            step={decimals === 0 ? 1 : "any"}
            inputMode="decimal"
            value={qtyText}
            onChange={(event) => setQtyText(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Works out at</Label>
          <div className="flex h-10 items-center rounded-md border border-border/60 bg-muted/40 px-3 text-sm tabular-nums">
            {worksOutAt(qty, unit, decimals, workingDays)}
          </div>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="revise-reason">Reason for the change</Label>
          <Textarea
            id="revise-reason"
            rows={3}
            placeholder="Why the plan moved"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>

      {(target.revisions ?? []).length > 0 ? (
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
          <p className="mb-1 font-medium">Earlier revisions</p>
          <ul className="space-y-1 text-muted-foreground">
            {(target.revisions ?? []).map((entry) => (
              <li key={entry.revisionNo}>
                R{entry.revisionNo}: {formatQtyAt(dprNumber(entry.fromQty), decimals)} →{" "}
                {formatQtyAt(dprNumber(entry.toQty), decimals)} · {entry.reason}
                {entry.changedByName ? ` · ${entry.changedByName}` : ""}
                {entry.changedAt ? ` · ${formatDisplayDate(String(entry.changedAt).slice(0, 10))}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {attempted ? (
        <DprMessages errors={check.errors} warnings={check.warnings} errorTitle="Fix these before saving" />
      ) : null}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={() => void handleSave()} disabled={isSaving || !context.canEdit}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save revision
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ── Plan one week (from the look-ahead) ────────────────────────────────────────────────────── */

export interface PlanWeekRequest {
  item: DprBoqItem;
  week: DprLookAheadWeek;
}

export function PlanWeekDialog({
  request,
  context,
  onClose,
  onSaved,
}: {
  request: PlanWeekRequest | null;
  context: ProjectionsContext;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  return (
    <Dialog open={Boolean(request)} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      {request ? (
        <PlanWeekBody
          key={`${request.item.id}-${request.week.startDate}`}
          request={request}
          context={context}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </Dialog>
  );
}

function PlanWeekBody({
  request,
  context,
  onClose,
  onSaved,
}: {
  request: PlanWeekRequest;
  context: ProjectionsContext;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const { data, actuals, today } = context;
  const { item, week } = request;
  const decimals = data.decimalsFor(item.unit);
  const current = data.plan.qtyInRange(item.id, week);

  const [qtyText, setQtyText] = useState("");
  const [distribution, setDistribution] = useState<DprDistribution>("even");
  const [attempted, setAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const qty = readQtyText(qtyText);
  const candidate = candidateFor({
    item,
    periodType: "Week",
    startDate: week.startDate,
    endDate: week.endDate,
    qty: qty !== null && Number.isFinite(qty) ? qty : 0,
    distribution,
  });
  const check = checkDprProjection({
    candidate,
    item: { unit: item.unit, boqQty: item.boqQty },
    targets: data.targets,
    actuals,
    settings: data.settings,
    projectDates: data.projectDates,
    today,
    // Planning a week inside a month is the point of the look-ahead: the week takes its days.
    overlapPolicy: "finer",
  });
  const workingDays = dprCalendar(data.settings).workingDays(week.startDate, week.endDate).length;

  const handleSave = async () => {
    setAttempted(true);
    if (check.errors.length > 0) return;
    setIsSaving(true);
    try {
      await createProjections(context, [{ candidate, item, remarks: "" }]);
      toast({ title: "Week planned", description: `${item.boqSlNo || "BOQ line"} · ${week.label}` });
      onClose();
      await onSaved();
    } catch (error) {
      console.error("Failed to save the weekly projection:", error);
      toast({
        title: "Save failed",
        description: "The weekly projection could not be saved.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogContent size="md" className="gap-4 overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Plan this week</DialogTitle>
        <DialogDescription>
          {item.boqSlNo ? `${item.boqSlNo} · ` : ""}
          {formatDisplayDate(week.startDate)} – {formatDisplayDate(week.endDate)} · currently{" "}
          {formatQtyAt(current, decimals)} {item.unit} from longer projections
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="week-qty">Quantity for the week{item.unit ? ` (${item.unit})` : ""}</Label>
          <Input
            id="week-qty"
            type="number"
            min={0}
            step={decimals === 0 ? 1 : "any"}
            inputMode="decimal"
            value={qtyText}
            onChange={(event) => setQtyText(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="week-spread">Spread across the week</Label>
          <Select value={distribution} onValueChange={(next) => setDistribution(next as DprDistribution)}>
            <SelectTrigger id="week-spread" className="text-left">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DPR_DISTRIBUTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {DPR_DISTRIBUTION_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Works out at</Label>
          <div className="flex h-10 items-center rounded-md border border-border/60 bg-muted/40 px-3 text-sm tabular-nums">
            {worksOutAt(qty, item.unit, decimals, workingDays)}
          </div>
        </div>
      </div>

      <DprMessages
        errors={attempted ? check.errors : []}
        warnings={check.warnings}
        errorTitle="Fix these before saving"
      />

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={() => void handleSave()} disabled={isSaving || !context.canEdit}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save weekly projection
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ── Paste from Excel ───────────────────────────────────────────────────────────────────────── */

export function PasteQuantitiesDialog({
  open,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setText("");
        onOpenChange(next);
      }}
    >
      <DialogContent size="md" className="gap-4 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Paste from Excel</DialogTitle>
          <DialogDescription>
            Two columns: the BOQ item number, then the quantity. One line per row.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={8}
          aria-label="Pasted quantities"
          placeholder={"2.2\t4.5\n5\t12"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="font-mono text-sm"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!text.trim()}
            onClick={() => {
              onApply(text);
              setText("");
              onOpenChange(false);
            }}
          >
            Fill quantities
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
