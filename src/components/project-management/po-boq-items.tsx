"use client";

import { useMemo, useState } from "react";
import { PackageSearch, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  return (
    <Card className="overflow-hidden border-border/60">
      {/* The sidebar already names this view, so the title and its search sit on one bar rather
          than a CardHeader stacked above a separate search row. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <PackageSearch className="h-3.5 w-3.5 shrink-0 text-cyan-600" />
          <span className="font-medium text-foreground">BOQ items — Supply</span>
          · {filteredItems.length} item{filteredItems.length === 1 ? "" : "s"} with quantities indented or ordered
        </p>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search ERP SL No, BOQ SL No or description..."
            aria-label="Search BOQ items"
            className="h-7 pl-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <CardContent className="p-0">
        <div className="max-h-[70vh] overflow-auto">
          <Table className="[&_th]:h-8 [&_th]:whitespace-nowrap [&_th]:px-2 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1">
            <TableHeader>
              <TableRow>
                <TableHead>ERP SL No</TableHead>
                <TableHead>BOQ SL No</TableHead>
                <TableHead className="min-w-[220px]">Description</TableHead>
                <TableHead>Units</TableHead>
                <TableHead>QTY</TableHead>
                <TableHead>Unit Rate</TableHead>
                <TableHead>Budget Price</TableHead>
                <TableHead>Total Budget Price</TableHead>
                <TableHead>Total Amount</TableHead>
                <TableHead>Indent Qty</TableHead>
                <TableHead>PO Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.length ? (
                filteredItems.map((item) => {
                  const qty = toNumber(item.QTY);
                  const rate = toNumber(item["Unit Rate"]);
                  const budgetPrice = toNumber(item["Budget Price"]);
                  const totalAmount = toNumber(item["Total Amount"]) || qty * rate;
                  const totalBudgetPrice = qty * budgetPrice;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{String(item["ERP SL NO"] ?? "—")}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{String(item["BOQ SL No"] ?? "—")}</TableCell>
                      <TableCell className="max-w-xs truncate" title={String(item.Description ?? "")}>{String(item.Description ?? "—")}</TableCell>
                      <TableCell>{String(item.Unit ?? "—")}</TableCell>
                      <TableCell>{formatQuantity(qty)}</TableCell>
                      <TableCell>{formatCurrency(rate)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatCurrency(budgetPrice)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatCurrency(totalBudgetPrice)}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(totalAmount)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatQuantity(indentQtyByBoqItemId.get(item.id) ?? 0)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatQuantity(poQtyByBoqItemId.get(item.id) ?? 0)}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={11} className="h-24 text-center text-sm text-muted-foreground">
                    {items.length ? "No matching BOQ items." : "No Scope 2 = Supply BOQ items found for this project."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
