'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs } from 'firebase/firestore';
import { addMonths, format, startOfDay } from 'date-fns';
import { Download, IndianRupee, RefreshCw, TrendingUp } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import type { InsurancePolicy, ProjectInsurancePolicy } from '@/lib/types';
import { bucketByMonth, formatDay, formatInr, premiumOutflows, type Outflow } from '@/lib/insurance';
import { PERSONAL_POLICIES, PROJECT_POLICIES } from '@/lib/insurance-service';
import { exportWorkbook } from '@/lib/report-excel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { AccessDenied } from '@/components/insurance/insurance-ui';
import { cn } from '@/lib/utils';

/**
 * What the insurance book will cost over the coming months — every personal instalment still to
 * fall due and every project renewal, bucketed by month, for cash planning. Premiums already in
 * arrears are carried into the first month so they are budgeted rather than forgotten.
 */
export default function PremiumForecastPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View Reports', 'Insurance.Reports') || can('View', 'Insurance.Reports');
  const canPersonal = can('View', 'Insurance.Personal Insurance');
  const canProject = can('View', 'Insurance.Project Insurance');

  const [personal, setPersonal] = useState<InsurancePolicy[]>([]);
  const [project, setProject] = useState<ProjectInsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [months, setMonths] = useState('12');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [p, j] = await Promise.all([
        canPersonal ? getDocs(collection(db, PERSONAL_POLICIES)) : null,
        canProject ? getDocs(collection(db, PROJECT_POLICIES)) : null,
      ]);
      setPersonal(p ? p.docs.map((d) => ({ id: d.id, ...d.data() } as InsurancePolicy)) : []);
      setProject(j ? j.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectInsurancePolicy)) : []);
    } catch (error) {
      console.error('Error loading forecast:', error);
      toast({ title: 'Error', description: 'Failed to load policies.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [canPersonal, canProject, toast]);

  useEffect(() => {
    if (authLoading) return;
    if (canView) load();
    else setIsLoading(false);
  }, [authLoading, canView, load]);

  const horizon = Number(months);
  const { outflows, buckets, totals } = useMemo(() => {
    const from = startOfDay(new Date());
    const to = addMonths(from, horizon);
    const outflows = premiumOutflows(personal, project, from, to, from);
    const buckets = bucketByMonth(outflows, from, horizon + 1).filter((b) => b.count > 0 || b.month < to);
    return {
      outflows,
      buckets,
      totals: {
        personal: buckets.reduce((s, b) => s + b.personal, 0),
        project: buckets.reduce((s, b) => s + b.project, 0),
        total: buckets.reduce((s, b) => s + b.total, 0),
        arrears: outflows.filter((o) => o.overdue).reduce((s, o) => s + o.amount, 0),
        count: outflows.length,
      },
    };
  }, [personal, project, horizon]);

  const peak = buckets.reduce((m, b) => (b.total > m.total ? b : m), buckets[0] ?? { total: 0, key: '', month: new Date() });
  const detail: Outflow[] = selectedMonth ? outflows.filter((o) => format(o.date, 'yyyy-MM') === selectedMonth) : outflows;

  const exportForecast = () =>
    exportWorkbook(`Insurance Premium Forecast ${format(new Date(), 'yyyy-MM-dd')}.xlsx`, [
      {
        name: 'By Month',
        columns: [
          { header: 'Month', key: 'month', width: 14 },
          { header: 'Personal Premiums', key: 'personal', width: 20 },
          { header: 'Project Renewals', key: 'project', width: 20 },
          { header: 'Total', key: 'total', width: 16 },
          { header: 'Payments', key: 'count', width: 12 },
        ],
        rows: buckets.map((b) => ({ month: format(b.month, 'MMM yyyy'), personal: b.personal, project: b.project, total: b.total, count: b.count })),
      },
      {
        name: 'Payments',
        columns: [
          { header: 'Date', key: 'date', width: 14 },
          { header: 'Type', key: 'kind', width: 12 },
          { header: 'Holder / Asset', key: 'label', width: 28 },
          { header: 'Policy No.', key: 'policyNo', width: 20 },
          { header: 'Insurer', key: 'company', width: 24 },
          { header: 'Amount', key: 'amount', width: 14 },
          { header: 'Arrears', key: 'overdue', width: 10 },
        ],
        rows: outflows.map((o) => ({
          date: formatDay(o.date), kind: o.kind === 'personal' ? 'Premium' : 'Renewal', label: o.label,
          policyNo: o.policyNo, company: o.company, amount: o.amount, overdue: o.overdue ? 'Yes' : '',
        })),
      },
    ]);

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }
  if (!canView) return <AccessDenied what="view insurance reports" />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={TrendingUp}
        title="Premium Forecast"
        description="Premiums and renewals falling due, month by month — for cash-flow planning"
        backHref="/insurance/reports"
        backLabel="Back to reports"
        actions={
          <>
            <Select value={months} onValueChange={(v) => { setMonths(v); setSelectedMonth(null); }}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Horizon"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Next 3 months</SelectItem>
                <SelectItem value="6">Next 6 months</SelectItem>
                <SelectItem value="12">Next 12 months</SelectItem>
                <SelectItem value="24">Next 24 months</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportForecast} disabled={outflows.length === 0}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden border-border/60">
        <CardContent className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5">
          {[
            { label: `Total, ${horizon} months`, value: formatInr(totals.total), color: 'text-slate-800' },
            { label: 'Personal premiums', value: formatInr(totals.personal), color: 'text-violet-600' },
            { label: 'Project renewals', value: formatInr(totals.project), color: 'text-emerald-600' },
            { label: 'Arrears carried in', value: formatInr(totals.arrears), color: totals.arrears ? 'text-red-600' : 'text-slate-500' },
            { label: peak?.total ? `Peak: ${format(peak.month, 'MMM yyyy')}` : 'Peak month', value: formatInr(peak?.total ?? 0), color: 'text-amber-600' },
          ].map((s, i) => (
            <div key={s.label} className={cn('flex min-w-0 flex-col items-center rounded-lg py-2 text-center', i === 0 && 'col-span-2 sm:col-span-1')}>
              <span className={cn('truncate text-base font-bold leading-tight sm:text-lg', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {!canPersonal || !canProject ? (
        <p className="text-xs text-muted-foreground">
          Showing {canPersonal ? 'personal' : 'project'} insurance only — you do not have access to the other register.
        </p>
      ) : null}

      <TableCard title="By month" icon={IndianRupee} description="Select a month to list its payments below." scroll="natural">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Personal Premiums</TableHead>
              <TableHead className="text-right">Project Renewals</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Payments</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buckets.map((b) => (
              <TableRow
                key={b.key}
                onClick={() => setSelectedMonth(selectedMonth === b.key ? null : b.key)}
                className={cn('cursor-pointer', selectedMonth === b.key && 'bg-muted/60', b.count === 0 && 'text-muted-foreground')}
                aria-selected={selectedMonth === b.key}
              >
                <TableCell className="whitespace-nowrap font-medium">{format(b.month, 'MMM yyyy')}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{b.personal ? formatInr(b.personal) : '—'}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{b.project ? formatInr(b.project) : '—'}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{b.total ? formatInr(b.total) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{b.count || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(totals.personal)}</TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(totals.project)}</TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(totals.total)}</TableCell>
              <TableCell className="text-right tabular-nums">{totals.count}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableCard>

      <TableCard
        title={selectedMonth ? `Payments in ${format(new Date(`${selectedMonth}-01T00:00:00`), 'MMMM yyyy')}` : 'All payments'}
        count={detail.length}
        noun="payment"
        scroll="natural"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Holder / Asset</TableHead>
              <TableHead>Policy No.</TableHead>
              <TableHead>Insurer</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">Nothing falls due in this period.</TableCell></TableRow>
            ) : detail.map((o, i) => (
              <TableRow key={`${o.kind}-${o.policyId}-${o.date.getTime()}-${i}`}>
                <TableCell className="whitespace-nowrap">
                  {formatDay(o.date)}
                  {o.overdue && <span className="ml-1 text-[10px] font-medium text-red-600">arrears</span>}
                </TableCell>
                <TableCell>{o.kind === 'personal' ? 'Premium' : 'Renewal (est.)'}</TableCell>
                <TableCell className="font-medium">
                  <Link href={o.kind === 'personal' ? `/insurance/personal/${o.policyId}` : '/insurance/project/premium-due'} className="hover:underline">{o.label}</Link>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono">{o.policyNo}</TableCell>
                <TableCell>{o.company}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(o.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
