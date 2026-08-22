'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { BarChart3, CalendarClock, FileSpreadsheet, Loader2, Printer, Store, Tags, TrendingUp } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { PaymentObligation, RP_COLLECTIONS, currency, effectiveStatus, matchesScopeFilter, recurringDateOnly, visibleObligations } from '@/lib/recurring-payments';
import { exportWorkbook } from '@/lib/report-excel';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import CollapsibleFilterCard from './collapsible-filter-card';
import { TableScrollArea } from './module-table-card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useGlobalScopes } from './use-global-scopes';
import {
  ReportAccessDenied,
  ReportErrorBanner,
  ReportHeader,
  ReportLoading,
  ReportMetricTile,
  ReportSummaryTable,
} from './report-ui';

const DEFAULT_FILTERS = { project: 'all', department: 'all' };

export default function RecurringPaymentReports() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const { activeProjects, activeDepartments } = useGlobalScopes();
  const organizationId = user?.organizationId || 'default';
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  useEffect(
    () => onSnapshot(
      query(collection(db, RP_COLLECTIONS.payments), where('organizationId', '==', organizationId)),
      snap => {
        setPayments(visibleObligations(snap.docs.map(d => ({ id: d.id, ...d.data(), status: effectiveStatus({ id: d.id, ...d.data() } as PaymentObligation) } as PaymentObligation))));
        setLoading(false);
      },
      () => {
        setLoading(false);
        setLoadError(true);
      },
    ),
    [organizationId],
  );

  const activeFilterCount = (Object.keys(DEFAULT_FILTERS) as Array<keyof typeof DEFAULT_FILTERS>)
    .filter(key => filters[key] !== DEFAULT_FILTERS[key]).length;

  const scopedPayments = useMemo(
    () => payments.filter(p =>
      matchesScopeFilter(filters.project, { id: p.projectId, name: p.projectName }, activeProjects.map(project => ({ id: project.id, name: project.projectName }))) &&
      matchesScopeFilter(filters.department, { id: p.departmentId, name: p.department }, activeDepartments.map(department => ({ id: department.id, name: department.name })))),
    [payments, filters, activeProjects, activeDepartments],
  );

  // "Non-void" excludes Cancelled/Waived — those never happened, so counting them into expense
  // exposure (category/vendor totals, the monthly trend) overstated spend. Draft/Scheduled
  // obligations are still included here (at their expected amount) since they're a real forecast,
  // not yet-realized spend — that distinction is what "open" (below) narrows further for ageing.
  const nonVoid = useMemo(() => scopedPayments.filter(p => !['Cancelled', 'Waived'].includes(p.status)), [scopedPayments]);
  const open = useMemo(() => scopedPayments.filter(p => !['Paid', 'Closed', 'Cancelled', 'Waived'].includes(p.status)), [scopedPayments]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const outflow = (days: number) => open.filter(p => {
    if (!p.dueDate) return false;
    const due = new Date(`${p.dueDate}T00:00:00`);
    return due >= today && due <= new Date(today.getTime() + days * 86_400_000);
  }).reduce((s, p) => s + (p.billAmount || p.expectedAmount), 0);

  const byCategory = group(nonVoid, p => p.category);
  const byVendor = group(nonVoid, p => p.vendorName);
  const ageing = [['1–7 days', 1, 7], ['8–15 days', 8, 15], ['16–30 days', 16, 30], ['31–60 days', 31, 60], ['Above 60 days', 61, 100_000]].map(([label, min, max]) => {
    const subset = open.filter(p => {
      if (!p.dueDate) return false;
      const days = Math.floor((today.getTime() - new Date(`${p.dueDate}T00:00:00`).getTime()) / 86_400_000);
      return days >= Number(min) && days <= Number(max);
    });
    return { label: String(label), count: subset.length, amount: subset.reduce((s, p) => s + (p.billAmount || p.expectedAmount) - (p.settledAmount || p.paidAmount), 0) };
  });
  const monthly = Array.from({ length: 6 }, (_, index) => {
    const d = new Date(today.getFullYear(), today.getMonth() - (5 - index), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const subset = nonVoid.filter(p => p.dueDate?.startsWith(key));
    return {
      month: d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
      expected: subset.reduce((s, p) => s + p.expectedAmount, 0),
      actual: subset.reduce((s, p) => s + (p.billAmount || p.expectedAmount), 0),
      paid: subset.reduce((s, p) => s + p.paidAmount, 0),
    };
  });

  async function excel() {
    setExporting(true);
    try {
      await exportWorkbook(`recurring-payment-report-${recurringDateOnly(new Date())}.xlsx`, [
        {
          name: 'Payment Register',
          columns: [
            { header: 'Cycle', key: 'cycleKey', width: 22 },
            { header: 'Title', key: 'title', width: 32 },
            { header: 'Category', key: 'category', width: 24 },
            { header: 'Vendor', key: 'vendorName', width: 24 },
            { header: 'Due Date', key: 'dueDate', width: 14 },
            { header: 'Expected', key: 'expectedAmount', width: 14 },
            { header: 'Bill Amount', key: 'billAmount', width: 14 },
            { header: 'Paid', key: 'paidAmount', width: 14 },
            { header: 'Status', key: 'status', width: 18 },
            { header: 'Stage', key: 'stage', width: 22 },
          ],
          rows: scopedPayments.map(p => ({ ...p, billAmount: p.billAmount || p.expectedAmount })),
        },
        {
          name: 'Category Summary',
          columns: [
            { header: 'Category', key: 'name', width: 30 },
            { header: 'Count', key: 'count', width: 12 },
            { header: 'Amount', key: 'amount', width: 18 },
          ],
          rows: byCategory,
        },
        {
          name: 'Vendor Summary',
          columns: [
            { header: 'Vendor', key: 'name', width: 30 },
            { header: 'Count', key: 'count', width: 12 },
            { header: 'Amount', key: 'amount', width: 18 },
          ],
          rows: byVendor,
        },
        {
          name: 'Overdue Ageing',
          columns: [
            { header: 'Bucket', key: 'label', width: 20 },
            { header: 'Count', key: 'count', width: 12 },
            { header: 'Outstanding', key: 'amount', width: 18 },
          ],
          rows: ageing,
        },
      ]);
      toast({ title: 'Excel report exported' });
    } catch {
      toast({ title: 'Excel export failed', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <ReportLoading />;
  if (!can('View', 'Recurring Payments.Reports')) return <ReportAccessDenied />;

  return (
    <div className="space-y-5 print:p-0">
      <ReportHeader
        title="Recurring Payment Analytics"
        description="Cash-flow, category, vendor, trend and overdue analysis"
        hero={{
          label: "Open outflow, next 30 days",
          value: currency(outflow(30)),
          hint: `${open.length} obligation(s) still open`,
        }}
        actions={
          <>
            {can('Export', 'Recurring Payments.Reports') && (
              <Button variant="secondary" onClick={excel} disabled={exporting}>
                {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                Excel
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

      <CollapsibleFilterCard activeCount={activeFilterCount} onClear={() => setFilters(DEFAULT_FILTERS)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground">Project</Label>
            <Select value={filters.project} onValueChange={project => setFilters(current => ({ ...current, project }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All global projects" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All global projects</SelectItem>
                {activeProjects.map(project => <SelectItem value={project.id} key={project.id}>{project.projectName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground">Department</Label>
            <Select value={filters.department} onValueChange={department => setFilters(current => ({ ...current, department }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All global departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All global departments</SelectItem>
                {activeDepartments.map(department => <SelectItem value={department.id} key={department.id}>{department.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleFilterCard>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[7, 15, 30, 60, 90].map(days => (
          <ReportMetricTile key={days} label={`Next ${days} days`} value={currency(outflow(days))} icon={CalendarClock} tone="neutral" />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportSummaryTable title="Category-wise expense" description="Total billed (or expected, where no bill exists yet) value, by category — excludes cancelled/waived" icon={Tags} rows={byCategory} />
        <ReportSummaryTable title="Vendor-wise expense" description="Top 12 vendors by total value — excludes cancelled/waived" icon={Store} rows={byVendor.slice(0, 12)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-emerald-600" />Six-month comparison</CardTitle>
          <CardDescription>Expected vs. billed vs. paid, over the trailing 6 months — excludes cancelled/waived</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <TableScrollArea>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Actual bills</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthly.map(row => (
                <TableRow key={row.month}>
                  <TableCell>{row.month}</TableCell>
                  <TableCell className="text-right">{currency(row.expected)}</TableCell>
                  <TableCell className="text-right">{currency(row.actual)}</TableCell>
                  <TableCell className="text-right">{currency(row.paid)}</TableCell>
                  <TableCell className={`text-right ${row.actual > row.expected ? 'text-red-600' : 'text-emerald-600'}`}>
                    {row.expected ? `${(((row.actual - row.expected) / row.expected) * 100).toFixed(1)}%` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </TableScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-red-600" />Overdue ageing</CardTitle>
          <CardDescription>Outstanding obligations grouped by days past due</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <TableScrollArea>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ageing bucket</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ageing.map(row => (
                <TableRow key={row.label}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="text-right">{row.count}</TableCell>
                  <TableCell className="text-right font-semibold">{currency(row.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </TableScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function group(payments: PaymentObligation[], key: (p: PaymentObligation) => string) {
  return Object.entries(
    payments.reduce<Record<string, { count: number; amount: number }>>((acc, p) => {
      const name = key(p) || 'Unspecified';
      acc[name] ??= { count: 0, amount: 0 };
      acc[name].count++;
      acc[name].amount += (p.billAmount || p.expectedAmount);
      return acc;
    }, {}),
  ).map(([name, value]) => ({ name, ...value })).sort((a, b) => b.amount - a.amount);
}
