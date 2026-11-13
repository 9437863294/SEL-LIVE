"use client";

/**
 * Adding a sub-item under a BOQ line (or under another sub-item), and editing one.
 *
 * The checks are the engine's (`checkDprSubItem`): unique SL No within the line's breakdown, unit
 * precision, shares no more than 100% across siblings, the depth limit, and no sub-items under a
 * line that already has projections or progress of its own — so nothing is ever counted twice.
 */

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import {
  DPR_SUB_ITEM_COLLECTION,
  checkDprSubItem,
  effectiveWeights,
  nextSubItemSlNo,
  type DprBreakdownNode,
} from "@/lib/project-management-dpr-breakdown";
import { dprUnitDecimals } from "@/lib/project-management-dpr-plan";
import type { DprDataState } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprBoqSummary,
  DprMessages,
  formatPct,
} from "@/components/project-management/dpr/dpr-shell";
import { InfoTip } from "@/components/shared/info-tip";
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
import { Textarea } from "@/components/ui/textarea";

export type SubItemDialogRequest =
  | { mode: "add"; parentId: string }
  | { mode: "edit"; id: string };

export interface BreakdownUser {
  id?: string;
  name?: string;
  email?: string;
}

/** Units sold as a lump: a sub-item under one is most often 1 of the same, so it is suggested. */
const LUMP_UNITS = new Set(["lot", "ls", "lumpsum", "job", "set"]);
const unitKey = (unit: unknown) =>
  String(unit ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** "" → null (blank); otherwise the number, NaN when it is not one. */
const readNumberText = (text: string): number | null => {
  const trimmed = text.replace(/,/g, "").trim();
  return trimmed === "" ? null : Number(trimmed);
};

export function SubItemDialog({
  request,
  data,
  user,
  onClose,
}: {
  request: SubItemDialogRequest | null;
  data: DprDataState;
  user: BreakdownUser | null;
  onClose: () => void;
}) {
  const key = request ? (request.mode === "add" ? `add-${request.parentId}` : `edit-${request.id}`) : "";
  return (
    <Dialog open={Boolean(request)} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      {request ? <SubItemBody key={key} request={request} data={data} user={user} onClose={onClose} /> : null}
    </Dialog>
  );
}

function SubItemBody({
  request,
  data,
  user,
  onClose,
}: {
  request: SubItemDialogRequest;
  data: DprDataState;
  user: BreakdownUser | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { breakdown } = data;
  const editing = request.mode === "edit" ? breakdown.nodes.get(request.id) : undefined;
  const stored = request.mode === "edit" ? data.subItems.find((sub) => sub.id === request.id) : undefined;
  const parentId = request.mode === "add" ? request.parentId : (editing?.parentId ?? "");
  const parent = breakdown.nodes.get(parentId);
  const siblings = useMemo(
    () => (parent ? breakdown.childrenOf(parent.id) : []),
    [breakdown, parent],
  );
  const parentIsLump = LUMP_UNITS.has(unitKey(parent?.unit));

  const [slNo, setSlNo] = useState(() =>
    editing ? editing.slNo : nextSubItemSlNo(parent?.slNo ?? "", siblings),
  );
  const [description, setDescription] = useState(editing?.description ?? "");
  const [unit, setUnit] = useState(editing?.unit ?? parent?.unit ?? "");
  const [qtyText, setQtyText] = useState(
    editing ? String(editing.qty) : parentIsLump ? "1" : "",
  );
  const [shareText, setShareText] = useState(
    editing && editing.weightPct !== null ? String(editing.weightPct) : "",
  );
  const [remarks, setRemarks] = useState(stored?.remarks ?? "");
  const [attempted, setAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const qty = readNumberText(qtyText);
  const share = readNumberText(shareText);
  const decimals = dprUnitDecimals(unit, data.settings);

  const check = useMemo(
    () =>
      checkDprSubItem({
        draft: {
          parentId,
          slNo,
          description,
          unit,
          qty: qty !== null && Number.isFinite(qty) ? qty : 0,
          // NaN is passed through so the engine reports it as out of range.
          weightPct: share,
        },
        editingId: editing?.id,
        breakdown,
        targets: data.targets,
        entries: data.entries,
        settings: data.settings,
      }),
    [parentId, slNo, description, unit, qty, share, editing?.id, breakdown, data.targets, data.entries, data.settings],
  );

  /** The share this sub-item would actually get, as the engine would work it out. */
  const effectiveShare = useMemo(() => {
    if (!parent) return null;
    const others = siblings
      .filter((sibling) => sibling.id !== editing?.id)
      .map((sibling) => ({ id: sibling.id, unit: sibling.unit, qty: sibling.qty, weightPct: sibling.weightPct }));
    const draftId = editing?.id ?? "__draft__";
    const weights = effectiveWeights(parent, [
      ...others,
      {
        id: draftId,
        unit,
        qty: qty !== null && Number.isFinite(qty) ? qty : 0,
        weightPct: share !== null && Number.isFinite(share) ? share : null,
      },
    ]);
    return (weights.get(draftId) ?? 0) * 100;
  }, [parent, siblings, editing?.id, unit, qty, share]);

  /** Units already in use on this project, offered as the unit is typed. */
  const knownUnits = useMemo(() => {
    const seen = new Map<string, string>();
    for (const line of data.boqLines) if (line.unit) seen.set(line.unit.toLowerCase(), line.unit);
    for (const sub of data.subItems) if (sub.unit) seen.set(sub.unit.toLowerCase(), sub.unit);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [data.boqLines, data.subItems]);

  const handleSave = async () => {
    setAttempted(true);
    if (!parent || check.errors.length > 0 || qty === null || !data.globalProjectId || !user) return;
    setIsSaving(true);
    const fields = {
      slNo: slNo.trim(),
      description: description.trim(),
      unit: unit.trim(),
      qty,
      weightPct: share !== null && Number.isFinite(share) ? share : null,
      remarks: remarks.trim(),
    };
    const audit = {
      updatedAt: serverTimestamp(),
      updatedBy: user.id ?? "",
      updatedByName: user.name ?? "",
    };
    try {
      if (editing) {
        await updateDoc(
          doc(db, "projects", data.globalProjectId, DPR_SUB_ITEM_COLLECTION, editing.id),
          { ...fields, ...audit },
        );
      } else {
        const order =
          data.subItems
            .filter((sub) => sub.parentId === parent.id)
            .reduce((highest, sub) => Math.max(highest, Number(sub.order) || 0), 0) + 1;
        await addDoc(collection(db, "projects", data.globalProjectId, DPR_SUB_ITEM_COLLECTION), {
          boqItemId: parent.boqItemId,
          parentId: parent.id,
          ...fields,
          order,
          createdAt: serverTimestamp(),
          createdBy: user.id ?? "",
          createdByName: user.name ?? "",
          ...audit,
        });
      }
      void logUserActivity({
        userId: user.id ?? "",
        userName: user.name ?? "",
        userEmail: user.email ?? "",
        module: "Project Management",
        action: editing ? "Update DPR Sub-item" : "Add DPR Sub-item",
        details: {
          project: data.projectName,
          parent: parent.slNo,
          slNo: fields.slNo,
          description: fields.description,
          unit: fields.unit,
          qty: fields.qty,
          weightPct: fields.weightPct,
        },
      });
      toast({ title: editing ? `Sub-item ${fields.slNo} updated` : `Sub-item ${fields.slNo} added` });
      onClose();
      await data.reload();
    } catch (error) {
      console.error("Failed to save the sub-item:", error);
      toast({
        title: "Save failed",
        description: "The sub-item could not be saved.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogContent size="md" className="gap-4 overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{editing ? `Edit sub-item ${editing.slNo}` : "Add sub-item"}</DialogTitle>
        <DialogDescription>
          {editing
            ? "Changes apply to every figure rolled up from this sub-item."
            : "A part of the line below, planned and recorded on its own."}
        </DialogDescription>
      </DialogHeader>

      {parent ? (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Under</span>
          <DprBoqSummary boqSlNo={parent.slNo} description={parent.description} unit={parent.unit} />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor="sub-slno">SL No</Label>
          <Input id="sub-slno" value={slNo} onChange={(event) => setSlNo(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sub-description">Description</Label>
          <Textarea
            id="sub-description"
            rows={2}
            value={description}
            placeholder="What this part of the work is"
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="sub-unit">Unit</Label>
          <Input
            id="sub-unit"
            list="dpr-breakdown-units"
            value={unit}
            placeholder="Nos, Rmt, Cum, LOT…"
            onChange={(event) => setUnit(event.target.value)}
          />
          <datalist id="dpr-breakdown-units">
            {knownUnits.map((known) => (
              <option key={known} value={known} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sub-qty">Quantity{unit ? ` (${unit})` : ""}</Label>
          <Input
            id="sub-qty"
            type="number"
            min={0}
            step={decimals === 0 ? 1 : "any"}
            inputMode={decimals === 0 ? "numeric" : "decimal"}
            className="text-right tabular-nums"
            value={qtyText}
            onChange={(event) => setQtyText(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          {/* h-6 keeps this label level with the plain ones beside it. */}
          <div className="flex h-6 items-center gap-1.5">
            <Label htmlFor="sub-share">Share of parent %</Label>
            <InfoTip label="About the share of the parent">
              How much of the line above this sub-item stands for. Leave it blank to share out what
              the set ones leave: by quantity when every sub-item uses the parent&apos;s unit (so
              same-unit parts simply add up), otherwise equally. Shares under one line can total
              at most 100%.
            </InfoTip>
          </div>
          <Input
            id="sub-share"
            type="number"
            min={0}
            max={100}
            step="any"
            inputMode="decimal"
            placeholder="Auto"
            className="text-right tabular-nums"
            value={shareText}
            onChange={(event) => setShareText(event.target.value)}
          />
          {effectiveShare !== null ? (
            <p className="text-xs text-muted-foreground">
              {share === null ? "Works out at " : "Uses "}
              {formatPct(effectiveShare)} of {parent?.slNo || "the parent"}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sub-remarks">Remarks</Label>
        <Input id="sub-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} />
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
        <Button onClick={() => void handleSave()} disabled={isSaving || !user}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {editing ? "Save changes" : "Add sub-item"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** Rows a parent-level check would raise for a would-be sub-item, to explain a disabled Add. */
export function addBlockersFor(
  node: DprBreakdownNode,
  data: Pick<DprDataState, "breakdown" | "targets" | "entries" | "settings">,
): string[] {
  // A draft that is valid in every field of its own, so only the parent's rules can fail it.
  const result = checkDprSubItem({
    draft: {
      parentId: node.id,
      slNo: `__probe__${node.id}`,
      description: "probe",
      unit: node.unit || "Nos",
      qty: 1,
      weightPct: null,
    },
    breakdown: data.breakdown,
    targets: data.targets,
    entries: data.entries,
    settings: data.settings,
  });
  return result.errors;
}
