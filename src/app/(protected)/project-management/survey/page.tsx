"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Compass,
  GitPullRequestArrow,
  Loader2,
  Ruler,
  Search,
  ShieldAlert,
} from "lucide-react";
import { collection, doc, getDoc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BoqItem } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { DEFAULT_VARIATION_TOLERANCE_PCT } from "@/lib/project-management-variations";
import { PO_COLLECTION, type PurchaseOrder } from "@/lib/purchase-orders";
import {
  DEFAULT_PLAUSIBILITY_LIMIT_PCT,
  SURVEY_CLASSIFICATIONS,
  SURVEY_PERMISSION_RESOURCE,
  classifySurveyDeviation,
  formatDeviationPct,
  surveyClassificationStyles,
  type SurveyClassification,
} from "@/lib/project-management-survey";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

type SurveyRow = {
  boqItem: BoqItem;
  boqSlNo: string;
  description: string;
  unit: string;
  boqQty: number;
  budgetPrice: number;
  surveyedQty: number | null;
  surveyRemarks: string;
  surveyedByName: string;
  indentedQty: number;
  orderedQty: number;
};

const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatQuantity = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

const getBoqSlNo = (item: BoqItem) => String(item["BOQ SL No"] ?? item["SL. No."] ?? "");

export default function SurveyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", SURVEY_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canRecord = can("Record", SURVEY_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [rows, setRows] = useState<SurveyRow[]>([]);
  const [tolerancePct, setTolerancePct] = useState(DEFAULT_VARIATION_TOLERANCE_PCT);
  const [plausibilityPct, setPlausibilityPct] = useState(DEFAULT_PLAUSIBILITY_LIMIT_PCT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [classificationFilter, setClassificationFilter] = useState<SurveyClassification | "All">("All");

  const [activeRow, setActiveRow] = useState<SurveyRow | null>(null);
  const [surveyedQtyInput, setSurveyedQtyInput] = useState("");
  const [remarksInput, setRemarksInput] = useState("");

  const loadData = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) {
        setMapping(null);
        return;
      }
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      setMapping(mappingData);

      const [boqSnapshot, indentSnapshot, poSnapshot, settingsSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "indents")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION)),
        getDoc(doc(db, "projectManagementSettings", "general")),
      ]);

      const storedTolerance = settingsSnapshot.data()?.variationTolerancePct;
      setTolerancePct(typeof storedTolerance === "number" ? storedTolerance : DEFAULT_VARIATION_TOLERANCE_PCT);
      const storedPlausibility = settingsSnapshot.data()?.plausibilityLimitPct;
      setPlausibilityPct(typeof storedPlausibility === "number" ? storedPlausibility : DEFAULT_PLAUSIBILITY_LIMIT_PCT);

      const indentedQtyByBoqItem = new Map<string, number>();
      indentSnapshot.docs.forEach((indentDoc) => {
        const data = indentDoc.data() as { status?: string; items?: Array<{ boqItemId?: string; requestedQty?: unknown }> };
        if (["Rejected", "Cancelled"].includes(data.status ?? "")) return;
        (Array.isArray(data.items) ? data.items : []).forEach((item) => {
          const id = String(item.boqItemId ?? "");
          if (!id) return;
          indentedQtyByBoqItem.set(id, (indentedQtyByBoqItem.get(id) ?? 0) + toNumber(item.requestedQty));
        });
      });

      const orderedQtyByBoqItem = new Map<string, number>();
      poSnapshot.docs.forEach((poDoc) => {
        const data = poDoc.data() as PurchaseOrder;
        if (!["Issued", "Received"].includes(data.status)) return;
        (data.items ?? []).forEach((item) => {
          if (!item.boqItemId) return;
          orderedQtyByBoqItem.set(item.boqItemId, (orderedQtyByBoqItem.get(item.boqItemId) ?? 0) + toNumber(item.qty));
        });
      });

      const nextRows: SurveyRow[] = boqSnapshot.docs.map((boqDoc) => {
        const boqItem = { id: boqDoc.id, ...boqDoc.data() } as BoqItem;
        const storedSurveyedQty = boqItem.surveyedQty;
        return {
          boqItem,
          boqSlNo: getBoqSlNo(boqItem),
          description: String(boqItem["Description"] ?? ""),
          unit: String(boqItem["Unit"] ?? ""),
          boqQty: toNumber(boqItem["QTY"]),
          budgetPrice: toNumber(boqItem["Budget Price"]),
          surveyedQty: typeof storedSurveyedQty === "number" ? storedSurveyedQty : null,
          surveyRemarks: String(boqItem.surveyRemarks ?? ""),
          surveyedByName: String(boqItem.surveyedByName ?? ""),
          indentedQty: indentedQtyByBoqItem.get(boqDoc.id) ?? 0,
          orderedQty: orderedQtyByBoqItem.get(boqDoc.id) ?? 0,
        };
      });
      setRows(nextRows.sort((a, b) => a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true })));
    } catch (error) {
      console.error("Failed to load survey data:", error);
      toast({ title: "Unable to load survey data", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, toast]);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  const rowsWithDeviation = useMemo(
    () =>
      rows.map((row) => ({
        row,
        ...classifySurveyDeviation(row.surveyedQty, row.boqQty, tolerancePct, plausibilityPct),
      })),
    [rows, tolerancePct, plausibilityPct],
  );

  const coverage = useMemo(() => {
    const totalValue = rows.reduce((sum, row) => sum + row.boqQty * row.budgetPrice, 0);
    const surveyedValue = rows
      .filter((row) => row.surveyedQty != null)
      .reduce((sum, row) => sum + row.boqQty * row.budgetPrice, 0);
    return { totalValue, surveyedValue, pct: totalValue ? Math.round((surveyedValue / totalValue) * 100) : 0 };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rowsWithDeviation.filter(({ row, classification }) => {
      if (classificationFilter !== "All" && classification !== classificationFilter) return false;
      if (term && !row.boqSlNo.toLowerCase().includes(term) && !row.description.toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [rowsWithDeviation, search, classificationFilter]);

  const openRecord = (row: SurveyRow) => {
    setActiveRow(row);
    setSurveyedQtyInput(row.surveyedQty != null ? String(row.surveyedQty) : "");
    setRemarksInput(row.surveyRemarks);
  };

  const livePreview = useMemo(() => {
    if (!activeRow) return null;
    const qty = Number(surveyedQtyInput);
    if (!surveyedQtyInput.trim() || !Number.isFinite(qty)) return null;
    return classifySurveyDeviation(qty, activeRow.boqQty, tolerancePct, plausibilityPct);
  }, [activeRow, surveyedQtyInput, tolerancePct, plausibilityPct]);

  const handleSaveSurvey = async () => {
    if (!mapping || !user || !activeRow) return;
    const qty = Number(surveyedQtyInput);
    if (!surveyedQtyInput.trim() || !Number.isFinite(qty) || qty < 0) {
      toast({ title: "Enter a valid surveyed quantity", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      await updateDoc(doc(db, "projects", mapping.globalProjectId, "boqItems", activeRow.boqItem.id), {
        surveyedQty: qty,
        surveyRemarks: remarksInput.trim(),
        surveyedBy: user.id,
        surveyedByName: user.name,
        surveyedAt: serverTimestamp(),
      });
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Record Survey",
        details: { project: mapping.projectName, boqSlNo: activeRow.boqSlNo, surveyedQty: qty },
      });
      toast({ title: "Survey recorded" });
      setActiveRow(null);
      await loadData();
    } catch (error) {
      console.error("Failed to record survey:", error);
      toast({ title: "Unable to record survey", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const goToRaiseVariation = (row: SurveyRow) => {
    const params = new URLSearchParams({ project: mappingId, boqItemId: row.boqItem.id });
    if (row.surveyedQty != null) params.set("surveyedQty", String(row.surveyedQty));
    router.push(`/project-management/settings/variation-orders?${params.toString()}`);
  };

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this module.</CardDescription>
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
            <CardDescription>Return to Project Management and choose a project before opening Survey.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/project-management/supply?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Supply">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 shadow-sm">
            <Compass className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Survey</h1>
            <p className="text-sm text-muted-foreground">
              {coverage.pct}% of BOQ value surveyed ({formatCurrency(coverage.surveyedValue)} of {formatCurrency(coverage.totalValue)}) for {mapping.projectName}
            </p>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/project-management/requirement-planner?project=${encodeURIComponent(mappingId)}`}>
            <CalendarClock className="mr-2 h-4 w-4" />
            Requirement Planner
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search BOQ SL No or description..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          value={classificationFilter}
          onValueChange={(value: SurveyClassification | "All") => setClassificationFilter(value)}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All classifications</SelectItem>
            {SURVEY_CLASSIFICATIONS.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BOQ SL No</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">BOQ Qty</TableHead>
                  <TableHead className="text-right">Surveyed Qty</TableHead>
                  <TableHead className="text-right">Deviation</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Ledger</TableHead>
                  <TableHead className="w-56 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length ? (
                  filteredRows.map(({ row, deviation, deviationPct, classification }) => {
                    const exposureQty = Math.max(row.indentedQty, row.orderedQty) - (row.surveyedQty ?? row.boqQty);
                    const hasSurplusExposure =
                      classification === "Scope Reduction" && row.surveyedQty != null && exposureQty > 0;
                    return (
                      <TableRow key={row.boqItem.id}>
                        <TableCell className="whitespace-nowrap">{row.boqSlNo || "—"}</TableCell>
                        <TableCell className="max-w-xs truncate" title={row.description}>{row.description}</TableCell>
                        <TableCell>{row.unit || "—"}</TableCell>
                        <TableCell className="text-right">{formatQuantity(row.boqQty)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {row.surveyedQty != null ? formatQuantity(row.surveyedQty) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.surveyedQty != null ? (
                            <span className={deviation > 0 ? "text-amber-600" : deviation < 0 ? "text-blue-600" : ""}>
                              {deviation > 0 ? "+" : ""}
                              {formatQuantity(deviation)} ({formatDeviationPct(deviationPct)})
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={surveyClassificationStyles[classification]}>
                            {classification}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="text-muted-foreground">
                            {row.indentedQty > 0 && <div>Indented: {formatQuantity(row.indentedQty)}</div>}
                            {row.orderedQty > 0 && <div>Ordered: {formatQuantity(row.orderedQty)}</div>}
                          </div>
                          {hasSurplusExposure && (
                            <div
                              className="mt-1 flex items-center gap-1 font-medium text-red-600"
                              title={`Surplus exposure: ${formatCurrency(exposureQty * row.budgetPrice)}`}
                            >
                              <AlertTriangle className="h-3 w-3" />
                              Surplus {formatCurrency(exposureQty * row.budgetPrice)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {canRecord && (
                              <Button variant="outline" size="sm" onClick={() => openRecord(row)}>
                                <Ruler className="mr-1.5 h-3.5 w-3.5" />
                                {row.surveyedQty != null ? "Re-survey" : "Record"}
                              </Button>
                            )}
                            {classification === "Variation Required" && (
                              <Button variant="outline" size="sm" onClick={() => goToRaiseVariation(row)}>
                                <GitPullRequestArrow className="mr-1.5 h-3.5 w-3.5" />
                                Raise Variation
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center">
                      <Compass className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">No BOQ items match</p>
                      <p className="mt-1 text-sm text-muted-foreground">Try a different search or classification.</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(activeRow)} onOpenChange={(open) => !open && setActiveRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Survey</DialogTitle>
            <DialogDescription>{activeRow ? `${activeRow.boqSlNo} — ${activeRow.description}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <p className="text-xs text-muted-foreground">
              BOQ Qty: {activeRow ? formatQuantity(activeRow.boqQty) : "—"} {activeRow?.unit}
            </p>
            <div className="space-y-2">
              <Label htmlFor="surveyed-qty">Surveyed Quantity</Label>
              <Input
                id="surveyed-qty"
                type="number"
                min="0"
                step="0.001"
                value={surveyedQtyInput}
                onChange={(event) => setSurveyedQtyInput(event.target.value)}
              />
            </div>
            {livePreview && (
              <div className={`rounded-md px-3 py-2 text-xs font-medium ${surveyClassificationStyles[livePreview.classification]}`}>
                Deviation {livePreview.deviation > 0 ? "+" : ""}
                {formatQuantity(livePreview.deviation)} ({formatDeviationPct(livePreview.deviationPct)}) — {livePreview.classification}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="survey-remarks">Remarks</Label>
              <Textarea
                id="survey-remarks"
                placeholder="Optional notes..."
                value={remarksInput}
                onChange={(event) => setRemarksInput(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleSaveSurvey} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
