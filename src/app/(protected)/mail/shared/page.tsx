'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BadgeCheck, Loader2, ShieldAlert, Users } from 'lucide-react';

import { useLoader, useMailHub } from '@/components/mail-hub/hooks';
import { MailView } from '@/components/mail-hub/mail-view';
import { EmptyState, ErrorNotice, PageHeader, Spinner } from '@/components/mail-hub/ui';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { mailApi, startOAuth, type SharedMailboxRow } from '@/lib/mail-hub/client';

/**
 * Team mailboxes. Reading one takes both halves of access: an ERP membership (granted on the
 * Permissions page) and the email provider confirming that *your own* account has been given the
 * mailbox. The second half is what "Verify my access" checks.
 */
export default function MailSharedPage() {
  const router = useRouter();
  const pathname = usePathname() ?? '/mail/shared';
  const params = useSearchParams();
  const { data, refresh } = useMailHub();
  const { value, loading, error, reload } = useLoader(() => mailApi.shared(), []);
  const mailboxes = useMemo(() => value?.sharedMailboxes ?? [], [value]);
  const selectedAccount = params?.get('account') ?? mailboxes.find((mailbox) => mailbox.access.canRead)?.accountId ?? null;
  const selected = mailboxes.find((mailbox) => mailbox.accountId === selectedAccount) ?? null;

  if (!data) return null;
  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (loading && !value) return <Spinner />;

  if (!mailboxes.length) {
    return (
      <>
        <PageHeader title="Shared mailboxes" />
        <EmptyState icon={<Users className="h-10 w-10" />} title="You are not a member of any shared mailbox" body="An administrator adds members on Settings › Permissions & sharing." />
      </>
    );
  }

  return (
    <div className="space-y-3">
      {mailboxes.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Mailbox</span>
          <Select value={selectedAccount ?? ''} onValueChange={(value) => router.replace(`${pathname}?account=${value}`)}>
            <SelectTrigger className="h-9 w-[280px] bg-white"><SelectValue placeholder="Choose a shared mailbox" /></SelectTrigger>
            <SelectContent>
              {mailboxes.map((mailbox) => (
                <SelectItem key={mailbox.id} value={mailbox.accountId}>{mailbox.name} ({mailbox.address}){mailbox.access.canRead ? '' : ' — no access yet'}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {selected && !selected.access.canRead ? (
        <AccessNeeded mailbox={selected} onVerified={() => { void reload(); void refresh(); }} />
      ) : selected ? (
        <MailView view="inbox" title={selected.name} sharedAccountId={selected.accountId} sharedLabel={`${selected.address}${selected.departmentName ? ` · ${selected.departmentName}` : ''} · replies due within ${selected.responseHours || '—'} h`} />
      ) : null}
    </div>
  );
}

function AccessNeeded({ mailbox, onVerified }: { mailbox: SharedMailboxRow; onVerified: () => void }) {
  const { toast } = useToast();
  const { data } = useMailHub();
  const [busy, setBusy] = useState(false);
  const own = (data?.accounts ?? []).filter((account) => account.kind === 'personal' && account.provider === mailbox.provider);
  const [accountId, setAccountId] = useState(mailbox.membership?.memberAccountId ?? own[0]?.id ?? '');
  const grant = mailbox.membership?.providerGrant;

  const verify = async () => {
    if (!mailbox.membership) return;
    setBusy(true);
    try {
      const result = await mailApi.verifyMember(mailbox.id, mailbox.membership.userId, accountId || null);
      toast({ title: result.grant.read === 'verified' ? 'Access verified' : 'Not verified', description: result.grant.detail ?? undefined, variant: result.grant.read === 'verified' ? undefined : 'destructive' });
      onVerified();
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Verification failed', description: caught instanceof Error ? caught.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader title={mailbox.name} description={mailbox.address} />
      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            <p className="font-medium">{mailbox.access.reason ?? 'You cannot open this mailbox yet.'}</p>
            {mailbox.membership ? (
              <>
                <p className="text-muted-foreground">
                  Your ERP membership is in place. The email provider must also confirm that your own {mailbox.provider === 'gmail' ? 'Google' : mailbox.provider === 'microsoft' ? 'Microsoft 365' : 'company'} account has been given this mailbox.
                  {grant?.detail ? ` Last check: ${grant.detail}` : ''}
                </p>
                {own.length === 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {mailbox.provider === 'imap' ? (
                      <Button asChild size="sm"><Link href="/mail/settings/accounts">Connect your company mailbox</Link></Button>
                    ) : (
                      <Button size="sm" onClick={() => startOAuth(mailbox.provider as 'gmail' | 'microsoft', { purpose: 'member-verify', sharedMailboxId: mailbox.id, returnTo: '/mail/shared' })}>
                        Connect your {mailbox.provider === 'gmail' ? 'Google' : 'Microsoft 365'} account
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={accountId} onValueChange={setAccountId}>
                      <SelectTrigger className="h-9 w-[260px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{own.map((account) => <SelectItem key={account.id} value={account.id}>{account.emailAddress}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="sm" onClick={verify} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}Verify my access</Button>
                    {mailbox.provider === 'microsoft' && (
                      <Button size="sm" variant="outline" onClick={() => startOAuth('microsoft', { purpose: 'member-verify', sharedMailboxId: mailbox.id, returnTo: '/mail/shared' })}>
                        Grant delegated access
                      </Button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Ask a Mail Hub administrator to add you as a member.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
