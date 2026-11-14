"use client";

/**
 * Adding several sub-items under one BOQ line (or sub-item) at once — the quick way to break a
 * 1 LOT line into its parts.
 *
 * A grid of rows (SL No numbered on automatically, description, unit, quantity, share), filled by
 * hand or by pasting rows copied from Excel. Every row is checked with the engine's own
 * `checkDprSubItem`, against the saved breakdown *plus the other rows in the grid*, so an SL No used
 * twice or shares that would pass 100% across the grid and the existing sub-items are caught before
 * anything is written. The share bar shows what each row will actually get. One Save writes every
 * row in a single batch.
 */

import { useMemo, useState } from "react";
import { ClipboardPaste, ListPlus, Loader2, Plus, Trash2 } from "lucide-react";
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
import { DprMessages, formatPct } from "@/components/project-management/dpr/dpr-shell";
import {
  addBlockersFor,
  isShareCoverageWarning,
  knownUnitsOf,
  type BreakdownUser,
} from "@/components/project-management/dpr/breakdown-dialogs";
import {
  SUB_ITEM_DIALOG_CLASS,
  SUB_ITEM_DIALOG_STYLE,
  ShareAllocation,
  SubItemDialogHeader,
  SubItemParentCard,
  SubmitChordHint,
  isSubmitChord,
  readNumberText,
  subItemColour,
  type ShareSegment,
} from "@/components/project-management/dpr/sub-item-dialog-parts";
import { InfoTip } from "@/components/shared/info-tip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
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

/** An SL No as pasted: digits, dot-separated, optionally ending in a letter (7.2, 7.2.1, 7.2a). */
const SL_NO_PATTERN = /^\d+(\.\d+)*[a-z]?$/i;
/** A quantity or share as pasted: "1,200", "0.5", "40%". */
const NUMBER_CELL = /^-?(\d{1,3}(,\d{2,3})*|\d+)?(\.\d+)?%?$/;
/** A heading cell copied along with the rows. */
const HEADING_CELL = /^(s\.?\s*l\.?\s*no\.?|s\.?\s*no\.?|sr\.?\s*no\.?|description|particulars|qty|quantity|unit|share\s*%?)$/i;

const isNumberCell = (cell: string) => cell !== "" && NUMBER_CELL.test(cell.replace(/\s/g, ""));

interface GridRow {
  key: string;
  /** Kept only once typed (or pasted); otherwise the row is numbered on from the rows above it. */
  slNo: string;
  slEdited: boolean;
  description: string;
  unit: string;
  qtyText: string;
  shareText: string;
}

let rowSeed = 0;
const rowKey = () => `row-${Date.now().toString(36)}-${(rowSeed += 1)}`;

/** Untouched: nothing typed beyond what a new row starts with (a lump line's parts start at 1). */
const isBlankGridRow = (row: GridRow, defaultQty: string) =>
  !row.description.trim() &&
  !row.shareText.trim() &&
  (!row.qtyText.trim() || row.qtyText.trim() === defaultQty);

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

  const blankRow = (): GridRow => ({
    key: rowKey(),
    slNo: "",
    slEdited: false,
    description: "",
    unit: defaultUnit,
    qtyText: defaultQty,
    shareText: "",
  });

  const isBlankRow = (row: GridRow) => isBlankGridRow(row, defaultQty);

  const [rows, setRows] = useState<GridRow[]>(() => [blankRow(), blankRow(), blankRow()]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Each row's SL No: as typed, or numbered on from the saved sub-items and the rows above it —
   * skipping any number typed on a row further down, so a pasted "7.9" does not push 7.3 to 7.10.
   */
  const slNos = useMemo(() => {
    const typed = new Set(rows.filter((row) => row.slEdited).map((row) => row.slNo.trim().toLowerCase()));
    const above: Array<{ slNo: string }> = [...siblings];
    const map = new Map<string, string>();
    for (const row of rows) {
      let slNo = row.slNo;
      if (!row.slEdited) {
        slNo = nextSubItemSlNo(parent?.slNo ?? "", above);
        for (let guard = 0; typed.has(slNo.toLowerCase()) && guard < 1000; guard += 1) {
          slNo = nextSubItemSlNo(parent?.slNo ?? "", [...above, { slNo }]);
        }
      }
      map.set(row.key, slNo);
      above.push({ slNo });
    }
    return map;
  }, [rows, siblings, parent?.slNo]);
  const slNoOf = (row: GridRow) => slNos.get(row.key) ?? row.slNo;

  /** The parent's own rules (depth, records already booked) — they block every row alike. */
  const parentBlockers = useMemo(() => (parent ? addBlockersFor(parent, data) : []), [parent, data]);

  /** Each filled row as the sub-item it would become, for the checks and the shares. */
  const { filled, drafts } = useMemo(() => {
    const filledRows = rows.filter((row) => !isBlankGridRow(row, defaultQty));
    return {
      filled: filledRows,
      drafts: filledRows.map((row, index) => {
        const qty = readNumberText(row.qtyText);
        const share = readNumberText(row.shareText);
        const virtual: DprSubItem = {
          id: `__grid__${row.key}`,
          boqItemId: parent?.boqItemId ?? "",
          parentId,
          slNo: (slNos.get(row.key) ?? row.slNo).trim(),
          description: row.description.trim(),
          unit: row.unit.trim(),
          qty: qty !== null && Number.isFinite(qty) ? qty : 0,
          weightPct: share !== null && Number.isFinite(share) && share > 0 ? share : null,
          order: 100000 + index,
        };
        return { row, virtual, share, colourIndex: index };
      }),
    };
  }, [rows, defaultQty, slNos, parent?.boqItemId, parentId]);

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
          slNo: draft.virtual.slNo,
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

  /** The share each row (and each saved sub-item) actually gets once these rows are added. */
  const weights = parent
    ? effectiveWeights(parent, [
        ...siblings.map((sibling) => ({
          id: sibling.id,
          unit: sibling.unit,
          qty: sibling.qty,
          weightPct: sibling.weightPct,
        })),
        ...drafts.map((draft) => draft.virtual),
      ])
    : new Map<string, number>();

  const segments: ShareSegment[] = [
    ...siblings.map((sibling, index) => ({
      id: sibling.id,
      share: weights.get(sibling.id) ?? 0,
      existing: true,
      auto: sibling.weightPct === null,
      colourIndex: index,
      label: `${sibling.slNo} ${sibling.description}`.trim(),
    })),
    ...drafts.map((draft) => ({
      id: draft.virtual.id,
      share: weights.get(draft.virtual.id) ?? 0,
      existing: false,
      auto: draft.virtual.weightPct === null,
      colourIndex: draft.colourIndex,
      label: `${draft.virtual.slNo} ${draft.virtual.description}`.trim(),
    })),
  ];
  const setTotalPct =
    siblings.reduce((sum, sibling) => sum + (sibling.weightPct ?? 0), 0) +
    drafts.reduce((sum, draft) => sum + (draft.virtual.weightPct ?? 0), 0);
  const over = setTotalPct > 100 + 1e-9;

  const rowErrors = drafts.flatMap((draft) =>
    (rowChecks.get(draft.row.key)?.errors ?? []).map(
      (message) => `${draft.virtual.slNo || "A row"}: ${message}`,
    ),
  );
  const allErrors = [
    ...parentBlockers,
    ...(attempted && filled.length === 0 ? ["Fill in at least one sub-item."] : []),
    ...(attempted ? rowErrors : []),
  ];
  // The same warning comes back from every row; show it once. Share coverage is the bar's job.
  const allWarnings = [
    ...new Set(
      drafts
        .flatMap((draft) => rowChecks.get(draft.row.key)?.warnings ?? [])
        .filter((message) => !isShareCoverageWarning(message)),
    ),
  ];

  const canSubmit =
    Boolean(parent) && filled.length > 0 && !over && parentBlockers.length === 0 && Boolean(user) && !isSaving;

  const setRow = (key: string, patch: Partial<GridRow>) =>
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const addRow = () => {
    const row = blankRow();
    setRows((previous) => [...previous, row]);
    setFocusKey(row.key);
  };

  const removeRow = (key: string) =>
    setRows((previous) => {
      const next = previous.filter((row) => row.key !== key);
      return next.length > 0 ? next : [blankRow()];
    });

  /**
   * Rows copied from Excel: tab-separated (or two-or-more spaces). Description, Qty, Share % —
   * optionally with an SL No before the description and a unit after it. A missing unit takes the
   * parent's; a missing quantity takes 1 under a lump line. A heading row is skipped.
   */
  const applyPaste = () => {
    const pasted: GridRow[] = [];
    for (const raw of pasteText.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const cells = (raw.includes("\t") ? raw.split("\t") : raw.trim().split(/\s{2,}/)).map((cell) =>
        cell.trim(),
      );
      if (cells.some((cell) => HEADING_CELL.test(cell))) continue;
      let at = 0;
      let slNo = "";
      if (cells.length >= 2 && SL_NO_PATTERN.test(cells[0] ?? "") && cells[1]) {
        slNo = cells[0] ?? "";
        at = 1;
      }
      const description = cells[at] ?? "";
      at += 1;
      if (!description) continue;
      let unit = "";
      const unitCell = cells[at] ?? "";
      if (unitCell && !isNumberCell(unitCell)) {
        unit = unitCell;
        at += 1;
      }
      let qty = cells[at] ?? "";
      let share = cells[at + 1] ?? "";
      // "Earth pits  40%": a lone percentage is the share, not the quantity.
      if (qty.endsWith("%") && !share) {
        share = qty;
        qty = "";
      }
      const qtyClean = qty.replace(/,/g, "");
      const shareClean = share.replace(/%/g, "").trim();
      pasted.push({
        key: rowKey(),
        slNo,
        slEdited: Boolean(slNo),
        description,
        unit: unit || defaultUnit,
        qtyText: qtyClean && Number.isFinite(Number(qtyClean)) ? qtyClean : defaultQty,
        shareText: shareClean && Number.isFinite(Number(shareClean)) ? shareClean : "",
      });
    }
    if (pasted.length === 0) {
      toast({ title: "Nothing to add", description: "No row with a description was found in the pasted text." });
      return;
    }
    setRows((previous) => [...previous.filter((row) => !isBlankRow(row)), ...pasted]);
    setPasteText("");
    setShowPaste(false);
    toast({ title: `${pasted.length} row${pasted.length === 1 ? "" : "s"} added from Excel` });
  };

  const handleSave = async () => {
    setAttempted(true);
    if (!parent || filled.length === 0 || rowErrors.length > 0 || parentBlockers.length > 0) return;
    if (!data.globalProjectId || !user) return;
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

  const knownUnits = useMemo(() => knownUnitsOf(data), [data]);
  const parentLabel = parent?.slNo || "the line";

  return (
    <DialogContent
      size="xl"
      className={cn(SUB_ITEM_DIALOG_CLASS, "max-w-[95vw] sm:max-w-[60rem]")}
      style={SUB_ITEM_DIALOG_STYLE}
      onKeyDown={(event) => {
        if (!isSubmitChord(event)) return;
        event.preventDefault();
        if (canSubmit) void handleSave();
      }}
    >
      <SubItemDialogHeader
        icon={<ListPlus className="h-4 w-4" />}
        title="Add several sub-items"
        description={
          lump
            ? "Break the lump line below into its parts. Each part is planned and recorded on its own, and the line's progress rolls up from them."
            : "Each row becomes a sub-item of the line below, planned and recorded on its own."
        }
      />

      <DialogBody className="mx-0 space-y-4 px-5 py-4 sm:px-6">
        {parent ? (
          <SubItemParentCard
            slNo={parent.slNo}
            description={parent.description}
            unit={parent.unit}
            kind={parent.kind}
            path={parent.ancestors}
          />
        ) : null}

        {parent ? (
          <ShareAllocation
            parentLabel={parentLabel}
            segments={segments}
            setTotalPct={setTotalPct}
            newLabel="New rows"
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">Sub-items</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            · {rows.length} row{rows.length === 1 ? "" : "s"}, {filled.length} filled
          </span>
          <InfoTip label="About the shares">
            Leave Share on Auto to share out what the set ones leave: by quantity when every
            sub-item uses the parent&apos;s unit (so same-unit parts simply add up), otherwise
            equally. Shares under one line can total at most 100%. Under a lump line (LOT, LS, job,
            set) each part is usually 1 of its own unit, with a share of the whole.
          </InfoTip>
          <span className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            aria-expanded={showPaste}
            onClick={() => setShowPaste((open) => !open)}
          >
            <ClipboardPaste className="mr-1.5 h-4 w-4" /> Paste from Excel
          </Button>
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-1.5 h-4 w-4" /> Add row
          </Button>
        </div>

        {showPaste ? (
          <div className="space-y-2 rounded-lg border border-dashed border-violet-300 bg-violet-50/60 p-3">
            <Label htmlFor="sub-paste" className="sr-only">
              Rows copied from Excel
            </Label>
            <Textarea
              id="sub-paste"
              rows={4}
              autoFocus
              className="bg-background font-mono text-xs"
              value={pasteText}
              placeholder="Copy rows from Excel and paste here. Columns: Description · Qty · Share % (Qty and Share are optional)"
              onChange={(event) => setPasteText(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Each line becomes one row. SL No and Unit are filled in for you.</span>
              <InfoTip label="About pasting rows">
                One sub-item per line, columns separated by tabs (what Excel copies): Description,
                Qty, Share %. An SL No may come first and a unit after the description — both are
                kept when given. A missing unit takes the parent&apos;s; a missing quantity takes 1
                under a lump line. A heading row is skipped.
              </InfoTip>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => setShowPaste(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={applyPaste} disabled={!pasteText.trim()}>
                Add rows
              </Button>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-border/60">
          <Table stickyHeader containerClassName="max-h-[45vh]" className="min-w-[820px] table-fixed">
            <colgroup>
              <col className="w-[40px]" />
              <col className="w-[104px]" />
              <col />
              {/* Wide enough for "Nos" / "SQ.MTRS." beside the browser's suggestions arrow. */}
              <col className="w-[124px]" />
              <col className="w-[112px]" />
              <col className="w-[100px]" />
              <col className="w-[100px]" />
              <col className="w-[48px]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="truncate">
                  <span className="sr-only">Row</span>
                </TableHead>
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
              {rows.map((row, index) => {
                const slNo = slNoOf(row);
                const blank = isBlankRow(row);
                const draft = blank ? undefined : drafts.find((candidate) => candidate.row.key === row.key);
                const hasErrors = attempted && Boolean(rowChecks.get(row.key)?.errors.length);
                const share = draft ? weights.get(draft.virtual.id) : undefined;
                const decimals = dprUnitDecimals(row.unit, data.settings);
                return (
                  <TableRow key={row.key}>
                    <TableCell className="py-1.5 text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Input
                        aria-label={`SL No for row ${index + 1}`}
                        title={row.slEdited ? undefined : "Numbered on automatically — type to set your own"}
                        className={cn(
                          "h-8 w-full min-w-0 tabular-nums",
                          !row.slEdited && "bg-muted/40",
                          hasErrors && "border-destructive",
                        )}
                        value={slNo}
                        onChange={(event) =>
                          setRow(row.key, {
                            slNo: event.target.value,
                            slEdited: event.target.value.trim() !== "",
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Input
                        aria-label={`Description for ${slNo || "this row"}`}
                        className={cn("h-8 w-full min-w-0", hasErrors && "border-destructive")}
                        placeholder="What this part of the work is"
                        autoFocus={row.key === focusKey}
                        value={row.description}
                        onChange={(event) => setRow(row.key, { description: event.target.value })}
                      />
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Input
                        aria-label={`Unit for ${slNo || "this row"}`}
                        className="h-8 w-full min-w-0"
                        list="dpr-several-units"
                        value={row.unit}
                        onChange={(event) => setRow(row.key, { unit: event.target.value })}
                      />
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Input
                        aria-label={`Quantity for ${slNo || "this row"}`}
                        type="number"
                        min={0}
                        step={decimals === 0 ? 1 : "any"}
                        inputMode={decimals === 0 ? "numeric" : "decimal"}
                        placeholder="0"
                        className="h-8 w-full min-w-0 text-right tabular-nums"
                        value={row.qtyText}
                        onChange={(event) => setRow(row.key, { qtyText: event.target.value })}
                      />
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Input
                        aria-label={`Share of the parent for ${slNo || "this row"}`}
                        type="number"
                        min={0}
                        max={100}
                        step="any"
                        inputMode="decimal"
                        placeholder="Auto"
                        className={cn(
                          "h-8 w-full min-w-0 text-right tabular-nums",
                          over && row.shareText.trim() && "border-destructive",
                        )}
                        value={row.shareText}
                        onChange={(event) => setRow(row.key, { shareText: event.target.value })}
                      />
                    </TableCell>
                    <TableCell className="truncate text-right text-sm font-semibold tabular-nums">
                      {draft && share !== undefined ? (
                        <span className="inline-flex items-center gap-1.5">
                          <i
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: subItemColour(draft.colourIndex) }}
                            aria-hidden="true"
                          />
                          {formatPct(share * 100)}
                        </span>
                      ) : (
                        <span className="font-normal text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove row ${index + 1}`}
                        title="Remove row"
                        onClick={() => removeRow(row.key)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <datalist id="dpr-several-units">
          {knownUnits.map((unit) => (
            <option key={unit} value={unit} />
          ))}
        </datalist>

        <DprMessages errors={allErrors} warnings={allWarnings} errorTitle="Fix these before saving" />
      </DialogBody>

      <DialogFooter className="justify-end gap-2 border-t border-border/60 bg-muted/40 px-5 py-3 sm:items-center sm:space-x-0 sm:px-6">
        <span className="flex items-center gap-3 text-xs text-muted-foreground sm:mr-auto">
          <span>{filled.length > 0 ? "Empty rows are skipped." : "Fill in at least one description."}</span>
          <SubmitChordHint action="add" />
        </span>
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={() => void handleSave()} disabled={!canSubmit}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {filled.length > 0
            ? `Add ${filled.length} sub-item${filled.length === 1 ? "" : "s"}`
            : "Add sub-items"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
