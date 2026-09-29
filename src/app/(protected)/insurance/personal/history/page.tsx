
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, History, RefreshCw, Shield } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { formatDay, formatInr, toDate } from '@/lib/insurance';
import { AccessDenied } from '@/components/insurance/insurance-ui';
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

type EventType = 'Policy Created' | 'Premium Paid' | 'Claimed';

type HistoryEvent = {
  id: string;
  date: Date;
  policyNo: string;
  policyHolder: string;
  eventType: EventType;
  user: string;
  details: string;
};

export default function PersonalInsuranceHistoryPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View History', 'Insurance.Personal Insurance') || can('View', 'Insurance.Personal Insurance');
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const [policiesSnap, usersSnap] = await Promise.all([
        // Not ordered by a field: Firestore silently drops documents missing the ordered field.
        getDocs(collection(db, 'insurance_policies')),
        getDocs(collection(db, 'users')),
      ]);
      const policies = policiesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as InsurancePolicy));
      const usersMap = new Map(usersSnap.docs.map((d) => [d.id, (d.data() as User).name]));

      const renewalSnaps = await Promise.all(policies.map((p) => getDocs(collection(db, 'insurance_policies', p.id, 'renewals'))));
      const all: HistoryEvent[] = [];
      policies.forEach((policy, i) => {
        const created = toDate(policy.createdAt) ?? toDate(policy.date_of_comm);
        if (created) {
          all.push({
            id: `create-${policy.id}`,
            date: created,
            policyNo: policy.policy_no,
            policyHolder: policy.insured_person,
            eventType: 'Policy Created',
            user: policy.createdByName || (policy.createdBy ? usersMap.get(policy.createdBy) : undefined) || 'System',
            details: `${policy.insurance_company} · Sum assured ${formatInr(policy.sum_insured)}`,
          });
        }
        const closedOn = toDate(policy.closed_on);
        if (policy.status === 'Claimed' && closedOn) {
          all.push({
            id: `claim-${policy.id}`,
            date: closedOn,
            policyNo: policy.policy_no,
            policyHolder: policy.insured_person,
            eventType: 'Claimed',
            user: policy.updatedByName || 'Unknown',
            details: `Maturity claim ${formatInr(policy.closure_amount ?? 0)}`,
          });
        }
        renewalSnaps[i].forEach((rd) => {
          const r = rd.data() as PolicyRenewal;
          const due = toDate(r.instalmentDueDate);
          all.push({
            id: `renew-${rd.id}`,
            date: toDate(r.renewalDate) ?? toDate(r.paymentDate) ?? new Date(0),
            policyNo: policy.policy_no,
            policyHolder: policy.insured_person,
            eventType: 'Premium Paid',
            user: r.renewedByName || usersMap.get(r.renewedBy) || 'Unknown',
            details: [
              r.amount ? formatInr(r.amount) : null,
              `via ${r.paymentType}`,
              due ? `for instalment ${formatDay(due)}` : null,
              r.referenceNo ? `ref ${r.referenceNo}` : null,
            ].filter(Boolean).join(' · '),
          });
        });
      });
      all.sort((a, b) => b.date.getTime() - a.date.getTime());
      setEvents(all);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to fetch history.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (authLoading) return;
    if (canView) fetchHistory();
    else setIsLoading(false);
  }, [authLoading, canView, fetchHistory]);

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

  if (!authLoading && !canView) return <AccessDenied what="view personal insurance history" />;

  if (authLoading || isLoading) {
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
        description="Complete activity log — policies recorded, premiums paid and maturities claimed"
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
