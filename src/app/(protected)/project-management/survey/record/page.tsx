"use client";

/**
 * Record Survey — the BOQ-item deviation table.
 *
 * This screen used to live at /project-management/survey and wrote `surveyedQty` straight onto the
 * BOQ item. Surveyed quantities now have to be certified before they can drive variations or
 * procurement, so recording here opens a survey entry that walks the configured workflow; the BOQ
 * item is only touched when the final step approves (see project-management-survey-workflow.ts).
 *
 * The deviation columns therefore show two different things: the classification of whatever is
 * already approved on the BOQ item, and — where one exists — the entry still in review.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Compass,
  GitPullRequestArrow,
  Loader2,
  Ruler,
  Search,
} from "lucide-react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BoqItem, WorkflowStep } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { DEFAULT_VARIATION_TOLERANCE_PCT } from "@/lib/project-management-variations";
import { PO_COLLECTION, type PurchaseOrder } from "@/lib/purchase-orders";
import {
  DEFAULT_PLAUSIBILITY_LIMIT_PCT,
  SURVEY_CLASSIFICATIONS,
  classifySurveyDeviation,
  formatDeviationPct,
  surveyClassificationStyles,
  type SurveyClassification,
} from "@/lib/project-management-survey";
import {
  DEFAULT_SURVEY_STEPS,
  SURVEY_ENTRY_COLLECTION,
  SURVEY_PERMISSION_RESOURCE,
  SURVEY_WORKFLOW_DOC_ID,
  initialSurveyState,
  isTerminalSurveyStatus,
  surveyStatusStyles,
  type SurveyEntry,
  type SurveyEntryStatus,
} from "@/lib/project-management-survey-workflow";
import { getAssigneeForStep, calculateDeadline } from "@/lib/workflow-utils";
import { applySurveyEntryToBoqInTransaction } from "@/lib/project-management-survey-entries";
import { useProjectManagementSurveyContext } from "@/components/survey/use-survey-host-context";
import { SurveyNav } from "@/components/survey/survey-nav";
import {
  SURVEY_GRADIENT,
  SurveyAccessDenied,
  SurveyLoadingState,
  SurveyPageHeader,
  SurveyPageShell,
  SurveyProjectNotFound,
} from "@/components/survey/survey-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

type SurveyRow = {
  boqItem: BoqItem;
  boqSlNo: string;
  description: string;
  unit: string;
  boqQty: number;
  budgetPrice: number;
  /** Approved figure currently on the BOQ item. */
  surveyedQty: number | null;
  surveyRemarks: string;
  surveyedByName: string;
  indentedQty: number;
  orderedQty: number;
  /** The entry still in review for this item, if any. */
  openEntry: SurveyEntry | null;
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

export default function RecordSurveyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementSurveyContext(mappingId);

  const canView = can("View", SURVEY_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canRecord = can("Record", SURVEY_PERMISSION_RESOURCE);

  const [rows, setRows] = useState<SurveyRow[]>([]);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [tolerancePct, setTolerancePct] = useState(DEFAULT_VARIATION_TOLERANCE_PCT);
  const [plausibilityPct, setPlausibilityPct] = useState(DEFAULT_PLAUSIBILITY_LIMIT_PCT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [classificationFilter, setClassificationFilter] = useState<SurveyClassification | "All">("All");

  const [activeRow, setActiveRow] = useState<SurveyRow | null>(null);
  const [surveyedQtyInput, setSurveyedQtyInput] = useState("");
  const [remarksInput, setRemarksInput] = useState("");

  const globalProjectId = context.globalProjectId;

  const loadData = useCallback(async () => {
    if (!globalProjectId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [boqSnapshot, indentSnapshot, poSnapshot, settingsSnapshot, workflowSnapshot, entrySnapshot] =
        await Promise.all([
          getDocs(collection(db, "projects", globalProjectId, "boqItems")),
          getDocs(collection(db, "projects", globalProjectId, "indents")),
          getDocs(collection(db, "projects", globalProjectId, PO_COLLECTION)),
          getDoc(doc(db, "projectManagementSettings", "general")),
          getDoc(doc(db, "workflows", SURVEY_WORKFLOW_DOC_ID)),
          getDocs(collection(db, "projects", globalProjectId, SURVEY_ENTRY_COLLECTION)),
        ]);

      const storedTolerance = settingsSnapshot.data()?.variationTolerancePct;
      setTolerancePct(typeof storedTolerance === "number" ? storedTolerance : DEFAULT_VARIATION_TOLERANCE_PCT);
      const storedPlausibility = settingsSnapshot.data()?.plausibilityLimitPct;
      setPlausibilityPct(typeof storedPlausibility === "number" ? storedPlausibility : DEFAULT_PLAUSIBILITY_LIMIT_PCT);

      const rawSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : DEFAULT_SURVEY_STEPS;
      setSteps(Array.isArray(rawSteps) ? rawSteps.filter((step) => step && step.name) : []);

      // Only one entry can be open per BOQ item; the newest wins if data ever says otherwise.
      const openEntryByBoqItem = new Map<string, SurveyEntry>();
      entrySnapshot.docs.forEach((entryDoc) => {
        const entry = { id: entryDoc.id, ...entryDoc.data() } as SurveyEntry;
        if (isTerminalSurveyStatus(entry.status)) return;
        openEntryByBoqItem.set(entry.boqItemId, entry);
      });

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
          openEntry: openEntryByBoqItem.get(boqDoc.id) ?? null,
        };
      });
      setRows(nextRows.sort((a, b) => a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true })));
    } catch (error) {
      console.error("Failed to load survey data:", error);
      toast({ title: "Unable to load survey data", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId, toast]);

  useEffect(() => {
    if (isAuthLoading || isResolving || !canView) {
      if (!isAuthLoading && !isResolving) setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, isResolving, loadData]);

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
    setSurveyedQtyInput(
      row.openEntry ? String(row.openEntry.surveyedQty) : row.surveyedQty != null ? String(row.surveyedQty) : "",
    );
    setRemarksInput(row.openEntry ? row.openEntry.remarks : row.surveyRemarks);
  };

  const livePreview = useMemo(() => {
    if (!activeRow) return null;
    const qty = Number(surveyedQtyInput);
    if (!surveyedQtyInput.trim() || !Number.isFinite(qty)) return null;
    return classifySurveyDeviation(qty, activeRow.boqQty, tolerancePct, plausibilityPct);
  }, [activeRow, surveyedQtyInput, tolerancePct, plausibilityPct]);

  const handleSubmitSurvey = async () => {
    if (!globalProjectId || !user || !activeRow) return;
    const qty = Number(surveyedQtyInput);
    if (!surveyedQtyInput.trim() || !Number.isFinite(qty) || qty < 0) {
      toast({ title: "Enter a valid surveyed quantity", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const initial = initialSurveyState(steps);
      const firstStep = steps[initial.currentStepIndex];

      let assignees: string[] = [];
      let deadline: Date | null = null;
      if (firstStep) {
        assignees = await getAssigneeForStep(firstStep, {
          projectId: globalProjectId,
          departmentId: "",
          amount: qty * activeRow.budgetPrice,
        });
        try {
          deadline = await calculateDeadline(new Date(), firstStep.tat);
        } catch {
          // Working hours aren't configured on this instance — the entry still routes, it just
          // carries no deadline rather than failing to submit.
          deadline = null;
        }
      }

      const entry: Omit<SurveyEntry, "id"> = {
        boqItemId: activeRow.boqItem.id,
        boqSlNo: activeRow.boqSlNo,
        description: activeRow.description,
        unit: activeRow.unit,
        boqQty: activeRow.boqQty,
        budgetPrice: activeRow.budgetPrice,
        surveyedQty: qty,
        remarks: remarksInput.trim(),
        surveyedBy: user.id,
        surveyedByName: user.name,
        createdAt: serverTimestamp(),
        status: initial.status,
        currentStepIndex: initial.currentStepIndex,
        currentStepName: initial.currentStepName,
        assignees,
        ...(deadline ? { deadline } : {}),
        actionLogs: [],
        projectId: globalProjectId,
        mappingId,
      };

      const created = await addDoc(
        collection(db, "projects", globalProjectId, SURVEY_ENTRY_COLLECTION),
        entry,
      );

      // With no workflow configured the entry is born approved, and there is no stage that would
      // otherwise write it through — so apply it here rather than leaving the BOQ item stale.
      if (initial.applyToBoq) {
        await runTransaction(db, async (transaction) => {
          applySurveyEntryToBoqInTransaction(transaction, globalProjectId, {
            boqItemId: entry.boqItemId,
            surveyedQty: entry.surveyedQty,
            remarks: entry.remarks,
            surveyedBy: entry.surveyedBy,
            surveyedByName: entry.surveyedByName,
          });
          transaction.update(created, { appliedAt: serverTimestamp() });
        });
      }

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: context.activityModule,
        action: "Submit Survey",
        details: { project: projectName, boqSlNo: activeRow.boqSlNo, surveyedQty: qty },
      });

      toast({
        title: steps.length ? "Survey submitted for review" : "Survey recorded",
        description: steps.length
          ? `Routed to ${initial.currentStepName}.`
          : "No workflow is configured, so this was applied directly.",
      });
      setActiveRow(null);
      await loadData();
    } catch (error) {
      console.error("Failed to submit survey:", error);
      toast({ title: "Unable to submit survey", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const goToRaiseVariation = (row: SurveyRow) => {
    const params = new URLSearchParams({ project: mappingId, boqItemId: row.boqItem.id });
    if (row.surveyedQty != null) params.set("surveyedQty", String(row.surveyedQty));
    router.push(`/project-management/settings/variation-orders?${params.toString()}`);
  };

  if (isAuthLoading || isResolving || (isLoading && canView)) {
    return <SurveyLoadingState />;
  }

  if (!canView) {
    return <SurveyAccessDenied description="You do not have permission to view the Survey module." />;
  }

  if (notFound) {
    return (
      <SurveyProjectNotFound
        description="Return to Project Management and choose a project before opening Survey."
        href="/project-management"
      />
    );
  }

  return (
    <SurveyPageShell>
      <SurveyPageHeader
        title="Record Survey"
        subtitle={
          `${coverage.pct}% of BOQ value certified (${formatCurrency(coverage.surveyedValue)} of ${formatCurrency(coverage.totalValue)})` +
          (projectName ? ` for ${projectName}` : "")
        }
        icon={Compass}
        backHref={context.surveyHref()}
        backLabel="Back to Survey"
        gradient={SURVEY_GRADIENT}
      />

      <SurveyNav context={context} active="record" />

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
                  <TableHead className="text-right">Certified Qty</TableHead>
                  <TableHead className="text-right">Deviation</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>In Review</TableHead>
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
                        <TableCell>
                          {row.openEntry ? (
                            <div className="space-y-1">
                              <Badge
                                variant="outline"
                                className={surveyStatusStyles[row.openEntry.status as SurveyEntryStatus]}
                              >
                                {row.openEntry.status}
                              </Badge>
                              <p className="text-xs text-muted-foreground">
                                {formatQuantity(row.openEntry.surveyedQty)}
                                {row.openEntry.currentStepName ? ` · ${row.openEntry.currentStepName}` : ""}
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
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
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openRecord(row)}
                                disabled={Boolean(row.openEntry)}
                                title={row.openEntry ? "A survey for this item is already in review" : undefined}
                              >
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
                    <TableCell colSpan={10} className="h-32 text-center">
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
            <p className="text-xs text-muted-foreground">
              {steps.length
                ? `This will be sent to ${steps[0].name} for review. The BOQ item is updated only once the final step approves.`
                : "No survey workflow is configured, so this will be applied to the BOQ item immediately."}
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleSubmitSurvey} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {steps.length ? "Submit for review" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SurveyPageShell>
  );
}
