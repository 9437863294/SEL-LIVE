"use client";

/**
 * BOQ Item 360° — the single place that answers "what has happened to this line, and what is it
 * waiting on?"
 *
 * Every stage of the chain already records its own data, but until now nothing joined them: you had
 * to open eleven registers to reconstruct one BOQ line's history. This page assembles them.
 *
 * Loading is deliberately shaped around how the data is stored. The gate registers hold ONE doc per
 * BOQ item (doc id === boqItemId), so they are point reads. Indents, RFQs and POs keep their BOQ
 * reference inside an `items[]` array of maps, which Firestore cannot index — those three must be
 * scanned and filtered client-side. Reading the whole `boqItems` collection is avoided entirely.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ExternalLink, Route, ShieldAlert } from "lucide-react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { PO_COLLECTION, formatQuantity, type PurchaseOrder } from "@/lib/purchase-orders";
import { RFQ_COLLECTION, type Rfq } from "@/lib/rfq";
import { MDL_COLLECTION, type MdlDrawing } from "@/lib/mdl";
import {
  DI_COLLECTION,
  GRN_COLLECTION,
  INSPECTION_COLLECTION,
  MC_COLLECTION,
  MDCC_COLLECTION,
  MVAC_COLLECTION,
  formatGateDate,
  isInspectionRequired,
  type DiRecord,
  type GrnRecord,
  type InspectionRecord,
  type ManufacturingClearance,
  type MdccRecord,
  type MvacRecord,
} from "@/lib/supply-gates";
import {
  WORK_PACKAGE_COLLECTION,
  type ProjectWorkPackage,
} from "@/lib/project-management-work-packages";
import {
  JMC_ENTRY_COLLECTION,
  MVAC_ENTRY_COLLECTION,
  SUBCONTRACTOR_BILL_COLLECTION,
  WORK_ORDER_COLLECTION,
  aggregateMeasurementsByBoqKey,
  aggregateSubcontractorBillsByBoqItem,
  aggregateWorkOrdersByBoqItem,
  civilBoqKey,
  civilBoqKeyOfBoqItem,
  readBoqSlNo,
  readLooseScope,
  type MeasurementEntryLike,
  type SubcontractorBillLike,
  type WorkOrderLike,
} from "@/lib/civil-execution";
import {
  buildBoqTimeline,
  computeBoqProgressPct,
  currentTraceStage,
  traceStageStatusStyles,
  type TraceLane,
  type TraceStage,
} from "@/lib/boq-traceability";
import {
  reconcileBoqQuantities,
  quantityExceptionStyles,
  type QuantityLedger,
} from "@/lib/boq-quantity-control";
import { DEFAULT_VARIATION_TOLERANCE_PCT } from "@/lib/project-management-variations";
import {
  DOCUMENT_COLLECTION,
  type ProjectManagementDocument,
} from "@/lib/project-management-documents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

type BoqItemDoc = Record<string, unknown> & { id: string };

const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

const text = (value: unknown) => String(value ?? "").trim();

/** BOQ items store dates inconsistently — the survey stamps a Firestore Timestamp (`surveyedAt`)
 * while most other fields are plain yyyy-mm-dd strings. Normalise to the string form the timeline
 * and formatGateDate() expect. */
const toDateString = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (typeof value === "string") return value.slice(0, 10) || undefined;
  const date =
    value instanceof Date
      ? value
      : typeof (value as { toDate?: () => Date }).toDate === "function"
        ? (value as { toDate: () => Date }).toDate()
        : null;
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** Civil and Erection are both delivered as work packages, so they share the civil lane. */
const resolveLane = (boqItem: BoqItemDoc | null): TraceLane =>
  ["civil", "erection"].includes(text(boqItem?.["Scope 2"]).toLowerCase()) ? "civil" : "supply";

/** Where each timeline stage lives, so a user can jump straight to it. */
const STAGE_ROUTES: Partial<Record<TraceStage["key"], string>> = {
  survey: "survey",
  indent: "indent",
  rfq: "rfq",
  po: "purchase-orders",
  drawing: "mdl",
  mc: "manufacturing-clearance",
  inspection: "inspections",
  mdcc: "mdcc",
  di: "dispatch-instructions",
  grn: "grn",
  mvac: "mvac",
  workOrder: "civil",
  workPackage: "civil",
  jmc: "civil",
};

export default function BoqItem360Page() {
  const { boqItemId } = useParams() as { boqItemId: string };
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can("View", "Project Management.BOQ");

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [boqItem, setBoqItem] = useState<BoqItemDoc | null>(null);
  const [indents, setIndents] = useState<Array<Record<string, unknown>>>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [mdl, setMdl] = useState<MdlDrawing | null>(null);
  const [mc, setMc] = useState<ManufacturingClearance | null>(null);
  const [inspection, setInspection] = useState<InspectionRecord | null>(null);
  const [mdcc, setMdcc] = useState<MdccRecord | null>(null);
  const [di, setDi] = useState<DiRecord | null>(null);
  const [grn, setGrn] = useState<GrnRecord | null>(null);
  const [mvac, setMvac] = useState<MvacRecord | null>(null);
  const [workPackages, setWorkPackages] = useState<ProjectWorkPackage[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderLike[]>([]);
  const [measurementEntries, setMeasurementEntries] = useState<MeasurementEntryLike[]>([]);
  const [subcontractorBills, setSubcontractorBills] = useState<SubcontractorBillLike[]>([]);
  const [documents, setDocuments] = useState<ProjectManagementDocument[]>([]);
  const [tolerancePct, setTolerancePct] = useState(DEFAULT_VARIATION_TOLERANCE_PCT);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!mappingId || !boqItemId) {
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
      const projectId = mappingData.globalProjectId;
      const gate = (name: string) => getDoc(doc(db, "projects", projectId, name, boqItemId));

      const [
        boqSnapshot,
        mdlSnapshot,
        mcSnapshot,
        inspectionSnapshot,
        mdccSnapshot,
        diSnapshot,
        grnSnapshot,
        mvacSnapshot,
        indentSnapshot,
        rfqSnapshot,
        poSnapshot,
        workPackageSnapshot,
        workOrderSnapshot,
        jmcEntrySnapshot,
        mvacEntrySnapshot,
        subBillSnapshot,
        settingsSnapshot,
        documentSnapshot,
      ] = await Promise.all([
        getDoc(doc(db, "projects", projectId, "boqItems", boqItemId)),
        gate(MDL_COLLECTION),
        gate(MC_COLLECTION),
        gate(INSPECTION_COLLECTION),
        gate(MDCC_COLLECTION),
        gate(DI_COLLECTION),
        gate(GRN_COLLECTION),
        gate(MVAC_COLLECTION),
        // These three keep boqItemId inside items[], which Firestore cannot index — scan required.
        getDocs(collection(db, "projects", projectId, "indents")),
        getDocs(collection(db, "projects", projectId, RFQ_COLLECTION)),
        getDocs(collection(db, "projects", projectId, PO_COLLECTION)),
        getDocs(collection(db, "projects", projectId, WORK_PACKAGE_COLLECTION)),
        // Civil registers owned by Billing Recon / Subcontractors Management. Work orders and
        // bills key items by boqItemId; JMC/MVAC measurements only by (scope1, scope2, BOQ SL No)
        // — both scans are unavoidable for the same items[]-array reason as indents/RFQs/POs.
        getDocs(collection(db, "projects", projectId, WORK_ORDER_COLLECTION)),
        getDocs(collection(db, "projects", projectId, JMC_ENTRY_COLLECTION)),
        getDocs(collection(db, "projects", projectId, MVAC_ENTRY_COLLECTION)),
        getDocs(collection(db, "projects", projectId, SUBCONTRACTOR_BILL_COLLECTION)),
        getDoc(doc(db, "projectManagementSettings", "general")),
        getDocs(query(collection(db, DOCUMENT_COLLECTION), where("linkedId", "==", boqItemId))),
      ]);

      if (!boqSnapshot.exists()) {
        setBoqItem(null);
        return;
      }
      setBoqItem({ id: boqSnapshot.id, ...boqSnapshot.data() });
      setMdl(mdlSnapshot.exists() ? ({ id: mdlSnapshot.id, ...mdlSnapshot.data() } as MdlDrawing) : null);
      setMc(mcSnapshot.exists() ? ({ id: mcSnapshot.id, ...mcSnapshot.data() } as ManufacturingClearance) : null);
      setInspection(inspectionSnapshot.exists() ? ({ id: inspectionSnapshot.id, ...inspectionSnapshot.data() } as InspectionRecord) : null);
      setMdcc(mdccSnapshot.exists() ? ({ id: mdccSnapshot.id, ...mdccSnapshot.data() } as MdccRecord) : null);
      setDi(diSnapshot.exists() ? ({ id: diSnapshot.id, ...diSnapshot.data() } as DiRecord) : null);
      setGrn(grnSnapshot.exists() ? ({ id: grnSnapshot.id, ...grnSnapshot.data() } as GrnRecord) : null);
      setMvac(mvacSnapshot.exists() ? ({ id: mvacSnapshot.id, ...mvacSnapshot.data() } as MvacRecord) : null);

      setIndents(indentSnapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setRfqs(rfqSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Rfq));
      setPurchaseOrders(poSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as PurchaseOrder));
      setWorkPackages(
        workPackageSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as ProjectWorkPackage),
      );
      setWorkOrders(workOrderSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkOrderLike));
      setMeasurementEntries([
        ...jmcEntrySnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as MeasurementEntryLike),
        ...mvacEntrySnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as MeasurementEntryLike),
      ]);
      setSubcontractorBills(
        subBillSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as SubcontractorBillLike),
      );
      setDocuments(
        documentSnapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as ProjectManagementDocument)
          .filter((document) => document.linkedType === "BOQ Item"),
      );

      const storedTolerance = settingsSnapshot.data()?.variationTolerancePct;
      setTolerancePct(
        typeof storedTolerance === "number" ? storedTolerance : DEFAULT_VARIATION_TOLERANCE_PCT,
      );
    } catch (error) {
      console.error("Failed to load BOQ item lifecycle:", error);
      toast({ title: "Unable to load this BOQ item", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, boqItemId, toast]);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  /* ---- derived: this item's slice of each multi-item register ---- */

  const indentLines = useMemo(
    () =>
      indents
        .filter((indent) => !["Rejected", "Cancelled"].includes(text(indent.status)))
        .flatMap((indent) =>
          ((indent.items as Array<Record<string, unknown>> | undefined) ?? [])
            .filter((line) => text(line.boqItemId) === boqItemId)
            .map((line) => ({
              indentNumber: text(indent.indentNumber),
              indentDate: text(indent.indentDate),
              status: text(indent.status),
              requestedQty: toNumber(line.requestedQty),
            })),
        ),
    [indents, boqItemId],
  );

  const rfqLines = useMemo(
    () =>
      rfqs
        .filter((rfq) => rfq.status !== "Cancelled")
        .flatMap((rfq) =>
          (rfq.items ?? [])
            .filter((line) => line.boqItemId === boqItemId)
            .map((line) => ({
              rfqNumber: rfq.rfqNumber,
              rfqDate: rfq.rfqDate,
              status: rfq.status,
              qty: line.qty,
              awardedVendorName: line.awardedVendorName,
            })),
        ),
    [rfqs, boqItemId],
  );

  // Only committed POs count, matching buildPoPlacedItems() and the Survey page.
  const poLines = useMemo(
    () =>
      purchaseOrders
        .filter((po) => ["Issued", "Received"].includes(po.status))
        .flatMap((po) =>
          (po.items ?? [])
            .filter((line) => line.boqItemId === boqItemId)
            .map((line) => ({
              poNumber: po.poNumber,
              poDate: po.poDate,
              status: po.status,
              qty: line.qty,
              vendorName: po.vendorName,
            })),
        ),
    [purchaseOrders, boqItemId],
  );

  const lane = resolveLane(boqItem);
  const scopeWorkPackages = useMemo(
    () =>
      lane === "civil"
        ? workPackages.filter((workPackage) =>
            text(boqItem?.["Scope 2"]).toLowerCase() === "erection"
              ? workPackage.scope === "Erection"
              : workPackage.scope === "Civil",
          )
        : [],
    [lane, workPackages, boqItem],
  );

  /* ---- civil registers, reduced to this one item's slice ---- */
  const workOrderAgg = useMemo(
    () => (lane === "civil" ? aggregateWorkOrdersByBoqItem(workOrders).get(boqItemId) : undefined),
    [lane, workOrders, boqItemId],
  );
  const measurementAgg = useMemo(
    () =>
      lane === "civil" && boqItem
        ? aggregateMeasurementsByBoqKey(measurementEntries).get(civilBoqKeyOfBoqItem(boqItem))
        : undefined,
    [lane, measurementEntries, boqItem],
  );
  const subBillAgg = useMemo(
    () =>
      lane === "civil"
        ? aggregateSubcontractorBillsByBoqItem(subcontractorBills).get(boqItemId)
        : undefined,
    [lane, subcontractorBills, boqItemId],
  );

  /** The individual civil records behind the aggregates — what a user would actually open. */
  const civilRecords = useMemo(() => {
    if (lane !== "civil" || !boqItem) return null;
    const itemKey = civilBoqKeyOfBoqItem(boqItem);
    const rowsOf = (parent: { items?: unknown }) =>
      Array.isArray(parent.items) ? (parent.items as Array<Record<string, unknown>>) : [];
    return {
      workOrders: workOrders
        .filter((workOrder) => rowsOf(workOrder).some((line) => text(line.boqItemId) === boqItemId))
        .map((workOrder) => ({
          reference: text(workOrder.workOrderNo),
          date: text(workOrder.date),
          party: text(workOrder.subcontractorName),
          qty: rowsOf(workOrder)
            .filter((line) => text(line.boqItemId) === boqItemId)
            .reduce((total, line) => total + toNumber(line.orderQty), 0),
          certifiedQty: undefined as number | undefined,
          status: text(workOrder.status),
          kind: "Work Order",
        })),
      measurements: measurementEntries
        .filter((entry) =>
          rowsOf(entry).some(
            (line) =>
              civilBoqKey(readLooseScope(line, 1), readLooseScope(line, 2), readBoqSlNo(line)) ===
              itemKey,
          ),
        )
        .map((entry) => {
          const lines = rowsOf(entry).filter(
            (line) =>
              civilBoqKey(readLooseScope(line, 1), readLooseScope(line, 2), readBoqSlNo(line)) ===
              itemKey,
          );
          return {
            reference: text(entry.jmcNo ?? entry.mvacNo),
            date: text(entry.jmcDate ?? entry.mvacDate),
            party: "",
            qty: lines.reduce((total, line) => total + toNumber(line.executedQty), 0),
            certifiedQty: lines.reduce((total, line) => total + toNumber(line.certifiedQty), 0),
            status: text(entry.status),
            kind: text(entry.jmcNo) ? "JMC" : "MVAC",
          };
        }),
      bills: subcontractorBills
        .filter(
          (bill) =>
            bill.isRetentionBill !== true &&
            rowsOf(bill).some((line) => text(line.boqItemId) === boqItemId),
        )
        .map((bill) => ({
          reference: text(bill.billNo),
          date: text(bill.billDate),
          party: "",
          qty: rowsOf(bill)
            .filter((line) => text(line.boqItemId) === boqItemId)
            .reduce((total, line) => total + toNumber(line.billedQty), 0),
          certifiedQty: undefined as number | undefined,
          status: text(bill.status),
          kind: "Subcontractor Bill",
        })),
    };
  }, [lane, boqItem, boqItemId, workOrders, measurementEntries, subcontractorBills]);

  const boqQty = toNumber(boqItem?.QTY);
  const surveyedQty = typeof boqItem?.surveyedQty === "number" ? boqItem.surveyedQty : undefined;
  const budgetPrice = toNumber(boqItem?.["Budget Price"]);

  const stages = useMemo(
    () =>
      boqItem
        ? buildBoqTimeline({
            lane,
            boqQty,
            surveyedQty,
            surveyDate: toDateString(boqItem.surveyedAt),
            surveyedByName: text(boqItem.surveyedByName) || undefined,
            mdlRequired: text(boqItem.MDL).toLowerCase() === "yes",
            inspectionRequired: isInspectionRequired(boqItem["Inspection Required"]),
            indentLines,
            rfqLines,
            poLines,
            mdl: mdl ? { status: mdl.status, firstSubmittedOn: mdl.firstSubmittedOn } : undefined,
            mc: mc ?? undefined,
            inspection: inspection ?? undefined,
            mdcc: mdcc ?? undefined,
            di: di ?? undefined,
            grn: grn ?? undefined,
            mvac: mvac ?? undefined,
            workPackages: scopeWorkPackages,
            workOrder: workOrderAgg,
            jmc: measurementAgg,
          })
        : [],
    [boqItem, lane, boqQty, surveyedQty, indentLines, rfqLines, poLines, mdl, mc, inspection, mdcc, di, grn, mvac, scopeWorkPackages, workOrderAgg, measurementAgg],
  );

  const ledger: QuantityLedger | null = useMemo(
    () =>
      boqItem
        ? reconcileBoqQuantities({
            lane,
            boqQty,
            surveyedQty,
            indentedQty: indentLines.length
              ? indentLines.reduce((total, line) => total + line.requestedQty, 0)
              : undefined,
            orderedQty: poLines.length
              ? poLines.reduce((total, line) => total + line.qty, 0)
              : undefined,
            inspectedAcceptedQty: inspection?.qtyAccepted,
            dispatchedQty: di?.dispatchQty,
            receivedQty: grn?.receivedQty,
            siteAcceptedQty: grn?.acceptedQty,
            clientAcceptedQty: mvac?.qtyAccepted,
            woOrderedQty: workOrderAgg?.orderedQty,
            executedQty: measurementAgg?.executedQty,
            jmcQty: measurementAgg?.certifiedQty,
            subcontractorBilledQty: subBillAgg?.billedQty,
            approvedVariationQty:
              typeof boqItem.variationApprovedQty === "number" ? boqItem.variationApprovedQty : 0,
            tolerancePct,
          })
        : null,
    [boqItem, lane, boqQty, surveyedQty, indentLines, poLines, inspection, di, grn, mvac, workOrderAgg, measurementAgg, subBillAgg, tolerancePct],
  );

  const progressPct = computeBoqProgressPct(stages);
  const current = currentTraceStage(stages);

  const stageHref = (stage: TraceStage) => {
    const route = STAGE_ROUTES[stage.key];
    return route
      ? `/project-management/${route}?project=${encodeURIComponent(mappingId)}`
      : undefined;
  };

  /* ---- render ---- */

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
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

  if (!mapping || !boqItem) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>BOQ item not found</CardTitle>
            <CardDescription>
              This BOQ item could not be loaded for the selected project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={`/project-management/boq/costing?project=${encodeURIComponent(mappingId)}`}>
                Back to BOQ
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const boqSlNo = text(boqItem["BOQ SL No"]) || text(boqItem["SL. No."]);
  const unit = text(boqItem.Unit);

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link
            href={`/project-management/boq/costing?project=${encodeURIComponent(mappingId)}`}
            aria-label="Back to BOQ"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-sm">
          <Route className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">
            {boqSlNo ? `${boqSlNo} — ` : ""}
            {text(boqItem.Description) || "BOQ item"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Full lifecycle for {mapping.projectName}
          </p>
        </div>
      </div>

      {/* Header facts */}
      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Unit", value: unit || "—" },
            { label: "BOQ Qty", value: formatQuantity(boqQty) },
            { label: "Surveyed Qty", value: surveyedQty != null ? formatQuantity(surveyedQty) : "—" },
            { label: "Budget Price", value: budgetPrice ? formatCurrency(budgetPrice) : "—" },
            {
              label: "Total Budget",
              value: budgetPrice ? formatCurrency(budgetPrice * (surveyedQty ?? boqQty)) : "—",
            },
            { label: "Scope", value: text(boqItem["Scope 2"]) || "—" },
          ].map((fact) => (
            <div key={fact.label}>
              <p className="text-xs text-muted-foreground">{fact.label}</p>
              <p className="font-semibold">{fact.value}</p>
            </div>
          ))}
          <div className="sm:col-span-3 lg:col-span-6">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Lifecycle progress ({lane === "civil" ? "Civil" : "Supply"} lane)
              </span>
              <span className="font-medium">{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* What it is waiting on — the question this page exists to answer */}
      {current && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            current.status === "blocked"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-blue-200 bg-blue-50 text-blue-800",
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Currently at <strong>{current.label}</strong>
            {current.status === "blocked" && current.blockedReason
              ? ` — blocked: ${current.blockedReason}`
              : current.detail
                ? ` — ${current.detail}`
                : ""}
            .
          </span>
        </div>
      )}

      {/* Lifecycle timeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lifecycle</CardTitle>
          <CardDescription>
            Every stage this BOQ line passes through, with the record and date behind each one.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead className="w-24 text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stages.map((stage) => {
                  const href = stageHref(stage);
                  return (
                    <TableRow key={stage.key} className={cn(stage.status === "na" && "opacity-60")}>
                      <TableCell className="whitespace-nowrap font-medium">{stage.label}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={traceStageStatusStyles[stage.status]}>
                          {stage.status === "na" ? "N/A" : stage.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {stage.date ? formatGateDate(stage.date) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{stage.reference || "—"}</TableCell>
                      <TableCell className="text-right text-xs">
                        {stage.qty != null ? formatQuantity(stage.qty) : "—"}
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">
                        {stage.status === "blocked" && stage.blockedReason ? (
                          <span className="font-medium text-red-600">{stage.blockedReason}</span>
                        ) : (
                          stage.detail || "—"
                        )}
                        {stage.actor ? <div className="mt-0.5">{stage.actor}</div> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {href && stage.status !== "na" ? (
                          <Button variant="ghost" size="icon" asChild aria-label={`Open ${stage.label}`}>
                            <Link href={href}>
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Quantity reconciliation */}
      {ledger && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quantity reconciliation</CardTitle>
            <CardDescription>
              Each stage&apos;s recorded quantity, checked against the one above it and against
              approved scope. {formatQuantity(ledger.availableToOrder)} {unit} still available to order.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">vs previous</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.rungs.map((rung) => (
                    <TableRow key={rung.key}>
                      <TableCell className="whitespace-nowrap">{rung.label}</TableCell>
                      <TableCell className="text-right">
                        {rung.qty != null ? formatQuantity(rung.qty) : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right text-xs",
                          rung.deltaFromPrevious != null && rung.deltaFromPrevious > 0
                            ? "font-medium text-red-600"
                            : "text-muted-foreground",
                        )}
                      >
                        {rung.deltaFromPrevious != null
                          ? `${rung.deltaFromPrevious > 0 ? "+" : ""}${rung.deltaFromPrevious}`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {ledger.exceptions.length ? (
              <div className="space-y-2">
                {ledger.exceptions.map((exception, index) => (
                  <div
                    key={`${exception.rung}-${index}`}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border p-3 text-sm",
                      exception.severity === "critical"
                        ? "border-red-200 bg-red-50 text-red-800"
                        : "border-amber-200 bg-amber-50 text-amber-800",
                    )}
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <Badge
                        variant="outline"
                        className={cn("mr-2", quantityExceptionStyles[exception.severity])}
                      >
                        {exception.severity}
                      </Badge>
                      {exception.message}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                Every recorded quantity reconciles against the stage above it and stays within
                approved scope.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Civil commercial records — the work orders, measurements, and bills behind the lane */}
      {civilRecords &&
        (civilRecords.workOrders.length > 0 ||
          civilRecords.measurements.length > 0 ||
          civilRecords.bills.length > 0) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Subcontract &amp; measurement records</CardTitle>
              <CardDescription>
                Work orders, JMC/MVAC measurement entries, and subcontractor bills that reference
                this BOQ line — owned by Subcontractors Management and Billing Recon, joined here.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Party</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Certified</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      ...civilRecords.workOrders,
                      ...civilRecords.measurements,
                      ...civilRecords.bills,
                    ].map((record, index) => (
                      <TableRow key={`${record.kind}-${record.reference}-${index}`}>
                        <TableCell>
                          <Badge variant="outline">{record.kind}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {record.reference || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {record.date ? formatGateDate(record.date) : "—"}
                        </TableCell>
                        <TableCell className="max-w-40 truncate text-xs">
                          {record.party || "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {formatQuantity(record.qty)}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {record.certifiedQty != null ? formatQuantity(record.certifiedQty) : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{record.status || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

      {/* Linked documents */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Linked documents</CardTitle>
          <CardDescription>Evidence filed against this BOQ item in the document vault.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {documents.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Uploaded by</TableHead>
                    <TableHead className="w-20 text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell className="max-w-xs truncate" title={document.fileName}>
                        {document.fileName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{document.category}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {document.uploadedByName || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" asChild aria-label="Open document">
                          <a href={document.fileUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No documents filed against this BOQ item yet.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
