'use client';

/**
 * Retention ledger (`/bill-tracking/retention`) and collection targets & forecast
 * (`/bill-tracking/targets`).
 *
 * Retention held is what bills deducted under retention heads; released is the ledger of release
 * entries — written automatically when a receipt is verified against a retention bill, or recorded
 * here for a release that came another way. Targets are weekly amounts per project (or company-wide)
 * compared with verified receipts in the same ISO week.
 */

import { useState } from 'react';
import Link from 'next/link';
import { PiggyBank, Plus, Target, Trash2 } from 'lucide-react';

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
import { formatINR } from '@/lib/bill-tracking/money';
import { RETENTION_STATE_LABELS, type BillRetention, type RetentionTotals } from '@/lib/bill-tracking/retention';
import type { RetentionRow, TargetPerformanceRow, ForecastWindow } from '@/lib/bill-tracking/reports';
import type { CollectionTarget, RetentionRelease } from '@/lib/bill-tracking/types';

import { btFetch, useBt, useBtQuery, useLookups } from './bt-client';
import { BillFilterBar, useUrlFilters } from './bt-filters';
import { BtTable, type BtColumn } from './bt-table';
import { ToolbarSelect } from './bt-toolbar';
import { TargetActualChart } from './dashboard-charts';
import { RetentionTable } from './reports';
import { Amount, BtEmpty, BtError, BtLoading, ExportMenu, MoneyKpi, dateText, percentText, BT_TAB, BT_TABS_LIST, RetentionStateBadge, StatStrip, TabCount, TruncatedText } from './bt-ui';

/** One bill with retention: held, raised on retention bills, received, still to raise. */
type RetentionBillRow = BillRetention & {
  id: string;
  gstInvoiceNumber?: string;
  billSerialNumber?: string;
  billDate: string;
  projectId: string;
  projectName: string;
  billTypeName: string;
};

interface RetentionData {
  rows: RetentionRow[];
  totals: { deducted: number; released: number; balance: number; dueThisMonth: number; overdue: number };
  releases: RetentionRelease[];
  byBill: RetentionBillRow[];
  byBillTotals: RetentionTotals;
}

const STATE_FILTERS = (['not_raised', 'partly_raised', 'raised', 'received'] as const).map((value) => ({ value, label: RETENTION_STATE_LABELS[value] }));

export function RetentionPage() {
  const lookups = useLookups();
  const { can } = useBt();
  const { toast } = useToast();
  const filters = useUrlFilters();
  const { data, loading, error, reload } = useBtQuery<RetentionData>(`retention?${filters.apiQuery()}`);
  const [releaseFor, setReleaseFor] = useState<string | null>(null);
  const [form, setForm] = useState({ projectId: '', againstBillId: '', deductionTypeId: '', releaseDate: lookups.today, amount: '', kind: 'retention_invoice', remarks: '' });
  const [tab, setTab] = useState('bills');
  const [stateFilter, setStateFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openRelease = (projectId: string, bill?: RetentionBillRow) => {
    // From a bill row: that bill, its first head with retention still out, and that amount.
    const head = bill?.heads.find((entry) => entry.pendingToRaise > 0) ?? bill?.heads[0];
    setForm((current) => ({ ...current, projectId, againstBillId: bill?.id ?? '', deductionTypeId: head?.deductionTypeId ?? '', kind: head?.kind ?? current.kind, amount: head ? String(head.pendingToRaise || '') : '' }));
    setReleaseFor(projectId || 'new');
  };
  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await btFetch('retention', { body: { projectId: form.projectId, againstBillId: form.againstBillId || undefined, deductionTypeId: form.againstBillId ? form.deductionTypeId || undefined : undefined, releaseDate: form.releaseDate, amount: Number(form.amount), kind: form.kind, remarks: form.remarks } });
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

  const releaseColumns: BtColumn<RetentionRelease>[] = [
    { key: 'date', header: 'Release date', pinned: true, mobile: 'title', sortValue: (row) => row.releaseDate, cell: (row) => dateText(row.releaseDate) },
    { key: 'project', header: 'Project', cell: (row) => row.projectNameSnapshot },
    { key: 'against', header: 'Against bill', cell: (row) => (row.againstBillId ? <Link className="text-emerald-700 hover:underline" href={`/bill-tracking/bills/${row.againstBillId}`}>{row.againstBillSerial ?? 'bill'}</Link> : row.retentionBillId ? <Link className="text-emerald-700 hover:underline" href={`/bill-tracking/bills/${row.retentionBillId}`}>Retention bill</Link> : '—') },
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

  const billRows = (data?.byBill ?? []).filter((row) => !stateFilter || row.state === stateFilter);
  const billColumns: BtColumn<RetentionBillRow>[] = [
    {
      key: 'invoice',
      header: 'GST invoice',
      pinned: true,
      mobile: 'title',
      sortValue: (row) => row.gstInvoiceNumber ?? '',
      cell: (row) => (
        <Link href={`/bill-tracking/bills/${row.id}?tab=retention`} className="whitespace-nowrap font-medium text-emerald-700 hover:underline">
          {row.gstInvoiceNumber || 'NA'}
        </Link>
      ),
      total: 'Total',
    },
    { key: 'bill', header: 'Bill no.', label: 'Bill no.', sortValue: (row) => row.billSerialNumber ?? '', cell: (row) => <TruncatedText text={row.billSerialNumber} className="max-w-[150px] text-xs text-slate-600" /> },
    { key: 'project', header: 'Project', sortValue: (row) => row.projectName, cell: (row) => <TruncatedText text={row.projectName} className="max-w-[180px]" /> },
    { key: 'date', header: 'Bill date', sortValue: (row) => row.billDate, cell: (row) => <span className="whitespace-nowrap">{dateText(row.billDate)}</span> },
    { key: 'type', header: 'Sub category', defaultHidden: true, cell: (row) => row.billTypeName },
    { key: 'held', header: 'Held', align: 'right', sortValue: (row) => row.held, cell: (row) => <Amount value={row.held} />, total: <Amount value={data?.byBillTotals.held} /> },
    { key: 'claimed', header: 'Raised', align: 'right', sortValue: (row) => row.claimed, cell: (row) => <Amount value={row.claimed} muted />, total: <Amount value={data?.byBillTotals.claimed} /> },
    { key: 'received', header: 'Received', align: 'right', sortValue: (row) => row.received, cell: (row) => <Amount value={row.received} muted className="text-emerald-700" />, total: <Amount value={data?.byBillTotals.received} /> },
    {
      key: 'pending',
      header: 'Still to raise',
      align: 'right',
      mobile: 'aside',
      sortValue: (row) => row.pendingToRaise,
      cell: (row) => <Amount value={row.pendingToRaise} muted className={row.pendingToRaise > 0 ? 'font-semibold text-amber-700' : undefined} />,
      total: <Amount value={data?.byBillTotals.pendingToRaise} />,
    },
    { key: 'awaiting', header: 'Awaiting payment', align: 'right', defaultHidden: true, sortValue: (row) => row.awaitingPayment, cell: (row) => <Amount value={row.awaitingPayment} muted />, total: <Amount value={data?.byBillTotals.awaitingPayment} /> },
    { key: 'state', header: 'Status', mobile: 'detail', sortValue: (row) => row.state, cell: (row) => <RetentionStateBadge state={row.state} /> },
    {
      key: 'retentionBills',
      header: 'Retention bills',
      cell: (row) =>
        row.claims.length ? (
          <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
            {[...new Map(row.claims.map((claim) => [claim.retentionBillId, claim])).values()].map((claim) => (
              <Link key={claim.retentionBillId} href={`/bill-tracking/bills/${claim.retentionBillId}?tab=retention`} className="whitespace-nowrap text-emerald-700 hover:underline">
                {claim.reference}
              </Link>
            ))}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      label: 'Actions',
      mobile: 'omit',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          {row.pendingToRaise > 0 && can('Bills', 'Add') ? (
            <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
              <Link href={`/bill-tracking/bills/new?type=retention_bill&project=${row.projectId}&claim=${row.id}`}>Raise retention bill</Link>
            </Button>
          ) : null}
          {row.state !== 'received' && can('Retention', 'Manage') ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openRelease(row.projectId, row)}>
              Record release
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
  // The release dialog: bills of the chosen project, and the heads of the chosen bill.
  const projectBills = (data?.byBill ?? []).filter((row) => row.projectId === form.projectId);
  const chosenBill = projectBills.find((row) => row.id === form.againstBillId);

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
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className={BT_TABS_LIST}>
            <TabsTrigger className={BT_TAB} value="bills">
              By bill <TabCount value={data.byBill.length} />
            </TabsTrigger>
            <TabsTrigger className={BT_TAB} value="projects">
              By project <TabCount value={data.rows.length} />
            </TabsTrigger>
            <TabsTrigger className={BT_TAB} value="ledger">
              Release ledger <TabCount value={data.releases.length} />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bills" className="space-y-4">
            <StatStrip
              items={[
                { label: 'Bills with retention', value: data.byBillTotals.bills.toLocaleString('en-IN') },
                { label: 'Retention not raised', value: data.byBillTotals.byState.not_raised.toLocaleString('en-IN'), hint: data.byBillTotals.byState.partly_raised ? `+ ${data.byBillTotals.byState.partly_raised} partly raised` : undefined, tone: data.byBillTotals.byState.not_raised ? 'text-amber-700' : 'text-slate-900' },
                { label: 'Still to raise', value: <Amount value={data.byBillTotals.pendingToRaise} compact />, tone: data.byBillTotals.pendingToRaise > 0 ? 'text-amber-700' : 'text-slate-900' },
                { label: 'Raised · awaiting payment', value: <Amount value={data.byBillTotals.awaitingPayment} compact />, tone: 'text-violet-700' },
                { label: 'Received', value: <Amount value={data.byBillTotals.received} compact />, tone: 'text-emerald-700' },
              ]}
            />
            <BtTable
              caption={<span>{billRows.length.toLocaleString('en-IN')} bill{billRows.length === 1 ? '' : 's'} with retention</span>}
              toolbarSlot={<ToolbarSelect label="Status" value={stateFilter} onChange={setStateFilter} options={STATE_FILTERS} allLabel="All" />}
              rows={billRows}
              columns={billColumns}
              storageKey="retention-by-bill"
              rowHref={(row) => `/bill-tracking/bills/${row.id}?tab=retention`}
              showTotals
              empty={<BtEmpty icon={PiggyBank} title={stateFilter ? 'No bills with that retention status.' : 'No retention deducted for the selected filters.'} />}
            />
          </TabsContent>

          <TabsContent value="projects">
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
              <Select value={form.projectId} onValueChange={(value) => setForm({ ...form, projectId: value })}>
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
              <Label>Against bill</Label>
              <Select
                value={form.againstBillId || 'none'}
                onValueChange={(value) => {
                  const bill = projectBills.find((row) => row.id === value);
                  const head = bill?.heads.find((entry) => entry.pendingToRaise > 0) ?? bill?.heads[0];
                  setForm({ ...form, againstBillId: value === 'none' ? '' : value, deductionTypeId: head?.deductionTypeId ?? '', kind: head?.kind ?? form.kind });
                }}
                disabled={!form.projectId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={form.projectId ? 'Not against one bill' : 'Choose the project first'} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">Not against one bill (the project)</SelectItem>
                  {projectBills.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.gstInvoiceNumber || row.billSerialNumber || 'Bill'} · {dateText(row.billDate)} · held {formatINR(row.held)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Head</Label>
              {chosenBill ? (
                <Select
                  value={form.deductionTypeId}
                  onValueChange={(value) => {
                    const head = chosenBill.heads.find((entry) => entry.deductionTypeId === value);
                    setForm({ ...form, deductionTypeId: value, kind: head?.kind ?? form.kind });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose the retention head" />
                  </SelectTrigger>
                  <SelectContent>
                    {chosenBill.heads.map((head) => (
                      <SelectItem key={head.deductionTypeId} value={head.deductionTypeId}>
                        {head.name} · held {formatINR(head.held)} · still out {formatINR(Math.max(0, head.held - head.received))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
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
              )}
            </div>
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
