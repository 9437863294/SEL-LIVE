"use client";

import { useMemo, useState } from "react";
import { PackageSearch, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PmDataList, PmEmptyState, type PmListColumn } from "@/components/project-management/pm-shell";
import { formatCurrency, formatQuantity, toNumber } from "@/lib/purchase-orders";
import type { PoBoqItemLite } from "@/components/project-management/po-reports";

export default function PoBoqItemsTable({
  items,
  indentQtyByBoqItemId,
  poQtyByBoqItemId,
}: {
  items: PoBoqItemLite[];
  indentQtyByBoqItemId: Map<string, number>;
  poQtyByBoqItemId: Map<string, number>;
}) {
  const [search, setSearch] = useState("");

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [item["ERP SL NO"], item["BOQ SL No"], item.Description].some((value) =>
        String(value ?? "").toLowerCase().includes(query),
      ),
    );
  }, [items, search]);

  const columns: PmListColumn<PoBoqItemLite>[] = [
    {
      header: "ERP SL No",
      className: "whitespace-nowrap text-xs text-muted-foreground",
      cell: (item) => String(item["ERP SL NO"] ?? "—"),
    },
    {
      header: "BOQ SL No",
      className: "whitespace-nowrap text-xs text-muted-foreground",
      cell: (item) => String(item["BOQ SL No"] ?? "—"),
    },
    {
      header: "Description",
      className: "min-w-[220px] max-w-xs truncate",
      mobile: "title",
      cell: (item) => <span title={String(item.Description ?? "")}>{String(item.Description ?? "—")}</span>,
    },
    { header: "Units", cell: (item) => String(item.Unit ?? "—") },
    { header: "QTY", cell: (item) => formatQuantity(toNumber(item.QTY)) },
    { header: "Unit Rate", cell: (item) => formatCurrency(toNumber(item["Unit Rate"])) },
    {
      header: "Budget Price",
      className: "text-muted-foreground",
      cell: (item) => formatCurrency(toNumber(item["Budget Price"])),
    },
    {
      header: "Total Budget Price",
      className: "text-muted-foreground",
      cell: (item) => formatCurrency(toNumber(item.QTY) * toNumber(item["Budget Price"])),
    },
    {
      header: "Total Amount",
      className: "font-medium",
      cell: (item) =>
        formatCurrency(toNumber(item["Total Amount"]) || toNumber(item.QTY) * toNumber(item["Unit Rate"])),
    },
    {
      header: "Indent Qty",
      className: "text-muted-foreground",
      cell: (item) => formatQuantity(indentQtyByBoqItemId.get(item.id) ?? 0),
    },
    {
      header: "PO Qty",
      className: "text-muted-foreground",
      cell: (item) => formatQuantity(poQtyByBoqItemId.get(item.id) ?? 0),
    },
  ];

  return (
    // A card on a desktop; on a phone the bar and the item cards stand on the page, so the list is
    // not boxed twice.
    <Card className="overflow-hidden border-border/60 max-sm:overflow-visible max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none">
      {/* The sidebar already names this view, so the title and its search sit on one bar rather
          than a CardHeader stacked above a separate search row. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:mb-0 sm:border-b sm:border-border/60 sm:px-4 sm:py-2.5">
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground sm:items-center">
          <PackageSearch className="mt-px h-3.5 w-3.5 shrink-0 text-cyan-600 sm:mt-0" />
          <span>
            <span className="font-medium text-foreground">BOQ items — Supply</span>
            {" "}· {filteredItems.length} item{filteredItems.length === 1 ? "" : "s"} with quantities indented or ordered
          </span>
        </p>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search ERP SL No, BOQ SL No or description..."
            aria-label="Search BOQ items"
            className="h-9 pl-8 text-sm sm:h-7 sm:text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <PmDataList
        rows={filteredItems}
        columns={columns}
        // The card above is the frame on a desktop.
        className="sm:rounded-none sm:border-0 sm:shadow-none"
        tableClassName="[&_th]:h-8 [&_th]:whitespace-nowrap [&_th]:px-2 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1"
        maxHeightClassName="sm:max-h-[70vh]"
        empty={
          <PmEmptyState
            icon={PackageSearch}
            title={items.length ? "No matching BOQ items." : "No Scope 2 = Supply BOQ items found for this project."}
          />
        }
      />
    </Card>
  );
}
