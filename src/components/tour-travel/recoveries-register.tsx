'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import {
  RECOVERY_MODES,
  TT_COLLECTIONS,
  roundMoney,
  type RecoveryMode,
  type TravelRecovery,
} from '@/lib/tour-travel';
import { TravelControlError, recordRecovery } from '@/lib/tour-travel-service';
import { TT_PERMISSION_MODULE } from './module-layout-shell';
import { useTravelActor, useTravelCollection } from './use-travel-config';
import { Money, TravelDataList, TravelEmptyState, TravelFilterCard, TravelKpiCard, TravelLoader, TravelPageHeader, TravelStatusBadge, travelDialog } from './travel-ui';

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Outstanding balance on a recovery. Used by the register's amount, tint and action columns. */
const balanceOf = (recovery: TravelRecovery) =>
  Math.max(0, roundMoney(Number(recovery.amount || 0) - Number(recovery.recoveredAmount || 0)));

/**
 * Employee recovery register (spec section 25).
 *
 * A recovery can arrive in instalments — a payroll deduction spread over two months is normal — so
 * the register tracks recovered-against-due rather than a boolean. The advance is only settled when
 * the full amount is back, which is why a part-recovered row still shows as outstanding.
 */
export default function RecoveriesRegister() {
  const { toast } = useToast();
  const { can } = useAuthorization();
  const actor = useTravelActor();
  const { records, loading } = useTravelCollection<TravelRecovery>(TT_COLLECTIONS.recoveries);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('open');
  const [busy, setBusy] = useState(false);

  const [recovering, setRecovering] = useState<TravelRecovery | null>(null);
  const [amount, setAmount] = useState<number | ''>('');
  const [mode, setMode] = useState<RecoveryMode>('Employee Bank Deposit');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [payrollPeriod, setPayrollPeriod] = useState('');
  const [remarks, setRemarks] = useState('');

  const canRecover = can('Record Recovery', `${TT_PERMISSION_MODULE}.Recoveries`);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return records
      .filter(recovery => {
        if (status === 'open' && !['PENDING', 'PARTIALLY_RECOVERED'].includes(recovery.status)) return false;
        if (!['open', 'all'].includes(status) && recovery.status !== status) return false;
        if (!needle) return true;
        return [recovery.referenceNumber, recovery.employeeName].some(value => (value || '').toLowerCase().includes(needle));
      })
      .sort((a, b) => (b.referenceNumber || '').localeCompare(a.referenceNumber || ''));
  }, [records, search, status]);

  const totals = useMemo(() => {
    const open = records.filter(recovery => ['PENDING', 'PARTIALLY_RECOVERED'].includes(recovery.status));
    return {
      outstanding: roundMoney(open.reduce((sum, r) => sum + Math.max(0, Number(r.amount || 0) - Number(r.recoveredAmount || 0)), 0)),
      count: open.length,
      recovered: roundMoney(records.reduce((sum, r) => sum + Number(r.recoveredAmount || 0), 0)),
    };
  }, [records]);

  if (loading) return <TravelLoader label="Loading recoveries…" />;

  return (
    <div className="space-y-3">
      <TravelPageHeader title="Employee Recoveries" description="Unused travel advances to be recovered from employees." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <TravelKpiCard label="Recovery Pending" value={<Money value={totals.outstanding} />} hint={`${totals.count} employee(s)`} icon={Undo2} tone="rose" />
        <TravelKpiCard label="Recovered" value={<Money value={totals.recovered} />} icon={Undo2} tone="emerald" />
        <TravelKpiCard label="Total Records" value={records.length} tone="slate" />
      </div>

      <TravelFilterCard summary={`${filtered.length} recovery record(s)`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" value={search} onChange={event => setSearch(event.target.value)} placeholder="Reference or employee" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="PARTIALLY_RECOVERED">Partially recovered</SelectItem>
                <SelectItem value="RECOVERED">Recovered</SelectItem>
                <SelectItem value="WAIVED">Waived</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </TravelFilterCard>

      <TravelDataList
        rows={filtered}
        rowClassName={recovery => (balanceOf(recovery) > 0 ? 'bg-rose-50/40 border-rose-200' : undefined)}
        empty={
          <TravelEmptyState
            title="No recoveries"
            description="When an approved claim is less than the advance paid, the difference appears here."
            icon={Undo2}
          />
        }
        columns={[
          { header: 'Reference', mobile: 'title', cell: recovery => <span className="font-medium">{recovery.referenceNumber}</span> },
          { header: 'Employee', mobile: 'title', cell: recovery => recovery.employeeName },
          { header: 'Status', mobile: 'aside', cell: recovery => <TravelStatusBadge status={recovery.status} /> },
          {
            header: 'Claim',
            className: 'hidden md:table-cell',
            mobile: 'omit',
            cell: recovery => (
              <Link href={`/tour-travel/claims/${recovery.claimId}`} className="text-sky-700 hover:underline">
                View claim
              </Link>
            ),
          },
          { header: 'Due', align: 'right', cell: recovery => <Money value={recovery.amount} /> },
          {
            header: 'Recovered',
            align: 'right',
            cell: recovery => {
              const percent = recovery.amount > 0 ? Math.round((Number(recovery.recoveredAmount || 0) / recovery.amount) * 100) : 0;
              return (
                <>
                  <Money value={recovery.recoveredAmount || 0} />
                  {percent > 0 && percent < 100 && <Progress value={percent} className="mt-1 h-1" />}
                </>
              );
            },
          },
          {
            header: 'Balance',
            align: 'right',
            cell: recovery => {
              const balance = balanceOf(recovery);
              return <span className={balance > 0 ? 'font-medium text-rose-600' : ''}><Money value={balance} /></span>;
            },
          },
          {
            header: 'Mode',
            className: 'hidden lg:table-cell',
            cell: recovery => <span className="text-xs text-muted-foreground">{recovery.mode || '—'}</span>,
          },
          {
            header: 'Action',
            mobile: 'footer',
            cell: recovery => {
              const balance = balanceOf(recovery);
              return (
                <div className="flex flex-1 gap-2">
                  {canRecover && balance > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setRecovering(recovery);
                        setAmount(balance);
                        setReceivedOn(todayIso());
                        setReference('');
                        setPayrollPeriod('');
                        setRemarks('');
                      }}
                    >
                      Record
                    </Button>
                  )}
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs sm:hidden">
                    <Link href={`/tour-travel/claims/${recovery.claimId}`}>View claim</Link>
                  </Button>
                </div>
              );
            },
          },
        ]}
      />

      <Dialog open={!!recovering} onOpenChange={open => !open && setRecovering(null)}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>Record recovery</DialogTitle>
            <DialogDescription>
              {recovering?.referenceNumber} · {recovering?.employeeName} · balance{' '}
              {roundMoney(Number(recovering?.amount || 0) - Number(recovering?.recoveredAmount || 0))}
            </DialogDescription>
          </DialogHeader>
          <div className={travelDialog.bodyGrid}>
            <div>
              <Label className="text-xs">Amount recovered</Label>
              <Input type="number" inputMode="decimal" min={0} value={amount} onChange={event => setAmount(event.target.value === '' ? '' : Number(event.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Received on</Label>
              <Input type="date" value={receivedOn} onChange={event => setReceivedOn(event.target.value)} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Mode</Label>
              <Select value={mode} onValueChange={value => setMode(value as RecoveryMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECOVERY_MODES.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {mode === 'Payroll Deduction' && (
              <div className="col-span-2">
                <Label className="text-xs">Payroll period <span className="text-rose-600">*</span></Label>
                <Input value={payrollPeriod} onChange={event => setPayrollPeriod(event.target.value)} placeholder="e.g. 2026-09" />
              </div>
            )}
            <div className="col-span-2">
              <Label className="text-xs">Transaction reference</Label>
              <Input value={reference} onChange={event => setReference(event.target.value)} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Remarks</Label>
              <Textarea value={remarks} onChange={event => setRemarks(event.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter className={travelDialog.footer}>
            <Button variant="outline" onClick={() => setRecovering(null)}>Cancel</Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!actor) return;
                setBusy(true);
                try {
                  await recordRecovery(recovering!.id, actor, {
                    amount: Number(amount || 0),
                    mode,
                    receivedOn,
                    transactionReference: reference,
                    payrollPeriod,
                    remarks,
                  });
                  toast({ title: 'Recovery recorded' });
                  setRecovering(null);
                } catch (error) {
                  toast({
                    variant: 'destructive',
                    title: 'Could not record recovery',
                    description: error instanceof TravelControlError ? error.message : 'Something went wrong. Please try again.',
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
