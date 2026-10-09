'use client';

/**
 * Bill Register (`/bill-tracking/bills`) and Outstanding (`/bill-tracking/outstanding`).
 *
 * One component, two presets: the register lists every bill; Outstanding lists only bills with
 * something left to collect, with ageing, follow-up and commitment columns and the quick-filter
 * chips. Paging, sorting and filtering all happen on the server; the strip above the table shows
 * totals over everything the filters match, not just the page on screen.
 */

import { useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Clock, HandCoins, Plus, ReceiptIndianRupee, UserCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { PM_DIALOG } from '@/components/project-management/pm-shell';
import { useToast } from '@/hooks/use-toast';
import { categoryName } from '@/lib/bill-tracking/categories';
import { receiptBlockReason } from '@/lib/bill-tracking/certification';
import { STEP_PERMISSION, certificationBlocked, waitingFor } from '@/lib/bill-tracking/workflow';
import { LEGACY_EXPORT_HEADERS, legacyExportRows } from '@/lib/bill-tracking/legacy-export';
import { formatINRCompact } from '@/lib/bill-tracking/money';
import { exportWorkbook } from '@/lib/report-excel';
import { GST_TYPE_LABELS, PAYMENT_STATUS_LABELS, WORKFLOW_STATUS_LABELS, type Bill } from '@/lib/bill-tracking/types';
import type { BillTotals } from '@/lib/bill-tracking/reports';

import { btFetch, useBtQuery, useLookups, useBt, useWorkflowActor } from './bt-client';
import { BillFilterBar, FilterChips, useUrlFilters } from './bt-filters';
import { BtTable, Pager, type BtColumn } from './bt-table';
import CertificationRegister, { RegisterViewTabs, type RegisterView } from './certification-register';
import { AgeingBadge, Amount, BtEmpty, BtError, BtLoading, ExportMenu, PaymentStatusBadge, TransactionTypeBadge, WorkflowStatusBadge, dateText, percentText, type ExportColumn, StatStrip, TruncatedText } from './bt-ui';

export interface BillRow extends Bill {
  ageingDays: number;
  ageingBucket: string;
  overdue: boolean;
  commitmentMissed: boolean;
}

interface ListResponse {
  rows: BillRow[];
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  totals: BillTotals;
  asOf: string;
}

const OUTSTANDING_CHIPS = [
  { value: 'not_received', label: 'Not received' },
  { value: 'partially_received', label: 'Partially received' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'gt30', label: '> 30 days' },
  { value: 'gt60', label: '> 60 days' },
  { value: 'gt90', label: '> 90 days' },
  { value: 'gt180', label: '> 180 days' },
  { value: 'gt365', label: '> 365 days' },
  { value: 'commitment_missed', label: 'Commitment missed' },
];

export function billReference(bill: Pick<Bill, 'gstInvoiceNumber' | 'billSerialNumber' | 'id'>) {
  return bill.gstInvoiceNumber || bill.billSerialNumber || bill.id.slice(0, 8);
}

export function TotalsStrip({ totals }: { totals: BillTotals }) {
  return (
    <StatStrip
      items={[
        { label: 'Bills', value: totals.count.toLocaleString('en-IN') },
        { label: 'Gross', value: <Amount value={totals.gross} compact /> },
        { label: 'Net receivable', value: <Amount value={totals.net} compact /> },
        { label: 'Received', value: <Amount value={totals.received} compact />, tone: 'text-emerald-700' },
        { label: 'Outstanding', value: <Amount value={totals.outstanding} compact />, tone: 'text-rose-700' },
        { label: 'Collection %', value: percentText(totals.collectionPercent) },
      ]}
    />
  );
}

export default function BillRegister({ mode = 'all' }: { mode?: 'all' | 'outstanding' }) {
  const lookups = useLookups();
  const { can } = useBt();
  const { toast } = useToast();
  const filters = useUrlFilters();
  const outstanding = mode === 'outstanding';
  const actor = useWorkflowActor();
  // "Waiting for me": bills whose next stage is this person's. Someone in only through Settings →
  // Workflow sees nothing else.
  const mine = lookups.workflowOnly || filters.get('mine') === '1';
  // The register's certification views (Outstanding has none).
  const requestedView = filters.get('view');
  const view: RegisterView = !outstanding && (requestedView === 'certified' || requestedView === 'compare') ? requestedView : 'raised';
  const sort = filters.get('sort') || (outstanding ? 'ageing' : 'billDate');
  const dir = (filters.get('dir') || 'desc') as 'asc' | 'desc';
  const page = Number(filters.get('page')) || 1;
  const pageSize = Number(filters.get('pageSize')) || 25;
  const query = filters.apiQuery({ sort, dir, page, pageSize, open: outstanding ? '1' : undefined, mine: mine ? '1' : undefined });
  const { data, loading, error, reload } = useBtQuery<ListResponse>(view === 'raised' ? `bills?${query}` : null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | 'assign_owner' | 'set_target_week' | 'set_next_follow_up' | 'set_expected_date'>(null);
  const buckets = lookups.config.settings.ageingBuckets;

  const columns: BtColumn<BillRow>[] = [
    {
      key: 'invoice',
      header: 'GST invoice',
      pinned: true,
      mobile: 'title',
      sortKey: 'gstInvoiceNumber',
      cell: (bill) => (
        <div className="min-w-0">
          <Link href={`/bill-tracking/bills/${bill.id}`} className={bill.gstInvoiceNumber ? 'whitespace-nowrap font-medium text-emerald-700 hover:underline' : 'font-medium text-slate-500 hover:underline'}>
            {bill.gstInvoiceNumber || 'NA'}
          </Link>
          <div className="flex flex-wrap items-center gap-1">
            <TransactionTypeBadge type={bill.transactionType} />
            {bill.netMismatch && !bill.netMismatch.resolvedAt ? <span className="text-[10px] font-medium text-amber-700">net mismatch</span> : null}
          </div>
        </div>
      ),
      total: 'Total',
    },
    { key: 'bill', header: 'Bill no.', label: 'Bill no.', sortKey: 'billSerialNumber', cell: (bill) => <TruncatedText text={bill.billSerialNumber} className="max-w-[150px] text-xs text-slate-600" /> },
    { key: 'date', header: 'Date', sortKey: 'billDate', cell: (bill) => <span className="whitespace-nowrap">{dateText(bill.billDate)}</span> },
    { key: 'project', header: 'Project', sortKey: 'projectNameSnapshot', cell: (bill) => <TruncatedText text={bill.projectNameSnapshot} className="max-w-[180px]" /> },
    { key: 'client', header: 'Client', defaultHidden: !outstanding, cell: (bill) => bill.clientNameSnapshot || '—' },
    {
      key: 'type',
      header: 'Category',
      cell: (bill) => (
        <div className="whitespace-nowrap text-xs">
          <div>{bill.billTypeName}</div>
          <div className="text-[10px] text-muted-foreground">{categoryName(bill.billCategory, lookups.config.billCategories, bill.billCategoryName)}</div>
        </div>
      ),
    },
    { key: 'taxable', header: 'Taxable', align: 'right', sortKey: 'taxableAmount', defaultHidden: outstanding, cell: (bill) => <Amount value={bill.taxableAmount} signed />, total: <Amount value={data?.totals.taxable} /> },
    { key: 'gst', header: 'GST', align: 'right', defaultHidden: outstanding, cell: (bill) => <Amount value={bill.gstAmount} signed />, total: <Amount value={data?.totals.gst} /> },
    { key: 'gstType', header: 'GST type', defaultHidden: true, cell: (bill) => (bill.gstType ? `${GST_TYPE_LABELS[bill.gstType]}${bill.gstPercent ? ` @ ${bill.gstPercent}%` : ''}` : bill.gstAmount ? 'Not split' : '—') },
    { key: 'cgst', header: 'CGST', align: 'right', defaultHidden: true, cell: (bill) => <Amount value={bill.cgstAmount ?? 0} muted signed /> },
    { key: 'sgst', header: 'SGST', align: 'right', defaultHidden: true, cell: (bill) => <Amount value={bill.sgstAmount ?? 0} muted signed /> },
    { key: 'igst', header: 'IGST', align: 'right', defaultHidden: true, cell: (bill) => <Amount value={bill.igstAmount ?? 0} muted signed /> },
    { key: 'gross', header: 'Gross', align: 'right', cell: (bill) => <Amount value={bill.grossAmount} signed />, total: <Amount value={data?.totals.gross} /> },
    { key: 'deduction', header: 'Deduction', align: 'right', defaultHidden: outstanding, cell: (bill) => <Amount value={bill.totalDeduction} muted />, total: <Amount value={data?.totals.deduction} /> },
    { key: 'net', header: 'Net', align: 'right', sortKey: 'netReceivable', cell: (bill) => <Amount value={bill.netReceivable} signed />, total: <Amount value={data?.totals.net} /> },
    { key: 'received', header: 'Received', align: 'right', sortKey: 'totalReceived', cell: (bill) => <Amount value={bill.totalReceived} muted />, total: <Amount value={data?.totals.received} /> },
    { key: 'outstanding', header: 'Outstanding', align: 'right', sortKey: 'outstandingAmount', mobile: 'aside', cell: (bill) => <Amount value={bill.outstandingAmount} className={bill.outstandingAmount > 0 ? 'font-semibold text-rose-700' : undefined} muted />, total: <Amount value={data?.totals.outstanding} /> },
    { key: 'ageing', header: 'Ageing', sortKey: 'ageing', cell: (bill) => <AgeingBadge label={bill.ageingBucket} days={bill.ageingBucket ? bill.ageingDays : undefined} buckets={buckets} /> },
    { key: 'due', header: 'Due', defaultHidden: !outstanding, cell: (bill) => <span className={bill.overdue ? 'whitespace-nowrap font-medium text-rose-700' : 'whitespace-nowrap'}>{dateText(bill.dueDate)}</span> },
    { key: 'lastFollowUp', header: 'Last follow-up', defaultHidden: !outstanding, cell: (bill) => dateText(bill.lastFollowUpDate) },
    { key: 'nextFollowUp', header: 'Next follow-up', defaultHidden: !outstanding, cell: (bill) => dateText(bill.nextFollowUpDate) },
    {
      key: 'commitment',
      header: 'Commitment',
      defaultHidden: !outstanding,
      cell: (bill) =>
        bill.nextCommitmentDate ? (
          <span className={bill.commitmentMissed ? 'whitespace-nowrap font-medium text-rose-700' : 'whitespace-nowrap'}>
            {dateText(bill.nextCommitmentDate)} · {formatINRCompact(bill.nextCommitmentAmount ?? 0)}
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'owner', header: 'Owner', defaultHidden: !outstanding, cell: (bill) => bill.collectionOwnerName || '—' },
    { key: 'payment', header: 'Payment', mobile: 'detail', cell: (bill) => <PaymentStatusBadge status={bill.paymentStatus} overridden={Boolean(bill.paymentStatusOverride)} /> },
    { key: 'workflow', header: 'Workflow', defaultHidden: outstanding, cell: (bill) => <WorkflowStatusBadge status={bill.workflowStatus} /> },
    {
      key: 'waiting',
      header: 'Waiting for',
      label: 'Waiting for',
      defaultHidden: !mine,
      cell: (bill) => {
        const waiting = waitingFor(bill, lookups.config.settings);
        if (!waiting) return <span className="text-muted-foreground">—</span>;
        const names = waiting.userIds.map((id) => lookups.users.find((user) => user.id === id)?.name ?? 'Unknown').join(', ');
        return <TruncatedText text={waiting.status === null ? `${names || 'Preparer'} · correction` : names ? `${names} · ${WORKFLOW_STATUS_LABELS[waiting.status]}` : `${WORKFLOW_STATUS_LABELS[waiting.status]} · ${STEP_PERMISSION[waiting.status]}`} className="max-w-[200px] text-xs" />;
      },
    },
    {
      key: 'actions',
      header: '',
      label: 'Actions',
      mobile: 'omit',
      align: 'right',
      cell: (bill) => (
        <div className="flex justify-end gap-1">
          {can('Collections', 'Add') && bill.outstandingAmount > 0 && !receiptBlockReason(bill, lookups.config.settings.certificationBeforeReceipt) ? (
            <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
              <Link href={`/bill-tracking/collections/new?bill=${bill.id}`}>Receive</Link>
            </Button>
          ) : null}
          {bill.outstandingAmount > 0 && certificationBlocked(bill, lookups.config.settings, actor) === null && receiptBlockReason(bill, lookups.config.settings.certificationBeforeReceipt) ? (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs text-amber-800" title="Payment waits for the client's certification">
              <Link href={`/bill-tracking/bills/${bill.id}/certify`}>Certify</Link>
            </Button>
          ) : null}
          {outstanding && can('Follow-ups', 'Add') ? (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
              <Link href={`/bill-tracking/bills/${bill.id}?tab=followup`}>Follow-up</Link>
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const loadAll = async () => (await btFetch<ListResponse>(`bills?${filters.apiQuery({ sort, dir, all: '1', open: outstanding ? '1' : undefined })}`)).rows;
  const exportColumns: ExportColumn<BillRow>[] = [
    { key: 'gstInvoiceNumber', label: 'GST Invoice', value: (bill) => bill.gstInvoiceNumber ?? 'NA' },
    { key: 'billSerialNumber', label: 'Bill No', value: (bill) => bill.billSerialNumber },
    { key: 'billDate', label: 'Bill Date', value: (bill) => bill.billDate },
    { key: 'project', label: 'Project', value: (bill) => bill.projectNameSnapshot },
    { key: 'client', label: 'Client', value: (bill) => bill.clientNameSnapshot },
    { key: 'dgm', label: 'DGM Office', value: (bill) => bill.dgmOffice },
    { key: 'category', label: 'Main Category', value: (bill) => categoryName(bill.billCategory, lookups.config.billCategories, bill.billCategoryName) },
    { key: 'type', label: 'Sub Category', value: (bill) => bill.billTypeName },
    { key: 'taxable', label: 'Taxable', value: (bill) => bill.taxableAmount, money: true },
    { key: 'gst', label: 'GST', value: (bill) => bill.gstAmount, money: true },
    { key: 'gstType', label: 'GST Type', value: (bill) => (bill.gstType ? GST_TYPE_LABELS[bill.gstType] : bill.gstAmount ? 'Not split' : '') },
    { key: 'gstRate', label: 'GST %', value: (bill) => bill.gstPercent },
    { key: 'cgst', label: 'CGST', value: (bill) => bill.cgstAmount ?? 0, money: true },
    { key: 'sgst', label: 'SGST', value: (bill) => bill.sgstAmount ?? 0, money: true },
    { key: 'igst', label: 'IGST', value: (bill) => bill.igstAmount ?? 0, money: true },
    { key: 'against', label: 'Against Invoice', value: (bill) => bill.againstBillRef },
    { key: 'gross', label: 'Gross', value: (bill) => bill.grossAmount, money: true },
    { key: 'deduction', label: 'Deduction', value: (bill) => bill.totalDeduction, money: true },
    { key: 'net', label: 'Net', value: (bill) => bill.netReceivable, money: true },
    { key: 'received', label: 'Received', value: (bill) => bill.totalReceived, money: true },
    { key: 'outstanding', label: 'Outstanding', value: (bill) => bill.outstandingAmount, money: true },
    { key: 'ageingDays', label: 'Ageing Days', value: (bill) => (bill.ageingBucket ? bill.ageingDays : '') },
    { key: 'ageingBucket', label: 'Ageing Bucket', value: (bill) => bill.ageingBucket },
    { key: 'dueDate', label: 'Due Date', value: (bill) => bill.dueDate },
    { key: 'lastFollowUp', label: 'Last Follow-up', value: (bill) => bill.lastFollowUpDate },
    { key: 'nextFollowUp', label: 'Next Follow-up', value: (bill) => bill.nextFollowUpDate },
    { key: 'commitment', label: 'Commitment Date', value: (bill) => bill.nextCommitmentDate },
    { key: 'owner', label: 'Owner', value: (bill) => bill.collectionOwnerName },
    { key: 'payment', label: 'Payment Status', value: (bill) => PAYMENT_STATUS_LABELS[bill.paymentStatus] },
    { key: 'workflow', label: 'Workflow', value: (bill) => WORKFLOW_STATUS_LABELS[bill.workflowStatus] },
  ];

  const exportLegacy = async () => {
    const rows = await loadAll();
    const lines = legacyExportRows(rows, lookups.config.deductionTypes);
    await exportWorkbook(`Bill Tracking ${filters.fy} (legacy format).xlsx`, [
      { name: 'Bill Tracking', columns: LEGACY_EXPORT_HEADERS.map((header, index) => ({ header, key: `c${index}`, width: Math.max(12, Math.min(header.length + 4, 40)) })), rows: lines.map((line) => Object.fromEntries(line.map((value, index) => [`c${index}`, value ?? '']))) },
    ]);
  };

  const meta = () => [
    { label: 'Financial year', value: filters.fy === 'all' ? 'All' : filters.fy },
    { label: 'As on', value: dateText(data?.asOf) },
    ...(filters.get('project') ? [{ label: 'Project', value: lookups.projects.find((project) => project.id === filters.get('project'))?.name ?? '' }] : []),
    ...(filters.get('q') ? [{ label: 'Search', value: filters.get('q') }] : []),
  ];

  if (view !== 'raised') return <CertificationRegister view={view} />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={outstanding ? Clock : ReceiptIndianRupee}
        title={outstanding ? 'Outstanding Bills' : 'Bill Register'}
        description={outstanding ? 'Every bill with money still to collect, oldest first — with follow-ups, commitments and owners.' : 'All client bills, credit notes and retention bills with their deductions, receipts and status.'}
        actions={
          can('Bills', 'Add') ? (
            <Button asChild size="sm" className="gap-1.5">
              <Link href="/bill-tracking/bills/new">
                <Plus className="h-4 w-4" /> New bill
              </Link>
            </Button>
          ) : null
        }
      />

      {outstanding ? null : <RegisterViewTabs view="raised" />}

      <BillFilterBar
        filters={filters}
        page={outstanding ? 'outstanding' : 'bills'}
        extra={
          lookups.workflowOnly ? null : (
            <Button type="button" size="sm" variant={mine ? 'default' : 'outline'} className="h-9 gap-1.5" aria-pressed={mine} onClick={() => filters.set({ mine: mine ? undefined : '1' })}>
              <UserCheck className="h-4 w-4" /> Waiting for me
            </Button>
          )
        }
        actions={
          <ExportMenu<BillRow>
            loadAll
            spec={async () => ({ title: outstanding ? 'Outstanding Bills' : 'Bill Register', fileName: `${outstanding ? 'outstanding' : 'bill-register'}-${filters.fy}`, columns: exportColumns, rows: await loadAll(), meta: meta(), generatedBy: lookups.user.name })}
            extra={[{ label: 'Legacy Bill Tracking format', onSelect: () => void exportLegacy().catch((caught) => toast({ title: 'Export failed', description: String(caught), variant: 'destructive' })) }]}
          />
        }
      />

      {outstanding ? <FilterChips filters={filters} chips={OUTSTANDING_CHIPS} /> : null}
      {data ? <TotalsStrip totals={data.totals} /> : null}
      <BtError message={error} onRetry={reload} />

      {loading && !data ? (
        <BtLoading />
      ) : (
        <BtTable
          rows={data?.rows ?? []}
          columns={columns}
          storageKey={outstanding ? 'outstanding' : 'bills'}
          sort={{ key: sort, dir }}
          onSort={(key, nextDir) => filters.set({ sort: key, dir: nextDir })}
          selectable={can('Bills', 'Edit')}
          selected={selected}
          onSelectedChange={setSelected}
          rowHref={(bill) => `/bill-tracking/bills/${bill.id}`}
          rowClassName={(bill) => (bill.isDeleted ? 'opacity-50' : undefined)}
          showTotals
          caption={
            selected.size > 0 && can('Bills', 'Edit') ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">{selected.size} selected</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="h-8">
                      Bulk action
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setBulk('assign_owner')}>
                      <UserCheck className="mr-2 h-4 w-4" /> Assign collection owner
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setBulk('set_target_week')}>
                      <CalendarClock className="mr-2 h-4 w-4" /> Set target week
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setBulk('set_next_follow_up')}>
                      <Clock className="mr-2 h-4 w-4" /> Set next follow-up date
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setBulk('set_expected_date')}>
                      <HandCoins className="mr-2 h-4 w-4" /> Set expected payment date
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <span className="hidden text-xs font-normal text-slate-500 md:inline">Amounts are never bulk-edited.</span>
              </div>
            ) : data ? (
              <span>
                {data.total.toLocaleString('en-IN')} {outstanding ? 'outstanding ' : ''}bill{data.total === 1 ? '' : 's'}
              </span>
            ) : null
          }
          footer={data && data.total > 0 ? <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(next) => filters.set({ page: String(next) }, false)} onPageSize={(size) => filters.set({ pageSize: String(size) })} /> : undefined}
          empty={
            <BtEmpty
              title={outstanding ? 'No outstanding bills for the selected filters.' : 'No bills found for the selected filters.'}
              description={filters.activeCount ? 'Clear or change the filters to see more.' : can('Import', 'Import') ? 'Add a bill, or import the finance team’s Bill Tracking workbook.' : undefined}
              action={
                !filters.activeCount && can('Import', 'Import') ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/bill-tracking/import">Import workbook</Link>
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <BulkDialog
        action={bulk}
        billIds={[...selected]}
        onClose={() => setBulk(null)}
        onDone={(result) => {
          setBulk(null);
          setSelected(new Set());
          reload();
          toast({ title: 'Bulk update done', description: `${result.updated} updated${result.skipped ? `, ${result.skipped} skipped (no access)` : ''}.` });
        }}
      />
    </div>
  );
}

function BulkDialog({ action, billIds, onClose, onDone }: { action: null | string; billIds: string[]; onClose: () => void; onDone: (result: { updated: number; skipped: number }) => void }) {
  const lookups = useLookups();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titles: Record<string, string> = {
    assign_owner: 'Assign collection owner',
    set_target_week: 'Set target week',
    set_next_follow_up: 'Set next follow-up date',
    set_expected_date: 'Set expected payment date',
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { billIds, action, ownerId: action === 'assign_owner' ? value || undefined : undefined, targetWeek: action === 'set_target_week' ? value || undefined : undefined, date: action === 'set_next_follow_up' || action === 'set_expected_date' ? value || undefined : undefined };
      onDone(await btFetch<{ updated: number; skipped: number }>('bills/bulk', { body }));
      setValue('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={Boolean(action)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={PM_DIALOG.content}>
        <DialogHeader className={PM_DIALOG.header}>
          <DialogTitle>{action ? titles[action] : ''}</DialogTitle>
          <DialogDescription>Applies to {billIds.length} selected bill(s). Leave blank to clear.</DialogDescription>
        </DialogHeader>
        <div className={PM_DIALOG.body}>
          {action === 'assign_owner' ? (
            <div className="space-y-1">
              <Label>Collection owner</Label>
              <Select value={value || 'none'} onValueChange={(next) => setValue(next === 'none' ? '' : next)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">Unassigned</SelectItem>
                  {lookups.users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : action === 'set_target_week' ? (
            <div className="space-y-1">
              <Label>Target week (ISO)</Label>
              <Input placeholder="2026-W41" value={value} onChange={(event) => setValue(event.target.value)} />
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={value} onChange={(event) => setValue(event.target.value)} />
            </div>
          )}
          <BtError message={error} />
        </div>
        <DialogFooter className={PM_DIALOG.footer}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Saving…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
