"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  ListPlus,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { YES_NO_OPTIONS } from "@/lib/project-management-boq-columns";

const BOQ_PERMISSION = "Project Management.BOQ";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId?: string;
  globalProjectName?: string;
};

type StickyForm = {
  projectName: string;
  subDivision: string;
  site: string;
  scope1: string;
  scope2: string;
  category1: string;
  category2: string;
  category3: string;
};

type LineForm = {
  erpSlNo: string;
  boqSlNo: string;
  description: string;
  unit: string;
  qty: string;
  unitRate: string;
  totalAmount: string;
  budgetPrice: string;
  fiPercentage: string;
  startDate: string;
  endDate: string;
  mdl: string;
};

type StagedRow = Record<string, string | number> & {
  __key: string;
  "BOQ SL No": string;
  Description: string;
  Unit: string;
  QTY: number;
  "Total Amount": number;
  "Budget Price": number;
  "F&I Price": number;
  "Total Budget Price": number;
  MDL: string;
};

const emptySticky = (): StickyForm => ({
  projectName: "",
  subDivision: "",
  site: "",
  scope1: "",
  scope2: "",
  category1: "",
  category2: "",
  category3: "",
});

const emptyLine = (): LineForm => ({
  erpSlNo: "",
  boqSlNo: "",
  description: "",
  unit: "",
  qty: "",
  unitRate: "",
  totalAmount: "",
  budgetPrice: "",
  fiPercentage: "",
  startDate: "",
  endDate: "",
  mdl: "No",
});

const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const compositeKey = (scope1: string, scope2: string, boqSlNo: string) =>
  `${scope1.trim().toLowerCase()}__${scope2.trim().toLowerCase()}__${boqSlNo.trim().toLowerCase()}`;

const formatQuantity = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

export default function AddBoqItemsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canAdd = can("Add Manual", BOQ_PERMISSION);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(Boolean(mappingId));
  const [isSaving, setIsSaving] = useState(false);

  const [sticky, setSticky] = useState<StickyForm>(emptySticky());
  const [line, setLine] = useState<LineForm>(emptyLine());
  const [rows, setRows] = useState<StagedRow[]>([]);

  useEffect(() => {
    if (isAuthLoading || !canAdd || !mappingId) {
      setIsLoading(false);
      return;
    }

    const load = async () => {
      setIsLoading(true);
      try {
        const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
        if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
        const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
        if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");

        const globalSnapshot = await getDoc(doc(db, "projects", mappingData.globalProjectId));
        const globalProjectName =
          (globalSnapshot.data()?.projectName as string | undefined) ?? mappingData.globalProjectName;
        if (!globalProjectName) throw new Error("Mapped global project not found");

        const itemsSnapshot = await getDocs(
          collection(db, "projects", mappingData.globalProjectId, "boqItems"),
        );
        const keys = new Set(
          itemsSnapshot.docs.map((itemDoc) => {
            const data = itemDoc.data() as Record<string, unknown>;
            return compositeKey(
              String(data["Scope 1"] ?? ""),
              String(data["Scope 2"] ?? ""),
              String(data["BOQ SL No"] ?? data["SL. No."] ?? ""),
            );
          }),
        );

        setMapping({ ...mappingData, globalProjectName });
        setExistingKeys(keys);
        setSticky((current) => ({ ...current, projectName: globalProjectName }));
      } catch (error) {
        console.error("Failed to load project for manual BOQ entry:", error);
        toast({
          title: "Unable to load project",
          description: error instanceof Error ? error.message : "The mapped project could not be loaded.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [canAdd, isAuthLoading, mappingId, toast]);

  const stagedKeys = useMemo(
    () =>
      new Set(
        rows.map((row) =>
          compositeKey(String(row["Scope 1"] ?? ""), String(row["Scope 2"] ?? ""), row["BOQ SL No"]),
        ),
      ),
    [rows],
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          qty: acc.qty + toNumber(row.QTY),
          amount: acc.amount + toNumber(row["Total Amount"]),
          budget: acc.budget + toNumber(row["Total Budget Price"]),
        }),
        { qty: 0, amount: 0, budget: 0 },
      ),
    [rows],
  );

  const handleAddRow = () => {
    const description = line.description.trim();
    const unit = line.unit.trim();
    const boqSlNo = line.boqSlNo.trim();
    const qty = toNumber(line.qty);

    if (!boqSlNo || !description || !unit) {
      toast({
        title: "Missing required fields",
        description: "BOQ SL No, Description, and Unit are required.",
        variant: "destructive",
      });
      return;
    }
    if (qty <= 0) {
      toast({ title: "Enter a valid quantity", variant: "destructive" });
      return;
    }
    if (line.startDate && line.endDate && line.endDate < line.startDate) {
      toast({
        title: "Invalid item timeline",
        description: "End date cannot be before start date.",
        variant: "destructive",
      });
      return;
    }

    const key = compositeKey(sticky.scope1, sticky.scope2, boqSlNo);
    if (existingKeys.has(key) || stagedKeys.has(key)) {
      toast({
        title: "Duplicate BOQ SL No",
        description: "This Scope 1 + Scope 2 + BOQ SL No combination already exists.",
        variant: "destructive",
      });
      return;
    }

    const unitRate = toNumber(line.unitRate);
    const totalAmount = line.totalAmount.trim()
      ? toNumber(line.totalAmount)
      : Math.round(qty * unitRate * 100) / 100;
    const budgetPrice = toNumber(line.budgetPrice);
    const fiPercentage = toNumber(line.fiPercentage);
    const fiPrice = Math.round(((budgetPrice * fiPercentage) / 100) * 100) / 100;
    const totalBudgetPrice = Math.round(budgetPrice * qty * 100) / 100;

    const row: StagedRow = {
      __key: key,
      "Project Name": sticky.projectName,
      "Sub-Division": sticky.subDivision,
      Site: sticky.site,
      "Scope 1": sticky.scope1,
      "Scope 2": sticky.scope2,
      "Category 1": sticky.category1,
      "Category 2": sticky.category2,
      "Category 3": sticky.category3,
      "ERP SL NO": line.erpSlNo,
      "BOQ SL No": boqSlNo,
      Description: description,
      Unit: unit,
      QTY: qty,
      "Unit Rate": unitRate,
      "Total Amount": totalAmount,
      "Budget Price": budgetPrice,
      "F&I %": fiPercentage,
      "F&I Price": fiPrice,
      "Total Budget Price": totalBudgetPrice,
      "Start Date": line.startDate,
      "End Date": line.endDate,
      MDL: line.mdl,
    };

    setRows((current) => [...current, row]);
    setLine(emptyLine());
  };

  const handleRemoveRow = (key: string) => {
    setRows((current) => current.filter((row) => row.__key !== key));
  };

  const handleSaveAll = async () => {
    if (!mapping?.globalProjectId || !rows.length || !user) return;
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const collectionRef = collection(db, "projects", mapping.globalProjectId, "boqItems");
      rows.forEach((row) => {
        const { __key, ...payload } = row;
        batch.set(doc(collectionRef), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: user.id,
          source: "manual_entry",
        });
      });
      await batch.commit();
      toast({ title: `${rows.length} BOQ item${rows.length === 1 ? "" : "s"} added` });
      setRows([]);
      setExistingKeys((current) => {
        const next = new Set(current);
        rows.forEach((row) => next.add(row.__key));
        return next;
      });
    } catch (error) {
      console.error("Failed to save manual BOQ items:", error);
      toast({ title: "Unable to save BOQ items", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (!canAdd) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Add BOQ Items</h1>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to manually add BOQ items.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!mappingId || !mapping) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Select a project first</CardTitle>
            <CardDescription>
              Return to Project Management and select a mapped project before adding BOQ items.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/project-management/boq?project=${encodeURIComponent(mappingId)}`} aria-label="Back to BOQ">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm">
          <ListPlus className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Add BOQ Items</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add one or more BOQ line items to {mapping.globalProjectName} at once.
          </p>
        </div>
      </div>

      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-indigo-600" />
        <CardHeader>
          <CardTitle className="text-base">Item Details</CardTitle>
          <CardDescription>
            Scope and category apply to every row you add below. Change them any time before adding
            the next item.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="sub-division">Sub-Division</Label>
              <Input id="sub-division" value={sticky.subDivision} onChange={(e) => setSticky((c) => ({ ...c, subDivision: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site">Site</Label>
              <Input id="site" value={sticky.site} onChange={(e) => setSticky((c) => ({ ...c, site: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scope-1">Scope 1</Label>
              <Input id="scope-1" value={sticky.scope1} onChange={(e) => setSticky((c) => ({ ...c, scope1: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scope-2">Scope 2</Label>
              <Input id="scope-2" value={sticky.scope2} onChange={(e) => setSticky((c) => ({ ...c, scope2: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category-1">Category 1</Label>
              <Input id="category-1" value={sticky.category1} onChange={(e) => setSticky((c) => ({ ...c, category1: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category-2">Category 2</Label>
              <Input id="category-2" value={sticky.category2} onChange={(e) => setSticky((c) => ({ ...c, category2: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category-3">Category 3</Label>
              <Input id="category-3" value={sticky.category3} onChange={(e) => setSticky((c) => ({ ...c, category3: e.target.value }))} />
            </div>
          </div>

          <div className="h-px bg-border" />

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="erp-sl-no">ERP SL NO</Label>
              <Input id="erp-sl-no" value={line.erpSlNo} onChange={(e) => setLine((c) => ({ ...c, erpSlNo: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="boq-sl-no">BOQ SL No <span className="text-destructive">*</span></Label>
              <Input id="boq-sl-no" value={line.boqSlNo} onChange={(e) => setLine((c) => ({ ...c, boqSlNo: e.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
              <Input id="description" value={line.description} onChange={(e) => setLine((c) => ({ ...c, description: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit">Unit <span className="text-destructive">*</span></Label>
              <Input id="unit" value={line.unit} onChange={(e) => setLine((c) => ({ ...c, unit: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qty">QTY <span className="text-destructive">*</span></Label>
              <Input id="qty" type="number" step="0.001" min="0" value={line.qty} onChange={(e) => setLine((c) => ({ ...c, qty: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit-rate">Unit Rate</Label>
              <Input id="unit-rate" type="number" step="0.01" min="0" value={line.unitRate} onChange={(e) => setLine((c) => ({ ...c, unitRate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="total-amount">Total Amount</Label>
              <Input id="total-amount" type="number" step="0.01" min="0" placeholder="Auto: QTY × Rate" value={line.totalAmount} onChange={(e) => setLine((c) => ({ ...c, totalAmount: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="budget-price">Budget Price</Label>
              <Input id="budget-price" type="number" step="0.01" min="0" value={line.budgetPrice} onChange={(e) => setLine((c) => ({ ...c, budgetPrice: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fi-percentage">F&amp;I %</Label>
              <Input id="fi-percentage" type="number" step="0.01" min="0" max="100" value={line.fiPercentage} onChange={(e) => setLine((c) => ({ ...c, fiPercentage: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="start-date">Start Date</Label>
              <Input id="start-date" type="date" value={line.startDate} max={line.endDate || undefined} onChange={(e) => setLine((c) => ({ ...c, startDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end-date">End Date</Label>
              <Input id="end-date" type="date" value={line.endDate} min={line.startDate || undefined} onChange={(e) => setLine((c) => ({ ...c, endDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mdl">MDL <span className="font-normal text-muted-foreground">(Master Drawing List)</span></Label>
              <Select value={line.mdl} onValueChange={(mdl) => setLine((c) => ({ ...c, mdl }))}>
                <SelectTrigger id="mdl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {YES_NO_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleAddRow}>
            <Plus className="mr-2 h-4 w-4" /> Add to List
          </Button>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card className="overflow-hidden border-border/60">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Items to Save ({rows.length})</CardTitle>
              <CardDescription>Review the staged items, then save them all at once.</CardDescription>
            </div>
            <Button onClick={() => void handleSaveAll()} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save {rows.length} Item{rows.length === 1 ? "" : "s"}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>BOQ SL No</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Unit Rate</TableHead>
                    <TableHead>Total Amount</TableHead>
                    <TableHead>Budget Price</TableHead>
                    <TableHead>Total Budget Price</TableHead>
                    <TableHead>MDL</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.__key}>
                      <TableCell>{row["BOQ SL No"]}</TableCell>
                      <TableCell className="max-w-xs truncate" title={row.Description}>{row.Description}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatQuantity(toNumber(row.QTY))} {row.Unit}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatCurrency(toNumber(row["Unit Rate"]))}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{formatCurrency(toNumber(row["Total Amount"]))}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatCurrency(toNumber(row["Budget Price"]))}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatCurrency(toNumber(row["Total Budget Price"]))}</TableCell>
                      <TableCell>{row.MDL || "—"}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleRemoveRow(row.__key)} aria-label={`Remove ${row.Description}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-end gap-6 border-t bg-muted/30 px-4 py-2 text-sm">
                <span className="text-muted-foreground">Total Qty: <span className="font-medium text-foreground">{formatQuantity(totals.qty)}</span></span>
                <span className="text-muted-foreground">Total Amount: <span className="font-medium text-foreground">{formatCurrency(totals.amount)}</span></span>
                <span className="text-muted-foreground">Total Budget Price: <span className="font-semibold text-foreground">{formatCurrency(totals.budget)}</span></span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
