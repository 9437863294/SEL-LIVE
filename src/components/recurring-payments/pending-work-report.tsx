"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { Clock, Download, Loader2, Printer } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DEFAULT_RECURRING_WORKFLOW,
  matchesScopeFilter,
  RP_COLLECTIONS,
  currency,
  recurringDateOnly,
  type PaymentObligation,
  type RecurringWorkflowStep,
  visibleObligations,
} from "@/lib/recurring-payments";
import { exportWorkbook } from "@/lib/report-excel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import CollapsibleFilterCard from "./collapsible-filter-card";
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
import { useGlobalScopes } from "./use-global-scopes";
import {
  ReportAccessDenied,
  ReportErrorBanner,
  ReportHeader,
  ReportLoading,
  ReportMetricTile,
} from "./report-ui";

/**
 * The one question none of this module's other reports answer: "what's stuck right now, at which
 * step, for how long, and who's sitting on it." Workflow Completion Summary is retrospective (what
 * finished, and when); Automation Health only checks obligations that never entered the workflow
 * at all. This covers every obligation currently *inside* the workflow (`workflowStatus ===
 * "In Progress"`, has a `currentStepId`), aged from `stepEnteredAt`, against that step's own TAT.
 */
const DEFAULT_FILTERS = {
  step: "all",
  project: "all",
  department: "all",
  category: "all",
  owner: "all",
};

type PendingRow = {
  id: string;
  title: string;
  vendorName: string;
  category: string;
  stepName: string;
  stepTatHours: number;
  assigneeNames: string[];
  enteredAtMillis: number;
  ageHours: number;
  tatBreached: boolean;
  amount: number;
};

function toMillis(value: unknown): number {
  const data = value as { toMillis?: () => number; seconds?: number } | null | undefined;
  if (data?.toMillis) return data.toMillis();
  if (data?.seconds) return data.seconds * 1000;
  return 0;
}

function formatAge(hours: number): string {
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const remHours = Math.round(hours % 24);
  return `${days}d ${remHours}h`;
}

export default function PendingWorkReport() {
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const organizationId = user?.organizationId || "default";
  const { activeProjects, activeDepartments } = useGlobalScopes();
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [workflow, setWorkflow] = useState<RecurringWorkflowStep[]>(DEFAULT_RECURRING_WORKFLOW);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [, forceTick] = useState(0);

  useEffect(() => {
    getDoc(doc(db, "workflows", "recurring-payments-workflow")).then((snapshot) => {
      const steps = snapshot.data()?.steps as RecurringWorkflowStep[] | undefined;
      if (steps?.length) setWorkflow(steps);
    });
    return onSnapshot(
      query(collection(db, RP_COLLECTIONS.payments), where("organizationId", "==", organizationId)),
      (snapshot) => {
        setPayments(visibleObligations(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as PaymentObligation)));
        setLoading(false);
      },
      () => {
        setLoading(false);
        setLoadError(true);
      },
    );
  }, [organizationId]);

  // "Age" is a moving target — re-render periodically so the on-screen hours/days keep climbing
  // even if nobody touches a filter (this is the one report in the module where staleness itself
  // is the thing being measured).
  useEffect(() => {
    const interval = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  const userMap = useMemo(() => new Map(users.map((item) => [item.id, item.name])), [users]);
  const stepMap = useMemo(() => new Map(workflow.map((step) => [step.id, step])), [workflow]);

  const pending = useMemo(() => {
    const now = Date.now();
    return payments
      .filter((item) => item.workflowStatus === "In Progress" && item.currentStepId)
      .map((item): PendingRow | null => {
        const step = stepMap.get(item.currentStepId as string);
        const enteredAtMillis = toMillis(item.stepEnteredAt) || toMillis(item.workflowStartedAt) || 0;
        const ageHours = enteredAtMillis ? (now - enteredAtMillis) / 3_600_000 : 0;
        // Compares against the obligation's own stored `workflowDeadline` — already computed at
        // write time from the org's working hours/holidays via `addBusinessHours` — rather than
        // re-deriving "raw elapsed hours vs. step TAT", which would ignore weekends/holidays and
        // disagree with the deadline actually shown elsewhere for the same obligation.
        const deadlineMillis = toMillis(item.workflowDeadline);
        return {
          id: item.id,
          title: item.title,
          vendorName: item.vendorName,
          category: item.category,
          stepName: step?.name || item.stage || "Unknown step",
          stepTatHours: step?.tat ?? 0,
          assigneeNames: (item.assignees || []).map((userId) => userMap.get(userId) || "Unassigned"),
          enteredAtMillis,
          ageHours,
          tatBreached: deadlineMillis ? now > deadlineMillis : step ? ageHours > step.tat : false,
          amount: Number(item.billAmount || item.expectedAmount || 0),
        };
      })
      .filter((row): row is PendingRow => row !== null);
  }, [payments, stepMap, userMap]);

  const filtered = useMemo(() => {
    const byId = new Map(payments.map((item) => [item.id, item]));
    return pending
      .filter((row) => {
        if (filters.step !== "all" && row.stepName !== filters.step) return false;
        if (filters.category !== "all" && row.category !== filters.category) return false;
        const source = byId.get(row.id);
        if (
          !matchesScopeFilter(
            filters.project,
            { id: source?.projectId, name: source?.projectName },
            activeProjects.map((project) => ({ id: project.id, name: project.projectName })),
          )
        )
          return false;
        if (
          !matchesScopeFilter(
            filters.department,
            { id: source?.departmentId, name: source?.department },
            activeDepartments.map((department) => ({ id: department.id, name: department.name })),
          )
        )
          return false;
        if (filters.owner !== "all" && !(source?.assignees || []).includes(filters.owner)) return false;
        return true;
      })
      .sort((a, b) => b.ageHours - a.ageHours);
  }, [pending, payments, filters, activeProjects, activeDepartments]);

  const activeFilterCount = (Object.keys(DEFAULT_FILTERS) as Array<keyof typeof DEFAULT_FILTERS>)
    .filter((key) => filters[key] !== DEFAULT_FILTERS[key]).length;

  const stepNames = useMemo(() => [...new Set(pending.map((row) => row.stepName))].sort(), [pending]);
  const categories = useMemo(() => [...new Set(payments.map((item) => item.category).filter(Boolean))].sort(), [payments]);

  const summary = useMemo(
    () => ({
      total: filtered.length,
      breached: filtered.filter((row) => row.tatBreached).length,
      oldestHours: filtered.reduce((max, row) => Math.max(max, row.ageHours), 0),
      value: filtered.reduce((sum, row) => sum + row.amount, 0),
    }),
    [filtered],
  );

  async function exportReport() {
    setIsExporting(true);
    try {
      await exportWorkbook(`recurring-pending-work-${recurringDateOnly(new Date())}.xlsx`, [
        {
          name: "Pending Work Aging",
          columns: [
            { header: "Payment", key: "title", width: 30 },
            { header: "Vendor", key: "vendorName", width: 24 },
            { header: "Category", key: "category", width: 20 },
            { header: "Step", key: "stepName", width: 20 },
            { header: "Assigned To", key: "assignees", width: 24 },
            { header: "Age", key: "age", width: 14 },
            { header: "TAT Breached", key: "tatBreached", width: 14 },
            { header: "Amount", key: "amount", width: 14 },
          ],
          rows: filtered.map((row) => ({
            title: row.title,
            vendorName: row.vendorName,
            category: row.category,
            stepName: row.stepName,
            assignees: row.assigneeNames.join(", "),
            age: formatAge(row.ageHours),
            tatBreached: row.tatBreached ? "Yes" : "No",
            amount: row.amount,
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
      <ReportHeader
        title="Pending Work Aging"
        description="Every obligation currently sitting inside the workflow — which step, how long, and who's holding it"
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
        <ReportMetricTile label="Currently pending" value={String(summary.total)} icon={Clock} tone="neutral" />
        <ReportMetricTile
          label="Past step TAT"
          value={String(summary.breached)}
          tone={summary.breached ? "critical" : "good"}
        />
        <ReportMetricTile label="Oldest item" value={summary.total ? formatAge(summary.oldestHours) : "—"} tone={summary.oldestHours > 48 ? "warning" : "neutral"} />
        <ReportMetricTile label="Value awaiting action" value={currency(summary.value)} tone="neutral" />
      </div>
      <CollapsibleFilterCard activeCount={activeFilterCount} onClear={() => setFilters(DEFAULT_FILTERS)}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Field label="Step">
            <Select value={filters.step} onValueChange={(step) => setFilters((current) => ({ ...current, step }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All steps" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All steps</SelectItem>
                {stepNames.map((step) => <SelectItem value={step} key={step}>{step}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Category">
            <Select value={filters.category} onValueChange={(category) => setFilters((current) => ({ ...current, category }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((category) => <SelectItem value={category} key={category}>{category}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Project">
            <Select value={filters.project} onValueChange={(project) => setFilters((current) => ({ ...current, project }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All global projects" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All global projects</SelectItem>
                {activeProjects.map((project) => <SelectItem value={project.id} key={project.id}>{project.projectName}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Department">
            <Select value={filters.department} onValueChange={(department) => setFilters((current) => ({ ...current, department }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All global departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All global departments</SelectItem>
                {activeDepartments.map((department) => <SelectItem value={department.id} key={department.id}>{department.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Owner">
            <Select value={filters.owner} onValueChange={(owner) => setFilters((current) => ({ ...current, owner }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All owners" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All owners</SelectItem>
                {users.map((entry) => <SelectItem value={entry.id} key={entry.id}>{entry.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </CollapsibleFilterCard>
      <Card>
        <CardHeader>
          <CardTitle>{filtered.length} item(s) pending</CardTitle>
          <CardDescription>Sorted by longest-waiting first</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Assigned to</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap font-medium">{row.title}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.vendorName}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.stepName}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.assigneeNames.length ? row.assigneeNames.join(", ") : <span className="text-amber-600">Unassigned</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">{currency(row.amount)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant={row.tatBreached ? "destructive" : "outline"}>{formatAge(row.ageHours)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {!filtered.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                      Nothing is currently pending in the workflow for the selected filters.
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
