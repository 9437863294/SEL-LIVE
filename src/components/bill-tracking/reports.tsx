'use client';

/**
 * Bill Tracking reports: the hub (`/bill-tracking/reports`) and every report view
 * (`/bill-tracking/reports/[kind]`, plus the Ageing and Deductions pages).
 *
 * Reports are computed on the server from the database — the legacy workbook's QUERY/IMPORTRANGE
 * sheets are rebuilt here, not re-run. All share the same filter bar (FY, dates, project, client,
 * DGM office, bill type, status, ageing), export to Excel / CSV / branded print, and drill down to
 * the bills behind any figure.
 */

import Link from 'next/link';
import { BarChart3, BookOpen, CalendarRange, Coins, FileWarning, Gauge, Hourglass, Landmark, Layers, ListChecks, MapPin, PiggyBank, Receipt, Scissors, ScrollText, TrendingUp, Users, Wallet } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { monthLabel, type LedgerLine } from '@/lib/bill-tracking/calculations';
import { AGEING_BASIS_LABELS, BILL_CATEGORY_LABELS, PAYMENT_STATUS_LABELS, RETENTION_STATUS_LABELS, type BillCategory, type DeductionTypeMaster, type RetentionRelease } from '@/lib/bill-tracking/types';
import type { AgeingReport, BillTotals, CollectionLine, ExceptionItem, ForecastItem, ForecastWindow, GroupRow, MonthlySummaryRow, RetentionRow, TargetPerformanceRow } from '@/lib/bill-tracking/reports';

import { useBtQuery, useLookups } from './bt-client';
import { BillFilterBar, useUrlFilters, type UrlFilters } from './bt-filters';
import { BtTable, type BtColumn } from './bt-table';
import { billReference, TotalsStrip, type BillRow } from './bill-register';
import { LedgerTable } from './bill-detail';
import { AgeingBadge, Amount, BtEmpty, BtError, BtLoading, DrillLink, ExportMenu, Notice, PaymentStatusBadge, dateText, percentText, toQuery, type ExportColumn, type ExportSpec } from './bt-ui';

/* ── hub ─────────────────────────────────────────────────────────────────── */

const REPORTS: { kind: string; title: string; description: string; icon: React.ElementType; href?: string }[] = [
  { kind: 'monthly', title: 'Month-wise summary', description: 'Taxable by category, GST, statutory deductions, retention, mobilisation advance, net, received and collection — per month (the legacy summary sheet).', icon: CalendarRange },
  { kind: 'pi', title: 'Month-wise PI report', description: 'The same summary for proforma-invoice (PI) rows only.', icon: Receipt },
  { kind: 'not-received', title: 'Not received', description: 'Every bill with money outstanding, with delay days, last receipt, follow-up and commitment.', icon: FileWarning },
  { kind: 'site-wise', title: 'Site-wise', description: 'One project’s bills with the full deduction breakdown and totals.', icon: MapPin },
  { kind: 'project-wise', title: 'Project-wise', description: 'Billing, deductions, received, outstanding, retention, oldest outstanding and average collection days per project.', icon: Layers },
  { kind: 'client-wise', title: 'Client-wise', description: 'Billing, received, outstanding, retention and payment cycle per client.', icon: Users },
  { kind: 'dgm-office', title: 'DGM office-wise', description: 'The same measures by DGM office.', icon: Landmark },
  { kind: 'bill-type', title: 'Bill type', description: 'Taxable, GST, net, collected and outstanding by bill type or category.', icon: ListChecks },
  { kind: 'collections', title: 'Collections', description: 'Receipts by receipt date, with month totals.', icon: Wallet },
  { kind: 'deductions', title: 'Deductions', description: 'Every deduction head by project, client, month, FY or bill type.', icon: Scissors, href: '/bill-tracking/deductions' },
  { kind: 'retention', title: 'Retention', description: 'Retention held, released and balance by project.', icon: PiggyBank, href: '/bill-tracking/retention' },
  { kind: 'ageing', title: 'Ageing', description: 'Outstanding by ageing bucket, as on any date, by project, client or DGM office.', icon: Hourglass, href: '/bill-tracking/ageing' },
  { kind: 'exceptions', title: 'Exceptions', description: 'Mismatches, over-receipts, old outstanding, missed commitments, missing follow-ups.', icon: FileWarning },
  { kind: 'forecast', title: 'Collection forecast', description: 'Expected collections from commitments, expected and due dates.', icon: TrendingUp },
  { kind: 'performance', title: 'Collection performance', description: 'Target vs actual by week, project, DGM office or collection owner.', icon: Gauge },
  { kind: 'project-ledger', title: 'Project bill ledger', description: 'Date-wise debit/credit ledger of one project’s bills and receipts.', icon: BookOpen },
  { kind: 'client-ledger', title: 'Client bill ledger', description: 'The same ledger for one client — for reconciliation with the client.', icon: ScrollText },
];

export function ReportsHub() {
  return (
    <div className="space-y-4">
      <PageHeader icon={BarChart3} title="Reports" description="Built directly from the bills, receipts and retention in SEL LIVE — no spreadsheet formulas." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((report) => {
          const Icon = report.icon;
          return (
            <Link key={report.kind} href={report.href ?? `/bill-tracking/reports/${report.kind}`} className="group rounded-xl border border-white/60 bg-white/85 p-4 shadow-sm transition hover:border-emerald-300 hover:shadow">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100">
                  <Icon className="h-4 w-4" />
                </span>
                <p className="font-semibold text-slate-800">{report.title}</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{report.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

const titleOf = (kind: string) => REPORTS.find((report) => report.kind === kind)?.title ?? 'Report';

function Picker({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value || 'none'} onValueChange={(next) => onChange(next === 'none' ? '' : next)}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {placeholder ? <SelectItem value="none">{placeholder}</SelectItem> : null}
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

function metaOf(filters: UrlFilters, lookups: ReturnType<typeof useLookups>, asOf?: string) {
  const meta = [{ label: 'Financial year', value: filters.fy === 'all' ? 'All years' : filters.fy }];
  if (asOf) meta.push({ label: 'As on', value: dateText(asOf) });
  const project = lookups.projects.find((entry) => entry.id === filters.get('project'));
  if (project) meta.push({ label: 'Project', value: project.name });
  const client = lookups.clients.find((entry) => entry.id === filters.get('client'));
  if (client) meta.push({ label: 'Client', value: client.name });
  if (filters.get('dgm')) meta.push({ label: 'DGM office', value: filters.get('dgm') });
  if (filters.get('billType')) meta.push({ label: 'Bill type', value: filters.get('billType') });
  if (filters.get('from') || filters.get('to')) meta.push({ label: 'Bill dates', value: `${dateText(filters.get('from'))} – ${dateText(filters.get('to'))}` });
  return meta;
}

/* ── the report view ─────────────────────────────────────────────────────── */

export function ReportView({ kind }: { kind: string }) {
  const lookups = useLookups();
  const filters = useUrlFilters();
  const path = `reports/${kind}?${filters.apiQuery()}`;
  const needsProject = kind === 'site-wise' || kind === 'project-ledger';
  const needsClient = kind === 'client-ledger';
  const blocked = (needsProject && !filters.get('project')) || (needsClient && !filters.get('client'));
  const { data, loading, error, reload } = useBtQuery<Record<string, unknown>>(blocked ? null : path);
  const meta = metaOf(filters, lookups, (data?.asOf as string | undefined) ?? undefined);
  const base = { meta, generatedBy: lookups.user.name };
  const backHref = kind === 'ageing' || kind === 'deductions' ? undefined : '/bill-tracking/reports';

  const extra = (() => {
    switch (kind) {
      case 'deductions':
        return <Picker label="Group by" value={filters.get('by') || 'project'} onChange={(value) => filters.set({ by: value })} options={[{ value: 'project', label: 'Project' }, { value: 'client', label: 'Client' }, { value: 'month', label: 'Month' }, { value: 'financialYear', label: 'Financial year' }, { value: 'billType', label: 'Bill type' }, { value: 'dgmOffice', label: 'DGM office' }]} />;
      case 'ageing':
        return (
          <>
            <Picker label="Rows" value={filters.get('by') || 'project'} onChange={(value) => filters.set({ by: value })} options={[{ value: 'project', label: 'Project' }, { value: 'client', label: 'Client' }, { value: 'dgmOffice', label: 'DGM office' }, { value: 'billType', label: 'Bill type' }]} />
            <Picker label="Ageing from" value={filters.get('basis')} onChange={(value) => filters.set({ basis: value })} options={Object.entries(AGEING_BASIS_LABELS).map(([value, label]) => ({ value, label }))} placeholder={`Default (${AGEING_BASIS_LABELS[lookups.config.settings.defaultAgeingBasis]})`} />
            <div className="min-w-0 space-y-1">
              <Label className="text-xs text-muted-foreground">As on</Label>
              <Input type="date" className="h-9" value={filters.get('asOf') || lookups.today} onChange={(event) => filters.set({ asOf: event.target.value })} />
            </div>
          </>
        );
      case 'bill-type':
        return <Picker label="Group by" value={filters.get('by') || 'billType'} onChange={(value) => filters.set({ by: value })} options={[{ value: 'billType', label: 'Bill type' }, { value: 'category', label: 'Category' }]} />;
      case 'performance':
        return <Picker label="By" value={filters.get('by') || 'project'} onChange={(value) => filters.set({ by: value })} options={[{ value: 'project', label: 'Project' }, { value: 'dgmOffice', label: 'DGM office' }, { value: 'owner', label: 'Collection owner' }]} />;
      case 'client-ledger':
        return <Picker label="Client" value={filters.get('client')} onChange={(value) => filters.set({ client: value })} options={lookups.clients.map((client) => ({ value: client.id, label: client.name }))} placeholder="Choose a client" />;
      case 'exceptions':
        return null;
      case 'not-received':
      case 'site-wise':
        return (
          <div className="min-w-0 space-y-1">
            <Label className="text-xs text-muted-foreground">As on</Label>
            <Input type="date" className="h-9" value={filters.get('asOf') || lookups.today} onChange={(event) => filters.set({ asOf: event.target.value })} />
          </div>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="space-y-4">
      <PageHeader icon={REPORTS.find((report) => report.kind === kind)?.icon as typeof BarChart3} title={titleOf(kind)} description={REPORTS.find((report) => report.kind === kind)?.description} backHref={backHref} backLabel="Reports" />
      <BillFilterBar filters={filters} page={`report-${kind}`} extra={extra} hide={kind === 'monthly' || kind === 'pi' ? ['payment'] : []} actions={data ? <ExportMenu spec={() => exportSpecFor(kind, data, base, lookups.config.deductionTypes)} /> : null} />
      {blocked ? <Notice tone="blue">{needsClient ? 'Choose a client to see its ledger.' : 'Choose a project (filter above) to see this report.'}</Notice> : null}
      <BtError message={error} onRetry={reload} />
      {loading && !data ? <BtLoading label="Building report…" /> : null}
      {data && !blocked ? <ReportBody kind={kind} data={data} filters={filters} /> : null}
    </div>
  );
}

function ReportBody({ kind, data, filters }: { kind: string; data: Record<string, unknown>; filters: UrlFilters }) {
  const lookups = useLookups();
  const fy = filters.fy;
  const carry = (extra: Record<string, string | undefined>) => toQuery({ fy, project: filters.get('project'), client: filters.get('client'), dgm: filters.get('dgm'), billType: filters.get('billType'), ...extra });
  switch (kind) {
    case 'monthly':
    case 'pi':
      return <MonthlyTable rows={data.rows as MonthlySummaryRow[]} totals={data.totals as Omit<MonthlySummaryRow, 'month' | 'from' | 'to'>} carry={carry} note={kind === 'pi' ? `Rows marked “${data.piMarker as string}” in Bill / PI (legacy TAXABLE / ADVANCE) or entered as Advance / PI. ${data.billCount as number} bill(s).` : undefined} />;
    case 'project-wise':
    case 'client-wise':
    case 'dgm-office':
    case 'bill-type':
      return <GroupTable kind={kind} rows={data.rows as GroupRow[]} totals={data.totals as BillTotals} carry={carry} />;
    case 'collections':
      return <CollectionsReport data={data as { rows: CollectionLine[]; total: number; byMonth: { month: string; amount: number }[]; from?: string; to?: string }} />;
    case 'deductions':
      return <DeductionTable data={data as unknown as DeductionData} />;
    case 'retention':
      return <RetentionReport data={data as unknown as RetentionData} />;
    case 'ageing':
      return <AgeingMatrix report={data as unknown as AgeingReport} carry={carry} by={filters.get('by') || 'project'} />;
    case 'not-received':
    case 'site-wise':
      return <BillsReport kind={kind} rows={data.rows as BillRow[]} totals={data.totals as BillTotals} deductionTypes={(data.deductionTypes as DeductionTypeMaster[] | undefined) ?? lookups.config.deductionTypes} />;
    case 'exceptions':
      return <ExceptionsReport data={data as { summary: { kind: string; label: string; count: number; amount: number }[]; rows: ExceptionItem[] }} filters={filters} />;
    case 'forecast':
      return <ForecastReport data={data as { windows: ForecastWindow[]; rows: ForecastItem[] }} />;
    case 'targets':
    case 'performance':
      return <PerformanceReport data={data as unknown as PerformanceData} />;
    case 'project-ledger':
    case 'client-ledger':
      return (
        <div className="space-y-3">
          {data.totals ? <TotalsStrip totals={data.totals as BillTotals} /> : null}
          <div className="rounded-xl border border-white/60 bg-white/85 p-4 shadow-sm">
            <LedgerTable lines={(data.lines as LedgerLine[]) ?? []} />
          </div>
          <p className="text-xs text-muted-foreground">A management ledger of bills and verified receipts — not a replacement for the accounting books.</p>
        </div>
      );
    default:
      return <BtEmpty title="Unknown report." />;
  }
}

/* ── month-wise ──────────────────────────────────────────────────────────── */

const MONTHLY_COLUMNS: [keyof MonthlySummaryRow, string][] = [
  ['taxableSupply', 'Taxable Supply'],
  ['taxableErection', 'Taxable Erection'],
  ['taxableCivil', 'Taxable Civil'],
  ['taxableFi', 'Taxable F&I'],
  ['taxableOther', 'Taxable Other'],
  ['retentionRaised', 'Retention Bills Raised'],
  ['totalTaxable', 'Total Taxable'],
  ['gst', 'GST'],
  ['totalInclGst', 'Total incl. GST'],
  ['statutoryDeduction', 'Statutory Deduction'],
  ['retentionCpbg', 'Retention vs CPBG'],
  ['retentionReleasedByClient', 'Retention Released'],
  ['retentionInvoice', 'Retention vs Invoice'],
  ['mobilizationAdvance', 'Mob. Adv. Adjusted'],
  ['mobilizationInterest', 'Interest Adj.'],
  ['net', 'Net Amount'],
  ['netReceived', 'Net Received'],
  ['difference', 'Difference'],
  ['collectionInMonth', 'Collection in Month'],
];

function MonthlyTable({ rows, totals, carry, note }: { rows: MonthlySummaryRow[]; totals: Omit<MonthlySummaryRow, 'month' | 'from' | 'to'>; carry: (extra: Record<string, string | undefined>) => string; note?: string }) {
  return (
    <div className="space-y-2">
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      <div className="max-h-[70vh] min-w-0 overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="sticky left-0 bg-slate-50 px-2 py-2 text-left">Month</th>
              {MONTHLY_COLUMNS.map(([key, label]) => (
                <th key={key} className="whitespace-nowrap px-2 py-2 text-right">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month} className="border-t border-slate-100 hover:bg-emerald-50/40">
                <td className="sticky left-0 whitespace-nowrap bg-white px-2 py-1.5 font-medium">
                  <DrillLink href={`/bill-tracking/bills${carry({ from: row.from, to: row.to })}`}>{monthLabel(row.month)}</DrillLink>
                  <span className="ml-1 text-[10px] text-muted-foreground">({row.billCount})</span>
                </td>
                {MONTHLY_COLUMNS.map(([key]) => (
                  <td key={key} className="px-2 py-1.5 text-right">
                    <Amount value={row[key] as number} muted signed />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-slate-100 font-semibold">
            <tr>
              <td className="sticky left-0 bg-slate-100 px-2 py-2">Total</td>
              {MONTHLY_COLUMNS.map(([key]) => (
                <td key={key} className="px-2 py-2 text-right">
                  <Amount value={totals[key as keyof typeof totals] as number} signed />
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Month = bill date, except “Collection in Month”, which is by receipt date. Each bill’s taxable value sits in exactly one category column (from the Bill Type master).</p>
    </div>
  );
}

/* ── group tables ────────────────────────────────────────────────────────── */

function GroupTable({ kind, rows, totals, carry }: { kind: string; rows: GroupRow[]; totals: BillTotals; carry: (extra: Record<string, string | undefined>) => string }) {
  const drill = (row: GroupRow) =>
    kind === 'project-wise'
      ? `/bill-tracking/bills${carry({ project: row.key })}`
      : kind === 'client-wise'
        ? `/bill-tracking/bills${carry({ client: row.key === '—' ? undefined : row.key })}`
        : kind === 'dgm-office'
          ? `/bill-tracking/bills${carry({ dgm: row.key === '—' ? undefined : row.key })}`
          : `/bill-tracking/bills${carry(row.key in BILL_CATEGORY_LABELS ? { category: row.key } : { billType: row.key })}`;
  const label = (row: GroupRow) => BILL_CATEGORY_LABELS[row.key as BillCategory] ?? row.label;
  const columns: BtColumn<GroupRow & { id: string }>[] = [
    { key: 'label', header: kind === 'project-wise' ? 'Project' : kind === 'client-wise' ? 'Client' : kind === 'dgm-office' ? 'DGM office' : 'Bill type', pinned: true, mobile: 'title', sortValue: (row) => row.label, cell: (row) => <DrillLink href={drill(row)}>{label(row)}</DrillLink>, total: 'Total' },
    { key: 'count', header: 'Bills', align: 'right', sortValue: (row) => row.count, cell: (row) => row.count, total: totals.count },
    { key: 'taxable', header: 'Taxable', align: 'right', sortValue: (row) => row.taxable, cell: (row) => <Amount value={row.taxable} signed />, total: <Amount value={totals.taxable} /> },
    { key: 'gst', header: 'GST', align: 'right', cell: (row) => <Amount value={row.gst} signed />, total: <Amount value={totals.gst} /> },
    { key: 'gross', header: 'Gross', align: 'right', defaultHidden: kind === 'bill-type', cell: (row) => <Amount value={row.gross} signed />, total: <Amount value={totals.gross} /> },
    { key: 'deduction', header: 'Deductions', align: 'right', cell: (row) => <Amount value={row.deduction} />, total: <Amount value={totals.deduction} /> },
    { key: 'net', header: 'Net receivable', align: 'right', sortValue: (row) => row.net, cell: (row) => <Amount value={row.net} signed />, total: <Amount value={totals.net} /> },
    { key: 'received', header: 'Received', align: 'right', sortValue: (row) => row.received, cell: (row) => <Amount value={row.received} />, total: <Amount value={totals.received} /> },
    { key: 'outstanding', header: 'Outstanding', align: 'right', mobile: 'aside', sortValue: (row) => row.outstanding, cell: (row) => <Amount value={row.outstanding} className={row.outstanding > 0 ? 'font-semibold text-rose-700' : undefined} muted />, total: <Amount value={totals.outstanding} /> },
    { key: 'pct', header: 'Collection %', align: 'right', sortValue: (row) => row.collectionPercent ?? -1, cell: (row) => percentText(row.collectionPercent), total: percentText(totals.collectionPercent) },
    { key: 'retention', header: 'Retention', align: 'right', defaultHidden: kind === 'bill-type', cell: (row) => <Amount value={row.retention} muted />, total: <Amount value={totals.retention} /> },
    { key: 'retBalance', header: 'Retention balance', align: 'right', defaultHidden: kind !== 'project-wise', cell: (row) => <Amount value={row.retentionBalance} muted /> },
    { key: 'oldest', header: 'Oldest outstanding', defaultHidden: kind === 'bill-type', sortValue: (row) => row.oldestOutstandingDays ?? -1, cell: (row) => (row.oldestOutstandingDate ? `${dateText(row.oldestOutstandingDate)} (${row.oldestOutstandingDays} d)` : '—') },
    { key: 'avgDays', header: kind === 'client-wise' ? 'Avg payment cycle' : 'Avg collection days', align: 'right', defaultHidden: kind === 'bill-type', sortValue: (row) => row.averageCollectionDays ?? -1, cell: (row) => (row.averageCollectionDays === null ? '—' : `${row.averageCollectionDays} d`) },
    { key: 'commitment', header: 'Pending commitment', align: 'right', defaultHidden: kind !== 'client-wise', cell: (row) => <Amount value={row.pendingCommitment} muted /> },
    { key: 'overdue', header: 'Overdue', align: 'right', defaultHidden: true, cell: (row) => <Amount value={row.overdue} muted /> },
    { key: 'lastReceipt', header: 'Last receipt', defaultHidden: true, cell: (row) => dateText(row.lastReceiptDate) },
  ];
  return <BtTable rows={rows.map((row) => ({ ...row, id: row.key }))} columns={columns} storageKey={`report-${kind}`} showTotals empty={<BtEmpty title="No bills for the selected filters." />} />;
}

/* ── collections ─────────────────────────────────────────────────────────── */

function CollectionsReport({ data }: { data: { rows: CollectionLine[]; total: number; byMonth: { month: string; amount: number }[]; from?: string; to?: string } }) {
  const columns: BtColumn<CollectionLine & { id: string }>[] = [
    { key: 'date', header: 'Receipt date', pinned: true, mobile: 'title', sortValue: (row) => row.receiptDate, cell: (row) => dateText(row.receiptDate), total: 'Total' },
    { key: 'bill', header: 'Bill', cell: (row) => <DrillLink href={`/bill-tracking/bills/${row.billId}`}>{row.gstInvoiceNumber || row.billSerialNumber}</DrillLink> },
    { key: 'project', header: 'Project', sortValue: (row) => row.projectName, cell: (row) => row.projectName },
    { key: 'mode', header: 'Mode', cell: (row) => row.paymentMode ?? '—' },
    { key: 'utr', header: 'UTR', cell: (row) => row.utrNumber ?? '—' },
    { key: 'amount', header: 'Amount', align: 'right', mobile: 'aside', sortValue: (row) => row.amount, cell: (row) => <Amount value={row.amount} />, total: <Amount value={data.total} /> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {data.byMonth.map((entry) => (
          <div key={entry.month} className="rounded-lg border border-white/60 bg-white/85 px-3 py-2 text-xs shadow-sm">
            <p className="text-muted-foreground">{monthLabel(entry.month)}</p>
            <p className="font-semibold">
              <Amount value={entry.amount} compact />
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Verified receipts dated {dateText(data.from)} – {dateText(data.to)}, against bills in your scope (any bill year).
      </p>
      <BtTable rows={data.rows.map((row, index) => ({ ...row, id: `${row.collectionId}-${row.billId}-${index}` }))} columns={columns} storageKey="report-collections" showTotals empty={<BtEmpty title="No collection records found." />} />
    </div>
  );
}

/* ── deductions ──────────────────────────────────────────────────────────── */

interface DeductionData {
  dimension: string;
  types: { id: string; name: string }[];
  rows: { key: string; label: string; byType: Record<string, number>; total: number }[];
  totals: Record<string, number>;
  grandTotal: number;
}

function DeductionTable({ data }: { data: DeductionData }) {
  const columns: BtColumn<DeductionData['rows'][number] & { id: string }>[] = [
    { key: 'label', header: data.dimension === 'month' ? 'Month' : data.dimension === 'financialYear' ? 'FY' : data.dimension === 'billType' ? 'Bill type' : data.dimension === 'client' ? 'Client' : data.dimension === 'dgmOffice' ? 'DGM office' : 'Project', pinned: true, mobile: 'title', sortValue: (row) => row.label, cell: (row) => (data.dimension === 'month' ? monthLabel(row.label) : row.label), total: 'Total' },
    ...data.types.map((type) => ({ key: type.id, header: type.name, align: 'right' as const, sortValue: (row: DeductionData['rows'][number]) => row.byType[type.id] ?? 0, cell: (row: DeductionData['rows'][number]) => <Amount value={row.byType[type.id] ?? 0} muted signed />, total: <Amount value={data.totals[type.id] ?? 0} signed /> })),
    { key: 'total', header: 'Total', align: 'right', mobile: 'aside', sortValue: (row) => row.total, cell: (row) => <Amount value={row.total} className="font-semibold" signed />, total: <Amount value={data.grandTotal} signed /> },
  ];
  return <BtTable rows={data.rows.map((row) => ({ ...row, id: row.key }))} columns={columns} storageKey={`report-deductions-${data.types.length}`} showTotals empty={<BtEmpty title="No deductions for the selected filters." />} />;
}

/* ── retention ───────────────────────────────────────────────────────────── */

interface RetentionData {
  rows: RetentionRow[];
  totals: { deducted: number; released: number; balance: number; dueThisMonth: number; overdue: number };
  releases: RetentionRelease[];
}

export function RetentionTable({ data, onRelease }: { data: RetentionData; onRelease?: (projectId: string) => void }) {
  const columns: BtColumn<RetentionRow & { id: string }>[] = [
    { key: 'project', header: 'Project', pinned: true, mobile: 'title', sortValue: (row) => row.projectName, cell: (row) => <DrillLink href={`/bill-tracking/bills?project=${row.projectId}&fy=all`}>{row.projectName}</DrillLink>, total: 'Total' },
    { key: 'cpbg', header: 'vs CPBG', align: 'right', cell: (row) => <Amount value={row.cpbg} muted /> },
    { key: 'invoice', header: 'vs Invoice', align: 'right', cell: (row) => <Amount value={row.invoice} muted /> },
    { key: 'te', header: 'Time ext.', align: 'right', cell: (row) => <Amount value={row.timeExtension} muted /> },
    { key: 'other', header: 'Other', align: 'right', defaultHidden: true, cell: (row) => <Amount value={row.other} muted /> },
    { key: 'deducted', header: 'Deducted', align: 'right', sortValue: (row) => row.deducted, cell: (row) => <Amount value={row.deducted} />, total: <Amount value={data.totals.deducted} /> },
    { key: 'released', header: 'Released', align: 'right', sortValue: (row) => row.released, cell: (row) => <Amount value={row.released} />, total: <Amount value={data.totals.released} /> },
    { key: 'balance', header: 'Balance', align: 'right', mobile: 'aside', sortValue: (row) => row.balance, cell: (row) => <Amount value={row.balance} className="font-semibold" signed />, total: <Amount value={data.totals.balance} /> },
    { key: 'expected', header: 'Expected release', sortValue: (row) => row.expectedReleaseDate ?? '', cell: (row) => dateText(row.expectedReleaseDate) },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge tone={row.status === 'fully_released' ? 'success' : row.status === 'overdue' || row.status === 'disputed' ? 'danger' : row.status === 'partially_released' ? 'warning' : 'neutral'}>{RETENTION_STATUS_LABELS[row.status]}</StatusBadge> },
    ...(onRelease
      ? [
          {
            key: 'action',
            header: '',
            label: 'Actions',
            mobile: 'omit' as const,
            align: 'right' as const,
            cell: (row: RetentionRow) =>
              row.balance > 0 ? (
                <button type="button" className="text-xs font-medium text-emerald-700 hover:underline" onClick={() => onRelease(row.projectId)}>
                  Record release
                </button>
              ) : null,
          },
        ]
      : []),
  ];
  return <BtTable rows={data.rows.map((row) => ({ ...row, id: row.projectId }))} columns={columns} storageKey="retention" showTotals empty={<BtEmpty title="No retention deducted for the selected filters." />} />;
}

function RetentionReport({ data }: { data: RetentionData }) {
  return <RetentionTable data={data} />;
}

/* ── ageing ──────────────────────────────────────────────────────────────── */

function AgeingMatrix({ report, carry, by }: { report: AgeingReport; carry: (extra: Record<string, string | undefined>) => string; by: string }) {
  const filterFor = (key: string): Record<string, string | undefined> => (by === 'project' ? { project: key } : by === 'client' ? { client: key === '—' ? undefined : key } : by === 'dgmOffice' ? { dgm: key === '—' ? undefined : key } : { billType: key === '—' ? undefined : key });
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Outstanding as on {dateText(report.asOf)}, aged from the {AGEING_BASIS_LABELS[report.basis].toLowerCase()} (bill date where that is not recorded). Click a figure to open those bills.
      </p>
      <div className="max-h-[70vh] min-w-0 overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">{by === 'project' ? 'Project' : by === 'client' ? 'Client' : by === 'dgmOffice' ? 'DGM office' : 'Bill type'}</th>
              {report.buckets.map((bucket) => (
                <th key={bucket.label} className="whitespace-nowrap px-3 py-2 text-right">
                  {bucket.label} days
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={report.buckets.length + 2} className="px-3 py-8 text-center text-muted-foreground">
                  No outstanding bills for the selected filters.
                </td>
              </tr>
            ) : null}
            {report.rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-100 hover:bg-emerald-50/40">
                <td className="px-3 py-1.5 font-medium">{row.label}</td>
                {row.buckets.map((cell) => (
                  <td key={cell.label} className="px-3 py-1.5 text-right">
                    {cell.amount ? (
                      <Link className="hover:underline" href={`/bill-tracking/outstanding${carry({ ...filterFor(row.key), ageing: cell.label, asOf: report.asOf, basis: report.basis })}`} title={`${cell.count} bill(s)`}>
                        <Amount value={cell.amount} />
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-semibold">
                  <Amount value={row.total} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-slate-100 font-semibold">
            <tr>
              <td className="px-3 py-2">Total ({report.count} bills)</td>
              {report.totals.map((cell) => (
                <td key={cell.label} className="px-3 py-2 text-right">
                  <Link className="hover:underline" href={`/bill-tracking/outstanding${carry({ ageing: cell.label, asOf: report.asOf, basis: report.basis })}`}>
                    <Amount value={cell.amount} />
                  </Link>
                </td>
              ))}
              <td className="px-3 py-2 text-right">
                <Amount value={report.grandTotal} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ── bill lists (not received, site-wise) ────────────────────────────────── */

function BillsReport({ kind, rows, totals, deductionTypes }: { kind: string; rows: BillRow[]; totals: BillTotals; deductionTypes: DeductionTypeMaster[] }) {
  const lookups = useLookups();
  const siteWise = kind === 'site-wise';
  const columns: BtColumn<BillRow>[] = [
    { key: 'sl', header: 'Sl. No.', defaultHidden: !siteWise, cell: (bill) => bill.serialNumber ?? '—' },
    { key: 'bill', header: 'Bill Sl No.', pinned: true, mobile: 'title', sortValue: (bill) => bill.billSerialNumber ?? '', cell: (bill) => <DrillLink href={`/bill-tracking/bills/${bill.id}`}>{bill.billSerialNumber || '—'}</DrillLink>, total: 'Total' },
    { key: 'invoice', header: 'GST invoice', cell: (bill) => bill.gstInvoiceNumber ?? 'NA' },
    { key: 'date', header: 'Date', sortValue: (bill) => bill.billDate, cell: (bill) => <span className="whitespace-nowrap">{dateText(bill.billDate)}</span> },
    { key: 'project', header: 'Project', defaultHidden: siteWise, cell: (bill) => bill.projectNameSnapshot },
    { key: 'desc', header: 'Description', defaultHidden: !siteWise, cell: (bill) => bill.description ?? '' },
    { key: 'type', header: 'Type', cell: (bill) => bill.billTypeName },
    { key: 'taxable', header: 'Taxable', align: 'right', cell: (bill) => <Amount value={bill.taxableAmount} signed />, total: <Amount value={totals.taxable} /> },
    { key: 'gst', header: 'GST', align: 'right', cell: (bill) => <Amount value={bill.gstAmount} signed />, total: <Amount value={totals.gst} /> },
    ...(siteWise
      ? deductionTypes.map((type) => ({
          key: `d-${type.id}`,
          header: type.name,
          align: 'right' as const,
          cell: (bill: BillRow) => <Amount value={(bill.deductions ?? []).filter((line) => line.deductionTypeId === type.id).reduce((sum, line) => sum + line.amount, 0)} muted signed />,
          total: <Amount value={rows.reduce((sum, bill) => sum + (bill.deductions ?? []).filter((line) => line.deductionTypeId === type.id).reduce((inner, line) => inner + line.amount, 0), 0)} signed />,
        }))
      : []),
    { key: 'deduction', header: 'Total deduction', align: 'right', defaultHidden: !siteWise, cell: (bill) => <Amount value={bill.totalDeduction} signed />, total: <Amount value={totals.deduction} /> },
    { key: 'net', header: 'Net', align: 'right', cell: (bill) => <Amount value={bill.netReceivable} signed />, total: <Amount value={totals.net} /> },
    { key: 'received', header: 'Received', align: 'right', cell: (bill) => <Amount value={bill.totalReceived} muted />, total: <Amount value={totals.received} /> },
    { key: 'outstanding', header: siteWise ? 'Shortfall' : 'Outstanding', align: 'right', mobile: 'aside', cell: (bill) => <Amount value={siteWise ? bill.shortfallSurplus : bill.outstandingAmount} signed />, total: <Amount value={totals.outstanding} /> },
    { key: 'lastReceipt', header: 'Last receipt', cell: (bill) => dateText(bill.lastReceiptDate) },
    { key: 'status', header: 'Status', cell: (bill) => <PaymentStatusBadge status={bill.paymentStatus} overridden={Boolean(bill.paymentStatusOverride)} /> },
    { key: 'delay', header: 'Delay days', align: 'right', defaultHidden: siteWise, sortValue: (bill) => bill.ageingDays, cell: (bill) => (bill.ageingBucket ? <AgeingBadge label={bill.ageingBucket} days={bill.ageingDays} buckets={lookups.config.settings.ageingBuckets} /> : '—') },
    { key: 'lastFollow', header: 'Last follow-up', defaultHidden: siteWise, cell: (bill) => dateText(bill.lastFollowUpDate) },
    { key: 'nextFollow', header: 'Next follow-up', defaultHidden: siteWise, cell: (bill) => dateText(bill.nextFollowUpDate) },
    { key: 'owner', header: 'Owner', defaultHidden: siteWise, cell: (bill) => bill.collectionOwnerName ?? '—' },
    { key: 'commitment', header: 'Commitment', defaultHidden: siteWise, cell: (bill) => dateText(bill.nextCommitmentDate) },
  ];
  return (
    <div className="space-y-3">
      <TotalsStrip totals={totals} />
      <BtTable rows={rows} columns={columns} storageKey={`report-${kind}-${deductionTypes.length}`} showTotals dense rowHref={(bill) => `/bill-tracking/bills/${bill.id}`} empty={<BtEmpty title={kind === 'not-received' ? 'Nothing outstanding for the selected filters.' : 'No bills for this project and period.'} />} />
    </div>
  );
}

/* ── exceptions, forecast, performance ───────────────────────────────────── */

function ExceptionsReport({ data, filters }: { data: { summary: { kind: string; label: string; count: number; amount: number }[]; rows: ExceptionItem[] }; filters: UrlFilters }) {
  const type = filters.get('type');
  const columns: BtColumn<ExceptionItem & { id: string }>[] = [
    { key: 'kind', header: 'Exception', pinned: true, mobile: 'title', sortValue: (row) => row.kind, cell: (row) => data.summary.find((entry) => entry.kind === row.kind)?.label ?? row.kind },
    { key: 'bill', header: 'Bill', cell: (row) => <DrillLink href={`/bill-tracking/bills/${row.billId}`}>{row.gstInvoiceNumber || row.billSerialNumber || 'Open'}</DrillLink> },
    { key: 'project', header: 'Project', sortValue: (row) => row.projectName, cell: (row) => row.projectName },
    { key: 'detail', header: 'Detail', cell: (row) => <span className="text-xs">{row.detail}</span> },
    { key: 'amount', header: 'Amount', align: 'right', mobile: 'aside', sortValue: (row) => row.amount, cell: (row) => <Amount value={row.amount} signed /> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => filters.set({ type: undefined })} className={`rounded-full border px-3 py-1 text-xs ${!type ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white'}`}>
          All ({data.summary.reduce((sum, entry) => sum + entry.count, 0)})
        </button>
        {data.summary.map((entry) => (
          <button key={entry.kind} type="button" onClick={() => filters.set({ type: entry.kind })} className={`rounded-full border px-3 py-1 text-xs ${type === entry.kind ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white'}`}>
            {entry.label} ({entry.count})
          </button>
        ))}
      </div>
      <BtTable rows={data.rows.map((row, index) => ({ ...row, id: `${row.kind}-${row.billId}-${index}` }))} columns={columns} storageKey="report-exceptions" empty={<BtEmpty title="No exceptions for the selected filters." />} />
    </div>
  );
}

function ForecastReport({ data }: { data: { windows: ForecastWindow[]; rows: ForecastItem[] } }) {
  const columns: BtColumn<ForecastItem & { id: string }>[] = [
    { key: 'date', header: 'Expected', pinned: true, mobile: 'title', sortValue: (row) => row.date, cell: (row) => dateText(row.date) },
    { key: 'bill', header: 'Bill', cell: (row) => <DrillLink href={`/bill-tracking/bills/${row.billId}`}>{row.gstInvoiceNumber || row.billSerialNumber}</DrillLink> },
    { key: 'project', header: 'Project', cell: (row) => row.projectName },
    { key: 'source', header: 'Basis', cell: (row) => (row.source === 'commitment' ? 'Client commitment' : row.source === 'expected_date' ? 'Expected payment date' : 'Due date') },
    { key: 'owner', header: 'Owner', cell: (row) => row.ownerName ?? '—' },
    { key: 'amount', header: 'Amount', align: 'right', mobile: 'aside', sortValue: (row) => row.amount, cell: (row) => <Amount value={row.amount} /> },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {data.windows.map((window) => (
          <div key={window.key} className="rounded-xl border border-white/60 bg-white/85 p-3 shadow-sm">
            <p className="text-[11px] uppercase text-muted-foreground">{window.label}</p>
            <p className="text-lg font-semibold">
              <Amount value={window.amount} compact />
            </p>
            <p className="text-[11px] text-muted-foreground">{window.count} bills · commitments <Amount value={window.bySource.commitment} compact /></p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Each open bill counts once: its pending commitment if it has one, else its expected payment date, else its due date — capped at what is outstanding. Nothing is estimated.</p>
      <BtTable rows={data.rows.map((row) => ({ ...row, id: row.billId }))} columns={columns} storageKey="report-forecast" empty={<BtEmpty title="Nothing expected from today on." />} />
    </div>
  );
}

interface PerformanceData {
  weeks: TargetPerformanceRow[];
  byDimension: { key: string; label: string; target: number; actual: number; achievement: number | null }[];
}

function PerformanceReport({ data }: { data: PerformanceData }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-800">By week</p>
        <BtTable
          rows={data.weeks.map((row) => ({ ...row, id: row.week }))}
          columns={[
            { key: 'week', header: 'Week', pinned: true, mobile: 'title', sortValue: (row) => row.week, cell: (row) => `${row.week} (${dateText(row.from)})` },
            { key: 'target', header: 'Target', align: 'right', cell: (row) => <Amount value={row.target} muted /> },
            { key: 'actual', header: 'Actual', align: 'right', mobile: 'aside', cell: (row) => <Amount value={row.actual} /> },
            { key: 'pct', header: 'Achievement', align: 'right', sortValue: (row) => row.achievement ?? -1, cell: (row) => percentText(row.achievement) },
          ]}
          storageKey="perf-weeks"
          empty={<BtEmpty title="No targets or collections this year." />}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-800">By dimension</p>
        <BtTable
          rows={data.byDimension.map((row) => ({ ...row, id: row.key }))}
          columns={[
            { key: 'label', header: 'Name', pinned: true, mobile: 'title', sortValue: (row) => row.label, cell: (row) => row.label },
            { key: 'target', header: 'Target', align: 'right', sortValue: (row) => row.target, cell: (row) => <Amount value={row.target} muted /> },
            { key: 'actual', header: 'Actual', align: 'right', mobile: 'aside', sortValue: (row) => row.actual, cell: (row) => <Amount value={row.actual} /> },
            { key: 'pct', header: 'Achievement', align: 'right', sortValue: (row) => row.achievement ?? -1, cell: (row) => percentText(row.achievement) },
          ]}
          storageKey="perf-dimension"
          empty={<BtEmpty title="Nothing to show." />}
        />
        <p className="text-xs text-muted-foreground">Operational collection reporting — not an employee performance score.</p>
      </div>
    </div>
  );
}

/* ── exports ─────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown> & { id?: string };

function exportSpecFor(kind: string, data: Record<string, unknown>, base: { meta: { label: string; value: string }[]; generatedBy: string }, deductionTypes: DeductionTypeMaster[]): ExportSpec<Row> {
  const money = (key: string, label: string): ExportColumn<Row> => ({ key, label, value: (row) => row[key] as number, money: true });
  const text = (key: string, label: string, map?: (value: unknown, row: Row) => string | number | undefined): ExportColumn<Row> => ({ key, label, value: (row) => (map ? map(row[key], row) : (row[key] as string)) });
  const title = titleOf(kind);
  const fileName = `${kind}-${new Date().toISOString().slice(0, 10)}`;
  switch (kind) {
    case 'monthly':
    case 'pi':
      return { ...base, title, fileName, rows: (data.rows as Row[]) ?? [], columns: [text('month', 'Month', (value) => monthLabel(String(value))), ...MONTHLY_COLUMNS.map(([key, label]) => money(key, label))], totals: data.totals as Record<string, number> };
    case 'project-wise':
    case 'client-wise':
    case 'dgm-office':
    case 'bill-type':
      return {
        ...base,
        title,
        fileName,
        rows: (data.rows as Row[]) ?? [],
        columns: [text('label', 'Name', (value, row) => BILL_CATEGORY_LABELS[row.key as BillCategory] ?? String(value)), text('count', 'Bills'), money('taxable', 'Taxable'), money('gst', 'GST'), money('gross', 'Gross'), money('deduction', 'Deductions'), money('net', 'Net'), money('received', 'Received'), money('outstanding', 'Outstanding'), text('collectionPercent', 'Collection %'), money('retention', 'Retention'), money('retentionBalance', 'Retention Balance'), text('oldestOutstandingDate', 'Oldest Outstanding'), text('averageCollectionDays', 'Avg Collection Days')],
        totals: data.totals as Record<string, number>,
      };
    case 'collections':
      return { ...base, title, fileName, rows: (data.rows as Row[]) ?? [], columns: [text('receiptDate', 'Receipt Date'), text('gstInvoiceNumber', 'Invoice'), text('billSerialNumber', 'Bill No'), text('projectName', 'Project'), text('paymentMode', 'Mode'), text('utrNumber', 'UTR'), money('amount', 'Amount')], totals: { amount: data.total as number } };
    case 'deductions': {
      const types = (data.types as { id: string; name: string }[]) ?? [];
      return { ...base, title, fileName, rows: ((data.rows as Row[]) ?? []).map((row) => ({ ...row, ...(row.byType as Record<string, number>) })), columns: [text('label', 'Name'), ...types.map((type) => money(type.id, type.name)), money('total', 'Total')], totals: { ...(data.totals as Record<string, number>), total: data.grandTotal as number } };
    }
    case 'retention':
      return { ...base, title, fileName, rows: (data.rows as Row[]) ?? [], columns: [text('projectName', 'Project'), money('cpbg', 'vs CPBG'), money('invoice', 'vs Invoice'), money('timeExtension', 'Time Extension'), money('deducted', 'Deducted'), money('released', 'Released'), money('balance', 'Balance'), text('expectedReleaseDate', 'Expected Release'), text('status', 'Status', (value) => RETENTION_STATUS_LABELS[value as keyof typeof RETENTION_STATUS_LABELS])], totals: data.totals as Record<string, number> };
    case 'ageing': {
      const report = data as unknown as AgeingReport;
      return { ...base, title: `${title} as on ${dateText(report.asOf)}`, fileName, rows: report.rows.map((row) => ({ label: row.label, total: row.total, ...Object.fromEntries(row.buckets.map((cell) => [cell.label, cell.amount])) })), columns: [text('label', 'Name'), ...report.buckets.map((bucket) => money(bucket.label, `${bucket.label} days`)), money('total', 'Total')], totals: { ...Object.fromEntries(report.totals.map((cell) => [cell.label, cell.amount])), total: report.grandTotal } };
    }
    case 'not-received':
    case 'site-wise': {
      const rows = ((data.rows as BillRow[]) ?? []) as unknown as Row[];
      const deductionColumns = kind === 'site-wise' ? deductionTypes.map((type) => ({ key: `d-${type.id}`, label: type.name, money: true, value: (row: Row) => ((row.deductions as { deductionTypeId: string; amount: number }[]) ?? []).filter((line) => line.deductionTypeId === type.id).reduce((sum, line) => sum + line.amount, 0) })) : [];
      return {
        ...base,
        title,
        fileName,
        rows,
        columns: [text('serialNumber', 'Sl. No.'), text('billSerialNumber', 'Bill Sl No.'), text('gstInvoiceNumber', 'GST Invoice'), text('billDate', 'Date'), text('projectNameSnapshot', 'Project'), text('billTypeName', 'Type'), money('taxableAmount', 'Taxable'), money('gstAmount', 'GST'), ...deductionColumns, money('totalDeduction', 'Total Deduction'), money('netReceivable', 'Net'), money('totalReceived', 'Received'), money('outstandingAmount', 'Outstanding'), text('lastReceiptDate', 'Last Receipt'), text('paymentStatus', 'Status', (value) => PAYMENT_STATUS_LABELS[value as keyof typeof PAYMENT_STATUS_LABELS]), text('ageingDays', 'Delay Days'), text('lastFollowUpDate', 'Last Follow-up'), text('nextFollowUpDate', 'Next Follow-up'), text('collectionOwnerName', 'Owner'), text('nextCommitmentDate', 'Commitment Date')],
        totals: { taxableAmount: (data.totals as BillTotals).taxable, gstAmount: (data.totals as BillTotals).gst, totalDeduction: (data.totals as BillTotals).deduction, netReceivable: (data.totals as BillTotals).net, totalReceived: (data.totals as BillTotals).received, outstandingAmount: (data.totals as BillTotals).outstanding },
      };
    }
    case 'exceptions':
      return { ...base, title, fileName, rows: (data.rows as Row[]) ?? [], columns: [text('kind', 'Exception'), text('gstInvoiceNumber', 'Invoice'), text('billSerialNumber', 'Bill No'), text('projectName', 'Project'), text('detail', 'Detail'), money('amount', 'Amount')] };
    case 'forecast':
      return { ...base, title, fileName, rows: (data.rows as Row[]) ?? [], columns: [text('date', 'Expected'), text('gstInvoiceNumber', 'Invoice'), text('billSerialNumber', 'Bill No'), text('projectName', 'Project'), text('source', 'Basis'), text('ownerName', 'Owner'), money('amount', 'Amount')] };
    case 'targets':
    case 'performance':
      return { ...base, title, fileName, rows: (data.weeks as Row[]) ?? [], columns: [text('week', 'Week'), text('from', 'From'), money('target', 'Target'), money('actual', 'Actual'), text('achievement', 'Achievement %')] };
    default:
      return { ...base, title, fileName, rows: ((data.lines as Row[]) ?? []), columns: [text('date', 'Date'), text('description', 'Transaction'), text('reference', 'Reference'), money('debit', 'Debit'), money('credit', 'Credit'), money('balance', 'Balance')] };
  }
}

export { billReference };
