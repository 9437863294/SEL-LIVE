
'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, History, RefreshCw, Shield } from 'lucide-react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { InsurancePolicy, PolicyRenewal, User } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { SearchInput } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';

type EventType = 'Policy Created' | 'Premium Paid';

type HistoryEvent = {
  id: string;
  date: Date;
  policyNo: string;
  policyHolder: string;
  eventType: EventType;
  user: string;
  details: string;
};

const fmtCur = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

export default function PersonalInsuranceHistoryPage() {
  const { toast } = useToast();
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      const [policiesSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, 'insurance_policies'), orderBy('date_of_comm', 'desc'))),
        getDocs(collection(db, 'users')),
      ]);
      const policies = policiesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as InsurancePolicy));
      const usersMap = new Map(usersSnap.docs.map((d) => [d.id, (d.data() as User).name]));

      const all: HistoryEvent[] = [];
      for (const policy of policies) {
        if (policy.date_of_comm) {
          all.push({
            id: `create-${policy.id}`,
            date: policy.date_of_comm.toDate(),
            policyNo: policy.policy_no,
            policyHolder: policy.insured_person,
            eventType: 'Policy Created',
            user: 'System',
            details: `Sum Insured: ${fmtCur(policy.sum_insured)}`,
          });
        }
        const renewalsSnap = await getDocs(collection(db, 'insurance_policies', policy.id, 'renewals'));
        renewalsSnap.forEach((rd) => {
          const r = rd.data() as PolicyRenewal;
          all.push({
            id: `renew-${rd.id}`,
            date: r.renewalDate.toDate(),
            policyNo: policy.policy_no,
            policyHolder: policy.insured_person,
            eventType: 'Premium Paid',
            user: usersMap.get(r.renewedBy) || 'Unknown',
            details: `Paid via ${r.paymentType}`,
          });
        });
      }
      all.sort((a, b) => b.date.getTime() - a.date.getTime());
      setEvents(all);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to fetch history.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchHistory(); }, []); // eslint-disable-line

  const filtered = useMemo(() => {
    if (!search.trim()) return events;
    const q = search.toLowerCase();
    return events.filter(
      (e) => e.policyNo.toLowerCase().includes(q) || e.policyHolder.toLowerCase().includes(q) || e.user.toLowerCase().includes(q)
    );
  }, [events, search]);

  const stats = useMemo(() => ({
    total: events.length,
    created: events.filter((e) => e.eventType === 'Policy Created').length,
    paid: events.filter((e) => e.eventType === 'Premium Paid').length,
  }), [events]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        icon={History}
        title="Personal Insurance History"
        description="Complete activity log — policy creations and premium payments"
        actions={
          <Button variant="outline" size="sm" onClick={fetchHistory} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />
      <Card className="overflow-hidden border-border/60">
        <CardContent className="grid grid-cols-3 gap-2 p-4">
          {[
            { label: 'Total Events',    value: stats.total,   color: 'text-slate-700' },
            { label: 'Policies Created', value: stats.created, color: 'text-blue-600' },
            { label: 'Premiums Paid',   value: stats.paid,    color: 'text-emerald-600' },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center rounded-lg py-2">
              <span className={cn('text-2xl font-bold', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Table */}
      <TableCard
        title="Activity log"
        icon={History}
        count={filtered.length}
        total={events.length}
        noun="event"
        toolbar={<SearchInput value={search} onChange={setSearch} placeholder="Search policy no., holder, user…" className="sm:max-w-sm" />}
      >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date & Time</TableHead>
                <TableHead>Policy No.</TableHead>
                <TableHead>Policy Holder</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <History className="h-8 w-8 opacity-30" />
                      <span className="text-sm">No history events found.</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell className="whitespace-nowrap">{format(ev.date, 'dd MMM yyyy, HH:mm')}</TableCell>
                    <TableCell className="font-mono font-medium whitespace-nowrap">{ev.policyNo}</TableCell>
                    <TableCell className="font-medium">{ev.policyHolder}</TableCell>
                    <TableCell><StatusBadge status={ev.eventType} /></TableCell>
                    <TableCell>{ev.user}</TableCell>
                    <TableCell>{ev.details}</TableCell>
                  </TableRow>
              ))}
            </TableBody>
          </Table>
      </TableCard>
    </div>
  );
}
