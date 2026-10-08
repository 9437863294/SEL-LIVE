'use client';

/**
 * Bill Tracking dashboard (`/bill-tracking/dashboard`).
 *
 * Every figure is computed on the server from the caller's in-scope bills for the selected filters,
 * and every figure is a way in: KPI cards, chart bars and table rows link to the register, the
 * outstanding list or a report pre-filtered to exactly what was counted.
 */

import Link from 'next/link';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CircleDollarSign,
  Clock,
  Coins,
  Gauge,
  HandCoins,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  ReceiptIndianRupee,
  Scissors,
  TrendingUp,
  Wallet,
} from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KpiCard } from '@/components/shared/kpi-card';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { Input } from '@/components/ui/input';
import { TRANSACTION_TYPE_LABELS } from '@/lib/bill-tracking/types';
import { categoryName } from '@/lib/bill-tracking/categories';
import type { AgeingReport, CollectionLine, DashboardKpis, ExceptionItem, ForecastItem, ForecastWindow, GroupRow, MonthlyFlowPoint, TargetPerformanceRow } from '@/lib/bill-tracking/reports';

import { useBtQuery, useLookups } from './bt-client';
import { useUrlFilters } from './bt-filters';
import { billReference, type BillRow } from './bill-register';
import { AgeingChart, BillingCollectionChart, ChartPanel, RankedBars, RetentionBar, TargetActualChart } from './dashboard-charts';
import { AgeingBadge, Amount, BtError, BtLoading, DrillLink, FySelect, MoneyKpi, dateText, percentText, toQuery } from './bt-ui';

interface DashboardData {
  asOf: string;
  financialYear: string;
  kpis: DashboardKpis;
  monthly: MonthlyFlowPoint[];
  projects: GroupRow[];
  clients: GroupRow[];
  billTypes: GroupRow[];
  ageing: AgeingReport;
  targets: TargetPerformanceRow[];
  forecast: ForecastWindow[];
  oldest: BillRow[];
  recentCollections: CollectionLine[];
  expectedThisWeek: ForecastItem[];
  missedCommitments: BillRow[];
  needsFollowUp: ExceptionItem[];
  exceptions: { kind: string; label: string; count: number; amount: number }[];
  retention: { deducted: number; released: number; balance: number; dueThisMonth: number; overdue: number };
}

function MiniSelect({ label, value, onChange, options, all }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; all: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value || 'any'} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value="any">{all}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TableBlock({ title, children, href, linkLabel = 'View all' }: { title: string; children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <section className="min-w-0 rounded-xl border border-white/60 bg-white/85 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {href ? (
          <Link href={href} className="text-xs font-medium text-emerald-700 hover:underline">
            {linkLabel}
          </Link>
        ) : null}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500';
const td = 'px-3 py-2 text-sm';

export default function BillTrackingDashboard() {
  const lookups = useLookups();
  const filters = useUrlFilters();
  const { data, loading, error, reload } = useBtQuery<DashboardData>(`dashboard?${filters.apiQuery()}`);
  const fy = filters.fy;
  // Links carry the dashboard's own filters forward.
  const carry = { fy, project: filters.get('project'), client: filters.get('client'), dgm: filters.get('dgm'), billType: filters.get('billType'), txn: filters.get('txn'), from: filters.get('from'), to: filters.get('to') };
  const link = (path: string, extra: Record<string, string | undefined> = {}) => `${path}${toQuery({ ...carry, ...extra })}`;

  return (
    <div className="space-y-4">
      <PageHeader icon={LayoutDashboard} title="Billing & Collection Dashboard" description={data ? `As on ${dateText(data.asOf)} · FY ${data.financialYear}${lookups.allProjects ? '' : ` · your ${lookups.projects.length} assigned project(s)`}` : 'Billing, collections, outstanding and retention at a glance.'} />

      <FilterBar activeCount={filters.activeCount} onClear={filters.clear}>
        <div className="min-w-0 space-y-1">
          <Label className="text-xs text-muted-foreground">Financial year</Label>
          <FySelect value={fy} onChange={(value) => filters.set({ fy: value })} />
        </div>
        <MiniSelect label="Project" value={filters.get('project')} onChange={(value) => filters.set({ project: value })} options={lookups.projects.map((project) => ({ value: project.id, label: project.name }))} all="All projects" />
        <MiniSelect label="Client" value={filters.get('client')} onChange={(value) => filters.set({ client: value })} options={lookups.clients.map((client) => ({ value: client.id, label: client.name }))} all="All clients" />
        <MiniSelect label="DGM office" value={filters.get('dgm')} onChange={(value) => filters.set({ dgm: value })} options={lookups.dgmOffices.map((office) => ({ value: office, label: office }))} all="All offices" />
        <MiniSelect label="Sub category" value={filters.get('billType')} onChange={(value) => filters.set({ billType: value })} options={lookups.config.billTypes.filter((type) => type.active).map((type) => ({ value: type.name, label: type.name }))} all="All sub categories" />
        <MiniSelect label="Transaction" value={filters.get('txn')} onChange={(value) => filters.set({ txn: value })} options={Object.entries(TRANSACTION_TYPE_LABELS).map(([value, label]) => ({ value, label }))} all="All" />
        <div className="min-w-0 space-y-1">
          <Label className="text-xs text-muted-foreground">Bill date from</Label>
          <Input type="date" className="h-9" value={filters.get('from')} onChange={(event) => filters.set({ from: event.target.value })} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label className="text-xs text-muted-foreground">to</Label>
          <Input type="date" className="h-9" value={filters.get('to')} onChange={(event) => filters.set({ to: event.target.value })} />
        </div>
      </FilterBar>

      <BtError message={error} onRetry={reload} />
      {loading && !data ? <BtLoading label="Calculating…" /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MoneyKpi label="Taxable billing" value={data.kpis.taxable} icon={ReceiptIndianRupee} tone="blue" href={link('/bill-tracking/bills')} />
            <MoneyKpi label="GST" value={data.kpis.gst} icon={Landmark} tone="indigo" href={link('/bill-tracking/reports/monthly')} />
            <MoneyKpi label="Gross billing" value={data.kpis.gross} icon={Banknote} tone="violet" href={link('/bill-tracking/bills')} />
            <MoneyKpi label="Total deduction" value={data.kpis.deduction} icon={Scissors} tone="orange" href={link('/bill-tracking/deductions')} />
            <MoneyKpi label="Net receivable" value={data.kpis.net} icon={Coins} tone="teal" href={link('/bill-tracking/bills')} />
            <MoneyKpi label="Total collection" value={data.kpis.received} icon={Wallet} tone="emerald" href={link('/bill-tracking/reports/collections')} />
            <MoneyKpi label="Total outstanding" value={data.kpis.outstanding} icon={Clock} tone="rose" href={link('/bill-tracking/outstanding')} />
            <KpiCard label="Collection %" value={percentText(data.kpis.collectionPercent)} icon={Gauge} tone="cyan" hint="Received ÷ net receivable" href={link('/bill-tracking/reports/project-wise')} />
            <MoneyKpi label="Retention deducted" value={data.kpis.retention} icon={PiggyBank} tone="violet" href={link('/bill-tracking/retention')} />
            <MoneyKpi label="Retention released" value={data.kpis.retentionReleased} icon={HandCoins} tone="emerald" href={link('/bill-tracking/retention')} />
            <MoneyKpi label="Retention balance" value={data.kpis.retentionBalance} icon={PiggyBank} tone="amber" href={link('/bill-tracking/retention')} />
            <MoneyKpi label="Overdue amount" value={data.kpis.overdue} icon={AlertTriangle} tone="rose" hint="Past due date" href={link('/bill-tracking/outstanding', { chip: 'overdue' })} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard label="Collected this month" value={<Amount value={data.kpis.collectionThisMonth} compact />} icon={TrendingUp} tone="emerald" href={link('/bill-tracking/reports/collections')} />
            <KpiCard label="Promised this week" value={<Amount value={data.kpis.promisedThisWeek} compact />} icon={CalendarClock} tone="blue" hint="Open client commitments due this week" href={link('/bill-tracking/targets')} />
            <KpiCard label="Missed commitments" value={data.kpis.missedCommitments.toLocaleString('en-IN')} icon={CircleDollarSign} tone="rose" hint="Commitment date passed, still outstanding" href={link('/bill-tracking/outstanding', { chip: 'commitment_missed' })} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartPanel title="Billing vs collection" description="Net billed and collected each month; the line is outstanding at month end. Click a bar to open those bills.">
              <BillingCollectionChart data={data.monthly} fy={data.financialYear} />
            </ChartPanel>
            <ChartPanel title="Ageing of outstanding" description={`As on ${dateText(data.asOf)}. Click a bucket to open those bills.`} footer={`Total ${data.ageing.count} bills · ${new Intl.NumberFormat('en-IN').format(Math.round(data.ageing.grandTotal))} outstanding`}>
              <AgeingChart data={data.ageing.totals} fy={data.financialYear} asOf={data.asOf} />
            </ChartPanel>
            <ChartPanel title="Project-wise outstanding" description="Top projects by outstanding.">
              <RankedBars valueLabel="Outstanding" data={data.projects.filter((row) => row.outstanding > 0).slice(0, 10).map((row) => ({ key: row.key, label: row.label, value: row.outstanding, href: link('/bill-tracking/outstanding', { project: row.key }) }))} />
            </ChartPanel>
            <ChartPanel title="Client-wise outstanding" description="Top clients by outstanding.">
              <RankedBars valueLabel="Outstanding" data={data.clients.filter((row) => row.outstanding > 0).slice(0, 8).map((row) => ({ key: row.key, label: row.label, value: row.outstanding, href: link('/bill-tracking/outstanding', { client: row.key === '—' ? undefined : row.key }) }))} />
            </ChartPanel>
            <ChartPanel title="Main category contribution" description="Net billing by main category.">
              <RankedBars valueLabel="Net billing" data={data.billTypes.map((row) => ({ key: row.key, label: categoryName(row.key, lookups.config.billCategories, row.label), value: row.net, href: link('/bill-tracking/bills', { category: row.key }) }))} />
            </ChartPanel>
            <ChartPanel title="Collection target vs actual" description="Last 12 weeks (ISO weeks).">
              <TargetActualChart data={data.targets} />
            </ChartPanel>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartPanel title="Retention" description="Deducted retention: released vs still held.">
              <RetentionBar released={data.retention.released} balance={data.retention.balance} href={link('/bill-tracking/retention')} />
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  Due this month <Amount value={data.retention.dueThisMonth} compact className="font-semibold" />
                </div>
                <div>
                  Overdue <Amount value={data.retention.overdue} compact className="font-semibold text-rose-700" />
                </div>
              </div>
            </ChartPanel>
            <ChartPanel title="Collection forecast" description="From commitments, expected payment dates and due dates only — nothing estimated.">
              <ul className="space-y-1.5 text-sm">
                {data.forecast.map((window) => (
                  <li key={window.key} className="flex items-center justify-between gap-2">
                    <Link href={link('/bill-tracking/targets', { window: window.key })} className="hover:underline">
                      {window.label} <span className="text-xs text-muted-foreground">({window.count})</span>
                    </Link>
                    <Amount value={window.amount} compact className="font-semibold" />
                  </li>
                ))}
              </ul>
            </ChartPanel>
            <ChartPanel title="Exceptions" description="What needs attention, instead of checking every bill.">
              {data.exceptions.length === 0 ? <p className="text-sm text-muted-foreground">No exceptions for the selected filters.</p> : null}
              <ul className="space-y-1.5 text-sm">
                {data.exceptions.map((entry) => (
                  <li key={entry.kind} className="flex items-center justify-between gap-2">
                    <Link href={link('/bill-tracking/reports/exceptions', { type: entry.kind })} className="hover:underline">
                      <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-600" />
                      {entry.label}
                    </Link>
                    <span className="text-xs tabular-nums text-slate-600">
                      {entry.count} · <Amount value={entry.amount} compact />
                    </span>
                  </li>
                ))}
              </ul>
            </ChartPanel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <TableBlock title="Highest outstanding projects" href={link('/bill-tracking/reports/project-wise')}>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Project</th>
                    <th className={`${th} text-right`}>Outstanding</th>
                    <th className={th}>Oldest</th>
                    <th className={th}>Last receipt</th>
                    <th className={`${th} text-right`}>Collection %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.projects.slice(0, 8).map((row) => (
                    <tr key={row.key} className="border-t border-slate-100">
                      <td className={td}>
                        <DrillLink href={link('/bill-tracking/outstanding', { project: row.key })}>{row.label}</DrillLink>
                      </td>
                      <td className={`${td} text-right`}>
                        <Amount value={row.outstanding} />
                      </td>
                      <td className={td}>{row.oldestOutstandingDays !== undefined ? `${row.oldestOutstandingDays} d` : '—'}</td>
                      <td className={td}>{dateText(row.lastReceiptDate)}</td>
                      <td className={`${td} text-right`}>{percentText(row.collectionPercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableBlock>

            <TableBlock title="Oldest outstanding bills" href={link('/bill-tracking/outstanding', { sort: 'ageing', dir: 'desc' })}>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Bill</th>
                    <th className={th}>Project</th>
                    <th className={th}>Ageing</th>
                    <th className={`${th} text-right`}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {data.oldest.map((bill) => (
                    <tr key={bill.id} className="border-t border-slate-100">
                      <td className={td}>
                        <DrillLink href={`/bill-tracking/bills/${bill.id}`}>{billReference(bill)}</DrillLink>
                      </td>
                      <td className={`${td} max-w-[200px] truncate`}>{bill.projectNameSnapshot}</td>
                      <td className={td}>
                        <AgeingBadge label={bill.ageingBucket} days={bill.ageingDays} buckets={lookups.config.settings.ageingBuckets} />
                      </td>
                      <td className={`${td} text-right`}>
                        <Amount value={bill.outstandingAmount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableBlock>

            <TableBlock title="Collections received recently" href={link('/bill-tracking/collections')}>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Bill</th>
                    <th className={th}>Project</th>
                    <th className={`${th} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentCollections.length === 0 ? (
                    <tr>
                      <td className={`${td} text-muted-foreground`} colSpan={4}>
                        No collections recorded.
                      </td>
                    </tr>
                  ) : null}
                  {data.recentCollections.map((line) => (
                    <tr key={`${line.collectionId}-${line.billId}`} className="border-t border-slate-100">
                      <td className={td}>{dateText(line.receiptDate)}</td>
                      <td className={td}>
                        <DrillLink href={`/bill-tracking/bills/${line.billId}`}>{line.gstInvoiceNumber || line.billSerialNumber}</DrillLink>
                      </td>
                      <td className={`${td} max-w-[200px] truncate`}>{line.projectName}</td>
                      <td className={`${td} text-right`}>
                        <Amount value={line.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableBlock>

            <TableBlock title="Payments expected this week" href={link('/bill-tracking/targets')}>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Bill</th>
                    <th className={th}>Basis</th>
                    <th className={`${th} text-right`}>Expected</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expectedThisWeek.length === 0 ? (
                    <tr>
                      <td className={`${td} text-muted-foreground`} colSpan={4}>
                        Nothing expected this week.
                      </td>
                    </tr>
                  ) : null}
                  {data.expectedThisWeek.map((item) => (
                    <tr key={item.billId} className="border-t border-slate-100">
                      <td className={td}>{dateText(item.date)}</td>
                      <td className={td}>
                        <DrillLink href={`/bill-tracking/bills/${item.billId}`}>{item.gstInvoiceNumber || item.billSerialNumber}</DrillLink>
                        <div className="text-xs text-muted-foreground">{item.projectName}</div>
                      </td>
                      <td className={`${td} text-xs`}>{item.source === 'commitment' ? 'Client commitment' : item.source === 'expected_date' ? 'Expected date' : 'Due date'}</td>
                      <td className={`${td} text-right`}>
                        <Amount value={item.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableBlock>

            <TableBlock title="Missed client commitments" href={link('/bill-tracking/outstanding', { chip: 'commitment_missed' })}>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Bill</th>
                    <th className={th}>Committed for</th>
                    <th className={`${th} text-right`}>Committed</th>
                    <th className={`${th} text-right`}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {data.missedCommitments.length === 0 ? (
                    <tr>
                      <td className={`${td} text-muted-foreground`} colSpan={4}>
                        No missed commitments.
                      </td>
                    </tr>
                  ) : null}
                  {data.missedCommitments.map((bill) => (
                    <tr key={bill.id} className="border-t border-slate-100">
                      <td className={td}>
                        <DrillLink href={`/bill-tracking/bills/${bill.id}?tab=followup`}>{billReference(bill)}</DrillLink>
                        <div className="text-xs text-muted-foreground">{bill.projectNameSnapshot}</div>
                      </td>
                      <td className={`${td} text-rose-700`}>{dateText(bill.nextCommitmentDate)}</td>
                      <td className={`${td} text-right`}>
                        <Amount value={bill.nextCommitmentAmount} />
                      </td>
                      <td className={`${td} text-right`}>
                        <Amount value={bill.outstandingAmount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableBlock>

            <TableBlock title="Bills requiring follow-up" href={link('/bill-tracking/reports/exceptions', { type: 'no_follow_up' })}>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Bill</th>
                    <th className={th}>Why</th>
                    <th className={`${th} text-right`}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {data.needsFollowUp.length === 0 ? (
                    <tr>
                      <td className={`${td} text-muted-foreground`} colSpan={3}>
                        Every open bill has a recent follow-up.
                      </td>
                    </tr>
                  ) : null}
                  {data.needsFollowUp.map((item) => (
                    <tr key={item.billId} className="border-t border-slate-100">
                      <td className={td}>
                        <DrillLink href={`/bill-tracking/bills/${item.billId}?tab=followup`}>{item.gstInvoiceNumber || item.billSerialNumber}</DrillLink>
                        <div className="text-xs text-muted-foreground">{item.projectName}</div>
                      </td>
                      <td className={`${td} text-xs`}>{item.detail}</td>
                      <td className={`${td} text-right`}>
                        <Amount value={item.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableBlock>
          </div>
        </>
      ) : null}
    </div>
  );
}
