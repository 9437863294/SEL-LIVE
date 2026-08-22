"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  AlertTriangle,
  ArrowLeft,
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
  buildPaymentObligationFields,
  DEFAULT_RECURRING_WORKFLOW,
  describeRecurrence,
  loadWorkingCalendar,
  matchApprovalRule,
  resolveWorkflowActivation,
  type ApprovalRule,
  type PaymentObligation,
  type RecurringPaymentMaster,
  type RecurringWorkflowStep,
  RP_COLLECTIONS,
  currency,
  maskAccount,
  visibleObligations,
} from "@/lib/recurring-payments";
import { addBusinessHours } from "@/lib/working-hours";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ModuleTableCard from "./module-table-card";

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

  // The cycle awaiting an obligation, not merely the one today falls inside — under arrears billing
  // those differ, and it's the former that "Generate now" must create and this page must report.
  const nextCycle = useMemo(
    () => (master ? actionableRecurringCycle(master, new Date()) : null),
    [master],
  );

  async function changeStatus(next: RecurringPaymentMaster["status"]) {
    if (!master || !user) return;
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
  }

  async function duplicate() {
    if (!master || !user) return;
    const { id, createdAt, updatedAt, ...data } = master;
    const copy = await addDoc(collection(db, RP_COLLECTIONS.masters), {
      ...data,
      title: `${master.title} (Copy)`,
      status: "Draft",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: user.id,
      updatedBy: user.id,
    });
    toast({ title: "Draft copy created" });
    router.push(`/recurring-payments/masters/${copy.id}/edit`);
  }

  async function generate() {
    if (!master || !nextCycle) return;
    const cycleKey = `${organizationId}_${master.id}_${nextCycle.key}`;
    const paymentRef = doc(
      db,
      RP_COLLECTIONS.payments,
      cycleKey.replace(/[^a-zA-Z0-9_-]/g, "_"),
    );
    if ((await getDoc(paymentRef)).exists())
      return toast({
        title: `The cycle ${nextCycle.billingPeriodStart} to ${nextCycle.billingPeriodEnd} already exists`,
        variant: "destructive",
      });
    const ruleSnapshot = await getDocs(
      query(
        collection(db, RP_COLLECTIONS.approvalRules),
        where("organizationId", "==", organizationId),
      ),
    );
    const amount = Number(master.amount || 0);
    const approvalRule = matchApprovalRule(
      ruleSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ApprovalRule),
      { amount, category: master.category, projectId: master.projectId, projectName: master.projectName },
    );
    const fields = buildPaymentObligationFields({
      organizationId,
      masterId: master.id,
      cycle: nextCycle,
      generatedAutomatically: false,
      title: master.title,
      category: master.category,
      vendorName: master.vendorName,
      branchId: master.branchId,
      branchName: master.branchName,
      projectId: master.projectId,
      projectName: master.projectName,
      departmentId: master.departmentId,
      department: master.department,
      costCentre: master.costCentre,
      ledger: master.ledger,
      amountType: master.amountType,
      description: master.description,
      accountNumber: master.accountNumber,
      amount,
      maximumAmount: master.maximumAmount,
      assignedTo: master.assignedTo,
      backupAssignedTo: master.backupAssignedTo,
      verifierId: master.verifierId,
      approverId: master.approverId,
      accountsProcessorId: master.accountsProcessorId,
      approvalRule,
    });
    // Don't leave this obligation stuck at "Scheduled" until the next automation run: if it's
    // already due soon enough per the org's workflow-activation window, enter it into the first
    // workflow step immediately, same as the daily automation job would.
    const [settingsSnap, workflowSnap, calendar] = await Promise.all([
      getDoc(doc(db, RP_COLLECTIONS.settings, organizationId.replace(/[^a-zA-Z0-9_-]/g, "_"))),
      getDoc(doc(db, "workflows", "recurring-payments-workflow")),
      loadWorkingCalendar(),
    ]);
    const activationDays = Math.min(90, Math.max(0, Number(settingsSnap.data()?.automation?.workflowActivationDays ?? 7)));
    const workflow = (workflowSnap.data()?.steps || DEFAULT_RECURRING_WORKFLOW) as RecurringWorkflowStep[];
    const activation = resolveWorkflowActivation(workflow[0], fields, { activationDays, today: new Date() });
    await setDoc(paymentRef, {
      ...fields,
      ...(activation
        ? {
            status: activation.status,
            workflowStatus: activation.workflowStatus,
            stage: activation.stage,
            currentStepId: activation.currentStepId,
            assignees: activation.assignees,
            workflowStartedAt: serverTimestamp(),
            stepEnteredAt: serverTimestamp(),
            // Real deadline, not resolveWorkflowActivation's naive approximation — accounts for
            // the org's configured working hours and holidays.
            workflowDeadline: Timestamp.fromMillis(
              addBusinessHours(new Date(), Math.max(1, workflow[0].tat), calendar.workingHours, calendar.holidays).getTime(),
            ),
          }
        : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    toast({
      title: "Current payment cycle generated",
      description: activation
        ? `Sent to ${activation.stage} for action.`
        : "Not due soon enough yet to enter the workflow — it'll activate automatically as the due date approaches.",
    });
    router.push(`/recurring-payments/payments/${paymentRef.id}`);
  }

  async function archive() {
    if (
      !master ||
      !user ||
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
    toast({ title: "Master archived; historical payments retained" });
    router.push("/recurring-payments/masters");
  }

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
      <Card className="border-0 bg-gradient-to-r from-indigo-800 to-violet-800 text-white">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-3">
              <Button
                size="icon"
                variant="secondary"
                onClick={() => router.back()}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold">{master.title}</h1>
                  <Badge className="bg-white/15 text-white">
                    {master.status}
                  </Badge>
                </div>
                <p className="text-sm text-indigo-100">
                  Master ID {master.id} · {master.category} ·{" "}
                  {master.vendorName}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {can("Edit", "Recurring Payments.Recurring Masters") && (
                <>
                  <Link href={`/recurring-payments/masters/${master.id}/edit`}>
                    <Button variant="secondary">
                      <Edit3 className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                  </Link>
                  <Button
                    variant="secondary"
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
                  <Button variant="secondary" onClick={duplicate}>
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate
                  </Button>
                </>
              )}
              {can("Add", "Recurring Payments.Payments") &&
                master.status === "Active" && (
                  <Button
                    className="bg-emerald-500 hover:bg-emerald-400"
                    onClick={generate}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Generate now
                  </Button>
                )}
              {can("Delete", "Recurring Payments.Recurring Masters") && (
                <Button variant="destructive" onClick={archive}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Archive
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Header
              label="Organization"
              value={master.organizationName || organizationId}
            />
            <Header label="Category" value={master.category} />
            <Header label="Vendor" value={master.vendorName} />
            <Header
              label="Next generation"
              value={nextCycle?.billingPeriodStart || "—"}
            />
            <Header
              label="Bill expected"
              value={nextCycle?.expectedBillDate || "—"}
            />
            <Header label="Next due date" value={nextCycle?.dueDate || "—"} />
          </div>
        </CardContent>
      </Card>
      <Tabs defaultValue="overview">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="payments">Generated Payments</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="automation">Automation History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Card>
            <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
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
                  <div className="grid gap-3 pt-1 sm:grid-cols-2 lg:grid-cols-4">
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
            <CardContent className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
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
            <CardContent className="grid gap-4 sm:grid-cols-3">
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
                  payments.some((item) =>
                    item.cycleKey.endsWith(nextCycle?.key || "__"),
                  )
                    ? "Current cycle already generated"
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
    <ModuleTableCard
      title="Generated payment obligations"
      description="One row per billing cycle generated from this master"
      count={payments.length}
      countNoun="cycle"
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
                  <Badge variant="outline">{payment.status}</Badge>
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
    </ModuleTableCard>
  );
}
function Header({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/10 p-3">
      <p className="text-[11px] text-indigo-200">{label}</p>
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
