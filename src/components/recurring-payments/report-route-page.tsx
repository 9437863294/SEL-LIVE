"use client";
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  AlertTriangle,
  CalendarClock,
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
  matchesScopeFilter,
  type PaymentObligation,
  RP_COLLECTIONS,
  currency,
  effectiveStatus,
  recurringDateOnly,
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
import {
  ReportAccessDenied,
  ReportErrorBanner,
  ReportHeader,
  ReportLoading,
  ReportMetricTile,
} from "./report-ui";

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

const FORECAST_HORIZONS = [7, 15, 30, 60, 90];

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

// Uses recurringDateOnly (local calendar components) rather than toISOString — a UTC round-trip
// here silently returned the wrong day for any timezone ahead of UTC (including IST), corrupting
// the "Last 7/30 days" presets and the "today" cutoff every time they were used.
function addDays(dateOnly: string, delta: number) {
  const date = new Date(`${dateOnly}T00:00:00`);
  date.setDate(date.getDate() + delta);
  return recurringDateOnly(date);
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
  const [loadError, setLoadError] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
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
            visibleObligations(
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
            ),
          );
          setLoading(false);
          setLoadError(false);
        },
        () => {
          setLoading(false);
          setLoadError(true);
        },
      ),
    [organizationId],
  );
  const todayDate = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const today = recurringDateOnly(todayDate);
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
          // unlike Cash-Flow Forecast, exclude obligations that haven't received a bill yet. Uses
          // `== null` rather than falsy so a legitimate ₹0 bill still counts as "received."
          if (kind === "expenses" && item.billAmount == null) return false;
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
  // Cash-Flow Forecast additionally shows a forward-looking horizon view (independent of the date
  // filter below) — otherwise this page was just the same flat table as Upcoming/Overdue with a
  // different status filter, despite being named "Forecast."
  const openForForecast = useMemo(
    () => payments.filter((item) => !["Paid", "Closed", "Cancelled", "Waived"].includes(item.status)),
    [payments],
  );
  const outflowBuckets = useMemo(
    () =>
      FORECAST_HORIZONS.map((days) => {
        const amount = openForForecast
          .filter((item) => {
            if (!item.dueDate) return false;
            const due = new Date(`${item.dueDate}T00:00:00`);
            return due >= todayDate && due <= new Date(todayDate.getTime() + days * 86_400_000);
          })
          .reduce((sum, item) => sum + Number(item.billAmount || item.expectedAmount || 0), 0);
        return { days, amount };
      }),
    [openForForecast, todayDate],
  );
  const values = (key: keyof PaymentObligation) =>
    [
      ...new Set(
        payments.map((item) => String(item[key] || "")).filter(Boolean),
      ),
    ].sort();
  const activeFilterCount = (Object.keys(DEFAULT_FILTERS) as Array<keyof typeof DEFAULT_FILTERS>)
    .filter((key) => filters[key] !== DEFAULT_FILTERS[key]).length;
  async function exportReport() {
    setIsExporting(true);
    try {
      await exportWorkbook(`recurring-${kind}-${today}.xlsx`, [
        {
          name: titles[kind][0].slice(0, 31),
          columns: [
            { header: "Payment ID", key: "id", width: 20 },
            { header: "Title", key: "title", width: 30 },
            { header: "Category", key: "category", width: 20 },
            { header: "Vendor", key: "vendorName", width: 24 },
            { header: "Owner", key: "owner", width: 20 },
            { header: "Source", key: "source", width: 12 },
            { header: "Branch", key: "branch", width: 16 },
            { header: "Project", key: "project", width: 20 },
            { header: "Department", key: "department", width: 18 },
            { header: "Bill No.", key: "billNumber", width: 16 },
            { header: "Due Date", key: "dueDate", width: 14 },
            { header: "Bill Date", key: "billDate", width: 14 },
            { header: "Payment Date", key: "paymentDate", width: 14 },
            { header: "Expected", key: "expectedAmount", width: 14 },
            { header: "Bill", key: "billAmount", width: 14 },
            { header: "Paid", key: "paidAmount", width: 14 },
            { header: "Outstanding", key: "outstanding", width: 14 },
            { header: "Status", key: "status", width: 18 },
            { header: "Confidence", key: "confidence", width: 18 },
          ],
          rows: rows.map((item) => ({
            id: item.id,
            title: item.title,
            category: item.category,
            vendorName: item.vendorName,
            owner: users.find((entry) => entry.id === item.assignedTo)?.name || "",
            source: item.sourceType || "Recurring",
            branch: item.branchName || "",
            project: item.projectName || "",
            department: item.department || "",
            billNumber: item.billNumber || "",
            dueDate: item.dueDate,
            billDate: item.billDate || "",
            paymentDate: item.paymentDate || "",
            expectedAmount: item.expectedAmount,
            billAmount: item.billAmount || "",
            paidAmount: item.paidAmount,
            outstanding: Math.max(
              0,
              (item.billAmount || item.expectedAmount) -
                (item.settledAmount || item.paidAmount),
            ),
            status: item.status,
            confidence: item.billAmount
              ? "Confirmed bill"
              : item.amountType === "Fixed"
                ? "Fixed recurring"
                : "Estimated",
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
        title={titles[kind][0]}
        description={titles[kind][1]}
        // Each report kind leads with the figure it is actually about: what's owed for the
        // forward-looking views, what's been billed for the expense summary.
        hero={{
          label: kind === "expenses" ? "Confirmed bill total" : "Expected total",
          value: currency(kind === "expenses" ? confirmed : expected),
          hint: `${rows.length.toLocaleString("en-IN")} obligation(s) in scope`,
        }}
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
        <ReportMetricTile label="Expected total" value={currency(expected)} icon={Target} tone="neutral" />
        <ReportMetricTile label="Confirmed bill total" value={currency(confirmed)} icon={FileCheck2} tone="neutral" />
        <ReportMetricTile label="Paid total" value={currency(paid)} icon={CheckCircle2} tone="good" />
        <ReportMetricTile
          label="Outstanding total"
          value={currency(outstanding)}
          icon={AlertTriangle}
          tone={outstanding > 0 ? (kind === "overdue" ? "critical" : "warning") : "good"}
        />
      </div>
      {kind === "cash-flow" && (
        <div>
          <div className="mb-2">
            <h2 className="text-lg font-semibold">Outflow horizon</h2>
            <p className="text-sm text-muted-foreground">
              Total open exposure (confirmed bills, or expected amount where no bill exists yet) due within each window, regardless of the filters below.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {outflowBuckets.map(({ days, amount }) => (
              <ReportMetricTile key={days} label={`Next ${days} days`} value={currency(amount)} icon={CalendarClock} tone="neutral" />
            ))}
          </div>
        </div>
      )}
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
