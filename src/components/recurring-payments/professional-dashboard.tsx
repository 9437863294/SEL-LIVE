"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Download,
  FileClock,
  FileWarning,
  IndianRupee,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  type PaymentObligation,
  RP_COLLECTIONS,
  currency,
  effectiveStatus,
  hasPaymentProof,
  isOpenObligation,
  outstandingAmountOf,
  visibleObligations,
} from "@/lib/recurring-payments";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { chartChrome } from "@/components/ui/chart";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGlobalScopes } from "./use-global-scopes";

const DAY = 86_400_000;
const PIE_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#10b981",
  "#0ea5e9",
  "#64748b",
];
const GLASS_CARD =
  "border-white/60 bg-white/80 shadow-sm backdrop-blur-sm";

export default function ProfessionalRecurringDashboard() {
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const organizationId = user?.organizationId || "default";
  const { activeProjects, activeDepartments } = useGlobalScopes();
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    financialYear: financialYearFor(new Date()),
    branch: "all",
    project: "all",
    department: "all",
    category: "all",
    status: "all",
    from: "",
    to: "",
  });

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
                (item) => ({ id: item.id, ...item.data() }) as PaymentObligation,
              ),
            ),
          );
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [organizationId],
  );

  const normalized = useMemo(
    () =>
      payments.map((payment) => ({
        ...payment,
        status: effectiveStatus(payment),
      })),
    [payments],
  );
  const branches = useMemo(
    () =>
      [
        ...new Set(
          normalized.map((item) => item.branchName).filter(Boolean) as string[],
        ),
      ].sort(),
    [normalized],
  );
  const projects = activeProjects.map((item) => item.projectName);
  const departments = activeDepartments.map((item) => item.name);
  const categories = useMemo(
    () =>
      [
        ...new Set(normalized.map((item) => item.category).filter(Boolean)),
      ].sort(),
    [normalized],
  );
  const years = useMemo(
    () =>
      [
        ...new Set([
          financialYearFor(new Date()),
          ...normalized.map((item) =>
            financialYearFor(new Date(`${item.dueDate}T00:00:00`)),
          ),
        ]),
      ]
        .sort()
        .reverse(),
    [normalized],
  );
  const defaultFilters = {
    financialYear: financialYearFor(new Date()),
    branch: "all", project: "all", department: "all", category: "all", status: "all",
    from: "", to: "",
  };
  const activeFilterCount = (Object.keys(defaultFilters) as Array<keyof typeof defaultFilters>)
    .filter((key) => filters[key] !== defaultFilters[key]).length;
  const visible = useMemo(
    () =>
      normalized.filter((payment) => {
        if (
          filters.financialYear !== "all" &&
          financialYearFor(new Date(`${payment.dueDate}T00:00:00`)) !==
            filters.financialYear
        )
          return false;
        if (filters.branch !== "all" && payment.branchName !== filters.branch)
          return false;
        if (
          filters.project !== "all" &&
          payment.projectName !== filters.project
        )
          return false;
        if (
          filters.department !== "all" &&
          payment.department !== filters.department
        )
          return false;
        if (filters.category !== "all" && payment.category !== filters.category)
          return false;
        if (filters.status !== "all" && payment.status !== filters.status)
          return false;
        if (filters.from && payment.dueDate < filters.from) return false;
        if (filters.to && payment.dueDate > filters.to) return false;
        return true;
      }),
    [normalized, filters],
  );

  // Read the clock once per mount, not on every render. Calling `new Date()`/`Date.now()` inline
  // during render made the dashboard's "due today" and "due this week" boundaries depend on which
  // render they were evaluated in — so a re-render that straddled midnight silently moved every
  // bucket, and the server and client could disagree on hydration. React's compiler flags this as
  // an impure call during render for exactly this reason.
  // The data is a live listener already; Refresh re-reads this clock, so a dashboard left open past
  // midnight moves its "today"/"this week" buckets forward.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const today = dateOnly(new Date(nowMs));
  const inDays = (days: number) => dateOnly(new Date(nowMs + days * DAY));
  const isOpen = isOpenObligation;
  const sum = (items: PaymentObligation[]) =>
    items.reduce(
      (total, item) =>
        total + Number(item.billAmount || item.expectedAmount || 0),
      0,
    );
  // Open-exposure figures count what is still owed, not the gross bill — a part-paid obligation
  // otherwise reported its full amount as overdue / due / about to leave the bank.
  const outstanding = (items: PaymentObligation[]) =>
    items.reduce((total, item) => total + outstandingAmountOf(item), 0);
  const cards = [
    {
      label: "Due Today",
      items: visible.filter((item) => item.dueDate === today && isOpen(item)),
      icon: CalendarClock,
      color: "border-blue-100 text-blue-600",
      href: `/recurring-payments/payments?from=${today}&to=${today}`,
    },
    {
      label: "Due This Week",
      items: visible.filter(
        (item) =>
          item.dueDate >= today && item.dueDate <= inDays(7) && isOpen(item),
      ),
      icon: FileClock,
      color: "border-cyan-100 text-cyan-600",
      href: "/recurring-payments/upcoming?days=7",
    },
    {
      label: "Overdue",
      items: visible.filter((item) => item.status === "Overdue"),
      icon: AlertTriangle,
      color: "border-rose-100 text-rose-600",
      href: "/recurring-payments/overdue",
    },
    {
      label: "Awaiting Bill",
      items: visible.filter((item) => item.status === "Awaiting Bill"),
      icon: WalletCards,
      color: "border-violet-100 text-violet-600",
      href: "/recurring-payments/payments?status=Awaiting%20Bill",
    },
    {
      label: "Pending Verification",
      items: visible.filter(
        (item) =>
          item.status === "Under Verification" ||
          item.status === "Bill Received",
      ),
      icon: ShieldCheck,
      color: "border-amber-100 text-amber-600",
      // Both statuses this tile counts, so the drill-down total matches the number clicked.
      href: "/recurring-payments/payments?status=Under%20Verification,Bill%20Received",
    },
    {
      label: "Pending Approval",
      items: visible.filter((item) => item.status === "Pending Approval"),
      icon: ShieldCheck,
      color: "border-orange-100 text-orange-600",
      href: "/recurring-payments/approvals",
    },
    {
      label: "Approved but Unpaid",
      // A part-paid obligation is approved and not yet fully paid, so it belongs here too.
      items: visible.filter((item) =>
        ["Approved", "Payment Processing", "Partially Paid"].includes(item.status),
      ),
      icon: IndianRupee,
      color: "border-emerald-100 text-emerald-600",
      href: "/recurring-payments/payments?status=Approved,Payment%20Processing,Partially%20Paid",
    },
    {
      label: "Missing Payment Proof",
      items: visible.filter(
        (item) =>
          ["Paid", "Closed"].includes(item.status) && !hasPaymentProof(item),
      ),
      icon: FileWarning,
      color: "border-slate-200 text-slate-600",
      href: "/recurring-payments/payments?missingReceipt=1",
      // Already-paid rows owe nothing, so this tile shows what was paid without proof.
      gross: true,
    },
  ];
  const cardAmount = (card: (typeof cards)[number]) =>
    card.gross ? sum(card.items) : outstanding(card.items);
  const paidMonth = visible.filter(
    (item) =>
      ["Paid", "Closed"].includes(item.status) &&
      item.paymentDate?.slice(0, 7) === today.slice(0, 7),
  );
  const upcoming30 = visible.filter(
    (item) =>
      item.dueDate >= today && item.dueDate <= inDays(30) && isOpen(item),
  );

  const monthlyTrend = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        // "All years" charts the current Indian financial year (Apr–Mar); the calendar year put
        // next FY's Jan–Mar on the chart from April onwards.
        const [startYear] = (
          filters.financialYear === "all"
            ? financialYearFor(new Date(nowMs))
            : filters.financialYear
        )
          .split("-")
          .map(Number);
        const date = new Date(
          index < 9 ? startYear : startYear + 1,
          (index + 3) % 12,
          1,
        );
        const key = dateOnly(date).slice(0, 7);
        const subset = visible.filter((item) => item.dueDate.startsWith(key));
        return {
          month: date.toLocaleString("en-IN", { month: "short" }),
          expected: sum(subset),
          paid: subset.reduce(
            (total, item) => total + Number(item.paidAmount || 0),
            0,
          ),
        };
      }),
    [filters.financialYear, visible, nowMs],
  );
  const categoryChart = useMemo(
    () =>
      Object.entries(
        visible.reduce<Record<string, number>>((accumulator, payment) => {
          accumulator[payment.category] =
            (accumulator[payment.category] || 0) +
            Number(payment.billAmount || payment.expectedAmount || 0);
          return accumulator;
        }, {}),
      )
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
    [visible],
  );
  const statusChart = useMemo(
    () =>
      Object.entries(
        visible.reduce<Record<string, number>>((accumulator, payment) => {
          accumulator[payment.status] = (accumulator[payment.status] || 0) + 1;
          return accumulator;
        }, {}),
      ).map(([name, value]) => ({ name, value })),
    [visible],
  );
  const activity = useMemo(
    () =>
      visible
        .flatMap((payment) =>
          (payment.workflowHistory || []).map((entry) => ({
            ...entry,
            payment,
          })),
        )
        .sort(
          (a, b) => timestampMillis(b.timestamp) - timestampMillis(a.timestamp),
        )
        .slice(0, 8),
    [visible],
  );
  const upcoming = [...visible]
    .filter(isOpen)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 8);

  function exportSummary() {
    const rows = [
      ["Metric", "Records", "Amount"],
      ...cards.map((card) => [card.label, card.items.length, cardAmount(card)]),
      ["Paid This Month", paidMonth.length, sum(paidMonth)],
      ["Upcoming 30 Days", upcoming30.length, outstanding(upcoming30)],
    ];
    const blob = new Blob(
      [
        rows
          .map((row) =>
            row
              .map((value) => `"${String(value).replaceAll('"', '""')}"`)
              .join(","),
          )
          .join("\n"),
      ],
      { type: "text/csv" },
    );
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `recurring-payment-dashboard-${today}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  if (loading)
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  return (
    <div className="space-y-5">
      <PageHeader
        icon={WalletCards}
        eyebrow="Financial obligation control centre"
        title="Recurring Payments"
        description="Real-time due dates, approvals, exceptions, cash flow and payment risk"
        actions={
          <>
            <Button
              variant="outline"
              className="bg-white/90"
              onClick={() => setNowMs(Date.now())}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            {can("Export", "Recurring Payments.Reports") && (
              <Button variant="outline" className="bg-white/90" onClick={exportSummary}>
                <Download className="mr-2 h-4 w-4" />
                Export summary
              </Button>
            )}
            {can("Add", "Recurring Payments.Payments") && (
              <Link href="/recurring-payments/payments/new">
                <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
                  <Plus className="mr-2 h-4 w-4" />
                  Manual payment
                </Button>
              </Link>
            )}
            {can("Add", "Recurring Payments.Recurring Masters") && (
              <Link href="/recurring-payments/masters/new">
                <Button className="bg-teal-600 text-white hover:bg-teal-700">
                  <Plus className="mr-2 h-4 w-4" />
                  Recurring master
                </Button>
              </Link>
            )}
          </>
        }
      />

      <FilterBar activeCount={activeFilterCount} onClear={() => setFilters(defaultFilters)}>
        <FilterSelect
          value={organizationId}
          options={[organizationId]}
          label={user?.organizationName || organizationId}
          disabled
          onChange={() => undefined}
        />
        <FilterSelect
          value={filters.financialYear}
          options={years}
          label="Financial year"
          onChange={(financialYear) =>
            setFilters((current) => ({ ...current, financialYear }))
          }
        />
        <FilterSelect
          value={filters.branch}
          options={branches}
          label="All branches"
          onChange={(branch) =>
            setFilters((current) => ({ ...current, branch }))
          }
        />
        <FilterSelect
          value={filters.project}
          options={projects}
          label="All projects"
          onChange={(project) =>
            setFilters((current) => ({ ...current, project }))
          }
        />
        <FilterSelect
          value={filters.department}
          options={departments}
          label="All departments"
          onChange={(department) =>
            setFilters((current) => ({ ...current, department }))
          }
        />
        <Input
          type="date"
          aria-label="From date"
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
          aria-label="To date"
          value={filters.to}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              to: event.target.value,
            }))
          }
        />
      </FilterBar>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cards.map((card) => {
          const { label, items, icon: Icon, color, href } = card;
          return (
          <Link href={href} key={label}>
            <Card className={`h-full bg-white/80 shadow-sm backdrop-blur-sm transition hover:-translate-y-0.5 hover:shadow-md ${color}`}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-xl bg-current/10 p-2.5">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-slate-500">
                    {label}
                  </p>
                  <p className="text-xl font-bold text-slate-900">{items.length}</p>
                  <p className="truncate text-xs text-slate-500">
                    {currency(cardAmount(card))}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
          );
        })}
        <MetricCard
          label="Paid This Month"
          value={currency(sum(paidMonth))}
          sub={`${paidMonth.length} payment(s)`}
          icon={CheckCircle2}
          color="border-emerald-100 text-emerald-600"
        />
        <MetricCard
          label="Upcoming 30 Days"
          value={currency(outstanding(upcoming30))}
          sub={`${upcoming30.length} obligation(s)`}
          icon={CalendarClock}
          color="border-indigo-100 text-indigo-600"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className={`${GLASS_CARD} xl:col-span-2`}>
          <CardHeader>
            <CardTitle>Monthly payment trend</CardTitle>
            <CardDescription>
              Expected obligations compared with completed payments
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyTrend}>
                <defs>
                  <linearGradient id="expected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartChrome.grid} />
                <XAxis dataKey="month" stroke={chartChrome.axis} />
                <YAxis tickFormatter={compactCurrency} stroke={chartChrome.axis} />
                <Tooltip {...chartChrome.tooltip} formatter={(value: number) => currency(value)} />
                <Area
                  type="monotone"
                  dataKey="expected"
                  stroke="#6366f1"
                  fill="url(#expected)"
                />
                <Area
                  type="monotone"
                  dataKey="paid"
                  stroke="#10b981"
                  fillOpacity={0}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <ChartCard title="Category-wise expense" data={categoryChart} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Status distribution" data={statusChart} />
        <Card className={GLASS_CARD}>
          <CardHeader>
            <CardTitle>Expected cash outflow</CardTitle>
            <CardDescription>
              Open obligations by forecast horizon
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {/* Already past due is its own bucket; the horizons start today, so "Next 7 days"
                no longer silently includes obligations that fell due months ago. */}
            {([0, 7, 15, 30, 60, 90] as const).map((days) => {
              const items = visible.filter(
                (item) =>
                  isOpen(item) &&
                  (days === 0
                    ? item.dueDate < today
                    : item.dueDate >= today && item.dueDate <= inDays(days)),
              );
              return (
                <div key={days} className="rounded-xl border border-teal-100 bg-teal-50/60 p-3">
                  <p className="text-xs text-muted-foreground">{days === 0 ? "Past due" : `Next ${days} days`}</p>
                  <p className="mt-1 font-bold">{currency(outstanding(items))}</p>
                  <p className="text-xs text-muted-foreground">
                    {items.length} item(s)
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div> 
    </div>
  );
}

function FilterSelect({
  value,
  options,
  label,
  onChange,
  disabled = false,
}: {
  value: string;
  options: string[];
  label: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {!disabled && <SelectItem value="all">{label}</SelectItem>}
        {options.map((option) => (
          <SelectItem value={option} key={option}>
            {disabled ? label : option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card className={`bg-white/80 shadow-sm backdrop-blur-sm ${color}`}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-xl bg-current/10 p-2.5">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-slate-500">{label}</p>
          <p className="truncate text-lg font-bold text-slate-900">{value}</p>
          <p className="text-xs text-slate-500">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}
function ChartCard({
  title,
  data,
}: {
  title: string;
  data: Array<{ name: string; value: number }>;
}) {
  return (
    <Card className={GLASS_CARD}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
                stroke={chartChrome.surface}
              >
                {data.map((item, index) => (
                  <Cell
                    key={item.name}
                    fill={PIE_COLORS[index % PIE_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                {...chartChrome.tooltip}
                formatter={(value: number) =>
                  typeof value === "number" && value > 1000
                    ? currency(value)
                    : value
                }
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No chart data.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
function dateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function financialYearFor(date: Date) {
  const start =
    date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}
function compactCurrency(value: number) {
  return value >= 10_000_000
    ? `₹${(value / 10_000_000).toFixed(1)}Cr`
    : value >= 100_000
      ? `₹${(value / 100_000).toFixed(1)}L`
      : `₹${Math.round(value / 1000)}K`;
}
function timestampMillis(value: unknown) {
  const timestamp = value as {
    toMillis?: () => number;
    seconds?: number;
  } | null;
  return timestamp?.toMillis?.() || Number(timestamp?.seconds || 0) * 1000;
}
function formatTimestamp(value: unknown) {
  const milliseconds = timestampMillis(value);
  return milliseconds ? new Date(milliseconds).toLocaleString("en-IN") : "—";
}
