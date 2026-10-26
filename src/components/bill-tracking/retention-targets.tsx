'use client';

/**
 * Retention ledger (`/bill-tracking/retention`) and collection targets & forecast
 * (`/bill-tracking/targets`).
 *
 * Retention held is what bills deducted under retention heads; released is the ledger of release
 * entries — written automatically when a receipt is verified against a retention bill, or recorded
 * here for a release that came another way. One invoice often holds retention at two rates (10% and
 * 30%, released at different milestones), so the page also splits it by rate (`retention.ts`): each
 * head-and-rate slab gets its own held, released and balance. Targets are weekly amounts per project
 * (or company-wide) compared with verified receipts in the same ISO week.
 */

import { useState } from 'react';
import Link from 'next/link';
import { FolderKanban, History, Percent, PiggyBank, Plus, Target, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { PM_DIALOG } from '@/components/project-management/pm-shell';
import { useToast } from '@/hooks/use-toast';
import { isoWeekOf } from '@/lib/bill-tracking/calculations';
import { formatINR, sumBy } from '@/lib/bill-tracking/money';
import type { RetentionRow, TargetPerformanceRow, ForecastWindow } from '@/lib/bill-tracking/reports';
import { formatRate, hasAmount, releaseSlabKey, type BifurcationBillRow, type BifurcationProjectRow, type RetentionBifurcation, type RetentionSlab, type SlabTotal } from '@/lib/bill-tracking/retention';
import type { CollectionTarget, RetentionRelease } from '@/lib/bill-tracking/types';

import { btFetch, useBt, useBtQuery, useLookups, type ProjectOption } from './bt-client';
import { BillFilterBar, useUrlFilters, type UrlFilters } from './bt-filters';
import { BtTable, type BtColumn } from './bt-table';
import { TargetActualChart } from './dashboard-charts';
import { RetentionTable } from './reports';
import { Amount, BT_TAB, BT_TABS_LIST, BtEmpty, BtError, BtLoading, DrillLink, ExportMenu, MoneyKpi, Notice, TabCount, TransactionTypeBadge, TruncatedText, dateText, percentText, type ExportColumn, type ExportSpec } from './bt-ui';

interface RetentionData {
  rows: RetentionRow[];
  totals: { deducted: number; released: number; balance: number; dueThisMonth: number; overdue: number };
  releases: RetentionRelease[];
  /** Retention held at each head and rate — overall, by project and by bill (`retention.ts`). */
  bifurcation: RetentionBifurcation;
}

/** Stands in while the API predates the bifurcation, so the page shows no slabs instead of failing. */
const NO_BIFURCATION: RetentionBifurcation = { columns: [], slabs: [], byProject: [], byBill: [], totals: { held: 0, released: 0, unattributed: 0, balance: 0, cells: {} } };

/** The "nothing chosen" value of the dialog's bill and slab pickers (Radix Select cannot hold ''). */
const NONE = 'none';

/** A rate on its own: "30%", or "Fixed amount" for a head's amounts that do not read as a rate. */
const rateText = (rate: number | null) => (rate === null ? 'Fixed amount' : `${formatRate(rate)}%`);

const FROM_AMOUNT_TIP = "Some retention on this bill was entered as an amount, so its rate was worked out from the bill's taxable (or gross) value, to the nearest half percent. An amount that does not come to a round rate is shown as a fixed amount.";
const FROM_INVOICE_TIP = "This note's retention did not read as a rate its invoice holds (10% and 30% reversed together read as 40%), so it is shared over the invoice's rates under the same head, in proportion to what each holds.";

/** How a bill row's rates were known, for the export. */
const basisText = (row: BifurcationBillRow) => [row.fromAmounts ? 'Worked out from amount' : null, row.fromInvoice ? 'Shared as on the invoice' : null].filter(Boolean).join('; ') || 'Entered as %';

const retentionTabHref = (billId: string) => `/bill-tracking/bills/${billId}?tab=retention`;

type SlabRow = SlabTotal & { id: string };
type ProjectRateRow = BifurcationProjectRow & { id: string };

/**
 * One table column per slab, reading the held amount from each row's `cells`. The heading is the
 * rate alone ("30%") while each rate belongs to one head, and the whole slab label where two heads
 * share a rate — otherwise their columns would read alike. The head is always on hover and in the
 * column picker.
 */
function slabColumns<T extends { cells: Record<string, number> }>(columns: readonly RetentionSlab[], totals: Record<string, number>): BtColumn<T>[] {
  const perRate = new Map<string, number>();
  for (const slab of columns) perRate.set(rateText(slab.rate), (perRate.get(rateText(slab.rate)) ?? 0) + 1);
  return columns.map((slab): BtColumn<T> => ({
    key: slab.key,
    header: (
      <span title={slab.label} className="block max-w-[10rem] whitespace-normal">
        {(perRate.get(rateText(slab.rate)) ?? 0) > 1 ? slab.label : rateText(slab.rate)}
      </span>
    ),
    label: slab.label,
    align: 'right',
    sortValue: (row) => row.cells[slab.key] ?? 0,
    cell: (row) => (hasAmount(row.cells[slab.key]) ? <Amount value={row.cells[slab.key]} signed /> : <span className="text-muted-foreground">—</span>),
    total: <Amount value={totals[slab.key] ?? 0} signed />,
  }));
}

/** One export column per slab, labelled in full — a printed sheet has no hover. */
const slabExportColumns = <T extends { cells: Record<string, number> }>(columns: readonly RetentionSlab[]): ExportColumn<T>[] =>
  columns.map((slab): ExportColumn<T> => ({ key: slab.key, label: slab.label, value: (row) => (hasAmount(row.cells[slab.key]) ? row.cells[slab.key] : undefined), money: true }));

/** The filters in force, printed on an export so it still makes sense later. */
function exportMeta(filters: UrlFilters, projects: readonly ProjectOption[]) {
  const meta = [{ label: 'Financial year', value: filters.fy === 'all' ? 'All years' : filters.fy }];
  const ids = filters.get('project').split(',').filter(Boolean);
  const names = projects.filter((project) => ids.includes(project.id)).map((project) => project.name);
  if (names.length) meta.push({ label: 'Project', value: names.join(', ') });
  return meta;
}

/**
 * The "By rate" tab: how much retention is held at each head and rate — overall, per project and per
 * bill — and what has been released against each rate.
 */
function RetentionByRate({ bifurcation }: { bifurcation: RetentionBifurcation }) {
  const lookups = useLookups();
  const filters = useUrlFilters();
  const { columns, slabs, totals } = bifurcation;
  // Releases that name no rate belong to no slab, so the rate table's released and balance totals
  // are the slabs' own; the project table carries the rest.
  const slabReleased = sumBy(slabs, (total) => total.released);
  const slabBalance = sumBy(slabs, (total) => total.balance);
  const billProjects = new Set(bifurcation.byBill.map((bill) => bill.projectId)).size;
  // The held-by-project and held-by-bill tables leave out slabs that are only released in view.
  const heldColumns = columns.filter((slab) => slabs.some((total) => total.slab.key === slab.key && total.bills > 0));

  const slabRows: SlabRow[] = slabs.map((total) => ({ ...total, id: total.slab.key }));
  const rateColumns: BtColumn<SlabRow>[] = [
    { key: 'head', header: 'Head', pinned: true, mobile: 'title', sortValue: (row) => row.slab.name, cell: (row) => <span className="font-medium text-slate-800">{row.slab.name}</span>, total: 'Total' },
    { key: 'rate', header: 'Rate', sortValue: (row) => row.slab.rate ?? Number.MAX_SAFE_INTEGER, cell: (row) => <span className="whitespace-nowrap">{rateText(row.slab.rate)}</span> },
    { key: 'bills', header: 'Bills', align: 'right', sortValue: (row) => row.bills, cell: (row) => row.bills.toLocaleString('en-IN'), total: bifurcation.byBill.length.toLocaleString('en-IN') },
    { key: 'projects', header: 'Projects', align: 'right', sortValue: (row) => row.projects, cell: (row) => row.projects.toLocaleString('en-IN'), total: billProjects.toLocaleString('en-IN') },
    { key: 'held', header: 'Held', align: 'right', mobile: 'aside', sortValue: (row) => row.held, cell: (row) => <Amount value={row.held} signed />, total: <Amount value={totals.held} signed /> },
    { key: 'released', header: 'Released', align: 'right', sortValue: (row) => row.released, cell: (row) => <Amount value={row.released} muted />, total: <Amount value={slabReleased} /> },
    { key: 'balance', header: 'Balance', align: 'right', sortValue: (row) => row.balance, cell: (row) => <Amount value={row.balance} signed className="font-semibold" />, total: <Amount value={slabBalance} signed /> },
  ];

  const projectRows: ProjectRateRow[] = bifurcation.byProject.map((row) => ({ ...row, id: row.projectId }));
  const projectColumns: BtColumn<ProjectRateRow>[] = [
    { key: 'project', header: 'Project', pinned: true, mobile: 'title', sortValue: (row) => row.projectName, cell: (row) => <DrillLink href={`/bill-tracking/bills?project=${row.projectId}&fy=all`}>{row.projectName}</DrillLink>, total: 'Total' },
    ...slabColumns<ProjectRateRow>(heldColumns, totals.cells),
    { key: 'held', header: 'Total held', align: 'right', sortValue: (row) => row.held, cell: (row) => <Amount value={row.held} signed />, total: <Amount value={totals.held} signed /> },
    { key: 'released', header: 'Released', align: 'right', sortValue: (row) => row.released, cell: (row) => <Amount value={row.released} muted />, total: <Amount value={totals.released} /> },
    { key: 'unattributed', header: 'Not tied to a rate', align: 'right', defaultHidden: true, sortValue: (row) => row.unattributed, cell: (row) => <Amount value={row.unattributed} muted />, total: <Amount value={totals.unattributed} /> },
    { key: 'balance', header: 'Balance', align: 'right', mobile: 'aside', sortValue: (row) => row.balance, cell: (row) => <Amount value={row.balance} signed className="font-semibold" />, total: <Amount value={totals.balance} signed /> },
  ];

  const billColumns: BtColumn<BifurcationBillRow>[] = [
    {
      key: 'invoice',
      header: 'GST invoice',
      pinned: true,
      mobile: 'title',
      sortValue: (row) => row.gstInvoiceNumber ?? '',
      cell: (row) => (
        <div className="min-w-0">
          <Link href={retentionTabHref(row.id)} className={row.gstInvoiceNumber ? 'whitespace-nowrap font-medium text-emerald-700 hover:underline' : 'font-medium text-slate-500 hover:underline'}>
            {row.gstInvoiceNumber || 'NA'}
          </Link>
          {row.transactionType !== 'invoice' ? (
            <div className="mt-0.5">
              <TransactionTypeBadge type={row.transactionType} />
            </div>
          ) : null}
        </div>
      ),
      total: 'Total',
    },
    { key: 'bill', header: 'Bill no.', sortValue: (row) => row.billSerialNumber ?? '', cell: (row) => <TruncatedText text={row.billSerialNumber} className="max-w-[150px] text-xs text-slate-600" /> },
    { key: 'project', header: 'Project', sortValue: (row) => row.projectName, cell: (row) => <TruncatedText text={row.projectName} className="max-w-[180px]" /> },
    { key: 'date', header: 'Bill date', sortValue: (row) => row.billDate, cell: (row) => <span className="whitespace-nowrap">{dateText(row.billDate)}</span> },
    ...slabColumns<BifurcationBillRow>(heldColumns, totals.cells),
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      mobile: 'aside',
      sortValue: (row) => row.held,
      cell: (row) => (
        <div>
          <Amount value={row.held} signed className="font-semibold" />
          {row.fromAmounts ? (
            <div className="cursor-help whitespace-nowrap text-[10px] text-muted-foreground" title={FROM_AMOUNT_TIP}>
              rate from amount
            </div>
          ) : null}
          {row.fromInvoice ? (
            <div className="cursor-help whitespace-nowrap text-[10px] text-muted-foreground" title={FROM_INVOICE_TIP}>
              shared as on invoice
            </div>
          ) : null}
        </div>
      ),
      total: <Amount value={totals.held} signed />,
    },
  ];

  const meta = exportMeta(filters, lookups.projects);
  const fileStem = filters.fy === 'all' ? 'all-years' : filters.fy;
  const projectExport = (): ExportSpec<ProjectRateRow> => ({
    title: 'Retention by Project and Rate',
    fileName: `retention-by-rate-projects-${fileStem}`,
    meta,
    generatedBy: lookups.user.name,
    rows: projectRows,
    columns: [
      { key: 'project', label: 'Project', value: (row) => row.projectName },
      ...slabExportColumns<ProjectRateRow>(heldColumns),
      { key: 'held', label: 'Total Held', value: (row) => row.held, money: true },
      { key: 'released', label: 'Released', value: (row) => row.released, money: true },
      { key: 'unattributed', label: 'Released, Not Tied To A Rate', value: (row) => row.unattributed, money: true },
      { key: 'balance', label: 'Balance', value: (row) => row.balance, money: true },
    ],
    totals: { ...totals.cells, held: totals.held, released: totals.released, unattributed: totals.unattributed, balance: totals.balance },
  });
  const billExport = (): ExportSpec<BifurcationBillRow> => ({
    title: 'Retention by Bill and Rate',
    fileName: `retention-by-rate-bills-${fileStem}`,
    meta,
    generatedBy: lookups.user.name,
    rows: bifurcation.byBill,
    columns: [
      { key: 'gstInvoiceNumber', label: 'GST Invoice', value: (row) => row.gstInvoiceNumber || 'NA' },
      { key: 'billSerialNumber', label: 'Bill No', value: (row) => row.billSerialNumber },
      { key: 'project', label: 'Project', value: (row) => row.projectName },
      { key: 'billDate', label: 'Bill Date', value: (row) => row.billDate },
      ...slabExportColumns<BifurcationBillRow>(heldColumns),
      { key: 'held', label: 'Total', value: (row) => row.held, money: true },
      { key: 'basis', label: 'Rate Basis', value: basisText },
    ],
    totals: { ...totals.cells, held: totals.held },
  });

  return (
    <div className="space-y-4">
      {columns.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {slabs.map((total) => (
            <div key={total.slab.key} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="line-clamp-2 break-words text-xs font-medium text-slate-500" title={total.slab.label}>
                {total.slab.label}
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900">
                <Amount value={total.held} compact signed />
              </p>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                <span>
                  Released <Amount value={total.released} compact />
                </span>
                <span>
                  Balance <Amount value={total.balance} compact signed className="font-medium text-slate-700" />
                </span>
                <span>{total.bills ? `${total.bills.toLocaleString('en-IN')} bill${total.bills === 1 ? '' : 's'}` : 'Released only — no bill in view holds it'}</span>
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <BtEmpty icon={Percent} title="No retention deducted for the selected filters." />
        </div>
      )}

      {totals.unattributed > 0 ? (
        <Notice tone="amber">
          {formatINR(totals.unattributed)} has been released without naming its retention slab — it counts in each project’s balance but in no rate’s balance. Choose a slab when recording a release (or set ‘Releases retention’ on retention bills) to keep each rate’s balance right.
        </Notice>
      ) : null}

      {columns.length ? (
        <>
          <BtTable caption="By rate" rows={slabRows} columns={rateColumns} storageKey="retention-rates" showTotals />
          <BtTable
            caption="Project-wise, by rate"
            toolbarSlot={<ExportMenu spec={projectExport} />}
            rows={projectRows}
            columns={projectColumns}
            storageKey="retention-rates-projects"
            showTotals
            empty={<BtEmpty title="No retention deducted for the selected filters." />}
          />
          <BtTable
            caption="Bill-wise, by rate"
            toolbarSlot={<ExportMenu spec={billExport} />}
            rows={bifurcation.byBill}
            columns={billColumns}
            storageKey="retention-rates-bills"
            rowHref={(row) => retentionTabHref(row.id)}
            showTotals
            empty={<BtEmpty title="No bills hold retention for the selected filters." />}
          />
        </>
      ) : null}
    </div>
  );
}

export function RetentionPage() {
  const lookups = useLookups();
  const { can } = useBt();
  const { toast } = useToast();
  const filters = useUrlFilters();
  const { data, loading, error, reload } = useBtQuery<RetentionData>(`retention?${filters.apiQuery()}`);
  const bifurcation = data?.bifurcation ?? NO_BIFURCATION;
  const [releaseFor, setReleaseFor] = useState<string | null>(null);
  const [form, setForm] = useState({ projectId: '', againstBillId: '', slab: NONE, releaseDate: lookups.today, amount: '', kind: 'retention_invoice', remarks: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // The dialog picks from the bifurcation: the project's bills that hold retention, and the slabs
  // held on the chosen bill — or across the project when the release is not against one bill.
  const projectBills = bifurcation.byBill.filter((bill) => bill.projectId === form.projectId && bill.held > 0);
  const projectCells = bifurcation.byProject.find((row) => row.projectId === form.projectId)?.cells ?? {};
  const chosenBill = projectBills.find((bill) => bill.id === form.againstBillId);
  const heldCells = chosenBill?.cells ?? projectCells;
  const slabOptions = bifurcation.columns.filter((slab) => hasAmount(heldCells[slab.key]));
  const chosenSlab = slabOptions.find((slab) => slab.key === form.slab);

  const openRelease = (projectId: string) => {
    setForm((current) => ({ ...current, projectId, againstBillId: '', slab: NONE }));
    setFormError(null);
    setReleaseFor(projectId || 'new');
  };
  const chooseBill = (value: string) => {
    const againstBillId = value === NONE ? '' : value;
    const cells = (againstBillId ? projectBills.find((bill) => bill.id === againstBillId)?.cells : projectCells) ?? {};
    // Keep the slab only while the newly chosen bill (or the project) still holds it.
    setForm({ ...form, againstBillId, slab: hasAmount(cells[form.slab]) ? form.slab : NONE });
  };
  const chooseSlab = (value: string) => {
    const slab = slabOptions.find((entry) => entry.key === value);
    setForm({ ...form, slab: slab ? slab.key : NONE, kind: slab ? slab.kind : form.kind });
  };
  const save = async () => {
    setSaving(true);
    setFormError(null);
    // A chosen slab names its head and rate. A fixed-amount slab's rate is null and is sent as null:
    // the API reads an absent rate as "not tied to a rate".
    const slabFields = chosenSlab ? { deductionTypeId: chosenSlab.deductionTypeId, rate: chosenSlab.rate } : {};
    try {
      await btFetch('retention', { body: { projectId: form.projectId, againstBillId: chosenBill?.id, releaseDate: form.releaseDate, amount: Number(form.amount), kind: chosenSlab?.kind ?? form.kind, remarks: form.remarks, ...slabFields } });
      toast({ title: 'Retention release recorded' });
      setReleaseFor(null);
      reload();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };
  const cancel = async (release: RetentionRelease) => {
    const reason = window.prompt('Reason for cancelling this release?');
    if (!reason) return;
    try {
      await btFetch(`retention/${release.id}`, { method: 'DELETE', body: { reason } });
      reload();
    } catch (caught) {
      toast({ title: 'Could not cancel', description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' });
    }
  };

  /** The slab a release names, by its label — matched as the bifurcation matches it (a bare rate, among its own project's slabs). */
  const releaseRate = (release: RetentionRelease): string | null => {
    const held = bifurcation.byProject.find((row) => row.projectId === release.projectId)?.cells ?? {};
    const key = releaseSlabKey(release, bifurcation.columns.filter((slab) => slab.key in held));
    const slab = key ? bifurcation.columns.find((entry) => entry.key === key) : undefined;
    if (slab) return slab.label;
    return release.rate === undefined ? null : rateText(release.rate);
  };

  const releaseColumns: BtColumn<RetentionRelease>[] = [
    { key: 'date', header: 'Release date', pinned: true, mobile: 'title', sortValue: (row) => row.releaseDate, cell: (row) => dateText(row.releaseDate) },
    { key: 'project', header: 'Project', cell: (row) => row.projectNameSnapshot },
    { key: 'against', header: 'Against bill', cell: (row) => (row.againstBillId ? <Link className="text-emerald-700 hover:underline" href={`/bill-tracking/bills/${row.againstBillId}`}>{row.againstBillSerial ?? 'bill'}</Link> : row.retentionBillId ? <Link className="text-emerald-700 hover:underline" href={`/bill-tracking/bills/${row.retentionBillId}`}>Retention bill</Link> : '—') },
    { key: 'rate', header: 'Rate', cell: (row) => <TruncatedText text={releaseRate(row)} className="max-w-[220px] text-xs" /> },
    { key: 'source', header: 'Source', cell: (row) => (row.collectionId ? 'Receipt on retention bill' : 'Recorded manually') },
    { key: 'remarks', header: 'Remarks', cell: (row) => <span className="line-clamp-1 text-xs">{row.remarks ?? ''}</span> },
    { key: 'amount', header: 'Amount', align: 'right', mobile: 'aside', cell: (row) => <Amount value={row.amount} /> },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge tone={row.status === 'active' ? 'success' : 'neutral'}>{row.status === 'active' ? 'Active' : 'Cancelled'}</StatusBadge> },
    {
      key: 'actions',
      header: '',
      label: 'Actions',
      mobile: 'omit',
      align: 'right',
      cell: (row) =>
        row.status === 'active' && !row.collectionId && can('Retention', 'Manage') ? (
          <Button size="sm" variant="ghost" className="h-7 text-xs text-rose-700" onClick={() => void cancel(row)}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={PiggyBank}
        title="Retention"
        description="Retention held under CPBG, invoice and time-extension heads, what has been released, and the balance still due."
        actions={
          can('Retention', 'Manage') ? (
            <Button size="sm" className="gap-1.5" onClick={() => openRelease(filters.get('project'))}>
              <Plus className="h-4 w-4" /> Record release
            </Button>
          ) : null
        }
      />
      <BillFilterBar filters={filters} page="retention" hide={['payment']} actions={data ? <ExportMenu spec={() => ({ title: 'Retention', fileName: 'retention', generatedBy: lookups.user.name, rows: data.rows.map((row) => ({ ...row, id: row.projectId })), columns: [{ key: 'p', label: 'Project', value: (row) => row.projectName }, { key: 'd', label: 'Deducted', value: (row) => row.deducted, money: true }, { key: 'r', label: 'Released', value: (row) => row.released, money: true }, { key: 'b', label: 'Balance', value: (row) => row.balance, money: true }, { key: 'e', label: 'Expected Release', value: (row) => row.expectedReleaseDate }, { key: 's', label: 'Status', value: (row) => row.status }] })} /> : null} />
      <BtError message={error} onRetry={reload} />
      {data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <MoneyKpi label="Total retention deducted" value={data.totals.deducted} tone="violet" />
          <MoneyKpi label="Total released" value={data.totals.released} tone="emerald" />
          <MoneyKpi label="Balance to be released" value={data.totals.balance} tone="amber" />
          <MoneyKpi label="Due this month" value={data.totals.dueThisMonth} tone="blue" />
          <MoneyKpi label="Overdue" value={data.totals.overdue} tone="rose" />
        </div>
      ) : null}
      {loading && !data ? <BtLoading /> : null}
      {data ? (
        <Tabs defaultValue="rate">
          <TabsList className={BT_TABS_LIST} aria-label="Retention view">
            <TabsTrigger className={BT_TAB} value="rate">
              <Percent className="h-4 w-4" /> By rate <TabCount value={bifurcation.columns.length} />
            </TabsTrigger>
            <TabsTrigger className={BT_TAB} value="project">
              <FolderKanban className="h-4 w-4" /> By project <TabCount value={data.rows.length} />
            </TabsTrigger>
            <TabsTrigger className={BT_TAB} value="ledger">
              <History className="h-4 w-4" /> Release ledger <TabCount value={data.releases.length} />
            </TabsTrigger>
          </TabsList>
          <TabsContent value="rate">
            <RetentionByRate bifurcation={bifurcation} />
          </TabsContent>
          <TabsContent value="project">
            <RetentionTable data={data} onRelease={can('Retention', 'Manage') ? openRelease : undefined} />
          </TabsContent>
          <TabsContent value="ledger">
            <BtTable caption="Release ledger" rows={data.releases} columns={releaseColumns} storageKey="retention-releases" rowClassName={(row) => (row.status === 'cancelled' ? 'opacity-50' : undefined)} empty={<BtEmpty title="No retention releases recorded." />} />
          </TabsContent>
        </Tabs>
      ) : null}

      <Dialog open={Boolean(releaseFor)} onOpenChange={(open) => !open && setReleaseFor(null)}>
        <DialogContent className={PM_DIALOG.content}>
          <DialogHeader className={PM_DIALOG.header}>
            <DialogTitle>Record retention release</DialogTitle>
            <DialogDescription>For a release not paid against a retention bill (a receipt on a retention bill posts its release automatically).</DialogDescription>
          </DialogHeader>
          <div className={PM_DIALOG.bodyGrid}>
            <div className="space-y-1 sm:col-span-2">
              <Label>Project *</Label>
              <Select value={form.projectId} onValueChange={(value) => setForm({ ...form, projectId: value, againstBillId: '', slab: NONE })}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {lookups.projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Release date *</Label>
              <Input type="date" value={form.releaseDate} onChange={(event) => setForm({ ...form, releaseDate: event.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Amount (₹) *</Label>
              <Input inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Against bill (optional)</Label>
              <Select value={chosenBill?.id ?? NONE} onValueChange={chooseBill} disabled={!form.projectId}>
                <SelectTrigger>
                  <span className="min-w-0 flex-1 truncate text-left">
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>Not against one bill</SelectItem>
                  {projectBills.map((bill) => (
                    <SelectItem key={bill.id} value={bill.id}>
                      {bill.gstInvoiceNumber || bill.billSerialNumber || 'No invoice no.'} · {dateText(bill.billDate)} · {formatINR(bill.held)} held
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Bills holding retention within the filters above — choose All years to see older bills.</p>
            </div>
            <div className={chosenSlab ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
              <Label>Retention slab</Label>
              <Select value={chosenSlab?.key ?? NONE} onValueChange={chooseSlab} disabled={!form.projectId}>
                <SelectTrigger>
                  <span className="min-w-0 flex-1 truncate text-left">
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>Not tied to a rate</SelectItem>
                  {slabOptions.map((slab) => (
                    <SelectItem key={slab.key} value={slab.key}>
                      {slab.label} · {formatINR(heldCells[slab.key])} held
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{chosenSlab ? 'Reduces this rate’s balance as well as the project’s.' : 'Counts in the project’s balance only, under the head chosen.'}</p>
            </div>
            {chosenSlab ? null : (
              <div className="space-y-1">
                <Label>Head</Label>
                <Select value={form.kind} onValueChange={(value) => setForm({ ...form, kind: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retention_cpbg">Against CPBG</SelectItem>
                    <SelectItem value="retention_invoice">Against invoice</SelectItem>
                    <SelectItem value="retention_time_extension">Time extension</SelectItem>
                    <SelectItem value="retention_other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1 sm:col-span-2">
              <Label>Remarks</Label>
              <Textarea rows={2} value={form.remarks} onChange={(event) => setForm({ ...form, remarks: event.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <BtError message={formError} />
            </div>
          </div>
          <DialogFooter className={PM_DIALOG.footer}>
            <Button variant="outline" onClick={() => setReleaseFor(null)}>
              Cancel
            </Button>
            <Button disabled={saving || !form.projectId || !(Number(form.amount) > 0)} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Record release'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── targets ─────────────────────────────────────────────────────────────── */

interface PerformanceResponse {
  financialYear: string;
  weeks: TargetPerformanceRow[];
  targets: CollectionTarget[];
  byDimension: { key: string; label: string; target: number; actual: number; achievement: number | null }[];
}

export function TargetsPage() {
  const lookups = useLookups();
  const { can } = useBt();
  const { toast } = useToast();
  const filters = useUrlFilters();
  const { data, loading, error, reload } = useBtQuery<PerformanceResponse>(`targets?${filters.apiQuery({ by: filters.get('by') || 'project' })}`);
  const { data: forecast } = useBtQuery<{ windows: ForecastWindow[] }>(`targets?${filters.apiQuery({ view: 'forecast' })}`);
  const blank = { id: '', week: isoWeekOf(lookups.today), projectId: '', amount: '', responsibleId: '', probability: '', expectedDate: '', remarks: '' };
  const [editing, setEditing] = useState<typeof blank | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    const body = { week: editing.week, projectId: editing.projectId || undefined, amount: Number(editing.amount), responsibleId: editing.responsibleId || undefined, probability: editing.probability ? Number(editing.probability) : undefined, expectedDate: editing.expectedDate, remarks: editing.remarks };
    try {
      if (editing.id) await btFetch(`targets/${editing.id}`, { method: 'PUT', body });
      else await btFetch('targets', { body });
      setEditing(null);
      toast({ title: 'Target saved' });
      reload();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const currentWeek = data?.weeks.find((row) => row.week === isoWeekOf(lookups.today));
  const targetColumns: BtColumn<CollectionTarget>[] = [
    { key: 'week', header: 'Week', pinned: true, mobile: 'title', sortValue: (row) => row.week, cell: (row) => row.week },
    { key: 'project', header: 'Project', cell: (row) => row.projectNameSnapshot ?? 'Company-wide' },
    { key: 'amount', header: 'Target', align: 'right', mobile: 'aside', sortValue: (row) => row.amount, cell: (row) => <Amount value={row.amount} /> },
    { key: 'responsible', header: 'Responsible', cell: (row) => row.responsibleName ?? '—' },
    { key: 'probability', header: 'Probability', align: 'right', cell: (row) => (row.probability !== undefined ? `${row.probability}%` : '—') },
    { key: 'expected', header: 'Expected date', cell: (row) => dateText(row.expectedDate) },
    { key: 'remarks', header: 'Remarks', defaultHidden: true, cell: (row) => row.remarks ?? '' },
    {
      key: 'actions',
      header: '',
      label: 'Actions',
      mobile: 'omit',
      align: 'right',
      cell: (row) =>
        can('Targets', 'Manage') ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing({ id: row.id, week: row.week, projectId: row.projectId ?? '', amount: String(row.amount), responsibleId: row.responsibleId ?? '', probability: row.probability !== undefined ? String(row.probability) : '', expectedDate: row.expectedDate ?? '', remarks: row.remarks ?? '' })}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-rose-700"
              aria-label="Remove target"
              onClick={async () => {
                if (!window.confirm(`Remove the ${row.week} target?`)) return;
                await btFetch(`targets/${row.id}`, { method: 'DELETE' });
                reload();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Target}
        title="Collection targets & forecast"
        description="Weekly collection targets against verified receipts, and what is expected next from recorded commitments and dates."
        actions={
          can('Targets', 'Manage') ? (
            <Button size="sm" className="gap-1.5" onClick={() => setEditing(blank)}>
              <Plus className="h-4 w-4" /> Set target
            </Button>
          ) : null
        }
      />
      <BillFilterBar filters={filters} page="targets" hide={['payment']} />
      <BtError message={error} onRetry={reload} />
      {loading && !data ? <BtLoading /> : null}
      {forecast ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-[11px] uppercase text-muted-foreground">This week · target</p>
            <p className="text-lg font-semibold">
              <Amount value={currentWeek?.target ?? 0} compact />
            </p>
            <p className="text-[11px] text-muted-foreground">
              actual <Amount value={currentWeek?.actual ?? 0} compact /> · {percentText(currentWeek?.achievement)}
            </p>
          </div>
          {forecast.windows.map((window) => (
            <div key={window.key} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-[11px] uppercase text-muted-foreground">Expected · {window.label}</p>
              <p className="text-lg font-semibold">
                <Amount value={window.amount} compact />
              </p>
              <p className="text-[11px] text-muted-foreground">{window.count} bills</p>
            </div>
          ))}
        </div>
      ) : null}
      {data ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionHeader title={`Target vs actual · FY ${data.financialYear}`} as="h3" />
            <div className="mt-2">
              <TargetActualChart data={data.weeks.slice(-16)} />
            </div>
          </section>
          <div className="space-y-2">
            <BtTable caption="Targets" toolbarSlot={<Link href={`/bill-tracking/reports/performance${filters.queryString ? `?${filters.queryString}` : ''}`} className="text-xs font-medium text-emerald-700 hover:underline">Performance by project / owner</Link>} rows={data.targets} columns={targetColumns} storageKey="targets" empty={<BtEmpty title="No targets set for this year." description="Set a weekly collection target for a project or the whole company." />} />
          </div>
        </>
      ) : null}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className={PM_DIALOG.content}>
          <DialogHeader className={PM_DIALOG.header}>
            <DialogTitle>{editing?.id ? 'Edit target' : 'Set collection target'}</DialogTitle>
            <DialogDescription>Compared with verified receipts dated in the same ISO week (Monday–Sunday).</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className={PM_DIALOG.bodyGrid}>
              <div className="space-y-1">
                <Label>Week *</Label>
                <Input value={editing.week} onChange={(event) => setEditing({ ...editing, week: event.target.value })} placeholder="2026-W41" />
              </div>
              <div className="space-y-1">
                <Label>Target amount (₹) *</Label>
                <Input inputMode="decimal" value={editing.amount} onChange={(event) => setEditing({ ...editing, amount: event.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Project</Label>
                <Select value={editing.projectId || 'all'} onValueChange={(value) => setEditing({ ...editing, projectId: value === 'all' ? '' : value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {lookups.allProjects ? <SelectItem value="all">Company-wide</SelectItem> : null}
                    {lookups.projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Responsible</Label>
                <Select value={editing.responsibleId || 'none'} onValueChange={(value) => setEditing({ ...editing, responsibleId: value === 'none' ? '' : value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="none">—</SelectItem>
                    {lookups.users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Probability %</Label>
                <Input inputMode="numeric" value={editing.probability} onChange={(event) => setEditing({ ...editing, probability: event.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Expected collection date</Label>
                <Input type="date" value={editing.expectedDate} onChange={(event) => setEditing({ ...editing, expectedDate: event.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Remarks</Label>
                <Textarea rows={2} value={editing.remarks} onChange={(event) => setEditing({ ...editing, remarks: event.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <BtError message={formError} />
              </div>
            </div>
          ) : null}
          <DialogFooter className={PM_DIALOG.footer}>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={saving || !editing || !(Number(editing.amount) > 0) || !/^\d{4}-W\d{2}$/.test(editing.week)} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save target'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
