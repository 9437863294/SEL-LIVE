'use client';

import Link from 'next/link';
import { Inbox, KeyRound, ListChecks, Plug, Users } from 'lucide-react';

import { useLoader, useMailHub } from '@/components/mail-hub/hooks';
import { AccountStatusBadge, DeadlineBadge, EmptyState, PageHeader, RecoveryPanel, formatLong } from '@/components/mail-hub/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { mailApi } from '@/lib/mail-hub/client';

/** Mail Hub's landing page: mailbox health, what needs a reply, and what is due. */
export default function MailOverviewPage() {
  const { data } = useMailHub();
  const work = useLoader(() => mailApi.tasks(), []);
  if (!data) return null;
  const personal = data.accounts.filter((account) => account.kind === 'personal');
  const unread = personal.reduce((sum, account) => sum + ((data.folders[account.id] ?? []).find((folder) => folder.role === 'inbox')?.unreadCount ?? 0), 0);
  const followUps = work.value?.followUps ?? [];
  const assigned = work.value?.assigned ?? [];
  const overdue = assigned.filter((thread) => thread.deadline === 'overdue').length + followUps.filter((entry) => Date.parse(entry.dueAt) < Date.now()).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Mail, ${data.user.name.split(' ')[0]}`}
        description="Your mailboxes, the mail assigned to you, and your follow-ups."
        actions={<Button asChild><Link href="/mail/inbox"><Inbox className="mr-2 h-4 w-4" /> Open inbox</Link></Button>}
      />

      {personal.length === 0 && (
        <EmptyState
          icon={<Plug className="h-10 w-10" />}
          title="Connect your first mailbox"
          body="Google Workspace, Microsoft 365 or the company mailbox. Only you will be able to read it here."
          action={data.capabilities.canConnectAccount ? <Button asChild className="mt-2"><Link href="/mail/settings/accounts">Connect email account</Link></Button> : undefined}
        />
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Unread in inbox', value: unread, href: '/mail/inbox' },
          { label: 'Assigned to me', value: assigned.length, href: '/mail/tasks' },
          { label: 'Open follow-ups', value: followUps.length, href: '/mail/tasks' },
          { label: 'Overdue', value: overdue, href: '/mail/tasks', tone: overdue ? 'text-rose-700' : undefined },
        ].map((tile) => (
          <Link key={tile.label} href={tile.href} className="rounded-xl border bg-white p-3 transition-shadow hover:shadow-sm">
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${tile.tone ?? 'text-slate-900'}`}>{work.loading && tile.label !== 'Unread in inbox' ? '—' : tile.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><KeyRound className="h-4 w-4" /> Mailboxes</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.accounts.length === 0 && <p className="text-sm text-muted-foreground">None connected.</p>}
            {data.accounts.map((account) => (
              <div key={account.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{account.sharedMailboxName ?? account.emailAddress}</p>
                    <p className="text-xs text-muted-foreground">{account.kind === 'shared' ? 'Shared mailbox' : 'Personal'} · last synced {account.sync.lastSuccessAt ? formatLong(account.sync.lastSuccessAt) : 'not yet'}</p>
                  </div>
                  <AccountStatusBadge account={account} />
                </div>
                {account.recovery && account.status !== 'active' && account.access.canManage && <RecoveryPanel advice={account.recovery} />}
              </div>
            ))}
            <Button asChild variant="outline" size="sm"><Link href="/mail/settings/accounts">Manage accounts</Link></Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><ListChecks className="h-4 w-4" /> Needs your attention</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {assigned.slice(0, 5).map((thread) => (
              <Link key={thread.id} href={`/mail/shared?account=${thread.accountId}&thread=${thread.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-sm">{thread.subject}</span>
                <DeadlineBadge thread={thread} />
              </Link>
            ))}
            {followUps.slice(0, 5).map((followUp) => (
              <Link key={followUp.id} href={`/mail/${followUp.sharedMailboxId ? 'shared' : 'inbox'}?account=${followUp.accountId}&thread=${followUp.threadId}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <ListChecks className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-sm">{followUp.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatLong(followUp.dueAt)}</span>
              </Link>
            ))}
            {!work.loading && assigned.length === 0 && followUps.length === 0 && <p className="text-sm text-muted-foreground">Nothing assigned and nothing due.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
