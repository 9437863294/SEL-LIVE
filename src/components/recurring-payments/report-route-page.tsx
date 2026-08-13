"use client";
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Download,
  FileCheck2,
  Loader2,
  Printer,
  Target,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  downloadCsv,
  matchesScopeFilter,
  type PaymentObligation,
  RP_COLLECTIONS,
  currency,
  effectiveStatus,
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
import CollapsibleFilterCard from "./collapsible-filter-card";
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
import { useGlobalScopes } from "./use-global-scopes";

export type ReportKind = "upcoming" | "overdue" | "expenses" | "cash-flow";

const titles = {
  upcoming: [
    "Upcoming Payments Report",
    "Open obligations due in the selected future period",
  ],
  overdue: [
    "Overdue Payments Report",
    "Unpaid obligations past their due date",
  ],
  expenses: [
    "Expense Summary",
    "Bills actually received against recurring obligations, by category and vendor",
  ],
  "cash-flow": [
    "Cash-Flow Forecast",
    "Expected, confirmed, approved and overdue outflow — including bills not yet received",
  ],
} as const;

const DEFAULT_FILTERS = {
  from: "",
  to: "",
  dateField: "dueDate" as "dueDate" | "billDate" | "paymentDate",
  category: "all",
  vendor: "all",
  status: "all",
  branch: "all",
  project: "all",
  department: "all",
  owner: "all",
  source: "all" as "all" | "Recurring" | "Manual",
  min: "",
  max: "",
};

function addDays(dateOnly: string, delta: number) {
  const date = new Date(`${dateOnly}T00:00:00`);
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
}

const COMPACT_CONTROL = "h-8 text-sm";

function datePresets(today: string): Array<{ label: string; from: string }> {
  return [
    { label: "Today", from: today },
    { label: "Last 7 days", from: addDays(today, -6) },
    { label: "Last 30 days", from: addDays(today, -29) },
    { label: "This month", from: `${today.slice(0, 7)}-01` },
  ];
}

export default function RecurringReportRoutePage({
  kind,
}: {
  kind: ReportKind;
}) {
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const organizationId = user?.organizationId || "default";
  const { activeProjects, activeDepartments } = useGlobalScopes();
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, RP_COLLECTIONS.payments),
          where("organizationId", "==", organizationId),
        ),
        (snapshot) => {
          setPayments(
            snapshot.docs.map(
              (item) =>
                ({
                  id: item.id,
                  ...item.data(),
                  status: effectiveStatus({
                    id: item.id,
                    ...item.data(),
                  } as PaymentObligation),
                }) as PaymentObligation,
            ),
          );
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [organizationId],
  );
  const today = new Date().toISOString().slice(0, 10);
  const rows = useMemo(
    () =>
      payments
        .filter((item) => {
          if (
            kind === "upcoming" &&
            (item.dueDate < today ||
              ["Paid", "Closed", "Cancelled", "Waived"].includes(item.status))
          )
            return false;
          if (kind === "overdue" && item.status !== "Overdue") return false;
          if (
            kind === "cash-flow" &&
            ["Paid", "Closed", "Cancelled", "Waived"].includes(item.status)
          )
            return false;
          // Expense Summary is about what's actually been billed, not what's merely scheduled —
          // unlike Cash-Flow Forecast, exclude obligations that haven't received a bill yet.
          if (kind === "expenses" && !item.billAmount) return false;
          const dateValue = item[filters.dateField] as string | undefined;
          if ((filters.from || filters.to) && !dateValue) return false;
          if (filters.from && dateValue! < filters.from) return false;
          if (filters.to && dateValue! > filters.to) return false;
          if (filters.category !== "all" && item.category !== filters.category)
            return false;
          if (filters.vendor !== "all" && item.vendorName !== filters.vendor)
            return false;
          if (filters.status !== "all" && item.status !== filters.status)
            return false;
          if (filters.branch !== "all" && item.branchName !== filters.branch)
            return false;
          if (
            !matchesScopeFilter(
              filters.project,
              { id: item.projectId, name: item.projectName },
              activeProjects.map((project) => ({ id: project.id, name: project.projectName })),
            )
          )
            return false;
          if (
            !matchesScopeFilter(
              filters.department,
              { id: item.departmentId, name: item.department },
              activeDepartments.map((department) => ({ id: department.id, name: department.name })),
            )
          )
            return false;
          if (filters.owner !== "all" && item.assignedTo !== filters.owner)
            return false;
          if (
            filters.source !== "all" &&
            (item.sourceType || "Recurring") !== filters.source
          )
            return false;
          const amount = Number(item.billAmount || item.expectedAmount);
          if (filters.min && amount < Number(filters.min)) return false;
          if (filters.max && amount > Number(filters.max)) return false;
          return true;
        })
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [filters, kind, payments, today, activeProjects, activeDepartments],
  );
  const expected = rows.reduce(
    (sum, item) => sum + Number(item.expectedAmount || 0),
    0,
  );
  const confirmed = rows.reduce(
    (sum, item) => sum + Number(item.billAmount || 0),
    0,
  );
  const paid = rows.reduce(
    (sum, item) => sum + Number(item.paidAmount || 0),
    0,
  );
  const outstanding = rows.reduce(
    (sum, item) =>
      sum +
      Math.max(
        0,
        (item.billAmount || item.expectedAmount) -
          (item.settledAmount || item.paidAmount),
      ),
    0,
  );
  const values = (key: keyof PaymentObligation) =>
    [
      ...new Set(
        payments.map((item) => String(item[key] || "")).filter(Boolean),
      ),
    ].sort();
  const activeFilterCount = (Object.keys(DEFAULT_FILTERS) as Array<keyof typeof DEFAULT_FILTERS>)
    .filter((key) => filters[key] !== DEFAULT_FILTERS[key]).length;
  function exportCsv() {
    downloadCsv(
      `recurring-${kind}-${today}.csv`,
      [
        "Payment ID",
        "Title",
        "Category",
        "Vendor",
        "Owner",
        "Source",
        "Branch",
        "Project",
        "Department",
        "Bill No.",
        "Due Date",
        "Bill Date",
        "Payment Date",
        "Expected",
        "Bill",
        "Paid",
        "Outstanding",
        "Status",
        "Confidence",
      ],
      rows.map((item) => [
        item.id,
        item.title,
        item.category,
        item.vendorName,
        users.find((entry) => entry.id === item.assignedTo)?.name || "",
        item.sourceType || "Recurring",
        item.branchName || "",
        item.projectName || "",
        item.department || "",
        item.billNumber || "",
        item.dueDate,
        item.billDate || "",
        item.paymentDate || "",
        item.expectedAmount,
        item.billAmount || "",
        item.paidAmount,
        Math.max(
          0,
          (item.billAmount || item.expectedAmount) -
            (item.settledAmount || item.paidAmount),
        ),
        item.status,
        item.billAmount
          ? "Confirmed bill"
          : item.amountType === "Fixed"
            ? "Fixed recurring"
            : "Estimated",
      ]),
    );
  }
  if (loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  return (
    <div className="space-y-5">
      <Card className="border-0 bg-gradient-to-r from-slate-900 to-indigo-900 text-white">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{titles[kind][0]}</h1>
            <p className="text-sm text-indigo-100">{titles[kind][1]}</p>
          </div>
          <div className="flex gap-2 print:hidden">
            {can("Export", "Recurring Payments.Reports") && (
              <Button variant="secondary" onClick={exportCsv}>
                <Download className="mr-2 h-4 w-4" />
                Export Excel/CSV
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
        <Metric label="Expected total" value={currency(expected)} icon={Target} tone="neutral" />
        <Metric label="Confirmed bill total" value={currency(confirmed)} icon={FileCheck2} tone="neutral" />
        <Metric label="Paid total" value={currency(paid)} icon={CheckCircle2} tone="good" />
        <Metric
          label="Outstanding total"
          value={currency(outstanding)}
          icon={AlertTriangle}
          tone={outstanding > 0 ? (kind === "overdue" ? "critical" : "warning") : "good"}
        />
      </div>
      <CollapsibleFilterCard activeCount={activeFilterCount} onClear={() => setFilters(DEFAULT_FILTERS)}>
          <div className="space-y-1.5 border-b pb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <CalendarRange className="h-3.5 w-3.5" />
                Date range
              </span>
              {datePresets(today).map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-xs"
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      from: preset.from,
                      to: today,
                    }))
                  }
                >
                  {preset.label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs text-muted-foreground"
                onClick={() =>
                  setFilters((current) => ({ ...current, from: "", to: "" }))
                }
              >
                All time
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Select
                value={filters.dateField}
                onValueChange={(dateField) =>
                  setFilters((current) => ({
                    ...current,
                    dateField: dateField as typeof current.dateField,
                  }))
                }
              >
                <SelectTrigger className={COMPACT_CONTROL}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dueDate">By due date</SelectItem>
                  <SelectItem value="billDate">By bill date</SelectItem>
                  <SelectItem value="paymentDate">By payment date</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                className={COMPACT_CONTROL}
                value={filters.from}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    from: event.target.value,
                  }))
                }
              />
              <Input
                type="date"
                className={COMPACT_CONTROL}
                value={filters.to}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, to: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            <Field label="Category">
              <Filter
                value={filters.category}
                label="All categories"
                options={values("category")}
                onChange={(category) =>
                  setFilters((current) => ({ ...current, category }))
                }
              />
            </Field>
            <Field label="Vendor">
              <Filter
                value={filters.vendor}
                label="All vendors"
                options={values("vendorName")}
                onChange={(vendor) =>
                  setFilters((current) => ({ ...current, vendor }))
                }
              />
            </Field>
            <Field label="Status">
              <Filter
                value={filters.status}
                label="All statuses"
                options={values("status")}
                onChange={(status) =>
                  setFilters((current) => ({ ...current, status }))
                }
              />
            </Field>
            <Field label="Branch">
              <Filter
                value={filters.branch}
                label="All branches"
                options={values("branchName")}
                onChange={(branch) =>
                  setFilters((current) => ({ ...current, branch }))
                }
              />
            </Field>
            <Field label="Project">
              <Select
                value={filters.project}
                onValueChange={(project) =>
                  setFilters((current) => ({ ...current, project }))
                }
              >
                <SelectTrigger className={COMPACT_CONTROL}>
                  <SelectValue placeholder="All global projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All global projects</SelectItem>
                  {activeProjects.map((project) => (
                    <SelectItem value={project.id} key={project.id}>
                      {project.projectName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Department">
              <Select
                value={filters.department}
                onValueChange={(department) =>
                  setFilters((current) => ({ ...current, department }))
                }
              >
                <SelectTrigger className={COMPACT_CONTROL}>
                  <SelectValue placeholder="All global departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All global departments</SelectItem>
                  {activeDepartments.map((department) => (
                    <SelectItem value={department.id} key={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Owner">
              <Select
                value={filters.owner}
                onValueChange={(owner) =>
                  setFilters((current) => ({ ...current, owner }))
                }
              >
                <SelectTrigger className={COMPACT_CONTROL}>
                  <SelectValue placeholder="All owners" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All owners</SelectItem>
                  {users.map((entry) => (
                    <SelectItem value={entry.id} key={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Source">
              <Select
                value={filters.source}
                onValueChange={(source) =>
                  setFilters((current) => ({
                    ...current,
                    source: source as typeof current.source,
                  }))
                }
              >
                <SelectTrigger className={COMPACT_CONTROL}>
                  <SelectValue placeholder="All sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="Recurring">Recurring (auto-generated)</SelectItem>
                  <SelectItem value="Manual">Manual entry</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Min amount">
              <Input
                type="number"
                className={COMPACT_CONTROL}
                placeholder="No minimum"
                value={filters.min}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    min: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Max amount">
              <Input
                type="number"
                className={COMPACT_CONTROL}
                placeholder="No maximum"
                value={filters.max}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    max: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
      </CollapsibleFilterCard>
      <Card>
        <CardHeader>
          <CardTitle>{rows.length} report record(s)</CardTitle>
          <CardDescription>
            Organization: {user?.organizationName || organizationId}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap">{item.dueDate}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">
                      {item.title}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.projectName || item.branchName || "Organization-wide"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{item.category}</TableCell>
                    <TableCell className="whitespace-nowrap">{item.vendorName}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {users.find((entry) => entry.id === item.assignedTo)?.name || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {currency(item.expectedAmount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {currency(item.billAmount || 0)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">
                      {currency(
                        Math.max(
                          0,
                          (item.billAmount || item.expectedAmount) -
                            (item.settledAmount || item.paidAmount),
                        ),
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="outline">{item.status}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.billAmount
                        ? "Confirmed bill"
                        : item.amountType === "Fixed"
                          ? "Fixed"
                          : "Estimated"}
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="h-28 text-center text-muted-foreground"
                    >
                      No records match the report filters.
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

const METRIC_TONES = {
  neutral: { chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", value: "" },
  good: { chip: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400", value: "" },
  warning: { chip: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400", value: "text-amber-600 dark:text-amber-400" },
  critical: { chip: "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400", value: "text-rose-600 dark:text-rose-400" },
} as const;

function Metric({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  tone: keyof typeof METRIC_TONES;
}) {
  const palette = METRIC_TONES[tone];
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`mt-1 text-xl font-bold ${palette.value}`}>{value}</p>
        </div>
        <div className={`rounded-lg p-2 ${palette.chip}`}>
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
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
function Filter({
  value,
  label,
  options,
  onChange,
}: {
  value: string;
  label: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={COMPACT_CONTROL}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}</SelectItem>
        {options.map((item) => (
          <SelectItem value={item} key={item}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
