"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  AlertOctagon,
  CalendarClock,
  Download,
  FilePlus2,
  Landmark,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  FD_COLLECTIONS,
  assignmentOutstanding,
  type FDAssignment,
} from "@/lib/fixed-deposit";
import {
  BG_COLLECTIONS,
  BG_PERMISSION_MODULE,
  bgLabel,
  calculateBgAvailableLimit,
  daysToBgDate,
  formatBgCurrency,
  toBgDate,
  toBgDateInput,
  type BGRequest,
  type BankGuarantee,
} from "@/lib/bank-guarantee";
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

type Row = Record<string, any> & { id: string };
const activeStatuses = [
  "ISSUED",
  "ACTIVE",
  "EXTENSION_DUE",
  "EXTENSION_PENDING",
  "AMENDMENT_PENDING",
  "CLAIM_PERIOD_ACTIVE",
  "INVOCATION_NOTICE_RECEIVED",
  "INVOKED",
  "CANCELLATION_REQUESTED",
  "BANK_CANCELLATION_PENDING",
  "MARGIN_RELEASE_PENDING",
];
const colors = [
  "#4f46e5",
  "#7c3aed",
  "#0ea5e9",
  "#14b8a6",
  "#f59e0b",
  "#ef4444",
  "#64748b",
];

export default function BankGuaranteeDashboard() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || "default";
  const canView =
    can("View", `${BG_PERMISSION_MODULE}.Dashboard`) ||
    can("View Module", BG_PERMISSION_MODULE);
  const canExport = can("Export", `${BG_PERMISSION_MODULE}.Dashboard`);
  const [guarantees, setGuarantees] = useState<BankGuarantee[]>([]),
    [requests, setRequests] = useState<BGRequest[]>([]),
    [limits, setLimits] = useState<Row[]>([]),
    [extensions, setExtensions] = useState<Row[]>([]),
    [cancellations, setCancellations] = useState<Row[]>([]),
    [invocations, setInvocations] = useState<Row[]>([]),
    [commissions, setCommissions] = useState<Row[]>([]),
    [cashMargins, setCashMargins] = useState<Row[]>([]),
    [assignments, setAssignments] = useState<FDAssignment[]>([]);
  const [loading, setLoading] = useState(true),
    [bank, setBank] = useState("ALL"),
    [project, setProject] = useState("ALL"),
    [status, setStatus] = useState("ALL"),
    [exporting, setExporting] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scoped = (name: string) =>
        user?.role === "Super Admin"
          ? collection(db, name)
          : query(
              collection(db, name),
              where("organizationId", "==", organizationId),
            );
      const snapshots = await Promise.all(
        [
          BG_COLLECTIONS.guarantees,
          BG_COLLECTIONS.requests,
          BG_COLLECTIONS.bankLimits,
          BG_COLLECTIONS.extensions,
          BG_COLLECTIONS.cancellations,
          BG_COLLECTIONS.invocations,
          BG_COLLECTIONS.commissions,
          BG_COLLECTIONS.cashMargins,
          FD_COLLECTIONS.assignments,
        ].map((name) => getDocs(scoped(name))),
      );
      const map = (index: number) =>
        snapshots[index].docs.map(
          (item) => ({ id: item.id, ...item.data() }) as Row,
        );
      setGuarantees(
        map(0).filter((item) => !item.isDeleted) as BankGuarantee[],
      );
      setRequests(map(1).filter((item) => !item.isDeleted) as BGRequest[]);
      setLimits(
        map(2).filter((item) =>
          ["BG", "COMBINED_BG_LC"].includes(String(item.limitType)),
        ),
      );
      setExtensions(map(3));
      setCancellations(map(4));
      setInvocations(map(5));
      setCommissions(map(6));
      setCashMargins(map(7));
      setAssignments(map(8) as FDAssignment[]);
    } catch (error) {
      console.error(error);
      toast({ title: "Unable to load BG dashboard", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [organizationId, toast, user?.role]);
  useEffect(() => {
    if (!authLoading && canView) void load();
    else if (!authLoading) setLoading(false);
  }, [authLoading, canView, load]);
  const filtered = useMemo(
    () =>
      guarantees.filter(
        (item) =>
          (bank === "ALL" || item.bankId === bank) &&
          (project === "ALL" || item.projectId === project) &&
          (status === "ALL" || item.status === status),
      ),
    [bank, guarantees, project, status],
  );
  const scopedLimits = useMemo(
    () => limits.filter((item) => bank === "ALL" || item.bankId === bank),
    [bank, limits],
  );
  const scopedRequests = requests.filter(
    (item) =>
      (bank === "ALL" || item.preferredBankId === bank) &&
      (project === "ALL" || item.projectId === project),
  );
  const metrics = useMemo(() => {
    const sanctioned = scopedLimits.reduce(
        (sum, item) =>
          sum +
          Number(item.sanctionedAmount || 0) +
          Number(item.temporaryLimit || 0),
        0,
      ),
      utilised = scopedLimits.reduce(
        (sum, item) =>
          sum +
          Number(
            (item.bgUtilizedAmount ??
              (String(item.limitType) === "BG" ? item.utilizedAmount : 0)) ||
              0,
          ),
        0,
      ),
      reserved = scopedLimits.reduce(
        (sum, item) => sum + Number(item.reservedAmount || 0),
        0,
      ),
      active = filtered.filter((item) => activeStatuses.includes(item.status)),
      expiring = (days: number) =>
        active.filter((item) => {
          const value = daysToBgDate(item.currentExpiryDate);
          return value !== null && value >= 0 && value <= days;
        }),
      expired = filtered.filter(
        (item) => (daysToBgDate(item.currentExpiryDate) ?? 1) < 0,
      ),
      claimActive = filtered.filter(
        (item) => item.status === "CLAIM_PERIOD_ACTIVE",
      ),
      fd = assignments
        .filter(
          (item) =>
            item.instrumentType === "BG" &&
            ACTIVE_ASSIGNMENT_STATUSES.includes(item.status) &&
            filtered.some((bg) => bg.id === item.instrumentId),
        )
        .reduce((sum, item) => sum + assignmentOutstanding(item), 0),
      cash = cashMargins
        .filter(
          (item) =>
            item.status === "BLOCKED" &&
            filtered.some((bg) => bg.id === item.bgId),
        )
        .reduce((sum, item) => sum + Number(item.amount || 0), 0),
      invoked = invocations
        .filter((item) => !["SETTLED", "CLOSED"].includes(String(item.status)))
        .reduce((sum, item) => sum + Number(item.claimedAmount || 0), 0);
    return {
      sanctioned,
      utilised,
      reserved,
      available: calculateBgAvailableLimit(sanctioned, 0, utilised, reserved),
      activeAmount: active.reduce((sum, item) => sum + item.currentAmount, 0),
      activeCount: active.length,
      exp7: expiring(7),
      exp30: expiring(30),
      exp90: expiring(90),
      expired,
      claimActive,
      fd,
      cash,
      invoked,
      pendingExtensions: extensions.filter(
        (item) =>
          !["COMPLETED", "REJECTED", "CANCELLED"].includes(String(item.status)),
      ).length,
      pendingCancellations: cancellations.filter(
        (item) =>
          !["COMPLETED", "REJECTED", "CANCELLED"].includes(String(item.status)),
      ).length,
      commission: commissions.reduce(
        (sum, item) => sum + Number(item.bankChargedCommission || 0),
        0,
      ),
      difference: commissions.reduce(
        (sum, item) => sum + Number(item.differenceAmount || 0),
        0,
      ),
      originals: filtered.filter(
        (item) => item.originalDispatched && !item.originalReturned,
      ).length,
    };
  }, [
    assignments,
    cancellations,
    cashMargins,
    commissions,
    extensions,
    filtered,
    invocations,
    scopedLimits,
  ]);
  const group = (key: "bankName" | "projectName" | "beneficiaryName") =>
    Array.from(
      filtered
        .reduce((map, item) => {
          const name = item[key] || "Unassigned",
            row = map.get(name) || { name, amount: 0, count: 0 };
          row.amount += item.currentAmount;
          row.count += 1;
          map.set(name, row);
          return map;
        }, new Map<string, { name: string; amount: number; count: number }>())
        .values(),
    )
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  const bankData = group("bankName"),
    projectData = group("projectName"),
    statusData = Array.from(
      filtered
        .reduce(
          (map, item) =>
            map.set(
              bgLabel(item.status),
              (map.get(bgLabel(item.status)) || 0) + 1,
            ),
          new Map<string, number>(),
        )
        .entries(),
    ).map(([name, value]) => ({ name, value }));
  const upcoming = filtered
    .filter((item) => {
      const days = daysToBgDate(item.currentExpiryDate);
      return days !== null && days <= 120;
    })
    .sort(
      (a, b) =>
        (toBgDate(a.currentExpiryDate)?.getTime() || 0) -
        (toBgDate(b.currentExpiryDate)?.getTime() || 0),
    )
    .slice(0, 12);
  const exportDashboard = async () => {
    setExporting(true);
    try {
      const workbook = new ExcelJS.Workbook(),
        summary = workbook.addWorksheet("BG Dashboard"),
        register = workbook.addWorksheet("BG Register"),
        limitSheet = workbook.addWorksheet("Bank Limits");
      summary.columns = [
        { header: "Metric", key: "metric", width: 35 },
        { header: "Value", key: "value", width: 24 },
      ];
      Object.entries({
        "Total sanction limit": metrics.sanctioned,
        "BG utilised": metrics.utilised,
        "Reserved limit": metrics.reserved,
        "Available limit": metrics.available,
        "Active BG amount": metrics.activeAmount,
        "Active BG count": metrics.activeCount,
        "Expiring within 30 days": metrics.exp30.length,
        "Invoked exposure": metrics.invoked,
        "FD margin utilised": metrics.fd,
        "Cash margin blocked": metrics.cash,
        "Commission charged": metrics.commission,
        "Commission difference": metrics.difference,
      }).forEach(([metric, value]) => summary.addRow({ metric, value }));
      register.columns = [
        { header: "BG Number", key: "number", width: 24 },
        { header: "Bank", key: "bank", width: 22 },
        { header: "Beneficiary", key: "beneficiary", width: 28 },
        { header: "Project", key: "project", width: 25 },
        { header: "Amount", key: "amount", width: 18 },
        { header: "Expiry", key: "expiry", width: 15 },
        { header: "Claim Expiry", key: "claim", width: 15 },
        { header: "Status", key: "status", width: 24 },
      ];
      filtered.forEach((item) =>
        register.addRow({
          number: item.bankBgNumber,
          bank: item.bankName,
          beneficiary: item.beneficiaryName,
          project: item.projectName,
          amount: item.currentAmount,
          expiry: toBgDateInput(item.currentExpiryDate),
          claim: toBgDateInput(item.currentClaimExpiryDate),
          status: bgLabel(item.status),
        }),
      );
      limitSheet.columns = [
        { header: "Bank", key: "bank", width: 22 },
        { header: "Type", key: "type", width: 22 },
        { header: "Sanctioned", key: "sanctioned", width: 18 },
        { header: "BG Used", key: "used", width: 18 },
        { header: "LC Used", key: "lc", width: 18 },
        { header: "Reserved", key: "reserved", width: 18 },
        { header: "Available", key: "available", width: 18 },
      ];
      scopedLimits.forEach((item) =>
        limitSheet.addRow({
          bank: item.bankName,
          type: item.limitType,
          sanctioned: item.sanctionedAmount,
          used: item.bgUtilizedAmount,
          lc: item.lcUtilizedAmount,
          reserved: item.reservedAmount,
          available: item.availableAmount,
        }),
      );
      const buffer = await workbook.xlsx.writeBuffer(),
        url = URL.createObjectURL(new Blob([buffer]));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `bg-dashboard-${new Date().toISOString().slice(0, 10)}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };
  if (authLoading || loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
      </div>
    );
  const cards: Array<[string, string | number, string]> = [
    [
      "Total BG sanction limit",
      formatBgCurrency(metrics.sanctioned),
      "text-indigo-700",
    ],
    [
      "Total BG utilised",
      formatBgCurrency(metrics.utilised),
      "text-violet-700",
    ],
    ["Reserved BG limit", formatBgCurrency(metrics.reserved), "text-amber-700"],
    [
      "Available BG limit",
      formatBgCurrency(metrics.available),
      "text-emerald-700",
    ],
    [
      "Active BG exposure",
      formatBgCurrency(metrics.activeAmount),
      "text-blue-700",
    ],
    ["Active BG count", metrics.activeCount, "text-slate-800"],
    [
      "Expiring in 7 days",
      `${metrics.exp7.length} · ${formatBgCurrency(metrics.exp7.reduce((s, i) => s + i.currentAmount, 0))}`,
      "text-rose-700",
    ],
    [
      "Expiring in 30 days",
      `${metrics.exp30.length} · ${formatBgCurrency(metrics.exp30.reduce((s, i) => s + i.currentAmount, 0))}`,
      "text-orange-700",
    ],
    ["Expiring in 90 days", metrics.exp90.length, "text-amber-700"],
    [
      "Expired / claim active",
      `${metrics.expired.length} / ${metrics.claimActive.length}`,
      "text-rose-700",
    ],
    [
      "Extension / cancellation pending",
      `${metrics.pendingExtensions} / ${metrics.pendingCancellations}`,
      "text-violet-700",
    ],
    [
      "FD / cash margin",
      `${formatBgCurrency(metrics.fd)} / ${formatBgCurrency(metrics.cash)}`,
      "text-cyan-700",
    ],
    ["Invoked exposure", formatBgCurrency(metrics.invoked), "text-rose-700"],
    [
      "Commission difference",
      formatBgCurrency(metrics.difference),
      "text-amber-700",
    ],
    ["Original return pending", metrics.originals, "text-slate-800"],
  ];
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-0 bg-gradient-to-r from-slate-950 via-indigo-950 to-violet-950 text-white shadow-lg">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-indigo-300" />
              <h1 className="text-2xl font-bold">Bank Guarantee Management</h1>
            </div>
            <p className="mt-1 text-sm text-indigo-100">
              Limits, expiry, collateral, commission, custody, claims, and
              cancellation.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href="/bank-guarantee/new">
                <FilePlus2 className="mr-2 h-4 w-4" />
                Create BG Request
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/bank-guarantee/calendar">
                <CalendarClock className="mr-2 h-4 w-4" />
                Expiry Calendar
              </Link>
            </Button>
            {canExport && (
              <Button
                variant="secondary"
                disabled={exporting}
                onClick={() => void exportDashboard()}
              >
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Export
              </Button>
            )}
            <Button variant="secondary" size="icon" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-2 p-3 sm:grid-cols-3">
          <Select value={bank} onValueChange={setBank}>
            <SelectTrigger>
              <SelectValue placeholder="All banks" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Banks</SelectItem>
              {Array.from(
                new Map(
                  guarantees.map((item) => [item.bankId, item.bankName]),
                ).entries(),
              ).map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={project} onValueChange={setProject}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Projects</SelectItem>
              {Array.from(
                new Map(
                  guarantees.map((item) => [item.projectId, item.projectName]),
                ).entries(),
              ).map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              {Array.from(new Set(guarantees.map((item) => item.status))).map(
                (value) => (
                  <SelectItem key={value} value={value}>
                    {bgLabel(value)}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map(([label, value, tone]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-[11px] font-medium text-muted-foreground">
                {label}
              </p>
              <p className={`mt-1 text-lg font-bold ${tone}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Chart title="Bank-wise BG exposure" data={bankData} />
        <Chart title="Project-wise BG exposure" data={projectData} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={95}
                  label
                >
                  {statusData.map((_, index) => (
                    <Cell key={index} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertOctagon className="h-4 w-4 text-rose-600" />
              Critical exposure
            </CardTitle>
            <CardDescription>
              Invocations, expired BGs, and pending original returns.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            <Metric label="Invoked" value={formatBgCurrency(metrics.invoked)} />
            <Metric label="Expired" value={String(metrics.expired.length)} />
            <Metric label="Originals" value={String(metrics.originals)} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Expiry and claim action queue
          </CardTitle>
          <CardDescription>
            BGs reaching expiry within 120 days, expired, or inside claim
            period.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BG</TableHead>
                  <TableHead>Beneficiary / Project</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Claim Expiry</TableHead>
                  <TableHead>Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcoming.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link
                        className="font-medium text-indigo-700 hover:underline"
                        href={`/bank-guarantee/${item.id}`}
                      >
                        {item.bankBgNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {item.beneficiaryName}
                      <p className="text-xs text-muted-foreground">
                        {item.projectName}
                      </p>
                    </TableCell>
                    <TableCell>{item.bankName}</TableCell>
                    <TableCell className="text-right">
                      {formatBgCurrency(item.currentAmount, item.currency)}
                    </TableCell>
                    <TableCell>
                      {toBgDateInput(item.currentExpiryDate)}
                      <p className="text-xs text-muted-foreground">
                        {daysToBgDate(item.currentExpiryDate)} days
                      </p>
                    </TableCell>
                    <TableCell>
                      {toBgDateInput(item.currentClaimExpiryDate)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {bgLabel(item.extensionDecision || "NO_ACTION_YET")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {!upcoming.length && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No BGs in the 120-day action window.
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

function Chart({
  title,
  data,
}: {
  title: string;
  data: Array<{ name: string; amount: number }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis
              tickFormatter={(value) =>
                `${Math.round(Number(value) / 100000)}L`
              }
            />
            <Tooltip
              formatter={(value) => formatBgCurrency(Number(value || 0))}
            />
            <Bar dataKey="amount" fill="#4f46e5" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-slate-50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}
