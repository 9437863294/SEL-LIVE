'use client';

import Link from 'next/link';
import { ListChecks, Users } from 'lucide-react';

import { useLoader } from '@/components/mail-hub/hooks';
import { DeadlineBadge, EmptyState, ErrorNotice, Spinner, formatLong } from '@/components/mail-hub/ui';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { mailApi } from '@/lib/mail-hub/client';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';

const PRIORITY_TONE: Record<string, StatusTone> = {
  urgent: 'danger',
  high: 'warning',
  normal: 'info',
  low: 'neutral',
};

/** Your mail work: shared-mailbox conversations assigned to you, and your follow-ups. */
export default function MailTasksPage() {
  const { toast } = useToast();
  const { value, loading, error, reload } = useLoader(() => mailApi.tasks(), []);

  return (
    <div className="space-y-4">
      <PageHeader title="Tasks & follow-ups" description="Reminders arrive in the bell and on your phone before each is due." />
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !value && <Spinner />}
      {value && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><Users className="h-4 w-4" /> Assigned to me ({value.assigned.length})</h2>
            {value.assigned.length === 0 ? (
              <EmptyState title="No conversations assigned to you" />
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border bg-white">
                {value.assigned.map((thread) => (
                  <li key={thread.id}>
                    <Link href={`/mail/shared?account=${thread.accountId}&thread=${thread.id}`} className="flex flex-col gap-1 px-3 py-2.5 hover:bg-slate-50">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{thread.subject}</span>
                        <DeadlineBadge thread={thread} />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{thread.snippet}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><ListChecks className="h-4 w-4" /> My follow-ups ({value.followUps.length})</h2>
            {value.followUps.length === 0 ? (
              <EmptyState title="No open follow-ups" body="Open a conversation and choose Follow-ups › Add." />
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border bg-white">
                {value.followUps.map((followUp) => {
                  const overdue = Date.parse(followUp.dueAt) < Date.now();
                  return (
                    <li key={followUp.id} className="flex items-start gap-3 px-3 py-2.5">
                      <Checkbox
                        className="mt-1"
                        aria-label={`Mark "${followUp.title}" done`}
                        onCheckedChange={async () => {
                          try {
                            await mailApi.updateFollowUp(followUp.id, { status: 'done' });
                            void reload();
                          } catch (caught) {
                            toast({ variant: 'destructive', title: 'Could not update', description: caught instanceof Error ? caught.message : undefined });
                          }
                        }}
                      />
                      <Link href={`/mail/${followUp.sharedMailboxId ? 'shared' : 'inbox'}?account=${followUp.accountId}&thread=${followUp.threadId}`} className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{followUp.title}</span>
                          <StatusBadge status={followUp.priority} tone={PRIORITY_TONE[followUp.priority] ?? 'neutral'} />
                        </div>
                        <p className={cn('text-xs', overdue ? 'font-medium text-rose-700' : 'text-muted-foreground')}>
                          {overdue ? 'Overdue — ' : 'Due '}{formatLong(followUp.dueAt)} · “{followUp.subject}”
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
