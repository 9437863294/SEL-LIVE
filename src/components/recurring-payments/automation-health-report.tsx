"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { Download, Loader2, Printer } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DEFAULT_RECURRING_WORKFLOW,
  resolveWorkflowActivation,
  RP_COLLECTIONS,
  currency,
  recurringDateOnly,
  type PaymentObligation,
  type RecurringPaymentMaster,
  type RecurringWorkflowStep,
  visibleObligations,
} from "@/lib/recurring-payments";
import { exportWorkbook } from "@/lib/report-excel";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { TableCard } from "@/components/shared/table-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ReportAccessDenied,
  ReportErrorBanner,
  ReportLoading,
  ReportMetricTile,
} from "./report-ui";
import { PageHeader } from "@/components/shared/page-header";

type AutomationLog = {
  id: string;
  organizationId: string;
  jobName: string;
  startedAt?: unknown;
  status: string;
  result?: {
    generated?: number;
    skipped?: number;
    automationDisabled?: number;
    workflowTriggered?: number;
    assigneeMissing?: number;
    remindersQueued?: number;
    checked?: number;
  };
};

/**
 * Answers "is the automation actually working" — the question every other report in this module
 * assumes the answer to is yes. Reads `recurringPaymentAutomationLogs` (the daily cron's own run
 * history — never surfaced anywhere before this) alongside masters that aren't currently
 * generating and obligations stuck at "Scheduled" with no workflow step, diagnosing each stuck
 * item with the same `resolveWorkflowActivation` logic the generation route itself uses.
 */
export default function AutomationHealthReport() {
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const organizationId = user?.organizationId || "default";
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [masters, setMasters] = useState<RecurringPaymentMaster[]>([]);
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [workflow, setWorkflow] = useState<RecurringWorkflowStep[]>(DEFAULT_RECURRING_WORKFLOW);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    // The daily cron logs its runs under organizationId "all" (it isn't scoped to one org),
    // while a manually-triggered run logs under the actual org — so both have to be included or
    // the daily job's own history would never show up here.
    const stops = [
      onSnapshot(
        query(
          collection(db, RP_COLLECTIONS.automationLogs),
          where("organizationId", "in", [organizationId, "all"]),
        ),
        (snapshot) =>
          setLogs(
            snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AutomationLog),
          ),
        () => setLoadError(true),
      ),
      onSnapshot(
        query(
          collection(db, RP_COLLECTIONS.masters),
          where("organizationId", "==", organizationId),
        ),
        (snapshot) =>
          setMasters(
            snapshot.docs
              .map((item) => ({ id: item.id, ...item.data() }) as RecurringPaymentMaster)
              .filter((item) => !item.deleted),
          ),
        () => setLoadError(true),
      ),
      onSnapshot(
        query(
          collection(db, RP_COLLECTIONS.payments),
          where("organizationId", "==", organizationId),
        ),
        (snapshot) => {
          setPayments(
            visibleObligations(
              snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as PaymentObligation),
            ),
          );
          setLoading(false);
        },
        () => {
          setLoading(false);
          setLoadError(true);
        },
      ),
    ];
    (async () => {
      const workflowSnap = await getDoc(doc(db, "workflows", "recurring-payments-workflow"));
      // An empty saved list falls back too — `[]` is truthy, and with no first step every stuck
      // item would read as "No assignee resolved".
      const steps = workflowSnap.data()?.steps as RecurringWorkflowStep[] | undefined;
      setWorkflow(steps?.length ? steps : DEFAULT_RECURRING_WORKFLOW);
    })().catch(() => setLoadError(true));
    return () => stops.forEach((stop) => stop());
  }, [organizationId]);

  const recentRuns = useMemo(
    () =>
      [...logs]
        .sort((a, b) => millis(b.startedAt) - millis(a.startedAt))
        .slice(0, 20),
    [logs],
  );

  const inactiveMasters = useMemo(
    () => masters.filter((item) => item.status !== "Active" || item.autoGenerationEnabled === false),
    [masters],
  );

  const stuck = useMemo(
    () =>
      payments
        .filter(
          (item) =>
            item.status === "Scheduled" &&
            !item.currentStepId &&
            !["Cancelled", "Waived"].includes(item.status),
        )
        .map((item) => ({ item, diagnosis: diagnose(item, workflow) }))
        .sort((a, b) => a.item.dueDate.localeCompare(b.item.dueDate)),
    [payments, workflow],
  );

  const stuckNeedingAttention = stuck.filter((row) => row.diagnosis.actionable);

  async function exportReport() {
    setIsExporting(true);
    try {
      await exportWorkbook(`recurring-automation-health-${recurringDateOnly(new Date())}.xlsx`, [
        {
          name: "Stuck obligations",
          columns: [
            { header: "Payment", key: "title", width: 30 },
            { header: "Vendor", key: "vendor", width: 24 },
            { header: "Due Date", key: "dueDate", width: 14 },
            { header: "Owner", key: "owner", width: 20 },
            { header: "Amount", key: "amount", width: 14 },
            { header: "Diagnosis", key: "diagnosis", width: 40 },
          ],
          rows: stuck.map(({ item, diagnosis }) => ({
            title: item.title,
            vendor: item.vendorName,
            dueDate: item.dueDate,
            owner: users.find((entry) => entry.id === item.assignedTo)?.name || "Unassigned",
            amount: item.billAmount || item.expectedAmount || 0,
            diagnosis: diagnosis.label,
          })),
        },
        {
          name: "Masters not generating",
          columns: [
            { header: "Master", key: "title", width: 30 },
            { header: "Category", key: "category", width: 20 },
            { header: "Vendor", key: "vendor", width: 24 },
            { header: "Status", key: "status", width: 16 },
            { header: "Auto-generation", key: "autoGeneration", width: 18 },
          ],
          rows: inactiveMasters.map((item) => ({
            title: item.title,
            category: item.category,
            vendor: item.vendorName,
            status: item.status,
            autoGeneration: item.autoGenerationEnabled === false ? "Disabled" : "Enabled",
          })),
        },
      ]);
    } finally {
      setIsExporting(false);
    }
  }

  if (loading) return <ReportLoading />;
  if (!can("View", "Recurring Payments.Reports")) return <ReportAccessDenied />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Automation & Generation Health"
        // This report exists to surface problems, so it leads with the count that needs someone
        // to act rather than with a total that looks reassuring.
        meta={[{
          label: "Needing attention",
          value: String(stuckNeedingAttention.length),
          hint: `of ${stuck.length} obligation(s) stuck before a workflow queue`,
        }]}
        description="Which masters aren't generating, which obligations never reached a workflow queue, and why"
        actions={
          <>
            {can("Export", "Recurring Payments.Reports") && (
              <Button variant="secondary" onClick={exportReport} disabled={isExporting}>
                {isExporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Export Excel
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print / PDF
            </Button>
          </>
        }
      />
      {loadError && <ReportErrorBanner />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ReportMetricTile label="Active masters" value={String(masters.filter((item) => item.status === "Active").length)} />
        <ReportMetricTile label="Not active (draft / paused / inactive)" value={String(masters.filter((item) => item.status !== "Active").length)} />
        <ReportMetricTile label="Auto-generation disabled" value={String(masters.filter((item) => item.autoGenerationEnabled === false).length)} />
        <ReportMetricTile
          label="Stuck obligations needing attention"
          value={String(stuckNeedingAttention.length)}
          tone={stuckNeedingAttention.length ? "warning" : "good"}
        />
      </div>
      <TableCard
        title="Recent automation runs"
        description={<>Last {recentRuns.length} run(s) of the daily generation job</>}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Job</TableHead>
              <TableHead className="text-right">Checked</TableHead>
              <TableHead className="text-right">Generated</TableHead>
              <TableHead className="text-right">Workflow triggered</TableHead>
              <TableHead className="text-right">Assignee missing</TableHead>
              <TableHead className="text-right">Reminders queued</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentRuns.map((run) => (
              <TableRow key={run.id}>
                <TableCell>{formatTimestamp(run.startedAt)}</TableCell>
                <TableCell>{run.jobName}</TableCell>
                <TableCell className="text-right">{run.result?.checked ?? "—"}</TableCell>
                <TableCell className="text-right">{run.result?.generated ?? "—"}</TableCell>
                <TableCell className="text-right">{run.result?.workflowTriggered ?? "—"}</TableCell>
                <TableCell className="text-right">
                  {run.result?.assigneeMissing ? (
                    <StatusBadge tone="danger">{run.result.assigneeMissing}</StatusBadge>
                  ) : (
                    run.result?.assigneeMissing ?? 0
                  )}
                </TableCell>
                <TableCell className="text-right">{run.result?.remindersQueued ?? "—"}</TableCell>
                <TableCell>
                  <StatusBadge status={run.status} />
                </TableCell>
              </TableRow>
            ))}
            {!recentRuns.length && (
              <TableRow>
                <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                  No automation runs recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableCard>
      <TableCard
        title={<>Obligations stuck at &quot;Scheduled&quot;</>}
        count={stuck.length}
        noun="obligation"
        description={
          <>
            Generated, but never entered a workflow step — each enters its first step on the next
            automation run once it has an owner
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Due date</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Diagnosis</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stuck.map(({ item, diagnosis }) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap">{item.dueDate || "—"}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">{item.title}</TableCell>
                <TableCell className="whitespace-nowrap">{item.vendorName}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {users.find((entry) => entry.id === item.assignedTo)?.name || (
                    <StatusBadge tone="warning">Unassigned</StatusBadge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {currency(item.billAmount || item.expectedAmount || 0)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <StatusBadge tone={diagnosis.actionable ? "danger" : "neutral"}>
                    {diagnosis.label}
                  </StatusBadge>
                </TableCell>
              </TableRow>
            ))}
            {!stuck.length && (
              <TableRow>
                <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                  Nothing is stuck — every generated obligation has entered its workflow.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableCard>
      <TableCard
        title="Masters not currently generating"
        count={inactiveMasters.length}
        noun="master"
        description="Draft, paused, inactive, or with auto-generation turned off"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Master</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Auto-generation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inactiveMasters.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap">{item.title}</TableCell>
                <TableCell className="whitespace-nowrap">{item.category}</TableCell>
                <TableCell className="whitespace-nowrap">{item.vendorName}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <StatusBadge status={item.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {item.autoGenerationEnabled === false ? (
                    <StatusBadge tone="danger">Disabled</StatusBadge>
                  ) : (
                    "Enabled"
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!inactiveMasters.length && (
              <TableRow>
                <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                  Every master is active and auto-generating.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}

function diagnose(
  payment: PaymentObligation,
  workflow: RecurringWorkflowStep[],
): { label: string; actionable: boolean } {
  if (!payment.dueDate) return { label: "Missing due date", actionable: true };
  // The same rule the generation route applies: there is no waiting window, so a Scheduled
  // obligation either has an owner and activates on the next run, or needs one assigned.
  const activation = resolveWorkflowActivation(workflow[0], payment);
  if (!activation)
    return {
      label: "No assignee resolved — check the master's owner / backup owner",
      actionable: true,
    };
  return { label: "Ready — will activate on the next automation run", actionable: false };
}

function millis(value: unknown): number {
  const data = value as { toMillis?: () => number; seconds?: number } | null | undefined;
  if (data?.toMillis) return data.toMillis();
  if (data?.seconds) return data.seconds * 1000;
  return 0;
}

function formatTimestamp(value: unknown): string {
  const data = value as { toDate?: () => Date; seconds?: number } | null | undefined;
  const date = data?.toDate ? data.toDate() : data?.seconds ? new Date(data.seconds * 1000) : null;
  return date ? date.toLocaleString("en-IN") : "—";
}
