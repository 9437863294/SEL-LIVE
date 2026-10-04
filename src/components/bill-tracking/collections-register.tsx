'use client';

/**
 * Collections (`/bill-tracking/collections`): every bank receipt, its allocation across bills and
 * its verification state. Draft receipts can be verified or cancelled here in a click.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { PM_DIALOG } from '@/components/project-management/pm-shell';
import { useToast } from '@/hooks/use-toast';
import { PAYMENT_MODES, type BillCollection } from '@/lib/bill-tracking/types';

import { btFetch, useBt, useBtQuery, useLookups } from './bt-client';
import { BillFilterBar, useUrlFilters } from './bt-filters';
import { BtTable, Pager, type BtColumn } from './bt-table';
import { Amount, BtEmpty, BtError, BtLoading, ExportMenu, dateText } from './bt-ui';

interface Response {
  rows: BillCollection[];
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  totals: { count: number; amount: number; verified: number; draft: number; unallocated: number };
}

export default function CollectionsRegister() {
  const lookups = useLookups();
  const { can } = useBt();
  const { toast } = useToast();
  const filters = useUrlFilters();
  const page = Number(filters.get('page')) || 1;
  const { data, loading, error, reload } = useBtQuery<Response>(`collections?${filters.apiQuery({ page })}`);
  const [cancel, setCancel] = useState<BillCollection | null>(null);
  const [reason, setReason] = useState('');

  const act = async (collection: BillCollection, action: 'verify' | 'cancel', why?: string) => {
    try {
      await btFetch(`collections/${collection.id}`, { body: { action, reason: why } });
      toast({ title: action === 'verify' ? 'Receipt verified' : 'Receipt cancelled' });
      reload();
    } catch (caught) {
      toast({ title: 'Failed', description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' });
    }
  };

  const columns: BtColumn<BillCollection>[] = [
    { key: 'date', header: 'Receipt date', mobile: 'title', pinned: true, sortValue: (row) => row.receiptDate, cell: (row) => <span className="whitespace-nowrap font-medium">{dateText(row.receiptDate)}</span> },
    { key: 'amount', header: 'Amount', align: 'right', mobile: 'aside', sortValue: (row) => row.amount, cell: (row) => <Amount value={row.amount} className="font-semibold" />, total: <Amount value={data?.totals.amount} /> },
    {
      key: 'bills',
      header: 'Allocated to',
      className: 'max-w-[320px]',
      cell: (row) => (
        <div className="space-y-0.5 text-xs">
          {row.allocations.slice(0, 3).map((allocation) => (
            <div key={allocation.billId} className="truncate">
              <Link className="text-emerald-700 hover:underline" href={`/bill-tracking/bills/${allocation.billId}`}>
                {allocation.gstInvoiceNumber || allocation.billSerialNumber}
              </Link>{' '}
              · {allocation.projectNameSnapshot} · <Amount value={allocation.amount} />
            </div>
          ))}
          {row.allocations.length > 3 ? <div className="text-muted-foreground">+{row.allocations.length - 3} more</div> : null}
          {row.unallocatedAmount ? (
            <div className="font-medium text-amber-700">
              Unallocated <Amount value={row.unallocatedAmount} />
            </div>
          ) : null}
        </div>
      ),
    },
    { key: 'mode', header: 'Mode', cell: (row) => row.paymentMode ?? '—' },
    { key: 'utr', header: 'UTR / reference', cell: (row) => row.utrNumber || row.bankReference || '—' },
    { key: 'client', header: 'Client', defaultHidden: true, cell: (row) => row.clientNameSnapshot ?? '—' },
    { key: 'source', header: 'Source', defaultHidden: true, cell: (row) => (row.source === 'excel_import' ? 'Workbook import' : 'Manual') },
    { key: 'by', header: 'Recorded by', defaultHidden: true, cell: (row) => row.createdByName ?? row.createdBy },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusBadge tone={row.status === 'verified' ? 'success' : row.status === 'draft' ? 'warning' : 'neutral'}>{row.status === 'draft' ? 'Awaiting verification' : row.status === 'verified' ? 'Verified' : 'Cancelled'}</StatusBadge>,
    },
    {
      key: 'actions',
      header: '',
      label: 'Actions',
      mobile: 'omit',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          {row.status === 'draft' && can('Collections', 'Verify') ? (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void act(row, 'verify')}>
              Verify
            </Button>
          ) : null}
          {row.status !== 'cancelled' && can('Collections', 'Cancel') ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-rose-700" onClick={() => setCancel(row)}>
              Cancel
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Wallet}
        title="Collections"
        description="Bank receipts and how each was allocated across bills. Only verified receipts count as collected."
        actions={
          can('Collections', 'Add') ? (
            <Button asChild size="sm" className="gap-1.5">
              <Link href="/bill-tracking/collections/new">
                <Plus className="h-4 w-4" /> Record receipt
              </Link>
            </Button>
          ) : null
        }
      />
      <BillFilterBar
        filters={filters}
        page="collections"
        hide={['payment']}
        extra={
          <>
            <div className="min-w-0 space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={filters.get('status') || 'any'} onValueChange={(value) => filters.set({ status: value })}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">All</SelectItem>
                  <SelectItem value="draft">Awaiting verification</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="text-xs text-muted-foreground">Mode</Label>
              <Select value={filters.get('mode') || 'any'} onValueChange={(value) => filters.set({ mode: value })}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">All</SelectItem>
                  {PAYMENT_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        }
        actions={
          <ExportMenu<BillCollection>
            loadAll
            spec={async () => {
              const all = await btFetch<Response>(`collections?${filters.apiQuery({ all: '1' })}`);
              return {
                title: 'Collections',
                fileName: `collections-${filters.fy}`,
                generatedBy: lookups.user.name,
                meta: [{ label: 'Financial year', value: filters.fy }],
                rows: all.rows,
                columns: [
                  { key: 'date', label: 'Receipt Date', value: (row) => row.receiptDate },
                  { key: 'amount', label: 'Amount', value: (row) => row.amount, money: true },
                  { key: 'bills', label: 'Bills', value: (row) => row.allocations.map((a) => `${a.gstInvoiceNumber || a.billSerialNumber}: ${a.amount}`).join('; ') },
                  { key: 'projects', label: 'Projects', value: (row) => [...new Set(row.allocations.map((a) => a.projectNameSnapshot))].join('; ') },
                  { key: 'unallocated', label: 'Unallocated', value: (row) => row.unallocatedAmount, money: true },
                  { key: 'mode', label: 'Mode', value: (row) => row.paymentMode },
                  { key: 'utr', label: 'UTR', value: (row) => row.utrNumber },
                  { key: 'ref', label: 'Bank Reference', value: (row) => row.bankReference },
                  { key: 'status', label: 'Status', value: (row) => row.status },
                ],
                totals: { amount: all.totals.amount },
              };
            }}
          />
        }
      />
      {data ? (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/60 bg-white/80 p-3 text-sm shadow-sm sm:grid-cols-4">
          <div>
            <p className="text-[11px] uppercase text-muted-foreground">Receipts</p>
            <p className="font-semibold">{data.totals.count}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-muted-foreground">Verified</p>
            <p className="font-semibold text-emerald-700">
              <Amount value={data.totals.verified} compact />
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-muted-foreground">Awaiting verification</p>
            <p className="font-semibold text-amber-700">
              <Amount value={data.totals.draft} compact />
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-muted-foreground">Unallocated</p>
            <p className="font-semibold">
              <Amount value={data.totals.unallocated} compact />
            </p>
          </div>
        </div>
      ) : null}
      <BtError message={error} onRetry={reload} />
      {loading && !data ? (
        <BtLoading />
      ) : (
        <BtTable rows={data?.rows ?? []} columns={columns} storageKey="collections" showTotals rowClassName={(row) => (row.status === 'cancelled' ? 'opacity-50' : filters.get('highlight') === row.id ? 'bg-emerald-50' : undefined)} empty={<BtEmpty title="No collection records found." description="Record a receipt from a bill, or here for a payment covering several bills." />} />
      )}
      {data ? <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(next) => filters.set({ page: String(next) }, false)} /> : null}

      <Dialog open={Boolean(cancel)} onOpenChange={(open) => !open && setCancel(null)}>
        <DialogContent className={PM_DIALOG.content}>
          <DialogHeader className={PM_DIALOG.header}>
            <DialogTitle>Cancel receipt</DialogTitle>
            <DialogDescription>The receipt is cancelled on every bill it was allocated to and the outstanding goes back up. It stays in the audit trail.</DialogDescription>
          </DialogHeader>
          <div className={PM_DIALOG.body}>
            <Label>Reason *</Label>
            <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <DialogFooter className={PM_DIALOG.footer}>
            <Button variant="outline" onClick={() => setCancel(null)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3}
              onClick={() => {
                if (cancel) void act(cancel, 'cancel', reason.trim());
                setCancel(null);
                setReason('');
              }}
            >
              Cancel receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
