"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { Download, History, Loader2, Printer } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DEFAULT_RECURRING_WORKFLOW,
  loadWorkingCalendar,
  matchesScopeFilter,
  RP_COLLECTIONS,
  currency,
  recurringDateOnly,
  type PaymentObligation,
  type RecurringWorkflowStep,
  visibleObligations,
} from "@/lib/recurring-payments";
import { exportWorkbook } from "@/lib/report-excel";
import { addBusinessHours } from "@/lib/working-hours";
import type { Holiday, WorkingHours } from "@/lib/types";
import { personOptionLabel } from '@/lib/people-directory';
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { TableCard } from "@/components/shared/table-card";
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
import { useGlobalScopes } from "./use-global-scopes";
import {
  ReportAccessDenied,
  ReportErrorBanner,
  ReportLoading,
  ReportMetricTile,
} from "./report-ui";

// The workflow's own "moves it forward" and "sends it back / ends it" actions — used to decide
// whether a workflowHistory entry represents a completed step, a rejection, or neither (e.g. "On
// Hold" / "Dispute", which don't leave the step). Matches FORWARD_ACTIONS / COMMENT_REQUIRED in
// professional-workflow-stage.tsx; kept here as a broader net since a custom workflow step name
// doesn't change what these action labels mean.
const COMPLETION_ACTIONS = ["Submit Bill", "Verify", "Approve", "Record Payment", "Close", "Create Expense Request"];
const REJECTION_ACTIONS = ["Reject", "Return for Correction", "Payment Failed"];

type StepStat = { total: number; completed: number; onTime: number; rejected: number };
type StepReport = Record<string, Record<string, StepStat>>;
type CompletionEvent = {
  paymentId: string;
  title: string;
  vendorName: string;
  stepName: string;
  action: string;
  userName: string;
  comment: string;
  timestamp: unknown;
  onTime: boolean | null;
};

function toMillis(value: unknown): number {
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

function buildStepReport(
  rows: PaymentObligation[],
  workflow: RecurringWorkflowStep[],
  users: Array<{ id: string; name: string }>,
  workingHours: WorkingHours | null,
  holidays: Holiday[],
): { stepReport: StepReport; completions: CompletionEvent[] } {
  const report: StepReport = {};
  const completions: CompletionEvent[] = [];
  const userMap = new Map(users.map(item => [item.id, item.name]));
  const stepMap = new Map(workflow.map(step => [step.name, step]));
  workflow.forEach(step => { report[step.name] = {}; });

  const ensure = (stepName: string, userName: string) => {
    report[stepName] ??= {};
    report[stepName][userName] ??= { total: 0, completed: 0, onTime: 0, rejected: 0 };
    return report[stepName][userName];
  };

  rows.forEach(payment => {
    // In timestamp order, so "the latest outcome wins" below really is the latest (a stable sort
    // keeps the stored order for entries sharing a timestamp).
    const history = [...(payment.workflowHistory || [])].sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp));
    let previousTime = toMillis(payment.workflowStartedAt) || toMillis(payment.createdAt) || 0;
    const countedTotal = new Set<string>();
    // Total counts each payment once per step/user, so Done/On time/Rejected must too — a step
    // returned for correction and resubmitted would otherwise count two completions against one
    // payment, pushing Done past Total and the on-time rate past 100%. The latest outcome wins.
    const outcomes = new Map<string, { stat: StepStat; completed: boolean; onTime: boolean | null; rejected: boolean }>();

    history.forEach(entry => {
      const userName = entry.userName || userMap.get(entry.userId) || "Unknown user";
      const stat = ensure(entry.stepName, userName);
      const key = `${entry.stepName}__${userName}`;
      if (!countedTotal.has(key)) { stat.total++; countedTotal.add(key); }

      const isCompletion = COMPLETION_ACTIONS.includes(entry.action);
      const isRejection = REJECTION_ACTIONS.includes(entry.action);
      const entryMillis = toMillis(entry.timestamp);
      let onTime: boolean | null = null;
      const outcome = outcomes.get(key) ?? { stat, completed: false, onTime: null, rejected: false };
      outcomes.set(key, outcome);

      if (isCompletion) {
        const step = stepMap.get(entry.stepName);
        if (step && previousTime) {
          // Deadline as of when this step was entered, computed the same working-hours-aware
          // way it's stored on the obligation at write time — a raw `+ tat hours` comparison
          // would call a step "on time" or "late" inconsistently with weekends/holidays.
          const stepDeadlineMillis = addBusinessHours(new Date(previousTime), step.tat, workingHours, holidays).getTime();
          onTime = entryMillis <= stepDeadlineMillis;
        }
        // Completed and rejected are one outcome, not two sticky flags — otherwise a rejected then
        // resubmitted step counts in both Done and Rejected, and the two exceed Total.
        outcome.completed = true;
        outcome.rejected = false;
        outcome.onTime = onTime;
        completions.push({ paymentId: payment.id, title: payment.title, vendorName: payment.vendorName, stepName: entry.stepName, action: entry.action, userName, comment: entry.comment, timestamp: entry.timestamp, onTime });
      } else if (isRejection) {
        outcome.rejected = true;
        outcome.completed = false;
        outcome.onTime = null;
        completions.push({ paymentId: payment.id, title: payment.title, vendorName: payment.vendorName, stepName: entry.stepName, action: entry.action, userName, comment: entry.comment, timestamp: entry.timestamp, onTime: null });
      }
      if (isCompletion || isRejection) previousTime = entryMillis || previousTime;
    });
    outcomes.forEach(outcome => {
      if (outcome.completed) outcome.stat.completed++;
      if (outcome.completed && outcome.onTime) outcome.stat.onTime++;
      if (outcome.rejected) outcome.stat.rejected++;
    });

    // Still sitting at a step counts toward that step's workload even though it hasn't
    // completed yet — otherwise "Total" would only ever reflect finished work.
    if (payment.currentStepId) {
      const currentStep = workflow.find(step => step.id === payment.currentStepId);
      if (currentStep) {
        (payment.assignees || []).forEach(userId => {
          const userName = userMap.get(userId) || "Unassigned";
          const stat = ensure(currentStep.name, userName);
          const key = `${currentStep.name}__${userName}`;
          if (!countedTotal.has(key)) { stat.total++; countedTotal.add(key); }
        });
      }
    }
  });

  completions.sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp));
  return { stepReport: report, completions };
}

/**
 * The recurring-payments analog of Site Fund Requisition's "Site Fund Summary" report — per-step,
 * per-user workload/completion/on-time/rejection counts, plus (since payments already record an
 * exact `workflowHistory` timestamp per action, unlike requisitions which had to reconstruct it) a
 * literal timeline of every completion event: what finished, at which step, by whom, and exactly
 * when.
 */
const DEFAULT_FILTERS = {
  year: "all",
  month: "all",
  project: "all",
  department: "all",
  category: "all",
  owner: "all",
};

export default function WorkflowCompletionReport() {
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const organizationId = user?.organizationId || "default";
  const { activeProjects, activeDepartments } = useGlobalScopes();
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [workflow, setWorkflow] = useState<RecurringWorkflowStep[]>(DEFAULT_RECURRING_WORKFLOW);
  const [workingHours, setWorkingHours] = useState<WorkingHours | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  useEffect(() => {
    getDoc(doc(db, "workflows", "recurring-payments-workflow")).then(snapshot => {
      const steps = snapshot.data()?.steps as RecurringWorkflowStep[] | undefined;
      if (steps?.length) setWorkflow(steps);
    });
    loadWorkingCalendar().then(calendar => {
      setWorkingHours(calendar.workingHours);
      setHolidays(calendar.holidays);
    });
    return onSnapshot(
      query(collection(db, RP_COLLECTIONS.payments), where("organizationId", "==", organizationId)),
      snapshot => {
        setPayments(visibleObligations(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as PaymentObligation))));
        setLoading(false);
      },
      () => {
        setLoading(false);
        setLoadError(true);
      },
    );
  }, [organizationId]);

  const years = useMemo(
    () => [...new Set(payments.map(item => item.dueDate?.slice(0, 4)).filter(Boolean))].sort().reverse(),
    [payments],
  );
  const categories = useMemo(
    () => [...new Set(payments.map(item => item.category).filter(Boolean))].sort(),
    [payments],
  );

  const rows = useMemo(
    () => payments.filter(item => {
      if (filters.year !== "all" && item.dueDate?.slice(0, 4) !== filters.year) return false;
      if (filters.month !== "all" && item.dueDate?.slice(5, 7) !== filters.month) return false;
      if (filters.category !== "all" && item.category !== filters.category) return false;
      if (filters.owner !== "all" && item.assignedTo !== filters.owner) return false;
      if (!matchesScopeFilter(filters.project, { id: item.projectId, name: item.projectName }, activeProjects.map(project => ({ id: project.id, name: project.projectName })))) return false;
      if (!matchesScopeFilter(filters.department, { id: item.departmentId, name: item.department }, activeDepartments.map(department => ({ id: department.id, name: department.name })))) return false;
      return true;
    }),
    [payments, filters, activeProjects, activeDepartments],
  );

  const activeFilterCount = (Object.keys(DEFAULT_FILTERS) as Array<keyof typeof DEFAULT_FILTERS>)
    .filter(key => filters[key] !== DEFAULT_FILTERS[key]).length;

  const summary = useMemo(() => {
    const totalAmount = rows.reduce((sum, item) => sum + Number(item.billAmount || item.expectedAmount || 0), 0);
    const paidAmount = rows.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
    const outstanding = rows.reduce((sum, item) => sum + Math.max(0, Number(item.billAmount || item.expectedAmount || 0) - Number(item.settledAmount || item.paidAmount || 0)), 0);
    const rejected = rows.filter(item => ["Rejected", "Disputed", "Payment Failed"].includes(item.status)).length;
    return { total: rows.length, totalAmount, paidAmount, outstanding, rejected };
  }, [rows]);

  const { stepReport, completions } = useMemo(
    () => buildStepReport(rows, workflow, users, workingHours, holidays),
    [rows, workflow, users, workingHours, holidays],
  );

  async function exportReport() {
    setIsExporting(true);
    try {
      await exportWorkbook(`recurring-workflow-completions-${recurringDateOnly(new Date())}.xlsx`, [
        {
          name: "Completion timeline",
          columns: [
            { header: "Completed At", key: "completedAt", width: 22 },
            { header: "Payment", key: "title", width: 30 },
            { header: "Vendor", key: "vendor", width: 24 },
            { header: "Step", key: "step", width: 20 },
            { header: "Action", key: "action", width: 18 },
            { header: "By", key: "by", width: 20 },
            { header: "On Time", key: "onTime", width: 12 },
            { header: "Comment", key: "comment", width: 30 },
          ],
          rows: completions.map(item => ({
            completedAt: formatTimestamp(item.timestamp),
            title: item.title,
            vendor: item.vendorName,
            step: item.stepName,
            action: item.action,
            by: item.userName,
            onTime: item.onTime === null ? "—" : item.onTime ? "Yes" : "No",
            comment: item.comment || "",
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
        title="Workflow Completion Summary"
        meta={[{
          label: "Total value",
          value: currency(summary.totalAmount),
          hint: `${summary.total} payment(s)`,
        }]}
        description="Totals, step-wise workload and on-time performance, and exactly what completed when"
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

      <FilterBar className="print:hidden" activeCount={activeFilterCount} onClear={() => setFilters(DEFAULT_FILTERS)}>
        <Select value={filters.year} onValueChange={year => setFilters(current => ({ ...current, year }))}>
          <SelectTrigger aria-label="Year"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All years</SelectItem>
            {years.map(year => <SelectItem value={year} key={year}>{year}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.month} onValueChange={month => setFilters(current => ({ ...current, month }))}>
          <SelectTrigger aria-label="Month"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All months</SelectItem>
            {Array.from({ length: 12 }, (_, index) => (
              <SelectItem value={String(index + 1).padStart(2, "0")} key={index}>
                {new Date(0, index).toLocaleString("en-IN", { month: "long" })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.project} onValueChange={project => setFilters(current => ({ ...current, project }))}>
          <SelectTrigger aria-label="Project"><SelectValue placeholder="All projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {activeProjects.map(project => <SelectItem value={project.id} key={project.id}>{project.projectName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.department} onValueChange={department => setFilters(current => ({ ...current, department }))}>
          <SelectTrigger aria-label="Department"><SelectValue placeholder="All departments" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {activeDepartments.map(department => <SelectItem value={department.id} key={department.id}>{department.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.category} onValueChange={category => setFilters(current => ({ ...current, category }))}>
          <SelectTrigger aria-label="Category"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(category => <SelectItem value={category} key={category}>{category}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.owner} onValueChange={owner => setFilters(current => ({ ...current, owner }))}>
          <SelectTrigger aria-label="Owner"><SelectValue placeholder="All owners" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            {users.map(entry => <SelectItem value={entry.id} key={entry.id}>{personOptionLabel(entry)}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterBar>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <ReportMetricTile label="Total payments" value={String(summary.total)} />
        <ReportMetricTile label="Total value" value={currency(summary.totalAmount)} />
        <ReportMetricTile label="Paid" value={currency(summary.paidAmount)} />
        <ReportMetricTile label="Outstanding" value={currency(summary.outstanding)} />
        <ReportMetricTile label="Rejected / failed" value={String(summary.rejected)} tone={summary.rejected ? "warning" : "good"} />
      </div>

      <SectionHeader
        className="mb-0"
        title="Step-wise workload"
        description="Who handled each step, how many they completed, and how many stayed within the step's TAT."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {workflow.map(step => {
          const stepData = stepReport[step.name];
          const entries = stepData ? Object.entries(stepData).filter(([, stat]) => stat.total > 0) : [];
          if (!entries.length) return null;
          return (
            <TableCard key={step.id} title={step.name} scroll="natural">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Done</TableHead>
                    <TableHead className="text-right">On time</TableHead>
                    <TableHead className="text-right">Rejected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(([userName, stat]) => (
                    <TableRow key={userName}>
                      <TableCell>{userName}</TableCell>
                      <TableCell className="text-right">{stat.total}</TableCell>
                      <TableCell className="text-right">{stat.completed}</TableCell>
                      <TableCell className="text-right">{stat.onTime}</TableCell>
                      <TableCell className="text-right">{stat.rejected || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          );
        })}
        {!workflow.some(step => stepReport[step.name] && Object.keys(stepReport[step.name]).length) && (
          <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No workflow activity matches the selected filters.</p>
        )}
      </div>

      <TableCard
        title="Completion timeline"
        icon={History}
        description="Every completed or rejected step, exactly when it happened"
        count={completions.length}
        noun="event"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Completed at</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Step</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>By</TableHead>
              <TableHead>On time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {completions.map((item, index) => (
              <TableRow key={`${item.paymentId}-${index}`}>
                <TableCell className="whitespace-nowrap">{formatTimestamp(item.timestamp)}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">{item.title}</TableCell>
                <TableCell className="whitespace-nowrap">{item.vendorName}</TableCell>
                <TableCell className="whitespace-nowrap">{item.stepName}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <StatusBadge tone={REJECTION_ACTIONS.includes(item.action) ? "danger" : "neutral"}>{item.action}</StatusBadge>
                </TableCell>
                <TableCell className="whitespace-nowrap">{item.userName}</TableCell>
                <TableCell className="whitespace-nowrap">{item.onTime === null ? "—" : item.onTime ? "Yes" : "No"}</TableCell>
              </TableRow>
            ))}
            {!completions.length && (
              <TableRow>
                <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">No completed steps match the selected filters.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}

