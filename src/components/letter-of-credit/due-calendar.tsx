'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { CalendarClock, Loader2, ShieldAlert, WalletCards } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { LC_COLLECTIONS, LC_PERMISSION_MODULE, daysUntil, derivePaymentStatus, formatLcCurrency, lcLabel, toLcDate, type LetterOfCredit } from '@/lib/letter-of-credit';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';

const tone = (days: number | null): StatusTone => days === null ? 'neutral' : days <= 7 ? 'danger' : days <= 30 ? 'warning' : 'info';

export default function LCDueCalendar() {
  const { user } = useAuth(); const { can, isLoading: authLoading } = useAuthorization(); const { toast } = useToast();
  const [credits, setCredits] = useState<LetterOfCredit[]>([]); const [loading, setLoading] = useState(true); const [from, setFrom] = useState(new Date().toISOString().slice(0, 8) + '01'); const [to, setTo] = useState(() => { const date = new Date(); date.setDate(date.getDate() + 90); return date.toISOString().slice(0, 10); }); const [bank, setBank] = useState('ALL');
  const canView = can('View', `${LC_PERMISSION_MODULE}.Payment Due Calendar`);
  useEffect(() => { if (authLoading || !canView) { if (!authLoading) setLoading(false); return; } const source = user?.role === 'Super Admin' || !user?.organizationId ? collection(db, LC_COLLECTIONS.credits) : query(collection(db, LC_COLLECTIONS.credits), where('organizationId', '==', user.organizationId)); void getDocs(source).then((snapshot) => setCredits(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as LetterOfCredit)))).catch(() => toast({ title: 'Unable to load payment calendar', variant: 'destructive' })).finally(() => setLoading(false)); }, [authLoading, canView, toast, user?.organizationId, user?.role]);
  const rows = useMemo(() => credits.filter((item) => item.outstandingAmount > 0 && !['CLOSED', 'CANCELLED'].includes(item.status)).map((item) => ({ ...item, due: toLcDate(item.actualDueDate || item.expectedDueDate), days: daysUntil(item.actualDueDate || item.expectedDueDate) })).filter((item) => item.due && item.due >= new Date(`${from}T00:00:00`) && item.due <= new Date(`${to}T23:59:59`) && (bank === 'ALL' || item.bankId === bank)).sort((a, b) => Number(a.due) - Number(b.due)), [bank, credits, from, to]);
  const grouped = useMemo(() => rows.reduce<Record<string, typeof rows>>((map, item) => { const key = item.due!.toLocaleString('en-IN', { month: 'long', year: 'numeric' }); map[key] = [...(map[key] || []), item]; return map; }, {}), [rows]);
  if (authLoading || loading) return <div className="flex min-h-[45vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-600" /></div>;
  if (!canView) return <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view payment obligations.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card>;
  return <div className="space-y-4"><PageHeader title="LC Payment Due Calendar" description="Cash-flow view of accepted LC liabilities and overdue obligations." /><FilterBar activeCount={bank !== 'ALL' ? 1 : 0} onClear={() => setBank('ALL')} summary={`${rows.length} obligations · ${formatLcCurrency(rows.reduce((sum, item) => sum + item.outstandingAmount, 0))}`}><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" /><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" /><Select value={bank} onValueChange={setBank}><SelectTrigger aria-label="Bank"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All banks</SelectItem>{Array.from(new Map(credits.map((item) => [item.bankId, item.bankName])).entries()).map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select></FilterBar>
    {Object.entries(grouped).map(([month, items]) => <TableCard key={month} title={month} icon={CalendarClock} count={items.length} noun="payment" actions={<p className="font-bold tabular-nums">{formatLcCurrency(items.reduce((sum, item) => sum + item.outstandingAmount, 0))}</p>} scroll="natural"><Table><TableHeader><TableRow><TableHead>Due Date</TableHead><TableHead>LC / Vendor</TableHead><TableHead>Bank / Project</TableHead><TableHead className="text-right">Due Amount</TableHead><TableHead>Priority</TableHead><TableHead /></TableRow></TableHeader><TableBody>{items.map((item) => <TableRow key={item.id}><TableCell><p className="font-medium">{item.due!.toLocaleDateString('en-IN')}</p><p className="text-xs text-muted-foreground">{item.days! < 0 ? `${Math.abs(item.days!)} days overdue` : `${item.days} days remaining`}</p></TableCell><TableCell><p>{item.bankLcNumber}</p><p className="text-xs text-muted-foreground">{item.vendorName}</p></TableCell><TableCell>{item.bankName}<p className="text-xs text-muted-foreground">{item.projectName}</p></TableCell><TableCell className="text-right font-semibold">{formatLcCurrency(item.outstandingAmount, item.currency)}</TableCell><TableCell className="whitespace-nowrap"><StatusBadge tone={tone(item.days)}>{lcLabel(derivePaymentStatus(item.actualDueDate || item.expectedDueDate, item.outstandingAmount))}</StatusBadge></TableCell><TableCell><Button asChild size="sm" variant="outline"><Link href={`/letter-of-credit/payments?lcId=${item.id}`}><WalletCards className="mr-2 h-4 w-4" />Pay</Link></Button></TableCell></TableRow>)}</TableBody></Table></TableCard>)}{!rows.length && <Card><CardContent className="py-16 text-center text-muted-foreground">No LC payment obligations fall within the selected range.</CardContent></Card>}
  </div>;
}
