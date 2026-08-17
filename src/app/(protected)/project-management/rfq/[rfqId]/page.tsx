"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  FileSearch,
  Loader2,
  Pencil,
  Save,
  Send,
  ShieldAlert,
  Trophy,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
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
import { Textarea } from "@/components/ui/textarea";
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
import {
  RFQ_COLLECTION,
  RFQ_PERMISSION_RESOURCE,
  RFQ_QUOTES_SUBCOLLECTION,
  computeCashOutflow,
  computeLandedCost,
  formatCurrency,
  formatDate,
  formatQuantity,
  rfqStatusStyles,
  toNumber,
  type Rfq,
  type RfqItem,
  type RfqQuote,
  type RfqStatus,
} from "@/lib/rfq";
import { VENDOR_COLLECTIONS } from "@/lib/vendor-management";
import { useAuth } from "@/components/auth/AuthProvider";
import type { WorkflowStep } from "@/lib/types";
import { getAssigneeForStep, calculateDeadline } from "@/lib/workflow-utils";
import {
  createPurchaseOrdersForAwards,
  type AwardGroup,
} from "@/lib/project-management-rfq-awards";
import { requestRfqAwardApproval } from "@/lib/project-management-rfq-award-entries";
import {
  DEFAULT_RFQ_AWARD_STEPS,
  RFQ_AWARD_WORKFLOW_DOC_ID,
  rfqAwardRequiresApproval,
  type RfqLike,
} from "@/lib/project-management-rfq-workflow";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

type QuoteForm = {
  submittedDate: string;
  paymentTerms: string;
  deliveryTime: string;
  validityDate: string;
  remarks: string;
  rates: Record<string, string>;
  discountAmount: string;
  packingForwardingAmount: string;
  freightAmount: string;
  insuranceAmount: string;
  gstPct: string;
};

const emptyQuoteForm = (rfqItems: RfqItem[]): QuoteForm => ({
  submittedDate: "",
  paymentTerms: "",
  deliveryTime: "",
  validityDate: "",
  remarks: "",
  rates: Object.fromEntries(rfqItems.map((item) => [item.rfqItemId, ""])),
  discountAmount: "",
  packingForwardingAmount: "",
  freightAmount: "",
  insuranceAmount: "",
  gstPct: "",
});

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export default function RfqDetailPage() {
  const { rfqId } = useParams() as { rfqId: string };
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();

  const canView = can("View", RFQ_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canSend = can("Send", RFQ_PERMISSION_RESOURCE);
  const canEnterQuote = can("Enter Quote", RFQ_PERMISSION_RESOURCE);
  const canAward = can("Award", RFQ_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [quotes, setQuotes] = useState<RfqQuote[]>([]);
  const [budgetPriceByBoqItemId, setBudgetPriceByBoqItemId] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isSavingQuote, setIsSavingQuote] = useState(false);
  const [isAwarding, setIsAwarding] = useState(false);

  const [quoteDialogVendorId, setQuoteDialogVendorId] = useState<string | null>(null);
  const [quoteForm, setQuoteForm] = useState<QuoteForm>(emptyQuoteForm([]));
  const [awardSelections, setAwardSelections] = useState<Record<string, string>>({});
  /** Award approval stages, if this project has configured any. */
  const [awardSteps, setAwardSteps] = useState<WorkflowStep[]>([]);

  const loadRfq = useCallback(async () => {
    if (!mappingId || !rfqId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");
      setMapping(mappingData);

      const rfqSnapshot = await getDoc(doc(db, "projects", mappingData.globalProjectId, RFQ_COLLECTION, rfqId));
      if (!rfqSnapshot.exists()) {
        setRfq(null);
        return;
      }
      const rfqData = { id: rfqSnapshot.id, ...rfqSnapshot.data() } as Rfq;
      setRfq(rfqData);

      const [quotesSnapshot, boqSnapshot, workflowSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, RFQ_COLLECTION, rfqId, RFQ_QUOTES_SUBCOLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDoc(doc(db, "workflows", RFQ_AWARD_WORKFLOW_DOC_ID)),
      ]);
      setQuotes(quotesSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as RfqQuote));

      const rawAwardSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : DEFAULT_RFQ_AWARD_STEPS;
      setAwardSteps(
        (Array.isArray(rawAwardSteps) ? rawAwardSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) })),
      );
      setBudgetPriceByBoqItemId(
        new Map(boqSnapshot.docs.map((d) => [d.id, toNumber((d.data() as Record<string, unknown>)["Budget Price"])])),
      );

      setAwardSelections(
        Object.fromEntries(rfqData.items.map((item) => [item.rfqItemId, item.awardedVendorId ?? ""])),
      );
    } catch (error) {
      console.error("Failed to load RFQ:", error);
      toast({ title: "Unable to load RFQ", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, rfqId, toast]);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadRfq();
  }, [canView, isAuthLoading, loadRfq]);

  const receivedQuotes = useMemo(() => quotes.filter((q) => q.status === "Received"), [quotes]);

  const bestRatePerItem = useMemo(() => {
    const map = new Map<string, number>();
    if (!rfq) return map;
    rfq.items.forEach((item) => {
      const rates = receivedQuotes
        .map((q) => q.items.find((qi) => qi.rfqItemId === item.rfqItemId)?.rate)
        .filter((rate): rate is number => typeof rate === "number");
      if (rates.length) map.set(item.rfqItemId, Math.min(...rates));
    });
    return map;
  }, [rfq, receivedQuotes]);

  // What this package would cost at BOQ rates — the benchmark a normalised quote is judged
  // against, shown alongside every vendor so a rate escalation is visible before award.
  const boqBenchmarkValue = useMemo(() => {
    if (!rfq) return 0;
    return rfq.items.reduce((sum, item) => sum + item.qty * (budgetPriceByBoqItemId.get(item.boqItemId) ?? 0), 0);
  }, [rfq, budgetPriceByBoqItemId]);

  const landedCostByVendor = useMemo(() => {
    const map = new Map<string, number>();
    receivedQuotes.forEach((quote) => map.set(quote.vendorId, quote.landedCost ?? computeLandedCost(quote)));
    return map;
  }, [receivedQuotes]);

  const bestLandedCost = useMemo(() => {
    const values = Array.from(landedCostByVendor.values());
    return values.length ? Math.min(...values) : undefined;
  }, [landedCostByVendor]);

  const handleSendToVendors = async () => {
    if (!mapping || !rfq) return;
    setIsSending(true);
    try {
      const vendorsForEmail = await Promise.all(
        rfq.vendorIds.map(async (vendorId, index) => {
          const vendorSnapshot = await getDoc(doc(db, VENDOR_COLLECTIONS.vendors, vendorId));
          return {
            vendorId,
            name: rfq.vendorNames?.[index] ?? vendorSnapshot.data()?.vendorName ?? "Vendor",
            email: vendorSnapshot.data()?.email as string | undefined,
          };
        }),
      );

      const response = await fetch("/api/rfq/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rfqNumber: rfq.rfqNumber,
          rfqDate: rfq.rfqDate,
          dueDate: rfq.dueDate,
          projectName: mapping.globalProjectName,
          remarks: rfq.remarks,
          items: rfq.items.map((item) => ({ description: item.description, unit: item.unit, qty: item.qty })),
          vendors: vendorsForEmail,
        }),
      });
      const result = await response.json();
      const succeeded = (result.results ?? []).filter((r: { success: boolean }) => r.success).length;

      await setDoc(
        doc(db, "projects", mapping.globalProjectId, RFQ_COLLECTION, rfq.id),
        { status: "Sent" satisfies RfqStatus, updatedAt: serverTimestamp() },
        { merge: true },
      );
      toast({ title: "RFQ sent", description: `Emailed ${succeeded} of ${vendorsForEmail.length} vendor(s).` });
      await loadRfq();
    } catch (error) {
      console.error("Failed to send RFQ:", error);
      toast({ title: "Unable to send RFQ", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  const openQuoteDialog = (vendorId: string) => {
    if (!rfq) return;
    const existing = quotes.find((q) => q.vendorId === vendorId);
    if (existing && existing.status === "Received") {
      setQuoteForm({
        submittedDate: existing.submittedDate ?? "",
        paymentTerms: existing.paymentTerms ?? "",
        deliveryTime: existing.deliveryTime ?? "",
        validityDate: existing.validityDate ?? "",
        remarks: existing.remarks ?? "",
        rates: Object.fromEntries(
          rfq.items.map((item) => [
            item.rfqItemId,
            String(existing.items.find((qi) => qi.rfqItemId === item.rfqItemId)?.rate ?? ""),
          ]),
        ),
        discountAmount: existing.discountAmount != null ? String(existing.discountAmount) : "",
        packingForwardingAmount: existing.packingForwardingAmount != null ? String(existing.packingForwardingAmount) : "",
        freightAmount: existing.freightAmount != null ? String(existing.freightAmount) : "",
        insuranceAmount: existing.insuranceAmount != null ? String(existing.insuranceAmount) : "",
        gstPct: existing.gstPct != null ? String(existing.gstPct) : "",
      });
    } else {
      setQuoteForm({ ...emptyQuoteForm(rfq.items), submittedDate: today() });
    }
    setQuoteDialogVendorId(vendorId);
  };

  const quoteFormPreview = useMemo(() => {
    const basicTotal = rfq
      ? rfq.items.reduce((sum, item) => sum + toNumber(quoteForm.rates[item.rfqItemId]) * item.qty, 0)
      : 0;
    const landedCost = computeLandedCost({
      totalAmount: basicTotal,
      discountAmount: toNumber(quoteForm.discountAmount),
      packingForwardingAmount: toNumber(quoteForm.packingForwardingAmount),
      freightAmount: toNumber(quoteForm.freightAmount),
      insuranceAmount: toNumber(quoteForm.insuranceAmount),
    });
    const cashOutflowInclGst = computeCashOutflow(landedCost, toNumber(quoteForm.gstPct));
    return { basicTotal, landedCost, cashOutflowInclGst };
  }, [rfq, quoteForm]);

  const handleSaveQuote = async () => {
    if (!mapping || !rfq || !quoteDialogVendorId) return;
    const vendorName = quotes.find((q) => q.vendorId === quoteDialogVendorId)?.vendorName
      ?? rfq.vendorNames[rfq.vendorIds.indexOf(quoteDialogVendorId)]
      ?? "Vendor";

    const items = rfq.items.map((item) => {
      const rate = toNumber(quoteForm.rates[item.rfqItemId]);
      return { rfqItemId: item.rfqItemId, rate, amount: Math.round(rate * item.qty * 100) / 100 };
    });
    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

    if (!items.some((item) => item.rate > 0)) {
      toast({ title: "Enter at least one item rate", variant: "destructive" });
      return;
    }

    const discountAmount = toNumber(quoteForm.discountAmount);
    const packingForwardingAmount = toNumber(quoteForm.packingForwardingAmount);
    const freightAmount = toNumber(quoteForm.freightAmount);
    const insuranceAmount = toNumber(quoteForm.insuranceAmount);
    const gstPct = toNumber(quoteForm.gstPct);
    const landedCost = computeLandedCost({ totalAmount, discountAmount, packingForwardingAmount, freightAmount, insuranceAmount });
    const cashOutflowInclGst = computeCashOutflow(landedCost, gstPct);

    setIsSavingQuote(true);
    try {
      await setDoc(
        doc(db, "projects", mapping.globalProjectId, RFQ_COLLECTION, rfq.id, RFQ_QUOTES_SUBCOLLECTION, quoteDialogVendorId),
        {
          vendorId: quoteDialogVendorId,
          vendorName,
          status: "Received",
          submittedDate: quoteForm.submittedDate,
          paymentTerms: quoteForm.paymentTerms.trim(),
          deliveryTime: quoteForm.deliveryTime.trim(),
          validityDate: quoteForm.validityDate,
          remarks: quoteForm.remarks.trim(),
          items,
          totalAmount,
          discountAmount,
          packingForwardingAmount,
          freightAmount,
          insuranceAmount,
          gstPct,
          landedCost,
          cashOutflowInclGst,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      toast({ title: "Quote saved" });
      setQuoteDialogVendorId(null);
      await loadRfq();
    } catch (error) {
      console.error("Failed to save quote:", error);
      toast({ title: "Unable to save quote", variant: "destructive" });
    } finally {
      setIsSavingQuote(false);
    }
  };

  const handleConfirmAwards = async () => {
    if (!mapping || !rfq) return;

    const itemsToProcess = rfq.items.filter((item) => {
      const selectedVendorId = awardSelections[item.rfqItemId];
      return selectedVendorId && !item.poId;
    });
    if (!itemsToProcess.length) {
      toast({ title: "No new item awards to confirm", variant: "destructive" });
      return;
    }

    setIsAwarding(true);
    try {
      const byVendor = new Map<string, RfqItem[]>();
      itemsToProcess.forEach((item) => {
        const vendorId = awardSelections[item.rfqItemId];
        byVendor.set(vendorId, [...(byVendor.get(vendorId) ?? []), item]);
      });

      // Build each vendor's award once, with rates resolved from their quote. The same shape feeds
      // both paths below, so an approved award produces exactly the PO a direct award would.
      const groups: AwardGroup[] = [];
      for (const [vendorId, items] of byVendor.entries()) {
        const quote = quotes.find((q) => q.vendorId === vendorId);
        if (!quote) continue;
        groups.push({
          vendorId,
          vendorName: quote.vendorName,
          items: items.map((item) => {
            const quoteItem = quote.items.find((qi) => qi.rfqItemId === item.rfqItemId);
            const rate = quoteItem?.rate ?? 0;
            return {
              rfqItemId: item.rfqItemId,
              description: item.description,
              unit: item.unit,
              qty: item.qty,
              rate,
              amount: Math.round(rate * item.qty * 100) / 100,
              sourceIndentId: item.sourceIndentId,
              sourceIndentNumber: item.sourceIndentNumber,
              boqItemId: item.boqItemId,
            };
          }),
        });
      }

      if (!rfqAwardRequiresApproval(rfq as RfqLike, awardSteps)) {
        // Legacy RFQ, or no workflow configured — award directly, as this screen always did.
        const { poCount, itemCount } = await createPurchaseOrdersForAwards({
          globalProjectId: mapping.globalProjectId,
          projectMappingId: mapping.id,
          projectManagementProjectName: mapping.projectName,
          globalProjectName: mapping.globalProjectName,
          rfq: { id: rfq.id, rfqNumber: rfq.rfqNumber, rfqDate: rfq.rfqDate },
          groups,
        });
        toast({ title: `Awarded ${itemCount} item(s) across ${poCount} purchase order(s)` });
        await loadRfq();
        return;
      }

      if (!user) throw new Error("You must be signed in to request an award approval.");

      // One approval request per vendor: they are separate decisions, and a reviewer may well
      // approve one vendor's award and send another back.
      for (const group of groups) {
        const groupTotal = group.items.reduce((sum, item) => sum + item.amount, 0);
        await requestRfqAwardApproval({
          globalProjectId: mapping.globalProjectId,
          mappingId,
          rfq: { id: rfq.id, rfqNumber: rfq.rfqNumber, rfqDate: rfq.rfqDate },
          vendorId: group.vendorId,
          vendorName: group.vendorName,
          items: group.items.map((item) => ({
            rfqItemId: item.rfqItemId,
            boqItemId: item.boqItemId,
            boqSlNo:
              rfq.items.find((rfqItem) => rfqItem.rfqItemId === item.rfqItemId)?.boqSlNo ?? "",
            description: item.description,
            unit: item.unit,
            qty: item.qty,
            rate: item.rate,
            amount: item.amount,
            sourceIndentId: item.sourceIndentId,
            sourceIndentNumber: item.sourceIndentNumber,
          })),
          // Snapshotted so a reviewer can see whether this was the cheapest option without
          // re-opening the RFQ and re-deriving it.
          lowestLandedCost: bestLandedCost,
          steps: awardSteps,
          requestedBy: { id: user.id, name: user.name },
          resolveAssignees: (step) =>
            getAssigneeForStep(step, {
              projectId: mapping.globalProjectId,
              departmentId: "",
              amount: groupTotal,
            }),
          resolveDeadline: async (step) => {
            try {
              return await calculateDeadline(new Date(), step.tat);
            } catch {
              return null;
            }
          },
        });
      }

      toast({
        title: `${groups.length} award request${groups.length === 1 ? "" : "s"} sent for approval`,
        description: `Routed to ${awardSteps[0]?.name ?? "review"}. The purchase order is raised once approved.`,
      });
      await loadRfq();
    } catch (error) {
      console.error("Failed to confirm awards:", error);
      toast({
        title: "Unable to confirm awards",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsAwarding(false);
    }
  };

  const generatedPoIds = useMemo(
    () => Array.from(new Set((rfq?.items ?? []).map((item) => item.poId).filter((id): id is string => Boolean(id)))),
    [rfq],
  );

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view RFQs.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!rfq || !mapping) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>RFQ not found</CardTitle>
            <CardDescription>This RFQ may have been deleted, or the project link is invalid.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href={`/project-management/rfq?project=${encodeURIComponent(mappingId)}`}>Back to RFQs</Link></Button>
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
            <Link href={`/project-management/rfq?project=${encodeURIComponent(mappingId)}`} aria-label="Back to RFQs">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm">
            <FileSearch className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{rfq.rfqNumber}</h1>
            <p className="text-sm text-muted-foreground">{mapping.projectName} · Due {formatDate(rfq.dueDate)}</p>
          </div>
          <span className={`ml-2 rounded-full px-3 py-1 text-xs font-medium ${rfqStatusStyles[rfq.status]}`}>{rfq.status}</span>
        </div>
        {rfq.status === "Draft" && canSend && (
          <Button onClick={() => void handleSendToVendors()} disabled={isSending}>
            {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send to Vendors
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <CardDescription>{rfq.items.length} item(s) from {new Set(rfq.items.map((i) => i.sourceIndentId)).size} indent(s).</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BOQ SL No</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Source Indent</TableHead>
                  <TableHead>Awarded To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfq.items.map((item) => (
                  <TableRow key={item.rfqItemId}>
                    <TableCell>{item.boqSlNo || "—"}</TableCell>
                    <TableCell className="max-w-sm truncate" title={item.description}>{item.description}</TableCell>
                    <TableCell>{formatQuantity(item.qty)} {item.unit}</TableCell>
                    <TableCell>{item.sourceIndentNumber}</TableCell>
                    <TableCell>
                      {item.awardedVendorName ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <Trophy className="h-3.5 w-3.5" /> {item.awardedVendorName} · {formatCurrency(item.awardedAmount ?? 0)}
                        </span>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vendor Quotes</CardTitle>
          <CardDescription>{receivedQuotes.length} of {rfq.vendorIds.length} vendor(s) have submitted a quote.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quotes.map((quote) => (
            <div key={quote.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{quote.vendorName}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${quote.status === "Received" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                  {quote.status}
                </span>
              </div>
              {quote.status === "Received" ? (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p>Payment Terms: <span className="text-foreground">{quote.paymentTerms || "—"}</span></p>
                  <p>Delivery Time: <span className="text-foreground">{quote.deliveryTime || "—"}</span></p>
                  <p>Basic Total: <span className="text-foreground">{formatCurrency(quote.totalAmount)}</span></p>
                  <p>Landed Cost: <span className="font-semibold text-foreground">{formatCurrency(quote.landedCost ?? computeLandedCost(quote))}</span></p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">Awaiting quote submission.</p>
              )}
              {canEnterQuote && (
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => openQuoteDialog(quote.vendorId)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> {quote.status === "Received" ? "Edit Quote" : "Enter Quote"}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {receivedQuotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Compare Quotes</CardTitle>
            <CardDescription>
              Lowest rate per item, and lowest overall landed cost, are highlighted. BOQ benchmark for this package:{" "}
              <span className="font-semibold text-foreground">{formatCurrency(boqBenchmarkValue)}</span>. Choose an
              award for each item, then confirm.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Item</TableHead>
                    {receivedQuotes.map((quote) => (
                      <TableHead key={quote.vendorId} className="min-w-[120px] text-right">{quote.vendorName}</TableHead>
                    ))}
                    <TableHead className="min-w-[200px]">Award To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rfq.items.map((item) => {
                    const bestRate = bestRatePerItem.get(item.rfqItemId);
                    const vendorsForItem = receivedQuotes.filter((q) => q.items.some((qi) => qi.rfqItemId === item.rfqItemId && qi.rate > 0));
                    return (
                      <TableRow key={item.rfqItemId}>
                        <TableCell className="max-w-xs truncate" title={item.description}>{item.description}</TableCell>
                        {receivedQuotes.map((quote) => {
                          const rate = quote.items.find((qi) => qi.rfqItemId === item.rfqItemId)?.rate;
                          const isBest = typeof rate === "number" && rate > 0 && rate === bestRate;
                          return (
                            <TableCell key={quote.vendorId} className={`text-right whitespace-nowrap ${isBest ? "bg-emerald-50 font-semibold text-emerald-700" : ""}`}>
                              {typeof rate === "number" && rate > 0 ? formatCurrency(rate) : "—"}
                            </TableCell>
                          );
                        })}
                        <TableCell>
                          {item.poId ? (
                            <span className="text-xs text-muted-foreground">Already in PO</span>
                          ) : (
                            <Select
                              value={awardSelections[item.rfqItemId] ?? ""}
                              onValueChange={(value) => setAwardSelections((current) => ({ ...current, [item.rfqItemId]: value }))}
                              disabled={!canAward}
                            >
                              <SelectTrigger className="h-8"><SelectValue placeholder="Not awarded" /></SelectTrigger>
                              <SelectContent>
                                {vendorsForItem.map((quote) => (
                                  <SelectItem key={quote.vendorId} value={quote.vendorId}>{quote.vendorName}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-medium">Payment Terms</TableCell>
                    {receivedQuotes.map((quote) => (
                      <TableCell key={quote.vendorId} colSpan={1} className="text-right text-xs">{quote.paymentTerms || "—"}</TableCell>
                    ))}
                    <TableCell />
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-medium">Delivery Time</TableCell>
                    {receivedQuotes.map((quote) => (
                      <TableCell key={quote.vendorId} className="text-right text-xs">{quote.deliveryTime || "—"}</TableCell>
                    ))}
                    <TableCell />
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-medium">Basic Total</TableCell>
                    {receivedQuotes.map((quote) => (
                      <TableCell key={quote.vendorId} className="text-right text-xs">{formatCurrency(quote.totalAmount)}</TableCell>
                    ))}
                    <TableCell />
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-medium">Landed Cost (excl. GST)</TableCell>
                    {receivedQuotes.map((quote) => {
                      const landedCost = landedCostByVendor.get(quote.vendorId) ?? quote.totalAmount;
                      const isBest = typeof bestLandedCost === "number" && landedCost === bestLandedCost;
                      const overBenchmark = boqBenchmarkValue > 0 && landedCost > boqBenchmarkValue;
                      return (
                        <TableCell
                          key={quote.vendorId}
                          className={`text-right text-xs font-semibold ${isBest ? "bg-emerald-50 text-emerald-700" : overBenchmark ? "text-amber-600" : ""}`}
                        >
                          {formatCurrency(landedCost)}
                          {overBenchmark && <div className="text-[10px] font-normal text-amber-600">above BOQ rate</div>}
                        </TableCell>
                      );
                    })}
                    <TableCell />
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-medium">Cash Outflow (incl. GST)</TableCell>
                    {receivedQuotes.map((quote) => {
                      const landedCost = landedCostByVendor.get(quote.vendorId) ?? quote.totalAmount;
                      const cashOutflow = quote.cashOutflowInclGst ?? computeCashOutflow(landedCost, quote.gstPct ?? 0);
                      return (
                        <TableCell key={quote.vendorId} className="text-right text-xs text-muted-foreground">
                          {formatCurrency(cashOutflow)}
                        </TableCell>
                      );
                    })}
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {canAward && (
              <div className="flex flex-col items-end gap-1 p-4">
                {rfqAwardRequiresApproval(rfq as RfqLike, awardSteps) && (
                  <p className="text-xs text-muted-foreground">
                    Awards go to {awardSteps[0]?.name} for approval. The purchase order is raised
                    once approved.
                  </p>
                )}
                <Button onClick={() => void handleConfirmAwards()} disabled={isAwarding}>
                  {isAwarding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trophy className="mr-2 h-4 w-4" />}
                  {rfqAwardRequiresApproval(rfq as RfqLike, awardSteps)
                    ? "Submit Awards for Approval"
                    : "Confirm Awards"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {generatedPoIds.length > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="flex flex-col gap-2 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
              <CheckCircle2 className="h-4 w-4" /> {generatedPoIds.length} purchase order(s) generated from this RFQ
            </p>
            <div className="flex flex-wrap gap-2">
              {generatedPoIds.map((poId) => (
                <Link key={poId} href={`/project-management/purchase-orders/${poId}?project=${encodeURIComponent(mappingId)}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                  View Purchase Order →
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!quoteDialogVendorId} onOpenChange={(open) => !open && setQuoteDialogVendorId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Enter Vendor Quote</DialogTitle>
            <DialogDescription>Record the rates and terms this vendor quoted for the RFQ items.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="submitted-date">Quote Submitted Date</Label>
                <Input id="submitted-date" type="date" value={quoteForm.submittedDate} onChange={(e) => setQuoteForm((c) => ({ ...c, submittedDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="validity-date">Quote Valid Until</Label>
                <Input id="validity-date" type="date" value={quoteForm.validityDate} onChange={(e) => setQuoteForm((c) => ({ ...c, validityDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="payment-terms">Payment Terms</Label>
                <Input id="payment-terms" placeholder="e.g. 30 days credit" value={quoteForm.paymentTerms} onChange={(e) => setQuoteForm((c) => ({ ...c, paymentTerms: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delivery-time">Delivery Time</Label>
                <Input id="delivery-time" placeholder="e.g. 7 days" value={quoteForm.deliveryTime} onChange={(e) => setQuoteForm((c) => ({ ...c, deliveryTime: e.target.value }))} />
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rfq?.items ?? []).map((item) => {
                    const rate = toNumber(quoteForm.rates[item.rfqItemId]);
                    return (
                      <TableRow key={item.rfqItemId}>
                        <TableCell className="max-w-xs truncate" title={item.description}>{item.description}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatQuantity(item.qty)} {item.unit}</TableCell>
                        <TableCell>
                          <Input
                            className="w-28"
                            type="number"
                            min="0"
                            step="0.01"
                            value={quoteForm.rates[item.rfqItemId] ?? ""}
                            onChange={(e) => setQuoteForm((c) => ({ ...c, rates: { ...c.rates, [item.rfqItemId]: e.target.value } }))}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatCurrency(Math.round(rate * item.qty * 100) / 100)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Landed Cost Adjustments</p>
              <p className="text-xs text-muted-foreground">
                Quoted as one lump sum for this RFQ, not per line. GST is excluded from the comparable landed cost
                (input credit is available) but shown separately as actual cash outflow.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="discount-amount">Discount (₹)</Label>
                  <Input id="discount-amount" type="number" min="0" step="1" value={quoteForm.discountAmount} onChange={(e) => setQuoteForm((c) => ({ ...c, discountAmount: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pf-amount">Packing & Forwarding (₹)</Label>
                  <Input id="pf-amount" type="number" min="0" step="1" value={quoteForm.packingForwardingAmount} onChange={(e) => setQuoteForm((c) => ({ ...c, packingForwardingAmount: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="freight-amount">Freight (₹)</Label>
                  <Input id="freight-amount" type="number" min="0" step="1" value={quoteForm.freightAmount} onChange={(e) => setQuoteForm((c) => ({ ...c, freightAmount: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="insurance-amount">Insurance (₹)</Label>
                  <Input id="insurance-amount" type="number" min="0" step="1" value={quoteForm.insuranceAmount} onChange={(e) => setQuoteForm((c) => ({ ...c, insuranceAmount: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gst-pct">GST (%)</Label>
                  <Input id="gst-pct" type="number" min="0" step="0.5" value={quoteForm.gstPct} onChange={(e) => setQuoteForm((c) => ({ ...c, gstPct: e.target.value }))} />
                </div>
              </div>
              <div className="mt-2 space-y-1 rounded-md bg-muted/40 p-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Basic Total</span><span>{formatCurrency(quoteFormPreview.basicTotal)}</span></div>
                <div className="flex justify-between font-semibold"><span>Landed Cost (excl. GST)</span><span>{formatCurrency(quoteFormPreview.landedCost)}</span></div>
                <div className="flex justify-between text-xs text-muted-foreground"><span>Cash Outflow (incl. GST)</span><span>{formatCurrency(quoteFormPreview.cashOutflowInclGst)}</span></div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quote-remarks">Remarks</Label>
              <Textarea id="quote-remarks" placeholder="Optional" value={quoteForm.remarks} onChange={(e) => setQuoteForm((c) => ({ ...c, remarks: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => void handleSaveQuote()} disabled={isSavingQuote}>
              {isSavingQuote ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
