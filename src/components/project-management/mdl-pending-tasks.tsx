"use client";

import { useMemo } from "react";
import { ClipboardCheck, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  formatMdlDate,
  isMdlOverdue,
  mdlOverallStatusStyles,
  type MdlOverallStatus,
  type MdlRow,
} from "@/lib/mdl";

export type PoPlacement = {
  poNumbers: string[];
  vendorNames: string[];
  latestPoDate: string;
};

const APPROVED_STATUSES: MdlOverallStatus[] = ["Approved", "Approved with Comments"];

// A drawing becomes a "pending task" once a purchase order has actually been placed for its
// BOQ item — that's the point procurement is committed and the drawing needs to be ready —
// and it hasn't reached an approved state yet.
export default function MdlPendingTasks({
  rows,
  poInfoByBoqItemId,
  onSelectItem,
}: {
  rows: MdlRow[];
  poInfoByBoqItemId: Map<string, PoPlacement>;
  onSelectItem: (boqItemId: string) => void;
}) {
  const pendingRows = useMemo(() => {
    return rows
      .filter((row) => poInfoByBoqItemId.has(row.item.id) && !APPROVED_STATUSES.includes(row.drawing?.status ?? "Pending"))
      .map((row) => ({ ...row, po: poInfoByBoqItemId.get(row.item.id)! }))
      .sort((a, b) => {
        const aOverdue = isMdlOverdue(a.drawing);
        const bOverdue = isMdlOverdue(b.drawing);
        if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
        return (b.po.latestPoDate || "").localeCompare(a.po.latestPoDate || "");
      });
  }, [rows, poInfoByBoqItemId]);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListTodo className="h-4 w-4" /> Pending Tasks
        </CardTitle>
        <CardDescription>
          Drawings that still need action even though a purchase order has already been placed for that item.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {pendingRows.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Item</TableHead>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>PO Date</TableHead>
                  <TableHead>Planned End</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRows.map(({ item, drawing, po }) => {
                  const overdue = isMdlOverdue(drawing);
                  return (
                    <TableRow key={item.id} className="cursor-pointer" onClick={() => onSelectItem(item.id)}>
                      <TableCell className="max-w-xs truncate" title={String(item.Description ?? "")}>
                        {String(item.Description ?? "—")}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{po.poNumbers.join(", ")}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{po.vendorNames.join(", ")}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatMdlDate(po.latestPoDate)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className={overdue ? "font-medium text-red-600" : ""}>{formatMdlDate(drawing?.plannedEndDate)}</span>
                        {overdue && (
                          <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                            Overdue
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", mdlOverallStatusStyles[drawing?.status ?? "Pending"])}>
                          {drawing?.status ?? "Pending"}
                        </span>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" onClick={() => onSelectItem(item.id)}>
                          Update
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <ClipboardCheck className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nothing pending — every MDL item with a placed purchase order already has an approved drawing.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
