'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Bot, Loader2, Play, RefreshCw } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { RP_COLLECTIONS } from '@/lib/recurring-payments';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableScrollArea } from './module-table-card';

type Log = { id: string; organizationId?: string; jobName?: string; startedAt?: unknown; completedAt?: unknown; recordsProcessed?: number; successCount?: number; failureCount?: number; status?: string; errorDetails?: string; createdAt?: unknown };

export default function AutomationOperations() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const [running, setRunning] = useState(false);

  // Two fixes live in this subscription.
  //
  // The nightly cron sweeps every organization in one pass and therefore logs its run against
  // 'all', not against any single organization — so filtering on `organizationId` alone meant this
  // table, the only place the scheduler's history is visible, listed nothing but the manual "Run
  // automation now" clicks. Whether the scheduled job ran at all is the one question the page
  // exists to answer, and it could not answer it.
  //
  // And the rows are ordered *after* the fetch, so the server-side `limit` was taking an arbitrary
  // slice by document id and sorting only that: once the collection outgrew the limit, the "latest
  // 20" quietly stopped being the latest. Sorting the whole (narrow) result set is correct, and
  // keeps this on the automatic single-field index rather than requiring a composite index to be
  // deployed — the convention the rest of the module follows.
  //
  // Two separate subscriptions rather than one `in` query, because this project's Firestore rules
  // are maintained in the Firebase console rather than in this repository (see firestore.rules). If
  // the live ruleset scopes reads to the caller's own organization, an `in` query spanning 'all'
  // fails as a whole and takes the organization's own history down with it; as two queries, the
  // global feed simply stays empty and the manual runs still render.
  const [orgLogs, setOrgLogs] = useState<Log[]>([]);
  const [globalLogs, setGlobalLogs] = useState<Log[]>([]);
  const logs = useMemo(
    () => [...orgLogs, ...globalLogs]
      .sort((a, b) => timestampMillis(b.createdAt || b.startedAt) - timestampMillis(a.createdAt || a.startedAt))
      .slice(0, 20),
    [orgLogs, globalLogs],
  );

  useEffect(() => {
    const subscribe = (scope: string, apply: (rows: Log[]) => void) => onSnapshot(
      query(collection(db, RP_COLLECTIONS.automationLogs), where('organizationId', '==', scope)),
      snapshot => apply(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Log))),
      () => apply([]),
    );
    const stopOrg = subscribe(organizationId, setOrgLogs);
    const stopGlobal = subscribe('all', setGlobalLogs);
    return () => { stopOrg(); stopGlobal(); };
  }, [organizationId]);

  async function run() {
    if (!can('Manage Automation', 'Recurring Payments.Settings') && !can('Edit', 'Recurring Payments.Settings')) return;
    setRunning(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Please sign in again.');
      const response = await fetch('/api/recurring-payments/generate', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Automation failed');
      toast({
        title: 'Organization automation completed',
        description: `Generated ${result.generated}, triggered ${result.workflowTriggered}, and queued ${result.remindersQueued} reminder(s).`
          + (result.assigneeMissing ? ` ${result.assigneeMissing} payment(s) could not enter their workflow — no assignee configured. Check the audit log on each.` : ''),
        variant: result.assigneeMissing ? 'destructive' : undefined,
      });
    } catch (error) {
      toast({ title: 'Automation run failed', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  }

  const canManage = can('Manage Automation', 'Recurring Payments.Settings') || can('Edit', 'Recurring Payments.Settings');
  return <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-indigo-600" />Scheduler Operations</CardTitle><CardDescription>Organization-scoped, idempotent generation, workflow activation, overdue and reminder checks.</CardDescription></div>{canManage && <Button onClick={run} disabled={running}>{running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Run automation now</Button>}</CardHeader><CardContent className="p-0"><TableScrollArea><Table><TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Started</TableHead><TableHead>Processed</TableHead><TableHead>Success</TableHead><TableHead>Failure</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{logs.map(log => <TableRow key={log.id}><TableCell>{log.jobName || 'Recurring scheduler'}</TableCell><TableCell>{formatTimestamp(log.startedAt)}</TableCell><TableCell>{log.recordsProcessed || 0}</TableCell><TableCell>{log.successCount || 0}</TableCell><TableCell>{log.failureCount || 0}</TableCell><TableCell><Badge variant={log.status === 'Completed' ? 'default' : 'destructive'}>{log.status || 'Unknown'}</Badge></TableCell></TableRow>)}{!logs.length && <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground"><RefreshCw className="mx-auto mb-2 h-6 w-6" />No organization automation logs recorded yet.</TableCell></TableRow>}</TableBody></Table></TableScrollArea></CardContent></Card>;
}

function timestampMillis(value: unknown) { const timestamp = value as { toDate?: () => Date; seconds?: number } | null; if (timestamp?.toDate) return timestamp.toDate().getTime(); return Number(timestamp?.seconds || 0) * 1000; }
function formatTimestamp(value: unknown) { const millis = timestampMillis(value); return millis ? new Date(millis).toLocaleString('en-IN') : '—'; }
