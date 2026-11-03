'use client';

/**
 * The RA bill register's shared pieces: the status badge, the period line and the bill's view
 * dialog (facts, line detail and whatever actions the page passes in).
 */

import type { ReactNode } from 'react';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { RaBill } from '@/lib/billing-recon/types';
import { formatAmount, formatIsoDate, formatQty, toIsoDate } from '@/lib/billing-recon/lines';

const TONE: Record<string, StatusTone> = {
  Draft: 'neutral',
  Submitted: 'info',
  Cancelled: 'danger',
};

/** Draft (neutral), Submitted (info), Cancelled (danger). A div — never inside a <p>. */
export function RaBillStatusBadge({ status, className }: { status: string | undefined; className?: string }) {
  return (
    <StatusBadge status={status ?? 'Draft'} tone={TONE[status ?? ''] ?? 'neutral'} className={className}>
      {status || 'Draft'}
    </StatusBadge>
  );
}

/** "01 Oct 2026 – 31 Oct 2026", "from 01 Oct 2026", or '—'. */
export function periodText(bill: Pick<RaBill, 'periodFrom' | 'periodTo'>): string {
  const from = bill.periodFrom ? formatIsoDate(bill.periodFrom, '') : '';
  const to = bill.periodTo ? formatIsoDate(bill.periodTo, '') : '';
  if (from && to) return `${from} – ${to}`;
  if (from) return `from ${from}`;
  if (to) return `up to ${to}`;
  return '—';
}

/** A Firestore Timestamp or ISO text as "03 Nov 2026". */
export function stampText(value: unknown): string {
  const iso = toIsoDate(value);
  return iso ? formatIsoDate(iso) : '';
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-sm text-foreground">{children}</div>
    </div>
  );
}

/** The bill's lines as a table: what was certified, billed before and billed on this bill. */
export function RaBillLinesTable({ bill }: { bill: RaBill }) {
  const items = Array.isArray(bill.items) ? bill.items : [];
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border">
      <Table className="min-w-[56rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Entry</TableHead>
            <TableHead>BOQ SL No</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Certified</TableHead>
            <TableHead className="text-right">Prev. billed</TableHead>
            <TableHead className="text-right">This bill</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableEmpty colSpan={10}>This bill has no lines.</TableEmpty>
          ) : (
            items.map((item, index) => (
              <TableRow key={`${item.source}-${item.entryId}-${item.itemIndex}-${index}`}>
                <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="font-medium">{item.entryNo || '—'}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">{item.source}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{item.boqSlNo || '—'}</TableCell>
                <TableCell className="min-w-[14rem] max-w-md">
                  <div className="line-clamp-2" title={item.description}>
                    {item.description || '—'}
                  </div>
                  {(item.scope1 || item.scope2) && (
                    <div className="text-xs text-muted-foreground">{[item.scope1, item.scope2].filter(Boolean).join(' / ')}</div>
                  )}
                </TableCell>
                <TableCell>{item.unit || '—'}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatAmount(item.rate)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(item.certifiedQty)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(item.previouslyBilledQty)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatQty(item.billedQty)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatAmount(item.amount)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        {items.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={9} className="text-right">
                Total
              </TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatAmount(bill.totalAmount)}</TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}

/** One bill: its facts, its lines, and the page's actions for it in the footer. */
export function RaBillViewDialog({
  bill,
  open,
  onOpenChange,
  actions,
}: {
  bill: RaBill | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: ReactNode;
}) {
  return (
    <Dialog open={open && Boolean(bill)} onOpenChange={onOpenChange}>
      <DialogContent size="2xl" className="gap-4">
        {bill && (
          <>
            <DialogHeader className="shrink-0 pr-6">
              <DialogTitle>RA bill {bill.billNo}</DialogTitle>
              <DialogDescription>
                RA {bill.raSequence || '—'} · {formatIsoDate(bill.billDate)} · {(bill.items ?? []).length} line
                {(bill.items ?? []).length === 1 ? '' : 's'}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact label="Status">
                  <RaBillStatusBadge status={bill.status} />
                </Fact>
                <Fact label="Amount">{formatAmount(bill.totalAmount)}</Fact>
                <Fact label="Period">{periodText(bill)}</Fact>
                <Fact label="Bill Tracking ref">{bill.billTrackingRef || 'Not linked yet'}</Fact>
                <Fact label="Created">
                  {[bill.createdByName, stampText(bill.createdAt)].filter(Boolean).join(' · ') || '—'}
                </Fact>
                {bill.submittedAt && (
                  <Fact label="Submitted">{[bill.submittedByName, stampText(bill.submittedAt)].filter(Boolean).join(' · ')}</Fact>
                )}
                {bill.cancelledAt && (
                  <Fact label="Cancelled">{[bill.cancelledByName, stampText(bill.cancelledAt)].filter(Boolean).join(' · ')}</Fact>
                )}
                {bill.cancelReason && <Fact label="Cancel reason">{bill.cancelReason}</Fact>}
                {bill.remarks && <Fact label="Remarks">{bill.remarks}</Fact>}
              </div>
              <RaBillLinesTable bill={bill} />
            </DialogBody>
            {actions ? <DialogFooter className="gap-2 sm:gap-0">{actions}</DialogFooter> : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
