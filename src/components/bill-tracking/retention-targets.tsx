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
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { PM_DIALOG } from '@/components/project-management/pm-shell';
import { useToast } from '@/hooks/use-toast';
import { isoWeekOf } from '@/lib/bill-tracking/calculations';
import type { RetentionRow, TargetPerformanceRow, ForecastWindow } from '@/lib/bill-tracking/reports';
import type { CollectionTarget, RetentionRelease } from '@/lib/bill-tracking/types';

import { btFetch, useBt, useBtQuery, useLookups } from './bt-client';
import { BillFilterBar, useUrlFilters } from './bt-filters';
import { BtTable, type BtColumn } from './bt-table';
import { TargetActualChart } from './dashboard-charts';
import { RetentionTable } from './reports';
import { Amount, BtEmpty, BtError, BtLoading, ExportMenu, MoneyKpi, dateText, percentText } from './bt-ui';

interface RetentionData {
  rows: RetentionRow[];
  totals: { deducted: number; released: number; balance: number; dueThisMonth: number; overdue: number };
  releases: RetentionRelease[];
}

export function RetentionPage() {
  const lookups = useLookups();
  const { can } = useBt();
  const { toast } = useToast();
  const filters = useUrlFilters();
  const { data, loading, error, reload } = useBtQuery<RetentionData>(`retention?${filters.apiQuery()}`);
  const [releaseFor, setReleaseFor] = useState<string | null>(null);
  const [form, setForm] = useState({ projectId: '', againstBillId: '', releaseDate: lookups.today, amount: '', kind: 'retention_invoice', remarks: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openRelease = (projectId: string) => {
    setForm((current) => ({ ...current, projectId }));
    setReleaseFor(projectId || 'new');
  };
  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await btFetch('retention', { body: { projectId: form.projectId, againstBillId: form.againstBillId || undefined, releaseDate: form.releaseDate, amount: Number(form.amount), kind: form.kind, remarks: form.remarks } });
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
      {data ? <RetentionTable data={data} onRelease={can('Retention', 'Manage') ? openRelease : undefined} /> : null}
      {data ? (
        <div className="space-y-2">
          <BtTable caption="Release ledger" rows={data.releases} columns={releaseColumns} storageKey="retention-releases" rowClassName={(row) => (row.status === 'cancelled' ? 'opacity-50' : undefined)} empty={<BtEmpty title="No retention releases recorded." />} />
        </div>
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
            <div className="space-y-1">
              <Label>Against bill id (optional)</Label>
              <Input value={form.againstBillId} onChange={(event) => setForm({ ...form, againstBillId: event.target.value })} placeholder="Paste from the bill URL" />
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
