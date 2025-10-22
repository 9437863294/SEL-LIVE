
"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, Plus, Trash2, Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { collection, addDoc, getDocs } from "firebase/firestore";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BoqItem, BillItem } from "@/lib/types";
import { BoqItemSelector } from "@/components/BoqItemSelector";
import { BoqMultiSelectDialog } from "@/components/BoqMultiSelectDialog";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { logUserActivity } from "@/lib/activity-logger";

// ---------------------- Types ----------------------
type JmcDetails = {
  jmcNo: string;
  woNo: string;
  jmcDate: string; // yyyy-mm-dd
};

type JmcItem = {
  boqSlNo: string;
  description: string;
  unit: string;
  boqQty: number;
  rate: number;
  executedQty: number;
  totalAmount: number;
};

// ---------------------- Constants ----------------------
const initialJmcDetails: JmcDetails = {
  jmcNo: "",
  woNo: "",
  jmcDate: new Date().toISOString().split("T")[0],
};

const initialItem: JmcItem = {
  boqSlNo: "",
  description: "",
  unit: "",
  boqQty: 0,
  rate: 0,
  executedQty: 0,
  totalAmount: 0,
};

export default function JmcEntryPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { project: projectSlug } = useParams() as { project: string };

  const [details, setDetails] = useState<JmcDetails>(initialJmcDetails);
  const [items, setItems] = useState<JmcItem[]>([initialItem]);

  const [isSaving, setIsSaving] = useState(false);

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isBoqLoading, setIsBoqLoading] = useState(true);
  const [isBoqMultiSelectOpen, setIsBoqMultiSelectOpen] = useState(false);

  // ---------------------- Effects ----------------------
  useEffect(() => {
    const fetchBoqItems = async () => {
      if (!projectSlug) return;
      setIsBoqLoading(true);
      try {
        const boqSnapshot = await getDocs(collection(db, "projects", projectSlug, "boqItems"));
        const boqData = boqSnapshot.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              ...data,
              id: d.id,
              ["SL. No."]: String((data as any)["SL. No."] ?? ""),
            } as BoqItem;
          })
          .sort((a, b) => {
            const slNoA = parseFloat((a as any)["SL. No."]);
            const slNoB = parseFloat((b as any)["SL. No."]);
            if (Number.isNaN(slNoA) || Number.isNaN(slNoB)) return 0;
            return slNoA - slNoB;
          });

        setBoqItems(boqData);
      } catch (error) {
        console.error("Error fetching BOQ items:", error);
        toast({
          title: "Error",
          description: "Could not fetch BOQ items for this project.",
          variant: "destructive",
        });
      } finally {
        setIsBoqLoading(false);
      }
    };

    fetchBoqItems();
  }, [projectSlug, toast]);

  // ---------------------- Helpers ----------------------
  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails((prev) => ({ ...prev, [name]: value }));
  };

  // generic price-key finder (works for BoqItem or BillItem)
  const findBasicPriceKey = (row: Record<string, unknown>): string | undefined => {
    const knownPriceKeys = ["UNIT PRICE", "Unit Rate", "Rate"];
    for (const key of knownPriceKeys) {
      if (Object.prototype.hasOwnProperty.call(row, key)) return key;
    }
    return Object.keys(row).find((k) => k.toLowerCase().includes("rate") && !k.toLowerCase().includes("total"));
  };

  // parse numbers from string/number (handles commas/spaces)
  const parseNum = (v: unknown): number => {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "string") {
      const n = Number(v.replace(/[, ]/g, ""));
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };

  const recalcRow = (row: JmcItem): JmcItem => {
    const qty = typeof row.executedQty === "number" ? row.executedQty : Number(row.executedQty ?? 0);
    const rate = typeof row.rate === "number" ? row.rate : Number(row.rate ?? 0);
    const total = !Number.isFinite(qty * rate) ? 0 : qty * rate;
    return { ...row, totalAmount: total };
  };

  const handleItemQtyChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const next = [...items];
    const qty = Number.isNaN(e.target.valueAsNumber) ? 0 : e.target.valueAsNumber;
    next[index] = recalcRow({ ...next[index], executedQty: qty });
    setItems(next);
  };

  const handleBoqSelect = (index: number, boqItem: BoqItem | null) => {
    const next = [...items];

    if (boqItem) {
      const anyRow = boqItem as unknown as Record<string, unknown>;

      const boqSlNo =
        ((anyRow["SL. No."] as string) ?? (anyRow["BOQ SL No"] as string) ?? "") as string;

      const boqQtyKey = Object.keys(anyRow).find((k) => k.toLowerCase().includes("qty")) || "QTY";
      const boqQty = parseNum(anyRow[boqQtyKey]);

      const rateKey = findBasicPriceKey(anyRow);
      const rate = parseNum(rateKey ? anyRow[rateKey] : 0);

      const updated: JmcItem = recalcRow({
        ...next[index],
        boqSlNo,
        description: ((anyRow["Description"] as string) ?? "") as string,
        unit: ((anyRow["Unit"] as string) ?? "") as string,
        boqQty,
        rate: Number.isFinite(rate) ? rate : 0,
      });

      next[index] = updated;
    } else {
      next[index] = { ...initialItem };
    }

    setItems(next);
  };
  
  const handleMultiBoqSelect = (selectedBoqItems: BoqItem[]) => {
    const mapped: JmcItem[] = selectedBoqItems.map((row) => {
      const anyRow = row as unknown as Record<string, unknown>;

      const rateKey = findBasicPriceKey(anyRow);
      const rate = parseNum(rateKey ? anyRow[rateKey] : 0);

      const boqQtyKey = Object.keys(anyRow).find((k) => k.toLowerCase().includes("qty")) || "QTY";
      const boqQty = parseNum(anyRow[boqQtyKey]);

      const boqSlNo = (anyRow["SL. No."] as string) ?? (anyRow["BOQ SL No"] as string) ?? "";

      const description = (anyRow["Description"] as string) ?? "";
      const unit = (anyRow["Unit"] as string) ?? "";

      return recalcRow({
        boqSlNo,
        description,
        unit,
        boqQty,
        rate: Number.isFinite(rate) ? rate : 0,
        executedQty: 0,
        totalAmount: 0,
      });
    });

    const base = items.length === 1 && !items[0].boqSlNo ? [] : items;
    setItems([...base, ...mapped]);
  };

  const addItem = () => setItems((prev) => [...prev, { ...initialItem }]);

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems((prev) => prev.filter((_, i) => i !== index));
    } else {
      setItems([{ ...initialItem }]);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);

  const grandTotal = useMemo(
    () => items.reduce((acc, it) => acc + (Number.isFinite(it.totalAmount) ? it.totalAmount : 0), 0),
    [items]
  );

  const hasMissingFields =
    !details.jmcNo.trim() || !details.woNo.trim() || items.some((it) => !it.boqSlNo.trim());

  // ---------------------- Save ----------------------
  const handleSave = async () => {
    if (!user) {
      toast({
        title: "Authentication Error",
        description: "You must be logged in.",
        variant: "destructive",
      });
      return;
    }

    if (hasMissingFields) {
      toast({
        title: "Missing Required Fields",
        description: "Please fill JMC No, WO No, and ensure all items have a BOQ Sl. No.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);

    try {
      const cleanedItems = items.map(recalcRow);

      const payload = {
        ...details,
        items: cleanedItems,
        grandTotal,
        createdAt: new Date().toISOString(),
      };

      await addDoc(collection(db, "projects", projectSlug, "jmcEntries"), payload);

      await logUserActivity({
        userId: (user as any).id ?? (user as any).uid ?? "unknown",
        action: "Create JMC Entry",
        details: {
          project: projectSlug,
          jmcNo: details.jmcNo,
          workOrderNo: details.woNo,
          itemCount: cleanedItems.length,
          grandTotal,
        },
      });

      toast({
        title: "JMC Entry Created",
        description: "The new JMC entry has been successfully saved.",
      });

      setDetails(initialJmcDetails);
      setItems([initialItem]);
    } catch (error) {
      console.error("Error creating JMC entry: ", error);
      toast({
        title: "Save Failed",
        description: "An error occurred while saving the JMC entry.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // ---------------------- Render ----------------------
  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/jmc`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Create JMC Entry</h1>
          </div>

          <Button onClick={handleSave} disabled={isSaving || hasMissingFields}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Entry
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>JMC Details</CardTitle>
            <CardDescription>Provide the main details for this Joint Measurement Certificate.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="jmcNo">JMC No</Label>
                <Input id="jmcNo" name="jmcNo" value={details.jmcNo} onChange={handleDetailChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="woNo">WO No</Label>
                <Input id="woNo" name="woNo" value={details.woNo} onChange={handleDetailChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="jmcDate">JMC Date</Label>
                <Input id="jmcDate" name="jmcDate" type="date" value={details.jmcDate} onChange={handleDetailChange} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>JMC Items</CardTitle>
                <CardDescription>Add one or more items executed under this JMC.</CardDescription>
              </div>
              <Button variant="outline" onClick={() => setIsBoqMultiSelectOpen(true)} disabled={isBoqLoading}>
                <Library className="mr-2 h-4 w-4" /> Add Items from BOQ
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto rounded-md border">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[240px] sticky top-0 bg-background z-10">BOQ Sl. No.</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10">Description</TableHead>
                    <TableHead className="w-[110px] sticky top-0 bg-background z-10">Unit</TableHead>
                    <TableHead className="w-[110px] sticky top-0 bg-background z-10">BOQ Qty</TableHead>
                    <TableHead className="w-[130px] sticky top-0 bg-background z-10">Rate</TableHead>
                    <TableHead className="w-[150px] sticky top-0 bg-background z-10">Executed Qty</TableHead>
                    <TableHead className="w-[160px] sticky top-0 bg-background z-10">Total Amount</TableHead>
                    <TableHead className="w-[60px] sticky top-0 bg-background z-10">Action</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={`${item.boqSlNo || "row"}-${index}`}>
                      <TableCell>
                        <BoqItemSelector
                          boqItems={boqItems}
                          selectedSlNo={item.boqSlNo}
                          onSelect={(boqItem) => handleBoqSelect(index, boqItem)}
                          isLoading={isBoqLoading}
                        />
                      </TableCell>

                      <TableCell className="align-top">{item.description}</TableCell>
                      <TableCell className="align-top">{item.unit}</TableCell>
                      <TableCell className="align-top">{item.boqQty}</TableCell>
                      <TableCell className="align-top">{formatCurrency(item.rate)}</TableCell>

                      <TableCell className="align-top">
                        <Input
                          inputMode="decimal"
                          name="executedQty"
                          value={Number.isFinite(item.executedQty) ? item.executedQty : 0}
                          onChange={(e) => handleItemQtyChange(index, e)}
                          type="number"
                          step="any"
                          min={0}
                        />
                      </TableCell>

                      <TableCell className="align-top font-medium">{formatCurrency(item.totalAmount)}</TableCell>

                      <TableCell className="align-top">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(index)}
                          aria-label="Remove item"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between items-center mt-4">
              <Button variant="outline" onClick={addItem} className="mt-4">
                <Plus className="mr-2 h-4 w-4" /> Add Item
              </Button>
              <div className="text-right">
                <p className="text-muted-foreground">Grand Total</p>
                <p className="text-xl font-bold">{formatCurrency(grandTotal)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <BoqMultiSelectDialog
        isOpen={isBoqMultiSelectOpen}
        onOpenChange={setIsBoqMultiSelectOpen}
        boqItems={boqItems}
        onConfirm={handleMultiBoqSelect}
      />
    </>
  );
}

    
