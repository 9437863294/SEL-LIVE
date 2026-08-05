'use client';

import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
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

type Log = { id: string; organizationId?: string; jobName?: string; startedAt?: unknown; completedAt?: unknown; recordsProcessed?: number; successCount?: number; failureCount?: number; status?: string; errorDetails?: string; createdAt?: unknown };

export default function AutomationOperations() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const [logs, setLogs] = useState<Log[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => onSnapshot(
    query(collection(db, RP_COLLECTIONS.automationLogs), where('organizationId', '==', organizationId), limit(50)),
    snapshot => setLogs(snapshot.docs
      .map(item => ({ id: item.id, ...item.data() } as Log))
      .sort((a, b) => timestampMillis(b.createdAt || b.startedAt) - timestampMillis(a.createdAt || a.startedAt))
      .slice(0, 20)),
    () => setLogs([]),
  ), [organizationId]);

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
  return <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-indigo-600" />Scheduler Operations</CardTitle><CardDescription>Organization-scoped, idempotent generation, workflow activation, overdue and reminder checks.</CardDescription></div>{canManage && <Button onClick={run} disabled={running}>{running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Run automation now</Button>}</CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Started</TableHead><TableHead>Processed</TableHead><TableHead>Success</TableHead><TableHead>Failure</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{logs.map(log => <TableRow key={log.id}><TableCell>{log.jobName || 'Recurring scheduler'}</TableCell><TableCell>{formatTimestamp(log.startedAt)}</TableCell><TableCell>{log.recordsProcessed || 0}</TableCell><TableCell>{log.successCount || 0}</TableCell><TableCell>{log.failureCount || 0}</TableCell><TableCell><Badge variant={log.status === 'Completed' ? 'default' : 'destructive'}>{log.status || 'Unknown'}</Badge></TableCell></TableRow>)}{!logs.length && <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground"><RefreshCw className="mx-auto mb-2 h-6 w-6" />No organization automation logs recorded yet.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>;
}

function timestampMillis(value: unknown) { const timestamp = value as { toDate?: () => Date; seconds?: number } | null; if (timestamp?.toDate) return timestamp.toDate().getTime(); return Number(timestamp?.seconds || 0) * 1000; }
function formatTimestamp(value: unknown) { const millis = timestampMillis(value); return millis ? new Date(millis).toLocaleString('en-IN') : '—'; }
