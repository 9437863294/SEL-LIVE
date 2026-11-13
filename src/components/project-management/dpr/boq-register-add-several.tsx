"use client";

/**
 * Adding several sub-items under one BOQ line (or sub-item) at once — the quick way to break a
 * 1 LOT line into its parts.
 *
 * A grid of rows (SL No auto-numbered, description, unit, quantity, share), filled by hand or by
 * pasting rows copied from Excel. Every row is checked with the engine's own `checkDprSubItem`,
 * against the saved breakdown *plus the other rows in the grid*, so an SL No used twice in the grid
 * or shares that would pass 100% across the grid and the existing sub-items are caught before
 * anything is written. One Save writes every row in a single batch.
 */

import { useMemo, useState } from "react";
import { ClipboardPaste, Loader2, Plus, Trash2 } from "lucide-react";
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import {
  DPR_SUB_ITEM_COLLECTION,
  buildDprBreakdown,
  checkDprSubItem,
  effectiveWeights,
  nextSubItemSlNo,
  type DprSubItem,
} from "@/lib/project-management-dpr-breakdown";
import { dprUnitDecimals } from "@/lib/project-management-dpr-plan";
import type { DprDataState } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprBoqSummary,
  DprMessages,
  formatPct,
} from "@/components/project-management/dpr/dpr-shell";
import {
  addBlockersFor,
  type BreakdownUser,
} from "@/components/project-management/dpr/breakdown-dialogs";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Units sold as a lump: their parts are most often 1 of something each. */
const LUMP_UNITS = new Set(["lot", "ls", "lumpsum", "job", "set"]);
const unitKey = (unit: unknown) =>
  String(unit ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export const isLumpUnit = (unit: unknown) => LUMP_UNITS.has(unitKey(unit));

/** "" → null (blank); otherwise the number, NaN when it is not one. */
const readNumberText = (text: string): number | null => {
  const trimmed = text.replace(/,/g, "").trim();
  return trimmed === "" ? null : Number(trimmed);
};

/** An SL No as pasted: digits, dot-separated, optionally ending in a letter (7.2, 7.2.1, 7.2a). */
const SL_NO_PATTERN = /^\d+(\.\d+)*[a-z]?$/i;

interface GridRow {
  key: string;
  slNo: string;
  description: string;
  unit: string;
  qtyText: string;
  shareText: string;
}

const isBlankRow = (row: GridRow) => !row.description.trim() && !row.qtyText.trim() && !row.shareText.trim();

let rowSeed = 0;
const rowKey = () => `row-${Date.now().toString(36)}-${(rowSeed += 1)}`;

export function AddSubItemsDialog({
  parentId,
  data,
  user,
  onClose,
}: {
  /** The line the new sub-items go under; null keeps the dialog closed. */
  parentId: string | null;
  data: DprDataState;
  user: BreakdownUser | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(parentId)} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      {parentId ? (
        <AddSeveralBody key={parentId} parentId={parentId} data={data} user={user} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}

function AddSeveralBody({
  parentId,
  data,
  user,
  onClose,
}: {
  parentId: string;
  data: DprDataState;
  user: BreakdownUser | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { breakdown } = data;
  const parent = breakdown.nodes.get(parentId);
  const siblings = useMemo(() => (parent ? breakdown.childrenOf(parent.id) : []), [breakdown, parent]);
  const lump = isLumpUnit(parent?.unit);
  const defaultUnit = parent?.unit ?? "";
  const defaultQty = lump ? "1" : "";

  /** Rows numbered on from whatever already sits under the parent (and the rows above them). */
  const numberedRows = (count: number, existing: readonly GridRow[]): GridRow[] => {
    const taken: Array<{ slNo: string }> = [...siblings, ...existing];
    const rows: GridRow[] = [];
    for (let index = 0; index < count; index += 1) {
      const slNo = nextSubItemSlNo(parent?.slNo ?? "", [...taken, ...rows]);
      rows.push({ key: rowKey(), slNo, description: "", unit: defaultUnit, qtyText: defaultQty, shareText: "" });
    }
    return rows;
  };

  const [rows, setRows] = useState<GridRow[]>(() => numberedRows(3, []));
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const filled = useMemo(() => rows.filter((row) => !isBlankRow(row)), [rows]);
  /** The parent's own rules (depth, records already booked) — they block every row alike. */
  const parentBlockers = useMemo(() => (parent ? addBlockersFor(parent, data) : []), [parent, data]);

  /** Each filled row as the sub-item it would become, for the checks and the shares. */
  const drafts = useMemo(
    () =>
      filled.map((row, index) => {
        const qty = readNumberText(row.qtyText);
        const share = readNumberText(row.shareText);
        return {
          row,
          virtual: {
            id: `__grid__${row.key}`,
            boqItemId: parent?.boqItemId ?? "",
            parentId,
            slNo: row.slNo.trim(),
            description: row.description.trim(),
            unit: row.unit.trim(),
            qty: qty !== null && Number.isFinite(qty) ? qty : 0,
            weightPct: share !== null && Number.isFinite(share) ? share : null,
            order: 100000 + index,
          } satisfies DprSubItem,
          qty,
          share,
        };
      }),
    [filled, parent?.boqItemId, parentId],
  );

  /** Per row: the engine's checks against the saved breakdown plus every other row in the grid. */
  const rowChecks = useMemo(() => {
    const map = new Map<string, { errors: string[]; warnings: string[] }>();
    if (!parent) return map;
    for (const draft of drafts) {
      const others = drafts.filter((other) => other !== draft).map((other) => other.virtual);
      const augmented = buildDprBreakdown(data.boqLines, [...data.subItems, ...others]);
      const result = checkDprSubItem({
        draft: {
          parentId,
          slNo: draft.row.slNo,
          description: draft.row.description,
          unit: draft.row.unit,
          qty: draft.virtual.qty,
          // NaN is passed through so the engine reports it as out of range.
          weightPct: draft.share,
        },
        breakdown: augmented,
        targets: data.targets,
        entries: data.entries,
        settings: data.settings,
      });
      // The parent's own rules are reported once for the whole grid, not on every row.
      map.set(draft.row.key, {
        errors: result.errors.filter((message) => !parentBlockers.includes(message)),
        warnings: result.warnings,
      });
    }
    return map;
  }, [drafts, parent, parentId, data.boqLines, data.subItems, data.targets, data.entries, data.settings, parentBlockers]);

  /** The share each row (and each existing sub-item) actually gets once these rows are added. */
  const shares = useMemo(() => {
    if (!parent) return new Map<string, number>();
    return effectiveWeights(parent, [
      ...siblings.map((sibling) => ({
        id: sibling.id,
        unit: sibling.unit,
        qty: sibling.qty,
        weightPct: sibling.weightPct,
      })),
      ...drafts.map((draft) => draft.virtual),
    ]);
  }, [parent, siblings, drafts]);

  const gridShare = drafts.reduce((sum, draft) => sum + (shares.get(draft.virtual.id) ?? 0), 0) * 100;
  const existingShare = siblings.reduce((sum, sibling) => sum + (shares.get(sibling.id) ?? 0), 0) * 100;

  const rowErrors = drafts.flatMap((draft) =>
    (rowChecks.get(draft.row.key)?.errors ?? []).map((message) => `${draft.row.slNo || "A row"}: ${message}`),
  );
  const allErrors = [
    ...parentBlockers,
    ...(filled.length === 0 ? ["Fill in at least one sub-item."] : []),
    ...rowErrors,
  ];
  // The same warning ("shares total 80%…") comes back from every row; show it once.
  const allWarnings = [...new Set(drafts.flatMap((draft) => rowChecks.get(draft.row.key)?.warnings ?? []))];

  const setRow = (key: string, patch: Partial<GridRow>) =>
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const addRow = () => setRows((previous) => [...previous, ...numberedRows(1, previous)]);

  const removeRow = (key: string) =>
    setRows((previous) => {
      const next = previous.filter((row) => row.key !== key);
      return next.length > 0 ? next : numberedRows(1, []);
    });

  /**
   * Rows copied from Excel: tab-separated (or two-or-more spaces). With an SL No first —
   * SL No, Description, Unit, Qty, Share % — or without one, numbered on automatically. A missing
   * unit takes the parent's; a missing quantity takes 1 under a lump line. A header row is skipped.
   */
  const applyPaste = () => {
    const pasted: GridRow[] = [];
    for (const raw of pasteText.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const cells = (line.includes("\t") ? line.split("\t") : line.split(/\s{2,}/)).map((cell) => cell.trim());
      const hasSlNo = cells.length >= 2 && SL_NO_PATTERN.test(cells[0] ?? "");
      const [slNo, description, unit, qty, share] = hasSlNo ? cells : ["", ...cells];
      if (!description) continue;
      // "Description / Unit / Qty" headings: a quantity cell that is there but is not a number.
      if (qty && !Number.isFinite(Number(qty.replace(/,/g, "")))) continue;
      pasted.push({
        key: rowKey(),
        slNo: slNo ?? "",
        description,
        unit: unit || defaultUnit,
        qtyText: qty ? qty.replace(/,/g, "") : defaultQty,
        shareText: share ? share.replace(/%/g, "").trim() : "",
      });
    }
    if (pasted.length === 0) {
      toast({ title: "Nothing to add", description: "No row with a description was found in the pasted text." });
      return;
    }
    setRows((previous) => {
      const kept = previous.filter((row) => !isBlankRow(row));
      // Rows pasted without an SL No are numbered on from everything above them.
      const numbered: GridRow[] = [];
      for (const row of pasted) {
        numbered.push(
          row.slNo
            ? row
            : { ...row, slNo: nextSubItemSlNo(parent?.slNo ?? "", [...siblings, ...kept, ...numbered]) },
        );
      }
      return [...kept, ...numbered];
    });
    setPasteText("");
    setShowPaste(false);
    toast({ title: `${pasted.length} row${pasted.length === 1 ? "" : "s"} added from the paste` });
  };

  const handleSave = async () => {
    setAttempted(true);
    if (!parent || allErrors.length > 0 || !data.globalProjectId || !user) return;
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const firstOrder =
        data.subItems
          .filter((sub) => sub.parentId === parent.id)
          .reduce((highest, sub) => Math.max(highest, Number(sub.order) || 0), 0) + 1;
      drafts.forEach((draft, index) => {
        const ref = doc(collection(db, "projects", data.globalProjectId, DPR_SUB_ITEM_COLLECTION));
        batch.set(ref, {
          boqItemId: parent.boqItemId,
          parentId: parent.id,
          slNo: draft.virtual.slNo,
          description: draft.virtual.description,
          unit: draft.virtual.unit,
          qty: draft.virtual.qty,
          weightPct: draft.virtual.weightPct,
          order: firstOrder + index,
          remarks: "",
          createdAt: serverTimestamp(),
          createdBy: user.id ?? "",
          createdByName: user.name ?? "",
          updatedAt: serverTimestamp(),
          updatedBy: user.id ?? "",
          updatedByName: user.name ?? "",
        });
      });
      await batch.commit();
      void logUserActivity({
        userId: user.id ?? "",
        userName: user.name ?? "",
        userEmail: user.email ?? "",
        module: "Project Management",
        action: "Add DPR Sub-items",
        details: {
          project: data.projectName,
          parent: parent.slNo,
          count: drafts.length,
          slNos: drafts.map((draft) => draft.virtual.slNo).join(", "),
        },
      });
      toast({
        title: `${drafts.length} sub-item${drafts.length === 1 ? "" : "s"} added under ${parent.slNo || "the line"}`,
      });
      onClose();
      await data.reload();
    } catch (error) {
      console.error("Failed to add the sub-items:", error);
      toast({
        title: "Save failed",
        description: "The sub-items could not be saved. Nothing was added.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogContent size="xl" className="gap-4 overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Add several sub-items</DialogTitle>
        <DialogDescription>
          {lump
            ? "Break the lump line below into its parts. Each part is planned and recorded on its own, and the line's progress rolls up from them."
            : "Each row becomes a sub-item of the line below, planned and recorded on its own."}
        </DialogDescription>
      </DialogHeader>

      {parent ? (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Under</span>
          <DprBoqSummary boqSlNo={parent.slNo} description={parent.description} unit={parent.unit} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {filled.length} row{filled.length === 1 ? "" : "s"} · {formatPct(gridShare)} of{" "}
            {parent?.slNo || "the line"}
            {siblings.length > 0 ? ` · existing sub-items ${formatPct(existingShare)}` : ""}
          </span>
          <InfoTip label="About the shares">
            Leave Share blank to share out what the set ones leave: by quantity when every sub-item
            uses the parent&apos;s unit (so same-unit parts simply add up), otherwise equally. Shares
            under one line can total at most 100%. Under a lump line (LOT, LS, job, set) each part is
            usually 1 of its own unit, with a share of the whole.
          </InfoTip>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowPaste((open) => !open)}>
            <ClipboardPaste className="mr-1.5 h-4 w-4" /> Paste from Excel
          </Button>
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-1.5 h-4 w-4" /> Add row
          </Button>
        </div>
      </div>

      {showPaste ? (
        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="flex h-6 items-center gap-1.5">
            <Label htmlFor="sub-paste">Rows copied from Excel</Label>
            <InfoTip label="About pasting rows">
              One sub-item per row, columns separated by tabs (what Excel copies): SL No, Description,
              Unit, Qty, Share %. The SL No column may be left out — rows are then numbered on
              automatically. A missing unit takes the parent&apos;s; a missing quantity takes 1 under a
              lump line. A heading row is skipped.
            </InfoTip>
          </div>
          <Textarea
            id="sub-paste"
            rows={4}
            value={pasteText}
            placeholder={"7.1\tEarth pits\tNos\t20\t40\n7.2\tGI strip\tRmt\t500"}
            onChange={(event) => setPasteText(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowPaste(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={applyPaste} disabled={!pasteText.trim()}>
              Fill rows
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border/60">
        <Table stickyHeader containerClassName="max-h-[45vh]" className="min-w-[820px] table-fixed">
          <colgroup>
            <col className="w-[104px]" />
            <col />
            <col className="w-[100px]" />
            <col className="w-[104px]" />
            <col className="w-[96px]" />
            <col className="w-[96px]" />
            <col className="w-[48px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="truncate">SL No</TableHead>
              <TableHead className="truncate">Description</TableHead>
              <TableHead className="truncate">Unit</TableHead>
              <TableHead className="truncate text-right">Qty</TableHead>
              <TableHead className="truncate text-right" title="Share of the parent, % (blank = auto)">
                Share %
              </TableHead>
              <TableHead className="truncate text-right" title="The share this row actually gets">
                Works out
              </TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Remove</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const check = rowChecks.get(row.key);
              const hasErrors = attempted && Boolean(check && check.errors.length > 0);
              const share = shares.get(`__grid__${row.key}`);
              const decimals = dprUnitDecimals(row.unit, data.settings);
              return (
                <TableRow key={row.key}>
                  <TableCell className="py-1.5">
                    <Input
                      aria-label="SL No"
                      className={cn("h-8 w-full min-w-0 tabular-nums", hasErrors && "border-destructive")}
                      value={row.slNo}
                      onChange={(event) => setRow(row.key, { slNo: event.target.value })}
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Input
                      aria-label={`Description for ${row.slNo || "this row"}`}
                      className="h-8 w-full min-w-0"
                      placeholder="What this part of the work is"
                      value={row.description}
                      onChange={(event) => setRow(row.key, { description: event.target.value })}
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Input
                      aria-label={`Unit for ${row.slNo || "this row"}`}
                      className="h-8 w-full min-w-0"
                      list="dpr-several-units"
                      value={row.unit}
                      onChange={(event) => setRow(row.key, { unit: event.target.value })}
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Input
                      aria-label={`Quantity for ${row.slNo || "this row"}`}
                      type="number"
                      min={0}
                      step={decimals === 0 ? 1 : "any"}
                      inputMode={decimals === 0 ? "numeric" : "decimal"}
                      className="h-8 w-full min-w-0 text-right tabular-nums"
                      value={row.qtyText}
                      onChange={(event) => setRow(row.key, { qtyText: event.target.value })}
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Input
                      aria-label={`Share of the parent for ${row.slNo || "this row"}`}
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      inputMode="decimal"
                      placeholder="Auto"
                      className="h-8 w-full min-w-0 text-right tabular-nums"
                      value={row.shareText}
                      onChange={(event) => setRow(row.key, { shareText: event.target.value })}
                    />
                  </TableCell>
                  <TableCell className="truncate text-right text-sm tabular-nums text-muted-foreground">
                    {isBlankRow(row) || share === undefined ? "—" : formatPct(share * 100)}
                  </TableCell>
                  <TableCell className="py-1.5 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={`Remove row ${row.slNo || ""}`.trim()}
                      onClick={() => removeRow(row.key)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <datalist id="dpr-several-units">
        {[...new Map(
          [...data.boqLines.map((line) => line.unit), ...data.subItems.map((sub) => sub.unit)]
            .filter(Boolean)
            .map((unit) => [unit.toLowerCase(), unit] as const),
        ).values()].map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>

      <DprMessages
        errors={attempted ? allErrors : parentBlockers}
        warnings={allWarnings}
        errorTitle="Fix these before saving"
      />

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={() => void handleSave()} disabled={isSaving || !user || parentBlockers.length > 0}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Add {filled.length > 0 ? filled.length : ""} sub-item{filled.length === 1 ? "" : "s"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
