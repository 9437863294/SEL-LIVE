"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  AlertTriangle,
  Copy,
  Edit3,
  FileText,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  actionableRecurringCycle,
  describeRecurrence,
  loadWorkingCalendar,
  type PaymentObligation,
  type RecurringPaymentMaster,
  RP_COLLECTIONS,
  currency,
  maskAccount,
  recurringDateOnly,
  visibleObligations,
} from "@/lib/recurring-payments";
import {
  generatedCyclePredicate,
  generateMasterCycle,
  loadManualGenerationContext,
} from "@/lib/recurring-payments-generation";
import { makeIsWorkingDay } from "@/lib/working-hours";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableCard } from "@/components/shared/table-card";

type AuditRecord = {
  id: string;
  action: string;
  summary?: string;
  userName?: string;
  createdAt?: unknown;
};

export default function RecurringMasterDetailPage({
  masterId,
}: {
  masterId: string;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || "default";
  const [master, setMaster] = useState<RecurringPaymentMaster | null>(null);
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  // Every obligation id this master has, soft-deleted included: a deleted obligation still occupies
  // its cycle's document id, so it counts as generated even though it's hidden from the list.
  const [obligationIds, setObligationIds] = useState<string[]>([]);
  const [calendar, setCalendar] = useState<Awaited<ReturnType<typeof loadWorkingCalendar>> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadWorkingCalendar().then(setCalendar).catch(() => undefined);
  }, []);

  useEffect(() => {
    const masterRef = doc(db, RP_COLLECTIONS.masters, masterId);
    const stops = [
      onSnapshot(
        masterRef,
        (snapshot) => {
          const value = snapshot.exists()
            ? ({
                id: snapshot.id,
                ...snapshot.data(),
              } as RecurringPaymentMaster)
            : null;
          setMaster(value?.organizationId === organizationId ? value : null);
          setLoading(false);
        },
        () => setLoading(false),
      ),
      onSnapshot(
        query(
          collection(db, RP_COLLECTIONS.payments),
          where("organizationId", "==", organizationId),
          where("masterId", "==", masterId),
        ),
        (snapshot) => {
          setObligationIds(snapshot.docs.map((item) => item.id));
          setPayments(
            visibleObligations(
              snapshot.docs.map(
                (item) =>
                  ({ id: item.id, ...item.data() }) as PaymentObligation,
              ),
            ).sort((a, b) => b.dueDate.localeCompare(a.dueDate)),
          );
        },
      ),
      onSnapshot(
        query(
          collection(masterRef, RP_COLLECTIONS.auditLogs),
          orderBy("createdAt", "desc"),
        ),
        (snapshot) => {
          setAudit(
            snapshot.docs.map(
              (item) => ({ id: item.id, ...item.data() }) as AuditRecord,
            ),
          );
        },
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [masterId, organizationId]);

  // The earliest cycle still missing an obligation — not merely the one today falls inside (under
  // arrears billing those differ), nor the oldest one in the pending window (which the cron has
  // usually generated already). It's what "Generate now" creates and what this page reports, on
  // the org's working calendar so a "last working day" due date matches the cron's.
  const nextCycle = useMemo(
    () =>
      master?.startDate
        ? actionableRecurringCycle(master, new Date(), {
            isWorkingDay: makeIsWorkingDay(calendar?.workingHours, calendar?.holidays),
            isGenerated: generatedCyclePredicate(organizationId, master.id, obligationIds),
          })
        : null,
    [master, calendar, organizationId, obligationIds],
  );
  // An archived master keeps its page for the history, but nothing on it may act: resuming it set
  // it Active while still archived, which then offered "Generate now" for it.
  const archived = master?.deleted === true;

  /** Runs a write with a busy flag and a toast on failure, so no action fails silently or twice. */
  async function guarded(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast({
        title: `${label} failed`,
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const changeStatus = (next: RecurringPaymentMaster["status"]) =>
    guarded("Status change", async () => {
      if (!master || !user || archived) return;
      await updateDoc(doc(db, RP_COLLECTIONS.masters, master.id), {
        status: next,
        updatedAt: serverTimestamp(),
        updatedBy: user.id,
      });
      await addDoc(
        collection(
          db,
          RP_COLLECTIONS.masters,
          master.id,
          RP_COLLECTIONS.auditLogs,
        ),
        {
          organizationId,
          masterId: master.id,
          action: `Master ${next.toLowerCase()}`,
          summary: `Status changed from ${master.status} to ${next}`,
          userId: user.id,
          userName: user.name,
          createdAt: serverTimestamp(),
        },
      );
      toast({ title: `Master ${next.toLowerCase()}` });
    });

  const duplicate = () =>
    guarded("Duplicate", async () => {
      if (!master || !user) return;
      // The copy is a fresh draft: none of the original's archive markers come with it.
      const { id, createdAt, updatedAt, deleted, ...data } = master as RecurringPaymentMaster & Record<string, unknown>;
      delete data.deletedAt;
      delete data.deletedBy;
      delete data.deletionReason;
      const copy = await addDoc(collection(db, RP_COLLECTIONS.masters), {
        ...data,
        title: `${master.title} (Copy)`,
        status: "Draft",
        deleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.id,
        updatedBy: user.id,
      });
      toast({ title: "Draft copy created" });
      router.push(`/recurring-payments/masters/${copy.id}/edit`);
    });

  const generate = () =>
    guarded("Generation", async () => {
      if (!master || !user || !nextCycle || archived) return;
      const outcome = await generateMasterCycle(
        master,
        nextCycle,
        await loadManualGenerationContext(organizationId, user),
      );
      if (outcome.kind === "exists") {
        toast({
          title: `The cycle ${nextCycle.billingPeriodStart} to ${nextCycle.billingPeriodEnd} already exists`,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: `Payment generated for ${nextCycle.billingPeriodStart} to ${nextCycle.billingPeriodEnd}`,
        description: outcome.activationStage
          ? `Sent to ${outcome.activationStage} for action.`
          : outcome.noAssignee
            ? "Due to enter the workflow, but nobody could be assigned — check the payment owner, or the first step's users in Settings › Workflow."
            : "Not due soon enough yet to enter the workflow — it'll activate automatically as the bill date approaches.",
        variant: outcome.noAssignee ? "destructive" : undefined,
      });
      router.push(`/recurring-payments/payments/${outcome.paymentId}`);
    });

  const archive = () =>
    guarded("Archive", async () => {
      if (
        !master ||
        !user ||
        archived ||
        !window.confirm(
          "Archive this master? Existing generated payments will remain available.",
        )
      )
        return;
      await updateDoc(doc(db, RP_COLLECTIONS.masters, master.id), {
        deleted: true,
        status: "Inactive",
        deletionReason: "Archived from master details",
        deletedAt: serverTimestamp(),
        deletedBy: user.id,
      });
      await addDoc(collection(db, RP_COLLECTIONS.masters, master.id, RP_COLLECTIONS.auditLogs), {
        organizationId,
        masterId: master.id,
        action: "Master archived",
        summary: "Archived from master details; generated payments retained",
        userId: user.id,
        userName: user.name,
        createdAt: serverTimestamp(),
      });
      toast({ title: "Master archived; historical payments retained" });
      router.push("/recurring-payments/masters");
    });

  if (loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  if (!master)
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-amber-500" />
          Master not found or access denied.
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        backHref="/recurring-payments/masters"
        backLabel="Back to masters"
        title={master.title}
        badge={<StatusBadge status={archived ? "Archived" : master.status} />}
        description={
          <>
            Master ID {master.id} · {master.category} ·{" "}
            {master.vendorName}
          </>
        }
        actions={
          <>
            {can("Edit", "Recurring Payments.Recurring Masters") && (
              <>
                {!archived && (
                  <>
                    <Link href={`/recurring-payments/masters/${master.id}/edit`}>
                      <Button variant="outline">
                        <Edit3 className="mr-2 h-4 w-4" />
                        Edit
                      </Button>
                    </Link>
                    {/* Pause/Resume only between Active and Paused — resuming a Draft would activate a
                        master that never passed the form's validation. */}
                    {["Active", "Paused"].includes(master.status) && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          changeStatus(
                            master.status === "Paused" ? "Active" : "Paused",
                          )
                        }
                      >
                        {master.status === "Paused" ? (
                          <Play className="mr-2 h-4 w-4" />
                        ) : (
                          <Pause className="mr-2 h-4 w-4" />
                        )}
                        {master.status === "Paused" ? "Resume" : "Pause"}
                      </Button>
                    )}
                  </>
                )}
                <Button variant="outline" disabled={busy} onClick={duplicate}>
                  <Copy className="mr-2 h-4 w-4" />
                  Duplicate
                </Button>
              </>
            )}
            {can("Add", "Recurring Payments.Payments") &&
              master.status === "Active" &&
              !archived &&
              nextCycle && (
                <Button
                  className="bg-emerald-500 hover:bg-emerald-400"
                  disabled={busy}
                  onClick={generate}
                >
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Generate now
                </Button>
              )}
            {can("Delete", "Recurring Payments.Recurring Masters") && !archived && (
              <Button variant="destructive" disabled={busy} onClick={archive}>
                <Trash2 className="mr-2 h-4 w-4" />
                Archive
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <HeaderStat
          label="Organization"
          value={master.organizationName || organizationId}
        />
        <HeaderStat label="Category" value={master.category} />
        <HeaderStat label="Vendor" value={master.vendorName} />
        <HeaderStat
          label="Next generation"
          value={nextCycle?.generationDate || "—"}
        />
        <HeaderStat
          label="Bill expected"
          value={nextCycle?.expectedBillDate || "—"}
        />
        <HeaderStat label="Next due date" value={nextCycle?.dueDate || "—"} />
      </div>
      <Tabs defaultValue="overview">
        <TabsList className="flex h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="payments">Generated Payments</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="automation">Automation History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Card>
            <CardContent className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Info
                label="Branch / project"
                value={
                  master.projectName || master.branchName || "Organization-wide"
                }
              />
              <Info label="Department" value={master.department || "—"} />
              <Info label="Frequency" value={master.frequency} />
              <Info label="Amount type" value={master.amountType} />
              <Info label="Expected amount" value={currency(master.amount)} />
              <Info
                label="Maximum amount"
                value={currency(master.maximumAmount || 0)}
              />
              <Info
                label="Account"
                value={maskAccount(master.accountNumber) || "—"}
              />
              <Info
                label="Ledger / cost centre"
                value={master.ledger || master.costCentre || "—"}
              />
              <Info
                label="Start / end"
                value={`${master.startDate}${master.endDate ? ` to ${master.endDate}` : ""}`}
              />
              <Info
                label="Auto-generation"
                value={
                  master.autoGenerationEnabled === false
                    ? "Disabled"
                    : "Enabled"
                }
              />
              <Info
                label="Variance tolerance"
                value={`${master.varianceTolerancePercent || 20}%`}
              />
              {/* The rule fields on their own don't answer "when is the next bill due?", so show the
                  rules as a sentence alongside the dates they actually resolve to this cycle. */}
              <div className="sm:col-span-2 lg:col-span-4 space-y-2 rounded-lg border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Schedule rules
                </p>
                <p className="text-sm">{describeRecurrence(master)}</p>
                {nextCycle && (
                  <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2 lg:grid-cols-4">
                    <Info
                      label="Current cycle"
                      value={`${nextCycle.billingPeriodStart} to ${nextCycle.billingPeriodEnd}`}
                    />
                    <Info
                      label="Bill expected"
                      value={nextCycle.expectedBillDate}
                    />
                    <Info label="Payment due" value={nextCycle.dueDate} />
                    <Info label="Overdue after" value={nextCycle.overdueDate} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="payments">
          <PaymentTable
            payments={payments}
            onOpen={(id) => router.push(`/recurring-payments/payments/${id}`)}
          />
        </TabsContent>
        <TabsContent value="documents">
          <Card>
            <CardContent className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {(master.masterDocuments || []).map((document, index) => (
                <a
                  className="flex gap-3 rounded-xl border p-4 hover:bg-muted"
                  href={document.reference}
                  target="_blank"
                  rel="noreferrer"
                  key={`${document.reference}-${index}`}
                >
                  <FileText className="h-5 w-5 text-indigo-600" />
                  <div>
                    <p className="font-medium">{document.documentType}</p>
                    <p className="text-xs text-muted-foreground">
                      {document.fileName} · version {document.version}
                    </p>
                  </div>
                </a>
              ))}
              {!(master.masterDocuments || []).length && (
                <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
                  No master documents uploaded.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="activity">
          <Card>
            <CardContent className="space-y-3 p-5">
              {audit.map((item) => (
                <div className="rounded-xl border p-3" key={item.id}>
                  <p className="font-medium">{item.action}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.summary}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.userName} · {formatTimestamp(item.createdAt)}
                  </p>
                </div>
              ))}
              {!audit.length && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No activity recorded.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="automation">
          <Card>
            <CardHeader>
              <CardTitle>Generation status</CardTitle>
              <CardDescription>
                Current calculated cycle and generation readiness
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Info
                label="Current cycle"
                value={nextCycle?.key || "Not applicable"}
              />
              <Info
                label="Billing period"
                value={
                  nextCycle
                    ? `${nextCycle.billingPeriodStart} to ${nextCycle.billingPeriodEnd}`
                    : "—"
                }
              />
              <Info
                label="Generation result"
                value={
                  archived
                    ? "Master archived — no further cycles are generated"
                    : !nextCycle
                      ? "No cycle left to generate"
                      : nextCycle.generationDate > recurringDateOnly(new Date())
                        ? `Next cycle generates on ${nextCycle.generationDate}`
                        : "Ready for generation"
                }
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PaymentTable({
  payments,
  onOpen,
}: {
  payments: PaymentObligation[];
  onOpen: (id: string) => void;
}) {
  return (
    <TableCard
      title="Generated payment obligations"
      description="One row per billing cycle generated from this master"
      count={payments.length}
      noun="cycle"
    >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cycle</TableHead>
              <TableHead>Billing period</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead className="text-right">Bill</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((payment) => (
              <TableRow
                key={payment.id}
                className="cursor-pointer"
                onClick={() => onOpen(payment.id)}
              >
                <TableCell>{payment.cycleKey}</TableCell>
                <TableCell>
                  {payment.billingPeriodStart} to {payment.billingPeriodEnd}
                </TableCell>
                <TableCell>{payment.dueDate}</TableCell>
                <TableCell className="text-right">
                  {currency(payment.billAmount || payment.expectedAmount)}
                </TableCell>
                <TableCell className="text-right">
                  {currency(payment.paidAmount)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={payment.status} />
                </TableCell>
              </TableRow>
            ))}
            {!payments.length && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-28 text-center text-muted-foreground"
                >
                  No payments have been generated.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
    </TableCard>
  );
}
function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3 shadow-sm">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium">{value}</p>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}
function formatTimestamp(value: unknown) {
  const timestamp = value as { toDate?: () => Date; seconds?: number } | null;
  if (timestamp?.toDate) return timestamp.toDate().toLocaleString("en-IN");
  if (timestamp?.seconds)
    return new Date(timestamp.seconds * 1000).toLocaleString("en-IN");
  return "—";
}
