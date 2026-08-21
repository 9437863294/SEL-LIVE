'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Coins, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import {
  ADVANCE_PAYMENT_MODES,
  ADVANCE_REFERENCE_REQUIRED_MODES,
  TT_COLLECTIONS,
  roundMoney,
  type AdvancePaymentMode,
  type TravelPayment,
} from '@/lib/tour-travel';
import { TravelControlError, recordReimbursementPayment } from '@/lib/tour-travel-service';
import { TT_PERMISSION_MODULE } from './module-layout-shell';
import { useTravelActor, useTravelCollection } from './use-travel-config';
import { Money, TravelDataList, TravelEmptyState, TravelFilterCard, TravelKpiCard, TravelLoader, TravelPageHeader, TravelStatusBadge, travelDialog } from './travel-ui';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Reimbursement payment register (spec section 24).
 *
 * Recording a payment here is also what settles the employee's travel advance — see
 * `recordReimbursementPayment`. That coupling is deliberate: the advance is only genuinely absorbed
 * once the balancing money has left the bank, so there is no separate "settle advance" button that
 * could be pressed early.
 */
export default function PaymentsRegister() {
  const { toast } = useToast();
  const { can } = useAuthorization();
  const actor = useTravelActor();
  const { records, loading } = useTravelCollection<TravelPayment>(TT_COLLECTIONS.payments);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('PENDING');
  const [busy, setBusy] = useState(false);

  const [paying, setPaying] = useState<TravelPayment | null>(null);
  const [payDate, setPayDate] = useState(todayIso());
  const [payMode, setPayMode] = useState<AdvancePaymentMode>('NEFT');
  const [payReference, setPayReference] = useState('');
  const [payBankAccount, setPayBankAccount] = useState('');
  const [payBankName, setPayBankName] = useState('');
  const [payVoucher, setPayVoucher] = useState('');

  const canPay = can('Record Payment', `${TT_PERMISSION_MODULE}.Payments`);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return records
      .filter(payment => {
        if (status !== 'all' && payment.status !== status) return false;
        if (!needle) return true;
        return [payment.referenceNumber, payment.employeeName, payment.transactionReference]
          .some(value => (value || '').toLowerCase().includes(needle));
      })
      .sort((a, b) => (b.referenceNumber || '').localeCompare(a.referenceNumber || ''));
  }, [records, search, status]);

  const totals = useMemo(
    () => ({
      pending: roundMoney(records.filter(p => p.status === 'PENDING').reduce((sum, p) => sum + Number(p.amount || 0), 0)),
      paid: roundMoney(records.filter(p => p.status === 'PAID').reduce((sum, p) => sum + Number(p.amount || 0), 0)),
      pendingCount: records.filter(p => p.status === 'PENDING').length,
    }),
    [records],
  );

  if (loading) return <TravelLoader label="Loading reimbursements…" />;

  return (
    <div className="space-y-3">
      <TravelPageHeader title="Reimbursements" description="Approved settlements awaiting payment to employees." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <TravelKpiCard label="Pending Payment" value={<Money value={totals.pending} />} hint={`${totals.pendingCount} payment(s)`} icon={Coins} tone="orange" />
        <TravelKpiCard label="Paid" value={<Money value={totals.paid} />} icon={Coins} tone="emerald" />
        <TravelKpiCard label="Total Records" value={records.length} tone="slate" />
      </div>

      <TravelFilterCard summary={`${filtered.length} payment(s)`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" value={search} onChange={event => setSearch(event.target.value)} placeholder="Reference, employee, UTR" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </TravelFilterCard>

      <TravelDataList
        rows={filtered}
        empty={<TravelEmptyState title="No reimbursements" description="Approved claims with an amount payable to the employee appear here." icon={Coins} />}
        columns={[
          { header: 'Reference', mobile: 'title', cell: payment => <span className="font-medium">{payment.referenceNumber}</span> },
          { header: 'Employee', mobile: 'title', cell: payment => payment.employeeName },
          { header: 'Status', mobile: 'aside', cell: payment => <TravelStatusBadge status={payment.status} /> },
          {
            header: 'Claim',
            className: 'hidden md:table-cell',
            mobile: 'omit',
            cell: payment => (
              <Link href={`/tour-travel/claims/${payment.claimId}`} className="text-sky-700 hover:underline">
                View claim
              </Link>
            ),
          },
          { header: 'Amount', align: 'right', cell: payment => <span className="font-medium"><Money value={payment.amount} /></span> },
          { header: 'Paid on', cell: payment => <span className="tabular-nums">{payment.paymentDate || '—'}</span> },
          {
            header: 'Reference no.',
            className: 'hidden lg:table-cell',
            cell: payment => <span className="text-xs text-muted-foreground">{payment.transactionReference || '—'}</span>,
          },
          {
            header: 'Action',
            mobile: 'footer',
            cell: payment => (
              <div className="flex flex-1 gap-2">
                {canPay && payment.status === 'PENDING' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setPaying(payment);
                      setPayDate(todayIso());
                      setPayReference('');
                      setPayBankAccount('');
                      setPayBankName('');
                      setPayVoucher('');
                    }}
                  >
                    Pay
                  </Button>
                )}
                <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs sm:hidden">
                  <Link href={`/tour-travel/claims/${payment.claimId}`}>View claim</Link>
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Dialog open={!!paying} onOpenChange={open => !open && setPaying(null)}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>Record reimbursement payment</DialogTitle>
            <DialogDescription>
              {paying?.referenceNumber} · {paying?.employeeName} · {paying?.amount}
            </DialogDescription>
          </DialogHeader>
          <p className="rounded border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-800">
            Recording this payment also settles the employee&apos;s travel advance for this tour.
          </p>
          <div className={travelDialog.bodyGrid}>
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
              <Label className="text-xs">Employee bank account</Label>
              <Input value={payBankAccount} onChange={event => setPayBankAccount(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Bank</Label>
              <Input value={payBankName} onChange={event => setPayBankName(event.target.value)} />
            </div>
            {ADVANCE_REFERENCE_REQUIRED_MODES.includes(payMode) && (
              <div className="col-span-2">
                <Label className="text-xs">UTR / transaction reference <span className="text-rose-600">*</span></Label>
                <Input value={payReference} onChange={event => setPayReference(event.target.value)} />
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
              disabled={busy}
              onClick={async () => {
                if (!actor) return;
                setBusy(true);
                try {
                  await recordReimbursementPayment(paying!.id, actor, {
                    paymentDate: payDate,
                    mode: payMode,
                    bankAccount: payBankAccount,
                    bankName: payBankName,
                    transactionReference: payReference,
                    voucherNumber: payVoucher,
                  });
                  toast({ title: 'Reimbursement paid' });
                  setPaying(null);
                } catch (error) {
                  toast({
                    variant: 'destructive',
                    title: 'Payment failed',
                    description: error instanceof TravelControlError ? error.message : 'Something went wrong. Please try again.',
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Mark paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
