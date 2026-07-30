"use client";
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Download, Loader2, Printer } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
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
import { Input } from "@/components/ui/input";
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
    "Monthly Expense Summary",
    "Expected, billed and paid recurring expenses",
  ],
  "cash-flow": [
    "Cash-Flow Forecast",
    "Expected, confirmed, approved and overdue outflow",
  ],
} as const;
export default function RecurringReportRoutePage({
  kind,
}: {
  kind: ReportKind;
}) {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const organizationId = user?.organizationId || "default";
  const { activeProjects, activeDepartments } = useGlobalScopes();
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    category: "all",
    vendor: "all",
    status: "all",
    branch: "all",
    project: "all",
    department: "all",
    min: "",
    max: "",
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
          if (filters.from && item.dueDate < filters.from) return false;
          if (filters.to && item.dueDate > filters.to) return false;
          if (filters.category !== "all" && item.category !== filters.category)
            return false;
          if (filters.vendor !== "all" && item.vendorName !== filters.vendor)
            return false;
          if (filters.status !== "all" && item.status !== filters.status)
            return false;
          if (filters.branch !== "all" && item.branchName !== filters.branch)
            return false;
          if (
            filters.project !== "all" &&
            item.projectId !== filters.project &&
            item.projectName !==
              activeProjects.find((project) => project.id === filters.project)
                ?.projectName
          )
            return false;
          if (
            filters.department !== "all" &&
            item.departmentId !== filters.department &&
            item.department !==
              activeDepartments.find(
                (department) => department.id === filters.department,
              )?.name
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
  function exportCsv() {
    const data = [
      [
        "Payment ID",
        "Title",
        "Category",
        "Vendor",
        "Branch",
        "Project",
        "Department",
        "Due Date",
        "Expected",
        "Bill",
        "Paid",
        "Outstanding",
        "Status",
        "Confidence",
      ],
      ...rows.map((item) => [
        item.id,
        item.title,
        item.category,
        item.vendorName,
        item.branchName || "",
        item.projectName || "",
        item.department || "",
        item.dueDate,
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
    ];
    const blob = new Blob(
      [
        data
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
    anchor.download = `recurring-${kind}-${today}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
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
        <Metric label="Expected total" value={currency(expected)} />
        <Metric label="Confirmed bill total" value={currency(confirmed)} />
        <Metric label="Paid total" value={currency(paid)} />
        <Metric label="Outstanding total" value={currency(outstanding)} />
      </div>
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Report filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            type="date"
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
            value={filters.to}
            onChange={(event) =>
              setFilters((current) => ({ ...current, to: event.target.value }))
            }
          />
          <Filter
            value={filters.category}
            label="All categories"
            options={values("category")}
            onChange={(category) =>
              setFilters((current) => ({ ...current, category }))
            }
          />
          <Filter
            value={filters.vendor}
            label="All vendors"
            options={values("vendorName")}
            onChange={(vendor) =>
              setFilters((current) => ({ ...current, vendor }))
            }
          />
          <Filter
            value={filters.status}
            label="All statuses"
            options={values("status")}
            onChange={(status) =>
              setFilters((current) => ({ ...current, status }))
            }
          />
          <Filter
            value={filters.branch}
            label="All branches"
            options={values("branchName")}
            onChange={(branch) =>
              setFilters((current) => ({ ...current, branch }))
            }
          />
          <Select
            value={filters.project}
            onValueChange={(project) =>
              setFilters((current) => ({ ...current, project }))
            }
          >
            <SelectTrigger>
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
          <Select
            value={filters.department}
            onValueChange={(department) =>
              setFilters((current) => ({ ...current, department }))
            }
          >
            <SelectTrigger>
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
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              placeholder="Min amount"
              value={filters.min}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  min: event.target.value,
                }))
              }
            />
            <Input
              type="number"
              placeholder="Max amount"
              value={filters.max}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  max: event.target.value,
                }))
              }
            />
          </div>
        </CardContent>
      </Card>
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
                  <TableHead>Category / vendor</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Confidence / status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.dueDate}</TableCell>
                    <TableCell>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.projectName ||
                          item.branchName ||
                          "Organization-wide"}
                      </p>
                    </TableCell>
                    <TableCell>
                      {item.category}
                      <p className="text-xs text-muted-foreground">
                        {item.vendorName}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      {currency(item.expectedAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {currency(item.billAmount || 0)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {currency(
                        Math.max(
                          0,
                          (item.billAmount || item.expectedAmount) -
                            (item.settledAmount || item.paidAmount),
                        ),
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.status}</Badge>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.billAmount
                          ? "Confirmed bill"
                          : item.amountType === "Fixed"
                            ? "Fixed"
                            : "Estimated"}
                      </p>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
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
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-bold">{value}</p>
      </CardContent>
    </Card>
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
      <SelectTrigger>
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
