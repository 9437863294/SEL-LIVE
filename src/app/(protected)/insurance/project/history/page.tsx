
'use client';

import { useEffect, useMemo, useState } from 'react';
import { History, RefreshCw, Search, X } from 'lucide-react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { ProjectInsurancePolicy, ProjectPolicyRenewal, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type EventType = 'Policy Created' | 'Policy Renewed';

type HistoryEvent = {
  id: string;
  date: Date;
  policyNo: string;
  assetName: string;
  eventType: EventType;
  user: string;
  details: string;
};

const EVENT_CFG: Record<EventType, { cls: string; dot: string }> = {
  'Policy Created': { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  'Policy Renewed': { cls: 'bg-blue-100 text-blue-700 border-blue-200',           dot: 'bg-blue-500' },
};

const fmtCur = (n: number) =>
  typeof n === 'number'
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
    : 'N/A';

export default function ProjectInsuranceHistoryPage() {
  const { toast } = useToast();
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      const [policiesSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, 'project_insurance_policies'), orderBy('insurance_start_date', 'desc'))),
        getDocs(collection(db, 'users')),
      ]);
      const policies = policiesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectInsurancePolicy));
      const usersMap = new Map(usersSnap.docs.map((d) => [d.id, (d.data() as User).name]));

      const all: HistoryEvent[] = [];
      for (const policy of policies) {
        if (policy.insurance_start_date) {
          all.push({
            id: `create-${policy.id}`,
            date: policy.insurance_start_date.toDate(),
            policyNo: policy.policy_no,
            assetName: policy.assetName,
            eventType: 'Policy Created',
            user: 'System',
            details: `Sum Insured: ${fmtCur(policy.sum_insured)}`,
          });
        }
        const renewalsSnap = await getDocs(collection(db, 'project_insurance_policies', policy.id, 'history'));
        renewalsSnap.forEach((rd) => {
          const r = rd.data() as ProjectPolicyRenewal;
          all.push({
            id: `renew-${rd.id}`,
            date: r.renewalDate.toDate(),
            policyNo: policy.policy_no,
            assetName: policy.assetName,
            eventType: 'Policy Renewed',
            user: usersMap.get(r.renewedBy) || 'Unknown',
            details: `Renewed premium: ${fmtCur(r.premium)}`,
          });
        });
      }
      all.sort((a, b) => b.date.getTime() - a.date.getTime());
      setEvents(all);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to fetch project insurance history.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchHistory(); }, []); // eslint-disable-line

  const filtered = useMemo(() => {
    if (!search.trim()) return events;
    const q = search.toLowerCase();
    return events.filter(
      (e) => e.policyNo.toLowerCase().includes(q) || e.assetName.toLowerCase().includes(q) || e.user.toLowerCase().includes(q)
    );
  }, [events, search]);

  const stats = useMemo(() => ({
    total:   events.length,
    created: events.filter((e) => e.eventType === 'Policy Created').length,
    renewed: events.filter((e) => e.eventType === 'Policy Renewed').length,
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
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-400 via-teal-500 to-slate-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
              <History className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="tracking-tight">Project Insurance History</CardTitle>
              <CardDescription>Complete log of all project insurance policy activities</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchHistory} className="gap-1.5 w-fit">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2 border-t pt-4">
          {[
            { label: 'Total Events',     value: stats.total,   color: 'text-slate-700' },
            { label: 'Policies Created', value: stats.created, color: 'text-emerald-600' },
            { label: 'Renewals',         value: stats.renewed, color: 'text-blue-600' },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center rounded-lg py-2">
              <span className={cn('text-2xl font-bold', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search policy no., asset, user…" className="pl-8 h-9 text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} events</span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden border-border/60">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-6" />
                <TableHead>Date & Time</TableHead>
                <TableHead>Asset Name</TableHead>
                <TableHead>Policy No.</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <History className="h-8 w-8 opacity-30" />
                      <span className="text-sm">No history events found.</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.map((ev) => {
                const cfg = EVENT_CFG[ev.eventType];
                return (
                  <TableRow key={ev.id} className="hover:bg-muted/20 transition-colors">
                    <TableCell className="pr-0"><div className={cn('h-2 w-2 rounded-full mx-auto', cfg.dot)} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{format(ev.date, 'dd MMM yyyy, HH:mm')}</TableCell>
                    <TableCell className="font-medium">{ev.assetName}</TableCell>
                    <TableCell className="font-mono text-xs font-medium">{ev.policyNo}</TableCell>
                    <TableCell><Badge variant="outline" className={cn('text-[10px]', cfg.cls)}>{ev.eventType}</Badge></TableCell>
                    <TableCell className="text-sm">{ev.user}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{ev.details}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
