"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PO_COLLECTION, formatCurrency, formatQuantity, toNumber, type PurchaseOrder } from "@/lib/purchase-orders";

const formatDateSafe = (value?: string) => {
  if (!value) return "N/A";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const PrintableStyles = () => (
  <style>{`
    @media print {
      @page { size: A4 portrait; margin: 0; }
      html, body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        margin: 0;
        padding: 0;
        background: #fff !important;
      }
      #printable-sheet { padding: 10mm; width: 210mm; box-sizing: border-box; }
      table { width: 100%; border-collapse: collapse; border: 1px solid #000; page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
      th, td { border: 1px solid #000; padding: 2px 4px; vertical-align: top; font-size: 9pt; }
      th { font-weight: bold; text-align: center; }
      .no-print { display: none !important; }
      .signatures { page-break-inside: avoid; }
    }
  `}</style>
);

export default function PrintPurchaseOrderPage() {
  const { poId } = useParams() as { poId: string };
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [projectName, setProjectName] = useState("");
  const [budgetPriceByBoqItemId, setBudgetPriceByBoqItemId] = useState<Map<string, number>>(new Map());
  const [boqSlNoByBoqItemId, setBoqSlNoByBoqItemId] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      if (!mappingId || !poId) {
        setIsLoading(false);
        setError("Missing project or purchase order.");
        return;
      }
      setIsLoading(true);
      try {
        const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
        if (!mappingSnapshot.exists()) throw new Error("Project mapping not found.");
        const mapping = mappingSnapshot.data() as {
          globalProjectId?: string;
          globalProjectName?: string;
          projectName?: string;
        };
        if (!mapping.globalProjectId) throw new Error("Global project is not mapped.");

        const [poSnapshot, projectSnapshot, boqSnapshot] = await Promise.all([
          getDoc(doc(db, "projects", mapping.globalProjectId, PO_COLLECTION, poId)),
          getDoc(doc(db, "projects", mapping.globalProjectId)),
          getDocs(collection(db, "projects", mapping.globalProjectId, "boqItems")),
        ]);
        if (!poSnapshot.exists()) throw new Error("Purchase order not found.");

        setPo({ id: poSnapshot.id, ...poSnapshot.data() } as PurchaseOrder);
        setProjectName(
          (projectSnapshot.data()?.projectName as string | undefined) ?? mapping.globalProjectName ?? mapping.projectName ?? "",
        );
        setBudgetPriceByBoqItemId(
          new Map(
            boqSnapshot.docs.map((d) => [d.id, toNumber((d.data() as Record<string, unknown>)["Budget Price"])]),
          ),
        );
        setBoqSlNoByBoqItemId(
          new Map(
            boqSnapshot.docs.map((d) => [d.id, String((d.data() as Record<string, unknown>)["BOQ SL No"] ?? "")]),
          ),
        );
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : "Failed to load purchase order.");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [mappingId, poId]);

  useEffect(() => {
    if (!isLoading && po) {
      const id = setTimeout(() => {
        if (typeof window !== "undefined") window.print();
      }, 500);
      return () => clearTimeout(id);
    }
  }, [isLoading, po]);

  if (isLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-[80vh]" />
      </div>
    );
  }

  if (error || !po) {
    return <div className="p-8">{error || "Purchase order not found."}</div>;
  }

  const totalBudgetPrice = (po.items ?? []).reduce((sum, item) => {
    const budgetPrice = item.boqItemId ? budgetPriceByBoqItemId.get(item.boqItemId) ?? 0 : 0;
    return sum + budgetPrice * item.qty;
  }, 0);
  const variance = totalBudgetPrice - po.totalAmount;

  return (
    <>
      <PrintableStyles />
      <div className="bg-white">
        <div id="printable-sheet">
          <div className="text-center">
            <h1 className="text-lg font-extrabold">PURCHASE ORDER</h1>
          </div>

          <div className="mb-2 mt-4 space-y-1 border border-black p-2 text-[9pt]">
            <div className="flex justify-between">
              <span><strong>PO Number:</strong> {po.poNumber}</span>
              <span><strong>PO Date:</strong> {formatDateSafe(po.poDate)}</span>
            </div>
            <p><strong>Project:</strong> {projectName || "N/A"}</p>
            <p><strong>Vendor:</strong> {po.vendorName}{po.vendorCode ? ` (${po.vendorCode})` : ""}</p>
            <div className="flex justify-between">
              <span><strong>Delivery Start:</strong> {formatDateSafe(po.startDate)}</span>
              <span><strong>Delivery End:</strong> {formatDateSafe(po.endDate)}</span>
            </div>
          </div>

          <div className="overflow-x-auto border border-black">
            <Table className="w-full table-auto text-[8pt]">
              <TableHeader>
                <TableRow>
                  <TableHead className="border-black text-center">Sl. No.</TableHead>
                  <TableHead className="border-black text-center">BOQ SL No</TableHead>
                  <TableHead className="border-black text-center">Description</TableHead>
                  <TableHead className="border-black text-center">Unit</TableHead>
                  <TableHead className="border-black text-center">Qty</TableHead>
                  <TableHead className="border-black text-center">Rate</TableHead>
                  <TableHead className="border-black text-center">Amount</TableHead>
                  <TableHead className="border-black text-center">Budget Price</TableHead>
                  <TableHead className="border-black text-center">Total Budget Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(po.items ?? []).map((item, index) => {
                  const budgetPrice = item.boqItemId ? budgetPriceByBoqItemId.get(item.boqItemId) ?? 0 : 0;
                  const boqSlNo = item.boqItemId ? boqSlNoByBoqItemId.get(item.boqItemId) : "";
                  return (
                    <TableRow key={index}>
                      <TableCell className="text-center border-black">{index + 1}</TableCell>
                      <TableCell className="text-center border-black">{boqSlNo || "—"}</TableCell>
                      <TableCell className="border-black">{item.description}</TableCell>
                      <TableCell className="text-center border-black">{item.unit || "—"}</TableCell>
                      <TableCell className="text-right border-black">{formatQuantity(item.qty)}</TableCell>
                      <TableCell className="text-right border-black">{formatCurrency(item.rate)}</TableCell>
                      <TableCell className="text-right border-black">{formatCurrency(item.amount)}</TableCell>
                      <TableCell className="text-right border-black">{formatCurrency(budgetPrice)}</TableCell>
                      <TableCell className="text-right border-black">{formatCurrency(budgetPrice * item.qty)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="mt-2 flex justify-end">
            <div className="w-1/2 text-[9pt]">
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-bold">Total Amount</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(po.totalAmount)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Total Budget Price</TableCell>
                    <TableCell className="text-right">{formatCurrency(totalBudgetPrice)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className={variance >= 0 ? "text-emerald-700" : "text-red-600"}>
                      {variance >= 0 ? "Savings" : "Overrun"}
                    </TableCell>
                    <TableCell className={`text-right ${variance >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {formatCurrency(Math.abs(variance))}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          {po.terms && (
            <div className="mt-2 border border-black p-2 text-[9pt]">
              <strong>Terms / Remarks:</strong> {po.terms}
            </div>
          )}

          <div className="signatures mt-16 flex justify-between px-4 text-[9pt]">
            <div className="w-1/3 text-center"><p className="mt-8 border-t border-black pt-1">Prepared By</p></div>
            <div className="w-1/3 text-center"><p className="mt-8 border-t border-black pt-1">Checked By</p></div>
            <div className="w-1/3 text-center"><p className="mt-8 border-t border-black pt-1">Approved By</p></div>
          </div>
        </div>
      </div>
    </>
  );
}
