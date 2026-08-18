"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Library, ListChecks, Loader2, Plus, Save, ShieldAlert, Trash2 } from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { ControlledField } from "@/components/project-management/controlled-field";
import { useFieldControl, validateFieldControlRequirements } from "@/components/project-management/use-field-control";
import { DEFAULT_VARIATION_TOLERANCE_PCT, computeAvailableQty } from "@/lib/project-management-variations";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BoqItemSelector } from "@/components/billing-recon/BoqItemSelector";
import { BoqMultiSelectDialog } from "@/components/billing-recon/BoqMultiSelectDialog";
import type { BoqItem } from "@/lib/types";
import { indentReservesQuantity, type IndentLike } from "@/lib/project-management-indent-workflow";

const PERMISSION_RESOURCE = "Project Management.Indent";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

type IndentRow = {
  rowId: string;
  boqItemId: string;
  boqSlNo: string;
  description: string;
  unit: string;
  boqQty: number;
  budgetPrice: number;
  requestedQty: string;
};

const emptyRow = (): IndentRow => ({
  rowId: Math.random().toString(36).slice(2),
  boqItemId: "",
  boqSlNo: "",
  description: "",
  unit: "",
  boqQty: 0,
  budgetPrice: 0,
  requestedQty: "",
});

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const compositeKey = (scope1: string, scope2: string, boqSlNo: string) =>
  `${scope1.trim().toLowerCase()}__${scope2.trim().toLowerCase()}__${boqSlNo.trim().toLowerCase()}`;

const formatQuantity = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export default function NewIndentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const deepLinkBoqItemIds = useMemo(
    () => (searchParams?.get("boqItemIds") ?? "").split(",").map((id) => id.trim()).filter(Boolean),
    [searchParams],
  );
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canAdd = can("Add", PERMISSION_RESOURCE) || can("Import", "Project Management.BOQ");
  const { field: fieldControl } = useFieldControl("indentNew");

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [usedQtyByBoqItem, setUsedQtyByBoqItem] = useState<Map<string, number>>(new Map());
  const [variationTolerancePct, setVariationTolerancePct] = useState(DEFAULT_VARIATION_TOLERANCE_PCT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isMultiSelectOpen, setIsMultiSelectOpen] = useState(false);

  const [indentDate, setIndentDate] = useState(today());
  const [requiredDate, setRequiredDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [rows, setRows] = useState<IndentRow[]>([emptyRow()]);

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

        const [projectSnapshot, boqSnapshot, indentSnapshot, settingsSnapshot] = await Promise.all([
          getDoc(doc(db, "projects", mappingData.globalProjectId)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
          getDocs(collection(db, "projects", mappingData.globalProjectId, "indents")),
          getDoc(doc(db, "projectManagementSettings", "general")),
        ]);
        // Parent document optional: the name already falls back to the mapping, and everything else
        // this screen reads is in subcollections.
        const globalProjectName =
          (projectSnapshot.data()?.projectName as string | undefined) ?? mappingData.globalProjectName;

        setMapping({ ...mappingData, globalProjectName });
        const loadedBoqItems = boqSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as BoqItem);
        setBoqItems(loadedBoqItems);
        const storedTolerance = settingsSnapshot.data()?.variationTolerancePct;
        setVariationTolerancePct(typeof storedTolerance === "number" ? storedTolerance : DEFAULT_VARIATION_TOLERANCE_PCT);

        // Arriving from the Requirement Planner with ?boqItemIds= — pre-populate rows instead of
        // making the user re-pick what they just selected there.
        if (deepLinkBoqItemIds.length) {
          const matches = loadedBoqItems.filter((item) => deepLinkBoqItemIds.includes(item.id));
          if (matches.length) {
            setRows(
              matches.map((item) => ({
                rowId: Math.random().toString(36).slice(2),
                boqItemId: item.id,
                boqSlNo: String(item["BOQ SL No"] ?? item["SL. No."] ?? ""),
                description: String(item["Description"] ?? ""),
                unit: String(item["Unit"] ?? ""),
                boqQty: toNumber(item["QTY"]),
                budgetPrice: toNumber(item["Budget Price"]),
                requestedQty: "",
              })),
            );
          }
        }

        const used = new Map<string, number>();
        indentSnapshot.docs.forEach((indentDoc) => {
          const data = indentDoc.data() as IndentLike & { items?: any[] };
          // Available quantity is only consumed by indents that actually reserve — a draft
          // sitting in someone's review queue no longer blocks raising another.
          if (!indentReservesQuantity(data)) return;
          (Array.isArray(data.items) ? data.items : []).forEach((item) => {
            const id = String(item.boqItemId ?? "");
            if (!id) return;
            used.set(id, (used.get(id) ?? 0) + toNumber(item.requestedQty));
          });
        });
        setUsedQtyByBoqItem(used);
      } catch (error) {
        console.error("Failed to load project for indent creation:", error);
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
  }, [canAdd, isAuthLoading, mappingId, toast, deepLinkBoqItemIds]);

  const usedBoqItemIds = useMemo(
    () => new Set(rows.map((row) => row.boqItemId).filter(Boolean)),
    [rows],
  );

  // Approved variation orders raise a BOQ item's effective allowance above its stated quantity —
  // see project-management-variations.ts. Read directly off the already-loaded BOQ item docs.
  const variationApprovedQtyByBoqItem = useMemo(() => {
    const map = new Map<string, number>();
    boqItems.forEach((item) => map.set(item.id, toNumber(item.variationApprovedQty)));
    return map;
  }, [boqItems]);

  // A recorded survey (see project-management-survey.ts) reflects actual site reality and
  // supersedes the raw BOQ tender quantity as the base for availability, once one exists.
  const surveyedQtyByBoqItem = useMemo(() => {
    const map = new Map<string, number>();
    boqItems.forEach((item) => {
      if (typeof item.surveyedQty === "number") map.set(item.id, item.surveyedQty);
    });
    return map;
  }, [boqItems]);

  const availableFor = (boqItemId: string, boqQty: number) =>
    computeAvailableQty(
      surveyedQtyByBoqItem.get(boqItemId) ?? boqQty,
      variationTolerancePct,
      variationApprovedQtyByBoqItem.get(boqItemId) ?? 0,
      usedQtyByBoqItem.get(boqItemId) ?? 0,
    );

  const handleBoqSelect = (rowId: string, boqItem: BoqItem | null) => {
    setRows((current) =>
      current.map((row) => {
        if (row.rowId !== rowId) return row;
        if (!boqItem) return { ...emptyRow(), rowId };

        if (usedBoqItemIds.has(boqItem.id) && boqItem.id !== row.boqItemId) {
          toast({ title: "This BOQ item is already added to this indent.", variant: "destructive" });
          return row;
        }

        return {
          rowId,
          boqItemId: boqItem.id,
          boqSlNo: String(boqItem["BOQ SL No"] ?? boqItem["SL. No."] ?? ""),
          description: String(boqItem["Description"] ?? ""),
          unit: String(boqItem["Unit"] ?? ""),
          boqQty: toNumber(boqItem["QTY"]),
          budgetPrice: toNumber(boqItem["Budget Price"]),
          requestedQty: "",
        };
      }),
    );
  };

  const handleMultiBoqSelect = (selected: BoqItem[]) => {
    const newRows: IndentRow[] = selected
      .filter((item) => !usedBoqItemIds.has(item.id))
      .map((item) => ({
        rowId: Math.random().toString(36).slice(2),
        boqItemId: item.id,
        boqSlNo: String(item["BOQ SL No"] ?? item["SL. No."] ?? ""),
        description: String(item["Description"] ?? ""),
        unit: String(item["Unit"] ?? ""),
        boqQty: toNumber(item["QTY"]),
        budgetPrice: toNumber(item["Budget Price"]),
        requestedQty: "",
      }));

    const existing = rows.length === 1 && !rows[0].boqItemId ? [] : rows;
    setRows([...existing, ...newRows]);
  };

  const handleQtyChange = (rowId: string, value: string) => {
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, requestedQty: value } : row)));
  };

  const addRow = () => setRows((current) => [...current, emptyRow()]);
  const removeRow = (rowId: string) => {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.rowId !== rowId) : [emptyRow()]));
  };

  const lineTotal = (row: IndentRow) => Math.round(row.budgetPrice * toNumber(row.requestedQty) * 100) / 100;

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          qty: acc.qty + toNumber(row.requestedQty),
          amount: acc.amount + lineTotal(row),
        }),
        { qty: 0, amount: 0 },
      ),
    [rows],
  );

  const handleSave = async () => {
    if (!mapping || !user) return;

    const validRows = rows.filter((row) => row.boqItemId && toNumber(row.requestedQty) > 0);
    if (!validRows.length) {
      toast({ title: "Add at least one BOQ item with a quantity", variant: "destructive" });
      return;
    }
    if (!indentDate) {
      toast({ title: "Select the indent date", variant: "destructive" });
      return;
    }
    const missingLabel = validateFieldControlRequirements(
      "indentNew",
      { indentDate, requiredDate, remarks },
      fieldControl,
    );
    if (missingLabel) {
      toast({ title: `${missingLabel} is required`, variant: "destructive" });
      return;
    }
    if (requiredDate && requiredDate < indentDate) {
      toast({
        title: "Invalid required date",
        description: "Required date cannot be before the indent date.",
        variant: "destructive",
      });
      return;
    }

    for (const row of validRows) {
      const available = availableFor(row.boqItemId, row.boqQty);
      if (toNumber(row.requestedQty) > available) {
        toast({
          title: "Quantity exceeds BOQ availability",
          description: `${row.description || row.boqSlNo}: only ${formatQuantity(available)} ${row.unit} remain available. If the site actually needs more, request a Variation Order from Project Management → Settings first.`,
          variant: "destructive",
        });
        return;
      }
    }

    setIsSaving(true);
    try {
      const indentReference = doc(collection(db, "projects", mapping.globalProjectId, "indents"));
      const dateCode = indentDate.replace(/-/g, "");
      const indentNumber = `IND-${dateCode}-${indentReference.id.slice(0, 5).toUpperCase()}`;

      const items = validRows.map((row) => ({
        boqItemId: row.boqItemId,
        boqSlNo: row.boqSlNo,
        description: row.description,
        unit: row.unit,
        boqQty: row.boqQty,
        requestedQty: toNumber(row.requestedQty),
        budgetPrice: row.budgetPrice,
        lineTotal: lineTotal(row),
      }));
      const totalAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);

      await setDoc(indentReference, {
        indentNumber,
        projectMappingId: mapping.id,
        projectManagementProjectName: mapping.projectName,
        globalProjectId: mapping.globalProjectId,
        items,
        totalAmount,
        indentDate,
        requiredDate,
        remarks: remarks.trim(),
        status: "Draft",
        // Marks this indent as workflow-aware. Its absence is what grandfathers indents raised
        // before the approval workflow existed — see indentReservesQuantity. A new draft reserves
        // nothing until it has been submitted and approved.
        workflowEnrolled: true,
        currentStepIndex: -1,
        currentStepName: "",
        assignees: [],
        actionLogs: [],
        createdAt: serverTimestamp(),
        createdBy: user.id,
        createdByName: user.name ?? "",
        updatedAt: serverTimestamp(),
      });

      toast({
        title: "Indent created",
        description: `${indentNumber} — submit it from the register to start approval.`,
      });
      router.push(`/project-management/indent/register?project=${encodeURIComponent(mappingId)}`);
    } catch (error) {
      console.error("Failed to create indent:", error);
      toast({ title: "Unable to create indent", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (!canAdd) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Create Indent</h1>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to create indents.</CardDescription>
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
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Select a project first</CardTitle>
            <CardDescription>Return to Project Management and choose a project before creating an indent.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="w-full space-y-5 px-4 py-4 sm:px-6 sm:py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/project-management/indent?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Indents">
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm">
            <ListChecks className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-xl font-bold">Create Indent</h1>
        </div>
        <Button onClick={() => void handleSave()} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Entry
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Indent Details</CardTitle>
          <CardDescription>Provide the main details for this indent.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="project">Project</Label>
              <Input id="project" value={mapping.projectName} readOnly className="bg-muted/50" />
            </div>
            <ControlledField setting={fieldControl("indentDate")} className="space-y-2">
              <Input id="indent-date" type="date" value={indentDate} max={requiredDate || undefined} onChange={(e) => setIndentDate(e.target.value)} />
            </ControlledField>
            <ControlledField setting={fieldControl("requiredDate")} className="space-y-2">
              <Input id="required-date" type="date" value={requiredDate} min={indentDate || undefined} onChange={(e) => setRequiredDate(e.target.value)} />
            </ControlledField>
            <ControlledField setting={fieldControl("remarks")} className="space-y-2">
              <Input id="remarks" placeholder="Optional" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </ControlledField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Indent Items</CardTitle>
              <CardDescription>Add one or more BOQ items required under this indent.</CardDescription>
            </div>
            <Button variant="outline" onClick={() => setIsMultiSelectOpen(true)}>
              <Library className="mr-2 h-4 w-4" /> Add Items from BOQ
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BOQ Sl. No.</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>BOQ Qty</TableHead>
                  <TableHead>Budget Price</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Requested Qty</TableHead>
                  <TableHead>Line Total</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const available = row.boqItemId ? availableFor(row.boqItemId, row.boqQty) : 0;
                  return (
                    <TableRow key={row.rowId}>
                      <TableCell className="min-w-[220px]">
                        <BoqItemSelector
                          boqItems={boqItems}
                          selectedSlNo={row.boqSlNo || null}
                          onSelect={(item) => handleBoqSelect(row.rowId, item)}
                          isLoading={isLoading}
                        />
                      </TableCell>
                      <TableCell className="max-w-xs truncate" title={row.description}>{row.description || "—"}</TableCell>
                      <TableCell>{row.unit || "—"}</TableCell>
                      <TableCell>
                        {row.boqItemId ? (
                          <>
                            {formatQuantity(row.boqQty)}
                            {(() => {
                              const surveyed = surveyedQtyByBoqItem.get(row.boqItemId);
                              return surveyed != null && surveyed !== row.boqQty ? (
                                <div className="text-xs text-muted-foreground">Surveyed: {formatQuantity(surveyed)}</div>
                              ) : null;
                            })()}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{row.boqItemId ? formatCurrency(row.budgetPrice) : "—"}</TableCell>
                      <TableCell className={available <= 0 && row.boqItemId ? "text-destructive" : "text-emerald-700"}>
                        {row.boqItemId ? formatQuantity(available) : "—"}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          max={row.boqItemId ? available : undefined}
                          value={row.requestedQty}
                          onChange={(e) => handleQtyChange(row.rowId, e.target.value)}
                          disabled={!row.boqItemId}
                          className="w-28"
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">
                        {row.boqItemId ? formatCurrency(lineTotal(row)) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => removeRow(row.rowId)} aria-label="Remove row">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={addRow}>
              <Plus className="mr-2 h-4 w-4" /> Add Item
            </Button>
            <div className="flex items-center gap-6 text-sm">
              <span className="text-muted-foreground">Total Qty: <span className="font-medium text-foreground">{formatQuantity(totals.qty)}</span></span>
              <span className="text-muted-foreground">Total Amount: <span className="font-semibold text-foreground">{formatCurrency(totals.amount)}</span></span>
            </div>
          </div>
        </CardContent>
      </Card>

      <BoqMultiSelectDialog
        isOpen={isMultiSelectOpen}
        onOpenChange={setIsMultiSelectOpen}
        boqItems={boqItems}
        onConfirm={handleMultiBoqSelect}
        alreadyAddedItems={rows.filter((row) => row.boqItemId).map((row) => ({ id: row.boqItemId }))}
      />
    </main>
  );
}
