"use client";

/**
 * Pick BOQ lines from a list — the dialog behind "Add BOQ lines" on a projection record and
 * "Add projection" on Plan several lines. A filter, one row per line (SL No, description indented
 * by its depth, unit, balance, and what is already planned where the caller says so), a box per
 * row and one for every line shown, and the count picked. The lines come back in the list's own
 * order, whatever order they were ticked in.
 */

import { useMemo, useState } from "react";
import { ListPlus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DprBoqItem } from "@/components/project-management/dpr/use-dpr-data";
import { formatQtyAt } from "@/components/project-management/dpr/dpr-shell";
import { DprIndentedText, breakdownTitle } from "@/components/project-management/dpr/dpr-indent";
import { DprSlNoPill } from "@/components/project-management/dpr/reports-parts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function DprBoqLinePickerDialog({
  open,
  onOpenChange,
  title,
  description,
  emptyText,
  candidates,
  decimalsFor,
  balanceOf,
  planned,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Shown when there is nothing left to pick. */
  emptyText: string;
  /** The lines that can be picked, in the order to list them. */
  candidates: readonly DprBoqItem[];
  decimalsFor: (unit: string) => number;
  /** BOQ quantity less what is done, or null when the line has no BOQ quantity. */
  balanceOf: (item: DprBoqItem) => number | null;
  /** An extra "Planned" column — what is already planned in the period in view — and its tooltip. */
  planned?: { of: (item: DprBoqItem) => number | null; title: string };
  onAdd: (ids: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const close = (next: boolean) => {
    if (!next) {
      setFilter("");
      setPicked(new Set());
    }
    onOpenChange(next);
  };

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((item) =>
      `${item.boqSlNo} ${item.erpSlNo ?? ""} ${item.description} ${item.path ?? ""}`.toLowerCase().includes(needle),
    );
  }, [candidates, filter]);
  const allShownPicked = shown.length > 0 && shown.every((item) => picked.has(item.id));

  const toggle = (id: string, on: boolean) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="xl" className="flex flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Filter BOQ lines"
            placeholder="Filter by SL No or description…"
            className="h-9 rounded-[11px] pl-9 font-semibold"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60">
          {shown.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {candidates.length === 0 ? emptyText : "No BOQ line matches the filter."}
            </p>
          ) : (
            <Table
              stickyHeader
              containerClassName="max-h-[50vh]"
              className={cn("table-fixed", planned ? "min-w-[860px]" : "min-w-[760px]")}
            >
              <colgroup>
                <col className="w-[44px]" />
                <col className="w-[72px]" />
                <col />
                <col className="w-[76px]" />
                <col className="w-[120px]" />
                {planned ? <col className="w-[100px]" /> : null}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Checkbox
                      aria-label="Select every line shown"
                      checked={allShownPicked}
                      onCheckedChange={(checked) =>
                        setPicked((previous) => {
                          const next = new Set(previous);
                          for (const item of shown) {
                            if (checked === true) next.add(item.id);
                            else next.delete(item.id);
                          }
                          return next;
                        })
                      }
                    />
                  </TableHead>
                  <TableHead className="truncate">SL No</TableHead>
                  <TableHead className="truncate">BOQ line</TableHead>
                  <TableHead className="truncate">Unit</TableHead>
                  <TableHead className="truncate text-right" title="BOQ quantity less what is done">
                    Balance
                  </TableHead>
                  {planned ? (
                    <TableHead className="truncate text-right" title={planned.title}>
                      Planned
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((item) => {
                  const on = picked.has(item.id);
                  const balance = balanceOf(item);
                  const plannedQty = planned ? planned.of(item) : null;
                  return (
                    <TableRow
                      key={item.id}
                      className={cn("cursor-pointer", on && "bg-violet-50")}
                      onClick={() => toggle(item.id, !on)}
                    >
                      <TableCell className="py-1.5" onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          aria-label={`Add ${item.boqSlNo || item.description}`}
                          checked={on}
                          onCheckedChange={(checked) => toggle(item.id, checked === true)}
                        />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <DprSlNoPill slNo={item.boqSlNo || item.erpSlNo || ""} seed={item.id} />
                      </TableCell>
                      <TableCell className="text-sm" title={breakdownTitle(item)}>
                        <DprIndentedText text={item.description} depth={item.depth ?? 0} />
                      </TableCell>
                      <TableCell className="truncate text-sm" title={item.unit}>
                        {item.unit || "—"}
                      </TableCell>
                      <TableCell className="truncate text-right text-sm tabular-nums">
                        {balance === null ? "—" : formatQtyAt(balance, decimalsFor(item.unit))}
                      </TableCell>
                      {planned ? (
                        <TableCell className="truncate text-right text-sm tabular-nums">
                          {plannedQty !== null && plannedQty > 0 ? (
                            <span className="rounded-lg bg-violet-50 px-2 py-0.5 font-extrabold text-violet-700">
                              {formatQtyAt(plannedQty, decimalsFor(item.unit))}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-sm font-bold tabular-nums text-muted-foreground">
            {picked.size === 0 ? "Nothing picked yet" : `${plural(picked.size, "line")} picked`}
          </span>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              disabled={picked.size === 0}
              onClick={() => {
                // Keep the list's order, whatever order they were ticked in.
                onAdd(candidates.filter((item) => picked.has(item.id)).map((item) => item.id));
                close(false);
              }}
            >
              <ListPlus className="mr-2 h-4 w-4" />
              {picked.size === 0 ? "Add lines" : `Add ${plural(picked.size, "line")}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
