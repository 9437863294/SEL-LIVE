'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, Search, Wallet, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import {
  ADVANCE_PAYMENT_MODES,
  ADVANCE_REFERENCE_REQUIRED_MODES,
  ADVANCE_STATUSES,
  TT_COLLECTIONS,
  advanceAgeingBucket,
  dayDifference,
  parseTravelDateTime,
  roundMoney,
  summarizeAdvanceAgeing,
  type AdvancePaymentMode,
  type TravelAdvance,
} from '@/lib/tour-travel';
import { TravelControlError, approveTravelAdvance, recordAdvancePayment, rejectTravelAdvance } from '@/lib/tour-travel-service';
import { TT_PERMISSION_MODULE } from './module-layout-shell';
import { useTravelActor, useTravelCollection, useTravelConfig } from './use-travel-config';
import { Money, TravelDataList, TravelEmptyState, TravelFilterCard, TravelLoader, TravelPageHeader, TravelSection, TravelStatusBadge, travelDialog } from './travel-ui';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Travel advance register (spec sections 11–12, 33).
 *
 * Ageing is shown above the table rather than buried in a report, because an unsettled advance is
 * the single most common way travel money goes missing — the number that matters is how long
 * employees have been holding cash, not how many advances exist. Rows past the settlement deadline
 * are tinted so they can't be scrolled past.
 */
export default function AdvancesRegister() {
  const { toast } = useToast();
  const { can } = useAuthorization();
  const actor = useTravelActor();
  const { settings } = useTravelConfig();
  const { records, loading } = useTravelCollection<TravelAdvance>(TT_COLLECTIONS.advances);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);

  const [approving, setApproving] = useState<TravelAdvance | null>(null);
  const [approvedAmount, setApprovedAmount] = useState<number | ''>('');
  const [approvalRemarks, setApprovalRemarks] = useState('');

  const [rejecting, setRejecting] = useState<TravelAdvance | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [paying, setPaying] = useState<TravelAdvance | null>(null);
  const [payAmount, setPayAmount] = useState<number | ''>('');
  const [payDate, setPayDate] = useState(todayIso());
  const [payMode, setPayMode] = useState<AdvancePaymentMode>('NEFT');
  const [payReference, setPayReference] = useState('');
  const [payCheque, setPayCheque] = useState('');
  const [payBank, setPayBank] = useState('');
  const [payVoucher, setPayVoucher] = useState('');

  const canApprove = can('Approve', `${TT_PERMISSION_MODULE}.Advances`);
  const canPay = can('Record Payment', `${TT_PERMISSION_MODULE}.Advances`);

  const deadline = settings.general.advanceSettlementDeadlineDays;

  // `id` is carried on the decorated row so it can be keyed directly by the shared list.
  const decorated = useMemo(
    () =>
      records.map(advance => {
        const outstanding = Math.max(0, roundMoney(Number(advance.paidAmount || 0) - Number(advance.settledAmount || 0)));
        const paidOn = parseTravelDateTime(advance.paidOn);
        const ageDays = paidOn ? dayDifference(paidOn, new Date()) : 0;
        return { id: advance.id, advance, outstanding, ageDays, overdue: outstanding > 0 && ageDays > deadline };
      }),
    [records, deadline],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return decorated
      .filter(row => {
        if (status === 'outstanding' && row.outstanding <= 0) return false;
        if (status === 'overdue' && !row.overdue) return false;
        if (!['all', 'outstanding', 'overdue'].includes(status) && row.advance.status !== status) return false;
        if (!needle) return true;
        return [row.advance.referenceNumber, row.advance.travelRequestNumber, row.advance.employeeName, row.advance.projectName]
          .some(value => (value || '').toLowerCase().includes(needle));
      })
      .sort((a, b) => b.ageDays - a.ageDays || (b.advance.referenceNumber || '').localeCompare(a.advance.referenceNumber || ''));
  }, [decorated, search, status]);

  const ageing = useMemo(
    () => summarizeAdvanceAgeing(records.filter(advance => !['REJECTED', 'CANCELLED'].includes(advance.status))),
    [records],
  );
  const totalOutstanding = useMemo(
    () => roundMoney(Object.values(ageing).reduce((sum, bucket) => sum + bucket.amount, 0)),
    [ageing],
  );

  const run = async (key: string, action: () => Promise<void>, successTitle: string) => {
    if (!actor) {
      toast({ variant: 'destructive', title: 'Not signed in' });
      return;
    }
    setBusy(key);
    try {
      await action();
      toast({ title: successTitle });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Action failed',
        description: error instanceof TravelControlError ? error.message : 'Something went wrong. Please try again.',
      });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <TravelLoader label="Loading advances…" />;

  return (
    <div className="space-y-3">
      <TravelPageHeader
        title="Travel Advances"
        description={`Advance requests, approvals and disbursement. Settlement deadline: ${deadline} days after payment.`}
      />

      <TravelSection title="Advance Ageing" description={`Total unsettled: ${totalOutstanding.toLocaleString('en-IN')}`}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(['0-7', '8-15', '16-30', '31-60', '>60'] as const).map(bucket => {
            const entry = ageing[bucket];
            const alarming = bucket === '31-60' || bucket === '>60';
            return (
              <button
                key={bucket}
                type="button"
                onClick={() => setStatus(alarming ? 'overdue' : 'outstanding')}
                className={
                  alarming && entry.amount > 0
                    ? 'rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-left transition-colors hover:bg-rose-100'
                    : 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:bg-slate-50'
                }
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{bucket} days</p>
                <p className="text-sm font-semibold tabular-nums text-slate-800"><Money value={entry.amount} /></p>
                <p className="text-[11px] text-muted-foreground">{entry.count} advance(s)</p>
              </button>
            );
          })}
        </div>
      </TravelSection>

      <TravelFilterCard summary={`${filtered.length} advance(s)`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" value={search} onChange={event => setSearch(event.target.value)} placeholder="Advance, tour, employee" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="outstanding">Outstanding</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                {ADVANCE_STATUSES.map(value => <SelectItem key={value} value={value}>{value.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </TravelFilterCard>

      <TravelDataList
        rows={filtered}
        rowClassName={row => (row.overdue ? 'bg-rose-50/50 border-rose-200' : undefined)}
        empty={<TravelEmptyState title="No advances match" description="Advance requests raised against approved tours appear here." icon={Wallet} />}
        columns={[
          {
            header: 'Advance',
            mobile: 'title',
            cell: ({ advance }) => (
              <>
                <span className="font-medium">{advance.referenceNumber}</span>
                {advance.outstandingOverride && (
                  <Badge variant="outline" className="ml-1 border-amber-300 bg-amber-50 text-[10px] text-amber-800">Override</Badge>
                )}
              </>
            ),
          },
          { header: 'Employee', mobile: 'title', cell: ({ advance }) => advance.employeeName },
          { header: 'Status', mobile: 'aside', cell: ({ advance }) => <TravelStatusBadge status={advance.status} /> },
          {
            header: 'Tour',
            className: 'hidden lg:table-cell',
            cell: ({ advance }) => (
              <Link href={`/tour-travel/requests/${advance.travelRequestId}`} className="text-sky-700 hover:underline">
                {advance.travelRequestNumber}
              </Link>
            ),
          },
          { header: 'Requested', align: 'right', cell: ({ advance }) => <Money value={advance.requestedAmount} /> },
          { header: 'Approved', align: 'right', className: 'hidden sm:table-cell', cell: ({ advance }) => <Money value={advance.approvedAmount} /> },
          { header: 'Paid', align: 'right', cell: ({ advance }) => <Money value={advance.paidAmount} /> },
          {
            header: 'Outstanding',
            align: 'right',
            cell: ({ outstanding }) => (
              <span className={outstanding > 0 ? 'font-medium text-rose-600' : ''}><Money value={outstanding} /></span>
            ),
          },
          {
            header: 'Age',
            className: 'hidden md:table-cell',
            cell: ({ advance, ageDays, overdue }) =>
              advance.paidOn ? (
                <span className={overdue ? 'font-medium text-rose-600' : ''}>{ageDays}d · {advanceAgeingBucket(ageDays)}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            header: 'Action',
            mobile: 'footer',
            cell: ({ advance }) => (
              <div className="flex flex-1 flex-wrap gap-1.5">
                {canApprove && advance.status === 'REQUESTED' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs text-emerald-700"
                      onClick={() => { setApproving(advance); setApprovedAmount(advance.requestedAmount); setApprovalRemarks(''); }}
                    >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-rose-600" onClick={() => { setRejecting(advance); setRejectReason(''); }}>
                      <XCircle className="mr-1 h-3.5 w-3.5" /> <span className="sm:hidden">Reject</span>
                    </Button>
                  </>
                )}
                {canPay && ['APPROVED', 'PAYMENT_PENDING'].includes(advance.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setPaying(advance);
                      setPayAmount(roundMoney(advance.approvedAmount - (advance.paidAmount || 0)));
                      setPayDate(todayIso());
                      setPayReference('');
                      setPayCheque('');
                      setPayBank('');
                      setPayVoucher('');
                    }}
                  >
                    Record payment
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* ── Approve ──────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={!!approving} onOpenChange={open => !open && setApproving(null)}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>Approve advance</DialogTitle>
            <DialogDescription>
              {approving?.referenceNumber} · {approving?.employeeName} · requested {approving?.requestedAmount}
            </DialogDescription>
          </DialogHeader>
          {approving?.outstandingOverride && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-semibold">Raised against an outstanding advance</p>
              <p>
                {approving.outstandingOverride.outstandingAmount} outstanding, oldest {approving.outstandingOverride.oldestAgeDays} days.
              </p>
              <p className="mt-1 italic">Override reason: {approving.outstandingOverride.reason}</p>
            </div>
          )}
          <div className={travelDialog.body}>
            <div>
              <Label className="text-xs">Approved amount</Label>
              <Input
                type="number" inputMode="decimal"
                min={0}
                max={approving?.requestedAmount}
                value={approvedAmount}
                onChange={event => setApprovedAmount(event.target.value === '' ? '' : Number(event.target.value))}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Cannot exceed the requested amount.</p>
            </div>
            <div>
              <Label className="text-xs">Remarks</Label>
              <Textarea value={approvalRemarks} onChange={event => setApprovalRemarks(event.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter className={travelDialog.footer}>
            <Button variant="outline" onClick={() => setApproving(null)}>Cancel</Button>
            <Button
              disabled={busy === 'approve'}
              onClick={() =>
                run('approve', async () => {
                  await approveTravelAdvance(approving!.id, actor!, { approvedAmount: Number(approvedAmount || 0), remarks: approvalRemarks });
                  setApproving(null);
                }, 'Advance approved')
              }
            >
              {busy === 'approve' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject ───────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={!!rejecting} onOpenChange={open => !open && setRejecting(null)}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>Reject advance</DialogTitle>
            <DialogDescription>{rejecting?.referenceNumber} · {rejecting?.employeeName}</DialogDescription>
          </DialogHeader>
          <div className={travelDialog.body}>
            <Label className="text-xs">Reason <span className="text-rose-600">*</span></Label>
            <Textarea value={rejectReason} onChange={event => setRejectReason(event.target.value)} rows={3} />
          </div>
          <DialogFooter className={travelDialog.footer}>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy === 'reject'}
              onClick={() =>
                run('reject', async () => {
                  await rejectTravelAdvance(rejecting!.id, actor!, rejectReason);
                  setRejecting(null);
                }, 'Advance rejected')
              }
            >
              {busy === 'reject' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Record payment ───────────────────────────────────────────────────────────────────── */}
      <Dialog open={!!paying} onOpenChange={open => !open && setPaying(null)}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>Record advance payment</DialogTitle>
            <DialogDescription>
              {paying?.referenceNumber} · approved {paying?.approvedAmount} · already paid {paying?.paidAmount || 0}
            </DialogDescription>
          </DialogHeader>
          <div className={travelDialog.bodyGrid}>
            <div>
              <Label className="text-xs">Amount</Label>
              <Input type="number" inputMode="decimal" min={0} value={payAmount} onChange={event => setPayAmount(event.target.value === '' ? '' : Number(event.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Payment date</Label>
              <Input type="date" value={payDate} onChange={event => setPayDate(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <Select value={payMode} onValueChange={value => setPayMode(value as AdvancePaymentMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ADVANCE_PAYMENT_MODES.map(mode => <SelectItem key={mode} value={mode}>{mode}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Bank account</Label>
              <Input value={payBank} onChange={event => setPayBank(event.target.value)} />
            </div>
            {ADVANCE_REFERENCE_REQUIRED_MODES.includes(payMode) && (
              <div className="col-span-2">
                <Label className="text-xs">UTR / transaction reference <span className="text-rose-600">*</span></Label>
                <Input value={payReference} onChange={event => setPayReference(event.target.value)} />
              </div>
            )}
            {payMode === 'Cheque' && (
              <div className="col-span-2">
                <Label className="text-xs">Cheque number <span className="text-rose-600">*</span></Label>
                <Input value={payCheque} onChange={event => setPayCheque(event.target.value)} />
              </div>
            )}
            <div className="col-span-2">
              <Label className="text-xs">Voucher number</Label>
              <Input value={payVoucher} onChange={event => setPayVoucher(event.target.value)} />
            </div>
          </div>
          <DialogFooter className={travelDialog.footer}>
            <Button variant="outline" onClick={() => setPaying(null)}>Cancel</Button>
            <Button
              disabled={busy === 'pay'}
              onClick={() =>
                run('pay', async () => {
                  await recordAdvancePayment(paying!.id, actor!, {
                    amount: Number(payAmount || 0),
                    paymentDate: payDate,
                    mode: payMode,
                    bankAccount: payBank,
                    transactionReference: payReference,
                    chequeNumber: payCheque,
                    voucherNumber: payVoucher,
                  });
                  setPaying(null);
                }, 'Payment recorded')
              }
            >
              {busy === 'pay' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
