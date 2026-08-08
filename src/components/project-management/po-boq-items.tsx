"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">BOQ Items — Supply</CardTitle>
        <CardDescription>Scope 2 = Supply BOQ items, with quantities already indented or ordered.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search ERP SL No, BOQ SL No or description..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-[70vh] overflow-auto rounded-lg border">
          <Table>
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
