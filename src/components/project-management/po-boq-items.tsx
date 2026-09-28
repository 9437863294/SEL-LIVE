"use client";

import { useMemo, useState } from "react";
import { PackageSearch } from "lucide-react";
import { SearchInput } from "@/components/shared/filter-bar";
import { TableCard } from "@/components/shared/table-card";
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
      className: "whitespace-nowrap",
      cell: (item) => String(item["ERP SL NO"] ?? "—"),
    },
    {
      header: "BOQ SL No",
      className: "whitespace-nowrap",
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
      cell: (item) => formatCurrency(toNumber(item["Budget Price"])),
    },
    {
      header: "Total Budget Price",
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
      cell: (item) => formatQuantity(indentQtyByBoqItemId.get(item.id) ?? 0),
    },
    {
      header: "PO Qty",
      cell: (item) => formatQuantity(poQtyByBoqItemId.get(item.id) ?? 0),
    },
  ];

  return (
    // A card on a desktop; on a phone the bar and the item cards stand on the page, so the list is
    // not boxed twice.
    <TableCard
      title="BOQ items — Supply"
      description="With quantities indented or ordered"
      icon={PackageSearch}
      count={filteredItems.length}
      total={items.length}
      noun="item"
      className="max-sm:overflow-visible max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none"
      toolbar={
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search ERP SL No, BOQ SL No or description..."
          label="Search BOQ items"
          className="sm:max-w-xs"
        />
      }
    >
      <PmDataList
        rows={filteredItems}
        columns={columns}
        // The card above is the frame on a desktop.
        className="sm:rounded-none sm:border-0 sm:shadow-none"
        empty={
          <PmEmptyState
            icon={PackageSearch}
            title={items.length ? "No matching BOQ items." : "No Scope 2 = Supply BOQ items found for this project."}
          />
        }
      />
    </TableCard>
  );
}
