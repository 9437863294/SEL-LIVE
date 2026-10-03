"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Download, Loader2, Printer, Store } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  matchesScopeFilter,
  RP_COLLECTIONS,
  currency,
  effectiveStatus,
  outstandingAmountOf,
  paymentTiming,
  recurringDateOnly,
  type PaymentObligation,
  visibleObligations,
} from "@/lib/recurring-payments";
import { exportWorkbook } from "@/lib/report-excel";
import type { RecurringVendor } from "./vendor-management";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/shared/filter-bar";
import { TableCard } from "@/components/shared/table-card";
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
import {
  ReportAccessDenied,
  ReportErrorBanner,
  ReportLoading,
  ReportMetricTile,
} from "./report-ui";
import { PageHeader } from "@/components/shared/page-header";

/**
 * Vendor is a first-class entity in this module (its own register, its own masked banking
 * details) but had zero dedicated reporting — every other report groups by category or shows a
 * flat obligation list, so "how much do we owe this vendor, and how overdue is it" had no answer
 * short of manually filtering the Upcoming/Overdue tables one vendor at a time. Groups every
 * obligation by `vendorName` (obligations only ever store the vendor's name, not an id) and joins
 * the vendor register in for status/category context.
 */
const DEFAULT_FILTERS = {
  from: "",
  to: "",
  category: "all",
  project: "all",
  department: "all",
  search: "",
};

type VendorRow = {
  vendorName: string;
  category: string;
  vendorStatus: string;
  count: number;
  expected: number;
  billed: number;
  paid: number;
  outstanding: number;
  overdueCount: number;
  oldestOverdueDays: number;
  lastPaymentDate: string;
};

export default function VendorSpendReport() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const organizationId = user?.organizationId || "default";
  const { activeProjects, activeDepartments } = useGlobalScopes();
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [vendors, setVendors] = useState<RecurringVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  useEffect(() => {
    const stops = [
      onSnapshot(
        query(collection(db, RP_COLLECTIONS.payments), where("organizationId", "==", organizationId)),
        (snapshot) => {
          setPayments(
            visibleObligations(
              snapshot.docs.map(
                (item) =>
                  ({
                    id: item.id,
                    ...item.data(),
                    status: effectiveStatus({ id: item.id, ...item.data() } as PaymentObligation),
                  }) as PaymentObligation,
              ),
            ),
          );
          setLoading(false);
        },
        () => {
          setLoading(false);
          setLoadError(true);
        },
      ),
      onSnapshot(
        query(collection(db, RP_COLLECTIONS.vendors), where("organizationId", "==", organizationId)),
        (snapshot) => setVendors(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as RecurringVendor)),
        () => setLoadError(true),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [organizationId]);

  const categories = useMemo(
    () => [...new Set(payments.map((item) => item.category).filter(Boolean))].sort(),
    [payments],
  );

  const filtered = useMemo(
    () =>
      payments.filter((item) => {
        if (filters.from && item.dueDate < filters.from) return false;
        if (filters.to && item.dueDate > filters.to) return false;
        if (filters.category !== "all" && item.category !== filters.category) return false;
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
        return true;
      }),
    [payments, filters, activeProjects, activeDepartments],
  );

  const activeFilterCount = (Object.keys(DEFAULT_FILTERS) as Array<keyof typeof DEFAULT_FILTERS>)
    .filter((key) => filters[key] !== DEFAULT_FILTERS[key]).length;

  const vendorMap = useMemo(() => new Map(vendors.map((item) => [item.name, item])), [vendors]);

  const rows = useMemo<VendorRow[]>(() => {
    const byVendor = new Map<string, VendorRow>();
    filtered.forEach((item) => {
      // Cancelled/Waived/Rejected obligations were never owed, so they count toward neither the
      // vendor's billed value nor what is outstanding with them.
      if (["Cancelled", "Waived", "Rejected"].includes(item.status)) return;
      const name = item.vendorName || "Unspecified";
      const row =
        byVendor.get(name) ||
        ({
          vendorName: name,
          category: item.category || "",
          vendorStatus: vendorMap.get(name)?.status || "Not in register",
          count: 0,
          expected: 0,
          billed: 0,
          paid: 0,
          outstanding: 0,
          overdueCount: 0,
          oldestOverdueDays: 0,
          lastPaymentDate: "",
        } as VendorRow);
      row.count += 1;
      row.expected += Number(item.expectedAmount || 0);
      row.billed += Number(item.billAmount || item.expectedAmount || 0);
      row.paid += Number(item.paidAmount || 0);
      row.outstanding += outstandingAmountOf(item);
      if (item.status === "Overdue") {
        row.overdueCount += 1;
        // Days past grace — the point the payment became Overdue — not past the due date.
        row.oldestOverdueDays = Math.max(row.oldestOverdueDays, paymentTiming(item).daysPastGrace);
      }
      if (item.paymentDate && item.paymentDate > row.lastPaymentDate) row.lastPaymentDate = item.paymentDate;
      byVendor.set(name, row);
    });
    return [...byVendor.values()]
      .filter((row) => !filters.search || row.vendorName.toLowerCase().includes(filters.search.trim().toLowerCase()))
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [filtered, vendorMap, filters.search]);

  const totals = useMemo(
    () => ({
      vendorCount: rows.length,
      billed: rows.reduce((sum, row) => sum + row.billed, 0),
      paid: rows.reduce((sum, row) => sum + row.paid, 0),
      outstanding: rows.reduce((sum, row) => sum + row.outstanding, 0),
      vendorsOverdue: rows.filter((row) => row.overdueCount > 0).length,
    }),
    [rows],
  );

  async function exportReport() {
    setIsExporting(true);
    try {
      await exportWorkbook(`recurring-vendor-spend-${recurringDateOnly(new Date())}.xlsx`, [
        {
          name: "Vendor Spend & Ageing",
          columns: [
            { header: "Vendor", key: "vendorName", width: 30 },
            { header: "Category", key: "category", width: 20 },
            { header: "Vendor Status", key: "vendorStatus", width: 16 },
            { header: "Payments", key: "count", width: 12 },
            { header: "Billed", key: "billed", width: 16 },
            { header: "Paid", key: "paid", width: 16 },
            { header: "Outstanding", key: "outstanding", width: 16 },
            { header: "Overdue Count", key: "overdueCount", width: 14 },
            { header: "Oldest Overdue (days)", key: "oldestOverdueDays", width: 18 },
            { header: "Last Payment Date", key: "lastPaymentDate", width: 16 },
          ],
          rows,
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
        title="Vendor Spend & Ageing"
        description="Total billed, paid and outstanding value per vendor, with overdue ageing"
        meta={[{
          label: "Outstanding",
          value: currency(totals.outstanding),
          hint: `across ${totals.vendorCount} vendor(s)`,
        }]}
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
        <ReportMetricTile label="Vendors with activity" value={String(totals.vendorCount)} icon={Store} tone="neutral" />
        <ReportMetricTile label="Total billed" value={currency(totals.billed)} tone="neutral" />
        <ReportMetricTile label="Total paid" value={currency(totals.paid)} tone="good" />
        <ReportMetricTile
          label="Outstanding"
          value={currency(totals.outstanding)}
          tone={totals.outstanding > 0 ? "warning" : "good"}
        />
      </div>
      <TableCard
        title="Vendors"
        count={rows.length}
        noun="vendor"
        description={<>Sorted by outstanding value, highest first — {totals.vendorsOverdue} with at least one overdue payment</>}
        toolbar={
          <FilterBar
            search={{
              value: filters.search,
              onChange: (search) => setFilters((current) => ({ ...current, search })),
              placeholder: "Search vendor...",
            }}
            activeCount={activeFilterCount - (filters.search ? 1 : 0)}
            onClear={() => setFilters(DEFAULT_FILTERS)}
          >
            <Input
              type="date"
              aria-label="Due date from"
              value={filters.from}
              onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
            />
            <Input
              type="date"
              aria-label="Due date to"
              value={filters.to}
              onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
            />
            <Select value={filters.category} onValueChange={(category) => setFilters((current) => ({ ...current, category }))}>
              <SelectTrigger aria-label="Category"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((category) => <SelectItem value={category} key={category}>{category}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.project} onValueChange={(project) => setFilters((current) => ({ ...current, project }))}>
              <SelectTrigger aria-label="Project"><SelectValue placeholder="All global projects" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All global projects</SelectItem>
                {activeProjects.map((project) => <SelectItem value={project.id} key={project.id}>{project.projectName}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Payments</TableHead>
              <TableHead className="text-right">Billed</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Ageing</TableHead>
              <TableHead>Last payment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.vendorName}>
                <TableCell className="whitespace-nowrap font-medium">{row.vendorName}</TableCell>
                <TableCell className="whitespace-nowrap">{row.category || "—"}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <StatusBadge status={row.vendorStatus} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">{row.count}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{currency(row.billed)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{currency(row.paid)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{currency(row.outstanding)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.overdueCount > 0 ? (
                    <StatusBadge tone="danger">
                      {row.overdueCount} overdue · {row.oldestOverdueDays}d oldest
                    </StatusBadge>
                  ) : (
                    <span className="text-muted-foreground">On track</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{row.lastPaymentDate || "—"}</TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={9} className="h-28 text-center text-muted-foreground">
                  No vendor activity matches the report filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}

