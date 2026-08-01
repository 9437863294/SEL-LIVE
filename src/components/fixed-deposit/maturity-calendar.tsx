'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { CalendarClock, ExternalLink, Loader2, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { CLOSED_FD_STATUSES, FD_COLLECTIONS, daysUntil, formatFdCurrency, toDate, type FixedDeposit } from '@/lib/fixed-deposit';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export default function FixedDepositMaturityCalendar() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const canView = can('View', 'Fixed Deposit Management.Maturity Calendar');
  const [deposits, setDeposits] = useState<FixedDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());

  useEffect(() => {
    if (authLoading) return;
    if (!canView) { setLoading(false); return; }
    const source = user?.role === 'Super Admin' || !user?.organizationId ? collection(db, FD_COLLECTIONS.deposits) : query(collection(db, FD_COLLECTIONS.deposits), where('organizationId', '==', user.organizationId));
    getDocs(source).then((snapshot) => setDeposits(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as FixedDeposit)).filter((fd) => !fd.isDeleted && !CLOSED_FD_STATUSES.includes(fd.status)))).catch((error) => { console.error('Unable to load FD maturities', error); toast({ title: 'Unable to load maturity calendar', variant: 'destructive' }); }).finally(() => setLoading(false));
  }, [authLoading, canView, toast, user?.organizationId, user?.role]);

  const maturityMap = useMemo(() => {
    const map = new Map<string, FixedDeposit[]>();
    deposits.forEach((fd) => { const date = toDate(fd.maturityDate); if (!date) return; const key = dayKey(date); map.set(key, [...(map.get(key) || []), fd]); });
    return map;
  }, [deposits]);
  const maturityDates = useMemo(() => Array.from(maturityMap.keys()).map((value) => new Date(`${value}T12:00:00`)), [maturityMap]);
  const monthRows = useMemo(() => deposits.filter((fd) => { const date = toDate(fd.maturityDate); return date?.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth(); }).sort((a, b) => (toDate(a.maturityDate)?.getTime() || 0) - (toDate(b.maturityDate)?.getTime() || 0)), [deposits, month]);
  const selectedRows = selectedDate ? maturityMap.get(dayKey(selectedDate)) || [] : [];
  const monthAmount = monthRows.reduce((total, fd) => total + fd.principalAmount, 0);

  if (authLoading || loading) return <div className="flex min-h-[45vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-600" /></div>;
  if (!canView) return <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view FD maturities.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card>;

  return <div className="space-y-4"><div><h1 className="text-2xl font-bold tracking-tight">FD Maturity Calendar</h1><p className="text-sm text-muted-foreground">Monthly and daily visibility of fixed-deposit maturities.</p></div>
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]"><Card><CardHeader><CardTitle className="text-base">Select a maturity date</CardTitle></CardHeader><CardContent><Calendar mode="single" selected={selectedDate} onSelect={setSelectedDate} month={month} onMonthChange={setMonth} modifiers={{ hasMaturity: maturityDates }} modifiersClassNames={{ hasMaturity: 'font-bold ring-2 ring-cyan-500 ring-inset bg-cyan-50' }} className="mx-auto rounded-md border" /><div className="mt-4 rounded-xl bg-slate-50 p-3"><p className="text-xs text-muted-foreground">{selectedDate?.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p><p className="mt-1 font-semibold">{selectedRows.length} FD{selectedRows.length === 1 ? '' : 's'} · {formatFdCurrency(selectedRows.reduce((total, fd) => total + fd.principalAmount, 0))}</p></div></CardContent></Card>
      <Card><CardHeader className="flex flex-row items-start justify-between"><div><CardTitle>{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</CardTitle><CardDescription>{monthRows.length} maturity event{monthRows.length === 1 ? '' : 's'}</CardDescription></div><Badge variant="outline">{formatFdCurrency(monthAmount)}</Badge></CardHeader><CardContent className="space-y-2">{monthRows.map((fd) => { const remaining = daysUntil(fd.maturityDate); return <div key={fd.id} className="flex flex-col justify-between gap-3 rounded-xl border bg-white p-3 sm:flex-row sm:items-center"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50"><CalendarClock className="h-5 w-5 text-amber-700" /></div><div><p className="font-medium">{fd.referenceNumber} · {fd.fdNumber}</p><p className="text-xs text-muted-foreground">{fd.bankName} · {fd.holderName}</p><p className="mt-1 text-xs">Matures {toDate(fd.maturityDate)?.toLocaleDateString('en-IN')} · {remaining !== null && remaining < 0 ? `${Math.abs(remaining)} days overdue` : `${remaining} days remaining`}</p></div></div><div className="flex items-center justify-between gap-3 sm:text-right"><div><p className="font-semibold">{formatFdCurrency(fd.principalAmount, fd.currency)}</p><Badge variant="outline" className={remaining !== null && remaining < 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : remaining !== null && remaining <= 7 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-cyan-200 bg-cyan-50 text-cyan-700'}>{fd.autoRenewal ? 'Auto renewal' : 'Action required'}</Badge></div><Button asChild variant="ghost" size="icon"><Link href="/fixed-deposit/register"><ExternalLink className="h-4 w-4" /></Link></Button></div></div>; })}{!monthRows.length && <div className="flex h-48 flex-col items-center justify-center text-center text-muted-foreground"><CalendarClock className="mb-3 h-10 w-10 opacity-40" /><p>No FD maturities this month.</p></div>}</CardContent></Card>
    </div>
  </div>;
}
