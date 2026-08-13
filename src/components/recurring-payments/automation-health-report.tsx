"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { AlertTriangle, Download, Loader2, Printer } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DEFAULT_RECURRING_WORKFLOW,
  downloadCsv,
  resolveWorkflowActivation,
  RP_COLLECTIONS,
  currency,
  type PaymentObligation,
  type RecurringPaymentMaster,
  type RecurringWorkflowStep,
} from "@/lib/recurring-payments";
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
  const [activationDays, setActivationDays] = useState(7);
  const [loading, setLoading] = useState(true);

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
      ),
      onSnapshot(
        query(
          collection(db, RP_COLLECTIONS.payments),
          where("organizationId", "==", organizationId),
        ),
        (snapshot) => {
          setPayments(
            snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as PaymentObligation),
          );
          setLoading(false);
        },
        () => setLoading(false),
      ),
    ];
    (async () => {
      const [settingsSnap, workflowSnap] = await Promise.all([
        getDoc(doc(db, RP_COLLECTIONS.settings, organizationId.replace(/[^a-zA-Z0-9_-]/g, "_"))),
        getDoc(doc(db, "workflows", "recurring-payments-workflow")),
      ]);
      setActivationDays(
        Math.min(90, Math.max(0, Number(settingsSnap.data()?.automation?.workflowActivationDays ?? 7))),
      );
      setWorkflow((workflowSnap.data()?.steps as RecurringWorkflowStep[]) || DEFAULT_RECURRING_WORKFLOW);
    })();
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

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const stuck = useMemo(
    () =>
      payments
        .filter(
          (item) =>
            item.status === "Scheduled" &&
            !item.currentStepId &&
            !["Cancelled", "Waived"].includes(item.status),
        )
        .map((item) => ({ item, diagnosis: diagnose(item, workflow, activationDays, today) }))
        .sort((a, b) => a.item.dueDate.localeCompare(b.item.dueDate)),
    [payments, workflow, activationDays, today],
  );

  const stuckNeedingAttention = stuck.filter((row) => row.diagnosis.actionable);

  function exportCsv() {
    downloadCsv(
      `recurring-automation-health-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Payment", "Vendor", "Due Date", "Owner", "Diagnosis"],
      stuck.map(({ item, diagnosis }) => [
        item.title,
        item.vendorName,
        item.dueDate,
        users.find((entry) => entry.id === item.assignedTo)?.name || "Unassigned",
        diagnosis.label,
      ]),
    );
  }

  if (loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  if (!can("View", "Recurring Payments.Reports"))
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-amber-500" />
          <p className="font-semibold text-muted-foreground">
            You don&apos;t have permission to view this report.
          </p>
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-5">
      <Card className="border-0 bg-gradient-to-r from-slate-800 to-slate-950 text-white">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Automation & Generation Health</h1>
            <p className="text-sm text-slate-300">
              Which masters aren&apos;t generating, which obligations never reached a workflow
              queue, and why
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            {can("Export", "Recurring Payments.Reports") && (
              <Button variant="secondary" onClick={exportCsv}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print / PDF
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Active masters" value={String(masters.filter((item) => item.status === "Active").length)} />
        <Metric label="Not active (draft / paused / inactive)" value={String(masters.filter((item) => item.status !== "Active").length)} />
        <Metric label="Auto-generation disabled" value={String(masters.filter((item) => item.autoGenerationEnabled === false).length)} />
        <Metric
          label="Stuck obligations needing attention"
          value={String(stuckNeedingAttention.length)}
          tone={stuckNeedingAttention.length ? "warn" : undefined}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent automation runs</CardTitle>
          <CardDescription>Last {recentRuns.length} run(s) of the daily generation job</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
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
                        <Badge variant="destructive">{run.result.assigneeMissing}</Badge>
                      ) : (
                        run.result?.assigneeMissing ?? 0
                      )}
                    </TableCell>
                    <TableCell className="text-right">{run.result?.remindersQueued ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{run.status}</Badge>
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
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Obligations stuck at &quot;Scheduled&quot;</CardTitle>
          <CardDescription>
            Generated, but never entered a workflow step — diagnosed against the org&apos;s
            current activation window ({activationDays} day(s) before due)
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
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
                        <span className="text-amber-600">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {currency(item.billAmount || item.expectedAmount || 0)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant={diagnosis.actionable ? "destructive" : "outline"}>
                        {diagnosis.label}
                      </Badge>
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
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Masters not currently generating</CardTitle>
          <CardDescription>Draft, paused, inactive, or with auto-generation turned off</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
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
                      <Badge variant="outline">{item.status}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.autoGenerationEnabled === false ? (
                        <Badge variant="destructive">Disabled</Badge>
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function diagnose(
  payment: PaymentObligation,
  workflow: RecurringWorkflowStep[],
  activationDays: number,
  today: Date,
): { label: string; actionable: boolean } {
  if (!payment.dueDate) return { label: "Missing due date", actionable: true };
  const due = new Date(`${payment.dueDate}T00:00:00`);
  const daysUntilDue = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (daysUntilDue > activationDays)
    return {
      label: `Not due yet — activates automatically in ${daysUntilDue - activationDays} day(s)`,
      actionable: false,
    };
  const activation = resolveWorkflowActivation(workflow[0], payment, { activationDays, today });
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

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-xl font-bold ${tone === "warn" ? "text-amber-600" : ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
