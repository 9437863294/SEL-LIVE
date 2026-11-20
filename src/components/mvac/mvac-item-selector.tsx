"use client";

/**
 * Choosing what goes on an MVAC: one item at a time, or several at once.
 *
 * The same two controls Create JMC uses over the BOQ — a searchable picker in the row, and an
 * "add several" dialog — but over a different list. A JMC measures contract lines; an MVAC
 * accepts material that has actually arrived, so the list here is what **GRN has accepted and no
 * certificate has taken yet**, whoever supplied it, one row per purchase-order item with the GRNs
 * that delivered it named beside it.
 *
 * Lines already on the form are left out of both controls rather than shown and refused: the same
 * item on two rows would be checked against the balance twice and pass twice, which is how a
 * register ends up over-accepted.
 *
 * Presentation only — the candidate list and the balance rules come from
 * `project-management-mvac-dashboard.ts`.
 */

import { useMemo, useState } from "react";
import { ArrowUpDown, Check, Search, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  filterMvacCandidates,
  formatMvacQty,
  type MvacCandidateLine,
} from "@/lib/project-management-mvac-dashboard";
import { cn } from "@/lib/utils";

/** The GRN numbers behind a line, as a short list with the rest counted. */
export function MvacGrnChips({
  grns,
  unit,
  max = 3,
}: {
  grns: MvacCandidateLine["grns"];
  unit?: string;
  max?: number;
}) {
  if (grns.length === 0) {
    return (
      <span className="whitespace-nowrap text-[11px] font-semibold text-muted-foreground">
        no GRN recorded
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {grns.slice(0, max).map((grn) => (
        <span
          key={`${grn.grnNumber}-${grn.date}`}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-extrabold"
          title={`${formatMvacQty(grn.qty, unit)} accepted on ${grn.date || "an unrecorded date"}`}
        >
          <Truck className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          {grn.grnNumber}
        </span>
      ))}
      {grns.length > max ? (
        <span className="text-[10.5px] font-bold text-muted-foreground">
          +{grns.length - max}
        </span>
      ) : null}
    </span>
  );
}

/* ── One item, in a register row ────────────────────────────────────────────────────────────── */

export function MvacItemSelector({
  candidates,
  selectedKey,
  onSelect,
  isLoading,
}: {
  /** Everything still available, including the line this row already holds. */
  candidates: readonly MvacCandidateLine[];
  selectedKey: string;
  onSelect: (line: MvacCandidateLine | null) => void;
  isLoading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const selected = useMemo(
    () => candidates.find((row) => row.key === selectedKey) ?? null,
    [candidates, selectedKey],
  );

  const sorted = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...candidates].sort(
      (a, b) => collator.compare(a.itemDescription, b.itemDescription) * direction,
    );
  }, [candidates, sortDirection]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          <span className="truncate">{selected ? selected.itemDescription : "Select item..."}</span>
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      {/* Capped to the viewport so a phone does not get a 700px panel hanging off its edge. */}
      <PopoverContent
        className="z-[99999] w-[min(760px,calc(100vw_-_1.5rem))] p-0"
        side="bottom"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Command>
          <CommandInput placeholder="Search by item, PO, vendor or GRN no..." />
          <CommandList className="max-h-72 overflow-y-auto">
            <CommandEmpty>
              {isLoading ? "Loading..." : "Nothing left for joint acceptance."}
            </CommandEmpty>
            <CommandGroup>
              <div className="flex items-center border-b px-4 py-2 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[3fr_1.4fr_1.6fr_1fr]">
                <button
                  type="button"
                  onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
                  className="flex cursor-pointer select-none items-center gap-1 text-left"
                  title="Sort by item"
                >
                  Item
                  <ArrowUpDown
                    className={cn(
                      "h-3 w-3 transition-transform",
                      sortDirection === "desc" && "rotate-180",
                    )}
                  />
                </button>
                <div className="hidden text-left sm:block">PO · Vendor</div>
                <div className="hidden text-left sm:block">From GRN</div>
                <div className="hidden text-right sm:block">Available</div>
              </div>

              {sorted.map((row) => {
                const isSelected = row.key === selectedKey;
                return (
                  <CommandItem
                    key={row.key}
                    value={row.key}
                    keywords={[
                      row.itemDescription,
                      row.poNumber,
                      row.vendorName,
                      ...row.grns.map((grn) => grn.grnNumber),
                    ].filter(Boolean)}
                    onSelect={(key) => {
                      onSelect(candidates.find((entry) => entry.key === key) ?? null);
                      setOpen(false);
                    }}
                    className={cn("px-2 py-2", isSelected && "bg-accent text-accent-foreground")}
                  >
                    <div className="grid w-full grid-cols-2 items-center gap-x-2 gap-y-0.5 sm:grid-cols-[3fr_1.4fr_1.6fr_1fr] sm:gap-2">
                      <div className="col-span-2 flex items-center gap-2 truncate pr-2 text-sm font-medium sm:col-span-1">
                        {isSelected ? (
                          <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        ) : null}
                        <span className="truncate">{row.itemDescription}</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {row.poNumber} · {row.vendorName}
                      </div>
                      <div className="text-xs">
                        <MvacGrnChips grns={row.grns} unit={row.unit} max={2} />
                      </div>
                      <div className="text-right text-sm font-semibold tabular-nums">
                        {formatMvacQty(row.availableQty, row.unit)}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ── Several at once ────────────────────────────────────────────────────────────────────────── */

export function MvacGrnMultiSelectDialog({
  isOpen,
  onOpenChange,
  candidates,
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only what is still free — lines already on the form are not offered. */
  candidates: readonly MvacCandidateLine[];
  onConfirm: (lines: MvacCandidateLine[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState("all");

  /*
   * A fresh dialog each time it opens: last time's ticks and filters are not a draft anybody
   * wants back. Adjusted during render rather than in an effect — the pattern React documents for
   * "reset state when a prop changes" — so it costs no second pass.
   */
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setSelected(new Set());
      setQuery("");
      setVendor("all");
    }
  }

  const vendors = useMemo(
    () => [...new Set(candidates.map((row) => row.vendorName))].sort(),
    [candidates],
  );

  const shown = useMemo(() => {
    const byText = filterMvacCandidates(candidates, query);
    return vendor === "all" ? byText : byText.filter((row) => row.vendorName === vendor);
  }, [candidates, query, vendor]);

  const allShownChosen = shown.length > 0 && shown.every((row) => selected.has(row.key));

  const toggle = (key: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(1000px,calc(100vw-1.5rem))] max-w-none flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Add items from GRN</DialogTitle>
          <DialogDescription>
            Everything received at site and not yet on a certificate. Any vendor — tick what this
            MVAC covers.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Item, PO, vendor or GRN no."
            aria-label="Search what is available"
            className="h-9 w-full sm:w-[280px]"
          />
          <Select value={vendor} onValueChange={setVendor}>
            <SelectTrigger className="h-9 w-full text-left sm:w-[220px]">
              <SelectValue placeholder="Every vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every vendor</SelectItem>
              {vendors.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs font-semibold text-muted-foreground">
            {selected.size} selected · {shown.length} shown
          </span>
        </div>

        {/* A native scroller, not ScrollArea: a wide table inside that wrapper loses its
            scrollbars. */}
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr className="text-left text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                <th className="w-10 p-2">
                  <Checkbox
                    checked={allShownChosen}
                    aria-label="Select everything shown"
                    onCheckedChange={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        for (const row of shown) {
                          if (checked) next.add(row.key);
                          else next.delete(row.key);
                        }
                        return next;
                      })
                    }
                  />
                </th>
                <th className="p-2">Item</th>
                <th className="p-2">PO · Vendor</th>
                <th className="p-2">From GRN</th>
                <th className="p-2 text-right">Received</th>
                <th className="p-2 text-right">Available</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                    {candidates.length === 0
                      ? "Nothing is waiting for joint acceptance."
                      : "Nothing matches that filter."}
                  </td>
                </tr>
              ) : (
                shown.map((row) => {
                  const checked = selected.has(row.key);
                  return (
                    <tr
                      key={row.key}
                      className={cn(
                        "border-t hover:bg-muted/40",
                        checked && "bg-rose-50/60 dark:bg-rose-950/20",
                      )}
                    >
                      <td className="p-2 align-top">
                        <Checkbox
                          checked={checked}
                          aria-label={`Add ${row.itemDescription}`}
                          onCheckedChange={(state) => toggle(row.key, state === true)}
                        />
                      </td>
                      <td className="max-w-[280px] p-2 font-medium">
                        <span className="block truncate" title={row.itemDescription}>
                          {row.itemDescription}
                        </span>
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {row.poNumber} · {row.vendorName}
                      </td>
                      <td className="p-2">
                        <MvacGrnChips grns={row.grns} unit={row.unit} />
                      </td>
                      <td className="whitespace-nowrap p-2 text-right tabular-nums text-muted-foreground">
                        {formatMvacQty(row.receivedQty, row.unit)}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right font-semibold tabular-nums">
                        {formatMvacQty(row.availableQty, row.unit)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            disabled={selected.size === 0}
            onClick={() => {
              onConfirm(candidates.filter((row) => selected.has(row.key)));
              onOpenChange(false);
            }}
          >
            Add {selected.size || ""} item{selected.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
